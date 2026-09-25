import { Sparkles } from "lucide-react";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";

// Agente de IA (Tela 6): o agente e da Fase 3 e ainda nao existe. Ate la a
// tela diz, em linguagem de recepcionista, o que a clinica tem AGORA e quem
// responde enquanto isso (achado 111 da revisao: nada de "em construção" nem
// "fase", e nenhum esqueleto de painel que nao existe). Casca e cabecalho do
// design system (docs/06 secao 5.14); o painel completo entra com o agente.

export default function AgentePage() {
  return (
    <div className="mx-auto grid w-full max-w-content content-start gap-4 p-6">
      <AvisoCelular />
      <PageHeader
        eyebrow="Inteligência"
        title="Agente de IA"
        description="Como a recepcionista de IA se comporta."
      />
      <Card>
        <EmptyState
          icon={Sparkles}
          title="A recepcionista de IA ainda não está ligada nesta clínica"
          description="Por enquanto a equipe responde pelo Atendimento."
          action={{
            label: "Abrir Atendimento",
            href: "/atendimento",
            variant: "outline",
          }}
        />
      </Card>
    </div>
  );
}
