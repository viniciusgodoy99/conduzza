"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { salvarAutomacaoDeFluxoAction } from "@/app/(app)/automacoes/fluxo-actions";
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
import {
  cicloDaAutomacao,
  ehGatilhoDeTempo,
  entradaDoFormulario,
  ESPERA_MAXIMA_MINUTOS,
  ESPERA_MINIMA_MINUTOS,
  formularioDaAutomacaoSchema,
  MAXIMO_DE_ACOES,
  minutosDoFormulario,
  NOME_MAXIMO,
  OPCOES_DE_GATILHO,
  recomecaAVigencia,
  regraParaCiclo,
  resolvedorDeNomes,
  textoDoCiclo,
  valoresIniciais,
  type AutomacaoDeFluxo,
  type ValoresDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type {
  LeituraDasEtiquetas,
  OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

import { FazDaAutomacao, OpcaoDeEtapa } from "./faz-da-automacao";
import { PreviaDaAutomacao } from "./previa-da-automacao";
import { SeDaAutomacao } from "./se-da-automacao";
import { useValorAtrasado } from "./use-valor-atrasado";

// Criar e editar uma automacao de fluxo num dialogo central, em tres partes
// (onda 4, itens 14 e 15): QUANDO (etapa, gatilho e o tempo nos gatilhos de
// tempo), SE (as condicoes de etiqueta, opcionais) e FAZ (de 1 a 5 acoes, o
// mover sempre por ultimo). react-hook-form com o Zod do formulario de
// lib/domain/automacoes-de-fluxo; a Server Action valida de novo e o banco e
// a garantia final (RPC salvar_automacao_de_fluxo: vetos, ciclo, FKs).
//
// Antes de salvar a tela ja avisa o que o banco recusaria: o ciclo com as
// outras automacoes ligadas (espelho do detector do banco, lendo as acoes) e
// a previa de quantos leads ja passaram do ponto (a regra nao e retroativa).

export function DialogoDaAutomacao({
  aberto,
  aoFechar,
  aoSalvar,
  regra,
  automacoes,
  jornada,
  etiquetas,
  opcoesDeEtiqueta,
  leituraDasOpcoes,
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
  /** As etiquetas para as condicoes (catalogo e em uso nos leads) */
  opcoesDeEtiqueta: readonly OpcaoDeEtiqueta[];
  leituraDasOpcoes: LeituraDasEtiquetas;
  clinicId: string;
}) {
  const form = useForm<ValoresDaAutomacao>({
    resolver: zodResolver(formularioDaAutomacaoSchema),
    defaultValues: valoresIniciais(regra),
  });

  const valores = form.watch();
  const nomeDaEtapa = resolvedorDeNomes(jornada);
  const deTempo = ehGatilhoDeTempo(valores.gatilho);
  const salvando = form.formState.isSubmitting;
  const erroGeral = form.formState.errors.root?.message;
  const erroDasAcoes =
    form.formState.errors.acoes?.root?.message ??
    form.formState.errors.acoes?.message;
  const erroDasCondicoes =
    form.formState.errors.condicoes?.root?.message ??
    form.formState.errors.condicoes?.message;

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
  // Regra ligada que so mudou de nome, de condicao ou de acao continua
  // valendo desde quando foi ligada: ai a previa nao se aplica. Desligada,
  // mostra o que vai valer ao ligar.
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

  // Espelho do detector de ciclo do banco: so com a regra ligada e com um
  // mover de destino escolhido.
  const destino =
    valores.acoes.find((acao) => acao.acao === "mover_etapa")?.etapa_destino ??
    "";
  const ciclo =
    destino !== ""
      ? cicloDaAutomacao(
          {
            id: regra?.id ?? null,
            ativa: valores.ativa,
            gatilho: valores.gatilho,
            etapa: valores.etapa,
            destino,
          },
          automacoes.map(regraParaCiclo),
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

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? aoFechar() : null)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>
            {regra ? `Editar ${regra.nome}` : "Nova automação de fluxo"}
          </DialogTitle>
          <DialogDescription>
            Quando o lead está numa etapa e algo acontece, se as condições
            baterem, a automação faz até {MAXIMO_DE_ACOES} coisas por ele, na
            ordem. Roda sozinha, em até 1 minuto.
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
                          form.getValues("acoes").forEach((acao, indice) => {
                            if (
                              acao.acao === "mover_etapa" &&
                              acao.etapa_destino === valor
                            ) {
                              form.setValue(
                                `acoes.${indice}.etapa_destino`,
                                "",
                              );
                            }
                          });
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

            <SeDaAutomacao
              form={form}
              opcoes={opcoesDeEtiqueta}
              leitura={leituraDasOpcoes}
              desabilitado={salvando}
            />
            {erroDasCondicoes ? (
              <Aviso tom="alert" role="alert">
                {erroDasCondicoes}
              </Aviso>
            ) : null}

            <FazDaAutomacao
              form={form}
              jornada={jornada}
              etiquetas={etiquetas}
              desabilitado={salvando}
            />
            {erroDasAcoes ? (
              <Aviso tom="alert" role="alert">
                {erroDasAcoes}
              </Aviso>
            ) : null}

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
