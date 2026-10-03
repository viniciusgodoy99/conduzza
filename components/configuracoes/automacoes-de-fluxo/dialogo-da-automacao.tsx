"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { salvarAutomacaoDeFluxoAction } from "@/app/(app)/configuracoes/automacoes-de-fluxo-actions";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
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
import { STATUS_TONE_VARS } from "@/lib/design/status";
import {
  cicloDaAutomacao,
  destinosPossiveis,
  ehGatilhoDeTempo,
  entradaDoFormulario,
  ESPERA_MAXIMA_MINUTOS,
  ESPERA_MINIMA_MINUTOS,
  formularioDaAutomacaoSchema,
  minutosDoFormulario,
  NOME_MAXIMO,
  NOTA_MAXIMA,
  OPCOES_DE_ACAO,
  OPCOES_DE_GATILHO,
  recomecaAVigencia,
  resolvedorDeNomes,
  textoDoCiclo,
  TITULO_DA_ATIVIDADE_MAXIMO,
  valoresIniciais,
  type AutomacaoDeFluxo,
  type ValoresDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";

import { PreviaDaAutomacao } from "./previa-da-automacao";
import { useValorAtrasado } from "./use-valor-atrasado";

// Criar e editar uma automacao de fluxo num dialogo central. Os campos
// aparecem conforme o gatilho (o tempo so nos de tempo) e a acao (destino,
// etiqueta, atividade ou nota). react-hook-form com o Zod do formulario de
// lib/domain/automacoes-de-fluxo; a Server Action valida de novo e o banco
// e a garantia final (vetos, ciclo, FKs).
//
// Antes de salvar a tela ja avisa o que o banco recusaria: o ciclo com as
// outras automacoes ligadas (espelho do detector do banco) e a previa de
// quantos leads ja passaram do ponto (a regra nao e retroativa).

/** Etapa com icone e nome na cor da familia, como o seletor de etapa do Kanban. */
function OpcaoDeEtapa({ etapa }: { etapa: EtapaDaJornada }) {
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

export function DialogoDaAutomacao({
  aberto,
  aoFechar,
  aoSalvar,
  regra,
  automacoes,
  jornada,
  etiquetas,
  clinicId,
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** Depois de salvar (a lista volta pelo revalidate da action) */
  aoSalvar: () => void;
  /** nula cria uma nova */
  regra: AutomacaoDeFluxo | null;
  /** todas as regras da clinica, para o detector de ciclo */
  automacoes: readonly AutomacaoDeFluxo[];
  jornada: readonly EtapaDaJornada[];
  /** nulo: a leitura das etiquetas falhou */
  etiquetas: readonly EtiquetaDeConversa[] | null;
  clinicId: string;
}) {
  const form = useForm<ValoresDaAutomacao>({
    resolver: zodResolver(formularioDaAutomacaoSchema),
    defaultValues: valoresIniciais(regra),
  });

  const valores = form.watch();
  const nomeDaEtapa = resolvedorDeNomes(jornada);
  const deTempo = ehGatilhoDeTempo(valores.gatilho);
  const destinos = destinosPossiveis(jornada, valores.etapa);
  const destinoEscolhido = jornada.find(
    (etapa) => etapa.chave === valores.etapa_destino,
  );
  const salvando = form.formState.isSubmitting;
  const erroGeral = form.formState.errors.root?.message;

  // A previa so consulta depois de o campo de tempo parar de mudar.
  const esperaAtrasada = useValorAtrasado(
    `${valores.espera_valor}|${valores.espera_unidade}`,
    400,
  );
  const [valorAtrasado = "", unidadeAtrasada = "dias"] =
    esperaAtrasada.split("|");
  const minutosDaPrevia = deTempo
    ? minutosDoFormulario({
        espera_valor: valorAtrasado,
        espera_unidade: unidadeAtrasada === "horas" ? "horas" : "dias",
      })
    : null;
  // Regra ligada que so mudou de nome ou de acao continua valendo desde
  // quando foi ligada: ai a previa nao se aplica. Desligada, mostra o que
  // vai valer ao ligar.
  const previaSeAplica =
    regra === null ||
    !regra.ativa ||
    recomecaAVigencia(regra, {
      ativa: valores.ativa,
      gatilho: valores.gatilho,
      etapa: valores.etapa,
      espera_minutos: deTempo ? minutosDoFormulario(valores) : null,
    });
  const previaPronta =
    previaSeAplica &&
    valores.etapa !== "" &&
    (!deTempo ||
      (minutosDaPrevia !== null &&
        minutosDaPrevia >= ESPERA_MINIMA_MINUTOS &&
        minutosDaPrevia <= ESPERA_MAXIMA_MINUTOS));

  // Espelho do detector de ciclo do banco: so com a regra ligada.
  const ciclo =
    valores.acao === "mover_etapa" && valores.etapa_destino !== ""
      ? cicloDaAutomacao(
          {
            id: regra?.id ?? null,
            ativa: valores.ativa,
            gatilho: valores.gatilho,
            acao: valores.acao,
            etapa: valores.etapa,
            etapa_destino: valores.etapa_destino,
          },
          automacoes,
        )
      : null;

  const enviar = async (dados: ValoresDaAutomacao) => {
    if (ciclo) {
      return;
    }
    const resultado = await salvarAutomacaoDeFluxoAction(
      entradaDoFormulario(dados, regra?.id ?? null),
    );
    if (!resultado.ok) {
      form.setError("root", { message: resultado.error });
      return;
    }
    toast.success(regra ? "Automação salva." : "Automação criada.");
    aoSalvar();
    aoFechar();
  };

  const destinoComConversao =
    destinoEscolhido?.conversao_ativa && destinoEscolhido.meta_event_name;

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? aoFechar() : null)}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {regra ? `Editar ${regra.nome}` : "Nova automação de fluxo"}
          </DialogTitle>
          <DialogDescription>
            Quando o lead está numa etapa e algo acontece, a automação faz uma
            coisa por ele. Roda sozinha, em até 1 minuto.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            noValidate
            className="grid gap-5"
            onSubmit={(evento) => void form.handleSubmit(enviar)(evento)}
          >
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da automação</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={NOME_MAXIMO}
                      placeholder="Ex.: Sem resposta vira Perdido"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <fieldset className="grid gap-3 rounded-xl border border-border p-3.5">
              <legend className="px-1 text-[13.5px] font-bold text-text-strong">
                Quando
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="etapa"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>O lead está na etapa</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(valor) => {
                          field.onChange(valor);
                          // Destino igual a origem nao existe: limpa.
                          if (form.getValues("etapa_destino") === valor) {
                            form.setValue("etapa_destino", "");
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Escolha a etapa" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {jornada.map((etapa) => (
                            <SelectItem key={etapa.chave} value={etapa.chave}>
                              <OpcaoDeEtapa etapa={etapa} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gatilho"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E acontece</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {OPCOES_DE_GATILHO.map((opcao) => (
                            <SelectItem key={opcao.valor} value={opcao.valor}>
                              {opcao.rotulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="text-xs text-text-secondary">
                {
                  OPCOES_DE_GATILHO.find(
                    (opcao) => opcao.valor === valores.gatilho,
                  )?.ajuda
                }
              </p>

              {deTempo ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <FormField
                    control={form.control}
                    name="espera_valor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {valores.gatilho === "sem_resposta_na_etapa"
                            ? "Tempo sem responder"
                            : "Tempo na etapa"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="numeric"
                            maxLength={4}
                            className="cz-num"
                          />
                        </FormControl>
                        <FormDescription>De 1 hora a 90 dias.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="espera_unidade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Em</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="horas">Horas</SelectItem>
                            <SelectItem value="dias">Dias</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-border p-3.5">
              <legend className="px-1 text-[13.5px] font-bold text-text-strong">
                Faz
              </legend>
              <FormField
                control={form.control}
                name="acao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ação</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {OPCOES_DE_ACAO.map((opcao) => (
                          <SelectItem key={opcao.valor} value={opcao.valor}>
                            {opcao.rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {
                        OPCOES_DE_ACAO.find(
                          (opcao) => opcao.valor === valores.acao,
                        )?.ajuda
                      }
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {valores.acao === "mover_etapa" ? (
                <>
                  <FormField
                    control={form.control}
                    name="etapa_destino"
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
                            {destinos.map((etapa) => (
                              <SelectItem key={etapa.chave} value={etapa.chave}>
                                <OpcaoDeEtapa etapa={etapa} />
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
                  {destinoComConversao ? (
                    <Aviso tom="warning">
                      {destinoEscolhido.nome} registra conversão para os
                      anúncios da Meta: cada lead movido pela automação conta
                      como conversão.
                    </Aviso>
                  ) : null}
                </>
              ) : null}

              {valores.acao === "etiquetar" ? (
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
                    name="etiqueta"
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

              {valores.acao === "criar_atividade" ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <FormField
                    control={form.control}
                    name="atividade_titulo"
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
                    name="atividade_prazo_dias"
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

              {valores.acao === "nota_interna" ? (
                <FormField
                  control={form.control}
                  name="nota_texto"
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
            </fieldset>

            {/* Checkbox, e nao Switch: a escolha so vale depois do Salvar
                (docs/06, C31). O Radix pode devolver "indeterminate": so
                true marca. Ligar e desligar direto, sem Salvar, fica no
                Switch da linha da lista. */}
            <FormField
              control={form.control}
              name="ativa"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(valor) =>
                        field.onChange(valor === true)
                      }
                      className="mt-px"
                    />
                  </FormControl>
                  <div className="grid gap-0.5">
                    <FormLabel className="font-normal">Ligada</FormLabel>
                    <FormDescription>
                      Desmarcada, a automação fica guardada e não roda.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {previaPronta ? (
              <PreviaDaAutomacao
                clinicId={clinicId}
                gatilho={valores.gatilho}
                etapa={valores.etapa}
                nomeDaEtapa={nomeDaEtapa(valores.etapa)}
                esperaMinutos={minutosDaPrevia}
              />
            ) : null}

            {ciclo ? (
              <Aviso tom="alert" titulo="Fecha um ciclo com outra automação">
                Com esta ligada, o lead ficaria indo e voltando sozinho:{" "}
                {textoDoCiclo(ciclo, nomeDaEtapa)}. Mude o destino, desligue a
                outra automação ou salve esta desligada.
              </Aviso>
            ) : null}

            {erroGeral ? (
              <Aviso tom="alert" role="alert">
                {erroGeral}
              </Aviso>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={salvando}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={salvando || ciclo !== null}>
                <Check className="size-4" aria-hidden />
                {salvando ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
