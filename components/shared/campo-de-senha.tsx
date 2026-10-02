"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Campo de senha com o olho para mostrar o que foi digitado (pedido do dono em
// 02/10/2026, revoga o "nada de botao Mostrar senha" do docs/06 5.13). Usado
// no login, no cadastro, no convite e na redefinicao. O token da Meta NAO usa:
// e segredo colado, e o valor salvo nunca volta para a tela.
//
// - O campo e o mesmo no do DOM nos dois estados (so o type muda), entao o
//   valor se mantem ao alternar. Nao controlado: ref e props vao para o Input.
// - O botao e type="button" (nunca envia o formulario: no login o Enter tem
//   de cair em "Entrar") e fica logo depois do campo na ordem do Tab.
// - O rotulo muda junto com o estado ("Mostrar senha"/"Ocultar senha"). Por
//   isso NAO ha aria-pressed: rotulo que muda junto com "pressionado" e lido
//   duas vezes ("Ocultar senha, pressionado").
// - Com o texto a mostra, corretor, maiuscula automatica e sugestao do
//   teclado do celular passariam a mexer na senha: ficam desligados sempre.
// - Ao enviar o formulario a senha volta a ficar oculta.

export type CampoDeSenhaProps = Omit<
  React.ComponentProps<"input">,
  "type" | "autoComplete" | "id"
> & {
  /** Liga o Label (htmlFor) e o aria-controls do botao. */
  id: string;
  /** Obrigatorio: senha nova ou senha atual, nunca solto. */
  autoComplete: "new-password" | "current-password";
  /**
   * Complemento do rotulo do botao: "senha" da "Mostrar senha"/"Ocultar
   * senha". Num formulario com dois campos, o segundo usa outro texto para os
   * botoes nao terem o mesmo nome.
   */
  oQueMostrar?: string;
  /** Classe do contorno (posicao na grade). `className` vai para o campo. */
  classNameDoContainer?: string;
};

function juntarRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (no) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(no);
      } else if (ref) {
        ref.current = no;
      }
    }
  };
}

export function CampoDeSenha({
  id,
  autoComplete,
  oQueMostrar = "senha",
  classNameDoContainer,
  className,
  disabled,
  ref,
  ...props
}: CampoDeSenhaProps) {
  const [visivel, setVisivel] = useState(false);
  const campo = useRef<HTMLInputElement | null>(null);
  const refDoCampo = useMemo(() => juntarRefs(campo, ref), [ref]);

  useEffect(() => {
    const formulario = campo.current?.form;
    if (!formulario) {
      return;
    }
    const ocultar = () => setVisivel(false);
    formulario.addEventListener("submit", ocultar);
    return () => formulario.removeEventListener("submit", ocultar);
  }, []);

  const Icone = visivel ? EyeOff : Eye;

  return (
    // grid: o campo vira item de grade e o contorno fica com a altura exata
    // dele, como quando o Input era filho direto da grade do formulario.
    <div className={cn("relative grid", classNameDoContainer)}>
      <Input
        {...props}
        ref={refDoCampo}
        id={id}
        type={visivel ? "text" : "password"}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        disabled={disabled}
        // pr-12: o texto nao passa por baixo do olho. O olho proprio do Edge
        // (::-ms-reveal) some para nao haver dois.
        className={cn(
          "pr-12 [&::-ms-clear]:hidden [&::-ms-reveal]:hidden",
          className,
        )}
      />
      {/* 40px reais dentro do campo de 44px (h-11), centrado na altura. O
          contorno de foco entra no botao (offset negativo) para nao vazar
          da borda do campo. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${visivel ? "Ocultar" : "Mostrar"} ${oQueMostrar}`}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setVisivel((atual) => !atual)}
        className="absolute inset-y-0 right-0.5 my-auto text-text-secondary focus-visible:-outline-offset-2"
      >
        <Icone aria-hidden />
      </Button>
    </div>
  );
}
