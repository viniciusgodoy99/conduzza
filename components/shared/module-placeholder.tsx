import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { NAV_ITEMS } from "@/lib/navigation";

// Conteudo interino de modulo que ainda nao tem tela. Hoje so o Agente de IA
// usa. O texto e de recepcionista: diz o que a clinica tem agora e quem
// responde enquanto isso, sem "em construcao" nem "fase" (linguagem de
// backlog, achado 111 da revisao). O vazio vai dentro de um Card, como todo
// vazio solto na pagina (docs/06 secao 4.6).

const COPY: Record<
  string,
  { header: string; titulo: string; descricao: string }
> = {
  "/agente": {
    header: "Como a recepcionista de IA se comporta",
    titulo: "A recepcionista de IA ainda não está ligada nesta clínica",
    descricao: "Por enquanto a equipe responde pelo Atendimento.",
  },
};

export function ModulePlaceholder({ href }: { href: string }) {
  const item = NAV_ITEMS.find((navItem) => navItem.href === href);
  const copy = COPY[href];
  if (!item || !copy) {
    return null;
  }
  return (
    <div className="grid gap-6 p-6">
      <PageHeader title={item.label} description={copy.header} />
      <Card>
        <EmptyState
          icon={item.icon}
          title={copy.titulo}
          description={copy.descricao}
        />
      </Card>
    </div>
  );
}
