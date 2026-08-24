"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, History } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  mudarStatusAction,
  remarcarAgendamentoAction,
} from "@/app/(app)/agenda/actions";
import { StatusHistorySheet } from "@/components/agenda/status-history-sheet";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import type { AppointmentStatus } from "@/lib/design/status";
import { transicoesPermitidas } from "@/lib/domain/appointment-status";
import { diaCivil, instanteLocal } from "@/lib/domain/horarios";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// Menu do bloco de consulta: cabecalho de contexto, mudanca de situacao
// (transicoes validas do dominio, com confirmacao explicita para falta e
// pergunta de canal para confirmacao da recepcao), remarcar e historico.
// Sem permissao: tudo visivel, desabilitado, com a dica.

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
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const transicoes = transicoesPermitidas(consulta.status);

  const atualizarAgenda = () =>
    queryClient.invalidateQueries({ queryKey: ["agenda", contexto.clinicId] });

  const aplicarStatus = (
    novoStatus: AppointmentStatus,
    canal: CanalConfirmacao | null,
    aoTerminar?: () => void,
  ) => {
    iniciarTransicao(async () => {
      const resultado = await mudarStatusAction({
        id: consulta.id,
        status_atual: consulta.status,
        novo_status: novoStatus,
        canal,
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
    aplicarStatus(novoStatus, null);
  };

  return (
    <>
      <DropdownMenu>
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

          {transicoes.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-text-tertiary">
                Mudar situação
              </DropdownMenuLabel>
              {transicoes.map((novoStatus) => {
                const definicao = APPOINTMENT_STATUS[novoStatus];
                const tone = STATUS_TONE_VARS[definicao.tone];
                const Icone = definicao.icon;
                return (
                  <DropdownMenuItem
                    key={novoStatus}
                    disabled={!contexto.podeEditar || pendente}
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
            disabled={!contexto.podeEditar || pendente}
            className="h-10"
            onSelect={() => setDialogRemarcar(true)}
          >
            <CalendarClock strokeWidth={1.5} className="size-4" aria-hidden />
            <span>Remarcar</span>
          </DropdownMenuItem>
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

  const profissionaisAtivos = contexto.catalogo.profissionais.filter(
    (p) => p.active || p.id === consulta.professional_id,
  );

  const confirmar = () => {
    if (!dia || !hora) {
      setErro("Informe o dia e a hora do novo horário.");
      return;
    }
    setErro(null);
    iniciarTransicao(async () => {
      const duracaoMs =
        new Date(consulta.ends_at).getTime() -
        new Date(consulta.starts_at).getTime();
      const novoInicio = instanteLocal(contexto.timezone, dia, hora);
      const novoFim = new Date(novoInicio.getTime() + duracaoMs);
      const resultado = await remarcarAgendamentoAction({
        id: consulta.id,
        starts_at_esperado: consulta.starts_at,
        novo_starts_at: novoInicio.toISOString(),
        novo_ends_at: novoFim.toISOString(),
        novo_professional_id: profissionalId,
        avisar_paciente: avisarPaciente,
      });
      if (resultado.ok) {
        toast.success("Consulta remarcada.");
        onSucesso();
        onFechar();
        return;
      }
      if (resultado.code === "conflito") {
        // Mantem o dialog aberto para escolher outro horario
        setErro(resultado.error ?? "O horário de destino está ocupado.");
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
                {profissionaisAtivos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex min-h-10 items-center justify-between gap-3">
            <span className="text-sm">Avisar o paciente sobre a mudança</span>
            <Switch
              checked={avisarPaciente}
              onCheckedChange={setAvisarPaciente}
            />
          </label>

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
