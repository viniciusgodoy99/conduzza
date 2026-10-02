"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import {
  updatePasswordAction,
  type SenhaNovaState,
} from "@/app/(auth)/actions";
import { SenhaComConfirmacao } from "@/app/(auth)/components/senha-com-confirmacao";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";

const initialState: SenhaNovaState = {};

// Formulario compartilhado de definicao de senha: usado na redefinicao
// (esqueci a senha) e no aceite de convite. Exige sessao vinda do link. A
// senha nova vem duas vezes, com o olho nos dois campos (02/10/2026).
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
      <SenhaComConfirmacao rotulo="Nova senha" />
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
