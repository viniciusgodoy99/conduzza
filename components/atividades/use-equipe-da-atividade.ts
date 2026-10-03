"use client";

import { useQuery } from "@tanstack/react-query";

import { equipeDaAtividadeAction } from "@/app/(app)/atividades/actions";
import {
  atividadesKeys,
  type EquipeDaAtividade,
} from "@/lib/queries/atividades";

/** Uma opcao do "Responsável": membro ativo, ordenado pelo nome. */
export type OpcaoDeResponsavel = { id: string; nome: string; ativo: boolean };

/**
 * Quem pode ser responsavel (membros ATIVOS, por nome). O responsavel atual
 * que saiu da equipe entra no fim, marcado, para a escolha de hoje continuar
 * aparecendo no campo; o banco so confere quem e escolhido ou trocado.
 */
export function opcoesDeResponsavel(
  equipe: EquipeDaAtividade,
  atual: string | null,
): OpcaoDeResponsavel[] {
  const opcoes: OpcaoDeResponsavel[] = equipe.ativos
    .map((id) => ({ id, nome: equipe.nomes[id] ?? "Sem nome", ativo: true }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (atual !== null && !equipe.ativos.includes(atual)) {
    opcoes.push({
      id: atual,
      nome: equipe.nomes[atual] ?? "Pessoa que saiu da equipe",
      ativo: false,
    });
  }
  return opcoes;
}

/**
 * A equipe para o dialogo, quando quem o abre ainda nao a tem (o drawer do
 * lead). So busca quando `habilitado` (o dialogo aberto e sem equipe dada).
 * A chave leva a clinica: trocar de clinica nao reaproveita a equipe da
 * outra.
 */
export function useEquipeDaAtividade(clinicId: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...atividadesKeys.equipe, clinicId],
    queryFn: async () => {
      const resultado = await equipeDaAtividadeAction();
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.equipe;
    },
    enabled: habilitado && clinicId !== "",
    staleTime: 5 * 60_000,
  });
}
