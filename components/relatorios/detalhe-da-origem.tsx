"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { TableProperties } from "lucide-react";
import type { ReactNode } from "react";

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
  DIMENSOES_DA_ORIGEM,
  lerDimensaoDaOrigem,
  montarDetalheDeOrigem,
  type DimensaoDaOrigem,
  type LinhaDeOrigem,
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

function celulaOpcional({ getValue }: { getValue: () => unknown }) {
  const valor = getValue() as number | null;
  return valor === null ? "" : valor;
}

// O rotulo pode ser longo (titulo de anuncio, nome de campanha): quebra a
// linha em vez de esticar a tabela para os lados.
function celulaDoRotulo({ getValue }: { getValue: () => unknown }) {
  return (
    <span className="block max-w-[28rem] min-w-40 py-2 break-words whitespace-normal">
      {getValue() as string}
    </span>
  );
}

const COLUNAS: ColumnDef<LinhaDeOrigem, unknown>[] = [
  { accessorKey: "rotulo", header: "Origem", cell: celulaDoRotulo },
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

export function DetalheDaOrigem({
  funil,
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
    : montarDetalheDeOrigem(funil, dimensao, campanhas, anuncios);
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
          columns={COLUNAS}
          data={linhas ?? []}
          isLoading={linhas === null}
          emptyTitle="Sem leads no período"
          emptyDescription="Os detalhes aparecem quando os primeiros contatos chegarem no período escolhido."
        />
      )}
    </Secao>
  );
}
