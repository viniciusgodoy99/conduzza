"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
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
  motivoDaRecusaVigente,
  motivosDaRecusaVigentes,
  recusarCelularDuplicado,
  type Pareamento,
  type RecusaDaTrava,
} from "@/lib/integrations/whatsapp/trava-celular";
import {
  nomeDaInstancia,
  UazapiHttpError,
  UazapiProvider,
} from "@/lib/integrations/whatsapp/uazapi";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Conexao do WhatsApp por NUMERO (Tela 13; docs/07, Fase 2). Cada numero da
// clinica (whatsapp_account.id) ganha a PROPRIA instancia no uazapi, criada
// no primeiro acesso com o token administrativo: e isso que torna o cadastro
// de clientes escalavel, sem intervencao tecnica. Escrita em
// whatsapp_account e whatsapp_account_secret e sempre por service role
// (tabelas sem policy de escrita), com papel conferido aqui.
//
// Toda acao recebe o id do numero e filtra por clinica E id: nenhuma leitura
// ou escrita "da clinica" sobrou, porque com mais de um numero ela pegaria um
// qualquer. Sem id (clinica que ainda nao tem numero), a conexao cria o
// principal.
//
// Fica em lib/actions porque as mesmas acoes servem duas telas: o onboarding
// de primeiro acesso (/whatsapp) e a aba de conexao das Configuracoes.

const DICA_SEM_PERMISSAO =
  "Somente administradores e gestores conectam o WhatsApp";
// D8 do docs/07: remover e so do administrador.
const DICA_SO_ADMIN = "Somente administradores removem um número de WhatsApp.";
// D1: o numero que nasce sozinho numa clinica sem numero.
const NOME_DO_PRINCIPAL = "Número principal";

const TEXTO_NUMERO_INVALIDO =
  "Número de WhatsApp inválido. Recarregue a página e tente de novo.";
const TEXTO_NUMERO_NAO_ENCONTRADO =
  "Este número não existe mais nesta clínica. Recarregue a página.";
const TEXTO_FALHA_DE_LEITURA =
  "Não foi possível carregar os números desta clínica. Tente de novo em instantes.";

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
  /**
   * O numero (whatsapp_account.id) desta conexao. A tela que abriu sem numero
   * (clinica nova) recebe aqui o id do principal que a acao criou, e passa a
   * usa-lo nas chamadas seguintes.
   */
  accountId?: string;
};

/** Resultado das acoes de cadastro do numero (adicionar, renomear...). */
export type NumeroActionResult = {
  ok: boolean;
  error?: string;
  /** o numero criado ou alterado */
  accountId?: string;
};

type AccountRow = {
  id: string;
  provider: "fake" | "uazapi" | "cloud_api";
  server_url: string | null;
  instance_id: string | null;
  display_phone: string | null;
  connection_status: ConnectState["status"];
  nome: string;
  principal: boolean;
  connected_at: string | null;
};

const COLUNAS_DA_CONTA =
  "id, provider, server_url, instance_id, display_phone, connection_status, nome, principal, connected_at";

type SecretRow = {
  instance_token: string | null;
  webhook_secret: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

/** O numero em que a acao mexe: sempre clinica E id. */
type NumeroAlvo = { clinicId: string; accountId: string };

type Guard = {
  clinicId: string;
  clinicName: string;
  slug: string;
  userId: string;
  role: Role;
};

const idDoNumero = z.uuid();
const idDoNumeroOuNulo = z.uuid().nullable();
const nomeDoNumero = z.string().trim().min(1).max(40);
const numeroNovoSchema = z.object({
  nome: nomeDoNumero,
  unitId: z.uuid().nullable().optional(),
});
// So o campo que veio e gravado: o dialogo de Unidade manda so a unidade e o
// de Renomear so o nome. Regravar o nome do retrato da tela desfazia um
// renomear feito em outra aba enquanto esta estava aberta.
const numeroEditadoSchema = z
  .object({
    accountId: z.uuid(),
    /** ausente: o nome fica como esta */
    nome: nomeDoNumero.optional(),
    /** ausente: a unidade fica como esta; nulo: tira a unidade */
    unitId: z.uuid().nullable().optional(),
  })
  .refine((dados) => dados.nome !== undefined || dados.unitId !== undefined);
const TEXTO_NOME_INVALIDO =
  "Dê um nome ao número, com até 40 caracteres, e escolha a unidade da lista.";

// Quem edita Configuracoes conecta o numero (administrador e gestor). A
// checagem vale para todas as acoes de conexao, inclusive a consulta de
// status: o QR e o token da instancia sao segredo da clinica. Adicionar,
// renomear, trocar a unidade e escolher o principal tambem (D8).
async function requireManageContext(): Promise<Guard | { error: string }> {
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
    userId: context.userId,
    role,
  };
}

// Remover um numero encerra as conversas abertas dele (D3): so o
// administrador (D8).
async function requireAdminContext(): Promise<Guard | { error: string }> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return guard;
  }
  if (guard.role !== "admin") {
    return { error: DICA_SO_ADMIN };
  }
  return guard;
}

