import {
  AlarmClock,
  CalendarClock,
  ChevronRight,
  Funnel,
  Hand,
  Hourglass,
  Inbox,
  ListTodo,
  Megaphone,
  MessageCircleMore,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { rotuloDoCanal } from "@/components/leads/rotulos";
import { BarraHorizontal } from "@/components/relatorios/barra-horizontal";
import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { Secao } from "@/components/relatorios/secao";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { formatarDuracao } from "@/lib/domain/duracao";
import type {
  AgendaDoPeriodo,
  AtendimentoDoPeriodo,
  FunilDoPeriodo,
  Periodizado,
  ProximasAcoes,
} from "@/lib/queries/relatorios";
import { cn } from "@/lib/utils";
import { formatarCentavos } from "@/lib/utils/moeda";

// O painel do Inicio (Tela 5): bento com um ponto focal, leitura em F, no
// desenho do design system Conduzza (docs/06 secao 5.2). Periodo FIXO dos
// ultimos 30 dias civis contra os 30 anteriores; o filtro livre mora em
// Resultados. Todo numero aqui vem das mesmas RPCs da Tela 11: dois numeros
// com o mesmo nome contam igual nas duas telas.
//
// O card heroi e "Consultas recuperadas": horarios preenchidos pela lista
// de espera, com a receita associada. Sem contrafactual ("confirmacoes que
// evitaram falta" nao e mensuravel e nao se inventa numero); a remarcacao
// apos falta entra como numero FACTUAL, com o rotulo exato. E o unico
// preenchimento lime do corpo da tela (D16).

function pct(parte: number, todo: number): string {
  if (todo <= 0) {
    // Mesmo criterio da Tela 11: sem denominador nao ha taxa a mostrar.
    return "sem dados";
  }
  return `${Math.round((parte / todo) * 100)}%`;
}

// Linha de dado do bloco Atendimento (receita "linha de dado", docs/06 4.7):
// rotulo a esquerda, numero mono a direita. Valor sem numero ("sem dados") e
// campo vazio: texto secundario, nunca travessao.
const LINHA_DE_DADO =
  "flex items-baseline justify-between gap-2 border-b border-border py-2.5 text-[13px] last:border-0";

function LinhaDeDado({ rotulo, valor }: { rotulo: string; valor: string }) {
  const temNumero = /\d/.test(valor);
  return (
    <div className={LINHA_DE_DADO}>
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd
        className={
          temNumero
            ? "cz-num font-semibold text-text-strong"
            : "text-text-secondary"
        }
      >
        {temNumero ? valor : valor.charAt(0).toUpperCase() + valor.slice(1)}
      </dd>
    </div>
  );
}

export function Painel({
  funil,
  agenda,
  atendimento,
  proximasAcoes,
  pedidosDeAcesso = 0,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  agenda: Periodizado<AgendaDoPeriodo>;
  atendimento: Periodizado<AtendimentoDoPeriodo>;
  proximasAcoes: ProximasAcoes;
  /** Pedidos de entrada pelo codigo aguardando liberacao (so quem gerencia
   *  a equipe recebe o numero; para os outros papeis fica 0). */
  pedidosDeAcesso?: number;
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

  const etapasDoFunil = [
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
  ];
  // Denominador da participacao de cada canal: a soma das proprias barras.
  const totalDosCanais = f.porCanal.reduce(
    (soma, canal) => soma + canal.leads,
    0,
  );

  return (
    <div className="grid gap-4">
      <p className="text-xs font-medium text-text-secondary">
        Últimos <span className="cz-num">30</span> dias, comparados com os{" "}
        <span className="cz-num">30</span> anteriores.
      </p>

      {/* A faixa de 4 indicadores */}
      <section
        aria-label="Indicadores do período"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
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

      {/* Linha 1: heroi + atendimento */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
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
          <p className="max-w-[60ch] text-[13px] leading-[1.5] text-primary-foreground">
            {a.recuperadas.total > 0 ? (
              <>
                Horários que ficariam vagos e foram preenchidos pela lista de
                espera, com{" "}
                <span className="cz-num font-semibold">
                  {formatarCentavos(a.recuperadas.receitaCents)}
                </span>{" "}
                em receita associada
                {a.recuperadas.semPreco > 0 ? (
                  <>
                    {" "}
                    (<span className="cz-num">
                      {a.recuperadas.semPreco}
                    </span>{" "}
                    sem preço cadastrado)
                  </>
                ) : null}
                .
              </>
            ) : (
              "Quando um cancelamento for preenchido pela lista de espera, o horário recuperado conta aqui."
            )}
            {a.remarcadasAposFalta.faltas > 0 ? (
              <>
                {" "}
                Além disso,{" "}
                <span className="cz-num">
                  {a.remarcadasAposFalta.remarcadas}
                </span>{" "}
                de{" "}
                <span className="cz-num">{a.remarcadasAposFalta.faltas}</span>{" "}
                faltas remarcaram em até <span className="cz-num">30</span>{" "}
                dias.
              </>
            ) : null}
          </p>
        </CartaoKpi>
        <Secao
          titulo="Atendimento"
          icone={MessagesSquare}
          corpoClassName="py-1.5"
        >
          <dl className="grid">
            <LinhaDeDado
              rotulo="Novas conversas"
              valor={at.conversasIniciadas.toLocaleString("pt-BR")}
            />
            <LinhaDeDado
              rotulo="Primeira resposta (mediana)"
              valor={formatarDuracao(at.primeiraResposta.medianaSegundos)}
            />
            <LinhaDeDado
              rotulo="Aguardando resposta agora"
              valor={proximasAcoes.aguardandoHumano.toLocaleString("pt-BR")}
            />
            <div className={cn(LINHA_DE_DADO, "opacity-45")}>
              <dt className="text-text-secondary">
                Resolvidas pela IA sem humano
              </dt>
              <dd>
                <DisabledWithHint hint="Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.">
                  <span className="text-text-secondary">Ainda não medido</span>
                </DisabledWithHint>
              </dd>
            </div>
          </dl>
        </Secao>
      </div>

      {/* Linha 2: funil + origem */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Secao titulo="Funil dos leads do período" icone={Funnel}>
          {etapasDoFunil.map((etapa) => (
            <BarraDeProgresso
              key={etapa.rotulo}
              rotulo={etapa.rotulo}
              legenda={`${etapa.valor.toLocaleString("pt-BR")}${
                etapa.taxa ? ` (${etapa.taxa})` : ""
              }`}
              valor={etapa.valor}
              maximo={f.coorte.leads}
              tom="destaque"
              ariaLabel={`${etapa.rotulo}: ${etapa.valor}`}
            />
          ))}
        </Secao>
        <Secao titulo="Origem dos leads" icone={Megaphone}>
          {f.porCanal.length === 0 ? (
            <EmptyState
              compact
              icon={Inbox}
              title="Nenhum lead chegou neste período"
            />
          ) : (
            f.porCanal.map((canal) => (
              <BarraHorizontal
                key={canal.canal ?? "sem_atribuicao"}
                rotulo={rotuloDoCanal(canal.canal) ?? "Sem atribuição"}
                valor={canal.leads}
                maximo={maiorCanal}
                total={totalDosCanais}
                destaque={canal.canal !== null}
              />
            ))
          )}
        </Secao>
      </div>

      {/* Linha 3: proximas acoes + mensagens */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <CartaoProximasAcoes
          proximasAcoes={proximasAcoes}
          pedidosDeAcesso={pedidosDeAcesso}
        />
        <Secao titulo="Mensagens no período" icone={MessageCircleMore}>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <span className="cz-eyebrow text-text-secondary">Enviadas</span>
              <span className="cz-num text-[24px] leading-none font-semibold text-text-strong">
                {at.mensagens.saida.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="grid gap-2">
              <span className="cz-eyebrow text-text-secondary">Recebidas</span>
              <span className="cz-num text-[24px] leading-none font-semibold text-text-strong">
                {at.mensagens.entrada.toLocaleString("pt-BR")}
              </span>
            </div>
          </div>
          <p className="border-t border-border pt-3 text-xs text-text-secondary">
            No WhatsApp conectado por QR não há custo por mensagem
            {atAnterior ? (
              <>
                ; no período anterior foram{" "}
                <span className="cz-num">
                  {atAnterior.mensagens.saida.toLocaleString("pt-BR")}
                </span>{" "}
                enviadas
              </>
            ) : null}
            .
          </p>
        </Secao>
      </div>
    </div>
  );
}

type ItemDeProximaAcao = {
  rotulo: string;
  valor: number;
  href: string;
  Icone: LucideIcon;
  /** Tabela de icones reservados (docs/06 4.6): um icone, uma cor. */
  corDoIcone: string;
};

/** Card de Próximas ações, compartilhado com a visão do profissional (onde
 *  a RLS já recorta as contagens para "as dele"). Cada item leva à pendência
 *  já filtrada (achado 109): o Atendimento lê ?filtro= e abre no recorte. */
export function CartaoProximasAcoes({
  proximasAcoes,
  pedidosDeAcesso = 0,
  rotulo = "Próximas ações",
}: {
  proximasAcoes: ProximasAcoes;
  /** Pedidos de entrada pelo código (achados 108 e 125): o item só aparece
   *  com pedido parado, para quem gerencia a equipe. */
  pedidosDeAcesso?: number;
  rotulo?: string;
}) {
  const acoes: ItemDeProximaAcao[] = [
    {
      rotulo: "Confirmações pendentes de amanhã",
      valor: proximasAcoes.confirmacoesPendentesAmanha,
      href: "/confirmacoes",
      Icone: CalendarClock,
      corDoIcone: "text-text-secondary",
    },
    {
      rotulo: "Conversas aguardando você",
      valor: proximasAcoes.aguardandoHumano,
      href: "/atendimento?filtro=aguardando",
      Icone: Hand,
      corDoIcone: "text-warning-text",
    },
    {
      rotulo: "Sem resposta há mais de 24h",
      valor: proximasAcoes.semResposta24h,
      href: "/atendimento?filtro=sem_resposta_24h",
      Icone: AlarmClock,
      corDoIcone: "text-alert-text",
    },
  ];
  if (pedidosDeAcesso > 0) {
    acoes.push({
      rotulo:
        pedidosDeAcesso === 1
          ? "Pessoa aguardando liberação de acesso"
          : "Pessoas aguardando liberação de acesso",
      valor: pedidosDeAcesso,
      href: "/configuracoes?aba=equipe",
      Icone: Hourglass,
      corDoIcone: "text-warning-text",
    });
  }

  return (
    <Secao titulo={rotulo} icone={ListTodo} semPadding>
      <ul>
        {acoes.map((acao) => (
          <li key={acao.href} className="border-b border-border last:border-0">
            <Link
              href={acao.href}
              className="flex min-h-11 items-center gap-2.5 px-4 py-2 text-[13.5px] text-foreground outline-none cz-transition hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              <acao.Icone
                aria-hidden
                className={cn("size-4 shrink-0", acao.corDoIcone)}
              />
              <span className="min-w-0 flex-1 truncate">{acao.rotulo}</span>
              <span className="cz-num font-bold text-text-strong">
                {acao.valor.toLocaleString("pt-BR")}
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-text-secondary"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Secao>
  );
}
