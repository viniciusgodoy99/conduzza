"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useForm, type FieldErrors, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

import { CartoesDeEscolha } from "@/components/agente/cartoes-de-escolha";
import { ChaveTravada } from "@/components/agente/chave-travada";
import {
  useAvisarNaoSalvo,
  type AvisarNaoSalvo,
} from "@/components/agente/nao-salvo";
import { TEXTOS_DO_AGENTE as T } from "@/components/agente/textos";
import type { RetornoDaAcao } from "@/components/agente/tipos";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DIAS_DA_SEMANA,
  descricaoDoModo,
  GATILHOS_OBRIGATORIOS,
  horarioPadrao,
  horarioSchema,
  MINUTOS_SEM_RESPOSTA,
  MODOS_DE_OPERACAO,
  ROTULO_DO_DIA,
  ROTULO_DO_MODO,
  TEXTO_DA_CONFORMIDADE,
  type HorarioDeOperacao,
} from "@/lib/domain/agente/config";

// Aba Regras e limites da Tela 6:
// - Horario de operacao: o modo em 3 cartoes de radio (24 horas, so fora do
//   expediente, se a equipe nao responder em X minutos), os minutos e a
//   grade do expediente por dia (molde da janela de envio da regua, com
//   inicio e fim type=time). Salvar grava no RASCUNHO.
// - Os 6 gatilhos obrigatorios de passar para a equipe, travados (so
//   exibicao: quem decide e o codigo do agente, nao esta lista).
// - A caixa de Conformidade do brief: Aviso ambar com cadeado, o texto
//   aprovado e as travas do filtro do CFM em chaves ligadas e travadas (C24).
//
// "Salvar horario" nunca falha calado (achados 11 e 37): todo erro do
// formulario aparece numa lista junto do botao, inclusive o de um campo que
// nao esta na tela (os minutos fora do modo "Se a equipe nao responder"), e o
// Inicio tem a mensagem dele. Dia fechado nao valida as horas (o schema do
// dominio), e trocar para um modo sem os minutos volta um valor invalido ao
// ultimo salvo, para o campo escondido nao travar o Salvar.
//
// A lista nunca fica com erro velho: desmarcar um dia (ou sair do modo dos
// minutos) limpa o erro dos campos que somem, e mexer no Inicio ou no Fim
// confere os dois de novo depois da primeira tentativa de salvar (o erro do
// fim antes do inicio fica no Fim e depende do Inicio, e o react-hook-form
// so revalida o campo mexido).

type ValoresDoHorario = z.input<typeof horarioSchema>;
type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];
/** O pedaco do formulario que limpa e confere de novo (o do useForm). */
type FormularioQueConfere = Pick<
  UseFormReturn<ValoresDoHorario, unknown, HorarioDeOperacao>,
  "clearErrors" | "trigger"
>;

/** O Inicio e o Fim de um dia: os campos que somem quando o dia fecha. */
export function camposDoDia(dia: DiaDaSemana) {
  return [`expediente.${dia}.inicio`, `expediente.${dia}.fim`] as const;
}

/**
 * Depois de marcar ou desmarcar um dia. Fechado, as horas somem da tela e o
 * schema nao as valida: o erro delas sai da lista. Aberto de novo depois de
 * uma tentativa de salvar, as horas sao conferidas de novo (o erro volta se
 * ainda valer). Antes de tentar salvar, nada aparece (valida no Salvar).
 */
export function depoisDeMudarODia(
  form: FormularioQueConfere,
  dia: DiaDaSemana,
  aberto: boolean,
  jaTentouSalvar: boolean,
): void {
  if (!aberto) {
    form.clearErrors([...camposDoDia(dia)]);
    return;
  }
  if (jaTentouSalvar) {
    void form.trigger([...camposDoDia(dia)]);
  }
}

/**
 * Depois de mudar o Inicio ou o Fim: confere os DOIS do dia, para o erro de
 * um nao ficar depois que o outro o resolveu (ou aparecer so no Salvar).
 */
