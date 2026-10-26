import type { SupabaseClient } from "@supabase/supabase-js";

import type { SituacaoDaConexao } from "@/components/whatsapp/numeros";
import type { Role } from "@/lib/domain/permissions";

// Leitura do Painel geral, so para a equipe Conduzza (super admin). Desde
// 26/10/2026 (pedido do dono, com o print do painel: "ele e para ser tipo
// uma visualizacao de CS"), o painel e o acompanhamento de cliente: quantas
// clinicas, quais estao em uso (alguem da equipe usou o sistema nos ultimos
// 30 dias), quem usou por ultimo, a equipe, o WhatsApp e o agente de IA.
// Contrato do banco em supabase/migrations/20261026100000_painel_cs.sql:
// - painel_cs_das_clinicas(): os totais do topo e uma linha por clinica
//   (sem as e_de_teste das suites);
// - equipe_da_clinica_no_painel(p_clinic_id): a secao Equipe do detalhe,
//   com os Implementadores numa lista separada (P18-5 da onda 5).
// As duas sao STABLE SECURITY DEFINER e recusam (42501) quem nao e
// is_product_admin(). painel_geral_das_clinicas (onda 1) nao e mais lida
// por aqui: ela sai numa limpeza depois. O codigo depende da migration
// aplicada (ordem de publicacao: a migration antes do codigo, escrita no
// cabecalho dela); sem as funcoes, o painel mostra o erro de leitura.
//
// O ultimo acesso e a ULTIMA ATIVIDADE (decisao do dono de 26/10/2026, "Pela
// ultima atividade"): o maior entre o ultimo login (auth.users.
// last_sign_in_at) e a renovacao das sessoes da pessoa (auth.sessions), que
// o sistema faz enquanto ela usa; a tela diz isso. A equipe Conduzza com
// vinculo ativo conta como qualquer vinculo (o desenho: "dos membros
// ATIVOS"; o dono confirmou em 26/10/2026) e vem marcada, para a tela dizer
// quando o ultimo acesso foi dela.
//
// SO CONTAGENS DE PACIENTE: nenhum dado de paciente passa por aqui (nem
// nome, nem telefone, nem conteudo). Nome, e-mail, papel e o ultimo acesso
// sao da EQUIPE da clinica (dado de operacao); o numero de WhatsApp chega so
// com os 4 ultimos digitos. Nada daqui vai para log.
//
// O formato do banco e conferido aqui (lerPainelDoBanco e
// lerEquipeDoBanco): campo essencial fora do formato LANCA, e a tela mostra
// o erro com "Tentar de novo", nunca um painel que afirma o que nao
// conferiu (uma clinica "em uso" sem o acesso que prova, uma "ativa" que
// pode estar suspensa, um gasto zero que nao foi lido). Item de lista que so
// serve a busca ou fora do formato (um numero sem id) fica de fora, como nas
// outras leituras.
//
// Onda 2 (item 11): o leitor entende 'producao' (estado do agente) e
// 'numero_inteiro' (modo da liberacao). Os requisitos da producao
// (requisitos_da_producao, so do super admin, com o registro da equipe
// Conduzza no detalhe de cada um) tem leitura propria: antes da migration da
// producao, "indisponivel" (o cartao diz que a producao ainda nao chegou),
// nunca o erro.

/** A conta da clinica: ativa ou suspensa (clinica_suspensa). */
export type SituacaoDaConta = "ativa" | "suspensa";

/** O agente da clinica (ia_clinica_habilitada). */
export type EstadoDoAgente = "desligado" | "teste" | "producao";

/** O modo gravado em ia_liberacao. */
export type ModoDoAgenteNoPainel = "simulador" | "contatos" | "numero_inteiro";

/** Um numero de WhatsApp da clinica (sem os removidos). */
export type NumeroNoPainel = {
  /** whatsapp_account.id */
  id: string;
  /** O nome dado pela equipe ("Recepção"). */
  nome: string;
  /** Os 4 ultimos digitos do telefone pareado; nulo se nunca pareou. */
  final: string | null;
  conexao: SituacaoDaConexao;
  /** O numero esta ligado ao agente (ia_numero_liberado.ativo). */
  iaLigada: boolean;
};

