"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  erroDeSempre,
  FRASE_DA_EQUIPE_CONDUZZA,
  FRASES_SEM_PERMISSAO,
  fraseDoNomeComInvisivel,
  frasesDoConteudoRecusado,
  prepararTextoDoPreparo,
  problemaNoTextoDoPreparo,
  TEXTOS_DO_PREPARO as T,
  traduzirErroDoPreparo,
  type AcaoDoPreparo,
  type RecusaDoPreparo,
} from "@/components/cadastros/preparo-na-tela";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { problemasDoTextoDoPreparo } from "@/lib/domain/conformidade/preparo-aprovado";
import { canEdit, type Role } from "@/lib/domain/permissions";
import { conteudoRecusadoPeloBanco } from "@/lib/domain/preparo";
import { createClient } from "@/lib/supabase/server";

import {
  recusaDoTextoDoPreparo,
  recusasDasVersoesAprovadas,
} from "./recusas-do-preparo";

// Server Actions da orientacao de preparo do procedimento (AG7; Cadastros,
// modal do Procedimento). Ficam FORA de ./actions.ts de proposito: o
// requireEditor de la recusa quem nao e administrador nem gestor, e aqui o
// responsavel tecnico (RT) de qualquer papel escreve e aprova (D-71). A
// guarda de cada acao e conferida AQUI, antes da RPC (esconder botao nao
// protege nada), e de novo no banco (as RPCs SECURITY DEFINER, com as
// frases 42501 do contrato):
//  - escrever, descartar e suspender: administrador ou gestor ativo, a
//    equipe Conduzza (super admin) ou o RT vigente;
//  - aprovar, aprovar de novo e devolver: SO o RT vigente, e nunca a equipe
//    Conduzza (super admin), nem quando ela e o RT designado: aprovar e ato
//    clinico (D-71; revisao das telas, TELA-9).
// Toda entrada passa por Zod; o cliente e o de SESSAO (RLS); a clinica e
// sempre a ativa, e o procedimento ou a versao de outra clinica nao chega a
// RPC. O texto passa pelas regras de hoje (problemasDoTextoDoPreparo) ao
// escrever E ao aprovar (CFM-2): o texto antigo copiado pela migration e o
// salvo por chamada direta da API so chegam ao RT por aqui. A trilha
// (audit_log, so ids e o codigo do texto) e gravada pelas RPCs. O texto do
// preparo nao e dado de paciente, mas nada daqui e logado.

/** O Salvar: a versao nova, aguardando o RT (nula quando so a resposta veio fora do formato). */
export type ResultadoDoSalvarPreparo =
  | {
      ok: true;
      versao: { id: string; versao: number; textoSha256: string } | null;
    }
  | RecusaDoPreparo;

export type ResultadoDoPreparo = { ok: true } | RecusaDoPreparo;

/**
 * Os avisos do texto (remedio, dose, jejum...) para o dialogo do RT e, quando
 * as regras de hoje recusam o texto, a frase que diz o que tirar (o dialogo
 * mostra e nao deixa aprovar; CFM-2).
 */
export type ResultadoDosAvisos =
  | { ok: true; avisos: string[]; recusa: string | null }
  | { ok: false; error: string };

/**
 * Revisao curta da AG7 (CURTA-5): as versoes aprovadas e suspensas cujo
 * texto as regras de hoje recusam (o id da versao para a frase da recusa).
 */
export type ResultadoDasRecusas =
  { ok: true; recusas: Record<string, string> } | { ok: false; error: string };

const SESSAO_EXPIRADA = "Sessão expirada. Entre de novo.";
const ENTRADA_INVALIDA = "Confira o texto da orientação de preparo.";
const PROCEDIMENTO_NAO_ENCONTRADO = "Procedimento não encontrado.";
const VERSAO_NAO_ENCONTRADA =
  "Este texto não foi encontrado. Feche e abra de novo.";
const COMENTARIO_INVALIDO =
  "Escreva o que precisa mudar, em até 300 caracteres.";
const MOTIVO_INVALIDO = "Escreva o motivo em até 300 caracteres.";
const LIMITE_DO_COMENTARIO = 300;

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Sessao = {
  supabase: Supabase;
  clinicId: string;
  role: Role;
  superAdmin: boolean;
};