// A conexao alimenta a faixa vermelha do shell e o checklist do Inicio; sem
// revalidar, as duas telas continuam mostrando o estado anterior. Fora do
// poll, que roda a cada 2,5s.
function revalidarTelasDeConexao(): void {
  revalidatePath("/configuracoes");
  revalidatePath("/inicio");
}

/**
 * Trilha das acoes de cadastro do numero. Pela sessao: a policy da trilha so
 * aceita a acao do proprio usuario. Falha da trilha nao desfaz a acao.
 */
async function registrarNaTrilha(
  guard: Guard,
  action: string,
  entity: string,
  entityId: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.userId,
    action,
    entity,
    entity_id: entityId,
  });
}

/** Os numeros ATIVOS da clinica, o principal primeiro. */
async function listarNumerosAtivos(
  admin: AdminClient,
  clinicId: string,
): Promise<AccountRow[] | null> {
  const { data, error } = await admin
    .from("whatsapp_account")
    .select(COLUNAS_DA_CONTA)
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .order("principal", { ascending: false })
    .order("created_at", { ascending: true });
  return error ? null : ((data ?? []) as AccountRow[]);
}

/**
 * Erro de gravacao do numero em texto de recepcao. O limite do plano chega
 * pelo gatilho antes_de_criar_numero (23514) e o nome repetido pelo indice
 * whatsapp_account_nome_unico (23505).
 *
 * TEMPORARIO: enquanto o unique whatsapp_account_uma_por_clinica existir
 * (sai no contrato da Fase 3), o segundo numero da clinica recebe 23505 dele.
 */
function mensagemDeCadastro(
  error: { code?: string; message?: string } | null,
): string {
  const texto = error?.message ?? "";
  switch (error?.code) {
    case "23514":
      return texto.includes("whatsapp_account_nome_tamanho")
        ? "O nome do número precisa ter de 1 a 40 caracteres."
        : "Esta clínica atingiu o limite de números do plano.";
    case "23505":
      if (texto.includes("whatsapp_account_nome_unico")) {
        return "Já existe um número com este nome nesta clínica. Escolha outro nome.";
      }
      if (texto.includes("whatsapp_account_uma_por_clinica")) {
        return "Por enquanto, esta clínica tem um número só.";
      }
      return "Não foi possível salvar este número. Tente de novo.";
    case "23503":
      return "A unidade escolhida não pertence a esta clínica.";
    default:
      return "Não foi possível salvar este número. Tente de novo.";
  }
}

/**
 * Cria o principal de uma clinica que ainda nao tem numero. A conta nasce com
 * o provedor do AMBIENTE; em producao sem provedor real configurado nao
 * nasce: antes ela nascia 'fake', conectava na hora com um numero ficticio e
 * ficava gravada assim para sempre. O gatilho antes_de_criar_numero a torna
 * principal (nao ha outro ativo).
 */
async function criarPrincipal(
  admin: AdminClient,
  clinicId: string,
): Promise<{ id: string } | { erro: string }> {
  const provedor = provedorDoAmbiente();
  if (!provedor) {
    return { erro: MENSAGEM_CANAL_NAO_CONFIGURADO };
  }
  const { data, error } = await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: provedor,
      nome: NOME_DO_PRINCIPAL,
    })
    .select("id")
    .single();
  if (data) {
    return { id: data.id as string };
  }
  // Dois cliques (ou duas abas) criando ao mesmo tempo: o segundo recebe
  // 23505 e usa o principal que o primeiro criou.
  if (error?.code === "23505") {
    const numeros = await listarNumerosAtivos(admin, clinicId);
    const principal = numeros?.find((numero) => numero.principal);
    if (principal) {
      return { id: principal.id };
    }
  }
  return { erro: mensagemDeCadastro(error) };
}

type ContaCarregada = {
  admin: AdminClient;
  account: AccountRow;
  secret: SecretRow;
};

/**
 * O numero e o segredo dele, lidos por clinica E id. Id nulo: o principal
 * ativo, e sem numero nenhum, o principal nasce aqui (a clinica nova conecta
 * sem passar por "Adicionar numero").
 */
