"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, History, X } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  aprovarEncaixeAction,
  mudarStatusAction,
  recusarEncaixeAction,
  remarcarAgendamentoAction,
} from "@/app/(app)/agenda/actions";
import {
  ChaveAvisarPaciente,
  ERROS_CORRIGIVEIS_NA_REMARCACAO,
  NotaDaConfirmacao,
  profissionaisParaRemarcar,
} from "@/components/agenda/remarcacao-comum";
import { StatusHistorySheet } from "@/components/agenda/status-history-sheet";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import type { AppointmentStatus } from "@/lib/design/status";
import {
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  eCancelamento,
  faltaLiberada,
  podeRemarcar,
  transicoesPermitidas,
} from "@/lib/domain/appointment-status";
import { diaCivil, instanteLocal } from "@/lib/domain/horarios";
import {
  agendaKeys,
  fetchListaDeEsperaDaClinica,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";
import { createClient } from "@/lib/supabase/client";

// Menu do bloco de consulta: cabecalho de contexto, mudanca de situacao
// (transicoes validas do dominio, com confirmacao explicita para falta e para
// os dois cancelamentos, e pergunta de canal para confirmacao da recepcao),
// remarcar e historico. Sem permissao: tudo visivel, desabilitado, com a
// dica. Acao que a regra impede agora (falta antes do horario, remarcar
// consulta encerrada) tambem fica visivel e desabilitada, com o porque.

/** "quinta-feira, 25/09 às 10:00" no fuso da clinica. */
function diaEHoraNoFuso(timezone: string, instante: string): string {
  const data = new Date(instante);
  const dia = data.toLocaleDateString("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
  const hora = data.toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dia} às ${hora}`;
}

type CanalConfirmacao = "whatsapp" | "telefone" | "presencial";

const CANAIS: { valor: CanalConfirmacao; rotulo: string }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "presencial", rotulo: "Presencial" },
];

function horaNoFuso(timezone: string, instante: string): string {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AppointmentMenu({
  contexto,
  consulta,
  children,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [pendente, iniciarTransicao] = useTransition();

  const [dialogFalta, setDialogFalta] = useState(false);
  const [dialogCanal, setDialogCanal] = useState(false);
  const [dialogRemarcar, setDialogRemarcar] = useState(false);
  const [cancelamento, setCancelamento] = useState<AppointmentStatus | null>(
    null,
  );
  const [historicoAberto, setHistoricoAberto] = useState(false);
  // O relogio do menu: renovado a cada abertura (falta so a partir do
  // horario da consulta). O servidor confere de novo com o horario do banco.
  const [agora, setAgora] = useState(() => Date.now());
  const idDicaFalta = useId();
  const idDicaRemarcar = useId();

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const transicoes = transicoesPermitidas(consulta.status);
  const faltaAindaNao = !faltaLiberada(consulta.starts_at, new Date(agora));
  const remarcavel = podeRemarcar(consulta.status);

  const atualizarAgenda = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["agenda", contexto.clinicId],
      }),
      queryClient.invalidateQueries({
        queryKey: agendaKeys.historico(consulta.id),
      }),
    ]);

  const aplicarStatus = (
    novoStatus: AppointmentStatus,
    canal: CanalConfirmacao | null,
    aoTerminar?: () => void,
    oferecerVaga?: boolean,
  ) => {
    iniciarTransicao(async () => {
      const resultado = await mudarStatusAction({
        id: consulta.id,
        status_atual: consulta.status,
        novo_status: novoStatus,
        canal,
        ...(oferecerVaga === undefined ? {} : { oferecer_vaga: oferecerVaga }),
      });
      if (resultado.ok) {
        toast.success(
          `Situação mudada para ${APPOINTMENT_STATUS[novoStatus].label}.`,
        );
        await atualizarAgenda();
      } else {
        toast.error(resultado.error ?? "Não foi possível mudar a situação.");
      }
      aoTerminar?.();
    });
  };

  const escolherTransicao = (novoStatus: AppointmentStatus) => {
    if (novoStatus === "faltou") {
      setDialogFalta(true);
      return;
    }
    if (novoStatus === "confirmado_recepcao") {
      setDialogCanal(true);
      return;
    }
    // Cancelar nao tem volta e pode acionar a lista de espera: sempre com
    // confirmacao que nomeia paciente, procedimento e horario (achado 80).
    if (eCancelamento(novoStatus)) {
      setCancelamento(novoStatus);
      return;
    }
    aplicarStatus(novoStatus, null);
  };

  const tratarEncaixe = (decisao: "aprovar" | "recusar") => {
    iniciarTransicao(async () => {
      const resultado =
        decisao === "aprovar"
          ? await aprovarEncaixeAction(consulta.id)
          : await recusarEncaixeAction(consulta.id);
      if (resultado.ok) {
        toast.success(
          decisao === "aprovar" ? "Encaixe aprovado." : "Encaixe recusado.",
        );
        await atualizarAgenda();
      } else {
        toast.error(resultado.error ?? "Não foi possível tratar o encaixe.");
      }
    });
  };

  return (
    <>
      <DropdownMenu
        onOpenChange={(aberto) => {
          if (aberto) {
            setAgora(Date.now());
          }
        }}
      >
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="truncate text-sm font-semibold">{nome}</span>
            {consulta.contact?.phone_e164 ? (
              <span className="font-mono text-xs font-normal text-text-secondary">
                {consulta.contact.phone_e164}
              </span>
            ) : null}
            <span className="truncate text-xs font-normal text-text-secondary">
              {consulta.service_link?.procedure?.name ?? "Procedimento"}
              {" · "}
              {consulta.service_link?.insurance?.name ?? "Particular"}
            </span>
            <span className="text-xs font-normal text-text-secondary">
              {horaNoFuso(contexto.timezone, consulta.starts_at)}
              {" às "}
              {horaNoFuso(contexto.timezone, consulta.ends_at)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {consulta.approval_status === "pendente" ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs font-medium text-text-tertiary">
                  Encaixe pendente
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!contexto.podeEditar || pendente}
                  className="h-10"
                  onSelect={() => tratarEncaixe("aprovar")}
                >
                  <Check
                    strokeWidth={1.5}
                    className="size-4 shrink-0"
                    aria-hidden
                  />
                  <span>Aprovar encaixe</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!contexto.podeEditar || pendente}
                  className="h-10"
                  onSelect={() => tratarEncaixe("recusar")}
                >
                  <X
                    strokeWidth={1.5}
                    className="size-4 shrink-0"
                    aria-hidden
                  />
                  <span>Recusar encaixe</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}

          {transicoes.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-text-tertiary">
                Mudar situação
              </DropdownMenuLabel>
              {transicoes.map((novoStatus) => {
                const definicao = APPOINTMENT_STATUS[novoStatus];
                const tone = STATUS_TONE_VARS[definicao.tone];
                const Icone = definicao.icon;
                // Faltou fica VISIVEL antes do horario, desabilitado e com o
                // porque logo abaixo (achado 81).
                const bloqueadoPeloHorario =
                  novoStatus === "faltou" && faltaAindaNao;
                return (
                  <div key={novoStatus}>
                    <DropdownMenuItem
                      disabled={
                        !contexto.podeEditar || pendente || bloqueadoPeloHorario
                      }
                      aria-describedby={
                        bloqueadoPeloHorario ? idDicaFalta : undefined
                      }
                      className="h-10"
                      onSelect={() => escolherTransicao(novoStatus)}
                    >
                      {Icone ? (
                        <Icone
                          strokeWidth={1.5}
                          className="size-4 shrink-0"
                          style={{ color: tone.text }}
                          aria-hidden
                        />
                      ) : null}
                      <span>{definicao.label}</span>
                    </DropdownMenuItem>
                    {bloqueadoPeloHorario ? (
                      <p
                        id={idDicaFalta}
                        className="max-w-64 px-2 pb-1.5 text-xs whitespace-normal text-text-secondary"
                      >
                        {DICA_FALTA_ANTES_DO_HORARIO}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </DropdownMenuGroup>
          ) : (
            <DropdownMenuLabel className="text-xs font-normal text-text-tertiary">
              Situação final, sem mudanças possíveis
            </DropdownMenuLabel>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!contexto.podeEditar || pendente || !remarcavel}
            aria-describedby={!remarcavel ? idDicaRemarcar : undefined}
            className="h-10"
            onSelect={() => setDialogRemarcar(true)}
          >
            <CalendarClock strokeWidth={1.5} className="size-4" aria-hidden />
            <span>Remarcar</span>
          </DropdownMenuItem>
          {!remarcavel ? (
            <p
              id={idDicaRemarcar}
              className="max-w-64 px-2 pb-1.5 text-xs whitespace-normal text-text-secondary"
            >
              {DICA_REMARCAR_ENCERRADA}
            </p>
          ) : null}
          <DropdownMenuItem
            className="h-10"
            onSelect={() => setHistoricoAberto(true)}
          >
            <History strokeWidth={1.5} className="size-4" aria-hidden />
            <span>Ver histórico</span>
          </DropdownMenuItem>

          {!contexto.podeEditar ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="max-w-64 text-xs font-normal whitespace-normal text-text-tertiary">
                {contexto.dica}
              </DropdownMenuLabel>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmacao explicita de falta: nunca automatica */}
      <Dialog open={dialogFalta} onOpenChange={setDialogFalta}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar falta de {nome}?</DialogTitle>
            <DialogDescription>
              Falta é sempre uma ação registrada, nunca automática.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              disabled={pendente}
              onClick={() => setDialogFalta(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={pendente}
              onClick={() =>
                aplicarStatus("faltou", null, () => setDialogFalta(false))
              }
            >
              Confirmar falta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Canal da confirmacao pela recepcao */}
      <Dialog open={dialogCanal} onOpenChange={setDialogCanal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Como a confirmação chegou?</DialogTitle>
            <DialogDescription>
              O canal fica registrado junto com a confirmação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {CANAIS.map((canal) => (
              <Button
                key={canal.valor}
                variant="outline"
                className="h-10 justify-start"
                disabled={pendente}
                onClick={() =>
                  aplicarStatus("confirmado_recepcao", canal.valor, () =>
                    setDialogCanal(false),
                  )
                }
              >
                {canal.rotulo}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {cancelamento ? (
        <CancelarDialog
          contexto={contexto}
          consulta={consulta}
          status={cancelamento}
          pendente={pendente}
          onFechar={() => setCancelamento(null)}
          onConfirmar={(oferecerVaga) =>
            aplicarStatus(
              cancelamento,
              null,
              () => setCancelamento(null),
              oferecerVaga,
            )
          }
        />
      ) : null}

      {dialogRemarcar ? (
        <RemarcarDialog
          contexto={contexto}
          consulta={consulta}
          aberto={dialogRemarcar}
          onFechar={() => setDialogRemarcar(false)}
          onSucesso={atualizarAgenda}
        />
      ) : null}

      <StatusHistorySheet
        contexto={contexto}
        consulta={consulta}
        aberto={historicoAberto}
        onFechar={() => setHistoricoAberto(false)}
      />
    </>
  );
}

function RemarcarDialog({
  contexto,
  consulta,
  aberto,
  onFechar,
  onSucesso,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  aberto: boolean;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [dia, setDia] = useState(() =>
    diaCivil(contexto.timezone, new Date(consulta.starts_at)),
  );
  const [hora, setHora] = useState(() =>
    horaNoFuso(contexto.timezone, consulta.starts_at),
  );
  const [profissionalId, setProfissionalId] = useState(
    consulta.professional_id,
  );
  const [avisarPaciente, setAvisarPaciente] = useState(true);
  const idChaveAviso = useId();

  // So quem atende o MESMO procedimento pelo MESMO convenio (achado 85): o
  // servidor recusa os demais, entao a lista nem os oferece.
  const profissionaisPossiveis = profissionaisParaRemarcar(contexto, consulta);

  const confirmar = () => {
    if (!dia || !hora) {
      setErro("Informe o dia e a hora do novo horário.");
      return;
    }
    setErro(null);
    iniciarTransicao(async () => {
      // A duracao sai do vinculo no servidor; a tela so manda o novo inicio.
      const novoInicio = instanteLocal(contexto.timezone, dia, hora);
      const resultado = await remarcarAgendamentoAction({
        id: consulta.id,
        starts_at_esperado: consulta.starts_at,
        novo_starts_at: novoInicio.toISOString(),
        novo_professional_id: profissionalId,
        avisar_paciente: avisarPaciente,
      });
      if (resultado.ok) {
        toast.success("Consulta remarcada.");
        if (resultado.aviso) {
          // O aviso NAO saiu: a recepcao precisa saber para ligar.
          toast.warning(resultado.aviso, { duration: 10_000 });
        }
        onSucesso();
        onFechar();
        return;
      }
      if (
        resultado.code &&
        ERROS_CORRIGIVEIS_NA_REMARCACAO.has(resultado.code)
      ) {
        // Mantem o dialogo aberto para escolher outro horario ou profissional
        setErro(resultado.error ?? "Não foi possível remarcar neste horário.");
        return;
      }
      toast.error(resultado.error ?? "Não foi possível remarcar.");
      onFechar();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remarcar consulta</DialogTitle>
          <DialogDescription>
            {consulta.contact?.name ?? "Paciente"}
            {" · "}
            {consulta.service_link?.procedure?.name ?? "Procedimento"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="remarcar-dia">Novo dia</Label>
              <Input
                id="remarcar-dia"
                type="date"
                className="h-10"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="remarcar-hora">Nova hora</Label>
              <Input
                id="remarcar-hora"
                type="time"
                className="h-10"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Profissional</Label>
            <Select value={profissionalId} onValueChange={setProfissionalId}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Escolha o profissional" />
              </SelectTrigger>
              <SelectContent>
                {profissionaisPossiveis.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-secondary">
              Aparecem só os profissionais que atendem este procedimento por
              este convênio.
            </p>
          </div>

          <ChaveAvisarPaciente
            id={idChaveAviso}
            marcada={avisarPaciente}
            aoMudar={setAvisarPaciente}
          />

          <NotaDaConfirmacao consulta={consulta} />

          {erro ? (
            <p
              role="alert"
              className="rounded-md px-3 py-2 text-sm"
              style={{
                color: "var(--alert-text)",
                backgroundColor: "var(--alert-bg)",
              }}
            >
              {erro}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Cancelar
          </Button>
          <Button className="h-10" disabled={pendente} onClick={confirmar}>
            {pendente ? "Remarcando..." : "Remarcar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirmacao dos dois cancelamentos (achado 80). Nomeia paciente,
 * procedimento, profissional e horario no fuso da clinica, diz que nao tem
 * volta e, quando a lista de espera vai ser acionada, deixa a recepcao
 * decidir se oferece o horario (appointment.oferecer_vaga_ao_cancelar).
 */
function CancelarDialog({
  contexto,
  consulta,
  status,
  pendente,
  onFechar,
  onConfirmar,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  status: AppointmentStatus;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: (oferecerVaga: boolean | undefined) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [oferecerVaga, setOferecerVaga] = useState(true);
  const [abertoEm] = useState(() => Date.now());
  const idOferecer = useId();

  // Encaixe nao e reoferecido (o gatilho de reoferta ignora encaixe).
  const podeIrParaALista = !consulta.is_overbooking;
  const esperaQuery = useQuery({
    queryKey: agendaKeys.listaDeEspera(contexto.clinicId),
    queryFn: () => fetchListaDeEsperaDaClinica(supabase, contexto.clinicId),
    enabled: podeIrParaALista,
    staleTime: 60_000,
  });

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const procedimento = consulta.service_link?.procedure?.name ?? "Consulta";
  const profissional = contexto.catalogo.profissionais.find(
    (p) => p.id === consulta.professional_id,
  )?.name;
  const quando = diaEHoraNoFuso(contexto.timezone, consulta.starts_at);
  const titulo =
    status === "cancelado_paciente"
      ? `Cancelar a consulta de ${nome} a pedido do paciente?`
      : `Cancelar a consulta de ${nome} pela clínica?`;

  // A oferta so parte quando ha fila ativa e da tempo de o paciente da lista
  // responder antes do horario (a mesma guarda do job de reoferta).
  const espera = esperaQuery.data;
  const daTempoDeOferecer =
    espera !== undefined &&
    new Date(consulta.starts_at).getTime() >
      abertoEm + espera.janelaMinutos * 60_000;
  const vaParaALista =
    podeIrParaALista &&
    espera !== undefined &&
    espera.ativos > 0 &&
    daTempoDeOferecer;
  // Sem saber se ha fila (erro de leitura), a escolha continua na mao da
  // recepcao: melhor perguntar a mais do que oferecer sem perguntar.
  const mostrarEscolha =
    podeIrParaALista && (vaParaALista || esperaQuery.isError);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {procedimento}
            {profissional ? ` com ${profissional}` : ""}, {quando}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="text-sm">
            Cancelar não tem volta. Para atender o paciente de novo, marque uma
            nova consulta.
          </p>

          {podeIrParaALista && esperaQuery.isPending ? (
            <Skeleton
              className="h-10 w-full"
              aria-label="Conferindo a lista de espera"
            />
          ) : null}

          {mostrarEscolha ? (
            <div className="grid gap-2 rounded-md border border-border px-3 py-2">
              <p className="text-sm text-text-secondary">
                {esperaQuery.isError
                  ? "Não foi possível conferir a lista de espera. Se houver pacientes nela, este horário pode ser oferecido a eles pelo WhatsApp."
                  : `Há ${espera?.ativos === 1 ? "1 paciente" : `${espera?.ativos ?? 0} pacientes`} na lista de espera. Com a opção marcada, este horário é oferecido pelo WhatsApp a quem combina com ele.`}
              </p>
              <div className="flex min-h-10 items-center gap-3">
                <Checkbox
                  id={idOferecer}
                  checked={oferecerVaga}
                  onCheckedChange={(valor) => setOferecerVaga(valor === true)}
                />
                <Label htmlFor={idOferecer}>
                  Oferecer este horário à lista de espera
                </Label>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Manter consulta
          </Button>
          <Button
            variant="destructive"
            className="h-10"
            disabled={pendente || (podeIrParaALista && esperaQuery.isPending)}
            onClick={() =>
              onConfirmar(mostrarEscolha ? oferecerVaga : undefined)
            }
          >
            {pendente ? "Cancelando..." : "Cancelar consulta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
