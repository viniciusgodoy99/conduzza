"use server";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import { canEdit } from "@/lib/domain/permissions";
import {
  CORPO_DO_MENU_APOS_MIDIA,
  MENU_CONFIRMACAO,
} from "@/lib/domain/textos-padrao";
import { carregarInstancia } from "@/lib/integrations/whatsapp/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 7 (Automacoes). Mesmo guard da regua na Tela 2:
// configuracao de automacao e assunto de administrador e gestor (policy
// "gestao escreve passos" no banco; a checagem aqui existe porque esconder
// botao nao protege nada, regra 3.4).
//
// Cliente de SESSAO sempre: a RLS decide, e a prova automatizada dela ja
// existe em tests/rls/reguas.test.ts (gestor edita texto do passo, recepcao
// recebe 42501).

export type AutomacoesActionResult = {
  ok: boolean;
  error?: string;
  /** Deu certo, mas com uma ressalva que a clinica precisa ouvir. */
  aviso?: string;
};

async function requireAutomacoes() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "automacoes")) {
    return {
      error:
        "Somente administradores e gestores alteram as automações." as const,
    };
  }
  return { context, clinicId: context.active.clinicId };
}

const textoSchema = z.object({
  cadence_step_id: z.uuid(),
  // 2000 caracteres cobre com folga qualquer texto de recepcao; o corpo cru
  // vai para o WhatsApp, entao tamanho desgovernado seria mensagem quebrada.
  // Vazio e permitido SOMENTE quando o passo tem anexo (a mensagem vira so a
  // midia); a conferencia vive no corpo da action.
  fixed_body: z.string().trim().max(2000),
});

