"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

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
  agendaCompleta,
  agendaDoAgenteSchema,
  ANTECEDENCIA_DA_AGENDA,
  HORIZONTE_DA_AGENDA,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";

// Limites para marcar consulta (E4, decisao D13 do dono de 20/10/2026), na
// aba Regras e limites da Tela 6: a antecedencia minima (horas) e o
// horizonte (dias) que a IA respeita ao oferecer horario. A clinica preenche;
// ninguem inventa valor: o campo nasce vazio (colunas nulas) e, com um dos
// dois vazio, a habilidade "Agendar consulta" fica desligada (a aba
// Habilidades mostra a chave desabilitada com a dica, e o motor e o banco
// recusam).
//
// Formulario proprio, com o proprio Salvar (grava agenda_antecedencia_horas e
// agenda_horizonte_dias no RASCUNHO pela acao salvarAgendaAction, o mesmo
// caminho de permissao das outras partes). Validacao com o Zod da frente de
// IA (agendaDoAgenteSchema: inteiros nas faixas do CHECK do banco). Campo
// vazio vira nulo; texto que o navegador nao le como numero ("1e") vira NaN
// e cai na mensagem do campo, nunca num nulo calado. Sem permissao
// (recepcao), os campos ficam travados e o Salvar, visivel e desabilitado
// com a dica.

type ValoresDaAgenda = z.input<typeof agendaDoAgenteSchema>;
type CampoDaAgenda = keyof ValoresDaAgenda;

/**
 * O valor do campo numerico para o formulario: vazio vira nulo (a clinica
 * ainda nao preencheu); o que o navegador nao conseguiu ler como numero vira
 * NaN, para o Zod recusar com a mensagem do campo.
 */
export function valorDoCampoDaAgenda(
  texto: string,
  invalidoNoNavegador: boolean,
): number | null {
  if (invalidoNoNavegador) {
    return Number.NaN;
  }
  const limpo = texto.trim();
  return limpo === "" ? null : Number(limpo);
}

/** O que o campo mostra: nulo e NaN ficam vazios. */
export function textoDoCampoDaAgenda(valor: number | null): string | number {
  return valor === null || Number.isNaN(valor) ? "" : valor;
}

/**
 * O aviso de que "Agendar consulta" fica desligada aparece com o que esta
 * no formulario agora (nao so com o que esta salvo): a pessoa ve o efeito
 * enquanto digita.
 */
export function avisoDeAgendaIncompleta(valores: ValoresDaAgenda): boolean {
  return !agendaCompleta({
    antecedenciaHoras: valores.antecedenciaHoras,
    horizonteDias: valores.horizonteDias,
  });
}

export function CartaoDaAgenda({
  agenda,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  agenda: AgendaDoAgente;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (agenda: AgendaDoAgente, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi digitado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const form = useForm<ValoresDaAgenda, unknown, AgendaDoAgente>({
    resolver: zodResolver(agendaDoAgenteSchema),
    defaultValues: agenda,
  });
  const travado = !podeEditar;
  const antecedencia = form.watch("antecedenciaHoras");
  const horizonte = form.watch("horizonteDias");
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
      {salvando ? "Salvando..." : T.salvarAgenda}
    </Button>
  );

  const campo = (
    nome: CampoDaAgenda,
    rotulo: string,
    descricao: string,
    faixa: { minimo: number; maximo: number },
  ) => (
    <FormField
      control={form.control}
      name={nome}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{rotulo}</FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="numeric"
              className="cz-num"
              min={faixa.minimo}
              max={faixa.maximo}
              step={1}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={textoDoCampoDaAgenda(field.value)}
              onChange={(evento) =>
                field.onChange(
                  valorDoCampoDaAgenda(
                    evento.target.value,
                    evento.target.validity.badInput,
                  ),
                )
              }
            />
          </FormControl>
          <FormDescription>{descricao}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Card role="region" aria-labelledby="agente-agenda-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-agenda-titulo">{T.agendaTitulo}</CardTitle>
          <CardDescription>{T.agendaDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            aria-label={T.agendaTitulo}
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
            <fieldset
              disabled={travado}
              className="grid min-w-0 items-start gap-5 sm:grid-cols-2"
            >
              {campo(
                "antecedenciaHoras",
                T.antecedencia,
                T.antecedenciaDica(
                  ANTECEDENCIA_DA_AGENDA.minimo,
                  ANTECEDENCIA_DA_AGENDA.maximo,
                ),
                ANTECEDENCIA_DA_AGENDA,
              )}
              {campo(
                "horizonteDias",
                T.horizonte,
                T.horizonteDica(
                  HORIZONTE_DA_AGENDA.minimo,
                  HORIZONTE_DA_AGENDA.maximo,
                ),
                HORIZONTE_DA_AGENDA,
              )}
            </fieldset>

            {avisoDeAgendaIncompleta({
              antecedenciaHoras: antecedencia,
              horizonteDias: horizonte,
            }) ? (
              <Aviso tom="info" role="note">
                {T.agendaIncompleta}
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
