"use client";

import {
  CircleCheck,
  CircleMinus,
  Hourglass,
  MessagesSquare,
  Plug,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader } from "@/components/ui/card";
import type { StatusDefinition } from "@/lib/design/status";

// Checklist de primeiros passos da clinica recem-criada. Aparece ACIMA do
// painel enquanto houver passo pendente e some quando tudo esta pronto.
//
// Desenho do design system Conduzza (docs/06 secao 5.2) e correcoes dos
// achados 112 e 126 da revisao de liberacao:
// - o ladrilho do passo e SEMPRE neutro; o estado vai no chip, com icone de
//   forma propria (CircleCheck feito, Hourglass pendente, CircleMinus
//   dispensado), rotulo e cor. Antes o mesmo icone do passo mudava de cor;
// - quem nao configura a clinica ve a acao desabilitada com a dica do papel,
//   nunca escondida (regra do brief);
// - "Chamar a equipe" pode ser dispensado por quem trabalha sozinho. A
//   escolha e conveniencia por navegador (localStorage, com try/catch): nao
//   e estado do sistema, entao nao vai para o banco.

export type ChaveDoPasso = "whatsapp" | "equipe" | "atendimento";

export type PassoDoChecklist = {
  chave: ChaveDoPasso;
  concluido: boolean;
  titulo: string;
  /** Texto ou trechos (numeros em cz-num); elemento React cruza a fronteira */
  descricao: React.ReactNode;
  acao?: {
    rotulo: string;
    href: string;
    /** Dica do papel sem permissao: a acao aparece desabilitada com ela */
    bloqueio?: string | null;
  };
  /** Pode ser dispensado neste navegador ("Não tenho equipe") */
  dispensavel?: boolean;
};

// Icone por chave: componente nao atravessa a fronteira servidor/cliente.
const ICONE_DO_PASSO: Record<ChaveDoPasso, LucideIcon> = {
  whatsapp: Plug,
  equipe: UserPlus,
  atendimento: MessagesSquare,
};

const ESTADO_DO_PASSO: Record<
  "feito" | "pendente" | "dispensado",
  StatusDefinition
> = {
  feito: { label: "Feito", tone: "success", icon: CircleCheck },
  pendente: { label: "Pendente", tone: "warning", icon: Hourglass },
  dispensado: { label: "Dispensado", tone: "neutral", icon: CircleMinus },
};

// Estado "ainda nao sei" do servidor e da hidratacao: o localStorage so
// existe no navegador.
const DESCONHECIDO = "?";
const EVENTO_DE_MUDANCA = "conduzza:checklist-dispensado";

function chaveDoArmazenamento(clinicId: string): string {
  return `conduzza:inicio:passos-dispensados:${clinicId}`;
}

function lerDispensados(clinicId: string): string {
  try {
    return window.localStorage.getItem(chaveDoArmazenamento(clinicId)) ?? "";
  } catch {
    // Janela privada ou armazenamento bloqueado: nada dispensado.
    return "";
  }
}

function gravarDispensados(clinicId: string, chaves: Set<string>): boolean {
  try {
    const chave = chaveDoArmazenamento(clinicId);
    if (chaves.size === 0) {
      window.localStorage.removeItem(chave);
    } else {
      window.localStorage.setItem(chave, [...chaves].join(","));
    }
    return true;
  } catch {
    return false;
  } finally {
    window.dispatchEvent(new Event(EVENTO_DE_MUDANCA));
  }
}

function assinar(aoMudar: () => void): () => void {
  window.addEventListener("storage", aoMudar);
  window.addEventListener(EVENTO_DE_MUDANCA, aoMudar);
  return () => {
    window.removeEventListener("storage", aoMudar);
    window.removeEventListener(EVENTO_DE_MUDANCA, aoMudar);
  };
}