async function lerSessao(): Promise<Sessao | null> {
  const context = await getSessionContext();
  if (!context?.active) {
    return null;
  }
  return {
    supabase: await createClient(),
    clinicId: context.active.clinicId,
    role: context.active.role,
    superAdmin: context.isProductAdmin === true,
  };
}

/** A sessao e o RT vigente da clinica ativa? Erro e "nao" (falha fechada). */
async function souRtVigente(sessao: Sessao): Promise<boolean> {
  const { data, error } = await sessao.supabase.rpc(
    "user_e_responsavel_tecnico",
    { p_clinic_id: sessao.clinicId },
  );
  return !error && data === true;
}

/** Escrever, descartar e suspender (D-71; a matriz do desenho 5.6). */
async function mexeNoTexto(sessao: Sessao): Promise<boolean> {
  if (canEdit(sessao.role, "cadastros") || sessao.superAdmin) {
    return true;
  }
  return souRtVigente(sessao);
}

function semPermissao(frase: string): RecusaDoPreparo {
  return { ok: false, error: frase, code: "sem_permissao" };
}

/**
 * Aprovar, aprovar de novo e devolver: so o RT vigente, e nunca a equipe
 * Conduzza, nem quando ela e o RT designado (D-71; TELA-9). A RPC recusa de
 * novo. Null: pode.
 */
async function recusaDeQuemAprova(
  sessao: Sessao,
): Promise<RecusaDoPreparo | null> {
  if (sessao.superAdmin) {
    return semPermissao(FRASE_DA_EQUIPE_CONDUZZA);
  }
  return (await souRtVigente(sessao))
    ? null
    : semPermissao(FRASES_SEM_PERMISSAO.aprovar);
}

function versaoNaoEncontrada(): RecusaDoPreparo {
  return {
    ok: false,
    error: VERSAO_NAO_ENCONTRADA,
    code: "versao_inexistente",
  };
}

/** O procedimento existe na clinica ATIVA? */
async function procedimentoDaClinica(
  sessao: Sessao,
  procedureId: string,
): Promise<"sim" | "nao" | "erro"> {
  const { data, error } = await sessao.supabase
    .from("procedure")
    .select("id")
    .eq("clinic_id", sessao.clinicId)
    .eq("id", procedureId)
    .maybeSingle();
  if (error) {
    return "erro";
  }
  return data ? "sim" : "nao";
}

/** O nome GRAVADO do procedimento da clinica ATIVA (o que a mensagem leva). */
async function nomeDoProcedimento(
  sessao: Sessao,
  procedureId: string,
): Promise<{ nome: string } | "nao" | "erro"> {
  const { data, error } = await sessao.supabase
    .from("procedure")
    .select("id, name")
    .eq("clinic_id", sessao.clinicId)
    .eq("id", procedureId)
    .maybeSingle();
  if (error) {
    return "erro";
  }
  if (!data) {
    return "nao";
  }
  const nome = (data as { name?: unknown }).name;
  return typeof nome === "string" ? { nome } : "erro";
}

type VersaoLida = {
  id: string;
  procedure_id: string;
  versao: number;
  situacao: string;
  texto: string;
  texto_sha256: string;
};

const versaoLidaSchema = z.object({
  id: z.string(),
  procedure_id: z.string(),
  versao: z.number().int(),
  situacao: z.string(),
  texto: z.string(),
  texto_sha256: z.string(),
});

/** A versao, so se for da clinica ATIVA. */
async function versaoDaClinica(
  sessao: Sessao,
  versaoId: string,
): Promise<VersaoLida | null | "erro"> {
  const { data, error } = await sessao.supabase
    .from("preparo_do_procedimento")
    .select("id, procedure_id, versao, situacao, texto, texto_sha256")
    .eq("clinic_id", sessao.clinicId)
    .eq("id", versaoId)
    .maybeSingle();
  if (error) {
    return "erro";
  }
  const lida = versaoLidaSchema.safeParse(data);
  return lida.success ? lida.data : null;
}

