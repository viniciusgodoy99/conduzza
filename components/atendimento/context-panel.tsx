"use client";

import Link from "next/link";

import {
  CalendarClock,
  CalendarPlus,
  History,
  Hourglass,
  IdCard,
  RotateCcw,
  ShieldQuestion,
  UserPlus,
} from "lucide-react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { EtapaDoContato } from "@/components/atendimento/etapa-do-contato";
import { EtiquetasDaConversa } from "@/components/atendimento/etiquetas-da-conversa";
import {
  dataNaClinica,
  FUSO_PADRAO,
} from "@/components/atendimento/fuso-da-clinica";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONSENT_STATUS,
  STATUS_TONE_VARS,
  type StatusDefinition,
} from "@/lib/design/status";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  estadoDoConsentimento,
  type ConsentInfo,
  type ContactSummary,
} from "@/lib/queries/conversations";

// Painel de contexto (design system Conduzza, docs/06 secao 5.3): a
// identidade do contato com as acoes de agenda e espera, as etiquetas, a
// etapa da jornada, a autorizacao de mensagens (tres estados, CONSENT_STATUS),
// a origem e os atalhos para a ficha e a agenda (que ja existem; este painel
// aponta, nao duplica). Sem fio entre secoes: o respiro separa.

const CONSENT_SOURCE_LABEL: Record<string, string> = {
  formulario_site: "Formulário do site",
  anuncio_ctwa: "Anúncio click-to-WhatsApp",
  recepcao: "Cadastro na recepção",
  importacao_planilha: "Importação de planilha",
  conversa: "Iniciou a conversa",
};

// Tipo do contato: neutro, com forma propria (nao reusa icone de status).
const TIPO_DO_CONTATO: Record<ContactSummary["kind"], StatusDefinition> = {
  paciente: { label: "Paciente", tone: "neutral", icon: IdCard },
  lead: { label: "Lead", tone: "neutral", icon: UserPlus },
};

// Link de bloco que pode ter texto longo: quebra linha em vez de vazar do
// painel de 320px (o Button padrao e whitespace-nowrap).
const LINK_EM_BLOCO =
  "h-auto min-h-10 w-full justify-start py-2 text-left whitespace-normal";

/** Estado da consulta de autorizacao, para nao confundir "carregando" com "sem". */
export type EstadoDaAutorizacao = "carregando" | "erro" | "pronto";

function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <h3 className="cz-eyebrow text-text-secondary">{titulo}</h3>
      {children}
    </section>
  );
}

function Linha({
  rotulo,
  valor,
  numerico = false,
}: {
  rotulo: string;
  valor: string | null;
  numerico?: boolean;
}) {
  if (!valor) {
    return null;
  }
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
      <span className="text-text-secondary">{rotulo}</span>
      <span
        className={
          numerico
            ? "min-w-0 cz-num text-foreground"
            : "min-w-0 break-words text-foreground"
        }
      >
        {valor}
      </span>
    </div>
  );
}

