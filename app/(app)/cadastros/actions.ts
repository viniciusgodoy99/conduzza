"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  CODIGO_CADASTRO_MUDOU,
  MENSAGEM_CADASTRO_MUDOU,
  MENSAGEM_CONVENIO_INATIVO,
} from "@/lib/domain/convenios-do-medico";
import {
  ITENS_POR_PACOTE_MAX,
  NOME_DO_PACOTE_MAX,
  problemaNosItens,
  SESSOES_POR_ITEM_MAX,
} from "@/lib/domain/pacotes";
import { canEdit } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 8 (Cadastros). Escrita e SO de administrador e
// gestor (matriz do brief secao 5; a RLS do banco confere de novo). Toda
// entrada passa por Zod; cliente de SESSAO (RLS aplica); mutacao relevante
// vai para audit_log; exclusao e sempre suave (active = false), porque
// apagar de verdade quebraria agendamentos historicos por FK.

/**
 * O que o Salvar de "Convenios que atende" mudou (ou mudaria, quando volta
 * pedindo confirmacao), lido do retorno da RPC
 * sincronizar_convenios_do_profissional e passado para camelCase. Satisfaz o
 * ResumoParaTexto de lib/domain/convenios-do-medico.ts (frasesDoResumoDos
 * Convenios e tituloDoAvisoDosConvenios leem direto daqui).
 */
export type ResumoDosConvenios = {
  /** Convenio novo e os procedimentos em que ele entrou (Coberto ou reativado) */
  entram: { insuranceId: string; procedureIds: string[] }[];
  /** Convenio que saiu e os procedimentos em que o vinculo foi desativado */
  saem: { insuranceId: string; procedureIds: string[] }[];
  /** Procedimentos que ele deixa de fazer (D3) */
  deixaDeFazer: string[];
  /** Consultas futuras nos vinculos que saem (continuam marcadas) */
  consultasFuturas: number;
  primeiraConsulta: string | null;
};

export type CadastroActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  // code 'consultas_no_periodo': nada foi gravado; ha consultas marcadas no
  // periodo afetado (ou, nos convenios do profissional, um procedimento que
  // ele deixa de fazer) e a tela precisa pedir confirmacao explicita (achado
  // 37; D3 e D4 de 02/10/2026). `motivo` diz qual confirmacao pedir.
  // code 'cadastro_mudou': a RPC recusou a aba parada (CZ409, D5); nada foi
  // gravado e a tela invalida o catalogo (aoMudar) para reabrir com o atual.
  code?: "consultas_no_periodo" | "cadastro_mudou";
  consultas?: number;
  primeiraConsulta?: string | null;
  /**
   * Com code 'consultas_no_periodo': "desativar" (profissional ativo para
   * inativo), "convenios" (Convenios que atende: reenviar com
   * confirmar_convenios) ou "vinculos" (Quem faz e convenios: reenviar com
   * extras.confirmar).
   */
  motivo?: "desativar" | "convenios" | "vinculos";
  /**
   * Uma parte foi gravada e a outra nao (ver `error`). Com `id`: a tela
   * guarda o id no formulario para o proximo Salvar editar em vez de criar.
   */
  parcial?: true;
  /** Convenios do profissional: o que entrou e saiu, ou o que pede confirmacao */
  convenios?: ResumoDosConvenios;
};

// Consultas nao canceladas dos profissionais que ainda nao terminaram e
// cruzam o periodo [inicio, fim). "Ainda nao terminaram" usa o instante
// atual (comparacao de instantes em UTC, sem dia civil envolvido). Erro de
// leitura volta como erro: nunca "zero consultas" falso.
async function contarConsultasNoPeriodo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  professionalIds: string[],
  inicio: string | null,
  fim: string | null,
): Promise<{ total: number; primeira: string | null } | null> {
  const agora = new Date().toISOString();
  const inicioEfetivo =
    inicio !== null && new Date(inicio) > new Date(agora) ? inicio : agora;
  let consulta = supabase
    .from("appointment")
    .select("starts_at", { count: "exact" })
    .eq("clinic_id", clinicId)
    .in("professional_id", professionalIds)
    .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
    .gt("ends_at", inicioEfetivo);
  if (fim !== null) {
    consulta = consulta.lt("starts_at", fim);
  }
  const { data, count, error } = await consulta
    .order("starts_at", { ascending: true })
    .limit(1);
  if (error) {
    return null;
  }
  const primeira = (data?.[0]?.starts_at as string | undefined) ?? null;
  return { total: count ?? 0, primeira };
}

async function requireEditor() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "cadastros")) {
    return {
      error:
        "Somente administradores e gestores alteram os cadastros." as const,
    };
  }
  return { context, clinicId: context.active.clinicId };
}

const idSchema = z.uuid();
const nomeSchema = z.string().trim().min(2).max(120);
const centavosSchema = z.number().int().min(0).max(100_000_000).nullable();

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
  });
}

