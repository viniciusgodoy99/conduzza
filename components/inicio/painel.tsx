import {
  CalendarClock,
  Hand,
  MessageSquareText,
  MessagesSquare,
  Timer,
} from "lucide-react";
import Link from "next/link";

import { rotuloDoCanal } from "@/components/leads/rotulos";
import { formatarDuracao } from "@/lib/domain/duracao";
import { BarraHorizontal } from "@/components/relatorios/barra-horizontal";
import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import type {
  AgendaDoPeriodo,
  AtendimentoDoPeriodo,
  FunilDoPeriodo,
  Periodizado,
  ProximasAcoes,
} from "@/lib/queries/relatorios";
import { formatarCentavos } from "@/lib/utils/moeda";

// O painel do Inicio (Tela 5): bento com um ponto focal, leitura em F.
// Periodo FIXO dos ultimos 30 dias civis contra os 30 anteriores; o filtro
// livre mora em Resultados. Todo numero aqui vem das mesmas RPCs da Tela 11:
// dois numeros com o mesmo nome contam igual nas duas telas.
//
// O card heroi e "Consultas recuperadas": horarios preenchidos pela lista
// de espera, com a receita associada. Sem contrafactual ("confirmacoes que
// evitaram falta" nao e mensuravel e nao se inventa numero); a remarcacao
// apos falta entra como numero FACTUAL, com o rotulo exato.

function pct(parte: number, todo: number): string {
  if (todo <= 0) {
    // Mesmo criterio da Tela 11: sem denominador nao ha taxa a mostrar.
    return "sem dados";
  }
  return `${Math.round((parte / todo) * 100)}%`;
}

