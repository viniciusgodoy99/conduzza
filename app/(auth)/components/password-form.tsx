"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import {
  updatePasswordAction,
  type SenhaNovaState,
} from "@/app/(auth)/actions";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SenhaNovaState = {};

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
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-1.5">
        <h1 className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="text-[13.5px] text-text-secondary">{description}</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-describedby="password-dica"
          className="h-11"
        />
        <p id="password-dica" className="text-xs text-text-secondary">
          Pelo menos 8 caracteres.
        </p>
      </div>
      {state.error ? (
        <Aviso
          tom="alert"
          role="alert"
          acao={
            state.pedirLinkNovo ? (
              <Link
                href="/recuperar-senha"
                className="inline-flex min-h-10 items-center rounded-sm text-[13px] font-semibold whitespace-nowrap underline underline-offset-2"
              >
                Pedir link novo
              </Link>
            ) : undefined
          }
        >
          {state.error}
        </Aviso>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? (
          <>
            <LoaderCircle aria-hidden className="animate-spin" />
            Salvando...
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}
