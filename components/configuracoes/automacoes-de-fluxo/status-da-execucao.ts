import { CircleCheck, Clock, OctagonAlert, SkipForward } from "lucide-react";

import type { StatusDefinition } from "@/lib/design/status";
import type { StatusDaExecucao } from "@/lib/domain/automacoes-de-fluxo";

// Situacao de uma execucao de automacao de fluxo, em 3 camadas (forma,
// rotulo, cor), seguindo a tabela de icones reservados (docs/06 secao 4.6):
// CircleCheck e sempre sucesso; Clock e aguardando (warning); OctagonAlert e
// erro ou falha; SkipForward (neutro) ja e o "nao saiu" das metricas da
// regua. O teste tests/unit/configuracoes/automacoes-de-fluxo-status.test.ts
// confere a regra "um icone, uma cor" contra todos os mapas do produto.

export const EXECUCAO_STATUS: Record<StatusDaExecucao, StatusDefinition> = {
  pendente: { label: "Aguardando", tone: "warning", icon: Clock },
  executada: { label: "Feita", tone: "success", icon: CircleCheck },
  pulada: { label: "Pulada", tone: "neutral", icon: SkipForward },
  falhou: { label: "Falhou", tone: "alert", icon: OctagonAlert },
};
