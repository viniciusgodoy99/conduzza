"use client";

import { Download, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";

// Documento recebido do paciente.
//
// Sempre BAIXA, nunca abre no navegador: a rota forca isso no cabecalho para
// content_type 'documento'. O motivo e concreto: um SVG servido do dominio do
// Supabase e aberto em navegacao de topo executa script no contexto daquele
// dominio. Baixado, nao executa nada.
//
// Sem miniatura de PDF no primeiro corte: gerar a primeira pagina exige
// processar o arquivo, e o motor roda em ambiente sem servidor com orcamento
// de tempo apertado. Nome e icone dizem o que precisa ser dito.

export function CartaoDeDocumento({
  messageId,
  nomeDoArquivo,
}: {
  messageId: string;
  nomeDoArquivo: string | null;
}) {
  const nome = nomeDoArquivo?.trim() || "Documento recebido";
  // Ladrilho do design system: fundo de cartao dentro de qualquer pele de
  // bolha, com a cor de texto propria (na bolha de tinta da IA a cor herdada
  // sumiria no branco).
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-card p-2.5 text-foreground">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-4">
        <FileText aria-hidden className="size-5 text-text-secondary" />
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[13px] font-medium"
        title={nome}
      >
        {nome}
      </span>
      <Button asChild variant="ghost" size="sm" className="shrink-0">
        {/* download=1 e obrigatorio: <a download> e ignorado quando a resposta
            vem de outro dominio, e sem ele o clique navegaria para o arquivo. */}
        <a href={`/api/atendimento/midia/${messageId}?download=1`}>
          <Download aria-hidden />
          Baixar
        </a>
      </Button>
    </div>
  );
}
