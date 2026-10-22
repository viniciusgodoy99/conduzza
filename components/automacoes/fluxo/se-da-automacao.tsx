"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";

import { SeletorDeEtiqueta } from "@/components/automacoes/seletor-de-etiqueta";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AJUDA_DAS_CONDICOES,
  condicaoEmBranco,
  MAXIMO_DE_CONDICOES,
  OPCOES_DE_COMBINAR,
  OPCOES_DE_CONDICAO,
  type ValoresDaAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type {
  LeituraDasEtiquetas,
  OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";

// O "Se" do dialogo da automacao (onda 4, item 15; decisoes D5, D6 e D9 do
// dono): ate 5 condicoes de etiqueta, "o lead tem" ou "nao tem", juntas por
// uma escolha so (todas ou qualquer uma). Opcional: sem condicao, a regra
// vale para todo lead do Quando, como sempre foi. A etiqueta conta no lead e
// na conversa, pelo nome (D1); o seletor oferece as do catalogo e as em uso
// nos leads, como o "Etiquetar lead".

export function SeDaAutomacao({
  form,
  opcoes,
  leitura,
  desabilitado,
}: {
  form: UseFormReturn<ValoresDaAutomacao>;
  /** As etiquetas para escolher (catalogo e em uso, sem repetir) */
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  desabilitado: boolean;
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "condicoes",
  });
  const cheia = fields.length >= MAXIMO_DE_CONDICOES;

  const botaoAdicionar = (
    <Button
      type="button"
      variant="outline"
      disabled={desabilitado || cheia}
      onClick={() => append(condicaoEmBranco())}
    >
      <Plus aria-hidden />
      Adicionar condição
    </Button>
  );

  return (
    <fieldset className="grid gap-3 rounded-xl border border-border p-3.5">
      <legend className="px-1 text-[13.5px] font-bold text-text-strong">
        Se <span className="font-normal text-text-secondary">(opcional)</span>
      </legend>

      {fields.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          Sem condição, a automação vale para todo lead que bate com o Quando.
        </p>
      ) : (
        <p className="text-xs text-text-secondary">{AJUDA_DAS_CONDICOES}</p>
      )}

      {fields.length >= 2 ? (
        <FormField
          control={form.control}
          name="combinar"
          render={({ field }) => (
            <FormItem className="sm:max-w-[320px]">
              <FormLabel>Como juntar as condições</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {OPCOES_DE_COMBINAR.map((opcao) => (
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
      ) : null}

      {fields.length > 0 ? (
        <ol className="grid gap-2.5">
          {fields.map((item, indice) => (
            <li
              key={item.id}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
            >
              <FormField
                control={form.control}
                name={`condicoes.${indice}.tipo`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">
                      Condição {indice + 1}
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {OPCOES_DE_CONDICAO.map((opcao) => (
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
              <FormField
                control={form.control}
                name={`condicoes.${indice}.etiqueta`}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <SeletorDeEtiqueta
                        modo="trocar"
                        valor={field.value}
                        rotulo={`Etiqueta da condição ${indice + 1}`}
                        opcoes={opcoes}
                        leitura={leitura}
                        desabilitado={desabilitado}
                        aoEscolher={(nome) => {
                          field.onChange(nome);
                          void form.trigger(`condicoes.${indice}.etiqueta`);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={desabilitado}
                aria-label={`Remover a condição ${indice + 1}`}
                onClick={() => remove(indice)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}

      <div>
        {cheia ? (
          <DisabledWithHint
            hint={`Até ${MAXIMO_DE_CONDICOES} condições por automação.`}
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
