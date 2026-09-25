"use client";

import { useQuery } from "@tanstack/react-query";
import { BellOff, Inbox, ListEnd, Mails, SkipForward } from "lucide-react";

import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMetricasDaRegua } from "@/lib/queries/automacoes";
import { createClient } from "@/lib/supabase/client";

// Metricas por regua (spec 7.8), ultimos 30 dias, so numero real. Sem
// "respondidas" e "agendadas": sem atribuicao de resposta confiavel seria
// numero inventado; chegam com a atribuicao.
//
// Receita StatCard afundado (docs/06 secoes 4.7 e 5.10): contagem nao e
// status, entao o icone e neutro e de forma propria (nenhum dos mapas de
// status usa estes quatro); o rotulo e o numero dizem tudo. O titulo
// "Últimos 30 dias" fica no cabecalho do cartao, em AbaRegua.

const ROTULO_DO_MOTIVO: Record<string, string> = {
  sem_consentimento: "sem autorização",
  fora_janela: "fora do horário",
  condicao_parada: "parou pela condição",
  falha_envio: "falha no envio",
  desconectado: "WhatsApp fora do ar",
  teto_gasto: "teto de gasto",
  canal_ocupado: "WhatsApp da clínica com fila",
  consulta_remarcada: "consulta remarcada",
  remarcacao_pedida: "pediu para remarcar",
  toque_atrasado: "atrasada, a seguinte cobriu",
};

export function MetricasDaRegua({
  clinicId,
  cadenceId,
}: {
  clinicId: string;
  cadenceId: string;
}) {
  const supabase = createClient();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["automacoes", clinicId, "metricas", cadenceId],
    queryFn: () => fetchMetricasDaRegua(supabase, clinicId, cadenceId),
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-2.5 rounded-xl bg-surface-4 p-3.5">
            <Skeleton className="h-2.5 w-3/5 bg-surface-5" />
            <Skeleton className="h-6 w-2/5 bg-surface-5" />
          </div>
        ))}
      </div>
    );
  }
  if (isError || !data) {
    // Erro nao vira zero: numero falso e pior que estado de erro.
    return (
      <Aviso
        tom="alert"
        acao={
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      >
        Não foi possível carregar os números da régua agora.
      </Aviso>
    );
  }

  // Enviadas e Na fila sao CONTAGEM EXATA (count no banco); Entregues e
  // Descadastros saem do detalhamento, que para de 1000 linhas. Misturar os
  // quatro sem dizer qual e qual fazia a clinica ler "3000 enviadas, 1000
  // entregues" e concluir 33% de entrega (achado da revisao de 15/09/2026).
  const cartoes = [
    {
      rotulo: "Enviadas",
      valor: data.enviadas30d,
      Icone: Mails,
      exato: true,
    },
    {
      rotulo: "Entregues",
      valor: data.entregues30d,
      Icone: Inbox,
      exato: false,
    },
    {
      rotulo: "Na fila",
      valor: data.naFila,
      Icone: ListEnd,
      exato: true,
    },
    {
      rotulo: "Descadastros",
      valor: data.descadastros30d,
      Icone: BellOff,
      exato: false,
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cartoes.map((cartao) => {
          const amostrado = data.aproximado && !cartao.exato;
          return (
            <div
              key={cartao.rotulo}
              className="grid min-w-0 content-start gap-2.5 rounded-xl bg-surface-4 p-3.5"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="cz-eyebrow text-text-secondary">
                  {cartao.rotulo}
                </span>
                <cartao.Icone
                  className="size-4 shrink-0 text-text-secondary"
                  aria-hidden
                />
              </span>
              <span className="cz-num text-2xl leading-none font-semibold text-text-strong">
                {cartao.valor}
              </span>
              {amostrado ? (
                <span className="text-[11px] text-text-secondary">
                  nos <span className="cz-num">1000</span> toques mais recentes
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {data.puladasPorMotivo.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5 font-semibold text-text-strong">
            <SkipForward
              className="size-4 shrink-0 text-warning-text"
              aria-hidden
            />
            Não saíram:
          </span>
          {data.puladasPorMotivo.map((linha) => (
            <span key={linha.motivo}>
              <span className="cz-num font-semibold text-text-strong">
                {linha.total}
              </span>{" "}
              {ROTULO_DO_MOTIVO[linha.motivo] ?? "motivo não identificado"}
            </span>
          ))}
        </p>
      ) : null}
      <p className="text-[11.5px] text-text-secondary">
        {data.aproximado
          ? "Régua com muito volume: Enviadas e Na fila são totais do período; Entregues, Descadastros e os motivos vêm dos 1000 toques mais recentes. "
          : ""}
        Respostas e agendamentos gerados pela régua chegam junto com a
        atribuição de resposta; número sem origem confiável não aparece aqui.
      </p>
    </div>
  );
}
