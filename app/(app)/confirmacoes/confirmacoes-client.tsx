"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Workflow,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { mudarStatusAction } from "@/app/(app)/agenda/actions";
import {
  cobrarAgoraAction,
  manterHorarioAction,
} from "@/app/(app)/confirmacoes/actions";
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
import { resumoDaCobranca } from "@/components/confirmacoes/resumo-da-cobranca";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import {
  CardsSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import {
  SegmentedControl,
  type OpcaoSegmentada,
} from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { somarDias } from "@/lib/domain/horarios";
import { agendaKeys, fetchAgendaDia } from "@/lib/queries/agenda";
import { catalogoKeys, fetchCatalogo } from "@/lib/queries/catalogo";
import {
  confirmacoesKeys,
  fetchConfirmacoesDia,
  fetchFaltasDeHoje,
  fetchRecuperadasDoDia,
  fetchReguasDaClinica,
  STATUS_CANCELADOS,
  STATUS_CONFIRMADOS,
  STATUS_PENDENTES,
  type ConsultaDaConfirmacao,
  type FaltaDoDia,
  type ReguasDaClinica,
} from "@/lib/queries/confirmacoes";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { createClient } from "@/lib/supabase/client";

// Tela 2 no cliente: aba e dia vivem na URL (link direto para "as
// confirmacoes de 14/08"), uma query por bloco de dado e as acoes do dia.
//
// O dia da lista e sempre dia CIVIL DA CLINICA: quem calcula "hoje" e
// "amanha" e o servidor, no fuso da clinica, e o cliente so soma dias em
// cima da string (somarDias nao envolve fuso).

type Aba = "amanha" | "faltas";

// Filtro por situacao da lista do dia (decisao do dono, C27): local, sobre os
// mesmos dados, e a lista continua agrupada por profissional em ordem de
// horario. "Nao enviadas" sao exatamente as linhas com o chip "Nao enviada"
// (toque pulado); quem pediu para remarcar mostra o pedido no lugar e fica
// fora, como na linha.
type FiltroDoDia =
  "todas" | "confirmadas" | "aguardando" | "canceladas" | "nao_enviadas";

const FILTROS: {
  value: FiltroDoDia;
  label: string;
  inclui: (consulta: ConsultaDaConfirmacao) => boolean;
}[] = [
  { value: "todas", label: "Todas", inclui: () => true },
  {
    value: "confirmadas",
    label: "Confirmadas",
    inclui: (consulta) => STATUS_CONFIRMADOS.includes(consulta.status),
  },
  {
    value: "aguardando",
    label: "Aguardando",
    inclui: (consulta) => STATUS_PENDENTES.includes(consulta.status),
  },
  {
    value: "canceladas",
    label: "Canceladas",
    inclui: (consulta) => STATUS_CANCELADOS.includes(consulta.status),
  },
  {
    value: "nao_enviadas",
    label: "Não enviadas",
    inclui: (consulta) =>
      consulta.remarcacao_pedida_em === null &&
      consulta.toque.situacao === "pulado",
  },
];

export function ConfirmacoesClient({
  clinicId,
  timezone,
  viewerId,
  hoje,
  amanha,
  diaInicial,
  consultasIniciais,
  faltasIniciais,
  reguasIniciais,
  podeConfirmar,
  dicaConfirmar,
  podeAgendar,
  dicaAgendar,
  podeAutomatizar,
  dicaAutomatizar,
  podeRegistrarAutorizacao,
  dicaAutorizacao,
  podeEditarCadastros,
  dicaCadastros,
  ehAdministrador,
}: {
  clinicId: string;
  timezone: string;
  viewerId: string;
  hoje: string;
  amanha: string;
  diaInicial: string;
  consultasIniciais: ConsultaDaConfirmacao[];
  faltasIniciais: FaltaDoDia[];
  reguasIniciais: ReguasDaClinica;
  podeConfirmar: boolean;
  dicaConfirmar: string;
  podeAgendar: boolean;
  dicaAgendar: string;
  podeAutomatizar: boolean;
  dicaAutomatizar: string;
  podeRegistrarAutorizacao: boolean;
  dicaAutorizacao: string;
  podeEditarCadastros: boolean;
  dicaCadastros: string;
  ehAdministrador: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, iniciarTransicao] = useTransition();
  const [painelAberto, setPainelAberto] = useState(false);
  const [remarcarPara, setRemarcarPara] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDoDia>("todas");

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

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(
    confirmacoesKeys.dia(clinicId, diaInicial),
    consultasIniciais,
  );
  useDadosDoServidor(confirmacoesKeys.faltas(clinicId, hoje), faltasIniciais);
  useDadosDoServidor(confirmacoesKeys.regua(clinicId), reguasIniciais);

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
    queryFn: () => fetchReguasDaClinica(supabase, clinicId),
    initialData: reguasIniciais,
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

  const recuperadasQuery = useQuery({
    queryKey: [...confirmacoesKeys.dia(clinicId, dia), "recuperadas"],
    queryFn: () => fetchRecuperadasDoDia(supabase, clinicId, dia, timezone),
  });

  const consultas = diaQuery.data ?? [];
  const faltas = faltasQuery.data ?? [];

  const pendentes = consultas.filter((consulta) =>
    STATUS_PENDENTES.includes(consulta.status),
  );
  const cobraveis = pendentes.filter(
    (consulta) =>
      consulta.consent_ativo &&
      consulta.send_confirmation &&
      // Quem pediu para remarcar ja respondeu: fica fora da cobranca em lote.
      consulta.remarcacao_pedida_em === null,
  );
  const contagens: ContagensDoDia = {
    total: consultas.length,
    recuperadas: recuperadasQuery.data ?? 0,
    pendentes: pendentes.length,
    confirmadas: consultas.filter((consulta) =>
      STATUS_CONFIRMADOS.includes(consulta.status),
    ).length,
    canceladas: consultas.filter((consulta) =>
      STATUS_CANCELADOS.includes(consulta.status),
    ).length,
    cobraveis: cobraveis.length,
  };

  const filtroAtual =
    FILTROS.find((opcao) => opcao.value === filtro) ?? FILTROS[0]!;
  const visiveis = consultas.filter(filtroAtual.inclui);
  const opcoesDoFiltro: OpcaoSegmentada<FiltroDoDia>[] = FILTROS.map(
    (opcao) => ({
      value: opcao.value,
      label: opcao.label,
      count: consultas.filter(opcao.inclui).length,
    }),
  );

  const atualizarDia = async () => {
    await queryClient.invalidateQueries({
      queryKey: confirmacoesKeys.dia(clinicId, dia),
    });
  };

  // Manter o horario depois de um pedido de remarcacao (R12). A pergunta de
  // confirmacao mora na lista; aqui so a acao, o aviso e a recarga do dia.
  const manterHorario = (consulta: ConsultaDaConfirmacao) => {
    iniciarTransicao(async () => {
      const resultado = await manterHorarioAction({
        appointment_id: consulta.id,
      });
      if (resultado.ok) {
        toast.success("Horário mantido. O pedido de remarcação saiu da lista.");
      } else {
        toast.error(resultado.error ?? "Não foi possível manter o horário.");
      }
      await atualizarDia();
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
      // Com varios numeros, parte pode ter ficado de fora por numero
      // desconectado: o aviso diz quantas, qual numero e o que fazer.
      const resumo = resumoDaCobranca(resultado);
      if (resumo.tom === "success") {
        toast.success(resumo.titulo);
      } else if (resumo.detalhe) {
        toast.warning(resumo.titulo, {
          description: resumo.detalhe,
          duration: 10_000,
        });
      } else {
        toast.warning(resumo.titulo);
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
    <div className="flex flex-col gap-3.5">
      <Tabs
        value={aba}
        onValueChange={(valor) =>
          setParams({ aba: valor === "faltas" ? "faltas" : null })
        }
        className="gap-3.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Duas vistas: abas segmentadas, com role=tab (docs/06, D11). */}
          <TabsList variant="segmented">
            <TabsTrigger value="amanha">Confirmações do dia</TabsTrigger>
            <TabsTrigger value="faltas">
              Faltas de hoje
              {faltas.length > 0 ? (
                <>
                  {" "}
                  <TabsCount>{faltas.length}</TabsCount>
                </>
              ) : null}
            </TabsTrigger>
          </TabsList>
          {/* Nome unico na pagina: o e2e abre o painel por ele. */}
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => setPainelAberto(true)}
          >
            <Workflow aria-hidden />
            Mensagens automáticas
          </Button>
        </div>

        <TabsContent value="amanha" className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Dia anterior"
              onClick={() => setParams({ data: somarDias(dia, -1) })}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Input
              type="date"
              aria-label="Dia das confirmações"
              className="w-[168px] cz-num"
              value={dia}
              onChange={(evento) =>
                setParams({ data: evento.target.value || null })
              }
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Próximo dia"
              onClick={() => setParams({ data: somarDias(dia, 1) })}
            >
              <ChevronRight aria-hidden />
            </Button>
            {dia !== amanha ? (
              <Button variant="ghost" onClick={() => setParams({ data: null })}>
                Voltar para amanhã
              </Button>
            ) : null}
          </div>

          {erroDoDia && consultas.length === 0 ? (
            <Card>
              <EmptyState
                tom="erro"
                title="Não foi possível carregar as consultas deste dia"
                description="Confira a conexão e tente de novo. Nada foi alterado."
                action={{
                  label: "Tentar de novo",
                  variant: "outline",
                  onClick: () => void diaQuery.refetch(),
                }}
              />
            </Card>
          ) : carregandoDia ? (
            <>
              <CardsSkeleton
                cards={5}
                className="sm:grid-cols-2 lg:grid-cols-5"
              />
              <TableSkeleton columns={6} />
            </>
          ) : (
            <>
              {erroDoDia ? (
                <Aviso
                  tom="alert"
                  role="alert"
                  acao={
                    <Button
                      variant="outline"
                      onClick={() => void diaQuery.refetch()}
                    >
                      Tentar de novo
                    </Button>
                  }
                >
                  Não foi possível atualizar a lista. Os dados exibidos podem
                  estar desatualizados.
                </Aviso>
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
                <Card>
                  <EmptyState
                    icon={CalendarCheck}
                    title="Nenhuma consulta neste dia"
                    description="Escolha outro dia ou marque a primeira consulta na Agenda."
                    action={{
                      label: "Abrir a Agenda",
                      href: "/agenda",
                      variant: "outline",
                    }}
                  />
                </Card>
              ) : (
                <ListaConfirmacoes
                  consultas={visiveis}
                  timezone={timezone}
                  podeEditar={podeConfirmar}
                  dicaSemPermissao={dicaConfirmar}
                  podeRegistrarAutorizacao={podeRegistrarAutorizacao}
                  dicaAutorizacao={dicaAutorizacao}
                  ocupado={pendente}
                  onCobrar={(consulta) => cobrar([consulta.id])}
                  onConfirmar={confirmarManualmente}
                  onManterHorario={manterHorario}
                  aoRegistrarAutorizacao={atualizarDia}
                  barra={
                    // O trilho rola na horizontal no celular: cinco opcoes
                    // nao cabem em 390px e a pagina nao pode rolar de lado.
                    <div className="cz-scroll max-w-full overflow-x-auto">
                      <SegmentedControl
                        ariaLabel="Filtrar por situação"
                        options={opcoesDoFiltro}
                        value={filtro}
                        onChange={setFiltro}
                      />
                    </div>
                  }
                  vazio={
                    <EmptyState
                      compact
                      icon={ListFilter}
                      title="Nenhuma consulta nesta situação"
                      description="Neste dia, nenhuma consulta está na situação escolhida."
                      onClearFilters={() => setFiltro("todas")}
                    />
                  }
                />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="faltas" className="flex flex-col gap-3.5">
          {faltasQuery.isError && faltas.length === 0 ? (
            <Card>
              <EmptyState
                tom="erro"
                title="Não foi possível carregar as faltas de hoje"
                description="Confira a conexão e tente de novo. Nada foi alterado."
                action={{
                  label: "Tentar de novo",
                  variant: "outline",
                  onClick: () => void faltasQuery.refetch(),
                }}
              />
            </Card>
          ) : faltasQuery.isLoading ? (
            <TableSkeleton columns={5} />
          ) : faltas.length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarX}
                title="Ninguém faltou hoje"
                description="A falta é sempre registrada por alguém da clínica, na Agenda. Quando isso acontecer, o paciente aparece aqui."
              />
            </Card>
          ) : (
            <>
              {faltasQuery.isError ? (
                <Aviso
                  tom="alert"
                  role="alert"
                  acao={
                    <Button
                      variant="outline"
                      onClick={() => void faltasQuery.refetch()}
                    >
                      Tentar de novo
                    </Button>
                  }
                >
                  Não foi possível atualizar a lista. Os dados exibidos podem
                  estar desatualizados.
                </Aviso>
              ) : null}
              <ListaFaltas
                faltas={faltas}
                timezone={timezone}
                podeEditar={podeAgendar}
                dicaSemPermissao={dicaAgendar}
                onRemarcar={abrirRemarcacao}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <PainelRegua
        clinicId={clinicId}
        reguas={reguaQuery.data ?? null}
        aberto={painelAberto}
        onFechar={() => setPainelAberto(false)}
        podeEditar={podeAutomatizar}
        dicaSemPermissao={dicaAutomatizar}
        ehAdministrador={ehAdministrador}
      />

      {remarcarPara && catalogoQuery.data && agendaDiaQuery.data ? (
        <AgendamentoModal
          // O mesmo contrato da Agenda (achados L13 e L21): autorizacao pela
          // permissao de leads e pacientes, atalho de Cadastros pela de
          // cadastros. Nunca a da agenda por tabela.
          contexto={{
            clinicId,
            timezone,
            catalogo: catalogoQuery.data,
            podeEditar: podeAgendar,
            dica: dicaAgendar,
            viewerId,
            podeEditarCadastros,
            dicaCadastros,
            podeRegistrarAutorizacao,
            dicaAutorizacao,
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
