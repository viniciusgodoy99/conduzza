"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { BalaoWhatsApp } from "@/components/automacoes/balao-whatsapp";
import { CartoesDeEscolha } from "@/components/agente/cartoes-de-escolha";
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
import { Textarea } from "@/components/ui/textarea";
import {
  EXEMPLO_DO_TOM,
  LIMITES_DO_AGENTE,
  personaSchema,
  problemaNoTextoDoAgente,
  ROTULO_DO_TOM,
  TONS_DO_AGENTE,
  type ConfigDoAgente,
  type PersonaDoAgente,
} from "@/lib/domain/agente/config";

// Aba Persona da Tela 6: nome, tom de voz em 3 cartoes com a frase de
// exemplo, usar emoji (Checkbox: so vale depois de salvar e publicar, C31),
// saudacao e encerramento com contador e a previa no balao do WhatsApp
// (ponto de vista do paciente, C30). Salvar grava no RASCUNHO; o paciente so
// ve depois de publicar.
//
// O formulario confere o mesmo schema da acao e, por cima, as regras do
// filtro do CFM em nome, saudacao e encerramento (problemaNoTextoDoAgente):
// o erro aparece no campo, antes de ir ao servidor, que confere de novo.

/** O schema da acao com as regras do filtro, campo a campo. */
export const personaDaTelaSchema = personaSchema.superRefine((persona, ctx) => {
  const campos = [
    ["nome", persona.nome],
    ["saudacao", persona.saudacao],
    ["encerramento", persona.encerramento],
  ] as const;
  for (const [campo, texto] of campos) {
    if (texto === null) {
      continue;
    }
    const problema = problemaNoTextoDoAgente(texto, campo);
    if (problema !== null) {
      ctx.addIssue({ code: "custom", path: [campo], message: problema });
    }
  }
});

type ValoresDaPersona = z.input<typeof personaDaTelaSchema>;

export function valoresDaPersona(config: ConfigDoAgente): ValoresDaPersona {
  return {
    nome: config.nome,
    tom: config.tom,
    usarEmoji: config.usarEmoji,
    saudacao: config.saudacao ?? "",
    encerramento: config.encerramento ?? "",
  };
}

/** O texto da previa: saudacao, a frase de exemplo do tom e o encerramento. */
export function textoDaPrevia(valores: ValoresDaPersona): string {
  return [
    (valores.saudacao ?? "").trim(),
    EXEMPLO_DO_TOM[valores.tom],
    (valores.encerramento ?? "").trim(),
  ]
    .filter((parte) => parte !== "")
    .join("\n\n");
}

function Contador({ valor, limite }: { valor: string; limite: number }) {
  return (
    <span className="cz-num text-[11px] text-text-secondary" aria-hidden>
      {valor.length}/{limite}
    </span>
  );
}

export function AbaPersona({
  config,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  config: ConfigDoAgente;
  podeEditar: boolean;
  dica: string | null;
  /** Alguma acao do painel esta rodando (uma por vez). */
  pendente: boolean;
  /** Esta acao (salvar a persona) esta rodando. */
  salvando: boolean;
  aoSalvar: (persona: PersonaDoAgente, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi digitado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const form = useForm<ValoresDaPersona, unknown, PersonaDoAgente>({
    resolver: zodResolver(personaDaTelaSchema),
    defaultValues: valoresDaPersona(config),
  });
  const valores = form.watch();
  const travado = !podeEditar;
  const erroDoServidor = form.formState.errors.root?.message;
  const naoSalvo = form.formState.isDirty && !travado;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);

  const botaoSalvar = (
    <Button
      type="submit"
      variant="solid"
      disabled={travado || pendente}
      aria-busy={salvando || undefined}
    >
      {salvando ? "Salvando..." : "Salvar persona"}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby="agente-persona-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-persona-titulo">{T.personaTitulo}</CardTitle>
          <CardDescription>{T.personaDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            aria-label={T.personaTitulo}
            className="grid gap-5"
            onSubmit={(evento) =>
              void form.handleSubmit((persona) =>
                aoSalvar(persona, {
                  // O que foi salvo vira o novo ponto de partida (o
                  // "Alterações ainda não salvas" some).
                  seDerCerto: () =>
                    form.reset(valoresDaPersona({ ...config, ...persona })),
                  seFalhar: (erro) => form.setError("root", { message: erro }),
                }),
              )(evento)
            }
          >
            <fieldset disabled={travado} className="grid min-w-0 gap-5">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem className="sm:max-w-[360px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <FormLabel>{T.nome}</FormLabel>
                      <Contador
                        valor={field.value}
                        limite={LIMITES_DO_AGENTE.nome}
                      />
                    </div>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={LIMITES_DO_AGENTE.nome}
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormDescription>{T.nomeDica}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tom"
                render={({ field }) => (
                  <FormItem>
                    {/* O grupo leva o mesmo nome (aria-label): o titulo
                        visivel nao e lido duas vezes. */}
                    <span
                      aria-hidden
                      className="text-xs font-semibold text-foreground"
                    >
                      {T.tom}
                    </span>
                    <CartoesDeEscolha
                      nome="agente-tom"
                      rotuloDoGrupo={T.tom}
                      className="lg:grid-cols-3"
                      desabilitado={travado}
                      valor={field.value}
                      aoEscolher={field.onChange}
                      opcoes={TONS_DO_AGENTE.map((tom) => ({
                        valor: tom,
                        rotulo: ROTULO_DO_TOM[tom],
                        exemplo: EXEMPLO_DO_TOM[tom],
                      }))}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="usarEmoji"
                render={({ field }) => (
                  <FormItem className="flex items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(valor) =>
                          field.onChange(valor === true)
                        }
                        onBlur={field.onBlur}
                        className="mt-px"
                      />
                    </FormControl>
                    <div className="grid gap-1">
                      <FormLabel className="text-[13.5px] leading-[1.3]">
                        {T.emoji}
                      </FormLabel>
                      <FormDescription>{T.emojiDescricao}</FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              <div className="grid gap-4 rounded-xl bg-surface-4 p-3.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="grid content-start gap-4">
                  <FormField
                    control={form.control}
                    name="saudacao"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-baseline justify-between gap-2">
                          <FormLabel>{T.saudacao}</FormLabel>
                          <Contador
                            valor={field.value ?? ""}
                            limite={LIMITES_DO_AGENTE.saudacao}
                          />
                        </div>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ""}
                            rows={3}
                            maxLength={LIMITES_DO_AGENTE.saudacao}
                            placeholder="Ex.: Olá! Aqui é a recepção da clínica."
                            className="text-sm"
                          />
                        </FormControl>
                        <FormDescription>{T.saudacaoDica}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="encerramento"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-baseline justify-between gap-2">
                          <FormLabel>{T.encerramento}</FormLabel>
                          <Contador
                            valor={field.value ?? ""}
                            limite={LIMITES_DO_AGENTE.encerramento}
                          />
                        </div>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ""}
                            rows={3}
                            maxLength={LIMITES_DO_AGENTE.encerramento}
                            placeholder="Ex.: Qualquer dúvida, é só chamar por aqui."
                            className="text-sm"
                          />
                        </FormControl>
                        <FormDescription>{T.encerramentoDica}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid content-start gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {T.comoOPacienteVe}
                  </span>
                  <BalaoWhatsApp corpo={textoDaPrevia(valores)} />
                  <p className="text-[11.5px] text-text-secondary">
                    {T.previaExplicacao}
                  </p>
                </div>
              </div>
            </fieldset>

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
