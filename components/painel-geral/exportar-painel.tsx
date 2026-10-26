"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import {
  MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
  MENSAGEM_EXPORTACAO_DO_PAINEL_VAZIA,
  ROTA_DA_EXPORTACAO_DO_PAINEL,
  type PedidoDeExportacaoDoPainel,
} from "@/components/painel-geral/exportacao-do-painel";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { baixarArquivo } from "@/lib/utils/csv";

// O "Exportar" da lista do Painel geral (segunda leva, 26/10/2026; escolha
// (7) do dono): o arquivo e gerado no SERVIDOR (painel-geral/exportar), com
// os filtros e a ordem da tela, e a trilha gravada antes de sair. Aqui: o
// pedido, o download e os estados, como o "Exportar" dos leads.
// - Enquanto gera: "Exportando..." com o icone girando, desabilitado e com
//   aria-busy.
// - Nenhuma clinica com os filtros: o botao fica visivel e desabilitado,
//   com a dica (e, se a lista mudar no meio, o aviso de vazio).
// - Erro: o aviso com a mensagem do servidor e "Tentar de novo" quando
//   tentar de novo pode resolver.
// O aviso vale para o pedido que o gerou: trocou o filtro, ele some.

export type RespostaDaExportacaoDoPainel =
  | { tipo: "arquivo"; nome: string; arquivo: Blob }
  | { tipo: "vazio" }
  | { tipo: "erro"; mensagem: string; podeTentarDeNovo: boolean };

export type AvisoDaExportacaoDoPainel = Exclude<
  RespostaDaExportacaoDoPainel,
  { tipo: "arquivo" }
>;

/** O nome que a rota mandou; senao, "painel-geral.csv". */
function nomeDoArquivo(resposta: Response): string {
  const cabecalho = resposta.headers.get("content-disposition") ?? "";
  const nome = /filename="([^"]+)"/.exec(cabecalho)?.[1];
  return nome && /^[\w.-]+$/.test(nome) ? nome : "painel-geral.csv";
}

async function mensagemDoServidor(resposta: Response): Promise<string | null> {
  try {
    const corpo: unknown = await resposta.json();
    if (
      corpo &&
      typeof corpo === "object" &&
      "mensagem" in corpo &&
      typeof corpo.mensagem === "string" &&
      corpo.mensagem.length > 0
    ) {
      return corpo.mensagem;
    }
  } catch {
    // Resposta sem JSON: fica a mensagem padrao.
  }
  return null;
}

/**
 * Pede o arquivo da lista com os filtros e a ordem da tela e interpreta a
 * resposta. Nunca lanca: rede caida, sessao vencida (o middleware
 * redireciona para o login) e resposta estranha viram mensagem.
 */
export async function pedirExportacaoDoPainel(
  pedido: PedidoDeExportacaoDoPainel,
  buscar: typeof fetch = fetch,
): Promise<RespostaDaExportacaoDoPainel> {
  let resposta: Response;
  try {
    resposta = await buscar(ROTA_DA_EXPORTACAO_DO_PAINEL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pedido),
    });
  } catch {
    return {
      tipo: "erro",
      mensagem: TEXTOS_DO_PAINEL.semResposta,
      podeTentarDeNovo: true,
    };
  }
  if (resposta.redirected) {
    return {
      tipo: "erro",
      mensagem: TEXTOS_DO_PAINEL.sessaoExpirada,
      podeTentarDeNovo: false,
    };
  }
  if (resposta.status === 204) {
    return { tipo: "vazio" };
  }
  const tipo = resposta.headers.get("content-type") ?? "";
  if (resposta.ok && tipo.startsWith("text/csv")) {
    try {
      return {
        tipo: "arquivo",
        nome: nomeDoArquivo(resposta),
        arquivo: await resposta.blob(),
      };
    } catch {
      return {
        tipo: "erro",
        mensagem: TEXTOS_DO_PAINEL.semResposta,
        podeTentarDeNovo: true,
      };
    }
  }
  return {
    tipo: "erro",
    mensagem:
      (await mensagemDoServidor(resposta)) ??
      MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
    // Sessao, permissao e filtros nao mudam tentando de novo.
    podeTentarDeNovo: resposta.status >= 500,
  };
}

/** O estado da exportacao: o pedido em curso e o aviso do ultimo. */
export function useExportacaoDoPainel(pedido: PedidoDeExportacaoDoPainel) {
  const [exportando, setExportando] = useState(false);
  const [ultimo, setUltimo] = useState<{
    chave: string;
    aviso: AvisoDaExportacaoDoPainel;
  } | null>(null);
  // Clique duplo antes do re-render nao faz dois pedidos.
  const emCurso = useRef(false);
  const chave = JSON.stringify(pedido);

  const exportar = async () => {
    if (emCurso.current) {
      return;
    }
    emCurso.current = true;
    setExportando(true);
    setUltimo(null);
    try {
      const resposta = await pedirExportacaoDoPainel(pedido);
      if (resposta.tipo === "arquivo") {
        baixarArquivo(resposta.nome, resposta.arquivo);
      } else {
        setUltimo({ chave, aviso: resposta });
      }
    } finally {
      emCurso.current = false;
      setExportando(false);
    }
  };

  return {
    exportando,
    aviso: ultimo && ultimo.chave === chave ? ultimo.aviso : null,
    exportar: () => void exportar(),
    dispensar: () => setUltimo(null),
  };
}

/** O botao da barra da lista (40px). */
export function BotaoExportarPainel({
  temClinicas,
  exportando,
  aoExportar,
}: {
  /** Ha clinica com os filtros da tela; sem nenhuma, desabilitado. */
  temClinicas: boolean;
  exportando: boolean;
  aoExportar: () => void;
}) {
  const icone = exportando ? (
    <LoaderCircle
      className="size-4 animate-spin motion-reduce:animate-none"
      aria-hidden
    />
  ) : (
    <Download className="size-4" aria-hidden />
  );
  const rotulo = exportando
    ? TEXTOS_DO_PAINEL.exportando
    : TEXTOS_DO_PAINEL.exportar;
  if (!temClinicas) {
    return (
      <DisabledWithHint hint={TEXTOS_DO_PAINEL.exportarSemClinicas}>
        <Button variant="outline" className="h-10" disabled>
          {icone}
          {rotulo}
        </Button>
      </DisabledWithHint>
    );
  }
  return (
    <Button
      variant="outline"
      className="h-10"
      onClick={aoExportar}
      disabled={exportando}
      aria-busy={exportando || undefined}
    >
      {icone}
      {rotulo}
    </Button>
  );
}

/** O resultado que nao virou arquivo: nenhuma clinica ou erro. */
export function AvisoDaExportacao({
  aviso,
  aoDispensar,
  aoTentarDeNovo,
}: {
  aviso: AvisoDaExportacaoDoPainel | null;
  aoDispensar: () => void;
  aoTentarDeNovo: () => void;
}) {
  if (!aviso) {
    return null;
  }
  if (aviso.tipo === "vazio") {
    return (
      <Aviso tom="info" role="status" aoDispensar={aoDispensar}>
        {MENSAGEM_EXPORTACAO_DO_PAINEL_VAZIA}
      </Aviso>
    );
  }
  return (
    <Aviso
      tom="alert"
      role="alert"
      aoDispensar={aoDispensar}
      acao={
        aviso.podeTentarDeNovo ? (
          <Button variant="ghost" size="sm" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Button>
        ) : undefined
      }
    >
      {aviso.mensagem}
    </Aviso>
  );
}