// ---------------------------------------------------------------------------
// Profissionais e jornada
// ---------------------------------------------------------------------------

const profissionalSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  // Conselho de classe em campo LIVRE (spec 3.1): CRM, CRO, CREFITO, CRBM,
  // CRN ou vazio para esteticista. Nunca dropdown fechado.
  council_type: z.string().trim().max(20).nullable(),
  council_number: z.string().trim().max(30).nullable(),
  specialties: z.array(z.string().trim().min(2).max(60)).max(20),
  calendar_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  active: z.boolean(),
  // Desativar com consultas futuras so passa com confirmacao explicita.
  confirmar_consultas: z.boolean().optional(),
  // "Convenios que atende" (decisao do dono em 02/10/2026). AUSENTE = nao
  // mexe nos convenios (a tela so manda quando precisaSalvarConvenios diz
  // que sim, e um cliente antigo aberto durante a publicacao nao apaga
  // nada). Presente = a lista INTEIRA desejada, sem o Particular (implicito).
  insurance_ids: z
    .array(idSchema)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  // professional_insurance CRU de quando o modal abriu (abertura.gravados,
  // nunca os marcados com a cura): a RPC compara sob a trava e recusa a aba
  // parada com CZ409. Ausente = sem conferencia.
  insurance_ids_na_abertura: z.array(idSchema).max(200).optional(),
  // Tirar convenio com consulta futura (D4) ou que tira o profissional de
  // um procedimento (D3) so passa com confirmacao explicita.
  confirmar_convenios: z.boolean().optional(),
});

/** Retorno da RPC sincronizar_convenios_do_profissional (migration 20261002140000) */
const mudancaDoConvenioSchema = z.object({
  insurance_id: z.string(),
  procedure_ids: z.array(z.string()),
});
const retornoDosConveniosSchema = z.object({
  aplicado: z.boolean(),
  entram: z.array(mudancaDoConvenioSchema),
  saem: z.array(mudancaDoConvenioSchema),
  deixa_de_fazer: z.array(z.string()),
  consultas_futuras: z.number().int().min(0),
  primeira_consulta: z.string().nullable(),
});

const MENSAGENS_DOS_CONVENIOS: Record<string, string> = {
  "22023": MENSAGEM_CONVENIO_INATIVO,
  "23503": "Um convênio escolhido não é desta clínica.",
  "42501": "Somente administradores e gestores alteram os cadastros.",
  P0002: "Profissional não encontrado.",
};

const ERRO_DOS_CONVENIOS =
  "Não foi possível salvar os convênios do profissional.";

type SincroniaDosConvenios =
  | { ok: true; aplicado: boolean; resumo: ResumoDosConvenios }
  | { ok: false; error: string; code?: "cadastro_mudou" };

// Chama a RPC do lado do medico (SECURITY INVOKER: papel, RLS e a trava da
// clinica valem la dentro) e le o retorno. A cascata nos vinculos e do
// banco; aqui so traduz erro e formato.
async function sincronizarConveniosDoProfissional(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    professionalId: string;
    convenios: string[];
    naAbertura: string[] | null;
    confirmar: boolean;
  },
): Promise<SincroniaDosConvenios> {
  const { data, error } = await supabase.rpc(
    "sincronizar_convenios_do_profissional",
    {
      p_professional_id: params.professionalId,
      p_convenios: params.convenios,
      p_convenios_na_abertura: params.naAbertura,
      p_confirmar: params.confirmar,
    },
  );
  if (error) {
    if (error.code === CODIGO_CADASTRO_MUDOU) {
      return {
        ok: false,
        code: "cadastro_mudou",
        error: MENSAGEM_CADASTRO_MUDOU,
      };
    }
    return {
      ok: false,
      error: MENSAGENS_DOS_CONVENIOS[error.code ?? ""] ?? ERRO_DOS_CONVENIOS,
    };
  }
  const lido = retornoDosConveniosSchema.safeParse(data);
  if (!lido.success) {
    return { ok: false, error: ERRO_DOS_CONVENIOS };
  }
  const paraTela = (lista: z.infer<typeof mudancaDoConvenioSchema>[]) =>
    lista.map((mudanca) => ({
      insuranceId: mudanca.insurance_id,
      procedureIds: mudanca.procedure_ids,
    }));
  return {
    ok: true,
    aplicado: lido.data.aplicado,
    resumo: {
      entram: paraTela(lido.data.entram),
      saem: paraTela(lido.data.saem),
      deixaDeFazer: lido.data.deixa_de_fazer,
      consultasFuturas: lido.data.consultas_futuras,
      primeiraConsulta: lido.data.primeira_consulta,
    },
  };
}

