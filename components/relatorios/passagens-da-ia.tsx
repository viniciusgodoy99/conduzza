import { UsersRound } from "lucide-react";
import type { ReactNode } from "react";

import { BarraHorizontal } from "@/components/relatorios/barra-horizontal";
import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TITULO_DAS_PASSAGENS,
  gruposDasPassagens,
  type RotulosDosMotivos,
} from "@/lib/domain/exportacao-de-resultados";
import type { PassagensDaIaDoPeriodo } from "@/lib/queries/relatorios";

// "Por que foi para a equipe" (aba Agente de IA, metricas certas de
// 23/11/2026): as passagens da IA para a equipe no periodo, por motivo, em
// barras horizontais agrupadas por onde aconteceram (na chegada da mensagem,
// durante a conversa, na conferencia antes de enviar, por falha tecnica). Os
// rotulos sao os do evento "A IA passou a conversa para a equipe: ...". Conta
// passagens, nao conversas: uma conversa pode passar mais de uma vez.

function plural(n: number, singular: string, pluralizado: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : pluralizado}`;
}

export function PassagensDaIa({
  passagens,
  rotulos,
  erro = false,
  tentarDeNovo,
}: {
  /** undefined = carregando */
  passagens: PassagensDaIaDoPeriodo | undefined;
  /** ROTULO_DO_MOTIVO_DE_ESCALONAMENTO, vindo do servidor. */
  rotulos: RotulosDosMotivos;
  erro?: boolean;
  tentarDeNovo?: ReactNode;
}) {
  let corpo: ReactNode;
  let meta: string | undefined;
  if (erro) {
    corpo = (
      <EmptyState
        compact
        tom="erro"
        title="Não foi possível carregar os motivos"
        description="Tente de novo em instantes."
      >
        {tentarDeNovo}
      </EmptyState>
    );
  } else if (passagens === undefined) {
    corpo = (
      <div aria-busy className="grid gap-3">
        {Array.from({ length: 3 }).map((_, indice) => (
          <Skeleton key={indice} className="h-7 w-full" />
        ))}
        <span className="sr-only">Carregando</span>
      </div>
    );
  } else {
    const grupos = gruposDasPassagens(passagens, rotulos);
    if (grupos.length === 0) {
      corpo = (
        <EmptyState
          compact
          icon={UsersRound}
          title="Nenhuma conversa foi para a equipe no período"
          description="Quando a IA passar uma conversa para a equipe, o motivo aparece aqui."
        />
      );
    } else {
      meta = `${plural(passagens.total, "passagem", "passagens")} no período. Uma conversa pode passar mais de uma vez.`;
      const maximo = Math.max(
        ...grupos.flatMap((grupo) => grupo.linhas.map((l) => l.passagens)),
      );
      corpo = grupos.map((grupo) => (
        <div key={grupo.camada} className="grid gap-2">
          <h3 className="text-[13px] font-semibold text-text-secondary">
            {grupo.rotulo}
          </h3>
          {grupo.linhas.map((linha) => (
            <BarraHorizontal
              key={linha.motivo}
              rotulo={linha.rotulo}
              valor={linha.passagens}
              maximo={maximo}
              total={passagens.total}
              rotuloEmCima
            />
          ))}
        </div>
      ));
    }
  }
  return (
    <Secao titulo={TITULO_DAS_PASSAGENS} icone={UsersRound} meta={meta}>
      {corpo}
    </Secao>
  );
}
