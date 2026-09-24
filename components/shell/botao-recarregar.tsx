"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Refaz a tela no servidor sem recarregar o navegador (router.refresh): o
// layout le de novo o vinculo com a clinica. Usado em "Atualizar" da espera
// de liberacao e em "Tentar de novo" quando o acesso nao carregou.
export function BotaoRecarregar({
  rotulo,
  variant = "default",
}: {
  rotulo: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [recarregando, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      className="h-10 px-4"
      disabled={recarregando}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw
        aria-hidden
        className={cn(
          "size-4",
          recarregando && "animate-spin motion-reduce:animate-none",
        )}
      />
      {rotulo}
    </Button>
  );
}
