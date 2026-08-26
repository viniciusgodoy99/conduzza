"use client";

import { MessageSquareText, Phone, Send, UserCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APPOINTMENT_STATUS, PATIENT_TAG } from "@/lib/design/status";
import { temRiscoDeFalta } from "@/lib/domain/etiquetas";
import type { ConsultaDaConfirmacao } from "@/lib/queries/confirmacoes";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";

// Corpo da Tela 2: lista agrupada por profissional, em ordem de horario,
// linhas de 56px. O chip de situacao vem inteiro de APPOINTMENT_STATUS, e e
// por isso que "Confirmado por WhatsApp" e "Confirmado pela recepcao"
// aparecem diferentes: sao status diferentes, com icone e rotulo proprios.

export type CanalDaConfirmacao = "whatsapp" | "telefone" | "presencial";

const CANAIS: { valor: CanalDaConfirmacao; rotulo: string }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "presencial", rotulo: "Presencial" },
];

export function horaLocal(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Botao de icone com rotulo em texto na dica (alvo de toque de 40px). */
function AcaoDeLinha({
  icone: Icone,
  rotulo,
  href,
  externo = false,
  onClick,
  desabilitado = false,
  dica,
}: {
  icone: typeof Phone;
  rotulo: string;
  href?: string;
  externo?: boolean;
  onClick?: () => void;
  desabilitado?: boolean;
  dica?: string;
}) {
  const botao = (
    <Button
      variant="ghost"
      size="icon"
      className="size-10"
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={onClick}
      asChild={!desabilitado && href !== undefined}
    >
      {!desabilitado && href !== undefined ? (
        externo ? (
          <a href={href} aria-label={rotulo}>
            <Icone strokeWidth={1.5} className="size-4" aria-hidden />
          </a>
        ) : (
          <Link href={href} aria-label={rotulo}>
            <Icone strokeWidth={1.5} className="size-4" aria-hidden />
          </Link>
        )
      ) : (
        <Icone strokeWidth={1.5} className="size-4" aria-hidden />
      )}
    </Button>
  );

  if (desabilitado && dica) {
    return <DisabledWithHint hint={dica}>{botao}</DisabledWithHint>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{botao}</TooltipTrigger>
      <TooltipContent>{dica ?? rotulo}</TooltipContent>
    </Tooltip>
  );
}

function Linha({
  consulta,
  timezone,
  podeEditar,
  dicaSemPermissao,
  ocupado,
  onCobrar,
  onConfirmar,
}: {
  consulta: ConsultaDaConfirmacao;
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ocupado: boolean;
  onCobrar: (consulta: ConsultaDaConfirmacao) => void;
  onConfirmar: (consulta: ConsultaDaConfirmacao) => void;
}) {
  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Sem nome";
  const faltas = consulta.contact?.no_show_count ?? 0;
  // A etiqueta de risco ja existe no sistema de status (PATIENT_TAG): mesmo
  // significado, mesma forma, mesma cor da lista de Pacientes.
  const IconeDeRisco = PATIENT_TAG.risco_de_falta.icon;
  const pendente = STATUS_PENDENTES.includes(consulta.status);
  const telefone = consulta.contact?.phone_e164 ?? null;

  const motivoSemCobranca = !podeEditar
    ? dicaSemPermissao
    : !consulta.consent_ativo
      ? "Sem autorização para receber mensagens no WhatsApp"
      : !consulta.send_confirmation
        ? "A confirmação automática está desligada nesta consulta"
        : null;

  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0">
      <span className="w-12 shrink-0 font-mono text-[13px] tabular-nums">
        {horaLocal(consulta.starts_at, timezone)}
      </span>
      <ContactAvatar name={consulta.contact?.name ?? null} phone={telefone ?? ""} size={32} />
      <span className="flex min-w-0 flex-1 basis-40 items-center gap-1.5">
        {temRiscoDeFalta(faltas) && IconeDeRisco ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="flex size-5 shrink-0 items-center justify-center rounded-full"
                style={{
                  color: "var(--alert-text)",
                  backgroundColor: "var(--alert-bg)",
                }}
              >
                <IconeDeRisco
                  strokeWidth={1.5}
                  className="size-3.5"
                  aria-hidden
                />
                <span className="sr-only">{faltas} faltas anteriores</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{faltas} faltas anteriores</TooltipContent>
          </Tooltip>
        ) : null}
        <span className="truncate text-sm font-medium">{nome}</span>
      </span>
      <span className="min-w-0 basis-40 truncate text-[13px] text-text-secondary">
        {consulta.service_link?.procedure?.name ?? "Procedimento"}
      </span>
      <span className="min-w-0 basis-28 truncate text-[13px] text-text-secondary">
        {consulta.service_link?.insurance?.name ?? "Particular"}
      </span>
      <StatusChip definition={APPOINTMENT_STATUS[consulta.status]} />
      <span className="ml-auto flex items-center gap-0.5">
        {pendente ? (
          motivoSemCobranca ? (
            <DisabledWithHint hint={motivoSemCobranca}>
              <Button variant="outline" size="sm" className="h-10" disabled>
                <Send strokeWidth={1.5} className="size-4" aria-hidden />
                Cobrar agora
              </Button>
            </DisabledWithHint>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              disabled={ocupado}
              onClick={() => onCobrar(consulta)}
            >
              <Send strokeWidth={1.5} className="size-4" aria-hidden />
              Cobrar agora
            </Button>
          )
        ) : null}
        <AcaoDeLinha
          icone={Phone}
          rotulo={`Ligar para ${nome}`}
          href={telefone ? `tel:${telefone}` : undefined}
          externo
          desabilitado={!telefone}
          dica={telefone ? `Ligar para ${telefone}` : "Sem telefone cadastrado"}
        />
        <AcaoDeLinha
          icone={UserCheck}
          rotulo="Confirmar manualmente"
          onClick={() => onConfirmar(consulta)}
          desabilitado={!podeEditar || !pendente || ocupado}
          dica={
            !podeEditar
              ? dicaSemPermissao
              : !pendente
                ? "Esta consulta já saiu da fila de confirmação"
                : "Confirmar manualmente"
          }
        />
        <AcaoDeLinha
          icone={MessageSquareText}
          rotulo="Abrir conversa"
          href={
            consulta.conversation_id
              ? `/atendimento?conversa=${consulta.conversation_id}`
              : undefined
          }
          desabilitado={!consulta.conversation_id}
          dica={
            consulta.conversation_id
              ? "Abrir conversa"
              : "Este paciente não tem conversa aberta no WhatsApp"
          }
        />
      </span>
    </li>
  );
}

