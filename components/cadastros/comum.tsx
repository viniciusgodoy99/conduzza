"use client";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";

// Pecas minimas compartilhadas pelas abas de Cadastros.

// Acao de escrita: visivel sempre; desabilitada com dica quando o papel nao
// edita (regra do brief: esconder confunde, desabilitar explica).
export function BotaoProtegido({
  podeEditar,
  dica,
  onClick,
  children,
  variant = "default",
  size = "default",
}: {
  podeEditar: boolean;
  dica: string;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}) {
  if (podeEditar) {
    return (
      <Button variant={variant} size={size} onClick={onClick}>
        {children}
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={dica}>
      <Button variant={variant} size={size} disabled>
        {children}
      </Button>
    </DisabledWithHint>
  );
}

export function chipAtivo(active: boolean): {
  texto: string;
  classe: string;
} {
  // Estado com rotulo em texto, nunca so cor.
  return active
    ? { texto: "Ativo", classe: "text-[color:var(--success-text)]" }
    : { texto: "Inativo", classe: "text-text-tertiary" };
}
