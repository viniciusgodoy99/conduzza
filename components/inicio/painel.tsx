import {
  AlarmClock,
  CalendarClock,
  ChevronRight,
  Hand,
  Hourglass,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Secao } from "@/components/relatorios/secao";
import { BotaoRecarregar } from "@/components/shell/botao-recarregar";
import { Aviso } from "@/components/shared/aviso";
import type { EtapaDoFunil, Leitura, ResumoDoDia } from "@/lib/queries/inicio";
import type { ProximasAcoes } from "@/lib/queries/relatorios";
import { cn } from "@/lib/utils";

import {
  LinhasDeAtividades,
  LinhasDeAtividadesCarregando,
} from "./atividades-em-proximas-acoes";
import { ConsultasPorDia } from "./consultas-por-dia";
import { FunilDeLeads } from "./funil-de-leads";
import { IndicadoresDoDia } from "./indicadores-do-dia";

// O painel do Inicio (Tela 5), desde a Fase 3 (decisao do dono de 02/10):
// os numeros do DIA no lugar do periodo de 30 dias. O filtro livre, o funil
// de coorte, a Origem, as Mensagens e o heroi "Consultas recuperadas" moram
// em Resultados. Leitura em F, como no prototipo:
// - a faixa dos 4 cartoes do dia (Consultas hoje, Confirmadas, Aguardando,
//   Resolvidas pela IA);
// - a esquerda, Proximas acoes (o que pede acao agora, exigido pelo brief)
//   e "Consultas por dia, ultimos 7 dias";
// - a direita, o "Funil de leads" pelas etapas da jornada da clinica.
//
// Cada bloco recebe a propria leitura: se uma RPC falha, so aquele bloco
// mostra o erro (nunca zero) e o aviso do topo oferece "Tentar de novo";
// Proximas acoes e o checklist continuam de pe.

export function Painel({
  timezone,
  resumo,
  funil,
  proximasAcoes,
  pedidosDeAcesso = 0,
}: {
  /** Fuso da clinica: o "Ultimo disparo HH:mm" sai nele (regra 3.6). */
  timezone: string;
  resumo: Leitura<ResumoDoDia>;
  funil: Leitura<EtapaDoFunil[]>;
  proximasAcoes: ProximasAcoes;
  /** Pedidos de entrada pelo codigo aguardando liberacao (so quem gerencia
   *  a equipe recebe o numero; para os outros papeis fica 0). */
  pedidosDeAcesso?: number;
}) {
  const algumaFalha = !resumo.ok || !funil.ok;

  return (
    <div className="grid gap-4">
      {algumaFalha ? (
        <Aviso
          tom="alert"
          titulo="Alguns números não carregaram"
          acao={<BotaoRecarregar rotulo="Tentar de novo" variant="outline" />}
        >
          O que falhou está marcado abaixo. O resto da tela está certo.
        </Aviso>
      ) : null}

      <IndicadoresDoDia resumo={resumo} timezone={timezone} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <CartaoProximasAcoes
            proximasAcoes={proximasAcoes}
            pedidosDeAcesso={pedidosDeAcesso}
          />
          <ConsultasPorDia resumo={resumo} />
        </div>
        <FunilDeLeads funil={funil} />
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
 *  já filtrada (achado 109): o Atendimento lê ?filtro= e abre no recorte.
 *  As duas linhas de atividades (as suas atrasadas e para hoje) vêm de um
 *  componente de servidor próprio, em Suspense: a falha delas não derruba o
 *  cartão nem o Início. */
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
        {/* Atividades: leitura propria, que chega depois e falha sozinha. */}
        <Suspense fallback={<LinhasDeAtividadesCarregando />}>
          <LinhasDeAtividades />
        </Suspense>
      </ul>
    </Secao>
  );
}
