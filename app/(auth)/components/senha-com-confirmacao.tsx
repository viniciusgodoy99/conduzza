"use client";

import { OctagonAlert } from "lucide-react";
import { useRef, useState } from "react";

import { CampoDeSenha } from "@/components/shared/campo-de-senha";
import { Label } from "@/components/ui/label";
import {
  DICA_DA_SENHA,
  SENHA_MINIMA,
  SENHAS_DIFERENTES,
} from "@/lib/auth/senha";

// Senha nova digitada duas vezes (pedido do dono em 02/10/2026): cadastro
// (clinica e codigo), convite e redefinicao. Os dois campos tem o olho.
//
// A conferencia no navegador usa a validacao nativa, como o required e o
// minLength ja fazem nessas telas: com as senhas diferentes, a confirmacao
// recebe setCustomValidity, o envio nao acontece (nenhuma ida ao servidor) e o
// navegador poe o foco nela. O servidor confere de novo (lib/auth/senha.ts),
// porque o cliente nunca e garantia.
//
// Os valores sao lidos pelos ref e nao ficam em estado do React: com
// <form action>, o React 19 limpa os campos nao controlados quando a action
// termina, e um valor guardado em estado ficaria velho depois da limpeza.
//
// A mensagem aparece ao sair do campo ou ao tentar enviar, e some na hora em
// que as senhas ficam iguais (nao aparece no meio da digitacao).

export const ID_DA_SENHA = "password";
export const ID_DA_CONFIRMACAO = "confirmacao";
const ID_DA_DICA = "password-dica";
const ID_DO_ERRO = "confirmacao-erro";

export function SenhaComConfirmacao({
  rotulo = "Senha",
}: {
  /** Rotulo do primeiro campo: "Senha" no cadastro, "Nova senha" no PasswordForm. */
  rotulo?: string;
}) {
  const senha = useRef<HTMLInputElement>(null);
  const confirmacao = useRef<HTMLInputElement>(null);
  const [erroVisivel, setErroVisivel] = useState(false);

  // Marca a confirmacao como invalida quando difere da senha e devolve se
  // estao diferentes. Confirmacao vazia fica com o required (o navegador pede
  // para preencher): "nao sao iguais" so com algo digitado. Sem trim: espaco
  // faz parte da senha.
  function conferir(): boolean {
    const campo = confirmacao.current;
    if (!campo) {
      return false;
    }
    const diferentes =
      campo.value !== "" && campo.value !== (senha.current?.value ?? "");
    campo.setCustomValidity(diferentes ? SENHAS_DIFERENTES : "");
    return diferentes;
  }

  function aoDigitar() {
    if (!conferir()) {
      setErroVisivel(false);
    }
  }

  function aoSairOuRecusar() {
    setErroVisivel(conferir());
  }

  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={ID_DA_SENHA}>{rotulo}</Label>
        <CampoDeSenha
          ref={senha}
          id={ID_DA_SENHA}
          name="password"
          autoComplete="new-password"
          required
          minLength={SENHA_MINIMA}
          aria-describedby={ID_DA_DICA}
          onInput={aoDigitar}
          onBlur={aoSairOuRecusar}
          className="h-11"
        />
        <p id={ID_DA_DICA} className="text-xs text-text-secondary">
          {DICA_DA_SENHA}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ID_DA_CONFIRMACAO}>Repita a senha</Label>
        <CampoDeSenha
          ref={confirmacao}
          id={ID_DA_CONFIRMACAO}
          name="confirmacao"
          autoComplete="new-password"
          required
          oQueMostrar="a senha repetida"
          aria-invalid={erroVisivel || undefined}
          aria-describedby={ID_DO_ERRO}
          onInput={aoDigitar}
          onBlur={aoSairOuRecusar}
          onInvalid={aoSairOuRecusar}
          className="h-11"
        />
        {/* Regiao sempre montada para o leitor de tela anunciar a troca. O
            erro vai nas 3 camadas: icone de forma propria, texto e cor. */}
        <div id={ID_DO_ERRO} aria-live="polite">
          {erroVisivel ? (
            <p className="flex items-start gap-1.5 text-xs leading-[1.4] font-medium text-alert-text">
              <OctagonAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>{SENHAS_DIFERENTES}</span>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
