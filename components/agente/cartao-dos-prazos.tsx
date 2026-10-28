"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import {
  textoDoCampoDaAgenda,
  valorDoCampoDaAgenda,
} from "@/components/agente/cartao-da-agenda";
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
  PRAZO_DA_IA,
  prazosDoAgenteSchema,
  ROTULO_DOS_PRAZOS,
  type PrazosDoAgente,
} from "@/lib/domain/agente/config";

// "Prazos para cancelar e remarcar" (AG4, decisao D-24 pela recomendacao,
// pendente do dono), na aba Regras e limites da Tela 6, logo depois de
// "Dados para marcar consulta": ate quantas horas antes da consulta o
// assistente cancela e remarca. Com menos tempo, ele passa o pedido para a
// equipe (motivo fora_do_prazo). A clinica preenche; ninguem inventa valor:
// os campos nascem vazios (colunas nulas) e, com o campo vazio, a habilidade
// dele fica desligada (a aba Habilidades mostra a chave desabilitada com a
// dica; a Server Action, o motor e o banco recusam de novo).
//
// Versionado como os "Dados para marcar consulta": grava no RASCUNHO
// (salvarPrazosAction, colunas cancelar_antecedencia_horas e
// remarcar_antecedencia_horas), vale ao publicar e volta no restaurar.
// Formulario proprio, com o proprio Salvar, validado pelo Zod da
// configuracao (prazosDoAgenteSchema: inteiro de 0 a 720, ou vazio).
// Campo vazio vira nulo; texto que o navegador nao le como numero vira NaN
// e cai na mensagem do campo ("Use um número inteiro de 0 a 720 horas."),
// nunca num nulo calado (as mesmas regras do cartao dos limites). O que foi
// digitado e nao salvo avisa o painel e conta como o dos limites
// ("agenda", como os dados para marcar): os tres cartoes sao sobre a agenda
// e descartar remonta os tres. Sem permissao (recepcao), os campos ficam
// travados e o Salvar, visivel e desabilitado com a dica.

type ValoresDosPrazos = z.input<typeof prazosDoAgenteSchema>;
type CampoDoPrazo = keyof ValoresDosPrazos;

/**
 * O aviso de habilidade desligada, com o que esta no formulario agora (a
 * pessoa ve o efeito enquanto digita). Nulo quando os dois estao
 * preenchidos.
 */
export function avisoDosPrazos(valores: {
  cancelarHoras: number | null;
  remarcarHoras: number | null;
}): string | null {
  const semCancelar =
    valores.cancelarHoras === null || Number.isNaN(valores.cancelarHoras);
  const semRemarcar =
    valores.remarcarHoras === null || Number.isNaN(valores.remarcarHoras);
  if (semCancelar && semRemarcar) {
    return T.prazosVazios;
  }
  if (semCancelar) {
    return T.prazoDeCancelarVazio;
  }
  return semRemarcar ? T.prazoDeRemarcarVazio : null;
}

export function CartaoDosPrazos({
  prazos,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  /** Os prazos do rascunho (ou da publicada, sem rascunho). */
  prazos: PrazosDoAgente;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (prazos: PrazosDoAgente, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi digitado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const form = useForm<ValoresDosPrazos, unknown, PrazosDoAgente>({
    resolver: zodResolver(prazosDoAgenteSchema),
    defaultValues: prazos,
  });
  const travado = !podeEditar;
  const cancelar = form.watch("cancelarHoras");
  const remarcar = form.watch("remarcarHoras");
  const erroDoServidor = form.formState.errors.root?.message;
  const naoSalvo = form.formState.isDirty && !travado;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);
  const aviso = avisoDosPrazos({
    cancelarHoras: cancelar,
    remarcarHoras: remarcar,
  });

  const botaoSalvar = (
    <Button
      type="submit"
      variant="solid"
      disabled={travado || pendente}
      aria-busy={salvando || undefined}
    >
      {salvando ? "Salvando..." : T.salvarPrazos}
    </Button>
  );

  const campo = (nome: CampoDoPrazo, rotulo: string) => (
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
              min={PRAZO_DA_IA.minimo}
              max={PRAZO_DA_IA.maximo}
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
          <FormDescription>
            {T.prazoDica(
              PRAZO_DA_IA.minimo,
              PRAZO_DA_IA.maximo,
              ROTULO_DOS_PRAZOS.ajuda,
            )}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Card role="region" aria-labelledby="agente-prazos-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-prazos-titulo">
            {ROTULO_DOS_PRAZOS.titulo}
          </CardTitle>
          <CardDescription>{T.prazosDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            aria-label={ROTULO_DOS_PRAZOS.titulo}
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
              {campo("cancelarHoras", ROTULO_DOS_PRAZOS.cancelarHoras)}
              {campo("remarcarHoras", ROTULO_DOS_PRAZOS.remarcarHoras)}
            </fieldset>

            {aviso ? (
              <Aviso tom="info" role="note">
                {aviso}
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
