"use client";

import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  SquareSlash,
  Trash2,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  excluirMensagemPadraoAction,
  reordenarMensagemPadraoAction,
  salvarMensagemPadraoAction,
} from "@/app/(app)/configuracoes/mensagens-padrao-actions";
import { BalaoWhatsApp } from "@/components/automacoes/balao-whatsapp";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { RECORD_STATUS } from "@/lib/design/status";
import {
  atalhoDoTitulo,
  camposDesconhecidos,
  LIMITE_DO_TEXTO,
  limparAtalho,
  mensagemPadraoSchema,
  PLACEHOLDERS_DA_RESPOSTA,
  renderizarResposta,
  usaNome,
  type RespostaRapida,
} from "@/lib/domain/respostas-rapidas";

// Aba "Mensagens padrao" (Configuracoes, logo depois de Etiquetas): os
// textos prontos que a equipe usa no Atendimento digitando "/" na resposta
// ao paciente (spec 1.11; nome na tela dado pelo dono em 02/10/2026).
// Administrador e gestor cadastram, editam, ativam ou desativam, reordenam e
// excluem; os demais papeis nem chegam a esta tela.
//
// Molde da aba de Etiquetas (linha por item, edicao inline num bloco
// afundado, exclusao com dialogo) com a reordenacao por setas da Jornada e o
// editor de texto da regua (chips de campo e previa em balao de WhatsApp),
// so com {{nome}} e {{clinica}}. A previa usa um nome FICTICIO: o nome de
// verdade so entra no compositor, na conversa de cada paciente.

// Fora do alfabeto do uuid: nenhuma mensagem real colide com "estou criando".
const CRIANDO = ":nova";

const NOME_DE_AMOSTRA = "Maria";

type Rascunho = {
  titulo: string;
  atalho: string;
  corpo: string;
  ativo: boolean;
};

const RASCUNHO_VAZIO: Rascunho = {
  titulo: "",
  atalho: "",
  corpo: "",
  ativo: true,
};

