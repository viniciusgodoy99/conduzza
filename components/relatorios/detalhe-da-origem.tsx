"use client";

import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { TableProperties } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { Secao } from "@/components/relatorios/secao";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hrefDaListaDeLeads,
  nomeDoLinkDaLista,
  type PeriodoDaLista,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import {
  DIMENSOES_DA_ORIGEM,
  lerDimensaoDaOrigem,
  montarDetalheDeOrigemDaTela,
  type DimensaoDaOrigem,
  type LinhaDeOrigemDaTela,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AnunciosDoPeriodo,
  CampanhasDoPeriodo,
  FunilDoPeriodo,
} from "@/lib/queries/relatorios";

// Detalhe da origem (Marketing, 10.7): por canal, por campanha ou por
// anuncio, com a dimensao trocavel por Select (C33). A dimensao vive no pai:
// a exportacao da aba usa a MESMA dimensao da tabela. "Comparecimento" =
// compareceram dividido por leads (a Conversao das campanhas e outra regra:
// agendaram). Fase 4: por campanha usa as MESMAS linhas da tabela Campanhas
// (campanhas_do_periodo, casamento so por id), mais "Sem campanha".
// Por anuncio (20/10/2026, pedido do dono): anuncios_do_periodo, uma linha
// por anuncio com o titulo que veio na mensagem (senao o nome na Meta, senao
// "Anúncio sem título (id 120240624148610289)"; rotulos repetidos ganham o id
// inteiro), mais "Anúncio não identificado" e "Sem anúncio da Meta". So e
// buscada quando a dimensao e escolhida.
//
// De Resultados para a lista (pedido do dono em 20/10/2026): o rotulo de
// cada linha e um link para a lista de Leads com o MESMO periodo e os mesmos
// leads da linha (o filtro sai da chave que o banco agrupou,
// montarDetalheDeOrigemDaTela). A exportacao continua igual.

function celulaOpcional({ getValue }: { getValue: () => unknown }) {
  const valor = getValue() as number | null;
  return valor === null ? "" : valor;
}

// O rotulo pode ser longo (titulo de anuncio, nome de campanha): quebra a
// linha em vez de esticar a tabela para os lados. O link tem 40px de altura
// no minimo e o nome acessivel diz o destino.
function celulaDoRotulo(periodo: PeriodoDaLista) {
  return function CelulaDoRotulo({
    row,
  }: CellContext<LinhaDeOrigemDaTela, unknown>) {
    const linha = row.original;
    return (
      <Link
        href={hrefDaListaDeLeads(periodo, linha.filtro)}
        // Um link por linha, todos para /leads: sem prefetch, a lista
        // carrega no clique.
        prefetch={false}
        aria-label={nomeDoLinkDaLista(linha.rotulo, linha.leads)}
        className="flex min-h-10 max-w-[28rem] min-w-40 items-center rounded-sm py-1.5 font-medium whitespace-normal text-primary-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        <span className="min-w-0 break-words">{linha.rotulo}</span>
      </Link>
    );
  };
}

function colunas(
  periodo: PeriodoDaLista,
): ColumnDef<LinhaDeOrigemDaTela, unknown>[] {
  return [
    { accessorKey: "rotulo", header: "Origem", cell: celulaDoRotulo(periodo) },
    { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
    {
      accessorKey: "agendaram",
      header: "Agendaram",
      meta: { align: "right" },
      cell: celulaOpcional,
    },
    {
      accessorKey: "compareceram",
      header: "Compareceram",
      meta: { align: "right" },
      cell: celulaOpcional,
    },
    {
      accessorKey: "comparecimento",
      header: "Comparecimento",
      meta: { align: "right" },
    },
  ];
}

export function DetalheDaOrigem({
  funil,
  periodo,
  campanhas,
  campanhasComErro = false,
  tentarCampanhasDeNovo,
  anuncios,
  anunciosComErro = false,
  tentarAnunciosDeNovo,
  dimensao,
  aoMudarDimensao,
}: {
  funil: FunilDoPeriodo;
  /** O periodo da tela (dias civis da clinica): o mesmo vai para a lista. */
  periodo: PeriodoDaLista;
  /** Atual de campanhas_do_periodo; undefined = carregando */
  campanhas: CampanhasDoPeriodo | undefined;
  campanhasComErro?: boolean;
  tentarCampanhasDeNovo?: ReactNode;
  /** anuncios_do_periodo; undefined = carregando (ou dimensao nao escolhida) */
  anuncios?: AnunciosDoPeriodo;
  anunciosComErro?: boolean;
  tentarAnunciosDeNovo?: ReactNode;
  dimensao: DimensaoDaOrigem;
  aoMudarDimensao: (dimensao: DimensaoDaOrigem) => void;
}) {
  const erro =
    dimensao === "campanha"
      ? campanhasComErro
        ? {
            titulo: "Não foi possível carregar as campanhas.",
            acao: tentarCampanhasDeNovo,
          }
        : null
      : dimensao === "anuncio" && anunciosComErro
        ? {
            titulo: "Não foi possível carregar os anúncios.",
            acao: tentarAnunciosDeNovo,
          }
        : null;
  const linhas = erro
    ? null
    : montarDetalheDeOrigemDaTela(funil, dimensao, campanhas, anuncios);
  const { diaDe, diaAte } = periodo;
  const colunasDaTabela = useMemo(
    () => colunas({ diaDe, diaAte }),
    [diaDe, diaAte],
  );
  return (
    <Secao
      titulo="Detalhe da origem"
      icone={TableProperties}
      semPadding
      acao={
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-secondary">Dimensão</span>
          <Select
            value={dimensao}
            onValueChange={(valor) =>
              aoMudarDimensao(lerDimensaoDaOrigem(valor))
            }
          >
            <SelectTrigger className="w-40" aria-label="Dimensão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSOES_DA_ORIGEM.map((opcao) => (
                <SelectItem key={opcao.chave} value={opcao.chave}>
                  {opcao.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {erro ? (
        <div className="p-4">
          <Aviso tom="alert" role="alert" titulo={erro.titulo} acao={erro.acao}>
            Tente de novo em instantes.
          </Aviso>
        </div>
      ) : (
        <DataTable
          variant="bare"
          columns={colunasDaTabela}
          data={linhas ?? []}
          isLoading={linhas === null}
          emptyTitle="Sem leads no período"
          emptyDescription="Os detalhes aparecem quando os primeiros contatos chegarem no período escolhido."
        />
      )}
    </Secao>
  );
}
