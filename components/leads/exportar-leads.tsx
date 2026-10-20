"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  CABECALHO_DA_CLINICA_DA_TELA,
  corpoDoPedidoDeExportacao,
  DICA_EXPORTAR_LEADS,
  MENSAGEM_EXPORTACAO_FALHOU,
  MENSAGEM_EXPORTACAO_SEM_CONEXAO,
  MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
  MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR,
} from "@/lib/domain/exportacao-de-leads";
import type { ValoresDosFiltrosDeLeads } from "@/lib/domain/leads-ui";
import { baixarArquivo } from "@/lib/utils/csv";

// "Exportar" da Tela 4 (pedido do dono em 20/10/2026), nas visoes Kanban e
// Lista: o arquivo e gerado no SERVIDOR (app/api/leads/exportar), com todos
// os leads que batem com os filtros da tela, e nao so os carregados. Aqui:
// o pedido, o download e os estados.
//
// - Administrador e gestor: botao habilitado. Os outros papeis: visivel e
//   desabilitado, com a dica do dono (a rota recusa do mesmo jeito: esconder
//   ou desabilitar botao nao protege nada).
// - Enquanto gera: "Exportando..." com o icone girando (no celular so o
//   icone fica a vista), desabilitado e com aria-busy.
// - O pedido diz qual clinica a tela mostra; a rota recusa se a ativa
//   mudou em outra aba (o arquivo sairia da outra clinica).
// - Sem lead com esses filtros: o aviso "Nenhum lead para exportar com esses
//   filtros." e nenhum arquivo.
// - Erro: o aviso com a mensagem do servidor, em linguagem de recepcao, e
//   "Tentar de novo" quando tentar de novo pode resolver.
// O aviso vale para os filtros do pedido: trocou o filtro, ele some.

export const ROTA_DA_EXPORTACAO_DE_LEADS = "/api/leads/exportar";

/** O que o navegador faz com a resposta da rota. */
export type RespostaDaExportacao =
  | { tipo: "arquivo"; nome: string; arquivo: Blob }
  | { tipo: "vazio" }
  | { tipo: "erro"; mensagem: string; podeTentarDeNovo: boolean };

export type AvisoDaExportacao = Exclude<
  RespostaDaExportacao,
  { tipo: "arquivo" }
>;

/** O nome que a rota mandou no Content-Disposition; senao, "leads.csv". */
function nomeDoArquivo(resposta: Response): string {
  const cabecalho = resposta.headers.get("content-disposition") ?? "";
  const nome = /filename="([^"]+)"/.exec(cabecalho)?.[1];
  return nome && /^[\w.-]+$/.test(nome) ? nome : "leads.csv";
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
 * Pede o arquivo dos leads com os filtros da tela e interpreta a resposta.
 * Nunca lanca: rede caida, sessao vencida (o middleware redireciona para o
 * login) e resposta estranha viram mensagem.
 */
export async function pedirExportacaoDeLeads(
  clinicId: string,
  valores: ValoresDosFiltrosDeLeads,
  buscar: typeof fetch = fetch,
): Promise<RespostaDaExportacao> {
  let resposta: Response;
  try {
    resposta = await buscar(ROTA_DA_EXPORTACAO_DE_LEADS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CABECALHO_DA_CLINICA_DA_TELA]: clinicId,
      },
      body: JSON.stringify(corpoDoPedidoDeExportacao(valores)),
    });
  } catch {
    return {
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_SEM_CONEXAO,
      podeTentarDeNovo: true,
    };
  }
  if (resposta.redirected) {
    return {
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
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
        mensagem: MENSAGEM_EXPORTACAO_SEM_CONEXAO,
        podeTentarDeNovo: true,
      };
    }
  }
  return {
    tipo: "erro",
    mensagem:
      (await mensagemDoServidor(resposta)) ?? MENSAGEM_EXPORTACAO_FALHOU,
    // Papel, filtros, teto e sessao nao mudam tentando de novo.
    podeTentarDeNovo: resposta.status >= 500,
  };
}

/** Os filtros de um pedido, como chave (o aviso so vale para eles). */
function chaveDosFiltros(valores: ValoresDosFiltrosDeLeads): string {
  return JSON.stringify(corpoDoPedidoDeExportacao(valores));
}

/** Estado da exportacao da tela: o pedido em curso e o aviso do ultimo. */
export function useExportacaoDeLeads(
  clinicId: string,
  valores: ValoresDosFiltrosDeLeads,
) {
  const [exportando, setExportando] = useState(false);
  const [ultimo, setUltimo] = useState<{
    chave: string;
    aviso: AvisoDaExportacao;
  } | null>(null);
  // Clique duplo antes do re-render nao faz dois pedidos.
  const emCurso = useRef(false);
  const chave = chaveDosFiltros(valores);

  const exportar = async () => {
    if (emCurso.current) {
      return;
    }
    emCurso.current = true;
    setExportando(true);
    setUltimo(null);
    try {
      const resposta = await pedirExportacaoDeLeads(clinicId, valores);
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

/** O botao da barra da Tela 4 (40px, ao lado de "Importar planilha"). */
export function BotaoExportarLeads({
  podeExportar,
  exportando,
  aoExportar,
}: {
  podeExportar: boolean;
  exportando: boolean;
  aoExportar: () => void;
}) {
  // Abaixo de 640px so o icone fica a vista (o nome continua para o leitor
  // de tela): os botoes da barra nao cabem numa linha no celular. Por isso
  // o "gerando" tambem esta no icone, que gira (parado com
  // prefers-reduced-motion, quando o nome e o aria-busy contam).
  const rotulo = (
    <span className="max-sm:sr-only">
      {exportando ? "Exportando..." : "Exportar"}
    </span>
  );
  if (!podeExportar) {
    return (
      <DisabledWithHint hint={DICA_EXPORTAR_LEADS}>
        <Button variant="outline" className="h-10" disabled>
          <Download className="size-4" aria-hidden />
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
      {exportando ? (
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      {rotulo}
    </Button>
  );
}

/** O resultado que nao virou arquivo: zero lead ou erro. */
export function AvisoDaExportacaoDeLeads({
  aviso,
  aoDispensar,
  aoTentarDeNovo,
}: {
  aviso: AvisoDaExportacao | null;
  aoDispensar: () => void;
  aoTentarDeNovo: () => void;
}) {
  if (!aviso) {
    return null;
  }
  if (aviso.tipo === "vazio") {
    return (
      <Aviso tom="info" role="status" aoDispensar={aoDispensar}>
        {MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR}
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
