"use client";

import { CalendarPlus, Hourglass, MessageSquareText } from "lucide-react";
import Link from "next/link";

import { BlocoFicha } from "@/components/pacientes/comum";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";

// Acoes rapidas da ficha, incluindo a entrada na lista de espera (4.9): o
// link abre a Tela 10 com o paciente ja escolhido no modal.
export function AcoesPaciente({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId: string | null;
}) {
  return (
    <BlocoFicha titulo="Ações">
      {/* o span da dica nasce w-fit; aqui os tres botoes ocupam a coluna */}
      <div className="grid gap-2 [&>span]:w-full">
        {conversationId ? (
          <Button variant="outline" className="h-10 w-full" asChild>
            <Link href={`/atendimento?conversa=${conversationId}`}>
              <MessageSquareText strokeWidth={1.5} className="size-4" />
              Abrir conversa
            </Link>
          </Button>
        ) : (
          <DisabledWithHint hint="Este paciente não tem conversa aberta no WhatsApp">
            <Button variant="outline" className="h-10 w-full" disabled>
              <MessageSquareText strokeWidth={1.5} className="size-4" />
              Abrir conversa
            </Button>
          </DisabledWithHint>
        )}
        <Button variant="outline" className="h-10 w-full" asChild>
          <Link href="/agenda">
            <CalendarPlus strokeWidth={1.5} className="size-4" />
            Agendar
          </Link>
        </Button>
        <Button variant="outline" className="h-10 w-full" asChild>
          <Link href={`/espera?adicionar=${contactId}`}>
            <Hourglass strokeWidth={1.5} className="size-4" />
            Adicionar à lista de espera
          </Link>
        </Button>
      </div>
    </BlocoFicha>
  );
}
