import { ChartSpline } from "lucide-react";
import type { ReactNode } from "react";

import { Secao } from "@/components/relatorios/secao";
import { rotulosDosDias } from "@/components/relatorios/serie-leads-agendadas";
import { EmptyState } from "@/components/shared/empty-state";
import {
  GraficoDeLinha,
  type SerieDoGrafico,
} from "@/components/shared/grafico-de-linha";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GRUPOS_DE_ORIGEM,
  ROTULO_DO_GRUPO_DE_ORIGEM,
  textoDeLeads,
  type GrupoDeOrigem,
} from "@/lib/domain/grupos-de-origem";
import type { PontoDaSerie } from "@/lib/queries/relatorios";

// "Origem dos leads por dia" (Marketing, painel por origem, decisao do dono
// de 17/11/2026): linha com marcadores, uma serie por grupo de origem (Meta
// Ads, Google Ads, Outras origens, Nao rastreada), no molde de "Leads x
// consultas agendadas". Cada serie tem traco, marcador e cor proprios, e a
// legenda escreve o nome e o total de leads do periodo. Os pontos vem de
// por_grupo da serie diaria, que o banco manda SEM o filtro da tela: com uma
// origem escolhida, so a serie dela e desenhada, com a mesma cara de sempre.
// por_grupo ausente (banco de antes da migration 20261117110000): o bloco
// diz que o dado nao esta disponivel, nunca desenha zero inventado.

const ALTURA = 200;

/** O estilo do GraficoDeLinha de cada grupo, fixo com ou sem filtro. */
const ESTILO_DO_GRUPO: Record<GrupoDeOrigem, 0 | 1 | 2 | 3> = {
  meta: 0,
  google: 2,
  outras: 3,
  // Sem canal e magnitude sem origem: o tom neutro, como "Sem atribuição".
  nao_rastreada: 1,
};

export function OrigemDosLeadsPorDia({
  serie,
  timezone,
  grupo = null,
  erro = false,
  tentarDeNovo,
  className,
}: {
  /** undefined = carregando */
  serie: PontoDaSerie[] | undefined;
  timezone: string;
  /** A origem escolhida na tela; null = todas (as quatro series). */
  grupo?: GrupoDeOrigem | null;
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
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="w-full" style={{ height: ALTURA }} />
        <span className="sr-only">Carregando</span>
      </div>
    );
  } else if (serie.some((ponto) => ponto.porGrupo === null)) {
    corpo = (
      <EmptyState
        compact
        icon={ChartSpline}
        title="Ainda não disponível"
        description="A divisão dos leads por origem, dia a dia, ainda não está disponível."
      />
    );
  } else {
    const { rotulos, rotulosFalados } = rotulosDosDias(serie, timezone);
    const grupos: readonly GrupoDeOrigem[] = grupo ? [grupo] : GRUPOS_DE_ORIGEM;
    const [primeira, ...outras] = grupos.map((chave): SerieDoGrafico => {
      const valores = serie.map((ponto) => ponto.porGrupo?.[chave] ?? 0);
      return {
        nome: ROTULO_DO_GRUPO_DE_ORIGEM[chave],
        valores,
        estilo: ESTILO_DO_GRUPO[chave],
        detalhe: textoDeLeads(valores.reduce((soma, n) => soma + n, 0)),
      };
    });
    corpo = primeira ? (
      <GraficoDeLinha
        titulo="Origem dos leads por dia"
        rotulos={rotulos}
        rotulosFalados={rotulosFalados}
        series={[primeira, ...outras]}
        altura={ALTURA}
        textoVazio={
          grupo
            ? `Nenhum lead em ${ROTULO_DO_GRUPO_DE_ORIGEM[grupo]} no período`
            : "Nenhum lead no período"
        }
      />
    ) : null;
  }

  return (
    <Secao
      titulo="Origem dos leads por dia"
      icone={ChartSpline}
      meta={
        grupo
          ? `Só ${ROTULO_DO_GRUPO_DE_ORIGEM[grupo]}, por dia, no fuso da clínica`
          : "Por dia, no fuso da clínica"
      }
      className={className}
    >
      {corpo}
    </Secao>
  );
}
