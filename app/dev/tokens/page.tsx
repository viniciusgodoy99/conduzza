import { notFound } from "next/navigation";

import { TokensView } from "./tokens-view";

// Pagina de desenvolvimento: paleta, tipografia, chips de status e componentes
// compartilhados nos dois temas. Nao existe em producao.
export default function TokensPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <TokensView />;
}