async function loadAccount(
  clinicId: string,
  accountId: string | null,
): Promise<ContaCarregada | { erro: string }> {
  const admin = createAdminClient();

  let id = accountId;
  if (id === null) {
    const numeros = await listarNumerosAtivos(admin, clinicId);
    if (numeros === null) {
      return { erro: TEXTO_FALHA_DE_LEITURA };
    }
    const principal = numeros.find((numero) => numero.principal) ?? null;
    if (principal) {
      id = principal.id;
    } else {
      const criado = await criarPrincipal(admin, clinicId);
      if ("erro" in criado) {
        return criado;
      }
      id = criado.id;
    }
  }

  const { data: account } = await admin
    .from("whatsapp_account")
    .select(COLUNAS_DA_CONTA)
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .is("removido_em", null)
    .maybeSingle();
  if (!account) {
    return { erro: TEXTO_NUMERO_NAO_ENCONTRADO };
  }

  // O segredo e do NUMERO (PK account_id). Nasce na primeira conexao, com o
  // webhook_secret do default do banco; ja existindo, fica como esta.
  await admin
    .from("whatsapp_account_secret")
    .upsert(
      { clinic_id: clinicId, account_id: id },
      { onConflict: "account_id", ignoreDuplicates: true },
    );
  const { data: secret } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token, webhook_secret")
    .eq("clinic_id", clinicId)
    .eq("account_id", id)
    .maybeSingle();
  if (!secret) {
    return {
      erro: "Não foi possível carregar a conexão deste número. Tente de novo em instantes.",
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

/**
 * Rotulo da instancia nova no painel do uazapi.
 *
 * O principal que ja tem instance_id mantem o nome que tem (docs/07: o
 * principal atual nao e renomeado), inclusive quando a instancia e recriada
 * porque o servidor nao a reconhece mais. Numero novo, ou que nao e o
 * principal, ganha o sufixo do proprio id: instance_id e unico entre os
 * numeros ativos (indice whatsapp_account_instancia_unica), e o nome so da
 * clinica colidiria no segundo numero.
 */
function nomeDaNovaInstancia(
  guard: { slug: string; clinicId: string },
  account: AccountRow,
): string {
  if (account.principal && account.instance_id) {
    return account.instance_id;
  }
  return nomeDaInstancia(guard.slug, guard.clinicId, account.id);
}

/** Cria a instancia do numero e guarda o token proprio dela. */
async function criarInstancia(
  admin: AdminClient,
  numero: NumeroAlvo,
  provider: UazapiProvider,
  ref: InstanceRef,
  nome: string,
): Promise<InstanceRef> {
  const criada = await provider.createInstance(ref, nome);
  await admin
    .from("whatsapp_account_secret")
    .update({ instance_token: criada.instanceToken })
    .eq("clinic_id", numero.clinicId)
    .eq("account_id", numero.accountId);
  await admin
    .from("whatsapp_account")
    .update({ instance_id: criada.instanceId ?? nome })
    .eq("clinic_id", numero.clinicId)
    .eq("id", numero.accountId);
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
  admin: AdminClient,
  numero: NumeroAlvo,
): Promise<void> {
  await admin
    .from("whatsapp_account_secret")
    .update({ instance_token: null, qr_code: null })
    .eq("clinic_id", numero.clinicId)
    .eq("account_id", numero.accountId);
  await admin
    .from("whatsapp_account")
    .update({ instance_id: null })
    .eq("clinic_id", numero.clinicId)
    .eq("id", numero.accountId);
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
      whatsapp_account_id: ref.accountId ?? null,
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

/**
 * A conexao nao foi gravada como veio: o que a tela mostra e por que.
 *
 * A trava contra o MESMO celular em duas instancias (achado 10 do docs/07)
 * mora em lib/integrations/whatsapp/trava-celular.ts: ela vale tambem para o
 * evento de conexao do webhook, e todo export deste arquivo "use server"
 * viraria acao chamavel pelo navegador. Na recusa, ela mesma gira o segredo
 * do webhook, desliga a instancia e grava "desconectado".
 */
type Recusa = RecusaDaTrava;

/**
 * Quem grava o status. `abrePareamento` so no Conectar: o clique que abre o
 * pareamento grava o "conectando" que o provedor devolver, venha de onde vier.
 */
type ComoGravar = { abrePareamento?: boolean };

/**
 * O status que fica no banco depois de uma CONSULTA (gravarStatus sem
 * `abrePareamento`): "conectando" so substitui "aguardando_qr".
 */
function statusQueFica(
  anterior: ConnectState["status"],
  lido: ConnectState["status"],
): ConnectState["status"] {
  return lido === "conectando" && anterior !== "aguardando_qr"
    ? anterior
    : lido;
}

/**
 * Grava o que o provedor disse sobre o numero, sem conferir nada.
 *
 * "conectando" so e gravado DENTRO de um pareamento (achado T[0] da revisao
 * da trava): o que este clique abriu (`abrePareamento`) ou o que ja esta
 * aberto no banco ("aguardando_qr", o QR na tela). A porta da ingestao
 * (app/api/webhooks/whatsapp/route.ts) segura a mensagem de numero
 * "conectando" ate a trava decidir, entao a consulta que via a sessao ja
 * pareada reconectando rebaixava um numero "conectado" e segurava mensagem de
 * paciente. Fora do pareamento o status fica como esta (statusQueFica). O
 * evento de conexao do webhook segue a mesma regra.
 */
async function gravarStatus(
  admin: AdminClient,
  numero: NumeroAlvo,
  status: InstanceStatus,
  { abrePareamento = false }: ComoGravar = {},
): Promise<void> {
  // TRANSICAO primeiro, com o .neq do webhook: os carimbos connected_at e
  // disconnected_at marcam o instante em que o status MUDOU. Sem o guard, o
  // poll de 2,5s reescrevia disconnected_at a cada passagem e o instante
  // real da queda se perdia (achado da exploracao de 19/09/2026).
  const transicao = admin
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
    .eq("clinic_id", numero.clinicId)
    .eq("id", numero.accountId)
    .neq("connection_status", status.status);
  await (status.status === "conectando" && !abrePareamento
    ? transicao.eq("connection_status", "aguardando_qr")
    : transicao);

  // Metadados sempre, mudanca de status ou nao.
  if (status.displayPhone || status.instanceId) {
    await admin
      .from("whatsapp_account")
      .update({
        ...(status.displayPhone ? { display_phone: status.displayPhone } : {}),
        ...(status.instanceId ? { instance_id: status.instanceId } : {}),
      })
      .eq("clinic_id", numero.clinicId)
      .eq("id", numero.accountId);
  }

  await admin
    .from("whatsapp_account_secret")
    .update({
      qr_code: status.qrCode ?? null,
      ...(status.instanceToken ? { instance_token: status.instanceToken } : {}),
    })
    .eq("clinic_id", numero.clinicId)
    .eq("account_id", numero.accountId);
}

/**
 * Grava o status do numero. Com `pareamento`, confere antes a trava do
 * celular: devolve a recusa quando a conexao nova nao pode valer (e ai o
 * "conectado" nao e gravado).
 */
async function persistStatus(
  admin: AdminClient,
  numero: NumeroAlvo,
  status: InstanceStatus,
  pareamento?: Pareamento,
  comoGravar: ComoGravar = {},
): Promise<Recusa | null> {
  if (pareamento && status.status === "conectado") {
    const recusa = await recusarCelularDuplicado(
      admin,
      numero,
      status,
      pareamento,
    );
    if (recusa) {
      return recusa;
    }
  }
  await gravarStatus(admin, numero, status, comoGravar);
  return null;
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

function toState(
  status: InstanceStatus,
  account: Pick<AccountRow, "id" | "display_phone">,
): ConnectState {
  return {
    status: status.status,
    qrCode: status.qrCode ?? null,
    displayPhone: status.displayPhone ?? account.display_phone,
    accountId: account.id,
  };
}

/** Estado de falha antes de haver numero carregado (guard, id, leitura). */
function falhaSemNumero(error: string): ConnectState {
  return {
    status: "desconectado",
    qrCode: null,
    displayPhone: null,
    error,
  };
}

/** A instancia do numero, como o provedor a enxerga. */
function refDoNumero(
  clinicId: string,
  account: AccountRow,
  secret: Pick<SecretRow, "instance_token">,
): InstanceRef {
  return {
    clinicId,
    accountId: account.id,
    serverUrl: account.server_url,
    instanceToken: secret.instance_token,
    instanceId: account.instance_id,
  };
}

const TEXTO_INSTANCIA_PERDIDA =
  "O servidor do WhatsApp não reconhece mais a conexão deste número. Clique em Conectar WhatsApp para refazer a conexão.";

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

/**
 * Conecta (pareia) um numero. `accountId` nulo: o principal da clinica, e
 * sem numero nenhum ele nasce aqui; o id dele volta em `accountId`.
 */
export async function connectWhatsAppAction(
  accountId: string | null = null,
): Promise<ConnectState> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return falhaSemNumero(guard.error);
  }
  const id = idDoNumeroOuNulo.safeParse(accountId);
  if (!id.success) {
    return falhaSemNumero(TEXTO_NUMERO_INVALIDO);
  }
  const carregada = await loadAccount(guard.clinicId, id.data);
  if ("erro" in carregada) {
    return falhaSemNumero(carregada.erro);
  }
  const { admin, account, secret } = carregada;
  const numero: NumeroAlvo = {
    clinicId: guard.clinicId,
    accountId: account.id,
  };
  let ref = refDoNumero(guard.clinicId, account, secret);
  // Calculado ANTES de qualquer descarte: o principal que ja tinha instancia
  // mantem o nome dela mesmo quando ela e recriada.
  const nomeDaInstanciaNova = nomeDaNovaInstancia(guard, account);
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

    // 1. O numero ainda nao tem instancia? Cria uma, com o token
    // administrativo, e guarda o token proprio dela.
    if (!ref.instanceToken && uazapi) {
      ref = await criarInstancia(
        admin,
        numero,
        uazapi,
        ref,
        nomeDaInstanciaNova,
      );
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
    // URL NOVA (docs/07, Compatibilidade): o numero vem dito, e o segredo e
    // o dele. A URL antiga (?clinic=&secret=) continua valendo no webhook
    // para as instancias que ja estao no ar; esta so e gravada ao conectar.
    const urlDoWebhook = `${origin}/api/webhooks/whatsapp?clinic=${guard.clinicId}&account=${account.id}&secret=${secret.webhook_secret}`;

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
        whatsapp_account_id: account.id,
        http_status: error instanceof UazapiHttpError ? error.status : null,
      });
      await descartarInstancia(admin, numero);
      await persistStatus(admin, numero, { status: "desconectado" });
      statusConhecido = "desconectado";
      ref = await criarInstancia(
        admin,
        numero,
        uazapi,
        { ...ref, instanceToken: null, instanceId: null },
        nomeDaInstanciaNova,
      );
      pareamento = await parear(provider, ref, urlDoWebhook);
    }

    // Este clique ABRE o pareamento: o "conectando" que o provedor devolver
    // (codigo de pareamento, sem QR) vale mesmo sem "aguardando_qr" antes, e
    // a porta da ingestao segura a mensagem ate a trava decidir.
    const recusa = await persistStatus(
      admin,
      numero,
      pareamento.status,
      {
        anterior: {
          connection_status: statusConhecido,
          display_phone: account.display_phone,
        },
        provider,
        ref,
      },
      { abrePareamento: true },
    );
    revalidarTelasDeConexao();
    if (recusa) {
      return {
        status: recusa.status,
        qrCode: null,
        displayPhone: account.display_phone,
        error: recusa.mensagem,
        accountId: account.id,
      };
    }
    const estado = toState(pareamento.status, account);
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
      accountId: account.id,
    };
  }
}

