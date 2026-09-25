import type { SupabaseClient } from "@supabase/supabase-js";

// Numero de WhatsApp de teste (varios numeros por clinica, Fase 2; desenho em
// docs/07_multiplos_numeros_whatsapp.md). Compartilhado pelas suites de RLS,
// de integracao e e2e: mora ao lado de stack.ts porque as tres ja importam
// daqui.
//
// O numero e o segredo nascem JUNTOS e ligados por account_id, como o codigo
// da Fase 2 grava. O caminho legado (inserir so com clinic_id e deixar o
// gatilho temporario preencher_conta_do_segredo escolher o principal)
// continua provado de proposito em tests/rls/numeros-whatsapp.test.ts, e sai
// na Fase 3.
//
// Provedor padrao 'fake': nenhum teste pode encostar no WhatsApp real.
//
// Enquanto o unique temporario whatsapp_account_uma_por_clinica existir
// (ate a Fase 3), cada clinica tem UM numero: o segundo criarNumeroDeTeste na
// mesma clinica recebe 23505. Os testes de dois numeros ficam em it.skip.

export type ProvedorDeTeste = "fake" | "uazapi" | "cloud_api";

export type StatusDeConexaoDeTeste =
  "desconectado" | "aguardando_qr" | "conectando" | "conectado";

export type OpcoesDoNumeroDeTeste = {
  /** Pedido de principal. O primeiro numero ativo da clinica nasce principal de qualquer jeito (gatilho antes_de_criar_numero). */
  principal?: boolean;
  /** Nome livre do numero; sem ele, o padrao do banco ("Número principal"). */
  nome?: string;
  provider?: ProvedorDeTeste;
  connection_status?: StatusDeConexaoDeTeste;
  display_phone?: string | null;
  instance_id?: string | null;
  instance_token?: string | null;
  /** Sem ele, o banco gera um segredo aleatorio. */
  webhook_secret?: string;
  unit_id?: string | null;
};

export type NumeroDeTeste = {
  /** whatsapp_account.id */
  id: string;
  clinicId: string;
  nome: string;
  principal: boolean;
  webhookSecret: string;
  instanceToken: string | null;
};

type LinhaDoNumero = { id: string; nome: string; principal: boolean };
type LinhaDoSegredo = { webhook_secret: string; instance_token: string | null };

/** Cria o numero (whatsapp_account) e o segredo dele, ligado por account_id. */
export async function criarNumeroDeTeste(
  admin: SupabaseClient,
  clinicId: string,
  opcoes: OpcoesDoNumeroDeTeste = {},
): Promise<NumeroDeTeste> {
  const { data: numero } = await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: opcoes.provider ?? "fake",
      connection_status: opcoes.connection_status ?? "conectado",
      ...(opcoes.nome !== undefined ? { nome: opcoes.nome } : {}),
      ...(opcoes.principal !== undefined
        ? { principal: opcoes.principal }
        : {}),
      ...(opcoes.display_phone !== undefined
        ? { display_phone: opcoes.display_phone }
        : {}),
      ...(opcoes.instance_id !== undefined
        ? { instance_id: opcoes.instance_id }
        : {}),
      ...(opcoes.unit_id !== undefined ? { unit_id: opcoes.unit_id } : {}),
    })
    .select("id, nome, principal")
    .single()
    .throwOnError();
  const linha = numero as LinhaDoNumero;

  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .insert({
      clinic_id: clinicId,
      account_id: linha.id,
      ...(opcoes.instance_token !== undefined
        ? { instance_token: opcoes.instance_token }
        : {}),
      ...(opcoes.webhook_secret !== undefined
        ? { webhook_secret: opcoes.webhook_secret }
        : {}),
    })
    .select("webhook_secret, instance_token")
    .single()
    .throwOnError();
  const linhaDoSegredo = segredo as LinhaDoSegredo;

  return {
    id: linha.id,
    clinicId,
    nome: linha.nome,
    principal: linha.principal,
    webhookSecret: linhaDoSegredo.webhook_secret,
    instanceToken: linhaDoSegredo.instance_token,
  };
}

/**
 * O numero principal ATIVO da clinica (no maximo um, pelo indice unico
 * parcial whatsapp_account_um_principal). Para teste que criou o numero pelo
 * caminho antigo e precisa do id.
 */
export async function numeroPrincipalDaClinica(
  admin: SupabaseClient,
  clinicId: string,
): Promise<string> {
  const { data } = await admin
    .from("whatsapp_account")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("principal", true)
    .is("removido_em", null)
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/**
 * Caminho do webhook de entrada de um numero.
 *
 * Formato novo (Fase 2): ?clinic=&account=&secret=. Com `legado: true`, o
 * formato antigo ?clinic=&secret=, que continua valendo para as instancias
 * configuradas antes da Fase 2 (a rota acha, entre os segredos da clinica, o
 * que bate).
 */
export function caminhoDoWebhook(
  numero: Pick<NumeroDeTeste, "clinicId" | "id" | "webhookSecret">,
  opcoes: { legado?: boolean; segredo?: string } = {},
): string {
  const parametros = new URLSearchParams({ clinic: numero.clinicId });
  if (!opcoes.legado) {
    parametros.set("account", numero.id);
  }
  parametros.set("secret", opcoes.segredo ?? numero.webhookSecret);
  return `/api/webhooks/whatsapp?${parametros.toString()}`;
}
