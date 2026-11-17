"use client";

import { Download, FileText, Megaphone, Printer } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  exportarConversoesParaOGoogleAction,
  registrarExportacaoDeRelatorioAction,
} from "@/app/(app)/relatorios/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  resumoDaExportacaoParaOGoogle,
  TEXTOS_DAS_CONVERSOES_DO_GOOGLE,
} from "@/lib/domain/conversoes-google";
import {
  linhasDoCsv,
  type ExportavelDaAba,
} from "@/lib/domain/exportacao-de-resultados";
import { baixarArquivo, baixarCsv, gerarCsv } from "@/lib/utils/csv";

// Exportacao da aba ativa dos Relatorios (10.11): CSV de verdade e "PDF"
// pela impressao do navegador (nao existe gerador de PDF no sistema, e
// imprimir-para-PDF e o caminho honesto; o layout de impressao e proprio,
// preto no branco, padrao do print-day da Agenda).
//
// Desde a Fase 3 a aba exporta VARIAS secoes (Comercial e Agente de IA tem
// mais de uma tabela): no CSV cada secao abre com uma linha de titulo; na
// impressao, uma tabela por secao. As linhas vem montadas pelo modulo puro
// lib/domain/exportacao-de-resultados.ts, que nunca poe "R$" para quem nao
// pode ver valores.
//
// A trilha vai ANTES de o dado sair da tela (regra 3.1): sem gravar a
// auditoria, nada e baixado nem impresso.

export type { ExportavelDaAba };

export function ExportarRelatorio({
  aba,
  periodoRotulo,
  montar,
  desabilitado = false,
  periodo,
  podeExportarParaOGoogle = false,
}: {
  aba: string;
  periodoRotulo: string;
  /**
   * O periodo em dias civis da clinica: com ele o menu ganha "Conversões
   * para o Google Ads" (etapa 6A do plano de 16/11/2026). Sem ele (o Inicio),
   * o item nao aparece.
   */
  periodo?: { diaDe: string; diaAte: string };
  /** So administrador e gestor. Os outros veem o item desabilitado. */
  podeExportarParaOGoogle?: boolean;
  /** Monta as linhas na hora do clique, sempre da aba ATIVA. */
  montar: () => ExportavelDaAba;
  /** Aba ainda carregando ou em erro: exportar gravaria trilha de um CSV
   *  vazio (achado da revisao de 18/09). Visivel e desabilitado, com dica. */
  desabilitado?: boolean;
}) {
  const [imprimindo, setImprimindo] = useState<ExportavelDaAba | null>(null);

  const exportarCsv = async () => {
    const auditoria = await registrarExportacaoDeRelatorioAction("csv", aba);
    if (!auditoria.ok) {
      toast.error("Não foi possível registrar a exportação. Tente de novo.");
      return;
    }
    const dados = montar();
    baixarCsv(
      `resultados-${aba}-${periodoRotulo.replaceAll("/", "-").replaceAll(" ", "")}.csv`,
      gerarCsv(linhasDoCsv(dados)),
    );
  };

  // O arquivo para a agencia subir no Google Ads. E montado no servidor (o
  // identificador do clique nunca fica na tela) e ja volta com a trilha
  // gravada. Separado por virgula e sem BOM: e para a maquina do Google.
  const exportarParaOGoogle = async () => {
    if (!periodo) {
      return;
    }
    let resultado;
    try {
      resultado = await exportarConversoesParaOGoogleAction(periodo);
    } catch {
      toast.error(TEXTOS_DAS_CONVERSOES_DO_GOOGLE.falhou);
      return;
    }
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    if (!resultado.arquivo) {
      toast.info(TEXTOS_DAS_CONVERSOES_DO_GOOGLE.vazio);
      return;
    }
    baixarArquivo(
      resultado.arquivo.nome,
      new Blob([resultado.arquivo.csv], { type: "text/csv;charset=utf-8" }),
    );
    toast.success(
      resumoDaExportacaoParaOGoogle(resultado.exportadas, resultado.semGclid),
    );
  };

  const imprimir = async () => {
    const auditoria = await registrarExportacaoDeRelatorioAction(
      "impressao",
      aba,
    );
    if (!auditoria.ok) {
      toast.error("Não foi possível registrar a impressão. Tente de novo.");
      return;
    }
    // Monta o layout de impressao SO agora (padrao da Agenda); afterprint
    // desmonta para nao duplicar conteudo para leitores de tela.
    setImprimindo(montar());
    setTimeout(() => {
      const aoTerminar = () => {
        setImprimindo(null);
        window.removeEventListener("afterprint", aoTerminar);
      };
      window.addEventListener("afterprint", aoTerminar);
      window.print();
    }, 80);
  };

  if (desabilitado) {
    return (
      <DisabledWithHint hint="Aguarde os dados do período carregarem.">
        <Button variant="outline" className="h-10 gap-2" disabled>
          <Download className="size-4" aria-hidden />
          Exportar
        </Button>
      </DisabledWithHint>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 gap-2 print:hidden">
            <Download className="size-4" aria-hidden />
            Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportarCsv()}>
            <FileText className="size-4" aria-hidden />
            Planilha (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void imprimir()}>
            <Printer className="size-4" aria-hidden />
            Imprimir ou salvar em PDF
          </DropdownMenuItem>
          {periodo ? (
            podeExportarParaOGoogle ? (
              <DropdownMenuItem onSelect={() => void exportarParaOGoogle()}>
                <Megaphone className="size-4" aria-hidden />
                {TEXTOS_DAS_CONVERSOES_DO_GOOGLE.item}
              </DropdownMenuItem>
            ) : (
              // Sem permissao: visivel e desabilitado, com o porque escrito.
              <DropdownMenuItem
                disabled
                className="flex-col items-start gap-0.5"
              >
                <span className="flex items-center gap-2">
                  <Megaphone className="size-4" aria-hidden />
                  {TEXTOS_DAS_CONVERSOES_DO_GOOGLE.item}
                </span>
                <span className="text-xs text-text-secondary">
                  {TEXTOS_DAS_CONVERSOES_DO_GOOGLE.semPermissao}
                </span>
              </DropdownMenuItem>
            )
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Portal no body: a tela inteira fica print:hidden (pagina e shell),
          e um bloco filho de ancestral escondido nunca imprimiria. */}
      {imprimindo
        ? createPortal(
            <div className="hidden bg-white text-black print:block">
              <h1 className="mb-1 text-xl font-bold">{imprimindo.titulo}</h1>
              <p className="mb-4 text-sm">{periodoRotulo}</p>
              {imprimindo.secoes.map((secao, indiceDaSecao) => (
                <section key={indiceDaSecao} className="mb-6 break-inside-avoid">
                  <h2 className="mb-2 text-sm font-bold">{secao.titulo}</h2>
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        {(secao.linhas[0] ?? []).map((celula, indice) => (
                          <th
                            key={indice}
                            className="border-b border-black py-1 text-left font-semibold"
                          >
                            {celula}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {secao.linhas.slice(1).map((linha, i) => (
                        <tr key={i} className="break-inside-avoid">
                          {linha.map((celula, j) => (
                            <td
                              key={j}
                              className="border-b border-neutral-400 py-1"
                            >
                              {celula}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
