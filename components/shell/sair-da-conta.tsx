import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Saida das telas sem o shell (aguardando liberacao, sem clinica, acesso que
// nao carregou, criar clinica, escolher clinica). Sem ela a pessoa ficava
// presa: o /login manda quem tem sessao de volta para a area logada, que
// devolve a mesma tela, e o computador da recepcao so saia da conta com
// janela anonima (achados 4, 107 e 119 da revisao). O e-mail mostra em que
// conta a pessoa esta.
//
// Form com a Server Action: funciona em Server Component e sem JavaScript.
// Nunca dentro de outro form.
export function SairDaConta({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  return (
    <div className={cn("grid justify-items-center gap-2", className)}>
      {email ? (
        <p className="text-xs break-all text-text-secondary">
          Conectado como{" "}
          <span className="font-semibold text-foreground">{email}</span>
        </p>
      ) : null}
      <form action={signOutAction}>
        <Button type="submit" variant="outline" className="h-10 px-4">
          <LogOut aria-hidden className="size-4" />
          Sair
        </Button>
      </form>
    </div>
  );
}
