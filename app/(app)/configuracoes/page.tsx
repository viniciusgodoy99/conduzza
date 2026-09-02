import { redirect } from "next/navigation";

import type { MembroEquipe } from "@/components/configuracoes/lista-equipe";
import { PageHeader } from "@/components/shared/page-header";
import type { ConnectState } from "@/lib/actions/whatsapp-connect";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
import { fetchProfileNames } from "@/lib/queries/profiles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { ConfiguracoesClient } from "./configuracoes-client";
import type { Pendente } from "./equipe-client";

// Tela 12, Configuracoes, em duas abas: equipe e permissoes (liberacao de
// pedidos, papeis, convite, codigo da clinica e a tabela do que cada papel
// faz) e conexao do WhatsApp, o mesmo painel do primeiro acesso.
// Administrador e gestor editam; os demais papeis nem chegam aqui (o layout
// redireciona pela matriz do brief).
export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const [memberResult, clinicResult, codigoResult, whatsappResult] =
    await Promise.all([
      supabase
        .from("clinic_member")
        .select("user_id, role, status, created_at")
        .eq("clinic_id", active.clinicId)
        .order("created_at", { ascending: true }),
      supabase
        .from("clinic")
        .select("allow_code_signup")
        .eq("id", active.clinicId)
        .single(),
      // O codigo mora em tabela propria, legivel so por quem gerencia.
      supabase
        .from("clinic_access_code")
        .select("code")
        .eq("clinic_id", active.clinicId)
        .maybeSingle(),
      supabase
        .from("whatsapp_account")
        .select("connection_status, display_phone, connected_at, provider")
        .eq("clinic_id", active.clinicId)
        .maybeSingle(),
    ]);

  type MemberRow = {
    user_id: string;
    role: Role;
    status: "ativo" | "pendente" | "inativo";
  };
  const rows = (memberResult.data ?? []) as MemberRow[];

  // Nome vem da tabela profile (uma consulta indexada). E-mail so existe no
  // GoTrue: a RPC emails_da_equipe (restrita ao service role) devolve os da
  // clinica numa consulta so, no lugar de uma chamada HTTP a API admin POR
  // membro (equipe de 15 pessoas eram 15 requests antes de renderizar).
  const admin = createAdminClient();
  const memberIds = rows.map((row) => row.user_id);
  const [nameById, emailsResult] = await Promise.all([
    fetchProfileNames(supabase, memberIds),
    admin.rpc("emails_da_equipe", { p_clinic_id: active.clinicId }),
  ]);
  const emailById = new Map(
    ((emailsResult.data ?? []) as { user_id: string; email: string }[]).map(
      (linha) => [linha.user_id, linha.email] as const,
    ),
  );
  const userById = new Map(
    memberIds.map((id) => [
      id,
      {
        name: nameById[id] ?? emailById.get(id) ?? "Usuário",
        email: emailById.get(id) ?? "",
      },
    ]),
  );

  // Quem esta na equipe (com acesso ou sem) entra numa lista so; quem perdeu
  // o acesso vai para o fim, esmaecido. O sort e estavel, entao dentro de cada
  // grupo a ordem de entrada na clinica se mantem.
  const equipe: MembroEquipe[] = rows
    .filter((row) => row.status !== "pendente")
    .map((row) => ({
      userId: row.user_id,
      nome: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
      papel: row.role,
      ativo: row.status === "ativo",
    }))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo));

  const pendentes: Pendente[] = rows
    .filter((row) => row.status === "pendente")
    .map((row) => ({
      userId: row.user_id,
      nome: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
    }));

  const podeGerenciar = canEdit(active.role, "configuracoes");
  const ehAdmin = active.role === "admin";
  const dica = permissionHint(active.role, "configuracoes");

  const whatsapp = whatsappResult.data;
  const initial: ConnectState = {
    status:
      (whatsapp?.connection_status as ConnectState["status"]) ?? "desconectado",
    qrCode: null,
    displayPhone: whatsapp?.display_phone ?? null,
  };
  // Sem linha de whatsapp_account ainda, o provedor e o do ambiente: assumir
  // "fake" faria a clinica em producao ver o aviso de demonstracao.
  const providerName =
    (whatsapp?.provider as string | undefined) ??
    process.env.WHATSAPP_PROVIDER ??
    "fake";

  const { aba } = await searchParams;

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Configurações"
        description={`Equipe, permissões e WhatsApp de ${active.clinicName}`}
      />
      <ConfiguracoesClient
        abaInicial={aba}
        equipe={equipe}
        pendentes={pendentes}
        meuUserId={context.userId}
        podeGerenciar={podeGerenciar}
        ehAdmin={ehAdmin}
        dica={dica ?? "Seu perfil não altera as configurações"}
        codigo={codigoResult.data?.code ?? ""}
        codigoAtivo={clinicResult.data?.allow_code_signup ?? false}
        whatsapp={{
          initial,
          connectedAt: whatsapp?.connected_at ?? null,
          providerName,
        }}
      />
    </div>
  );
}
