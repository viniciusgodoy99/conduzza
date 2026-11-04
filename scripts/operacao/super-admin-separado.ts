import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// O super admin numa conta so para o painel (decisao do dono de 03/11/2026,
// "Conta propria so para o painel"). Roteiro completo, com a ordem e o que
// conferir: supabase/operacao/super-admin-separado.md.
//
//   npx tsx scripts/operacao/super-admin-separado.ts conferir
//   npx tsx scripts/operacao/super-admin-separado.ts criar --email <e-mail> --nome "<nome>" --app <endereco do app> [--confirmar]
//   npx tsx scripts/operacao/super-admin-separado.ts limpar --antiga <e-mail> [--antiga <e-mail>] --nova <e-mail> [--confirmar]
//
// SEM --confirmar, nada e gravado: o script le, confere e diz o que faria.
// Os e-mails vem do dono; o script nao tem nenhum e-mail fixo.
//
// conferir  so le: os super admins (product_admin) com o e-mail, o ultimo
//           login e os vinculos de cada um, e as contas marcadas como equipe
//           Conduzza (equipe_conduzza, que so existe depois da migration
//           20261103110000).
// criar     a conta do painel: criada pela API de administracao (service
//           role), confirmada e SEM senha; a linha em product_admin; e o
//           e-mail de "redefinir senha", para a pessoa criar a dela (o link
//           leva a /confirm?next=/redefinir-senha do --app). Conta que ja
//           existe com o e-mail serve so se nao tiver linha em clinica
//           nenhuma (nem pendente, nem com o acesso tirado).
// limpar    DEPOIS que a conta nova funciona (ela e super admin, sem
//           vinculo, e ja entrou pelo menos uma vez): cada conta antiga e
//           marcada em equipe_conduzza (marcado_por = a conta nova) e SO
//           ENTAO sai de product_admin. A conta antiga continua membro das
//           clinicas, como conta normal, e o uso dela continua contando
//           marcado no Painel geral. Exige a migration 20261103110000.
//
// Precisa de NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY, lidos do ambiente ou do .env.local. Nenhum dado
// de paciente e lido nem impresso; os e-mails impressos sao das contas da
// equipe Conduzza.

type Conta = {
  userId: string;
  email: string;
  confirmada: boolean;
  ultimoLogin: string | null;
};

type Vinculo = { clinicId: string; papel: string; situacao: string };

type Situacao = {
  conta: Conta;
  superAdmin: boolean;
  /** null: equipe_conduzza nao existe (a migration nao foi aplicada). */
  marcada: boolean | null;
  vinculos: Vinculo[];
};

const emailSchema = z.email();

function carregarEnvLocal(): void {
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) {
    return;
  }
  for (const linha of readFileSync(caminho, "utf-8").split("\n")) {
    const achou = linha.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (achou?.[1] && achou[2] && process.env[achou[1]] === undefined) {
      process.env[achou[1]] = achou[2].trim();
    }
  }
}

function clientes(): { admin: SupabaseClient; publico: SupabaseClient } {
  carregarEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !servico) {
    throw new Error(
      "Preencha NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    admin: createClient(url, servico, opcoes),
    publico: createClient(url, anon, opcoes),
  };
}

/** Os valores de uma opcao repetivel (--antiga a --antiga b). */
export function valoresDe(args: readonly string[], nome: string): string[] {
  const valores: string[] = [];
  args.forEach((arg, indice) => {
    const valor = args[indice + 1];
    if (arg === nome && valor !== undefined && !valor.startsWith("--")) {
      valores.push(valor.trim());
    }
  });
  return valores;
}

export function valorDe(args: readonly string[], nome: string): string | null {
  return valoresDe(args, nome)[0] ?? null;
}

