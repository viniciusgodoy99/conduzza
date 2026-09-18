"use client";

import { useState } from "react";

import {
  AbaAgendamentos,
  type DimensaoDaAgenda,
} from "@/components/relatorios/aba-agendamentos";
import type {
  AgendaDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Visao do papel profissional na Tela 11 ("so os proprios", matriz do
// brief): os agendamentos DELE nos ultimos 30 dias, com recorte explicito e
// rotulado. A RPC no banco recusa qualquer outro professional_id para esse
// papel, entao nao ha numero da clinica inteira passando por aqui.

export function VisaoDoProfissional({
  agenda,
}: {
  agenda: Periodizado<AgendaDoPeriodo>;
}) {
  const [dimensao, setDimensao] = useState<DimensaoDaAgenda>("procedimento");
  return (
    <AbaAgendamentos
      agenda={agenda}
      dimensao={dimensao}
      aoMudarDimensao={setDimensao}
      rotuloProprio="Seus atendimentos nos últimos 30 dias, comparados com os 30 anteriores."
    />
  );
}
