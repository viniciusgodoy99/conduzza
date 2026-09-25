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
import { instanteLocal } from "@/lib/domain/horarios";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import { filtrarLeads, type FiltrosDeLeads } from "@/lib/domain/leads-ui";
import {
  fetchLeads,
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
  jornada,
  membros,
  responsaveisAtivos,
  podeEditar,
  dica,
  podeAgendar,
  dicaAgendar,
  soAtribuidas,
}: {
  clinicId: string;
  timezone: string;
  leadsIniciais: LeadResumo[];
  /** Total de contatos da clinica; null se a contagem falhou no servidor */
  totalInicial: number | null;
  /** Etapas com regua de follow-up ligada; null se a leitura falhou */
  reguasIniciais: ReguaDaEtapa[] | null;
  jornada: EtapaDaJornada[];
  /** Nomes de todos os membros, inclusive antigos (exibicao) */
  membros: Record<string, string>;
  /** Ids dos membros ativos: os unicos que podem virar responsavel */
  responsaveisAtivos: string[];
  podeEditar: boolean;
  dica: string;
  /** Permissao da Agenda, para o "Agendar" do drawer */
  podeAgendar: boolean;
  dicaAgendar: string;
  /** Profissional: a RLS so mostra as conversas atribuidas a ele */
  soAtribuidas: boolean;
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

  const visao: Visao =
    searchParams.get("visao") === "lista" ? "lista" : "kanban";
  const visaoEfetiva: Visao = telaEstreita ? "lista" : visao;

  const valores: ValoresFiltros = {
    etapa: searchParams.get("etapa") ?? "",
    origem: searchParams.get("origem") ?? "",
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
  // ate o ultimo milissegundo do dia.
  const filtros = useMemo<FiltrosDeLeads>(
    () => ({
      etapa: valores.etapa || undefined,
      origem: valores.origem || undefined,
      responsavel: valores.resp || undefined,
      deISO: valores.de
        ? instanteLocal(timezone, valores.de, "00:00").toISOString()
        : undefined,
      ateISO: valores.ate
        ? new Date(
            instanteLocal(timezone, valores.ate, "23:59").getTime() + 59_999,
          ).toISOString()
        : undefined,
    }),
    [
      valores.etapa,
      valores.origem,
      valores.resp,
      valores.de,
      valores.ate,
      timezone,
    ],
  );

  // Com initialData a query sempre tem dados definidos.
  const leads = leadsQuery.data;
  const leadsFiltrados = useMemo(
    () => filtrarLeads(leads, filtros),
    [leads, filtros],
  );

  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [leadAbertoId, setLeadAbertoId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [importAberto, setImportAberto] = useState(false);

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
    setParams({ etapa: null, origem: null, resp: null, de: null, ate: null });
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
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          variant="outline"
          onClick={() => setImportAberto(true)}
        >
          <Upload className="size-4" /> Importar planilha
        </BotaoProtegido>
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
        aoMudar={mudarFiltro}
        aoLimpar={limparFiltros}
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
      ) : leadsQuery.isLoading ? (
        visaoEfetiva === "kanban" ? (
          <ColunasCarregando colunas={jornada.length} />
        ) : (
          <TableSkeleton columns={9} />
        )
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
        soAtribuidas={soAtribuidas}
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
