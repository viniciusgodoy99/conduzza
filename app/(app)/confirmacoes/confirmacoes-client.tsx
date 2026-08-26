"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { mudarStatusAction } from "@/app/(app)/agenda/actions";
import { cobrarAgoraAction } from "@/app/(app)/confirmacoes/actions";
import { AgendamentoModal } from "@/components/agenda/agendamento-modal";
import { FILTROS_VAZIOS } from "@/components/agenda/tipos";
import {
  CartoesDoDia,
  type ContagensDoDia,
} from "@/components/confirmacoes/cartoes-do-dia";
import {
  ListaConfirmacoes,
  type CanalDaConfirmacao,
} from "@/components/confirmacoes/lista-confirmacoes";
import { ListaFaltas } from "@/components/confirmacoes/lista-faltas";
import { PainelRegua } from "@/components/confirmacoes/painel-regua";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { somarDias } from "@/lib/domain/horarios";
import { agendaKeys, fetchAgendaDia } from "@/lib/queries/agenda";
import { catalogoKeys, fetchCatalogo } from "@/lib/queries/catalogo";
import {
  confirmacoesKeys,
  fetchConfirmacoesDia,
  fetchFaltasDeHoje,
  fetchReguaDeConfirmacao,
  STATUS_CANCELADOS,
  STATUS_CONFIRMADOS,
  STATUS_PENDENTES,
  type ConsultaDaConfirmacao,
  type FaltaDoDia,
  type ReguaDeConfirmacao,
} from "@/lib/queries/confirmacoes";
import { createClient } from "@/lib/supabase/client";

// Tela 2 no cliente: aba e dia vivem na URL (link direto para "as
// confirmacoes de 14/08"), uma query por bloco de dado e as acoes do dia.
//
// O dia da lista e sempre dia CIVIL DA CLINICA: quem calcula "hoje" e
// "amanha" e o servidor, no fuso da clinica, e o cliente so soma dias em
// cima da string (somarDias nao envolve fuso).

type Aba = "amanha" | "faltas";

