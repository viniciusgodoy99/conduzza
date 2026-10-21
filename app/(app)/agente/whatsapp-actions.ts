"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  avisoDeContatoDaClinica,
  escolhaAtual,
  MODO_DA_ESCOLHA,
  telefoneDaEquipeSchema,
  TEXTOS_DA_IA,
  TEXTOS_DO_TESTE_COM_PACIENTE,
} from "@/components/agente/whatsapp/agente-de-ia";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { situacaoDaConexao } from "@/components/whatsapp/numeros";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { chaveDeTelefone } from "@/lib/domain/telefone";
import { log } from "@/lib/log";
import {
  abaDaIaVisivel,
  fetchLiberacaoDaIa,
  fetchNumeroDaClinica,
  type DadosDaIa,
} from "@/lib/queries/ia-liberacao";
import { fetchNumeroDaClinicaNoPainel } from "@/lib/queries/painel-geral";
import { createClient } from "@/lib/supabase/server";

// Aba "WhatsApp" da tela Agente de IA (Tela 6; ate a onda 2, a aba "Agente
// de IA" de Configuracoes, em app/(app)/configuracoes/ia-liberacao-actions):
// ligar e desligar o assistente na clinica e escolher o modo, ligar e
// desligar cada numero (varios ao mesmo tempo desde a decisao do dono de
// 19/10/2026, migration 20261019110000), cadastrar, desligar e excluir os
// telefones da equipe e, desde a onda 2, pausar e retomar. Contrato do
// banco nas migrations 20261006100000_ia_liberacao_e_schema.sql,
// 20261006120000_ia_liberacao_pela_tela.sql e nas da onda 2 (excluir e o
// "Usar mesmo assim" do administrador na 20261022110000; a pausa na
// 20261022120000). O interruptor geral saiu daqui (onda 2, P8): mora no
// Painel geral (app/(app)/painel-geral/actions.ts).
//
// A AUTORIZACAO VIVE NO BANCO: toda escrita passa pelas RPCs definir_*_da_ia
// (e excluir_contato_liberado_da_ia), com a sessao. O guarda
// ia_exigir_quem_libera deixa passar so o administrador ativo da propria
// clinica da lista do banco e o super admin. A guarda daqui e a segunda
// camada (CLAUDE.md 3.4: esconder botao nao protege nada): a aba so existe
// nas clinicas da fase controlada (abaDaIaVisivel, a mesma decisao da
// pagina) e so o administrador da clinica ou o super admin chega a RPC.
// Cada RPC grava a trilha (audit_log) sozinha, sem telefone.
//
// LIGAR O ATENDIMENTO PELO WHATSAPP E SO DA EQUIPE CONDUZZA NESTA FASE (E3,
// decisao do dono em 13/10/2026): escolher "Conversar com a equipe" e ligar
// um numero exigem o super admin, aqui e no banco (ia_exigir_equipe_conduzza).
// Desligar continua com o administrador da clinica. A producao ("Atendendo
// os contatos", o modo numero_inteiro) nunca e ligada daqui: so pelo Painel
// geral, com os requisitos cumpridos (onda 2, P11c). TELEFONE DA EQUIPE
// (decisao do dono em 19/10/2026, migration 20261019100000): adicionar e
// ligar de novo voltam para quem passa na guarda. O telefone novo exige a
// confirmacao do aviso da OpenAI (LGPD, D32), que vai ao BANCO
// (p_confirmou_aviso_da_openai). Telefone de paciente e numero de WhatsApp
// do Conduzza sao recusados pelo banco; o "Usar mesmo assim" (o forcar) do
// telefone de paciente, desde a onda 2 (item 3, decisao P3 do dono), vale
// tambem para o administrador, sempre com a confirmacao do teste
// (p_confirmou_teste_com_paciente), que o banco grava na trilha no nome de
// quem forcou.
//
// Nada daqui vai para log alem do codigo do erro, da clinica, do numero e
// do tipo de acao: nunca telefone, rotulo nem nome de contato.
//
// PAINEL GERAL (onda 1, decisao do dono de 20/10/2026): os numeros e os
// telefones da equipe tambem se mudam pelo Painel geral, para qualquer
// clinica com o agente habilitado. A entrada traz o clinicId da tela, e
// entao so a equipe Conduzza passa (super admin; o banco confere de novo em
// ia_exigir_quem_libera), sem precisar ser membro da clinica. Sem clinicId,
// vale a clinica ativa, como sempre. No painel:
// - a conexao do numero vem do proprio painel (painel_geral_das_clinicas,
//   so do super admin): whatsapp_account so e legivel por membro ativo;
// - o telefone novo pede SEMPRE a confirmacao de que e de alguem da equipe,
//   sem consultar os contatos da clinica: o painel nao le nem mostra dado
//   de paciente (o banco continua recusando telefone de paciente sem o
//   forcar e o numero de WhatsApp do Conduzza).
//
// Guarda local: toda funcao exportada de um arquivo "use server" vira
// endpoint, entao cada uma confere por si.