/** Comentario aparado de 1 a 300 (cadastro_texto_valido), ou null. */
function comentarioValido(texto: string): string | null {
  const aparado = texto.replace(/\r\n?/g, "\n").trim();
  const tamanho = Array.from(aparado).length;
  return tamanho >= 1 && tamanho <= LIMITE_DO_COMENTARIO ? aparado : null;
}

function revalidar() {
  revalidatePath("/cadastros");
  revalidatePath("/agente");
}

const uuid = z.uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const versaoLida = z.number().int().min(0).max(1_000_000);

const respostaDoSalvarSchema = z.object({
  versao_id: z.string(),
  versao: z.number().int(),
  texto_sha256: z.string(),
});

/**
 * O texto que o BANCO recusou (texto_recusado: 22023 no salvar, P0001 no
 * aprovar; preparo_texto_recusado: o link, o valor em reais, o arroba ou o
 * invisivel que o filtro recusa), dito em frase que diz o que tirar, a
 * partir do texto que foi ao banco. As regras de hoje ja recusaram antes
 * tudo o que acharam (textoParaSalvar e o aprovar), entao chegar aqui e uma
 * divergencia: quem explica e o espelho da funcao do banco
 * (conteudoRecusadoPeloBanco), com o trecho ou a linha; sem achar, as quatro
 * coisas que o banco recusa. Nunca "Nao foi possivel...": a pessoa precisa
 * saber o que tirar.
 */
function fraseDoTextoRecusado(texto: string): string {
  return (
    frasesDoConteudoRecusado(texto, conteudoRecusadoPeloBanco(texto)) ??
    T.textoRecusadoPeloBanco
  );
}

type ErroDaRpc = { code?: string | null; message?: string | null };

/**
 * A recusa da RPC em frase de recepcao: o texto_recusado com o que tirar
 * (o aprovar com "Este texto nao pode ser aprovado." antes, como a recusa
 * das regras de hoje); o resto, traduzirErroDoPreparo.
 */
function recusaDoBanco(
  acao: AcaoDoPreparo,
  erro: ErroDaRpc,
  texto: string,
  // Revisao curta da AG7 (CURTA-6): o nome do procedimento lido antes da
  // RPC, para o nome_do_procedimento_invalido dizer o que tirar.
  nomeDoProcedimento?: string,
): RecusaDoPreparo {
  if (
    erro.code === "22023" &&
    erro.message === "nome_do_procedimento_invalido" &&
    nomeDoProcedimento !== undefined
  ) {
    const frase = fraseDoNomeComInvisivel(nomeDoProcedimento, "procedimento");
    if (frase !== null) {
      return { ok: false, error: frase };
    }
  }
  if (
    erro.message === "texto_recusado" &&
    (erro.code === "22023" || erro.code === "P0001")
  ) {
    const frase = fraseDoTextoRecusado(texto);
    return {
      ok: false,
      error: acao === "aprovar" ? `${T.naoPodeSerAprovado} ${frase}` : frase,
      code: "texto_recusado",
    };
  }
  return traduzirErroDoPreparo(acao, erro);
}

/**
 * O texto que vai para a RPC: preparado como o banco guarda (a tabulacao
 * vira espaco; CR para LF, NFC e o trim()), conferido pelo espelho do CHECK
 * e pelas regras do filtro: promessa, oferta casada, antes e depois, preco
 * e link sao recusados AQUI, antes do banco; remedio, dose e jejum passam
 * (D-80) e viram o aviso do dialogo do RT.
 */
function textoParaSalvar(
  bruto: string,
): { ok: true; texto: string } | RecusaDoPreparo {
  const problema = problemaNoTextoDoPreparo(bruto);
  if (problema) {
    return { ok: false, error: problema };
  }
  const texto = prepararTextoDoPreparo(bruto);
  const recusa = recusaDoTextoDoPreparo(texto);
  if (recusa) {
    return { ok: false, error: recusa, code: "texto_recusado" };
  }
  return { ok: true, texto };
}

