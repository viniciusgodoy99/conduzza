"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  erroDeSempre,
  FRASES_SEM_PERMISSAO,
  frasesDasRecusas,
  problemaNoTextoDoPreparo,
  traduzirErroDoPreparo,
  type RecusaDoPreparo,
} from "@/components/cadastros/preparo-na-tela";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { problemasDoTextoDoPreparo } from "@/lib/domain/conformidade/preparo-aprovado";
import { normalizarTextoDoPreparo } from "@/lib/domain/preparo";
import { canEdit, type Role } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Actions da orientacao de preparo do procedimento (AG7; Cadastros,
// modal do Procedimento). Ficam FORA de ./actions.ts de proposito: o
// requireEditor de la recusa quem nao e administrador nem gestor, e aqui o
// responsavel tecnico (RT) de qualquer papel escreve e aprova (D-71). A
// guarda de cada acao e conferida AQUI, antes da RPC (esconder botao nao
// protege nada), e de novo no banco (as RPCs SECURITY DEFINER, com as
// frases 42501 do contrato):
//  - escrever, descartar e suspender: administrador ou gestor ativo, a
//    equipe Conduzza (super admin) ou o RT vigente;
//  - aprovar, aprovar de novo e devolver: SO o RT vigente (nem o super
//    admin: aprovar e ato clinico, D-71).
// Toda entrada passa por Zod; o cliente e o de SESSAO (RLS); a clinica e
// sempre a ativa, e o procedimento ou a versao de outra clinica nao chega a
// RPC. A trilha (audit_log, so ids e o codigo do texto) e gravada pelas
// RPCs. O texto do preparo nao e dado de paciente, mas nada daqui e logado.

/** O Salvar: a versao nova, aguardando o RT (nula quando so a resposta veio fora do formato). */
export type ResultadoDoSalvarPreparo =
  | {
      ok: true;
      versao: { id: string; versao: number; textoSha256: string } | null;
    }
  | RecusaDoPreparo;

export type ResultadoDoPreparo = { ok: true } | RecusaDoPreparo;

/** Os avisos do texto (remedio, dose, jejum...) para o dialogo do RT. */
export type ResultadoDosAvisos =
  { ok: true; avisos: string[] } | { ok: false; error: string };

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
 * O texto que vai para a RPC: normalizado como o banco guarda (CR para LF,
 * NFC e o trim()), conferido pelo espelho do CHECK e pelas regras do filtro
 * (problemasDoTextoDoPreparo): promessa, oferta casada, antes e depois,
 * preco e link sao recusados AQUI, antes do banco; remedio, dose e jejum
 * passam (D-80) e viram o aviso do dialogo do RT.
 */
function textoParaSalvar(
  bruto: string,
): { ok: true; texto: string } | { ok: false; error: string } {
  const problema = problemaNoTextoDoPreparo(bruto);
  if (problema) {
    return { ok: false, error: problema };
  }
  const texto = normalizarTextoDoPreparo(bruto);
  const recusa = frasesDasRecusas(problemasDoTextoDoPreparo(texto).recusas);
  if (recusa) {
    return { ok: false, error: recusa };
  }
  return { ok: true, texto };
}

async function salvarNoBanco(
  sessao: Sessao,
  procedureId: string,
  texto: string,
  versaoLidaNaTela: number,
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
    return traduzirErroDoPreparo("salvar", error);
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
  const procedimento = await procedimentoDaClinica(
    sessao,
    lido.data.procedureId,
  );
  if (procedimento !== "sim") {
    return {
      ok: false,
      error:
        procedimento === "erro"
          ? erroDeSempre("salvar")
          : PROCEDIMENTO_NAO_ENCONTRADO,
    };
  }
  const resultado = await salvarNoBanco(
    sessao,
    lido.data.procedureId,
    texto.texto,
    lido.data.versaoLida,
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
 * descarte, um texto novo) recebe nao_aguarda_aprovacao.
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
  if (!(await souRtVigente(sessao))) {
    return semPermissao(FRASES_SEM_PERMISSAO.aprovar);
  }
  const versao = await versaoDaClinica(sessao, lido.data.versaoId);
  if (versao === "erro") {
    return { ok: false, error: erroDeSempre("aprovar") };
  }
  if (versao === null) {
    return { ok: false, error: VERSAO_NAO_ENCONTRADA };
  }
  const { error } = await sessao.supabase.rpc(
    "aprovar_preparo_do_procedimento",
    { p_versao_id: lido.data.versaoId, p_texto_sha256: lido.data.textoSha256 },
  );
  if (error) {
    return traduzirErroDoPreparo("aprovar", error);
  }
  revalidar();
  return { ok: true };
}

const aprovarDeNovoSchema = z.object({
  procedureId: uuid,
  versaoLida,
  /** O hash do texto que o RT leu no dialogo (o da ultima aprovada). */
  textoSha256: sha256,
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
 * quando ela nao vale mais) e aprova. O texto passa de novo pelas regras de
 * hoje. Se o texto do banco nao for o que o RT leu (o hash), nada e gravado.
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
  if (!(await souRtVigente(sessao))) {
    return semPermissao(FRASES_SEM_PERMISSAO.aprovar);
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
  const base = versoes.data
    .filter((v) => SITUACOES_JA_APROVADAS.has(v.situacao))
    .sort((a, b) => b.versao - a.versao)[0];
  if (!base) {
    return { ok: false, error: VERSAO_NAO_ENCONTRADA };
  }
  if (base.texto_sha256 !== lido.data.textoSha256) {
    return {
      ok: false,
      error: "O texto mudou enquanto você lia. Feche e abra de novo.",
      code: "texto_mudou",
    };
  }
  const texto = textoParaSalvar(base.texto);
  if (!texto.ok) {
    return texto;
  }
  const salvo = await salvarNoBanco(
    sessao,
    lido.data.procedureId,
    texto.texto,
    lido.data.versaoLida,
  );
  if (!salvo.ok) {
    return salvo;
  }
  revalidar();
  if (salvo.versao === null) {
    // Gravou, mas a resposta veio fora do formato: o texto espera o RT, e a
    // tela recarrega para ele aprovar pelo "Revisar e aprovar".
    return {
      ok: false,
      error: `${erroDeSempre("aprovar")} O texto ficou aguardando o RT.`,
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
    const recusa = traduzirErroDoPreparo("aprovar", aprovado.error);
    return {
      ...recusa,
      error: `${recusa.error} O texto ficou aguardando o RT.`,
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
  if (!(await souRtVigente(sessao))) {
    return semPermissao(FRASES_SEM_PERMISSAO.aprovar);
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
    return { ok: false, error: VERSAO_NAO_ENCONTRADA };
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
    return { ok: false, error: VERSAO_NAO_ENCONTRADA };
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
 * aprovacao mostra o aviso do desenho 5.2 quando a lista nao e vazia.
 * Qualquer membro ativo le a versao (a mesma policy da tela).
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
  };
}
