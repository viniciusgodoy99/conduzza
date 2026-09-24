"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  CanalNaoConfiguradoError,
  conexaoRecusadaNoAmbiente,
  getWhatsAppProvider,
  MENSAGEM_CANAL_NAO_CONFIGURADO,
  provedorDoAmbiente,
} from "@/lib/integrations/whatsapp/provider";
import type {
  InstanceRef,
  InstanceStatus,
  WhatsAppProvider,
} from "@/lib/integrations/whatsapp/provider";
import {
  nomeDaInstancia,
  UazapiHttpError,
  UazapiProvider,
} from "@/lib/integrations/whatsapp/uazapi";
import { log } from "@/lib/log";
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
  /** a acao falhou: o texto diz o que houve e o que fazer */
  error?: string;
  /**
   * A conexao andou, mas com um problema que continua valendo (hoje, o
   * recebimento de mensagens nao configurado). Separado de `error` porque a
   * tela o mantem visivel durante o pareamento e depois de conectar: antes ele
   * sumia na primeira consulta de status, 2,5 segundos depois.
   */
  aviso?: string;
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

type ContaCarregada = {
  admin: ReturnType<typeof createAdminClient>;
  account: AccountRow;
  secret: SecretRow;
};

async function loadAccount(
  clinicId: string,
): Promise<ContaCarregada | { erro: string }> {
  const admin = createAdminClient();

  // A conta nasce com o provedor do AMBIENTE. Em producao sem provedor real
  // configurado nao nasce: antes ela nascia 'fake', conectava na hora com um
  // numero ficticio e ficava gravada assim para sempre.
  const provedor = provedorDoAmbiente();
  if (provedor) {
    await admin
      .from("whatsapp_account")
      .upsert(
        { clinic_id: clinicId, provider: provedor },
        { onConflict: "clinic_id", ignoreDuplicates: true },
      );
  }
  const { data: account } = await admin
    .from("whatsapp_account")
    .select(
      "provider, server_url, instance_id, display_phone, connection_status",
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!account) {
    return { erro: MENSAGEM_CANAL_NAO_CONFIGURADO };
  }

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
    .maybeSingle();
  if (!secret) {
    return {
      erro: "Não foi possível carregar a conexão desta clínica. Tente de novo em instantes.",
    };
  }

  return {
    admin,
    account: account as AccountRow,
    secret: secret as SecretRow,
  };
}

/** Recusa 401 ou 404: a instancia guardada nao vale mais no servidor. */
function instanciaInvalida(error: unknown): boolean {
  return (
    error instanceof UazapiHttpError &&
    error.operacao !== "criar" &&
    error.motivo === "instancia_invalida"
  );
}

/** Cria a instancia da clinica e guarda o token proprio dela. */
async function criarInstancia(
  admin: ReturnType<typeof createAdminClient>,
  guard: { clinicId: string; slug: string },
  provider: UazapiProvider,
  ref: InstanceRef,
): Promise<InstanceRef> {
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
  return {
    ...ref,
    instanceToken: criada.instanceToken,
    instanceId: criada.instanceId ?? nome,
  };
}

/**
 * Esquece a instancia que o servidor nao reconhece mais.
 *
 * Vem ANTES de criar a nova, e de proposito: se a criacao falhar, o proximo
 * clique ja cria do zero, em vez de insistir no token morto. Antes nao havia
 * caminho na tela para sair disso, so mexendo direto no banco.
 */
async function descartarInstancia(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string,
): Promise<void> {
  await admin
    .from("whatsapp_account_secret")
    .update({ instance_token: null, qr_code: null })
    .eq("clinic_id", clinicId);
  await admin
    .from("whatsapp_account")
    .update({ instance_id: null })
    .eq("clinic_id", clinicId);
}

