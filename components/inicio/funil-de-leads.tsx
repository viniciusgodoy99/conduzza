import { ArrowUpRight, Funnel, Inbox } from "lucide-react";
import Link from "next/link";

import { Secao } from "@/components/relatorios/secao";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { EtapaDoFunil, Leitura } from "@/lib/queries/inicio";

import { contarLeads, maiorValor, tomDaEtapa } from "./numeros-do-dia";

// "Funil de leads" do Inicio (Fase 3): as etapas da jornada DA CLINICA, em
// ordem de posicao, com quantos contatos estao em cada uma AGORA (retrato de
// contact.funnel_stage, o mesmo numero do Kanban de Leads). Nao e coorte do
// periodo: o funil de coorte mora em Resultados. Barras so em destaque ou
// neutro (C12): os tons de status do prototipo sao proibidos, e "Perdido"
// fica neutro porque nao e avanco.

const TITULO = "Funil de leads";

function AbrirLeads() {
  return (
    <Button asChild variant="ghost" size="icon">
      <Link href="/leads" aria-label="Abrir Leads">
        <ArrowUpRight aria-hidden />
      </Link>
    </Button>
  );
}

export function FunilDeLeads({ funil }: { funil: Leitura<EtapaDoFunil[]> }) {
  if (!funil.ok) {
    return (
      <Secao titulo={TITULO} icone={Funnel} acao={<AbrirLeads />}>
        <EmptyState
          compact
          tom="erro"
          title="Não foi possível carregar o funil de leads"
        />
      </Secao>
    );
  }

  const etapas = funil.dados;
  const soma = etapas.reduce((total, etapa) => total + etapa.total, 0);

  if (soma === 0) {
    return (
      <Secao titulo={TITULO} icone={Funnel} acao={<AbrirLeads />}>
        <EmptyState
          compact
          icon={Inbox}
          title="Nenhum lead na jornada ainda"
          description="Quando alguém escrever para a clínica, o lead entra na primeira etapa e aparece aqui."
        />
      </Secao>
    );
  }

  const maximo = maiorValor(etapas.map((etapa) => etapa.total));

  return (
    <Secao
      titulo={TITULO}
      icone={Funnel}
      meta={`${contarLeads(soma)}, pela etapa em que estão agora`}
      acao={<AbrirLeads />}
    >
      {etapas.map((etapa) => (
        <BarraDeProgresso
          key={etapa.chave}
          rotulo={etapa.nome}
          legenda={etapa.total.toLocaleString("pt-BR")}
          valor={etapa.total}
          maximo={maximo}
          tom={tomDaEtapa(etapa.papel)}
          ariaLabel={`${etapa.nome}: ${contarLeads(etapa.total)}`}
        />
      ))}
    </Secao>
  );
}