/**
 * Quem da equipe da clinica usou o sistema por ultimo, e quando: a ultima
 * atividade mais recente (o login ou a renovacao da sessao) dos vinculos
 * ATIVOS, a equipe Conduzza inclusive (marcada). Dado da equipe, nao de
 * paciente.
 */
export type UltimoAcessoNoPainel = {
  /** O instante da ultima atividade (o maior entre o login e a renovacao da sessao). */
  em: string;
  userId: string;
  /** profile.name; nulo sem nome no perfil. */
  nome: string | null;
  email: string | null;
  /** O papel na clinica; nulo quando o banco manda um que a tela nao conhece. */
  papel: Role | null;
  /** A pessoa tem a marca de Implementador nesta clinica. */
  implementador: boolean;
  /** A pessoa e da equipe Conduzza (super admin): a tela diz que foi ela. */
  equipeConduzza: boolean;
};

/** Uma pessoa da equipe, so para a busca da lista (dado da equipe). */
export type PessoaNaBusca = {
  nome: string | null;
  email: string | null;
};

/** O agente da clinica, como o painel mostra. */
export type AgenteNoPainel = {
  estado: EstadoDoAgente;
  /** ia_liberacao.modo; nulo quando a clinica nunca teve a linha. */
  modo: ModoDoAgenteNoPainel | null;
  /** ia_liberacao.liberada (a escolha da propria clinica). */
  liberada: boolean;
  pausadaPelaClinica: boolean;
  /** Telefones da equipe ligados (ia_contato_liberado.ativo). */
  telefonesLigados: number;
};

/**
 * O gasto da IA em centavos de dolar, arredondado pelo banco. As 24 horas
 * sao a janela movel do teto; o mes e o mes corrente no fuso da clinica. O
 * "sem simulador" tira o gasto dos testes dentro do sistema.
 */
export type GastoNoPainel = {
  ultimas24hCentavos: number;
  mesCentavos: number;
  ultimas24hSemSimuladorCentavos: number;
  mesSemSimuladorCentavos: number;
};

export type SuspensaoNoPainel = {
  suspensaEm: string;
  motivo: string;
};

export type ClinicaNoPainel = {
  id: string;
  nome: string;
  criadaEm: string;
  /** clinic.timezone (CLAUDE.md 3.6); o padrao quando vem vazio. */
  fuso: string;
  /**
   * Alguem da equipe da clinica usou o sistema nos ultimos 30 dias,
   * contados do relogio do banco na leitura (geradoEm). Sem ultimo acesso,
   * falso.
   */
  emUso: boolean;
  /** Nulo: ninguem com vinculo ativo na clinica entrou ainda. */
  ultimoAcesso: UltimoAcessoNoPainel | null;
  /** Vinculos ativos (o Implementador e a equipe Conduzza contam). */
  membrosAtivos: number;
  /** Pedidos de entrada esperando liberacao (a equipe Conduzza conta). */
  membrosPendentes: number;
  /** Dos ativos, quantos sao da equipe Conduzza (ja contados em membrosAtivos). */
  membrosEquipeConduzza: number;
  /** Todo vinculo da clinica (qualquer situacao), so para a busca. */
  pessoas: PessoaNaBusca[];
  /** Numeros de WhatsApp sem os removidos. */
  numerosTotal: number;
  numerosConectados: number;
  numeros: NumeroNoPainel[];
  /** Total de contatos (leads e pacientes), so a contagem. */
  contatos: number;
  /** Leads novos nos ultimos 30 dias (pelo primeiro contato). */
  leads30Dias: number;
  /** Conversas criadas nos ultimos 30 dias. */
  conversas30Dias: number;
  /** A mensagem recebida mais recente (max de last_inbound_at), ou nulo. */
  ultimaMensagemEm: string | null;
  /** Nula: a conta esta ativa. */
  suspensao: SuspensaoNoPainel | null;
  agente: AgenteNoPainel;
  gasto: GastoNoPainel;
  /** ia_liberacao.teto_diario_centavos_usd; nulo sem a linha. */
  tetoDiarioCentavos: number | null;
};

