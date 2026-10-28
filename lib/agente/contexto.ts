import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  configDaLinha,
  configPadraoDoAgente,
  baseDoConhecimento,
  type ConfigDoAgente,
  type ItemDaBase,
  type LinhaDaConfigDoAgente,
} from "@/lib/domain/agente/config";
import { log } from "@/lib/log";

import {
  idsDoIndice,
  montarCatalogoDoAgente,
  type CatalogoDoAgente,
  type LinhasDoCatalogo,
} from "./ferramentas/buscar-procedimento";

// Carregadores do motor do agente de IA (E2). Rodam com o cliente de SERVICE
// ROLE (o motor nao tem sessao, e so ele le a coluna instrucoes), entao o
// isolamento por clinica e AQUI: toda consulta leva o clinic_id explicito,
// que vem do servidor (sessao conferida na Server Action, ou o job do E3),
// nunca do modelo nem do navegador.
//
// Colunas sempre explicitas. Erro de leitura LANCA (sem mensagem do banco):
// quem chama nao roda o agente com configuracao ou catalogo pela metade.

type Cliente = SupabaseClient;

/**
 * Todas as colunas que o motor usa (instrucoes inclusive: service role).
 * publico_atendido (onda 2, item 4) so existe DEPOIS da migration
 * 20261022110000: este codigo so vai ao ar com ela aplicada (antes, o
 * PostgREST devolve 42703 e a IA das clinicas para de responder, a licao da
 * E4).
 *
 * AG3 (27/10/2026): exige_nome_completo, exige_nascimento e exige_cpf (os
 * dados que a IA pede para marcar, D-6). Sem eles no select, o motor e o
 * simulador liam falso (dadosExigidosDoBanco) e publicar so essa mudanca
 * dizia "Não há alterações". Existem so DEPOIS da migration
 * 20261027120000_agendamento_completo_da_ia.sql: este codigo vai ao ar com
 * ela aplicada (a mesma licao).
 *
 * AG4 (27/10/2026): cancelar_antecedencia_horas e remarcar_antecedencia_horas
 * (os prazos da clinica para a IA cancelar e remarcar, D-24). Sem eles no
 * select, cancelar e remarcar valem desligadas (prazosDoBanco le nulo). Existem
 * so DEPOIS da migration 20261028100000_remarcar_e_cancelar_pela_ia.sql: este
 * codigo vai ao ar com ela aplicada (antes, 42703 e a IA de todas as clinicas
 * falha fechada).
 */
const COLUNAS_DA_CONFIG =
  "id, version, status, agent_name, tone, use_emoji, greeting, closing, skills, operating_mode, fallback_minutes, operating_hours, agenda_antecedencia_horas, agenda_horizonte_dias, publico_atendido, exige_nome_completo, exige_nascimento, exige_cpf, cancelar_antecedencia_horas, remarcar_antecedencia_horas, instrucoes, conhecimento, updated_at";

type LinhaDoMotor = LinhaDaConfigDoAgente & {
  id: string;
  instrucoes: string | null;
  conhecimento: unknown;
  updated_at?: string | null;
};

const INSTANTE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Um timestamptz do PostgREST em microssegundos desde 1970 (o Date do JS so
 * guarda milissegundos e perderia a diferenca). null fora do formato.
 */
function emMicrossegundos(instante: string): number | null {
  const lido = INSTANTE.exec(instante.trim());
  if (!lido) {
    return null;
  }
  const [, dia, hora, fracao = "", fuso] = lido;
  const fusoIso =
    fuso === "Z"
      ? "Z"
      : /^[+-]\d{2}$/.test(fuso ?? "")
        ? `${fuso}:00`
        : (fuso ?? "").replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const segundos = Date.parse(`${dia}T${hora}${fusoIso}`);
  if (!Number.isFinite(segundos)) {
    return null;
  }
  return segundos * 1000 + Number(fracao.padEnd(6, "0"));
}

