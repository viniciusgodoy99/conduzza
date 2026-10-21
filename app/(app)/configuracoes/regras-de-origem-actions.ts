"use server";

import { randomInt } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { gerarToken, TOKEN_ALPHABET } from "@/lib/domain/attribution";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  avisoDasPalavrasRepetidas,
  campoDoProblema,
  camposDaRegra,
  DICA_SEM_PERMISSAO_NAS_ORIGENS,
  ERRO_SEM_JEITO_DE_RECONHECER,
  LIMITE_DE_ORIGENS_ATIVAS,
  origemComAMesmaMensagem,
  palavrasEmOutraOrigem,
  recusaDaMensagemRepetida,
  recusaDoBancoNaOrigem,
  recusaDoLimite,
  REGRA_DE_ORIGEM_SELECT,
  regraDaLinha,
  salvarOrigemSchema,
  type CampoDaOrigem,
  type LinhaDaRegraDeOrigem,
  type RegraDeOrigem,
} from "@/lib/domain/regras-de-origem";
import { createClient } from "@/lib/supabase/server";

// Origem dos leads (onda 5, item 17; contrato A.2): criar, editar, ativar,
// desativar e excluir as regras de campaign_link pela aba de Configuracoes.
// Saem de app/(app)/leads/actions.ts (salvarCampanhaAction e
// desativarCampanhaAction, que nenhuma tela chamava). Mesma forma das
// actions de mensagens padrao: guarda de papel ANTES de qualquer escrita
// (quem tem "tudo" em Configuracoes: administrador e gestor; o
// Implementador entra como administrador), Zod (o mesmo schema do
// formulario), cliente de SESSAO (a RLS "gestao gerencia campanhas" decide
// de novo), trilha sem o texto da mensagem e revalidate.
//
// As conferencias usam a MESMA normalizacao da ingestao (normalizarTexto):
// mensagem pronta igual a de outra origem ativa recusa (so a primeira
// reconheceria); palavra-chave repetida em outra origem ativa so avisa. O
// codigo do link nasce na criacao (P17-3) e nunca muda: link ja publicado na
// bio nao pode quebrar. Excluir nao apaga historico (o contato guarda a
// origem gravada, nao o id da regra).

export type ResultadoDaOrigem =
  | { ok: true; id: string; codigo?: string | null; aviso?: string }
  | { ok: false; error: string; campo?: CampoDaOrigem };

const idSchema = z.object({ id: z.uuid() });

const ORIGEM_SUMIU = "Esta origem não existe mais. Recarregue a página.";
const LEITURA_FALHOU =
  "Não foi possível conferir as origens cadastradas. Tente de novo.";

type Guarda = { userId: string; clinicId: string };

async function exigirGestao(): Promise<Guarda | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error:
        permissionHint(role, "configuracoes") ??
        DICA_SEM_PERMISSAO_NAS_ORIGENS,
    };
  }
  return { userId: context.userId, clinicId: context.active.clinicId };
}
type Cliente = Awaited<ReturnType<typeof createClient>>;

/**
 * Todas as origens da clinica (ativas e desativadas), na ordem de criacao.
 * Decide os conflitos e o limite: se a leitura falhar, a action para.
 */
async function lerOrigens(
  supabase: Cliente,
  clinicId: string,
): Promise<RegraDeOrigem[] | null> {
  const { data, error } = await supabase
    .from("campaign_link")
    .select(REGRA_DE_ORIGEM_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    return null;
  }
  return ((data ?? []) as LinhaDaRegraDeOrigem[]).map(regraDaLinha);
}

async function auditar(
  supabase: Cliente,
  guarda: Guarda,
  action: string,
  entityId: string,
): Promise<void> {
  // Sem o texto da mensagem nem as palavras-chave: so quem, o que e qual
  // linha.
  await supabase.from("audit_log").insert({
    clinic_id: guarda.clinicId,
    user_id: guarda.userId,
    action,
    entity: "campaign_link",
    entity_id: entityId,
  });
}

