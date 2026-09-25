"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, UserPlus, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  criarAgendamentoAction,
  criarPacienteRapidoAction,
} from "@/app/(app)/agenda/actions";
import { concederConsentimentoAction } from "@/app/(app)/leads/actions";
import { BotaoProtegido } from "@/components/cadastros/comum";
import type {
  ContextoAgenda,
  FiltrosAgenda,
  PrePreenchido,
} from "@/components/agenda/tipos";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CONSENT_STATUS, type StatusDefinition } from "@/lib/design/status";
import {
  diaCivil,
  instanteLocal,
  somarDias,
  weekdayLocal,
} from "@/lib/domain/horarios";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import {
  availableSlots,
  conferirEncaixe,
  firstAvailableSlots,
  type ConferenciaDeEncaixe,
  type EntradaDisponibilidade,
  type SlotLivre,
} from "@/lib/domain/scheduling";
import {
  chaveDeTelefone,
  formatarTelefone,
  MENSAGEM_TELEFONE_INVALIDO,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import {
  agendaKeys,
  fetchAgendaDia,
  fetchConsentimentoDoContato,
  type AgendaDia,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";
import type { Vinculo } from "@/lib/queries/catalogo";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Modal de novo agendamento (tarefa 2.6): a acao mais repetida do dia da
// recepcao. UMA tela, ordem fixa de campos, aceite de 20 segundos. O motor
// de horarios e o availableSlots puro; o conflito real quem decide e a
// exclusion constraint do banco (o modal so reage ao code "conflito").
//
// Da revisao de liberacao: encaixe proposital com a chave "Marcar como
// encaixe" (achado 82); faixas de jornada da unidade escolhida (40 e 90);
// "sem jornada" e "sem vinculo" levam a Cadastros (38); a autorizacao do
// paciente aparece junto da confirmacao automatica, que so diz o que e
// verdade (50, 57 e 88); o cadastro rapido manda o telefone como digitado e
// mostra o cadastro que ficou (86, 87 e R6); a busca acha o telefone pela
// chave, com ou sem o nono digito.

const PARTICULAR = "particular";

/** Encaixe: um icone, um rotulo e uma cor, igual no bloco da grade. */
const ENCAIXE: StatusDefinition = {
  label: "Encaixe",
  tone: "neutral",
  icon: Zap,
};

type PacienteSelecionado = { id: string; name: string; phone: string };

type ResultadoBusca = { id: string; name: string | null; phone_e164: string };

export function AgendamentoModal({
  contexto,
  aberto,
  onFechar,
  prePreenchido,
  dia,
  dadosDoDia,
  filtros,
}: {
  contexto: ContextoAgenda;
  aberto: boolean;
  onFechar: () => void;
  prePreenchido: PrePreenchido;
  dia: string;
  /** null quando o dia da tela nao carregou: o modal busca de novo */
  dadosDoDia: AgendaDia | null;
  filtros: FiltrosAgenda;
}) {
  const { clinicId, timezone, catalogo } = contexto;
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  // ----- estado do formulario -------------------------------------------
  const [paciente, setPaciente] = useState<PacienteSelecionado | null>(null);
  const [unidadeId, setUnidadeId] = useState<string | null>(null);
  const [convenioId, setConvenioId] = useState<string>(PARTICULAR);
  const [procedimentoId, setProcedimentoId] = useState<string | null>(null);
  const [vinculoId, setVinculoId] = useState<string | null>(null);
  const [dataEscolhida, setDataEscolhida] = useState(dia);
  const [slot, setSlot] = useState<SlotLivre | null>(null);
  const [inicioDesejado, setInicioDesejado] = useState<Date | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  // Encaixe proposital (achado 82): hora livre, dentro ou fora da jornada.
  const [modoEncaixe, setModoEncaixe] = useState(false);
  const [horaEncaixe, setHoraEncaixe] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviarConfirmacao, setEnviarConfirmacao] = useState(true);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [houveConflito, setHouveConflito] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Reset completo a cada abertura, ja com o pre-preenchido do clique no vao
  // ou da falta ("Marcar nova consulta": mesmo procedimento e convenio).
  useEffect(() => {
    if (!aberto) {
      return;
    }
    setPaciente(null);
    const unidadesAtivas = catalogo.unidades.filter((u) => u.active);
    setUnidadeId(
      filtros.unidadeId ??
        (unidadesAtivas.length === 1 ? unidadesAtivas[0]!.id : null),
    );
    setConvenioId(
      prePreenchido.convenioId !== undefined
        ? (prePreenchido.convenioId ?? PARTICULAR)
        : (filtros.convenioId ?? PARTICULAR),
    );
    setProcedimentoId(
      prePreenchido.procedimentoId ?? filtros.procedimentoId ?? null,
    );
    setVinculoId(null);
    setDataEscolhida(
      prePreenchido.inicio
        ? diaCivil(timezone, prePreenchido.inicio)
        : (prePreenchido.dia ?? dia),
    );
    setSlot(null);
    setInicioDesejado(prePreenchido.inicio ?? null);
    setMostrarTodos(false);
    setModoEncaixe(false);
    setHoraEncaixe("");
    setObservacao("");
    setEnviarConfirmacao(true);
    setErros({});
    setErroGeral(null);
    setHouveConflito(false);
    setSalvando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // prePreenchido.contactId: seleciona direto, buscando nome e telefone.
  useEffect(() => {
    if (!aberto || !prePreenchido.contactId) {
      return;
    }
    let cancelado = false;
    supabase
      .from("contact")
      .select("id, name, phone_e164")
      .eq("clinic_id", clinicId)
      .eq("id", prePreenchido.contactId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado && data) {
          setPaciente({
            id: data.id,
            name: data.name ?? "Sem nome",
            phone: data.phone_e164,
          });
        }
      });
    return () => {
      cancelado = true;
    };
  }, [aberto, prePreenchido.contactId, supabase, clinicId]);

  // ----- catalogo derivado ----------------------------------------------
  const unidadesAtivas = useMemo(
    () => catalogo.unidades.filter((u) => u.active),
    [catalogo.unidades],
  );
  const conveniosAtivos = useMemo(
    () => catalogo.convenios.filter((c) => c.active),
    [catalogo.convenios],
  );
  const convenioAlvo = convenioId === PARTICULAR ? null : convenioId;

  const vinculosDoConvenio = useMemo(
    () =>
      catalogo.vinculos.filter(
        (v) => v.active && v.insurance_id === convenioAlvo,
      ),
    [catalogo.vinculos, convenioAlvo],
  );

  // Procedimentos: so os com vinculo ATIVO no convenio escolhido.
  const procedimentosDisponiveis = useMemo(() => {
    const comVinculo = new Set(vinculosDoConvenio.map((v) => v.procedure_id));
    return catalogo.procedimentos.filter(
      (p) => p.active && comVinculo.has(p.id),
    );
  }, [catalogo.procedimentos, vinculosDoConvenio]);

  // Profissionais: um vinculo ativo por opcao (o vinculo define preco,
  // duracao e o service_link_id que vai para o banco).
  const opcoesDeProfissional = useMemo(() => {
    if (!procedimentoId) {
      return [];
    }
    return vinculosDoConvenio
      .filter((v) => v.procedure_id === procedimentoId)
      .map((v) => ({
        vinculo: v,
        profissional: catalogo.profissionais.find(
          (p) => p.active && p.id === v.professional_id,
        ),
      }))
      .filter(
        (
          o,
        ): o is {
          vinculo: Vinculo;
          profissional: NonNullable<typeof o.profissional>;
        } => Boolean(o.profissional),
      )
      .sort((a, b) => a.profissional.name.localeCompare(b.profissional.name));
  }, [procedimentoId, vinculosDoConvenio, catalogo.profissionais]);

  const vinculo = useMemo(
    () => opcoesDeProfissional.find((o) => o.vinculo.id === vinculoId) ?? null,
    [opcoesDeProfissional, vinculoId],
  );
  const procedimento = useMemo(
    () => catalogo.procedimentos.find((p) => p.id === procedimentoId) ?? null,
    [catalogo.procedimentos, procedimentoId],
  );

  // Saneia escolhas que os selects anteriores invalidaram.
  useEffect(() => {
    if (
      procedimentoId &&
      !procedimentosDisponiveis.some((p) => p.id === procedimentoId)
    ) {
      setProcedimentoId(null);
      setVinculoId(null);
      setSlot(null);
    }
  }, [procedimentoId, procedimentosDisponiveis]);
  useEffect(() => {
    if (
      vinculoId &&
      !opcoesDeProfissional.some((o) => o.vinculo.id === vinculoId)
    ) {
      setVinculoId(null);
      setSlot(null);
    }
  }, [vinculoId, opcoesDeProfissional]);

  // prePreenchido.professionalId: pre-seleciona quando compativel.
  useEffect(() => {
    if (!aberto || vinculoId || !prePreenchido.professionalId) {
      return;
    }
    const compativel = opcoesDeProfissional.find(
      (o) => o.profissional.id === prePreenchido.professionalId,
    );
    if (compativel) {
      setVinculoId(compativel.vinculo.id);
    }
  }, [aberto, vinculoId, prePreenchido.professionalId, opcoesDeProfissional]);

  // ----- dados do dia escolhido -----------------------------------------
  // dadosDoDia so vale para a data da tela; outra data busca (cache comum).
  // Sem o dado da tela (a busca do dia falhou), busca de novo pela mesma
  // chave em vez de oferecer horario sobre um dia vazio (achado 83).
  const usaDadoDaTela = dataEscolhida === dia && dadosDoDia !== null;
  const outraDataQuery = useQuery({
    queryKey: agendaKeys.dia(clinicId, dataEscolhida),
    queryFn: () => fetchAgendaDia(supabase, clinicId, dataEscolhida, timezone),
    enabled: aberto && !usaDadoDaTela,
    staleTime: 30_000,
  });
  const dadosDaData: AgendaDia | null = usaDadoDaTela
    ? dadosDoDia
    : (outraDataQuery.data ?? null);
  const erroNoDia =
    !usaDadoDaTela &&
    !outraDataQuery.data &&
    outraDataQuery.isError &&
    !outraDataQuery.isFetching;
  const carregandoDia = !usaDadoDaTela && !outraDataQuery.data && !erroNoDia;

  // Faixas de jornada do profissional escolhido, SO da unidade escolhida
  // (ou sem unidade): a jornada de terca na Aldeota nao abre horario no
  // Centro (achados 40 e 90).
  const jornadaDoProfissional = useMemo(() => {
    if (!vinculo) {
      return [];
    }
    return catalogo.jornadas
      .filter(
        (j) =>
          j.professional_id === vinculo.profissional.id &&
          (unidadeId === null || j.unit_id === null || j.unit_id === unidadeId),
      )
      .map((j) => ({
        weekday: j.weekday,
        startsAt: j.starts_at,
        endsAt: j.ends_at,
      }));
  }, [vinculo, catalogo.jornadas, unidadeId]);
  // Sem jornada nenhuma (em unidade nenhuma) e diferente de sem jornada
  // neste dia: o primeiro caso so se resolve em Cadastros (achado 38).
  const semJornadaCadastrada = useMemo(
    () =>
      vinculo !== null &&
      !catalogo.jornadas.some(
        (j) => j.professional_id === vinculo.profissional.id,
      ),
    [vinculo, catalogo.jornadas],
  );
  const weekdayEscolhido = weekdayLocal(
    timezone,
    instanteLocal(timezone, dataEscolhida, "12:00"),
  );
  const semJornadaNoDia =
    vinculo !== null &&
    !semJornadaCadastrada &&
    !jornadaDoProfissional.some((j) => j.weekday === weekdayEscolhido);

  const entradaSlots: EntradaDisponibilidade | null = useMemo(() => {
    if (!vinculo || !dadosDaData) {
      return null;
    }
    const profId = vinculo.profissional.id;
    const agora = new Date();
    // Recurso exigido pelo procedimento: se houver, o motor precisa da
    // ocupacao dele por QUALQUER profissional, senao oferece um horario que
    // a exclusion constraint sem_sobreposicao_recurso recusaria (23P01).
    const recursoId = procedimento?.resource_id ?? null;
    const naoCancelada = (status: string) =>
      status !== "cancelado_paciente" && status !== "cancelado_clinica";
    return {
      timezone,
      rangeStart: instanteLocal(timezone, dataEscolhida, "00:00"),
      // Meia-noite do dia seguinte: '23:59' descartava o ultimo minuto e
      // perdia o slot que encosta na virada.
      rangeEnd: instanteLocal(timezone, somarDias(dataEscolhida, 1), "00:00"),
      durationMin: vinculo.vinculo.duration_min,
      schedule: jornadaDoProfissional,
      blocks: dadosDaData.bloqueios
        .filter((b) => b.professional_id === profId)
        .map((b) => ({
          startsAt: new Date(b.starts_at),
          endsAt: new Date(b.ends_at),
        })),
      appointments: dadosDaData.consultas
        .filter((c) => c.professional_id === profId && naoCancelada(c.status))
        .map((c) => ({
          startsAt: new Date(c.starts_at),
          endsAt: new Date(c.ends_at),
        })),
      holds: dadosDaData.holds
        .filter(
          (h) =>
            h.professional_id === profId &&
            new Date(h.expires_at).getTime() > agora.getTime(),
        )
        .map((h) => ({
          startsAt: new Date(h.starts_at),
          endsAt: new Date(h.ends_at),
        })),
      resourceBusy: recursoId
        ? dadosDaData.consultas
            .filter(
              (c) => c.resource_id === recursoId && naoCancelada(c.status),
            )
            .map((c) => ({
              startsAt: new Date(c.starts_at),
              endsAt: new Date(c.ends_at),
            }))
        : undefined,
      now: agora,
    };
  }, [
    vinculo,
    procedimento,
    dadosDaData,
    timezone,
    dataEscolhida,
    jornadaDoProfissional,
  ]);

  const primeirosSlots = useMemo(
    () => (entradaSlots ? firstAvailableSlots(entradaSlots, 3) : []),
    [entradaSlots],
  );
  const todosOsSlots = useMemo(
    () => (entradaSlots && mostrarTodos ? availableSlots(entradaSlots) : []),
    [entradaSlots, mostrarTodos],
  );

  // prePreenchido.inicio: pre-seleciona o slot mais proximo do clique no vao.
  useEffect(() => {
    if (!inicioDesejado || slot || !entradaSlots) {
      return;
    }
    const candidatos = availableSlots(entradaSlots);
    let melhor: SlotLivre | null = null;
    let menorDiff = Infinity;
    for (const c of candidatos) {
      const diff = Math.abs(c.startsAt.getTime() - inicioDesejado.getTime());
      if (diff < menorDiff) {
        menorDiff = diff;
        melhor = c;
      }
    }
    if (melhor && menorDiff <= entradaSlots.durationMin * 60_000) {
      setSlot(melhor);
      setInicioDesejado(null);
    }
  }, [inicioDesejado, slot, entradaSlots]);

  // Aviso de recurso ocupado (nao bloqueia: o recurso e aviso, o conflito de
  // profissional e constraint).
  const recursoOcupado = useMemo(() => {
    if (!procedimento?.resource_id || !slot || !dadosDaData || !vinculo) {
      return null;
    }
    const inicio = slot.startsAt.getTime();
    const fim = slot.startsAt.getTime() + vinculo.vinculo.duration_min * 60_000;
    const conflito = dadosDaData.consultas.some(
      (c: ConsultaDaAgenda) =>
        c.resource_id === procedimento.resource_id &&
        c.status !== "cancelado_paciente" &&
        c.status !== "cancelado_clinica" &&
        new Date(c.starts_at).getTime() < fim &&
        new Date(c.ends_at).getTime() > inicio,
    );
    if (!conflito) {
      return null;
    }
    return (
      catalogo.recursos.find((r) => r.id === procedimento.resource_id)?.name ??
      "necessário"
    );
  }, [procedimento, slot, dadosDaData, vinculo, catalogo.recursos]);

  // ----- encaixe proposital (achado 82) -----------------------------------
  // Hora livre no dia escolhido. Passa por cima de jornada, consulta e
  // bloqueio comum (com aviso), nunca de bloqueio que impede encaixe nem de
  // recurso ocupado: esses dois travam o botao (a Server Action e a exclusion
  // constraint do recurso recusam de novo).
  const inicioDoEncaixe = useMemo(
    () =>
      modoEncaixe && /^\d{2}:\d{2}$/.test(horaEncaixe)
        ? instanteLocal(timezone, dataEscolhida, horaEncaixe)
        : null,
    [modoEncaixe, horaEncaixe, timezone, dataEscolhida],
  );
  const conferenciaDoEncaixe = useMemo(() => {
    if (!inicioDoEncaixe || !vinculo || !dadosDaData) {
      return null;
    }
    const profId = vinculo.profissional.id;
    const recursoId = procedimento?.resource_id ?? null;
    const viva = (c: ConsultaDaAgenda) =>
      c.status !== "cancelado_paciente" && c.status !== "cancelado_clinica";
    const intervalo = (c: { starts_at: string; ends_at: string }) => ({
      startsAt: new Date(c.starts_at),
      endsAt: new Date(c.ends_at),
    });
    return conferirEncaixe({
      timezone,
      jornada: jornadaDoProfissional,
      inicio: inicioDoEncaixe,
      fim: new Date(
        inicioDoEncaixe.getTime() + vinculo.vinculo.duration_min * 60_000,
      ),
      bloqueios: dadosDaData.bloqueios
        .filter((b) => b.professional_id === profId)
        .map((b) => ({ ...intervalo(b), impedeEncaixe: b.blocks_overbooking })),
      consultas: dadosDaData.consultas
        .filter((c) => c.professional_id === profId && viva(c))
        .map(intervalo),
      recursoOcupado: recursoId
        ? dadosDaData.consultas
            .filter((c) => c.resource_id === recursoId && viva(c))
            .map(intervalo)
        : [],
      agora: new Date(),
    });
  }, [
    inicioDoEncaixe,
    vinculo,
    dadosDaData,
    procedimento,
    timezone,
    jornadaDoProfissional,
  ]);
  const encaixeTravado =
    conferenciaDoEncaixe !== null &&
    (conferenciaDoEncaixe.bloqueadoSemEncaixe ||
      conferenciaDoEncaixe.recursoOcupado);

  const horaLocal = useCallback(
    (d: Date) =>
      d.toLocaleTimeString("pt-BR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
    [timezone],
  );

  // ----- salvar ----------------------------------------------------------
  const salvar = async (comoEncaixe: boolean) => {
    const pendentes: Record<string, string> = {};
    if (!paciente) {
      pendentes.paciente = "Escolha o paciente ou crie o cadastro.";
    }
    if (!procedimentoId) {
      pendentes.procedimento = "Escolha o procedimento.";
    }
    if (!vinculo) {
      pendentes.profissional = "Escolha o profissional.";
    }
    // Encaixe proposital: a hora digitada. Senao, o horario livre escolhido
    // (e o "Marcar como encaixe" depois de um conflito reusa esse horario).
    const inicio = modoEncaixe ? inicioDoEncaixe : (slot?.startsAt ?? null);
    if (!inicio) {
      pendentes.horario = modoEncaixe
        ? "Informe a hora do encaixe."
        : "Escolha um horário livre.";
    }
    setErros(pendentes);
    if (
      Object.keys(pendentes).length > 0 ||
      !paciente ||
      !vinculo ||
      !inicio ||
      (modoEncaixe && encaixeTravado)
    ) {
      return;
    }
    const encaixe = comoEncaixe || modoEncaixe;
    setSalvando(true);
    setErroGeral(null);
    setHouveConflito(false);
    const fim = new Date(
      inicio.getTime() + vinculo.vinculo.duration_min * 60_000,
    );
    const resultado = await criarAgendamentoAction({
      contact_id: paciente.id,
      professional_id: vinculo.profissional.id,
      service_link_id: vinculo.vinculo.id,
      unit_id: unidadeId,
      resource_id: procedimento?.resource_id ?? null,
      starts_at: inicio.toISOString(),
      ends_at: fim.toISOString(),
      is_overbooking: encaixe,
      send_confirmation: enviarConfirmacao,
      notes: observacao.trim() === "" ? null : observacao.trim(),
    });
    setSalvando(false);
    if (resultado.ok) {
      toast.success(
        `Consulta marcada para ${horaLocal(inicio)} com ${vinculo.profissional.name}${encaixe ? ", como encaixe" : ""}.`,
      );
      void queryClient.invalidateQueries({
        queryKey: agendaKeys.dia(clinicId, dataEscolhida),
      });
      onFechar();
      return;
    }
    if (resultado.code === "conflito") {
      setHouveConflito(true);
      void queryClient.invalidateQueries({
        queryKey: agendaKeys.dia(clinicId, dataEscolhida),
      });
    }
    setErroGeral(resultado.error ?? "Não foi possível marcar a consulta.");
  };

  const usarProximoLivre = () => {
    if (!entradaSlots || !slot) {
      return;
    }
    const referencia = slot.startsAt.getTime();
    const candidatos = availableSlots({ ...entradaSlots, now: new Date() });
    const proximo =
      candidatos.find((c) => c.startsAt.getTime() > referencia) ??
      candidatos[0] ??
      null;
    setSlot(proximo);
    setHouveConflito(false);
    setErroGeral(
      proximo
        ? null
        : "Não há mais horários livres neste dia. Escolha outra data.",
    );
  };

  const temVinculoNaClinica = catalogo.vinculos.some((v) => v.active);

  const ligarEncaixe = (ligado: boolean) => {
    setModoEncaixe(ligado);
    setErros((e) => ({ ...e, horario: "" }));
    if (ligado && horaEncaixe === "") {
      // Aproveita o horario ja escolhido ou o do clique no vao.
      const referencia = slot?.startsAt ?? inicioDesejado;
      if (referencia) {
        setHoraEncaixe(horaLocal(referencia));
      }
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Nova consulta</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {/* 1. Paciente */}
          <BuscaPaciente
            clinicId={clinicId}
            paciente={paciente}
            onPaciente={(p) => {
              setPaciente(p);
              setErros((e) => ({ ...e, paciente: "" }));
            }}
            onLimpar={() => setPaciente(null)}
            erro={erros.paciente}
          />

          {/* 2. Unidade (so quando ha mais de uma ativa). Trocar de unidade
              troca as faixas de jornada: o horario escolhido cai. */}
          {unidadesAtivas.length > 1 ? (
            <CampoSelect
              id="unidade"
              rotulo="Unidade"
              valor={unidadeId ?? ""}
              placeholder="Escolha a unidade"
              onValor={(v) => {
                setUnidadeId(v);
                setSlot(null);
                setMostrarTodos(false);
              }}
              opcoes={unidadesAtivas.map((u) => ({
                valor: u.id,
                rotulo: u.name,
              }))}
            />
          ) : null}

          {/* 3. Convenio */}
          <CampoSelect
            id="convenio"
            rotulo="Convênio"
            valor={convenioId}
            placeholder="Escolha o convênio"
            onValor={(v) => {
              setConvenioId(v);
              setSlot(null);
            }}
            opcoes={[
              { valor: PARTICULAR, rotulo: "Particular" },
              ...conveniosAtivos.map((c) => ({
                valor: c.id,
                rotulo: c.plan_name ? `${c.name} · ${c.plan_name}` : c.name,
              })),
            ]}
          />

          {/* 4. Procedimento */}
          <div className="grid gap-1.5">
            <CampoSelect
              id="procedimento"
              rotulo="Procedimento"
              valor={procedimentoId ?? ""}
              placeholder={
                !temVinculoNaClinica
                  ? "Nenhum vínculo cadastrado ainda"
                  : procedimentosDisponiveis.length === 0
                    ? "Nenhum procedimento atendido neste convênio"
                    : "Escolha o procedimento"
              }
              desabilitado={procedimentosDisponiveis.length === 0}
              onValor={(v) => {
                setProcedimentoId(v);
                setVinculoId(null);
                setSlot(null);
                setErros((e) => ({ ...e, procedimento: "" }));
              }}
              opcoes={procedimentosDisponiveis.map((p) => ({
                valor: p.id,
                rotulo: p.name,
              }))}
            />
            {!temVinculoNaClinica ? (
              // Clinica nova: sem vinculo, nao ha procedimento para escolher
              // em convenio nenhum. O caminho e Cadastros (achado 38).
              <Aviso
                tom="warning"
                acao={
                  <AtalhoParaCadastros
                    contexto={contexto}
                    aba="vinculos"
                    rotulo="Cadastrar vínculos"
                  />
                }
              >
                A clínica ainda não tem vínculos: quem faz qual procedimento,
                por qual convênio e por qual preço. Sem eles a agenda não
                oferece procedimento.
              </Aviso>
            ) : null}
            <ErroDeCampo mensagem={erros.procedimento} />
          </div>

          {/* 5. Profissional (a opcao carrega preco e duracao do vinculo) */}
          <div className="grid gap-1.5">
            <CampoSelect
              id="profissional"
              rotulo="Profissional"
              valor={vinculoId ?? ""}
              placeholder={
                !procedimentoId
                  ? "Escolha o procedimento primeiro"
                  : opcoesDeProfissional.length === 0
                    ? "Ninguém atende este procedimento neste convênio"
                    : "Escolha o profissional"
              }
              desabilitado={
                !procedimentoId || opcoesDeProfissional.length === 0
              }
              onValor={(v) => {
                setVinculoId(v);
                setSlot(null);
                setErros((e) => ({ ...e, profissional: "" }));
              }}
              opcoes={opcoesDeProfissional.map((o) => {
                const preco = exibirPrecoVinculo(o.vinculo);
                const partes = [o.profissional.name];
                if (preco.text !== "") {
                  partes.push(preco.text);
                }
                partes.push(`${o.vinculo.duration_min} min`);
                return { valor: o.vinculo.id, rotulo: partes.join(" · ") };
              })}
            />
            <ErroDeCampo mensagem={erros.profissional} />
          </div>

          {/* 6. Data e horario, com a chave do encaixe proposital */}
          <div className="grid gap-2">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="grid gap-1.5">
                <Label htmlFor="data-consulta">Data e horário</Label>
                <Input
                  id="data-consulta"
                  type="date"
                  className="w-fit cz-num"
                  value={dataEscolhida}
                  onChange={(e) => {
                    if (e.target.value) {
                      setDataEscolhida(e.target.value);
                      setSlot(null);
                      setMostrarTodos(false);
                    }
                  }}
                />
              </div>
              <ChaveDoEncaixe
                podeEditar={contexto.podeEditar}
                dica={contexto.dica}
                ligada={modoEncaixe}
                aoMudar={ligarEncaixe}
              />
            </div>
            {modoEncaixe ? (
              <HoraDoEncaixe
                vinculoEscolhido={Boolean(vinculo)}
                carregando={carregandoDia}
                erroDia={erroNoDia}
                onTentarDeNovo={() => void outraDataQuery.refetch()}
                hora={horaEncaixe}
                onHora={(h) => {
                  setHoraEncaixe(h);
                  setErros((e) => ({ ...e, horario: "" }));
                }}
                conferencia={conferenciaDoEncaixe}
                nomeDoProfissional={vinculo?.profissional.name ?? ""}
                nomeDoRecurso={
                  catalogo.recursos.find(
                    (r) => r.id === procedimento?.resource_id,
                  )?.name ?? null
                }
              />
            ) : (
              <SelecaoDeHorario
                vinculoEscolhido={Boolean(vinculo)}
                carregando={carregandoDia}
                erroDia={
                  erroNoDia
                    ? "Não foi possível carregar os horários deste dia."
                    : null
                }
                onTentarDeNovo={() => void outraDataQuery.refetch()}
                primeiros={primeirosSlots}
                todos={todosOsSlots}
                mostrarTodos={mostrarTodos}
                onMostrarTodos={() => setMostrarTodos(true)}
                slot={slot}
                onSlot={(s) => {
                  setSlot(s);
                  setErros((e) => ({ ...e, horario: "" }));
                }}
                horaLocal={horaLocal}
                semJornada={
                  semJornadaCadastrada ? (
                    <Aviso
                      tom="warning"
                      acao={
                        <AtalhoParaCadastros
                          contexto={contexto}
                          aba="profissionais"
                          rotulo="Cadastrar jornada"
                        />
                      }
                    >
                      {vinculo?.profissional.name} ainda não tem jornada
                      cadastrada. Sem ela, a agenda não abre horários. Para
                      marcar mesmo assim, use o encaixe.
                    </Aviso>
                  ) : semJornadaNoDia ? (
                    <p className="text-sm text-text-secondary">
                      {vinculo?.profissional.name} não atende neste dia da
                      semana
                      {unidadeId && unidadesAtivas.length > 1
                        ? " nesta unidade"
                        : ""}
                      . Escolha outra data ou use o encaixe.
                    </p>
                  ) : null
                }
              />
            )}
            <ErroDeCampo mensagem={erros.horario} />
          </div>

          {/* 7. Aviso de recurso ocupado */}
          {recursoOcupado && !modoEncaixe ? (
            <Aviso tom="warning">
              O recurso {recursoOcupado} estará ocupado neste horário.
            </Aviso>
          ) : null}

          {/* 8. Observacao */}
          <div className="grid gap-1.5">
            <Label htmlFor="observacao">Observação (opcional)</Label>
            <Textarea
              id="observacao"
              rows={2}
              maxLength={2000}
              placeholder="Algo que a recepção precisa saber"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          {/* 9. Confirmacao automatica, com a autorizacao do paciente: o
              texto so promete o que acontece (achados 50, 57 e 88). */}
          <div className="grid gap-3 rounded-xl border border-border px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <Label htmlFor="enviar-confirmacao" className="cursor-pointer">
                  Enviar confirmação automática
                </Label>
                <p className="text-xs text-text-secondary">
                  Com a régua de confirmação ligada, as mensagens desta consulta
                  saem nos horários configurados, só para quem autorizou receber
                  mensagens no WhatsApp. Desligar aqui pula só esta consulta.
                </p>
              </div>
              <Switch
                id="enviar-confirmacao"
                checked={enviarConfirmacao}
                onCheckedChange={setEnviarConfirmacao}
              />
            </div>
            {paciente ? (
              <AutorizacaoDoPaciente
                key={paciente.id}
                contexto={contexto}
                pacienteId={paciente.id}
                pacienteNome={paciente.name}
              />
            ) : null}
          </div>

          {/* Erro geral (conflito inclusive) */}
          {erroGeral ? (
            <div className="grid gap-2">
              <Aviso tom="alert" role="alert">
                {erroGeral}
              </Aviso>
              {houveConflito ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={usarProximoLivre}
                  >
                    Usar o próximo horário livre
                  </Button>
                  {contexto.podeEditar ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={salvando}
                      onClick={() => void salvar(true)}
                    >
                      Marcar como encaixe
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          {salvando ? (
            <Button disabled className="min-w-32">
              <Loader2 className="animate-spin" aria-hidden />
              Marcando...
            </Button>
          ) : (
            <BotaoProtegido
              podeEditar={contexto.podeEditar}
              dica={contexto.dica}
              disabled={modoEncaixe && encaixeTravado}
              onClick={() => void salvar(false)}
            >
              Marcar consulta
            </BotaoProtegido>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function ErroDeCampo({ mensagem }: { mensagem?: string }) {
  if (!mensagem) {
    return null;
  }
  return <p className="text-[13px] font-medium text-alert-text">{mensagem}</p>;
}

/**
 * Atalho para Cadastros quando falta jornada ou vinculo (achado 38). Quem nao
 * cadastra (recepcao, profissional, leitura) ve o atalho desabilitado, com a
 * dica: esconder deixaria a clinica sem saber o que falta.
 */
function AtalhoParaCadastros({
  contexto,
  aba,
  rotulo,
}: {
  contexto: ContextoAgenda;
  aba: "profissionais" | "vinculos";
  rotulo: string;
}) {
  if (contexto.podeEditarCadastros) {
    return (
      <Button asChild variant="outline">
        <Link href={`/cadastros?aba=${aba}`}>{rotulo}</Link>
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={contexto.dicaCadastros}>
      <Button variant="outline" disabled>
        {rotulo}
      </Button>
    </DisabledWithHint>
  );
}

/** Chave do encaixe proposital: visivel sempre, desabilitada sem permissao. */
function ChaveDoEncaixe({
  podeEditar,
  dica,
  ligada,
  aoMudar,
}: {
  podeEditar: boolean;
  dica: string;
  ligada: boolean;
  aoMudar: (ligada: boolean) => void;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5">
      {podeEditar ? (
        <Switch
          id="marcar-encaixe"
          checked={ligada}
          onCheckedChange={aoMudar}
        />
      ) : (
        <DisabledWithHint hint={dica}>
          <Switch id="marcar-encaixe" checked={false} disabled />
        </DisabledWithHint>
      )}
      <Label
        htmlFor="marcar-encaixe"
        className="inline-flex items-center gap-1.5"
      >
        <Zap className="size-3.5 text-neutral-text" aria-hidden />
        Marcar como encaixe
      </Label>
    </div>
  );
}

/**
 * Hora livre do encaixe, com o que ela atravessa em texto: bloqueio que
 * impede encaixe e recurso ocupado travam (alerta); fora da jornada, em cima
 * de consulta ou de bloqueio comum e horario vencido so avisam (atencao).
 */
function HoraDoEncaixe({
  vinculoEscolhido,
  carregando,
  erroDia,
  onTentarDeNovo,
  hora,
  onHora,
  conferencia,
  nomeDoProfissional,
  nomeDoRecurso,
}: {
  vinculoEscolhido: boolean;
  carregando: boolean;
  erroDia: boolean;
  onTentarDeNovo: () => void;
  hora: string;
  onHora: (hora: string) => void;
  conferencia: ConferenciaDeEncaixe | null;
  nomeDoProfissional: string;
  nomeDoRecurso: string | null;
}) {
  if (!vinculoEscolhido) {
    return (
      <p className="text-sm text-text-secondary">
        Escolha o profissional para marcar o encaixe.
      </p>
    );
  }
  if (erroDia) {
    return (
      <Aviso
        tom="alert"
        role="alert"
        acao={
          <Button type="button" variant="outline" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        }
      >
        Não foi possível carregar a agenda deste dia para conferir o encaixe.
      </Aviso>
    );
  }

  const atencoes: string[] = [];
  if (conferencia?.foraDaJornada) {
    atencoes.push(`Fora da jornada de ${nomeDoProfissional}.`);
  }
  if (conferencia?.sobreConsulta) {
    atencoes.push(
      `Em cima de outra consulta de ${nomeDoProfissional}: as duas ficam no mesmo horário.`,
    );
  }
  if (conferencia?.sobreBloqueio) {
    atencoes.push("Em cima de um bloqueio que permite encaixe.");
  }
  if (conferencia?.noPassado) {
    atencoes.push("Este horário já passou.");
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="hora-encaixe">Hora do encaixe</Label>
          <Input
            id="hora-encaixe"
            type="time"
            className="w-fit cz-num"
            value={hora}
            onChange={(e) => onHora(e.target.value)}
          />
        </div>
        <span className="flex min-h-10 items-center">
          <StatusChip definition={ENCAIXE} />
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        O encaixe pode ficar em cima de outra consulta ou fora da jornada. Só
        não passa por bloqueio sem encaixe nem por sala ou equipamento ocupado.
      </p>
      {carregando ? (
        <Skeleton className="h-11 w-full" aria-label="Conferindo o horário" />
      ) : null}
      {conferencia?.bloqueadoSemEncaixe ? (
        <Aviso tom="alert" role="alert">
          Este período está bloqueado sem permissão de encaixe. Escolha outra
          hora.
        </Aviso>
      ) : null}
      {conferencia?.recursoOcupado ? (
        <Aviso tom="alert" role="alert">
          {nomeDoRecurso ? `O recurso ${nomeDoRecurso}` : "O recurso"} está
          ocupado neste horário. Encaixe não resolve conflito de sala ou
          equipamento.
        </Aviso>
      ) : null}
      {atencoes.length > 0 ? (
        <Aviso tom="warning">
          <ul className="grid gap-0.5">
            {atencoes.map((texto) => (
              <li key={texto}>{texto}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}
    </div>
  );
}

/**
 * Autorizacao do paciente escolhido para receber mensagens, nas 3 camadas do
 * CONSENT_STATUS (achados 50, 57 e 88). Sem autorizacao, diz que a
 * confirmacao automatica nao vai sair e oferece o registro ali mesmo (mesma
 * acao da ficha, origem recepcao, com evidencia). Carregando ou com erro,
 * nunca aparece como "sem autorizacao".
 */
function AutorizacaoDoPaciente({
  contexto,
  pacienteId,
  pacienteNome,
}: {
  contexto: ContextoAgenda;
  pacienteId: string;
  pacienteNome: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [registrando, setRegistrando] = useState(false);
  const consentimentoQuery = useQuery({
    queryKey: agendaKeys.consentimento(contexto.clinicId, pacienteId),
    queryFn: () =>
      fetchConsentimentoDoContato(supabase, contexto.clinicId, pacienteId),
    staleTime: 30_000,
  });

  if (consentimentoQuery.isPending) {
    return (
      <Skeleton className="h-6 w-60" aria-label="Conferindo a autorização" />
    );
  }
  if (consentimentoQuery.isError) {
    return (
      <Aviso
        tom="alert"
        acao={
          <Button
            type="button"
            variant="outline"
            onClick={() => void consentimentoQuery.refetch()}
          >
            Tentar de novo
          </Button>
        }
      >
        Não foi possível conferir a autorização para receber mensagens.
      </Aviso>
    );
  }

  const situacao = consentimentoQuery.data;
  if (situacao === "autorizado") {
    return (
      <span className="flex">
        <StatusChip size="sm" definition={CONSENT_STATUS.autorizado} />
      </span>
    );
  }

  const revogado = situacao === "revogado";
  const rotuloDoRegistro = revogado
    ? "Registrar nova autorização"
    : "Registrar autorização";
  // A permissao e a de leads e pacientes, nunca a da agenda (achado L13).
  const podeRegistrar = contexto.podeRegistrarAutorizacao;
  return (
    <div className="grid gap-2">
      <span className="flex">
        <StatusChip size="sm" definition={CONSENT_STATUS[situacao]} />
      </span>
      <p className="text-[13px] text-foreground">
        A confirmação automática não vai sair para este paciente.
        {revogado
          ? " Ele pediu para não receber mensagens: só registre de novo se ele autorizou outra vez."
          : " Se ele autorizou receber mensagens, registre aqui."}
      </p>
      <div className="flex flex-wrap gap-2">
        {podeRegistrar ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRegistrando(true)}
          >
            {rotuloDoRegistro}
          </Button>
        ) : (
          <DisabledWithHint hint={contexto.dicaAutorizacao}>
            <Button type="button" variant="outline" disabled>
              {rotuloDoRegistro}
            </Button>
          </DisabledWithHint>
        )}
      </div>
      {registrando ? (
        <DialogoDeAutorizacao
          contexto={contexto}
          pacienteId={pacienteId}
          pacienteNome={pacienteNome}
          revogado={revogado}
          onFechar={() => setRegistrando(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Registro da autorizacao a partir do modal: a mesma Server Action da ficha
 * (concederConsentimentoAction), com origem recepcao e evidencia obrigatoria
 * (quem marca por telefone precisa dizer quando e como o paciente autorizou).
 * Depois de revogada, a action e o gatilho do banco exigem a evidencia de
 * novo.
 */
function DialogoDeAutorizacao({
  contexto,
  pacienteId,
  pacienteNome,
  revogado,
  onFechar,
}: {
  contexto: ContextoAgenda;
  pacienteId: string;
  pacienteNome: string;
  revogado: boolean;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [evidencia, setEvidencia] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const evidenciaValida = evidencia.trim().length >= 2;

  const registrar = async () => {
    if (!evidenciaValida) {
      setErro("Descreva quando e como o paciente autorizou.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await concederConsentimentoAction({
      contact_id: pacienteId,
      source: "recepcao",
      evidence: evidencia.trim(),
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível registrar a autorização.");
      return;
    }
    toast.success("Autorização registrada");
    await queryClient.invalidateQueries({
      queryKey: agendaKeys.consentimento(contexto.clinicId, pacienteId),
    });
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {revogado ? "Registrar nova autorização" : "Registrar autorização"}
          </DialogTitle>
          <DialogDescription>
            {revogado
              ? `${pacienteNome} pediu para não receber mensagens. Só registre se autorizou de novo, e descreva como.`
              : `Registre como ${pacienteNome} autorizou a clínica a mandar mensagem no WhatsApp.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
            <span className="text-text-secondary">Como autorizou</span>
            <span className="text-foreground">Recepção</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="autorizacao-evidencia">Evidência</Label>
            <Input
              id="autorizacao-evidencia"
              value={evidencia}
              maxLength={500}
              autoFocus
              placeholder="Ex.: autorizou por telefone ao marcar a consulta"
              onChange={(e) => setEvidencia(e.target.value)}
            />
            <p className="text-[11px] text-text-secondary">
              Obrigatória: quando e como a autorização foi dada.
            </p>
          </div>
          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            type="button"
            disabled={salvando || !evidenciaValida}
            onClick={() => void registrar()}
          >
            {salvando ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampoSelect({
  id,
  rotulo,
  valor,
  placeholder,
  desabilitado,
  onValor,
  opcoes,
}: {
  id: string;
  rotulo: string;
  valor: string;
  placeholder: string;
  desabilitado?: boolean;
  onValor: (valor: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Select
        value={valor === "" ? undefined : valor}
        onValueChange={onValor}
        disabled={desabilitado}
      >
        <SelectTrigger id={id} className="h-10 w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Combobox de paciente: busca com debounce + criacao rapida inline. */
function BuscaPaciente({
  clinicId,
  paciente,
  onPaciente,
  onLimpar,
  erro,
}: {
  clinicId: string;
  paciente: PacienteSelecionado | null;
  onPaciente: (paciente: PacienteSelecionado) => void;
  onLimpar: () => void;
  erro?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  // Criacao rapida que caiu num cadastro existente: o aviso fica sob o
  // paciente escolhido enquanto ele for esse cadastro.
  const [avisoDeCadastro, setAvisoDeCadastro] = useState<{
    id: string;
    texto: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce de 300ms na busca por nome ou telefone. Telefone completo casa
  // pela CHAVE (phone_key), com ou sem o nono digito e em qualquer formato
  // ("(84) 99999-0000" acha o contato que o WhatsApp gravou sem o 9);
  // pedaco de numero procura pelos digitos; o resto e nome.
  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(() => {
      const telefone = normalizarTelefone(limpo);
      const digitos = limpo.replace(/\D/g, "");
      const pareceTelefone = /^[\d\s()+.-]+$/.test(limpo);
      let consulta = supabase
        .from("contact")
        .select("id, name, phone_e164")
        .eq("clinic_id", clinicId);
      if (telefone) {
        consulta = consulta.eq("phone_key", chaveDeTelefone(telefone));
      } else if (pareceTelefone && digitos.length >= 4) {
        // Pedaco de numero pela CHAVE, que sempre tem o nono digito (achado
        // L15): "99999-0000" acha quem o WhatsApp gravou como
        // +558599990000, e a tela mostra o numero com o 9. O texto gravado
        // segue valendo para pedaco sem o 9 que atravessa o DDD ("858765").
        // `digitos` so tem digitos: seguro dentro do or.
        consulta = consulta.or(
          `phone_key.ilike.%${digitos}%,phone_e164.ilike.%${digitos}%`,
        );
      } else {
        consulta = consulta.ilike("name", `%${limpo.replace(/[%_,()]/g, "")}%`);
      }
      void consulta.limit(8).then(({ data }) => {
        setResultados((data ?? []) as ResultadoBusca[]);
        setBuscando(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [termo, supabase, clinicId]);

  const confirmarCriacao = async () => {
    setErroCriacao(null);
    if (novoNome.trim().length < 2) {
      setErroCriacao("Informe o nome do paciente.");
      return;
    }
    // A MESMA normalizacao do servidor, so para dizer o erro antes. O texto
    // vai como foi digitado ou colado: quem decide e o servidor (achado 87,
    // antes o "+" era arrancado aqui e o numero virava +5555...).
    const normalizado = normalizarTelefone(novoTelefone);
    if (!normalizado) {
      setErroCriacao(MENSAGEM_TELEFONE_INVALIDO);
      return;
    }
    setSalvandoNovo(true);
    const resultado = await criarPacienteRapidoAction({
      name: novoNome.trim(),
      phone: novoTelefone.trim(),
    });
    setSalvandoNovo(false);
    if (!resultado.ok || !resultado.id) {
      setErroCriacao(resultado.error ?? "Não foi possível criar o cadastro.");
      return;
    }
    if (resultado.existente) {
      // O telefone ja tinha cadastro (casado pela chave, com ou sem o nono
      // digito): a consulta fica NELE. Mostra o nome e o telefone do cadastro,
      // nunca os digitados, e diz isso a recepcao (achado R6).
      const nomeDoCadastro = resultado.nome?.trim()
        ? resultado.nome.trim()
        : null;
      setAvisoDeCadastro({
        id: resultado.id,
        texto: nomeDoCadastro
          ? `Este telefone já é do cadastro de ${nomeDoCadastro}. A consulta fica nesse cadastro.`
          : "Este telefone já é de um cadastro sem nome. A consulta fica nesse cadastro.",
      });
      onPaciente({
        id: resultado.id,
        name: nomeDoCadastro ?? "Cadastro sem nome",
        phone: resultado.telefone ?? normalizado,
      });
    } else {
      setAvisoDeCadastro(null);
      onPaciente({
        id: resultado.id,
        name: novoNome.trim(),
        phone: normalizado,
      });
    }
    setCriando(false);
    setTermo("");
    setResultados([]);
  };

  if (paciente) {
    return (
      <div className="grid gap-1.5">
        <Label>Paciente</Label>
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border-strong bg-card pl-3 shadow-xs">
          <span className="min-w-0 truncate text-sm font-semibold text-text-strong">
            {paciente.name}
            <span className="ml-2 cz-num text-xs font-normal text-text-secondary">
              {formatarTelefone(paciente.phone)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTermo("");
              setCriando(false);
              setAvisoDeCadastro(null);
              onLimpar();
            }}
          >
            Trocar
          </Button>
        </div>
        {avisoDeCadastro && avisoDeCadastro.id === paciente.id ? (
          <Aviso tom="warning">
            {avisoDeCadastro.texto} Se for outra pessoa, use Trocar e informe o
            telefone dela.
          </Aviso>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="busca-paciente">Paciente</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <Input
          id="busca-paciente"
          ref={inputRef}
          autoFocus
          autoComplete="off"
          className="h-10 pl-9"
          placeholder="Nome ou telefone do paciente"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setCriando(false);
          }}
        />
      </div>

      {termo.trim().length >= 2 && !criando ? (
        <div className="overflow-hidden rounded-xl border border-border-strong bg-card shadow-xs">
          {buscando ? (
            <div className="grid gap-1.5 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <ul className="cz-scroll max-h-56 overflow-y-auto">
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm outline-none cz-transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                    onClick={() =>
                      onPaciente({
                        id: r.id,
                        name: r.name ?? "Sem nome",
                        phone: r.phone_e164,
                      })
                    }
                  >
                    <span className="min-w-0 truncate font-semibold text-text-strong">
                      {r.name ?? "Sem nome"}
                    </span>
                    <span className="shrink-0 cz-num text-xs text-text-secondary">
                      {formatarTelefone(r.phone_e164)}
                    </span>
                  </button>
                </li>
              ))}
              {resultados.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-text-secondary">
                  Nenhum paciente com esse nome ou telefone.
                </li>
              ) : null}
            </ul>
          )}
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2 border-t border-border px-3 text-left text-sm font-semibold text-text-strong outline-none cz-transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            onClick={() => {
              setCriando(true);
              // Digitou um telefone: ele vai para o campo de telefone, nao
              // para o nome.
              const digitado = termo.trim();
              if (normalizarTelefone(digitado)) {
                setNovoNome("");
                setNovoTelefone(digitado);
              } else {
                setNovoNome(digitado);
                setNovoTelefone("");
              }
              setErroCriacao(null);
            }}
          >
            <UserPlus className="size-4" aria-hidden />
            Criar cadastro para {termo.trim()}
          </button>
        </div>
      ) : null}

      {criando ? (
        <div className="grid gap-3 rounded-xl bg-surface-4 p-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor="novo-nome">Nome</Label>
            <Input
              id="novo-nome"
              autoFocus
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="novo-telefone">Telefone com DDD</Label>
            <Input
              id="novo-telefone"
              className="cz-num"
              inputMode="tel"
              placeholder="(85) 99999-0000"
              value={novoTelefone}
              onChange={(e) => setNovoTelefone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmarCriacao();
                }
              }}
            />
          </div>
          {erroCriacao ? (
            <Aviso tom="alert" role="alert">
              {erroCriacao}
            </Aviso>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="solid"
              disabled={salvandoNovo}
              onClick={() => void confirmarCriacao()}
            >
              {salvandoNovo ? "Criando..." : "Confirmar cadastro"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCriando(false)}
            >
              Voltar para a busca
            </Button>
          </div>
        </div>
      ) : null}

      <ErroDeCampo mensagem={erro} />
    </div>
  );
}

/** Os 3 primeiros horarios em botoes grandes + grade completa sob demanda. */
function SelecaoDeHorario({
  vinculoEscolhido,
  carregando,
  erroDia,
  onTentarDeNovo,
  primeiros,
  todos,
  mostrarTodos,
  onMostrarTodos,
  slot,
  onSlot,
  horaLocal,
  semJornada,
}: {
  vinculoEscolhido: boolean;
  carregando: boolean;
  erroDia: string | null;
  onTentarDeNovo: () => void;
  primeiros: SlotLivre[];
  todos: SlotLivre[];
  mostrarTodos: boolean;
  onMostrarTodos: () => void;
  slot: SlotLivre | null;
  onSlot: (slot: SlotLivre) => void;
  horaLocal: (d: Date) => string;
  /**
   * Profissional sem jornada cadastrada ou sem jornada neste dia (achado
   * 38): a mensagem certa no lugar do generico "nenhum horario livre".
   */
  semJornada?: React.ReactNode;
}) {
  if (!vinculoEscolhido) {
    return (
      <p className="text-sm text-text-secondary">
        Escolha o profissional para ver os horários livres.
      </p>
    );
  }
  if (semJornada) {
    return <>{semJornada}</>;
  }
  if (erroDia) {
    return (
      <Aviso
        tom="alert"
        role="alert"
        acao={
          <Button type="button" variant="outline" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        }
      >
        {erroDia}
      </Aviso>
    );
  }
  if (carregando) {
    return (
      <div className="flex gap-2">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-24" />
      </div>
    );
  }
  if (primeiros.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Nenhum horário livre neste dia. Escolha outra data ou use o encaixe.
      </p>
    );
  }

  const selecionado = (s: SlotLivre) =>
    slot !== null && s.startsAt.getTime() === slot.startsAt.getTime();

  // Receita "Escolha em chip" (docs/06 secao 4.7): selecionado em lime suave
  // com borda e o Check, nunca o lime cheio (o lime da tela e o "Marcar
  // consulta"). O nome acessivel continua so a hora ("08:30").
  const classeDoChip = (s: SlotLivre) =>
    selecionado(s)
      ? "border-primary-edge bg-primary-soft text-primary-text hover:bg-primary-soft-hover"
      : "";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {primeiros.map((s) => (
          <Button
            key={s.startsAt.toISOString()}
            type="button"
            variant="outline"
            className={cn(
              "h-11 min-w-24 cz-num text-base font-semibold",
              classeDoChip(s),
            )}
            aria-pressed={selecionado(s)}
            onClick={() => onSlot(s)}
          >
            {selecionado(s) ? <Check className="size-3.5" aria-hidden /> : null}
            {horaLocal(s.startsAt)}
          </Button>
        ))}
        {!mostrarTodos ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={onMostrarTodos}
          >
            Escolher outro
          </Button>
        ) : null}
      </div>
      {mostrarTodos ? (
        <div className="grid cz-scroll max-h-48 grid-cols-3 gap-1.5 overflow-y-auto rounded-xl bg-surface-4 p-2 sm:grid-cols-6">
          {todos.map((s) => (
            <Button
              key={s.startsAt.toISOString()}
              type="button"
              variant="outline"
              className={cn("cz-num font-semibold", classeDoChip(s))}
              aria-pressed={selecionado(s)}
              onClick={() => onSlot(s)}
            >
              {selecionado(s) ? (
                <Check className="size-3.5" aria-hidden />
              ) : null}
              {horaLocal(s.startsAt)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
