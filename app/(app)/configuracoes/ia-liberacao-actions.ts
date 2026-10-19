"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  avisoDeContatoDaClinica,
  MODO_DA_ESCOLHA,
  telefoneDaEquipeSchema,
  TEXTOS_DA_IA,
} from "@/components/configuracoes/agente-de-ia";
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
import { createClient } from "@/lib/supabase/server";

// Aba "Agente de IA" de Configuracoes (Fase 3; decisao do dono em
// 05/10/2026): ligar e desligar o assistente na clinica e escolher o modo,
// ligar e desligar cada numero (varios ao mesmo tempo desde a decisao do
// dono de 19/10/2026, migration 20261019110000), cadastrar e desligar os
// telefones da equipe e, so para o super admin, o interruptor geral.
// Contrato do banco nas migrations 20261006100000_ia_liberacao_e_schema.sql
// e 20261006120000_ia_liberacao_pela_tela.sql.
//
// A AUTORIZACAO VIVE NO BANCO: toda escrita passa pelas RPCs definir_*_da_ia,
// com a sessao. O guarda ia_exigir_quem_libera deixa passar so o
// administrador ativo da propria clinica da lista fechada e o super admin;
// definir_interruptor_da_ia, so o super admin. A guarda daqui e a segunda
// camada (CLAUDE.md 3.4: esconder botao nao protege nada): a aba so existe
// nas clinicas da fase controlada (abaDaIaVisivel, a mesma decisao da
// pagina) e so o administrador da clinica ou o super admin chega a RPC.
// Cada RPC grava a trilha (audit_log) sozinha, sem telefone.
//
// LIGAR O ATENDIMENTO PELO WHATSAPP E SO DA EQUIPE CONDUZZA NESTA FASE (E3,
// decisao do dono em 13/10/2026): escolher "Conversar com a equipe" e ligar
// um numero exigem o super admin, aqui e no banco (ia_exigir_equipe_conduzza).
// Desligar continua com o administrador da clinica. Cada numero liga e
// desliga sozinho: ligar um nao desliga os outros (decisao do dono de
// 19/10/2026; antes, o banco desligava os outros). TELEFONE DA EQUIPE
// (decisao do dono em 19/10/2026, migration 20261019100000): adicionar e
// ligar de novo voltam para quem passa na guarda (o administrador da clinica
// ou o super admin), como no banco (ia_exigir_quem_libera). O telefone novo
// exige a confirmacao do aviso da OpenAI (LGPD, D32); desde a revisao de
// producao de 19/10/2026 (migration 20261019120000) ela vai ao BANCO
// (p_confirmou_aviso_da_openai), que recusa telefone novo sem ela e grava a
// trilha 'confirmou_aviso_da_openai' na mesma transacao, no nome de quem
// adicionou. "Ligar de novo" so vale para telefone que ja esta na lista.
// Telefone de paciente e numero de WhatsApp do Conduzza sao recusados pelo
// banco, e so o super admin forca o primeiro (aqui e no banco: o forcar de
// quem nao e super admin para antes do banco).
//
// Nada daqui vai para log alem do codigo do erro, da clinica, do numero e
// do tipo de acao: nunca telefone, rotulo nem nome de contato.
//
// Guarda local: toda funcao exportada de um arquivo "use server" vira
// endpoint, entao cada uma confere por si.

/**
 * pedeConfirmacao: o telefone novo ja e de um contato da clinica; a tela
 * mostra o aviso e o campo de confirmacao, e so grava com ele marcado.
 * pedeForcar: o banco recusou o telefone por ser de paciente e quem chama e
 * o super admin; a tela mostra "Usar mesmo assim (fica registrado)".
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
  soSuperAdmin: "Somente a equipe Conduzza liga e desliga o interruptor geral.",
  naoAlterou: "Não foi possível alterar o assistente de IA. Tente de novo.",
  naoLeu:
    "Não foi possível conferir a configuração do assistente. Recarregue a página e tente de novo.",
  numeroForaDaClinica:
    "Este número não está mais entre os números da clínica. Recarregue a página.",
  numeroRemovido: "Este número foi removido da clínica. Recarregue a página.",
  telefoneForaDaLista:
    "Este telefone não está na lista da equipe. Adicione o telefone pelo formulário.",
  interruptorNaoAlterou:
    "Não foi possível alterar o interruptor geral. Tente de novo.",
} as const;

/** Texto livre do motivo nas RPCs (vai para ia_liberacao.motivo). */
const MOTIVO = "Configurações, aba Agente de IA";