// Ordem ao EDITAR (critica §3.4), com toda confirmacao antes de qualquer
// escrita: guarda e Zod, conferencia de desativacao, RPC dos convenios (so
// quando insurance_ids veio; sem confirmar_convenios ela devolve
// aplicado:false e NAO grava nada), UPDATE da linha, trilha. A jornada e
// outra action, chamada pela tela depois. Ao CRIAR: insert, depois a RPC com
// confirmar (nao ha vinculo para desativar); se a RPC falhar, o profissional
// ja existe e volta {ok:false, parcial:true, id}.
export async function salvarProfissionalAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = profissionalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do profissional." };
  }
  const supabase = await createClient();
  const {
    id,
    confirmar_consultas,
    insurance_ids,
    insurance_ids_na_abertura,
    confirmar_convenios,
    ...campos
  } = parsed.data;

  if (id) {
    // Desativar tira a coluna do profissional da Agenda, mas nao desmarca
    // nada: as consultas futuras continuam valendo e os lembretes saem.
    // Avisar antes (achado 37; decisao: so avisar e pedir confirmacao).
    if (!campos.active && confirmar_consultas !== true) {
      const { data: atual } = await supabase
        .from("professional")
        .select("active")
        .eq("clinic_id", guard.clinicId)
        .eq("id", id)
        .maybeSingle();
      if (atual?.active === true) {
        const futuras = await contarConsultasNoPeriodo(
          supabase,
          guard.clinicId,
          [id],
          null,
          null,
        );
        if (futuras === null) {
          return {
            ok: false,
            error:
              "Não foi possível conferir as consultas marcadas. Tente de novo.",
          };
        }
        if (futuras.total > 0) {
          return {
            ok: false,
            code: "consultas_no_periodo",
            motivo: "desativar",
            consultas: futuras.total,
            primeiraConsulta: futuras.primeira,
          };
        }
      }
    }

    // Convenios ANTES da linha: com consulta futura ou deixa_de_fazer e sem
    // confirmar_convenios, a RPC devolve aplicado:false sem gravar nada, e a
    // linha tambem fica como estava (nada e gravado antes da confirmacao).
    let convenios: ResumoDosConvenios | undefined;
    if (insurance_ids !== undefined) {
      // So o profissional da clinica ATIVA (como na action do procedimento):
      // a RLS deixa quem e membro de duas clinicas enxergar o da outra, e a
      // RPC aceitaria (o papel e conferido na clinica do profissional), mas
      // a trilha iria para a clinica ativa com um id que nao e dela.
      const { data: doCadastro, error: erroDoCadastro } = await supabase
        .from("professional")
        .select("id")
        .eq("clinic_id", guard.clinicId)
        .eq("id", id)
        .maybeSingle();
      if (erroDoCadastro) {
        return { ok: false, error: ERRO_DOS_CONVENIOS };
      }
      if (!doCadastro) {
        return { ok: false, error: "Profissional não encontrado." };
      }
      const sincronia = await sincronizarConveniosDoProfissional(supabase, {
        professionalId: id,
        convenios: insurance_ids,
        naAbertura: insurance_ids_na_abertura ?? null,
        confirmar: confirmar_convenios === true,
      });
      if (!sincronia.ok) {
        return sincronia.code
          ? { ok: false, code: sincronia.code, error: sincronia.error }
          : { ok: false, error: sincronia.error };
      }
      if (!sincronia.aplicado) {
        return {
          ok: false,
          code: "consultas_no_periodo",
          motivo: "convenios",
          consultas: sincronia.resumo.consultasFuturas,
          primeiraConsulta: sincronia.resumo.primeiraConsulta,
          convenios: sincronia.resumo,
        };
      }
      convenios = sincronia.resumo;
      // A trilha sai logo depois da gravacao: se a linha falhar abaixo, os
      // convenios ja mudaram e a mudanca precisa estar no audit_log.
      await auditar(
        supabase,
        guard.clinicId,
        guard.context.userId,
        "editou_convenios_do_profissional",
        "professional",
        id,
      );
    }

    const { data } = await supabase
      .from("professional")
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", id)
      .select("id");
    if (!data || data.length === 0) {
      if (convenios) {
        revalidatePath("/cadastros");
        return {
          ok: false,
          parcial: true,
          id,
          error:
            "Os convênios foram salvos, mas os dados do profissional não. Clique em Salvar de novo.",
          convenios,
        };
      }
      return { ok: false, error: "Não foi possível salvar o profissional." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "editou",
      "professional",
      id,
    );
    revalidatePath("/cadastros");
    return convenios ? { ok: true, id, convenios } : { ok: true, id };
  }

  const { data, error } = await supabase
    .from("professional")
    .insert({ clinic_id: guard.clinicId, ...campos })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Não foi possível criar o profissional." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "professional",
    data.id,
  );
  revalidatePath("/cadastros");

  // Profissional novo nao faz procedimento nenhum: a RPC so grava os pares
  // (nada para desativar, entao vai confirmada). Lista vazia nao chama.
  if (insurance_ids === undefined || insurance_ids.length === 0) {
    return { ok: true, id: data.id };
  }
  const sincronia = await sincronizarConveniosDoProfissional(supabase, {
    professionalId: data.id,
    convenios: insurance_ids,
    naAbertura: null,
    confirmar: true,
  });
  if (!sincronia.ok || !sincronia.aplicado) {
    return {
      ok: false,
      parcial: true,
      id: data.id,
      error: `O profissional foi criado, mas os convênios que ele atende não. ${
        sincronia.ok ? "Clique em Salvar de novo." : sincronia.error
      }`,
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou_convenios_do_profissional",
    "professional",
    data.id,
  );
  return { ok: true, id: data.id, convenios: sincronia.resumo };
}

const faixaSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/),
  unit_id: idSchema.nullable(),
});

// Substitui a jornada INTEIRA do profissional de uma vez: a grade da tela
// edita o conjunto (almoco = duas faixas no mesmo dia), e reconciliar faixa
// a faixa criaria estados intermediarios invalidos.
export async function salvarJornadaAction(
  professionalId: unknown,
  faixas: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(professionalId);
  const parsedFaixas = z.array(faixaSchema).max(40).safeParse(faixas);
  if (!parsedId.success || !parsedFaixas.success) {
    return { ok: false, error: "Confira os horários informados." };
  }
  for (const faixa of parsedFaixas.data) {
    if (faixa.starts_at === faixa.ends_at) {
      return {
        ok: false,
        error: "Uma faixa não pode começar e terminar no mesmo horário.",
      };
    }
  }

  const supabase = await createClient();
  // Substituicao ATOMICA (delete + insert numa transacao no banco): sem isto,
  // uma falha no insert depois do delete deixava o profissional sem jornada.
  const { error } = await supabase.rpc("substituir_jornada", {
    p_clinic_id: guard.clinicId,
    p_professional_id: parsedId.data,
    p_faixas: parsedFaixas.data.map((faixa) => ({
      weekday: faixa.weekday,
      starts_at: faixa.starts_at,
      ends_at: faixa.ends_at,
      unit_id: faixa.unit_id,
    })),
  });
  if (error) {
    return { ok: false, error: "Não foi possível salvar a jornada." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou",
    "professional_schedule",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Procedimentos, convenios, unidades, pacotes (recursos sairam da tela em
// 29/09/2026: continuam no banco, com a trava, sem action de escrita)
// ---------------------------------------------------------------------------

const procedimentoSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  description: z.string().trim().max(2000).nullable(),
  default_duration_min: z.number().int().min(5).max(600),
  base_price_cents: centavosSchema,
  requires_evaluation: z.boolean(),
  prep_instructions: z.string().trim().max(4000).nullable(),
  // Recursos sairam da tela (decisao do dono em 29/09/2026), mas a coluna e
  // a trava do banco ficam: sem o campo no formulario, o update NAO toca
  // procedure.resource_id (a chave ausente fica fora do update), e o
  // procedimento que ja exigia uma sala continua exigindo.
  resource_id: idSchema.nullable().optional(),
  bookable_by_ai: z.boolean(),
  active: z.boolean(),
});

const convenioSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  plan_name: z.string().trim().max(120).nullable(),
  requires_card: z.boolean(),
  notes: z.string().trim().max(2000).nullable(),
  active: z.boolean(),
});

const unidadeSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(30).nullable(),
  active: z.boolean(),
});

// Pacote com varios procedimentos (migration 20260929120000): nome, os itens
// (procedimento e sessoes, cada procedimento uma vez), o preco que a clinica
// define e a validade do PACOTE. O preco avulso nao vem da tela: e calculado
// do preco base de cada procedimento (lib/domain/pacotes.ts).
const itemDoPacoteSchema = z.object({
  procedure_id: idSchema,
  sessions: z.number().int().min(1).max(SESSOES_POR_ITEM_MAX),
});

const pacoteSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(NOME_DO_PACOTE_MAX),
  itens: z.array(itemDoPacoteSchema).min(1).max(ITENS_POR_PACOTE_MAX),
  price_cents: z.number().int().min(0).max(100_000_000),
  validity_days: z.number().int().min(1).max(3650).nullable(),
  active: z.boolean(),
});

const MENSAGEM_PACOTE_VENDIDO_REMOVER =
  "Este pacote já foi vendido. Desative em vez de remover.";

// Erros da RPC salvar_pacote. 23514 (regra) e a mensagem em portugues do
// proprio banco, que a tela mostra como veio (ver mensagemDaRegra).
const MENSAGENS_DO_PACOTE: Record<string, string> = {
  "23503": "Um procedimento escolhido não é desta clínica.",
  "42501": "Somente administradores e gestores alteram os cadastros.",
  P0002: "Pacote não encontrado.",
  "22023": "Confira os procedimentos do pacote.",
  "23505": "O mesmo procedimento aparece duas vezes no pacote.",
};

