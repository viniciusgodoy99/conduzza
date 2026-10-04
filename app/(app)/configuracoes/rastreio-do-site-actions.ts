"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { frasesDoRastreioSchema } from "@/lib/domain/rastreio-do-site";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// Rastreio do site (F1 do Google, aba Anuncios do Google de Configuracoes):
// ligar e desligar, gerar chave nova e salvar as frases do botao sem texto
// pronto. Contrato do banco nas migrations 20261005100000_clique_do_site.sql
// e 20261005110000_frases_do_rastreio.sql.
//
// TUDO PELA SESSAO (a RLS e a funcao conferem o papel no banco): a policy de
// rastreio_do_site e de administrador e gestor ativos, com user_can_write; a
// sessao tem grant de INSERT so em (clinic_id, ativo) e de UPDATE so em
// (ativo, frases). A chave nasce no banco e so troca por
// trocar_chave_do_rastreio.
//
// NUNCA upsert: o ON CONFLICT DO UPDATE do PostgREST grava clinic_id, que
// nao tem grant de UPDATE, e o banco responde 42501. Por isso ligar e
// "update; se nao havia linha, insert; se o insert bater em 23505 (outra
// aba criou ao mesmo tempo), update de novo". As frases seguem o mesmo
// caminho, com a linha nova criada DESLIGADA (insert com frases da 42501).
//
// A chave e publica (vai no HTML do site da clinica), mas nada daqui vai
// para log: so o codigo do erro, a clinica e, nas frases, a contagem. O
// texto das frases tambem nao vai para log nem para a trilha.
//
// Guarda local: toda funcao exportada de um arquivo "use server" vira
// endpoint, entao cada uma confere o papel por si.

export type ResultadoDoRastreio = { ok: true } | { ok: false; error: string };

export type ResultadoDaChaveNova =
  { ok: true; chave: string } | { ok: false; error: string };

/** As frases como ficaram gravadas (aparadas pelo schema do rastreio). */
export type ResultadoDasFrases =
  { ok: true; frases: string[] } | { ok: false; error: string };

const TEXTOS = {
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  semPermissao:
    "Somente administradores e gestores alteram o rastreio do site.",
  dadosInvalidos: "Dados inválidos. Recarregue a página e tente de novo.",
  perfilNaoAltera: "Seu perfil não altera o rastreio do site.",
  naoAlterou: "Não foi possível alterar o rastreio do site. Tente de novo.",
  perfilNaoTroca:
    "Seu perfil não gera chave nova para o rastreio do site. A chave atual continua valendo.",
  chaveNaoTrocada:
    "Não foi possível gerar a chave nova. A chave atual continua valendo.",
  perfilNaoAlteraFrases:
    "Seu perfil não altera as frases do rastreio do site. As frases atuais continuam valendo.",
  frasesNaoSalvas:
    "Não foi possível salvar as frases. As frases atuais continuam valendo. Tente de novo.",
  frasesForaDaRegra:
    "Alguma frase não foi aceita. Confira as frases e tente de novo.",
} as const;

/** O formato da chave do banco (check de rastreio_do_site). */
const CHAVE_VALIDA = /^[0-9a-f]{20}$/;

const alternarSchema = z.object({ ligar: z.boolean() }).strict();

// As regras sao as do modulo do rastreio (as mesmas dos checks do banco):
// apara cada frase, de 1 a 5, ate 300 caracteres, sem quebra de linha,
// colchetes nem o sinal #. A tela confere com o mesmo schema antes de
// mandar, entao chegar aqui fora da regra e raro (outra aba, versao velha).
const salvarFrasesSchema = z
  .object({ frases: frasesDoRastreioSchema })
  .strict();

/**
 * A primeira regra que a entrada quebrou, no texto do schema do rastreio,
 * com o numero da frase quando o problema e numa frase so. Formato fora do
 * esperado (sem a lista, campo a mais): o texto de dados invalidos.
 */