/**
 * pedeConfirmacao: o telefone novo ja e de um contato da clinica; a tela
 * mostra o aviso e o campo de confirmacao, e so grava com ele marcado.
 * pedeForcar: o banco recusou o telefone por ser de paciente; a tela abre o
 * dialogo do "Usar mesmo assim", com a confirmacao do teste.
 */
export type ResultadoDaIa =
  | { ok: true }
  | {
      ok: false;
      error: string;
      pedeConfirmacao?: true;
      pedeForcar?: true;
    };

const TEXTOS = {
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  foraDaFase: "O assistente de IA ainda não está disponível nesta clínica.",
  dadosInvalidos: "Dados inválidos. Recarregue a página e tente de novo.",
  naoAlterou: "Não foi possível alterar o assistente de IA. Tente de novo.",
  naoLeu:
    "Não foi possível conferir a configuração do assistente. Recarregue a página e tente de novo.",
  numeroForaDaClinica:
    "Este número não está mais entre os números da clínica. Recarregue a página.",
  numeroRemovido: "Este número foi removido da clínica. Recarregue a página.",
  telefoneForaDaLista:
    "Este telefone não está na lista da equipe. Adicione o telefone pelo formulário.",
  // Excluir (onda 2, item 9): a linha sumiu entre a tela e o clique.
  telefoneJaSaiu: "Este telefone já não está na lista. Recarregue a página.",
  naoExcluiu: "Não foi possível excluir o telefone. Tente de novo.",
  // Pausa (onda 2, item 11): so com o WhatsApp ligado.
  pausaSemWhatsapp:
    "O assistente não está ligado no WhatsApp nesta clínica. Não há o que pausar.",
  retomarSemWhatsapp:
    "O assistente não está ligado no WhatsApp nesta clínica. Não há o que retomar.",
  pausaContaSuspensa:
    "A conta da clínica está suspensa. Fale com a equipe Conduzza.",
  naoPausou: "Não foi possível pausar o assistente. Tente de novo.",
  naoRetomou: "Não foi possível retomar o assistente. Tente de novo.",
  // A funcao do banco que a acao chama ainda nao existe (o codigo subiu
  // antes da migration dela): nada mudou.
  aindaNaoDisponivel:
    "Esta opção ainda não está disponível. Nada foi alterado; tente de novo mais tarde.",
  // Pelo Painel geral (os mesmos textos da tela do painel).
  soEquipeConduzzaNoPainel: TEXTOS_DO_PAINEL.soEquipeConduzzaNoAgente,
  agenteDesligadoNoPainel: TEXTOS_DO_PAINEL.soComAgenteEmTeste,
  confirmeQueEDaEquipe: TEXTOS_DO_PAINEL.confirmeQueEDaEquipe,
} as const;

/** Texto livre do motivo nas RPCs (vai para ia_liberacao.motivo). */
const MOTIVO = "Agente de IA, aba WhatsApp";
const MOTIVO_DO_PAINEL = "Painel geral";

/** E.164 do banco (check de ia_contato_liberado). */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * A clinica que o Painel geral manda (so o super admin). Ausente: a clinica
 * ativa, como sempre (a aba da Tela 6).
 */
const clinicaDoPainel = z.uuid().optional();

const escolhaSchema = z
  .object({ escolha: z.enum(["desligado", "simulador", "equipe"]) })
  .strict();

const alternarNumeroSchema = z
  .object({
    whatsappAccountId: z.uuid(),
    ligado: z.boolean(),
    clinicId: clinicaDoPainel,
  })
  .strict();

const alternarTelefoneSchema = z
  .object({
    telefone: z.string().regex(E164),
    ligado: z.boolean(),
    clinicId: clinicaDoPainel,
  })
  .strict();

// O mesmo schema do formulario (estrito: o extend mantem), com a clinica do
// painel.
const adicionarTelefoneSchema = telefoneDaEquipeSchema.extend({
  clinicId: clinicaDoPainel,
});

/** Excluir telefone (onda 2, item 9): o id da linha de ia_contato_liberado. */
const excluirTelefoneSchema = z
  .object({ id: z.uuid(), clinicId: clinicaDoPainel })
  .strict();

