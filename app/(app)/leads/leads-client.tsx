"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutList,
  Plus,
  SearchX,
  SquareKanban,
  TriangleAlert,
  Upload,
  UsersRound,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BotaoProtegido } from "@/components/cadastros/comum";
import { BarraAcoesMassa } from "@/components/leads/barra-acoes-massa";
import { DrawerLead } from "@/components/leads/drawer-lead";
import {
  FiltrosLeads,
  type ValoresFiltros,
} from "@/components/leads/filtros-leads";
import { ModalImportacao } from "@/components/leads/importacao/modal-importacao";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { ListaLeads } from "@/components/leads/lista-leads";
import { ModalNovoLead } from "@/components/leads/modal-novo-lead";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { instanteLocal } from "@/lib/domain/horarios";
import { filtrarLeads, type FiltrosDeLeads } from "@/lib/domain/leads-ui";
import { fetchLeads, leadsKeys, type LeadResumo } from "@/lib/queries/leads";
import { useLeadsChannel } from "@/lib/realtime/use-leads-channel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Tela 4: visao (kanban ou lista) e filtros vivem na URL para link direto,
// mesmo padrao de Cadastros. UMA query da clinica com initialData do
// servidor; filtros aplicados no cliente (filtrarLeads, puro) e tempo real
// mesclando a linha afetada. Abaixo de 1024px a tela forca a lista: Kanban
// arrastavel nao funciona bem no toque estreito.

type Visao = "kanban" | "lista";

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
  membros,
  podeEditar,
  dica,
}: {
  clinicId: string;
  timezone: string;
  leadsIniciais: LeadResumo[];
  membros: Record<string, string>;
  podeEditar: boolean;
  dica: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const telaEstreita = useTelaEstreita();

  useLeadsChannel(supabase, clinicId);

  const leadsQuery = useQuery({
    queryKey: leadsKeys.lista(clinicId),
    queryFn: () => fetchLeads(supabase, clinicId),
    initialData: leadsIniciais,
    staleTime: 30_000,
  });

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

  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [leadAbertoId, setLeadAbertoId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [importAberto, setImportAberto] = useState(false);

  const leadAberto = leads.find((lead) => lead.id === leadAbertoId) ?? null;
  const leadsSelecionados = leads.filter((lead) =>
    selecionados.includes(lead.id),
  );

  const limparFiltros = () =>
    setParams({ etapa: null, origem: null, resp: null, de: null, ate: null });

  const trocarVisao = (nova: Visao) => {
    setSelecionados([]);
    setParams({ visao: nova });
  };

  const selecionar = (id: string, marcado: boolean) =>
    setSelecionados((atual) =>
      marcado ? [...new Set([...atual, id])] : atual.filter((s) => s !== id),
    );
  const selecionarTodos = (ids: string[], marcado: boolean) =>
    setSelecionados((atual) =>
      marcado
        ? [...new Set([...atual, ...ids])]
        : atual.filter((s) => !ids.includes(s)),
    );

  const invalidar = () =>
    void queryClient.invalidateQueries({ queryKey: leadsKeys.lista(clinicId) });

  const abrirLead = (lead: LeadResumo) => setLeadAbertoId(lead.id);

  const vazioInicial = !leadsQuery.isError && leads.length === 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FiltrosLeads
          valores={valores}
          membros={membros}
          aoMudar={(campo, valor) => setParams({ [campo]: valor || null })}
          aoLimpar={limparFiltros}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Some por CSS, nao por estado: o estado de tela estreita so fica
              pronto DEPOIS da montagem, e trocar o DOM naquele instante
              derrubava o foco de quem navega por teclado. */}
          <div className="hidden lg:contents">
            <div
              role="group"
              aria-label="Modo de exibição"
              className="grid grid-cols-2 rounded-lg bg-surface-3 p-0.5 text-[12.5px] font-medium"
            >
              {(
                [
                  ["kanban", "Kanban", SquareKanban],
                  ["lista", "Lista", LayoutList],
                ] as const
              ).map(([valor, rotulo, Icone]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => trocarVisao(valor)}
                  aria-pressed={visao === valor}
                  className={cn(
                    "flex h-[34px] min-w-[80px] items-center justify-center gap-1.5 rounded-md px-3 transition-colors",
                    visao === valor
                      ? "bg-surface-5 text-foreground"
                      : "text-text-secondary hover:text-foreground",
                  )}
                >
                  <Icone strokeWidth={1.5} className="size-4" aria-hidden />
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          <BotaoProtegido
            podeEditar={podeEditar}
            dica={dica}
            onClick={() => setNovoAberto(true)}
          >
            <Plus strokeWidth={1.5} className="size-4" /> Novo lead
          </BotaoProtegido>
          <BotaoProtegido
            podeEditar={podeEditar}
            dica={dica}
            variant="outline"
            onClick={() => setImportAberto(true)}
          >
            <Upload strokeWidth={1.5} className="size-4" /> Importar planilha
          </BotaoProtegido>
        </div>
      </div>

      {leadsQuery.isError && leads.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <TriangleAlert
            strokeWidth={1.5}
            className="size-4 shrink-0 [color:var(--alert)]"
            aria-hidden
          />
          <p className="text-sm text-text-secondary">
            Não foi possível atualizar os leads. Os dados exibidos podem estar
            desatualizados.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void leadsQuery.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {leadsQuery.isError && leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <TriangleAlert
            strokeWidth={1.5}
            className="size-5 [color:var(--alert)]"
            aria-hidden
          />
          <p className="text-sm text-text-secondary">
            Não foi possível carregar os leads.
          </p>
          <Button variant="outline" onClick={() => void leadsQuery.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : leadsQuery.isLoading ? (
        visaoEfetiva === "kanban" ? (
          <div className="flex gap-3 overflow-x-auto pb-2" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[420px] w-[260px] shrink-0" />
            ))}
          </div>
        ) : (
          <TableSkeleton columns={6} />
        )
      ) : vazioInicial ? (
        <EmptyState
          icon={UsersRound}
          title="Nenhum lead ainda"
          description="Os leads chegam sozinhos pelas conversas do WhatsApp. Você também pode criar um lead ou trazer sua base numa planilha."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <BotaoProtegido
              podeEditar={podeEditar}
              dica={dica}
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
          </div>
        </EmptyState>
      ) : leadsFiltrados.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum lead com esses filtros"
          description="Ajuste os filtros ou limpe para ver todos os leads."
          onClearFilters={limparFiltros}
        />
      ) : visaoEfetiva === "kanban" ? (
        <KanbanBoard
          clinicId={clinicId}
          leads={leadsFiltrados}
          membros={membros}
          podeEditar={podeEditar}
          onAbrirLead={abrirLead}
        />
      ) : (
        <ListaLeads
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
          clinicId={clinicId}
          selecionados={leadsSelecionados}
          membros={membros}
          podeEditar={podeEditar}
          dica={dica}
          onLimpar={() => setSelecionados([])}
        />
      ) : null}

      <DrawerLead
        clinicId={clinicId}
        lead={leadAberto}
        timezone={timezone}
        membros={membros}
        podeEditar={podeEditar}
        dica={dica}
        onFechar={() => setLeadAbertoId(null)}
      />

      <ModalNovoLead
        aberto={novoAberto}
        membros={membros}
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
