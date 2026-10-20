"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Columns3,
  List,
  Plus,
  SearchX,
  Upload,
  UsersRound,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BotaoProtegido } from "@/components/cadastros/comum";
import { BarraAcoesMassa } from "@/components/leads/barra-acoes-massa";
import { ColunasCarregando } from "@/components/leads/colunas-carregando";
import { DrawerLead } from "@/components/leads/drawer-lead";
import {
  AvisoDaExportacaoDeLeads,
  BotaoExportarLeads,
  useExportacaoDeLeads,
} from "@/components/leads/exportar-leads";
import {
  FiltrosLeads,
  type OpcaoDeResponsavel,
  type ValoresFiltros,
} from "@/components/leads/filtros-leads";
import { ModalImportacao } from "@/components/leads/importacao/modal-importacao";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { ListaLeads } from "@/components/leads/lista-leads";
import { ModalNovoLead } from "@/components/leads/modal-novo-lead";
import { Aviso } from "@/components/shared/aviso";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  indexarMapaDeAtribuicao,
  opcoesDeAnuncio,
  opcoesDeCampanha,
  type MapaDeAtribuicaoLido,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import {
  opcoesDeEtiqueta,
  tonsDasEtiquetas,
  type LeituraDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import {
  algumaEtapaComDescricao,
  type EtapaDaJornada,
} from "@/lib/domain/jornada";
import {
  filtrarLeads,
  filtrosDeLeadsDosValores,
  textoDaContagemDeLeads,
  type FiltrosDeLeads,
} from "@/lib/domain/leads-ui";
import {
  etiquetasKeys,
  fetchEtiquetasDeConversa,
} from "@/lib/queries/etiquetas-de-conversa";
import {
  fetchLeads,
  fetchMapaDeAtribuicao,
  fetchReguasDeFollowup,
  fetchTotalDeLeads,
  LEADS_LIMIT,
  leadsKeys,
  type LeadResumo,
  type ReguaDaEtapa,
} from "@/lib/queries/leads";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { useLeadsChannel } from "@/lib/realtime/use-leads-channel";
import { createClient } from "@/lib/supabase/client";

// Tela 4: visao (kanban ou lista) e filtros vivem na URL para link direto,
// mesmo padrao de Cadastros. UMA query da clinica com initialData do
// servidor; filtros aplicados no cliente (filtrarLeads, puro) e tempo real
// mesclando a linha afetada. Abaixo de 1024px a tela forca a lista: Kanban
// arrastavel nao funciona bem no toque estreito.
//
// Selecao (achado 96 da revisao): o alvo de uma acao em massa e sempre o que
// esta NA TELA. A selecao efetiva e recortada pelos leads filtrados, zera
// quando um filtro muda e, depois de uma acao em massa, fica so com os leads
// que nao mudaram (nenhum, quando tudo deu certo).
//
// Exportar (pedido do dono em 20/10/2026): o arquivo e gerado no servidor
// com TODOS os leads que batem com os filtros da URL, nao so os carregados
// aqui (components/leads/exportar-leads.tsx). So administrador e gestor; os
// outros papeis veem o botao desabilitado, com a dica.
//
// Campanha e Anúncio (pedido do dono em 20/10/2026, para o cliente bater
// com Resultados): os leads sao separados com as chaves de Resultados
// (lib/domain/campanha-e-anuncio-do-lead.ts), e cada linha de Resultados
// abre esta tela ja filtrada (?visao=lista&de=&ate=&campanha=...). O filtro
// de campanha precisa do mapa da clinica (meta_anuncio e
// anuncio_do_whatsapp): sem ele a lista espera ou diz que nao deu, nunca
// filtra errado. Ao lado da barra, quantos leads batem com os filtros.
//
// Etiquetas (relato do dono em 20/10/2026): as cadastradas da clinica
// (conversation_tag_def, pela sessao, com a RLS) vem do servidor e ficam na
// MESMA consulta do Atendimento. Dao o tom dos chips da lista, do cartao e
// da gaveta, e, com as que ja estao em uso nos leads carregados, as opcoes
// do "Etiquetar lead". Sem a leitura (carregando ou erro), os chips saem
// neutros e o popover fica com as em uso, avisando; a tela nao cai.

type Visao = "kanban" | "lista";

const VISOES = [
  { value: "kanban", label: "Kanban", icon: Columns3 },
  { value: "lista", label: "Lista", icon: List },
] as const;

const numero = new Intl.NumberFormat("pt-BR");

function ordenarPorNome(
  ids: Iterable<string>,
  membros: Record<string, string>,
): OpcaoDeResponsavel[] {
  const opcoes: OpcaoDeResponsavel[] = [];
  for (const id of ids) {
    const nome = membros[id];
    if (nome !== undefined) {
      opcoes.push({ id, nome });
    }
  }
  return opcoes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function useTelaEstreita(): boolean {
  const [estreita, setEstreita] = useState(false);
  useEffect(() => {
    const consulta = window.matchMedia("(max-width: 1023px)");
    const atualizar = () => setEstreita(consulta.matches);
    atualizar();
    consulta.addEventListener("change", atualizar);
    return () => consulta.removeEventListener("change", atualizar);
  }, []);
  return estreita;
}

export function LeadsClient({
  clinicId,
  timezone,
  leadsIniciais,
  totalInicial,
  reguasIniciais,
  mapaInicial,
  jornada,
  membros,
  responsaveisAtivos,
  podeEditar,
  dica,
  podeExportar,
  podeAgendar,
  dicaAgendar,
  podeIniciarConversa = false,
  dicaIniciarConversa = "",
  soAtribuidas,
  etiquetasIniciais,
}: {
  clinicId: string;
  timezone: string;
  leadsIniciais: LeadResumo[];
  /** Total de contatos da clinica; null se a contagem falhou no servidor */
  totalInicial: number | null;
  /** Etapas com regua de follow-up ligada; null se a leitura falhou */
  reguasIniciais: ReguaDaEtapa[] | null;
  /**
   * Mapa da clinica para separar campanha e anuncio como Resultados; null
   * se a leitura falhou no servidor (o navegador tenta de novo).
   */
  mapaInicial: MapaDeAtribuicaoLido | null;
  jornada: EtapaDaJornada[];
  /** Nomes de todos os membros, inclusive antigos (exibicao) */
  membros: Record<string, string>;
  /** Ids dos membros ativos: os unicos que podem virar responsavel */
  responsaveisAtivos: string[];
  podeEditar: boolean;
  dica: string;
  /** Administrador ou gestor: o "Exportar" fica habilitado */
  podeExportar: boolean;
  /** Permissao da Agenda, para o "Agendar" do drawer */
  podeAgendar: boolean;
  dicaAgendar: string;
  /** "Iniciar conversa" do drawer: Atendimento e Leads editaveis */
  podeIniciarConversa?: boolean;
  dicaIniciarConversa?: string;
  /** Profissional: a RLS so mostra as conversas atribuidas a ele */
  soAtribuidas: boolean;
  /**
   * Etiquetas cadastradas da clinica; null se a leitura falhou no servidor
   * (o navegador tenta de novo).
   */
  etiquetasIniciais?: EtiquetaDeConversa[] | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const telaEstreita = useTelaEstreita();

  useLeadsChannel(supabase, clinicId);

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(leadsKeys.lista(clinicId), leadsIniciais);
  useDadosDoServidor(leadsKeys.total(clinicId), totalInicial ?? undefined);
  useDadosDoServidor(leadsKeys.reguas(clinicId), reguasIniciais ?? undefined);
  useDadosDoServidor(leadsKeys.mapa(clinicId), mapaInicial ?? undefined);
  useDadosDoServidor(
    etiquetasKeys.daClinica(clinicId),
    etiquetasIniciais ?? undefined,
  );

  const leadsQuery = useQuery({
    queryKey: leadsKeys.lista(clinicId),
    queryFn: () => fetchLeads(supabase, clinicId),
    initialData: leadsIniciais,
    staleTime: 30_000,
    // O canal Realtime mescla contato a contato; refetch por foco refazia a
    // lista inteira sem necessidade.
    refetchOnWindowFocus: false,
  });

  // Acessorios: sem dado do servidor (falhou la), o navegador busca sozinho.
  const totalQuery = useQuery({
    queryKey: leadsKeys.total(clinicId),
    queryFn: () => fetchTotalDeLeads(supabase, clinicId),
    initialData: totalInicial ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const reguasQuery = useQuery({
    queryKey: leadsKeys.reguas(clinicId),
    queryFn: () => fetchReguasDeFollowup(supabase, clinicId),
    initialData: reguasIniciais ?? undefined,
    staleTime: 60_000,
  });
  // null = nao deu para conferir (carregando ou erro): o Mudar etapa avisa.
  const reguas = reguasQuery.data ?? null;
  // O mapa muda sem tempo real (o resolvedor de anuncios grava meta_anuncio
  // no servidor): vale por um minuto, como Resultados.
  const mapaQuery = useQuery({
    queryKey: leadsKeys.mapa(clinicId),
    queryFn: () => fetchMapaDeAtribuicao(supabase, clinicId),
    initialData: mapaInicial ?? undefined,
    staleTime: 60_000,
  });
  const mapa = useMemo(
    () => (mapaQuery.data ? indexarMapaDeAtribuicao(mapaQuery.data) : null),
    [mapaQuery.data],
  );
  // Etiquetas cadastradas: o gestor pode criar uma em Configuracoes a
  // qualquer hora; vale por um minuto, como no Atendimento.
  const etiquetasQuery = useQuery({
    queryKey: etiquetasKeys.daClinica(clinicId),
    queryFn: () => fetchEtiquetasDeConversa(supabase, clinicId),
    initialData: etiquetasIniciais ?? undefined,
    staleTime: 60_000,
  });
  const catalogoDeEtiquetas = etiquetasQuery.data;
  // "Tentar de novo" volta a mostrar carregando enquanto busca.
  const leituraDasEtiquetas: LeituraDasEtiquetas = catalogoDeEtiquetas
    ? "pronto"
    : etiquetasQuery.isError && !etiquetasQuery.isFetching
      ? "erro"
      : "carregando";
  const tonsDeEtiqueta = useMemo(
    () => tonsDasEtiquetas(catalogoDeEtiquetas ?? []),
    [catalogoDeEtiquetas],
  );

  const visao: Visao =
    searchParams.get("visao") === "lista" ? "lista" : "kanban";
  const visaoEfetiva: Visao = telaEstreita ? "lista" : visao;

  const valores: ValoresFiltros = {
    etapa: searchParams.get("etapa") ?? "",
    origem: searchParams.get("origem") ?? "",
    campanha: searchParams.get("campanha") ?? "",
    anuncio: searchParams.get("anuncio") ?? "",
    resp: searchParams.get("resp") ?? "",
    de: searchParams.get("de") ?? "",
    ate: searchParams.get("ate") ?? "",
  };
  const setParams = (mudancas: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") {
        params.delete(chave);
      } else {
        params.set(chave, valor);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // O periodo dos inputs e dia civil da clinica; o filtro compara instantes.
  // A conversao respeita o fuso da clinica (regra 3.6), com o fim inclusivo
  // ate o ultimo milissegundo do dia. A MESMA conversao vale na exportacao.
  const filtros = useMemo<FiltrosDeLeads>(
    () =>
      filtrosDeLeadsDosValores(
        {
          etapa: valores.etapa,
          origem: valores.origem,
          campanha: valores.campanha,
          anuncio: valores.anuncio,
          resp: valores.resp,
          de: valores.de,
          ate: valores.ate,
        },
        timezone,
      ),
    [
      valores.etapa,
      valores.origem,
      valores.campanha,
      valores.anuncio,
      valores.resp,
      valores.de,
      valores.ate,
      timezone,
    ],
  );

  // Com initialData a query sempre tem dados definidos.
  const leads = leadsQuery.data;
  // As etiquetas do "Etiquetar lead": as cadastradas e as em uso em TODOS
  // os leads carregados (nao so nos filtrados), sem repetir.
  const etiquetasDaClinica = useMemo(
    () => opcoesDeEtiqueta(catalogoDeEtiquetas ?? [], leads),
    [catalogoDeEtiquetas, leads],
  );
  // O filtro de campanha sem o mapa (carregando ou erro) nao decide nada: a
  // lista mostra o carregando ou o erro, nunca um recorte errado.
  const campanhaSemMapa = Boolean(filtros.campanha) && mapa === null;
  const leadsFiltrados = useMemo(
    () =>
      campanhaSemMapa ? [] : filtrarLeads(leads, filtros, mapa ?? undefined),
    [leads, filtros, mapa, campanhaSemMapa],
  );

  // Opcoes a partir de TODOS os leads carregados (nao so os filtrados): o
  // valor da URL fora deles aparece com o rotulo de reserva.
  const opcoesDaCampanha = useMemo(
    () => opcoesDeCampanha(leads, mapa, valores.campanha),
    [leads, mapa, valores.campanha],
  );
  const opcoesDoAnuncio = useMemo(
    () => opcoesDeAnuncio(leads, mapa, valores.anuncio),
    [leads, mapa, valores.anuncio],
  );
  const dicaDaCampanha =
    mapa !== null
      ? null
      : mapaQuery.isError
        ? "Não foi possível carregar as campanhas. Tente de novo."
        : "Carregando as campanhas.";

  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [leadAbertoId, setLeadAbertoId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [importAberto, setImportAberto] = useState(false);
  const exportacao = useExportacaoDeLeads(clinicId, valores);

  const leadAberto = leads.find((lead) => lead.id === leadAbertoId) ?? null;
  // So o que esta na tela pode ser alvo: lead que saiu do filtro (pela troca
  // de filtro, por uma acao ou pelo tempo real) sai da selecao efetiva.
  const leadsSelecionados = useMemo(
    () => leadsFiltrados.filter((lead) => selecionados.has(lead.id)),
    [leadsFiltrados, selecionados],
  );

  const limparSelecao = () => setSelecionados(new Set());

  const mudarFiltro = (campo: keyof ValoresFiltros, valor: string) => {
    limparSelecao();
    setParams({ [campo]: valor || null });
  };

  const limparFiltros = () => {
    limparSelecao();
    setParams({
      etapa: null,
      origem: null,
      campanha: null,
      anuncio: null,
      resp: null,
      de: null,
      ate: null,
    });
  };

  const trocarVisao = (nova: Visao) => {
    limparSelecao();
    setParams({ visao: nova });
  };

  const selecionar = (id: string, marcado: boolean) =>
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcado) {
        proximo.add(id);
      } else {
        proximo.delete(id);
      }
      return proximo;
    });
  const selecionarTodos = (ids: string[], marcado: boolean) =>
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      for (const id of ids) {
        if (marcado) {
          proximo.add(id);
        } else {
          proximo.delete(id);
        }
      }
      return proximo;
    });

  // Responsavel que se ESCOLHE (Reatribuir, Novo lead): so membro ativo. No
  // filtro entram tambem os donos atuais dos leads carregados, para ainda
  // dar para achar os leads de quem saiu da clinica (achado 102).
  const responsaveis = useMemo(
    () => ordenarPorNome(responsaveisAtivos, membros),
    [responsaveisAtivos, membros],
  );
  const responsaveisDoFiltro = useMemo(() => {
    const ids = new Set(responsaveisAtivos);
    for (const lead of leads) {
      if (lead.owner_user_id) {
        ids.add(lead.owner_user_id);
      }
    }
    if (valores.resp) {
      ids.add(valores.resp);
    }
    return ordenarPorNome(ids, membros);
  }, [responsaveisAtivos, leads, membros, valores.resp]);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: leadsKeys.lista(clinicId) });
    void queryClient.invalidateQueries({ queryKey: leadsKeys.total(clinicId) });
  };

  const abrirLead = (lead: LeadResumo) => setLeadAbertoId(lead.id);

  const vazioInicial = !leadsQuery.isError && leads.length === 0;

  // Aviso de corte (achado 93): so quando o teto cortou de verdade. Contato
  // criado entre a contagem e a busca nao dispara aviso numa clinica pequena.
  const total = totalQuery.data;
  const cortado =
    total !== undefined && leads.length >= LEADS_LIMIT && total > leads.length;

  // Quantos leads batem com os filtros, para comparar com Resultados. So
  // quando a lista diz algo de verdade (nem carregando, nem erro sem dado,
  // nem esperando o mapa da campanha). A regiao viva fica sempre montada:
  // o leitor de tela so anuncia mudanca em regiao que ja existia.
  const contagemVisivel =
    !leadsQuery.isLoading &&
    !(leadsQuery.isError && leads.length === 0) &&
    !campanhaSemMapa;
  const resumo = (
    <p
      aria-live="polite"
      aria-atomic="true"
      className="text-[13px] whitespace-nowrap text-text-secondary"
    >
      {contagemVisivel
        ? textoDaContagemDeLeads(
            leadsFiltrados.length,
            cortado ? leads.length : null,
          )
        : null}
    </p>
  );

  return (
    <div className="flex flex-col gap-3.5 p-6">
      <PageHeader
        title="Leads"
        description="Todos os contatos no funil da clínica, do primeiro contato ao comparecimento"
      >
        {/* Some por CSS, nao por estado: o estado de tela estreita so fica
            pronto DEPOIS da montagem, e trocar o DOM naquele instante
            derrubava o foco de quem navega por teclado. */}
        <div className="hidden lg:contents">
          <SegmentedControl
            options={VISOES}
            value={visao}
            onChange={trocarVisao}
            ariaLabel="Modo de exibição"
          />
        </div>
        {/* Abaixo de 640px Importar e Exportar ficam so com o icone (o nome
            continua para o leitor de tela): com os dois e o Novo lead, a
            barra passaria da largura do celular. */}
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          variant="outline"
          onClick={() => setImportAberto(true)}
        >
          <Upload className="size-4" aria-hidden />
          <span className="max-sm:sr-only">Importar planilha</span>
        </BotaoProtegido>
        <BotaoExportarLeads
          podeExportar={podeExportar}
          exportando={exportacao.exportando}
          aoExportar={exportacao.exportar}
        />
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => setNovoAberto(true)}
        >
          <Plus className="size-4" /> Novo lead
        </BotaoProtegido>
      </PageHeader>

      <AvisoCelular />

      <FiltrosLeads
        jornada={jornada}
        valores={valores}
        responsaveis={responsaveisDoFiltro}
        opcoesDeCampanha={opcoesDaCampanha}
        dicaDaCampanha={dicaDaCampanha}
        opcoesDeAnuncio={opcoesDoAnuncio}
        resumo={resumo}
        aoMudar={mudarFiltro}
        aoLimpar={limparFiltros}
      />

      {/* O mapa nao carregou e nenhuma campanha esta filtrada: so o filtro
          de campanha fica de fora (com o filtro ativo, o erro ocupa o lugar
          da lista, abaixo). */}
      {mapa === null && mapaQuery.isError && !campanhaSemMapa ? (
        <Aviso
          tom="warning"
          acao={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void mapaQuery.refetch()}
            >
              Tentar de novo
            </Button>
          }
        >
          Não foi possível carregar as campanhas. O filtro de campanha fica
          indisponível até carregar.
        </Aviso>
      ) : null}

      <AvisoDaExportacaoDeLeads
        aviso={exportacao.aviso}
        aoDispensar={exportacao.dispensar}
        aoTentarDeNovo={exportacao.exportar}
      />

      {cortado ? (
        <Aviso tom="info" role="note">
          Mostrando{" "}
          <span className="cz-num font-bold">
            {numero.format(leads.length)}
          </span>{" "}
          de{" "}
          <span className="cz-num font-bold">{numero.format(total ?? 0)}</span>{" "}
          leads, os de contato mais recente. Use os filtros para achar alguém
          entre eles.
        </Aviso>
      ) : null}

      {leadsQuery.isError && leads.length > 0 ? (
        <Aviso
          tom="warning"
          acao={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void leadsQuery.refetch()}
            >
              Tentar de novo
            </Button>
          }
        >
          Não foi possível atualizar os leads. Os dados exibidos podem estar
          desatualizados.
        </Aviso>
      ) : null}

      {leadsQuery.isError && leads.length === 0 ? (
        <Card>
          <EmptyState
            tom="erro"
            title="Não foi possível carregar os leads"
            description="A lista não chegou do servidor. Confira a internet e tente de novo."
            action={{
              label: "Tentar de novo",
              onClick: () => void leadsQuery.refetch(),
              variant: "outline",
            }}
          />
        </Card>
      ) : leadsQuery.isLoading || (campanhaSemMapa && !mapaQuery.isError) ? (
        visaoEfetiva === "kanban" ? (
          <ColunasCarregando
            colunas={jornada.length}
            comDescricao={algumaEtapaComDescricao(jornada)}
          />
        ) : (
          <TableSkeleton columns={10} />
        )
      ) : campanhaSemMapa ? (
        <Card>
          <EmptyState
            tom="erro"
            title="Não foi possível filtrar por campanha"
            description="As campanhas da clínica não carregaram. Tente de novo ou limpe os filtros."
            action={{
              label: "Tentar de novo",
              onClick: () => void mapaQuery.refetch(),
              variant: "outline",
            }}
            onClearFilters={limparFiltros}
          />
        </Card>
      ) : vazioInicial ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="Nenhum lead ainda"
            description="Os leads chegam sozinhos pelas conversas do WhatsApp. Você também pode criar um lead ou trazer sua base numa planilha."
          >
            <BotaoProtegido
              podeEditar={podeEditar}
              dica={dica}
              variant="outline"
              onClick={() => setNovoAberto(true)}
            >
              Criar lead
            </BotaoProtegido>
            <BotaoProtegido
              podeEditar={podeEditar}
              dica={dica}
              variant="outline"
              onClick={() => setImportAberto(true)}
            >
              Importar planilha
            </BotaoProtegido>
          </EmptyState>
        </Card>
      ) : leadsFiltrados.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={SearchX}
            title="Nenhum lead com esses filtros"
            description="Ajuste os filtros ou limpe para ver todos os leads."
            onClearFilters={limparFiltros}
          />
        </Card>
      ) : visaoEfetiva === "kanban" ? (
        <KanbanBoard
          jornada={jornada}
          clinicId={clinicId}
          leads={leadsFiltrados}
          membros={membros}
          reguas={reguas}
          podeEditar={podeEditar}
          onAbrirLead={abrirLead}
        />
      ) : (
        <ListaLeads
          jornada={jornada}
          leads={leadsFiltrados}
          membros={membros}
          timezone={timezone}
          tonsDeEtiqueta={tonsDeEtiqueta}
          selecionados={selecionados}
          onSelecionar={selecionar}
          onSelecionarTodos={selecionarTodos}
          onAbrirLead={abrirLead}
        />
      )}

      {visaoEfetiva === "lista" && leadsSelecionados.length > 0 ? (
        <BarraAcoesMassa
          jornada={jornada}
          clinicId={clinicId}
          selecionados={leadsSelecionados}
          responsaveis={responsaveis}
          reguas={reguas}
          podeEditar={podeEditar}
          dica={dica}
          etiquetasDaClinica={etiquetasDaClinica}
          leituraDasEtiquetas={leituraDasEtiquetas}
          aoTentarDeNovoAsEtiquetas={() => void etiquetasQuery.refetch()}
          onLimpar={limparSelecao}
          aoConcluir={(restantes) => setSelecionados(new Set(restantes))}
        />
      ) : null}

      <DrawerLead
        jornada={jornada}
        clinicId={clinicId}
        lead={leadAberto}
        timezone={timezone}
        membros={membros}
        podeEditar={podeEditar}
        dica={dica}
        podeAgendar={podeAgendar}
        dicaAgendar={dicaAgendar}
        podeIniciarConversa={podeIniciarConversa}
        dicaIniciarConversa={dicaIniciarConversa}
        soAtribuidas={soAtribuidas}
        tonsDeEtiqueta={tonsDeEtiqueta}
        onFechar={() => setLeadAbertoId(null)}
      />

      <ModalNovoLead
        aberto={novoAberto}
        responsaveis={responsaveis}
        onFechar={() => setNovoAberto(false)}
        aoCriar={invalidar}
      />

      <ModalImportacao
        aberto={importAberto}
        aoFechar={() => setImportAberto(false)}
        aoImportar={invalidar}
      />
    </div>
  );
}