/** Pausar e retomar (onda 2, item 11): so a clinica ativa, pela aba. */
const pausaSchema = z.object({ pausada: z.boolean() }).strict();

type Guarda = {
  userId: string;
  clinicId: string;
  superAdmin: boolean;
  /** A acao veio do Painel geral (a clinica da tela, nao a ativa). */
  noPainel: boolean;
};

/**
 * De onde vem a clinica: a ativa (sem clinicId na entrada), a do painel (um
 * uuid) ou uma entrada que nao serve (clinicId que nao e uuid). So olha a
 * chave: o resto da entrada passa pelo Zod de cada acao.
 */
type ClinicaDaEntrada =
  { de: "ativa" } | { de: "painel"; clinicId: string } | { de: "invalida" };

function clinicaDaEntrada(entrada: unknown): ClinicaDaEntrada {
  if (
    typeof entrada !== "object" ||
    entrada === null ||
    !("clinicId" in entrada)
  ) {
    return { de: "ativa" };
  }
  const valor = (entrada as { clinicId?: unknown }).clinicId;
  if (valor === undefined) {
    return { de: "ativa" };
  }
  const lido = z.uuid().safeParse(valor);
  return lido.success
    ? { de: "painel", clinicId: lido.data.toLowerCase() }
    : { de: "invalida" };
}

/**
 * Sem clinicId: a clinica ativa tem o agente habilitado e quem chama e o
 * administrador dela ou o super admin (gestor e os demais papeis param aqui
 * e no banco). Com clinicId (Painel geral): so o super admin, e so clinica
 * da lista do banco (agente habilitado e conta ativa: a lista tira a
 * suspensa).
 */
async function guarda(
  origem: ClinicaDaEntrada = { de: "ativa" },
): Promise<Guarda | { error: string }> {
  const context = await getSessionContext();
  if (!context) {
    return { error: TEXTOS.sessaoExpirada };
  }
  if (origem.de !== "ativa") {
    if (!context.isProductAdmin) {
      return { error: TEXTOS.soEquipeConduzzaNoPainel };
    }
    if (origem.de === "invalida") {
      return { error: TEXTOS.dadosInvalidos };
    }
    if (!(await abaDaIaVisivel(origem.clinicId))) {
      return { error: TEXTOS.agenteDesligadoNoPainel };
    }
    return {
      userId: context.userId,
      clinicId: origem.clinicId,
      superAdmin: true,
      noPainel: true,
    };
  }
  if (!context.active) {
    return { error: TEXTOS.sessaoExpirada };
  }
  if (!(await abaDaIaVisivel(context.active.clinicId))) {
    return { error: TEXTOS.foraDaFase };
  }
  if (context.active.role !== "admin" && !context.isProductAdmin) {
    return { error: TEXTOS_DA_IA.semPermissao };
  }
  return {
    userId: context.userId,
    clinicId: context.active.clinicId,
    superAdmin: context.isProductAdmin,
    noPainel: false,
  };
}

/**
 * As telas que mostram o que mudou: a aba WhatsApp da Tela 6 (o "Em uso no
 * WhatsApp" do rodape le a mesma liberacao) e o Painel geral (lista e
 * detalhe), de onde quer que a acao tenha vindo.
 */
function revalidar() {
  revalidatePath("/agente");
  revalidatePath("/painel-geral", "layout");
}

/**
 * Ligar o atendimento pelo WhatsApp (modo "equipe" e ligar um numero) e so
 * do super admin nesta fase. O telefone nao passa por aqui desde 19/10/2026:
 * basta a guarda. null: pode.
 */
function recusaDeLigar(guardaOk: Guarda): ResultadoDaIa | null {
  return guardaOk.superAdmin
    ? null
    : { ok: false, error: TEXTOS_DA_IA.soEquipeConduzzaLiga };
}

/**
 * O forcar do telefone de paciente ("Usar mesmo assim"): desde a onda 2
 * (item 3, decisao P3 do dono) o administrador da clinica tambem forca,
 * mas SEMPRE com a confirmacao do teste, inclusive o super admin. Sem ela,
 * recusa aqui, antes de ler o contato e antes do banco (que tambem recusa:
 * 23514 teste_com_paciente_nao_confirmado). null: pode.
 */
