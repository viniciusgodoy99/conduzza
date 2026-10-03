import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

import {
  diaCivil,
  diasEntre,
  instanteLocal,
  somarDias,
} from "@/lib/domain/horarios";

// Atividades do lead ou paciente (tabela contact_activity, migration
// 20261002120000_crm_leva_a). Modulo PURO: o predicado de atrasada e de
// "para hoje" (espelho do SQL de contagem_de_atividades), o agrupamento da
// lista por prazo, os filtros da tela, o texto do prazo no fuso da clinica,
// os schemas Zod do formulario e das Server Actions e a traducao dos erros do
// banco. Sem I/O.
//
// Regra 3.6: o prazo e o dia civil DA CLINICA (due_on) e, quando tem hora, o
// instante em UTC (due_at). "Hoje" e sempre o dia civil no clinic.timezone,
// nunca o do navegador nem o do servidor.

export type StatusDaAtividade = "pendente" | "concluida" | "cancelada";
export type OrigemDaAtividade = "manual" | "automacao";

export const STATUS_DA_ATIVIDADE: readonly StatusDaAtividade[] = [
  "pendente",
  "concluida",
  "cancelada",
] as const;

/** O minimo do prazo para os predicados (a linha do banco serve). */
export type PrazoDaAtividade = {
  status: StatusDaAtividade;
  /** Dia civil da clinica, aaaa-mm-dd */
  due_on: string;
  /** Instante com hora (ISO), ou null quando a atividade e so do dia */
  due_at: string | null;
};

// ---------------------------------------------------------------------------
// Predicados (espelho de contagem_de_atividades)
// ---------------------------------------------------------------------------
// SQL: atrasada = coalesce(due_at < now(), due_on < hoje); hoje = due_on =
// hoje e NAO atrasada. As duas nao se sobrepoem: a de hoje com hora que ja
// passou e atrasada. So pendente conta.

/** Pendente e vencida: com hora, a hora ja passou; sem hora, o dia ja passou. */
export function ehAtrasada(
  atividade: PrazoDaAtividade,
  agora: Date,
  hoje: string,
): boolean {
  if (atividade.status !== "pendente") {
    return false;
  }
  if (atividade.due_at !== null) {
    return new Date(atividade.due_at).getTime() < agora.getTime();
  }
  return atividade.due_on < hoje;
}

/** Pendente, do dia de hoje e ainda nao vencida. */
export function ehParaHoje(
  atividade: PrazoDaAtividade,
  agora: Date,
  hoje: string,
): boolean {
  return (
    atividade.status === "pendente" &&
    atividade.due_on === hoje &&
    !ehAtrasada(atividade, agora, hoje)
  );
}

/** A situacao que o chip mostra (3 camadas em lib/design/status). */
export type SituacaoDaAtividade =
  "atrasada" | "hoje" | "pendente" | "concluida" | "cancelada";

export function situacaoDaAtividade(
  atividade: PrazoDaAtividade,
  agora: Date,
  hoje: string,
): SituacaoDaAtividade {
  if (atividade.status !== "pendente") {
    return atividade.status;
  }
  if (ehAtrasada(atividade, agora, hoje)) {
    return "atrasada";
  }
  if (atividade.due_on === hoje) {
    return "hoje";
  }
  return "pendente";
}

// ---------------------------------------------------------------------------
// Agrupamento da lista por prazo
// ---------------------------------------------------------------------------

export type GrupoDePrazo =
  "atrasadas" | "hoje" | "amanha" | "proximos_7_dias" | "depois";

export const ORDEM_DOS_GRUPOS: readonly GrupoDePrazo[] = [
  "atrasadas",
  "hoje",
  "amanha",
  "proximos_7_dias",
  "depois",
] as const;

export const ROTULO_DO_GRUPO: Record<GrupoDePrazo, string> = {
  atrasadas: "Atrasadas",
  hoje: "Hoje",
  amanha: "Amanhã",
  proximos_7_dias: "Próximos 7 dias",
  depois: "Depois",
};