function revalidar() {
  revalidatePath("/configuracoes");
  // A gaveta do lead mostra o nome da origem no lugar da campanha digitada.
  revalidatePath("/leads");
}

function recusa(
  error: { code?: string; message?: string; details?: string; hint?: string },
  padrao: string,
  acao: "criar" | "ativar" = "criar",
): ResultadoDaOrigem {
  const traduzida = recusaDoBancoNaOrigem(error, acao);
  if (!traduzida) {
    return { ok: false, error: padrao };
  }
  return traduzida.campo
    ? { ok: false, error: traduzida.texto, campo: traduzida.campo }
    : { ok: false, error: traduzida.texto };
}

/** Sorteio do codigo pelo gerador criptografico (indice exato do alfabeto). */
function sorteio(): number {
  return randomInt(TOKEN_ALPHABET.length) / TOKEN_ALPHABET.length;
}

export async function salvarRegraDeOrigemAction(
  entrada: unknown,
): Promise<ResultadoDaOrigem> {
  const guarda = await exigirGestao();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const parsed = salvarOrigemSchema.safeParse(entrada);
  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    const campo = campoDoProblema(problema?.path);
    const texto = problema?.message ?? "Confira os campos da origem.";
    return campo
      ? { ok: false, error: texto, campo }
      : { ok: false, error: texto };
  }
  const dados = parsed.data;
  const supabase = await createClient();

  const origens = await lerOrigens(supabase, guarda.clinicId);
  if (!origens) {
    return { ok: false, error: LEITURA_FALHOU };
  }
  const atual = dados.id
    ? origens.find((origem) => origem.id === dados.id)
    : undefined;
  if (dados.id && !atual) {
    return { ok: false, error: ORIGEM_SUMIU };
  }

  const campos = camposDaRegra(dados);
  // Na edicao vale o codigo do banco (nunca muda), nao o que a tela mandou.
  const comCodigo = atual ? atual.codigo !== null : dados.com_codigo;
  if (
    !comCodigo &&
    campos.default_message === null &&
    campos.keywords.length === 0
  ) {
    return { ok: false, error: ERRO_SEM_JEITO_DE_RECONHECER, campo: "mensagem" };
  }

  // A origem nova nasce ativa; a editada fica como estava.
  const ficaAtiva = atual ? atual.ativa : true;
  const idAtual = atual?.id ?? null;
  if (ficaAtiva) {
    const outra = origemComAMesmaMensagem(
      campos.default_message,
      origens,
      idAtual,
    );
    if (outra) {
      return {
        ok: false,
        error: recusaDaMensagemRepetida(outra.nome),
        campo: "mensagem",
      };
    }
  }
  if (
    !atual &&
    origens.filter((origem) => origem.ativa).length >= LIMITE_DE_ORIGENS_ATIVAS
  ) {
    return { ok: false, error: recusaDoLimite("criar") };
  }
  const aviso = ficaAtiva
    ? avisoDasPalavrasRepetidas(
        palavrasEmOutraOrigem(campos.keywords, origens, idAtual),
      )
    : null;

  if (atual) {
    // Edicao nao mexe no codigo nem em active: so o conteudo.
    const { data, error } = await supabase
      .from("campaign_link")
      .update(campos)
      .eq("clinic_id", guarda.clinicId)
      .eq("id", atual.id)
      .select("id");
    if (error) {
      return recusa(error, "Não foi possível salvar a origem.");
    }
    if (!data || data.length === 0) {
      return { ok: false, error: ORIGEM_SUMIU };
    }
    await auditar(supabase, guarda, "editou_regra_de_origem", atual.id);
    revalidar();
    return aviso ? { ok: true, id: atual.id, aviso } : { ok: true, id: atual.id };
  }

  // Codigo unico por clinica (indice em upper(token)): colisao 23505 tenta
  // de novo com outro codigo, ate 3 vezes.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = comCodigo ? gerarToken(sorteio).toUpperCase() : null;
    const { data, error } = await supabase
      .from("campaign_link")
      .insert({ clinic_id: guarda.clinicId, token: codigo, ...campos })
      .select("id")
      .single();
    if (!error && data) {
      const id = (data as { id: string }).id;
      await auditar(supabase, guarda, "criou_regra_de_origem", id);
      revalidar();
      return aviso
        ? { ok: true, id, codigo, aviso }
        : { ok: true, id, codigo };
    }
    if (error?.code === "23505" && codigo !== null) {
      continue;
    }
    return recusa(
      error ?? {},
      "Não foi possível criar a origem.",
    );
  }
  return {
    ok: false,
    error: "Não foi possível gerar um código único. Tente de novo.",
  };
}

