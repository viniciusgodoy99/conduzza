"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

// Cadastro self-service. Quem cria clinica ou vincula por codigo e o gatilho
// handle_new_user() no banco, na MESMA transacao do signup: aqui so validamos
// a entrada e empacotamos os metadados. Sem chave de servico, sem estado
// intermediario inconsistente.

export type CadastroState = {
  error?: string;
  success?: string;
  email?: string;
};

const nomeSchema = z.string().trim().min(2, "Informe seu nome");
const senhaSchema = z
  .string()
  .min(8, "A senha precisa de pelo menos 8 caracteres");

const clinicaSchema = z.object({
  nomeClinica: z.string().trim().min(2, "Informe o nome da clínica"),
  nome: nomeSchema,
  email: z.email("Informe um e-mail válido"),
  password: senhaSchema,
});

const codigoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(4, "Informe o código da clínica")
    .max(16, "Código inválido"),
  nome: nomeSchema,
  email: z.email("Informe um e-mail válido"),
  password: senhaSchema,
});

function traduzirErro(mensagem: string): string {
  const texto = mensagem.toLowerCase();
  if (
    texto.includes("already registered") ||
    texto.includes("already been registered")
  ) {
    return "Este e-mail já tem cadastro. Tente entrar ou recuperar a senha.";
  }
  if (texto.includes("código da clínica inválido")) {
    return "Código da clínica inválido ou desativado. Confira com quem te passou.";
  }
  if (texto.includes("nome da clínica")) {
    return "Informe o nome da clínica.";
  }
  if (texto.includes("rate limit") || texto.includes("too many")) {
    return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  }
  if (texto.includes("password")) {
    return "Senha muito fraca. Use pelo menos 8 caracteres.";
  }
  return "Não foi possível concluir o cadastro. Tente de novo em instantes.";
}

export async function conferirCodigoAction(
  codigo: string,
): Promise<{ nome: string } | null> {
  const parsed = codigoSchema.shape.codigo.safeParse(codigo);
  if (!parsed.success) {
    return null;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("validar_codigo_clinica", {
    p_codigo: parsed.data,
  });
  const resultado = data as { nome?: string } | null;
  return resultado?.nome ? { nome: resultado.nome } : null;
}

export async function cadastrarClinicaAction(
  _prev: CadastroState,
  formData: FormData,
): Promise<CadastroState> {
  const parsed = clinicaSchema.safeParse({
    nomeClinica: formData.get("nomeClinica"),
    nome: formData.get("nome"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        tipo: "clinica",
        nome: parsed.data.nome,
        nome_clinica: parsed.data.nomeClinica,
        name: parsed.data.nome,
      },
    },
  });
  if (error) {
    return { error: traduzirErro(error.message) };
  }
  return { success: "clinica", email: parsed.data.email };
}

export async function cadastrarPorCodigoAction(
  _prev: CadastroState,
  formData: FormData,
): Promise<CadastroState> {
  const parsed = codigoSchema.safeParse({
    codigo: formData.get("codigo"),
    nome: formData.get("nome"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        tipo: "codigo",
        nome: parsed.data.nome,
        codigo: parsed.data.codigo.toUpperCase(),
        name: parsed.data.nome,
      },
    },
  });
  if (error) {
    return { error: traduzirErro(error.message) };
  }
  return { success: "codigo", email: parsed.data.email };
}
