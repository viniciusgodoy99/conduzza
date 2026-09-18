"use client";

import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { registrarExportacaoDeRelatorioAction } from "@/app/(app)/relatorios/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { baixarCsv, gerarCsv } from "@/lib/utils/csv";

// Exportacao da aba ativa dos Relatorios (10.11): CSV de verdade e "PDF"
// pela impressao do navegador (nao existe gerador de PDF no sistema, e
// imprimir-para-PDF e o caminho honesto; o layout de impressao e proprio,
// preto no branco, padrao do print-day da Agenda).
//
// A trilha vai ANTES de o dado sair da tela (regra 3.1): sem gravar a
// auditoria, nada e baixado nem impresso.

export type ExportavelDaAba = {
  titulo: string;
  /** Primeira linha = cabecalho. */
  linhas: string[][];
};

export function ExportarRelatorio({
  aba,
  periodoRotulo,
  montar,
}: {
  aba: string;
  periodoRotulo: string;
  /** Monta as linhas na hora do clique, sempre da aba ATIVA. */
  montar: () => ExportavelDaAba;
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
      gerarCsv(dados.linhas),
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 gap-2 print:hidden">
            <Download strokeWidth={1.5} className="size-4" aria-hidden />
            Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportarCsv()}>
            <FileText strokeWidth={1.5} className="size-4" aria-hidden />
            Planilha (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void imprimir()}>
            <Printer strokeWidth={1.5} className="size-4" aria-hidden />
            Imprimir ou salvar em PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {imprimindo ? (
        <div className="hidden bg-white text-black print:block">
          <h1 className="mb-1 text-xl font-bold">{imprimindo.titulo}</h1>
          <p className="mb-4 text-sm">{periodoRotulo}</p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {(imprimindo.linhas[0] ?? []).map((celula, indice) => (
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
              {imprimindo.linhas.slice(1).map((linha, i) => (
                <tr key={i} className="break-inside-avoid">
                  {linha.map((celula, j) => (
                    <td key={j} className="border-b border-neutral-400 py-1">
                      {celula}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
