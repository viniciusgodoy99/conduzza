import { Banknote, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
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
  FaturamentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Cartoes de VALOR EM REAIS da Tela 11 (Fase 3): so admin e gestor veem
// numero. Para os outros papeis o cartao continua visivel, desabilitado com a
// dica (regra 5), e nenhum valor chega ao HTML: a pagina nem busca o
// faturamento, e o banco devolve null se alguem pedir.

export const DICA_SEM_ACESSO_A_VALORES =
  "Só administrador e gestor veem valores em reais.";

export const DICA_CUSTO_POR_LEAD =
  "Chega com a leitura do investimento nos anúncios da Meta. Sem o investimento, não existe custo para mostrar.";

/** Custo por lead: "Ainda não medido" ate a Fase 4 (investimento da Meta). */
export function CartaoCustoPorLead({
  podeVerValores,
}: {
  podeVerValores: boolean;
}) {
  return podeVerValores ? (
    <CartaoDeMetrica
      rotulo="Custo por lead"
      icone={Wallet}
      estado="nao-medido"
      dica={DICA_CUSTO_POR_LEAD}
    />
  ) : (
    <CartaoDeMetrica
      rotulo="Custo por lead"
      icone={Wallet}
      estado="sem-acesso"
      dica={DICA_SEM_ACESSO_A_VALORES}
    />
  );
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
