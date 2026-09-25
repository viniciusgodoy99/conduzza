"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { MessagesSquare, Plug } from "lucide-react";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Composer, type Mode } from "@/components/atendimento/composer";
import { ContextPanel } from "@/components/atendimento/context-panel";
import { ConversationList } from "@/components/atendimento/conversation-list";
import { DialogoApagar } from "@/components/atendimento/dialogo-apagar";
import { Thread } from "@/components/atendimento/thread";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  filtroDeSituacaoDaUrl,
  type FiltroDaUrl,
  type FiltroDeSituacao,
} from "@/lib/domain/filtros-da-conversa";
import {
  contarConversasResolvidas,
  conversationKeys,
  fetchComplianceDecisions,
  fetchConsent,
  fetchConversationById,
  fetchConversations,
  fetchMessagesPage,
  fetchResolvedConversations,
  RESOLVIDAS_LIMIT,
  type ConversationListItem,
  type MessageItem,
} from "@/lib/queries/conversations";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import {
  etiquetasKeys,
  fetchEtiquetasDeConversa,
} from "@/lib/queries/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import { canEdit, permissionHint, type Role } from "@/lib/domain/permissions";
import {
  conciliarEnvios,
  enviosDaConversa,
  type EnvioEmVoo,
} from "@/lib/domain/envios-em-voo";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { useInboxChannel } from "@/lib/realtime/use-inbox-channel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import {
  addInternalNoteAction,
  apagarMensagemAction,
  markConversationReadAction,
  sendMessageAction,
} from "./actions";

// Tela 1, Atendimento (design system Conduzza, docs/06 secao 5.3): lista
// 336px, fio flexivel, contexto 320px. O painel de contexto segue a largura
// UTIL da tela (container query @container/inbox, D13), e nao a da janela:
// com o menu aberto em 248px ou recolhido em 64px, sobra espaco diferente.
// Abaixo de 1100px uteis o contexto abre numa folha. Abaixo de 1024px de
// janela a tela alterna entre lista e fio. Leituras do cliente passam pela
// RLS.