function recusaDoForcar(
  forcar: boolean | undefined,
  confirmouTeste: boolean | undefined,
): ResultadoDaIa | null {
  return forcar === true && confirmouTeste !== true
    ? { ok: false, error: TEXTOS_DO_TESTE_COM_PACIENTE.naoConfirmado }
    : null;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ErroDoBanco = { code?: string; message?: string } | null;

function falhou(
  guardaOk: Guarda,
  kind: string,
  error: ErroDoBanco,
  texto: string,
): ResultadoDaIa {
  log.warn("ia_liberacao_nao_alterada", {
    clinic_id: guardaOk.clinicId,
    kind,
    error_code: error?.code ?? null,
  });
  return {
    ok: false,
    error:
      // No painel so chega o super admin: 42501 e o banco nao reconhecendo
      // a equipe Conduzza, nunca "fale com o administrador".
      guardaOk.noPainel && error?.code === "42501"
        ? TEXTOS.soEquipeConduzzaNoPainel
        : textoDoErro(kind, error, texto),
  };
}

/**
 * O codigo do banco em texto de recepcionista, conforme a acao: 42501 e
 * permissao em todas; 22023 so vem do telefone (fora do E.164); 23503 e
 * 23514 do numero (de outra clinica, ou removido) e do telefone (as chaves
 * na mensagem). O resto, o texto generico da acao.
 */
function textoDoErro(kind: string, error: ErroDoBanco, outro: string): string {
  const codigo = error?.code;
  const chave = (error?.message ?? "").trim();
  // A RPC (ou a assinatura nova dela) ainda nao existe no banco: a migration
  // da onda 2 que a traz nao foi aplicada (PGRST202 do PostgREST, 42883 do
  // Postgres). Nada foi gravado.
  if (codigo === "PGRST202" || codigo === "42883") {
    return TEXTOS.aindaNaoDisponivel;
  }
  if (codigo === "42501") {
    // Ligar o modo equipe e ligar um numero e so da equipe Conduzza.
    // Telefone (desde 19/10/2026) e o resto: o texto de permissao.
    return kind === "escolha_equipe" || kind === "numero_ligar"
      ? TEXTOS_DA_IA.soEquipeConduzzaLiga
      : TEXTOS_DA_IA.semPermissao;
  }
  if (kind.startsWith("telefone_") && codigo === "23514") {
    if (chave === "telefone_invalido_para_equipe") {
      return TEXTOS_DA_IA.telefoneDaPlataforma;
    }
    if (chave === "contato_de_paciente") {
      return TEXTOS_DA_IA.contatoDePaciente;
    }
    // Telefone novo sem a confirmacao do aviso da OpenAI (migration
    // 20261019120000): o mesmo texto do campo do formulario.
    if (chave === "aviso_da_openai_nao_confirmado") {
      return TEXTOS_DA_IA.avisoDaOpenaiObrigatorio;
    }
    // O forcar sem a confirmacao do teste (onda 2, item 3).
    if (chave === "teste_com_paciente_nao_confirmado") {
      return TEXTOS_DO_TESTE_COM_PACIENTE.naoConfirmado;
    }
  }
  if (kind.startsWith("telefone_") && codigo === "22023") {
    return TEXTOS_DA_IA.telefoneInvalido;
  }
  // A clinica em producao (migration 20261022120000, revisao da onda 2): o
  // modo so muda pelo Painel geral.
  if (kind.startsWith("escolha_") && codigo === "P0001" && chave === "clinica_em_producao") {
    return TEXTOS_DA_IA.emProducaoSoPeloPainel;
  }
  // A pausa (migration 20261022120000): sem a linha de liberacao nao ha o
  // que pausar nem retomar; a conta suspensa tem a chave propria.
  if ((kind === "pausar" || kind === "retomar") && codigo === "P0001") {
    if (chave === "sem_liberacao") {
      return kind === "pausar"
        ? TEXTOS.pausaSemWhatsapp
        : TEXTOS.retomarSemWhatsapp;
    }
    if (chave === "clinica_suspensa") {
      return TEXTOS.pausaContaSuspensa;
    }
  }
  if (kind.startsWith("numero_") && codigo === "23503") {
    return TEXTOS.numeroForaDaClinica;
  }
  if (kind.startsWith("numero_") && codigo === "23514") {
    return TEXTOS.numeroRemovido;
  }
  return outro;
}

async function lerDados(
  supabase: Supabase,
  clinicId: string,
): Promise<DadosDaIa | null> {
  try {
    return await fetchLiberacaoDaIa(supabase, clinicId);
  } catch {
    return null;
  }
}

/**
 * Numero e telefone exigem a linha de liberacao (FK no banco). Sem ela,
 * cria a linha DESLIGADA, a mesma que o primeiro ligar criaria; com ela,
 * nada muda (nunca religa nem desliga o que existe).
 */
async function garantirLinha(
  supabase: Supabase,
  guardaOk: Guarda,
  dados: DadosDaIa,
): Promise<ErroDoBanco | "ok"> {
  if (dados.liberacao) {
    return "ok";
  }
  const { error } = await supabase.rpc("definir_liberacao_da_ia", {
    p_clinic_id: guardaOk.clinicId,
    p_liberada: false,
    p_motivo: guardaOk.noPainel ? MOTIVO_DO_PAINEL : MOTIVO,
  });
  return error ?? "ok";
}

/**
 * Liga ou desliga o assistente nesta clinica e escolhe o modo. "equipe"
 * (modo contatos do banco) exige ao menos um numero ligado que ainda e
 * numero ativo da clinica e ao menos um telefone ligado, conferidos de novo
 * aqui com a leitura do banco. Numero ligado e desconectado nao e falta (a
 * aba mostra o motivo da parada; reconectar nao pede ligar de novo). A
 * producao nunca e escolhida aqui (so o Painel geral), e com o assistente
 * em producao nenhum modo muda por aqui (revisao da onda 2: "Só simulador"
 * ou "Desligado" gravavam o modo com o estado ainda producao; a clinica
 * para pelo Pausar). O banco recusa de novo (P0001 clinica_em_producao).
 */
export async function definirEscolhaDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda();
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = escolhaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const { escolha } = parsed.data;
  if (escolha === "equipe") {
    const recusa = recusaDeLigar(guardaOk);
    if (recusa) {
      return recusa;
    }
  }
  const supabase = await createClient();

  // Com o assistente em producao, so o Painel geral muda o modo. A leitura
  // que falha nao trava o desligar aqui: o banco recusa a clinica em
  // producao do mesmo jeito.
  const lidos = await lerDados(supabase, guardaOk.clinicId);
  if (lidos && escolhaAtual(lidos.liberacao) === "producao") {
    return { ok: false, error: TEXTOS_DA_IA.emProducaoSoPeloPainel };
  }

  if (escolha === "equipe") {
    const dados = lidos;
    if (!dados) {
      return { ok: false, error: TEXTOS.naoLeu };
    }
    const temTelefone = dados.telefones.some((telefone) => telefone.ativo);
    let temNumero = false;
    for (const whatsappAccountId of dados.numerosLigados) {
      try {
        const numero = await fetchNumeroDaClinica(
          supabase,
          guardaOk.clinicId,
          whatsappAccountId,
        );
        if (numero) {
          temNumero = true;
          break;
        }
      } catch {
        return { ok: false, error: TEXTOS.naoLeu };
      }
    }
    if (!temNumero || !temTelefone) {
      return { ok: false, error: TEXTOS_DA_IA.faltaParaAEquipe };
    }
  }

  const { error } = await supabase.rpc(
    "definir_liberacao_da_ia",
    escolha === "desligado"
      ? {
          p_clinic_id: guardaOk.clinicId,
          p_liberada: false,
          p_motivo: MOTIVO,
        }
      : {
          p_clinic_id: guardaOk.clinicId,
          p_liberada: true,
          p_modo: MODO_DA_ESCOLHA[escolha],
          p_motivo: MOTIVO,
        },
  );
  if (error) {
    return falhou(guardaOk, `escolha_${escolha}`, error, TEXTOS.naoAlterou);
  }
  revalidar();
  return { ok: true };
}

