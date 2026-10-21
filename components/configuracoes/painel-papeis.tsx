import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACCESS_LEVEL_STATUS } from "@/lib/design/status";
import {
  DESCRICAO_DO_PAPEL,
  MODULE_KEYS,
  MODULE_LABELS,
  PAPEIS_NA_TELA,
  papelDoBanco,
  PERMISSION_MATRIX,
  ROTULO_DO_PAPEL,
} from "@/lib/domain/permissions";

// Referencia de consulta de quem escolhe o papel de um colega: uma frase por
// papel e a matriz inteira, celula a celula. Somente leitura: a matriz vem da
// secao 5 do brief e nao se edita por clinica (docs/06, C25). O nivel de
// acesso e sempre StatusChip (icone, texto de ACCESS_LABELS e cor, de
// ACCESS_LEVEL_STATUS), e a tabela rola sozinha no celular com a coluna das
// telas presa a esquerda. E a UNICA table da aba de equipe (e2e).
//
// Implementador (onda 5, item 18): coluna propria, logo depois do
// Administrador, com as celulas do administrador (no banco ele e um
// administrador com a marca; a matriz nao muda). O que ele nao faz (mexer
// em administrador, exportar os leads) esta na frase do papel.

export function PainelPapeis() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>O que cada papel pode fazer</CardTitle>
        <CardDescription>
          Confira antes de escolher o papel de alguém da equipe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PAPEIS_NA_TELA.map((papel) => (
            <li
              key={papel}
              className="grid gap-1 rounded-xl bg-surface-4 p-3.5"
            >
              <p className="text-[13.5px] font-bold text-text-strong">
                {ROTULO_DO_PAPEL[papel]}
              </p>
              <p className="text-[12.5px] text-text-secondary">
                {DESCRICAO_DO_PAPEL[papel]}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>

      <Table containerClassName="border-t border-border">
        <TableHeader>
          <TableRow>
            <TableHead className="left-0 z-[2] min-w-44">Tela</TableHead>
            {PAPEIS_NA_TELA.map((papel) => (
              <TableHead key={papel} className="min-w-36">
                {ROTULO_DO_PAPEL[papel]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {MODULE_KEYS.map((modulo) => (
            <TableRow key={modulo}>
              <TableCell className="sticky left-0 z-[1] bg-card font-semibold text-text-strong">
                {MODULE_LABELS[modulo]}
              </TableCell>
              {PAPEIS_NA_TELA.map((papel) => {
                const acesso = PERMISSION_MATRIX[modulo][papelDoBanco(papel)];
                return (
                  <TableCell key={papel}>
                    <StatusChip
                      size="sm"
                      definition={ACCESS_LEVEL_STATUS[acesso]}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <CardFooter>
        <p className="text-xs text-text-secondary">
          Só o que é dele: a pessoa vê e altera apenas os próprios atendimentos,
          os próprios horários e os próprios números.
        </p>
      </CardFooter>
    </Card>
  );
}
