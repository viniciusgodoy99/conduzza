"use client";

import { Building2 } from "lucide-react";
import { useActionState } from "react";

import {
  criarClinicaAction,
  type CriarClinicaState,
} from "@/app/(app)/inicio/actions";
import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { SairDaConta } from "@/components/shell/sair-da-conta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inicial: CriarClinicaState = {};

// Primeira clinica do dono do produto. Sem esta tela, quem administra o
// produto entra no sistema e nao tem por onde comecar. O Sair fica fora do
// form de criacao (form dentro de form nao existe em HTML).
export function CriarClinica({
  primeira,
  email,
}: {
  primeira: boolean;
  /** E-mail da conta conectada, mostrado junto do Sair */
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    criarClinicaAction,
    inicial,
  );

  return (
    <EstadoDeTela
      emCartao
      icone={Building2}
      tom="destaque"
      titulo={primeira ? "Crie a primeira clínica" : "Criar clínica"}
      descricao={
        <p>
          {primeira
            ? "Você é o dono do produto. Comece criando uma clínica para atender, e depois convide a equipe dela."
            : "A clínica nasce com você como administrador."}
        </p>
      }
    >
      <form action={formAction} className="grid w-full gap-4 text-left">
        <div className="grid gap-1.5">
          <Label htmlFor="nome">Nome da clínica</Label>
          <Input
            id="nome"
            name="nome"
            required
            placeholder="Clínica Bem Estar"
            className="h-11"
          />
        </div>
        {state.error ? (
          <p role="alert" className="text-[13px] text-alert-text">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="h-11">
          {pending ? "Criando..." : "Criar clínica"}
        </Button>
      </form>
      <SairDaConta
        email={email}
        className="mt-2 w-full border-t border-border pt-4"
      />
    </EstadoDeTela>
  );
}
