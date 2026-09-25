"use server";

import { headers } from "next/headers";
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

// Destino do link de confirmacao quando o modelo de e-mail usa o endereco
// que o app manda (o modelo versionado em supabase/templates usa o Site URL
// e ja aponta para /confirm; isto cobre o modelo padrao do Supabase).
async function destinoDaConfirmacao(): Promise<string> {
  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ??
    `http://${headerStore.get("host") ?? "localhost:3000"}`;
  return `${origin}/confirm?next=/inicio`;
}

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

const CODIGO_INVALIDO =
  "Código da clínica inválido ou desativado. Confira com quem te passou.";

// O GoTrue embrulha QUALQUER excecao do gatilho handle_new_user num 500
// generico ("Database error saving new user") e nao repassa a mensagem do
// gatilho (achado 128). No caminho do codigo, a unica recusa do gatilho que a
// pessoa consegue causar e o codigo ter sido desligado ou trocado entre a
// conferencia e o envio: ali a orientacao e conferir o codigo, porque tentar
// de novo com o mesmo codigo nunca resolve. No caminho de criar clinica esse
// erro nao significa nada que a pessoa possa corrigir.
function traduzirErro(mensagem: string, caminho: "clinica" | "codigo"): string {
  const texto = mensagem.toLowerCase();
  if (
    texto.includes("already registered") ||
    texto.includes("already been registered")
  ) {
    return "Este e-mail já tem cadastro. Tente entrar ou recuperar a senha.";
  }
  if (texto.includes("database error saving new user")) {
    return caminho === "codigo"
      ? "Não foi possível usar esse código. Confira com a clínica se ele continua ativo e se foi digitado certo."
      : "Não foi possível concluir o cadastro. Tente de novo em instantes.";
  }
  if (texto.includes("rate limit") || texto.includes("too many")) {
    return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  }
  if (texto.includes("password")) {
    return "Senha muito fraca. Use pelo menos 8 caracteres.";
  }
  return "Não foi possível concluir o cadastro. Tente de novo em instantes.";
}

export type ConferenciaDoCodigo =
  | { situacao: "encontrado"; nome: string }
  | { situacao: "nao_encontrado" }
  | { situacao: "falhou" };

export async function conferirCodigoAction(
  codigo: string,
): Promise<ConferenciaDoCodigo> {
  const parsed = codigoSchema.shape.codigo.safeParse(codigo);
  if (!parsed.success) {
    return { situacao: "nao_encontrado" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validar_codigo_clinica", {
    p_codigo: parsed.data,
  });
  // Erro do banco nao e codigo invalido: a tela deixa seguir e o cadastro
  // confere de novo. Antes o erro virava "Código não encontrado" e travava o
  // botao sem motivo.
  if (error) {
    return { situacao: "falhou" };
  }
  const resultado = data as { nome?: string } | null;
  return resultado?.nome
    ? { situacao: "encontrado", nome: resultado.nome }
    : { situacao: "nao_encontrado" };
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
      emailRedirectTo: await destinoDaConfirmacao(),
      data: {
        tipo: "clinica",
        nome: parsed.data.nome,
        nome_clinica: parsed.data.nomeClinica,
        name: parsed.data.nome,
      },
    },
  });
  if (error) {
    return { error: traduzirErro(error.message, "clinica") };
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

  const codigo = parsed.data.codigo.toUpperCase();
  const supabase = await createClient();

  // Achado 128: a tela deixa seguir quando a conferencia falha por rede, e o
  // codigo pode ser desligado ou trocado depois da conferencia. Conferir de
  // novo aqui, antes do signUp, da a mensagem certa em vez do erro generico
  // do GoTrue. Se a propria conferencia falhar, o gatilho do banco decide.
  const { data: conferencia, error: erroDaConferencia } = await supabase.rpc(
    "validar_codigo_clinica",
    { p_codigo: codigo },
  );
  if (!erroDaConferencia && conferencia === null) {
    return { error: CODIGO_INVALIDO };
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: await destinoDaConfirmacao(),
      data: {
        tipo: "codigo",
        nome: parsed.data.nome,
        codigo,
        name: parsed.data.nome,
      },
    },
  });
  if (error) {
    return { error: traduzirErro(error.message, "codigo") };
  }
  return { success: "codigo", email: parsed.data.email };
}
