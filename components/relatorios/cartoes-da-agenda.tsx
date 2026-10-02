import { CalendarCheck, CalendarMinus2, CalendarOff, ClipboardCheck } from "lucide-react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import type { AgendaDoPeriodo, Periodizado } from "@/lib/queries/relatorios";

// Os 4 cartoes do movimento da agenda no periodo (aba Comercial e visao do
// profissional): agendadas (consultas CRIADAS no periodo), comparecimentos,
// faltas e cancelamentos (paciente e clinica somados; o detalhe por situacao
// separa os dois). Falta e cancelamento sobem para PIOR: polaridade
// menor-melhor, senao a alta de faltas sairia verde.

const COMPARADO_COM = "período anterior";

function variacao(
  atual: number,
  anterior: number | null,
  polaridade: "maior-melhor" | "menor-melhor" = "maior-melhor",
) {
  return anterior === null
    ? null
    : { atual, anterior, polaridade, comparadoCom: COMPARADO_COM };
}

export function CartoesDaAgenda({
  agenda,
}: {
  agenda: Periodizado<AgendaDoPeriodo>;
}) {
  const atual = agenda.atual;
  const anterior = agenda.anterior;
  const cancelados =
    atual.porStatus.cancelado_paciente + atual.porStatus.cancelado_clinica;
  const canceladosAnterior = anterior
    ? anterior.porStatus.cancelado_paciente +
      anterior.porStatus.cancelado_clinica
    : null;

  return (
    <section
      aria-label="Indicadores da agenda no período"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <CartaoDeMetrica
        rotulo="Consultas agendadas"
        icone={CalendarCheck}
        valor={atual.criados.toLocaleString("pt-BR")}
        variacao={variacao(atual.criados, anterior?.criados ?? null)}
        rodape="criadas no período"
      />
      <CartaoDeMetrica
        rotulo="Comparecimentos"
        icone={ClipboardCheck}
        valor={atual.porStatus.compareceu.toLocaleString("pt-BR")}
        variacao={variacao(
          atual.porStatus.compareceu,
          anterior?.porStatus.compareceu ?? null,
        )}
      />
      <CartaoDeMetrica
        rotulo="Faltas"
        icone={CalendarMinus2}
        valor={atual.porStatus.faltou.toLocaleString("pt-BR")}
        variacao={variacao(
          atual.porStatus.faltou,
          anterior?.porStatus.faltou ?? null,
          "menor-melhor",
        )}
      />
      <CartaoDeMetrica
        rotulo="Cancelamentos"
        icone={CalendarOff}
        valor={cancelados.toLocaleString("pt-BR")}
        variacao={variacao(cancelados, canceladosAnterior, "menor-melhor")}
      />
    </section>
  );
}
