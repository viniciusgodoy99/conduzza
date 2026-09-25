"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Tag,
  UserRoundCog,
  Workflow,
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
import {
  contarLeads,
  executarEmLotes,
  mensagemDeFalhaParcial,
  type ResultadoDaAcao,
  type ResultadoEmLotes,
} from "@/components/leads/em-lotes";
import type { OpcaoDeResponsavel } from "@/components/leads/filtros-leads";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";
import {
  leadsKeys,
  type LeadResumo,
  type ReguaDaEtapa,
} from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Barra flutuante das acoes em massa da lista, no desenho do design system
// Conduzza (docs/06 secao 5.4). Toda acao usa as Server Actions de Leads;
// Perdido passa pelo mesmo modal de motivo do Kanban.
//
// Correcoes da revisao de liberacao:
// - achado 95: selecao grande vai em lotes de 100 (o teto das actions), com
//   progresso; falha no meio diz quantos mudaram e deixa selecionados so os
//   que nao mudaram;
// - achado 96: depois de uma acao que deu certo, a selecao zera;
// - achado 97: "Disparar regua" continua visivel e desabilitado, agora com a
//   dica verdadeira (as reguas de follow-up sao por etapa e comecam sozinhas);
// - achado 98: no Mudar etapa, a etapa com regua de follow-up ligada vem
//   marcada, e mover para ela pede confirmacao dizendo quantos autorizados
//   vao receber as mensagens.

const DICA_DISPARAR_REGUA =
  "As réguas de follow-up começam sozinhas quando o lead entra na etapa. Use Mudar etapa para colocar os selecionados numa etapa com régua.";

