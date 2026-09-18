import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

// Checklist de primeiros passos da clinica recem-criada (extraido da versao
// pre-painel do Inicio, sem mudanca de comportamento). Ele aparece ACIMA do
// painel enquanto houver passo pendente e some quando tudo esta pronto.

export type PassoDoChecklist = {
  concluido: boolean;
  titulo: string;
  descricao: string;
  acao?: { rotulo: string; href: string };
  icone: LucideIcon;
};

export function Checklist({ passos }: { passos: PassoDoChecklist[] }) {
  return (
    <div className="grid gap-3">
      {passos.map((passo) => {
        const Icone = passo.icone;
        return (
          <div
            key={passo.titulo}
            className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full"
              style={
                passo.concluido
                  ? {
                      backgroundColor: "var(--success-bg)",
                      color: "var(--success-text)",
                    }
                  : {
                      backgroundColor: "var(--warning-bg)",
                      color: "var(--warning-text)",
                    }
              }
            >
              <Icone strokeWidth={1.5} className="size-5" />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {passo.titulo}
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={
                    passo.concluido
                      ? {
                          backgroundColor: "var(--success-bg)",
                          color: "var(--success-text)",
                        }
                      : {
                          backgroundColor: "var(--warning-bg)",
                          color: "var(--warning-text)",
                        }
                  }
                >
                  {passo.concluido ? "Feito" : "Pendente"}
                </span>
              </span>
              <span className="text-[12.5px] text-text-secondary">
                {passo.descricao}
              </span>
            </div>
            {passo.acao ? (
              <Button
                asChild
                variant={passo.concluido ? "outline" : "default"}
                size="sm"
              >
                <Link href={passo.acao.href}>{passo.acao.rotulo}</Link>
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
