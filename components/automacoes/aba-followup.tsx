"use client";

import {
  Check,
  ChevronDown,
  PenLine,
  Plus,
  Repeat,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  criarReguaDeFollowupAction,
  excluirReguaAction,
} from "@/app/(app)/automacoes/actions";
import { AbaRegua } from "@/components/automacoes/aba-regua";
import {
  DialogoDeExclusao,
  PERDAS_DO_HISTORICO,
} from "@/components/automacoes/dialogo-de-exclusao";
import type { NumerosDasAutomaticas } from "@/components/automacoes/numeros-de-envio";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REGUA_STATUS } from "@/lib/design/status";
import type { ReguaDeFollowup } from "@/lib/queries/automacoes";
import { cn } from "@/lib/utils";

// Aba de follow-up de leads (spec modulo 7): regua por ETAPA da jornada.
// Gatilho = entrou na etapa; parada automatica quando responde, muda de
// etapa (agendou, perdido, qualquer movimento). Mensagem fixa por enquanto:
// deixar a IA escrever fica desabilitado ate o agente existir com o filtro
// de conformidade (regra 3.2; o banco recusa use_ai=true).
//
// Desenho do design system (docs/06 secao 5.10): o modo em uso como cartao
// escolhido (receita 4.7), cada regua num cartao com cabecalho de acordeao e
// a situacao em 3 camadas (REGUA_STATUS; achado 54), e "Excluir" suave que
// pergunta antes (achado 48).

export type EtapaParaFollowup = { chave: string; nome: string };

