"use client";

import { OctagonAlert, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";

// Estado de ERRO das telas da area do super admin (o Painel geral), dentro
// do menu proprio, no molde do app/(app)/error.tsx: em portugues, com
// "Tentar de novo" e o codigo para o suporte. A mensagem nao repassa
// err.message (erro de banco pode carregar nome de tabela ou de coluna).
// router.refresh() refaz a busca no servidor e reset() troca a tela de erro
// pela nova na mesma transicao (achado 114 da revisao).

export default function ErroDaAreaDaEquipe({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();

  useEffect(() => {
    // O console do navegador e da pessoa; o digest e um codigo, nao conteudo.
    console.error("tela_falhou", error.digest ?? "");
  }, [error]);

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
            Alguma coisa falhou ao buscar os dados do painel. Nada foi alterado:
            é só esta tela que não abriu.
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