/**
 * Mensagem de regra (23514) que o banco levanta ja em portugues. A mensagem
 * crua de CHECK do Postgres (em ingles, com nome de constraint) nunca vai
 * para a tela: vira o texto do mapa do codigo ou o padrao.
 */
function mensagemDaRegra(
  error: { code?: string; message?: string },
  padrao: string,
  mensagens: Record<string, string> = MENSAGENS_DO_PACOTE,
): string {
  if (
    error.code === "23514" &&
    error.message &&
    !/violates|constraint|relation|row-level/i.test(error.message)
  ) {
    return error.message;
  }
  return mensagens[error.code ?? ""] ?? padrao;
}

async function vendasDoPacote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  packageId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("package_balance")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("package_id", packageId);
  if (error) {
    return null;
  }
  return count ?? 0;
}

async function salvarEntidade(
  tabela: string,
  schema: z.ZodType<Record<string, unknown>>,
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos informados." };
  }
  const supabase = await createClient();
  const { id, ...campos } = parsed.data as { id?: string } & Record<
    string,
    unknown
  >;

  if (id) {
    const { data } = await supabase
      .from(tabela)
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", id)
      .select("id");
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "editou",
      tabela,
      id,
    );
    revalidatePath("/cadastros");
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from(tabela)
    .insert({ clinic_id: guard.clinicId, ...campos })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Não foi possível criar o registro." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    tabela,
    data.id,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

// "IA pode agendar" tem uma fonte so: o vinculo segue a chave do
// procedimento. O modal so regrava os vinculos (RPC
// sincronizar_vinculos_do_procedimento) quando "Quem faz e convenios", o
// preco base, a duracao ou a chave mudaram em relacao a abertura; com o
// catalogo desatualizado (outro gestor mudou a chave no meio), a comparacao
// diria "nada mudou" e os vinculos ficariam com a chave antiga. Por isso o
// Salvar do procedimento ja existente alinha a chave dos vinculos aqui, sem
// criar nem desativar vinculo (a RLS de service_link vale: admin e gestor).
//
// Desde 02/10/2026, ao EDITAR, a tela chama sincronizarVinculosDoProcedimento
// Action ANTES desta (critica §3.4: nada gravado antes do aviso de consulta).
// A RPC copia a chave do procedimento como estava gravada, entao, quando a
// pessoa mudou a chave no mesmo Salvar, e este alinhamento que a leva aos
// vinculos: o erro dele agora e conferido e volta como gravacao parcial.
export async function salvarProcedimentoAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const resultado = await salvarEntidade(
    "procedure",
    procedimentoSchema,
    input,
  );
  if (!resultado.ok || !resultado.id) {
    return resultado;
  }
  const parsed = procedimentoSchema.safeParse(input);
  // So na edicao. Um procedimento recem-criado nao tem vinculo para alinhar
  // (a sincronia da tela roda depois do insert e a RPC copia a chave da
  // linha ja gravada), e um parcial aqui faria a tela perder o id e duplicar
  // o procedimento no proximo Salvar.
  if (parsed.success && parsed.data.id) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("service_link")
      .update({ bookable_by_ai: parsed.data.bookable_by_ai })
      .eq("procedure_id", resultado.id)
      .neq("bookable_by_ai", parsed.data.bookable_by_ai);
    if (error) {
      // A linha do procedimento ja esta gravada: a tela guarda o id e o
      // proximo Salvar alinha de novo (o UPDATE e idempotente).
      return {
        ok: false,
        parcial: true,
        id: resultado.id,
        error:
          "O procedimento foi salvo, mas a opção IA pode agendar não chegou a quem faz este procedimento. Clique em Salvar de novo.",
      };
    }
  }
  return resultado;
}

export async function salvarConvenioAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("insurance", convenioSchema, input);
}

export async function salvarUnidadeAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("unit", unidadeSchema, input);
}