/** Os cartoes do topo (em_uso + sem_uso = clinicas; as suspensas, a parte). */
export type TotaisDoPainel = {
  clinicas: number;
  emUso: number;
  semUso: number;
  suspensas: number;
  /** Agente em Teste ou em Producao. */
  agenteLiberado: number;
  /** O mes corrente de todas as clinicas, cada uma no proprio fuso. */
  gastoMesCentavos: number;
};

export type PainelGeral = {
  /** O relogio do banco na leitura: os 30 dias do uso contam daqui. */
  geradoEm: string;
  totais: TotaisDoPainel;
  /** Ultimo acesso mais recente primeiro; quem nunca entrou no fim. */
  clinicas: ClinicaNoPainel[];
};

/** Os dois tetos da IA da clinica, como estao em ia_liberacao. */
export type TetosDaIa = {
  tetoDiarioCentavos: number;
  tetoRespostasPorConversaHora: number;
};

/** A situacao do vinculo da pessoa (clinic_member.status). */
export type SituacaoDoMembro = "ativo" | "pendente" | "inativo";

/** Uma pessoa da equipe da clinica no detalhe (dado da equipe). */
export type PessoaDaEquipe = {
  userId: string;
  /** profile.name; nulo sem nome no perfil. */
  nome: string | null;
  email: string | null;
  /** O papel do vinculo; o Implementador e sempre admin. */
  papel: Role;
  situacao: SituacaoDoMembro;
  /** A ultima atividade da pessoa, qualquer que seja a situacao; nulo: nunca. */
  ultimoAcessoEm: string | null;
  /**
   * E da equipe Conduzza (super admin): aparece marcada; ativa, conta no
   * uso e nas contagens como qualquer vinculo.
   */
  equipeConduzza: boolean;
};

/**
 * A equipe de uma clinica: as pessoas sem a marca de Implementador e, numa
 * lista separada, as com a marca (P18-5). Ordem do banco: situacao, papel e
 * nome.
 */
export type EquipeNoPainel = {
  equipe: PessoaDaEquipe[];
  implementadores: PessoaDaEquipe[];
};

export const FUSO_PADRAO_DO_PAINEL = "America/Fortaleza";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SITUACOES_DA_CONEXAO: readonly SituacaoDaConexao[] = [
  "conectado",
  "conectando",
  "aguardando_qr",
  "desconectado",
];

const PAPEIS: readonly Role[] = [
  "admin",
  "gestor",
  "recepcao",
  "profissional",
  "leitura",
];

const SITUACOES_DO_MEMBRO: readonly SituacaoDoMembro[] = [
  "ativo",
  "pendente",
  "inativo",
];

function ilegivel(): never {
  throw new Error("painel geral ilegivel");
}

function objeto(valor: unknown): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return ilegivel();
  }
  return valor as Record<string, unknown>;
}

/** Contagem ou valor em centavos: inteiro e nunca negativo. */
function contagem(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0) {
    return ilegivel();
  }
  return valor;
}

function contagemOuNula(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : contagem(valor);
}

function texto(valor: unknown): string {
  if (typeof valor !== "string" || valor.trim() === "") {
    return ilegivel();
  }
  return valor;
}

function textoOuNulo(valor: unknown): string | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor !== "string") {
    return ilegivel();
  }
  return valor.trim() === "" ? null : valor;
}

function instante(valor: unknown): string {
  const lido = texto(valor);
  return Number.isNaN(Date.parse(lido)) ? ilegivel() : lido;
}

function instanteOuNulo(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : instante(valor);
}

function booleano(valor: unknown): boolean {
  return typeof valor === "boolean" ? valor : ilegivel();
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : ilegivel();
}

function uuid(valor: unknown): string {
  const lido = texto(valor);
  return UUID.test(lido) ? lido : ilegivel();
}

/** Valor do banco na situacao da tela; o desconhecido e desconectado. */
function conexaoDoBanco(valor: unknown): SituacaoDaConexao {
  return (
    SITUACOES_DA_CONEXAO.find((situacao) => situacao === valor) ??
    "desconectado"
  );
}

