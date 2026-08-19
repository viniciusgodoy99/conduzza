import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { NAV_ITEMS } from "@/lib/navigation";

// Conteudo interino dos modulos da area logada, ate cada fase do backlog
// entregar a tela de verdade. Usa o vazio inicial do brief (secao 8).

const DESCRIPTIONS: Record<string, { header: string; empty: string }> = {
  "/inicio": {
    header: "O resumo do dia da clínica",
    empty: "Os indicadores aparecem quando a clínica estiver conectada.",
  },
  "/atendimento": {
    header: "As conversas do WhatsApp da clínica",
    empty: "As conversas aparecem quando o WhatsApp estiver conectado.",
  },
  "/agenda": {
    header: "A agenda por profissional",
    empty: "Os horários aparecem quando os profissionais forem cadastrados.",
  },
  "/leads": {
    header: "Quem chegou e ainda não agendou",
    empty: "Os leads aparecem quando as primeiras conversas chegarem.",
  },
  "/pacientes": {
    header: "A base de pacientes da clínica",
    empty: "Os pacientes aparecem quando o primeiro agendamento for criado.",
  },
  "/confirmacoes": {
    header: "As confirmações de consulta do dia seguinte",
    empty: "As confirmações aparecem quando a agenda estiver em uso.",
  },
  "/espera": {
    header: "A fila de espera por horário",
    empty: "A fila aparece quando o primeiro paciente entrar na espera.",
  },
  "/relatorios": {
    header: "Qual canal traz paciente que comparece",
    empty: "Os relatórios aparecem quando houver dados de atendimento.",
  },
  "/agente": {
    header: "Como a recepcionista de IA se comporta",
    empty: "A configuração do agente chega na fase do agente de IA.",
  },
  "/automacoes": {
    header: "As réguas automáticas de mensagem",
    empty: "As automações chegam na fase de réguas.",
  },
  "/cadastros": {
    header: "Profissionais, procedimentos, convênios e vínculos",
    empty: "Os cadastros chegam na fase de cadastro e agenda.",
  },
  "/configuracoes": {
    header: "Clínica, marca, usuários e privacidade",
    empty: "As configurações chegam junto com o login e os papéis.",
  },
};

export function ModulePlaceholder({ href }: { href: string }) {
  const item = NAV_ITEMS.find((navItem) => navItem.href === href);
  const copy = DESCRIPTIONS[href];
  if (!item || !copy) {
    return null;
  }
  return (
    <div className="grid gap-6 p-6">
      <PageHeader title={item.label} description={copy.header} />
      <EmptyState
        icon={item.icon}
        title="Em construção"
        description={copy.empty}
      />
    </div>
  );
}