// O mesmo texto aparece em dois momentos (a tela o mantem do QR ate depois
// de conectar), entao ele tem de ser verdade nos dois: nao afirma que o
// numero ja conectou (com o QR na tela, ainda nao) e nao manda clicar num
// botao que o cartao "WhatsApp conectado" nao tem. Conectado, a unica forma de
// refazer a configuracao e desconectar e ler o QR de novo, e o texto diz isso.
const AVISO_WEBHOOK =
  "Não foi possível configurar o recebimento de mensagens deste número: as respostas dos pacientes não vão chegar até isso ser resolvido. Para tentar de novo, clique em Conectar WhatsApp; se o número já estiver conectado, é preciso desconectar e ler o QR code outra vez. Se continuar, fale com o suporte.";

/**
 * Webhook e pareamento, na ordem certa.
 *
 * O webhook vem ANTES de conectar, para nao perder a primeira mensagem nem o
 * evento de conexao. Recusa de instancia (401/404) sobe para quem chama
 * recriar a instancia; qualquer outra falha do webhook vira aviso, nunca
 * silencio. O 409 (pareamento ja aberto) devolve o QR que ja existe.
 */
async function parear(
  provider: WhatsAppProvider,
  ref: InstanceRef,
  urlDoWebhook: string,
): Promise<{ status: InstanceStatus; avisoDoWebhook: string | null }> {
  let avisoDoWebhook: string | null = null;
  try {
    await provider.configureWebhook(ref, urlDoWebhook);
  } catch (error) {
    if (instanciaInvalida(error)) {
      throw error;
    }
    log.warn("whatsapp_webhook_nao_configurado", {
      clinic_id: ref.clinicId,
      http_status: error instanceof UazapiHttpError ? error.status : null,
    });
    avisoDoWebhook = AVISO_WEBHOOK;
  }

  try {
    return {
      status: await provider.connectInstance(ref),
      avisoDoWebhook,
    };
  } catch (error) {
    if (
      error instanceof UazapiHttpError &&
      error.motivo === "fluxo_em_andamento"
    ) {
      return { status: await provider.getStatus(ref), avisoDoWebhook };
    }
    throw error;
  }
}

