"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  adiarAtividadeAction,
  cancelarAtividadeAction,
  concluirAtividadeAction,
  reabrirAtividadeAction,
  type AtividadeActionResult,
} from "@/app/(app)/atividades/actions";
import {
  ROTULO_DO_ADIAMENTO,
  type Adiamento,
  type StatusDaAtividade,
} from "@/lib/domain/atividades";

// As acoes de uma linha de atividade, iguais na tela Atividades, no drawer
// do lead, no painel da conversa e na ficha. Concluir, reabrir e cancelar
// mudam a tela NA HORA (sobrescrita local do status) e desfazem sozinhos se
// o servidor recusar. Concluir e cancelar oferecem "Desfazer" no aviso. A
// sobrescrita some quando o dado recarregado ja traz o mesmo status.
//
// Nenhum texto de atividade vai para o aviso: so a acao ("Atividade
// concluída"). O texto e dado de paciente e o aviso nao e lugar dele.

type AtividadeComStatus = { id: string; status: StatusDaAtividade };

export type AcoesDeAtividade<T extends AtividadeComStatus> = {
  /** A lista com as mudancas que ainda estao a caminho do servidor */
  lista: T[];
  /** Ids com uma acao em andamento (botao ocupado) */
  ocupadas: ReadonlySet<string>;
  concluir: (atividade: T) => void;
  reabrir: (atividade: T) => void;
  cancelar: (atividade: T) => void;
  adiar: (atividade: T, dias: Adiamento) => void;
};

export function useAcoesDeAtividade<T extends AtividadeComStatus>({
  lista,
  aoMudar,
}: {
  lista: readonly T[];
  /** Recarrega a fonte (invalidar a consulta ou router.refresh) */
  aoMudar: () => void;
}): AcoesDeAtividade<T> {
  const [sobrescritas, setSobrescritas] = useState<
    Readonly<Record<string, StatusDaAtividade>>
  >({});
  const [ocupadas, setOcupadas] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // O dado novo chegou com o status que a tela ja mostrava: a sobrescrita
  // cumpriu o papel e sai, para nao esconder uma mudanca futura.
  useEffect(() => {
    setSobrescritas((atual) => {
      const ids = Object.keys(atual);
      if (ids.length === 0) {
        return atual;
      }
      const proximo: Record<string, StatusDaAtividade> = { ...atual };
      let mudou = false;
      for (const atividade of lista) {
        if (proximo[atividade.id] === atividade.status) {
          delete proximo[atividade.id];
          mudou = true;
        }
      }
      return mudou ? proximo : atual;
    });
  }, [lista]);

  const marcarOcupada = useCallback((id: string, ocupada: boolean) => {
    setOcupadas((atual) => {
      const proximo = new Set(atual);
      if (ocupada) {
        proximo.add(id);
      } else {
        proximo.delete(id);
      }
      return proximo;
    });
  }, []);

  const sobrescrever = useCallback(
    (id: string, status: StatusDaAtividade | null) => {
      setSobrescritas((atual) => {
        const proximo = { ...atual };
        if (status === null) {
          delete proximo[id];
        } else {
          proximo[id] = status;
        }
        return proximo;
      });
    },
    [],
  );

  const executar = useCallback(
    async (
      atividade: T,
      acao: () => Promise<AtividadeActionResult>,
      otimista: StatusDaAtividade | null,
      aoDarCerto: (
        resultado: Extract<AtividadeActionResult, { ok: true }>,
      ) => void,
    ) => {
      marcarOcupada(atividade.id, true);
      if (otimista !== null) {
        sobrescrever(atividade.id, otimista);
      }
      let resultado: AtividadeActionResult;
      try {
        resultado = await acao();
      } catch {
        resultado = {
          ok: false,
          error: "Não foi possível falar com o servidor. Tente de novo.",
        };
      }
      marcarOcupada(atividade.id, false);
      if (!resultado.ok) {
        sobrescrever(atividade.id, null);
        toast.error(resultado.error);
        aoMudar();
        return;
      }
      aoDarCerto(resultado);
      aoMudar();
    },
    [aoMudar, marcarOcupada, sobrescrever],
  );

  const reabrir = useCallback(
    (atividade: T) => {
      void executar(
        atividade,
        () => reabrirAtividadeAction(atividade.id),
        "pendente",
        () => toast.success("Atividade reaberta"),
      );
    },
    [executar],
  );

  const concluir = useCallback(
    (atividade: T) => {
      void executar(
        atividade,
        () => concluirAtividadeAction(atividade.id),
        "concluida",
        (resultado) =>
          toast.success(
            resultado.jaEstava
              ? "Esta atividade já estava concluída"
              : "Atividade concluída",
            resultado.jaEstava
              ? undefined
              : {
                  action: {
                    label: "Desfazer",
                    onClick: () => reabrir(atividade),
                  },
                },
          ),
      );
    },
    [executar, reabrir],
  );

  const cancelar = useCallback(
    (atividade: T) => {
      void executar(
        atividade,
        () => cancelarAtividadeAction(atividade.id),
        "cancelada",
        (resultado) =>
          toast.success(
            resultado.jaEstava
              ? "Esta atividade já estava cancelada"
              : "Atividade cancelada",
            resultado.jaEstava
              ? undefined
              : {
                  action: {
                    label: "Desfazer",
                    onClick: () => reabrir(atividade),
                  },
                },
          ),
      );
    },
    [executar, reabrir],
  );

  const adiar = useCallback(
    (atividade: T, dias: Adiamento) => {
      void executar(
        atividade,
        () => adiarAtividadeAction({ id: atividade.id, dias }),
        null,
        () =>
          toast.success(
            `Atividade adiada ${ROTULO_DO_ADIAMENTO[dias].toLowerCase()}`,
          ),
      );
    },
    [executar],
  );

  const listaVisivel = useMemo(
    () =>
      lista.map((atividade) => {
        const status = sobrescritas[atividade.id];
        return status !== undefined && status !== atividade.status
          ? { ...atividade, status }
          : atividade;
      }),
    [lista, sobrescritas],
  );

  return {
    lista: listaVisivel,
    ocupadas,
    concluir,
    reabrir,
    cancelar,
    adiar,
  };
}
