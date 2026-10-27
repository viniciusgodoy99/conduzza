"use client";

import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  hrefDaListaDeLeads,
  nomeDoLinkDaLista,
  type PeriodoDaLista,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import type { LinhaDeAnuncioSemCampanha } from "@/lib/domain/exportacao-de-resultados";

// Os anuncios no quadro Campanhas (pedido do dono de 26/10/2026): sem
// nenhuma linha de campanha, o quadro mostra os anuncios que trouxeram leads
// no periodo, pelo titulo que veio com o lead (anunciosSemCampanha). O
// rotulo abre a lista de Leads com os mesmos leads (o filtro do Detalhe da
// origem); "Ver anúncio" mostra o texto e o link como vieram na mensagem.
// So contagens: nenhum nome de paciente.

/** O "Ver anúncio": o texto como veio e o "Abrir anúncio" (outra aba). */
export function VerAnuncio({
  anuncio,
}: {
  anuncio: NonNullable<LinhaDeAnuncioSemCampanha["anuncio"]>;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          aria-label={`Ver o anúncio ${anuncio.titulo}`}
        >
          Ver anúncio
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-words">{anuncio.titulo}</DialogTitle>
          <DialogDescription>
            O texto do anúncio como veio na mensagem do lead.
          </DialogDescription>
        </DialogHeader>
        {anuncio.descricao ? (
          <p className="max-h-80 overflow-y-auto text-[14px] break-words whitespace-pre-line text-text-strong">
            {anuncio.descricao}
          </p>
        ) : null}
        {anuncio.link ? (
          <Button asChild variant="outline" className="w-fit">
            <a href={anuncio.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Abrir anúncio <span className="sr-only">(abre em outra aba)</span>
            </a>
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function celulaDoAnuncio(periodo: PeriodoDaLista | undefined) {
  return function CelulaDoAnuncio({
    row,
  }: CellContext<LinhaDeAnuncioSemCampanha, unknown>) {
    const linha = row.original;
    return (
      <div className="flex max-w-[28rem] min-w-40 flex-wrap items-center gap-x-3 gap-y-1">
        {periodo ? (
          <Link
            href={hrefDaListaDeLeads(periodo, linha.filtro)}
            // Um link por linha, todos para /leads: sem prefetch.
            prefetch={false}
            aria-label={nomeDoLinkDaLista(linha.rotulo, linha.leads)}
            className="flex min-h-10 min-w-0 items-center rounded-sm py-1.5 font-semibold whitespace-normal text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            <span className="min-w-0 break-words">{linha.rotulo}</span>
          </Link>
        ) : (
          <span className="min-w-0 py-1.5 font-semibold break-words whitespace-normal text-text-strong">
            {linha.rotulo}
          </span>
        )}
        {linha.anuncio ? <VerAnuncio anuncio={linha.anuncio} /> : null}
      </div>
    );
  };
}

function colunas(
  periodo: PeriodoDaLista | undefined,
): ColumnDef<LinhaDeAnuncioSemCampanha, unknown>[] {
  return [
    {
      accessorKey: "rotulo",
      header: "Anúncio",
      cell: celulaDoAnuncio(periodo),
    },
    {
      accessorKey: "plataforma",
      header: "Plataforma",
      cell: ({ row }) => (
        <span className="whitespace-normal">{row.original.plataforma}</span>
      ),
    },
    { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
    { accessorKey: "agendaram", header: "Agendaram", meta: { align: "right" } },
    {
      accessorKey: "compareceram",
      header: "Compareceram",
      meta: { align: "right" },
    },
  ];
}

export function AnunciosSemCampanha({
  linhas,
  texto,
  periodo,
}: {
  linhas: LinhaDeAnuncioSemCampanha[];
  /** A frase de cima (textoDosAnunciosSemCampanha). */
  texto: string;
  /** O periodo da tela: o mesmo vai para a lista de Leads. */
  periodo?: PeriodoDaLista;
}) {
  return (
    <>
      <p className="border-b border-border px-4 py-3 text-[13px] text-text-secondary">
        {texto}
      </p>
      <DataTable variant="bare" columns={colunas(periodo)} data={linhas} />
    </>
  );
}
