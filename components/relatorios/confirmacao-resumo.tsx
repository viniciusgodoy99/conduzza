import { ArrowRight, CalendarSearch, ClipboardCheck } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  formatarPercentualDoObjetivo,
  percentualOuSemDados,
  taxasDaConfirmacao,
} from "@/lib/domain/exportacao-de-resultados";
import { formatarPercentual } from "@/lib/domain/formato-compacto";
import type { AgendaDoPeriodo, LinhaDeBase } from "@/lib/queries/relatorios";

// Resumo da Confirmacao de consulta na Visao geral: as taxas do periodo com o
// par bruto escrito, as recuperadas e a comparacao FACTUAL com a linha de
// base. A frase causal do prototipo ("a confirmacao reduziu as faltas em
// 38%") nao entra: a linha de base e informada pela clinica e a taxa e
// medida pelo sistema, e por em relacao de causa os dois seria inventar. O
// relatorio completo (linha de base, antes e depois da regua) fica em
// Comercial.

export function ConfirmacaoResumo({
  agenda,
  linhaDeBase,
  aoVerDetalhes,
  className,
}: {
  agenda: AgendaDoPeriodo;
  linhaDeBase: LinhaDeBase;
  aoVerDetalhes: () => void;
  className?: string;
}) {
  const taxas = taxasDaConfirmacao(agenda);
  const comDesfecho = agenda.porStatus.compareceu + agenda.porStatus.faltou;

  return (
    <Secao
      titulo="Confirmação de consulta"
      icone={ClipboardCheck}
      meta="Consultas com início no período"
      className={className}
    >
      {agenda.total === 0 ? (
        <EmptyState
          compact
          icon={CalendarSearch}
          title="Nenhuma consulta com início neste período"
        />
      ) : (
        <>
          {taxas.map((taxa) => {
            const legenda =
              taxa.percentual === null
                ? "sem dados"
                : `${formatarPercentual(taxa.percentual)}% (${taxa.parte.toLocaleString("pt-BR")} de ${taxa.total.toLocaleString("pt-BR")})`;
            return (
              <BarraDeProgresso
                key={taxa.rotulo}
                rotulo={taxa.rotulo}
                legenda={legenda}
                valor={taxa.parte}
                maximo={taxa.total}
                tom="destaque"
                ariaLabel={`${taxa.rotulo}: ${legenda}`}
              />
            );
          })}
          <p className="text-[13px] text-foreground">
            <span className="cz-num font-semibold">
              {agenda.recuperadas.total.toLocaleString("pt-BR")}
            </span>{" "}
            {agenda.recuperadas.total === 1
              ? "consulta recuperada"
              : "consultas recuperadas"}{" "}
            pela lista de espera.
          </p>
        </>
      )}
      <p className="border-t border-border pt-3 text-xs text-text-secondary">
        {linhaDeBase ? (
          <>
            Linha de base informada pela clínica:{" "}
            <span className="cz-num font-semibold text-foreground">
              {formatarPercentualDoObjetivo(linhaDeBase.ratePercent)}%
            </span>{" "}
            de faltas. Medida pelo sistema no período:{" "}
            <span className="cz-num font-semibold text-foreground">
              {percentualOuSemDados(agenda.porStatus.faltou, comDesfecho)}
            </span>
            .
          </>
        ) : (
          "A linha de base de faltas ainda não foi registrada."
        )}
      </p>
      <Button variant="ghost" className="w-fit" onClick={aoVerDetalhes}>
        Ver detalhes em Comercial
        <ArrowRight aria-hidden />
      </Button>
    </Secao>
  );
}