/** E.164 do banco (check de ia_contato_liberado). */
const E164 = /^\+[1-9][0-9]{7,14}$/;

const escolhaSchema = z
  .object({ escolha: z.enum(["desligado", "simulador", "equipe"]) })
  .strict();

const alternarNumeroSchema = z
  .object({ whatsappAccountId: z.uuid(), ligado: z.boolean() })
  .strict();

const alternarTelefoneSchema = z
  .object({ telefone: z.string().regex(E164), ligado: z.boolean() })
  .strict();

const interruptorSchema = z.object({ ligado: z.boolean() }).strict();

type Guarda = { userId: string; clinicId: string; superAdmin: boolean };

/**
 * A clinica ativa esta na fase controlada e quem chama e o administrador
 * dela ou o super admin. Gestor e os demais papeis param aqui (e no banco).
 */
async function guarda(): Promise<Guarda | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: TEXTOS.sessaoExpirada };
  }
  if (!abaDaIaVisivel(context.active.clinicId)) {
    return { error: TEXTOS.foraDaFase };
  }
  if (context.active.role !== "admin" && !context.isProductAdmin) {
    return { error: TEXTOS_DA_IA.semPermissao };
  }
  return {
    userId: context.userId,
    clinicId: context.active.clinicId,
    superAdmin: context.isProductAdmin,
  };
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
 * O forcar do telefone de paciente ("Usar mesmo assim") continua so do super
 * admin: o de quem nao e para aqui, antes de ler o contato e antes do banco
 * (que tambem recusa, com ia_exigir_equipe_conduzza). null: pode.
 */
function recusaDoForcar(
  guardaOk: Guarda,
  forcar: boolean | undefined,
): ResultadoDaIa | null {
  return forcar === true && !guardaOk.superAdmin
    ? { ok: false, error: TEXTOS_DA_IA.soEquipeConduzzaForca }
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
  return { ok: false, error: textoDoErro(kind, error, texto) };
}

/**
 * O codigo do banco em texto de recepcionista, conforme a acao: 42501 e
 * permissao em todas; 22023 so vem do telefone (fora do E.164); 23503 e
 * 23514 so do numero (de outra clinica, ou removido). O resto, o texto
 * generico da acao.
 */
function textoDoErro(kind: string, error: ErroDoBanco, outro: string): string {
  const codigo = error?.code;
  const chave = (error?.message ?? "").trim();
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
  }
  if (kind.startsWith("telefone_") && codigo === "22023") {
    return TEXTOS_DA_IA.telefoneInvalido;
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
    p_motivo: MOTIVO,
  });
  return error ?? "ok";
}

/**
 * Liga ou desliga o assistente nesta clinica e escolhe o modo. "equipe"
 * (modo contatos do banco) exige ao menos um numero ligado que ainda e
 * numero ativo da clinica e ao menos um telefone ligado, conferidos de novo
 * aqui com a leitura do banco. Numero ligado e desconectado nao e falta (a
 * aba mostra o motivo da parada; reconectar nao pede ligar de novo).
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

  if (escolha === "equipe") {
    const dados = await lerDados(supabase, guardaOk.clinicId);
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
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * Liga ou desliga UM numero da clinica para o assistente, sem mexer nos
 * outros: a clinica pode ter varios numeros ligados ao mesmo tempo (decisao
 * do dono de 19/10/2026; o banco deixou de desligar os outros ao ligar,
 * migration 20261019110000). Ligar: so o super admin nesta fase, e so
 * numero conectado da clinica. Desligar: o administrador da clinica tambem,
 * mesmo com o numero desconectado; o banco devolve para a equipe so as
 * conversas DESTE numero.
 */