/**
 * Liga ou desliga UM numero da clinica para o assistente, sem mexer nos
 * outros: a clinica pode ter varios numeros ligados ao mesmo tempo (decisao
 * do dono de 19/10/2026; o banco deixou de desligar os outros ao ligar,
 * migration 20261019110000). Ligar: so o super admin nesta fase, e so
 * numero conectado da clinica. Desligar: o administrador da clinica tambem,
 * mesmo com o numero desconectado; o banco devolve para a equipe so as
 * conversas DESTE numero. Pelo Painel geral (clinicId na entrada), a
 * conexao vem do painel (numeroDaClinica).
 */
export async function alternarNumeroDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda(clinicaDaEntrada(entrada));
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = alternarNumeroSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const { whatsappAccountId, ligado } = parsed.data;
  if (ligado) {
    const recusa = recusaDeLigar(guardaOk);
    if (recusa) {
      return recusa;
    }
  }
  const supabase = await createClient();

  const definir = (ativo: boolean) =>
    supabase.rpc("definir_numero_da_ia", {
      p_clinic_id: guardaOk.clinicId,
      p_whatsapp_account_id: whatsappAccountId,
      p_ativo: ativo,
    });

  if (!ligado) {
    const { error } = await definir(false);
    if (error) {
      return falhou(guardaOk, "numero_desligar", error, TEXTOS.naoAlterou);
    }
    revalidar();
    return { ok: true };
  }

  let numero: { id: string; connectionStatus: string | null } | null;
  try {
    numero = await numeroDaClinica(supabase, guardaOk, whatsappAccountId);
  } catch {
    return { ok: false, error: TEXTOS.naoLeu };
  }
  if (!numero) {
    return { ok: false, error: TEXTOS.numeroForaDaClinica };
  }
  if (situacaoDaConexao(numero.connectionStatus) !== "conectado") {
    return { ok: false, error: TEXTOS_DA_IA.conecteAntes };
  }

  const dados = await lerDados(supabase, guardaOk.clinicId);
  if (!dados) {
    return { ok: false, error: TEXTOS.naoLeu };
  }
  const linha = await garantirLinha(supabase, guardaOk, dados);
  if (linha !== "ok") {
    return falhou(guardaOk, "numero_linha", linha, TEXTOS.naoAlterou);
  }
  const { error } = await definir(true);
  if (error) {
    return falhou(guardaOk, "numero_ligar", error, TEXTOS.naoAlterou);
  }
  revalidar();
  return { ok: true };
}

