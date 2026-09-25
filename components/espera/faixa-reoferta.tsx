"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Hourglass, Send, ThumbsDown, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelarReofertaAction } from "@/app/(app)/espera/actions";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import type { OfertaEmAndamento } from "@/lib/queries/espera";

// A faixa "Reoferta em andamento" do brief: quem recebeu, quanto tempo
// resta (contagem no cliente sobre expires_at, padrao do slot_hold) e o
// botao de cancelar. Situacao de cada destinatario em 3 camadas (icone,
// texto e cor): aguardando com Hourglass (pendencia, warning) e recusou com
// ThumbsDown neutro (tabela de icones reservados, docs/06 secao 4.6).
//
// Um cartao so na lateral, com TODAS as ofertas abertas (duas vagas ao mesmo
// tempo precisam de duas entradas: a recepcao so cancela o que enxerga) e o
// vazio dentro dele quando nao ha nenhuma.

export function CartaoReoferta({
  ofertas,
  timezone,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  ofertas: OfertaEmAndamento[];
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section
      aria-labelledby="titulo-da-reoferta"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="titulo-da-reoferta"
          className="text-base leading-[1.3] font-bold tracking-[-0.01em]"
        >
          Reoferta em andamento
        </h2>
        {ofertas.length > 1 ? (
          <span className="shrink-0 text-[12.5px] text-text-secondary">
            <span className="cz-num">{ofertas.length}</span> vagas
          </span>
        ) : null}
      </div>
      {ofertas.length === 0 ? (
        <EmptyState
          compact
          icon={Send}
          title="Nenhuma vaga em reoferta agora"
          description="Quando um horário vagar, a oferta sai sozinha para a fila e aparece aqui."
        />
      ) : (
        <ul className="grid gap-3">
          {ofertas.map((oferta) => (
            <li
              key={oferta.id}
              className="grid gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <OfertaAberta
                oferta={oferta}
                timezone={timezone}
                agora={agora}
                podeEditar={podeEditar}
                dicaSemPermissao={dicaSemPermissao}
                aoMudar={aoMudar}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OfertaAberta({
  oferta,
  timezone,
  agora,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  oferta: OfertaEmAndamento;
  timezone: string;
  agora: number;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [pendente, iniciarTransicao] = useTransition();

  // Arredonda para cima: com 20 s de prazo ainda resta "1 min", nunca "0".
  const restanteMs = new Date(oferta.expires_at).getTime() - agora;
  const restanteMin = Math.ceil(restanteMs / 60_000);
  const inicio = new TZDate(
    new Date(oferta.slot_starts_at).getTime(),
    timezone,
  );
  const dia = format(inicio, "dd/MM", { locale: ptBR });
  const hora = format(inicio, "HH:mm", { locale: ptBR });
  const quantas = oferta.destinatarios.length;

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

  const rotuloDoCancelar = `Cancelar reoferta de ${dia} às ${hora}`;

  return (
    <>
      <div className="flex items-start gap-2.5 rounded-md bg-info-bg px-3 py-2.5 text-info-text">
        <Send className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-[13.5px] font-semibold">
            <span className="cz-num">{dia}</span> às{" "}
            <span className="cz-num">{hora}</span>
            {oferta.professional_nome ? (
              <span className="font-medium">
                {" "}
                com {oferta.professional_nome}
              </span>
            ) : null}
          </p>
          <p className="text-[12.5px]">
            Enviada para <span className="cz-num">{quantas}</span>{" "}
            {quantas === 1 ? "pessoa" : "pessoas"},{" "}
            {restanteMin > 0 ? (
              <>
                <span className="cz-num">{restanteMin}</span> min restantes
              </>
            ) : (
              "prazo de resposta encerrado"
            )}
          </p>
        </div>
      </div>
      <ul aria-label="Quem recebeu a oferta" className="grid gap-1.5">
        {oferta.destinatarios.map((destinatario) => {
          const recusou = destinatario.situacao === "recusou";
          return (
            <li
              key={destinatario.contactId}
              className="flex min-w-0 items-center gap-2 text-[13px]"
            >
              {recusou ? (
                <ThumbsDown
                  className="size-3.5 shrink-0 text-neutral-text"
                  aria-hidden
                />
              ) : (
                <Hourglass
                  className="size-3.5 shrink-0 text-warning-text"
                  aria-hidden
                />
              )}
              <span className="min-w-0 truncate text-foreground">
                {destinatario.nome ?? "Paciente"}
              </span>
              <span
                className={
                  recusou
                    ? "shrink-0 text-neutral-text"
                    : "shrink-0 text-warning-text"
                }
              >
                {recusou ? "(recusou)" : "(aguardando)"}
              </span>
            </li>
          );
        })}
      </ul>
      {podeEditar ? (
        <Button
          variant="outline"
          className="w-full"
          aria-label={rotuloDoCancelar}
          disabled={pendente}
          onClick={cancelar}
        >
          <X />
          {pendente ? "Cancelando..." : "Cancelar reoferta"}
        </Button>
      ) : (
        <DisabledWithHint hint={dicaSemPermissao} className="w-full">
          <Button
            variant="outline"
            className="w-full"
            aria-label={rotuloDoCancelar}
            disabled
          >
            <X />
            Cancelar reoferta
          </Button>
        </DisabledWithHint>
      )}
    </>
  );
}
