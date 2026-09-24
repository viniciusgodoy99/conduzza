"use client";

import {
  Bot,
  ChevronDown,
  MessageSquareText,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  criarReguaDeFollowupAction,
  excluirReguaAction,
} from "@/app/(app)/automacoes/actions";
import { AbaRegua } from "@/components/automacoes/aba-regua";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReguaDeFollowup } from "@/lib/queries/automacoes";
import { cn } from "@/lib/utils";

// Aba de follow-up de leads (spec modulo 7): regua por ETAPA da jornada.
// Gatilho = entrou na etapa; parada automatica quando responde, muda de
// etapa (agendou, perdido, qualquer movimento). Mensagem fixa por enquanto:
// deixar a IA escrever fica desabilitado ate o agente existir com o filtro
// de conformidade (regra 3.2; o banco recusa use_ai=true).

export type EtapaParaFollowup = { chave: string; nome: string };

export function AbaFollowup({
  clinicId,
  followups,
  etapas,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
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
  aoMudar: () => Promise<unknown> | void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
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
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  return (
    <div className="grid gap-4">
      {/* Os dois modos de escrever (spec 7.3): fixa hoje, IA com o agente */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-3 rounded-lg border bg-card p-3">
          <MessageSquareText
            className="size-5 shrink-0"
            style={{ color: "var(--success-text)" }}
            aria-hidden
          />
          <div className="grid gap-0.5 text-sm">
            <span className="font-medium">Mensagem fixa</span>
            <span className="text-xs text-text-secondary">
              Você escreve o texto de cada passo. É o modo em uso.
            </span>
          </div>
        </div>
        <DisabledWithHint hint="Chega com o agente de IA. As travas de conformidade médica vêm antes de qualquer texto escrito por máquina.">
          <div className="flex gap-3 rounded-lg border border-dashed bg-card p-3 opacity-60">
            <Bot className="size-5 shrink-0 text-text-tertiary" aria-hidden />
            <div className="grid gap-0.5 text-sm">
              <span className="font-medium">Deixar a IA escrever</span>
              <span className="text-xs text-text-secondary">
                A IA escreve dentro das regras da clínica.
              </span>
            </div>
          </div>
        </DisabledWithHint>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-xs text-text-secondary">
          A régua acompanha o lead enquanto ele está na etapa. Ela para sozinha
          quando ele responde, agenda ou muda de etapa.
        </p>
        {podeEditar ? (
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente || etapasLivres.length === 0}
            onClick={() => setDialogoAberto(true)}
          >
            <Plus className="size-4" />
            Nova régua por etapa
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button variant="outline" className="h-10" disabled>
              <Plus className="size-4" />
              Nova régua por etapa
            </Button>
          </DisabledWithHint>
        )}
      </div>

      {followups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          Nenhuma régua de follow-up ainda. Crie uma para a etapa onde os leads
          mais esfriam, como quem pediu preço e sumiu.
        </p>
      ) : (
        followups.map((regua) => {
          const expandida = aberta === regua.id;
          return (
            <article key={regua.id} className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  aria-expanded={expandida}
                  onClick={() => setAberta(expandida ? null : regua.id)}
                  className="flex min-h-10 flex-1 items-center gap-2 text-left"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      expandida ? "rotate-180" : "",
                    )}
                    aria-hidden
                  />
                  <span className="text-sm font-medium">{regua.name}</span>
                  <span className="text-xs text-text-secondary">
                    etapa {regua.etapa_nome}
                  </span>
                  <span className="ml-auto text-xs text-text-secondary">
                    {regua.active ? "Ligada" : "Desligada"}
                  </span>
                </button>
                {podeEditar ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 [color:var(--alert-text)]"
                    disabled={pendente}
                    onClick={() => excluir(regua)}
                  >
                    <Trash2 className="size-4" />
                    Excluir
                  </Button>
                ) : (
                  <DisabledWithHint hint={dicaSemPermissao}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 [color:var(--alert-text)]"
                      disabled
                    >
                      <Trash2 className="size-4" />
                      Excluir
                    </Button>
                  </DisabledWithHint>
                )}
              </div>
              {expandida ? (
                <div className="grid gap-3 border-t p-3">
                  {/* Spec 7.6: quem sera pulado por falta de autorizacao */}
                  {regua.sem_autorizacao > 0 ? (
                    <p className="rounded-lg border px-3 py-2 text-xs text-text-secondary">
                      <strong>{regua.sem_autorizacao}</strong> de{" "}
                      {regua.total_na_etapa}{" "}
                      {regua.total_na_etapa === 1 ? "contato" : "contatos"}{" "}
                      desta etapa não{" "}
                      {regua.sem_autorizacao === 1 ? "tem" : "têm"} autorização
                      para receber mensagens e{" "}
                      {regua.sem_autorizacao === 1
                        ? "será pulado"
                        : "serão pulados"}
                      .
                    </p>
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
                    aoMudar={aoMudar}
                  />
                </div>
              ) : null}
            </article>
          );
        })
      )}

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent className="sm:max-w-md">
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
              <SelectTrigger id="followup-etapa" className="min-h-10">
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
              <p className="text-xs text-text-tertiary">
                Todas as etapas da jornada já têm régua de follow-up.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              disabled={pendente}
              onClick={() => setDialogoAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              className="h-10"
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
