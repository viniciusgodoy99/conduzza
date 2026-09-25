"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  reenviarConfirmacaoAction,
  signInAction,
  type ActionState,
  type LoginState,
} from "@/app/(auth)/actions";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inicialDoLogin: LoginState = {};
const inicialDoReenvio: ActionState = {};

// O botao de reenviar fica dentro do aviso, no meio do formulario de login,
// mas pertence a outro formulario (atributo form): formulario dentro de
// formulario nao existe em HTML, e assim o Enter no campo de senha continua
// acionando "Entrar", que e o primeiro botao do formulario de login.
const FORM_DE_REENVIO = "reenvio-de-confirmacao";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    inicialDoLogin,
  );
  const [reenvio, reenviarAction, reenviando] = useActionState(
    reenviarConfirmacaoAction,
    inicialDoReenvio,
  );
  const parametros = useSearchParams();
  const linkNaoAbriu = parametros.get("erro") === "link_expirado";

  // Link de e-mail no formato antigo ({{ .ConfirmationURL }}) devolve a
  // sessao no fragmento da URL, que a rota /confirm nao le; o navegador leva
  // o fragmento ate aqui e o token ficava na barra e no historico de um
  // computador compartilhado (achado 117). Os modelos de supabase/templates
  // nao geram mais fragmento; isto apaga o que um modelo antigo deixar.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  return (
    <>
      <form action={formAction} className="grid gap-5">
        <div className="grid gap-1.5">
          <h1 className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">
            Entrar
          </h1>
          <p className="text-[13.5px] text-text-secondary">
            Use o e-mail e a senha da sua clínica.
          </p>
        </div>
        {linkNaoAbriu ? (
          // Achado 117: a causa pode ser link vencido, link ja usado ou link
          // aberto em outro navegador; a tela nao afirma qual foi.
          <Aviso tom="warning" titulo="Não foi possível abrir o link do e-mail">
            Ele pode ter vencido, já ter sido usado ou ter sido aberto em outro
            navegador. Se você já tem senha, é só entrar. Se não tem ou não
            lembra, peça um link novo em Esqueci minha senha.
          </Aviso>
        ) : null}
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
        {/* "Esqueci minha senha" aparece na linha do rotulo, mas vem DEPOIS
            do campo no codigo: assim o Tab do e-mail cai direto na senha. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
          <Label htmlFor="password" className="col-start-1 row-start-1">
            Senha
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="col-span-2 row-start-2 h-11"
          />
          <Link
            href="/recuperar-senha"
            className="col-start-2 row-start-1 inline-flex min-h-10 items-center rounded-sm text-[13px] font-semibold text-primary-text underline-offset-2 hover:underline"
          >
            Esqueci minha senha
          </Link>
        </div>
        {state.emailNaoConfirmado ? (
          <Aviso tom="warning" role="alert">
            <p>{state.error}</p>
            <Button
              type="submit"
              form={FORM_DE_REENVIO}
              variant="outline"
              disabled={reenviando}
              className="mt-2.5 h-auto min-h-10 w-full py-2 whitespace-normal"
            >
              {reenviando ? (
                <>
                  <LoaderCircle aria-hidden className="animate-spin" />
                  Reenviando...
                </>
              ) : (
                "Reenviar e-mail de confirmação"
              )}
            </Button>
          </Aviso>
        ) : state.error ? (
          <Aviso tom="alert" role="alert">
            {state.error}
          </Aviso>
        ) : null}
        {state.emailNaoConfirmado && reenvio.success ? (
          <Aviso tom="success">{reenvio.success}</Aviso>
        ) : null}
        {state.emailNaoConfirmado && reenvio.error ? (
          <Aviso tom="alert" role="alert">
            {reenvio.error}
          </Aviso>
        ) : null}
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? (
            <>
              <LoaderCircle aria-hidden className="animate-spin" />
              Entrando...
            </>
          ) : (
            "Entrar"
          )}
        </Button>
        <p className="text-[13.5px] text-text-secondary">
          Ainda não tem conta?{" "}
          <Link
            href="/cadastro"
            className="inline-flex min-h-10 items-center rounded-sm font-semibold text-primary-text underline-offset-2 hover:underline"
          >
            Criar conta
          </Link>
        </p>
      </form>
      {state.emailNaoConfirmado ? (
        <form id={FORM_DE_REENVIO} action={reenviarAction}>
          <input type="hidden" name="email" value={state.emailNaoConfirmado} />
        </form>
      ) : null}
    </>
  );
}
