import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChartLine } from "lucide-react";
import type { ReactNode } from "react";

import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import { GraficoDeLinha } from "@/components/shared/grafico-de-linha";
import { Skeleton } from "@/components/ui/skeleton";
import type { PontoDaSerie } from "@/lib/queries/relatorios";

// "Leads x consultas agendadas" (Visao geral): linha com marcadores e duas
// series, no lugar das colunas verticais do prototipo (C12). Os pontos ja
// chegam um por dia CIVIL da clinica, completos e com zero no dia vazio
// (serie_diaria_do_periodo); aqui so se formata o rotulo do dia. O dia vem
// como aaaa-mm-dd e o meio-dia no fuso da clinica evita qualquer virada de
// data na formatacao (regra 3.6).

const ALTURA = 200;

export function SerieLeadsAgendadas({
  serie,
  timezone,
  erro = false,
  tentarDeNovo,
  className,
}: {
  /** undefined = carregando */
  serie: PontoDaSerie[] | undefined;
  timezone: string;
  erro?: boolean;
  tentarDeNovo?: ReactNode;
  className?: string;
}) {
  let corpo: ReactNode;
  if (erro) {
    corpo = (
      <EmptyState
        compact
        tom="erro"
        title="Não foi possível carregar o gráfico"
        description="Tente de novo em instantes."
      >
        {tentarDeNovo}
      </EmptyState>
    );
  } else if (serie === undefined) {
    corpo = (
      <div aria-busy className="grid gap-3">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="w-full" style={{ height: ALTURA }} />
        <span className="sr-only">Carregando</span>
      </div>
    );
  } else {
    const rotulos = serie.map((ponto) => {
      const [, mes, dia] = ponto.dia.split("-");
      return `${dia}/${mes}`;
    });
    const rotulosFalados = serie.map((ponto) =>
      format(new TZDate(`${ponto.dia}T12:00:00`, timezone), "d 'de' MMMM", {
        locale: ptBR,
      }),
    );
    corpo = (
      <GraficoDeLinha
        titulo="Leads x consultas agendadas"
        rotulos={rotulos}
        rotulosFalados={rotulosFalados}
        series={[
          {
            nome: "Leads recebidos",
            valores: serie.map((ponto) => ponto.leads),
          },
          {
            nome: "Consultas agendadas",
            valores: serie.map((ponto) => ponto.agendadas),
          },
        ]}
        altura={ALTURA}
        textoVazio="Nenhum lead nem consulta agendada no período"
      />
    );
  }

  return (
    <Secao
      titulo="Leads x consultas agendadas"
      icone={ChartLine}
      meta="Por dia, no fuso da clínica"
      className={className}
    >
      {corpo}
    </Secao>
  );
}
