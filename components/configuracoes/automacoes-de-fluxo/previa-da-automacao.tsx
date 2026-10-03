"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";

import { previaDaAutomacaoDeFluxoAction } from "@/app/(app)/configuracoes/automacoes-de-fluxo-actions";
import { Aviso } from "@/components/shared/aviso";
import { Skeleton } from "@/components/ui/skeleton";
import {
  textoDaPrevia,
  type GatilhoDeAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import { automacoesDeFluxoKeys } from "@/lib/queries/automacoes-de-fluxo";

// A previa que a tela mostra ao ligar e ao salvar: a regra nao e
// retroativa, entao diz quantos leads ja passaram do ponto e ficam de fora.
// So contagens (RPC previa_da_automacao_de_fluxo, SECURITY INVOKER), sem
// nome de paciente.

export function PreviaDaAutomacao({
  clinicId,
  gatilho,
  etapa,
  nomeDaEtapa,
  esperaMinutos,
}: {
  clinicId: string;
  gatilho: GatilhoDeAutomacao;
  etapa: string;
  nomeDaEtapa: string;
  /** nulo nos gatilhos que nao sao de tempo */
  esperaMinutos: number | null;
}) {
  const consulta = useQuery({
    queryKey: automacoesDeFluxoKeys.previa(
      clinicId,
      gatilho,
      etapa,
      esperaMinutos,
    ),
    queryFn: async () => {
      const resultado = await previaDaAutomacaoDeFluxoAction({
        gatilho,
        etapa,
        espera_minutos: esperaMinutos,
      });
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.previa;
    },
    staleTime: 30_000,
  });

  if (consulta.isPending) {
    return (
      <div
        role="status"
        className="grid gap-2 rounded-xl bg-surface-4 px-3.5 py-3"
      >
        <span className="sr-only">Contando os leads da etapa</span>
        <Skeleton aria-hidden className="h-3.5 w-3/4" />
        <Skeleton aria-hidden className="h-3 w-1/2" />
      </div>
    );
  }

  if (consulta.isError) {
    return (
      <Aviso tom="warning">
        Não foi possível contar os leads da etapa agora. A automação continua
        valendo só para o que acontecer depois de ligada.
      </Aviso>
    );
  }

  const texto = textoDaPrevia(consulta.data, gatilho, nomeDaEtapa);
  return (
    <Aviso tom="neutral" icone={Users} titulo="Não é retroativa">
      <p>{texto.principal}</p>
      {texto.importados ? <p className="mt-1">{texto.importados}</p> : null}
    </Aviso>
  );
}
