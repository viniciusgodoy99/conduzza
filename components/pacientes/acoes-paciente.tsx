"use client";

import { CalendarPlus, Hourglass, MessageSquareText } from "lucide-react";
import Link from "next/link";

import { BotaoIniciarConversa } from "@/components/atendimento/iniciar-conversa";
import { BlocoFicha } from "@/components/pacientes/comum";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";

// Acoes rapidas da ficha (achado 73). "Agendar" abre a Agenda com o modal ja
// no paciente (/agenda?agendar=<id>, o mesmo deep link do Inbox) e "Adicionar
// a lista de espera" abre a Tela 10 com o paciente escolhido. "Abrir conversa"
// leva a conversa aberta ou, sem ela, a mais recente, mesmo resolvida (achado
// 70: o Atendimento abre resolvida pelo link). Sem conversa nenhuma que a
// pessoa possa ver, o lugar e do "Iniciar conversa" (decisao do dono em
// 20/10/2026): a primeira mensagem pelo sistema, so com a autorizacao
// registrada e para quem atende e edita pacientes; sem isso, visivel e
// desabilitado com a dica. Cada atalho respeita a permissao do modulo DE
// DESTINO: sem ela o botao fica visivel, desabilitado e com a dica (regra do
// brief), em vez de levar a uma tela onde nada acontece.
function Atalho({
  href,
  pode,
  dica,
  icone,
  children,
}: {
  href: string;
  pode: boolean;
  dica: string;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  if (pode) {
    return (
      <Button variant="outline" className="w-full" asChild>
        <Link href={href}>
          {icone}
          {children}
        </Link>
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={dica} className="w-full">
      <Button variant="outline" className="w-full" disabled>
        {icone}
        {children}
      </Button>
    </DisabledWithHint>
  );
}

export function AcoesPaciente({
  clinicId,
  contactId,
  nome,
  telefone,
  conversationId,
  podeAgendar,
  dicaAgendar,
  podeEsperar,
  dicaEsperar,
  podeIniciarConversa,
  dicaIniciarConversa,
  autorizado,
  soDaSuaAgenda = false,
}: {
  /** Clinica ativa: os numeros por onde a conversa pode sair */
  clinicId: string;
  contactId: string;
  nome: string | null;
  telefone: string;
  /** Conversa aberta ou, sem ela, a mais recente; null sem conversa nenhuma */
  conversationId: string | null;
  podeAgendar: boolean;
  dicaAgendar: string;
  podeEsperar: boolean;
  dicaEsperar: string;
  /** Atendimento e pacientes editaveis: a primeira mensagem pelo sistema */
  podeIniciarConversa: boolean;
  /** Dica do "Iniciar conversa" desabilitado por papel ("" quando pode) */
  dicaIniciarConversa: string;
  /** Autorizacao para receber mensagens vigente */
  autorizado: boolean;
  /** Profissional: a RLS so mostra as conversas atribuidas a ele */
  soDaSuaAgenda?: boolean;
}) {
  // O profissional nao inicia conversa, e para ele "sem conversa" pode ser
  // "nenhuma atribuida a voce": a dica diz as duas coisas.
  const dicaDoInicio =
    soDaSuaAgenda && !podeIniciarConversa
      ? `Nenhuma conversa deste paciente atribuída a você. ${dicaIniciarConversa}`.trim()
      : dicaIniciarConversa;
  return (
    <BlocoFicha titulo="Ações">
      <div className="grid gap-2">
        {conversationId !== null ? (
          <Atalho
            href={`/atendimento?conversa=${conversationId}`}
            pode
            dica=""
            icone={<MessageSquareText aria-hidden />}
          >
            Abrir conversa
          </Atalho>
        ) : (
          <BotaoIniciarConversa
            clinicId={clinicId}
            contato={{ id: contactId, nome, telefone }}
            podeIniciar={podeIniciarConversa}
            dicaSemPermissao={dicaDoInicio}
            autorizado={autorizado}
            className="w-full"
          />
        )}
        <Atalho
          href={`/agenda?agendar=${contactId}`}
          pode={podeAgendar}
          dica={dicaAgendar}
          icone={<CalendarPlus aria-hidden />}
        >
          Agendar
        </Atalho>
        <Atalho
          href={`/espera?adicionar=${contactId}`}
          pode={podeEsperar}
          dica={dicaEsperar}
          icone={<Hourglass aria-hidden />}
        >
          Adicionar à lista de espera
        </Atalho>
      </div>
    </BlocoFicha>
  );
}