function textoDaEntradaDasFrases(error: z.ZodError): string {
  const problema = error.issues[0];
  // Tipo errado (texto no lugar da lista, numero no lugar da frase) e campo
  // a mais nao sao erro de quem digitou: o texto do Zod e tecnico.
  if (!problema || problema.code === "invalid_type") {
    return TEXTOS.dadosInvalidos;
  }
  const [campo, indice] = problema.path;
  if (campo !== "frases") {
    return TEXTOS.dadosInvalidos;
  }
  if (typeof indice === "number") {
    return `Frase ${indice + 1}: ${problema.message}`;
  }
  return problema.path.length === 1 ? problema.message : TEXTOS.dadosInvalidos;
}

type Guarda = { userId: string; clinicId: string };

async function requireGestorOuAdmin(): Promise<Guarda | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: TEXTOS.sessaoExpirada };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error: permissionHint(role, "configuracoes") ?? TEXTOS.semPermissao,
    };
  }
  return { userId: context.userId, clinicId: context.active.clinicId };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function auditar(
  supabase: Supabase,
  guarda: Guarda,
  action: string,
): Promise<void> {
  // Sem a chave: so quem, o que e de qual clinica. Melhor esforco, como as
  // demais trilhas de Configuracoes.
  await supabase.from("audit_log").insert({
    clinic_id: guarda.clinicId,
    user_id: guarda.userId,
    action,
    entity: "rastreio_do_site",
    entity_id: guarda.clinicId,
  });
}

type ErroDoBanco = { code?: string } | null;

function textoDoErro(error: ErroDoBanco, semPermissao: string, outro: string) {
  return error?.code === "42501" ? semPermissao : outro;
}

/**
 * Liga ou desliga o rastreio do site. Ligar pela primeira vez cria a linha
 * (a chave nasce no banco); desligar sem linha nao tem o que desligar.
 */
export async function alternarRastreioDoSiteAction(
  entrada: unknown,
): Promise<ResultadoDoRastreio> {
  const guarda = await requireGestorOuAdmin();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const parsed = alternarSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const ligar = parsed.data.ligar;
  const supabase = await createClient();

  // .select() porque a RLS filtra o UPDATE sem erro: zero linhas quer dizer
  // "nao ha linha" (a guarda ja barrou quem nao e da gestao).
  const atualizar = () =>
    supabase
      .from("rastreio_do_site")
      .update({ ativo: ligar })
      .eq("clinic_id", guarda.clinicId)
      .select("clinic_id");

  const falhou = (error: ErroDoBanco): ResultadoDoRastreio => {
    log.warn("rastreio_do_site_nao_alterado", {
      clinic_id: guarda.clinicId,
      error_code: error?.code ?? null,
    });
    return {
      ok: false,
      error: textoDoErro(error, TEXTOS.perfilNaoAltera, TEXTOS.naoAlterou),
    };
  };

  const primeira = await atualizar();
  if (primeira.error) {
    return falhou(primeira.error);
  }
  let mudou = (primeira.data ?? []).length > 0;

  if (!mudou && ligar) {
    const { error: erroDaCriacao } = await supabase
      .from("rastreio_do_site")
      .insert({ clinic_id: guarda.clinicId, ativo: true });
    if (!erroDaCriacao) {
      mudou = true;
    } else if (erroDaCriacao.code === "23505") {
      // Criacao simultanea (outra aba ou outra pessoa da gestao): a linha
      // existe agora, entao o update acha.
      const segunda = await atualizar();
      if (segunda.error) {
        return falhou(segunda.error);
      }
      if ((segunda.data ?? []).length === 0) {
        return falhou(null);
      }
      mudou = true;
    } else {
      return falhou(erroDaCriacao);
    }
  }

  if (mudou) {
    await auditar(
      supabase,
      guarda,
      ligar ? "ligou_rastreio_do_site" : "desligou_rastreio_do_site",
    );
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * Gera uma chave nova (a funcao do banco confere administrador ou gestor
 * ativo e cria a linha desligada se ela nao existir). A linha que esta no
 * site para de valer na hora; os cliques ja recebidos continuam valendo.
 */
export async function trocarChaveDoRastreioAction(): Promise<ResultadoDaChaveNova> {
  const guarda = await requireGestorOuAdmin();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trocar_chave_do_rastreio", {
    p_clinic_id: guarda.clinicId,
  });
  if (error || typeof data !== "string" || !CHAVE_VALIDA.test(data)) {
    log.warn("rastreio_do_site_chave_nao_trocada", {
      clinic_id: guarda.clinicId,
      error_code: error?.code ?? null,
    });
    return {
      ok: false,
      error: textoDoErro(error, TEXTOS.perfilNaoTroca, TEXTOS.chaveNaoTrocada),
    };
  }
  await auditar(supabase, guarda, "trocou_chave_do_rastreio");
  revalidatePath("/configuracoes");
  return { ok: true, chave: data };
}

