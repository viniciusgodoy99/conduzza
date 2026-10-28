import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import type { ConfigDoAgente } from "@/lib/domain/agente/config";

import { rpcsDaAg5, type OpcoesDaAg5 } from "./ag5-contrato";
import { CenarioDaAg4, configDaAg4 } from "./ag4-conversa";
import type { Linha } from "./agenda-em-memoria";
import {
  AGORA,
  catalogoDaAgenda,
  CLINICA,
  codigoDoProcedimento,
  codigoDoProfissional,
  CONTATO,
  CONVERSA,
  PROC,
  PROF,
} from "./agenda-fixtures";

// O cenario das conversas da AG5 (a lista de espera pela IA) com o LLM
// FALSO de roteiro, sobre o contrato das RPCs em memoria (ag5-contrato.ts,
// mais os da AG3 e da AG4, que o cenario da AG4 ja liga): a mesma conversa
// da AG4 (a tabela message do banco em memoria, a autoria real, as lidas de
// cada job, o estado gravado entre os turnos), com a clinica ficticia da E4
// (uma unidade so: a lista de espera nao guarda a unidade, D-38) e a janela
// da IA aberta uma hora antes de agora. Nenhum teste fala com a OpenAI nem
// com o banco.
//
// A clinica: agora e terca, 20/10/2026, 09:00 em Fortaleza. A Dra. Ana Lima
// atende de segunda a sexta, das 08:00 as 12:00 e das 14:00 as 18:00; o Dr.
// Bruno Costa, terca e quinta, das 13:00 as 17:00. Ninguem atende a noite: a
// busca "a noite" da sem_horario.

export const CATALOGO_DA_AG5: CatalogoDoAgente = catalogoDaAgenda();
export const P_LIMPEZA = codigoDoProcedimento(CATALOGO_DA_AG5, PROC.limpeza);
export const P_CONSULTA = codigoDoProcedimento(CATALOGO_DA_AG5, PROC.consulta);
export const R_ANA = codigoDoProfissional(CATALOGO_DA_AG5, PROF.ana);
export const R_BRUNO = codigoDoProfissional(CATALOGO_DA_AG5, PROF.bruno);

/** A janela da IA na conversa: aberta uma hora antes de agora. */
export const JANELA_DESDE = new Date(AGORA - 60 * 60_000).toISOString();

/** A configuracao da AG4 com a lista de espera ligada. */
export function configDaAg5(
  extra: Partial<ConfigDoAgente> = {},
): ConfigDoAgente {
  const base = configDaAg4();
  return {
    ...base,
    habilidades: { ...base.habilidades, lista_de_espera: true },
    ...extra,
  };
}

/** Os argumentos de buscar_horario (a limpeza de pele, sem preferencia). */
export function busca(extra: Record<string, unknown> = {}) {
  return {
    procedimento: P_LIMPEZA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...extra,
  };
}

/** O que o banco da AG5 responde (as marcas que a frente de banco confere). */
export type MarcasDaAg5 = {
  ligada: boolean;
  iaAtendendo: boolean;
  unidadesAtivas: number;
  autorizado: boolean;
  paraOutraPessoa: boolean;
  menorDeIdade: boolean;
  /** A resposta forcada de cada RPC (o motivo, "22023" ou "fora_do_formato"). */
  forcar: { pedir?: string | null; entrar?: string | null };
};

export class CenarioDaAg5 extends CenarioDaAg4 {
  readonly marcas: MarcasDaAg5 = {
    ligada: true,
    iaAtendendo: true,
    unidadesAtivas: 1,
    autorizado: true,
    paraOutraPessoa: false,
    menorDeIdade: false,
    forcar: {},
  };

  constructor(
    e: {
      config?: ConfigDoAgente;
      atendimento?: AtendimentoDoTurno;
      catalogo?: CatalogoDoAgente;
      marcas?: Partial<MarcasDaAg5>;
    } = {},
  ) {
    super({
      config: e.config ?? configDaAg5(),
      catalogo: e.catalogo ?? CATALOGO_DA_AG5,
      ...(e.atendimento === undefined ? {} : { atendimento: e.atendimento }),
    });
    Object.assign(this.marcas, e.marcas ?? {});
    // A clinica da E4 nao tem unidade: a jornada vale para todas.
    for (const linha of this.banco.linhas("professional_schedule")) {
      linha.unit_id = null;
    }
    this.banco.inserir("ia_janela_da_conversa", {
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      desde: JANELA_DESDE,
      aberta_por: "ingestao",
    });
    const opcoes: OpcoesDaAg5 = {
      catalogo: this.catalogo,
      agora: () => this.agora,
      conversa: () => this.noBanco,
      lidas: (job) => this.lidasPorJob.get(job),
      turnos: () =>
        this.jobs.map((job) => ({
          job_id: job,
          estado: this.estadoDoTurnoPorJob.get(job) ?? "reservado",
          mensagens_lidas: [...(this.lidasPorJob.get(job) ?? [])],
        })),
      ligada: () => this.marcas.ligada,
      iaAtendendo: () => this.marcas.iaAtendendo,
      unidadesAtivas: () => this.marcas.unidadesAtivas,
      autorizado: () => this.marcas.autorizado,
      paraOutraPessoa: () => this.marcas.paraOutraPessoa,
      menorDeIdade: () => this.marcas.menorDeIdade,
      forcar: () => this.marcas.forcar,
    };
    rpcsDaAg5(this.banco, opcoes);
  }

  /** Os pedidos da lista de espera desta conversa (ia_pedido_de_espera). */
  get pedidos(): Linha[] {
    return this.banco.linhas("ia_pedido_de_espera");
  }

  /** As entradas da fila (waitlist). */
  get fila(): Linha[] {
    return this.banco.linhas("waitlist");
  }

  /** Os eventos do fio da conversa (o texto do evento da entrada). */
  get eventos(): string[] {
    return this.banco
      .linhas("message")
      .filter((m) => m.content_type === "evento" && typeof m.body === "string")
      .map((m) => String(m.body));
  }
}

/** A T-E1 do exemplo do desenho (Limpeza de pele, Dra. Ana, a noite). */
export const T_E1_ANA_NOITE_SEG_QUA =
  "Confirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.";

/** A T-E2 do mesmo pedido. */
export const T_E2_ANA_NOITE_SEG_QUA =
  "Pronto, você entrou na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas. Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp.";
