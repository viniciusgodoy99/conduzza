"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckCheck,
  CircleSlash,
  Send,
  Timer,
  UserRoundX,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { fetchMetricasDaRegua } from "@/lib/queries/automacoes";
import { Skeleton } from "@/components/ui/skeleton";

// Metricas por regua (spec 7.8), ultimos 30 dias, so numero real. Sem
// "respondidas" e "agendadas": sem atribuicao de resposta confiavel seria
// numero inventado; chegam com a atribuicao. 3 camadas em cada cartao.

const ROTULO_DO_MOTIVO: Record<string, string> = {
  sem_consentimento: "sem autorização",
  fora_janela: "fora do horário",
  condicao_parada: "parou pela condição",
  falha_envio: "falha no envio",
  desconectado: "WhatsApp fora do ar",
  teto_gasto: "teto de gasto",
  canal_ocupado: "canal ocupado",
};

export function MetricasDaRegua({
  clinicId,
  cadenceId,
}: {
  clinicId: string;
  cadenceId: string;
}) {
  const supabase = createClient();
  const { data, isPending, isError } = useQuery({
    queryKey: ["automacoes", clinicId, "metricas", cadenceId],
    queryFn: () => fetchMetricasDaRegua(supabase, clinicId, cadenceId),
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-xs text-text-secondary">
        Não foi possível carregar as métricas agora.
      </p>
    );
  }

  const cartoes = [
    {
      rotulo: "Enviadas",
      valor: data.enviadas30d,
      Icone: Send,
      cor: "var(--success-text)",
    },
    {
      rotulo: "Entregues",
      valor: data.entregues30d,
      Icone: CheckCheck,
      cor: "var(--info-text)",
    },
    {
      rotulo: "Na fila",
      valor: data.naFila,
      Icone: Timer,
      cor: "var(--neutral-text)",
    },
    {
      rotulo: "Descadastros",
      valor: data.descadastros30d,
      Icone: UserRoundX,
      cor: "var(--alert-text)",
    },
  ];

  return (
    <div className="grid gap-3">
      <h4 className="text-[13px] font-semibold">Últimos 30 dias</h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cartoes.map((cartao) => (
          <div key={cartao.rotulo} className="grid gap-1 rounded-lg border p-3">
            <span className="flex items-center gap-1.5 text-xs text-text-secondary">
              <cartao.Icone
                strokeWidth={1.5}
                className="size-4"
                style={{ color: cartao.cor }}
                aria-hidden
              />
              {cartao.rotulo}
            </span>
            <span className="text-xl font-semibold tabular-nums">
              {cartao.valor}
            </span>
          </div>
        ))}
      </div>
      {data.puladasPorMotivo.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          <CircleSlash
            strokeWidth={1.5}
            className="size-4"
            style={{ color: "var(--warning-text)" }}
            aria-hidden
          />
          Não saíram:
          {data.puladasPorMotivo.map((linha) => (
            <span key={linha.motivo}>
              {linha.total} {ROTULO_DO_MOTIVO[linha.motivo] ?? linha.motivo}
            </span>
          ))}
        </p>
      ) : null}
      <p className="text-[11.5px] text-text-tertiary">
        Respostas e agendamentos gerados pela régua chegam junto com a
        atribuição de resposta; número sem origem confiável não aparece aqui.
      </p>
    </div>
  );
}
