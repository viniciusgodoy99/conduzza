import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACCESS_LABELS,
  MODULE_KEYS,
  MODULE_LABELS,
  PERMISSION_MATRIX,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
} from "@/lib/domain/permissions";
import type { Access } from "@/lib/domain/permissions";

// Referencia de consulta de quem escolhe o papel de um colega: uma frase por
// papel e a matriz inteira, celula a celula. O nivel de acesso e sempre TEXTO
// (a cor so reforca), e a tabela rola sozinha no celular em vez de estourar.

const COR_DO_ACESSO: Record<Access, string> = {
  tudo: "[color:var(--success-text)]",
  ver: "text-text-secondary",
  proprio: "[color:var(--warning-text)]",
  nada: "text-text-tertiary",
};

export function PainelPapeis() {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((papel) => (
          <li key={papel} className="rounded-lg border bg-card p-3">
            <p className="text-sm font-medium">{ROLE_LABELS[papel]}</p>
            <p className="text-[12.5px] text-text-secondary">
              {ROLE_DESCRIPTIONS[papel]}
            </p>
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-44">Tela</TableHead>
              {ROLES.map((papel) => (
                <TableHead key={papel} className="min-w-28">
                  {ROLE_LABELS[papel]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULE_KEYS.map((modulo) => (
              <TableRow key={modulo}>
                <TableCell className="font-medium">
                  {MODULE_LABELS[modulo]}
                </TableCell>
                {ROLES.map((papel) => {
                  const acesso = PERMISSION_MATRIX[modulo][papel];
                  return (
                    <TableCell key={papel} className={COR_DO_ACESSO[acesso]}>
                      {ACCESS_LABELS[acesso]}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-text-tertiary">
        Só o que é dele: a pessoa vê e altera apenas os próprios atendimentos,
        os próprios horários e os próprios números.
      </p>
    </div>
  );
}