/** Um numero conferido pela checagem de conexao. */
export type NumeroVerificado = {
  id: string;
  nome: string;
  principal: boolean;
  connection_status: ConnectState["status"];
  /**
   * Por que o numero caiu, quando a trava recusou o celular dele (o texto do
   * dialogo de conexao). So para administrador e gestor, e so com motivo
   * vigente: ausente nos outros casos.
   */
  motivo?: string;
};

export type ChecagemDeConexao = {
  /**
   * Status do PRINCIPAL (nulo: clinica sem numero). E a forma de antes, que
   * valia para o unico numero; quem le a lista usa `numeros`.
   */
  status: string | null;
  /** Todos os numeros ativos da clinica, cada um com o status conferido. */
  numeros: NumeroVerificado[];
  error?: string;
};

/** Consulta o provedor por UM numero e grava o que ele disser. */
async function conferirNumero(
  admin: AdminClient,
  clinicId: string,
  account: AccountRow,
  secret: Pick<SecretRow, "instance_token"> | null,
): Promise<ConnectState["status"]> {
  const numero: NumeroAlvo = { clinicId, accountId: account.id };
  try {
    const provider = getWhatsAppProvider(account.provider);
    const ref = refDoNumero(clinicId, account, {
      instance_token: secret?.instance_token ?? null,
    });
    const status = await provider.getStatus(ref);
    const recusa = await persistStatus(admin, numero, status, {
      anterior: account,
      provider,
      ref,
    });
    // O que ficou no banco, que a faixa aplica na hora: o "conectando" de uma
    // sessao ja pareada nao foi gravado (achado T[0] da revisao da trava).
    return statusQueFica(
      account.connection_status,
      recusa ? recusa.status : status.status,
    );
  } catch (error) {
    // Instancia que o servidor nao reconhece mais E desconexao, e das que so
    // se resolvem conectando de novo: grava, para a faixa vermelha aparecer.
    if (instanciaInvalida(error)) {
      await persistStatus(admin, numero, { status: "desconectado" });
      return "desconectado";
    }
    // Provedor fora do ar: devolve o que o banco sabe, sem gravar nada.
    return account.connection_status;
  }
}

