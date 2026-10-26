import { Bot, Building2, Coins } from "lucide-react";

import {
  contagemNoPainel,
  dolares,
  SITUACAO_DA_CONTA_STATUS,
  TEXTOS_DO_PAINEL,
  USO_DA_CLINICA_STATUS,
} from "@/components/painel-geral/painel-geral";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import type { TotaisDoPainel as Totais } from "@/lib/queries/painel-geral";

// Os cartoes do topo do Painel geral como acompanhamento de cliente
// (desenho de 26/10/2026): Clinicas, Em uso, Sem uso, Suspensas, Agente de
// IA liberado e Gasto de IA no mes. Em uso + Sem uso = Clinicas; as
// suspensas sao contadas a parte e tambem entram no uso (decisao do banco,
// escrita no rodape). Os cartoes que SAO um status (em uso, sem uso,
// suspensas) levam o icone e o tom do chip (as 3 camadas, a mesma forma nos
// dois lugares); os de contagem e de gasto ficam neutros (Bot, Building2 e
// Coins sao ladrilhos decorativos). Sem lime de destaque: o painel nao tem
// um numero principal. Server Component.

export function TotaisDoPainel({ totais }: { totais: Totais }) {
  return (
    // Tres por linha nas telas largas (duas linhas): o valor em dolar em
    // mono de 34px nao cabe num sexto da largura. No celular, Clinicas e o
    // gasto ocupam a linha inteira (a conta fecha em pares).
    <section
      aria-label="Totais do sistema"
      className="grid grid-cols-2 gap-3 lg:grid-cols-3"
    >
      <CartaoDeMetrica
        className="col-span-2 lg:col-span-1"
        rotulo="Clínicas"
        icone={Building2}
        valor={contagemNoPainel(totais.clinicas)}
        rodape="Fora as de teste automático"
      />
      <CartaoDeMetrica
        rotulo="Em uso"
        icone={USO_DA_CLINICA_STATUS.em_uso.icon ?? undefined}
        tom={USO_DA_CLINICA_STATUS.em_uso.tone}
        valor={contagemNoPainel(totais.emUso)}
        rodape={TEXTOS_DO_PAINEL.rodapeDoEmUso}
      />
      <CartaoDeMetrica
        rotulo="Sem uso"
        icone={USO_DA_CLINICA_STATUS.sem_uso.icon ?? undefined}
        tom={USO_DA_CLINICA_STATUS.sem_uso.tone}
        valor={contagemNoPainel(totais.semUso)}
        rodape={TEXTOS_DO_PAINEL.rodapeDoSemUso}
      />
      <CartaoDeMetrica
        rotulo="Suspensas"
        icone={SITUACAO_DA_CONTA_STATUS.suspensa.icon ?? undefined}
        tom={SITUACAO_DA_CONTA_STATUS.suspensa.tone}
        valor={contagemNoPainel(totais.suspensas)}
        rodape={TEXTOS_DO_PAINEL.rodapeDasSuspensas}
      />
      <CartaoDeMetrica
        rotulo="Agente de IA liberado"
        icone={Bot}
        valor={contagemNoPainel(totais.agenteLiberado)}
        rodape={TEXTOS_DO_PAINEL.rodapeDoAgenteLiberado}
      />
      <CartaoDeMetrica
        className="col-span-2 lg:col-span-1"
        rotulo="Gasto de IA no mês"
        icone={Coins}
        valor={dolares(totais.gastoMesCentavos)}
        rodape="Todas as clínicas, no mês corrente de cada uma"
      />
    </section>
  );
}
