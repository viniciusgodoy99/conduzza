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
  /** Horarios do dia preenchidos pela reoferta da lista de espera (4.9). */
  recuperadas: number;
};

function percentual(parte: number, total: number): React.ReactNode {
  if (total <= 0) {
    return "sem consultas no dia";
  }
  const valor = (parte / total) * 100;
  return (
    <>
      <span className="cz-num">
        {valor.toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}
        %
      </span>{" "}
      do dia
    </>
  );
}

// Receita StatCard do design system (docs/06 secao 4.7): rotulo em eyebrow
// (a caixa alta e so do CSS: no DOM o texto continua "Pendentes", que o e2e
// procura exato) e o icone do status num quadrado com o fundo e o texto da
// familia. O heroi tem o numero de 34px; os demais, 24px.
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
  valor: number;
  apoio: React.ReactNode;
  heroi?: boolean;
  children?: React.ReactNode;
}) {
  const cores = STATUS_TONE_VARS[tom];
  return (
    <div
      className={cn(
        "grid min-w-0 content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm",
        heroi && "sm:col-span-2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="cz-eyebrow text-text-secondary">{rotulo}</span>
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: cores.bg, color: cores.text }}
        >
          <Icone className="size-4" aria-hidden />
        </span>
      </div>
      <span
        className={cn(
          "cz-num leading-none font-semibold text-text-strong",
          heroi ? "text-[34px]" : "text-2xl",
        )}
      >
        {valor}
      </span>
      <span className="text-xs text-text-secondary">{apoio}</span>
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
  // O unico botao lime do corpo da tela (docs/06 secao 5.7).
  const botao = (
    <Button
      className="w-full sm:w-auto"
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
        valor={contagens.pendentes}
        apoio={
          <>
            de <span className="cz-num">{contagens.total}</span>{" "}
            {contagens.total === 1 ? "consulta no dia" : "consultas no dia"}
          </>
        }
        heroi
      >
        {!podeCobrar ? (
          <DisabledWithHint hint={dicaSemPermissao} className="w-full sm:w-fit">
            {botao}
          </DisabledWithHint>
        ) : contagens.cobraveis === 0 ? (
          <DisabledWithHint
            className="w-full sm:w-fit"
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
        valor={contagens.confirmadas}
        apoio={percentual(contagens.confirmadas, contagens.total)}
      />
      <Cartao
        icone={CircleX}
        tom="alert"
        rotulo="Canceladas"
        valor={contagens.canceladas}
        apoio={percentual(contagens.canceladas, contagens.total)}
      />
      {/* O numero que justifica a mensalidade, agora REAL: horarios do dia
          preenchidos pela reoferta da lista de espera. Tom fixo success
          (tabela de icones reservados): o icone nao troca de cor com o
          valor. */}
      <Cartao
        icone={RotateCcw}
        tom="success"
        rotulo="Recuperadas"
        valor={contagens.recuperadas}
        apoio="pela lista de espera"
      />
    </div>
  );
}
