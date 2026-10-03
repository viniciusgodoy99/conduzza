import { Banknote, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import {
  avisoDeFusoDaConta,
  dicaDoCustoPorLead,
  estadoDoCustoPorLead,
  rodapeDoCustoPorLead,
  textoAtualizadoEm,
  textoDoCustoPorLead,
  variacaoDoCustoPorLead,
} from "@/lib/domain/custo-por-lead";
import {
  TEXTO_SEM_COMPARECIMENTO,
  TEXTO_SEM_PRECO_PARA_SOMAR,
  estadoDoFaturamento,
} from "@/lib/domain/exportacao-de-resultados";
import {
  formatarReaisCompacto,
  formatarReaisCompleto,
} from "@/lib/domain/formato-compacto";
import type {
  CampanhasDoPeriodo,
  FaturamentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Cartoes de VALOR EM REAIS da Tela 11 (Fase 3): so admin e gestor veem
// numero. Para os outros papeis o cartao continua visivel, desabilitado com a
// dica (regra 5), e nenhum valor chega ao HTML: a pagina nem busca o
// faturamento, e o banco devolve null se alguem pedir.

export const DICA_SEM_ACESSO_A_VALORES =
  "Só administrador e gestor veem valores em reais.";

/** Rodape em linhas: cada parte numa linha propria, sem juntar com sinal. */
function linhasDoRodape(partes: (string | null)[]): ReactNode {
  const presentes = partes.filter((parte): parte is string => Boolean(parte));
  if (presentes.length === 0) {
    return undefined;
  }
  return presentes.map((parte) => (
    <span key={parte} className="block">
      {parte}
    </span>
  ));
}

/**
 * Custo por lead (Fase 4): investimento total da conta de anuncios no
 * periodo dividido pelo divisor da decisao D2 (DIVISOR_DO_CUSTO_POR_LEAD).
 * Estados (lib/domain/custo-por-lead.ts, o mesmo texto do CSV):
 * - sem acesso (outros papeis): "Sem acesso", sem numero no HTML;
 * - sem leitura configurada, antes da primeira leitura, periodo antes do
 *   primeiro dia lido e leitura parada antes do fim do periodo: "Ainda não
 *   medido", com o porque na dica;
 * - outra moeda, sem investimento, nenhum lead de anuncio: o estado escrito;
 * - valor: "R$ 18,40", rodape "R$ 3.420,00 em N leads de anúncio" e
 *   "Atualizado em", variacao so com os dois periodos medidos por inteiro
 *   (cair e bom);
 * - conta de anuncios em outro fuso (deslocamento diferente do da clinica):
 *   uma linha a mais no rodape, so com o periodo medido.
 */
export function CartaoCustoPorLead({
  podeVerValores,
  campanhas,
  timezone,
  erro = false,
  tentarDeNovo,
  className,
}: {
  podeVerValores: boolean;
  /** undefined = carregando */
  campanhas: Periodizado<CampanhasDoPeriodo> | undefined;
  /** Fuso da clinica, para o "Atualizado em" */
  timezone: string;
  erro?: boolean;
  tentarDeNovo?: ReactNode;
  className?: string;
}) {
  const casca = { rotulo: "Custo por lead", icone: Wallet, className } as const;

  if (!podeVerValores) {
    return (
      <CartaoDeMetrica
        {...casca}
        estado="sem-acesso"
        dica={DICA_SEM_ACESSO_A_VALORES}
      />
    );
  }
  if (erro) {
    return (
      <CartaoDeMetrica {...casca} estado="erro" tentarDeNovo={tentarDeNovo} />
    );
  }
  if (campanhas === undefined) {
    return <CartaoDeMetrica {...casca} estado="carregando" />;
  }

  const estado = estadoDoCustoPorLead(campanhas.atual);
  const atualizado = textoAtualizadoEm(
    campanhas.atual.investimento?.sincronizadoEm ?? null,
    timezone,
  );
  // null fora do periodo medido (outra moeda, Ainda não medido): so acende
  // quando ha numero para o fuso distorcer.
  const avisoDeFuso = avisoDeFusoDaConta(campanhas.atual.investimento, timezone);

  switch (estado.tipo) {
    case "sem-acesso":
      // O banco recusou mesmo a pagina achando que podia (papel mudou no
      // meio do caminho): sem acesso, nunca zero.
      return (
        <CartaoDeMetrica
          {...casca}
          estado="sem-acesso"
          dica={DICA_SEM_ACESSO_A_VALORES}
        />
      );
    case "nao-configurado":
    case "aguardando-primeira-leitura":
    case "antes-da-leitura":
    case "leitura-atrasada":
      return (
        <CartaoDeMetrica
          {...casca}
          estado="nao-medido"
          dica={dicaDoCustoPorLead(estado) ?? ""}
        />
      );
    case "outra-moeda":
    case "sem-investimento":
    case "sem-lead":
      return (
        <CartaoDeMetrica
          {...casca}
          estado="vazio"
          texto={textoDoCustoPorLead(estado)}
          rodape={linhasDoRodape([
            rodapeDoCustoPorLead(estado),
            estado.tipo === "outra-moeda" ? null : atualizado,
            avisoDeFuso,
          ])}
        />
      );
    case "valor": {
      const compacto = formatarReaisCompacto(estado.custoCents);
      const cheio = formatarReaisCompleto(estado.custoCents);
      return (
        <CartaoDeMetrica
          {...casca}
          valor={compacto}
          valorFalado={compacto === cheio ? undefined : cheio}
          variacao={variacaoDoCustoPorLead(campanhas)}
          rodape={linhasDoRodape([
            rodapeDoCustoPorLead(estado),
            atualizado,
            avisoDeFuso,
          ])}
        />
      );
    }
  }
}

function plural(n: number, singular: string, pluralizado: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : pluralizado}`;
}

/** O que ficou fora da soma, escrito: convenio sem valor e sem preco. */
function foraDaSoma(atual: FaturamentoDoPeriodo): string[] {
  const partes: string[] = [];
  if (atual.cobertas > 0) {
    partes.push(
      `${plural(atual.cobertas, "consulta", "consultas")} de convênio sem valor`,
    );
  }
  if (atual.semPreco > 0) {
    partes.push(`${plural(atual.semPreco, "consulta", "consultas")} sem preço cadastrado`);
  }
  return partes;
}

/**
 * Faturamento estimado: soma do preco das consultas com comparecimento no
 * periodo. "Estimado" porque o preco vem do vinculo ATUAL (a consulta nao
 * congela preco). Compacto na grade de 5 ("R$ 284 mil", valor cheio para o
 * leitor de tela); cheio quando o cartao tem largura (detalhado).
 */
export function CartaoFaturamento({
  podeVerValores,
  faturamento,
  erro = false,
  tentarDeNovo,
  detalhado = false,
  className,
}: {
  podeVerValores: boolean;
  /** undefined = carregando; null = o banco recusou (sem permissao) */
  faturamento: Periodizado<FaturamentoDoPeriodo> | null | undefined;
  erro?: boolean;
  tentarDeNovo?: ReactNode;
  /** Valor cheio e rodape com todas as contagens (aba Comercial). */
  detalhado?: boolean;
  className?: string;
}) {
  const casca = {
    rotulo: "Faturamento estimado",
    icone: Banknote,
    className,
  } as const;

  if (!podeVerValores) {
    return (
      <CartaoDeMetrica
        {...casca}
        estado="sem-acesso"
        dica={DICA_SEM_ACESSO_A_VALORES}
      />
    );
  }
  if (erro) {
    return (
      <CartaoDeMetrica {...casca} estado="erro" tentarDeNovo={tentarDeNovo} />
    );
  }
  if (faturamento === undefined) {
    return <CartaoDeMetrica {...casca} estado="carregando" />;
  }
  if (faturamento === null) {
    // O banco recusou mesmo a pagina achando que podia (papel mudou no meio
    // do caminho): sem acesso, nunca zero.
    return (
      <CartaoDeMetrica
        {...casca}
        estado="sem-acesso"
        dica={DICA_SEM_ACESSO_A_VALORES}
      />
    );
  }

  const atual = faturamento.atual;
  const fora = foraDaSoma(atual);
  const estado = estadoDoFaturamento(atual);
  if (estado === "sem-comparecimento") {
    return (
      <CartaoDeMetrica
        {...casca}
        estado="vazio"
        texto={TEXTO_SEM_COMPARECIMENTO}
        rodape="Soma o preço das consultas com comparecimento no período."
      />
    );
  }
  if (estado === "sem-preco") {
    // Comparecimentos so de convenio sem valor ou sem preco: "R$ 0,00"
    // seria um numero falso. O rodape diz o que faltou (o CSV escreve o
    // mesmo texto, estadoDoFaturamento).
    return (
      <CartaoDeMetrica
        {...casca}
        estado="vazio"
        texto={TEXTO_SEM_PRECO_PARA_SOMAR}
        rodape={fora.join(", ")}
      />
    );
  }

  const rodape = detalhado
    ? [
        `${plural(atual.comValor, "consulta", "consultas")} com valor de ${plural(atual.comparecimentos, "comparecimento", "comparecimentos")}`,
        ...fora,
      ].join(", ")
    : fora.length > 0
      ? `Fora da soma: ${fora.join(", ")}`
      : `De ${plural(atual.comparecimentos, "comparecimento", "comparecimentos")}`;

  return (
    <CartaoDeMetrica
      {...casca}
      valor={
        detalhado
          ? formatarReaisCompleto(atual.valorCents)
          : formatarReaisCompacto(atual.valorCents)
      }
      valorFalado={
        detalhado ? undefined : formatarReaisCompleto(atual.valorCents)
      }
      variacao={
        faturamento.anterior
          ? {
              atual: atual.valorCents,
              anterior: faturamento.anterior.valorCents,
              comparadoCom: "período anterior",
            }
          : null
      }
      rodape={rodape}
    />
  );
}
