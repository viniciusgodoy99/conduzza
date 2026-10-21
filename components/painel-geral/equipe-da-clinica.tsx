import { Users } from "lucide-react";
import { useId } from "react";

import { contagemNoPainel } from "@/components/painel-geral/painel-geral";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AdministradorNoPainel } from "@/lib/queries/painel-geral";

// A equipe da clinica no detalhe do Painel geral (onda 1): quantos membros
// ativos, quantos pedidos de entrada esperam liberacao e os administradores
// ativos com nome e e-mail, para a equipe Conduzza saber com quem falar. E
// dado da EQUIPE da clinica, nao de paciente. Server Component.

export function textoDaEquipe(ativos: number, pendentes: number): string {
  const membros =
    ativos === 1
      ? "1 membro ativo"
      : `${contagemNoPainel(ativos)} membros ativos`;
  if (pendentes === 0) {
    return `${membros}.`;
  }
  return pendentes === 1
    ? `${membros} e 1 pedido de entrada esperando liberação.`
    : `${membros} e ${contagemNoPainel(pendentes)} pedidos de entrada esperando liberação.`;
}

export function EquipeDaClinica({
  membrosAtivos,
  membrosPendentes,
  administradores,
}: {
  membrosAtivos: number;
  membrosPendentes: number;
  administradores: AdministradorNoPainel[];
}) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={`${id}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Users className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${id}-titulo`}>Equipe da clínica</CardTitle>
            <CardDescription>
              {textoDaEquipe(membrosAtivos, membrosPendentes)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="cz-eyebrow text-text-secondary">Administradores</p>
        {administradores.length === 0 ? (
          <p className="text-[13px] text-text-secondary">
            Nenhum administrador ativo.
          </p>
        ) : (
          <ul className="grid gap-2" aria-label="Administradores ativos">
            {administradores.map((admin, indice) => (
              <li
                key={`${admin.email ?? ""}-${indice}`}
                className="grid gap-0.5 rounded-lg bg-surface-2 px-3.5 py-2.5"
              >
                <span className="font-semibold break-words text-text-strong">
                  {admin.nome ?? "Sem nome no perfil"}
                </span>
                {admin.email ? (
                  <a
                    href={`mailto:${admin.email}`}
                    className="inline-flex min-h-10 items-center text-[13px] break-all text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {admin.email}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