/** E-mail valido, em minusculas; null quando nao e e-mail. */
export function emailNormalizado(valor: string | null): string | null {
  if (!valor) {
    return null;
  }
  const email = valor.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

/**
 * O endereco do app em producao, de onde sai o link de redefinir senha: so
 * https (ou http no localhost), sem caminho.
 */
export function enderecoDoApp(valor: string | null): string | null {
  if (!valor) {
    return null;
  }
  try {
    const url = new URL(valor.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * O que impede a conta de virar a conta do painel (null: pode). A conta do
 * painel nao e membro de clinica nenhuma: nem ativa, nem pendente, nem com o
 * acesso tirado (o gatilho impedir_super_admin_com_vinculo recusa o mesmo).
 */
export function recusaDaContaNova(situacao: Situacao | null): string | null {
  if (!situacao) {
    return null;
  }
  if (situacao.vinculos.length > 0) {
    return `${situacao.conta.email} tem ${situacao.vinculos.length} vínculo(s) com clínica. A conta do painel não entra em clínica: use outro e-mail.`;
  }
  return null;
}

/**
 * O que impede a limpeza (null: pode). A conta nova precisa ja funcionar:
 * super admin, sem vinculo e com pelo menos um login. Cada antiga e outra
 * conta, ja super admin (ou ja limpa: so marcada).
 */
export function recusaDaLimpeza(
  nova: Situacao | null,
  antigas: readonly (Situacao | null)[],
  emailsAntigos: readonly string[],
): string | null {
  if (!nova) {
    return "A conta nova não existe. Rode o passo criar antes.";
  }
  if (nova.marcada === null) {
    return "A tabela equipe_conduzza não existe: aplique a migration 20261103110000 antes de limpar.";
  }
  if (!nova.superAdmin) {
    return `${nova.conta.email} não é super admin. Rode o passo criar antes.`;
  }
  if (nova.vinculos.length > 0) {
    return `${nova.conta.email} tem vínculo com clínica: não é a conta do painel.`;
  }
  if (!nova.conta.ultimoLogin) {
    return `${nova.conta.email} ainda não entrou nenhuma vez. Entre com ela no Painel geral antes de limpar as contas antigas.`;
  }
  for (const [indice, antiga] of antigas.entries()) {
    const email = emailsAntigos[indice] ?? "";
    if (!antiga) {
      return `Nenhuma conta com o e-mail ${email}.`;
    }
    if (antiga.conta.userId === nova.conta.userId) {
      return "A conta nova não pode ser também uma conta antiga.";
    }
    if (!antiga.superAdmin && !antiga.marcada) {
      return `${antiga.conta.email} não é super admin nem está marcada como equipe Conduzza: não é uma conta antiga.`;
    }
  }
  return null;
}

async function contaPorEmail(
  admin: SupabaseClient,
  email: string,
): Promise<Conta | null> {
  const { data, error } = await admin.rpc("conta_por_email", {
    p_email: email,
  });
  if (error) {
    throw new Error(`conta_por_email: ${error.message}`);
  }
  const linha = ((data ?? []) as { user_id: string; confirmada: boolean }[])[0];
  if (!linha) {
    return null;
  }
  const { data: usuario, error: erroUsuario } =
    await admin.auth.admin.getUserById(linha.user_id);
  if (erroUsuario || !usuario.user) {
    throw new Error(
      `ler a conta ${email}: ${erroUsuario?.message ?? "sem conta"}`,
    );
  }
  return {
    userId: linha.user_id,
    email: usuario.user.email ?? email,
    confirmada: linha.confirmada,
    ultimoLogin: usuario.user.last_sign_in_at ?? null,
  };
}

async function situacaoDa(
  admin: SupabaseClient,
  conta: Conta,
): Promise<Situacao> {
  const [
    { data: superAdmin, error: erroSuperAdmin },
    { data: vinculos, error: erroVinculos },
    marcada,
  ] = await Promise.all([
    admin
      .from("product_admin")
      .select("user_id")
      .eq("user_id", conta.userId)
      .maybeSingle(),
    admin
      .from("clinic_member")
      .select("clinic_id, role, status")
      .eq("user_id", conta.userId),
    estaMarcada(admin, conta.userId),
  ]);
  if (erroSuperAdmin || erroVinculos) {
    throw new Error(
      `ler a situação de ${conta.email}: ${(erroSuperAdmin ?? erroVinculos)?.message}`,
    );
  }
  return {
    conta,
    superAdmin: superAdmin !== null,
    marcada,
    vinculos: (
      (vinculos ?? []) as { clinic_id: string; role: string; status: string }[]
    ).map((v) => ({
      clinicId: v.clinic_id,
      papel: v.role,
      situacao: v.status,
    })),
  };
}

/** null: a tabela equipe_conduzza nao existe (a migration nao foi aplicada). */
async function estaMarcada(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("equipe_conduzza")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return null;
    }
    throw new Error(`ler equipe_conduzza: ${error.message}`);
  }
  return data !== null;
}

async function situacaoPorEmail(
  admin: SupabaseClient,
  email: string,
): Promise<Situacao | null> {
  const conta = await contaPorEmail(admin, email);
  return conta ? situacaoDa(admin, conta) : null;
}

function descrever(situacao: Situacao): string {
  const vinculos =
    situacao.vinculos.length === 0
      ? "sem vínculo com clínica"
      : situacao.vinculos
          .map((v) => `${v.clinicId} (${v.papel}, ${v.situacao})`)
          .join("; ");
  const marca =
    situacao.marcada === null
      ? "equipe_conduzza ainda não existe"
      : situacao.marcada
        ? "marcada como equipe Conduzza"
        : "sem a marca de equipe Conduzza";
  return [
    `  ${situacao.conta.email}`,
    `    super admin: ${situacao.superAdmin ? "sim" : "não"}; ${marca}`,
    `    último login: ${situacao.conta.ultimoLogin ?? "nunca entrou"}; e-mail confirmado: ${situacao.conta.confirmada ? "sim" : "não"}`,
    `    vínculos: ${vinculos}`,
  ].join("\n");
}

async function conferir(admin: SupabaseClient): Promise<void> {
  const { data: superAdmins, error } = await admin
    .from("product_admin")
    .select("user_id, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`ler product_admin: ${error.message}`);
  }
  console.log(`Super admins (${superAdmins?.length ?? 0}):`);
  for (const linha of (superAdmins ?? []) as { user_id: string }[]) {
    const { data: usuario } = await admin.auth.admin.getUserById(linha.user_id);
    const conta: Conta = {
      userId: linha.user_id,
      email: usuario.user?.email ?? linha.user_id,
      confirmada: Boolean(usuario.user?.email_confirmed_at),
      ultimoLogin: usuario.user?.last_sign_in_at ?? null,
    };
    console.log(descrever(await situacaoDa(admin, conta)));
  }
  const { data: marcadas, error: erroMarcadas } = await admin
    .from("equipe_conduzza")
    .select("user_id, entrou_em, marcado_por");
  if (erroMarcadas) {
    console.log(
      "\nequipe_conduzza: não existe (a migration 20261103110000 não foi aplicada).",
    );
    return;
  }
  console.log(`\nMarcadas como equipe Conduzza (${marcadas?.length ?? 0}):`);
  for (const linha of (marcadas ?? []) as {
    user_id: string;
    entrou_em: string;
  }[]) {
    const { data: usuario } = await admin.auth.admin.getUserById(linha.user_id);
    console.log(
      `  ${usuario.user?.email ?? linha.user_id} (desde ${linha.entrou_em})`,
    );
  }
}

async function criar(
  admin: SupabaseClient,
  publico: SupabaseClient,
  args: readonly string[],
  confirmar: boolean,
): Promise<void> {
  const email = emailNormalizado(valorDe(args, "--email"));
  const nome = valorDe(args, "--nome");
  const app = enderecoDoApp(valorDe(args, "--app"));
  if (!email || !nome || !app) {
    throw new Error(
      'Uso: criar --email <e-mail da conta do painel> --nome "<nome>" --app <endereço do app, https> [--confirmar]',
    );
  }

  const antes = await situacaoPorEmail(admin, email);
  const recusa = recusaDaContaNova(antes);
  if (recusa) {
    throw new Error(recusa);
  }
  if (antes) {
    console.log("A conta já existe e não tem vínculo com clínica:");
    console.log(descrever(antes));
  }
  const destino = `${app}/confirm?next=/redefinir-senha`;
  console.log(
    [
      "\nO que este passo faz:",
      antes
        ? "  1. usa a conta que já existe (nenhuma conta nova);"
        : `  1. cria a conta ${email}, confirmada e sem senha, com o nome "${nome}";`,
      antes?.superAdmin
        ? "  2. a conta já é super admin (nada a gravar em product_admin);"
        : "  2. grava a linha dela em product_admin;",
      `  3. manda o e-mail de redefinir senha para ${email}, com o link para ${destino}.`,
    ].join("\n"),
  );
  if (!confirmar) {
    console.log("\nSimulação: nada foi gravado. Rode de novo com --confirmar.");
    return;
  }

  let userId = antes?.conta.userId ?? null;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: nome },
    });
    if (error || !data.user) {
      throw new Error(`criar a conta: ${error?.message ?? "sem conta"}`);
    }
    userId = data.user.id;
    console.log(`  ✔ conta criada: ${email}`);
  }

  const depois = await situacaoPorEmail(admin, email);
  if (!depois || depois.vinculos.length > 0) {
    throw new Error(
      `${email} ganhou vínculo com clínica ao nascer. Nada foi gravado em product_admin: confira a conta antes de seguir.`,
    );
  }
  if (!depois.superAdmin) {
    const { error } = await admin
      .from("product_admin")
      .insert({ user_id: userId });
    if (error) {
      throw new Error(
        error.code === "CZSA2"
          ? `${email} tem vínculo com clínica e não vira super admin (o banco recusou).`
          : `gravar product_admin: ${error.message}`,
      );
    }
    console.log("  ✔ linha gravada em product_admin");
  }

  const { error: erroLink } = await publico.auth.resetPasswordForEmail(email, {
    redirectTo: destino,
  });
  if (erroLink) {
    throw new Error(
      `A conta está pronta, mas o e-mail de redefinir senha não saiu (${erroLink.message}). Peça de novo pela tela "Esqueci minha senha" do app.`,
    );
  }
  console.log(`  ✔ e-mail de redefinir senha enviado para ${email}`);
  console.log(
    "\nPróximo: a pessoa abre o e-mail, cria a senha e entra; ela cai direto no Painel geral. Depois disso, o passo limpar.",
  );
}