export async function alternarNumeroDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda();
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
    revalidatePath("/configuracoes");
    return { ok: true };
  }

  let numero: Awaited<ReturnType<typeof fetchNumeroDaClinica>>;
  try {
    numero = await fetchNumeroDaClinica(
      supabase,
      guardaOk.clinicId,
      whatsappAccountId,
    );
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
  revalidatePath("/configuracoes");
  return { ok: true };
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
 * Telefone que ja e de um contato da clinica (um paciente, quase sempre)
 * nao entra sem a confirmacao explicita: a acao recusa com o aviso e o nome
 * (pedeConfirmacao) e so grava quando a tela devolve confirmarContato
 * marcado. Mostrar o nome e leitura de dado de paciente por pessoa: vai
 * para a trilha (ficha_paciente, com o id do contato) antes de sair daqui.
 *
 * Desde 19/10/2026 (decisao do dono) o administrador da clinica tambem
 * adiciona; o forcar continua so do super admin (recusaDoForcar).
 */
export async function adicionarTelefoneDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda();
  if ("error" in guardaOk) {
    return { ok: false, error: guardaOk.error };
  }
  const parsed = telefoneDaEquipeSchema.safeParse(entrada);
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
  const { rotulo, telefone, confirmarContato, forcarContatoDePaciente } =
    parsed.data;
  const recusa = recusaDoForcar(guardaOk, forcarContatoDePaciente);
  if (recusa) {
    return recusa;
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
  // Sempre por nome de parametro: a assinatura tem o forcar (E3) e a
  // confirmacao do aviso da OpenAI (migration 20261019120000). O schema so
  // aceita a confirmacao marcada; o banco grava a trilha dela na mesma
  // transacao, no nome de quem adiciona.
  const { error } = await supabase.rpc("definir_contato_liberado_da_ia", {
    p_clinic_id: guardaOk.clinicId,
    p_telefone_e164: telefone,
    p_rotulo: rotulo,
    p_ativo: true,
    p_forcar_contato_existente: forcarContatoDePaciente === true,
    p_confirmou_aviso_da_openai: parsed.data.confirmarAvisoDaOpenai,
  });
  if (error) {
    const resultado = falhou(
      guardaOk,
      "telefone_adicionar",
      error,
      TEXTOS.naoAlterou,
    );
    // Telefone de paciente: so o super admin ve a opcao de forcar (o banco
    // confere de novo e grava a trilha propria).
    if (
      !resultado.ok &&
      error.code === "23514" &&
      (error.message ?? "").trim() === "contato_de_paciente" &&
      guardaOk.superAdmin
    ) {
      return { ...resultado, pedeForcar: true };
    }
    return resultado;
  }
  revalidatePath("/configuracoes");
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
 * adicionar, com o forcar do super admin.
 *
 * Revisao de producao de 19/10/2026: ligar so telefone que JA esta na lista.
 * Telefone novo entra so pelo formulario de adicionar, com a confirmacao do
 * aviso da OpenAI (o banco tambem recusa criar linha sem ela, e desligar
 * telefone fora da lista nao cria linha).
 */
export async function alternarTelefoneDaIaAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const guardaOk = await guarda();
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
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * O interruptor geral (todas as clinicas). So o super admin, aqui e no
 * banco (definir_interruptor_da_ia). Desligar devolve todas as conversas
 * da IA para a equipe, sem enviar nada.
 */
export async function definirInterruptorGeralAction(
  entrada: unknown,
): Promise<ResultadoDaIa> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: TEXTOS.sessaoExpirada };
  }
  if (!abaDaIaVisivel(context.active.clinicId)) {
    return { ok: false, error: TEXTOS.foraDaFase };
  }
  if (!context.isProductAdmin) {
    return { ok: false, error: TEXTOS.soSuperAdmin };
  }
  const parsed = interruptorSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("definir_interruptor_da_ia", {
    p_ligado: parsed.data.ligado,
    p_motivo: MOTIVO,
  });
  if (error) {
    log.warn("ia_interruptor_nao_alterado", {
      clinic_id: context.active.clinicId,
      error_code: error.code ?? null,
    });
    return {
      ok: false,
      error:
        error.code === "42501"
          ? TEXTOS.soSuperAdmin
          : TEXTOS.interruptorNaoAlterou,
    };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}