export function Checklist({
  passos,
  clinicId,
}: {
  passos: PassoDoChecklist[];
  clinicId: string;
}) {
  const bruto = useSyncExternalStore(
    assinar,
    () => lerDispensados(clinicId),
    () => DESCONHECIDO,
  );
  const dispensados = useMemo(
    () =>
      new Set(bruto === DESCONHECIDO ? [] : bruto.split(",").filter(Boolean)),
    [bruto],
  );

  const estaDispensado = (passo: PassoDoChecklist) =>
    Boolean(passo.dispensavel) &&
    !passo.concluido &&
    dispensados.has(passo.chave);

  // So os passos que o navegador pode dispensar dependem do localStorage.
  // Se so eles faltam, o servidor nao sabe se o checklist aparece: renderiza
  // nada ate o navegador responder, em vez de piscar o cartao e sumir.
  const pendentesFixos = passos.filter(
    (passo) => !passo.concluido && !passo.dispensavel,
  );
  if (bruto === DESCONHECIDO && pendentesFixos.length === 0) {
    return null;
  }
  const resolvidos = passos.filter(
    (passo) => passo.concluido || estaDispensado(passo),
  );
  if (resolvidos.length === passos.length) {
    return null;
  }

  const considerados = passos.filter((passo) => !estaDispensado(passo));
  const feitos = considerados.filter((passo) => passo.concluido).length;
  const primeiroPendente = passos.find(
    (passo) => !passo.concluido && !estaDispensado(passo),
  );

  const alternarDispensa = (chave: ChaveDoPasso, dispensar: boolean) => {
    const proximos = new Set(dispensados);
    if (dispensar) {
      proximos.add(chave);
    } else {
      proximos.delete(chave);
    }
    if (!gravarDispensados(clinicId, proximos)) {
      toast.error(
        "Este navegador não deixou guardar a escolha. Confira se o armazenamento do site está liberado.",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
          Primeiros passos
        </h2>
        <CardAction>
          <p className="text-xs text-text-secondary">
            <span className="cz-num">{feitos}</span> de{" "}
            <span className="cz-num">{considerados.length}</span> feitos
          </p>
        </CardAction>
      </CardHeader>
      <ol className="divide-y divide-border">
        {passos.map((passo) => {
          const Icone = ICONE_DO_PASSO[passo.chave];
          const dispensado = estaDispensado(passo);
          const estado = passo.concluido
            ? ESTADO_DO_PASSO.feito
            : dispensado
              ? ESTADO_DO_PASSO.dispensado
              : ESTADO_DO_PASSO.pendente;
          const ehOPrimeiroPendente = passo === primeiroPendente;
          const variante = ehOPrimeiroPendente ? "solid" : "outline";

          return (
            <li
              key={passo.chave}
              className="flex flex-wrap items-center gap-4 px-4 py-3.5"
            >
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-4 text-foreground"
              >
                <Icone className="size-[18px]" />
              </span>
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text-strong">
                    {passo.titulo}
                  </span>
                  <StatusChip definition={estado} size="sm" />
                </span>
                <span className="text-[12.5px] text-text-secondary">
                  {dispensado
                    ? "Você indicou que atende sem equipe. A escolha vale só neste navegador."
                    : passo.descricao}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {passo.dispensavel && !passo.concluido ? (
                  <Button
                    variant="ghost"
                    onClick={() => alternarDispensa(passo.chave, !dispensado)}
                  >
                    {dispensado ? "Desfazer" : "Não tenho equipe"}
                  </Button>
                ) : null}
                {passo.acao && !dispensado ? (
                  passo.acao.bloqueio ? (
                    <DisabledWithHint hint={passo.acao.bloqueio}>
                      <Button variant={variante} disabled>
                        {passo.acao.rotulo}
                      </Button>
                    </DisabledWithHint>
                  ) : (
                    <Button asChild variant={variante}>
                      <Link href={passo.acao.href}>{passo.acao.rotulo}</Link>
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