export function Painel({
  funil,
  agenda,
  atendimento,
  proximasAcoes,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  agenda: Periodizado<AgendaDoPeriodo>;
  atendimento: Periodizado<AtendimentoDoPeriodo>;
  proximasAcoes: ProximasAcoes;
}) {
  const f = funil.atual;
  const fAnterior = funil.anterior;
  const a = agenda.atual;
  const at = atendimento.atual;
  const atAnterior = atendimento.anterior;

  const maiorCanal = f.porCanal.reduce(
    (max, canal) => Math.max(max, canal.leads),
    0,
  );

  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-secondary">
        Últimos 30 dias, comparados com os 30 anteriores.{" "}
        <Link href="/relatorios" className="underline underline-offset-2">
          Ver com outro período em Resultados
        </Link>
      </p>

      {/* Linha 1: a faixa de 4 indicadores */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoKpi
          rotulo="Leads no período"
          valor={f.leads.toLocaleString("pt-BR")}
          anterior={
            fAnterior ? { atual: f.leads, anterior: fAnterior.leads } : null
          }
        />
        <CartaoKpi
          rotulo="Agendamentos criados"
          valor={f.agendamentosCriados.toLocaleString("pt-BR")}
          anterior={
            fAnterior
              ? {
                  atual: f.agendamentosCriados,
                  anterior: fAnterior.agendamentosCriados,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Comparecimentos"
          valor={f.comparecimentos.toLocaleString("pt-BR")}
          anterior={
            fAnterior
              ? {
                  atual: f.comparecimentos,
                  anterior: fAnterior.comparecimentos,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Lead para comparecimento"
          valor={pct(f.coorte.compareceram, f.coorte.leads)}
          notaSemDelta="coorte do período, ainda em maturação"
        />
      </section>

      {/* Linha 2: heroi + atendimento */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CartaoKpi
          rotulo="Consultas recuperadas"
          valor={a.recuperadas.total.toLocaleString("pt-BR")}
          heroi
          anterior={
            agenda.anterior
              ? {
                  atual: a.recuperadas.total,
                  anterior: agenda.anterior.recuperadas.total,
                }
              : null
          }
        >
          <p className="text-[12.5px] text-text-secondary">
            {a.recuperadas.total > 0
              ? `Horários que ficariam vagos e foram preenchidos pela lista de espera, com ${formatarCentavos(a.recuperadas.receitaCents)} em receita associada${
                  a.recuperadas.semPreco > 0
                    ? ` (${a.recuperadas.semPreco} sem preço cadastrado)`
                    : ""
                }.`
              : "Quando um cancelamento for preenchido pela lista de espera, o horário recuperado conta aqui."}{" "}
            {a.remarcadasAposFalta.faltas > 0
              ? `Além disso, ${a.remarcadasAposFalta.remarcadas} de ${a.remarcadasAposFalta.faltas} faltas remarcaram em até 30 dias.`
              : ""}
          </p>
        </CartaoKpi>
        <div className="grid content-start gap-2 rounded-lg border bg-card p-4 sm:col-span-2">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
            Atendimento
          </span>
          <div className="grid gap-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-text-secondary">Novas conversas</span>
              <span className="font-mono font-semibold tabular-nums">
                {at.conversasIniciadas.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-text-secondary">
                Primeira resposta (mediana)
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {formatarDuracao(at.primeiraResposta.medianaSegundos)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-text-secondary">
                Aguardando resposta agora
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {proximasAcoes.aguardandoHumano.toLocaleString("pt-BR")}
              </span>
            </div>
            <DisabledWithHint hint="Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.">
              <div className="flex w-full items-baseline justify-between gap-2 opacity-60">
                <span className="text-text-secondary">
                  Resolvidas pela IA sem humano
                </span>
                <span className="font-mono font-semibold text-text-tertiary">
                  --
                </span>
              </div>
            </DisabledWithHint>
          </div>
        </div>
      </section>

      {/* Linha 3: funil + origem */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="grid content-start gap-3 rounded-lg border bg-card p-4">
          <h2 className="text-[15px] font-semibold">
            Funil dos leads do período
          </h2>
          <div className="grid gap-3">
            {[
              {
                rotulo: "Chegaram",
                valor: f.coorte.leads,
                taxa: null as string | null,
              },
              {
                rotulo: "Agendaram",
                valor: f.coorte.agendaram,
                taxa: pct(f.coorte.agendaram, f.coorte.leads),
              },
              {
                rotulo: "Compareceram",
                valor: f.coorte.compareceram,
                taxa: pct(f.coorte.compareceram, f.coorte.agendaram),
              },
            ].map((etapa) => {
              // Piso so para valor > 0: barra desenhada para zero mente.
              const largura =
                f.coorte.leads > 0 && etapa.valor > 0
                  ? Math.max(4, (etapa.valor / f.coorte.leads) * 100)
                  : 0;
              return (
                <div key={etapa.rotulo} className="grid gap-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{etapa.rotulo}</span>
                    <span className="text-text-secondary tabular-nums">
                      {etapa.valor}
                      {etapa.taxa ? (
                        <span className="text-text-tertiary">
                          {" "}
                          ({etapa.taxa})
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <span
                    role="img"
                    aria-label={`${etapa.rotulo}: ${etapa.valor}`}
                    className="block h-2.5 overflow-hidden rounded-full bg-surface-4"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${largura}%`,
                        background: "var(--primary)",
                      }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid content-start gap-3 rounded-lg border bg-card p-4">
          <h2 className="text-[15px] font-semibold">Origem dos leads</h2>
          {f.porCanal.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nenhum lead chegou neste período.
            </p>
          ) : (
            <div className="grid gap-2">
              {f.porCanal.map((canal) => (
                <BarraHorizontal
                  key={canal.canal ?? "sem_atribuicao"}
                  rotulo={rotuloDoCanal(canal.canal) ?? "Sem atribuição"}
                  valor={canal.leads}
                  maximo={maiorCanal}
                  destaque={canal.canal !== null}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Linha 4: mensagens + proximas acoes */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="grid content-start gap-2 rounded-lg border bg-card p-4">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
            <MessageSquareText
              strokeWidth={1.5}
              className="size-4"
              aria-hidden
            />
            Mensagens no período
          </span>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-0.5">
              <span className="text-xs text-text-secondary">Enviadas</span>
              <span className="font-mono text-[28px] leading-none font-semibold tabular-nums">
                {at.mensagens.saida.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="grid gap-0.5">
              <span className="text-xs text-text-secondary">Recebidas</span>
              <span className="font-mono text-[28px] leading-none font-semibold tabular-nums">
                {at.mensagens.entrada.toLocaleString("pt-BR")}
              </span>
            </div>
          </div>
          <p className="text-[12.5px] text-text-tertiary">
            No WhatsApp conectado por QR não há custo por mensagem
            {atAnterior
              ? `; no período anterior foram ${atAnterior.mensagens.saida.toLocaleString("pt-BR")} enviadas`
              : ""}
            .
          </p>
        </div>
        <CartaoProximasAcoes proximasAcoes={proximasAcoes} />
      </section>
    </div>
  );
}

/** Card de Próximas ações, compartilhado com a visão do profissional (onde
 *  a RLS já recorta as contagens para "as dele"). */
export function CartaoProximasAcoes({
  proximasAcoes,
  rotulo = "Próximas ações",
}: {
  proximasAcoes: ProximasAcoes;
  rotulo?: string;
}) {
  const acoes = [
    {
      rotulo: "Confirmações pendentes de amanhã",
      valor: proximasAcoes.confirmacoesPendentesAmanha,
      href: "/confirmacoes",
      Icone: CalendarClock,
    },
    {
      rotulo: "Conversas aguardando você",
      valor: proximasAcoes.aguardandoHumano,
      href: "/atendimento",
      Icone: Hand,
    },
    {
      rotulo: "Sem resposta há mais de 24h",
      valor: proximasAcoes.semResposta24h,
      href: "/atendimento",
      Icone: Timer,
    },
  ];
  return (
    <div className="grid content-start gap-2 rounded-lg border bg-card p-4">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
        <MessagesSquare strokeWidth={1.5} className="size-4" aria-hidden />
        {rotulo}
      </span>
      <div className="grid gap-1.5">
        {acoes.map((acao) => (
          <Link
            key={acao.rotulo}
            href={acao.href}
            className="flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-surface-2"
          >
            <acao.Icone
              strokeWidth={1.5}
              className="size-4 shrink-0 text-text-secondary"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{acao.rotulo}</span>
            <span className="font-mono font-semibold tabular-nums">
              {acao.valor.toLocaleString("pt-BR")}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}