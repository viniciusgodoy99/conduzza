"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { salvarRegraDeOrigemAction } from "@/app/(app)/configuracoes/regras-de-origem-actions";
import { LinkParaABio } from "@/components/configuracoes/link-para-a-bio";
import { CANAIS } from "@/components/leads/rotulos";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizarTexto } from "@/lib/domain/attribution";
import {
  avisosDaMensagem,
  contarCaracteres,
  ERRO_DA_PALAVRA_CHAVE,
  formularioDaOrigemSchema,
  LIMITE_DE_PALAVRAS_CHAVE,
  MENSAGEM_MAXIMA,
  NOME_MAXIMO,
  palavraChaveValida,
  palavrasDoTexto,
  TEXTO_MAXIMO,
  valoresDaRegra,
  VALORES_DE_UMA_ORIGEM_NOVA,
  type NumeroParaOLink,
  type RegraDeOrigem,
  type ValoresDaOrigem,
} from "@/lib/domain/regras-de-origem";

// Dialogo "Nova origem" e "Editar origem" da aba Origem dos leads (onda 5,
// contrato A.3): react-hook-form com o MESMO schema da Server Action
// (lib/domain/regras-de-origem.ts), que valida de novo no servidor. Pelo
// menos um dos tres jeitos de reconhecer (mensagem pronta, codigo no link,
// palavra-chave). O codigo so se escolhe na criacao (P17-3: ligado por
// padrao) e nunca muda depois. O bloco "Link para a bio" mostra o link que a
// mensagem gera; copiar so depois de salvar.

export const TEXTOS_DO_DIALOGO = {
  tituloNova: "Nova origem",
  tituloEditar: "Editar origem",
  descricao:
    "Como o sistema reconhece quem chega por este link e qual origem o lead ganha.",
  ajudaDaCampanha:
    "Aparece em Resultados, em Campanhas, como campanha fora da Meta.",
  rotuloDaMensagem: "Mensagem pronta do link",
  ajudaDaMensagem:
    "Copie exatamente o texto que aparece escrito no WhatsApp quando a pessoa toca no link. Se o link é de outra ferramenta, use o texto que ela deixa pronto.",
  rotuloDasPalavras: "Palavras-chave (opcional)",
  avisoDasPalavras:
    "A palavra-chave vale para qualquer primeira mensagem que a tenha, e a origem gravada não muda depois. Evite palavras comuns como consulta ou agendar.",
  rotuloDoCodigo: "Pôr um código no link",
  ajudaDoCodigo:
    "O texto do link ganha um código como [#K7Q2MX] no fim. Ele reconhece também quem já é contato, e quem apagar o código ainda é reconhecido pela mensagem.",
  mensagemMudouSemCodigo:
    "Com a mensagem nova, o link antigo deixa de ser reconhecido. Troque o link onde ele já estiver publicado.",
  salvarAntesDeCopiar: "Salve a origem antes de copiar o link.",
  salvarMudancaAntesDeCopiar: "Salve a mudança antes de copiar o link novo.",
} as const;

