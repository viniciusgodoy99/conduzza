import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Labels } from "@/lib/branding/labels";
import type { Role } from "@/lib/domain/permissions";
import { lerMinhasMarcas } from "@/lib/queries/implementadores";

// Contexto de sessao e clinica ativa da area logada.
// O cookie e SO conveniencia de selecao: toda leitura e validada contra
// clinic_member na hora, e a barreira real continua sendo a RLS no banco.

export const ACTIVE_CLINIC_COOKIE = "conduzza-clinica-ativa";

export type Membership = {
  clinicId: string;
  clinicName: string;
  slug: string;
  /** fuso IANA da clinica; toda logica de agenda converte por ele */
  timezone: string;
  role: Role;
  /**
   * Administrador com a marca de Implementador nesta clinica (onda 5, item
   * 18): role continua 'admin' (ele ve e faz tudo como o administrador) e a
   * marca so muda o rotulo e as travas de equipe. Lida numa consulta
   * propria e tolerante: se a leitura falhar, fica false (o rotulo cai em
   * "Administrador") e a sessao segue.
   */
  implementador: boolean;
  /**
   * pendente = entrou por codigo e aguarda aprovacao; nao le dado de paciente.
   * suspensa = vinculo ativo numa clinica com a conta suspensa pela equipe
   * Conduzza (onda 1, decisao do dono de 20/10/2026): a RLS ja nega tudo e
   * o vinculo nunca vira clinica ativa; o layout mostra "Conta suspensa".
   */
  status: "ativo" | "pendente" | "suspensa";
  productName: string;
  primaryColor: string;
  labels: Partial<Labels> | null;
};

export type SessionContext = {
  userId: string;
  userName: string;
  userEmail: string;
  /** todos os vinculos, inclusive os pendentes e os de conta suspensa */
  memberships: Membership[];
  /**
   * null quando o usuario pertence a mais de uma clinica e ainda nao
   * escolheu, ou quando a clinica escolhida esta suspensa (clinicaSuspensa)
   */
  active: Membership | null;
  /**
   * A conta suspensa a avisar (onda 1): a clinica escolhida no cookie esta
   * suspensa, ou a pessoa nao tem nenhuma clinica ativa e alguma das suas
   * esta suspensa. O layout troca o sistema pela tela "Conta suspensa", com
   * Sair e, havendo outra clinica ativa, a troca. null: nada a avisar. O
   * super admin nunca cai aqui: ele le a clinica suspensa como qualquer
   * outra e entra normalmente.
   */
  clinicaSuspensa: Membership | null;
  isProductAdmin: boolean;
  /**
   * A leitura dos vinculos FALHOU (erro do banco ou da rede), e por isso
   * memberships veio vazio. Nao quer dizer "sem clinica": o layout mostra
   * um erro honesto com "Tentar de novo" em vez de afirmar que a pessoa nao
   * pertence a nenhuma clinica (achado 115 da revisao). Nao lanca excecao
   * porque o layout raiz tambem chama esta funcao e nao ha global-error.
   */
  vinculoIndisponivel: boolean;
  /**
   * A leitura da marca de Implementador FALHOU (nao a tabela ausente, que
   * quer dizer que ninguem tem marca). A sessao segue com implementador
   * false em todo vinculo; quem precisa da marca para RECUSAR algo que o
   * banco nao trava (a exportacao dos leads, P18-6) recusa na duvida.
   */
  marcaDeImplementadorIndisponivel: boolean;
};

type BrandingEmbed = {
  product_name: string;
  primary_color: string;
  labels: Partial<Labels> | null;
};

type ClinicEmbed = {
  id: string;
  name: string;
  slug: string;
  timezone: string | null;
  clinic_branding: BrandingEmbed | BrandingEmbed[] | null;
};

type MemberRow = {
  clinic_id: string;
  role: Role;
  /** 'inativo' (acesso tirado, reversivel) existe no banco e nunca vira Membership */
  status: "ativo" | "pendente" | "inativo";
  clinic: ClinicEmbed | ClinicEmbed[] | null;
};