/** Os 4 ultimos digitos, so digitos; outro formato vira nulo. */
function finalDoBanco(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

function numeroDoBanco(valor: unknown): NumeroNoPainel[] {
  if (typeof valor !== "object" || valor === null) {
    return [];
  }
  const n = valor as Record<string, unknown>;
  if (typeof n.id !== "string" || !UUID.test(n.id)) {
    return [];
  }
  return [
    {
      id: n.id,
      nome:
        typeof n.nome === "string" && n.nome.trim() !== ""
          ? n.nome
          : "Número sem nome",
      final: finalDoBanco(n.final),
      conexao: conexaoDoBanco(n.conexao),
      iaLigada: n.ia_ligada === true,
    },
  ];
}

/** Uma pessoa da busca; sem nome e sem e-mail nao acha nada e fica de fora. */
function pessoaNaBuscaDoBanco(valor: unknown): PessoaNaBusca[] {
  if (typeof valor !== "object" || valor === null) {
    return [];
  }
  const p = valor as Record<string, unknown>;
  const nome = typeof p.nome === "string" && p.nome.trim() ? p.nome : null;
  const email = typeof p.email === "string" && p.email.trim() ? p.email : null;
  return nome || email ? [{ nome, email }] : [];
}

/** O papel do banco; o que a tela nao conhece vira nulo (nao se mostra). */
function papelOuNulo(valor: unknown): Role | null {
  return PAPEIS.find((papel) => papel === valor) ?? null;
}

function ultimoAcessoDoBanco(valor: unknown): UltimoAcessoNoPainel | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  const a = objeto(valor);
  return {
    em: instante(a.em),
    userId: uuid(a.user_id),
    nome: textoOuNulo(a.nome),
    email: textoOuNulo(a.email),
    papel: papelOuNulo(a.papel),
    implementador: booleano(a.implementador),
    equipeConduzza: booleano(a.equipe_conduzza),
  };
}

function estadoDoAgenteDoBanco(valor: unknown): EstadoDoAgente {
  // Sem linha em ia_clinica_habilitada: desligado (o banco devolve nulo ou
  // 'desligado'). Qualquer outro valor fora dos tres e banco e codigo
  // desencontrados: o painel mostra o erro.
  if (valor === null || valor === undefined || valor === "desligado") {
    return "desligado";
  }
  return valor === "teste" || valor === "producao" ? valor : ilegivel();
}

function modoDoBanco(valor: unknown): AgenteNoPainel["modo"] {
  if (valor === null || valor === undefined) {
    return null;
  }
  return valor === "simulador" ||
    valor === "contatos" ||
    valor === "numero_inteiro"
    ? valor
    : ilegivel();
}

function agenteDoBanco(valor: unknown): AgenteNoPainel {
  const a = objeto(valor);
  return {
    estado: estadoDoAgenteDoBanco(a.estado),
    modo: modoDoBanco(a.modo),
    liberada:
      a.liberada === null || a.liberada === undefined
        ? false
        : booleano(a.liberada),
    pausadaPelaClinica:
      a.pausada_pela_clinica === null || a.pausada_pela_clinica === undefined
        ? false
        : booleano(a.pausada_pela_clinica),
    telefonesLigados: contagem(a.telefones_ligados ?? 0),
  };
}

function gastoDoBanco(valor: unknown): GastoNoPainel {
  const g = objeto(valor);
  return {
    ultimas24hCentavos: contagem(g.ultimas_24h_centavos_usd),
    mesCentavos: contagem(g.mes_centavos_usd),
    ultimas24hSemSimuladorCentavos: contagem(
      g.ultimas_24h_sem_simulador_centavos_usd,
    ),
    mesSemSimuladorCentavos: contagem(g.mes_sem_simulador_centavos_usd),
  };
}

function suspensaoDoBanco(valor: unknown): SuspensaoNoPainel | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  const s = objeto(valor);
  return { suspensaEm: instante(s.suspensa_em), motivo: texto(s.motivo) };
}

