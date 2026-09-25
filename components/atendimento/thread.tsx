"use client";

import { ArrowLeft, History, UserRoundSearch } from "lucide-react";
import { useEffect, useRef } from "react";

import { AcoesDaConversa } from "@/components/atendimento/acoes-da-conversa";
import { BolhaEmVoo } from "@/components/atendimento/bolha-em-voo";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import {
  dataCurtaNaClinica,
  diaNaClinica,
  FUSO_PADRAO,
  rotuloDoDia,
} from "@/components/atendimento/fuso-da-clinica";
import {
  ComplianceBlockCard,
  MessageBubble,
} from "@/components/atendimento/message-bubble";
import {
  ConexaoDoNumero,
  SeloDoNumero,
} from "@/components/atendimento/selo-do-numero";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { estadoVisualDaConversa } from "@/lib/design/status";
import type { EnvioEmVoo } from "@/lib/domain/envios-em-voo";
import type { NumeroDaConversa } from "@/lib/domain/numeros-do-inbox";
import type { Role } from "@/lib/domain/permissions";
import { formatarTelefone } from "@/lib/domain/telefone";
import type {
  ComplianceDecision,
  ConversationListItem,
  MessageItem,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Fio da conversa (design system Conduzza, docs/06 secao 5.3): cabecalho de
// 64px com avatar, nome, estado e as ACOES da conversa (decisao C29: Assumir,
// Transferir, Resolver e Reabrir moram aqui, nao no compositor); mensagens
// com separador de dia no fuso da clinica; cartoes de evento e de bloqueio de
// conformidade no meio do fio. O compositor entra como slot.
//
// O fio e um container (@container/fio): a largura dele, e nao a da janela,
// decide quando os botoes do cabecalho recolhem para so o icone.

type ThreadItem =
  | { type: "message"; message: MessageItem }
  | { type: "decision"; decision: ComplianceDecision };

type LinhaDoFio =
  | { tipo: "dia"; chave: string; rotulo: string }
  | { tipo: "historico"; chave: string; data: string }
  | { tipo: "item"; chave: string; item: ThreadItem };

function quandoDo(item: ThreadItem): string {
  return item.type === "message"
    ? item.message.created_at
    : item.decision.created_at;
}

/**
 * Transforma os itens em linhas do fio, com os separadores no lugar.
 *
 * Duas divisas: a de DIA (no calendario da clinica) e a de CONVERSA. O fio
 * traz tambem as conversas anteriores do mesmo contato (achado 10), e a
 * passagem de uma para a outra ganha "Conversa resolvida em dd/MM", com a
 * data da ultima mensagem da conversa que terminou (que e o proprio evento
 * "Conversa resolvida"). Depois da divisa o dia aparece de novo, para a
 * conversa nova comecar ancorada.
 */
function montarLinhas(items: ThreadItem[], timezone: string): LinhaDoFio[] {
  const agora = new Date();
  const linhas: LinhaDoFio[] = [];
  let diaAnterior: string | null = null;
  let ultimaMensagem: MessageItem | null = null;
  for (const item of items) {
    const quando = quandoDo(item);
    if (
      item.type === "message" &&
      ultimaMensagem?.conversation_id &&
      item.message.conversation_id &&
      item.message.conversation_id !== ultimaMensagem.conversation_id
    ) {
      linhas.push({
        tipo: "historico",
        chave: `historico-${item.message.id}`,
        data: dataCurtaNaClinica(ultimaMensagem.created_at, timezone),
      });
      diaAnterior = null;
    }
    const dia = diaNaClinica(quando, timezone);
    if (dia !== diaAnterior) {
      linhas.push({
        tipo: "dia",
        chave: `dia-${dia}-${linhas.length}`,
        rotulo: rotuloDoDia(quando, timezone, agora),
      });
      diaAnterior = dia;
    }
    linhas.push({
      tipo: "item",
      chave: item.type === "message" ? item.message.id : item.decision.id,
      item,
    });
    if (item.type === "message") {
      ultimaMensagem = item.message;
    }
  }
  return linhas;
}

/** Cinco bolhas vazias, alternando o lado, no lugar do fio que carrega. */
function EsqueletoDoFio() {
  const bolhas = [
    { paciente: true, classe: "h-12 w-[46%]" },
    { paciente: false, classe: "h-10 w-[38%]" },
    { paciente: true, classe: "h-16 w-[52%]" },
    { paciente: false, classe: "h-12 w-[44%]" },
    { paciente: true, classe: "h-10 w-[30%]" },
  ];
  return (
    <div role="status" className="mx-auto flex max-w-3xl flex-col gap-3">
      <span className="sr-only">Carregando as mensagens</span>
      {bolhas.map((bolha, indice) => (
        <Skeleton
          key={indice}
          aria-hidden
          className={cn(
            "rounded-bubble",
            bolha.paciente
              ? "self-start rounded-bl-[6px]"
              : "self-end rounded-br-[6px]",
            bolha.classe,
          )}
        />
      ))}
    </div>
  );
}

function mergeItems(
  messages: MessageItem[],
  decisions: ComplianceDecision[],
): ThreadItem[] {
  const items: ThreadItem[] = [
    ...messages.map((message) => ({ type: "message" as const, message })),
    ...decisions.map((decision) => ({ type: "decision" as const, decision })),
  ];
  return items.sort((a, b) => {
    const ta =
      a.type === "message" ? a.message.created_at : a.decision.created_at;
    const tb =
      b.type === "message" ? b.message.created_at : b.decision.created_at;
    return ta.localeCompare(tb);
  });
}

export function Thread({
  conversation,
  messages,
  decisions,
  isLoading,
  erroAoCarregar = false,
  aoRecarregar,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  authorNames,
  onBack,
  onToggleContext,
  footer,
  clinicId,
  viewerId,
  viewerRole,
  podeEditar,
  ehChefia,
  onResponder,
  onApagar,
  emVoo,
  aoTentarDeNovo,
  aoDescartarEnvio,
  aoIrParaConversa,
  aoPerderConversa,
  timezone = FUSO_PADRAO,
  numero = null,
}: {
  conversation: ConversationListItem;
  messages: MessageItem[];
  decisions: ComplianceDecision[];
  isLoading: boolean;
  /** a busca das mensagens falhou: o fio diz isso em vez de ficar em branco */
  erroAoCarregar?: boolean;
  aoRecarregar?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  authorNames: Record<string, string>;
  onBack: () => void;
  onToggleContext: () => void;
  footer: React.ReactNode;
  clinicId: string;
  viewerId: string;
  viewerRole: Role;
  podeEditar: boolean;
  ehChefia: boolean;
  onResponder: (message: MessageItem) => void;
  onApagar: (message: MessageItem) => void;
  /** mensagens já mandadas que ainda não viraram linha no banco */
  emVoo: EnvioEmVoo[];
  aoTentarDeNovo: (chave: string) => void;
  aoDescartarEnvio: (chave: string) => void;
  /** leva a tela até outra conversa (a aberta do mesmo paciente, ao reabrir) */
  aoIrParaConversa: (conversationId: string) => void;
  /** a conversa saiu do alcance desta pessoa (passada para outra) */
  aoPerderConversa?: (conversationId: string) => void;
  /** fuso da clínica: horas e separadores de dia saem nele */
  timezone?: string;
  /**
   * O número da clínica desta conversa, quando a tela deve mostrar
   * (numeroParaMostrar): mais de um número ativo, ou número removido.
   */
  numero?: NumeroDaConversa | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ultimaId = messages[messages.length - 1]?.id;
  // A ASSINATURA, e não a contagem: um envio que passa de "enviando" para
  // "falhou" não muda o tamanho da lista, mas cresce na tela (ganha rótulo,
  // linha de erro e dois botões). Com a contagem, o efeito não rodava e os
  // botões de "Tentar de novo" ficavam abaixo da dobra.
  const assinaturaEmVoo = emVoo.map((e) => e.chave + e.estado).join("|");
  const totalEmVoo = emVoo.length;

  /**
   * A pessoa estava lendo o FIM, medido ANTES de o conteúdo novo entrar.
   *
   * Esta é a correção do erro central da primeira tentativa: a distância era
   * calculada dentro do efeito, ou seja, com a bolha nova já no documento. A
   * altura do que acabava de chegar entrava na conta, então qualquer mensagem
   * mais alta que o limiar (uma foto, um texto de cinco linhas, o cartão de
   * falha) desligava o acompanhamento exatamente para quem estava colado no
   * fim. A pergunta certa é "onde ela estava", e só o evento de rolagem sabe.
   */
  const coladoNoFim = useRef(true);
  const conversaAncorada = useRef<string | null>(null);
  const quantosEmVoo = useRef(emVoo.length);

  const registrarRolagem = () => {
    const el = scrollRef.current;
    if (el) {
      coladoNoFim.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    // PRIMEIRA ÂNCORA desta conversa. Roda quando o conteúdo finalmente existe,
    // e não quando o id muda: o container só é renderizado depois do esqueleto,
    // então no instante da troca de conversa a referência ainda é nula e a
    // âncora se perdia, deixando o fio parado no TOPO das 50 mensagens.
    if (conversaAncorada.current !== conversation.id) {
      conversaAncorada.current = conversation.id;
      coladoNoFim.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    // A pessoa acabou de mandar alguma coisa: querer ver o resultado é o
    // sentido do gesto, então acompanha mesmo que ela estivesse lendo atrás.
    // Conta entradas, e não o tamanho da assinatura: um envio que muda de
    // estado reescreve a assinatura sem ser um envio novo.
    const euMandei = totalEmVoo > quantosEmVoo.current;
    quantosEmVoo.current = totalEmVoo;
    if (euMandei) {
      coladoNoFim.current = true;
    }
    if (coladoNoFim.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [ultimaId, assinaturaEmVoo, totalEmVoo, conversation.id, isLoading]);

  // Rola ate a mensagem citada e a destaca por um instante. Sem o realce, a
  // pessoa chega la e nao sabe qual das bolhas era a procurada.
  const irParaCitada = (id: string) => {
    const alvo = document.getElementById(`mensagem-${id}`);
    if (!alvo) {
      return;
    }
    alvo.scrollIntoView({ behavior: "smooth", block: "center" });
    // O contorno vai na BOLHA, nao na linha inteira: a linha ocupa a largura
    // do fio e o realce virava uma faixa que nao apontava para nada.
    const bolha = alvo.querySelector<HTMLElement>("[data-bolha]") ?? alvo;
    const realce = [
      "outline-2",
      "outline-offset-4",
      "outline-solid",
      "outline-focus",
    ];
    bolha.classList.add(...realce);
    window.setTimeout(() => {
      bolha.classList.remove(...realce);
    }, 1400);
  };

  // Quais mensagens existem no documento agora. O fio pagina de 50 em 50, e
  // citar algo de semanas atrás é comum: sem este conjunto o bloco de citação
  // virava um botão que não faz nada.
  const carregadas = new Set(messages.map((m) => m.id));

  const items = mergeItems(messages, decisions);
  const linhas = montarLinhas(items, timezone);
  // O MESMO helper do cartao da lista (achado 13): aguardando_humano sem
  // awaiting_reply e "Sem atendente", e em atendimento diz quem atende.
  const estado = estadoVisualDaConversa(conversation, {
    viewerId,
    authorNames,
    nomeCompleto: true,
  });
  const podeResponderAqui =
    podeEditar &&
    conversation.status === "em_atendimento" &&
    conversation.assignee_user_id === viewerId;
  const fioVazio = !erroAoCarregar && items.length === 0 && emVoo.length === 0;

  return (
    <div className="@container/fio flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onBack}
          aria-label="Voltar para a lista"
        >
          <ArrowLeft aria-hidden className="size-[18px]" />
        </Button>
        <span className="@max-[479px]/fio:hidden">
          <ContactAvatar
            name={conversation.contact.name}
            phone={conversation.contact.phone_e164}
            size={36}
          />
        </span>
        <div className="grid min-w-0 flex-1">
          {/* Com mais de um numero (docs/07): a primeira linha e do paciente
              (o nome, e a conexao do numero quando ele esta fora); o numero
              da clinica vai na linha de baixo, como no cartao da lista. O
              nome do paciente nunca disputa espaco com o selo. */}
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-bold text-text-strong">
              {conversation.contact.name ??
                formatarTelefone(conversation.contact.phone_e164)}
            </span>
            {numero ? (
              // Abaixo de 760px de fio (1366, e 1600 com o painel aberto) o
              // chip tiraria o espaco do nome: a conexao fica na faixa do
              // topo e no aviso do compositor.
              <ConexaoDoNumero
                numero={numero}
                className="@max-[759px]/fio:hidden"
              />
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11.5px] text-text-secondary">
            <span
              // Com selo, no fio de celular o telefone do paciente sai (fica
              // no painel do contato) para o nome do numero caber.
              className={cn(
                "shrink-0 cz-num",
                numero ? "@max-[479px]/fio:hidden" : undefined,
              )}
            >
              {formatarTelefone(conversation.contact.phone_e164)}
            </span>
            <span
              // Fio apertado e com selo: o nome do numero vale mais que
              // "Lead/Paciente", que continua no painel do contato.
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                numero ? "shrink-0 @max-[659px]/fio:hidden" : undefined,
              )}
            >
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">
                {conversation.contact.kind === "paciente" ? "Paciente" : "Lead"}
              </span>
            </span>
            {numero ? (
              <SeloDoNumero numero={numero} comTelefone className="min-w-0" />
            ) : null}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusChip
            className="@max-[599px]/fio:hidden"
            definition={estado.definition}
            label={estado.label}
            avatarInitials={estado.avatarInitials}
          />
          <AcoesDaConversa
            // Estado das acoes (menu aberto, acao em curso) e por conversa.
            key={conversation.id}
            conversation={conversation}
            clinicId={clinicId}
            viewerId={viewerId}
            viewerRole={viewerRole}
            authorNames={authorNames}
            aoIrParaConversa={aoIrParaConversa}
            aoPerderConversa={aoPerderConversa}
          />
          <Button
            variant="outline"
            size="icon"
            className="@min-[1100px]/inbox:hidden"
            onClick={onToggleContext}
            aria-label="Ver dados do contato"
          >
            <UserRoundSearch aria-hidden />
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={registrarRolagem}
        className="cz-scroll min-h-0 flex-1 overflow-y-auto bg-background p-4"
      >
        {isLoading ? (
          <EsqueletoDoFio />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {erroAoCarregar ? (
              <Aviso
                tom="alert"
                role="alert"
                titulo="Não foi possível carregar as mensagens."
                acao={
                  aoRecarregar ? (
                    <Button variant="outline" size="sm" onClick={aoRecarregar}>
                      Tentar de novo
                    </Button>
                  ) : null
                }
              >
                A conversa continua salva. Tente de novo em instantes.
              </Aviso>
            ) : null}
            {hasOlder ? (
              <div className="flex justify-center pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLoadOlder}
                  disabled={loadingOlder}
                  className="text-text-secondary"
                >
                  {loadingOlder
                    ? "Carregando..."
                    : "Carregar mensagens anteriores"}
                </Button>
              </div>
            ) : null}
            {fioVazio ? (
              <p className="py-8 text-center text-[12.5px] text-text-secondary">
                Nenhuma mensagem nesta conversa ainda.
              </p>
            ) : null}
            {linhas.map((linha) => {
              if (linha.tipo === "dia") {
                return (
                  <p
                    key={linha.chave}
                    className="self-center rounded-full border border-border bg-card px-2.5 py-[3px] text-[11px] font-medium text-text-secondary"
                  >
                    {linha.rotulo}
                  </p>
                );
              }
              if (linha.tipo === "historico") {
                return (
                  <div
                    key={linha.chave}
                    role="separator"
                    aria-label={`Conversa resolvida em ${linha.data}`}
                    className="flex items-center gap-3 py-2 text-[11px] font-semibold text-text-secondary"
                  >
                    <span
                      aria-hidden
                      className="h-px flex-1 bg-border-strong"
                    />
                    <span className="inline-flex items-center gap-1.5">
                      <History aria-hidden className="size-3.5" />
                      Conversa resolvida em{" "}
                      <span className="cz-num">{linha.data}</span>
                    </span>
                    <span
                      aria-hidden
                      className="h-px flex-1 bg-border-strong"
                    />
                  </div>
                );
              }
              const { item } = linha;
              if (item.type === "decision") {
                return (
                  <ComplianceBlockCard
                    key={linha.chave}
                    decision={item.decision}
                  />
                );
              }
              const deConversaAnterior =
                item.message.conversation_id !== undefined &&
                item.message.conversation_id !== conversation.id;
              return (
                <MessageBubble
                  key={linha.chave}
                  message={item.message}
                  authorName={
                    item.message.author === "ia"
                      ? "Assistente"
                      : item.message.author_user_id
                        ? (authorNames[item.message.author_user_id] ?? null)
                        : null
                  }
                  authorNames={authorNames}
                  contato={
                    conversation.contact.name ??
                    formatarTelefone(conversation.contact.phone_e164)
                  }
                  viewerId={viewerId}
                  podeEditar={podeEditar}
                  podeResponder={podeResponderAqui && !deConversaAnterior}
                  deConversaAnterior={deConversaAnterior}
                  ehChefia={ehChefia}
                  onResponder={onResponder}
                  onApagar={onApagar}
                  onIrParaCitada={irParaCitada}
                  citadaEstaNaTela={
                    item.message.reply_to !== null &&
                    carregadas.has(item.message.reply_to.id)
                  }
                  timezone={timezone}
                />
              );
            })}
            {emVoo.map((envio) => (
              <BolhaEmVoo
                key={envio.chave}
                envio={envio}
                aoTentarDeNovo={() => aoTentarDeNovo(envio.chave)}
                aoDescartar={() => aoDescartarEnvio(envio.chave)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card">{footer}</div>
    </div>
  );
}
