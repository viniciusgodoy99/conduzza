import { CalendarDays, ChartBar } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { EmptyState } from "@/components/shared/empty-state";
import type { Leitura, ResumoDoDia } from "@/lib/queries/inicio";
import { cn } from "@/lib/utils";

import { contarConsultas, maiorValor, rotuloDoDia } from "./numeros-do-dia";

// "Consultas por dia, ultimos 7 dias" (Fase 3). O prototipo desenha colunas
// verticais com o dia de hoje marcado so pela cor; a C12 e o CLAUDE.md
// proibem as duas coisas. Aqui sao 7 barras DEITADAS, de D-6 a D sem pular
// dia (domingo com zero aparece), com "Hoje" escrito no rotulo e em
// destaque e os outros dias em neutro. A contagem e a mesma de "Consultas
// hoje" (todas as situacoes), entao a barra de hoje bate com o cartao.

const TITULO = "Consultas por dia, últimos 7 dias";

export function ConsultasPorDia({ resumo }: { resumo: Leitura<ResumoDoDia> }) {
  if (!resumo.ok) {
    return (
      <Secao titulo={TITULO} icone={ChartBar}>
        <EmptyState
          compact
          tom="erro"
          title="Não foi possível carregar as consultas dos últimos 7 dias"
        />
      </Secao>
    );
  }

  const { porDia, dia: hoje } = resumo.dados;
  const maximo = maiorValor(porDia.map((linha) => linha.total));
  const soma = porDia.reduce((total, linha) => total + linha.total, 0);

  if (soma === 0) {
    return (
      <Secao titulo={TITULO} icone={ChartBar}>
        <EmptyState
          compact
          icon={CalendarDays}
          title="Nenhuma consulta nos últimos 7 dias"
          description="As consultas marcadas na Agenda aparecem aqui, uma linha por dia."
        />
      </Secao>
    );
  }

  return (
    <Secao
      titulo={TITULO}
      icone={ChartBar}
      meta={`${contarConsultas(soma)} no período, em todas as situações`}
    >
      <ul className="grid gap-1">
        {porDia.map((linha) => {
          const rotulo = rotuloDoDia(linha.dia, hoje);
          return (
            <li
              key={linha.dia}
              data-hoje={rotulo.ehHoje ? "" : undefined}
              className="grid min-h-7 grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3"
            >
              {/* O rotulo e o numero escritos sao para o olho; o leitor de
                  tela le a frase inteira no aria-label da barra, uma vez. */}
              <span
                aria-hidden
                className="flex items-baseline gap-1.5 text-[13px]"
              >
                <span
                  className={cn(
                    rotulo.ehHoje
                      ? "font-semibold text-text-strong"
                      : "text-foreground",
                  )}
                >
                  {rotulo.nome}
                </span>
                <span className="cz-num text-xs text-text-secondary">
                  {rotulo.data}
                </span>
              </span>
              <BarraDeProgresso
                valor={linha.total}
                maximo={maximo}
                tom={rotulo.ehHoje ? "destaque" : "neutro"}
                ariaLabel={`${rotulo.falado}: ${contarConsultas(linha.total)}`}
              />
              <span
                aria-hidden
                className={cn(
                  "text-right cz-num text-[13px] text-text-strong",
                  rotulo.ehHoje ? "font-bold" : "font-semibold",
                )}
              >
                {linha.total.toLocaleString("pt-BR")}
              </span>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
