import { describe, expect, it } from "vitest";

import { DICA_CONSULTA_PENDENTE } from "@/lib/domain/appointment-status";
import { estadoDoConfirmarManual } from "@/lib/queries/confirmacoes";

// Revisao da onda 2 (item 10): na tela Confirmacoes, a consulta que ainda
// espera a aprovacao da equipe (a que a IA marcou nasce 'pendente') mostrava
// "Confirmar manualmente" habilitado, e so o servidor recusava depois do
// clique e da escolha do canal. A acao que nao pode ser feita fica visivel e
// desabilitada, com a mesma dica da Agenda.

const SEM_PERMISSAO = "Seu perfil não pode alterar a agenda";

describe("Confirmar manualmente na lista de confirmações", () => {
  it("a consulta pendente de aprovação fica desabilitada, com a dica da Agenda", () => {
    for (const status of ["agendado", "aguardando_confirmacao"] as const) {
      expect(
        estadoDoConfirmarManual({
          consulta: { status, approval_status: "pendente" },
          podeEditar: true,
          dicaSemPermissao: SEM_PERMISSAO,
        }),
        status,
      ).toEqual({ desabilitado: true, dica: DICA_CONSULTA_PENDENTE });
    }
  });

  it("aprovada ou marcada pela equipe: liberada", () => {
    for (const approval_status of ["aprovado", null] as const) {
      expect(
        estadoDoConfirmarManual({
          consulta: { status: "agendado", approval_status },
          podeEditar: true,
          dicaSemPermissao: SEM_PERMISSAO,
        }),
        String(approval_status),
      ).toEqual({ desabilitado: false, dica: "Confirmar manualmente" });
    }
  });

  it("sem permissão vence; a que saiu da fila diz isso", () => {
    expect(
      estadoDoConfirmarManual({
        consulta: { status: "agendado", approval_status: "pendente" },
        podeEditar: false,
        dicaSemPermissao: SEM_PERMISSAO,
      }),
    ).toEqual({ desabilitado: true, dica: SEM_PERMISSAO });
    expect(
      estadoDoConfirmarManual({
        consulta: { status: "confirmado_paciente", approval_status: null },
        podeEditar: true,
        dicaSemPermissao: SEM_PERMISSAO,
      }),
    ).toEqual({
      desabilitado: true,
      dica: "Esta consulta já saiu da fila de confirmação",
    });
  });
});