function clinicaDoBanco(valor: unknown): ClinicaNoPainel {
  const c = objeto(valor);
  const fuso = textoOuNulo(c.fuso);
  const ultimoAcesso = ultimoAcessoDoBanco(c.ultimo_acesso);
  const emUso = booleano(c.em_uso);
  // "Em uso" sem o acesso que prova, ou mais gente da equipe Conduzza do
  // que ativas, e banco e codigo desencontrados: o painel nunca afirma o
  // que nao conferiu.
  if (emUso && ultimoAcesso === null) {
    return ilegivel();
  }
  const membrosAtivos = contagem(c.membros_ativos);
  const membrosEquipeConduzza = contagem(c.membros_equipe_conduzza);
  if (membrosEquipeConduzza > membrosAtivos) {
    return ilegivel();
  }
  return {
    id: uuid(c.id),
    nome: texto(c.nome),
    criadaEm: instante(c.criada_em),
    fuso: fuso ?? FUSO_PADRAO_DO_PAINEL,
    emUso,
    ultimoAcesso,
    membrosAtivos,
    membrosPendentes: contagem(c.membros_pendentes),
    membrosEquipeConduzza,
    pessoas: lista(c.pessoas ?? []).flatMap(pessoaNaBuscaDoBanco),
    numerosTotal: contagem(c.numeros_total),
    numerosConectados: contagem(c.numeros_conectados),
    numeros: lista(c.numeros ?? []).flatMap(numeroDoBanco),
    contatos: contagem(c.contatos),
    leads30Dias: contagem(c.leads_30_dias),
    conversas30Dias: contagem(c.conversas_30_dias),
    ultimaMensagemEm: instanteOuNulo(c.ultima_mensagem_em),
    suspensao: suspensaoDoBanco(c.suspensao),
    agente: agenteDoBanco(c.agente),
    gasto: gastoDoBanco(c.gasto),
    tetoDiarioCentavos: contagemOuNula(c.teto_diario_centavos_usd),
  };
}

function totaisDoBanco(valor: unknown): TotaisDoPainel {
  const t = objeto(valor);
  return {
    clinicas: contagem(t.clinicas),
    emUso: contagem(t.em_uso),
    semUso: contagem(t.sem_uso),
    suspensas: contagem(t.suspensas),
    agenteLiberado: contagem(t.agente_liberado),
    gastoMesCentavos: contagem(t.gasto_mes_centavos_usd),
  };
}

/** O jsonb de painel_cs_das_clinicas(). Formato estranho: lanca. */
export function lerPainelDoBanco(valor: unknown): PainelGeral {
  const p = objeto(valor);
  return {
    geradoEm: instante(p.gerado_em),
    totais: totaisDoBanco(p.totais),
    clinicas: lista(p.clinicas).map(clinicaDoBanco),
  };
}

/**
 * O painel inteiro, com a sessao (a RPC confere o super admin). Erro do
 * banco ou formato estranho: lanca, e a tela mostra o erro.
 */
export async function fetchPainelGeral(
  supabase: SupabaseClient,
): Promise<PainelGeral> {
  const { data, error } = await supabase.rpc("painel_cs_das_clinicas");
  if (error) {
    throw new Error("leitura do painel geral falhou");
  }
  return lerPainelDoBanco(data);
}

/**
 * Uma clinica do painel, pela mesma RPC, com o relogio da leitura. Nula
 * quando nao esta no painel (id que nao existe ou clinica e_de_teste das
 * suites). Lanca como fetchPainelGeral.
 */