export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return null;
    }

    // As tres so dependem de user.id: em serie eram idas ao Postgres remoto
    // pagas por TODA navegacao, dentro do caminho mais quente do app. A marca
    // de Implementador (onda 5) vem numa consulta propria e tolerante, NUNCA
    // por embed na leitura dos vinculos: tabela ausente ou erro nao derrubam
    // a sessao de ninguem.
    const [
      { data: memberRows, error: erroVinculos },
      { data: productAdminRow, error: erroDonoDoProduto },
      marcas,
    ] = await Promise.all([
      supabase
        .from("clinic_member")
        .select(
          "clinic_id, role, status, clinic:clinic_id (id, name, slug, timezone, clinic_branding (product_name, primary_color, labels))",
        )
        .eq("user_id", user.id),
      supabase
        .from("product_admin")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      lerMinhasMarcas(supabase, user.id),
    ]);
    const clinicasMarcadas = marcas.ok ? marcas.ids : new Set<string>();

    // Quem esta PENDENTE nao le a tabela clinic (a policy exige vinculo ativo,
    // para o codigo de acesso nao vazar antes da aprovacao), entao o embed vem
    // nulo. O nome vem por uma funcao que devolve so id e nome.
    const temPendenteSemNome = (
      (memberRows ?? []) as { status?: string; clinic?: unknown }[]
    ).some((row) => row.status === "pendente" && !row.clinic);
    const nomesPendentes = new Map<string, string>();
    let erroNomesPendentes = false;
    if (temPendenteSemNome) {
      const { data: pendentes, error: erroPendentes } = await supabase.rpc(
        "minhas_clinicas_pendentes",
      );
      // Sem o nome, o vinculo pendente sumiria e a pessoa veria "Sem
      // clinica vinculada": melhor dizer que o acesso nao carregou.
      erroNomesPendentes = erroPendentes !== null;
      for (const linha of (pendentes ?? []) as {
        clinic_id: string;
        clinic_name: string;
      }[]) {
        nomesPendentes.set(linha.clinic_id, linha.clinic_name);
      }
    }

    // Vinculo ATIVO sem a clinica no embed: desde a onda 1, e a conta
    // suspensa (a RLS de clinic so mostra clinica nao suspensa a quem nao e
    // super admin). O nome vem por uma funcao que devolve so id, nome e
    // quando foi suspensa, e so e chamada nesse caso: quem esta numa
    // clinica normal nao paga ida nenhuma a mais.
    const temAtivoSemClinica = (
      (memberRows ?? []) as { status?: string; clinic?: unknown }[]
    ).some((row) => row.status === "ativo" && !row.clinic);
    const nomesSuspensas = new Map<string, string>();
    let erroNomesSuspensas = false;
    if (temAtivoSemClinica) {
      const { data: suspensas, error: erroSuspensas } = await supabase.rpc(
        "minhas_clinicas_suspensas",
      );
      // Sem o nome, o vinculo sumiria e a pessoa veria "Sem clinica
      // vinculada" no lugar de "Conta suspensa": melhor dizer que o acesso
      // nao carregou.
      erroNomesSuspensas = erroSuspensas !== null;
      for (const linha of (suspensas ?? []) as {
        clinic_id: string;
        nome: string;
      }[]) {
        nomesSuspensas.set(linha.clinic_id, linha.nome);
      }
    }

    // Sem tipos gerados do banco (pendencia registrada), a inferencia do
    // supabase-js trata os embeds como array; em runtime clinic e branding
    // sao objetos (FK para PK). Conversao explicita + normalizacao defensiva.
    const rows = (memberRows ?? []) as unknown as MemberRow[];
    const memberships: Membership[] = rows
      .map((row): Membership | null => {
        // Acesso desativado: some da lista, como se o vinculo nao existisse.
        // A RLS ja nega tudo (toda checagem exige status = 'ativo'); isto so
        // evita mostrar a clinica numa lista de onde a pessoa nao entra mais.
        if (row.status === "inativo") {
          return null;
        }
        const clinic = Array.isArray(row.clinic)
          ? (row.clinic[0] ?? null)
          : row.clinic;
        if (!clinic) {
          // Vinculo pendente ou de conta suspensa: sem acesso a clinica, so
          // o nome pela funcao de cada caso.
          const nome =
            row.status === "pendente"
              ? nomesPendentes.get(row.clinic_id)
              : row.status === "ativo"
                ? nomesSuspensas.get(row.clinic_id)
                : undefined;
          if (nome) {
            return {
              clinicId: row.clinic_id,
              clinicName: nome,
              slug: "",
              timezone: "America/Fortaleza",
              role: row.role,
              implementador:
                row.role === "admin" && clinicasMarcadas.has(row.clinic_id),
              status:
                row.status === "pendente"
                  ? ("pendente" as const)
                  : ("suspensa" as const),
              productName: "Conduzza Clínicas",
              primaryColor: "#B2E54F",
              labels: null,
            };
          }
          return null;
        }
        const branding = Array.isArray(clinic.clinic_branding)
          ? (clinic.clinic_branding[0] ?? null)
          : clinic.clinic_branding;
        return {
          clinicId: clinic.id,
          clinicName: clinic.name,
          slug: clinic.slug,
          timezone: clinic.timezone ?? "America/Fortaleza",
          role: row.role,
          // A marca so vale com o vinculo admin (papelNaTela repete a regra).
          implementador:
            row.role === "admin" && clinicasMarcadas.has(clinic.id),
          status: row.status ?? "ativo",
          productName: branding?.product_name ?? "Conduzza Clínicas",
          primaryColor: branding?.primary_color ?? "#B2E54F",
          labels: branding?.labels ?? null,
        };
      })
      .filter((m): m is Membership => m !== null)
      .sort((a, b) => a.clinicName.localeCompare(b.clinicName));

    // Vinculo pendente nao pode virar clinica ativa: a pessoa entra no
    // sistema, ve que esta aguardando aprovacao, e nada mais. Vinculo de
    // conta suspensa tambem nao.
    const ativos = memberships.filter((m) => m.status === "ativo");
    const cookieStore = await cookies();
    const wanted = cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value;
    const fromCookie = wanted
      ? (ativos.find((m) => m.clinicId === wanted) ?? null)
      : null;
    // Conta suspensa: a escolhida no cookie (mesmo havendo outra ativa, a
    // pessoa precisa saber por que nao entrou nela) ou, sem nenhuma ativa,
    // a primeira suspensa.
    const suspensas = memberships.filter((m) => m.status === "suspensa");
    const clinicaSuspensa =
      (wanted ? suspensas.find((m) => m.clinicId === wanted) : undefined) ??
      (ativos.length === 0 ? (suspensas[0] ?? null) : null);
    const active =
      clinicaSuspensa !== null
        ? null
        : (fromCookie ?? (ativos.length === 1 ? (ativos[0] ?? null) : null));

    const metadata = user.user_metadata as Record<string, unknown> | null;
    const userName =
      typeof metadata?.name === "string" && metadata.name.trim().length > 0
        ? metadata.name
        : (user.email ?? "Usuário");

    return {
      userId: user.id,
      userName,
      userEmail: user.email ?? "",
      memberships,
      active,
      clinicaSuspensa,
      isProductAdmin: productAdminRow !== null,
      // A leitura de dono do produto entra junto: falhando, o dono sem
      // clinica veria "Sem clinica vinculada" no lugar de "Criar clinica".
      vinculoIndisponivel:
        erroVinculos !== null ||
        erroDonoDoProduto !== null ||
        erroNomesPendentes ||
        erroNomesSuspensas,
      marcaDeImplementadorIndisponivel: !marcas.ok,
    };
  },
);

// Rotulo de papel mora em lib/domain/permissions.ts (fonte unica, sem
// "server-only"); reexportado aqui para nao quebrar quem ja importava daqui.
export { ROLE_LABELS } from "@/lib/domain/permissions";