// Item de lista dentro do popover, na casca do item de menu do DS.
const ITEM_DO_POPOVER =
  "flex min-h-10 w-full items-center gap-[9px] rounded-sm px-[9px] text-left text-[13px] font-medium text-foreground outline-none cz-transition hover:bg-accent hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45";

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
  larguraClassName = "w-56",
  children,
}: {
  podeEditar: boolean;
  dica: string;
  ocupado: boolean;
  rotulo: string;
  icone: LucideIcon;
  aberto: boolean;
  onAberto: (a: boolean) => void;
  larguraClassName?: string;
  children: React.ReactNode;
}) {
  if (!podeEditar) {
    return (
      <DisabledWithHint hint={dica}>
        <Button variant="outline" disabled>
          <Icone className="size-4" /> {rotulo}
        </Button>
      </DisabledWithHint>
    );
  }
  return (
    <Popover open={aberto} onOpenChange={onAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={ocupado}>
          <Icone className="size-4" /> {rotulo}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("gap-0 p-[5px]", larguraClassName)}
        align="center"
        side="top"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

type Progresso = { verbo: string; feitos: number; total: number };

type ConfirmacaoDeEtapa = {
  chave: string;
  nome: string;
  /** Nome da regua ligada; null quando nao deu para conferir as reguas */
  regua: string | null;
};

export function BarraAcoesMassa({
  jornada,
  clinicId,
  selecionados,
  responsaveis,
  reguas,
  podeEditar,
  dica,
  onLimpar,
  aoConcluir,
}: {
  jornada: EtapaDaJornada[];
  clinicId: string;
  selecionados: LeadResumo[];
  /** Membros ativos, ja ordenados: os unicos que podem virar responsavel */
  responsaveis: OpcaoDeResponsavel[];
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: ReguaDaEtapa[] | null;
  podeEditar: boolean;
  dica: string;
  onLimpar: () => void;
  /** Fim de uma acao: a selecao passa a ser so os que nao mudaram */
  aoConcluir: (restantes: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [reatribuirAberto, setReatribuirAberto] = useState(false);
  const [etapaAberto, setEtapaAberto] = useState(false);
  const [etiquetarAberto, setEtiquetarAberto] = useState(false);
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoDeEtapa | null>(
    null,
  );

  const ids = selecionados.map((lead) => lead.id);
  const n = ids.length;
  const ocupado = progresso !== null;

  const invalidar = () =>
    void queryClient.invalidateQueries({ queryKey: leadsKeys.lista(clinicId) });

  // Roda a acao em lotes de 100 com o progresso na barra. Recarrega a lista
  // se qualquer lote gravou.
  const rodar = async (
    verbo: string,
    acao: (lote: string[]) => Promise<ResultadoDaAcao>,
  ): Promise<ResultadoEmLotes> => {
    setProgresso({ verbo, feitos: 0, total: n });
    const resultado = await executarEmLotes(ids, acao, (feitos) =>
      setProgresso({ verbo, feitos, total: n }),
    );
    setProgresso(null);
    if (resultado.feitos.length > 0) {
      invalidar();
    }
    return resultado;
  };

  // Tudo certo: aviso de sucesso e selecao limpa. Falha no meio: diz quantos
  // mudaram e deixa selecionados so os que nao mudaram, para tentar de novo.
  const concluir = (resultado: ResultadoEmLotes, sucesso: string) => {
    if (resultado.erro === null) {
      toast.success(sucesso);
      aoConcluir([]);
      return;
    }
    toast.error(mensagemDeFalhaParcial(resultado, n));
    aoConcluir(resultado.restantes);
  };

  const reatribuir = async (userId: string | null) => {
    setReatribuirAberto(false);
    const resultado = await rodar("Reatribuindo", (lote) =>
      reatribuirAction({ contact_ids: lote, owner_user_id: userId }),
    );
    concluir(
      resultado,
      n === 1 ? "1 lead reatribuído" : `${n} leads reatribuídos`,
    );
  };

  const reguaPorEtapa = new Map(
    (reguas ?? []).map((regua) => [regua.etapa, regua.nome]),
  );

  const moverPara = async (chave: string, nome: string) => {
    const resultado = await rodar("Movendo", (lote) =>
      mudarEtapaAction({ contact_ids: lote, etapa: chave }),
    );
    concluir(
      resultado,
      `${contarLeads(n)} ${n === 1 ? "movido" : "movidos"} para ${nome}`,
    );
  };

  const escolherEtapa = (def: EtapaDaJornada) => {
    setEtapaAberto(false);
    if (def.papel === "perdido") {
      setPerdaIds(ids);
      return;
    }
    // Etapa com regua (ou sem como saber): confirma antes, dizendo quem
    // passa a receber mensagem. Sem regua, move direto, como sempre.
    const regua = reguaPorEtapa.get(def.chave);
    if (reguas === null || regua !== undefined) {
      setConfirmacao({
        chave: def.chave,
        nome: def.nome,
        regua: regua ?? null,
      });
      return;
    }
    void moverPara(def.chave, def.nome);
  };

  const etiquetar = async (adicionar: string[], remover: string[]) => {
    const resultado = await rodar("Etiquetando", (lote) =>
      etiquetarAction({ contact_ids: lote, adicionar, remover }),
    );
    if (resultado.erro === null) {
      setNovaEtiqueta("");
      setEtiquetarAberto(false);
    }
    concluir(
      resultado,
      adicionar.length > 0
        ? `Etiqueta adicionada em ${contarLeads(n)}`
        : `Etiqueta removida de ${contarLeads(n)}`,
    );
  };

  // Uniao das etiquetas dos selecionados, para remover em massa.
  const etiquetasAtuais = [
    ...new Set(selecionados.flatMap((lead) => lead.tags)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Quem de fato passa a receber a regua ao mudar para a etapa confirmada:
  // tem autorizacao e ainda nao estava nela (o relogio da etapa so anda
  // quando a etapa muda).
  const recebem = confirmacao
    ? selecionados.filter(
        (lead) => lead.consent_ativo && lead.funnel_stage !== confirmacao.chave,
      ).length
    : 0;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-card border border-border-strong bg-card px-3 py-2 shadow-pop">
        {progresso ? (
          <span
            role="status"
            className="flex items-center gap-2 px-1 text-[13px] font-semibold whitespace-nowrap text-text-strong"
          >
            {progresso.verbo} <span className="cz-num">{progresso.feitos}</span>{" "}
            de <span className="cz-num">{progresso.total}</span>
            <BarraDeProgresso
              valor={progresso.feitos}
              maximo={progresso.total}
              tamanho="sm"
              ariaLabel={`${progresso.feitos} de ${progresso.total} leads`}
              className="w-16"
            />
          </span>
        ) : (
          <span className="px-1 text-[13px] font-semibold whitespace-nowrap text-text-strong">
            <span className="cz-num">{n}</span>{" "}
            {n === 1 ? "selecionado" : "selecionados"}
          </span>
        )}
        <span aria-hidden className="h-6 w-px bg-border" />

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Reatribuir"
          icone={UserRoundCog}
          aberto={reatribuirAberto}
          onAberto={setReatribuirAberto}
        >
          <div className="grid cz-scroll max-h-64 overflow-y-auto">
            {responsaveis.length === 0 ? (
              <p className="px-[9px] py-2 text-xs text-text-secondary">
                Nenhum membro ativo na clínica.
              </p>
            ) : null}
            {responsaveis.map((membro) => (
              <button
                key={membro.id}
                type="button"
                className={ITEM_DO_POPOVER}
                onClick={() => void reatribuir(membro.id)}
              >
                <span className="truncate">{membro.nome}</span>
              </button>
            ))}
            <button
              type="button"
              className={cn(ITEM_DO_POPOVER, "text-text-secondary")}
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
          larguraClassName="w-64"
        >
          <div className="grid">
            {jornada.map((def) => {
              const definicao = definicaoDaEtapa(def);
              const tone = STATUS_TONE_VARS[definicao.tone];
              const Icone = definicao.icon;
              const regua = reguaPorEtapa.get(def.chave);
              return (
                <button
                  key={def.chave}
                  type="button"
                  className={ITEM_DO_POPOVER}
                  onClick={() => escolherEtapa(def)}
                >
                  {Icone ? (
                    <Icone
                      className="size-[15px] shrink-0"
                      style={{ color: tone.text }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="truncate">{definicao.label}</span>
                  {regua !== undefined ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-text-secondary">
                      <Workflow className="size-3" aria-hidden />
                      Régua
                      <span className="sr-only">
                        {" "}
                        de follow-up ligada: {regua}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
            <p className="border-t border-border px-[9px] pt-2 pb-1 text-[11px] leading-[1.4] text-text-secondary">
              {reguas === null
                ? "Não foi possível conferir as réguas de follow-up. Antes de mover, a tela pede confirmação."
                : reguaPorEtapa.size > 0
                  ? "Etapa com Régua manda mensagens automáticas para quem tem autorização."
                  : "Nenhuma etapa tem régua de follow-up ligada."}
            </p>
          </div>
        </AcaoComPopover>

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Etiquetar lead"
          icone={Tag}
          aberto={etiquetarAberto}
          onAberto={setEtiquetarAberto}
          larguraClassName="w-72"
        >
          <div className="grid gap-3 p-[5px]">
            <p className="text-[11px] leading-[1.4] text-text-secondary">
              Estas etiquetas ficam no lead. As etiquetas da conversa ficam no
              Atendimento.
            </p>
            <div className="flex gap-1.5">
              <Input
                value={novaEtiqueta}
                onChange={(e) => setNovaEtiqueta(e.target.value)}
                placeholder="Nova etiqueta do lead"
                maxLength={40}
                aria-label="Nova etiqueta"
              />
              <Button
                variant="solid"
                disabled={ocupado || novaEtiqueta.trim().length === 0}
                onClick={() => void etiquetar([novaEtiqueta.trim()], [])}
              >
                Adicionar
              </Button>
            </div>
            {etiquetasAtuais.length > 0 ? (
              <div className="grid gap-1.5">
                <p className="text-xs text-text-secondary">
                  Etiquetas do lead nos selecionados (toque no X para remover)
                </p>
                <div className="flex flex-wrap gap-2">
                  {etiquetasAtuais.map((etiqueta) => (
                    <span
                      key={etiqueta}
                      className="inline-flex h-7 max-w-full items-center gap-1 rounded-sm border border-input bg-card pr-1 pl-2.5 text-xs font-medium text-foreground"
                    >
                      <span className="truncate">{etiqueta}</span>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => void etiquetar([], [etiqueta])}
                        aria-label={`Remover etiqueta ${etiqueta}`}
                        className="hit-40 relative grid size-5 shrink-0 place-items-center rounded-[4px] text-text-secondary cz-transition hover:bg-surface-3 hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-secondary">
                Os leads selecionados ainda não têm etiquetas.
              </p>
            )}
          </div>
        </AcaoComPopover>

        <DisabledWithHint hint={DICA_DISPARAR_REGUA}>
          <Button variant="outline" disabled>
            <Workflow className="size-4" /> Disparar régua
          </Button>
        </DisabledWithHint>

        <Button variant="ghost" onClick={onLimpar} disabled={ocupado}>
          <X className="size-4" /> Limpar seleção
        </Button>
      </div>

      <Dialog
        open={confirmacao !== null}
        onOpenChange={(aberto) => (!aberto ? setConfirmacao(null) : null)}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Mover para {confirmacao?.nome}?</DialogTitle>
            <DialogDescription>
              {confirmacao?.regua
                ? `A etapa ${confirmacao.nome} tem régua de follow-up ligada (${confirmacao.regua}).`
                : "Não foi possível conferir se esta etapa tem régua de follow-up ligada."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-[13px] leading-[1.5] text-foreground">
            {confirmacao?.regua ? "" : "Se tiver, "}
            <span className="cz-num font-bold text-text-strong">
              {recebem}
            </span>{" "}
            {recebem === 1
              ? "lead com autorização vai receber"
              : "leads com autorização vão receber"}{" "}
            as mensagens automáticas dela.
            {n - recebem > 0
              ? ` Os outros ${n - recebem} não recebem nada por esta mudança (estão sem autorização ou já estavam nesta etapa).`
              : null}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmacao(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (confirmacao) {
                  const { chave, nome } = confirmacao;
                  setConfirmacao(null);
                  void moverPara(chave, nome);
                }
              }}
            >
              Mover {contarLeads(n)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={(feitos) => {
          invalidar();
          const gravados = new Set(feitos);
          aoConcluir(ids.filter((id) => !gravados.has(id)));
        }}
      />
    </>
  );
}