export function AbaFollowup({
  clinicId,
  followups,
  etapas,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  numeros = null,
  aoMudar,
}: {
  clinicId: string;
  followups: ReguaDeFollowup[];
  /** Etapas da jornada que aceitam follow-up (sem a de perda). */
  etapas: EtapaParaFollowup[];
  nomeDaClinica: string;
  precoCents: number | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ehAdministrador: boolean;
  /** Numeros ativos e politica: o teste de cada passo escolhe o numero. */
  numeros?: NumerosDasAutomaticas | null;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [aExcluir, setAExcluir] = useState<ReguaDeFollowup | null>(null);
  const [etapaEscolhida, setEtapaEscolhida] = useState("");
  const [pendente, iniciarTransicao] = useTransition();

  const etapasLivres = etapas.filter(
    (etapa) => !followups.some((regua) => regua.trigger_stage === etapa.chave),
  );

  const criar = () => {
    iniciarTransicao(async () => {
      const resultado = await criarReguaDeFollowupAction({
        trigger_stage: etapaEscolhida,
      });
      if (resultado.ok) {
        toast.success("Régua criada, desligada. Escreva as mensagens e ligue.");
        setDialogoAberto(false);
        setEtapaEscolhida("");
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível criar a régua.");
    });
  };

  const excluir = (regua: ReguaDeFollowup) => {
    iniciarTransicao(async () => {
      const resultado = await excluirReguaAction({ cadence_id: regua.id });
      if (resultado.ok) {
        toast.success(`Régua ${regua.name} excluída.`);
        setAExcluir(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  return (
    <div className="grid gap-4">
      {/* Os dois modos de escrever (spec 7.3): fixa hoje, IA com o agente.
          O modo em uso e o cartao escolhido (lime suave com borda); o da IA
          fica visivel, apagado e com a dica, porque o agente nao existe
          ainda (Fase 3) e nada de IA fica ativo. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-3 rounded-card border border-primary-edge bg-primary-soft p-3.5">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-md bg-card text-primary-text">
            <PenLine className="size-[17px]" aria-hidden />
          </span>
          <div className="grid gap-0.5">
            <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-text-strong">
              <Check className="size-3.5 text-primary-text" aria-hidden />
              Mensagem fixa
            </span>
            <span className="text-xs text-foreground">
              Você escreve o texto de cada passo. É o modo em uso.
            </span>
          </div>
        </div>
        <DisabledWithHint
          className="w-full"
          hint="Chega com o agente de IA. As travas de conformidade médica vêm antes de qualquer texto escrito por máquina."
        >
          <div className="flex w-full gap-3 rounded-card border border-border bg-card p-3.5 opacity-45">
            <span className="grid size-[34px] shrink-0 place-items-center rounded-md bg-surface-4 text-text-secondary">
              <WandSparkles className="size-[17px]" aria-hidden />
            </span>
            <div className="grid gap-0.5">
              <span className="text-[13.5px] font-bold text-text-strong">
                Deixar a IA escrever
              </span>
              <span className="text-xs text-text-secondary">
                A IA escreve dentro das regras da clínica.
              </span>
            </div>
          </div>
        </DisabledWithHint>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-text-secondary">
          A régua acompanha o lead enquanto ele está na etapa. Ela para sozinha
          quando ele responde, agenda ou muda de etapa.
        </p>
        {podeEditar && etapasLivres.length > 0 ? (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => setDialogoAberto(true)}
          >
            <Plus aria-hidden />
            Nova régua por etapa
          </Button>
        ) : (
          <DisabledWithHint
            hint={
              podeEditar
                ? "Todas as etapas da jornada já têm régua de follow-up"
                : dicaSemPermissao
            }
          >
            <Button variant="outline" disabled>
              <Plus aria-hidden />
              Nova régua por etapa
            </Button>
          </DisabledWithHint>
        )}
      </div>

      {followups.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={Repeat}
            title="Nenhuma régua de follow-up ainda"
            description="Crie uma para a etapa onde os leads mais esfriam, como quem pediu preço e sumiu."
          />
        </Card>
      ) : (
        followups.map((regua) => {
          const expandida = aberta === regua.id;
          const idConteudo = `followup-${regua.id}`;
          return (
            <Card key={regua.id}>
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <button
                  type="button"
                  aria-expanded={expandida}
                  aria-controls={idConteudo}
                  onClick={() => setAberta(expandida ? null : regua.id)}
                  className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-text-secondary transition-transform duration-(--dur-base) motion-reduce:transition-none",
                      expandida && "rotate-180",
                    )}
                    aria-hidden
                  />
                  <span className="text-[13.5px] font-bold text-text-strong">
                    {regua.name}
                  </span>
                  <span className="text-xs text-text-secondary">
                    etapa {regua.etapa_nome}
                  </span>
                  <StatusChip
                    size="sm"
                    className="ml-auto"
                    definition={
                      REGUA_STATUS[regua.active ? "ligada" : "desligada"]
                    }
                  />
                </button>
                {podeEditar ? (
                  <Button
                    variant="destructive"
                    aria-label={`Excluir a régua ${regua.name}`}
                    disabled={pendente}
                    onClick={() => setAExcluir(regua)}
                  >
                    <Trash2 aria-hidden />
                    Excluir
                  </Button>
                ) : (
                  <DisabledWithHint hint={dicaSemPermissao}>
                    <Button
                      variant="destructive"
                      aria-label={`Excluir a régua ${regua.name}`}
                      disabled
                    >
                      <Trash2 aria-hidden />
                      Excluir
                    </Button>
                  </DisabledWithHint>
                )}
              </div>
              {expandida ? (
                <div
                  id={idConteudo}
                  className="grid gap-4 border-t border-border p-4"
                >
                  {/* Spec 7.6: quem sera pulado por falta de autorizacao */}
                  {regua.sem_autorizacao > 0 ? (
                    <Aviso tom="info">
                      <span className="cz-num font-semibold">
                        {regua.sem_autorizacao}
                      </span>{" "}
                      de <span className="cz-num">{regua.total_na_etapa}</span>{" "}
                      {regua.total_na_etapa === 1 ? "contato" : "contatos"}{" "}
                      desta etapa não{" "}
                      {regua.sem_autorizacao === 1 ? "tem" : "têm"} autorização
                      para receber mensagens e{" "}
                      {regua.sem_autorizacao === 1
                        ? "será pulado"
                        : "serão pulados"}
                      .
                    </Aviso>
                  ) : null}
                  <AbaRegua
                    clinicId={clinicId}
                    regua={regua}
                    copy={{
                      ligar: `Ligar a régua ${regua.name}`,
                      ligada: "Régua ligada",
                      desligada: "Régua desligada",
                      inicioDaLinha: "Entrou na etapa",
                      fimDaLinha: null,
                      vazio: "Esta régua não tem mensagens.",
                    }}
                    nomeDaClinica={nomeDaClinica}
                    estimativa={{
                      eventos30d: regua.eventos30d,
                      rotuloDoEvento: "leads que entraram na etapa",
                      rotuloDoEventoSingular: "lead que entrou na etapa",
                      precoCents,
                    }}
                    sentidoDoPasso="depois"
                    tipoDaRegua="followup"
                    eventoRotulo="a entrada na etapa"
                    placeholders={["nome", "clinica"]}
                    podeEditar={podeEditar}
                    dicaSemPermissao={dicaSemPermissao}
                    ehAdministrador={ehAdministrador}
                    numeros={numeros}
                    aninhada
                    aoMudar={aoMudar}
                  />
                </div>
              ) : null}
            </Card>
          );
        })
      )}

      <DialogoDeExclusao
        aberto={aExcluir !== null}
        titulo={`Excluir a régua ${aExcluir?.name ?? ""}?`}
        descricao={`Os leads da etapa ${aExcluir?.etapa_nome ?? ""} deixam de receber mensagens de acompanhamento.`}
        consequencias={[
          "Os textos e os anexos da régua são apagados.",
          "Todo o histórico de envios dela também é apagado e some das métricas.",
          PERDAS_DO_HISTORICO.resposta,
        ]}
        rotuloConfirmar="Excluir régua"
        pendente={pendente}
        onFechar={() => setAExcluir(null)}
        onConfirmar={() => {
          if (aExcluir) {
            excluir(aExcluir);
          }
        }}
      />

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Nova régua de follow-up</DialogTitle>
            <DialogDescription>
              Escolha a etapa da jornada. A régua nasce desligada e sem
              mensagens, para você escrever antes de ligar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="followup-etapa">Etapa da jornada</Label>
            <Select value={etapaEscolhida} onValueChange={setEtapaEscolhida}>
              <SelectTrigger id="followup-etapa" className="w-full">
                <SelectValue placeholder="Escolha a etapa" />
              </SelectTrigger>
              <SelectContent>
                {etapasLivres.map((etapa) => (
                  <SelectItem key={etapa.chave} value={etapa.chave}>
                    {etapa.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {etapasLivres.length === 0 ? (
              <p className="text-[11px] text-text-secondary">
                Todas as etapas da jornada já têm régua de follow-up.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setDialogoAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={pendente || etapaEscolhida === ""}
              onClick={criar}
            >
              {pendente ? "Criando..." : "Criar régua"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