/**
 * O mais recente dos instantes, como o banco escreveu (sem arredondar: vai
 * de volta para publicar_agente, que compara no Postgres). null sem nenhum
 * valido.
 */
export function maiorInstante(
  instantes: readonly (string | null | undefined)[],
): string | null {
  let maior: { texto: string; valor: number } | null = null;
  for (const instante of instantes) {
    if (typeof instante !== "string") {
      continue;
    }
    const valor = emMicrossegundos(instante);
    if (valor !== null && (maior === null || valor > maior.valor)) {
      maior = { texto: instante, valor };
    }
  }
  return maior?.texto ?? null;
}

/** O PostgREST corta em max_rows sem erro: le por paginas, ordenado por id. */
const PAGINA = 1000;

async function todasAsPaginas<T>(
  pagina: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) {
      throw new Error("leitura do agente falhou");
    }
    const lidas = (data ?? []) as T[];
    linhas.push(...lidas);
    if (lidas.length < PAGINA) {
      return linhas;
    }
  }
}

type LinhaDaBase = {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  updated_at?: string | null;
};

async function linhasDaBaseViva(
  cliente: Cliente,
  clinicId: string,
): Promise<LinhaDaBase[]> {
  return todasAsPaginas<LinhaDaBase>((de, ate) =>
    cliente
      .from("knowledge_item")
      .select("id, question, answer, active, updated_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate),
  );
}

function itemDaLinha(linha: LinhaDaBase): ItemDaBase {
  return {
    id: linha.id,
    pergunta: linha.question,
    resposta: linha.answer,
    ativo: linha.active === true,
  };
}

/**
 * A base viva (knowledge_item) da clinica, na ordem em que publicar_agente
 * congela (criacao e id), com ativas e inativas.
 */
export async function carregarBaseViva(
  cliente: Cliente,
  clinicId: string,
): Promise<ItemDaBase[]> {
  return (await linhasDaBaseViva(cliente, clinicId)).map(itemDaLinha);
}

async function linhaDaConfig(
  cliente: Cliente,
  clinicId: string,
  status: "rascunho" | "publicada",
): Promise<LinhaDoMotor | null> {
  const { data, error } = await cliente
    .from("ai_agent_config")
    .select(COLUNAS_DA_CONFIG)
    .eq("clinic_id", clinicId)
    .eq("status", status)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error("leitura do agente falhou");
  }
  return (data as LinhaDoMotor | null) ?? null;
}

/**
 * A ultima versao publicada, com a base congelada (`conhecimento`) e as
 * instrucoes: o que o agente usa no WhatsApp (E3). Nula se nunca publicou.
 */
export async function carregarConfigPublicada(
  admin: Cliente,
  clinicId: string,
): Promise<ConfigDoAgente | null> {
  const linha = await linhaDaConfig(admin, clinicId, "publicada");
  if (linha === null) {
    return null;
  }
  return configDaLinha(linha, {
    base: baseDoConhecimento(linha.conhecimento),
    instrucoes: linha.instrucoes,
  });
}

export type ConfigDoRascunho = {
  /**
   * O que o simulador roda: o rascunho; sem rascunho, a copia da ultima
   * publicada (o que garantir_rascunho_do_agente criaria); sem nenhuma, os
   * padroes. A base e sempre a viva (knowledge_item), que e o rascunho da
   * base.
   */
  config: ConfigDoAgente;
  /** id do rascunho gravado, ou null. */
  rascunhoId: string | null;
  /** A ultima publicada (base congelada), ou null. */
  publicada: ConfigDoAgente | null;
  /**
   * O maior updated_at entre o rascunho e os itens da base, como o banco
   * escreveu: publicarAgenteAction manda para publicar_agente
   * (p_conferido_em), que recusa (CZ409) se algo mudou depois desta
   * leitura. null sem rascunho.
   */
  conferidoEm: string | null;
};

/** Rodadas de leitura antes de desistir de um rascunho que nao para de mudar. */
export const TENTATIVAS_DA_LEITURA_DO_RASCUNHO = 3;

