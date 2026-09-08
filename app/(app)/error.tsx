"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

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
  useEffect(() => {
    // O console do navegador é da pessoa; nenhum dado de paciente passa por
    // aqui (o digest é um código, não conteúdo).
    console.error("tela_falhou", error.digest ?? "");
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="grid max-w-md justify-items-center gap-3 text-center">
        <TriangleAlert
          strokeWidth={1.5}
          className="size-8 [color:var(--alert-text)]"
        />
        <h1 className="text-lg font-semibold">Esta tela não carregou</h1>
        <p className="text-sm text-text-secondary">
          Alguma coisa falhou ao buscar os dados. Suas conversas e agendamentos
          continuam guardados: é só esta tela que não abriu.
        </p>
        <Button onClick={reset}>
          <RotateCcw strokeWidth={1.5} className="size-4" />
          Tentar de novo
        </Button>
        {error.digest ? (
          <p className="font-mono text-[11px] text-text-tertiary">
            código para o suporte: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