/**
 * Um numero ATIVO (nao removido) da clinica, com a conexao crua; nulo
 * quando nao e (mais) da clinica. Na clinica ativa, a leitura de sempre
 * (whatsapp_account pela RLS). No painel, o proprio painel: a equipe
 * Conduzza nem sempre e membro da clinica, e whatsapp_account so e legivel
 * por membro ativo. Lanca se a leitura falhar.
 */
async function numeroDaClinica(
  supabase: Supabase,
  guardaOk: Guarda,
  whatsappAccountId: string,
): Promise<{ id: string; connectionStatus: string | null } | null> {
  if (!guardaOk.noPainel) {
    return fetchNumeroDaClinica(supabase, guardaOk.clinicId, whatsappAccountId);
  }
  const doPainel = await fetchNumeroDaClinicaNoPainel(
    supabase,
    guardaOk.clinicId,
    whatsappAccountId,
  );
  return doPainel
    ? { id: doPainel.id, connectionStatus: doPainel.conexao }
    : null;
}

/**
 * O contato (lead ou paciente) desta clinica com este telefone, pela chave
 * canonica (com e sem o nono digito sao a mesma pessoa; contact.phone_key
 * tem indice unico por clinica). Nulo: nenhum. Lanca se a leitura falhar.
 */
async function contatoComOTelefone(
  supabase: Supabase,
  clinicId: string,
  telefone: string,
): Promise<{ id: string; name: string | null } | null> {
  const { data, error } = await supabase
    .from("contact")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .eq("phone_key", chaveDeTelefone(telefone))
    .maybeSingle();
  if (error) {
    throw new Error("leitura do contato falhou");
  }
  return data as { id: string; name: string | null } | null;
}

/**
 * Cadastra (ou religa) um telefone da equipe. O rotulo diz de quem e; o
 * telefone vira E.164 com o 55 do Brasil quando vem sem o codigo do pais.
 * O mesmo telefone com e sem o nono digito e uma linha so (o banco grava a
 * chave canonica).
 *
 * Telefone que ja e de um contato da clinica nao entra sem a confirmacao
 * explicita: a acao recusa com o aviso e o nome (pedeConfirmacao) e so
 * grava quando a tela devolve confirmarContato marcado. Mostrar o nome e
 * leitura de dado de paciente por pessoa: vai para a trilha (ficha_paciente,
 * com o id do contato) antes de sair daqui.
 *
 * Telefone de PACIENTE (sinal de paciente no banco): o banco recusa sem o
 * forcar, e a acao devolve pedeForcar para quem passou na guarda (o
 * administrador da clinica, desde a onda 2, e o super admin). O forcar so
 * vai ao banco com a confirmacao do teste (recusaDoForcar), que o banco
 * grava na trilha (confirmou_teste_com_paciente e
 * forcou_telefone_de_paciente_na_ia) no nome de quem forcou. O parametro
 * p_confirmou_teste_com_paciente so vai com o forcar: o resto continua
 * casando com a assinatura de antes.
 *
 * Pelo Painel geral (clinicId na entrada), a confirmacao de que o telefone
 * e de alguem da equipe e SEMPRE pedida, sem ler os contatos da clinica: o
 * painel nao le nem mostra dado de paciente (nada vai para a trilha de
 * leitura, porque nada de paciente foi lido).
 */