/** O id e o updated_at do rascunho, para conferir que nao mudou. */
async function marcaDoRascunho(
  cliente: Cliente,
  clinicId: string,
): Promise<string | null> {
  const { data, error } = await cliente
    .from("ai_agent_config")
    .select("id, updated_at")
    .eq("clinic_id", clinicId)
    .eq("status", "rascunho")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error("leitura do agente falhou");
  }
  return marcaDe(data as { id?: unknown; updated_at?: unknown } | null);
}

function marcaDe(
  linha: { id?: unknown; updated_at?: unknown } | null,
): string | null {
  return linha === null
    ? null
    : `${String(linha.id)}|${String(linha.updated_at)}`;
}

/**
 * O rascunho, a publicada e a base viva, e o carimbo do que foi lido
 * (conferidoEm).
 *
 * Ordem, em SEQUENCIA (nunca Promise.all, que deixava a ordem ao acaso):
 *  1. o rascunho (e a publicada, que nao entra no carimbo);
 *  2. a base, DEPOIS;
 *  3. o id e o updated_at do rascunho de novo: se mudou durante a leitura da
 *     base, le tudo outra vez (ate TENTATIVAS_DA_LEITURA_DO_RASCUNHO; depois
 *     lanca, e quem chama diz para tentar de novo).
 *
 * Por que isso fecha a corrida com publicar_agente: o carimbo e o maior
 * updated_at das duas leituras, e a RPC so pega uma escrita que a action nao
 * viu se o updated_at dela ficar ACIMA do carimbo. As acoes da base terminam
 * garantindo o rascunho (garantirRascunhoDepoisDaBase), entao o rascunho que
 * aparece depois de uma escrita na base e mais novo que ela. Lendo a base
 * primeiro, essa escrita podia escapar da leitura e o rascunho lido depois
 * erguia o carimbo ate ou acima dela: a RPC recalculava um maior updated_at
 * que nao passava do carimbo e congelava um texto que o filtro nao conferiu.
 * Lendo o rascunho primeiro, a base lida depois ja traz toda escrita
 * anterior ao rascunho lido. Sobra o caminho inverso: o rascunho muda entre
 * as duas leituras (outra aba, ou o restaurar, que grava rascunho e base
 * juntos) e a base lida traz algo tao novo quanto essa mudanca, que fica sob
 * o carimbo. O passo 3 recusa esse retrato: com o rascunho igual antes e
 * depois da base, as duas leituras valem pelo mesmo instante. Resta so a
 * janela descrita em publicar_agente: o set_updated_at grava now(), que e o
 * COMECO da transacao de escrita, e a RPC compara o carimbo em
 * milissegundos (corta os microssegundos). Uma escrita concorrente pode
 * ficar sob o carimbo se a leitura cair dentro da janela que vai do comeco
 * da transacao dela ate o commit, ou seja, a duracao inteira dessa
 * transacao (inclusive o tempo esperando uma trava), mais ate 1 ms do corte.
 */
export async function carregarConfigDoRascunho(
  admin: Cliente,
  clinicId: string,
): Promise<ConfigDoRascunho> {
  for (let tentativa = 1; ; tentativa += 1) {
    const [rascunho, publicadaLinha] = await Promise.all([
      linhaDaConfig(admin, clinicId, "rascunho"),
      linhaDaConfig(admin, clinicId, "publicada"),
    ]);
    const linhasDaBase = await linhasDaBaseViva(admin, clinicId);
    if ((await marcaDoRascunho(admin, clinicId)) === marcaDe(rascunho)) {
      return montarConfigDoRascunho(rascunho, publicadaLinha, linhasDaBase);
    }
    if (tentativa >= TENTATIVAS_DA_LEITURA_DO_RASCUNHO) {
      throw new Error("leitura do agente mudou");
    }
  }
}

