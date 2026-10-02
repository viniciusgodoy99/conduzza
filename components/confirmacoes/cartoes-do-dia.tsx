"use client";

import { CalendarDays, CircleX, Clock, MailWarning } from "lucide-react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  rodapeDosMotivos,
  type ResumoDosMotivos,
} from "@/lib/domain/falha-de-envio";
import {
  formatarPercentual,
  percentualDe,
} from "@/lib/domain/formato-compacto";

// Os cinco cartoes do topo da Tela 2 (Fase 3, decisao do dono em 02/10/2026),
// no cartao de metrica unico: Agendadas, Confirmadas (o lime da tela),
// Aguardando (com o "Cobrar" dentro, agora secundario: o lime passou a ser o
// cartao, C17), Canceladas e Nao enviadas (com o motivo mais comum).
//
// Cada cartao que E um status carrega as 3 camadas: icone com forma propria,
// rotulo em texto e cor da familia (Clock so Aguardando, CircleX so
// Cancelado, MailWarning o mesmo do chip "Não enviada"). Agendadas e o total,
// sem tom. Nenhum grafico: sao contagens do dia, e contagem se le melhor como
// numero. Os rotulos no DOM sao o texto exato (a caixa alta e so do CSS): o
// e2e acha cada cartao por getByRole("group", { name }).

export type ContagensDoDia = {
  /** Todas as consultas que comecam no dia, em qualquer situacao. */
  total: number;
  /** Predicado unico foiConfirmada (espelho de consulta_foi_confirmada). */
  confirmadas: number;
  /** agendado ou aguardando_confirmacao. */
  aguardando: number;
  canceladas: number;
  /** Aguardando que a clinica pode cobrar agora (autorizadas e com confirmação ligada). */
  cobraveis: number;
  /** Predicado falhouNoEnvio, o mesmo do filtro "Não enviadas". */
  naoEnviadas: number;
  /** Moda dos rotulos curtos das nao enviadas, para o rodape. */
  motivos: ResumoDosMotivos;
};

/** "87,2% do total"; sem consulta no dia, nada (percentual sem base nao e 0%). */
function doTotal(parte: number, total: number): string | undefined {
  const percentual = percentualDe(parte, total);
  return percentual === null
    ? undefined
    : `${formatarPercentual(percentual)}% do total`;
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
  // Secundario (outline): o lime da tela e o cartao Confirmadas (C17).
  const botao = (
    <Button
      variant="outline"
      className="h-10 w-full sm:w-auto"
      disabled={!podeCobrar || cobrando || contagens.cobraveis === 0}
      onClick={onCobrarTodos}
    >
      {cobrando ? "Enviando..." : rotuloDoBotao}
    </Button>
  );
  // Acao sem permissao, ou sem nada para cobrar: visivel e desabilitada, com
  // a dica do porque. Nunca escondida.
  const acao = !podeCobrar ? (
    <DisabledWithHint hint={dicaSemPermissao} className="w-full sm:w-fit">
      {botao}
    </DisabledWithHint>
  ) : contagens.cobraveis === 0 ? (
    <DisabledWithHint
      className="w-full sm:w-fit"
      hint={
        contagens.aguardando === 0
          ? "Nenhuma consulta aguardando confirmação neste dia"
          : "Nenhuma pendente pode ser cobrada agora (sem autorização para receber mensagens ou com a confirmação automática desligada)"
      }
    >
      {botao}
    </DisabledWithHint>
  ) : (
    botao
  );

  // Cinco colunas so a partir de xl: entre lg e xl o cartao ficaria estreito
  // demais para o botao "Cobrar todas as N" (que nao quebra linha).
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <CartaoDeMetrica
        rotulo="Agendadas"
        icone={CalendarDays}
        valor={contagens.total.toLocaleString("pt-BR")}
      />
      <CartaoDeMetrica
        destaque
        rotulo="Confirmadas"
        valor={contagens.confirmadas.toLocaleString("pt-BR")}
        rodape={doTotal(contagens.confirmadas, contagens.total)}
      />
      <CartaoDeMetrica
        rotulo="Aguardando"
        icone={Clock}
        tom="warning"
        valor={contagens.aguardando.toLocaleString("pt-BR")}
        acao={acao}
      />
      <CartaoDeMetrica
        rotulo="Canceladas"
        icone={CircleX}
        tom="alert"
        valor={contagens.canceladas.toLocaleString("pt-BR")}
        rodape={doTotal(contagens.canceladas, contagens.total)}
      />
      <CartaoDeMetrica
        rotulo="Não enviadas"
        icone={MailWarning}
        tom="warning"
        valor={contagens.naoEnviadas.toLocaleString("pt-BR")}
        rodape={rodapeDosMotivos(contagens.motivos) ?? undefined}
      />
    </div>
  );
}
