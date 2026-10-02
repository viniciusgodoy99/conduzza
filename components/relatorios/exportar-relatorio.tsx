"use client";

import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { registrarExportacaoDeRelatorioAction } from "@/app/(app)/relatorios/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  linhasDoCsv,
  type ExportavelDaAba,
} from "@/lib/domain/exportacao-de-resultados";
import { baixarCsv, gerarCsv } from "@/lib/utils/csv";

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
}: {
  aba: string;
  periodoRotulo: string;
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