async function salvarNoBanco(
  sessao: Sessao,
  procedureId: string,
  texto: string,
  versaoLidaNaTela: number,
  nomeDoProcedimento: string,
): Promise<ResultadoDoSalvarPreparo> {
  const { data, error } = await sessao.supabase.rpc(
    "salvar_preparo_do_procedimento",
    {
      p_procedure_id: procedureId,
      p_texto: texto,
      p_versao_lida: versaoLidaNaTela,
    },
  );
  if (error) {
    return recusaDoBanco("salvar", error, texto, nomeDoProcedimento);
  }
  const resposta = respostaDoSalvarSchema.safeParse(data);
  return {
    ok: true,
    versao: resposta.success
      ? {
          id: resposta.data.versao_id,
          versao: resposta.data.versao,
          textoSha256: resposta.data.texto_sha256,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Escrever (o texto novo, aguardando o RT)
// ---------------------------------------------------------------------------

const salvarSchema = z.object({
  procedureId: uuid,
  texto: z.string().max(20_000),
  versaoLida,
});

/**
 * Salva um texto novo como a versao seguinte, aguardando o RT
 * (salvar_preparo_do_procedimento). O texto aguardando que houver vira
 * descartado na RPC. `versaoLida` e a maior versao que a tela leu (0 sem
 * versao): outra pessoa salvou no meio, texto_mudou.
 */
export async function salvarPreparoAction(
  input: unknown,
): Promise<ResultadoDoSalvarPreparo> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = salvarSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: ENTRADA_INVALIDA };
  }
  if (!(await mexeNoTexto(sessao))) {
    return semPermissao(FRASES_SEM_PERMISSAO.escrever);
  }
  const texto = textoParaSalvar(lido.data.texto);
  if (!texto.ok) {
    return texto;
  }
  const procedimento = await nomeDoProcedimento(sessao, lido.data.procedureId);
  if (procedimento === "erro" || procedimento === "nao") {
    return {
      ok: false,
      error:
        procedimento === "erro"
          ? erroDeSempre("salvar")
          : PROCEDIMENTO_NAO_ENCONTRADO,
    };
  }
  // Revisao curta da AG7 (CURTA-6): o nome com caractere invisivel ou marca
  // de direcao (colado de outro lugar) vai no cabecalho da mensagem, e o
  // banco o recusa (nome_do_procedimento_invalido). A frase diz o que tirar,
  // antes da RPC.
  const nomeComInvisivel = fraseDoNomeComInvisivel(
    procedimento.nome,
    "procedimento",
  );
  if (nomeComInvisivel !== null) {
    return { ok: false, error: nomeComInvisivel };
  }
  const resultado = await salvarNoBanco(
    sessao,
    lido.data.procedureId,
    texto.texto,
    lido.data.versaoLida,
    procedimento.nome,
  );
  if (resultado.ok) {
    revalidar();
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Aprovar e devolver (so o RT vigente)
// ---------------------------------------------------------------------------

const aprovarSchema = z.object({ versaoId: uuid, textoSha256: sha256 });

/**
 * O RT aprova a versao aguardando que ele leu (o hash dela): a aprovada de
 * agora vira substituida, na RPC. Quem chega depois (outra aprovacao, o
 * descarte, um texto novo) recebe nao_aguarda_aprovacao. Antes da RPC, o
 * texto passa de novo pelas regras de hoje (CFM-2): o texto antigo copiado
 * pela migration (D-83) e o salvo por chamada direta da RPC nunca passaram
 * pela conferencia do Salvar, e com recusa nada e aprovado.
 */
export async function aprovarPreparoAction(
  input: unknown,
): Promise<ResultadoDoPreparo> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = aprovarSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  const recusaDoPapel = await recusaDeQuemAprova(sessao);
  if (recusaDoPapel) {
    return recusaDoPapel;
  }
  const versao = await versaoDaClinica(sessao, lido.data.versaoId);
  if (versao === "erro") {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  if (versao === null) {
    return versaoNaoEncontrada();
  }
  if (versao.texto_sha256 !== lido.data.textoSha256) {
    return traduzirErroDoPreparo("aprovar", {
      code: "P0001",
      message: "texto_mudou",
    });
  }
  const recusa = recusaDoTextoDoPreparo(versao.texto);
  if (recusa) {
    return {
      ok: false,
      error: `${T.naoPodeSerAprovado} ${recusa}`,
      code: "texto_recusado",
    };
  }
  const { error } = await sessao.supabase.rpc(
    "aprovar_preparo_do_procedimento",
    { p_versao_id: lido.data.versaoId, p_texto_sha256: lido.data.textoSha256 },
  );
  if (error) {
    return recusaDoBanco("aprovar", error, versao.texto);
  }
  revalidar();
  return { ok: true };
}

const aprovarDeNovoSchema = z.object({
  procedureId: uuid,
  /** A maior versao lida quando o dialogo abriu (nunca a relida depois). */
  versaoLida,
  /** O hash do texto que o RT leu no dialogo (o da ultima aprovada). */
  textoSha256: sha256,
  /** O nome do procedimento que a previa mostrou (o cabecalho da mensagem). */
  nomeLido: z.string().min(1).max(500),
});

const SITUACOES_JA_APROVADAS: ReadonlySet<string> = new Set([
  "aprovado",
  "substituido",
  "suspenso",
]);

/**
 * "Aprovar de novo" (D-72 e D-73): a aprovacao parou de valer (RT novo ou
 * sem acesso, nome do procedimento mudado, envio suspenso) e o RT aprova o
 * MESMO texto de novo, numa acao so: salva o texto da ultima versao que ja
 * foi aprovada como versao nova (a RPC aceita o texto igual ao da aprovada
 * quando ela nao vale mais) e aprova. Nada e gravado quando:
 *  - ha texto novo esperando o RT (TELA-1): salvar o texto antigo
 *    descartaria o novo, que o RT aprova pelo "Revisar e aprovar";
 *  - o texto do banco nao e o que o RT leu (o hash) ou o nome do
 *    procedimento nao e o da previa (TELA-11);
 *  - as regras de hoje recusam o texto (CFM-2).
 * A versao nova so e aprovada se o hash dela for o do texto lido.
 */
export async function aprovarDeNovoAction(
  input: unknown,
): Promise<ResultadoDoPreparo> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = aprovarDeNovoSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  const recusaDoPapel = await recusaDeQuemAprova(sessao);
  if (recusaDoPapel) {
    return recusaDoPapel;
  }
  const procedimento = await nomeDoProcedimento(sessao, lido.data.procedureId);
  if (procedimento === "erro") {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  if (procedimento === "nao") {
    return { ok: false, error: PROCEDIMENTO_NAO_ENCONTRADO };
  }
  const { data, error } = await sessao.supabase
    .from("preparo_do_procedimento")
    .select("id, procedure_id, versao, situacao, texto, texto_sha256")
    .eq("clinic_id", sessao.clinicId)
    .eq("procedure_id", lido.data.procedureId)
    .order("versao", { ascending: false });
  if (error) {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  const versoes = z.array(versaoLidaSchema).safeParse(data);
  if (!versoes.success) {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  if (versoes.data.some((v) => v.situacao === "aguardando_rt")) {
    return {
      ok: false,
      error: T.textoNovoAguardando,
      code: "texto_novo_aguardando",
    };
  }
  const base = versoes.data
    .filter((v) => SITUACOES_JA_APROVADAS.has(v.situacao))
    .sort((a, b) => b.versao - a.versao)[0];
  if (!base) {
    return versaoNaoEncontrada();
  }
  if (base.texto_sha256 !== lido.data.textoSha256) {
    return traduzirErroDoPreparo("aprovar", {
      code: "P0001",
      message: "texto_mudou",
    });
  }
  if (procedimento.nome !== lido.data.nomeLido) {
    return { ok: false, error: T.nomeMudouAoLer, code: "nome_mudou" };
  }
  const texto = textoParaSalvar(base.texto);
  if (!texto.ok) {
    return {
      ok: false,
      error: `${T.naoPodeSerAprovado} ${texto.error}`,
      code: "texto_recusado",
    };
  }
  const salvo = await salvarNoBanco(
    sessao,
    lido.data.procedureId,
    texto.texto,
    lido.data.versaoLida,
    procedimento.nome,
  );
  if (!salvo.ok) {
    // O banco recusou o conteudo no salvar: nada gravado, e a frase e a do
    // aprovar (a pessoa esta aprovando).
    return salvo.code === "texto_recusado"
      ? { ...salvo, error: `${T.naoPodeSerAprovado} ${salvo.error}` }
      : salvo;
  }
  revalidar();
  if (salvo.versao === null || salvo.versao.textoSha256 !== base.texto_sha256) {
    // Gravou, mas a resposta veio fora do formato ou a versao nova nao e o
    // texto lido: nada e aprovado, e o texto espera o RT, que o aprova (ou
    // nao) pelo "Revisar e aprovar", lendo de novo.
    return {
      ok: false,
      error: T.ficouAguardandoSemAprovar,
      code: "ficou_aguardando",
    };
  }
  const aprovado = await sessao.supabase.rpc(
    "aprovar_preparo_do_procedimento",
    {
      p_versao_id: salvo.versao.id,
      p_texto_sha256: salvo.versao.textoSha256,
    },
  );
  if (aprovado.error) {
    const recusa = recusaDoBanco("aprovar", aprovado.error, texto.texto);
    return recusa.code === undefined
      ? {
          ok: false,
          error: T.ficouAguardandoSemAprovar,
          code: "ficou_aguardando",
        }
      : {
          ok: false,
          error: `${recusa.error} ${T.ficouAguardando}`,
          code: recusa.code,
        };
  }
  return { ok: true };
}

const devolverSchema = z.object({
  versaoId: uuid,
  comentario: z.string().max(2_000),
});

/** O RT devolve a versao aguardando, com o que precisa mudar (obrigatorio). */
export async function devolverPreparoAction(
  input: unknown,
): Promise<ResultadoDoPreparo> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = devolverSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: COMENTARIO_INVALIDO };
  }
  const recusaDoPapel = await recusaDeQuemAprova(sessao);
  if (recusaDoPapel) {
    return recusaDoPapel;
  }
  const comentario = comentarioValido(lido.data.comentario);
  if (comentario === null) {
    return { ok: false, error: COMENTARIO_INVALIDO };
  }
  const versao = await versaoDaClinica(sessao, lido.data.versaoId);
  if (versao === "erro") {
    return { ok: false, error: erroDeSempre("devolver") };
  }
  if (versao === null) {
    return versaoNaoEncontrada();
  }
  const { error } = await sessao.supabase.rpc(
    "devolver_preparo_do_procedimento",
    { p_versao_id: lido.data.versaoId, p_comentario: comentario },
  );
  if (error) {
    return traduzirErroDoPreparo("devolver", error);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Descartar e suspender (administrador, gestor, super admin ou o RT)
// ---------------------------------------------------------------------------

const descartarSchema = z.object({ versaoId: uuid });

/** Descarta o texto que espera o RT (o aprovado, se houver, continua). */
export async function descartarPreparoAction(
  input: unknown,
): Promise<ResultadoDoPreparo> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = descartarSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: erroDeSempre("descartar") };
  }
  if (!(await mexeNoTexto(sessao))) {
    return semPermissao(FRASES_SEM_PERMISSAO.descartar);
  }
  const versao = await versaoDaClinica(sessao, lido.data.versaoId);
  if (versao === "erro") {
    return { ok: false, error: erroDeSempre("descartar") };
  }
  if (versao === null) {
    return versaoNaoEncontrada();
  }
  const { error } = await sessao.supabase.rpc(
    "descartar_preparo_do_procedimento",
    { p_versao_id: lido.data.versaoId },
  );
  if (error) {
    return traduzirErroDoPreparo("descartar", error);
  }
  revalidar();
  return { ok: true };
}

