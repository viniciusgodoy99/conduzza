"use client";

import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  excluirEtiquetaDeConversaAction,
  salvarEtiquetaDeConversaAction,
} from "@/app/(app)/configuracoes/actions";
import { ChipDeEtiqueta } from "@/components/shared/chip-de-etiqueta";
import { EmptyState } from "@/components/shared/empty-state";
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
import { STATUS_TONE_VARS } from "@/lib/design/status";
import type {
  EtiquetaDeConversa,
  TomDeEtiqueta,
} from "@/lib/domain/etiquetas-de-conversa";

// Aba "Etiquetas de conversa" (Configuracoes). Molde do jornada-tab, bem
// menor: etiqueta nao tem papel de sistema, nem icone, nem ordem, nem
// conversao. Uma divergencia consciente: aqui a exclusao TEM dialogo de
// confirmacao, porque ela e destrutiva de verdade (tira a etiqueta das
// conversas) em vez de ser recusada pelo gatilho como na jornada.

// Os dois pontos nao existem no alfabeto da chave (^[a-z0-9_]+$), entao
// nenhuma etiqueta real colide com a sentinela de "estou criando".
const CRIANDO = ":nova";

const TONS: { valor: TomDeEtiqueta; rotulo: string }[] = [
  { valor: "neutral", rotulo: "Cinza (neutro)" },
  { valor: "info", rotulo: "Azul (informativo)" },
  { valor: "warning", rotulo: "Âmbar (atenção)" },
  { valor: "success", rotulo: "Verde (sucesso)" },
  { valor: "alert", rotulo: "Vermelho (alerta)" },
];

type Rascunho = { nome: string; tom: TomDeEtiqueta };

