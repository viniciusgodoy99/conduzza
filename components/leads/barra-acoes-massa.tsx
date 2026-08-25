"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Send,
  Tag,
  UserRoundCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  etiquetarAction,
  mudarEtapaAction,
  reatribuirAction,
} from "@/app/(app)/leads/actions";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FUNNEL_STAGE,
  STATUS_TONE_VARS,
  type FunnelStage,
} from "@/lib/design/status";
import { leadsKeys, type LeadResumo } from "@/lib/queries/leads";

// Barra flutuante das acoes em massa da lista. Toda acao usa as Server
// Actions em lote existentes; Perdido passa pelo mesmo modal de motivo do
// Kanban. Disparar regua fica visivel e desabilitado ate a fase de
// Automacoes, com dica explicando por que (nunca escondido).

const ETAPAS: readonly FunnelStage[] = [
  "novo",
  "em_contato",
  "aguardando_resposta",
  "agendou",
  "compareceu",
  "perdido",
];

// Popover de acao protegida: com permissao abre o popover; sem permissao o
// botao fica visivel e desabilitado com a dica, sem popover nenhum.
function AcaoComPopover({
  podeEditar,
  dica,
  ocupado,
  rotulo,
  icone: Icone,
  aberto,
  onAberto,
  children,
}: {
  podeEditar: boolean;
  dica: string;
  ocupado: boolean;
  rotulo: string;
  icone: LucideIcon;
  aberto: boolean;
  onAberto: (a: boolean) => void;
  children: React.ReactNode;
}) {
  if (!podeEditar) {
    return (
      <DisabledWithHint hint={dica}>
        <Button variant="outline" className="h-10" disabled>
          <Icone strokeWidth={1.5} className="size-4" /> {rotulo}
        </Button>
      </DisabledWithHint>
    );
  }
  return (
    <Popover open={aberto} onOpenChange={onAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10" disabled={ocupado}>
          <Icone strokeWidth={1.5} className="size-4" /> {rotulo}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1" align="center" side="top">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function BarraAcoesMassa({
  clinicId,
  selecionados,
  membros,
  podeEditar,
  dica,
  onLimpar,
}: {
  clinicId: string;
  selecionados: LeadResumo[];
  membros: Record<string, string>;
  podeEditar: boolean;
  dica: string;
  onLimpar: () => void;
}) {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [reatribuirAberto, setReatribuirAberto] = useState(false);
  const [etapaAberto, setEtapaAberto] = useState(false);
  const [etiquetarAberto, setEtiquetarAberto] = useState(false);
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);

  const ids = selecionados.map((lead) => lead.id);
  const n = ids.length;

  const invalidar = () =>
    void queryClient.invalidateQueries({ queryKey: leadsKeys.lista(clinicId) });

  const reatribuir = async (userId: string | null) => {
    setOcupado(true);
    const resultado = await reatribuirAction({
      contact_ids: ids,
      owner_user_id: userId,
    });
    setOcupado(false);
    if (!resultado.ok) {
      toast.error(resultado.error ?? "Não foi possível reatribuir.");
      return;
    }
    toast.success(n === 1 ? "1 lead reatribuído" : `${n} leads reatribuídos`);
    setReatribuirAberto(false);
    invalidar();
  };

  const mudarEtapa = async (etapa: FunnelStage) => {
    if (etapa === "perdido") {
      setEtapaAberto(false);
      setPerdaIds(ids);
      return;
    }
    setOcupado(true);
    const resultado = await mudarEtapaAction({ contact_ids: ids, etapa });
    setOcupado(false);
    if (!resultado.ok) {
      toast.error(resultado.error ?? "Não foi possível mudar a etapa.");
      return;
    }
    toast.success(
      n === 1
        ? `1 lead movido para ${FUNNEL_STAGE[etapa].label}`
        : `${n} leads movidos para ${FUNNEL_STAGE[etapa].label}`,
    );
    setEtapaAberto(false);
    invalidar();
  };

  const etiquetar = async (adicionar: string[], remover: string[]) => {
    setOcupado(true);
    const resultado = await etiquetarAction({
      contact_ids: ids,
      adicionar,
      remover,
    });
    setOcupado(false);
    if (!resultado.ok) {
      toast.error(resultado.error ?? "Não foi possível etiquetar.");
      return;
    }
    toast.success(
      adicionar.length > 0
        ? `Etiqueta adicionada em ${n} ${n === 1 ? "lead" : "leads"}`
        : `Etiqueta removida de ${n} ${n === 1 ? "lead" : "leads"}`,
    );
    setNovaEtiqueta("");
    invalidar();
  };

  // Uniao das etiquetas dos selecionados, para remover em massa.
  const etiquetasAtuais = [
    ...new Set(selecionados.flatMap((lead) => lead.tags)),
  ].sort((a, b) => a.localeCompare(b));

  const responsaveis = Object.entries(membros)
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border bg-surface-1 px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium whitespace-nowrap">
          {n === 1 ? "1 selecionado" : `${n} selecionados`}
        </span>

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Reatribuir"
          icone={UserRoundCog}
          aberto={reatribuirAberto}
          onAberto={setReatribuirAberto}
        >
          <div className="grid max-h-64 w-52 overflow-y-auto">
            {responsaveis.map((membro) => (
              <button
                key={membro.id}
                type="button"
                className="flex min-h-10 items-center rounded-md px-2.5 text-left text-sm hover:bg-surface-3"
                onClick={() => void reatribuir(membro.id)}
              >
                {membro.nome}
              </button>
            ))}
            <button
              type="button"
              className="flex min-h-10 items-center rounded-md px-2.5 text-left text-sm text-text-secondary hover:bg-surface-3"
              onClick={() => void reatribuir(null)}
            >
              Sem responsável
            </button>
          </div>
        </AcaoComPopover>

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Mudar etapa"
          icone={ArrowRightLeft}
          aberto={etapaAberto}
          onAberto={setEtapaAberto}
        >
          <div className="grid w-56">
            {ETAPAS.map((etapa) => {
              const definicao = FUNNEL_STAGE[etapa];
              const tone = STATUS_TONE_VARS[definicao.tone];
              const Icone = definicao.icon;
              return (
                <button
                  key={etapa}
                  type="button"
                  className="flex min-h-10 items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-surface-3"
                  onClick={() => void mudarEtapa(etapa)}
                >
                  {Icone ? (
                    <Icone
                      strokeWidth={1.5}
                      className="size-4 shrink-0"
                      style={{ color: tone.text }}
                      aria-hidden
                    />
                  ) : null}
                  {definicao.label}
                </button>
              );
            })}
          </div>
        </AcaoComPopover>

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Etiquetar"
          icone={Tag}
          aberto={etiquetarAberto}
          onAberto={setEtiquetarAberto}
        >
          <div className="grid w-60 gap-3 p-2">
            <div className="flex gap-1.5">
              <Input
                value={novaEtiqueta}
                onChange={(e) => setNovaEtiqueta(e.target.value)}
                placeholder="Nova etiqueta"
                className="h-10"
                maxLength={40}
                aria-label="Nova etiqueta"
              />
              <Button
                className="h-10"
                disabled={ocupado || novaEtiqueta.trim().length === 0}
                onClick={() => void etiquetar([novaEtiqueta.trim()], [])}
              >
                Adicionar
              </Button>
            </div>
            {etiquetasAtuais.length > 0 ? (
              <div className="grid gap-1">
                <p className="text-xs text-text-tertiary">
                  Etiquetas dos selecionados (toque para remover)
                </p>
                <div className="flex flex-wrap gap-1">
                  {etiquetasAtuais.map((etiqueta) => (
                    <button
                      key={etiqueta}
                      type="button"
                      disabled={ocupado}
                      onClick={() => void etiquetar([], [etiqueta])}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-3 px-2.5 text-xs font-medium hover:bg-surface-4"
                      aria-label={`Remover etiqueta ${etiqueta}`}
                    >
                      {etiqueta}
                      <X strokeWidth={1.5} className="size-3" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">
                Os leads selecionados ainda não têm etiquetas.
              </p>
            )}
          </div>
        </AcaoComPopover>

        <DisabledWithHint hint="Nenhuma régua de follow-up ativa. Ative uma em Automações.">
          <Button variant="outline" className="h-10" disabled>
            <Send strokeWidth={1.5} className="size-4" /> Disparar régua
          </Button>
        </DisabledWithHint>

        <Button variant="ghost" className="h-10" onClick={onLimpar}>
          <X strokeWidth={1.5} className="size-4" /> Limpar seleção
        </Button>
      </div>

      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={() => {
          invalidar();
        }}
      />
    </>
  );
}