const suspenderSchema = z.object({
  procedureId: uuid,
  comentario: z.string().max(2_000).optional(),
});

/**
 * Suspende o envio do texto aprovado (parar e sempre o lado seguro): a regua
 * deixa de mandar e o assistente passa o pedido para a equipe, ate o RT
 * aprovar de novo. O motivo e opcional (ate 300).
 */
export async function suspenderPreparoAction(
  input: unknown,
): Promise<ResultadoDoPreparo> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = suspenderSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: erroDeSempre("suspender") };
  }
  if (!(await mexeNoTexto(sessao))) {
    return semPermissao(FRASES_SEM_PERMISSAO.suspender);
  }
  const bruto = lido.data.comentario?.trim() ?? "";
  const comentario = bruto === "" ? null : comentarioValido(bruto);
  if (bruto !== "" && comentario === null) {
    return { ok: false, error: MOTIVO_INVALIDO };
  }
  const procedimento = await procedimentoDaClinica(
    sessao,
    lido.data.procedureId,
  );
  if (procedimento !== "sim") {
    return {
      ok: false,
      error:
        procedimento === "erro"
          ? erroDeSempre("suspender")
          : PROCEDIMENTO_NAO_ENCONTRADO,
    };
  }
  const { error } = await sessao.supabase.rpc(
    "suspender_preparo_do_procedimento",
    comentario === null
      ? { p_procedure_id: lido.data.procedureId }
      : { p_procedure_id: lido.data.procedureId, p_comentario: comentario },
  );
  if (error) {
    return traduzirErroDoPreparo("suspender", error);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Os avisos do texto para o dialogo do RT (o navegador nunca roda o filtro)
// ---------------------------------------------------------------------------

const avisosSchema = z.object({ versaoId: uuid });

/**
 * O que o texto da versao cita de remedio, dose, jejum, triagem ou
 * diagnostico (problemasDoTextoDoPreparo, no servidor): o dialogo de
 * aprovacao mostra o aviso do desenho 5.2 quando a lista nao e vazia. Com
 * recusa das regras de hoje (CFM-2), a frase que diz o que tirar: o dialogo
 * mostra e nao deixa aprovar (a action de aprovar confere de novo). Qualquer
 * membro ativo le a versao (a mesma policy da tela); nada e gravado.
 */
export async function avisosDoPreparoAction(
  input: unknown,
): Promise<ResultadoDosAvisos> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const lido = avisosSchema.safeParse(input);
  if (!lido.success) {
    return { ok: false, error: VERSAO_NAO_ENCONTRADA };
  }
  const versao = await versaoDaClinica(sessao, lido.data.versaoId);
  if (versao === "erro" || versao === null) {
    return {
      ok: false,
      error: versao === null ? VERSAO_NAO_ENCONTRADA : erroDeSempre("aprovar"),
    };
  }
  return {
    ok: true,
    avisos: [...problemasDoTextoDoPreparo(versao.texto).avisos],
    recusa: recusaDoTextoDoPreparo(versao.texto),
  };
}