// Checagem de status para QUALQUER membro ativo (o botao "Verificar
// conexao" da faixa vermelha): consulta o provedor por TODOS os numeros
// ativos da clinica e grava, mas NAO devolve QR nem segredo, so o status de
// cada um. O pollWhatsAppStatusAction continua admin/gestor porque carrega o
// QR do pareamento.
//
// O motivo da recusa do celular (achado M[0] da revisao das Fases 3 e 4) vem
// junto so para administrador e gestor, o mesmo publico do dialogo de
// conexao: a faixa o mostra no aviso da verificacao, e nao no texto dela.
export async function checarConexaoAction(): Promise<ChecagemDeConexao> {
  const context = await getSessionContext();
  if (!context?.active) {
    return {
      status: null,
      numeros: [],
      error: "Sessão expirada. Entre de novo.",
    };
  }
  const clinicId = context.active.clinicId;
  const admin = createAdminClient();
  // Leitura SECA (sem os upserts do loadAccount): membro conferindo status
  // nao pode criar conta de WhatsApp do nada.
  const numeros = await listarNumerosAtivos(admin, clinicId);
  if (numeros === null) {
    return {
      status: null,
      numeros: [],
      error: "Não foi possível verificar agora. Tente de novo.",
    };
  }
  if (numeros.length === 0) {
    return { status: null, numeros: [] };
  }
  const { data: segredos } = await admin
    .from("whatsapp_account_secret")
    .select("account_id, instance_token")
    .eq("clinic_id", clinicId)
    .in(
      "account_id",
      numeros.map((numero) => numero.id),
    );
  const tokenPorNumero = new Map(
    (
      (segredos ?? []) as {
        account_id: string;
        instance_token: string | null;
      }[]
    ).map((segredo) => [segredo.account_id, segredo] as const),
  );

  const verificados = await Promise.all(
    numeros.map(async (numero): Promise<NumeroVerificado> => ({
      id: numero.id,
      nome: numero.nome,
      principal: numero.principal,
      connection_status: await conferirNumero(
        admin,
        clinicId,
        numero,
        tokenPorNumero.get(numero.id) ?? null,
      ),
    })),
  );
  const principal =
    verificados.find((numero) => numero.principal) ?? verificados[0] ?? null;
  // Lido DEPOIS da conferencia (que pode ter acabado de recusar o celular),
  // com a clinica da sessao, so pelos desta clinica que seguem desconectados.
  const podeVerOMotivo = canEdit(context.active.role, "configuracoes");
  const motivos: Record<string, string> = podeVerOMotivo
    ? await motivosDaRecusaVigentes(
        admin,
        clinicId,
        verificados
          .filter((numero) => numero.connection_status === "desconectado")
          .map((numero) => numero.id),
      )
    : {};
  return {
    status: principal?.connection_status ?? null,
    numeros: verificados.map((numero) => {
      const motivo = motivos[numero.id];
      return motivo ? { ...numero, motivo } : numero;
    }),
  };
}