export function depoisDeMudarAHora(
  form: FormularioQueConfere,
  dia: DiaDaSemana,
  jaTentouSalvar: boolean,
): void {
  if (jaTentouSalvar) {
    void form.trigger([...camposDoDia(dia)]);
  }
}

/**
 * Depois de mudar o modo: fora do "Se a equipe nao responder" os minutos
 * somem da tela, e o erro deles sai da lista (o valor ja voltou ao ultimo
 * salvo no normalizarMinutos; um valor ainda invalido aparece no Salvar).
 */
export function depoisDeMudarOModo(
  form: Pick<FormularioQueConfere, "clearErrors">,
  modo: HorarioDeOperacao["modo"],
): void {
  if (modo !== "fallback") {
    form.clearErrors("minutosSemResposta");
  }
}

function minutosNaFaixa(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= MINUTOS_SEM_RESPOSTA.minimo &&
    valor <= MINUTOS_SEM_RESPOSTA.maximo
  );
}

/**
 * Os erros do horario em texto, um por campo, na ordem da tela. Cobre os
 * campos escondidos: e o que a pessoa le quando o Salvar nao salva.
 */
export function errosDoHorario(erros: FieldErrors<ValoresDoHorario>): string[] {
  const lista: string[] = [];
  const doModo = erros.modo?.message;
  if (doModo) {
    lista.push(doModo);
  }
  const dosMinutos = erros.minutosSemResposta?.message;
  if (dosMinutos) {
    lista.push(`${T.minutos}: ${dosMinutos}`);
  }
  for (const dia of DIAS_DA_SEMANA) {
    const doDia = erros.expediente?.[dia];
    for (const campo of ["inicio", "fim"] as const) {
      const mensagem = doDia?.[campo]?.message;
      if (!mensagem) {
        continue;
      }
      // "Segunda: o fim do expediente precisa ser depois do início." ja
      // diz o dia; as outras ganham o dia e o campo na frente.
      lista.push(
        mensagem.startsWith(ROTULO_DO_DIA[dia])
          ? mensagem
          : `${ROTULO_DO_DIA[dia]}, ${campo === "inicio" ? T.inicio : T.fim}: ${mensagem}`,
      );
    }
  }
  return lista;
}

