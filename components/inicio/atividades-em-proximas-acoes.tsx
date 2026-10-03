import {
  ChevronRight,
  ClockAlert,
  ListChecks,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

import { BotaoRecarregar } from "@/components/shell/botao-recarregar";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionContext } from "@/lib/auth/active-clinic";
import type { ContagemDeAtividades } from "@/lib/domain/atividades";
import { log } from "@/lib/log";
import { fetchContagemDeAtividades } from "@/lib/queries/atividades";
import type { Leitura } from "@/lib/queries/inicio";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// As duas linhas de atividades em Proximas acoes do Inicio (escopo de
// 02/10/2026): "Suas atividades atrasadas" e "Suas atividades para hoje",
// cada uma levando a tela Atividades ja filtrada (Minhas e o padrao dela).
// So contagens (contagem_de_atividades, "hoje" no fuso da clinica calculado
// no banco): nenhum texto de atividade, entao nao ha leitura a auditar.
//
// Falham SOZINHAS: a leitura mora num componente de servidor proprio, dentro
// de um Suspense no cartao, e o erro vira a linha de erro (nunca zero) com
// "Tentar de novo". O Inicio e o resto de Proximas acoes continuam de pe.

const LINK_DA_LINHA =
  "flex min-h-11 items-center gap-2.5 px-4 py-2 text-[13.5px] text-foreground outline-none cz-transition hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid";

type LinhaDeAtividades = {
  rotulo: string;
  valor: number;
  href: string;
  Icone: LucideIcon;
  /** Tabela de icones reservados (docs/06 4.6): um icone, uma cor. */
  corDoIcone: string;
};

/** As linhas a partir da contagem: so as "minhas" (o Inicio e de quem usa). */
export function linhasDeAtividades(
  contagem: ContagemDeAtividades,
): LinhaDeAtividades[] {
  return [
    {
      rotulo: "Suas atividades atrasadas",
      valor: contagem.minhas_atrasadas,
      href: "/atividades?filtro=atrasadas",
      Icone: ClockAlert,
      corDoIcone: "text-alert-text",
    },
    {
      rotulo: "Suas atividades para hoje",
      valor: contagem.minhas_hoje,
      href: "/atividades?filtro=hoje",
      Icone: ListChecks,
      corDoIcone: "text-text-secondary",
    },
  ];
}

/** O desenho das duas linhas (puro, para o teste renderizar). */
export function LinhasDeAtividadesView({
  leitura,
}: {
  leitura: Leitura<ContagemDeAtividades>;
}) {
  if (!leitura.ok) {
    return (
      <li className="flex min-h-11 flex-wrap items-center gap-2.5 border-b border-border px-4 py-2 text-[13.5px] last:border-0">
        <OctagonAlert aria-hidden className="size-4 shrink-0 text-alert-text" />
        <span className="min-w-0 flex-1 text-foreground">
          Não foi possível contar suas atividades.
        </span>
        <BotaoRecarregar rotulo="Tentar de novo" variant="outline" />
      </li>
    );
  }
  return linhasDeAtividades(leitura.dados).map((linha) => (
    <li key={linha.href} className="border-b border-border last:border-0">
      <Link href={linha.href} className={LINK_DA_LINHA}>
        <linha.Icone
          aria-hidden
          className={cn("size-4 shrink-0", linha.corDoIcone)}
        />
        <span className="min-w-0 flex-1 truncate">{linha.rotulo}</span>
        <span className="cz-num font-bold text-text-strong">
          {linha.valor.toLocaleString("pt-BR")}
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-text-secondary"
        />
      </Link>
    </li>
  ));
}

/** Enquanto a contagem chega: duas linhas na forma das reais. */
export function LinhasDeAtividadesCarregando() {
  return [0, 1].map((indice) => (
    <li
      key={indice}
      aria-hidden
      className="flex min-h-11 items-center gap-2.5 border-b border-border px-4 py-2 last:border-0"
    >
      <Skeleton className="size-4 rounded-sm" />
      <Skeleton className="h-3.5 flex-1" />
      <Skeleton className="h-4 w-6" />
    </li>
  ));
}

/** Le a contagem no servidor e desenha as linhas; erro so marca as linhas. */
export async function LinhasDeAtividades() {
  const context = await getSessionContext();
  const clinicId = context?.active?.clinicId;
  if (!clinicId) {
    return null;
  }
  let leitura: Leitura<ContagemDeAtividades>;
  try {
    const supabase = await createClient();
    leitura = {
      ok: true,
      dados: await fetchContagemDeAtividades(supabase, clinicId),
    };
  } catch (erro) {
    // Sinal interno do Next nao e falha do bloco.
    unstable_rethrow(erro);
    log.error("inicio_bloco_falhou", {
      clinic_id: clinicId,
      kind: "contagem_de_atividades",
    });
    leitura = { ok: false };
  }
  return <LinhasDeAtividadesView leitura={leitura} />;
}
