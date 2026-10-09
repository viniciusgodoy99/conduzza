import {
  ativarItemDaBaseAction,
  excluirItemDaBaseAction,
  publicarAgenteAction,
  restaurarVersaoAction,
  salvarHabilidadesAction,
  salvarHorarioAction,
  salvarInstrucoesAction,
  salvarItemDaBaseAction,
  salvarPersonaAction,
  simularAction,
} from "@/app/(app)/agente/actions";
import type { EntradaDaSimulacao } from "@/components/agente/simulador";
import type {
  PassoDaTrilha,
  ResultadoDaAcao,
  ResultadoDaSimulacao,
} from "@/components/agente/tipos";
import type {
  HabilidadesDoAgente,
  HorarioDeOperacao,
  InstrucoesEntrada,
  ItemDaBaseEntrada,
  PersonaDoAgente,
  ProblemaDaPublicacao,
} from "@/lib/domain/agente/config";

// O UNICO lugar da tela que conhece o formato das Server Actions do agente
// (app/(app)/agente/actions.ts): o painel e o simulador falam com este
// contrato, e qualquer mudanca de assinatura da acao se ajusta aqui. Os
// testes de tela trocam este modulo inteiro (vi.mock).

export type ResultadoDaPublicacao =
  { ok: true } | { ok: false; erro: string; problemas: ProblemaDaPublicacao[] };

export type AcoesDoAgente = {
  salvarPersona: (persona: PersonaDoAgente) => Promise<ResultadoDaAcao>;
  salvarHabilidades: (
    habilidades: HabilidadesDoAgente,
  ) => Promise<ResultadoDaAcao>;
  salvarHorario: (horario: HorarioDeOperacao) => Promise<ResultadoDaAcao>;
  salvarItemDaBase: (item: ItemDaBaseEntrada) => Promise<ResultadoDaAcao>;
  ativarItemDaBase: (id: string, ativo: boolean) => Promise<ResultadoDaAcao>;
  excluirItemDaBase: (id: string) => Promise<ResultadoDaAcao>;
  salvarInstrucoes: (entrada: InstrucoesEntrada) => Promise<ResultadoDaAcao>;
  publicar: () => Promise<ResultadoDaPublicacao>;
  restaurarVersao: (versao: number) => Promise<ResultadoDaAcao>;
  simular: (entrada: EntradaDaSimulacao) => Promise<ResultadoDaSimulacao>;
};

/** ResultadoDoAgente e ResultadoDoItemDaBase das acoes ({ ok, error }). */
type RespostaDaAcao = { ok: true } | { ok: false; error: string };

function resultado(r: RespostaDaAcao): ResultadoDaAcao {
  return r.ok ? { ok: true } : { ok: false, erro: r.error };
}

export const acoesDoAgente: AcoesDoAgente = {
  salvarPersona: async (persona) =>
    resultado(await salvarPersonaAction(persona)),
  salvarHabilidades: async (habilidades) =>
    resultado(await salvarHabilidadesAction(habilidades)),
  salvarHorario: async (horario) =>
    resultado(await salvarHorarioAction(horario)),
  salvarItemDaBase: async (item) =>
    resultado(await salvarItemDaBaseAction(item)),
  ativarItemDaBase: async (id, ativo) =>
    resultado(await ativarItemDaBaseAction({ id, ativo })),
  excluirItemDaBase: async (id) =>
    resultado(await excluirItemDaBaseAction({ id })),
  salvarInstrucoes: async (entrada) =>
    resultado(await salvarInstrucoesAction(entrada)),
  publicar: async () => {
    const r = await publicarAgenteAction();
    return r.ok
      ? { ok: true }
      : { ok: false, erro: r.error, problemas: r.problemas ?? [] };
  },
  restaurarVersao: async (versao) =>
    resultado(await restaurarVersaoAction({ versao })),
  simular: async (entrada) => {
    const r = await simularAction(entrada);
    if (!r.ok) {
      return { ok: false, erro: r.error };
    }
    const trilha: PassoDaTrilha[] = r.trilha;
    return {
      ok: true,
      resposta: r.resposta,
      tipo: r.tipo,
      trilha,
      rascunhoBloqueado: r.rascunhoBloqueado,
      assinatura: r.assinatura,
    };
  },
};