function montarConfigDoRascunho(
  rascunho: LinhaDoMotor | null,
  publicadaLinha: LinhaDoMotor | null,
  linhasDaBase: readonly LinhaDaBase[],
): ConfigDoRascunho {
  const base = linhasDaBase.map(itemDaLinha);
  const publicada =
    publicadaLinha === null
      ? null
      : configDaLinha(publicadaLinha, {
          base: baseDoConhecimento(publicadaLinha.conhecimento),
          instrucoes: publicadaLinha.instrucoes,
        });
  const origem = rascunho ?? publicadaLinha;
  const config: ConfigDoAgente =
    origem === null
      ? { ...configPadraoDoAgente(), base }
      : {
          ...configDaLinha(origem, { base, instrucoes: origem.instrucoes }),
          status: "rascunho",
        };
  return {
    config,
    rascunhoId: rascunho?.id ?? null,
    publicada,
    conferidoEm:
      rascunho === null
        ? null
        : maiorInstante([
            rascunho.updated_at,
            ...linhasDaBase.map((linha) => linha.updated_at),
          ]),
  };
}

/**
 * O nome cadastrado da clinica (clinic.name), pela chave da propria clinica.
 * Lanca na leitura que falha (como o resto do catalogo). Sem linha: null.
 */
async function linhaDaClinica(
  admin: Cliente,
  clinicId: string,
): Promise<{ name: string | null } | null> {
  const { data, error } = await admin
    .from("clinic")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) {
    throw new Error("leitura do agente falhou");
  }
  const nome = (data as { name?: unknown } | null)?.name;
  return data === null
    ? null
    : { name: typeof nome === "string" ? nome : null };
}

/** Ids por pedido de `in` (a URL do PostgREST tem limite). */
const IDS_POR_LOTE = 100;

/**
 * O catalogo que o agente enxerga (indice e vinculos de buscar_procedimento):
 * so procedimento e vinculo ativos com "IA pode agendar" nas duas chaves,
 * profissional ativo e convenio ativo (montarCatalogoDoAgente). Os convenios
 * sao TODOS os ativos da clinica, com e sem vinculo do agente: viram
 * `conveniosDoCadastro` (so nome e plano; a tabela de convenios nao tem
 * preco), para a busca contar e listar os planos de uma operadora. Traz
 * tambem o nome cadastrado da clinica (revisao de producao de 19/10/2026,
 * Q7): o mesmo carregador serve ao WhatsApp, a retomada do envio, ao
 * simulador e a previa do prompt, entao o nome e a mascara do filtro nunca
 * divergem entre eles. Do E4 em diante, o vinculo traz tambem o id e a
 * duracao, e o procedimento o recurso (sala ou equipamento): e o que a
 * agenda da IA usa (lib/agente/agenda.ts), sem nada disso ir ao modelo.
 * Correcao da E4 (D14): os vinculos ATIVOS sem "IA pode agendar" vem so com
 * ids (nunca preco), para a agenda nunca dizer que o profissional nao atende
 * um convenio que ele atende (so a equipe marca por ele).
 *
 * AG2 (27/10/2026), o Cadastro das consultas do agente
 * (lib/agente/ferramentas/cadastro-do-agente.ts), sempre com o clinic_id
 * explicito e colunas explicitas, nada de paciente:
 *  - TODOS os procedimentos ativos (com "IA pode agendar" ou nao), com
 *    ia_pode_informar e requires_evaluation (nunca prep_instructions: D-4,
 *    opcao A);
 *  - a idade atendida do profissional;
 *  - as unidades ativas, sem cep, phone, link_do_mapa e address;
 *  - a jornada so com o profissional e a unidade (nunca a hora);
 *  - os requisitos ativos dos procedimentos;
 *  - os convenios de cada profissional (professional_insurance);
 *  - DEPOIS dessas leituras, e so quando ha: os vinculos ativos, com preco,
 *    dos procedimentos ativos fora do indice que deixam informar
 *    (ia_pode_informar, D-3). O vinculo que a IA nao marca so traz preco ao
 *    motor nesse caso.
 * Erro em qualquer leitura lanca (o catalogo nunca sai pela metade): quem
 * chama falha fechado, como sempre.
 *
 * ORDEM DE PUBLICACAO (a licao da E4): as colunas e a tabela da AG2
 * (procedure.ia_pode_informar, professional.idade_minima e idade_maxima, as
 * colunas novas de unit e procedure_requirement) so existem DEPOIS da
 * migration 20261027100000_cadastro_para_o_agente.sql. Este codigo so vai ao
 * ar com ela aplicada: antes, o PostgREST devolve 42703 ou 42P01, o catalogo
 * lanca e a IA de todas as clinicas para de responder (falha fechada, mas
 * parada).
 */
