"use client";

import { CalendarCheck2, RotateCw, TimerReset, Wallet } from "lucide-react";

import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatarPercentual,
  formatarReaisCompleto,
  percentualDe,
} from "@/lib/domain/formato-compacto";
import type { MetricasDaEspera } from "@/lib/queries/espera";

/**
 * A linha "Receita associada": sem permissao, sem nada com preco para somar
 * (nunca "R$ 0,00" quando as vagas foram de convenio sem valor ou sem preco
 * cadastrado, regra do faturamento) ou o valor com o que ficou fora da soma.
 */
export function receitaDaEspera(
  metricas: Pick<
    MetricasDaEspera,
    | "vagasPreenchidas"
    | "receitaCents"
    | "vagasComValor"
    | "vagasCobertas"
    | "vagasSemPreco"
  >,
):
  | { estado: "sem-acesso" }
  | { estado: "sem-preco"; fora: string | null }
  | { estado: "valor"; centavos: number; fora: string | null } {
  if (metricas.receitaCents === null) {
    return { estado: "sem-acesso" };
  }
  const partes: string[] = [];
  if ((metricas.vagasCobertas ?? 0) > 0) {
    partes.push(`${metricas.vagasCobertas} de convênio sem valor`);
  }
  if ((metricas.vagasSemPreco ?? 0) > 0) {
    partes.push(`${metricas.vagasSemPreco} sem preço cadastrado`);
  }
  const fora = partes.length > 0 ? partes.join(", ") : null;
  if (metricas.vagasPreenchidas > 0 && (metricas.vagasComValor ?? 0) === 0) {
    return { estado: "sem-preco", fora };
  }
  return {
    estado: "valor",
    centavos: metricas.receitaCents,
    fora: fora === null ? null : `Fora da soma: ${fora}`,
  };
}

// "Desempenho da lista" da Tela 10 (Fase 3, decisao do dono em 02/10/2026),
// no MES CIVIL da clinica pela RPC metricas_da_espera (a vaga entra no mes
// da sua primeira onda). Desenho do kit (screens-agenda) com os desvios do
// docs/06:
// - so as duas medidas com denominador honesto viram barra, e a barra so
//   tem os tons destaque e neutro (C12): "Vagas preenchidas" (preenchidas
//   de resolvidas; em andamento e canceladas ficam no rodape, porque ainda
//   nao terminaram ou nao dependeram do paciente) e "Aceite na 1ª oferta"
//   (primeiras ondas aceitas de resolvidas pelo paciente);
// - o tempo medio nao tem maximo: numero com TimerReset, sem barra;
// - a receita associada (o brief exige) so tem numero para administrador e
//   gestor. O banco devolve null para os outros papeis, e a linha fica
//   visivel e desabilitada com a dica, nunca escondida e nunca zero.
// Sem barra para zero: sem base, a linha diz em texto que nao ha dado.

export const DICA_SEM_ACESSO_A_REAIS =
  "Só administrador e gestor veem valores em reais.";

const numero = new Intl.NumberFormat("pt-BR");