function BlocoDeAutorizacao({
  consent,
  estado,
  aoTentarDeNovo,
  contactId,
  timezone,
}: {
  consent: ConsentInfo;
  estado: EstadoDaAutorizacao;
  aoTentarDeNovo: () => void;
  contactId: string;
  timezone: string;
}) {
  if (estado === "carregando") {
    // Antes o painel piscava "Sem autorização" em vermelho a cada conversa
    // aberta, ate a consulta voltar (achado 18).
    return (
      <div role="status">
        <span className="sr-only">Conferindo a autorização de mensagens</span>
        <Skeleton aria-hidden className="h-[60px] w-full rounded-md" />
      </div>
    );
  }
  if (estado === "erro") {
    return (
      <div className="flex items-start gap-2.5 rounded-md bg-neutral-bg px-2.5 py-2.5 text-neutral-text">
        <ShieldQuestion aria-hidden className="mt-px size-4 shrink-0" />
        <div className="grid justify-items-start gap-2">
          <p className="text-[13px] font-semibold">
            Não foi possível verificar a autorização.
          </p>
          <Button variant="outline" size="sm" onClick={aoTentarDeNovo}>
            <RotateCcw aria-hidden />
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }
  const chave = estadoDoConsentimento(consent);
  const definicao = CONSENT_STATUS[chave];
  const tom = STATUS_TONE_VARS[definicao.tone];
  const Icone = definicao.icon;
  const abrirFicha = (
    <Button asChild variant="outline" size="sm">
      <Link href={`/pacientes/${contactId}`}>Abrir a ficha</Link>
    </Button>
  );
  return (
    <div
      className="flex items-start gap-2.5 rounded-md px-2.5 py-2.5"
      style={{ backgroundColor: tom.bg, color: tom.text }}
    >
      {Icone ? <Icone aria-hidden className="mt-px size-4 shrink-0" /> : null}
      <div className="grid min-w-0 justify-items-start gap-1 text-[12.5px] leading-[1.45]">
        <p className="text-[13px] font-semibold">{definicao.label}</p>
        {consent && chave === "autorizado" ? (
          <p>
            {CONSENT_SOURCE_LABEL[consent.source] ?? consent.source} ·{" "}
            <span className="cz-num">
              {dataNaClinica(consent.granted_at, timezone)}
            </span>
          </p>
        ) : null}
        {consent?.revoked_at && chave === "revogado" ? (
          <>
            <p>
              Desde{" "}
              <span className="cz-num">
                {dataNaClinica(consent.revoked_at, timezone)}
              </span>
              . A clínica não consegue responder, nem se ele escrever. Se ele
              autorizou de novo, registre a nova autorização na ficha.
            </p>
            <span className="mt-1">{abrirFicha}</span>
          </>
        ) : null}
        {chave === "sem_autorizacao" ? (
          <>
            <p>
              A clínica não consegue enviar mensagens a este contato. Registre a
              autorização na ficha.
            </p>
            <span className="mt-1">{abrirFicha}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ContextPanel({
  contact,
  consent,
  estadoDaAutorizacao = "pronto",
  aoTentarAutorizacaoDeNovo,
  jornada,
  podeEditarLeads,
  dicaLeads,
  podeAgendar,
  dicaAgenda,
  podeListaDeEspera = true,
  dicaListaDeEspera = "Seu perfil só consulta a lista de espera",
  aoMudarEtapa,
  conversationId,
  etiquetasDaConversa,
  catalogoDeEtiquetas,
  podeEtiquetar,
  dicaEtiquetar,
  ehChefia,
  aoEtiquetar,
  timezone = FUSO_PADRAO,
}: {
  contact: ContactSummary;
  consent: ConsentInfo;
  /** a consulta de autorizacao ainda corre, falhou ou voltou */
  estadoDaAutorizacao?: EstadoDaAutorizacao;
  aoTentarAutorizacaoDeNovo?: () => void;
  jornada: EtapaDaJornada[];
  podeEditarLeads: boolean;
  dicaLeads: string;
  podeAgendar: boolean;
  dicaAgenda: string;
  /** a matriz deixa mexer na lista de espera (profissional e leitura so veem) */
  podeListaDeEspera?: boolean;
  dicaListaDeEspera?: string;
  aoMudarEtapa: () => Promise<unknown> | void;
  conversationId: string;
  etiquetasDaConversa: string[];
  catalogoDeEtiquetas: EtiquetaDeConversa[];
  podeEtiquetar: boolean;
  dicaEtiquetar: string;
  ehChefia: boolean;
  aoEtiquetar: (tags: string[]) => void;
  /** fuso da clinica, para as datas */
  timezone?: string;
}) {
  const marcarConsulta = (
    <>
      <CalendarPlus aria-hidden />
      Marcar consulta
    </>
  );
  const listaDeEspera = (
    <>
      <Hourglass aria-hidden />
      Adicionar à lista de espera
    </>
  );

  return (
    <div className="flex cz-scroll h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <section
        aria-label="Contato"
        className="flex flex-col items-center gap-2 text-center"
      >
        <ContactAvatar
          name={contact.name}
          phone={contact.phone_e164}
          size={56}
        />
        <div className="grid min-w-0 gap-0.5">
          <p className="truncate text-[15px] font-bold text-text-strong">
            {contact.name ?? "Sem nome"}
          </p>
          <p className="cz-num text-xs text-text-secondary">
            {formatarTelefone(contact.phone_e164)}
          </p>
        </div>
        <StatusChip size="sm" definition={TIPO_DO_CONTATO[contact.kind]} />
        <div className="grid w-full gap-2 pt-1">
          {podeAgendar ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/agenda?agendar=${contact.id}`}>
                {marcarConsulta}
              </Link>
            </Button>
          ) : (
            <DisabledWithHint hint={dicaAgenda} className="w-full">
              <Button variant="outline" className="w-full" disabled>
                {marcarConsulta}
              </Button>
            </DisabledWithHint>
          )}
          {podeListaDeEspera ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/espera?adicionar=${contact.id}`}>
                {listaDeEspera}
              </Link>
            </Button>
          ) : (
            <DisabledWithHint hint={dicaListaDeEspera} className="w-full">
              <Button variant="outline" className="w-full" disabled>
                {listaDeEspera}
              </Button>
            </DisabledWithHint>
          )}
        </div>
      </section>

      <Secao titulo="Etiquetas">
        <EtiquetasDaConversa
          conversationId={conversationId}
          tags={etiquetasDaConversa}
          catalogo={catalogoDeEtiquetas}
          podeEtiquetar={podeEtiquetar}
          dicaSemPermissao={dicaEtiquetar}
          ehChefia={ehChefia}
          aoEtiquetar={aoEtiquetar}
        />
      </Secao>

      <Secao titulo="Etapa da jornada">
        <EtapaDoContato
          contactId={contact.id}
          etapaAtual={contact.funnel_stage}
          jornada={jornada}
          podeEditar={podeEditarLeads}
          dicaSemPermissao={dicaLeads}
          aoMudar={aoMudarEtapa}
        />
      </Secao>

      <Secao titulo="Autorização de mensagens">
        <BlocoDeAutorizacao
          consent={consent}
          estado={estadoDaAutorizacao}
          aoTentarDeNovo={() => aoTentarAutorizacaoDeNovo?.()}
          contactId={contact.id}
          timezone={timezone}
        />
      </Secao>

      <Secao titulo="Origem">
        <div className="grid gap-1.5">
          <Linha rotulo="Canal" valor={contact.source_channel} />
          <Linha rotulo="Campanha" valor={contact.source_campaign} />
          <Linha
            rotulo="Primeiro contato"
            valor={
              contact.first_contact_at
                ? dataNaClinica(contact.first_contact_at, timezone)
                : null
            }
            numerico
          />
        </div>
        {!contact.source_channel && !contact.source_campaign ? (
          <p className="text-[12.5px] text-text-secondary">
            Origem ainda não identificada. Ela é capturada sozinha quando o
            contato chega por link de campanha, mensagem de anúncio ou
            palavra-chave.
          </p>
        ) : null}
      </Secao>

      <Secao titulo="Agendamentos e histórico">
        {contact.kind === "paciente" ? (
          <div className="grid gap-2">
            <Button asChild variant="outline" className={LINK_EM_BLOCO}>
              <Link href={`/pacientes/${contact.id}`}>
                <History aria-hidden />
                Abrir a ficha com a linha do tempo
              </Link>
            </Button>
            <Button asChild variant="outline" className={LINK_EM_BLOCO}>
              <Link href="/agenda">
                <CalendarClock aria-hidden />
                Ver a agenda
              </Link>
            </Button>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-[12.5px] text-text-secondary">
            <CalendarClock aria-hidden className="mt-px size-4 shrink-0" />
            Quando este lead agendar, a consulta aparece na Agenda e a ficha
            completa nasce em Pacientes.
          </p>
        )}
      </Secao>
    </div>
  );
}
