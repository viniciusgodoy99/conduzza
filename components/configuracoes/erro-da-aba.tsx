import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";

/** O cartao de erro de uma aba (ou de um passo) cuja leitura falhou. */
export function ErroDaAba({ titulo }: { titulo: string }) {
  return (
    <Card>
      <EmptyState
        tom="erro"
        title={titulo}
        description="Recarregue a página. Se continuar, fale com o suporte."
      />
    </Card>
  );
}