export function InboxClient({
  clinicId,
  viewerId,
  viewerRole,
  timezone,
  agoraInicial,
  nomesDeEtapa,
  jornada,
  etiquetas,
  authorNames,
  initialConversations,
  hasWhatsappAccount,
  temResolvidas,
  conversaDoLink,
  linkIndisponivel,
  filtroInicial,
}: {
  clinicId: string;
  viewerId: string;
  viewerRole: Role;
  /** Fuso da clinica: toda hora da tela sai nele (regra 3.6). */
  timezone: string;
  /** Relogio do servidor na carga: o primeiro desenho bate com o do HTML. */
  agoraInicial: number;
  nomesDeEtapa: Record<string, string>;
  /** A jornada inteira (com papel e tom): o painel troca etapa por ela. */
  jornada: EtapaDaJornada[];
  /** Catalogo de etiquetas de conversa da clinica. */
  etiquetas: EtiquetaDeConversa[];
  authorNames: Record<string, string>;
  initialConversations: ConversationListItem[];
  hasWhatsappAccount: boolean;
  /** Ha conversa resolvida (so consultado quando nao ha nenhuma ativa). */
  temResolvidas: boolean;
  /** A conversa de /atendimento?conversa=<id>, ja conferida pela RLS. */
  conversaDoLink: ConversationListItem | null;
  /** O link pedia uma conversa que nao existe para esta pessoa. */
  linkIndisponivel: boolean;
  /** /atendimento?filtro=: chip de situacao marcado na chegada. */
  filtroInicial: FiltroDaUrl | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  // LINK DIRETO (achados 9, 70 e 100 da revisao): Confirmacoes, a ficha do
  // paciente e o drawer do lead mandam para /atendimento?conversa=<id>. A
  // conversa abre selecionada; se ela estiver resolvida, a lista chega com o
  // filtro de resolvidas ligado. Os valores iniciais valem so na montagem:
  // um router.refresh() nao desfaz o que a pessoa escolheu depois.
  const [selectedId, setSelectedId] = useState<string | null>(
    conversaDoLink?.id ?? null,
  );
  const [contextOpen, setContextOpen] = useState(false);
  const [ladoDoContexto, setLadoDoContexto] = useState<"right" | "bottom">(
    "right",
  );
  const [showResolved, setShowResolved] = useState(
    conversaDoLink?.status === "resolvida",
  );
  const [filtroDaLista] = useState<FiltroDeSituacao | null>(() =>
    conversaDoLink?.status === "resolvida"
      ? "resolvida"
      : filtroInicial
        ? filtroDeSituacaoDaUrl(filtroInicial)
        : null,
  );
  // A conversa do link que NAO veio nas 300 ativas (resolvida, ou antiga
  // demais): vive numa consulta propria, sob a mesma chave-mae da lista, para
  // as invalidacoes do tempo real e das acoes alcancarem ela tambem.
  const [conversaAvulsaId, setConversaAvulsaId] = useState<string | null>(() =>
    conversaDoLink &&
    !initialConversations.some((c) => c.id === conversaDoLink.id)
      ? conversaDoLink.id
      : null,
  );
  const [avisoDoLink, setAvisoDoLink] = useState(linkIndisponivel);
  // Mensagem que está sendo respondida, e mensagem que está sendo apagada.
  // Moram AQUI, e não no compositor ou na bolha, porque a ação nasce numa
  // bolha e é consumida pelo compositor: são dois filhos irmãos.
  const [citando, setCitando] = useState<MessageItem | null>(null);
  // Para quem o texto do compositor vai. Mora AQUI, junto da citação, porque
  // os dois precisam concordar sempre: escolher uma citação escolhe o plano,
  // no mesmo gesto. Ver a explicação longa na prop `modo` do Composer.
  const [modo, setModo] = useState<Mode>("responder");
  // O TEXTO mora aqui, e não no compositor.
  //
  // Terceira correção da mesma família nesta tela, e desta vez estrutural: o
  // destino de um texto é decidido por TRÊS coisas (a conversa, o plano e a
  // citação) e elas precisam mudar sempre juntas. Enquanto o texto ficava no
  // filho, um gesto que mexia só no plano deixava o rascunho para trás: clicar
  // em "Responder" na bolha do paciente enquanto se escrevia uma nota interna
  // virava o plano para "responder" COM O TEXTO INTACTO, e o Enter seguinte
  // mandava a nota pelo WhatsApp do paciente.
  const [texto, setTexto] = useState("");
  // Mensagens já mandadas que ainda não viraram linha no banco.
  //
  // Moram aqui, e não no cache do TanStack, porque o cache do fio é a verdade
  // do servidor e é substituído inteiro a cada refetch: uma bolha otimista lá
  // dentro seria apagada por qualquer invalidação, ou sobreviveria ao lado da
  // linha real. Ver lib/domain/envios-em-voo.ts.
  const [emVoo, setEmVoo] = useState<EnvioEmVoo[]>([]);
  const [apagando, setApagando] = useState<MessageItem | null>(null);
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null);
  const [apagandoPendente, startApagar] = useTransition();

  const podeEditar = canEdit(viewerRole, "atendimento");
  // Mudar etapa e assunto de LEADS, nao de atendimento: matriz propria
  // (profissional e leitura veem o seletor desabilitado com dica).
  const podeEditarLeads = canEdit(viewerRole, "leads_pacientes");
  const dicaLeads =
    permissionHint(viewerRole, "leads_pacientes") ??
    "Seu perfil não altera a etapa do contato";
  const aoMudarEtapa = () =>
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  const podeAgendar = canEdit(viewerRole, "agenda");

  // Catalogo de etiquetas: vem do servidor e se mantem por refetch ao voltar
  // para a aba (o gestor pode ter criado uma etiqueta nova na outra tela).
  useDadosDoServidor(etiquetasKeys.daClinica(clinicId), etiquetas);
  const etiquetasQuery = useQuery({
    queryKey: etiquetasKeys.daClinica(clinicId),
    queryFn: () => fetchEtiquetasDeConversa(supabase, clinicId),
    initialData: etiquetas,
    staleTime: 60_000,
  });
  const catalogoDeEtiquetas = etiquetasQuery.data ?? etiquetas;
  const dicaEtiquetar =
    permissionHint(viewerRole, "atendimento") ??
    "Seu perfil não altera esta conversa";

  /** O painel duplica as props em dois pontos de montagem (aside e Sheet):
   *  monta uma vez e espalha nos dois, para nunca divergirem. */
  const propsDoPainel = (conversa: ConversationListItem) => ({
    contact: conversa.contact,
    consent: consentQuery.data ?? null,
    // Carregando e erro NAO sao "sem autorizacao" (achado 18): o painel
    // mostra esqueleto ou o erro com Tentar de novo.
    estadoDaAutorizacao: consentQuery.isPending
      ? ("carregando" as const)
      : consentQuery.isError
        ? ("erro" as const)
        : ("pronto" as const),
    aoTentarAutorizacaoDeNovo: () => void consentQuery.refetch(),
    timezone,
    jornada,
    podeEditarLeads,
    dicaLeads,
    podeAgendar,
    dicaAgenda,
    // Lista de espera: profissional e leitura so veem (achado 17).
    podeListaDeEspera: canEdit(viewerRole, "confirmacoes_espera"),
    dicaListaDeEspera: "Seu perfil só consulta a lista de espera",
    aoMudarEtapa,
    conversationId: conversa.id,
    etiquetasDaConversa: conversa.tags,
    catalogoDeEtiquetas,
    // Quem atende etiqueta; 'profissional' so a conversa atribuida a ele,
    // que e exatamente o recorte da policy de UPDATE de conversation.
    podeEtiquetar:
      canEdit(viewerRole, "atendimento") &&
      (viewerRole !== "profissional" || conversa.assignee_user_id === viewerId),
    dicaEtiquetar:
      viewerRole === "profissional" && conversa.assignee_user_id !== viewerId
        ? "Só quem está atendendo esta conversa pode etiquetar."
        : dicaEtiquetar,
    ehChefia,
    aoEtiquetar: (tags: string[]) => {
      // Grava em TODAS as listas sob a chave-mae: a ativa, o arquivo de
      // resolvidas e a conversa aberta por link.
      queryClient.setQueriesData<ConversationListItem[]>(
        { queryKey: conversationKeys.list(clinicId) },
        (atual) =>
          atual?.map((item) =>
            item.id === conversa.id ? { ...item, tags } : item,
          ),
      );
    },
  });
  const dicaAgenda =
    permissionHint(viewerRole, "agenda") ?? "Seu perfil só consulta a agenda";
  const ehChefia = viewerRole === "admin" || viewerRole === "gestor";

  useInboxChannel(supabase, clinicId);

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(conversationKeys.list(clinicId), initialConversations);

  // O PROFISSIONAL e o unico papel que perde a visao de uma conversa pelo que
  // OUTRA pessoa faz: a RLS so mostra a ele as atribuidas a ele, e quando a
  // recepcao passa a conversa para outra pessoa o tempo real nao entrega o
  // evento (a linha nova ja nao passa pela RLS dele). Sem sinal do canal, a
  // lista dele se confere sozinha: ao voltar para a aba e de 30 em 30
  // segundos com a aba a vista (achado L4). A lista do profissional e curta
  // (so as dele), entao o custo fica nele.
  const ehProfissional = viewerRole === "profissional";

  const conversationsQuery = useQuery({
    queryKey: conversationKeys.list(clinicId),
    queryFn: () => fetchConversations(supabase, clinicId),
    initialData: initialConversations,
    // O canal Realtime mantem a lista viva; o refetch por foco so duplicava
    // a carga a cada volta do WhatsApp Web. Exceto para o profissional, acima.
    refetchOnWindowFocus: ehProfissional,
    refetchInterval: ehProfissional ? 30_000 : false,
  });
  const activeConversations = useMemo(
    () => conversationsQuery.data ?? [],
    [conversationsQuery.data],
  );

  // Resolvidas sao arquivo: so buscadas quando o usuario abre o filtro, e nao
  // entram na lista mantida pelo tempo real.
  const resolvedQuery = useQuery({
    queryKey: [...conversationKeys.list(clinicId), "resolved"] as const,
    queryFn: () => fetchResolvedConversations(supabase, clinicId),
    enabled: showResolved,
  });
  // O total de resolvidas, contado no servidor (achado L3): o chip nao
  // mostra o teto carregado como se fosse o total. Pela sessao: a RLS recorta.
  const totalResolvidasQuery = useQuery({
    queryKey: conversationKeys.totalResolvidas(clinicId),
    queryFn: () => contarConversasResolvidas(supabase, clinicId),
    enabled: showResolved,
  });

  // A conversa do link fora das ativas (ver conversaAvulsaId). Lista de 0 ou
  // 1 item, na mesma forma das outras, para as gravacoes por chave-mae
  // (etiqueta, lida) valerem para ela sem caso especial.
  const avulsaQuery = useQuery({
    queryKey: [
      ...conversationKeys.list(clinicId),
      "conversa",
      conversaAvulsaId ?? "nenhuma",
    ] as const,
    queryFn: async () => {
      const conversa = await fetchConversationById(
        supabase,
        clinicId,
        conversaAvulsaId!,
      );
      return conversa ? [conversa] : [];
    },
    // O servidor ja trouxe a do link; outra (irParaConversa) busca agora.
    initialData:
      conversaDoLink && conversaAvulsaId === conversaDoLink.id
        ? [conversaDoLink]
        : undefined,
    enabled: conversaAvulsaId !== null,
    refetchOnWindowFocus: ehProfissional,
  });

  const conversations = useMemo(() => {
    // Uma conversa aparece UMA vez, com a versao mais viva primeiro: a lista
    // ativa (mantida pelo tempo real), depois o arquivo, depois a do link.
    const vistas = new Set<string>();
    const resultado: ConversationListItem[] = [];
    const incluir = (lista: ConversationListItem[] | undefined) => {
      for (const conversa of lista ?? []) {
        if (vistas.has(conversa.id)) {
          continue;
        }
        // Resolvida so aparece com o filtro de resolvidas aberto, menos a
        // que a pessoa acabou de abrir por link ou pelo historico do fio.
        if (
          conversa.status === "resolvida" &&
          !showResolved &&
          conversa.id !== selectedId
        ) {
          continue;
        }
        vistas.add(conversa.id);
        resultado.push(conversa);
      }
    };
    incluir(activeConversations);
    if (showResolved) {
      incluir(resolvedQuery.data);
    }
    incluir(avulsaQuery.data);
    return resultado;
  }, [
    activeConversations,
    resolvedQuery.data,
    avulsaQuery.data,
    showResolved,
    selectedId,
  ]);

  // "Ja houve conversa nesta sessao": sem ativas, oferecer o arquivo mesmo
  // que a consulta do servidor tenha dito que nao havia resolvida.
  const [jaHouveConversa, setJaHouveConversa] = useState(
    initialConversations.length > 0,
  );
  if (!jaHouveConversa && activeConversations.length > 0) {
    setJaHouveConversa(true);
  }
  const temArquivo = temResolvidas || jaHouveConversa;

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;

  const messagesQuery = useInfiniteQuery({
    queryKey: conversationKeys.messages(selected?.id ?? "none"),
    // Com o contato: o fio traz tambem as conversas RESOLVIDAS dele, com a
    // divisa "Conversa resolvida em" (achado 10). A RLS recorta o resto.
    queryFn: ({ pageParam }) =>
      fetchMessagesPage(
        supabase,
        selected!.id,
        pageParam,
        selected!.contact.id,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: selected !== null,
    // Mensagem nova chega pelo canal (que invalida o fio); o refetch por foco
    // refazia todas as paginas carregadas sem necessidade.
    refetchOnWindowFocus: false,
  });

  // Paginas vem do mais novo para o mais antigo; para exibir em ordem
  // cronologica, inverte a ordem das paginas e achata, deduplicando por id
  // (a borda entre paginas pode repetir uma mensagem em caso raro de empate
  // de timestamp).
  const messages = useMemo<MessageItem[]>(() => {
    const paginas = messagesQuery.data?.pages ?? [];
    const vistos = new Set<string>();
    const resultado: MessageItem[] = [];
    for (const pagina of [...paginas].reverse()) {
      for (const mensagem of pagina.items) {
        if (!vistos.has(mensagem.id)) {
          vistos.add(mensagem.id);
          resultado.push(mensagem);
        }
      }
    }
    return resultado;
  }, [messagesQuery.data]);
  const decisionsQuery = useQuery({
    queryKey: conversationKeys.decisions(selected?.id ?? "none"),
    queryFn: () => fetchComplianceDecisions(supabase, selected!.id),
    enabled: selected !== null,
  });
  const consentQuery = useQuery({
    queryKey: conversationKeys.consent(selected?.contact.id ?? "none"),
    queryFn: () => fetchConsent(supabase, selected!.contact.id),
    enabled: selected !== null,
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    // Pela MESMA razão que o compositor é recriado com key: a citação carrega
    // um trecho da mensagem de um paciente, e ela não pode aparecer na tela de
    // outro. A Server Action recusaria o envio, mas a prévia já teria sido
    // mostrada na conversa errada.
    setCitando(null);
    setModo("responder");
    setTexto("");
    marcarComoLida(id);
  };

  // Leva a tela ate uma conversa que pode NAO estar na lista carregada (a
  // conversa aberta do mesmo paciente ao reabrir, a anterior no historico,
  // uma fora das 300 ativas): ela entra como a conversa avulsa, buscada pela
  // sessao, e fica selecionada. Para o Thread e as acoes do cabecalho
  // (aoIrParaConversa).
  const irParaConversa = (id: string) => {
    if (!conversations.some((conversa) => conversa.id === id)) {
      setConversaAvulsaId(id);
    }
    handleSelect(id);
  };

  // Zera a nao lida em TODAS as listas sob a chave-mae (ativa, resolvidas e a
  // conversa do link) e grava no banco.
  const marcarComoLida = (id: string) => {
    queryClient.setQueriesData<ConversationListItem[]>(
      { queryKey: conversationKeys.list(clinicId) },
      (current) =>
        current?.map((conversation) =>
          conversation.id === id
            ? { ...conversation, unread_count: 0 }
            : conversation,
        ),
    );
    void markConversationReadAction(id);
  };

  // Chegada por link: a conversa ja abre selecionada, e abrir e ler (como o
  // clique na lista). Depois, a URL volta a ser so /atendimento, para um
  // recarregar nao reaplicar o link nem o filtro por cima do que a pessoa
  // escolheu.
  const linkAplicado = useRef(false);
  useEffect(() => {
    if (linkAplicado.current) {
      return;
    }
    linkAplicado.current = true;
    if (conversaDoLink) {
      marcarComoLida(conversaDoLink.id);
    }
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // So na montagem: o link e aplicado uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A conversa deixou de existir PARA ESTA PESSOA (achado L4): o servidor
   * respondeu conversaIndisponivel, ou a lista conferida ja nao a traz e a
   * busca pelo id volta vazia. Sai de todas as listas na hora, o fio fecha e
   * a pessoa fica sabendo por que, em vez de responder numa conversa que
   * ja e de outra pessoa. O rascunho e os envios pendurados nela vao junto:
   * nao ha mais para onde manda-los.
   */
  // A selecao VIGENTE, para quem volta depois (o envio que falha com a
  // atendente ja em outra conversa nao pode fechar a outra).
  const selecaoAtual = useRef(selectedId);
  useEffect(() => {
    selecaoAtual.current = selectedId;
  }, [selectedId]);

  const perderConversa = useCallback(
    (id: string, { comEnvio = false }: { comEnvio?: boolean } = {}) => {
      setEmVoo((atual) => atual.filter((e) => e.conversationId !== id));
      queryClient.setQueriesData<ConversationListItem[]>(
        { queryKey: conversationKeys.list(clinicId) },
        (atual) => atual?.filter((conversa) => conversa.id !== id),
      );
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.list(clinicId),
      });
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.totalResolvidas(clinicId),
      });
      setConversaAvulsaId((atual) => (atual === id ? null : atual));
      if (selecaoAtual.current === id) {
        selecaoAtual.current = null;
        setSelectedId(null);
        setCitando(null);
        setModo("responder");
        setTexto("");
      }
      // Um aviso so por conversa, mesmo com varios envios voltando juntos.
      toast.warning("Esta conversa não está mais disponível para você.", {
        id: `conversa-indisponivel-${id}`,
        description: comEnvio
          ? "Ela pode ter sido passada para outra pessoa. A mensagem não foi enviada."
          : "Ela pode ter sido passada para outra pessoa.",
      });
    },
    [queryClient, clinicId],
  );

  // A conversa aberta SUMIU da lista conferida (profissional, refetch de 30
  // segundos ou ao voltar para a aba): confere pelo id, com a sessao. Vazio e
  // "nao e mais sua"; se ela ainda existe (resolvida, por exemplo), nada muda.
  const vistaNaTela = useRef<string | null>(null);
  useEffect(() => {
    if (selected) {
      vistaNaTela.current = selected.id;
      return;
    }
    if (!ehProfissional || !selectedId || vistaNaTela.current !== selectedId) {
      return;
    }
    vistaNaTela.current = null;
    const id = selectedId;
    let cancelado = false;
    fetchConversationById(supabase, clinicId, id)
      .then((conversa) => {
        if (!cancelado && !conversa) {
          perderConversa(id);
        }
      })
      // Falha de rede: nada a afirmar; a proxima conferencia tenta de novo.
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [
    selected,
    selectedId,
    ehProfissional,
    supabase,
    clinicId,
    perderConversa,
  ]);

  // Abaixo de 1100px uteis o contexto abre numa folha: de baixo no celular,
  // da direita no resto.
  const abrirContexto = () => {
    setLadoDoContexto(
      window.matchMedia("(max-width: 767px)").matches ? "bottom" : "right",
    );
    setContextOpen(true);
  };

  // A citação guardada é um RETRATO do momento do clique. Se a mensagem citada
  // for apagada por outra pessoa (ou pelo paciente) enquanto ela está pendurada
  // no compositor, o retrato continuaria exibindo o texto que acabou de sair da
  // conversa. Reconciliar com a página carregada faz a prévia virar "Mensagem
  // apagada" junto com a bolha, e o envio é recusado pelo servidor com motivo.
  const citandoVivo = citando
    ? (messages.find((m) => m.id === citando.id) ?? citando)
    : null;

  // Some da lista assim que a linha real aparece no fio. A conciliação é por
  // conteúdo, um para um, e vive num módulo puro justamente para ser testável.
  const emVooPendentes = conciliarEnvios(
    messages,
    emVoo,
    viewerId,
    selected?.id ?? null,
  );
  const emVooDaConversa = selected
    ? enviosDaConversa(emVooPendentes, selected.id)
    : [];

  /**
   * Manda o texto sem segurar a interface.
   *
   * Segue o padrão que já existe em components/leads/kanban-board.tsx: dispara
   * e esquece, com o erro virando estado visível em vez de travar a tela.
   *
   * TUDO que a mensagem precisa é capturado AGORA, no gesto: a conversa e o
   * plano (nota ou resposta). Reler `selected` ou `modo` quando a ação voltar
   * é exatamente como nasceram os dois defeitos graves anteriores deste módulo.
   */
  const enviarTexto = ({
    corpo,
    ehNota,
    citandoId,
  }: {
    corpo: string;
    ehNota: boolean;
    citandoId: string | null;
  }) => {
    if (!selected) {
      return;
    }
    const envio: EnvioEmVoo = {
      chave: crypto.randomUUID(),
      conversationId: selected.id,
      corpo,
      ehNota,
      citandoId,
      idsAntes: new Set(messages.map((m) => m.id)),
      // Piso de tempo, do relógio do BANCO. Nulo enquanto o fio não carregou:
      // sem ele não há como distinguir a linha nova de uma antiga idêntica, e
      // a conciliação por conteúdo é recusada até a ação responder com o id.
      apartirDe: messagesQuery.isPending
        ? null
        : (messages[messages.length - 1]?.created_at ?? ""),
      estado: "enviando",
    };
    setEmVoo((atual) => [...atual, envio]);
    despachar(envio);
  };

  // Quem é o paciente daquele envio, para o aviso fora da conversa fazer
  // sentido. Só nome ou telefone, nunca o conteúdo da mensagem.
  const nomeDoContato = (envio: EnvioEmVoo): string => {
    const conversa = conversations.find((c) => c.id === envio.conversationId);
    return (
      conversa?.contact.name ?? conversa?.contact.phone_e164 ?? "o contato"
    );
  };

  const despachar = (envio: EnvioEmVoo) => {
    const acao = envio.ehNota
      ? addInternalNoteAction(
          envio.conversationId,
          envio.corpo,
          envio.citandoId,
        )
      : sendMessageAction(envio.conversationId, envio.corpo, envio.citandoId);
    void acao
      .then(async (resultado) => {
        if (!resultado.ok && resultado.conversaIndisponivel) {
          perderConversa(envio.conversationId, { comEnvio: true });
          return;
        }
        if (!resultado.ok) {
          setEmVoo((atual) =>
            atual.map((e) =>
              e.chave === envio.chave
                ? { ...e, estado: "falhou" as const, erro: resultado.error }
                : e,
            ),
          );
          // O aviso PRECISA sair da conversa: o commit inteiro existe para a
          // pessoa disparar e seguir para o próximo atendimento, então o caso
          // comum é a falha acontecer com ela olhando outra tela. O cartão
          // espera na conversa certa; o toast diz que ele existe.
          toast.error(`Não foi enviada para ${nomeDoContato(envio)}.`, {
            description: resultado.error,
          });
          return;
        }
        // Só tira da lista DEPOIS de a linha real estar na tela. Sem o await,
        // a bolha some antes de a mensagem aparecer e a conversa pisca vazia.
        // Guarda o id real ANTES de esperar: a partir daqui a conciliação é
        // exata, e não mais por conteúdo.
        if (resultado.messageId) {
          setEmVoo((atual) =>
            atual.map((e) =>
              e.chave === envio.chave
                ? { ...e, messageId: resultado.messageId }
                : e,
            ),
          );
        }
        await queryClient.invalidateQueries({
          queryKey: conversationKeys.messages(envio.conversationId),
        });
        setEmVoo((atual) => atual.filter((e) => e.chave !== envio.chave));
      })
      .catch(() => {
        setEmVoo((atual) =>
          atual.map((e) =>
            e.chave === envio.chave
              ? {
                  ...e,
                  estado: "falhou" as const,
                  erro: "Não foi possível falar com o servidor.",
                }
              : e,
          ),
        );
      });
  };

  const tentarDeNovo = (chave: string) => {
    const envio = emVoo.find((e) => e.chave === chave);
    if (!envio) {
      return;
    }
    setEmVoo((atual) =>
      atual.map((e) =>
        e.chave === chave
          ? { ...e, estado: "enviando" as const, erro: undefined }
          : e,
      ),
    );
    // Reenvia com a conversa e o plano GUARDADOS no envio, nunca com os da
    // tela: a atendente pode ter mudado de conversa ou de aba desde então.
    despachar({ ...envio, estado: "enviando" });
  };

  const descartarEnvio = (chave: string) => {
    setEmVoo((atual) => atual.filter((e) => e.chave !== chave));
  };

  const confirmarApagar = (escopo: "todos" | "local") => {
    const alvo = apagando;
    if (!alvo) {
      return;
    }
    setErroAoApagar(null);
    startApagar(async () => {
      const resultado = await apagarMensagemAction(alvo.id, escopo);
      if (!resultado.ok) {
        setErroAoApagar(resultado.error ?? "Não foi possível apagar.");
        return;
      }
      setApagando(null);
      // Citar uma mensagem recém-apagada seria enviar uma resposta a algo que
      // já não existe: a Server Action recusa, e a prévia ficaria mentindo.
      setCitando((atual) => (atual?.id === alvo.id ? null : atual));
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.messages(alvo.id),
      });
      if (selected) {
        void queryClient.invalidateQueries({
          queryKey: conversationKeys.messages(selected.id),
        });
      }
    });
  };

  // Sem WhatsApp e sem nada para mostrar, o passo e conectar. Com WhatsApp, a
  // lista aparece SEMPRE, com os filtros, mesmo sem conversa ativa (achado 10
  // da revisao): antes o vazio tomava a tela inteira e o arquivo de
  // resolvidas ficava inalcancavel pelo Atendimento.
  if (
    !hasWhatsappAccount &&
    activeConversations.length === 0 &&
    !temArquivo &&
    conversations.length === 0
  ) {
    return (
      <div className="grid h-full place-items-center p-4 md:p-6">
        <div className="w-full max-w-md rounded-card border border-border bg-card shadow-sm">
          <EmptyState
            icon={Plug}
            title="Conecte o WhatsApp da clínica"
            description="O Atendimento começa quando o número da clínica estiver conectado."
            action={{
              label: "Conectar WhatsApp",
              href: "/configuracoes?aba=whatsapp",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="@container/inbox flex h-full min-h-0"
      // Soltar um arquivo em QUALQUER outro ponto da tela faz o navegador
      // abrir o arquivo e trocar de pagina, tirando a atendente do sistema no
      // meio do atendimento. O compositor trata o que cai nele; aqui a gente
      // so impede o comportamento padrao no resto.
      onDragOver={(evento) => evento.preventDefault()}
      onDrop={(evento) => evento.preventDefault()}
    >
      <aside
        aria-label="Conversas"
        className={cn(
          "w-full min-w-0 shrink-0 flex-col border-r border-border bg-card lg:w-inbox-list",
          selected ? "hidden lg:flex" : "flex",
        )}
      >
        {avisoDoLink ? (
          <div className="shrink-0 border-b border-border p-3">
            <Aviso
              tom="warning"
              titulo="Não foi possível abrir a conversa do link."
              aoDispensar={() => setAvisoDoLink(false)}
            >
              Ela não existe mais ou não está disponível para o seu perfil.
            </Aviso>
          </div>
        ) : null}
        <ConversationList
          nomesDeEtapa={nomesDeEtapa}
          etiquetas={catalogoDeEtiquetas}
          conversations={conversations}
          viewerId={viewerId}
          authorNames={authorNames}
          timezone={timezone}
          agoraInicial={agoraInicial}
          selectedId={selectedId}
          onSelect={handleSelect}
          filtroInicial={filtroDaLista}
          onResolvedRequested={setShowResolved}
          resolvedLoading={resolvedQuery.isFetching}
          resolvedError={showResolved && resolvedQuery.isError}
          onRetryResolved={() => void resolvedQuery.refetch()}
          resolvidasTotal={totalResolvidasQuery.data ?? null}
          resolvidasNoTeto={
            (resolvedQuery.data?.length ?? 0) >= RESOLVIDAS_LIMIT
          }
          semAtivas={activeConversations.length === 0}
          temArquivo={temArquivo}
          ehProfissional={viewerRole === "profissional"}
        />
      </aside>

      <section
        // Regiao nomeada: o fio (e so ele) e achavel por papel e nome, sem
        // confundir com a previa da mesma mensagem no cartao da lista.
        aria-label="Conversa aberta"
        className={cn(
          "min-w-0 flex-1 bg-background",
          selected ? "block" : "hidden lg:block",
        )}
      >
        {selected ? (
          <Thread
            conversation={selected}
            messages={messages}
            decisions={decisionsQuery.data ?? []}
            isLoading={messagesQuery.isPending}
            erroAoCarregar={messagesQuery.isError}
            aoRecarregar={() => void messagesQuery.refetch()}
            clinicId={clinicId}
            viewerRole={viewerRole}
            timezone={timezone}
            aoIrParaConversa={irParaConversa}
            aoPerderConversa={perderConversa}
            hasOlder={messagesQuery.hasNextPage}
            loadingOlder={messagesQuery.isFetchingNextPage}
            onLoadOlder={() => void messagesQuery.fetchNextPage()}
            authorNames={authorNames}
            onBack={() => setSelectedId(null)}
            onToggleContext={abrirContexto}
            viewerId={viewerId}
            podeEditar={podeEditar}
            ehChefia={ehChefia}
            emVoo={emVooDaConversa}
            aoTentarDeNovo={tentarDeNovo}
            aoDescartarEnvio={descartarEnvio}
            onResponder={(mensagem) => {
              const planoDaCitada: Mode = mensagem.is_internal_note
                ? "nota"
                : "responder";
              // TROCAR O PLANO COM TEXTO PENDENTE É PROIBIDO.
              //
              // Citar uma mensagem do paciente enquanto se escreve uma nota
              // interna mudaria para onde aquele texto vai, sem tocar nele. O
              // rascunho pertence ao plano em que foi escrito: aqui a citação é
              // recusada, e a pessoa decide o que fazer com o que já escreveu.
              if (planoDaCitada !== modo && texto.trim().length > 0) {
                toast.warning(
                  modo === "nota"
                    ? "Você está escrevendo uma nota interna. Salve ou apague a nota antes de citar uma mensagem do paciente."
                    : "Você está escrevendo uma resposta ao paciente. Envie ou apague o texto antes de citar uma nota interna.",
                );
                return;
              }
              // Sem texto pendente não há o que mandar para o lugar errado: o
              // plano acompanha a citação, num gesto só.
              setCitando(mensagem);
              setModo(planoDaCitada);
            }}
            onApagar={(mensagem) => {
              setErroAoApagar(null);
              setApagando(mensagem);
            }}
            footer={
              // key OBRIGATORIA: sem ela o React so troca a prop e o
              // compositor mantem o estado. Com anexo, isso significa a
              // foto de um paciente ficar carregada ao abrir a conversa de
              // outro, e o proximo clique em Enviar manda o arquivo errado
              // para o WhatsApp errado.
              <Composer
                key={selected.id}
                conversation={selected}
                viewerId={viewerId}
                podeEditar={podeEditar}
                // So trava a resposta com a autorizacao CONFERIDA: carregando
                // ou com erro, quem decide e o envio no servidor.
                autorizacao={
                  consentQuery.isSuccess ? consentQuery.data : undefined
                }
                timezone={timezone}
                citando={citandoVivo}
                aoCancelarCitacao={() => setCitando(null)}
                aoCancelarCitacaoSeFor={(id) =>
                  setCitando((atual) => (atual?.id === id ? null : atual))
                }
                authorNames={authorNames}
                modo={modo}
                aoTrocarModo={setModo}
                texto={texto}
                aoMudarTexto={setTexto}
                aoEnviarTexto={enviarTexto}
                aoPerderConversa={perderConversa}
              />
            }
          />
        ) : (
          <div className="grid h-full place-items-center p-6">
            {conversations.length > 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title="Escolha uma conversa"
                description="Selecione um atendimento na lista para ver as mensagens."
              />
            ) : (
              <EmptyState
                icon={MessagesSquare}
                title="Nenhuma conversa aberta"
                description="Quando houver uma conversa na lista, as mensagens aparecem aqui."
              />
            )}
          </div>
        )}
      </section>

      <aside
        aria-label="Dados do contato"
        className="hidden w-context-panel shrink-0 border-l border-border bg-card @min-[1100px]/inbox:block"
      >
        {selected ? (
          <ContextPanel {...propsDoPainel(selected)} />
        ) : (
          <p className="p-4 text-[12.5px] text-text-secondary">
            Os dados do contato aparecem aqui.
          </p>
        )}
      </aside>

      <DialogoApagar
        message={apagando}
        aberto={apagando !== null}
        aoFechar={() => {
          setApagando(null);
          setErroAoApagar(null);
        }}
        aoApagar={confirmarApagar}
        pendente={apagandoPendente}
        erro={erroAoApagar}
      />

      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent
          side={ladoDoContexto}
          className={cn(
            "gap-0 p-0",
            ladoDoContexto === "bottom"
              ? "max-h-[85dvh]"
              : "data-[side=right]:w-[360px] data-[side=right]:max-w-[90vw]",
          )}
        >
          <SheetTitle className="sr-only">Contexto do contato</SheetTitle>
          {selected ? <ContextPanel {...propsDoPainel(selected)} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
