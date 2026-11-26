import { CalendarDays, Clock, Bot } from "lucide-react";

import {
  CartaoDeMetrica,
  type CartaoDeMetricaProps,
} from "@/components/shared/cartao-de-metrica";
import { lerMetricaDoAgente } from "@/lib/domain/exportacao-de-resultados";
import type { Leitura, ResumoDoDia } from "@/lib/queries/inicio";
import type {
  AtendimentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

import {
  COMPARADO_COM_O_DIA,
  rodapeDasConfirmadas,
  rodapeDasUnidades,
  rodapeDoAguardando,
} from "./numeros-do-dia";

// Os 4 cartoes do DIA do Inicio (Fase 3, decisao do dono de 02/10), na
// ordem do prototipo: Consultas hoje, Confirmadas (o lime da grade),
// Aguardando (o status, Clock em warning) e Resolvidas pela IA. A variacao
// A1 compara com o mesmo dia da semana passada; o dia de hoje ainda esta em
// andamento, D-7 ja fechou (vies conhecido e aceito). Erro nunca vira zero:
// o cartao diz que nao carregou.
//
// Resolvidas pela IA (metricas certas, 23/11/2026): a medida que ja existe
// em Resultados (atendimento_do_periodo de hoje, "Resolvidas sem humano"),
// sem variacao. Sem atividade da IA hoje: vazio na clinica com o agente,
// "Ainda não medido" nas outras.

const DICA_DA_IA =
  "Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.";

// Nas clinicas com o agente habilitado (a lista do banco desde a onda 1) o
// agente ja existe, so com os telefones da equipe (E3): "chega com o
// agente" deixa de ser verdade, mas a medicao ainda nao existe.
const DICA_DA_IA_NA_FASE = "Medição da IA ainda não disponível.";

/** A dica do cartao "Resolvidas pela IA". */
export function dicaDaIaNoInicio(iaNaFase: boolean): string {
  return iaNaFase ? DICA_DA_IA_NA_FASE : DICA_DA_IA;
}

type ConteudoDoCartaoDaIa = Pick<CartaoDeMetricaProps, "rodape"> &
  (
    | { estado: "valor"; valor: string }
    | { estado: "vazio"; texto: string }
    | { estado: "nao-medido"; dica: string }
    | { estado: "erro" }
  );

/**
 * O conteudo do cartao "Resolvidas pela IA" a partir da leitura de hoje
 * (atendimento_do_periodo). Sem a leitura (ou sem o bloco do agente), a
 * dica de antes; com erro, o erro (nunca zero).
 */
export function cartaoDaIaNoInicio(
  atendimento: Leitura<Periodizado<AtendimentoDoPeriodo>> | undefined,
  iaNaFase: boolean,
): ConteudoDoCartaoDaIa {
  if (atendimento === undefined) {
    return { estado: "nao-medido", dica: dicaDaIaNoInicio(iaNaFase) };
  }
  if (!atendimento.ok) {
    return { estado: "erro" };
  }
  const agente = atendimento.dados.atual.agente;
  if (agente === null) {
    return { estado: "nao-medido", dica: dicaDaIaNoInicio(iaNaFase) };
  }
  const leitura = lerMetricaDoAgente("Resolvidas sem humano", agente);
  if (leitura.estado === "valor") {
    return { estado: "valor", valor: leitura.valor, rodape: leitura.rodape };
  }
  if (leitura.estado === "vazio") {
    return { estado: "vazio", texto: "Sem dados", rodape: leitura.rodape };
  }
  // Sem atividade da IA hoje.
  return iaNaFase
    ? {
        estado: "vazio",
        texto: "Sem dados",
        rodape: "nenhuma conversa atendida pela IA hoje",
      }
    : { estado: "nao-medido", dica: DICA_DA_IA };
}

export function IndicadoresDoDia({
  resumo,
  timezone,
  iaNaFase = false,
  atendimento,
}: {
  resumo: Leitura<ResumoDoDia>;
  timezone: string;
  /** Clinica da fase controlada do agente de IA (decidido no servidor). */
  iaNaFase?: boolean;
  /** atendimento_do_periodo de hoje; ausente = a dica de antes. */
  atendimento?: Leitura<Periodizado<AtendimentoDoPeriodo>>;
}) {
  return (
    <section
      aria-label="Indicadores de hoje"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {resumo.ok ? (
        <CartoesComValor resumo={resumo.dados} timezone={timezone} />
      ) : (
        <>
          <CartaoDeMetrica
            rotulo="Consultas hoje"
            icone={CalendarDays}
            estado="erro"
          />
          <CartaoDeMetrica destaque rotulo="Confirmadas" estado="erro" />
          <CartaoDeMetrica
            rotulo="Aguardando"
            icone={Clock}
            tom="warning"
            estado="erro"
          />
        </>
      )}
      <CartaoDeMetrica
        rotulo="Resolvidas pela IA"
        icone={Bot}
        tom="ai"
        {...cartaoDaIaNoInicio(atendimento, iaNaFase)}
      />
    </section>
  );
}

function CartoesComValor({
  resumo,
  timezone,
}: {
  resumo: ResumoDoDia;
  timezone: string;
}) {
  const { hoje, semanaPassada } = resumo;
  return (
    <>
      <CartaoDeMetrica
        rotulo="Consultas hoje"
        icone={CalendarDays}
        valor={hoje.total.toLocaleString("pt-BR")}
        rodape={rodapeDasUnidades(hoje.unidades)}
        variacao={{
          atual: hoje.total,
          anterior: semanaPassada.total,
          comparadoCom: COMPARADO_COM_O_DIA,
        }}
      />
      <CartaoDeMetrica
        destaque
        rotulo="Confirmadas"
        valor={hoje.confirmadas.toLocaleString("pt-BR")}
        rodape={rodapeDasConfirmadas(hoje.confirmadas, hoje.total)}
        variacao={{
          atual: hoje.confirmadas,
          anterior: semanaPassada.confirmadas,
          comparadoCom: COMPARADO_COM_O_DIA,
        }}
      />
      <CartaoDeMetrica
        rotulo="Aguardando"
        icone={Clock}
        tom="warning"
        valor={hoje.aguardando.toLocaleString("pt-BR")}
        rodape={rodapeDoAguardando(resumo.ultimoDisparo, timezone)}
      />
    </>
  );
}
