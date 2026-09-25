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
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { instanteLocal, somarDias, weekdayLocal } from "@/lib/domain/horarios";
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
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { useAgendaChannel } from "@/lib/realtime/use-agenda-channel";
import { createClient } from "@/lib/supabase/client";

// Orquestrador da Tela 3. Estado: dia, visao, filtros (na ordem do brief:
// unidade, especialidade, convenio, procedimento e o profissional POR
// ULTIMO), modal pre-preenchivel. Os filtros derivam as colunas visiveis do
// CATALOGO ja em cache, sem refetch: e o que permite responder "quem esta
// livre para dermato pela Unimed" sem saber nome de profissional.
//
// Layout do design system (docs/06 secao 5.6): barra de filtros sobre o
// canvas, a grade num cartao que rola sozinho e o painel "Pendente de voce"
// ao lado. Sem PageHeader: o titulo esta na barra superior.

const DIA_VAZIO: AgendaDia = { consultas: [], bloqueios: [], holds: [] };

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
  podeEditarCadastros = false,
  dicaCadastros = "Somente administradores e gestores alteram os cadastros",
  podeRegistrarAutorizacao = false,
  dicaAutorizacao = "Seu perfil não pode editar leads e pacientes",
  ownProfessionalId,
  papelProfissionalSemVinculo = false,
  agendarContato = null,
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
  podeEditarCadastros?: boolean;
  dicaCadastros?: string;
  podeRegistrarAutorizacao?: boolean;
  dicaAutorizacao?: string;
  ownProfessionalId: string | null;
  papelProfissionalSemVinculo?: boolean;
  /** Deep link ?agendar=<contactId>: abre o modal com o paciente escolhido. */
  agendarContato?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [dia, setDia] = useState(diaInicial);
  const [visao, setVisao] = useState<VisaoAgenda>("dia");
  const [filtros, setFiltros] = useState<FiltrosAgenda>({
    ...FILTROS_VAZIOS,
    profissionalId: ownProfessionalId,
  });
  // Na Semana, de quem e a semana quando ha mais de um profissional visivel
  // (achado 89): escolhido no proprio cabecalho da Semana, sem mexer nos
  // filtros (o filtro de profissional recortaria a lista para um so).
  const [escolhaDaSemana, setEscolhaDaSemana] = useState<string | null>(null);
  const [modal, setModal] = useState<AberturaDeModal>(() =>
    // Deep link so abre o modal para quem PODE agendar: papel de leitura ve
    // a tela normal (mesma regra do /espera?adicionar=).
    agendarContato && podeEditar
      ? { aberto: true, prePreenchido: { contactId: agendarContato } }
      : { aberto: false, prePreenchido: {} },
  );

  useAgendaChannel(supabase, clinicId, timezone);

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(catalogoKeys.tudo(clinicId), catalogoInicial);
  useDadosDoServidor(agendaKeys.dia(clinicId, diaInicial), diaInicialDados);
  useDadosDoServidor(agendaKeys.pendencias(clinicId), pendenciasIniciais);

  const catalogoQuery = useQuery({
    queryKey: catalogoKeys.tudo(clinicId),
    queryFn: () => fetchCatalogo(supabase, clinicId),
    initialData: catalogoInicial,
    // Catalogo muda raramente e cada refetch sao 9 queries: sem motivo para
    // refazer a cada alt-tab.
    staleTime: 5 * 60_000,
  });
  const catalogo = catalogoQuery.data;

  const diaQuery = useQuery({
    queryKey: agendaKeys.dia(clinicId, dia),
    queryFn: () => fetchAgendaDia(supabase, clinicId, dia, timezone),
    initialData: dia === diaInicial ? diaInicialDados : undefined,
    staleTime: 30_000,
    gcTime: 5 * 60_000, // navegar muitos dias nao acumula cache para sempre
    // O canal Realtime mescla consulta e hold na hora; refetch por foco
    // so duplicava a carga.
    refetchOnWindowFocus: false,
  });

  const pendenciasQuery = useQuery({
    queryKey: agendaKeys.pendencias(clinicId),
    queryFn: () => fetchPendencias(supabase, clinicId),
    initialData: pendenciasIniciais,
    staleTime: 30_000,
  });

  const abrirModal = (pre: AberturaDeModal["prePreenchido"] = {}) =>
    setModal({ aberto: true, prePreenchido: pre });

  const contexto: ContextoAgenda = {
    clinicId,
    timezone,
    catalogo,
    podeEditar,
    dica,
    viewerId,
    podeEditarCadastros,
    dicaCadastros,
    podeRegistrarAutorizacao,
    dicaAutorizacao,
    abrirAgendamento: abrirModal,
  };

  const weekdayDoDia = weekdayLocal(
    timezone,
    instanteLocal(timezone, dia, "12:00"),
  );
  const consultasVivasDoDia = useMemo(
    () =>
      (diaQuery.data?.consultas ?? []).filter(
        (c) =>
          c.status !== "cancelado_paciente" && c.status !== "cancelado_clinica",
      ),
    [diaQuery.data],
  );

  // Colunas visiveis: profissional ativo que passa em TODOS os filtros. O
  // inativo continua visivel no dia em que ainda tem consulta (achado 37):
  // sem isso a consulta dele sumia da grade enquanto os lembretes saiam.
  const profissionaisVisiveis = useMemo(() => {
    const vinculosAtivos = catalogo.vinculos.filter((v) => v.active);
    const comConsultaNoDia = new Set(
      consultasVivasDoDia.map((c) => c.professional_id),
    );
    return catalogo.profissionais.filter((profissional) => {
      if (
        !profissional.active &&
        !(visao === "dia" && comConsultaNoDia.has(profissional.id))
      ) {
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
        // Na visao Dia, so as faixas do dia da semana exibido (achados 40 e
        // 90): quem atende na unidade as segundas nao aparece nela na terca.
        // Consulta ja marcada na unidade naquele dia tambem conta.
        const faixas = catalogo.jornadas.filter(
          (j) =>
            j.professional_id === profissional.id &&
            (visao === "semana" || j.weekday === weekdayDoDia),
        );
        const atendeNaUnidade =
          faixas.some(
            (j) => j.unit_id === null || j.unit_id === filtros.unidadeId,
          ) ||
          (visao === "dia" &&
            consultasVivasDoDia.some(
              (c) =>
                c.professional_id === profissional.id &&
                c.unit_id === filtros.unidadeId,
            ));
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
  }, [
    catalogo,
    filtros,
    ownProfessionalId,
    visao,
    weekdayDoDia,
    consultasVivasDoDia,
  ]);

  const temFiltro =
    filtros.unidadeId !== null ||
    filtros.especialidade !== null ||
    filtros.convenioId !== null ||
    filtros.procedimentoId !== null ||
    (filtros.profissionalId !== null && !ownProfessionalId);

  const semProfissionaisAtivos = !catalogo.profissionais.some((p) => p.active);

  // Semana: o escolhido no cabecalho da Semana, senao o do filtro (ou o do
  // proprio papel profissional), senao o primeiro visivel. Nunca em silencio:
  // a WeekGrid escreve "Semana de <nome>".
  const profissionalDaSemana =
    profissionaisVisiveis.find((p) => p.id === escolhaDaSemana) ??
    profissionaisVisiveis.find(
      (p) => p.id === (filtros.profissionalId ?? ownProfessionalId),
    ) ??
    profissionaisVisiveis[0] ??
    null;

  // Estado do dia (achado 83): sem dado e com a busca falhando, a grade NAO
  // se desenha vazia (a recepcao leria o dia como livre). Durante uma nova
  // tentativa, esqueleto.
  const carregandoDia =
    !diaQuery.data && (diaQuery.isPending || diaQuery.isFetching);
  const erroNoDia = !diaQuery.data && diaQuery.isError && !diaQuery.isFetching;

  // Papel 'profissional' cujo usuario ainda nao foi vinculado a um cadastro
  // de profissional: a RLS barraria todo insert com erro generico. Em vez de
  // abrir a grade e a barra de acoes, mostramos um estado dedicado.
  if (papelProfissionalSemVinculo) {
    return (
      <div className="grid h-full place-items-center px-4 py-6 md:px-6">
        <Card className="w-full max-w-xl">
          <EmptyState
            icon={UserRoundX}
            title="Seu cadastro de profissional ainda não foi vinculado"
            description="Peça ao administrador para vincular seu usuário ao seu cadastro de profissional para ver sua agenda."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5 px-4 pt-4 pb-6 md:px-6">
      <AvisoCelular />

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
        dados={diaQuery.data ?? null}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="relative cz-scroll min-w-0 flex-1 overflow-auto rounded-card border border-border bg-card shadow-sm">
          {semProfissionaisAtivos && profissionaisVisiveis.length === 0 ? (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={CalendarX2}
                title="Cadastre os profissionais para abrir a agenda"
                description="A agenda mostra uma coluna por profissional. Comece pelo cadastro."
                action={{
                  label: "Ir para Cadastros",
                  href: "/cadastros?aba=profissionais",
                  variant: "outline",
                }}
              />
            </div>
          ) : profissionaisVisiveis.length === 0 ? (
            <div className="grid h-full place-items-center">
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
            erroNoDia ? (
              <div role="alert" className="grid h-full place-items-center">
                <EmptyState
                  tom="erro"
                  title="Não foi possível carregar a agenda deste dia"
                  description="Confira a conexão e tente de novo. Sem esta leitura, a tela não sabe quais horários estão livres."
                >
                  <Button
                    variant="outline"
                    onClick={() => void diaQuery.refetch()}
                  >
                    Tentar de novo
                  </Button>
                </EmptyState>
              </div>
            ) : (
              <DayGrid
                contexto={contexto}
                dia={dia}
                dados={diaQuery.data ?? DIA_VAZIO}
                carregando={carregandoDia}
                profissionais={profissionaisVisiveis}
                unidadeId={filtros.unidadeId}
                onVaoClicado={(professionalId, inicio) =>
                  abrirModal({ professionalId, inicio })
                }
              />
            )
          ) : profissionalDaSemana ? (
            <WeekGrid
              contexto={contexto}
              diaBase={dia}
              profissional={profissionalDaSemana}
              profissionaisVisiveis={profissionaisVisiveis}
              onProfissional={setEscolhaDaSemana}
              unidadeId={filtros.unidadeId}
              onVaoClicado={(professionalId, inicio) =>
                abrirModal({ professionalId, inicio })
              }
            />
          ) : null}
        </div>

        <PendingPanel
          contexto={contexto}
          pendencias={pendenciasQuery.data ?? []}
        />
      </div>

      {/* Montado so quando aberto: e o maior componente do projeto e nao
          precisa hidratar em toda visita a Agenda (mesmo padrao do modal de
          remarcacao em Confirmacoes). Sem o dado do dia (busca falhou), o
          modal busca de novo em vez de oferecer horario sobre um dia vazio. */}
      {modal.aberto ? (
        <AgendamentoModal
          contexto={contexto}
          aberto={modal.aberto}
          onFechar={() => setModal({ aberto: false, prePreenchido: {} })}
          prePreenchido={modal.prePreenchido}
          dia={dia}
          dadosDoDia={diaQuery.data ?? null}
          filtros={filtros}
        />
      ) : null}
    </div>
  );
}

export function diaAnterior(dia: string): string {
  return somarDias(dia, -1);
}

export function diaSeguinte(dia: string): string {
  return somarDias(dia, 1);
}