export async function salvarTextoDoPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = textoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Escreva a mensagem antes de salvar (até 2000 caracteres).",
    };
  }

  const supabase = await createClient();
  if (parsed.data.fixed_body === "") {
    // Passo sem texto so existe quando ha anexo: sem os dois, o executor
    // pularia o toque como passo_sem_conteudo e a regua mentiria na tela.
    const { data: atual } = await supabase
      .from("cadence_step")
      .select("media_path")
      .eq("clinic_id", guard.clinicId)
      .eq("id", parsed.data.cadence_step_id)
      .maybeSingle();
    if (!atual?.media_path) {
      return {
        ok: false,
        error:
          "Escreva a mensagem, ou anexe uma mídia antes de deixar o texto vazio.",
      };
    }
  }
  // Escrita CONDICIONAL contra a corrida com removerAnexo (achado da
  // revisao de 19/09): esvaziar o texto so passa se o anexo AINDA existir
  // no instante do update, nao so no da conferencia acima.
  let query = supabase
    .from("cadence_step")
    .update({
      fixed_body: parsed.data.fixed_body === "" ? null : parsed.data.fixed_body,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id);
  if (parsed.data.fixed_body === "") {
    query = query.not("media_path", "is", null);
  }
  const { data: linhas, error } = await query.select("id");
  if (error || !linhas || linhas.length === 0) {
    return {
      ok: false,
      error:
        parsed.data.fixed_body === ""
          ? "Escreva a mensagem, ou anexe uma mídia antes de deixar o texto vazio."
          : "Não foi possível salvar o texto.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "salvou_texto_do_passo",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Anexo do passo (decisao do dono em 19/09/2026): UM anexo por passo (foto,
// audio ou arquivo), texto opcional quando ha anexo. O arquivo vive no balde
// midia-de-regua em <clinic_id>/<cadence_step_id>; o executor copia para
// midia-conversas na hora do envio, em nome da message nova.

// Mesmo teto da Server Action de anexo do Inbox: a plataforma recusa corpo
// acima de ~4,5 MB, e 3,8 MB deixa folga para o overhead do FormData.
const TETO_DO_ANEXO_BYTES = 3_800_000;

const MIMES_DO_ANEXO: Record<string, "image" | "audio" | "document"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio",
  "application/pdf": "document",
};

export async function salvarAnexoDoPassoAction(
  cadenceStepId: unknown,
  formulario: FormData,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = z.uuid().safeParse(cadenceStepId);
  if (!parsedId.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const arquivo = formulario.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, error: "Escolha um arquivo para anexar." };
  }
  const tipo = MIMES_DO_ANEXO[arquivo.type];
  if (!tipo) {
    return {
      ok: false,
      error:
        "Formato não aceito. Use foto (JPG, PNG, WebP, GIF), áudio (MP3, M4A, OGG) ou PDF.",
    };
  }
  if (arquivo.size > TETO_DO_ANEXO_BYTES) {
    return {
      ok: false,
      error: "O arquivo passa de 3,8 MB. Reduza e tente de novo.",
    };
  }

  // O passo precisa existir NA CLINICA da sessao (a RLS ja recorta, mas o
  // caminho do objeto usa clinic_id e nao pode nascer de palpite).
  const supabase = await createClient();
  const { data: passo } = await supabase
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!passo) {
    return { ok: false, error: "Mensagem não encontrada." };
  }

  const caminho = `${guard.clinicId}/${parsedId.data}`;
  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const admin = createAdminClient();
  const { error: erroUpload } = await admin.storage
    .from("midia-de-regua")
    .upload(caminho, bytes, {
      contentType: arquivo.type,
      upsert: true,
      cacheControl: "0",
    });
  if (erroUpload) {
    return {
      ok: false,
      error: "Não foi possível guardar o arquivo. Tente de novo.",
    };
  }

  const { data: linhas, error } = await supabase
    .from("cadence_step")
    .update({
      media_path: caminho,
      media_type: tipo,
      media_mimetype: arquivo.type,
      media_filename: tipo === "document" ? arquivo.name : null,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsedId.data)
    .select("id");
  if (error || !linhas || linhas.length === 0) {
    await admin.storage.from("midia-de-regua").remove([caminho]);
    return { ok: false, error: "Não foi possível salvar o anexo." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "anexou_midia_no_passo",
    entity: "cadence_step",
    entity_id: parsedId.data,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function removerAnexoDoPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_step_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: passo } = await supabase
    .from("cadence_step")
    .select("fixed_body, media_path")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .maybeSingle();
  if (!passo) {
    return { ok: false, error: "Mensagem não encontrada." };
  }
  if (!passo.media_path) {
    return { ok: true };
  }
  if (!passo.fixed_body || !(passo.fixed_body as string).trim()) {
    return {
      ok: false,
      error:
        "Escreva o texto antes de remover o anexo, ou exclua o passo inteiro.",
    };
  }

  // Mesmo desenho condicional do salvarTexto: remover o anexo so passa se
  // o TEXTO ainda existir no instante do update (a corrida contraria
  // deixaria o passo sem conteudo nenhum).
  const { data: linhasDoAnexo, error } = await supabase
    .from("cadence_step")
    .update({
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .not("fixed_body", "is", null)
    .select("id");
  if (error || !linhasDoAnexo || linhasDoAnexo.length === 0) {
    return {
      ok: false,
      error:
        "Escreva o texto antes de remover o anexo, ou exclua o passo inteiro.",
    };
  }
  // Objeto depois da linha: se a remocao do objeto falhar, sobra um orfao
  // inofensivo (sem media_path ninguem o referencia; a policy exige o passo).
  await createAdminClient()
    .storage.from("midia-de-regua")
    .remove([passo.media_path as string]);

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "removeu_midia_do_passo",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Excecoes e passos (fase 2 da 4.8). Tudo pela SESSAO: a policy "gestao
// escreve reguas/passos" decide, e o planner ja resolve a regua mais
// especifica sozinho (procedimento vence historico, que vence a padrao).

const OFFSET_MAXIMO_MIN = 43_200; // 30 dias: alem disso e erro de digitacao

const excecaoSchema = z.discriminatedUnion("base", [
  z.object({ base: z.literal("procedimento"), procedure_id: z.uuid() }),
  z.object({
    base: z.literal("reforcada"),
    no_show_threshold: z.number().int().min(1).max(10),
  }),
]);

export async function criarReguaDeExcecaoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = excecaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  // A excecao NASCE como copia da regua padrao da propria clinica (janela e
  // passos): conteudo da clinica, nada inventado. Nasce DESLIGADA.
  const { data: padrao } = await supabase
    .from("cadence")
    .select("id, send_window_start, send_window_end, send_weekdays")
    .eq("clinic_id", guard.clinicId)
    .eq("kind", "confirmacao")
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  if (!padrao) {
    return {
      ok: false,
      error: "A clínica ainda não tem a régua de confirmação principal.",
    };
  }

  let nome = "Confirmação reforçada";
  if (parsed.data.base === "procedimento") {
    const { data: procedimento } = await supabase
      .from("procedure")
      .select("name")
      .eq("clinic_id", guard.clinicId)
      .eq("id", parsed.data.procedure_id)
      .maybeSingle();
    if (!procedimento) {
      return { ok: false, error: "Procedimento não encontrado." };
    }
    nome = `Confirmação: ${procedimento.name as string}`;
  }

  const { data: nova, error } = await supabase
    .from("cadence")
    .insert({
      clinic_id: guard.clinicId,
      kind: "confirmacao",
      name: nome,
      procedure_id:
        parsed.data.base === "procedimento" ? parsed.data.procedure_id : null,
      for_no_show_history: parsed.data.base === "reforcada",
      no_show_threshold:
        parsed.data.base === "reforcada" ? parsed.data.no_show_threshold : 2,
      send_window_start: padrao.send_window_start,
      send_window_end: padrao.send_window_end,
      send_weekdays: padrao.send_weekdays,
      active: false,
    })
    .select("id")
    .single();
  if (error || !nova) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? parsed.data.base === "procedimento"
            ? "Já existe uma régua para este procedimento."
            : "Já existe uma régua reforçada nesta clínica."
          : "Não foi possível criar a régua.",
    };
  }

  // Copia os passos da padrao, ANEXO INCLUSO (achado da revisao de 19/09:
  // copiar so o texto transformava passo so-anexo em passo vazio que nunca
  // envia, em silencio). O insert em lote e ATOMICO no PostgREST: falhou,
  // nao entrou NENHUM passo, a regua recem-criada e desfeita e a clinica
  // ouve a verdade. A copia dos ARQUIVOS vem depois das linhas: se um
  // arquivo falhar, o passo copiado fica sem anexo, e um passo que ficaria
  // sem conteudo nenhum e removido com aviso, nunca deixado como casca.
  const { data: passos } = await supabase
    .from("cadence_step")
    .select(
      "offset_minutes, fixed_body, media_path, media_type, media_mimetype, media_filename",
    )
    .eq("clinic_id", guard.clinicId)
    .eq("cadence_id", padrao.id as string)
    .order("offset_minutes");
  let avisoDaCopia: string | undefined;
  if (passos && passos.length > 0) {
    const { data: copiados, error: erroCopia } = await supabase
      .from("cadence_step")
      .insert(
        passos.map((passo) => ({
          clinic_id: guard.clinicId,
          cadence_id: nova.id as string,
          offset_minutes: passo.offset_minutes as number,
          fixed_body: passo.fixed_body as string | null,
        })),
      )
      .select("id, offset_minutes");
    if (erroCopia || !copiados) {
      await supabase
        .from("cadence")
        .delete()
        .eq("clinic_id", guard.clinicId)
        .eq("id", nova.id as string);
      return {
        ok: false,
        error:
          "Não foi possível copiar as mensagens da régua principal. Tente de novo.",
      };
    }
    const adminStorage = createAdminClient();
    for (const original of passos) {
      if (!original.media_path) {
        continue;
      }
      const copiado = copiados.find(
        (c) => c.offset_minutes === original.offset_minutes,
      );
      if (!copiado) {
        continue;
      }
      const destino = `${guard.clinicId}/${copiado.id as string}`;
      const { data: bytesDoAnexo } = await adminStorage.storage
        .from("midia-de-regua")
        .download(original.media_path as string);
      const copiouArquivo = bytesDoAnexo
        ? !(
            await adminStorage.storage
              .from("midia-de-regua")
              .upload(destino, Buffer.from(await bytesDoAnexo.arrayBuffer()), {
                contentType:
                  (original.media_mimetype as string | null) ??
                  "application/octet-stream",
                upsert: true,
                cacheControl: "0",
              })
          ).error
        : false;
      if (copiouArquivo) {
        await supabase
          .from("cadence_step")
          .update({
            media_path: destino,
            media_type: original.media_type,
            media_mimetype: original.media_mimetype,
            media_filename: original.media_filename,
          })
          .eq("clinic_id", guard.clinicId)
          .eq("id", copiado.id as string);
      } else if (!original.fixed_body) {
        // Sem o arquivo e sem texto o passo seria uma casca que nunca envia:
        // melhor nao existir, e a clinica fica sabendo.
        await supabase
          .from("cadence_step")
          .delete()
          .eq("clinic_id", guard.clinicId)
          .eq("id", copiado.id as string);
        avisoDaCopia =
          "Um dos passos da régua principal é só anexo e o arquivo não pôde ser copiado: ele ficou de fora. Anexe de novo na régua nova.";
      } else {
        avisoDaCopia =
          "O texto veio, mas um anexo não pôde ser copiado. Anexe de novo na régua nova.";
      }
    }
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou_regua_de_excecao",
    entity: "cadence",
    entity_id: nova.id as string,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true, ...(avisoDaCopia ? { aviso: avisoDaCopia } : {}) };
}

const limiarSchema = z.object({
  cadence_id: z.uuid(),
  // Mesmo recorte da criacao: 1 a 10 faltas (o banco confere >= 1).
  no_show_threshold: z.number().int().min(1).max(10),
});

/**
 * Muda o numero de faltas da regua reforcada depois de criada (achado 53).
 * Antes o numero so mudava excluindo e recriando a regua, o que apaga os
 * textos, os anexos e o historico de envios. O filtro for_no_show_history
 * garante que so a reforcada aceita o numero: nas outras ele nao tem efeito.
 */
export async function salvarLimiarDaReforcadaAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = limiarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Informe um número de faltas de 1 a 10." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cadence")
    .update({ no_show_threshold: parsed.data.no_show_threshold })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_id)
    .eq("kind", "confirmacao")
    .eq("for_no_show_history", true)
    .select("id");
  if (error) {
    return { ok: false, error: "Não foi possível salvar o número de faltas." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Régua reforçada não encontrada." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "mudou_limiar_da_regua_reforcada",
    entity: "cadence",
    entity_id: parsed.data.cadence_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function excluirReguaAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: regua } = await supabase
    .from("cadence")
    .select("id, kind, procedure_id, for_no_show_history")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_id)
    .maybeSingle();
  if (!regua) {
    return { ok: false, error: "Régua não encontrada." };
  }
  const ehPadrao =
    regua.procedure_id === null && regua.for_no_show_history === false;
  if (regua.kind === "confirmacao" && ehPadrao) {
    return {
      ok: false,
      error:
        "A régua principal de confirmação não pode ser excluída. Desligue o interruptor para pausar.",
    };
  }
  if (regua.kind === "pos_falta") {
    return {
      ok: false,
      error:
        "A régua de recuperação não pode ser excluída. Desligue o interruptor para pausar.",
    };
  }

  // Antes do cascade levar os passos, anotar os anexos para limpar o balde.
  const { data: passosComAnexo } = await supabase
    .from("cadence_step")
    .select("media_path")
    .eq("clinic_id", guard.clinicId)
    .eq("cadence_id", parsed.data.cadence_id)
    .not("media_path", "is", null);

  // O cascade apaga os passos E as cadence_run deles, inclusive as ja
  // enviadas (FK ON DELETE CASCADE): o historico de envios da regua some e o
  // job de uma run pendente termina como run_inexistente no executor. Por
  // isso a tela pergunta antes e diz o que se perde (achado 48).
  const { error } = await supabase
    .from("cadence")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_id);
  if (error) {
    return { ok: false, error: "Não foi possível excluir a régua." };
  }
  const caminhos = (passosComAnexo ?? [])
    .map((p) => p.media_path as string | null)
    .filter((c): c is string => c !== null);
  if (caminhos.length > 0) {
    // Melhor esforco: a regua ja se foi; objeto orfao nao vaza (policy exige
    // cadence_step vivo para leitura).
    await createAdminClient().storage.from("midia-de-regua").remove(caminhos);
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "excluiu_regua",
    entity: "cadence",
    entity_id: parsed.data.cadence_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// Sinal do offset por tipo de regua: confirmacao conta ANTES da consulta
// (negativo); pos_falta conta DEPOIS da falta (zero ou positivo). O tipo vem
// do banco, nunca do cliente.
async function validarOffsetParaRegua(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  cadenceId: string,
  offsetMinutes: number,
): Promise<string | null> {
  const { data: regua } = await supabase
    .from("cadence")
    .select("kind")
    .eq("clinic_id", clinicId)
    .eq("id", cadenceId)
    .maybeSingle();
  if (!regua) {
    return "Régua não encontrada.";
  }
  if (Math.abs(offsetMinutes) > OFFSET_MAXIMO_MIN) {
    return "O momento da mensagem precisa estar a até 30 dias do evento.";
  }
  if (regua.kind === "confirmacao" && offsetMinutes >= 0) {
    return "Na confirmação, a mensagem sai antes da consulta.";
  }
  if (regua.kind !== "confirmacao" && offsetMinutes < 0) {
    return "Nesta régua, a mensagem sai depois do evento.";
  }
  return null;
}

const passoNovoSchema = z.object({
  cadence_id: z.uuid(),
  offset_minutes: z.number().int(),
  fixed_body: z.string().trim().min(1).max(2000),
});

export async function criarPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = passoNovoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escreva a mensagem e escolha o momento." };
  }

  const supabase = await createClient();
  const recusa = await validarOffsetParaRegua(
    supabase,
    guard.clinicId,
    parsed.data.cadence_id,
    parsed.data.offset_minutes,
  );
  if (recusa) {
    return { ok: false, error: recusa };
  }

  const { data: novo, error } = await supabase
    .from("cadence_step")
    .insert({
      clinic_id: guard.clinicId,
      cadence_id: parsed.data.cadence_id,
      offset_minutes: parsed.data.offset_minutes,
      fixed_body: parsed.data.fixed_body,
    })
    .select("id")
    .single();
  if (error || !novo) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "Já existe uma mensagem neste momento."
          : "Não foi possível criar a mensagem.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou_passo_da_regua",
    entity: "cadence_step",
    entity_id: novo.id as string,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function salvarEsperaDoPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .object({ cadence_step_id: z.uuid(), offset_minutes: z.number().int() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: passo } = await supabase
    .from("cadence_step")
    .select("cadence_id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .maybeSingle();
  if (!passo) {
    return { ok: false, error: "Mensagem não encontrada." };
  }
  const recusa = await validarOffsetParaRegua(
    supabase,
    guard.clinicId,
    passo.cadence_id as string,
    parsed.data.offset_minutes,
  );
  if (recusa) {
    return { ok: false, error: recusa };
  }

  const { error } = await supabase
    .from("cadence_step")
    .update({ offset_minutes: parsed.data.offset_minutes })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Já existe uma mensagem neste momento."
          : "Não foi possível mudar o momento.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "mudou_momento_do_passo",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

export async function excluirPassoAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_step_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: removidos, error } = await supabase
    .from("cadence_step")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .select("id, media_path");
  if (error || !removidos || removidos.length === 0) {
    return { ok: false, error: "Não foi possível excluir a mensagem." };
  }
  // Limpeza do anexo orfao: melhor esforco, a exclusao do passo ja valeu.
  const caminhoDoAnexo = removidos[0]?.media_path as string | null;
  if (caminhoDoAnexo) {
    await createAdminClient()
      .storage.from("midia-de-regua")
      .remove([caminhoDoAnexo]);
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "excluiu_passo_da_regua",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  revalidatePath("/automacoes");
  revalidatePath("/confirmacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Follow-up de leads (fase 3 da 4.8): regua por etapa da jornada.

export async function criarReguaDeFollowupAction(
  input: unknown,
): Promise<AutomacoesActionResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .object({ trigger_stage: z.string().regex(/^[a-z0-9_]{1,40}$/) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escolha a etapa da jornada." };
  }

  const supabase = await createClient();
  const { data: etapa } = await supabase
    .from("funnel_stage_def")
    .select("nome, papel")
    .eq("clinic_id", guard.clinicId)
    .eq("chave", parsed.data.trigger_stage)
    .maybeSingle();
  if (!etapa) {
    return { ok: false, error: "Esta etapa não existe na jornada." };
  }
  // Follow-up de quem foi PERDIDO e outra conversa (reativacao, fora do
  // escopo): mandar mensagem de acompanhamento para quem pediu para parar de
  // ser acompanhado seria spam.
  if (etapa.papel === "perdido") {
    return {
      ok: false,
      error: "A etapa de perda não recebe follow-up automático.",
    };
  }

  // Nasce DESLIGADA, sem janela e sem mensagens: o texto por etapa e decisao
  // da clinica, nada se inventa. Regua sem passos nao materializa nada.
  const { data: nova, error } = await supabase
    .from("cadence")
    .insert({
      clinic_id: guard.clinicId,
      kind: "followup",
      name: `Follow-up de ${etapa.nome as string}`,
      trigger_stage: parsed.data.trigger_stage,
      active: false,
    })
    .select("id")
    .single();
  if (error || !nova) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "Esta etapa já tem régua de follow-up."
          : "Não foi possível criar a régua.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou_regua_de_followup",
    entity: "cadence",
    entity_id: nova.id as string,
  });
  revalidatePath("/automacoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teste de envio (spec 7.7, fase 4 da 4.8): a mensagem renderizada com dados
// FICTICIOS sai para o PROPRIO numero da clinica, nunca para terceiro.
//
// Por que nao passa por job_queue nem cria message/conversa: ha um humano
// esperando na tela (a fila adicionaria ate 20s sem ganho de idempotencia,
// nao existe run) e contato/conversa da propria clinica poluiria Leads e
// Inbox. Consentimento nao se aplica: o destinatario e a clinica e o corpo
// so tem amostra ficticia, nenhum dado de paciente (regra 3.3 intacta).

export type TesteDeEnvioResult = AutomacoesActionResult & { aviso?: string };

export async function testarEnvioAction(
  input: unknown,
): Promise<TesteDeEnvioResult> {
  const guard = await requireAutomacoes();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ cadence_step_id: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: passo } = await supabase
    .from("cadence_step")
    .select(
      "fixed_body, media_path, media_type, media_mimetype, media_filename, cadence:cadence_id ( kind )",
    )
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.cadence_step_id)
    .maybeSingle();
  const kind = (
    (Array.isArray(passo?.cadence) ? passo?.cadence[0] : passo?.cadence) as {
      kind?: string;
    } | null
  )?.kind;
  if (!passo || !kind) {
    return { ok: false, error: "Mensagem não encontrada." };
  }
  const temTexto = Boolean(
    passo.fixed_body && (passo.fixed_body as string).trim(),
  );
  if (!temTexto && !passo.media_path) {
    return {
      ok: false,
      error: "Escreva o texto ou anexe uma mídia antes de testar.",
    };
  }

  const { data: clinica } = await supabase
    .from("clinic")
    .select("name, timezone")
    .eq("id", guard.clinicId)
    .single();

  // O numero da instancia e o status vem por admin client (a secret do
  // provedor nao tem policy), SO depois do guard de papel acima.
  const adminDb = createAdminClient();
  const { data: conta } = await adminDb
    .from("whatsapp_account")
    .select("connection_status, display_phone")
    .eq("clinic_id", guard.clinicId)
    .maybeSingle();
  if (conta?.connection_status !== "conectado" || !conta.display_phone) {
    return {
      ok: false,
      error:
        "O WhatsApp da clínica precisa estar conectado para receber o teste. Confira em Configurações.",
    };
  }
  // O destino precisa SER um numero. Instancias pareadas antes da correcao
  // do parse guardavam o NOME do perfil em display_phone: mandar isso ao
  // provedor seria, no pior caso, mensagem para numero de terceiro extraido
  // dos digitos do nome (achado grave da revisao de 14/09/2026).
  const destino = (conta.display_phone as string).replace(/\D/g, "");
  if (destino.length < 8 || destino.length > 15) {
    return {
      ok: false,
      error:
        "O número da instância está desatualizado. Abra Configurações, aba WhatsApp, e atualize o estado da conexão antes de testar.",
    };
  }

  const amanha = new TZDate(
    Date.now() + 24 * 60 * 60_000,
    (clinica?.timezone as string) ?? "America/Fortaleza",
  );
  const corpo = !temTexto
    ? "Teste da régua"
    : `Teste da régua: ${renderizarModelo(passo.fixed_body as string, {
        nome: "Maria",
        clinica: (clinica?.name as string) ?? "sua clínica",
        data: format(amanha, "dd/MM/yyyy", { locale: ptBR }),
        hora: "14:00",
        profissional: "Dra. Exemplo",
        procedimento: "Consulta",
        preparo: "",
      }).trim()}`;

  const { provider, ref } = await carregarInstancia(adminDb, guard.clinicId);
  let resultado;
  if (passo.media_path) {
    // O teste envia a MIDIA REAL do passo: os bytes vem do balde de regua e
    // vao direto ao provedor (sem message, como todo o resto deste caminho).
    const download = await adminDb.storage
      .from("midia-de-regua")
      .download(passo.media_path as string);
    if (download.error || !download.data) {
      return {
        ok: false,
        error: "Não foi possível ler o anexo do passo. Anexe de novo e tente.",
      };
    }
    const base64 = Buffer.from(await download.data.arrayBuffer()).toString(
      "base64",
    );
    // Audio nao mostra legenda no WhatsApp; imagem e documento mostram. Com
    // audio e texto, o texto vai numa segunda mensagem (lib/jobs/regua.ts).
    const audioComTexto = passo.media_type === "audio" && temTexto;
    resultado = await provider.sendMedia(ref, destino, {
      tipo: passo.media_type as "image" | "audio" | "document",
      base64,
      mimetype: passo.media_mimetype as string,
      legenda: audioComTexto ? null : temTexto ? corpo : "Teste da régua",
      nomeDoArquivo: (passo.media_filename as string | null) ?? null,
    });
    if (resultado.ok && kind === "confirmacao") {
      // Mesma coreografia do envio real: a midia primeiro, os botoes depois.
      resultado = await provider.sendMenu(
        ref,
        destino,
        audioComTexto ? corpo : CORPO_DO_MENU_APOS_MIDIA,
        MENU_CONFIRMACAO,
      );
    } else if (resultado.ok && audioComTexto) {
      resultado = await provider.sendText(ref, destino, corpo);
    }
  } else {
    resultado =
      kind === "confirmacao"
        ? await provider.sendMenu(ref, destino, corpo, MENU_CONFIRMACAO)
        : await provider.sendText(ref, destino, corpo);
  }
  if (!resultado.ok) {
    return {
      ok: false,
      error:
        "O envio de teste não saiu. Confira a conexão do WhatsApp e tente de novo.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "testou_regua",
    entity: "cadence_step",
    entity_id: parsed.data.cadence_step_id,
  });
  return {
    ok: true,
    aviso:
      provider.name === "fake"
        ? "Canal de teste: nenhuma mensagem real saiu."
        : undefined,
  };
}