export function EtiquetasTab({
  etiquetas,
  contagem,
  podeGerenciar,
  dica,
}: {
  etiquetas: EtiquetaDeConversa[];
  /** chave -> quantas conversas usam. */
  contagem: Record<string, number>;
  podeGerenciar: boolean;
  dica: string;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>({
    nome: "",
    tom: "neutral",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<EtiquetaDeConversa | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const abrirCriacao = () => {
    setErro(null);
    setRascunho({ nome: "", tom: "neutral" });
    setEditando(CRIANDO);
  };

  const abrirEdicao = (etiqueta: EtiquetaDeConversa) => {
    setErro(null);
    setRascunho({ nome: etiqueta.nome, tom: etiqueta.tom });
    setEditando(etiqueta.chave);
  };

  const salvar = (chave: string | null) => {
    iniciarTransicao(async () => {
      const resultado = await salvarEtiquetaDeConversaAction({
        chave,
        nome: rascunho.nome,
        tom: rascunho.tom,
      });
      if (resultado.ok) {
        toast.success(chave ? "Etiqueta salva." : "Etiqueta criada.");
        setEditando(null);
        setErro(null);
        return;
      }
      setErro(resultado.error ?? "Não foi possível salvar.");
    });
  };

  const excluir = () => {
    if (!excluindo) {
      return;
    }
    const alvo = excluindo;
    iniciarTransicao(async () => {
      const resultado = await excluirEtiquetaDeConversaAction(alvo.chave);
      if (resultado.ok) {
        toast.success("Etiqueta excluída.");
        setExcluindo(null);
        setEditando(null);
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  const formulario = (chave: string | null) => (
    <div className="grid gap-3 rounded-lg border bg-surface-2 p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="etiqueta-nome">Nome</Label>
        <Input
          id="etiqueta-nome"
          value={rascunho.nome}
          maxLength={32}
          placeholder="Ex.: Aguardando exame"
          onChange={(evento) =>
            setRascunho((atual) => ({ ...atual, nome: evento.target.value }))
          }
          className="h-10"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="etiqueta-tom">Cor</Label>
        <Select
          value={rascunho.tom}
          onValueChange={(valor) =>
            setRascunho((atual) => ({ ...atual, tom: valor as TomDeEtiqueta }))
          }
        >
          <SelectTrigger id="etiqueta-tom" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONS.map((tom) => (
              <SelectItem key={tom.valor} value={tom.valor}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{
                      backgroundColor: STATUS_TONE_VARS[tom.valor].text,
                    }}
                  />
                  {tom.rotulo}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">Fica assim:</span>
        <ChipDeEtiqueta
          nome={rascunho.nome.trim() || "Etiqueta"}
          tom={rascunho.tom}
        />
      </div>
      {erro ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          {erro}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-10"
          disabled={pendente || rascunho.nome.trim().length < 2}
          onClick={() => salvar(chave)}
        >
          {pendente ? "Salvando..." : "Salvar"}
        </Button>
        <Button
          variant="ghost"
          className="h-10"
          disabled={pendente}
          onClick={() => {
            setEditando(null);
            setErro(null);
          }}
        >
          Cancelar
        </Button>
        {chave ? (
          <Button
            variant="ghost"
            className="h-10 [color:var(--alert-text)]"
            disabled={pendente}
            onClick={() => {
              const alvo = etiquetas.find((e) => e.chave === chave);
              if (alvo) {
                setExcluindo(alvo);
              }
            }}
          >
            <Trash2 strokeWidth={1.5} className="size-4" aria-hidden />
            Excluir
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="grid gap-4">
      {etiquetas.length === 0 && editando !== CRIANDO ? (
        <EmptyState
          icon={Tag}
          title="Nenhuma etiqueta ainda"
          description="As etiquetas marcam o estado de uma conversa (por exemplo: orçamento enviado, aguardando convênio) e servem de filtro no Atendimento."
        />
      ) : (
        <div className="grid gap-2">
          {etiquetas.map((etiqueta) => {
            const emUso = contagem[etiqueta.chave] ?? 0;
            return (
              <article
                key={etiqueta.chave}
                className="grid gap-3 rounded-lg border bg-card p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <ChipDeEtiqueta nome={etiqueta.nome} tom={etiqueta.tom} />
                  <span className="text-xs text-text-tertiary">
                    {emUso === 0
                      ? "Ainda não usada"
                      : emUso === 1
                        ? "Usada em 1 conversa"
                        : `Usada em ${emUso} conversas`}
                  </span>
                  <span className="ml-auto">
                    {podeGerenciar ? (
                      <Button
                        variant="ghost"
                        className="h-10"
                        disabled={pendente}
                        onClick={() => abrirEdicao(etiqueta)}
                        aria-label={`Editar ${etiqueta.nome}`}
                      >
                        <Pencil strokeWidth={1.5} className="size-4" />
                        Editar
                      </Button>
                    ) : (
                      <DisabledWithHint hint={dica}>
                        <Button variant="ghost" className="h-10" disabled>
                          <Pencil strokeWidth={1.5} className="size-4" />
                          Editar
                        </Button>
                      </DisabledWithHint>
                    )}
                  </span>
                </div>
                {editando === etiqueta.chave ? formulario(etiqueta.chave) : null}
              </article>
            );
          })}
        </div>
      )}

      {editando === CRIANDO ? (
        <article className="grid gap-3 rounded-lg border bg-card p-3">
          <h3 className="text-[13px] font-semibold">Nova etiqueta</h3>
          {formulario(null)}
        </article>
      ) : podeGerenciar ? (
        <Button
          variant="outline"
          className="h-10 justify-self-start"
          disabled={pendente}
          onClick={abrirCriacao}
        >
          <Plus strokeWidth={1.5} className="size-4" />
          Nova etiqueta
        </Button>
      ) : (
        <DisabledWithHint hint={dica}>
          <Button variant="outline" className="h-10 justify-self-start" disabled>
            <Plus strokeWidth={1.5} className="size-4" />
            Nova etiqueta
          </Button>
        </DisabledWithHint>
      )}

      <Dialog
        open={excluindo !== null}
        onOpenChange={(aberto) => (!aberto ? setExcluindo(null) : null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir {excluindo?.nome}?</DialogTitle>
            <DialogDescription>
              {(() => {
                const emUso = excluindo ? (contagem[excluindo.chave] ?? 0) : 0;
                if (emUso === 0) {
                  return "Esta etiqueta ainda não foi usada em nenhuma conversa.";
                }
                return `Ela sai de ${emUso} ${emUso === 1 ? "conversa" : "conversas"}. Isso não pode ser desfeito.`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setExcluindo(null)}
            >
              Cancelar
            </Button>
            <Button
              className="h-10"
              disabled={pendente}
              onClick={excluir}
            >
              {pendente ? "Excluindo..." : "Excluir etiqueta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