function textoDoErroDasFrases(error: ErroDoBanco): string {
  if (error?.code === "42501") {
    return TEXTOS.perfilNaoAlteraFrases;
  }
  // 23514: check rastreio_do_site_frases_* (o schema daqui ja confere as
  // mesmas regras; so chega aqui se o banco e o modulo se desencontrarem).
  if (error?.code === "23514") {
    return TEXTOS.frasesForaDaRegra;
  }
  return TEXTOS.frasesNaoSalvas;
}

/**
 * Salva as frases que o script do site poe antes do codigo quando o botao do
 * WhatsApp nao tem texto pronto (de 1 a 5; com mais de uma, o script sorteia
 * uma por clique). O site busca as frases pela chave a cada visita do
 * Google: trocar aqui nao exige colar a linha de novo.
 *
 * So o UPDATE de frases (o grant da sessao e por coluna: junto com chave ou
 * clinic_id, o banco recusa a gravacao inteira). Sem linha, cria a linha
 * DESLIGADA (insert so de clinic_id e ativo, como o ligar) e grava as frases
 * por update; 23505 no insert e outra aba que criou ao mesmo tempo, entao o
 * update de novo acha. A RLS filtra o UPDATE sem erro: zero linhas no fim
 * quer dizer sem permissao (recepcao, leitura, pendente, outra clinica).
 *
 * A trilha leva so quem, o que e de qual clinica; o log de sucesso leva a
 * contagem. O texto das frases nao vai para nenhum dos dois.
 */
export async function salvarFrasesDoRastreioAction(
  entrada: unknown,
): Promise<ResultadoDasFrases> {
  const guarda = await requireGestorOuAdmin();
  if ("error" in guarda) {
    return { ok: false, error: guarda.error };
  }
  const parsed = salvarFrasesSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntradaDasFrases(parsed.error) };
  }
  const frases = parsed.data.frases;
  const supabase = await createClient();

  const atualizar = () =>
    supabase
      .from("rastreio_do_site")
      .update({ frases })
      .eq("clinic_id", guarda.clinicId)
      .select("clinic_id");

  const falhou = (error: ErroDoBanco): ResultadoDasFrases => {
    log.warn("rastreio_do_site_frases_nao_salvas", {
      clinic_id: guarda.clinicId,
      error_code: error?.code ?? null,
    });
    return { ok: false, error: textoDoErroDasFrases(error) };
  };

  // A linha existe (acabou de nascer ou outra aba criou) e o UPDATE continua
  // sem linha: a RLS filtrou, entao e permissao.
  const semLinha = (): ResultadoDasFrases => {
    log.warn("rastreio_do_site_frases_nao_salvas", {
      clinic_id: guarda.clinicId,
      error_code: null,
      status: "sem_linha",
    });
    return { ok: false, error: TEXTOS.perfilNaoAlteraFrases };
  };

  const primeira = await atualizar();
  if (primeira.error) {
    return falhou(primeira.error);
  }
  if ((primeira.data ?? []).length === 0) {
    const { error: erroDaCriacao } = await supabase
      .from("rastreio_do_site")
      .insert({ clinic_id: guarda.clinicId, ativo: false });
    if (erroDaCriacao && erroDaCriacao.code !== "23505") {
      return falhou(erroDaCriacao);
    }
    const segunda = await atualizar();
    if (segunda.error) {
      return falhou(segunda.error);
    }
    if ((segunda.data ?? []).length === 0) {
      return semLinha();
    }
  }

  await auditar(supabase, guarda, "alterou_frases_do_rastreio");
  log.info("rastreio_do_site_frases_salvas", {
    clinic_id: guarda.clinicId,
    count: frases.length,
  });
  revalidatePath("/configuracoes");
  return { ok: true, frases };
}