// ---------------------------------------------------------------------------
// O texto aprovado que as regras de hoje recusam (revisao curta, CURTA-5)
// ---------------------------------------------------------------------------

/**
 * As versoes aprovadas e suspensas da clinica ativa cujo texto as regras de
 * hoje recusam, com a frase da recusa: a secao mostra "Aprovada, sem envio"
 * com o motivo e trava o "Aprovar de novo". O envio ja nao deixa esse texto
 * sair (conferirParaEnvio e a regua); sem isto, a tela continuava dizendo
 * "Aprovada". Le pela sessao (a policy de membro ativo, a mesma da tela),
 * so as versoes aprovadas e suspensas; nada e gravado nem logado.
 */
export async function recusasDosPreparosAction(): Promise<ResultadoDasRecusas> {
  const sessao = await lerSessao();
  if (!sessao) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const { data, error } = await sessao.supabase
    .from("preparo_do_procedimento")
    .select("id, situacao, texto")
    .eq("clinic_id", sessao.clinicId)
    .in("situacao", ["aprovado", "suspenso"]);
  if (error) {
    return { ok: false, error: T.erroAoCarregar };
  }
  const versoes = ((data ?? []) as Record<string, unknown>[]).flatMap(
    (linha) =>
      typeof linha.id === "string" &&
      typeof linha.situacao === "string" &&
      typeof linha.texto === "string"
        ? [{ id: linha.id, situacao: linha.situacao, texto: linha.texto }]
        : [],
  );
  return { ok: true, recusas: recusasDasVersoesAprovadas(versoes) };
}
