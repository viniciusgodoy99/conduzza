"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ClipboardCheck, Flag } from "lucide-react";
import { useState } from "react";

import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { DialogLinhaDeBase } from "@/components/relatorios/dialog-linha-de-base";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import type {
  AgendaDoPeriodo,
  LinhaDeBase,
  Periodizado,
  PivoDaRegua,
} from "@/lib/queries/relatorios";
import { formatarCentavos } from "@/lib/utils/moeda";

// Aba Confirmacao (spec 8.10): o relatorio que renova o contrato. Toda
// comparacao aqui e entre numeros de ORIGEM DECLARADA: a linha de base e
// informada pela clinica (e rotulada assim), a taxa do periodo e medida
// pelo sistema, e o pivo antes/depois usa so consultas com desfecho. Nunca
// um numero sintetico misturando os dois.

function pctDeFalta(faltas: number, comDesfecho: number): string | null {
  if (comDesfecho <= 0) {
    return null;
  }
  return `${((faltas / comDesfecho) * 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}

export function AbaConfirmacao({
  agenda,
  pivo,
  linhaDeBase,
  ehAdmin,
  timezone,
  aoMudarLinhaDeBase,
}: {
  agenda: Periodizado<AgendaDoPeriodo>;
  pivo: PivoDaRegua;
  linhaDeBase: LinhaDeBase;
  ehAdmin: boolean;
  timezone: string;
  aoMudarLinhaDeBase: () => Promise<unknown> | void;
}) {
  const [dialogAberto, setDialogAberto] = useState(false);
  const atual = agenda.atual;
  const anterior = agenda.anterior;

  const comDesfecho = atual.porStatus.compareceu + atual.porStatus.faltou;
  const taxaDeFaltaNoPeriodo = pctDeFalta(atual.porStatus.faltou, comDesfecho);

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoKpi
          rotulo="Confirmadas em algum momento"
          valor={`${atual.confirmadasAlgumaVez} de ${atual.total}`}
          notaSemDelta="consultas com início no período; conta quem confirmou mesmo que depois tenha comparecido ou faltado"
        />
        <CartaoKpi
          rotulo="Faltas"
          valor={atual.porStatus.faltou.toLocaleString("pt-BR")}
          polaridade="menor-melhor"
          anterior={
            anterior
              ? {
                  atual: atual.porStatus.faltou,
                  anterior: anterior.porStatus.faltou,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Recuperadas pela lista de espera"
          valor={atual.recuperadas.total.toLocaleString("pt-BR")}
          notaSemDelta={
            atual.recuperadas.total > 0
              ? `${formatarCentavos(atual.recuperadas.receitaCents)} em receita associada${
                  atual.recuperadas.semPreco > 0
                    ? `, ${atual.recuperadas.semPreco} sem preço cadastrado`
                    : ""
                }`
              : "horários vagos preenchidos pela reoferta"
          }
        />
        <CartaoKpi
          rotulo="Remarcaram após a falta"
          valor={`${atual.remarcadasAposFalta.remarcadas} de ${atual.remarcadasAposFalta.faltas}`}
          notaSemDelta="consulta nova em até 30 dias após a falta; faltas recentes ainda estão dentro dessa janela"
        />
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Flag strokeWidth={1.5} className="size-4 text-text-secondary" />
          <h2 className="text-[15px] font-semibold">Contra a linha de base</h2>
        </div>
        {linhaDeBase ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-1 rounded-lg border p-4">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
                Linha de base (informada pela clínica)
              </span>
              <span className="font-mono text-[34px] leading-none font-semibold tabular-nums">
                {linhaDeBase.ratePercent.toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                %
              </span>
              <span className="text-[12.5px] text-text-tertiary">
                faltas medidas de{" "}
                {format(
                  new TZDate(`${linhaDeBase.measuredFrom}T12:00:00`, timezone),
                  "dd/MM/yy",
                  { locale: ptBR },
                )}{" "}
                a{" "}
                {format(
                  new TZDate(`${linhaDeBase.measuredTo}T12:00:00`, timezone),
                  "dd/MM/yy",
                  { locale: ptBR },
                )}
                {linhaDeBase.note ? ` (${linhaDeBase.note})` : ""}
              </span>
              {ehAdmin ? (
                <Button
                  variant="ghost"
                  className="h-10 w-fit"
                  onClick={() => setDialogAberto(true)}
                >
                  Registrar de novo
                </Button>
              ) : (
                <DisabledWithHint hint="Só quem administra a clínica registra a linha de base.">
                  <Button variant="ghost" className="h-10 w-fit" disabled>
                    Registrar de novo
                  </Button>
                </DisabledWithHint>
              )}
            </div>
            <div className="grid content-start gap-1 rounded-lg border p-4">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
                Taxa de faltas no período (medida pelo sistema)
              </span>
              <span className="font-mono text-[34px] leading-none font-semibold tabular-nums">
                {taxaDeFaltaNoPeriodo ?? "sem dados"}
              </span>
              <span className="text-[12.5px] text-text-tertiary">
                {comDesfecho > 0
                  ? `${atual.porStatus.faltou} falta${atual.porStatus.faltou === 1 ? "" : "s"} em ${comDesfecho} consultas com desfecho (compareceu ou faltou)`
                  : "nenhuma consulta com desfecho no período"}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium">
                A linha de base ainda não foi registrada
              </p>
              <p className="max-w-prose text-sm text-text-secondary">
                Registre a taxa de faltas da clínica dos 30 dias anteriores às
                mensagens automáticas. Sem ela, não existe prova de resultado.
              </p>
            </div>
            {ehAdmin ? (
              <Button className="h-10" onClick={() => setDialogAberto(true)}>
                Registrar a linha de base
              </Button>
            ) : (
              <DisabledWithHint hint="Só quem administra a clínica registra a linha de base.">
                <Button className="h-10" disabled>
                  Registrar a linha de base
                </Button>
              </DisabledWithHint>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardCheck
            strokeWidth={1.5}
            className="size-4 text-text-secondary"
          />
          <h2 className="text-[15px] font-semibold">
            Antes e depois da primeira mensagem de régua
          </h2>
        </div>
        {pivo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-1 rounded-lg border p-4">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
                Antes
              </span>
              <span className="font-mono text-[28px] leading-none font-semibold tabular-nums">
                {pctDeFalta(pivo.antes.faltas, pivo.antes.comDesfecho) ??
                  "sem dados"}
              </span>
              <span className="text-[12.5px] text-text-tertiary">
                {pivo.antes.faltas} faltas em {pivo.antes.comDesfecho} consultas
                com desfecho
              </span>
            </div>
            <div className="grid content-start gap-1 rounded-lg border p-4">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
                Depois ({format(
                  new TZDate(pivo.primeiraReguaEm, timezone),
                  "dd/MM/yy",
                  { locale: ptBR },
                )}{" "}
                em diante)
              </span>
              <span className="font-mono text-[28px] leading-none font-semibold tabular-nums">
                {pctDeFalta(pivo.depois.faltas, pivo.depois.comDesfecho) ??
                  "sem dados"}
              </span>
              <span className="text-[12.5px] text-text-tertiary">
                {pivo.depois.faltas} faltas em {pivo.depois.comDesfecho}{" "}
                consultas com desfecho
              </span>
            </div>
          </div>
        ) : (
          <p className="max-w-prose text-sm text-text-secondary">
            A régua desta clínica ainda não enviou nenhuma mensagem. Quando o
            primeiro toque sair, o comparativo aparece aqui.
          </p>
        )}
      </section>

      <DialogLinhaDeBase
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        aoMudar={aoMudarLinhaDeBase}
      />
    </div>
  );
}
