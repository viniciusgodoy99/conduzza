"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ACAO_DE_CONVITE,
  conviteRegistrado,
} from "@/components/configuracoes/convite-na-equipe";
import {
  ACTIVE_CLINIC_COOKIE,
  getSessionContext,
} from "@/lib/auth/active-clinic";
import { ROLES, can } from "@/lib/domain/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Server Actions de autenticacao. Toda mutacao valida a entrada com Zod
// (regra do CLAUDE.md); mensagens de erro sao genericas de proposito.

export type ActionState = { error?: string; success?: string };

async function siteOrigin(): Promise<string> {
  const headerStore = await headers();
  return (
    headerStore.get("origin") ??
    `http://${headerStore.get("host") ?? "localhost:3000"}`
  );
}

const credentialsSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(6, "Informe a senha"),
});

/**
 * Estado do login. `emailNaoConfirmado` so vem preenchido quando o GoTrue
 * recusou por falta de confirmacao: a tela mostra o aviso proprio e o botao
 * de reenviar para esse e-mail.
 */
export type LoginState = ActionState & { emailNaoConfirmado?: string };

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Achado 118: "e-mail ou senha incorretos" para quem so nao confirmou o
    // e-mail mandava a pessoa para a recuperacao de senha sem motivo. O
    // GoTrue so devolve email_not_confirmed DEPOIS de validar a senha, entao
    // dizer o motivo nao revela a conta para quem nao sabe a senha.
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "Falta confirmar seu e-mail. Abra o link de confirmação que chegou na sua caixa de entrada ou peça outro abaixo.",
        emailNaoConfirmado: parsed.data.email,
      };
    }
    if (error.code === "over_request_rate_limit" || error.status === 429) {
      return {
        error:
          "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
      };
    }
    // Falha de rede ou do servidor de login nao e senha errada: dizer
    // "incorretos" ali levava a pessoa a trocar uma senha que estava certa.
    if (!error.status || error.status >= 500) {
      return {
        error: "Não foi possível entrar agora. Tente de novo em instantes.",
      };
    }
    return { error: "E-mail ou senha incorretos" };
  }

  // O layout da area logada decide o que mostrar a partir dos vinculos
  // (clinica ativa, escolha entre varias, espera de aprovacao, sem clinica).
  // Concentrar essa decisao num lugar so evita divergencia e laco.
  redirect("/inicio");
}

const reenvioSchema = z.object({ email: z.email("Informe um e-mail válido") });

const REENVIO_FEITO =
  "Se este e-mail tiver um cadastro esperando confirmação, um link novo foi enviado. Se não chegar em alguns minutos, confira a caixa de spam.";

/**
 * Reenvia o e-mail de confirmacao de cadastro (achado 118). A resposta e a
 * mesma exista a conta ou nao, esteja ela confirmada ou nao: esta acao e um
 * endpoint publico e nao pode servir para descobrir quem tem cadastro. Pelo
 * mesmo motivo o limite POR E-MAIL do GoTrue ("so depois de N segundos", que
 * so acontece com conta existente) tambem vira a resposta padrao; so o limite
 * GERAL de envio, que nao depende da conta, ganha texto proprio.
 */
export async function reenviarConfirmacaoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reenvioSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const supabase = await createClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/confirm?next=/inicio` },
  });
  if (error) {
    const mensagem = error.message.toLowerCase();
    const limitePorConta =
      error.code === "over_email_send_rate_limit" &&
      mensagem.includes("security purposes");
    if (limitePorConta || error.code === "user_not_found") {
      return { success: REENVIO_FEITO };
    }
    if (error.status === 429) {
      return {
        error:
          "Muitos e-mails pedidos agora. Espere alguns minutos e peça de novo.",
      };
    }
    return {
      error: "Não foi possível reenviar agora. Tente de novo em instantes.",
    };
  }
  return { success: REENVIO_FEITO };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_CLINIC_COOKIE);
  redirect("/login");
}

const pickClinicSchema = z.object({ clinicId: z.uuid() });

export async function pickClinicAction(formData: FormData): Promise<void> {
  const parsed = pickClinicSchema.safeParse({
    clinicId: formData.get("clinicId"),
  });
  if (!parsed.success) {
    redirect("/selecionar-clinica");
  }
  const context = await getSessionContext();
  // Somente vinculo ATIVO: escolher uma clinica pendente deixaria a pessoa
  // numa tela de espera sem entender por que.
  const membership = context?.memberships.find(
    (m) => m.clinicId === parsed.data.clinicId && m.status === "ativo",
  );
  if (!context || !membership) {
    redirect("/selecionar-clinica");
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLINIC_COOKIE, membership.clinicId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/inicio");
}

const emailSchema = z.object({ email: z.email("Informe um e-mail válido") });

export async function recoverPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const supabase = await createClient();
  const origin = await siteOrigin();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/confirm?next=/redefinir-senha`,
  });
  // Mesma resposta existindo ou nao a conta: nao vazar quem tem cadastro.
  return {
    success:
      "Se este e-mail tiver cadastro, você vai receber um link para redefinir a senha.",
  };
}