// Cria ou edita o pacote e os itens numa transacao so no banco (RPC
// salvar_pacote, SECURITY INVOKER: a RLS e o papel da sessao valem la
// dentro). Pacote ja vendido: nome, preco, validade e "a venda" mudam; os
// itens (procedimentos e sessoes) ficam congelados, porque a venda copiou os
// itens para o saldo do paciente e o pacote precisa continuar dizendo o que
// foi vendido. O banco recusa com 23514 (inclusive na corrida com uma venda
// feita no meio); mandar os MESMOS itens de sempre passa.
export async function salvarPacoteAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = pacoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do pacote." };
  }
  const { id, name, itens, price_cents, validity_days, active } = parsed.data;
  const problema = problemaNosItens(itens);
  if (problema) {
    return { ok: false, error: problema };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("salvar_pacote", {
    p_clinic_id: guard.clinicId,
    p_name: name,
    p_itens: itens,
    p_price_cents: price_cents,
    p_validity_days: validity_days,
    p_active: active,
    p_package_id: id ?? null,
  });
  if (error || typeof data !== "string") {
    return {
      ok: false,
      error: error
        ? mensagemDaRegra(error, "Não foi possível salvar o pacote.")
        : "Não foi possível salvar o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    id ? "editou" : "criou",
    "package",
    data,
  );
  revalidatePath("/cadastros");
  revalidatePath("/pacientes");
  return { ok: true, id: data };
}

// Desativar tira o pacote da venda na ficha do paciente; os saldos ja
// vendidos continuam valendo e sendo debitados.
export async function alternarPacoteAtivoAction(
  id: unknown,
  ativo: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(id);
  const parsedAtivo = z.boolean().safeParse(ativo);
  if (!parsedId.success || !parsedAtivo.success) {
    return { ok: false, error: "Pacote inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("package")
    .update({ active: parsedAtivo.data })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsedId.data)
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: parsedAtivo.data
        ? "Não foi possível reativar o pacote."
        : "Não foi possível desativar o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    parsedAtivo.data ? "reativou" : "desativou",
    "package",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: parsedId.data };
}

export async function excluirPacoteAction(
  id: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Registro inválido." };
  }
  const supabase = await createClient();
  // Delete real so para pacote que nunca foi vendido. Com venda, a FK de
  // package_balance (NO ACTION) recusa, e o caminho e desativar.
  const vendas = await vendasDoPacote(supabase, guard.clinicId, parsed.data);
  if (vendas === null) {
    return {
      ok: false,
      error: "Não foi possível conferir as vendas deste pacote. Tente de novo.",
    };
  }
  if (vendas > 0) {
    return { ok: false, error: MENSAGEM_PACOTE_VENDIDO_REMOVER };
  }
  const { error } = await supabase
    .from("package")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? MENSAGEM_PACOTE_VENDIDO_REMOVER
          : "Não foi possível remover o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "excluiu",
    "package",
    parsed.data,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Vinculos dentro do Procedimento ("Quem faz e convenios")
// ---------------------------------------------------------------------------
// Desde 29/09/2026 o vinculo de tres pontas so e editado aqui: a aba Vinculos
// saiu de Cadastros, e com ela as actions de salvar, alternar IA, ativar e
// duplicar um vinculo solto.

// Uma linha por profissional e convenio, com o valor CONCRETO (o "padrao do
// procedimento" ja virou preco e duracao na tela, lib/domain/vinculos-do-
// procedimento.ts). bookable_by_ai nao vem daqui: segue o procedimento, e a
// RPC le a chave dele no banco.
const vinculoDoProcedimentoSchema = z
  .object({
    professional_id: idSchema,
    insurance_id: idSchema.nullable(),
    price_cents: centavosSchema,
    covered_by_insurance: z.boolean(),
    duration_min: z.number().int().min(5).max(600),
  })
  .refine((v) => !v.covered_by_insurance || v.insurance_id !== null);

export type ResultadoDosVinculosDoProcedimento = CadastroActionResult & {
  resumo?: {
    criados: number;
    reativados: number;
    atualizados: number;
    desativados: number;
    /** Consultas futuras que continuam marcadas nos vinculos que sairam */
    consultasFuturas: number;
    // As tres abaixo so vem no modo novo (com `extras`); sem extras o resumo
    // tem exatamente as cinco chaves acima, como antes de 02/10/2026.
    /** Primeira das consultas futuras (para o AvisoDeConsultas) */
    primeiraConsulta?: string | null;
    /** Convenios que passaram a cobrir (ou passariam, sem a confirmacao) */
    planosEntram?: string[];
    /** Convenios que deixaram de cobrir (ou deixariam) */
    planosSaem?: string[];
  };
};

const MENSAGENS_DA_SINCRONIZACAO: Record<string, string> = {
  // Profissional ou convenio de outra clinica (gatilho de isolamento).
  "23503": "Um profissional ou convênio escolhido não é desta clínica.",
  "42501": "Somente administradores e gestores alteram os cadastros.",
  P0002: "Procedimento não encontrado.",
  "22023": "Confira o preço e a duração de cada profissional e convênio.",
  // Corrida com outra gravacao do mesmo vinculo por outro caminho.
  "23505":
    "Outra pessoa alterou estes vínculos agora. Feche, abra de novo e salve.",
};

/** A mesma frase da regra (d) da RPC: a action recusa antes do banco */
const MENSAGEM_CONVENIO_FORA_DOS_QUE_COBREM =
  "Um convênio marcado para um profissional não está entre os convênios que cobrem este procedimento.";

// O terceiro argumento da action (ExtrasDaSincronizacao de lib/domain/
// vinculos-do-procedimento.ts, montado por extrasDaSincronizacao). Vai para
// a RPC como p_planos, p_vinculos_na_abertura, p_planos_na_abertura e
// p_confirmar. Sem ele, a RPC roda no modo legado (o de 29/09).
const extrasDaSincronizacaoSchema = z.object({
  planos: z.array(idSchema).max(200),
  vinculosNaAbertura: z
    .array(
      z.object({
        professional_id: idSchema,
        insurance_id: idSchema.nullable(),
      }),
    )
    .max(500),
  planosNaAbertura: z.array(idSchema).max(200),
  confirmar: z.boolean(),
});

// Retorno da RPC nos dois modos (legado: 5 chaves; novo: mais aplicado,
// primeira_consulta, planos_entram e planos_saem). Leitura tolerante, como
// era antes: a RPC ja gravou quando chega aqui, e contagem estranha nao
// vira erro.
const contagemDaRpc = z.number().int().min(0).catch(0);
const retornoDosVinculosSchema = z.object({
  aplicado: z.boolean().optional().catch(undefined),
  criados: contagemDaRpc,
  reativados: contagemDaRpc,
  atualizados: contagemDaRpc,
  desativados: contagemDaRpc,
  consultas_futuras: contagemDaRpc,
  primeira_consulta: z.string().nullable().catch(null),
  planos_entram: z.array(z.string()).catch([]),
  planos_saem: z.array(z.string()).catch([]),
});

// Grava de uma vez quem faz o procedimento e por quais convenios: cria,
// reativa e atualiza o que esta na lista e DESATIVA (nunca apaga) o que saiu,
// numa transacao so no banco (RPC sincronizar_vinculos_do_procedimento,
// SECURITY INVOKER: a RLS e o papel da sessao valem la dentro tambem).
//
// Com `extras` (convenio pelo medico, 02/10/2026), o modo novo da RPC:
// grava tambem "Convenios que cobrem este procedimento" (procedure_insurance
// = extras.planos), recusa a aba parada (CZ409, code "cadastro_mudou"), o
// convenio desativado que entra (22023) e as regras da cobertura (23514, com
// a frase do banco), e, com consulta futura num vinculo que sai e sem
// extras.confirmar, NAO grava nada e devolve code "consultas_no_periodo",
// motivo "vinculos". Sem `extras` (ou null), o modo legado, como antes.
export async function sincronizarVinculosDoProcedimentoAction(
  procedureId: unknown,
  linhas: unknown,
  extras?: unknown,
): Promise<ResultadoDosVinculosDoProcedimento> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(procedureId);
  const parsedLinhas = z
    .array(vinculoDoProcedimentoSchema)
    .max(500)
    .safeParse(linhas);
  if (!parsedId.success || !parsedLinhas.success) {
    return {
      ok: false,
      error: "Confira o preço e a duração de cada profissional e convênio.",
    };
  }
  const chaves = new Set(
    parsedLinhas.data.map(
      (linha) => `${linha.professional_id}:${linha.insurance_id ?? ""}`,
    ),
  );
  if (chaves.size !== parsedLinhas.data.length) {
    return {
      ok: false,
      error: "O mesmo profissional aparece duas vezes no mesmo convênio.",
    };
  }
  let modoNovo: z.infer<typeof extrasDaSincronizacaoSchema> | null = null;
  if (extras !== undefined && extras !== null) {
    const parsedExtras = extrasDaSincronizacaoSchema.safeParse(extras);
    if (!parsedExtras.success) {
      return {
        ok: false,
        error: "Confira os convênios que cobrem este procedimento.",
      };
    }
    modoNovo = parsedExtras.data;
    const cobrem = new Set(modoNovo.planos);
    if (
      parsedLinhas.data.some(
        (linha) =>
          linha.insurance_id !== null && !cobrem.has(linha.insurance_id),
      )
    ) {
      return { ok: false, error: MENSAGEM_CONVENIO_FORA_DOS_QUE_COBREM };
    }
  }

  const supabase = await createClient();
  // So o procedimento da clinica ATIVA. A RLS deixa quem e membro de duas
  // clinicas enxergar o procedimento da outra, e a RPC aceitaria (o papel e
  // conferido na clinica do procedimento), mas a trilha abaixo iria para a
  // clinica ativa com o id de um procedimento que nao e dela.
  const { data: procedimento, error: erroDoProcedimento } = await supabase
    .from("procedure")
    .select("id")
    .eq("id", parsedId.data)
    .eq("clinic_id", guard.clinicId)
    .maybeSingle();
  if (erroDoProcedimento) {
    return {
      ok: false,
      error: "Não foi possível salvar quem faz e os convênios.",
    };
  }
  if (!procedimento) {
    return { ok: false, error: "Procedimento não encontrado." };
  }
  // Sem extras, a chamada de sempre (2 argumentos nomeados): a RPC cai no
  // modo legado, identico ao de 29/09.
  const { data, error } = await supabase.rpc(
    "sincronizar_vinculos_do_procedimento",
    modoNovo
      ? {
          p_procedure_id: parsedId.data,
          p_linhas: parsedLinhas.data,
          p_planos: Array.from(new Set(modoNovo.planos)),
          p_vinculos_na_abertura: modoNovo.vinculosNaAbertura,
          p_planos_na_abertura: Array.from(new Set(modoNovo.planosNaAbertura)),
          p_confirmar: modoNovo.confirmar,
        }
      : {
          p_procedure_id: parsedId.data,
          p_linhas: parsedLinhas.data,
        },
  );
  if (error) {
    if (error.code === CODIGO_CADASTRO_MUDOU) {
      return {
        ok: false,
        code: "cadastro_mudou",
        error: MENSAGEM_CADASTRO_MUDOU,
      };
    }
    // No modo novo, 22023 so sai da conferencia do convenio desativado que
    // entra: a forma da lista (que tambem e 22023) o Zod acima ja garantiu.
    if (modoNovo && error.code === "22023") {
      return { ok: false, error: MENSAGEM_CONVENIO_INATIVO };
    }
    return {
      ok: false,
      error: mensagemDaRegra(
        error,
        "Não foi possível salvar quem faz e os convênios.",
        MENSAGENS_DA_SINCRONIZACAO,
      ),
    };
  }
  const lido = retornoDosVinculosSchema.safeParse(data ?? {});
  const contagem = lido.success
    ? lido.data
    : retornoDosVinculosSchema.parse({});
  const resumoBase = {
    criados: contagem.criados,
    reativados: contagem.reativados,
    atualizados: contagem.atualizados,
    desativados: contagem.desativados,
    consultasFuturas: contagem.consultas_futuras,
  };
  const resumo = modoNovo
    ? {
        ...resumoBase,
        primeiraConsulta: contagem.primeira_consulta,
        planosEntram: contagem.planos_entram,
        planosSaem: contagem.planos_saem,
      }
    : resumoBase;
  if (modoNovo && contagem.aplicado === false) {
    // Nada foi gravado: a tela mostra o aviso (D4) e reenvia com
    // extras.confirmar = true.
    return {
      ok: false,
      code: "consultas_no_periodo",
      motivo: "vinculos",
      consultas: contagem.consultas_futuras,
      primeiraConsulta: contagem.primeira_consulta,
      resumo,
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou_vinculos_do_procedimento",
    "procedure",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: parsedId.data, resumo };
}

// ---------------------------------------------------------------------------
// Bloqueios (pontuais, criacao em lote conforme spec 3.9)
// ---------------------------------------------------------------------------

const bloqueioLoteSchema = z.object({
  professional_ids: z.array(idSchema).min(1).max(50),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(2).max(200),
  blocks_overbooking: z.boolean(),
  // Bloqueio sobre consultas ja marcadas so passa com confirmacao explicita.
  confirmar_consultas: z.boolean().optional(),
});

export async function criarBloqueiosEmLoteAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = bloqueioLoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o período e o motivo do bloqueio." };
  }
  if (new Date(parsed.data.ends_at) <= new Date(parsed.data.starts_at)) {
    return {
      ok: false,
      error: "O fim do bloqueio precisa ser depois do início.",
    };
  }

  const supabase = await createClient();
  // O bloqueio tira os horarios da oferta, mas nao desmarca o que ja estava
  // marcado: as consultas continuam valendo e a regua pede confirmacao ao
  // paciente. Avisar antes (achado 37; decisao: so avisar e pedir
  // confirmacao, a recepcao remarca ou cancela pela Agenda).
  if (parsed.data.confirmar_consultas !== true) {
    const noPeriodo = await contarConsultasNoPeriodo(
      supabase,
      guard.clinicId,
      parsed.data.professional_ids,
      parsed.data.starts_at,
      parsed.data.ends_at,
    );
    if (noPeriodo === null) {
      return {
        ok: false,
        error:
          "Não foi possível conferir as consultas marcadas. Tente de novo.",
      };
    }
    if (noPeriodo.total > 0) {
      return {
        ok: false,
        code: "consultas_no_periodo",
        consultas: noPeriodo.total,
        primeiraConsulta: noPeriodo.primeira,
      };
    }
  }
  const { error } = await supabase.from("professional_block").insert(
    parsed.data.professional_ids.map((professionalId) => ({
      clinic_id: guard.clinicId,
      professional_id: professionalId,
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at,
      reason: parsed.data.reason,
      blocks_overbooking: parsed.data.blocks_overbooking,
    })),
  );
  if (error) {
    return { ok: false, error: "Não foi possível criar os bloqueios." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "professional_block",
    null,
  );
  // O bloqueio e criado e removido pela Agenda (a aba de Cadastros saiu).
  revalidatePath("/agenda");
  revalidatePath("/cadastros");
  return { ok: true };
}

export async function excluirBloqueioAction(
  id: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Bloqueio inválido." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("professional_block")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data);
  if (error) {
    return { ok: false, error: "Não foi possível remover o bloqueio." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "excluiu",
    "professional_block",
    parsed.data,
  );
  revalidatePath("/agenda");
  revalidatePath("/cadastros");
  return { ok: true };
}
