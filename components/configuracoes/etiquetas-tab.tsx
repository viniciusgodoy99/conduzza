"use client";

import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  excluirEtiquetaDeConversaAction,
  salvarEtiquetaDeConversaAction,
} from "@/app/(app)/configuracoes/actions";
import { Aviso } from "@/components/shared/aviso";
import { ChipDeEtiqueta } from "@/components/shared/chip-de-etiqueta";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
//
// Desenho do design system (docs/06 secao 5.12): cartao "Etiquetas da
// clinica" com uma linha por etiqueta (a Tag do DS, o uso em cz-num e
// "Editar") e a edicao inline num bloco afundado.

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
    <div className="grid gap-3 rounded-xl bg-surface-4 p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
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
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="etiqueta-tom">Cor</Label>
          <Select
            value={rascunho.tom}
            onValueChange={(valor) =>
              setRascunho((atual) => ({
                ...atual,
                tom: valor as TomDeEtiqueta,
              }))
            }
          >
            <SelectTrigger id="etiqueta-tom" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONS.map((tom) => (
                <SelectItem key={tom.valor} value={tom.valor}>
                  <span className="flex items-center gap-2">
                    {/* A amostra pinta o MESMO token do marcador do chip
                        (ChipDeEtiqueta usa .marker): com o tom de texto, o
                        seletor mostrava um passo e a previa outro, muito
                        diferente no escuro. Maior que o marcador de 7px so
                        para ler melhor no menu. */}
                    <span
                      aria-hidden
                      className="size-2.5 rounded-[2px]"
                      style={{
                        backgroundColor: STATUS_TONE_VARS[tom.valor].marker,
                      }}
                    />
                    {tom.rotulo}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">Fica assim:</span>
        <ChipDeEtiqueta
          nome={rascunho.nome.trim() || "Etiqueta"}
          tom={rascunho.tom}
        />
      </div>
      {erro ? (
        <Aviso tom="alert" role="alert">
          {erro}
        </Aviso>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pendente || rascunho.nome.trim().length < 2}
          onClick={() => salvar(chave)}
        >
          {pendente ? "Salvando..." : "Salvar"}
        </Button>
        <Button
          variant="ghost"
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
            variant="destructive"
            className="ml-auto"
            disabled={pendente}
            onClick={() => {
              const alvo = etiquetas.find((e) => e.chave === chave);
              if (alvo) {
                setExcluindo(alvo);
              }
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            Excluir
          </Button>
        ) : null}
      </div>
    </div>
  );

  const botaoNova = (
    <Button
      variant="outline"
      disabled={!podeGerenciar || pendente || editando === CRIANDO}
      onClick={abrirCriacao}
    >
      <Plus className="size-4" />
      Nova etiqueta
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Etiquetas da clínica</CardTitle>
        <CardAction>
          {podeGerenciar ? (
            botaoNova
          ) : (
            <DisabledWithHint hint={dica}>{botaoNova}</DisabledWithHint>
          )}
        </CardAction>
      </CardHeader>

      {etiquetas.length === 0 && editando !== CRIANDO ? (
        <EmptyState
          icon={Tag}
          title="Nenhuma etiqueta ainda"
          description="As etiquetas marcam o estado de uma conversa (por exemplo: orçamento enviado, aguardando convênio) e servem de filtro no Atendimento."
        />
      ) : (
        <ul className="divide-y divide-border">
          {etiquetas.map((etiqueta) => {
            const emUso = contagem[etiqueta.chave] ?? 0;
            const botaoEditar = (
              <Button
                variant="ghost"
                disabled={!podeGerenciar || pendente}
                onClick={() => abrirEdicao(etiqueta)}
                aria-label={`Editar ${etiqueta.nome}`}
              >
                <Pencil className="size-4" />
                Editar
              </Button>
            );
            return (
              <li key={etiqueta.chave} className="grid gap-3 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <ChipDeEtiqueta nome={etiqueta.nome} tom={etiqueta.tom} />
                  <span className="text-xs text-text-secondary">
                    {emUso === 0 ? (
                      "Ainda não usada"
                    ) : (
                      <>
                        Usada em <span className="cz-num">{emUso}</span>{" "}
                        {emUso === 1 ? "conversa" : "conversas"}
                      </>
                    )}
                  </span>
                  <span className="ml-auto">
                    {podeGerenciar ? (
                      botaoEditar
                    ) : (
                      <DisabledWithHint hint={dica}>
                        {botaoEditar}
                      </DisabledWithHint>
                    )}
                  </span>
                </div>
                {editando === etiqueta.chave
                  ? formulario(etiqueta.chave)
                  : null}
              </li>
            );
          })}
        </ul>
      )}

      {editando === CRIANDO ? (
        <CardContent className="grid gap-3 border-t border-border">
          <p className="text-[13.5px] font-bold text-text-strong">
            Nova etiqueta
          </p>
          {formulario(null)}
        </CardContent>
      ) : null}

      <Dialog
        open={excluindo !== null}
        onOpenChange={(aberto) => (!aberto ? setExcluindo(null) : null)}
      >
        <DialogContent className="sm:max-w-[420px]">
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
            <Button variant="ghost" onClick={() => setExcluindo(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={pendente} onClick={excluir}>
              {pendente ? "Excluindo..." : "Excluir etiqueta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
