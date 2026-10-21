import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";

// Clinica que nao esta no Painel geral: id invalido, clinica removida ou de
// teste automatico (as suites nao entram no painel). Dentro do shell, em
// portugues e com caminho de volta, no lugar do 404 do Next.
export default function ClinicaNaoEncontradaNoPainel() {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <EstadoDeTela
        icone={SearchX}
        titulo="Clínica não encontrada no painel"
        descricao={
          <p>
            A clínica pode ter sido removida, ou o link está incompleto. As
            clínicas de teste automático não aparecem no painel.
          </p>
        }
      >
        <Button asChild variant="outline">
          <Link href="/painel-geral">
            <ArrowLeft aria-hidden />
            Voltar para o painel geral
          </Link>
        </Button>
      </EstadoDeTela>
    </div>
  );
}
