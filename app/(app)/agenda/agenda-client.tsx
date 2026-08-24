"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarX2, UserRoundX } from "lucide-react";
import { useMemo, useState } from "react";

import { AgendamentoModal } from "@/components/agenda/agendamento-modal";
import { DayGrid } from "@/components/agenda/day-grid";
import { FilterBar } from "@/components/agenda/filter-bar";
import { PendingPanel } from "@/components/agenda/pending-panel";
import { WeekGrid } from "@/components/agenda/week-grid";
import {
  FILTROS_VAZIOS,
  type AberturaDeModal,
  type ContextoAgenda,
  type FiltrosAgenda,
  type VisaoAgenda,
} from "@/components/agenda/tipos";
import { EmptyState } from "@/components/shared/empty-state";
import { somarDias } from "@/lib/domain/horarios";
import {
  agendaKeys,
  fetchAgendaDia,
  fetchPendencias,
  type AgendaDia,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";
import {
  catalogoKeys,
  fetchCatalogo,
  type Catalogo,
} from "@/lib/queries/catalogo";
import { useAgendaChannel } from "@/lib/realtime/use-agenda-channel";
import { createClient } from "@/lib/supabase/client";

// Orquestrador da Tela 3. Estado: dia, visao, filtros (na ordem do brief:
// unidade, especialidade, convenio, procedimento e o profissional POR
// ULTIMO), modal pre-preenchivel. Os filtros derivam as colunas visiveis do
// CATALOGO ja em cache, sem refetch: e o que permite responder "quem esta
// livre para dermato pela Unimed" sem saber nome de profissional.

export function AgendaClient({
  clinicId,
  timezone,
  viewerId,
  diaInicial,
  catalogoInicial,
  diaInicialDados,
  pendenciasIniciais,
  podeEditar,
  dica,
  ownProfessionalId,
  papelProfissionalSemVinculo = false,
}: {
  clinicId: string;
  timezone: string;
  viewerId: string;
  diaInicial: string;
  catalogoInicial: Catalogo;
  diaInicialDados: AgendaDia;
  pendenciasIniciais: ConsultaDaAgenda[];
  podeEditar: boolean;
  dica: string;
  ownProfessionalId: string | null;
  papelProfissionalSemVinculo?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [dia, setDia] = useState(diaInicial);
  const [visao, setVisao] = useState<VisaoAgenda>("dia");
  const [filtros, setFiltros] = useState<FiltrosAgenda>({
    ...FILTROS_VAZIOS,
    profissionalId: ownProfessionalId,
  });
  const [modal, setModal] = useState<AberturaDeModal>({
    aberto: false,
    prePreenchido: {},
  });

  useAgendaChannel(supabase, clinicId, timezone);

  const catalogoQuery = useQuery({
    queryKey: catalogoKeys.tudo(clinicId),
    queryFn: () => fetchCatalogo(supabase, clinicId),
    initialData: catalogoInicial,
    staleTime: 60_000,
  });
  const catalogo = catalogoQuery.data;

  const diaQuery = useQuery({
    queryKey: agendaKeys.dia(clinicId, dia),
    queryFn: () => fetchAgendaDia(supabase, clinicId, dia, timezone),
    initialData: dia === diaInicial ? diaInicialDados : undefined,
    staleTime: 30_000,
    gcTime: 5 * 60_000, // navegar muitos dias nao acumula cache para sempre
  });

  const pendenciasQuery = useQuery({
    queryKey: agendaKeys.pendencias(clinicId),
    queryFn: () => fetchPendencias(supabase, clinicId),
    initialData: pendenciasIniciais,
    staleTime: 30_000,
  });

  const contexto: ContextoAgenda = {
    clinicId,
    timezone,
    catalogo,
    podeEditar,
    dica,
    viewerId,
  };

  // Colunas visiveis: profissional ativo que passa em TODOS os filtros.
  const profissionaisVisiveis = useMemo(() => {
    const vinculosAtivos = catalogo.vinculos.filter((v) => v.active);
    return catalogo.profissionais.filter((profissional) => {
      if (!profissional.active) {
        return false;
      }
      if (ownProfessionalId && profissional.id !== ownProfessionalId) {
        return false;
      }
      if (
        filtros.profissionalId &&
        profissional.id !== filtros.profissionalId
      ) {
        return false;
      }
      if (
        filtros.especialidade &&
        !profissional.specialties.includes(filtros.especialidade)
      ) {
        return false;
      }
      if (filtros.unidadeId) {
        const jornadasDoDia = catalogo.jornadas.filter(
          (j) => j.professional_id === profissional.id,
        );
        const atendeNaUnidade = jornadasDoDia.some(
          (j) => j.unit_id === null || j.unit_id === filtros.unidadeId,
        );
        if (!atendeNaUnidade) {
          return false;
        }
      }
      if (filtros.convenioId || filtros.procedimentoId) {
        const convenioAlvo =
          filtros.convenioId === "particular" ? null : filtros.convenioId;
        const temVinculo = vinculosAtivos.some(
          (v) =>
            v.professional_id === profissional.id &&
            (filtros.procedimentoId
              ? v.procedure_id === filtros.procedimentoId
              : true) &&
            (filtros.convenioId ? v.insurance_id === convenioAlvo : true),
        );
        if (!temVinculo) {
          return false;
        }
      }
      return true;
    });
  }, [catalogo, filtros, ownProfessionalId]);

  const temFiltro =
    filtros.unidadeId !== null ||
    filtros.especialidade !== null ||
    filtros.convenioId !== null ||
    filtros.procedimentoId !== null ||
    (filtros.profissionalId !== null && !ownProfessionalId);

  const abrirModal = (pre: AberturaDeModal["prePreenchido"] = {}) =>
    setModal({ aberto: true, prePreenchido: pre });

  const semProfissionais = catalogo.profissionais.filter((p) => p.active);

  // Papel 'profissional' cujo usuario ainda nao foi vinculado a um cadastro
  // de profissional: a RLS barraria todo insert com erro generico. Em vez de
  // abrir a grade e a barra de acoes, mostramos um estado dedicado.
  if (papelProfissionalSemVinculo) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          icon={UserRoundX}
          title="Seu cadastro de profissional ainda não foi vinculado"
          description="Peça ao administrador para vincular seu usuário ao seu cadastro de profissional para ver sua agenda."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        contexto={contexto}
        dia={dia}
        onDia={setDia}
        visao={visao}
        onVisao={setVisao}
        filtros={filtros}
        onFiltros={setFiltros}
        travadoNoProfissional={ownProfessionalId}
        onNovoAgendamento={() => abrirModal({})}
        dados={diaQuery.data ?? { consultas: [], bloqueios: [], holds: [] }}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {semProfissionais.length === 0 ? (
            <div className="grid h-full place-items-center p-6">
              <EmptyState
                icon={CalendarX2}
                title="Cadastre os profissionais para abrir a agenda"
                description="A agenda mostra uma coluna por profissional. Comece pelo cadastro."
                action={{
                  label: "Ir para Cadastros",
                  href: "/cadastros?aba=profissionais",
                }}
              />
            </div>
          ) : profissionaisVisiveis.length === 0 ? (
            <div className="grid h-full place-items-center p-6">
              <EmptyState
                icon={CalendarX2}
                title="Nenhum profissional com esses filtros"
                description="Ajuste os filtros ou limpe tudo para ver a agenda completa."
                onClearFilters={
                  temFiltro
                    ? () =>
                        setFiltros({
                          ...FILTROS_VAZIOS,
                          profissionalId: ownProfessionalId,
                        })
                    : undefined
                }
              />
            </div>
          ) : visao === "dia" ? (
            <DayGrid
              contexto={contexto}
              dia={dia}
              dados={
                diaQuery.data ?? { consultas: [], bloqueios: [], holds: [] }
              }
              carregando={diaQuery.isPending}
              profissionais={profissionaisVisiveis}
              onVaoClicado={(professionalId, inicio) =>
                abrirModal({ professionalId, inicio })
              }
            />
          ) : (
            <WeekGrid
              contexto={contexto}
              diaBase={dia}
              profissional={
                profissionaisVisiveis.find(
                  (p) => p.id === (filtros.profissionalId ?? ownProfessionalId),
                ) ?? profissionaisVisiveis[0]!
              }
              onVaoClicado={(professionalId, inicio) =>
                abrirModal({ professionalId, inicio })
              }
            />
          )}
        </div>

        <PendingPanel
          contexto={contexto}
          pendencias={pendenciasQuery.data ?? []}
        />
      </div>

      <AgendamentoModal
        contexto={contexto}
        aberto={modal.aberto}
        onFechar={() => setModal({ aberto: false, prePreenchido: {} })}
        prePreenchido={modal.prePreenchido}
        dia={dia}
        dadosDoDia={
          diaQuery.data ?? { consultas: [], bloqueios: [], holds: [] }
        }
        filtros={filtros}
      />
    </div>
  );
}

export function diaAnterior(dia: string): string {
  return somarDias(dia, -1);
}

export function diaSeguinte(dia: string): string {
  return somarDias(dia, 1);
}
