import { SearchX } from "lucide-react";
import Link from "next/link";

import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";

// Pagina inexistente DENTRO da area logada (dentro do shell, com o menu).
// Pega os notFound() das telas, como a ficha de um paciente que nao existe
// mais ou que e de outra clinica (a RLS esconde e a tela chama notFound()).
// Sem este arquivo aparecia o 404 do Next, em ingles e sem caminho de volta
// (achado 113 da revisao). O endereco digitado errado cai no app/not-found.
export default function PaginaNaoEncontrada() {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <EstadoDeTela
        icone={SearchX}
        titulo="Esta página não existe ou você não tem acesso"
        descricao={
          <p>
            O endereço pode estar errado, ou o registro foi removido ou é de
            outra clínica.
          </p>
        }
      >
        <Button asChild className="h-10 px-4">
          <Link href="/inicio">Ir para o Início</Link>
        </Button>
      </EstadoDeTela>
    </div>
  );
}
