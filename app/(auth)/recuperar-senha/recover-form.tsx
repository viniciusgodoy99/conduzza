"use client";

import Link from "next/link";
import { useActionState } from "react";

import { recoverPasswordAction, type ActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = {};

export function RecoverForm() {
  const [state, formAction, pending] = useActionState(
    recoverPasswordAction,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Recuperar senha</h1>
        <p className="text-sm text-text-secondary">
          Enviamos um link de redefinição para o seu e-mail.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-11"
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-alert-text text-sm">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-success-text text-sm">
          {state.success}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Enviando..." : "Enviar link"}
      </Button>
      <Link
        href="/login"
        className="text-sm text-text-secondary underline-offset-4 hover:text-foreground hover:underline"
      >
        Voltar para o login
      </Link>
    </form>
  );
}
