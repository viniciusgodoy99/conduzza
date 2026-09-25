"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CircleOff,
  ClipboardList,
  Forward,
  ListEnd,
  OctagonAlert,
  Send,
} from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import { formatarCentavos } from "@/lib/utils/moeda";

// Painel "Conversoes devolvidas a Meta", movido da pagina para a aba Origem.
// Os numeros sao DESDE O INICIO (a RPC nao recorta periodo de proposito:
// periodizar conversoes fica para depois), e o rotulo diz isso.
//
// Icones pela tabela de icones reservados (docs/06 4.6): falha e
// OctagonAlert (o CircleAlert e atencao, ambar); enviada e Send com success,
// como "Conversão ativa" e "Enviadas" da regua; "na fila" tem forma propria.

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
      Icone: ListEnd,
      cor: STATUS_TONE_VARS.info.text,
    },
    {
      rotulo: "Enviadas",
      valor: conversoes.porStatus.enviado,
      Icone: Send,
      cor: STATUS_TONE_VARS.success.text,
    },
    {
      rotulo: "Com falha",
      valor: conversoes.porStatus.falhou,
      Icone: OctagonAlert,
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
    <Secao
      titulo="Conversões devolvidas à Meta"
      icone={Forward}
      meta={
        <>
          desde o início
          {conversoes.ultimoEnvio ? (
            <>
              {", último envio "}
              {/* Regra 3.6: exibir no fuso da clinica, nunca no do servidor. */}
              <span className="cz-num">
                {format(
                  new TZDate(conversoes.ultimoEnvio, timezone),
                  "dd/MM 'às' HH:mm",
                  { locale: ptBR },
                )}
              </span>
            </>
          ) : null}
        </>
      }
    >
      {conversoes.total === 0 ? (
        <EmptyState
          compact
          icon={Forward}
          title="Nenhuma conversão registrada ainda"
          description="Escolha em qual etapa da jornada a clínica registra conversão na aba Jornada e conversões, em Configurações. O envio para a conta de anúncios liga depois, na aba de anúncios da Meta."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {statusDeConversao.map((status) => (
              <div
                key={status.rotulo}
                className="grid content-start gap-2 rounded-xl bg-surface-4 p-3.5"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                  <status.Icone
                    className="size-4 shrink-0"
                    style={{ color: status.cor }}
                    aria-hidden
                  />
                  {status.rotulo}
                </span>
                <span className="cz-num text-[24px] leading-none font-semibold text-text-strong">
                  {status.valor.toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-text-secondary">
            <span className="cz-num">{conversoes.comCtwa}</span> de{" "}
            <span className="cz-num">{conversoes.total}</span> com identificador
            do anúncio
            {conversoes.valorEnviadoCents > 0 ? (
              <>
                ,{" "}
                <span className="cz-num">
                  {formatarCentavos(conversoes.valorEnviadoCents)}
                </span>{" "}
                em valor já enviado
              </>
            ) : null}
            .
          </p>
        </>
      )}
    </Secao>
  );
}