/**
 * Status do pareamento em andamento (a tela consulta a cada 2,5 segundos).
 * `accountId` nulo: o principal, como na conexao.
 */
export async function pollWhatsAppStatusAction(
  accountId: string | null = null,
): Promise<ConnectState> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return falhaSemNumero(guard.error);
  }
  const id = idDoNumeroOuNulo.safeParse(accountId);
  if (!id.success) {
    return falhaSemNumero(TEXTO_NUMERO_INVALIDO);
  }
  const carregada = await loadAccount(guard.clinicId, id.data);
  if ("erro" in carregada) {
    return falhaSemNumero(carregada.erro);
  }
  const { admin, account, secret } = carregada;
  const numero: NumeroAlvo = {
    clinicId: guard.clinicId,
    accountId: account.id,
  };
  try {
    const provider = getWhatsAppProvider(account.provider);
    const ref = refDoNumero(guard.clinicId, account, secret);
    const status = await provider.getStatus(ref);
    // A consulta nao abre pareamento: "conectando" so e gravado em cima de
    // "aguardando_qr" (gravarStatus, achado T[0] da revisao da trava). O
    // dialogo recebe o que o provedor disse e acompanha a conexao.
    const recusa = await persistStatus(admin, numero, status, {
      anterior: account,
      provider,
      ref,
    });
    if (recusa) {
      if (recusa.status === "desconectado") {
        revalidarTelasDeConexao();
      }
      return {
        status: recusa.status,
        qrCode: null,
        displayPhone: account.display_phone,
        error: recusa.mensagem,
        accountId: account.id,
      };
    }
    // Desligado, o provedor nao diz por que. Quando o webhook recusou o
    // celular antes desta consulta (o caso comum: o evento chega na hora e a
    // consulta so a cada 2,5 s), a trava ja desligou a instancia e o motivo
    // esta na trilha. Sem isto a tela ficava so em "Desconectado" (achado
    // M[0] da revisao das Fases 3 e 4).
    if (status.status === "desconectado") {
      const motivo = await motivoDaRecusaVigente(admin, numero);
      if (motivo) {
        return { ...toState(status, account), error: motivo };
      }
    }
    return toState(status, account);
  } catch (error) {
    if (instanciaInvalida(error)) {
      // Antes isto virava "Desconectado" mudo, e clicar de novo dava o mesmo.
      // Agora a tela diz o que houve, e Conectar recria a instancia.
      await persistStatus(admin, numero, { status: "desconectado" });
      revalidarTelasDeConexao();
      return {
        status: "desconectado",
        qrCode: null,
        displayPhone: account.display_phone,
        error: TEXTO_INSTANCIA_PERDIDA,
        accountId: account.id,
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
        accountId: account.id,
      };
    }
    // Falha passageira de rede: o laco de 2,5 segundos tenta de novo, e um
    // erro aqui piscaria na tela a cada volta.
    return {
      status: account.connection_status,
      qrCode: null,
      displayPhone: account.display_phone,
      accountId: account.id,
    };
  }
}

