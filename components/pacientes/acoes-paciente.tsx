"use client";

import { CalendarPlus, Hourglass, MessageSquareText } from "lucide-react";
import Link from "next/link";

import { BlocoFicha } from "@/components/pacientes/comum";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";

// Acoes rapidas da ficha (achado 73). "Agendar" abre a Agenda com o modal ja
// no paciente (/agenda?agendar=<id>, o mesmo deep link do Inbox) e "Adicionar
// a lista de espera" abre a Tela 10 com o paciente escolhido. "Abrir conversa"
// leva a conversa aberta ou, sem ela, a mais recente, mesmo resolvida (achado
// 70: o Atendimento abre resolvida pelo link); so fica desabilitado quando o
// paciente nao tem conversa nenhuma que a pessoa possa ver. Cada atalho
// respeita a permissao do modulo DE DESTINO: sem ela o botao fica visivel,
// desabilitado e com a dica (regra do brief), em vez de levar a uma tela
// onde nada acontece.
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
  contactId,
  conversationId,
  podeAgendar,
  dicaAgendar,
  podeEsperar,
  dicaEsperar,
  soDaSuaAgenda = false,
}: {
  contactId: string;
  /** Conversa aberta ou, sem ela, a mais recente; null sem conversa nenhuma */
  conversationId: string | null;
  podeAgendar: boolean;
  dicaAgendar: string;
  podeEsperar: boolean;
  dicaEsperar: string;
  /** Profissional: a RLS so mostra as conversas atribuidas a ele */
  soDaSuaAgenda?: boolean;
}) {
  return (
    <BlocoFicha titulo="Ações">
      <div className="grid gap-2">
        <Atalho
          href={`/atendimento?conversa=${conversationId ?? ""}`}
          pode={conversationId !== null}
          dica={
            soDaSuaAgenda
              ? "Nenhuma conversa deste paciente atribuída a você"
              : "Este paciente ainda não tem conversa no WhatsApp"
          }
          icone={<MessageSquareText aria-hidden />}
        >
          Abrir conversa
        </Atalho>
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
