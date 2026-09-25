"use client";

import { OctagonAlert, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { EstadoDeTela } from "@/components/shell/estado-de-tela";
import { Button } from "@/components/ui/button";

// Estado de ERRO das telas de entrada (login, cadastro, senha, escolha de
// clinica). Sem ele, uma falha ao falar com o servidor de login derrubava a
// pessoa na tela generica do Next, em ingles e sem caminho de volta. Aparece
// dentro do cartao do layout, com a coluna da marca ao lado.
//
// A mensagem nao repassa err.message (pode carregar detalhe interno); o
// digest aparece pequeno para o suporte localizar no log.
export default function ErroDaEntrada({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();

  useEffect(() => {
    // So o digest, que e um codigo: nenhum dado de pessoa passa por aqui.
    console.error("tela_de_entrada_falhou", error.digest ?? "");
  }, [error]);

  // router.refresh() refaz a busca no servidor; reset() sozinho desenharia o
  // mesmo payload com o erro.
  const tentarDeNovo = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <EstadoDeTela
      icone={OctagonAlert}
      tom="alerta"
      titulo="Esta tela não carregou"
      descricao={
        <p>
          Alguma coisa falhou ao falar com o servidor. Tente de novo em
          instantes.
        </p>
      }
      className="max-w-none"
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={tentarDeNovo} disabled={tentando}>
          <RotateCcw aria-hidden />
          Tentar de novo
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="cz-num text-[11px] text-text-secondary">
          código para o suporte: {error.digest}
        </p>
      ) : null}
    </EstadoDeTela>
  );
}
