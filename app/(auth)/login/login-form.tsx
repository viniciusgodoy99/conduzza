"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { signInAction, type ActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );
  const parametros = useSearchParams();
  const avisoDeLink =
    parametros.get("erro") === "link_expirado"
      ? "O link do e-mail venceu ou já foi usado. Peça um novo pela recuperação de senha."
      : null;

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Entrar</h1>
        <p className="text-sm text-text-secondary">
          Use o e-mail e a senha da sua clínica.
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
          placeholder="voce@suaclinica.com.br"
          className="h-11"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>
      {avisoDeLink ? (
        <p
          role="status"
          className="rounded-lg border [border-color:var(--warning)] p-3 text-[12.5px] [color:var(--warning-text)] [background:var(--warning-bg)]"
        >
          {avisoDeLink}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-alert-text text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Entrando..." : "Entrar"}
      </Button>
      <Link
        href="/recuperar-senha"
        className="text-sm text-text-secondary underline-offset-4 hover:text-foreground hover:underline"
      >
        Esqueci minha senha
      </Link>
      <p className="text-sm text-text-secondary">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="underline-offset-4 hover:underline">
          Criar conta
        </Link>
      </p>
    </form>
  );
}
