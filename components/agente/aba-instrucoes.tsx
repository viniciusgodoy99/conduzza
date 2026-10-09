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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import {
  instrucoesSchema,
  LIMITES_DO_AGENTE,
  problemaNoTextoDoAgente,
  type InstrucoesEntrada,
} from "@/lib/domain/agente/config";

// Aba "Instruções do assistente" da Tela 6: SO o super admin (equipe
// Conduzza) monta esta aba; para os outros papeis ela nem existe, e a
// pagina nao le a coluna (decisao do dono de 06/10/2026). Texto livre de ate
// 2.000 caracteres, gravado no rascunho pela RPC do super admin, e a "Prévia
// do prompt" (somente leitura) que a pagina monta no servidor. As travas do
// CFM nao dependem deste texto: continuam no filtro de saida.

export const instrucoesDaTelaSchema = instrucoesSchema.superRefine(
  (entrada, ctx) => {
    if (entrada.instrucoes === null) {
      return;
    }
    const problema = problemaNoTextoDoAgente(entrada.instrucoes, "instrucoes");
    if (problema !== null) {
      ctx.addIssue({ code: "custom", path: ["instrucoes"], message: problema });
    }
  },
);

type ValoresDasInstrucoes = z.input<typeof instrucoesDaTelaSchema>;

export function AbaInstrucoes({
  instrucoes,
  previa,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  instrucoes: string | null;
  /** Nula: a previa nao carregou. */
  previa: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (entrada: InstrucoesEntrada, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi digitado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const form = useForm<ValoresDasInstrucoes, unknown, InstrucoesEntrada>({
    resolver: zodResolver(instrucoesDaTelaSchema),
    defaultValues: { instrucoes: instrucoes ?? "" },
  });
  const erroDoServidor = form.formState.errors.root?.message;
  const naoSalvo = form.formState.isDirty;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);

  return (
    <div className="grid gap-4">
      <Card role="region" aria-labelledby="agente-instrucoes-titulo">
        <CardHeader>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id="agente-instrucoes-titulo">
              {T.instrucoesTitulo}
            </CardTitle>
            <CardDescription>{T.instrucoesDescricao}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              noValidate
              aria-label={T.instrucoesTitulo}
              className="grid gap-4"
              onSubmit={(evento) =>
                void form.handleSubmit((entrada) =>
                  aoSalvar(entrada, {
                    seDerCerto: () =>
                      form.reset({ instrucoes: entrada.instrucoes ?? "" }),
                    seFalhar: (erro) =>
                      form.setError("root", { message: erro }),
                  }),
                )(evento)
              }
            >
              <Aviso tom="info" role="note">
                {T.instrucoesAviso}
              </Aviso>
              <FormField
                control={form.control}
                name="instrucoes"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-baseline justify-between gap-2">
                      <FormLabel>{T.instrucoesTitulo}</FormLabel>
                      <span
                        className="cz-num text-[11px] text-text-secondary"
                        aria-hidden
                      >
                        {(field.value ?? "").length}/
                        {LIMITES_DO_AGENTE.instrucoes}
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        rows={10}
                        maxLength={LIMITES_DO_AGENTE.instrucoes}
                        className="min-h-[220px] text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {erroDoServidor ? (
                <Aviso tom="alert" role="alert">
                  {erroDoServidor}
                </Aviso>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  variant="solid"
                  disabled={pendente}
                  aria-busy={salvando || undefined}
                >
                  {salvando ? "Salvando..." : "Salvar instruções"}
                </Button>
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

      <Card role="region" aria-labelledby="agente-previa-titulo">
        <CardHeader>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id="agente-previa-titulo">{T.previaTitulo}</CardTitle>
            <CardDescription>{T.previaDescricao}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {previa === null ? (
            <Aviso tom="alert" role="note">
              {T.previaIndisponivel}
            </Aviso>
          ) : (
            <pre
              tabIndex={0}
              aria-label={T.previaTitulo}
              className="cz-scroll max-h-[480px] overflow-auto rounded-xl bg-surface-4 p-3.5 font-mono text-[12px] leading-[1.55] break-words whitespace-pre-wrap text-foreground"
            >
              {previa}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
