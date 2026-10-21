import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { EmptyState } from "@/components/shared/empty-state";
import { BotaoRecarregar } from "@/components/shell/botao-recarregar";

// Erro de leitura do Painel geral (a RPC falhou ou devolveu um formato que
// o codigo nao conhece): nunca vira painel vazio nem zero, que afirmariam o
// que nao foi lido. "Tentar de novo" refaz a tela no servidor
// (router.refresh), sem recarregar o navegador. Server Component; o botao e
// o filho client.
export function ErroDoPainel({
  titulo = TEXTOS_DO_PAINEL.erroAoCarregar,
}: {
  titulo?: string;
}) {
  return (
    <div className="rounded-card border border-border bg-card shadow-sm">
      <EmptyState
        tom="erro"
        title={titulo}
        description={TEXTOS_DO_PAINEL.erroAoCarregarDescricao}
      >
        <BotaoRecarregar rotulo="Tentar de novo" variant="outline" />
      </EmptyState>
    </div>
  );
}
