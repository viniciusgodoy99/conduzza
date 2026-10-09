"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BookOpenText, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import {
  trocaDeEditorPedeConfirmacao,
  useAvisarNaoSalvo,
  type AvisarNaoSalvo,
} from "@/components/agente/nao-salvo";
import { TEXTOS_DO_AGENTE as T } from "@/components/agente/textos";
import type { RetornoDaAcao } from "@/components/agente/tipos";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RECORD_STATUS } from "@/lib/design/status";
import {
  itemDaBaseSchema,
  LIMITES_DO_AGENTE,
  problemaNoTextoDoAgente,
  type ItemDaBase,
  type ItemDaBaseEntrada,
} from "@/lib/domain/agente/config";

// Aba Conhecimento da Tela 6: as perguntas e respostas que o assistente usa
// (knowledge_item, a base VIVA: o que entra aqui vai para a proxima versao
// publicada). Molde do CRUD inline das Mensagens padrao: linha por item,
// edicao num bloco afundado, "Ativa" em Checkbox (so vale ao salvar, C31) e
// exclusao com dialogo. A caixa informativa do brief vai no topo.
//
// Ao salvar, o formulario roda as regras do filtro do CFM na pergunta e na
// resposta (problemaNoTextoDoAgente): telefone, CEP, link e preco sao
// recusados no campo, em texto de recepcionista, porque o filtro barraria a
// resposta do assistente depois. A acao confere de novo no servidor.
//
// Um editor aberto por vez. Abrir outro (Editar em outra linha ou Nova
// pergunta) com texto alterado e nao salvo pede confirmacao antes de
// descartar (achado 10), e o painel fica sabendo do que nao foi salvo para
// nao publicar sem ele (achado 27).

// Fora do alfabeto do uuid: nenhum item real colide com "estou criando".
const CRIANDO = ":nova";

/** O schema da acao com as regras do filtro na pergunta e na resposta. */
export const itemDaTelaSchema = itemDaBaseSchema.superRefine((item, ctx) => {
  const campos = [
    ["pergunta", item.pergunta],
    ["resposta", item.resposta],
  ] as const;
  for (const [campo, texto] of campos) {
    const problema = problemaNoTextoDoAgente(texto, campo);
    if (problema !== null) {
      ctx.addIssue({ code: "custom", path: [campo], message: problema });
    }
  }
});

type ValoresDoItem = z.input<typeof itemDaTelaSchema>;

/** Quantas perguntas estao ativas, e se passou do teto da publicacao. */
export function contagemDaBase(base: readonly ItemDaBase[]): {
  ativas: number;
  passouDoTeto: boolean;
} {
  const ativas = base.filter((item) => item.ativo).length;
  return { ativas, passouDoTeto: ativas > LIMITES_DO_AGENTE.itensDaBase };
}

export type AcoesDaBase = {
  aoSalvar: (item: ItemDaBaseEntrada, retorno: RetornoDaAcao) => void;
  aoAtivar: (item: ItemDaBase, ativo: boolean) => void;
  aoExcluir: (item: ItemDaBase, retorno: RetornoDaAcao) => void;
};