export async function adicionarTelefoneDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda(clinicaDaEntrada(entrada));
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = adicionarTelefoneSchema.safeParse(entrada);
  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    return {
      ok: false,
      error:
        problema && problema.code !== "invalid_type" && problema.path.length > 0
          ? problema.message
          : TEXTOS.dadosInvalidos,
    };
  }
  const {
    rotulo,
    telefone,
    confirmarContato,
    forcarContatoDePaciente,
    confirmouTesteComPaciente,
  } = parsed.data;
  const recusa = recusaDoForcar(
    forcarContatoDePaciente,
    confirmouTesteComPaciente,
  );
  if (recusa) {
    return recusa;
  }
  if (guardaOk.noPainel && confirmarContato !== true) {
    return {
      ok: false,
      error: TEXTOS.confirmeQueEDaEquipe,
      pedeConfirmacao: true,
    };
  }
  const supabase = await createClient();

  if (confirmarContato !== true) {
    let contato: Awaited<ReturnType<typeof contatoComOTelefone>>;
    try {
      contato = await contatoComOTelefone(
        supabase,
        guardaOk.clinicId,
        telefone,
      );
    } catch {
      return { ok: false, error: TEXTOS.naoLeu };
    }
    if (contato) {
      await auditarLeituraDePaciente(supabase, {
        clinicId: guardaOk.clinicId,
        userId: guardaOk.userId,
        entity: "ficha_paciente",
        entityId: contato.id,
      });
      return {
        ok: false,
        error: avisoDeContatoDaClinica(contato.name),
        pedeConfirmacao: true,
      };
    }
  }

  const dados = await lerDados(supabase, guardaOk.clinicId);
  if (!dados) {
    return { ok: false, error: TEXTOS.naoLeu };
  }
  const linha = await garantirLinha(supabase, guardaOk, dados);
  if (linha !== "ok") {
    return falhou(guardaOk, "telefone_linha", linha, TEXTOS.naoAlterou);
  }
  const forcar = forcarContatoDePaciente === true;
  // Sempre por nome de parametro: a assinatura tem o forcar (E3), a
  // confirmacao do aviso da OpenAI (migration 20261019120000) e, com o
  // forcar, a confirmacao do teste (onda 2, item 3). O schema so aceita a
  // confirmacao do aviso marcada; o banco grava as trilhas na mesma
  // transacao, no nome de quem adiciona.
  const { error } = await supabase.rpc("definir_contato_liberado_da_ia", {
    p_clinic_id: guardaOk.clinicId,
    p_telefone_e164: telefone,
    p_rotulo: rotulo,
    p_ativo: true,
    p_forcar_contato_existente: forcar,
    p_confirmou_aviso_da_openai: parsed.data.confirmarAvisoDaOpenai,
    ...(forcar ? { p_confirmou_teste_com_paciente: true } : {}),
  });
  if (error) {
    const resultado = falhou(
      guardaOk,
      "telefone_adicionar",
      error,
      TEXTOS.naoAlterou,
    );
    // Telefone de paciente: quem passou na guarda (administrador ou super
    // admin) ve o "Usar mesmo assim", com a confirmacao do teste (o banco
    // confere de novo e grava a trilha propria).
    if (
      !resultado.ok &&
      !forcar &&
      error.code === "23514" &&
      (error.message ?? "").trim() === "contato_de_paciente"
    ) {
      return { ...resultado, pedeForcar: true };
    }
    return resultado;
  }
  revalidar();
  return { ok: true };
}

/**
 * O telefone ja esta na lista da equipe desta clinica (pela chave canonica,
 * a mesma do banco)? Lanca se a leitura falhar.
 */
async function telefoneEstaNaLista(
  supabase: Supabase,
  clinicId: string,
  telefone: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ia_contato_liberado")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("phone_key", chaveDeTelefone(telefone))
    .maybeSingle();
  if (error) {
    throw new Error("leitura do telefone falhou");
  }
  return data !== null;
}

/**
 * Liga ou desliga um telefone que ja esta na lista (o rotulo fica como
 * esta). Desligar devolve para a equipe a conversa desse telefone. Ligar de
 * novo, desde 19/10/2026, basta a guarda (administrador da clinica ou super
 * admin), sem o forcar: telefone de paciente volta so pelo formulario de
 * adicionar, com o forcar e a confirmacao do teste.
 *
 * Revisao de producao de 19/10/2026: ligar so telefone que JA esta na lista.
 * Telefone novo entra so pelo formulario de adicionar, com a confirmacao do
 * aviso da OpenAI (o banco tambem recusa criar linha sem ela, e desligar
 * telefone fora da lista nao cria linha).
 */
