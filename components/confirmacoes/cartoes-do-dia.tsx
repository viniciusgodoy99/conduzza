"use client";

import { CircleCheck, CircleX, Clock, RotateCcw } from "lucide-react";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { STATUS_TONE_VARS, type StatusTone } from "@/lib/design/status";
import { cn } from "@/lib/utils";

// Bento do topo da Tela 2. O cartao de PENDENTES e o heroi (largura dupla):
// e o unico numero que pede acao agora, e a acao mora dentro dele.
//
// Cada cartao carrega as 3 camadas: forma (icone proprio), rotulo em texto e
// cor da familia semantica. Nenhum grafico: sao contagens, e contagem se le
// melhor como numero.

export type ContagensDoDia = {
  total: number;
  pendentes: number;
  confirmadas: number;
  canceladas: number;
  /** Pendentes que a clinica pode cobrar agora (autorizadas e com confirmação ligada). */
  cobraveis: number;
};

function percentual(parte: number, total: number): string {
  if (total <= 0) {
    return "sem consultas no dia";
  }
  const valor = (parte / total) * 100;
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}% do dia`;
}

function Cartao({
  icone: Icone,
  tom,
  rotulo,
  valor,
  apoio,
  heroi = false,
  children,
}: {
  icone: typeof Clock;
  tom: StatusTone;
  rotulo: string;
  valor: React.ReactNode;
  apoio: string;
  heroi?: boolean;
  children?: React.ReactNode;
}) {
  const cores = STATUS_TONE_VARS[tom];
  return (
    <div
      className={cn(
        "grid content-start gap-2 rounded-lg border bg-card p-4",
        heroi && "sm:col-span-2 lg:col-span-2",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: cores.bg, color: cores.text }}
        >
          <Icone strokeWidth={1.5} className="size-4" aria-hidden />
        </span>
        <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
          {rotulo}
        </span>
      </div>
      <span
        className={cn(
          "font-mono leading-none font-semibold tabular-nums",
          heroi ? "text-[40px]" : "text-[28px]",
        )}
      >
        {valor}
      </span>
      <span className="text-[12.5px] text-text-secondary">{apoio}</span>
      {children}
    </div>
  );
}

export function CartoesDoDia({
  contagens,
  podeCobrar,
  dicaSemPermissao,
  cobrando,
  onCobrarTodos,
}: {
  contagens: ContagensDoDia;
  podeCobrar: boolean;
  dicaSemPermissao: string;
  cobrando: boolean;
  onCobrarTodos: () => void;
}) {
  const rotuloDoBotao =
    contagens.cobraveis > 0
      ? `Cobrar ${contagens.cobraveis === 1 ? "a pendente" : `todas as ${contagens.cobraveis}`}`
      : "Cobrar pendentes";
  const botao = (
    <Button
      className="h-10 w-full sm:w-auto"
      disabled={!podeCobrar || cobrando || contagens.cobraveis === 0}
      onClick={onCobrarTodos}
    >
      {cobrando ? "Enviando..." : rotuloDoBotao}
    </Button>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Cartao
        icone={Clock}
        tom="warning"
        rotulo="Pendentes"
        valor={String(contagens.pendentes)}
        apoio={
          contagens.total === 1
            ? "de 1 consulta no dia"
            : `de ${contagens.total} consultas no dia`
        }
        heroi
      >
        {!podeCobrar ? (
          <DisabledWithHint hint={dicaSemPermissao}>{botao}</DisabledWithHint>
        ) : contagens.cobraveis === 0 ? (
          <DisabledWithHint
            hint={
              contagens.pendentes === 0
                ? "Nenhuma consulta pendente neste dia"
                : "Nenhuma pendente pode ser cobrada agora (sem autorização para receber mensagens ou com a confirmação automática desligada)"
            }
          >
            {botao}
          </DisabledWithHint>
        ) : (
          botao
        )}
      </Cartao>
      <Cartao
        icone={CircleCheck}
        tom="success"
        rotulo="Confirmadas"
        valor={String(contagens.confirmadas)}
        apoio={percentual(contagens.confirmadas, contagens.total)}
      />
      <Cartao
        icone={CircleX}
        tom="alert"
        rotulo="Canceladas"
        valor={String(contagens.canceladas)}
        apoio={percentual(contagens.canceladas, contagens.total)}
      />
      {/* Numero honesto: a reoferta e a lista de espera (tarefa 4.9). Sem ela
          nao existe consulta recuperada, e inventar valor aqui seria mentir
          justamente no cartao que justifica a mensalidade. */}
      <Cartao
        icone={RotateCcw}
        tom="neutral"
        rotulo="Recuperadas"
        valor={
          <>
            <span aria-hidden>-</span>
            <span className="sr-only">ainda sem número</span>
          </>
        }
        apoio="Chega com a lista de espera"
      />
    </div>
  );
}
