import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
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
  MODULE_KEYS,
  MODULE_LABELS,
  PAPEIS_NA_TELA,
  papelDoBanco,
  PERMISSION_MATRIX,
  ROTULO_DO_PAPEL,
} from "@/lib/domain/permissions";

// Referencia de consulta de quem escolhe o papel de um colega: a matriz
// inteira, celula a celula (a frase por papel saiu em 26/11/2026, pedido do
// dono de tela que mostra e nao explica; o que a matriz nao diz fica no
// rodape). Somente leitura: a matriz vem da
// secao 5 do brief e nao se edita por clinica (docs/06, C25). O nivel de
// acesso e sempre StatusChip (icone, texto de ACCESS_LABELS e cor, de
// ACCESS_LEVEL_STATUS), e a tabela rola sozinha no celular com a coluna das
// telas presa a esquerda. E a UNICA table da aba de equipe (e2e).
//
// Implementador (onda 5, item 18): coluna propria, logo depois do
// Administrador, com as celulas do administrador (no banco ele e um
// administrador com a marca; a matriz nao muda). O que ele nao faz (mexer
// em administrador, exportar os leads) esta no rodape.

export function PainelPapeis() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>O que cada papel pode fazer</CardTitle>
      </CardHeader>

      <Table>
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

      <CardFooter className="grid gap-1 text-xs text-text-secondary">
        <p>
          Só o que é dele: os próprios atendimentos, horários e números.
        </p>
        <p>
          Implementador: vê e faz tudo o que o administrador faz, menos mexer
          em administradores e exportar os leads.
        </p>
      </CardFooter>
    </Card>
  );
}
