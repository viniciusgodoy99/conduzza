"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { atualizarPacienteAction } from "@/app/(app)/pacientes/actions";
import { BlocoFicha } from "@/components/pacientes/comum";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
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
import { normalizarTelefone } from "@/lib/domain/importacao";
import type { ContatoDaFicha } from "@/lib/queries/pacientes";

// Cadastro do paciente, o unico bloco editavel da ficha. O telefone aceita os
// formatos brasileiros comuns e vira E.164 na validacao (normalizarTelefone, o
// mesmo da importacao); CPF guarda so digito. As observacoes sao recado de
// recepcao, NAO prontuario: a spec corta prontuario de proposito, porque puxa
// responsabilidade de guarda e certificacao.

const PARTICULAR = "__particular__";

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .max(120)
    .refine((valor) => valor === "" || valor.length >= 2, {
      message: "O nome precisa de pelo menos 2 letras, ou deixe em branco.",
    }),
  telefone: z.string().refine((valor) => normalizarTelefone(valor) !== null, {
    message: "Informe um telefone com DDD, por exemplo (85) 99999-0000.",
  }),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((valor) => valor === "" || z.email().safeParse(valor).success, {
      message: "Informe um e-mail válido ou deixe em branco.",
    }),
  cpf: z
    .string()
    .trim()
    .refine((valor) => valor === "" || valor.replace(/\D/g, "").length === 11, {
      message: "O CPF tem 11 dígitos.",
    }),
  birth_date: z
    .string()
    .refine((valor) => valor === "" || /^\d{4}-\d{2}-\d{2}$/.test(valor), {
      message: "Informe a data de nascimento no formato dd/mm/aaaa.",
    }),
  insurance_id: z.string(),
  insurance_card: z.string().trim().max(60),
  notes: z.string().trim().max(2000),
});

type ValoresDoFormulario = z.infer<typeof formSchema>;

function valoresIniciais(contato: ContatoDaFicha): ValoresDoFormulario {
  return {
    name: contato.name ?? "",
    telefone: contato.phone_e164,
    email: contato.email ?? "",
    cpf: contato.cpf ?? "",
    birth_date: contato.birth_date ?? "",
    insurance_id: contato.insurance?.id ?? PARTICULAR,
    insurance_card: contato.insurance_card ?? "",
    notes: contato.notes ?? "",
  };
}

export function DadosCadastrais({
  contato,
  convenios,
  podeEditar,
  dica,
}: {
  contato: ContatoDaFicha;
  convenios: { id: string; name: string }[];
  podeEditar: boolean;
  dica: string;
}) {
  const router = useRouter();
  const form = useForm<ValoresDoFormulario>({
    resolver: zodResolver(formSchema),
    defaultValues: valoresIniciais(contato),
  });

  const salvar = async (valores: ValoresDoFormulario) => {
    const resultado = await atualizarPacienteAction({
      contact_id: contato.id,
      name: valores.name || null,
      phone_e164: normalizarTelefone(valores.telefone),
      email: valores.email || null,
      cpf: valores.cpf ? valores.cpf.replace(/\D/g, "") : null,
      birth_date: valores.birth_date || null,
      insurance_id:
        valores.insurance_id === PARTICULAR ? null : valores.insurance_id,
      insurance_card: valores.insurance_card || null,
      notes: valores.notes || null,
    });
    if (!resultado.ok) {
      form.setError("root", {
        message: resultado.error ?? "Não foi possível salvar o cadastro.",
      });
      return;
    }
    toast.success("Cadastro atualizado");
    form.reset(valores);
    // A ficha e renderizada no servidor (a leitura de dado de paciente deixa
    // rastro la). Depois de salvar, quem recarrega e o servidor.
    router.refresh();
  };

  const salvando = form.formState.isSubmitting;
  const erroGeral = form.formState.errors.root?.message;

  return (
    <BlocoFicha titulo="Cadastro">
      <Form {...form}>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit((valores) => void salvar(valores))}
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="h-10"
                    maxLength={120}
                    disabled={!podeEditar}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="telefone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="h-10 font-mono"
                    inputMode="tel"
                    placeholder="(85) 99999-0000"
                    disabled={!podeEditar}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    className="h-10"
                    maxLength={160}
                    disabled={!podeEditar}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="cpf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPF</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="h-10 font-mono"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      maxLength={14}
                      disabled={!podeEditar}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="birth_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de nascimento</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="date"
                      className="h-10"
                      disabled={!podeEditar}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="insurance_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Convênio</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!podeEditar}
                >
                  <FormControl>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="Particular" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={PARTICULAR}>Particular</SelectItem>
                    {convenios.map((convenio) => (
                      <SelectItem key={convenio.id} value={convenio.id}>
                        {convenio.name}
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
            name="insurance_card"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Carteirinha</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="h-10 font-mono"
                    maxLength={60}
                    disabled={!podeEditar}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Observações</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={3}
                    maxLength={2000}
                    placeholder="Recado da recepção, como preferência de horário ou de profissional."
                    disabled={!podeEditar}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {erroGeral ? (
            <p role="alert" className="text-sm [color:var(--alert-text)]">
              {erroGeral}
            </p>
          ) : null}
          {podeEditar ? (
            <Button type="submit" className="h-10 w-fit" disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar cadastro"}
            </Button>
          ) : (
            <DisabledWithHint hint={dica}>
              <Button type="button" className="h-10 w-fit" disabled>
                Salvar cadastro
              </Button>
            </DisabledWithHint>
          )}
        </form>
      </Form>
    </BlocoFicha>
  );
}