export function tempoLegivel(minutos: number): string {
  if (minutos < 60) {
    return `${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

function plural(n: number, singular: string, pluralizado: string): string {
  return `${numero.format(n)} ${n === 1 ? singular : pluralizado}`;
}

/** "2 em andamento, 1 cancelada": so o que for maior que zero. */
export function rodapeDasVagas(metricas: MetricasDaEspera): string | null {
  const partes = [
    metricas.vagasEmAndamento > 0
      ? `${numero.format(metricas.vagasEmAndamento)} em andamento`
      : null,
    metricas.vagasCanceladas > 0
      ? plural(metricas.vagasCanceladas, "cancelada", "canceladas")
      : null,
  ].filter((parte): parte is string => parte !== null);
  return partes.length > 0 ? partes.join(", ") : null;
}

/**
 * "17 aceitas, 8 sem aceite": a base do aceite sao as primeiras ofertas que
 * o paciente resolveu (aceita, ou venceu sem ninguem aceitar); a cancelada
 * pela recepcao e a que segue aberta nao entram.
 */
export function rodapeDoAceite(metricas: MetricasDaEspera): string {
  const semAceite = metricas.primeiraOndaBase - metricas.primeiraOndaAceita;
  const aceitas = plural(metricas.primeiraOndaAceita, "aceita", "aceitas");
  return semAceite > 0
    ? `${aceitas}, ${numero.format(semAceite)} sem aceite`
    : aceitas;
}

function Cabecalho({ mes }: { mes: string }) {
  return (
    <div className="grid gap-[3px] border-b border-border px-4 py-3.5">
      <h2
        id="titulo-do-desempenho"
        className="text-base leading-[1.3] font-bold tracking-[-0.01em]"
      >
        Desempenho da lista
      </h2>
      <p className="text-[12.5px] text-text-secondary">{mes}</p>
    </div>
  );
}

/** Linha de rotulo e texto no lugar da barra, quando nao ha base. */
function SemBase({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 text-[12.5px] font-medium text-foreground">
        {rotulo}
      </span>
      <span className="shrink-0 text-xs text-text-secondary">{texto}</span>
    </span>
  );
}

export function PainelMetricas({
  metricas,
  mes,
  falhou,
  tentando,
  aoTentarDeNovo,
}: {
  /** undefined enquanto a primeira carga nao chegou (ou falhou) */
  metricas: MetricasDaEspera | undefined;
  /** "Outubro de 2026": o mes civil da clinica que os numeros contam */
  mes: string;
  /** Sem numero nenhum e a carga falhou */
  falhou: boolean;
  tentando: boolean;
  aoTentarDeNovo: () => void;
}) {
  let corpo: React.ReactNode;

  if (metricas === undefined && falhou) {
    corpo = (
      <EmptyState
        compact
        tom="erro"
        title="Não foi possível carregar o desempenho"
        description="Confira a conexão e tente de novo. A lista continua funcionando."
      >
        <Button
          variant="outline"
          className="h-10"
          disabled={tentando}
          onClick={aoTentarDeNovo}
        >
          <RotateCw aria-hidden />
          {tentando ? "Tentando..." : "Tentar de novo"}
        </Button>
      </EmptyState>
    );
  } else if (metricas === undefined) {
    corpo = (
      <div className="grid gap-4 px-4 py-3.5">
        <span role="status" className="sr-only">
          Carregando o desempenho da lista
        </span>
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-1.5" aria-hidden>
            <div className="flex justify-between">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-12" />
            </div>
            <Skeleton className="h-[7px] rounded-full" />
          </div>
        ))}
        {[0, 1].map((i) => (
          <div key={i} className="flex justify-between" aria-hidden>
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    );
  } else if (metricas.vagasOferecidas === 0) {
    corpo = (
      <EmptyState
        compact
        icon={CalendarCheck2}
        title="Nenhuma vaga na reoferta neste mês"
        description="Quando uma consulta é cancelada e o horário vai para a lista, o desempenho aparece aqui."
      />
    );
  } else {
    const resolvidas = metricas.vagasPreenchidas + metricas.vagasEsgotadas;
    const rodape = rodapeDasVagas(metricas);
    const receita = receitaDaEspera(metricas);
    const aceite = percentualDe(
      metricas.primeiraOndaAceita,
      metricas.primeiraOndaBase,
    );
    corpo = (
      <div className="grid gap-4 px-4 pt-3.5 pb-1.5">
        <div className="grid gap-1.5">
          {resolvidas > 0 ? (
            <BarraDeProgresso
              rotulo="Vagas preenchidas"
              legenda={`${numero.format(metricas.vagasPreenchidas)} de ${numero.format(resolvidas)}`}
              valor={metricas.vagasPreenchidas}
              maximo={resolvidas}
              tom="destaque"
              ariaLabel={`${numero.format(metricas.vagasPreenchidas)} de ${plural(resolvidas, "vaga resolvida foi preenchida", "vagas resolvidas foram preenchidas")}`}
            />
          ) : (
            <SemBase
              rotulo="Vagas preenchidas"
              texto="Nenhuma vaga resolvida ainda"
            />
          )}
          {rodape ? (
            <p className="text-xs text-text-secondary">{rodape}</p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          {aceite === null ? (
            <SemBase rotulo="Aceite na 1ª oferta" texto="Sem dados" />
          ) : (
            <>
              <BarraDeProgresso
                rotulo="Aceite na 1ª oferta"
                legenda={`${formatarPercentual(aceite)}%`}
                valor={metricas.primeiraOndaAceita}
                maximo={metricas.primeiraOndaBase}
                tom="neutro"
                ariaLabel={`${formatarPercentual(aceite)}% aceitaram na primeira oferta, ${numero.format(metricas.primeiraOndaAceita)} de ${numero.format(metricas.primeiraOndaBase)}`}
              />
              <p className="text-xs text-text-secondary">
                {rodapeDoAceite(metricas)}
              </p>
            </>
          )}
        </div>
        <dl className="grid border-t border-border">
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2">
            <dt className="flex min-w-0 items-center gap-2 text-[13px] text-text-secondary">
              <TimerReset className="size-4 shrink-0" aria-hidden />
              Tempo médio até o encaixe
            </dt>
            <dd
              className={
                metricas.tempoMedioMin === null
                  ? "shrink-0 text-[13px] text-text-secondary"
                  : "shrink-0 cz-num text-base font-semibold text-text-strong"
              }
            >
              {metricas.tempoMedioMin === null
                ? "Sem vaga preenchida"
                : tempoLegivel(metricas.tempoMedioMin)}
            </dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 py-2">
            <dt className="flex min-w-0 items-center gap-2 text-[13px] text-text-secondary">
              <Wallet className="size-4 shrink-0" aria-hidden />
              Receita associada
            </dt>
            <dd className="grid shrink-0 justify-items-end gap-0.5 text-right">
              {receita.estado === "sem-acesso" ? (
                <DisabledWithHint hint={DICA_SEM_ACESSO_A_REAIS}>
                  <span className="text-[13px] font-semibold text-text-secondary">
                    Sem acesso
                  </span>
                </DisabledWithHint>
              ) : receita.estado === "sem-preco" ? (
                <span className="text-[13px] font-semibold text-text-secondary">
                  Sem preço para somar
                </span>
              ) : (
                <span className="cz-num text-base font-semibold text-text-strong">
                  {formatarReaisCompleto(receita.centavos)}
                </span>
              )}
              {receita.estado !== "sem-acesso" && receita.fora ? (
                <span className="max-w-[240px] text-xs text-text-secondary">
                  {receita.fora}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="titulo-do-desempenho"
      aria-busy={metricas === undefined && !falhou ? true : undefined}
      className="flex min-w-0 flex-col rounded-card border border-border bg-card shadow-sm"
    >
      <Cabecalho mes={mes} />
      {corpo}
    </section>
  );
}
