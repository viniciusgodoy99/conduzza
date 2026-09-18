"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CircleAlert,
  CircleOff,
  ClipboardList,
  Send,
  SendHorizonal,
  Timer,
} from "lucide-react";

import { STATUS_TONE_VARS } from "@/lib/design/status";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import { formatarCentavos } from "@/lib/utils/moeda";

// Painel "Conversoes devolvidas a Meta", movido da pagina para a aba Origem.
// Os numeros sao DESDE O INICIO (a RPC nao recorta periodo de proposito:
// periodizar conversoes fica para depois), e o rotulo diz isso.

export function ConversoesMetaSecao({
  conversoes,
  timezone,
}: {
  conversoes: ConversoesResumo;
  timezone: string;
}) {
  // As 3 camadas da regra de status (forma distinta, rotulo, cor), nunca so
  // cor. Registrada = anotada aqui dentro; enviada = ja chegou na Meta.
  const statusDeConversao = [
    {
      rotulo: "Registradas",
      valor: conversoes.porStatus.registrado,
      Icone: ClipboardList,
      cor: STATUS_TONE_VARS.neutral.text,
    },
    {
      rotulo: "Na fila",
      valor: conversoes.porStatus.enfileirado,
      Icone: Timer,
      cor: STATUS_TONE_VARS.info.text,
    },
    {
      rotulo: "Enviadas",
      valor: conversoes.porStatus.enviado,
      Icone: SendHorizonal,
      cor: STATUS_TONE_VARS.success.text,
    },
    {
      rotulo: "Com falha",
      valor: conversoes.porStatus.falhou,
      Icone: CircleAlert,
      cor: STATUS_TONE_VARS.alert.text,
    },
    {
      rotulo: "Descartadas",
      valor: conversoes.porStatus.descartado,
      Icone: CircleOff,
      cor: STATUS_TONE_VARS.neutral.text,
    },
  ];

  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Send strokeWidth={1.5} className="size-4 text-text-secondary" />
        <h2 className="text-[15px] font-semibold">
          Conversões devolvidas à Meta
        </h2>
        <span className="text-sm text-text-tertiary">
          desde o início
          {conversoes.ultimoEnvio ? (
            <>
              {", último envio "}
              {/* Regra 3.6: exibir no fuso da clinica, nunca no do servidor. */}
              {format(
                new TZDate(conversoes.ultimoEnvio, timezone),
                "dd/MM 'às' HH:mm",
                { locale: ptBR },
              )}
            </>
          ) : null}
        </span>
      </div>
      {conversoes.total === 0 ? (
        <p className="max-w-prose text-sm text-text-secondary">
          Nenhuma conversão registrada ainda. Escolha em qual etapa da jornada
          a clínica registra conversão na aba Jornada e conversões, em
          Configurações. O envio para a conta de anúncios liga depois, na aba
          de anúncios da Meta.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {statusDeConversao.map((status) => (
              <div key={status.rotulo} className="grid gap-1">
                <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                  <status.Icone
                    strokeWidth={1.5}
                    className="size-4"
                    style={{ color: status.cor }}
                    aria-hidden
                  />
                  {status.rotulo}
                </span>
                <span className="text-xl font-semibold tabular-nums">
                  {status.valor}
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-text-secondary">
            {conversoes.comCtwa} de {conversoes.total} com identificador do
            anúncio
            {conversoes.valorEnviadoCents > 0
              ? `, ${formatarCentavos(conversoes.valorEnviadoCents)} em valor já enviado`
              : ""}
            .
          </p>
        </>
      )}
    </section>
  );
}
