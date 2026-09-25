"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { recoverPasswordAction, type ActionState } from "@/app/(auth)/actions";
import { Aviso } from "@/components/shared/aviso";
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
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-1.5">
        <h1 className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">
          Recuperar senha
        </h1>
        {/* Achado 128: o texto antigo dizia "Enviamos" antes de a pessoa
            digitar qualquer coisa. */}
        <p className="text-[13.5px] text-text-secondary">
          Informe seu e-mail e enviamos um link para criar uma senha nova.
        </p>
      </div>
      <div className="grid gap-1.5">
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
      {state.error ? (
        <Aviso tom="alert" role="alert">
          {state.error}
        </Aviso>
      ) : null}
      {state.success ? <Aviso tom="success">{state.success}</Aviso> : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? (
          <>
            <LoaderCircle aria-hidden className="animate-spin" />
            Enviando...
          </>
        ) : (
          "Enviar link"
        )}
      </Button>
      <Link
        href="/login"
        className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-sm text-[13px] font-semibold text-text-secondary underline-offset-2 hover:text-text-strong hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Voltar para o login
      </Link>
    </form>
  );
}