export async function alternarTelefoneDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda(clinicaDaEntrada(entrada));
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = alternarTelefoneSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const supabase = await createClient();
  if (parsed.data.ligado) {
    let naLista: boolean;
    try {
      naLista = await telefoneEstaNaLista(
        supabase,
        guardaOk.clinicId,
        parsed.data.telefone,
      );
    } catch {
      return { ok: false, error: TEXTOS.naoLeu };
    }
    if (!naLista) {
      return { ok: false, error: TEXTOS.telefoneForaDaLista };
    }
  }
  const { error } = await supabase.rpc("definir_contato_liberado_da_ia", {
    p_clinic_id: guardaOk.clinicId,
    p_telefone_e164: parsed.data.telefone,
    // Vazio mantem o rotulo gravado (nullif no banco).
    p_rotulo: "",
    p_ativo: parsed.data.ligado,
  });
  if (error) {
    return falhou(
      guardaOk,
      parsed.data.ligado ? "telefone_ligar" : "telefone_desligar",
      error,
      TEXTOS.naoAlterou,
    );
  }
  revalidar();
  return { ok: true };
}

/**
 * Exclui um telefone da lista da equipe (onda 2, item 9). O banco
 * (excluir_contato_liberado_da_ia, migration 20261022110000) confere o
 * guarda de sempre, apaga a linha, devolve para a equipe a conversa desse
 * telefone (ia_desligar) e grava a trilha excluiu_telefone_da_ia, nunca com
 * o telefone. Sem linha (ja saiu), devolve falso sem trilha. Excluir o
 * telefone forcado apaga o forcar: voltar exige forcar de novo, com a
 * confirmacao. Pelo Painel geral, com o clinicId da tela (so o super admin).
 */
export async function excluirTelefoneDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda(clinicaDaEntrada(entrada));
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = excluirTelefoneSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("excluir_contato_liberado_da_ia", {
    p_clinic_id: guardaOk.clinicId,
    p_contato_liberado_id: parsed.data.id,
  });
  if (error) {
    return falhou(guardaOk, "telefone_excluir", error, TEXTOS.naoExcluiu);
  }
  if (data !== true) {
    // A linha ja tinha saido (outra pessoa excluiu, ou outra clinica):
    // nada foi apagado e o banco nao gravou trilha.
    revalidar();
    return { ok: false, error: TEXTOS.telefoneJaSaiu };
  }
  revalidar();
  return { ok: true };
}

/**
 * Pausa ou retoma o assistente nesta clinica (onda 2, item 11, decisao
 * P11c: a clinica pausa e retoma sozinha). Grava pausada_pela_clinica (T7,
 * conferida em todas as decisoes) pela RPC definir_pausa_da_ia (migration
 * 20261022120000), que tem o guarda de sempre, devolve as conversas da IA
 * para a equipe ao pausar (ia_desligar) e grava a trilha (pausou_a_ia e
 * retomou_a_ia). So a clinica ativa, pela aba. Pausar so com o WhatsApp
 * ligado (equipe ou producao), conferido de novo aqui com a leitura do
 * banco; retomar sempre (tirar a pausa nao liga nada sozinho).
 */
export async function definirPausaDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda();
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = pausaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const { pausada } = parsed.data;
  const supabase = await createClient();
  if (pausada) {
    const dados = await lerDados(supabase, guardaOk.clinicId);
    if (!dados) {
      return { ok: false, error: TEXTOS.naoLeu };
    }
    // O modo como texto: numero_inteiro chega com a migration da producao.
    const modo: string | null = dados.liberacao?.modo ?? null;
    if (
      !dados.liberacao?.liberada ||
      (modo !== "contatos" && modo !== "numero_inteiro")
    ) {
      return { ok: false, error: TEXTOS.pausaSemWhatsapp };
    }
  }
  const { error } = await supabase.rpc("definir_pausa_da_ia", {
    p_clinic_id: guardaOk.clinicId,
    p_pausada: pausada,
    p_motivo: MOTIVO,
  });
  if (error) {
    return falhou(
      guardaOk,
      pausada ? "pausar" : "retomar",
      error,
      pausada ? TEXTOS.naoPausou : TEXTOS.naoRetomou,
    );
  }
  revalidar();
  return { ok: true };
}
