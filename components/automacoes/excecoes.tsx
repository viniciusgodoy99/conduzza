"use client";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  criarReguaDeExcecaoAction,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import type {
  ExcecaoDeConfirmacao,
  ProcedimentoParaExcecao,
} from "@/lib/queries/automacoes";
import { cn } from "@/lib/utils";

// Excecoes da regua de confirmacao (spec 8.2 e 8.3): regua propria por
// procedimento (colonoscopia tem 41% de falta, consulta comum tem 2%) e
// regua reforcada para paciente com historico de falta. O planner escolhe a
// mais especifica sozinho; aqui a clinica cria, edita e exclui.

export function Excecoes({
  clinicId,
  excecoes,
  procedimentos,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  clinicId: string;
  excecoes: ExcecaoDeConfirmacao[];
  procedimentos: ProcedimentoParaExcecao[];
  nomeDaClinica: string;
  precoCents: number | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [base, setBase] = useState<"procedimento" | "reforcada">(
    "procedimento",
  );
  const [procedimentoId, setProcedimentoId] = useState("");
  const [limiar, setLimiar] = useState("2");
  const [pendente, iniciarTransicao] = useTransition();

  const temReforcada = excecoes.some((regua) => regua.for_no_show_history);
  const procedimentosLivres = procedimentos.filter(
    (procedimento) =>
      !excecoes.some((regua) => regua.procedure?.id === procedimento.id),
  );

  const criar = () => {
    iniciarTransicao(async () => {
      const resultado = await criarReguaDeExcecaoAction(
        base === "procedimento"
          ? { base, procedure_id: procedimentoId }
          : { base, no_show_threshold: Number(limiar) },
      );
      if (resultado.ok) {
        if (resultado.aviso) {
          toast.warning(resultado.aviso);
        }
        toast.success("Régua criada, desligada. Ajuste os textos e ligue.");
        setDialogoAberto(false);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível criar a régua.");
    });
  };

  const excluir = (regua: ExcecaoDeConfirmacao) => {
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
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">Exceções da confirmação</h3>
          <p className="max-w-prose text-xs text-text-secondary">
            Procedimentos com preparo, como colonoscopia, têm falta muito maior
            e pedem mais toques. Pacientes com histórico de falta também. A
            régua mais específica vence a principal.
          </p>
        </div>
        {podeEditar ? (
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={() => setDialogoAberto(true)}
          >
            <Plus className="size-4" />
            Nova régua de exceção
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button variant="outline" className="h-10" disabled>
              <Plus className="size-4" />
              Nova régua de exceção
            </Button>
          </DisabledWithHint>
        )}
      </div>

      {excecoes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          Nenhuma exceção ainda. A régua principal cobre todas as consultas.
        </p>
      ) : (
        excecoes.map((regua) => {
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
                    {regua.for_no_show_history
                      ? `para quem tem ${regua.no_show_threshold} ${regua.no_show_threshold === 1 ? "falta" : "faltas"} ou mais`
                      : null}
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
                <div className="border-t p-3">
                  <AbaRegua
                    clinicId={clinicId}
                    regua={regua}
                    copy={{
                      ligar: `Ligar a régua ${regua.name}`,
                      ligada: "Régua ligada",
                      desligada: "Régua desligada",
                      inicioDaLinha: "Agendou",
                      fimDaLinha: "Consulta",
                      vazio: "Esta régua não tem mensagens.",
                    }}
                    nomeDaClinica={nomeDaClinica}
                    botoesDaPreview={MENU_CONFIRMACAO.map(
                      (opcao) => opcao.text,
                    )}
                    estimativa={{
                      eventos30d: regua.eventos30d,
                      rotuloDoEvento: "consultas marcadas",
                      rotuloDoEventoSingular: "consulta marcada",
                      precoCents,
                    }}
                    sentidoDoPasso="antes"
                    tipoDaRegua="confirmacao"
                    eventoRotulo="a consulta"
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
            <DialogTitle>Nova régua de exceção</DialogTitle>
            <DialogDescription>
              A régua nasce desligada, copiando a janela e as mensagens da
              principal, para você ajustar antes de ligar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="excecao-base">Tipo de exceção</Label>
              <Select
                value={base}
                onValueChange={(v) => setBase(v as typeof base)}
              >
                <SelectTrigger id="excecao-base" className="min-h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="procedimento">Por procedimento</SelectItem>
                  <SelectItem value="reforcada" disabled={temReforcada}>
                    Reforçada por histórico de falta
                    {temReforcada ? " (já existe)" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {base === "procedimento" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="excecao-procedimento">Procedimento</Label>
                <Select
                  value={procedimentoId}
                  onValueChange={setProcedimentoId}
                >
                  <SelectTrigger id="excecao-procedimento" className="min-h-10">
                    <SelectValue placeholder="Escolha o procedimento" />
                  </SelectTrigger>
                  <SelectContent>
                    {procedimentosLivres.map((procedimento) => (
                      <SelectItem key={procedimento.id} value={procedimento.id}>
                        {procedimento.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {procedimentosLivres.length === 0 ? (
                  <p className="text-xs text-text-tertiary">
                    Todos os procedimentos ativos já têm régua própria.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="excecao-limiar">
                  A partir de quantas faltas
                </Label>
                <Input
                  id="excecao-limiar"
                  type="number"
                  min={1}
                  max={10}
                  className="h-10"
                  value={limiar}
                  onChange={(e) => setLimiar(e.target.value)}
                />
                <p className="text-xs text-text-tertiary">
                  O mesmo número aparece na etiqueta de risco da ficha do
                  paciente.
                </p>
              </div>
            )}
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
              disabled={
                pendente ||
                (base === "procedimento"
                  ? procedimentoId === ""
                  : !Number.isInteger(Number(limiar)) ||
                    Number(limiar) < 1 ||
                    Number(limiar) > 10)
              }
              onClick={criar}
            >
              {pendente ? "Criando..." : "Criar régua"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