export function ListaConfirmacoes({
  consultas,
  timezone,
  podeEditar,
  dicaSemPermissao,
  ocupado,
  onCobrar,
  onConfirmar,
}: {
  consultas: ConsultaDaConfirmacao[];
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ocupado: boolean;
  onCobrar: (consulta: ConsultaDaConfirmacao) => void;
  onConfirmar: (
    consulta: ConsultaDaConfirmacao,
    canal: CanalDaConfirmacao,
  ) => void;
}) {
  const [aConfirmar, setAConfirmar] = useState<ConsultaDaConfirmacao | null>(
    null,
  );

  // Agrupa por profissional preservando a ordem de horario dentro do grupo. A
  // ordem dos grupos segue o primeiro horario de cada profissional.
  const grupos = new Map<
    string,
    { nome: string; consultas: ConsultaDaConfirmacao[] }
  >();
  for (const consulta of consultas) {
    const chave = consulta.professional_id;
    const grupo = grupos.get(chave) ?? {
      nome: consulta.professional?.name ?? "Sem profissional",
      consultas: [],
    };
    grupo.consultas.push(consulta);
    grupos.set(chave, grupo);
  }

  return (
    <>
      <div className="grid gap-4">
        {[...grupos.entries()].map(([id, grupo]) => (
          <section key={id} className="overflow-hidden rounded-lg border">
            <h2 className="border-b bg-surface-3 px-3 py-2 text-[13px] font-semibold">
              {grupo.nome}
              <span className="ml-2 font-normal text-text-secondary">
                {grupo.consultas.length === 1
                  ? "1 consulta"
                  : `${grupo.consultas.length} consultas`}
              </span>
            </h2>
            <ul className="grid">
              {grupo.consultas.map((consulta) => (
                <Linha
                  key={consulta.id}
                  consulta={consulta}
                  timezone={timezone}
                  podeEditar={podeEditar}
                  dicaSemPermissao={dicaSemPermissao}
                  ocupado={ocupado}
                  onCobrar={onCobrar}
                  onConfirmar={setAConfirmar}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* mudarStatusAction EXIGE o canal na confirmacao da recepcao: e o que
          fica registrado junto com a autoria */}
      <Dialog
        open={aConfirmar !== null}
        onOpenChange={(aberto) => (!aberto ? setAConfirmar(null) : null)}
      >
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
                disabled={ocupado}
                onClick={() => {
                  if (aConfirmar) {
                    onConfirmar(aConfirmar, canal.valor);
                  }
                  setAConfirmar(null);
                }}
              >
                {canal.rotulo}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
