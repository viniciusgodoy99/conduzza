import { CalendarCheck, CalendarMinus2, Percent } from "lucide-react";

import { BarraComparecimento } from "@/components/pacientes/comum";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import type { IndicadoresDoPaciente } from "@/lib/domain/pacientes-ui";

// Os tres cartoes da ficha, no cartao de metrica unico (Fase 3). Total de
// consultas = compareceu + faltou: cancelada com aviso nao e o mesmo que
// sumir no dia, entao nao entra na conta. Sem consulta nenhuma a taxa NAO
// existe e o cartao diz "Ainda não medido" com o porque na dica, nunca 0%,
// que leria como paciente que nunca aparece, nem traco. Sem lime: o lime da
// ficha e o "Salvar cadastro".
//
// O DOM que o e2e usa continua: o span do rotulo e filho direto do cartao,
// com o icone dentro, e "33" + "%" saem colados no texto do cartao.
//
// Profissional so enxerga as consultas da propria agenda (RLS de
// appointment): os rotulos dizem isso, para o numero nao passar por historico
// completo do paciente.

const numero = new Intl.NumberFormat("pt-BR");

export function IndicadoresPaciente({
  indicadores,
  soDaSuaAgenda = false,
}: {
  indicadores: IndicadoresDoPaciente;
  soDaSuaAgenda?: boolean;
}) {
  const sufixo = soDaSuaAgenda ? " na sua agenda" : "";
  const taxa = indicadores.taxaComparecimento;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <CartaoDeMetrica
        rotulo={`Total de consultas${sufixo}`}
        icone={CalendarCheck}
        valor={numero.format(indicadores.totalConsultas)}
      />
      <CartaoDeMetrica
        rotulo={`Faltas${sufixo}`}
        icone={CalendarMinus2}
        valor={numero.format(indicadores.faltas)}
      />
      {taxa === null ? (
        <CartaoDeMetrica
          rotulo={`Taxa de comparecimento${sufixo}`}
          icone={Percent}
          estado="nao-medido"
          dica="A taxa aparece depois da primeira consulta atendida ou com falta."
        />
      ) : (
        <CartaoDeMetrica
          rotulo={`Taxa de comparecimento${sufixo}`}
          icone={Percent}
          valor={String(Math.round(taxa * 100))}
          unidade="%"
        >
          <BarraComparecimento
            taxa={taxa}
            mostrarValor={false}
            tamanho="md"
            className="max-w-none"
          />
        </CartaoDeMetrica>
      )}
    </div>
  );
}