export function MensagensPadraoTab({
  mensagens,
  nomeDaClinica,
  podeGerenciar,
  dica,
}: {
  /** todas, ativas e desativadas, na ordem da lista */
  mensagens: RespostaRapida[];
  /** para a previa do {{clinica}} */
  nomeDaClinica: string;
  podeGerenciar: boolean;
  dica: string;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  // Ao criar, o atalho acompanha o titulo ate a pessoa mexer nele.
  const [atalhoTocado, setAtalhoTocado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<RespostaRapida | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const corpoRef = useRef<HTMLTextAreaElement>(null);

  const abrirCriacao = () => {
    setErro(null);
    setRascunho(RASCUNHO_VAZIO);
    setAtalhoTocado(false);
    setEditando(CRIANDO);
  };

  const abrirEdicao = (mensagem: RespostaRapida) => {
    setErro(null);
    setRascunho({
      titulo: mensagem.titulo,
      atalho: mensagem.atalho,
      corpo: mensagem.corpo,
      ativo: mensagem.ativo,
    });
    setAtalhoTocado(true);
    setEditando(mensagem.id);
  };

  const fecharEdicao = () => {
    setEditando(null);
    setErro(null);
  };

  const salvar = (id: string | null) => {
    const entrada = mensagemPadraoSchema.safeParse({ id, ...rascunho });
    if (!entrada.success) {
      setErro(
        entrada.error.issues[0]?.message ??
          "Confira o atalho, o título e o texto da mensagem.",
      );
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await salvarMensagemPadraoAction(entrada.data);
      if (resultado.ok) {
        toast.success(id ? "Mensagem salva." : "Mensagem criada.");
        fecharEdicao();
        return;
      }
      setErro(resultado.error ?? "Não foi possível salvar.");
    });
  };

  const reordenar = (mensagem: RespostaRapida, direcao: "subir" | "descer") => {
    iniciarTransicao(async () => {
      const resultado = await reordenarMensagemPadraoAction(
        mensagem.id,
        direcao,
      );
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível reordenar.");
      }
    });
  };

  const excluir = () => {
    if (!excluindo) {
      return;
    }
    const alvo = excluindo;
    iniciarTransicao(async () => {
      const resultado = await excluirMensagemPadraoAction(alvo.id);
      if (resultado.ok) {
        toast.success("Mensagem excluída.");
        setExcluindo(null);
        fecharEdicao();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  const inserirCampo = (campo: string) => {
    const marcador = `{{${campo}}}`;
    const area = corpoRef.current;
    const atual = rascunho.corpo;
    const inicio = area?.selectionStart ?? atual.length;
    const fim = area?.selectionEnd ?? atual.length;
    const novo = (atual.slice(0, inicio) + marcador + atual.slice(fim)).slice(
      0,
      LIMITE_DO_TEXTO,
    );
    setRascunho((anterior) => ({ ...anterior, corpo: novo }));
    requestAnimationFrame(() => {
      area?.focus();
      const cursor = Math.min(inicio + marcador.length, novo.length);
      area?.setSelectionRange(cursor, cursor);
    });
  };

  const formulario = (id: string | null) => {
    const desconhecidos = camposDesconhecidos(rascunho.corpo);
    const previa = renderizarResposta(rascunho.corpo, {
      nome: NOME_DE_AMOSTRA,
      clinica: nomeDaClinica,
    });
    const previaSemNome = usaNome(rascunho.corpo)
      ? renderizarResposta(rascunho.corpo, {
          nome: null,
          clinica: nomeDaClinica,
        })
      : null;
    const podeSalvar =
      rascunho.titulo.trim().length >= 2 &&
      rascunho.atalho.length > 0 &&
      rascunho.corpo.trim().length > 0;
    return (
      <div className="grid gap-4 rounded-xl bg-surface-4 p-3.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mensagem-titulo">Título</Label>
              <Input
                id="mensagem-titulo"
                value={rascunho.titulo}
                maxLength={60}
                placeholder="Ex.: Endereço da clínica"
                onChange={(evento) => {
                  const titulo = evento.target.value;
                  setRascunho((atual) => ({
                    ...atual,
                    titulo,
                    atalho: atalhoTocado
                      ? atual.atalho
                      : atalhoDoTitulo(titulo),
                  }));
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mensagem-atalho">Atalho</Label>
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="cz-num text-[13.5px] font-semibold text-text-secondary"
                >
                  /
                </span>
                <Input
                  id="mensagem-atalho"
                  value={rascunho.atalho}
                  maxLength={30}
                  placeholder="endereco"
                  aria-describedby="mensagem-atalho-dica"
                  className="cz-num"
                  onChange={(evento) => {
                    setAtalhoTocado(true);
                    setRascunho((atual) => ({
                      ...atual,
                      atalho: limparAtalho(evento.target.value),
                    }));
                  }}
                />
              </div>
              <span
                id="mensagem-atalho-dica"
                className="text-[11.5px] text-text-secondary"
              >
                No Atendimento, digite / e o atalho. Letras minúsculas, números
                e _.
              </span>
            </div>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="mensagem-corpo">Texto</Label>
              <span
                className="cz-num text-[11px] text-text-secondary"
                aria-hidden
              >
                {rascunho.corpo.length}/{LIMITE_DO_TEXTO}
              </span>
            </div>
            <Textarea
              id="mensagem-corpo"
              ref={corpoRef}
              value={rascunho.corpo}
              rows={6}
              maxLength={LIMITE_DO_TEXTO}
              placeholder="Escreva a mensagem que o paciente vai receber."
              className="min-h-[144px] text-sm"
              onChange={(evento) =>
                setRascunho((atual) => ({
                  ...atual,
                  corpo: evento.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs text-text-secondary">
              Toque num campo para inserir no texto. No Atendimento, ele vira o
              nome do contato da conversa ou o nome da clínica.
            </span>
            <div className="flex flex-wrap gap-x-1.5 gap-y-2.5">
              {PLACEHOLDERS_DA_RESPOSTA.map((campo) => (
                <button
                  key={campo}
                  type="button"
                  disabled={pendente}
                  onClick={() => inserirCampo(campo)}
                  className="hit-40 h-[30px] rounded-sm border border-border-strong bg-card px-2 cz-num text-[11.5px] text-foreground shadow-xs cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {`{{${campo}}}`}
                </button>
              ))}
            </div>
          </div>
          {desconhecidos.length > 0 ? (
            <Aviso tom="warning">
              {desconhecidos.length === 1 ? "O campo" : "Os campos"}{" "}
              <span className="cz-num">
                {desconhecidos.map((campo) => `{{${campo}}}`).join(", ")}
              </span>{" "}
              {desconhecidos.length === 1 ? "não existe" : "não existem"} aqui e
              {desconhecidos.length === 1 ? " sai" : " saem"} em branco. Use{" "}
              <span className="cz-num">{"{{nome}}"}</span> ou{" "}
              <span className="cz-num">{"{{clinica}}"}</span>.
            </Aviso>
          ) : null}
          <Aviso tom="info" titulo="Texto da clínica para o paciente.">
            Não prometa resultado nem oriente sobre sintoma, remédio ou
            diagnóstico: é regra do CFM e vale para toda mensagem da clínica. No
            Atendimento, a mensagem entra no campo para a pessoa revisar antes
            de enviar.
          </Aviso>
          {/* Checkbox, e nao Switch: a escolha so vale depois do Salvar
              (docs/06, C31). O radix pode devolver "indeterminate": so
              true marca. */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="mensagem-ativa"
              checked={rascunho.ativo}
              onCheckedChange={(valor) =>
                setRascunho((atual) => ({ ...atual, ativo: valor === true }))
              }
              aria-describedby="mensagem-ativa-descricao"
              className="mt-px"
            />
            <div className="grid gap-1">
              <Label
                htmlFor="mensagem-ativa"
                className="text-[13.5px] leading-[1.3]"
              >
                Ativa: aparece na lista do Atendimento
              </Label>
              <p
                id="mensagem-ativa-descricao"
                className="text-xs text-text-secondary"
              >
                Desmarcada, sai da lista e continua guardada aqui.
              </p>
            </div>
          </div>
          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pendente || !podeSalvar}
              onClick={() => salvar(id)}
            >
              {pendente ? "Salvando..." : "Salvar"}
            </Button>
            <Button variant="ghost" disabled={pendente} onClick={fecharEdicao}>
              Cancelar
            </Button>
            {id ? (
              <Button
                variant="destructive"
                className="ml-auto"
                disabled={pendente}
                onClick={() => {
                  const alvo = mensagens.find((item) => item.id === id);
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
        <div className="grid content-start gap-2">
          <span className="text-xs font-semibold text-foreground">
            Como o paciente vê
          </span>
          <BalaoWhatsApp corpo={previa} />
          <p className="text-[11.5px] text-text-secondary">
            Amostra com o nome fictício {NOME_DE_AMOSTRA}. No Atendimento, entra
            o nome do contato da conversa.
          </p>
          {previaSemNome !== null ? (
            <p className="text-[11.5px] text-text-secondary">
              Contato sem nome recebe:{" "}
              <span className="whitespace-pre-line text-foreground">
                {previaSemNome || "(texto vazio)"}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  const botaoNova = (
    <Button
      variant="outline"
      disabled={!podeGerenciar || pendente || editando === CRIANDO}
      onClick={abrirCriacao}
    >
      <Plus className="size-4" aria-hidden />
      Nova mensagem
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mensagens padrão da clínica</CardTitle>
        <CardAction>
          {podeGerenciar ? (
            botaoNova
          ) : (
            <DisabledWithHint hint={dica}>{botaoNova}</DisabledWithHint>
          )}
        </CardAction>
      </CardHeader>

      {mensagens.length === 0 && editando !== CRIANDO ? (
        <EmptyState
          icon={SquareSlash}
          title="Nenhuma mensagem padrão ainda"
          description="Textos prontos, como o endereço da clínica ou a confirmação de um horário. No Atendimento, digite / na resposta ao paciente para usar um."
        />
      ) : (
        <ul className="divide-y divide-border">
          {mensagens.map((mensagem, indice) => {
            const aberta = editando === mensagem.id;
            const botaoEditar = (
              <Button
                variant="ghost"
                disabled={!podeGerenciar || pendente}
                onClick={() => abrirEdicao(mensagem)}
                aria-label={`Editar ${mensagem.titulo}`}
              >
                <Pencil className="size-4" aria-hidden />
                Editar
              </Button>
            );
            const setas = (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Subir ${mensagem.titulo}`}
                  disabled={!podeGerenciar || pendente || indice === 0}
                  onClick={() => reordenar(mensagem, "subir")}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Descer ${mensagem.titulo}`}
                  disabled={
                    !podeGerenciar ||
                    pendente ||
                    indice === mensagens.length - 1
                  }
                  onClick={() => reordenar(mensagem, "descer")}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
              </>
            );
            return (
              <li key={mensagem.id} className="grid gap-3 px-4 py-2.5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-bold text-text-strong">
                        {mensagem.titulo}
                      </span>
                      <span className="cz-num text-[12px] text-text-secondary">
                        /{mensagem.atalho}
                      </span>
                      <StatusChip
                        size="sm"
                        definition={
                          RECORD_STATUS[mensagem.ativo ? "ativo" : "inativo"]
                        }
                        label={mensagem.ativo ? "Ativa" : "Desativada"}
                      />
                    </div>
                    <p className="line-clamp-2 text-[12.5px] whitespace-pre-line text-text-secondary">
                      {mensagem.corpo}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {podeGerenciar ? (
                      setas
                    ) : (
                      <DisabledWithHint hint={dica}>
                        <span className="flex items-center gap-1">{setas}</span>
                      </DisabledWithHint>
                    )}
                    {aberta ? null : podeGerenciar ? (
                      botaoEditar
                    ) : (
                      <DisabledWithHint hint={dica}>
                        {botaoEditar}
                      </DisabledWithHint>
                    )}
                  </div>
                </div>
                {aberta ? formulario(mensagem.id) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editando === CRIANDO ? (
        <CardContent className="grid gap-3 border-t border-border">
          <p className="text-[13.5px] font-bold text-text-strong">
            Nova mensagem padrão
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
            <DialogTitle>Excluir {excluindo?.titulo}?</DialogTitle>
            <DialogDescription>
              Ela sai da lista do Atendimento para toda a equipe. Isso não pode
              ser desfeito. Para só tirar da lista por um tempo, desative em vez
              de excluir.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExcluindo(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={pendente} onClick={excluir}>
              {pendente ? "Excluindo..." : "Excluir mensagem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