const passwordSchema = z.object({
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres"),
});

/**
 * Estado da senha nova. `pedirLinkNovo` marca a falha que so um link novo
 * resolve (sessao do link ausente ou vencida): a tela oferece o atalho para a
 * recuperacao. Senha repetida ou fraca se resolve no proprio campo.
 */
export type SenhaNovaState = ActionState & { pedirLinkNovo?: boolean };

export async function updatePasswordAction(
  _prev: SenhaNovaState,
  formData: FormData,
): Promise<SenhaNovaState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "same_password") {
      return { error: "Escolha uma senha diferente da atual." };
    }
    if (error.code === "weak_password") {
      return {
        error:
          "Senha muito fraca. Use pelo menos 8 caracteres e evite senhas comuns.",
      };
    }
    return {
      error: "Não foi possível salvar a senha. Abra o link do e-mail de novo.",
      pedirLinkNovo: true,
    };
  }
  redirect("/inicio");
}

// Papeis vem da fonte unica em lib/domain/permissions.ts.
const inviteSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  role: z.enum(ROLES),
});

export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." };
  }
  if (can(context.active.role, "configuracoes") !== "tudo") {
    return { error: "Somente administradores e gestores convidam usuários" };
  }
  // Conferido ANTES de qualquer e-mail sair (achados 3 e 124): o gatilho
  // proteger_papel_admin recusa o vinculo, mas so depois de o GoTrue ja ter
  // mandado o convite, e cada nova tentativa mandava outro.
  if (parsed.data.role === "admin" && context.active.role !== "admin") {
    return { error: "Somente um administrador convida outro administrador." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const clinicId = context.active.clinicId;
  const admin = createAdminClient();
  // O vinculo e criado com a sessao de quem convida: a policy de
  // clinic_member e os gatilhos de papel continuam decidindo. O service role
  // fica restrito ao GoTrue e a busca da conta pelo e-mail.
  const supabase = await createClient();

  // Conta que ja existe e esta confirmada (achados 3 e 121): o GoTrue recusa
  // o convite, e nao havia outro caminho para vincular essa conta. O vinculo
  // entra direto, e a pessoa entra com a senha que ja tem e acha a clinica em
  // "Trocar de clinica". Se a busca falhar (por exemplo, a RPC ainda nao
  // existe no banco), segue o convite de sempre.
  // Achados L17/L20: quem convida recebe a MESMA resposta e a trilha grava a
  // MESMA linha que num convite de conta nova. O cadastro e publico, entao
  // qualquer pessoa vira administradora criando uma clinica: dizer "ja tinha
  // conta" transformava este formulario no oraculo de "este e-mail tem
  // cadastro" que a migration 20260925110000 fechou para quem esta logado.
  // A conta que ja existia NAO recebe e-mail: os e-mails do app saem dos
  // modelos do Supabase Auth (cadastro, convite, senha nova), e nenhum deles
  // serve para "voce foi incluido numa clinica" (pendencia registrada).
  const existente = await contaPorEmail(admin, email);
  if (existente?.confirmada) {
    return vincularContaExistente(
      supabase,
      clinicId,
      context.userId,
      existente.userId,
      parsed.data.role,
      email,
    );
  }

  const origin = await siteOrigin();
  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/confirm?next=/convite`,
  });
  if (invited.error || !invited.data.user) {
    // A conta pode ter sido confirmada entre a busca e o convite.
    if (invited.error?.code === "email_exists") {
      const deNovo = await contaPorEmail(admin, email);
      if (deNovo) {
        return vincularContaExistente(
          supabase,
          clinicId,
          context.userId,
          deNovo.userId,
          parsed.data.role,
          email,
        );
      }
    }
    return {
      error:
        "Não foi possível enviar o convite. Confira o e-mail e tente de novo.",
    };
  }

  // Convite por e-mail e nominal: o administrador escolheu a pessoa e o papel,
  // entao o vinculo ja nasce ativo (diferente da entrada por codigo).
  const { error: memberError } = await supabase.from("clinic_member").insert({
    clinic_id: clinicId,
    user_id: invited.data.user.id,
    role: parsed.data.role,
    status: "ativo",
  });
  if (memberError) {
    // 23505: a pessoa ja tem vinculo aqui e ainda nao aceitou o convite. O
    // GoTrue acabou de reenviar o e-mail; o vinculo que existe fica como esta.
    if (memberError.code === "23505") {
      const atual = await vinculoNaClinica(
        supabase,
        clinicId,
        invited.data.user.id,
      );
      await registrarConvite(
        supabase,
        clinicId,
        context.userId,
        invited.data.user.id,
      );
      return { success: mensagemDeConviteReenviado(email, atual) };
    }
    // Mesmo texto da falha no caminho da conta que ja existia: textos
    // diferentes diriam qual dos dois caminhos rodou.
    return { error: recusaDoVinculo(memberError, CONVITE_NAO_CONCLUIDO) };
  }

  await registrarConvite(
    supabase,
    clinicId,
    context.userId,
    invited.data.user.id,
  );
  revalidatePath("/configuracoes");
  return { success: conviteRegistrado(email) };
}

const CONVITE_NAO_CONCLUIDO =
  "Não foi possível concluir o convite. Tente de novo.";

// Trilha do convite (regra 3.1; achados L17/L20): a MESMA linha para conta
// nova e para conta que ja existia, porque administrador e gestor leem a
// trilha. Com a sessao de quem convida: a policy de insert exige
// user_id = auth.uid(), e isso impede forjar trilha alheia. Best-effort, como
// as demais trilhas de acao: o vinculo ja existe, e a tela nao pode dizer que
// o convite falhou. A lista da equipe le estas linhas para saber quem foi
// convidado e ainda nao usou a clinica (configuracoes/page.tsx).
async function registrarConvite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  quemConvidou: string,
  convidado: string,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: quemConvidou,
    action: ACAO_DE_CONVITE,
    entity: "clinic_member",
    entity_id: convidado,
  });
}

type VinculoNaClinica = {
  role: (typeof ROLES)[number];
  status: "ativo" | "pendente" | "inativo";
} | null;

// Busca por RPC security definer executavel so pelo service role
// (migration 20260925110000): dar isso a quem esta logado seria um oraculo de
// "este e-mail tem conta". Erro vira nulo: quem chama segue pelo convite.
async function contaPorEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<{ userId: string; confirmada: boolean } | null> {
  const { data, error } = await admin.rpc("conta_por_email", {
    p_email: email,
  });
  if (error) {
    return null;
  }
  const linha = ((data ?? []) as { user_id: string; confirmada: boolean }[])[0];
  return linha ? { userId: linha.user_id, confirmada: linha.confirmada } : null;
}

async function vinculoNaClinica(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
): Promise<VinculoNaClinica> {
  const { data } = await supabase
    .from("clinic_member")
    .select("role, status")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as VinculoNaClinica) ?? null;
}

// Recusas dos gatilhos de clinic_member ja vem em portugues e explicam o
// motivo; erro de policy vira permissao. O resto cai no texto de quem chama.
function recusaDoVinculo(
  error: { code?: string; message?: string },
  fallback: string,
): string {
  if (error.code === "42501") {
    return "Seu perfil não convida pessoas para esta clínica.";
  }
  const mensagem = error.message ?? "";
  return mensagem.includes("Somente um administrador") ? mensagem : fallback;
}

function mensagemDeConviteReenviado(
  email: string,
  atual: VinculoNaClinica,
): string {
  if (atual?.status === "inativo") {
    return `Convite reenviado para ${email}, mas a pessoa está sem acesso: use Reativar na lista da equipe.`;
  }
  if (atual?.status === "pendente") {
    return `Convite reenviado para ${email}. O pedido de entrada continua aguardando liberação.`;
  }
  return `Convite reenviado para ${email}`;
}

// Conta que ja existe: o vinculo entra ativo com a sessao de quem convida
// (policy e gatilhos valem). A resposta e a trilha sao as do convite de conta
// nova (achados L17/L20): a tela nao confirma que o e-mail tem cadastro. As
// recusas por vinculo repetido so aparecem para quem ja esta na equipe desta
// clinica, que quem convida ja ve na lista.
async function vincularContaExistente(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  quemConvidou: string,
  userId: string,
  role: (typeof ROLES)[number],
  email: string,
): Promise<ActionState> {
  const { error } = await supabase.from("clinic_member").insert({
    clinic_id: clinicId,
    user_id: userId,
    role,
    status: "ativo",
  });
  if (!error) {
    await registrarConvite(supabase, clinicId, quemConvidou, userId);
    revalidatePath("/configuracoes");
    return { success: conviteRegistrado(email) };
  }
  if (error.code === "23505") {
    const atual = await vinculoNaClinica(supabase, clinicId, userId);
    if (atual?.status === "inativo") {
      return {
        error: `${email} está na equipe, sem acesso. Use Reativar na lista da equipe.`,
      };
    }
    if (atual?.status === "pendente") {
      return {
        error: `${email} já pediu entrada pelo código. Libere o pedido no quadro de pedidos.`,
      };
    }
    return { error: `${email} já faz parte da equipe.` };
  }
  return { error: recusaDoVinculo(error, CONVITE_NAO_CONCLUIDO) };
}
