"use client";

import { useActionState } from "react";

import { updatePasswordAction, type ActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = {};

// Formulario compartilhado de definicao de senha: usado na redefinicao
// (esqueci a senha) e no aceite de convite. Exige sessao vinda do link.
export function PasswordForm({
  title,
  description,
  submitLabel,
}: {
  title: string;
  description: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    updatePasswordAction,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">{title}</h1>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="h-11"
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-alert-text text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