export function DialogoDaOrigem({
  aberto,
  aoFechar,
  regra,
  numeros,
  frasesDoSite,
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** a origem editada; nula cria uma nova */
  regra: RegraDeOrigem | null;
  numeros: readonly NumeroParaOLink[] | null;
  frasesDoSite: readonly string[];
}) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          aoFechar();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {regra
              ? TEXTOS_DO_DIALOGO.tituloEditar
              : TEXTOS_DO_DIALOGO.tituloNova}
          </DialogTitle>
          <DialogDescription>{TEXTOS_DO_DIALOGO.descricao}</DialogDescription>
        </DialogHeader>
        {/* O conteudo desmonta ao fechar: o formulario recomeca limpo. */}
        {aberto ? (
          <FormularioDaOrigem
            regra={regra}
            numeros={numeros}
            frasesDoSite={frasesDoSite}
            aoFechar={aoFechar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * O corpo do dialogo. Exportado para o teste: o Dialog do Radix usa portal,
 * que nao renderiza no servidor.
 */
export function FormularioDaOrigem({
  regra,
  numeros,
  frasesDoSite,
  aoFechar,
}: {
  regra: RegraDeOrigem | null;
  numeros: readonly NumeroParaOLink[] | null;
  frasesDoSite: readonly string[];
  aoFechar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [rascunhoDaPalavra, setRascunhoDaPalavra] = useState("");
  const form = useForm<ValoresDaOrigem>({
    resolver: zodResolver(formularioDaOrigemSchema),
    defaultValues: regra ? valoresDaRegra(regra) : VALORES_DE_UMA_ORIGEM_NOVA,
  });
  const enviando = form.formState.isSubmitting;
  const mensagem = form.watch("mensagem");
  const palavras = form.watch("palavras_chave");
  const avisos = avisosDaMensagem(mensagem, frasesDoSite);
  const mensagemMudou =
    regra !== null &&
    normalizarTexto(mensagem) !== normalizarTexto(regra.mensagem ?? "");

  // Devolve false quando a palavra digitada nao entra (o erro fica no
  // campo); true quando entrou ou nao havia nada para entrar.
  const adicionarPalavras = (): boolean => {
    const novas = palavrasDoTexto(rascunhoDaPalavra);
    if (novas.length === 0) {
      return true;
    }
    const invalida = novas.find((palavra) => !palavraChaveValida(palavra));
    if (invalida) {
      form.setError("palavras_chave", { message: ERRO_DA_PALAVRA_CHAVE });
      return false;
    }
    const atuais = form.getValues("palavras_chave");
    const vistas = new Set(atuais.map((palavra) => normalizarTexto(palavra)));
    const juntas = [...atuais];
    for (const palavra of novas) {
      if (!vistas.has(normalizarTexto(palavra))) {
        vistas.add(normalizarTexto(palavra));
        juntas.push(palavra);
      }
    }
    if (juntas.length > LIMITE_DE_PALAVRAS_CHAVE) {
      form.setError("palavras_chave", {
        message: `Use até ${LIMITE_DE_PALAVRAS_CHAVE} palavras-chave.`,
      });
      return false;
    }
    form.clearErrors("palavras_chave");
    form.setValue("palavras_chave", juntas, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setRascunhoDaPalavra("");
    return true;
  };

  const tirarPalavra = (indice: number) => {
    const atuais = form.getValues("palavras_chave");
    form.setValue(
      "palavras_chave",
      atuais.filter((_, posicao) => posicao !== indice),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const enviar = async (valores: ValoresDaOrigem) => {
    setErro(null);
    const resultado = await salvarRegraDeOrigemAction(
      regra ? { ...valores, id: regra.id } : valores,
    ).catch(() => null);
    if (!resultado) {
      setErro("Não foi possível salvar a origem. Tente de novo.");
      return;
    }
    if (!resultado.ok) {
      if (resultado.campo) {
        form.setError(resultado.campo, { message: resultado.error });
      } else {
        setErro(resultado.error);
      }
      return;
    }
    toast.success(
      regra ? "Origem salva." : "Origem criada. O link está na lista.",
    );
    if (resultado.aviso) {
      toast.warning(resultado.aviso);
    }
    aoFechar();
  };

  return (
    <Form {...form}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(evento) => {
          // A palavra digitada e ainda nao adicionada entra antes de salvar,
          // em vez de sumir calada.
          if (!adicionarPalavras()) {
            evento.preventDefault();
            return;
          }
          void form.handleSubmit(enviar)(evento);
        }}
      >
        <FormField
          control={form.control}
          name="nome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  maxLength={NOME_MAXIMO}
                  placeholder="Ex.: Link da bio do Instagram"
                />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="canal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Canal</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CANAIS.map((canal) => (
                      <SelectItem key={canal.valor} value={canal.valor}>
                        {canal.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="origem"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Origem (opcional)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    maxLength={TEXTO_MAXIMO}
                    placeholder="Ex.: Instagram"
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="detalhe"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Detalhe (opcional)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    maxLength={TEXTO_MAXIMO}
                    placeholder="Ex.: Bio"
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="campanha"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Campanha (opcional)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    maxLength={TEXTO_MAXIMO}
                    placeholder="Ex.: Bio outubro"
                  />
                </FormControl>
                <FormDescription className="text-[12px] text-text-secondary">
                  {TEXTOS_DO_DIALOGO.ajudaDaCampanha}
                </FormDescription>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="mensagem"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-baseline justify-between gap-2">
                <FormLabel>{TEXTOS_DO_DIALOGO.rotuloDaMensagem}</FormLabel>
                <span
                  className="cz-num text-[11px] text-text-secondary"
                  aria-hidden
                >
                  {/* Pontos de codigo, como o Zod e o banco contam: um emoji
                    vale 1 (no .length valeria 2). */}
                  {contarCaracteres(field.value)}/{MENSAGEM_MAXIMA}
                </span>
              </div>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  maxLength={MENSAGEM_MAXIMA}
                  className="min-h-[96px] text-sm"
                  placeholder="Ex.: Olá! Vi o perfil da clínica no Instagram e quero agendar uma avaliação."
                />
              </FormControl>
              <FormDescription className="text-[12px] text-text-secondary">
                {TEXTOS_DO_DIALOGO.ajudaDaMensagem}
              </FormDescription>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />
        {avisos.map((aviso) => (
          <Aviso key={aviso.chave} tom="warning">
            {aviso.texto}
          </Aviso>
        ))}
        {mensagemMudou && regra?.codigo === null && regra.mensagem ? (
          <Aviso tom="warning">
            {TEXTOS_DO_DIALOGO.mensagemMudouSemCodigo}
          </Aviso>
        ) : null}

        <FormField
          control={form.control}
          name="palavras_chave"
          render={() => (
            <FormItem>
              <FormLabel>{TEXTOS_DO_DIALOGO.rotuloDasPalavras}</FormLabel>
              <div className="flex flex-wrap items-center gap-2">
                <FormControl>
                  <Input
                    value={rascunhoDaPalavra}
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    placeholder="Ex.: bio, perfil"
                    disabled={palavras.length >= LIMITE_DE_PALAVRAS_CHAVE}
                    onChange={(evento) =>
                      setRascunhoDaPalavra(evento.target.value)
                    }
                    onKeyDown={(evento) => {
                      if (evento.key === "Enter" || evento.key === ",") {
                        evento.preventDefault();
                        adicionarPalavras();
                      }
                    }}
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    rascunhoDaPalavra.trim() === "" ||
                    palavras.length >= LIMITE_DE_PALAVRAS_CHAVE
                  }
                  onClick={() => adicionarPalavras()}
                >
                  <Plus aria-hidden />
                  Adicionar
                </Button>
              </div>
              {palavras.length > 0 ? (
                <ul
                  className="flex flex-wrap gap-2"
                  aria-label="Palavras-chave desta origem"
                >
                  {palavras.map((palavra, indice) => (
                    <li
                      key={`${palavra}-${indice}`}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-3 pr-1 pl-3 text-[13px] text-text-strong"
                    >
                      {palavra}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Tirar a palavra-chave ${palavra}`}
                        onClick={() => tirarPalavra(indice)}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[12px] text-text-secondary">
                {palavras.length} de {LIMITE_DE_PALAVRAS_CHAVE}. Separe por
                vírgula ou aperte Enter.
              </p>
              <Aviso tom="warning" role="note">
                {TEXTOS_DO_DIALOGO.avisoDasPalavras}
              </Aviso>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        {regra ? (
          <p className="text-[13px] text-text-secondary">
            {regra.codigo ? (
              <>
                Código do link:{" "}
                <span className="cz-num font-semibold text-text-strong">
                  #{regra.codigo}
                </span>{" "}
                (não muda, para o link publicado continuar valendo).
              </>
            ) : (
              "Esta origem não tem código no link. O código só se escolhe ao criar."
            )}
          </p>
        ) : (
          <FormField
            control={form.control}
            name="com_codigo"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(valor) =>
                        field.onChange(valor === true)
                      }
                      className="mt-px"
                    />
                  </FormControl>
                  <div className="grid gap-1">
                    <FormLabel className="text-[13.5px] leading-[1.3]">
                      {TEXTOS_DO_DIALOGO.rotuloDoCodigo}
                    </FormLabel>
                    <FormDescription className="text-[12px] text-text-secondary">
                      {TEXTOS_DO_DIALOGO.ajudaDoCodigo}
                    </FormDescription>
                  </div>
                </div>
              </FormItem>
            )}
          />
        )}

        <div className="grid gap-1.5">
          <LinkParaABio
            numeros={numeros}
            mensagem={mensagem}
            codigo={regra ? regra.codigo : null}
            motivoSemCopiar={
              regra === null
                ? TEXTOS_DO_DIALOGO.salvarAntesDeCopiar
                : mensagemMudou
                  ? TEXTOS_DO_DIALOGO.salvarMudancaAntesDeCopiar
                  : null
            }
          />
          {regra === null && form.watch("com_codigo") ? (
            <p className="text-[12px] text-text-secondary">
              O código entra no fim do link depois de salvar.
            </p>
          ) : null}
        </div>

        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={enviando}
            onClick={aoFechar}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={enviando}>
            {enviando
              ? "Salvando..."
              : regra
                ? "Salvar origem"
                : "Criar origem"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
