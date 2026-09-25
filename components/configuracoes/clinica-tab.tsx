"use client";

import { TZDate } from "@date-fns/tz";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { salvarDadosDaClinicaAction } from "@/app/(app)/configuracoes/actions";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  dadosDaClinicaSchema,
  ehFusoDoBrasil,
  FUSOS_DO_BRASIL,
  type DadosDaClinica,
} from "./dados-da-clinica";

// Aba "Clinica" (achado 123, antecipada da tarefa 5.3 so com nome e fuso).
// O nome digitado no cadastro vai literalmente para as mensagens ao paciente
// ({{clinica}}), e o fuso nascia America/Fortaleza sem tela para corrigir.
// So o administrador altera; o gestor ve os campos desabilitados, com dica.

const DICA_SO_ADMIN =
  "Somente o administrador altera o nome e o fuso da clínica";

/**
 * "UTC-3" a partir do fuso, calculado na hora (nao fica escrito na lista, para
 * nao mentir se o horario de verao voltar). Hifen, nunca travessao.
 */
function deslocamento(timezone: string, agora: number): string {
  const partes = /^([+-])(\d{2}):(\d{2})$/.exec(
    format(new TZDate(agora, timezone), "xxx"),
  );
  if (!partes) {
    return "UTC";
  }
  const [, sinal, horas, minutos] = partes;
  const extra = minutos === "00" ? "" : `:${minutos}`;
  return `UTC${sinal}${Number(horas)}${extra}`;
}

export function ClinicaTab({
  nome,
  timezone,
  podeEditar,
}: {
  nome: string;
  timezone: string;
  /** so o administrador (policy "admin da clinica edita a clinica") */
  podeEditar: boolean;
}) {
  const form = useForm<DadosDaClinica>({
    resolver: zodResolver(dadosDaClinicaSchema),
    defaultValues: {
      nome,
      // Fuso fora da lista (gravado antes desta tela) fica sem escolha: o
      // Zod pede um da lista antes de salvar.
      ...(ehFusoDoBrasil(timezone) ? { timezone } : {}),
    },
  });

  // Referencia fixa para o deslocamento: nao muda entre renderizacoes.
  const [agora] = useState(() => Date.now());
  const fusoEscolhido = form.watch("timezone");
  const mudouFuso = Boolean(fusoEscolhido) && fusoEscolhido !== timezone;
  const salvando = form.formState.isSubmitting;
  const erroGeral = form.formState.errors.root?.message;

  const salvar = async (valores: DadosDaClinica) => {
    const resultado = await salvarDadosDaClinicaAction(valores);
    if (!resultado.ok) {
      form.setError("root", {
        message: resultado.error ?? "Não foi possível salvar os dados.",
      });
      return;
    }
    toast.success("Dados da clínica salvos");
    form.reset({ nome: valores.nome.trim(), timezone: valores.timezone });
  };

  const botaoSalvar = (
    <Button
      type="submit"
      disabled={!podeEditar || salvando || !form.formState.isDirty}
    >
      <Check className="size-4" />
      {salvando ? "Salvando..." : "Salvar"}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da clínica</CardTitle>
        <CardDescription>
          Como a clínica aparece para a equipe e para os pacientes, e em que
          horário ela funciona.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form
          noValidate
          onSubmit={(evento) => void form.handleSubmit(salvar)(evento)}
        >
          <CardContent className="grid max-w-[640px] gap-5">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da clínica</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={80}
                      autoComplete="organization"
                      disabled={!podeEditar}
                    />
                  </FormControl>
                  <FormDescription>
                    É o nome que o paciente lê nas mensagens automáticas
                    (confirmação, lista de espera e as demais) e o que aparece
                    no topo do sistema.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fuso horário</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    disabled={!podeEditar}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Escolha o fuso da clínica" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {FUSOS_DO_BRASIL.map((fuso) => (
                        <SelectItem key={fuso.valor} value={fuso.valor}>
                          {fuso.rotulo}{" "}
                          <span className="cz-num text-text-secondary">
                            ({deslocamento(fuso.valor, agora)})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Define a hora das mensagens automáticas, a linha de agora da
                    Agenda e o que conta como hoje e amanhã.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mudouFuso ? (
              <Aviso tom="warning" titulo="Antes de mudar o fuso">
                As consultas já marcadas continuam no mesmo instante e passam a
                aparecer no horário do fuso novo. Se o fuso estava errado,
                confira na Agenda os horários marcados até hoje.
              </Aviso>
            ) : null}

            {erroGeral ? (
              <Aviso tom="alert" role="alert">
                {erroGeral}
              </Aviso>
            ) : null}
          </CardContent>
          <CardFooter className="justify-end">
            {podeEditar ? (
              botaoSalvar
            ) : (
              <DisabledWithHint hint={DICA_SO_ADMIN}>
                {botaoSalvar}
              </DisabledWithHint>
            )}
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