/** Desconecta um numero. Precisa do id: nao ha o que desconectar sem ele. */
export async function disconnectWhatsAppAction(
  accountId: string,
): Promise<ConnectState> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return falhaSemNumero(guard.error);
  }
  const id = idDoNumero.safeParse(accountId);
  if (!id.success) {
    return falhaSemNumero(TEXTO_NUMERO_INVALIDO);
  }
  const carregada = await loadAccount(guard.clinicId, id.data);
  if ("erro" in carregada) {
    return falhaSemNumero(carregada.erro);
  }
  const { admin, account, secret } = carregada;
  try {
    const provider = getWhatsAppProvider(account.provider);
    await provider.disconnect(refDoNumero(guard.clinicId, account, secret));
  } catch {
    // Mesmo sem alcance ao servidor, o estado local vira desconectado.
  }
  await persistStatus(
    admin,
    { clinicId: guard.clinicId, accountId: account.id },
    { status: "desconectado" },
  );
  revalidarTelasDeConexao();
  return {
    status: "desconectado",
    qrCode: null,
    displayPhone: account.display_phone,
    accountId: account.id,
  };
}

// ---------------------------------------------------------------------------
// Cadastro dos numeros (docs/07, Fase 2). A tela de varios numeros e da
// Fase 4; ate la, a de Configuracoes mostra so o principal e estas acoes
// existem para ela e para os testes.
// ---------------------------------------------------------------------------

/**
 * Adiciona um numero a clinica, ainda sem conexao (o pareamento e o
 * "Conectar" do cartao dele). Nasce com o provedor do ambiente; sem principal
 * ativo, o gatilho o torna principal.
 */
export async function adicionarNumeroAction(
  input: unknown,
): Promise<NumeroActionResult> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = numeroNovoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: TEXTO_NOME_INVALIDO };
  }
  const provedor = provedorDoAmbiente();
  if (!provedor) {
    return { ok: false, error: MENSAGEM_CANAL_NAO_CONFIGURADO };
  }

  const admin = createAdminClient();
  const { data: novo, error } = await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: guard.clinicId,
      provider: provedor,
      nome: parsed.data.nome,
      unit_id: parsed.data.unitId ?? null,
    })
    .select("id")
    .single();
  if (error || !novo) {
    return { ok: false, error: mensagemDeCadastro(error) };
  }
  const accountId = novo.id as string;

  // O segredo ja nasce com o numero. Se falhar aqui, a primeira conexao cria
  // (loadAccount): o numero nao fica inutilizavel.
  const { error: erroDoSegredo } = await admin
    .from("whatsapp_account_secret")
    .insert({ clinic_id: guard.clinicId, account_id: accountId });
  if (erroDoSegredo) {
    log.warn("whatsapp_segredo_nao_criado", {
      clinic_id: guard.clinicId,
      whatsapp_account_id: accountId,
      error_code: erroDoSegredo.code,
    });
  }

  await registrarNaTrilha(
    guard,
    "adicionou_numero_whatsapp",
    "whatsapp_account",
    accountId,
  );
  revalidarTelasDeConexao();
  return { ok: true, accountId };
}

/**
 * Renomeia o numero e/ou troca (ou tira) a unidade dele. Grava so os campos
 * que vieram; sem nenhum dos dois, recusa.
 */
export async function atualizarNumeroAction(
  input: unknown,
): Promise<NumeroActionResult> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = numeroEditadoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: TEXTO_NOME_INVALIDO };
  }
  const { accountId, nome, unitId } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_account")
    .update({
      ...(nome !== undefined ? { nome } : {}),
      ...(unitId !== undefined ? { unit_id: unitId } : {}),
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", accountId)
    .is("removido_em", null)
    .select("id");
  if (error) {
    return { ok: false, error: mensagemDeCadastro(error) };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: TEXTO_NUMERO_NAO_ENCONTRADO };
  }

  await registrarNaTrilha(
    guard,
    "atualizou_numero_whatsapp",
    "whatsapp_account",
    accountId,
  );
  revalidarTelasDeConexao();
  revalidatePath("/atendimento");
  return { ok: true, accountId };
}

/**
 * Torna o numero o principal da clinica: a entrada sem numero e o envio para
 * quem nunca escreveu saem por ele. A troca e atomica na RPC (trava por
 * clinica, um principal ativo por vez).
 */
