"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { getWhatsAppProvider } from "@/lib/integrations/whatsapp/provider";
import type {
  InstanceRef,
  InstanceStatus,
} from "@/lib/integrations/whatsapp/provider";
import {
  nomeDaInstancia,
  UazapiProvider,
} from "@/lib/integrations/whatsapp/uazapi";
import { createAdminClient } from "@/lib/supabase/admin";

// Conexao do WhatsApp por clinica (Tela 13). Cada clinica ganha a PROPRIA
// instancia no uazapi, criada no primeiro acesso com o token administrativo:
// e isso que torna o cadastro de clientes escalavel, sem intervencao tecnica.
// Escrita em whatsapp_account e whatsapp_account_secret e sempre por service
// role (tabelas sem policy de escrita), com papel conferido aqui.
//
// Fica em lib/actions porque as mesmas acoes servem duas telas: o onboarding
// de primeiro acesso (/whatsapp) e a aba de conexao das Configuracoes.

const DICA_SEM_PERMISSAO =
  "Somente administradores e gestores conectam o WhatsApp";

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

type SecretRow = {
  instance_token: string | null;
  webhook_secret: string;
};

// Quem edita Configuracoes conecta o numero (administrador e gestor). A
// checagem vale para as tres acoes, inclusive a consulta de status: o QR e o
// token da instancia sao segredo da clinica.
async function requireManageContext() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error: permissionHint(role, "configuracoes") ?? DICA_SEM_PERMISSAO,
    };
  }
  return {
    clinicId: context.active.clinicId,
    clinicName: context.active.clinicName,
    slug: context.active.slug,
  };
}

// A conexao alimenta a faixa vermelha do shell e o checklist do Inicio; sem
// revalidar, as duas telas continuam mostrando o estado anterior. Fora do
// poll, que roda a cada 2,5s.
function revalidarTelasDeConexao(): void {
  revalidatePath("/configuracoes");
  revalidatePath("/inicio");
}

async function loadAccount(clinicId: string) {
  const admin = createAdminClient();

  await admin.from("whatsapp_account").upsert(
    {
      clinic_id: clinicId,
      provider: process.env.WHATSAPP_PROVIDER ?? "fake",
    },
    { onConflict: "clinic_id", ignoreDuplicates: true },
  );
  await admin
    .from("whatsapp_account_secret")
    .upsert(
      { clinic_id: clinicId },
      { onConflict: "clinic_id", ignoreDuplicates: true },
    );

  const [{ data: account }, { data: secret }] = await Promise.all([
    admin
      .from("whatsapp_account")
      .select(
        "provider, server_url, instance_id, display_phone, connection_status",
      )
      .eq("clinic_id", clinicId)
      .single(),
    admin
      .from("whatsapp_account_secret")
      .select("instance_token, webhook_secret")
      .eq("clinic_id", clinicId)
      .single(),
  ]);

  return {
    admin,
    account: account as AccountRow,
    secret: secret as SecretRow,
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

/**
 * Endereco publico do sistema, para o provedor conseguir chamar o webhook de
 * volta. Em desenvolvimento com tunel, PUBLIC_APP_URL tem precedencia sobre a
 * origem da requisicao (que seria localhost e o uazapi nao alcanca).
 */
async function publicOrigin(): Promise<string> {
  const configurada = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configurada) {
    return configurada;
  }
  const headerStore = await headers();
  return (
    headerStore.get("origin") ??
    `http://${headerStore.get("host") ?? "localhost:3000"}`
  );
}

function toState(status: InstanceStatus, phone: string | null): ConnectState {
  return {
    status: status.status,
    qrCode: status.qrCode ?? null,
    displayPhone: status.displayPhone ?? phone,
  };
}

function mensagemDeErro(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("limite de instâncias")) {
      return error.message;
    }
    if (error.message.includes("UAZAPI_SERVER_URL")) {
      return "O servidor do WhatsApp não está configurado. Fale com o suporte.";
    }
  }
  return "Não foi possível falar com o servidor do WhatsApp. Tente de novo em instantes.";
}

export async function connectWhatsAppAction(): Promise<ConnectState> {
  const guard = await requireManageContext();
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
  let ref: InstanceRef = {
    clinicId: guard.clinicId,
    serverUrl: account.server_url,
    instanceToken: secret.instance_token,
    instanceId: account.instance_id,
  };

  try {
    // 1. A clinica ainda nao tem instancia? Cria uma, com o token
    // administrativo, e guarda o token proprio dela.
    if (!ref.instanceToken && provider instanceof UazapiProvider) {
      const nome = nomeDaInstancia(guard.slug, guard.clinicId);
      const criada = await provider.createInstance(ref, nome);
      await admin
        .from("whatsapp_account_secret")
        .update({ instance_token: criada.instanceToken })
        .eq("clinic_id", guard.clinicId);
      await admin
        .from("whatsapp_account")
        .update({ instance_id: criada.instanceId ?? nome })
        .eq("clinic_id", guard.clinicId);
      ref = {
        ...ref,
        instanceToken: criada.instanceToken,
        instanceId: criada.instanceId ?? nome,
      };
    }

    // 2. Configura o webhook ANTES de conectar, para nao perder a primeira
    // mensagem nem o evento de conexao.
    const origin = await publicOrigin();
    try {
      await provider.configureWebhook(
        ref,
        `${origin}/api/webhooks/whatsapp?clinic=${guard.clinicId}&secret=${secret.webhook_secret}`,
      );
    } catch {
      // Configuracao de webhook e reexecutavel; falha aqui nao derruba o QR.
    }

    // 3. Dispara o pareamento e devolve o QR.
    const status = await provider.connectInstance(ref);
    await persistStatus(admin, guard.clinicId, status);
    revalidarTelasDeConexao();
    return toState(status, account.display_phone);
  } catch (error) {
    return {
      status: account.connection_status,
      qrCode: null,
      displayPhone: account.display_phone,
      error: mensagemDeErro(error),
    };
  }
}

export async function pollWhatsAppStatusAction(): Promise<ConnectState> {
  const guard = await requireManageContext();
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
  const guard = await requireManageContext();
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
  revalidarTelasDeConexao();
  return {
    status: "desconectado",
    qrCode: null,
    displayPhone: account.display_phone,
  };
}
