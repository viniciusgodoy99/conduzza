"use client";

import {
  CalendarCheck2,
  MessageSquareText,
  Phone,
  Send,
  ShieldPlus,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { ChipDoToque } from "@/components/confirmacoes/chip-do-toque";
import { DialogoDeAutorizacao } from "@/components/confirmacoes/dialogo-de-autorizacao";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
  CONSENT_STATUS,
  PATIENT_TAG,
} from "@/lib/design/status";
import { temRiscoDeFalta } from "@/lib/domain/etiquetas";
import type { ConsultaDaConfirmacao } from "@/lib/queries/confirmacoes";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";
import { cn } from "@/lib/utils";

// Corpo da Tela 2: um cartao com a lista agrupada por profissional, em ordem
// de horario, linhas de 56px (docs/06 secao 5.7). Continua section > h2 +
// ul > li. O chip de situacao vem inteiro de APPOINTMENT_STATUS, e e por
// isso que "Confirmado por WhatsApp" e "Confirmado pela recepcao" aparecem
// diferentes: sao status diferentes, com icone e rotulo proprios.
//
// A partir de 1280px as linhas viram grade com cabecalho de colunas. A grade
// e do cartao e cada grupo, lista e linha herda as colunas por subgrid: a
// coluna do chip e a das acoes tem largura "auto" e mesmo assim alinham em
// todas as linhas. Abaixo disso, a linha quebra em fluxo como antes.
//
// O cartao usa overflow-clip, e nao hidden: clip corta o canto arredondado
// sem virar conteiner de rolagem, e o cabecalho de colunas gruda no topo do
// <main> ao rolar.

/** Colunas da lista a partir de xl (docs/06 secao 5.7). */
const GRADE =
  "xl:grid xl:grid-cols-[56px_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(176px,auto)_minmax(200px,auto)_auto] xl:gap-x-3";