export async function fetchClinicaDoPainel(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<{ clinica: ClinicaNoPainel; geradoEm: string } | null> {
  const id = clinicId.trim().toLowerCase();
  const painel = await fetchPainelGeral(supabase);
  const clinica =
    painel.clinicas.find((linha) => linha.id.toLowerCase() === id) ?? null;
  return clinica ? { clinica, geradoEm: painel.geradoEm } : null;
}

/**
 * Um numero de WhatsApp da clinica, pelo painel: para o "Ligar" do numero
 * feito pelo Painel geral, que confere a conexao no servidor como a aba de
 * Configuracoes. A leitura direta de whatsapp_account e so de membro ativo
 * da clinica (RLS), e a equipe Conduzza nem sempre e membro; o painel e
 * SECURITY DEFINER e so do super admin. Nulo: o numero nao e (mais) da
 * clinica. Lanca como fetchPainelGeral.
 */
export async function fetchNumeroDaClinicaNoPainel(
  supabase: SupabaseClient,
  clinicId: string,
  whatsappAccountId: string,
): Promise<NumeroNoPainel | null> {
  const lida = await fetchClinicaDoPainel(supabase, clinicId);
  const id = whatsappAccountId.trim().toLowerCase();
  return (
    lida?.clinica.numeros.find((numero) => numero.id.toLowerCase() === id) ??
    null
  );
}

// ---------------------------------------------------------------------------
// A equipe da clinica no detalhe (equipe_da_clinica_no_painel)
// ---------------------------------------------------------------------------

function pessoaDaEquipeDoBanco(valor: unknown): PessoaDaEquipe {
  const p = objeto(valor);
  // Papel e situacao fora dos que o banco aceita (os CHECKs de
  // clinic_member) sao banco e codigo desencontrados: a secao mostra o
  // erro, nunca um rotulo inventado nem uma pessoa a menos.
  const papel = PAPEIS.find((valido) => valido === p.papel) ?? ilegivel();
  const situacao =
    SITUACOES_DO_MEMBRO.find((valida) => valida === p.situacao) ?? ilegivel();
  return {
    userId: uuid(p.user_id),
    nome: textoOuNulo(p.nome),
    email: textoOuNulo(p.email),
    papel,
    situacao,
    ultimoAcessoEm: instanteOuNulo(p.ultimo_acesso_em),
    equipeConduzza: booleano(p.equipe_conduzza),
  };
}

/**
 * O jsonb de equipe_da_clinica_no_painel(p_clinic_id). Nulo: a clinica nao
 * existe (o banco devolve null). Formato estranho: lanca.
 */
export function lerEquipeDoBanco(valor: unknown): EquipeNoPainel | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  const e = objeto(valor);
  return {
    equipe: lista(e.equipe).map(pessoaDaEquipeDoBanco),
    implementadores: lista(e.implementadores).map(pessoaDaEquipeDoBanco),
  };
}

/**
 * A equipe de uma clinica, com a sessao (a RPC confere o super admin). Nula:
 * a clinica nao existe. Erro do banco ou formato estranho: lanca, e a secao
 * mostra o erro no lugar dela.
 */
export async function fetchEquipeDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<EquipeNoPainel | null> {
  const { data, error } = await supabase.rpc("equipe_da_clinica_no_painel", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error("leitura da equipe da clinica falhou");
  }
  return lerEquipeDoBanco(data);
}

// ---------------------------------------------------------------------------
// Teto da IA
// ---------------------------------------------------------------------------

/**
 * Os dois tetos da IA da clinica (ia_liberacao, que o super admin le pela
 * policy propria). Nulo: a clinica nunca teve a linha (o teto nasce quando
 * o agente e ligado em teste pela primeira vez). Lanca se a leitura falhar.
 */
