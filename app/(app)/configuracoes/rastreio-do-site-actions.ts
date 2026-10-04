"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// Rastreio do site (F1 do Google, aba Anuncios do Google de Configuracoes):
// ligar e desligar, e gerar chave nova. Contrato do banco na migration
// 20261005100000_clique_do_site.sql.
//
// TUDO PELA SESSAO (a RLS e a funcao conferem o papel no banco): a policy de
// rastreio_do_site e de administrador e gestor ativos, com user_can_write; a
// sessao tem grant de INSERT so em (clinic_id, ativo) e de UPDATE so em
// (ativo). A chave nasce no banco e so troca por trocar_chave_do_rastreio.
//
// NUNCA upsert: o ON CONFLICT DO UPDATE do PostgREST grava clinic_id, que
// nao tem grant de UPDATE, e o banco responde 42501. Por isso ligar e
// "update; se nao havia linha, insert; se o insert bater em 23505 (outra
// aba criou ao mesmo tempo), update de novo".
//
// A chave e publica (vai no HTML do site da clinica), mas nada daqui vai
// para log: so o codigo do erro e a clinica.
//
// Guarda local: toda funcao exportada de um arquivo "use server" vira
// endpoint, entao cada uma confere o papel por si.

export type ResultadoDoRastreio = { ok: true } | { ok: false; error: string };

export type ResultadoDaChaveNova =
  { ok: true; chave: string } | { ok: false; error: string };

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
} as const;

/** O formato da chave do banco (check de rastreio_do_site). */
const CHAVE_VALIDA = /^[0-9a-f]{20}$/;

const alternarSchema = z.object({ ligar: z.boolean() }).strict();

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
