"use client";

import { OctagonAlert, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";

// Estado de ERRO de todas as telas do aplicativo. Achado da revisão de
// 08/09/2026: a definição de pronto (CLAUDE.md seção 6) exige vazio,
// carregando E erro, e não existia error boundary em lugar nenhum: qualquer
// consulta que falhasse derrubava a pessoa na tela genérica do Next, em
// inglês, sem caminho de volta.
//
// A mensagem não repassa err.message: erro de banco pode carregar nome de
// tabela ou de coluna, e a recepção não tem o que fazer com isso. O digest
// aparece pequeno para o suporte localizar no log.

export default function ErroDoAplicativo({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();

  useEffect(() => {
    // O console do navegador é da pessoa; nenhum dado de paciente passa por
    // aqui (o digest é um código, não conteúdo).
    console.error("tela_falhou", error.digest ?? "");
  }, [error]);

  // reset() sozinho só limpa o estado do boundary e desenha de novo o mesmo
  // payload do servidor, que já traz o erro: a tela voltava na hora e o
  // botão parecia quebrado. router.refresh() refaz a busca no servidor, e os
  // dois na mesma transição trocam a tela de erro pela nova de uma vez
  // (achado 114 da revisão).
  const tentarDeNovo = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <EstadoDeTela
        icone={OctagonAlert}
        tom="alerta"
        titulo="Esta tela não carregou"
        descricao={
          <p>
            Alguma coisa falhou ao buscar os dados. Suas conversas e
            agendamentos continuam guardados: é só esta tela que não abriu.
          </p>
        }
      >
        <Button
          variant="outline"
          className="h-10 px-4"
          onClick={tentarDeNovo}
          disabled={tentando}
        >
          <RotateCcw aria-hidden className="size-4" />
          Tentar de novo
        </Button>
        {error.digest ? (
          <p className="cz-num text-[11px] text-text-tertiary">
            código para o suporte: {error.digest}
          </p>
        ) : null}
      </EstadoDeTela>
    </div>
  );
}