export async function ativarRegraDeOrigemAction(
  entrada: unknown,
): Promise<ResultadoDaOrigem> {
  const guarda = await exigirGestao();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const parsed = idSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Origem inválida." };
  }
  const supabase = await createClient();
  const origens = await lerOrigens(supabase, guarda.clinicId);
  if (!origens) {
    return { ok: false, error: LEITURA_FALHOU };
  }
  const atual = origens.find((origem) => origem.id === parsed.data.id);
  if (!atual) {
    return { ok: false, error: ORIGEM_SUMIU };
  }
  if (atual.ativa) {
    return { ok: true, id: atual.id };
  }
  const outra = origemComAMesmaMensagem(atual.mensagem, origens, atual.id);
  if (outra) {
    return {
      ok: false,
      error: `${recusaDaMensagemRepetida(outra.nome)} Desative a outra antes de ativar esta.`,
    };
  }
  if (
    origens.filter((origem) => origem.ativa).length >= LIMITE_DE_ORIGENS_ATIVAS
  ) {
    return { ok: false, error: recusaDoLimite("ativar") };
  }

  const { data, error } = await supabase
    .from("campaign_link")
    .update({ active: true })
    .eq("clinic_id", guarda.clinicId)
    .eq("id", atual.id)
    .eq("active", false)
    .select("id");
  if (error) {
    return recusa(error, "Não foi possível ativar a origem.", "ativar");
  }
  if (!data || data.length === 0) {
    return { ok: false, error: ORIGEM_SUMIU };
  }
  await auditar(supabase, guarda, "ativou_regra_de_origem", atual.id);
  revalidar();
  const aviso = avisoDasPalavrasRepetidas(
    palavrasEmOutraOrigem(atual.palavrasChave, origens, atual.id),
  );
  return aviso ? { ok: true, id: atual.id, aviso } : { ok: true, id: atual.id };
}

export async function desativarRegraDeOrigemAction(
  entrada: unknown,
): Promise<ResultadoDaOrigem> {
  const guarda = await exigirGestao();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const parsed = idSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Origem inválida." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_link")
    .update({ active: false })
    .eq("clinic_id", guarda.clinicId)
    .eq("id", parsed.data.id)
    .eq("active", true)
    .select("id");
  if (error) {
    return recusa(error, "Não foi possível desativar a origem.");
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Esta origem já estava desativada. Recarregue a página.",
    };
  }
  await auditar(supabase, guarda, "desativou_regra_de_origem", parsed.data.id);
  revalidar();
  return { ok: true, id: parsed.data.id };
}

export async function excluirRegraDeOrigemAction(
  entrada: unknown,
): Promise<ResultadoDaOrigem> {
  const guarda = await exigirGestao();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const parsed = idSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Origem inválida." };
  }
  const supabase = await createClient();
  // O contato guarda a origem gravada (canal, origem, detalhe, campanha e o
  // metodo), nunca o id da regra: excluir nao muda lead nenhum. O codigo
  // excluido deixa de ser reservado (aceito no contrato).
  const { data, error } = await supabase
    .from("campaign_link")
    .delete()
    .eq("clinic_id", guarda.clinicId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    return recusa(error, "Não foi possível excluir a origem.");
  }
  if (!data || data.length === 0) {
    return { ok: false, error: ORIGEM_SUMIU };
  }
  await auditar(supabase, guarda, "excluiu_regra_de_origem", parsed.data.id);
  revalidar();
  return { ok: true, id: parsed.data.id };
}
