"use server";

import { headers } from "next/headers";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { getWhatsAppProvider } from "@/lib/integrations/whatsapp/provider";
import type {
  InstanceRef,
  InstanceStatus,
} from "@/lib/integrations/whatsapp/provider";
import { createAdminClient } from "@/lib/supabase/admin";

// Acoes da conexao do WhatsApp (Tela 13, reformulada para o canal uazapi/fake:
// pareamento por QR, sem o assistente da Meta). Escrita em whatsapp_account e
// whatsapp_account_secret e sempre via service role (tabelas sem policy de
// escrita), com papel checado aqui.

export type ConnectState = {
  status: "desconectado" | "aguardando_qr" | "conectando" | "conectado";
  qrCode: string | null;
  displayPhone: string | null;
  error?: string;
};

type AccountRow = {
  provider: "fake" | "uazapi" | "cloud_api";
  server_url: string | null;
  instance_id: string | null;
  display_phone: string | null;
  connection_status: ConnectState["status"];
};

async function requireAdminContext() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (context.active.role !== "admin") {
    return { error: "Somente administradores conectam o WhatsApp" as const };
  }
  return { clinicId: context.active.clinicId };
}

async function loadAccount(clinicId: string) {
  const admin = createAdminClient();

  const { data: account } = await admin
    .from("whatsapp_account")
    .upsert(
      {
        clinic_id: clinicId,
        provider: process.env.WHATSAPP_PROVIDER ?? "fake",
      },
      { onConflict: "clinic_id", ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();

  const { data: existing } = await admin
    .from("whatsapp_account")
    .select(
      "provider, server_url, instance_id, display_phone, connection_status",
    )
    .eq("clinic_id", clinicId)
    .single();

  await admin
    .from("whatsapp_account_secret")
    .upsert(
      { clinic_id: clinicId },
      { onConflict: "clinic_id", ignoreDuplicates: true },
    );

  const { data: secret } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token, webhook_secret")
    .eq("clinic_id", clinicId)
    .single();

  return {
    admin,
    account: (account ?? existing) as AccountRow,
    secret: secret as { instance_token: string | null; webhook_secret: string },
  };
}

async function persistStatus(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string,
  status: InstanceStatus,
): Promise<void> {
  await admin
    .from("whatsapp_account")
    .update({
      connection_status: status.status,
      ...(status.displayPhone ? { display_phone: status.displayPhone } : {}),
      ...(status.instanceId ? { instance_id: status.instanceId } : {}),
      ...(status.status === "conectado"
        ? { connected_at: new Date().toISOString() }
        : {}),
      ...(status.status === "desconectado"
        ? { disconnected_at: new Date().toISOString() }
        : {}),
    })
    .eq("clinic_id", clinicId);

  await admin
    .from("whatsapp_account_secret")
    .update({
      qr_code: status.qrCode ?? null,
      ...(status.instanceToken ? { instance_token: status.instanceToken } : {}),
    })
    .eq("clinic_id", clinicId);
}

function toState(status: InstanceStatus, phone: string | null): ConnectState {
  return {
    status: status.status,
    qrCode: status.qrCode ?? null,
    displayPhone: status.displayPhone ?? phone,
  };
}

export async function connectWhatsAppAction(): Promise<ConnectState> {
  const guard = await requireAdminContext();
  if ("error" in guard) {
    return {
      status: "desconectado",
      qrCode: null,
      displayPhone: null,
      error: guard.error,
    };
  }
  const { admin, account, secret } = await loadAccount(guard.clinicId);
  const provider = getWhatsAppProvider(account.provider);
  const ref: InstanceRef = {
    clinicId: guard.clinicId,
    serverUrl: account.server_url,
    instanceToken: secret.instance_token,
    instanceId: account.instance_id,
  };

  try {
    const status = await provider.connectInstance(ref);
    await persistStatus(admin, guard.clinicId, status);

    const headerStore = await headers();
    const origin =
      headerStore.get("origin") ??
      `http://${headerStore.get("host") ?? "localhost:3000"}`;
    try {
      await provider.configureWebhook(
        { ...ref, instanceToken: status.instanceToken ?? ref.instanceToken },
        `${origin}/api/webhooks/whatsapp?clinic=${guard.clinicId}&secret=${secret.webhook_secret}`,
      );
    } catch {
      // Configuracao de webhook e reexecutavel; falha aqui nao derruba o QR.
    }

    return toState(status, account.display_phone);
  } catch (error) {
    return {
      status: account.connection_status,
      qrCode: null,
      displayPhone: account.display_phone,
      error:
        error instanceof Error
          ? "Não foi possível falar com o servidor do WhatsApp. Confira a configuração."
          : "Falha inesperada na conexão.",
    };
  }
}

export async function pollWhatsAppStatusAction(): Promise<ConnectState> {
  const guard = await requireAdminContext();
  if ("error" in guard) {
    return {
      status: "desconectado",
      qrCode: null,
      displayPhone: null,
      error: guard.error,
    };
  }
  const { admin, account, secret } = await loadAccount(guard.clinicId);
  const provider = getWhatsAppProvider(account.provider);
  try {
    const status = await provider.getStatus({
      clinicId: guard.clinicId,
      serverUrl: account.server_url,
      instanceToken: secret.instance_token,
      instanceId: account.instance_id,
    });
    await persistStatus(admin, guard.clinicId, status);
    return toState(status, account.display_phone);
  } catch {
    return {
      status: account.connection_status,
      qrCode: null,
      displayPhone: account.display_phone,
    };
  }
}

export async function disconnectWhatsAppAction(): Promise<ConnectState> {
  const guard = await requireAdminContext();
  if ("error" in guard) {
    return {
      status: "desconectado",
      qrCode: null,
      displayPhone: null,
      error: guard.error,
    };
  }
  const { admin, account, secret } = await loadAccount(guard.clinicId);
  const provider = getWhatsAppProvider(account.provider);
  try {
    await provider.disconnect({
      clinicId: guard.clinicId,
      serverUrl: account.server_url,
      instanceToken: secret.instance_token,
      instanceId: account.instance_id,
    });
  } catch {
    // Mesmo sem alcance ao servidor, o estado local vira desconectado.
  }
  await persistStatus(admin, guard.clinicId, { status: "desconectado" });
  return {
    status: "desconectado",
    qrCode: null,
    displayPhone: account.display_phone,
  };
}