export function ConfirmacoesClient({
  clinicId,
  timezone,
  viewerId,
  hoje,
  amanha,
  diaInicial,
  consultasIniciais,
  faltasIniciais,
  reguaInicial,
  podeConfirmar,
  dicaConfirmar,
  podeAgendar,
  dicaAgendar,
  podeAutomatizar,
  dicaAutomatizar,
}: {
  clinicId: string;
  timezone: string;
  viewerId: string;
  hoje: string;
  amanha: string;
  diaInicial: string;
  consultasIniciais: ConsultaDaConfirmacao[];
  faltasIniciais: FaltaDoDia[];
  reguaInicial: ReguaDeConfirmacao | null;
  podeConfirmar: boolean;
  dicaConfirmar: string;
  podeAgendar: boolean;
  dicaAgendar: string;
  podeAutomatizar: boolean;
  dicaAutomatizar: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, iniciarTransicao] = useTransition();
  const [painelAberto, setPainelAberto] = useState(false);
  const [remarcarPara, setRemarcarPara] = useState<string | null>(null);

  const aba: Aba = searchParams.get("aba") === "faltas" ? "faltas" : "amanha";
  // Mesma validacao do servidor: dia fora do formato cai no dia inicial, para
  // um link torto nunca virar consulta com filtro invalido.
  const daURL = searchParams.get("data");
  const dia = daURL && /^\d{4}-\d{2}-\d{2}$/.test(daURL) ? daURL : diaInicial;

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

  const diaQuery = useQuery({
    queryKey: confirmacoesKeys.dia(clinicId, dia),
    queryFn: () => fetchConfirmacoesDia(supabase, clinicId, dia, timezone),
    initialData: dia === diaInicial ? consultasIniciais : undefined,
    staleTime: 30_000,
  });

  const faltasQuery = useQuery({
    queryKey: confirmacoesKeys.faltas(clinicId, hoje),
    queryFn: () => fetchFaltasDeHoje(supabase, clinicId, hoje, timezone),
    initialData: faltasIniciais,
    staleTime: 30_000,
  });

  const reguaQuery = useQuery({
    queryKey: confirmacoesKeys.regua(clinicId),
    queryFn: () => fetchReguaDeConfirmacao(supabase, clinicId),
    initialData: reguaInicial,
    staleTime: 60_000,
  });

  // O modal de agendamento so e montado quando a recepcao pede remarcacao:
  // catalogo e dia da agenda sao carga inutil para quem so confere o dia.
  const precisaDaAgenda = aba === "faltas" && podeAgendar;
  const catalogoQuery = useQuery({
    queryKey: catalogoKeys.tudo(clinicId),
    queryFn: () => fetchCatalogo(supabase, clinicId),
    enabled: precisaDaAgenda,
    staleTime: 60_000,
  });
  const agendaDiaQuery = useQuery({
    queryKey: agendaKeys.dia(clinicId, hoje),
    queryFn: () => fetchAgendaDia(supabase, clinicId, hoje, timezone),
    enabled: precisaDaAgenda,
    staleTime: 15_000,
  });

  const consultas = diaQuery.data ?? [];
  const faltas = faltasQuery.data ?? [];

  const pendentes = consultas.filter((consulta) =>
    STATUS_PENDENTES.includes(consulta.status),
  );
  const cobraveis = pendentes.filter(
    (consulta) => consulta.consent_ativo && consulta.send_confirmation,
  );
  const contagens: ContagensDoDia = {
    total: consultas.length,
    pendentes: pendentes.length,
    confirmadas: consultas.filter((consulta) =>
      STATUS_CONFIRMADOS.includes(consulta.status),
    ).length,
    canceladas: consultas.filter((consulta) =>
      STATUS_CANCELADOS.includes(consulta.status),
    ).length,
    cobraveis: cobraveis.length,
  };

  const atualizarDia = async () => {
    await queryClient.invalidateQueries({
      queryKey: confirmacoesKeys.dia(clinicId, dia),
    });
  };

  const cobrar = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await cobrarAgoraAction({ appointment_ids: ids });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível cobrar agora.");
        return;
      }
      const enfileirados = resultado.enfileirados ?? 0;
      const pulados = resultado.pulados_sem_autorizacao ?? 0;
      const partes: string[] = [
        enfileirados === 1
          ? "1 cobrança na fila de envio"
          : `${enfileirados} cobranças na fila de envio`,
      ];
      if (pulados > 0) {
        partes.push(
          pulados === 1
            ? "1 pulada por falta de autorização"
            : `${pulados} puladas por falta de autorização`,
        );
      }
      if (enfileirados > 0) {
        toast.success(partes.join(", "));
      } else {
        toast.warning(partes.join(", "));
      }
      await atualizarDia();
    });
  };

  // Reusa a acao da Agenda, que confere de novo a transicao, exige o canal e
  // grava a linha do historico com autoria. O botao e desabilitado por
  // "confirmacoes_espera" e a acao guarda por "agenda": na matriz do brief os
  // dois recortes coincidem (admin, gestor e recepcao editam ambos).
  const confirmarManualmente = (
    consulta: ConsultaDaConfirmacao,
    canal: CanalDaConfirmacao,
  ) => {
    iniciarTransicao(async () => {
      const resultado = await mudarStatusAction({
        id: consulta.id,
        status_atual: consulta.status,
        novo_status: "confirmado_recepcao",
        canal,
      });
      if (resultado.ok) {
        toast.success("Consulta confirmada pela recepção.");
        await atualizarDia();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível confirmar.");
    });
  };

  const abrirRemarcacao = (falta: FaltaDoDia) => {
    if (!catalogoQuery.data || !agendaDiaQuery.data) {
      toast.info("Um instante, a agenda ainda está carregando.");
      return;
    }
    setRemarcarPara(falta.contact_id);
  };

  const erroDoDia = diaQuery.isError;
  const carregandoDia = diaQuery.isLoading;

  return (
    <div className="grid gap-4">
      <Tabs
        value={aba}
        onValueChange={(valor) =>
          setParams({ aba: valor === "faltas" ? "faltas" : null })
        }
        className="gap-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="amanha" className="min-h-9">
              Confirmações do dia
            </TabsTrigger>
            <TabsTrigger value="faltas" className="min-h-9">
              Faltas de hoje
              {faltas.length > 0 ? (
                <span className="ml-1.5 font-mono tabular-nums">
                  {faltas.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            className="ml-auto h-10"
            onClick={() => setPainelAberto(true)}
          >
            <Workflow strokeWidth={1.5} className="size-4" aria-hidden />
            Régua de confirmação
          </Button>
        </div>

        <TabsContent value="amanha" className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-10"
              aria-label="Dia anterior"
              onClick={() => setParams({ data: somarDias(dia, -1) })}
            >
              <ChevronLeft strokeWidth={1.5} className="size-4" aria-hidden />
            </Button>
            <Input
              type="date"
              aria-label="Dia das confirmações"
              className="h-10 w-[168px]"
              value={dia}
              onChange={(evento) =>
                setParams({ data: evento.target.value || null })
              }
            />
            <Button
              variant="outline"
              size="icon"
              className="size-10"
              aria-label="Próximo dia"
              onClick={() => setParams({ data: somarDias(dia, 1) })}
            >
              <ChevronRight strokeWidth={1.5} className="size-4" aria-hidden />
            </Button>
            {dia !== amanha ? (
              <Button
                variant="ghost"
                className="h-10"
                onClick={() => setParams({ data: null })}
              >
                Voltar para amanhã
              </Button>
            ) : null}
          </div>

          {erroDoDia && consultas.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
              <TriangleAlert
                strokeWidth={1.5}
                className="size-5 [color:var(--alert)]"
                aria-hidden
              />
              <p className="text-sm text-text-secondary">
                Não foi possível carregar as consultas deste dia.
              </p>
              <Button variant="outline" onClick={() => void diaQuery.refetch()}>
                Tentar de novo
              </Button>
            </div>
          ) : carregandoDia ? (
            <TableSkeleton columns={6} />
          ) : (
            <>
              {erroDoDia ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                  <TriangleAlert
                    strokeWidth={1.5}
                    className="size-4 shrink-0 [color:var(--alert)]"
                    aria-hidden
                  />
                  <p className="text-sm text-text-secondary">
                    Não foi possível atualizar a lista. Os dados exibidos podem
                    estar desatualizados.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => void diaQuery.refetch()}
                  >
                    Tentar de novo
                  </Button>
                </div>
              ) : null}

              <CartoesDoDia
                contagens={contagens}
                podeCobrar={podeConfirmar}
                dicaSemPermissao={dicaConfirmar}
                cobrando={pendente}
                onCobrarTodos={() =>
                  cobrar(cobraveis.map((consulta) => consulta.id))
                }
              />

              {consultas.length === 0 ? (
                <EmptyState
                  icon={CalendarCheck}
                  title="Nenhuma consulta neste dia"
                  description="Escolha outro dia ou marque a primeira consulta na Agenda."
                />
              ) : (
                <ListaConfirmacoes
                  consultas={consultas}
                  timezone={timezone}
                  podeEditar={podeConfirmar}
                  dicaSemPermissao={dicaConfirmar}
                  ocupado={pendente}
                  onCobrar={(consulta) => cobrar([consulta.id])}
                  onConfirmar={confirmarManualmente}
                />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="faltas" className="grid gap-4">
          {faltasQuery.isError && faltas.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
              <TriangleAlert
                strokeWidth={1.5}
                className="size-5 [color:var(--alert)]"
                aria-hidden
              />
              <p className="text-sm text-text-secondary">
                Não foi possível carregar as faltas de hoje.
              </p>
              <Button
                variant="outline"
                onClick={() => void faltasQuery.refetch()}
              >
                Tentar de novo
              </Button>
            </div>
          ) : faltasQuery.isLoading ? (
            <TableSkeleton columns={5} />
          ) : faltas.length === 0 ? (
            <EmptyState
              icon={CalendarX}
              title="Ninguém faltou hoje"
              description="A falta é sempre registrada por alguém da clínica, na Agenda. Quando isso acontecer, o paciente aparece aqui."
            />
          ) : (
            <ListaFaltas
              faltas={faltas}
              timezone={timezone}
              podeEditar={podeAgendar}
              dicaSemPermissao={dicaAgendar}
              onRemarcar={abrirRemarcacao}
            />
          )}
        </TabsContent>
      </Tabs>

      <PainelRegua
        clinicId={clinicId}
        regua={reguaQuery.data ?? null}
        aberto={painelAberto}
        onFechar={() => setPainelAberto(false)}
        podeEditar={podeAutomatizar}
        dicaSemPermissao={dicaAutomatizar}
      />

      {remarcarPara && catalogoQuery.data && agendaDiaQuery.data ? (
        <AgendamentoModal
          contexto={{
            clinicId,
            timezone,
            catalogo: catalogoQuery.data,
            podeEditar: podeAgendar,
            dica: dicaAgendar,
            viewerId,
          }}
          aberto
          onFechar={() => setRemarcarPara(null)}
          prePreenchido={{ contactId: remarcarPara }}
          dia={hoje}
          dadosDoDia={agendaDiaQuery.data}
          filtros={FILTROS_VAZIOS}
        />
      ) : null}
    </div>
  );
}