export async function fetchTetosDaIa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<TetosDaIa | null> {
  const { data, error } = await supabase
    .from("ia_liberacao")
    .select("teto_diario_centavos_usd, teto_respostas_por_conversa_hora")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    throw new Error("leitura dos tetos da IA falhou");
  }
  const linha = data as {
    teto_diario_centavos_usd: number;
    teto_respostas_por_conversa_hora: number;
  } | null;
  return linha
    ? {
        tetoDiarioCentavos: linha.teto_diario_centavos_usd,
        tetoRespostasPorConversaHora: linha.teto_respostas_por_conversa_hora,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Requisitos da producao (onda 2, item 11; contrato secao 3.3)
// ---------------------------------------------------------------------------

/**
 * O registro da equipe Conduzza que vale para a clinica, como
 * requisitos_da_producao devolve no detalhe: o vivo (com a evidencia, a
 * data e se vale para todas) ou, sem vivo, o ultimo revogado (com a data e
 * o motivo). Texto da equipe Conduzza, nunca dado de paciente.
 */
export type RegistroDoRequisito = {
  id: string;
  revogado: boolean;
  evidencia: string | null;
  registradoEm: string | null;
  /** Vale para todas as clinicas (clinic_id nulo); nulo: o banco nao disse. */
  geral: boolean | null;
  revogadoEm: string | null;
  motivoDaRevogacao: string | null;
};

/**
 * Um requisito como requisitos_da_producao(p_clinic_id) devolve: a chave,
 * se esta cumprido, de onde vem (o banco confere ou a equipe registra) e o
 * que a tela mostra. Os conferidos pelo banco trazem o que viram (estado do
 * agente, versao, publico, modo de horario, numeros conectados); os da
 * equipe, o registro.
 */
export type RequisitoConferido = {
  chave: string;
  ok: boolean;
  origem: "banco" | "equipe";
  registro: RegistroDoRequisito | null;
  conferido: {
    estado: string | null;
    versao: number | null;
    publico: string | null;
    modo: string | null;
    conectados: number | null;
  };
};

/**
 * Os requisitos de uma clinica. "indisponivel": o banco ainda nao tem a
 * migration da producao (a funcao nao existe), e o cartao diz que a
 * producao ainda nao chegou, sem afirmar requisito nenhum.
 */
export type RequisitosDaProducao =
  | { estado: "indisponivel" }
  | { estado: "lido"; conferidos: RequisitoConferido[] };

/**
 * Codigos de "isto ainda nao existe no banco": a funcao (PGRST202 do
 * PostgREST, 42883 do Postgres). So a leitura dos requisitos tolera: e o
 * que a migration da producao traz.
 */
const AINDA_NAO_EXISTE = new Set(["PGRST202", "42883"]);

function textoOuNuloSolto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function inteiroOuNulo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

function instanteOuNuloSolto(valor: unknown): string | null {
  return typeof valor === "string" && !Number.isNaN(Date.parse(valor))
    ? valor
    : null;
}

function registroDoDetalhe(
  detalhe: Record<string, unknown>,
): RegistroDoRequisito | null {
  if (typeof detalhe.id !== "string" || !UUID.test(detalhe.id)) {
    return null;
  }
  return {
    id: detalhe.id,
    revogado: detalhe.revogado === true,
    evidencia: textoOuNuloSolto(detalhe.evidencia),
    registradoEm: instanteOuNuloSolto(detalhe.registrado_em),
    geral: typeof detalhe.geral === "boolean" ? detalhe.geral : null,
    revogadoEm: instanteOuNuloSolto(detalhe.revogado_em),
    motivoDaRevogacao: textoOuNuloSolto(detalhe.motivo_da_revogacao),
  };
}

function requisitoConferidoDoBanco(valor: unknown): RequisitoConferido[] {
  if (typeof valor !== "object" || valor === null) {
    return [];
  }
  const r = valor as Record<string, unknown>;
  if (typeof r.chave !== "string" || r.chave.trim() === "") {
    return [];
  }
  const detalhe =
    typeof r.detalhe === "object" && r.detalhe !== null
      ? (r.detalhe as Record<string, unknown>)
      : {};
  return [
    {
      chave: r.chave,
      // So o verdadeiro cumpre: qualquer outro valor e "falta" (falha
      // fechada; a producao nunca libera pelo que nao foi conferido).
      ok: r.ok === true,
      origem: detalhe.origem === "equipe" ? "equipe" : "banco",
      registro: registroDoDetalhe(detalhe),
      conferido: {
        estado: textoOuNuloSolto(detalhe.estado),
        versao: inteiroOuNulo(detalhe.versao),
        publico: textoOuNuloSolto(detalhe.publico),
        modo: textoOuNuloSolto(detalhe.modo),
        conectados: inteiroOuNulo(detalhe.conectados),
      },
    },
  ];
}

/** O jsonb de requisitos_da_producao. Fora do formato (nao lista): lanca. */
export function lerRequisitosDoBanco(valor: unknown): RequisitoConferido[] {
  return lista(valor).flatMap(requisitoConferidoDoBanco);
}

/**
 * Os requisitos da producao de uma clinica, com a sessao (a RPC e so do
 * super admin): o que o banco confere e, nos da equipe Conduzza, o registro
 * que vale para ela (o da clinica ou o de todas; sem vivo, o ultimo
 * revogado). Banco sem a migration da producao: "indisponivel". Outro erro
 * ou formato estranho: lanca, e o cartao mostra o erro.
 */
export async function fetchRequisitosDaProducao(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<RequisitosDaProducao> {
  const { data, error } = await supabase.rpc("requisitos_da_producao", {
    p_clinic_id: clinicId,
  });
  if (error?.code && AINDA_NAO_EXISTE.has(error.code)) {
    return { estado: "indisponivel" };
  }
  if (error) {
    throw new Error("leitura dos requisitos da producao falhou");
  }
  return { estado: "lido", conferidos: lerRequisitosDoBanco(data) };
}
