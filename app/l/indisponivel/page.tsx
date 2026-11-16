import { Unlink } from "lucide-react";
import type { Metadata } from "next";

import { EstadoDeTela, TelaSemShell } from "@/components/shell/estado-de-tela";

// Pagina publica, sem login, para onde o link rastreado (app/l/[codigo])
// manda quem tocou num link desativado, que nao existe mais ou de uma clinica
// sem numero de WhatsApp. Nunca um erro: uma frase que a pessoa entende. Fora
// do middleware (matcher exclui l/).

export const metadata: Metadata = {
  title: "Link indisponível",
  robots: { index: false, follow: false },
};

export default function LinkIndisponivel() {
  return (
    <TelaSemShell>
      <EstadoDeTela
        emCartao
        icone={Unlink}
        titulo="Este link não está disponível"
        descricao={
          <p>
            O link pode ter sido desativado. Procure a clínica pelo telefone ou
            pelas redes sociais dela.
          </p>
        }
      />
    </TelaSemShell>
  );
}
