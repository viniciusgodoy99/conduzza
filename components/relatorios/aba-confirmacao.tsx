"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ClipboardCheck, Flag } from "lucide-react";
import { useState } from "react";

import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { DialogLinhaDeBase } from "@/components/relatorios/dialog-linha-de-base";
import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

// Receita "bloco afundado" (docs/06 4.7): ladrilho dentro de cartao, sem
// borda e sem sombra.
const BLOCO_AFUNDADO = "grid content-start gap-2 rounded-xl bg-surface-4 p-3.5";

/** Taxa em mono; sem denominador, o campo vazio escrito (nunca travessao). */
function ValorOuVazio({
  valor,
  className,
}: {
  valor: string | null;
  className: string;
}) {
  if (valor === null) {
    return (
      <span className="text-base font-semibold text-text-secondary">
        Sem dados
      </span>
    );
  }
  return (
    <span
      className={cn(
        "cz-num leading-none font-semibold text-text-strong",
        className,
      )}
    >
      {valor}
    </span>
  );
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
    <div className="grid gap-4">
      <section
        aria-label="Indicadores do período"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
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
            atual.recuperadas.total > 0 ? (
              <>
                <span className="cz-num">
                  {formatarCentavos(atual.recuperadas.receitaCents)}
                </span>{" "}
                em receita associada
                {atual.recuperadas.semPreco > 0 ? (
                  <>
                    ,{" "}
                    <span className="cz-num">{atual.recuperadas.semPreco}</span>{" "}
                    sem preço cadastrado
                  </>
                ) : null}
              </>
            ) : (
              "horários vagos preenchidos pela reoferta"
            )
          }
        />
        <CartaoKpi
          rotulo="Remarcaram após a falta"
          valor={`${atual.remarcadasAposFalta.remarcadas} de ${atual.remarcadasAposFalta.faltas}`}
          notaSemDelta="consulta nova em até 30 dias após a falta; faltas recentes ainda estão dentro dessa janela"
        />
      </section>

      <Secao titulo="Contra a linha de base" icone={Flag}>
        {linhaDeBase ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={BLOCO_AFUNDADO}>
              <span className="cz-eyebrow text-text-secondary">
                Linha de base (informada pela clínica)
              </span>
              <span className="cz-num text-[34px] leading-none font-semibold text-text-strong">
                {linhaDeBase.ratePercent.toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                %
              </span>
              <span className="text-xs text-text-secondary">
                faltas medidas de{" "}
                <span className="cz-num">
                  {format(
                    new TZDate(
                      `${linhaDeBase.measuredFrom}T12:00:00`,
                      timezone,
                    ),
                    "dd/MM/yy",
                    { locale: ptBR },
                  )}
                </span>{" "}
                a{" "}
                <span className="cz-num">
                  {format(
                    new TZDate(`${linhaDeBase.measuredTo}T12:00:00`, timezone),
                    "dd/MM/yy",
                    { locale: ptBR },
                  )}
                </span>
                {linhaDeBase.note ? ` (${linhaDeBase.note})` : ""}
              </span>
              {ehAdmin ? (
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => setDialogAberto(true)}
                >
                  Registrar de novo
                </Button>
              ) : (
                <DisabledWithHint hint="Só quem administra a clínica registra a linha de base.">
                  <Button variant="outline" className="w-fit" disabled>
                    Registrar de novo
                  </Button>
                </DisabledWithHint>
              )}
            </div>
            <div className={BLOCO_AFUNDADO}>
              <span className="cz-eyebrow text-text-secondary">
                Taxa de faltas no período (medida pelo sistema)
              </span>
              <ValorOuVazio
                valor={taxaDeFaltaNoPeriodo}
                className="text-[34px]"
              />
              <span className="text-xs text-text-secondary">
                {comDesfecho > 0 ? (
                  <>
                    <span className="cz-num">{atual.porStatus.faltou}</span>{" "}
                    falta{atual.porStatus.faltou === 1 ? "" : "s"} em{" "}
                    <span className="cz-num">{comDesfecho}</span> consultas com
                    desfecho (compareceu ou faltou)
                  </>
                ) : (
                  "nenhuma consulta com desfecho no período"
                )}
              </span>
            </div>
          </div>
        ) : (
          <EmptyState
            compact
            icon={Flag}
            title="A linha de base ainda não foi registrada"
            description="Registre a taxa de faltas da clínica dos 30 dias anteriores às mensagens automáticas. Sem ela, não existe prova de resultado."
          >
            {ehAdmin ? (
              <Button onClick={() => setDialogAberto(true)}>
                Registrar a linha de base
              </Button>
            ) : (
              <DisabledWithHint hint="Só quem administra a clínica registra a linha de base.">
                <Button disabled>Registrar a linha de base</Button>
              </DisabledWithHint>
            )}
          </EmptyState>
        )}
      </Secao>

      <Secao
        titulo="Antes e depois da primeira mensagem de régua"
        icone={ClipboardCheck}
      >
        {pivo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={BLOCO_AFUNDADO}>
              <span className="cz-eyebrow text-text-secondary">Antes</span>
              <ValorOuVazio
                valor={pctDeFalta(pivo.antes.faltas, pivo.antes.comDesfecho)}
                className="text-[24px]"
              />
              <span className="text-xs text-text-secondary">
                <span className="cz-num">{pivo.antes.faltas}</span> faltas em{" "}
                <span className="cz-num">{pivo.antes.comDesfecho}</span>{" "}
                consultas com desfecho
              </span>
            </div>
            <div className={BLOCO_AFUNDADO}>
              <span className="cz-eyebrow text-text-secondary">
                Depois (
                <span className="cz-num">
                  {format(
                    new TZDate(pivo.primeiraReguaEm, timezone),
                    "dd/MM/yy",
                    { locale: ptBR },
                  )}
                </span>{" "}
                em diante)
              </span>
              <ValorOuVazio
                valor={pctDeFalta(pivo.depois.faltas, pivo.depois.comDesfecho)}
                className="text-[24px]"
              />
              <span className="text-xs text-text-secondary">
                <span className="cz-num">{pivo.depois.faltas}</span> faltas em{" "}
                <span className="cz-num">{pivo.depois.comDesfecho}</span>{" "}
                consultas com desfecho
              </span>
            </div>
          </div>
        ) : (
          <EmptyState
            compact
            icon={ClipboardCheck}
            title="A régua desta clínica ainda não enviou nenhuma mensagem"
            description="Quando o primeiro toque sair, o comparativo aparece aqui."
          />
        )}
      </Secao>

      <DialogLinhaDeBase
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        aoMudar={aoMudarLinhaDeBase}
      />
    </div>
  );
}