export function AbaConhecimento({
  base,
  podeEditar,
  dica,
  pendente,
  ocupado,
  acoes,
  aoMudarNaoSalvo,
}: {
  /** Nula: a leitura falhou. */
  base: ItemDaBase[] | null;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  ocupado: (qual: string) => boolean;
  acoes: AcoesDaBase;
  /** Avisa o painel do que foi digitado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<ItemDaBase | null>(null);
  // O editor aberto tem texto alterado e nao salvo (o formulario avisa).
  const [naoSalvo, setNaoSalvo] = useState(false);
  // O editor que a pessoa pediu enquanto o aberto tinha texto nao salvo.
  const [trocarPara, setTrocarPara] = useState<string | null>(null);
  useAvisarNaoSalvo(editando !== null && naoSalvo, aoMudarNaoSalvo);

  /** Abre um editor; com o aberto alterado, pede confirmacao antes. */
  const abrirEditor = (alvo: string) => {
    if (trocaDeEditorPedeConfirmacao(editando, alvo, naoSalvo)) {
      setTrocarPara(alvo);
      return;
    }
    setEditando(alvo);
  };

  const comDica = (controle: React.ReactNode) =>
    dica ? (
      <DisabledWithHint hint={dica}>{controle}</DisabledWithHint>
    ) : (
      controle
    );

  const botaoNova = (
    <Button
      variant="outline"
      disabled={!podeEditar || pendente || editando === CRIANDO}
      onClick={() => abrirEditor(CRIANDO)}
    >
      <Plus className="size-4" aria-hidden />
      {T.novaPergunta}
    </Button>
  );

  const contagem = base ? contagemDaBase(base) : null;

  return (
    <Card role="region" aria-labelledby="agente-conhecimento-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-conhecimento-titulo">
            {T.conhecimentoTitulo}
          </CardTitle>
          {contagem ? (
            <CardDescription>
              <span className="cz-num">{contagem.ativas}</span> de{" "}
              <span className="cz-num">{LIMITES_DO_AGENTE.itensDaBase}</span>{" "}
              perguntas ativas
            </CardDescription>
          ) : null}
        </div>
        <CardAction>{comDica(botaoNova)}</CardAction>
      </CardHeader>

      <CardContent className="grid gap-3">
        <Aviso tom="info" role="note">
          {T.conhecimentoAviso}
        </Aviso>
        {contagem?.passouDoTeto ? (
          <Aviso tom="warning" role="note">
            Com mais de {LIMITES_DO_AGENTE.itensDaBase} perguntas ativas não dá
            para publicar. Desative as que a recepção menos usa.
          </Aviso>
        ) : null}
      </CardContent>

      {base === null ? (
        <EmptyState
          tom="erro"
          compact
          title="Não foi possível carregar as perguntas"
          description="Recarregue a página. Se continuar, fale com o suporte."
        />
      ) : base.length === 0 && editando !== CRIANDO ? (
        <EmptyState
          compact
          icon={BookOpenText}
          title={T.conhecimentoVazio}
          description={T.conhecimentoVazioDescricao}
        />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {base.map((item) => {
            const aberta = editando === item.id;
            const botaoEditar = (
              <Button
                variant="ghost"
                disabled={!podeEditar || pendente}
                onClick={() => abrirEditor(item.id)}
                aria-label={`Editar ${item.pergunta}`}
              >
                <Pencil className="size-4" aria-hidden />
                Editar
              </Button>
            );
            const qualAtivar = `ativar-${item.id}`;
            const botaoAtivar = (
              <Button
                variant="ghost"
                disabled={!podeEditar || pendente}
                aria-busy={ocupado(qualAtivar) || undefined}
                onClick={() => acoes.aoAtivar(item, !item.ativo)}
                aria-label={`${item.ativo ? "Desativar" : "Ativar"} ${item.pergunta}`}
              >
                {ocupado(qualAtivar)
                  ? "Salvando..."
                  : item.ativo
                    ? "Desativar"
                    : "Ativar"}
              </Button>
            );
            return (
              <li key={item.id} className="grid gap-3 px-4 py-2.5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-bold break-words text-text-strong">
                        {item.pergunta}
                      </span>
                      <StatusChip
                        size="sm"
                        definition={
                          RECORD_STATUS[item.ativo ? "ativo" : "inativo"]
                        }
                        label={item.ativo ? "Ativa" : "Desativada"}
                      />
                    </div>
                    <p className="line-clamp-2 text-[12.5px] break-words whitespace-pre-line text-text-secondary">
                      {item.resposta}
                    </p>
                  </div>
                  {aberta ? null : (
                    <div className="ml-auto flex items-center gap-1">
                      {comDica(botaoAtivar)}
                      {comDica(botaoEditar)}
                    </div>
                  )}
                </div>
                {aberta ? (
                  <FormularioDoItem
                    item={item}
                    pendente={pendente}
                    salvando={ocupado(`salvar-${item.id}`)}
                    aoSalvar={(entrada, retorno) =>
                      acoes.aoSalvar(entrada, {
                        ...retorno,
                        seDerCerto: () => setEditando(null),
                      })
                    }
                    aoCancelar={() => setEditando(null)}
                    aoPedirExclusao={() => setExcluindo(item)}
                    aoMudarNaoSalvo={setNaoSalvo}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editando === CRIANDO ? (
        <CardContent className="grid gap-3 border-t border-border pt-4">
          <p className="text-[13.5px] font-bold text-text-strong">
            {T.novaPergunta}
          </p>
          <FormularioDoItem
            item={null}
            pendente={pendente}
            salvando={ocupado("salvar-nova")}
            aoSalvar={(entrada, retorno) =>
              acoes.aoSalvar(entrada, {
                ...retorno,
                seDerCerto: () => setEditando(null),
              })
            }
            aoCancelar={() => setEditando(null)}
            aoPedirExclusao={null}
            aoMudarNaoSalvo={setNaoSalvo}
          />
        </CardContent>
      ) : null}

      <Dialog
        open={trocarPara !== null}
        onOpenChange={(aberto) => (!aberto ? setTrocarPara(null) : null)}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{T.trocarPerguntaTitulo}</DialogTitle>
            <DialogDescription>{T.trocarPerguntaTexto}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrocarPara(null)}>
              {T.continuarEditando}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setEditando(trocarPara);
                setTrocarPara(null);
              }}
            >
              {T.descartarEAbrir}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={excluindo !== null}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setExcluindo(null) : null
        }
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Excluir esta pergunta?</DialogTitle>
            <DialogDescription>
              Ela sai da lista e da próxima versão publicada. Isso não pode ser
              desfeito aqui; uma versão antiga que tinha a pergunta ainda pode
              ser restaurada em Versões. Para só tirar do assistente por um
              tempo, desative em vez de excluir.
            </DialogDescription>
          </DialogHeader>
          {excluindo ? (
            <p className="rounded-xl bg-surface-4 p-3 text-[13px] font-semibold break-words">
              {excluindo.pergunta}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setExcluindo(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pendente}
              aria-busy={
                (excluindo !== null && ocupado(`excluir-${excluindo.id}`)) ||
                undefined
              }
              onClick={() => {
                if (excluindo) {
                  acoes.aoExcluir(excluindo, {
                    seDerCerto: () => {
                      setExcluindo(null);
                      setEditando(null);
                    },
                  });
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {excluindo !== null && ocupado(`excluir-${excluindo.id}`)
                ? "Excluindo..."
                : "Excluir pergunta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FormularioDoItem({
  item,
  pendente,
  salvando,
  aoSalvar,
  aoCancelar,
  aoPedirExclusao,
  aoMudarNaoSalvo,
}: {
  /** Nulo: criando. */
  item: ItemDaBase | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (entrada: ItemDaBaseEntrada, retorno: RetornoDaAcao) => void;
  aoCancelar: () => void;
  aoPedirExclusao: (() => void) | null;
  aoMudarNaoSalvo: AvisarNaoSalvo;
}) {
  const form = useForm<ValoresDoItem, unknown, ItemDaBaseEntrada>({
    resolver: zodResolver(itemDaTelaSchema),
    defaultValues: {
      id: item?.id ?? null,
      pergunta: item?.pergunta ?? "",
      resposta: item?.resposta ?? "",
      ativo: item?.ativo ?? true,
    },
  });
  const erroDoServidor = form.formState.errors.root?.message;
  useAvisarNaoSalvo(form.formState.isDirty, aoMudarNaoSalvo);

  return (
    <Form {...form}>
      <form
        noValidate
        aria-label={item ? `Editar ${item.pergunta}` : T.novaPergunta}
        className="grid gap-3 rounded-xl bg-surface-4 p-3.5"
        onSubmit={(evento) =>
          void form.handleSubmit((entrada) =>
            aoSalvar(entrada, {
              // O servidor confere de novo (filtro, limite, permissao): a
              // recusa aparece aqui, junto do que precisa mudar.
              seFalhar: (erro) => form.setError("root", { message: erro }),
            }),
          )(evento)
        }
      >
        <FormField
          control={form.control}
          name="pergunta"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-baseline justify-between gap-2">
                <FormLabel>{T.pergunta}</FormLabel>
                <span
                  className="cz-num text-[11px] text-text-secondary"
                  aria-hidden
                >
                  {field.value.length}/{LIMITES_DO_AGENTE.pergunta}
                </span>
              </div>
              <FormControl>
                <Input
                  {...field}
                  maxLength={LIMITES_DO_AGENTE.pergunta}
                  placeholder={T.perguntaPlaceholder}
                  autoComplete="off"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="resposta"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-baseline justify-between gap-2">
                <FormLabel>{T.resposta}</FormLabel>
                <span
                  className="cz-num text-[11px] text-text-secondary"
                  aria-hidden
                >
                  {field.value.length}/{LIMITES_DO_AGENTE.resposta}
                </span>
              </div>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  maxLength={LIMITES_DO_AGENTE.resposta}
                  placeholder={T.respostaPlaceholder}
                  className="min-h-[104px] text-sm"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ativo"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(valor) => field.onChange(valor === true)}
                  onBlur={field.onBlur}
                  className="mt-px"
                />
              </FormControl>
              <div className="grid gap-1">
                <FormLabel className="text-[13.5px] leading-[1.3]">
                  {T.ativa}
                </FormLabel>
                <FormDescription>{T.ativaDescricao}</FormDescription>
              </div>
            </FormItem>
          )}
        />
        {erroDoServidor ? (
          <Aviso tom="alert" role="alert">
            {erroDoServidor}
          </Aviso>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="solid"
            disabled={pendente}
            aria-busy={salvando || undefined}
          >
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pendente}
            onClick={aoCancelar}
          >
            Cancelar
          </Button>
          {aoPedirExclusao ? (
            <Button
              type="button"
              variant="destructive"
              className="ml-auto"
              disabled={pendente}
              onClick={aoPedirExclusao}
            >
              <Trash2 className="size-4" aria-hidden />
              Excluir
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  );
}
