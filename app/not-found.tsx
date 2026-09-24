import { SearchX } from "lucide-react";
import Link from "next/link";

import { EstadoDeTela, TelaSemShell } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";

// Endereco que nao existe em lugar nenhum do app (fora de qualquer grupo de
// rotas, entao sem o shell). Em portugues e com caminho de volta: sem este
// arquivo aparecia o 404 do Next, em ingles (achado 113 da revisao). Quem
// estiver sem sessao e mandado do Inicio para o login pelo proprio layout.
export default function EnderecoNaoEncontrado() {
  return (
    <TelaSemShell>
      <EstadoDeTela
        emCartao
        icone={SearchX}
        titulo="Esta página não existe ou você não tem acesso"
        descricao={
          <p>
            Confira o endereço. Se ele veio de um link, o link pode estar errado
            ou ser de outra clínica.
          </p>
        }
      >
        <Button asChild className="h-10 px-4">
          <Link href="/inicio">Ir para o Início</Link>
        </Button>
      </EstadoDeTela>
    </TelaSemShell>
  );
}