const SUBGRADE = "xl:col-span-full xl:grid xl:grid-cols-subgrid";

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
export function AcaoDeLinha({
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
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={onClick}
      asChild={!desabilitado && href !== undefined}
    >
      {!desabilitado && href !== undefined ? (
        externo ? (
          <a href={href} aria-label={rotulo}>
            <Icone className="size-4" aria-hidden />
          </a>
        ) : (
          <Link href={href} aria-label={rotulo}>
            <Icone className="size-4" aria-hidden />
          </Link>
        )
      ) : (
        <Icone className="size-4" aria-hidden />
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

/**
 * Nome do paciente com o alerta de faltas antes dele e o atalho para a ficha
 * (achado 57: e na ficha que mora o registro da autorizacao e o historico).
 * O alerta reusa a etiqueta de risco de PATIENT_TAG: mesmo significado, mesma
 * forma, mesma cor da lista de Pacientes.
 */
export function NomeDoPaciente({
  contactId,
  nome,
  faltas,
}: {
  contactId: string;
  nome: string;
  faltas: number;
}) {
  const IconeDeRisco = PATIENT_TAG.risco_de_falta.icon;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {temRiscoDeFalta(faltas) && IconeDeRisco ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="hit-40 flex size-5 shrink-0 items-center justify-center rounded-full bg-alert-bg text-alert-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              <IconeDeRisco className="size-3" aria-hidden />
              <span className="sr-only">{faltas} faltas anteriores</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="cz-num">{faltas}</span> faltas anteriores
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Link
        href={`/pacientes/${contactId}`}
        className="hit-40 inline-flex min-w-0 rounded-sm text-[13.5px] font-semibold text-text-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        <span className="truncate">{nome}</span>
      </Link>
    </span>
  );
}

function Linha({
  consulta,
  timezone,
  podeEditar,
  dicaSemPermissao,
  podeRegistrarAutorizacao,
  dicaAutorizacao,
  ocupado,
  onCobrar,
  onConfirmar,
  onManterHorario,
  onRegistrarAutorizacao,
}: {
  consulta: ConsultaDaConfirmacao;
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  podeRegistrarAutorizacao: boolean;
  dicaAutorizacao: string;
  ocupado: boolean;
  onCobrar: (consulta: ConsultaDaConfirmacao) => void;
  onConfirmar: (consulta: ConsultaDaConfirmacao) => void;
  onManterHorario: (consulta: ConsultaDaConfirmacao) => void;
  onRegistrarAutorizacao: (consulta: ConsultaDaConfirmacao) => void;
}) {
  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Sem nome";
  const pendente = STATUS_PENDENTES.includes(consulta.status);
  const telefone = consulta.contact?.phone_e164 ?? null;

  // O paciente respondeu "Remarcar": ele JA respondeu, e perguntar de novo se
  // confirma o horario que ele quer trocar e a mensagem errada.
  const pediuRemarcacao = consulta.remarcacao_pedida_em !== null;
  const semAutorizacao = consulta.consent_estado === "sem_autorizacao";

  const motivoSemCobranca = !podeEditar
    ? dicaSemPermissao
    : consulta.consent_estado === "revogado"
      ? "O paciente pediu para não receber mensagens no WhatsApp"
      : !consulta.consent_ativo
        ? "Sem autorização registrada para receber mensagens no WhatsApp"
        : !consulta.send_confirmation
          ? "A confirmação automática está desligada nesta consulta"
          : null;

  // Uma acao principal por linha, a que a situacao pede: manter o horario de
  // quem pediu para remarcar (R12), registrar a autorizacao de quem nunca foi
  // registrado (achado 57) ou cobrar a confirmacao de quem esta pendente.
  let acaoPrincipal: React.ReactNode = null;
  if (pediuRemarcacao) {
    acaoPrincipal = podeEditar ? (
      <Button
        variant="outline"
        disabled={ocupado}
        onClick={() => onManterHorario(consulta)}
      >
        <CalendarCheck2 aria-hidden />
        Manter o horário
      </Button>
    ) : (
      <DisabledWithHint hint={dicaSemPermissao}>
        <Button variant="outline" disabled>
          <CalendarCheck2 aria-hidden />
          Manter o horário
        </Button>
      </DisabledWithHint>
    );
  } else if (pendente && semAutorizacao) {
    acaoPrincipal = podeRegistrarAutorizacao ? (
      <Button
        variant="outline"
        onClick={() => onRegistrarAutorizacao(consulta)}
      >
        <ShieldPlus aria-hidden />
        Registrar autorização
      </Button>
    ) : (
      <DisabledWithHint hint={dicaAutorizacao}>
        <Button variant="outline" disabled>
          <ShieldPlus aria-hidden />
          Registrar autorização
        </Button>
      </DisabledWithHint>
    );
  } else if (pendente) {
    acaoPrincipal = motivoSemCobranca ? (
      <DisabledWithHint hint={motivoSemCobranca}>
        <Button variant="outline" disabled>
          <Send aria-hidden />
          Cobrar agora
        </Button>
      </DisabledWithHint>
    ) : (
      <Button
        variant="outline"
        disabled={ocupado}
        onClick={() => onCobrar(consulta)}
      >
        <Send aria-hidden />
        Cobrar agora
      </Button>
    );
  }

  return (
    <li
      className={cn(
        "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3.5 py-2 cz-transition last:border-b-0 hover:bg-surface-subtle",
        SUBGRADE,
      )}
    >
      <span className="w-12 shrink-0 cz-num text-[13px] font-semibold text-text-strong xl:w-auto">
        {horaLocal(consulta.starts_at, timezone)}
      </span>
      <span className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
        <ContactAvatar
          name={consulta.contact?.name ?? null}
          phone={telefone ?? ""}
          size={30}
        />
        <NomeDoPaciente
          contactId={consulta.contact_id}
          nome={nome}
          faltas={consulta.contact?.no_show_count ?? 0}
        />
      </span>
      <span className="min-w-0 basis-40 truncate text-[13px] text-text-secondary">
        {consulta.service_link?.procedure?.name ?? "Procedimento"}
      </span>
      <span className="min-w-0 basis-28 truncate text-[13px] text-text-secondary">
        {consulta.service_link?.insurance?.name ?? "Particular"}
      </span>
      <span className="flex min-w-0">
        <StatusChip definition={APPOINTMENT_STATUS[consulta.status]} />
      </span>
      <span className="flex min-w-0">
        {/* O pedido de remarcação é a informação que a recepção precisa
            aqui: sem ele, quem tocou em "Remarcar" parecia quem não
            respondeu. Fica no lugar do chip do toque, que só diria que os
            próximos foram pulados. */}
        {pediuRemarcacao ? (
          <StatusChip definition={APPOINTMENT_FLAG.remarcacao_pedida} />
        ) : consulta.toque.situacao !== "nenhum" ? (
          /* O que a régua já fez por esta consulta. Sem isto, a recepção
             decidia cobrar sem saber se a mensagem já tinha saído. */
          <ChipDoToque
            toque={consulta.toque}
            consentimento={consulta.consent_estado}
            horaLocal={(iso) => horaLocal(iso, timezone)}
          />
        ) : pendente && consulta.consent_estado !== "autorizado" ? (
          /* Nada saiu ainda e nada vai sair: a autorização explica por quê,
             separando quem nunca foi registrado de quem pediu para não
             receber (achado 57). */
          <StatusChip definition={CONSENT_STATUS[consulta.consent_estado]} />
        ) : null}
      </span>
      <span className="ml-auto flex items-center gap-0.5 xl:ml-0 xl:justify-self-end">
        {acaoPrincipal}
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
  podeRegistrarAutorizacao,
  dicaAutorizacao,
  ocupado,
  onCobrar,
  onConfirmar,
  onManterHorario,
  aoRegistrarAutorizacao,
  barra,
  vazio,
}: {
  /** As consultas que a tela quer mostrar (ja filtradas pela situacao). */
  consultas: ConsultaDaConfirmacao[];
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  /** Quem edita leads e pacientes registra a autorizacao (mesma regra da ficha). */
  podeRegistrarAutorizacao: boolean;
  dicaAutorizacao: string;
  ocupado: boolean;
  onCobrar: (consulta: ConsultaDaConfirmacao) => void;
  onConfirmar: (
    consulta: ConsultaDaConfirmacao,
    canal: CanalDaConfirmacao,
  ) => void;
  onManterHorario: (consulta: ConsultaDaConfirmacao) => void;
  /** Recarrega o dia depois de registrar uma autorizacao. */
  aoRegistrarAutorizacao: () => Promise<unknown> | void;
  /** Barra do topo do cartao (o filtro por situacao). */
  barra?: React.ReactNode;
  /** O que mostrar quando o filtro nao deixa nenhuma consulta. */
  vazio?: React.ReactNode;
}) {
  const [aConfirmar, setAConfirmar] = useState<ConsultaDaConfirmacao | null>(
    null,
  );
  const [aManter, setAManter] = useState<ConsultaDaConfirmacao | null>(null);
  const [aAutorizar, setAAutorizar] = useState<ConsultaDaConfirmacao | null>(
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

  const nomeDe = (consulta: ConsultaDaConfirmacao) =>
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Sem nome";
  const manterPendente =
    aManter !== null && STATUS_PENDENTES.includes(aManter.status);

  return (
    <>
      <Card className="overflow-clip">
        {barra ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-3.5 py-3">
            {barra}
          </div>
        ) : null}
        {consultas.length === 0 ? (
          vazio
        ) : (
          <div className={GRADE}>
            <div
              aria-hidden
              className={cn(
                "sticky top-0 z-[1] hidden h-9 items-center border-b border-border-strong bg-surface-subtle px-3.5 cz-eyebrow text-text-secondary",
                SUBGRADE,
              )}
            >
              <span>Hora</span>
              <span>Paciente</span>
              <span>Procedimento</span>
              <span>Convênio</span>
              <span>Situação</span>
              <span>Mensagem automática</span>
              <span className="text-right">Ações</span>
            </div>
            {[...grupos.entries()].map(([id, grupo]) => (
              <section key={id} className={SUBGRADE}>
                <h2 className="border-b border-border bg-surface-subtle px-3.5 py-2 text-[13px] font-bold xl:col-span-full">
                  {grupo.nome}
                  <span className="ml-2 font-normal text-text-secondary">
                    <span className="cz-num">{grupo.consultas.length}</span>{" "}
                    {grupo.consultas.length === 1 ? "consulta" : "consultas"}
                  </span>
                </h2>
                <ul className={cn("grid", SUBGRADE)}>
                  {grupo.consultas.map((consulta) => (
                    <Linha
                      key={consulta.id}
                      consulta={consulta}
                      timezone={timezone}
                      podeEditar={podeEditar}
                      dicaSemPermissao={dicaSemPermissao}
                      podeRegistrarAutorizacao={podeRegistrarAutorizacao}
                      dicaAutorizacao={dicaAutorizacao}
                      ocupado={ocupado}
                      onCobrar={onCobrar}
                      onConfirmar={setAConfirmar}
                      onManterHorario={setAManter}
                      onRegistrarAutorizacao={setAAutorizar}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      {/* mudarStatusAction EXIGE o canal na confirmacao da recepcao: e o que
          fica registrado junto com a autoria */}
      <Dialog
        open={aConfirmar !== null}
        onOpenChange={(aberto) => (!aberto ? setAConfirmar(null) : null)}
      >
        <DialogContent className="sm:max-w-[420px]">
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
                className="justify-start"
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

      {/* Manter o horario (R12): so zera o pedido, com a pergunta antes,
          porque a marca some da lista e a confirmacao volta a valer. */}
      <Dialog
        open={aManter !== null}
        onOpenChange={(aberto) => (!aberto ? setAManter(null) : null)}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Manter o horário?</DialogTitle>
            <DialogDescription>
              {aManter ? (
                <>
                  {nomeDe(aManter)}, consulta das{" "}
                  <span className="cz-num">
                    {horaLocal(aManter.starts_at, timezone)}
                  </span>
                  , pediu para remarcar pelo WhatsApp. Use quando já combinou
                  com o paciente que ele fica com este horário.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <p className="text-[13px] text-foreground">
            O pedido de remarcação sai da lista. A consulta continua no mesmo
            horário e na mesma situação
            {manterPendente
              ? ", e a confirmação automática volta a valer para ela."
              : "."}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAManter(null)}>
              Voltar
            </Button>
            <Button
              disabled={ocupado}
              onClick={() => {
                if (aManter) {
                  onManterHorario(aManter);
                }
                setAManter(null);
              }}
            >
              Manter o horário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {aAutorizar ? (
        <DialogoDeAutorizacao
          contactId={aAutorizar.contact_id}
          nome={nomeDe(aAutorizar)}
          onFechar={() => setAAutorizar(null)}
          aoRegistrar={aoRegistrarAutorizacao}
        />
      ) : null}
    </>
  );
}
