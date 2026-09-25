import { ArrowLeft, UserRoundX } from "lucide-react";
import Link from "next/link";

import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth/active-clinic";

// Ficha que nao existe para esta pessoa (achado 77): id invalido, contato
// apagado ou de OUTRA clinica (a RLS esconde e a pagina chama notFound()).
// Dentro do shell, em portugues e com caminho de volta, no lugar do 404 do
// Next. Quem trabalha em duas clinicas costuma cair aqui por um link guardado
// com a outra clinica ativa: a dica diz como trocar.
export default async function FichaNaoEncontrada() {
  const context = await getSessionContext();
  // So oferece a troca para quem tem mais de uma clinica ativa: com uma so,
  // a tela de escolha manda de volta para o Inicio.
  const variasClinicas =
    (context?.memberships.filter((vinculo) => vinculo.status === "ativo")
      .length ?? 0) > 1;

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <EstadoDeTela
        icone={UserRoundX}
        titulo="Paciente não encontrado nesta clínica"
        descricao={
          <p>
            {variasClinicas
              ? "O cadastro pode ter sido removido, ou ser de outra clínica. Se o link é da outra clínica em que você trabalha, troque a clínica ativa e abra de novo."
              : "O cadastro pode ter sido removido, ou o link é de outra clínica."}
          </p>
        }
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/pacientes">
              <ArrowLeft aria-hidden />
              Voltar para pacientes
            </Link>
          </Button>
          {variasClinicas ? (
            <Button asChild variant="ghost">
              <Link href="/selecionar-clinica">Trocar de clínica</Link>
            </Button>
          ) : null}
        </div>
      </EstadoDeTela>
    </div>
  );
}