/** O grupo de uma PENDENTE; null para concluida e cancelada. */
export function grupoDePrazo(
  atividade: PrazoDaAtividade,
  agora: Date,
  hoje: string,
): GrupoDePrazo | null {
  if (atividade.status !== "pendente") {
    return null;
  }
  if (ehAtrasada(atividade, agora, hoje)) {
    return "atrasadas";
  }
  const dias = diasEntre(hoje, atividade.due_on);
  // Dia anterior a hoje com hora ainda no futuro so acontece se o fuso da
  // clinica mudou depois de gravar: fica em Hoje, nunca some da lista.
  if (dias <= 0) {
    return "hoje";
  }
  if (dias === 1) {
    return "amanha";
  }
  if (dias <= 7) {
    return "proximos_7_dias";
  }
  return "depois";
}

/** Ordem de prazo: o dia, dentro do dia a com hora antes, depois a criacao. */
export function compararPorPrazo(
  a: PrazoDaAtividade & { created_at: string; id: string },
  b: PrazoDaAtividade & { created_at: string; id: string },
): number {
  if (a.due_on !== b.due_on) {
    return a.due_on < b.due_on ? -1 : 1;
  }
  if (a.due_at !== b.due_at) {
    if (a.due_at === null) {
      return 1;
    }
    if (b.due_at === null) {
      return -1;
    }
    const diferenca =
      new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    if (diferenca !== 0) {
      return diferenca;
    }
  }
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type GrupoDeAtividades<T> = {
  chave: GrupoDePrazo | "concluidas";
  rotulo: string;
  itens: T[];
};

/**
 * Os grupos da lista, na ordem da tela e sem grupo vazio. As concluidas (o
 * filtro Concluidas) vao num grupo so, da mais recente para a mais antiga.
 */
export function agruparAtividades<
  T extends PrazoDaAtividade & {
    created_at: string;
    id: string;
    completed_at: string | null;
  },
>(lista: readonly T[], agora: Date, hoje: string): GrupoDeAtividades<T>[] {
  const porGrupo = new Map<GrupoDePrazo, T[]>();
  const concluidas: T[] = [];
  for (const atividade of lista) {
    if (atividade.status === "concluida") {
      concluidas.push(atividade);
      continue;
    }
    const grupo = grupoDePrazo(atividade, agora, hoje);
    if (grupo === null) {
      continue;
    }
    const itens = porGrupo.get(grupo) ?? [];
    itens.push(atividade);
    porGrupo.set(grupo, itens);
  }
  const grupos: GrupoDeAtividades<T>[] = [];
  for (const chave of ORDEM_DOS_GRUPOS) {
    const itens = porGrupo.get(chave);
    if (itens && itens.length > 0) {
      grupos.push({
        chave,
        rotulo: ROTULO_DO_GRUPO[chave],
        itens: [...itens].sort(compararPorPrazo),
      });
    }
  }
  if (concluidas.length > 0) {
    grupos.push({
      chave: "concluidas",
      rotulo: "Concluídas",
      itens: [...concluidas].sort((a, b) =>
        (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
      ),
    });
  }
  return grupos;
}

// ---------------------------------------------------------------------------
// Filtros da tela (vivem na URL)
// ---------------------------------------------------------------------------

export type QuemDaLista = "minhas" | "todas";
export type FiltroDeSituacao =
  "pendentes" | "atrasadas" | "hoje" | "proximas" | "concluidas";

export const FILTROS_DE_SITUACAO: readonly FiltroDeSituacao[] = [
  "pendentes",
  "atrasadas",
  "hoje",
  "proximas",
  "concluidas",
] as const;

/** Valor do filtro de responsavel para "Sem responsável". */
export const SEM_RESPONSAVEL = "sem";

export type FiltrosDeAtividades = {
  quem: QuemDaLista;
  situacao: FiltroDeSituacao;
  /** id do membro, SEM_RESPONSAVEL ou null (todos). So vale em "todas". */
  responsavel: string | null;
  busca: string;
  /** Recorte de um contato so (o "Ver todas" do drawer, da conversa e da ficha) */
  contato: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Le os filtros da URL; valor desconhecido volta ao padrao, nunca quebra. */
export function lerFiltrosDeAtividades(params: {
  get(chave: string): string | null;
}): FiltrosDeAtividades {
  const quem = params.get("quem") === "todas" ? "todas" : "minhas";
  const filtro = params.get("filtro");
  const situacao = FILTROS_DE_SITUACAO.includes(filtro as FiltroDeSituacao)
    ? (filtro as FiltroDeSituacao)
    : "pendentes";
  const resp = params.get("resp");
  const responsavel =
    resp === SEM_RESPONSAVEL || (resp !== null && UUID.test(resp))
      ? resp
      : null;
  const contato = params.get("contato");
  return {
    quem,
    situacao,
    responsavel,
    busca: (params.get("busca") ?? "").slice(0, 80),
    contato: contato !== null && UUID.test(contato) ? contato : null,
  };
}

/** Texto sem acento e em minusculas, para a busca. */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export type AtividadeFiltravel = PrazoDaAtividade & {
  contact_id: string;
  assignee_user_id: string | null;
  titulo: string;
  contato: { nome: string | null; telefone: string } | null;
};

/** A atividade casa com a situacao escolhida. */
export function casaComSituacao(
  atividade: PrazoDaAtividade,
  situacao: FiltroDeSituacao,
  agora: Date,
  hoje: string,
): boolean {
  switch (situacao) {
    case "pendentes":
      return atividade.status === "pendente";
    case "atrasadas":
      return ehAtrasada(atividade, agora, hoje);
    case "hoje":
      return ehParaHoje(atividade, agora, hoje);
    case "proximas":
      return (
        atividade.status === "pendente" &&
        !ehAtrasada(atividade, agora, hoje) &&
        atividade.due_on > hoje
      );
    case "concluidas":
      return atividade.status === "concluida";
  }
}

/** Recorte de "quem": minhas = responsavel e quem esta usando. */
export function casaComQuem(
  atividade: { assignee_user_id: string | null },
  filtros: Pick<FiltrosDeAtividades, "quem" | "responsavel">,
  eu: string,
): boolean {
  if (filtros.quem === "minhas") {
    return atividade.assignee_user_id === eu;
  }
  if (filtros.responsavel === SEM_RESPONSAVEL) {
    return atividade.assignee_user_id === null;
  }
  if (filtros.responsavel !== null) {
    return atividade.assignee_user_id === filtros.responsavel;
  }
  return true;
}

/** Busca por nome ou telefone do contato, ou pelo texto do "O que fazer". */
export function casaComBusca(
  atividade: AtividadeFiltravel,
  busca: string,
): boolean {
  const termo = normalizarBusca(busca);
  if (!termo) {
    return true;
  }
  const digitos = termo.replace(/\D/g, "");
  const nome = normalizarBusca(atividade.contato?.nome ?? "");
  const titulo = normalizarBusca(atividade.titulo);
  if (nome.includes(termo) || titulo.includes(termo)) {
    return true;
  }
  // Pedaco de telefone: so quando o termo e numero (4 digitos ou mais).
  const pareceTelefone = /^[\d\s()+.-]+$/.test(termo);
  return (
    pareceTelefone &&
    digitos.length >= 4 &&
    (atividade.contato?.telefone ?? "").replace(/\D/g, "").includes(digitos)
  );
}

export function filtrarAtividades<T extends AtividadeFiltravel>(
  lista: readonly T[],
  filtros: FiltrosDeAtividades,
  contexto: { eu: string; agora: Date; hoje: string },
): T[] {
  return lista.filter(
    (atividade) =>
      (filtros.contato === null || atividade.contact_id === filtros.contato) &&
      casaComQuem(atividade, filtros, contexto.eu) &&
      casaComSituacao(
        atividade,
        filtros.situacao,
        contexto.agora,
        contexto.hoje,
      ) &&
      casaComBusca(atividade, filtros.busca),
  );
}

/** Quantas atrasadas e para hoje ha num recorte (frase do cabecalho). */
export function contarPendencias(
  lista: readonly PrazoDaAtividade[],
  agora: Date,
  hoje: string,
): { atrasadas: number; hoje: number } {
  let atrasadas = 0;
  let deHoje = 0;
  for (const atividade of lista) {
    if (ehAtrasada(atividade, agora, hoje)) {
      atrasadas += 1;
    } else if (ehParaHoje(atividade, agora, hoje)) {
      deHoje += 1;
    }
  }
  return { atrasadas, hoje: deHoje };
}

// ---------------------------------------------------------------------------
// Prazo no fuso da clinica
// ---------------------------------------------------------------------------

/** "14:05" de um instante, no relogio da clinica. */
export function horaDoPrazo(dueAt: string, timezone: string): string {
  return format(new TZDate(new Date(dueAt).getTime(), timezone), "HH:mm");
}

/**
 * O prazo como a recepcao fala: "Hoje", "Amanhã", "Ontem" ou "01/12" (com o
 * ano quando nao for o de hoje), mais ", 14:00" quando tem hora. Tudo no
 * fuso da clinica.
 */
export function textoDoPrazo(
  atividade: { due_on: string; due_at: string | null },
  hoje: string,
  timezone: string,
): string {
  const dias = diasEntre(hoje, atividade.due_on);
  const [ano, mes, dia] = atividade.due_on.split("-");
  const diaEmTexto =
    dias === 0
      ? "Hoje"
      : dias === 1
        ? "Amanhã"
        : dias === -1
          ? "Ontem"
          : ano === hoje.slice(0, 4)
            ? `${dia}/${mes}`
            : `${dia}/${mes}/${ano}`;
  if (atividade.due_at === null) {
    return diaEmTexto;
  }
  return `${diaEmTexto}, ${horaDoPrazo(atividade.due_at, timezone)}`;
}

/** O dia civil de hoje na clinica. */
export function hojeNaClinica(timezone: string, agora: Date): string {
  return diaCivil(timezone, agora);
}

/** Os atalhos de "Para quando", contados a partir de hoje na clinica. */
export function atalhosDePrazo(
  hoje: string,
): { rotulo: string; dias: number; dia: string }[] {
  return [
    { rotulo: "Amanhã", dias: 1, dia: somarDias(hoje, 1) },
    { rotulo: "Em 7 dias", dias: 7, dia: somarDias(hoje, 7) },
    { rotulo: "Em 30 dias", dias: 30, dia: somarDias(hoje, 30) },
  ];
}

/**
 * O que gravar: o dia sempre, e o instante quando ha hora (o banco recalcula
 * due_on a partir de due_at no fuso da clinica, este calculo so adianta).
 */
export function prazoParaGravar(
  timezone: string,
  dia: string,
  hora: string | null,
): { due_on: string; due_at: string | null } {
  if (!hora) {
    return { due_on: dia, due_at: null };
  }
  return {
    due_on: dia,
    due_at: instanteLocal(timezone, dia, hora).toISOString(),
  };
}

/** Os adiamentos do menu da linha, contados a partir de hoje. */
export const ADIAMENTOS = [1, 7, 30] as const;
export type Adiamento = (typeof ADIAMENTOS)[number];

export const ROTULO_DO_ADIAMENTO: Record<Adiamento, string> = {
  1: "Para amanhã",
  7: "Para daqui a 7 dias",
  30: "Para daqui a 30 dias",
};

/**
 * O novo prazo de um adiamento: hoje + N dias na clinica, mantendo a hora
 * local quando a atividade tem hora. Devolve so o que muda (contrato do
 * banco: com hora manda due_at; sem hora, due_on).
 */
export function prazoAdiado(
  atividade: { due_at: string | null },
  dias: number,
  hoje: string,
  timezone: string,
): { due_on: string; due_at?: string } {
  const novoDia = somarDias(hoje, dias);
  if (atividade.due_at === null) {
    return { due_on: novoDia };
  }
  const hora = horaDoPrazo(atividade.due_at, timezone);
  return {
    due_on: novoDia,
    due_at: instanteLocal(timezone, novoDia, hora).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validacao (formulario e Server Actions)
// ---------------------------------------------------------------------------

export const TITULO_MIN = 2;
export const TITULO_MAX = 120;
export const DETALHES_MAX = 2000;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** aaaa-mm-dd que existe no calendario (31/02 nao passa). */
export function ehDiaValido(dia: string): boolean {
  if (!DIA.test(dia)) {
    return false;
  }
  const [ano, mes, d] = dia.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, (mes ?? 1) - 1, d ?? 1));
  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === (mes ?? 1) - 1 &&
    data.getUTCDate() === d
  );
}

const tituloSchema = z
  .string()
  .trim()
  .min(TITULO_MIN, "Escreva o que fazer, com pelo menos 2 letras.")
  .max(TITULO_MAX, "Use até 120 caracteres.");

// Em branco vira null: o banco recusa detalhes so de espacos (23514).
const detalhesSchema = z
  .string()
  .max(DETALHES_MAX, "Use até 2000 caracteres nos detalhes.")
  .nullable()
  .optional()
  .transform((valor) => {
    const aparado = (valor ?? "").trim();
    return aparado === "" ? null : aparado;
  });

const diaSchema = z.string().refine(ehDiaValido, "Escolha o dia.");

const horaSchema = z
  .string()
  .regex(HORA, "Use a hora no formato 14:30.")
  .nullable()
  .optional()
  .transform((valor) => valor ?? null);

/** Formulario do dialogo (react-hook-form). Hora e responsavel podem ficar vazios. */
export const formularioDeAtividadeSchema = z.object({
  titulo: tituloSchema,
  detalhes: z
    .string()
    .max(DETALHES_MAX, "Use até 2000 caracteres nos detalhes."),
  dia: z.string().refine(ehDiaValido, "Escolha o dia."),
  hora: z.union([
    z.literal(""),
    z.string().regex(HORA, "Use a hora no formato 14:30."),
  ]),
  responsavel: z.string(),
});

export type ValoresDoFormularioDeAtividade = z.infer<
  typeof formularioDeAtividadeSchema
>;

/** Entrada da criacao (Server Action). */
export const criarAtividadeSchema = z.object({
  contact_id: z.uuid(),
  conversation_id: z.uuid().nullable().optional(),
  titulo: tituloSchema,
  detalhes: detalhesSchema,
  dia: diaSchema,
  hora: horaSchema,
  assignee_user_id: z.uuid().nullable(),
});

/** Entrada da edicao (Server Action). */
export const editarAtividadeSchema = z.object({
  id: z.uuid(),
  titulo: tituloSchema,
  detalhes: detalhesSchema,
  dia: diaSchema,
  hora: horaSchema,
  assignee_user_id: z.uuid().nullable(),
});

export const adiarAtividadeSchema = z.object({
  id: z.uuid(),
  dias: z.union([z.literal(1), z.literal(7), z.literal(30)]),
});

/** A RPC contagem_de_atividades: inteiros, nunca zero inventado. */
export const contagemDeAtividadesSchema = z.object({
  atrasadas: z.number().int().nonnegative(),
  hoje: z.number().int().nonnegative(),
  minhas_atrasadas: z.number().int().nonnegative(),
  minhas_hoje: z.number().int().nonnegative(),
});

export type ContagemDeAtividades = z.infer<typeof contagemDeAtividadesSchema>;

/**
 * Prazo de uma atividade NOVA: hoje ou depois, e com hora de hoje ainda por
 * vir. null quando esta certo; senao, a frase do erro. A edicao nao passa por
 * aqui (corrigir o texto de uma atrasada nao obriga a mudar o prazo).
 */
export function problemaNoPrazoNovo(
  dia: string,
  hora: string | null,
  agora: Date,
  timezone: string,
): string | null {
  const hoje = diaCivil(timezone, agora);
  if (dia < hoje) {
    return "Escolha hoje ou um dia depois.";
  }
  if (
    hora &&
    dia === hoje &&
    instanteLocal(timezone, dia, hora).getTime() <= agora.getTime()
  ) {
    return "Essa hora de hoje já passou. Escolha outra hora ou deixe sem hora.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Erros do banco em linguagem de recepcao
// ---------------------------------------------------------------------------

/**
 * Traduz o erro do PostgREST pelo CODIGO (contrato da migration). O texto do
 * banco so desempata o 23514, e nunca volta cru para a tela.
 */
export function mensagemDoErroDeAtividade(
  erro: { code?: string | null; message?: string | null } | null | undefined,
  padrao: string,
): string {
  const codigo = erro?.code ?? "";
  const texto = (erro?.message ?? "").toLowerCase();
  if (codigo === "42501") {
    return "Seu perfil não pode alterar atividades.";
  }
  if (codigo === "P0001" || codigo === "23503") {
    return "Contato não encontrado nesta clínica.";
  }
  if (codigo === "23514") {
    if (texto.includes("responsável") || texto.includes("responsavel")) {
      return "O responsável precisa ser alguém ativo da equipe desta clínica.";
    }
    if (texto.includes("conversa")) {
      return "A conversa escolhida não é deste contato.";
    }
    return "Confira os campos e tente de novo.";
  }
  return padrao;
}
