"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, TriangleAlert, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  criarAgendamentoAction,
  criarPacienteRapidoAction,
} from "@/app/(app)/agenda/actions";
import { BotaoProtegido } from "@/components/cadastros/comum";
import type {
  ContextoAgenda,
  FiltrosAgenda,
  PrePreenchido,
} from "@/components/agenda/tipos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { diaCivil, instanteLocal } from "@/lib/domain/horarios";
import { exibirPrecoVinculo } from "@/lib/domain/pricing";
import {
  availableSlots,
  firstAvailableSlots,
  type EntradaDisponibilidade,
  type SlotLivre,
} from "@/lib/domain/scheduling";
import {
  agendaKeys,
  fetchAgendaDia,
  type AgendaDia,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";
import type { Vinculo } from "@/lib/queries/catalogo";
import { createClient } from "@/lib/supabase/client";

// Modal de novo agendamento (tarefa 2.6): a acao mais repetida do dia da
// recepcao. UMA tela, ordem fixa de campos, aceite de 20 segundos. O motor
// de horarios e o availableSlots puro; o conflito real quem decide e a
// exclusion constraint do banco (o modal so reage ao code "conflito").

const PARTICULAR = "particular";

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
  dadosDoDia: AgendaDia;
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
  const [observacao, setObservacao] = useState("");
  const [enviarConfirmacao, setEnviarConfirmacao] = useState(true);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [houveConflito, setHouveConflito] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Reset completo a cada abertura, ja com o pre-preenchido do clique no vao.
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
    setConvenioId(filtros.convenioId ?? PARTICULAR);
    setProcedimentoId(filtros.procedimentoId ?? null);
    setVinculoId(null);
    setDataEscolhida(
      prePreenchido.inicio ? diaCivil(timezone, prePreenchido.inicio) : dia,
    );
    setSlot(null);
    setInicioDesejado(prePreenchido.inicio ?? null);
    setMostrarTodos(false);
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
  const outraDataQuery = useQuery({
    queryKey: agendaKeys.dia(clinicId, dataEscolhida),
    queryFn: () => fetchAgendaDia(supabase, clinicId, dataEscolhida, timezone),
    enabled: aberto && dataEscolhida !== dia,
    staleTime: 30_000,
  });
  const dadosDaData: AgendaDia | null =
    dataEscolhida === dia ? dadosDoDia : (outraDataQuery.data ?? null);
  const carregandoDia = dataEscolhida !== dia && outraDataQuery.isPending;

  const entradaSlots: EntradaDisponibilidade | null = useMemo(() => {
    if (!vinculo || !dadosDaData) {
      return null;
    }
    const profId = vinculo.profissional.id;
    const agora = new Date();
    return {
      timezone,
      rangeStart: instanteLocal(timezone, dataEscolhida, "00:00"),
      rangeEnd: instanteLocal(timezone, dataEscolhida, "23:59"),
      durationMin: vinculo.vinculo.duration_min,
      schedule: catalogo.jornadas
        .filter((j) => j.professional_id === profId)
        .map((j) => ({
          weekday: j.weekday,
          startsAt: j.starts_at,
          endsAt: j.ends_at,
        })),
      blocks: dadosDaData.bloqueios
        .filter((b) => b.professional_id === profId)
        .map((b) => ({
          startsAt: new Date(b.starts_at),
          endsAt: new Date(b.ends_at),
        })),
      appointments: dadosDaData.consultas
        .filter(
          (c) =>
            c.professional_id === profId &&
            c.status !== "cancelado_paciente" &&
            c.status !== "cancelado_clinica",
        )
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
      now: agora,
    };
  }, [vinculo, dadosDaData, timezone, dataEscolhida, catalogo.jornadas]);

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
    if (!slot) {
      pendentes.horario = "Escolha um horário livre.";
    }
    setErros(pendentes);
    if (Object.keys(pendentes).length > 0 || !paciente || !vinculo || !slot) {
      return;
    }
    setSalvando(true);
    setErroGeral(null);
    setHouveConflito(false);
    const inicio = slot.startsAt;
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
      is_overbooking: comoEncaixe,
      send_confirmation: enviarConfirmacao,
      notes: observacao.trim() === "" ? null : observacao.trim(),
    });
    setSalvando(false);
    if (resultado.ok) {
      toast.success(
        `Consulta marcada para ${horaLocal(inicio)} com ${vinculo.profissional.name}.`,
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

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
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

          {/* 2. Unidade (so quando ha mais de uma ativa) */}
          {unidadesAtivas.length > 1 ? (
            <CampoSelect
              id="unidade"
              rotulo="Unidade"
              valor={unidadeId ?? ""}
              placeholder="Escolha a unidade"
              onValor={(v) => setUnidadeId(v)}
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
                procedimentosDisponiveis.length === 0
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

          {/* 6. Data e horario */}
          <div className="grid gap-1.5">
            <Label htmlFor="data-consulta">Data e horário</Label>
            <Input
              id="data-consulta"
              type="date"
              className="h-10 w-fit"
              value={dataEscolhida}
              onChange={(e) => {
                if (e.target.value) {
                  setDataEscolhida(e.target.value);
                  setSlot(null);
                  setMostrarTodos(false);
                }
              }}
            />
            <SelecaoDeHorario
              vinculoEscolhido={Boolean(vinculo)}
              carregando={carregandoDia}
              erroDia={
                dataEscolhida !== dia && outraDataQuery.isError
                  ? "Não foi possível carregar os horários deste dia. Tente de novo."
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
            />
            <ErroDeCampo mensagem={erros.horario} />
          </div>

          {/* 7. Aviso de recurso ocupado */}
          {recursoOcupado ? (
            <div
              className="flex items-start gap-2 rounded-md px-3 py-2.5"
              style={{ backgroundColor: "var(--warning-bg)" }}
            >
              <TriangleAlert
                strokeWidth={1.5}
                className="mt-0.5 size-4 shrink-0"
                style={{ color: "var(--warning-text)" }}
              />
              <p className="text-sm" style={{ color: "var(--warning-text)" }}>
                O recurso {recursoOcupado} estará ocupado neste horário.
              </p>
            </div>
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

          {/* 9. Confirmacao automatica */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <div className="grid gap-0.5">
              <Label htmlFor="enviar-confirmacao" className="cursor-pointer">
                Enviar confirmação automática
              </Label>
              <p className="text-xs text-text-tertiary">
                A régua de confirmação chega na próxima fase; a escolha já fica
                registrada.
              </p>
            </div>
            <Switch
              id="enviar-confirmacao"
              checked={enviarConfirmacao}
              onCheckedChange={setEnviarConfirmacao}
            />
          </div>

          {/* Erro geral (conflito inclusive) */}
          {erroGeral ? (
            <div
              role="alert"
              className="grid gap-2 rounded-md px-3 py-2.5"
              style={{ backgroundColor: "var(--alert-bg)" }}
            >
              <p className="text-sm" style={{ color: "var(--alert-text)" }}>
                {erroGeral}
              </p>
              {houveConflito ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10"
                    onClick={usarProximoLivre}
                  >
                    Usar o próximo horário livre
                  </Button>
                  {contexto.podeEditar ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10"
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

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            {salvando ? (
              <Button disabled className="h-10 min-w-32">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Marcando...
              </Button>
            ) : (
              <BotaoProtegido
                podeEditar={contexto.podeEditar}
                dica={contexto.dica}
                onClick={() => void salvar(false)}
              >
                Marcar consulta
              </BotaoProtegido>
            )}
          </div>
        </div>
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
  return (
    <p className="text-sm" style={{ color: "var(--alert-text)" }}>
      {mensagem}
    </p>
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce de 300ms na busca por nome ou telefone.
  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(() => {
      const seguro = limpo.replace(/[%,()]/g, "");
      void supabase
        .from("contact")
        .select("id, name, phone_e164")
        .eq("clinic_id", clinicId)
        .or(`name.ilike.%${seguro}%,phone_e164.ilike.%${seguro}%`)
        .limit(8)
        .then(({ data }) => {
          setResultados((data ?? []) as ResultadoBusca[]);
          setBuscando(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [termo, supabase, clinicId]);

  const confirmarCriacao = async () => {
    setErroCriacao(null);
    if (novoNome.trim().length < 2 || novoTelefone.trim().length < 10) {
      setErroCriacao("Informe o nome e o telefone com DDD.");
      return;
    }
    setSalvandoNovo(true);
    const resultado = await criarPacienteRapidoAction({
      name: novoNome.trim(),
      phone: novoTelefone.replace(/\D/g, ""),
    });
    setSalvandoNovo(false);
    if (!resultado.ok || !resultado.id) {
      setErroCriacao(resultado.error ?? "Não foi possível criar o cadastro.");
      return;
    }
    onPaciente({
      id: resultado.id,
      name: novoNome.trim(),
      phone: novoTelefone.trim(),
    });
    setCriando(false);
    setTermo("");
    setResultados([]);
  };

  if (paciente) {
    return (
      <div className="grid gap-1.5">
        <Label>Paciente</Label>
        <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border px-3">
          <span className="min-w-0 truncate text-sm font-medium">
            {paciente.name}
            <span className="ml-2 font-mono text-xs text-text-tertiary">
              {paciente.phone}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => {
              setTermo("");
              setCriando(false);
              onLimpar();
            }}
          >
            Trocar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="busca-paciente">Paciente</Label>
      <div className="relative">
        <Search
          strokeWidth={1.5}
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
        <div className="overflow-hidden rounded-md border border-border">
          {buscando ? (
            <div className="grid gap-1.5 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() =>
                      onPaciente({
                        id: r.id,
                        name: r.name ?? "Sem nome",
                        phone: r.phone_e164,
                      })
                    }
                  >
                    <span className="min-w-0 truncate font-medium">
                      {r.name ?? "Sem nome"}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-text-tertiary">
                      {r.phone_e164}
                    </span>
                  </button>
                </li>
              ))}
              {resultados.length === 0 ? (
                <li className="px-3 py-2 text-sm text-text-secondary">
                  Nenhum paciente com esse nome ou telefone.
                </li>
              ) : null}
            </ul>
          )}
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2 border-t border-border px-3 text-left text-sm font-medium hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            onClick={() => {
              setCriando(true);
              setNovoNome(termo.trim());
              setNovoTelefone("");
              setErroCriacao(null);
            }}
          >
            <UserPlus strokeWidth={1.5} className="size-4" aria-hidden />
            Criar cadastro para {termo.trim()}
          </button>
        </div>
      ) : null}

      {criando ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="novo-nome">Nome</Label>
            <Input
              id="novo-nome"
              className="h-10"
              autoFocus
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="novo-telefone">Telefone com DDD</Label>
            <Input
              id="novo-telefone"
              className="h-10 font-mono"
              inputMode="tel"
              placeholder="85999990000"
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
            <p
              role="alert"
              className="text-sm"
              style={{ color: "var(--alert-text)" }}
            >
              {erroCriacao}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-10"
              disabled={salvandoNovo}
              onClick={() => void confirmarCriacao()}
            >
              {salvandoNovo ? "Criando..." : "Confirmar cadastro"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10"
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
}) {
  if (!vinculoEscolhido) {
    return (
      <p className="text-sm text-text-secondary">
        Escolha o profissional para ver os horários livres.
      </p>
    );
  }
  if (erroDia) {
    return (
      <div role="alert" className="flex items-center gap-2">
        <p className="text-sm" style={{ color: "var(--alert-text)" }}>
          {erroDia}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10"
          onClick={onTentarDeNovo}
        >
          Tentar de novo
        </Button>
      </div>
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
        Nenhum horário livre neste dia. Escolha outra data.
      </p>
    );
  }

  const selecionado = (s: SlotLivre) =>
    slot !== null && s.startsAt.getTime() === slot.startsAt.getTime();

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {primeiros.map((s) => (
          <Button
            key={s.startsAt.toISOString()}
            type="button"
            variant={selecionado(s) ? "default" : "outline"}
            className="h-11 min-w-24 font-mono text-base tabular-nums"
            aria-pressed={selecionado(s)}
            onClick={() => onSlot(s)}
          >
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
        <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-6">
          {todos.map((s) => (
            <Button
              key={s.startsAt.toISOString()}
              type="button"
              size="sm"
              variant={selecionado(s) ? "default" : "outline"}
              className="h-10 font-mono tabular-nums"
              aria-pressed={selecionado(s)}
              onClick={() => onSlot(s)}
            >
              {horaLocal(s.startsAt)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
