import { Building2, Coins } from "lucide-react";

import {
  AGENTE_DA_CLINICA_STATUS,
  contagemNoPainel,
  dolares,
  SITUACAO_DA_CONTA_STATUS,
} from "@/components/painel-geral/painel-geral";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import type { TotaisDoPainel as Totais } from "@/lib/queries/painel-geral";

// Os totais do topo do Painel geral (onda 1): clinicas, ativas, suspensas,
// com o agente em teste e o gasto de IA das ultimas 24 horas e do mes. Os
// cartoes que SAO um status (ativas, suspensas, agente em teste) levam o
// icone e o tom do chip da lista (as 3 camadas, a mesma forma nos dois
// lugares); os de contagem e de gasto ficam neutros. Coins e o mesmo icone
// do "Custo do período" do agente em Resultados. Sem lime de destaque: o
// painel nao tem um numero principal. Server Component.

export function TotaisDoPainel({ totais }: { totais: Totais }) {
  return (
    // Tres por linha ate as telas largas: o valor em dolar em mono de 34px
    // nao cabe num sexto da largura a 1366px. No celular, os dois de gasto
    // ocupam a linha inteira pelo mesmo motivo.
    <section
      aria-label="Totais do sistema"
      className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6"
    >
      <CartaoDeMetrica
        rotulo="Clínicas"
        icone={Building2}
        valor={contagemNoPainel(totais.clinicas)}
        rodape="Fora as de teste automático"
      />
      <CartaoDeMetrica
        rotulo="Ativas"
        icone={SITUACAO_DA_CONTA_STATUS.ativa.icon ?? undefined}
        tom={SITUACAO_DA_CONTA_STATUS.ativa.tone}
        valor={contagemNoPainel(totais.ativas)}
      />
      <CartaoDeMetrica
        rotulo="Suspensas"
        icone={SITUACAO_DA_CONTA_STATUS.suspensa.icon ?? undefined}
        tom={SITUACAO_DA_CONTA_STATUS.suspensa.tone}
        valor={contagemNoPainel(totais.suspensas)}
      />
      <CartaoDeMetrica
        rotulo="Agente em teste"
        icone={AGENTE_DA_CLINICA_STATUS.teste.icon ?? undefined}
        tom={AGENTE_DA_CLINICA_STATUS.teste.tone}
        valor={contagemNoPainel(totais.agenteEmTeste)}
      />
      <CartaoDeMetrica
        className="col-span-2 lg:col-span-1"
        rotulo="Gasto de IA em 24 horas"
        icone={Coins}
        valor={dolares(totais.gasto24hCentavos)}
        rodape="Todas as clínicas, com o simulador"
      />
      <CartaoDeMetrica
        className="col-span-2 lg:col-span-1"
        rotulo="Gasto de IA no mês"
        icone={Coins}
        valor={dolares(totais.gastoMesCentavos)}
        rodape="Mês corrente no fuso de cada clínica"
      />
    </section>
  );
}
