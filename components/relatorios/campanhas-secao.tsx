"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Target } from "lucide-react";
import type { ReactNode } from "react";

import { Secao } from "@/components/relatorios/secao";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
import {
  TEXTOS_DO_CUSTO_POR_LEAD,
  avisoDeFusoDaConta,
  coberturaDoInvestimento,
  dicaAntesDaLeitura,
  dicaLeituraAtrasada,
  formatarAtualizadoEm,
} from "@/lib/domain/custo-por-lead";
import {
  NOTA_DOS_VALORES_DAS_CAMPANHAS,
  campanhasComValores,
  estadoVazioDasCampanhas,
  montarCampanhas,
  rodapesDasCampanhas,
  type CelulaDeCampanha,
  type LinhaDeCampanhaDaTela,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  CampanhasDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Campanhas do periodo (Fase 4): uma linha por campanha da Meta com lead
// casado POR ID (nunca por nome) e uma por campanha da clinica digitada ou
// importada ("Fora da Meta"). Para admin e gestor, as colunas Investimento e
// Custo por lead, com o estado escrito quando nao ha medida ("Não medido",
// "Sem leads"); para os outros papeis essas colunas nao existem no DOM e a
// nota diz por que. Embaixo, as linhas de conferencia para o custo por lead
// nao mentir. So contagens, nunca nome de paciente: campanha com 1 lead ja
// seria identificacao indireta, entao nao ha detalhe nominal.

function CelulaDeValor({ valor }: { valor: CelulaDeCampanha | null }) {
  if (!valor) {
    return null;
  }
  // Estado escrito em texto comum (sans, secundario); valor em mono.
  return valor.estado ? (
    <span className="font-sans text-text-secondary">{valor.texto}</span>
  ) : (
    <>{valor.texto}</>
  );
}

const COLUNA_CAMPANHA: ColumnDef<LinhaDeCampanhaDaTela, unknown> = {
  accessorKey: "rotulo",
  header: "Campanha",
  cell: ({ row }) => (
    <span className="font-semibold text-text-strong">{row.original.rotulo}</span>
  ),
};

const COLUNAS_SEM_VALORES: ColumnDef<LinhaDeCampanhaDaTela, unknown>[] = [
  COLUNA_CAMPANHA,
  { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
  { accessorKey: "agendaram", header: "Agendados", meta: { align: "right" } },
  { accessorKey: "conversao", header: "Conversão", meta: { align: "right" } },
];

// Ordem do prototipo (screens-inteligencia.jsx): Campanha, Investimento,
// Leads, Custo por lead, Agendados, Conversao.
const COLUNAS_COM_VALORES: ColumnDef<LinhaDeCampanhaDaTela, unknown>[] = [
  COLUNA_CAMPANHA,
  {
    id: "investimento",
    header: "Investimento",
    meta: { align: "right" },
    cell: ({ row }) => <CelulaDeValor valor={row.original.investimento} />,
  },
  { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
  {
    id: "custoPorLead",
    header: "Custo por lead",
    meta: { align: "right" },
    cell: ({ row }) => <CelulaDeValor valor={row.original.custoPorLead} />,
  },
  { accessorKey: "agendaram", header: "Agendados", meta: { align: "right" } },
  { accessorKey: "conversao", header: "Conversão", meta: { align: "right" } },
];

/**
 * Linha curta abaixo do titulo. Gestao: quando o investimento foi lido (e o
 * aviso de fuso da conta, quando o deslocamento difere), ou o porque de nao
 * haver medida. Outros papeis: a nota dos valores.
 */
function metaDaSecao(
  campanhas: CampanhasDoPeriodo,
  comValores: boolean,
  timezone: string,
): string | undefined {
  if (!comValores) {
    return NOTA_DOS_VALORES_DAS_CAMPANHAS;
  }
  const investimento = campanhas.investimento;
  const cobertura = coberturaDoInvestimento(investimento);
  if (cobertura === "nao-configurado") {
    return TEXTOS_DO_CUSTO_POR_LEAD.dicaNaoConfigurado;
  }
  if (cobertura === "outra-moeda") {
    return TEXTOS_DO_CUSTO_POR_LEAD.rodapeOutraMoeda;
  }
  if (cobertura === "aguardando-primeira-leitura") {
    return TEXTOS_DO_CUSTO_POR_LEAD.dicaAguardando;
  }
  const quando = formatarAtualizadoEm(
    investimento?.sincronizadoEm ?? null,
    timezone,
  );
  const atualizado = quando ? `Investimento atualizado em ${quando}.` : null;
  if (cobertura === "antes-da-leitura" && investimento?.lidoDesde) {
    return [dicaAntesDaLeitura(investimento.lidoDesde), atualizado]
      .filter(Boolean)
      .join(" ");
  }
  if (cobertura === "leitura-atrasada" && investimento?.lidoAte) {
    return [dicaLeituraAtrasada(investimento.lidoAte), atualizado]
      .filter(Boolean)
      .join(" ");
  }
  return (
    [atualizado, avisoDeFusoDaConta(investimento, timezone)]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

export function CampanhasSecao({
  campanhas,
  podeVerValores,
  timezone,
  erro = false,
  tentarDeNovo,
  className,
}: {
  /** undefined = carregando */
  campanhas: Periodizado<CampanhasDoPeriodo> | undefined;
  podeVerValores: boolean;
  timezone: string;
  erro?: boolean;
  tentarDeNovo?: ReactNode;
  className?: string;
}) {
  if (erro) {
    return (
      <Secao titulo="Campanhas" icone={Target} className={className}>
        <Aviso
          tom="alert"
          role="alert"
          titulo="Não foi possível carregar as campanhas."
          acao={tentarDeNovo}
        >
          Tente de novo em instantes.
        </Aviso>
      </Secao>
    );
  }
  if (campanhas === undefined) {
    return (
      <Secao titulo="Campanhas" icone={Target} semPadding className={className}>
        <DataTable
          variant="bare"
          columns={COLUNAS_SEM_VALORES}
          data={[]}
          isLoading
        />
      </Secao>
    );
  }

  const atual = campanhas.atual;
  const comValores = campanhasComValores(atual, podeVerValores);
  const linhas = montarCampanhas(atual, podeVerValores);
  const rodapes = rodapesDasCampanhas(atual, podeVerValores);
  // Sem linha nenhuma: com leads no periodo, todos chegaram sem campanha (a
  // contagem esta no rodape); "Nenhum lead no período" so com 0 lead.
  const vazio = estadoVazioDasCampanhas(atual);
  // Ultima leitura com problema, com algo ja lido: os numeros podem estar
  // parados. Aviso com icone, texto e cor (nunca so cor).
  const leituraComProblema =
    comValores &&
    atual.investimento?.situacao === "com_problema" &&
    atual.investimento.lidoDesde !== null;

  return (
    <Secao
      titulo="Campanhas"
      icone={Target}
      meta={metaDaSecao(atual, comValores, timezone)}
      semPadding
      className={className}
    >
      {leituraComProblema ? (
        <div className="px-4 pt-3">
          <Aviso tom="warning" role="note">
            A última leitura do investimento teve problema. Veja o motivo em
            Configurações, aba Anúncios da Meta.
          </Aviso>
        </div>
      ) : null}
      <DataTable
        variant="bare"
        columns={comValores ? COLUNAS_COM_VALORES : COLUNAS_SEM_VALORES}
        data={linhas}
        emptyTitle={vazio.titulo}
        emptyDescription={vazio.descricao}
      />
      {rodapes.length > 0 ? (
        <div className="grid gap-1 border-t border-border px-4 py-3 text-[13px] text-text-secondary">
          {rodapes.map((texto) => (
            <p key={texto}>{texto}</p>
          ))}
        </div>
      ) : null}
    </Secao>
  );
}
