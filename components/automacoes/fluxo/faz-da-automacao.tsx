"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useFieldArray, type UseFormReturn } from "react-hook-form";

import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
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
import { STATUS_TONE_VARS } from "@/lib/design/status";
import {
  acaoEmBranco,
  destinosPossiveis,
  MAXIMO_DE_ACOES,
  NOTA_DO_MOVER,
  NOTA_MAXIMA,
  OPCOES_DE_ACAO,
  TITULO_DA_ATIVIDADE_MAXIMO,
  type AcaoDeAutomacao,
  type ValoresDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";

// O "Faz" do dialogo da automacao (onda 4, item 14; decisao D7 do dono): de
// 1 a 5 acoes, na ordem em que rodam, com no maximo um "Mover para outra
// etapa", que fica SEMPRE por ultimo (mover antes tiraria o lead da etapa,
// e as outras acoes nao rodariam). "Adicionar ação" entra antes do mover;
// escolher "Mover" numa acao a leva para o fim; Subir e Descer nunca passam
// do mover. Os campos de cada acao sao os de sempre.

/** Etapa com icone e nome na cor da familia, como o seletor de etapa do Kanban. */
export function OpcaoDeEtapa({ etapa }: { etapa: EtapaDaJornada }) {
  const definicao = definicaoDaEtapa(etapa);
  const Icone = definicao.icon;
  return (
    <span className="flex items-center gap-2">
      {Icone ? (
        <Icone
          aria-hidden
          className="size-[15px] shrink-0"
          style={{ color: STATUS_TONE_VARS[definicao.tone].text }}
        />
      ) : null}
      {etapa.nome}
    </span>
  );
}

export function FazDaAutomacao({
  form,
  jornada,
  etiquetas,
  desabilitado,
}: {
  form: UseFormReturn<ValoresDaAutomacao>;
  jornada: readonly EtapaDaJornada[];
  /** O catalogo de etiquetas de conversa; nulo: a leitura falhou */
  etiquetas: readonly EtiquetaDeConversa[] | null;
  desabilitado: boolean;
}) {
  const { fields, insert, remove, move, update } = useFieldArray({
    control: form.control,
    name: "acoes",
  });
  const acoes = form.watch("acoes");
  const etapa = form.watch("etapa");
  const indiceDoMover = acoes.findIndex((acao) => acao.acao === "mover_etapa");
  const cheia = fields.length >= MAXIMO_DE_ACOES;
  const destinos = destinosPossiveis(jornada, etapa);

  // A acao nova entra antes do mover (o mover e sempre a ultima).
  const adicionar = () => {
    const posicao = indiceDoMover >= 0 ? indiceDoMover : fields.length;
    insert(posicao, acaoEmBranco("criar_atividade"));
  };

  // Trocar o tipo: vira mover, vai para o fim; o resto dos campos fica (so
  // os do tipo escolhido valem no envio).
  const trocarTipo = (indice: number, tipo: AcaoDeAutomacao) => {
    const atual = form.getValues(`acoes.${indice}`);
    update(indice, { ...atual, acao: tipo });
    if (tipo === "mover_etapa" && indice !== fields.length - 1) {
      move(indice, fields.length - 1);
    }
  };

  const botaoAdicionar = (
    <Button
      type="button"
      variant="outline"
      disabled={desabilitado || cheia}
      onClick={adicionar}
    >
      <Plus aria-hidden />
      Adicionar ação
    </Button>
  );

  return (
    <fieldset className="grid gap-3 rounded-xl border border-border p-3.5">
      <legend className="px-1 text-[13.5px] font-bold text-text-strong">
        Faz
      </legend>

      <ol className="grid gap-3">
        {fields.map((item, indice) => {
          const acao = acoes[indice] ?? item;
          const ehMover = acao.acao === "mover_etapa";
          const numero = indice + 1;
          const ajuda = OPCOES_DE_ACAO.find(
            (opcao) => opcao.valor === acao.acao,
          )?.ajuda;
          const destinoEscolhido = ehMover
            ? jornada.find(
                (etapaDaJornada) => etapaDaJornada.chave === acao.etapa_destino,
              )
            : undefined;
          const comConversao =
            destinoEscolhido?.conversao_ativa &&
            destinoEscolhido.meta_event_name;
          // Subir e Descer nunca passam do mover.
          const podeSubir = !ehMover && indice > 0;
          const podeDescer =
            !ehMover &&
            indice < fields.length - 1 &&
            acoes[indice + 1]?.acao !== "mover_etapa";
          const dicaDaOrdem = ehMover ? NOTA_DO_MOVER : null;

          const subir = (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={desabilitado || !podeSubir}
              aria-label={`Subir a ação ${numero}`}
              onClick={() => move(indice, indice - 1)}
            >
              <ArrowUp aria-hidden />
            </Button>
          );
          const descer = (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={desabilitado || !podeDescer}
              aria-label={`Descer a ação ${numero}`}
              onClick={() => move(indice, indice + 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
          );
          const excluir = (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={desabilitado || fields.length <= 1}
              aria-label={`Remover a ação ${numero}`}
              onClick={() => remove(indice)}
            >
              <Trash2 aria-hidden />
            </Button>
          );

          return (
            <li
              key={item.id}
              className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-3"
            >
              <div className="flex flex-wrap items-end gap-2">
                <FormField
                  control={form.control}
                  name={`acoes.${indice}.acao`}
                  render={({ field }) => (
                    <FormItem className="min-w-[220px] flex-1">
                      <FormLabel>Ação {numero}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(valor) =>
                          trocarTipo(indice, valor as AcaoDeAutomacao)
                        }
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {OPCOES_DE_ACAO.map((opcao) => (
                            <SelectItem
                              key={opcao.valor}
                              value={opcao.valor}
                              // Um mover so por automacao: o da outra acao
                              // fica visivel e indisponivel.
                              disabled={
                                opcao.valor === "mover_etapa" &&
                                indiceDoMover >= 0 &&
                                indiceDoMover !== indice
                              }
                            >
                              {opcao.valor === "mover_etapa" &&
                              indiceDoMover >= 0 &&
                              indiceDoMover !== indice
                                ? `${opcao.rotulo} (a automação já move o lead)`
                                : opcao.rotulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <div className="flex items-center">
                  {dicaDaOrdem ? (
                    <DisabledWithHint hint={dicaDaOrdem}>
                      {subir}
                    </DisabledWithHint>
                  ) : (
                    subir
                  )}
                  {dicaDaOrdem ? (
                    <DisabledWithHint hint={dicaDaOrdem}>
                      {descer}
                    </DisabledWithHint>
                  ) : (
                    descer
                  )}
                  {fields.length <= 1 ? (
                    <DisabledWithHint hint="Uma automação faz pelo menos uma ação.">
                      {excluir}
                    </DisabledWithHint>
                  ) : (
                    excluir
                  )}
                </div>
              </div>
              {ajuda ? (
                <p className="text-xs text-text-secondary">{ajuda}</p>
              ) : null}

              {ehMover ? (
                <>
                  <FormField
                    control={form.control}
                    name={`acoes.${indice}.etapa_destino`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Para a etapa</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Escolha o destino" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {destinos.map((destino) => (
                              <SelectItem
                                key={destino.chave}
                                value={destino.chave}
                              >
                                <OpcaoDeEtapa etapa={destino} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Agendou e Compareceu não aparecem: quem leva o lead
                          para essas etapas é a Agenda.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {destinoEscolhido?.papel === "perdido" ? (
                    <p className="text-[13px] text-foreground">
                      <span className="font-semibold">Motivo da perda:</span>{" "}
                      Não respondeu (fixo). Quem tem consulta marcada fica onde
                      está.
                    </p>
                  ) : null}
                  {comConversao ? (
                    <Aviso tom="warning">
                      {destinoEscolhido.nome} registra conversão para os
                      anúncios da Meta: cada lead movido pela automação conta
                      como conversão.
                    </Aviso>
                  ) : null}
                </>
              ) : null}

              {acao.acao === "etiquetar" ? (
                etiquetas === null ? (
                  <Aviso tom="alert">
                    Não foi possível carregar as etiquetas. Recarregue a página
                    para escolher uma.
                  </Aviso>
                ) : etiquetas.length === 0 ? (
                  <Aviso tom="info">
                    Nenhuma etiqueta cadastrada ainda. Crie uma na aba{" "}
                    <Link
                      href="/configuracoes?aba=etiquetas"
                      className="font-semibold underline underline-offset-2"
                    >
                      Etiquetas de conversa
                    </Link>{" "}
                    e volte aqui.
                  </Aviso>
                ) : (
                  <FormField
                    control={form.control}
                    name={`acoes.${indice}.etiqueta`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Etiqueta</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Escolha a etiqueta" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {etiquetas.map((etiqueta) => (
                              <SelectItem
                                key={etiqueta.chave}
                                value={etiqueta.chave}
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    aria-hidden
                                    className="size-2.5 rounded-[2px]"
                                    style={{
                                      backgroundColor:
                                        STATUS_TONE_VARS[etiqueta.tom].marker,
                                    }}
                                  />
                                  {etiqueta.nome}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )
              ) : null}

              {acao.acao === "criar_atividade" ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <FormField
                    control={form.control}
                    name={`acoes.${indice}.atividade_titulo`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>O que fazer</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            maxLength={TITULO_DA_ATIVIDADE_MAXIMO}
                            placeholder="Ex.: Ligar para o lead"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`acoes.${indice}.atividade_prazo_dias`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vence em (dias)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="numeric"
                            maxLength={3}
                            className="cz-num"
                          />
                        </FormControl>
                        <FormDescription>
                          Zero vence no mesmo dia, no calendário da clínica.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}

              {acao.acao === "nota_interna" ? (
                <FormField
                  control={form.control}
                  name={`acoes.${indice}.nota_texto`}
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-baseline justify-between gap-2">
                        <FormLabel>Texto da nota</FormLabel>
                        <span
                          aria-hidden
                          className="cz-num text-[11px] text-text-secondary"
                        >
                          {field.value.length}/{NOTA_MAXIMA}
                        </span>
                      </div>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          maxLength={NOTA_MAXIMA}
                          placeholder="Ex.: Lead parado há 3 dias. Ofereça um horário."
                          className="min-h-[96px] text-sm"
                        />
                      </FormControl>
                      <FormDescription>
                        Só a equipe vê. Não escreva dado de saúde do paciente: o
                        mesmo texto vai para todos os leads.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {fields.length > 1 || indiceDoMover >= 0 ? (
        <p className="text-xs text-text-secondary">{NOTA_DO_MOVER}</p>
      ) : null}

      <div>
        {cheia ? (
          <DisabledWithHint
            hint={`Até ${MAXIMO_DE_ACOES} ações por automação.`}
          >
            {botaoAdicionar}
          </DisabledWithHint>
        ) : (
          botaoAdicionar
        )}
      </div>
    </fieldset>
  );
}