export async function carregarCatalogoDoAgente(
  admin: Cliente,
  clinicId: string,
): Promise<CatalogoDoAgente> {
  const [
    procedimentos,
    vinculos,
    profissionais,
    convenios,
    clinica,
    vinculosSoDaEquipe,
    unidades,
    jornadas,
    requisitos,
    conveniosDosProfissionais,
  ] = await Promise.all([
    todasAsPaginas<LinhasDoCatalogo["procedimentos"][number]>((de, ate) =>
      admin
        .from("procedure")
        .select(
          "id, name, active, bookable_by_ai, resource_id, ia_pode_informar, requires_evaluation",
        )
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .order("id", { ascending: true })
        .range(de, ate),
    ),
    todasAsPaginas<LinhasDoCatalogo["vinculos"][number]>((de, ate) =>
      admin
        .from("service_link")
        .select(
          "id, procedure_id, professional_id, insurance_id, price_cents, covered_by_insurance, bookable_by_ai, active, duration_min",
        )
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .eq("bookable_by_ai", true)
        .order("id", { ascending: true })
        .range(de, ate),
    ),
    // Onda 2 (item 6): as especialidades vao ao bloco <profissionais>,
    // saneadas (especialidadesParaOAgente). AG2: e a idade atendida. AG3: e
    // a grade (os inicios que a busca de horario oferece).
    todasAsPaginas<LinhasDoCatalogo["profissionais"][number]>((de, ate) =>
      admin
        .from("professional")
        .select(
          "id, name, active, specialties, idade_minima, idade_maxima, grade_minutos",
        )
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .order("id", { ascending: true })
        .range(de, ate),
    ),
    todasAsPaginas<LinhasDoCatalogo["convenios"][number]>((de, ate) =>
      admin
        .from("insurance")
        .select("id, name, plan_name, active, requires_card")
        .eq("clinic_id", clinicId)
        .eq("active", true)
        .order("id", { ascending: true })
        .range(de, ate),
    ),
    linhaDaClinica(admin, clinicId),
    // So ids: o vinculo que a IA nao marca nunca traz preco ao motor.
    todasAsPaginas<NonNullable<LinhasDoCatalogo["vinculosSoDaEquipe"]>[number]>(
      (de, ate) =>
        admin
          .from("service_link")
          .select("procedure_id, professional_id, insurance_id")
          .eq("clinic_id", clinicId)
          .eq("active", true)
          .eq("bookable_by_ai", false)
          .order("id", { ascending: true })
          .range(de, ate),
    ),
    // AG2: nunca cep, phone, link_do_mapa nem address.
    todasAsPaginas<NonNullable<LinhasDoCatalogo["unidades"]>[number]>(
      (de, ate) =>
        admin
          .from("unit")
          .select(
            "id, name, active, logradouro, numero, complemento, bairro, cidade, uf, referencia, estacionamento, acessibilidade, horario_de_funcionamento, observacao_ao_paciente",
          )
          .eq("clinic_id", clinicId)
          .eq("active", true)
          .order("id", { ascending: true })
          .range(de, ate),
    ),
    // AG2: so quem atende onde (nunca a hora).
    todasAsPaginas<NonNullable<LinhasDoCatalogo["jornadas"]>[number]>(
      (de, ate) =>
        admin
          .from("professional_schedule")
          .select("professional_id, unit_id")
          .eq("clinic_id", clinicId)
          .order("id", { ascending: true })
          .range(de, ate),
    ),
    todasAsPaginas<NonNullable<LinhasDoCatalogo["requisitos"]>[number]>(
      (de, ate) =>
        admin
          .from("procedure_requirement")
          .select(
            "procedure_id, insurance_id, tipo, valor_inteiro, texto_ao_paciente, ativo",
          )
          .eq("clinic_id", clinicId)
          .eq("ativo", true)
          .order("id", { ascending: true })
          .range(de, ate),
    ),
    todasAsPaginas<
      NonNullable<LinhasDoCatalogo["conveniosDosProfissionais"]>[number]
    >((de, ate) =>
      admin
        .from("professional_insurance")
        .select("professional_id, insurance_id")
        .eq("clinic_id", clinicId)
        .order("id", { ascending: true })
        .range(de, ate),
    ),
  ]);
  const vinculosDaEquipe = await carregarVinculosDaEquipe(admin, clinicId, {
    procedimentos,
    vinculos,
    profissionais,
    convenios,
  });
  const catalogo = montarCatalogoDoAgente({
    procedimentos,
    vinculos,
    profissionais,
    convenios,
    clinica,
    vinculosSoDaEquipe,
    vinculosDaEquipe,
    unidades,
    jornadas,
    requisitos,
    conveniosDosProfissionais,
  });
  // Especialidade que nao passa nas regras do filtro (ou fora do formato)
  // fica de fora do modelo; a equipe Conduzza fica sabendo so pela contagem.
  const descartadas = catalogo.especialidadesDescartadas ?? 0;
  if (descartadas > 0) {
    log.warn("agente_especialidade_descartada", {
      clinic_id: clinicId,
      count: descartadas,
    });
  }
  // AG2: o mesmo para os textos do Cadastro (endereco montado, textos da
  // unidade e dos requisitos): so a contagem, nunca o texto.
  const textos = catalogo.textosDoCadastroDescartados ?? 0;
  if (textos > 0) {
    log.warn("agente_texto_do_cadastro_descartado", {
      clinic_id: clinicId,
      count: textos,
    });
  }
  return catalogo;
}