async function persistStatus(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string,
  status: InstanceStatus,
): Promise<void> {
  // TRANSICAO primeiro, com o .neq do webhook: os carimbos connected_at e
  // disconnected_at marcam o instante em que o status MUDOU. Sem o guard, o
  // poll de 2,5s reescrevia disconnected_at a cada passagem e o instante
  // real da queda se perdia (achado da exploracao de 19/09/2026).
  await admin
    .from("whatsapp_account")
    .update({
      connection_status: status.status,
      ...(status.status === "conectado"
        ? { connected_at: new Date().toISOString() }
        : {}),
      ...(status.status === "desconectado"
        ? { disconnected_at: new Date().toISOString() }
        : {}),
    })
    .eq("clinic_id", clinicId)
    .neq("connection_status", status.status);

  // Metadados sempre, mudanca de status ou nao.
  if (status.displayPhone || status.instanceId) {
    await admin
      .from("whatsapp_account")
      .update({
        ...(status.displayPhone ? { display_phone: status.displayPhone } : {}),
        ...(status.instanceId ? { instance_id: status.instanceId } : {}),
      })
      .eq("clinic_id", clinicId);
  }

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

const TEXTO_INSTANCIA_PERDIDA =
  "O servidor do WhatsApp não reconhece mais a conexão desta clínica. Clique em Conectar WhatsApp para refazer a conexão.";

function mensagemDeErro(error: unknown): string {
  if (error instanceof CanalNaoConfiguradoError) {
    return MENSAGEM_CANAL_NAO_CONFIGURADO;
  }
  if (error instanceof UazapiHttpError) {
    if (error.operacao === "criar") {
      return error.motivo === "limite_de_conexoes"
        ? "O servidor do WhatsApp atingiu o limite de números conectados. Fale com o suporte."
        : "O servidor do WhatsApp recusou criar a conexão desta clínica. Fale com o suporte.";
    }
    switch (error.motivo) {
      case "instancia_invalida":
        // So chega aqui com uma instancia recem criada sendo recusada (a
        // guardada ja foi descartada e refeita): repetir o clique nao resolve.
        return "O servidor do WhatsApp recusou a conexão desta clínica, mesmo com uma conexão nova. Fale com o suporte.";
      case "limite_de_conexoes":
        return "O servidor do WhatsApp atingiu o limite de conexões ao mesmo tempo. Tente de novo em alguns minutos.";
      case "fluxo_em_andamento":
        return "Já existe um pareamento em andamento para este número. Aguarde um instante e clique em Verificar agora.";
      default:
        return `O servidor do WhatsApp recusou o pedido (código ${error.status}). Tente de novo; se continuar, fale com o suporte.`;
    }
  }
  if (
    error instanceof Error &&
    (error.message.includes("UAZAPI_SERVER_URL") ||
      error.message.includes("UAZAPI_ADMIN_TOKEN"))
  ) {
    return "O servidor do WhatsApp não está configurado. Fale com o suporte.";
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
  const carregada = await loadAccount(guard.clinicId);
  if ("erro" in carregada) {
    return {
      status: "desconectado",
      qrCode: null,
      displayPhone: null,
      error: carregada.erro,
    };
  }
  const { admin, account, secret } = carregada;
  let ref: InstanceRef = {
    clinicId: guard.clinicId,
    serverUrl: account.server_url,
    instanceToken: secret.instance_token,
    instanceId: account.instance_id,
  };
  // O que a tela mostra se algo falhar no caminho. Vira desconectado quando a
  // instancia guardada se prova morta, mesmo que a recriacao falhe depois.
  let statusConhecido: ConnectState["status"] = account.connection_status;

  try {
    // Em producao, conta com provedor 'fake' (gravada por um deploy mal
    // configurado) nao conecta: a tela diz isso com todas as letras em vez de
    // "conectar" o simulador com um numero ficticio.
    if (conexaoRecusadaNoAmbiente(account.provider)) {
      throw new CanalNaoConfiguradoError();
    }
    const provider = getWhatsAppProvider(account.provider);
    const uazapi = provider instanceof UazapiProvider ? provider : null;
    // So se recria o que ja existia antes deste clique: uma instancia recem
    // criada recusando o proprio token nao se resolve criando outra.
    const tinhaInstanciaGuardada = Boolean(ref.instanceToken);

    // 1. A clinica ainda nao tem instancia? Cria uma, com o token
    // administrativo, e guarda o token proprio dela.
    if (!ref.instanceToken && uazapi) {
      ref = await criarInstancia(admin, guard, uazapi, ref);
    }

    const origin = await publicOrigin();
    let avisoDeEndereco: string | null = null;
    if (origin.includes("localhost") || origin.startsWith("http://")) {
      // O provedor chama de FORA: um endereco local nunca vai ser alcancado, e
      // conectar assim entrega metade do produto (a clinica envia e nunca
      // recebe resposta nenhuma) parecendo sucesso.
      avisoDeEndereco =
        "O endereço público do sistema não está configurado, então as respostas dos pacientes não vão chegar. Configure PUBLIC_APP_URL antes de usar com paciente de verdade.";
    }
    const urlDoWebhook = `${origin}/api/webhooks/whatsapp?clinic=${guard.clinicId}&secret=${secret.webhook_secret}`;

    // 2 e 3. Webhook e pareamento. Se o servidor nao reconhece mais a
    // instancia guardada (apagada ou recriada no painel do servidor
    // compartilhado), descarta o token, cria outra e repete UMA vez, com a URL
    // do webhook regravada na nova.
    let pareamento: Awaited<ReturnType<typeof parear>>;
    try {
      pareamento = await parear(provider, ref, urlDoWebhook);
    } catch (error) {
      if (!uazapi || !tinhaInstanciaGuardada || !instanciaInvalida(error)) {
        throw error;
      }
      log.warn("whatsapp_instancia_recriada", {
        clinic_id: guard.clinicId,
        http_status: error instanceof UazapiHttpError ? error.status : null,
      });
      await descartarInstancia(admin, guard.clinicId);
      await persistStatus(admin, guard.clinicId, { status: "desconectado" });
      statusConhecido = "desconectado";
      ref = await criarInstancia(admin, guard, uazapi, {
        ...ref,
        instanceToken: null,
        instanceId: null,
      });
      pareamento = await parear(provider, ref, urlDoWebhook);
    }

    await persistStatus(admin, guard.clinicId, pareamento.status);
    revalidarTelasDeConexao();
    const estado = toState(pareamento.status, account.display_phone);
    const aviso = avisoDeEndereco ?? pareamento.avisoDoWebhook;
    return aviso ? { ...estado, aviso } : estado;
  } catch (error) {
    if (statusConhecido !== account.connection_status) {
      revalidarTelasDeConexao();
    }
    return {
      status: statusConhecido,
      qrCode: null,
      displayPhone: account.display_phone,
      error: mensagemDeErro(error),
    };
  }
}

// Checagem de status para QUALQUER membro ativo (o botao "Verificar
// conexao" da faixa vermelha): consulta o provedor e grava, mas NAO devolve
// QR nem segredo, so o status. O pollWhatsAppStatusAction continua
// admin/gestor porque carrega o QR do pareamento.
export async function checarConexaoAction(): Promise<{
  status: string | null;
  error?: string;
}> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { status: null, error: "Sessão expirada. Entre de novo." };
  }
  const clinicId = context.active.clinicId;
  const admin = createAdminClient();
  // Leitura SECA (sem os upserts do loadAccount): membro conferindo status
  // nao pode criar conta de WhatsApp do nada.
  const { data: account } = await admin
    .from("whatsapp_account")
    .select("provider, server_url, instance_id, connection_status")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!account) {
    return { status: null };
  }
  const { data: secret } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  try {
    const provider = getWhatsAppProvider(account.provider);
    const status = await provider.getStatus({
      clinicId,
      serverUrl: account.server_url,
      instanceToken: secret?.instance_token ?? null,
      instanceId: account.instance_id,
    });
    await persistStatus(admin, clinicId, status);
    return { status: status.status };
  } catch (error) {
    // Instancia que o servidor nao reconhece mais E desconexao, e das que so
    // se resolvem conectando de novo: grava, para a faixa vermelha aparecer.
    if (instanciaInvalida(error)) {
      await persistStatus(admin, clinicId, { status: "desconectado" });
      return { status: "desconectado" };
    }
    // Provedor fora do ar: devolve o que o banco sabe, sem gravar nada.
    return { status: account.connection_status as string };
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
  const carregada = await loadAccount(guard.clinicId);
  if ("erro" in carregada) {
    return {
      status: "desconectado",
      qrCode: null,
      displayPhone: null,
      error: carregada.erro,
    };
  }
  const { admin, account, secret } = carregada;
  try {
    const provider = getWhatsAppProvider(account.provider);
    const status = await provider.getStatus({
      clinicId: guard.clinicId,
      serverUrl: account.server_url,
      instanceToken: secret.instance_token,
      instanceId: account.instance_id,
    });
    await persistStatus(admin, guard.clinicId, status);
    return toState(status, account.display_phone);
  } catch (error) {
    if (instanciaInvalida(error)) {
      // Antes isto virava "Desconectado" mudo, e clicar de novo dava o mesmo.
      // Agora a tela diz o que houve, e Conectar recria a instancia.
      await persistStatus(admin, guard.clinicId, { status: "desconectado" });
      revalidarTelasDeConexao();
      return {
        status: "desconectado",
        qrCode: null,
        displayPhone: account.display_phone,
        error: TEXTO_INSTANCIA_PERDIDA,
      };
    }
    if (
      error instanceof CanalNaoConfiguradoError ||
      (error instanceof UazapiHttpError &&
        error.motivo === "limite_de_conexoes")
    ) {
      return {
        status: account.connection_status,
        qrCode: null,
        displayPhone: account.display_phone,
        error: mensagemDeErro(error),
      };
    }
    // Falha passageira de rede: o laco de 2,5 segundos tenta de novo, e um
    // erro aqui piscaria na tela a cada volta.
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
  const carregada = await loadAccount(guard.clinicId);
  if ("erro" in carregada) {
    return {
      status: "desconectado",
      qrCode: null,
      displayPhone: null,
      error: carregada.erro,
    };
  }
  const { admin, account, secret } = carregada;
  try {
    const provider = getWhatsAppProvider(account.provider);
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
