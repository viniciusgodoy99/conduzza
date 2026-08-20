"use client";

import { Building2 } from "lucide-react";
import { useActionState } from "react";

import {
  criarClinicaAction,
  type CriarClinicaState,
} from "@/app/(app)/inicio/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inicial: CriarClinicaState = {};

// Primeira clinica do dono do produto. Sem esta tela, quem administra o
// produto entra no sistema e nao tem por onde comecar.
export function CriarClinica({ primeira }: { primeira: boolean }) {
  const [state, formAction, pending] = useActionState(
    criarClinicaAction,
    inicial,
  );

  return (
    <form
      action={formAction}
      className="grid w-full max-w-md gap-4 rounded-lg border bg-card p-6"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Building2 strokeWidth={1.5} className="size-6 text-primary" />
      </span>
      <div className="grid gap-1">
        <h1 className="text-[17px] font-semibold">
          {primeira ? "Crie a primeira clínica" : "Criar clínica"}
        </h1>
        <p className="text-sm text-text-secondary">
          {primeira
            ? "Você é o dono do produto. Comece criando uma clínica para atender, e depois convide a equipe dela."
            : "A clínica nasce com você como administrador."}
        </p>
      </div>
      <div className="grid gap-2">
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
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Criando..." : "Criar clínica"}
      </Button>
    </form>
  );
}
