"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CircleX, Hourglass, Send, UserRoundX } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelarReofertaAction } from "@/app/(app)/espera/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import type { OfertaEmAndamento } from "@/lib/queries/espera";

// A faixa "Reoferta em andamento" do brief: quem recebeu, quanto tempo
// resta (contagem no cliente sobre expires_at, padrao do slot_hold) e o
// botao de cancelar. Situacao de cada destinatario em 3 camadas.

export function FaixaReoferta({
  oferta,
  timezone,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  oferta: OfertaEmAndamento;
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const restanteMin = Math.max(
    0,
    Math.round((new Date(oferta.expires_at).getTime() - agora) / 60_000),
  );
  const inicio = new TZDate(
    new Date(oferta.slot_starts_at).getTime(),
    timezone,
  );

  const cancelar = () => {
    iniciarTransicao(async () => {
      const resultado = await cancelarReofertaAction({ offer_id: oferta.id });
      if (resultado.ok) {
        toast.success("Reoferta cancelada.");
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível cancelar.");
    });
  };

  return (
    <section
      className="grid gap-2 rounded-lg border p-4"
      style={{ borderColor: "var(--info)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Send
          className="size-4"
          style={{ color: "var(--info-text)" }}
          aria-hidden
        />
        <span className="text-sm font-semibold">
          Reoferta em andamento:{" "}
          {format(inicio, "dd/MM 'às' HH:mm", { locale: ptBR })}
          {oferta.professional_nome ? ` com ${oferta.professional_nome}` : ""}
        </span>
        <span className="text-sm text-text-secondary">
          enviada para {oferta.destinatarios.length}{" "}
          {oferta.destinatarios.length === 1 ? "pessoa" : "pessoas"},{" "}
          {restanteMin} min restantes
        </span>
        <span className="ml-auto">
          {podeEditar ? (
            <Button
              variant="outline"
              className="h-10"
              disabled={pendente}
              onClick={cancelar}
            >
              <CircleX className="size-4" />
              {pendente ? "Cancelando..." : "Cancelar reoferta"}
            </Button>
          ) : (
            <DisabledWithHint hint={dicaSemPermissao}>
              <Button variant="outline" className="h-10" disabled>
                <CircleX className="size-4" />
                Cancelar reoferta
              </Button>
            </DisabledWithHint>
          )}
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        {oferta.destinatarios.map((destinatario) => (
          <li key={destinatario.contactId} className="flex items-center gap-1">
            {destinatario.situacao === "recusou" ? (
              <UserRoundX
                className="size-3.5"
                style={{ color: "var(--neutral-text)" }}
                aria-hidden
              />
            ) : (
              <Hourglass
                className="size-3.5"
                style={{ color: "var(--warning-text)" }}
                aria-hidden
              />
            )}
            {destinatario.nome ?? "Paciente"}{" "}
            {destinatario.situacao === "recusou" ? "(recusou)" : "(aguardando)"}
          </li>
        ))}
      </ul>
    </section>
  );
}
