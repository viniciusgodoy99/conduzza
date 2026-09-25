"use client";

import {
  AlarmClock,
  Check,
  ChevronDown,
  LoaderCircle,
  MessagesSquare,
  OctagonAlert,
  Search,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConversationCard } from "@/components/atendimento/conversation-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CONVERSATION_STATUS,
  STATUS_TONE_VARS,
  estadoVisualDaConversa,
  type StatusDefinition,
} from "@/lib/design/status";
import {
  casaEtiquetas,
  etiquetasDaConversa,
  porChaveDeEtiqueta,
  type EtiquetaDeConversa,
} from "@/lib/domain/etiquetas-de-conversa";
import {
  casaBusca,
  casaSituacao,
  recencia,
  type FiltroDeSituacao,
} from "@/lib/domain/filtros-da-conversa";
import {
  CONVERSATIONS_ATIVAS_LIMIT,
  RESOLVIDAS_LIMIT,
  type ConversationListItem,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Lista de conversas (design system Conduzza, docs/06 secao 5.3): filtros no
// topo na ordem busca, posse, situacao e etiquetas; cartoes rolando embaixo.
// Busca client-side sobre as conversas carregadas (as 300 ativas mais
// recentes, mais o arquivo quando aberto).

type OwnFilter = "minhas" | "sem_atendente" | "todas";

// Ordem dos chips de situacao. "IA atendendo" so aparece quando existe
// conversa com a IA (o Agente e da Fase 3; hoje o chip viraria um zero
// permanente na tela da recepcao).
const SITUACOES: FiltroDeSituacao[] = [
  "ia_atendendo",
  "aguardando_humano",
  "sem_resposta_24h",
  "em_atendimento",
  "resolvida",
];

// O recorte de urgencia do Inicio ("Sem resposta ha mais de 24h"), com o
// mesmo icone e o mesmo tom do item de Proximas acoes que leva ate aqui.
const SEM_RESPOSTA_24H: StatusDefinition = {
  label: "Há mais de 24h",
  tone: "alert",
  icon: AlarmClock,
};

function definicaoDaSituacao(situacao: FiltroDeSituacao): StatusDefinition {
  return situacao === "sem_resposta_24h"
    ? SEM_RESPOSTA_24H
    : CONVERSATION_STATUS[situacao];
}

export function ConversationList({
  nomesDeEtapa,
  etiquetas,
  conversations,
  viewerId,
  authorNames,
  timezone,
  agoraInicial,
  selectedId,
  onSelect,
  filtroInicial = null,
  onResolvedRequested,
  resolvedLoading = false,
  resolvedError = false,
  onRetryResolved,
  resolvidasTotal = null,
  resolvidasNoTeto = false,
  semAtivas = false,
  temArquivo = false,
  ehProfissional = false,
}: {
  nomesDeEtapa: Record<string, string>;
  /** Catalogo da clinica: resolve chave para nome e cor. */
  etiquetas: EtiquetaDeConversa[];
  conversations: ConversationListItem[];
  viewerId: string;
  /** Nomes da equipe: o cartao diz quem esta atendendo */
  authorNames: Record<string, string>;
  /** Fuso da clinica: a hora do cartao sai nele (regra 3.6) */
  timezone: string;
  /** Relogio do servidor na carga, para o primeiro desenho bater com o HTML */
  agoraInicial: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Chip de situacao marcado na chegada (link do Inicio ou da conversa) */
  filtroInicial?: FiltroDeSituacao | null;
  // Resolvidas sao arquivo carregado sob demanda: avisa o container quando o
  // usuario abre ou fecha o filtro de resolvidas.
  onResolvedRequested?: (open: boolean) => void;
  resolvedLoading?: boolean;
  resolvedError?: boolean;
  onRetryResolved?: () => void;
  /**
   * Total de resolvidas que esta pessoa ve (contagem no servidor). Nulo
   * enquanto nao chegou ou se a contagem falhou.
   */
  resolvidasTotal?: number | null;
  /** O arquivo carregado encheu o teto (RESOLVIDAS_LIMIT): ha mais la. */
  resolvidasNoTeto?: boolean;
  /** Nenhuma conversa em andamento carregada */
  semAtivas?: boolean;
  /** Ha (ou houve) conversa resolvida para oferecer no vazio */
  temArquivo?: boolean;
  /** O profissional so enxerga as conversas atribuidas a ele (RLS) */
  ehProfissional?: boolean;
}) {
  const [own, setOwn] = useState<OwnFilter>("todas");
  const [situacao, setSituacao] = useState<FiltroDeSituacao | null>(
    filtroInicial,
  );
  const [search, setSearch] = useState("");
  const [etiquetasEscolhidas, setEtiquetasEscolhidas] = useState<string[]>([]);
  // Relogio da lista: "Ha mais de 24h" e o "hoje" da hora do cartao andam com
  // ele. Comeca no relogio do servidor (o HTML e a hidratacao concordam) e
  // anda de minuto em minuto.
  const [agora, setAgora] = useState(agoraInicial);
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 60_000);
    return () => window.clearInterval(relogio);
  }, []);

  const porChave = useMemo(() => porChaveDeEtiqueta(etiquetas), [etiquetas]);

  // Escolha EFETIVA: o gestor pode excluir uma etiqueta enquanto ela esta
  // marcada aqui. Sem a poda, a chave morta continuaria filtrando e a lista
  // ficaria vazia sem nenhum chip na tela para desmarcar.
  const etiquetasAtivas = useMemo(
    () => etiquetasEscolhidas.filter((chave) => porChave.has(chave)),
    [etiquetasEscolhidas, porChave],
  );

  const escolherSituacao = (proxima: FiltroDeSituacao | null) => {
    const anterior = situacao;
    setSituacao(proxima);
    // O arquivo de resolvidas so e buscado com o chip ligado.
    if (anterior === "resolvida" || proxima === "resolvida") {
      onResolvedRequested?.(proxima === "resolvida");
    }
  };
  const alternarSituacao = (alvo: FiltroDeSituacao) =>
    escolherSituacao(situacao === alvo ? null : alvo);

  const counts = useMemo(() => {
    const mine = conversations.filter(
      (c) => c.assignee_user_id === viewerId,
    ).length;
    const unassigned = conversations.filter(
      (c) => c.assignee_user_id === null && c.status !== "resolvida",
    ).length;
    // Cada chip conta EXATAMENTE o conjunto que ele filtra (casaSituacao).
    const porSituacao = Object.fromEntries(
      SITUACOES.map((alvo) => [
        alvo,
        conversations.filter((c) => casaSituacao(c, alvo, agora)).length,
      ]),
    ) as Record<FiltroDeSituacao, number>;
    const ativas = conversations.filter((c) => c.status !== "resolvida").length;
    return { mine, unassigned, all: conversations.length, porSituacao, ativas };
  }, [conversations, viewerId, agora]);

  const filtered = useMemo(() => {
    return (
      conversations
        .filter((conversation) => {
          if (own === "minhas" && conversation.assignee_user_id !== viewerId) {
            return false;
          }
          if (
            own === "sem_atendente" &&
            (conversation.assignee_user_id !== null ||
              conversation.status === "resolvida")
          ) {
            return false;
          }
          // O chip filtra o mesmo conjunto que ele conta: número e lista têm
          // de dizer a mesma coisa.
          if (situacao && !casaSituacao(conversation, situacao, agora)) {
            return false;
          }
          // Marcar varias etiquetas SOMA os resultados (decisao do dono).
          if (!casaEtiquetas(conversation.tags, etiquetasAtivas)) {
            return false;
          }
          // Nome sem acento e sem caixa, ou telefone por digitos (com e sem
          // o 9, com e sem mascara): lib/domain/filtros-da-conversa.ts.
          return casaBusca(conversation.contact, search);
        })
        // ORDEM DE RECEBIMENTO, uma regra só: a fala mais recente do paciente
        // primeiro. Antes a chave primária era o booleano "esperando
        // resposta", o que empilhava a lista em dois blocos e fazia a coluna
        // de horários parecer embaralhada sem motivo visível.
        //
        // O sinal que aquele critério carregava não se perdeu: ele vive no
        // chip "Aguardando você", que é filtro, e é o lugar certo dele. Assim
        // um disparo de 40 confirmações continua não escondendo a conversa em
        // que o paciente escreveu, e quem quer ver só quem espera, filtra.
        .sort((a, b) => recencia(b) - recencia(a))
    );
  }, [conversations, own, situacao, search, etiquetasAtivas, viewerId, agora]);

  const hasActiveFilter =
    own !== "todas" ||
    situacao !== null ||
    search.trim() !== "" ||
    etiquetasAtivas.length > 0;

  const limparFiltros = () => {
    setOwn("todas");
    escolherSituacao(null);
    setSearch("");
    setEtiquetasEscolhidas([]);
  };

  // Resolvidas: o numero so existe depois de o arquivo chegar. Antes disso o
  // chip dizia "Resolvida 0", que e mentira.
  const arquivoCarregado =
    situacao === "resolvida" && !resolvedLoading && !resolvedError;
  const erroNoArquivo = situacao === "resolvida" && resolvedError;

  // O teto de 300 so importa quando um filtro pode estar procurando alem
  // dele: sem este aviso, a atendente conclui que a conversa sumiu.
  const filtrandoNoTeto =
    counts.ativas >= CONVERSATIONS_ATIVAS_LIMIT &&
    (etiquetasAtivas.length > 0 ||
      situacao === "sem_resposta_24h" ||
      search.trim() !== "");

  // O arquivo de resolvidas tambem tem teto (achado L3): o chip mostra o
  // TOTAL contado no servidor, e nao as 100 carregadas; a lista, a busca e
  // as etiquetas so alcancam as carregadas, e o aviso diz isso.
  const arquivoNoTeto = arquivoCarregado && resolvidasNoTeto;
  const buscandoNoArquivo =
    search.trim() !== "" || etiquetasAtivas.length > 0 || own !== "todas";
  const numeroDeResolvidas = (n: number): string =>
    resolvidasTotal !== null
      ? String(Math.max(resolvidasTotal, n))
      : resolvidasNoTeto
        ? `${RESOLVIDAS_LIMIT}+`
        : String(n);

  const marcadas = etiquetasAtivas.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 gap-[9px] border-b border-border p-3">
        <label className="flex h-10 items-center gap-2 rounded-full border border-input bg-surface-4 px-3 cz-transition focus-within:border-focus focus-within:bg-card focus-within:ring-3 focus-within:ring-ring/55">
          <Search
            aria-hidden
            className="size-[15px] shrink-0 text-text-secondary"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar conversa"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-text-strong outline-none placeholder:text-text-tertiary md:text-[13px]"
          />
        </label>

        {/* Posse. Sem "block": as opcoes dividem a largura pelo tamanho do
            rotulo (flex-auto), para "Sem atendente 12" caber numa linha nos
            336px da coluna em vez de quebrar em duas. */}
        <SegmentedControl
          size="sm"
          ariaLabel="Filtrar por responsável"
          className="flex w-full [&>button]:flex-auto [&>button]:px-2"
          value={own}
          onChange={setOwn}
          options={[
            { value: "minhas", label: "Minhas", count: counts.mine },
            {
              value: "sem_atendente",
              label: "Sem atendente",
              count: counts.unassigned,
            },
            { value: "todas", label: "Todas", count: counts.all },
          ]}
        />

        <div
          role="group"
          aria-label="Filtrar por situação"
          // No celular a fileira rola de lado; o py com -my devolvem ao
          // alvo de 40px (hit-40) o espaco que o recorte da rolagem tiraria.
          className="flex flex-wrap gap-x-1.5 gap-y-3 max-sm:-my-1.5 max-sm:[scrollbar-width:none] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:py-1.5 max-sm:[&::-webkit-scrollbar]:hidden"
        >
          {SITUACOES.map((alvo) => {
            const ativo = situacao === alvo;
            const n = counts.porSituacao[alvo];
            if (alvo === "ia_atendendo" && n === 0 && !ativo) {
              return null;
            }
            const definicao = definicaoDaSituacao(alvo);
            const tom = STATUS_TONE_VARS[definicao.tone];
            const Icone = definicao.icon;
            const carregando = alvo === "resolvida" && ativo && resolvedLoading;
            const mostraNumero = alvo !== "resolvida" || arquivoCarregado;
            return (
              <button
                key={alvo}
                type="button"
                aria-pressed={ativo}
                onClick={() => alternarSituacao(alvo)}
                className={cn(
                  "hit-40 inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
                  // Ligado: tinta cheia, diferenca de luminancia e nao de
                  // matiz. A forma do icone e o rotulo continuam iguais.
                  ativo
                    ? "border-transparent bg-inverse text-inverse-foreground"
                    : "border-border-strong bg-card hover:bg-surface-3",
                )}
                style={ativo ? undefined : { color: tom.text }}
              >
                {Icone ? (
                  <Icone aria-hidden className="size-3 shrink-0" />
                ) : (
                  // Em atendimento: a forma e o circulo de iniciais, como no
                  // chip do cartao.
                  <span
                    aria-hidden
                    className="grid size-3.5 shrink-0 place-items-center rounded-full bg-current/15 text-[7px] font-bold"
                  >
                    AT
                  </span>
                )}
                {alvo === "sem_resposta_24h" ? (
                  <span className="sr-only">Sem resposta </span>
                ) : null}
                {definicao.label}
                {carregando ? (
                  <>
                    {" "}
                    <LoaderCircle aria-hidden className="size-3 animate-spin" />
                    <span className="sr-only">carregando</span>
                  </>
                ) : mostraNumero ? (
                  <>
                    {" "}
                    <span className="cz-num">
                      {alvo === "resolvida" ? numeroDeResolvidas(n) : n}
                    </span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>

        {erroNoArquivo && filtered.length > 0 ? (
          <p className="flex items-center gap-1 text-[11.5px] text-alert-text">
            <OctagonAlert aria-hidden className="size-3 shrink-0" />
            Não foi possível carregar as resolvidas.
            <button
              type="button"
              onClick={onRetryResolved}
              className="hit-40 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              Tentar de novo
            </button>
          </p>
        ) : null}

        {etiquetas.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                aria-label={
                  // Contem o rotulo visivel ("Etiquetas"), para quem usa voz.
                  marcadas > 0
                    ? `Filtrar por etiquetas, ${marcadas} ${marcadas === 1 ? "marcada" : "marcadas"}`
                    : "Filtrar por etiquetas"
                }
              >
                <Tag aria-hidden />
                Etiquetas
                {marcadas > 0 ? (
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-inverse px-[5px] cz-num text-[10.5px] font-bold text-inverse-foreground">
                    {marcadas}
                  </span>
                ) : null}
                <ChevronDown aria-hidden className="text-text-secondary" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 gap-[5px] p-[5px]">
              <div
                role="group"
                aria-label="Etiquetas"
                className="grid cz-scroll max-h-72 gap-0.5 overflow-y-auto"
              >
                {etiquetas.map((etiqueta) => {
                  const ativa = etiquetasAtivas.includes(etiqueta.chave);
                  return (
                    <button
                      key={etiqueta.chave}
                      type="button"
                      aria-pressed={ativa}
                      onClick={() =>
                        setEtiquetasEscolhidas((atuais) =>
                          ativa
                            ? atuais.filter((chave) => chave !== etiqueta.chave)
                            : [...atuais, etiqueta.chave],
                        )
                      }
                      className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] font-medium text-foreground cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                    >
                      {/* O check e a camada de FORMA: marcado nao pode ser
                          comunicado so por cor. */}
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                          ativa
                            ? "border-primary-edge bg-primary text-primary-foreground"
                            : "border-input bg-card",
                        )}
                      >
                        {ativa ? <Check className="size-3" /> : null}
                      </span>
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-[2px]"
                        style={{
                          background: STATUS_TONE_VARS[etiqueta.tom].marker,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {etiqueta.nome}
                      </span>
                    </button>
                  );
                })}
              </div>
              {marcadas > 0 ? (
                <div className="border-t border-border pt-[5px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setEtiquetasEscolhidas([])}
                  >
                    Limpar etiquetas
                  </Button>
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : null}

        {filtrandoNoTeto ? (
          <p className="text-[11px] text-text-secondary">
            Filtrando as{" "}
            <span className="cz-num">{CONVERSATIONS_ATIVAS_LIMIT}</span>{" "}
            conversas mais recentes.
          </p>
        ) : null}

        {arquivoNoTeto ? (
          <p className="text-[11px] text-text-secondary">
            {buscandoNoArquivo ? "Buscando só nas " : "Mostrando as "}
            <span className="cz-num">{RESOLVIDAS_LIMIT}</span> resolvidas mais
            recentes.
          </p>
        ) : null}
      </div>

      <div className="cz-scroll min-h-0 flex-1 overflow-y-auto">
        {filtered.length > 0 ? (
          filtered.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              estado={estadoVisualDaConversa(conversation, {
                viewerId,
                authorNames,
              })}
              reserva={tipoEEtapa(conversation, nomesDeEtapa)}
              etiquetas={etiquetasDaConversa(conversation.tags, porChave)}
              selected={conversation.id === selectedId}
              viewerId={viewerId}
              timezone={timezone}
              agora={agora}
              onSelect={() => onSelect(conversation.id)}
            />
          ))
        ) : situacao === "resolvida" && resolvedLoading ? (
          <ListSkeleton rows={6} className="p-3.5" />
        ) : erroNoArquivo ? (
          <EmptyState
            tom="erro"
            compact
            title="Não foi possível carregar as resolvidas."
            description="As conversas continuam guardadas. Tente de novo em instantes."
          >
            <Button variant="outline" size="sm" onClick={onRetryResolved}>
              Tentar de novo
            </Button>
          </EmptyState>
        ) : hasActiveFilter ? (
          <EmptyState
            compact
            icon={Search}
            title="Nenhuma conversa com esses filtros"
            description="Ajuste os filtros ou limpe tudo."
            onClearFilters={limparFiltros}
          />
        ) : ehProfissional ? (
          <EmptyState
            compact
            icon={MessagesSquare}
            title="Nenhuma conversa com você"
            description="As conversas que a equipe passar para você aparecem aqui."
          >
            {temArquivo ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => escolherSituacao("resolvida")}
              >
                Ver resolvidas
              </Button>
            ) : null}
          </EmptyState>
        ) : semAtivas && temArquivo ? (
          <EmptyState
            compact
            icon={MessagesSquare}
            title="Nenhuma conversa em andamento"
            description="As conversas resolvidas continuam guardadas."
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => escolherSituacao("resolvida")}
            >
              Ver resolvidas
            </Button>
          </EmptyState>
        ) : (
          <EmptyState
            compact
            icon={MessagesSquare}
            title="Nenhuma conversa ainda"
            description="Quando um paciente escrever no WhatsApp da clínica, a conversa aparece aqui na hora."
          />
        )}
      </div>
    </div>
  );
}

// Reserva da previa quando a conversa ainda nao tem mensagem que o paciente
// ve (ou a ultima nao tem texto): o tipo do contato e a etapa da JORNADA da
// clinica, com a chave crua de reserva (mostrar a chave e feio, mentir seria
// pior).
function tipoEEtapa(
  conversation: ConversationListItem,
  nomesDeEtapa: Record<string, string>,
): string {
  const etapa =
    nomesDeEtapa[conversation.contact.funnel_stage] ??
    conversation.contact.funnel_stage;
  return `${conversation.contact.kind === "paciente" ? "Paciente" : "Lead"} · ${etapa}`;
}