async function limpar(
  admin: SupabaseClient,
  args: readonly string[],
  confirmar: boolean,
): Promise<void> {
  const emailNovo = emailNormalizado(valorDe(args, "--nova"));
  const emailsAntigos = valoresDe(args, "--antiga").map(emailNormalizado);
  if (
    !emailNovo ||
    emailsAntigos.length === 0 ||
    emailsAntigos.some((e) => e === null)
  ) {
    throw new Error(
      "Uso: limpar --antiga <e-mail> [--antiga <e-mail>] --nova <e-mail da conta do painel> [--confirmar]",
    );
  }
  const antigosValidos = emailsAntigos.filter((e): e is string => e !== null);

  const nova = await situacaoPorEmail(admin, emailNovo);
  const antigas = await Promise.all(
    antigosValidos.map((email) => situacaoPorEmail(admin, email)),
  );
  const recusa = recusaDaLimpeza(nova, antigas, antigosValidos);
  if (recusa || !nova) {
    throw new Error(recusa ?? "A conta nova não existe.");
  }

  console.log("A conta nova (fica super admin):");
  console.log(descrever(nova));
  console.log("\nAs contas antigas (saem de product_admin, ficam marcadas):");
  for (const antiga of antigas) {
    if (antiga) {
      console.log(descrever(antiga));
    }
  }
  if (!confirmar) {
    console.log("\nSimulação: nada foi gravado. Rode de novo com --confirmar.");
    return;
  }

  for (const antiga of antigas) {
    if (!antiga) {
      continue;
    }
    // A marca PRIMEIRO, depois a saida de product_admin: o painel nunca
    // mostra o uso da conta antiga como uso do cliente.
    if (!antiga.marcada) {
      const { error } = await admin.from("equipe_conduzza").insert({
        user_id: antiga.conta.userId,
        marcado_por: nova.conta.userId,
      });
      if (error && error.code !== "23505") {
        throw new Error(
          `marcar ${antiga.conta.email}: ${error.message}. Nada mais foi feito com esta conta.`,
        );
      }
      console.log(`  ✔ ${antiga.conta.email} marcada como equipe Conduzza`);
    }
    if (antiga.superAdmin) {
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", antiga.conta.userId);
      if (error) {
        throw new Error(
          `tirar ${antiga.conta.email} de product_admin: ${error.message}. Ela continua marcada; rode de novo.`,
        );
      }
      console.log(`  ✔ ${antiga.conta.email} deixou de ser super admin`);
    }
    const depois = await situacaoDa(admin, antiga.conta);
    if (depois.superAdmin || !depois.marcada) {
      throw new Error(
        `${antiga.conta.email} não ficou como devia (super admin: ${depois.superAdmin}, marcada: ${depois.marcada}). Confira com o passo conferir.`,
      );
    }
  }
  console.log(
    "\nPronto. As contas antigas continuam nas clínicas como contas normais; o Painel geral sai do menu delas na próxima tela. A conta do painel é a única super admin.",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const passo = args[0];
  const confirmar = args.includes("--confirmar");
  const { admin, publico } = clientes();
  if (passo === "conferir" || passo === undefined) {
    await conferir(admin);
    return;
  }
  if (passo === "criar") {
    await criar(admin, publico, args, confirmar);
    return;
  }
  if (passo === "limpar") {
    await limpar(admin, args, confirmar);
    return;
  }
  throw new Error(
    `Passo desconhecido: ${passo}. Use conferir, criar ou limpar.`,
  );
}

// So roda quando chamado como script (os testes de unidade importam as
// funcoes puras sem disparar nada).
if (process.argv[1]?.endsWith("super-admin-separado.ts")) {
  main().catch((erro: unknown) => {
    console.error(
      `\nParou: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    process.exit(1);
  });
}