export async function definirNumeroPrincipalAction(
  accountId: unknown,
): Promise<NumeroActionResult> {
  const guard = await requireManageContext();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const id = idDoNumero.safeParse(accountId);
  if (!id.success) {
    return { ok: false, error: TEXTO_NUMERO_INVALIDO };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("definir_numero_principal", {
    p_clinic_id: guard.clinicId,
    p_account_id: id.data,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "P0002"
          ? TEXTO_NUMERO_NAO_ENCONTRADO
          : error.code === "23514"
            ? "Este número foi removido da clínica e não pode ser o principal."
            : "Não foi possível tornar este número o principal. Tente de novo.",
    };
  }

  await registrarNaTrilha(
    guard,
    "definiu_numero_principal",
    "whatsapp_account",
    id.data,
  );
  revalidarTelasDeConexao();
  revalidatePath("/atendimento");
  return { ok: true, accountId: id.data };
}

/**
 * Remove o numero da clinica (D3 e D8): so o administrador. Encerra as
 * conversas abertas dele (com evento de sistema), redistribui os envios
 * automaticos pendentes e gira o segredo do webhook, tudo na RPC
 * remover_numero; o historico fica.
 *
 * Recusa ANTES de tocar na instancia: o principal enquanto houver outro
 * numero ativo (a clinica escolhe o novo principal antes) e o numero fixo
 * das mensagens automaticas (a clinica escolhe outro em Automacoes antes).
 * Depois da RPC, desconecta e apaga a instancia no servidor compartilhado;
 * falha ali nao desfaz a remocao, so fica registrada para o suporte limpar.
 */
export async function removerNumeroAction(
  accountId: unknown,
): Promise<NumeroActionResult> {
  const guard = await requireAdminContext();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const id = idDoNumero.safeParse(accountId);
  if (!id.success) {
    return { ok: false, error: TEXTO_NUMERO_INVALIDO };
  }

  const admin = createAdminClient();
  const { data: alvo, error: erroDoAlvo } = await admin
    .from("whatsapp_account")
    .select(`${COLUNAS_DA_CONTA}, removido_em`)
    .eq("clinic_id", guard.clinicId)
    .eq("id", id.data)
    .maybeSingle();
  if (erroDoAlvo) {
    return {
      ok: false,
      error: "Não foi possível remover este número. Tente de novo.",
    };
  }
  if (!alvo) {
    return { ok: false, error: TEXTO_NUMERO_NAO_ENCONTRADO };
  }
  const conta = alvo as AccountRow & { removido_em: string | null };
  // Segundo clique, ou outra aba: ja esta removido, nada a fazer.
  if (conta.removido_em) {
    return { ok: true, accountId: conta.id };
  }

  const numeros = await listarNumerosAtivos(admin, guard.clinicId);
  if (numeros === null) {
    return { ok: false, error: TEXTO_FALHA_DE_LEITURA };
  }
  if (conta.principal && numeros.some((numero) => numero.id !== conta.id)) {
    return {
      ok: false,
      error: "Escolha outro número como principal antes de remover este.",
    };
  }
  const { data: politica } = await admin
    .from("whatsapp_envio_automatico")
    .select("modo, conta_fixa_id")
    .eq("clinic_id", guard.clinicId)
    .maybeSingle();
  if (politica?.modo === "fixo" && politica.conta_fixa_id === conta.id) {
    return {
      ok: false,
      error:
        "As mensagens automáticas saem sempre por este número. Em Automações, escolha outro número antes de remover este.",
    };
  }

  // O token vem ANTES da RPC, que o apaga junto com o segredo do webhook.
  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", guard.clinicId)
    .eq("account_id", conta.id)
    .maybeSingle();

  const { error } = await admin.rpc("remover_numero", {
    p_clinic_id: guard.clinicId,
    p_account_id: conta.id,
    p_removido_por: guard.userId,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "55000"
          ? "Escolha outro número como principal antes de remover este."
          : error.code === "P0002"
            ? TEXTO_NUMERO_NAO_ENCONTRADO
            : "Não foi possível remover este número. Tente de novo.",
    };
  }

  await desligarInstanciaRemovida(guard.clinicId, conta, {
    instance_token: (segredo?.instance_token as string | null) ?? null,
  });

  await registrarNaTrilha(
    guard,
    "removeu_numero_whatsapp",
    "whatsapp_account",
    conta.id,
  );
  revalidarTelasDeConexao();
  revalidatePath("/atendimento");
  revalidatePath("/automacoes");
  return { ok: true, accountId: conta.id };
}

/**
 * Desconecta e apaga a instancia do numero removido. O servidor uazapi e
 * compartilhado e tem teto de instancias: numero removido nao pode deixar
 * instancia orfa ocupando vaga. Nunca lanca e nunca trava a remocao.
 */
async function desligarInstanciaRemovida(
  clinicId: string,
  conta: AccountRow,
  segredo: Pick<SecretRow, "instance_token">,
): Promise<void> {
  const campos = {
    clinic_id: clinicId,
    whatsapp_account_id: conta.id,
    instance_id: conta.instance_id,
    provider: conta.provider,
  };
  let provider: WhatsAppProvider;
  try {
    provider = getWhatsAppProvider(conta.provider);
  } catch {
    log.warn("whatsapp_instancia_nao_excluida", {
      ...campos,
      error_code: "provedor_indisponivel",
    });
    return;
  }
  const ref = refDoNumero(clinicId, conta, segredo);
  try {
    await provider.disconnect(ref);
  } catch {
    // Desconectar e cortesia: apagar a instancia, abaixo, tambem desliga.
  }
  if (!(provider instanceof UazapiProvider)) {
    return;
  }
  const exclusao = await provider.excluirInstancia(ref);
  if (!exclusao.ok) {
    log.warn("whatsapp_instancia_nao_excluida", {
      ...campos,
      error_code: exclusao.errorCode,
    });
  }
}