export function AbaRegras({
  horario,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  horario: HorarioDeOperacao;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (horario: HorarioDeOperacao, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi digitado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  return (
    <div className="grid gap-4">
      <CartaoDoHorario
        horario={horario}
        podeEditar={podeEditar}
        dica={dica}
        pendente={pendente}
        salvando={salvando}
        aoSalvar={aoSalvar}
        aoMudarNaoSalvo={aoMudarNaoSalvo}
      />

      <Card role="region" aria-labelledby="agente-gatilhos-titulo">
        <CardHeader>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id="agente-gatilhos-titulo">
              {T.gatilhosTitulo}
            </CardTitle>
            <CardDescription>{T.gatilhosDescricao}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {GATILHOS_OBRIGATORIOS.map((gatilho) => (
              <li key={gatilho.chave} className="py-1.5">
                <ChaveTravada rotulo={gatilho.rotulo} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <section aria-labelledby="agente-conformidade-titulo">
        <Aviso tom="warning" icone={Lock} role="note">
          <h2
            id="agente-conformidade-titulo"
            className="text-[13.5px] leading-[1.35] font-bold"
          >
            {TEXTO_DA_CONFORMIDADE.titulo}
          </h2>
          <p className="mt-0.5">{TEXTO_DA_CONFORMIDADE.texto}</p>
          <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {TEXTO_DA_CONFORMIDADE.travas.map((trava) => (
              <li key={trava.categoria}>
                <ChaveTravada rotulo={trava.rotulo} />
              </li>
            ))}
          </ul>
        </Aviso>
      </section>
    </div>
  );
}

function CartaoDoHorario({
  horario,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  horario: HorarioDeOperacao;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (horario: HorarioDeOperacao, retorno: RetornoDaAcao) => void;
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const form = useForm<ValoresDoHorario, unknown, HorarioDeOperacao>({
    resolver: zodResolver(horarioSchema),
    defaultValues: horario,
  });
  const travado = !podeEditar;
  const modo = form.watch("modo");
  const minutos = form.watch("minutosSemResposta");
  const minutosValidos = Number.isInteger(minutos) && minutos > 0;
  const erroDoServidor = form.formState.errors.root?.message;
  const erros = errosDoHorario(form.formState.errors);
  const naoSalvo = form.formState.isDirty && !travado;
  const jaTentouSalvar = form.formState.isSubmitted;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);

  const normalizarMinutos = (valor: HorarioDeOperacao["modo"]) => {
    // Os minutos so aparecem no "Se a equipe nao responder": fora dele, um
    // valor invalido digitado antes volta ao ultimo salvo (ou ao padrao),
    // para o campo escondido nao travar o Salvar sem a pessoa ver.
    if (
      valor !== "fallback" &&
      !minutosNaFaixa(form.getValues("minutosSemResposta"))
    ) {
      form.setValue(
        "minutosSemResposta",
        minutosNaFaixa(horario.minutosSemResposta)
          ? horario.minutosSemResposta
          : horarioPadrao().minutosSemResposta,
      );
    }
    depoisDeMudarOModo(form, valor);
  };

  const botaoSalvar = (
    <Button
      type="submit"
      variant="solid"
      disabled={travado || pendente}
      aria-busy={salvando || undefined}
    >
      {salvando ? "Salvando..." : "Salvar horário"}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby="agente-horario-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-horario-titulo">{T.horarioTitulo}</CardTitle>
          <CardDescription>{T.horarioDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            aria-label={T.horarioTitulo}
            className="grid gap-5"
            onSubmit={(evento) =>
              void form.handleSubmit((valores) =>
                aoSalvar(valores, {
                  seDerCerto: () => form.reset(valores),
                  seFalhar: (erro) => form.setError("root", { message: erro }),
                }),
              )(evento)
            }
          >
            <fieldset disabled={travado} className="grid min-w-0 gap-5">
              <FormField
                control={form.control}
                name="modo"
                render={({ field }) => (
                  <FormItem>
                    <CartoesDeEscolha
                      nome="agente-modo"
                      rotuloDoGrupo="Quando o assistente responde"
                      className="lg:grid-cols-3"
                      desabilitado={travado}
                      valor={field.value}
                      aoEscolher={(valor) => {
                        field.onChange(valor);
                        normalizarMinutos(valor);
                      }}
                      opcoes={MODOS_DE_OPERACAO.map((valor) => ({
                        valor,
                        rotulo: ROTULO_DO_MODO[valor],
                        descricao: descricaoDoModo(
                          valor,
                          minutosValidos ? minutos : horario.minutosSemResposta,
                        ),
                      }))}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              {modo === "fallback" ? (
                <FormField
                  control={form.control}
                  name="minutosSemResposta"
                  render={({ field }) => (
                    <FormItem className="sm:max-w-[280px]">
                      <FormLabel>{T.minutos}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="cz-num"
                          min={MINUTOS_SEM_RESPOSTA.minimo}
                          max={MINUTOS_SEM_RESPOSTA.maximo}
                          step={1}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={Number.isNaN(field.value) ? "" : field.value}
                          onChange={(evento) =>
                            field.onChange(
                              evento.target.value === ""
                                ? Number.NaN
                                : Number(evento.target.value),
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        De {MINUTOS_SEM_RESPOSTA.minimo} a{" "}
                        {MINUTOS_SEM_RESPOSTA.maximo} minutos. Conversa que a
                        equipe assumiu nunca volta para o assistente.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <fieldset className="grid min-w-0 gap-2">
                <legend className="text-sm font-bold">{T.expediente}</legend>
                <p className="text-xs text-text-secondary">
                  {T.expedienteDescricao}
                </p>
                <ul className="grid gap-1.5 pt-1">
                  {DIAS_DA_SEMANA.map((dia) => (
                    <LinhaDoDia
                      key={dia}
                      dia={dia}
                      form={form}
                      travado={travado}
                      jaTentouSalvar={jaTentouSalvar}
                    />
                  ))}
                </ul>
              </fieldset>
            </fieldset>

            {erros.length > 0 ? (
              <Aviso tom="alert" role="alert" titulo={T.horarioComErro}>
                <ul className="grid list-disc gap-0.5 pl-4">
                  {erros.map((erro) => (
                    <li key={erro} className="break-words">
                      {erro}
                    </li>
                  ))}
                </ul>
              </Aviso>
            ) : null}
            {erroDoServidor ? (
              <Aviso tom="alert" role="alert">
                {erroDoServidor}
              </Aviso>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {dica ? (
                <DisabledWithHint hint={dica}>{botaoSalvar}</DisabledWithHint>
              ) : (
                botaoSalvar
              )}
              {naoSalvo ? (
                <span className="text-[13px] text-text-secondary">
                  Alterações ainda não salvas.
                </span>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function LinhaDoDia({
  dia,
  form,
  travado,
  jaTentouSalvar,
}: {
  dia: DiaDaSemana;
  form: UseFormReturn<ValoresDoHorario, unknown, HorarioDeOperacao>;
  travado: boolean;
  jaTentouSalvar: boolean;
}) {
  const aberto = form.watch(`expediente.${dia}.aberto`);
  const rotulo = ROTULO_DO_DIA[dia];
  return (
    <li className="grid items-center gap-x-3 gap-y-1.5 rounded-md bg-surface-4 px-3 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <FormField
        control={form.control}
        name={`expediente.${dia}.aberto`}
        render={({ field }) => (
          <FormItem className="flex min-h-10 items-center gap-3">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={(valor) => {
                  const marcado = valor === true;
                  field.onChange(marcado);
                  depoisDeMudarODia(form, dia, marcado, jaTentouSalvar);
                }}
                onBlur={field.onBlur}
              />
            </FormControl>
            <FormLabel className="text-[13.5px]">{rotulo}</FormLabel>
            <span className="sr-only">
              {field.value ? T.aberto : T.fechado}
            </span>
          </FormItem>
        )}
      />
      {aberto ? (
        <div className="flex flex-wrap items-start gap-3">
          <FormField
            control={form.control}
            name={`expediente.${dia}.inicio`}
            render={({ field }) => (
              <FormItem className="grid gap-1">
                <div className="flex items-center gap-2">
                  <FormLabel className="text-xs font-medium text-text-secondary">
                    <span aria-hidden>{T.inicio}</span>
                    <span className="sr-only">{`${T.inicio} de ${rotulo}`}</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="time"
                      className="w-[7.5rem] cz-num"
                      disabled={travado}
                      onChange={(evento) => {
                        field.onChange(evento);
                        depoisDeMudarAHora(form, dia, jaTentouSalvar);
                      }}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`expediente.${dia}.fim`}
            render={({ field }) => (
              <FormItem className="grid gap-1">
                <div className="flex items-center gap-2">
                  <FormLabel className="text-xs font-medium text-text-secondary">
                    <span aria-hidden>{T.fim}</span>
                    <span className="sr-only">{`${T.fim} de ${rotulo}`}</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="time"
                      className="w-[7.5rem] cz-num"
                      disabled={travado}
                      onChange={(evento) => {
                        field.onChange(evento);
                        depoisDeMudarAHora(form, dia, jaTentouSalvar);
                      }}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ) : (
        <span className="text-[13px] text-text-secondary">{T.fechado}</span>
      )}
    </li>
  );
}
