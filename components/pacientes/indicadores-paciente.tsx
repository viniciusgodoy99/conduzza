import { CalendarCheck, CalendarMinus2, Percent } from "lucide-react";

import {
  BarraComparecimento,
  CartaoIndicador,
  SemDado,
  ValorIndicador,
} from "@/components/pacientes/comum";
import {
  porcentagemDeComparecimento,
  type IndicadoresDoPaciente,
} from "@/lib/domain/pacientes-ui";

// Os tres cartoes da ficha, na receita StatCard. Total de consultas =
// compareceu + faltou: cancelada com aviso nao e o mesmo que sumir no dia,
// entao nao entra na conta. Sem consulta nenhuma a taxa NAO existe e a tela
// diz isso em texto (receita 4.7), nunca 0%, que leria como paciente que
// nunca aparece, nem traco. Sem lime:
// o lime da ficha e o "Salvar cadastro".
//
// Profissional so enxerga as consultas da propria agenda (RLS de
// appointment): os rotulos dizem isso, para o numero nao passar por historico
// completo do paciente.

export function IndicadoresPaciente({
  indicadores,
  soDaSuaAgenda = false,
}: {
  indicadores: IndicadoresDoPaciente;
  soDaSuaAgenda?: boolean;
}) {
  const sufixo = soDaSuaAgenda ? " na sua agenda" : "";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <CartaoIndicador
        rotulo={`Total de consultas${sufixo}`}
        icone={CalendarCheck}
      >
        <ValorIndicador>{indicadores.totalConsultas}</ValorIndicador>
      </CartaoIndicador>
      <CartaoIndicador rotulo={`Faltas${sufixo}`} icone={CalendarMinus2}>
        <ValorIndicador>{indicadores.faltas}</ValorIndicador>
      </CartaoIndicador>
      <CartaoIndicador
        rotulo={`Taxa de comparecimento${sufixo}`}
        icone={Percent}
      >
        {indicadores.taxaComparecimento === null ? (
          <SemDado texto="Ainda não medido" className="text-[13px]" />
        ) : (
          <div className="grid gap-2.5">
            <ValorIndicador>
              {porcentagemDeComparecimento(indicadores.taxaComparecimento)}
            </ValorIndicador>
            <BarraComparecimento
              taxa={indicadores.taxaComparecimento}
              mostrarValor={false}
              tamanho="md"
              className="max-w-none"
            />
          </div>
        )}
      </CartaoIndicador>
    </div>
  );
}