/**
 * AG2 (D-3): os vinculos ATIVOS, com preco e duracao, so dos procedimentos
 * ativos que a IA nao marca (fora do indice) e que deixam informar
 * (ia_pode_informar). Os procedimentos vem da leitura de cima; o indice e o
 * de montarCatalogoDoAgente (o mesmo calculo). Sem nenhum desses
 * procedimentos, nada e lido.
 */
async function carregarVinculosDaEquipe(
  admin: Cliente,
  clinicId: string,
  linhas: Pick<
    LinhasDoCatalogo,
    "procedimentos" | "vinculos" | "profissionais" | "convenios"
  >,
): Promise<NonNullable<LinhasDoCatalogo["vinculosDaEquipe"]>> {
  const doIndice = idsDoIndice(linhas);
  const ids = linhas.procedimentos
    .filter(
      (p) => p.active && p.ia_pode_informar !== false && !doIndice.has(p.id),
    )
    .map((p) => p.id)
    .sort();
  const lidos: NonNullable<LinhasDoCatalogo["vinculosDaEquipe"]>[number][] = [];
  for (let de = 0; de < ids.length; de += IDS_POR_LOTE) {
    const lote = ids.slice(de, de + IDS_POR_LOTE);
    lidos.push(
      ...(await todasAsPaginas<
        NonNullable<LinhasDoCatalogo["vinculosDaEquipe"]>[number]
      >((inicio, fim) =>
        admin
          .from("service_link")
          .select(
            "id, procedure_id, professional_id, insurance_id, price_cents, covered_by_insurance, active, duration_min",
          )
          .eq("clinic_id", clinicId)
          .eq("active", true)
          .in("procedure_id", lote)
          .order("id", { ascending: true })
          .range(inicio, fim),
      )),
    );
  }
  return lidos;
}
