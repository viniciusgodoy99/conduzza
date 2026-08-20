import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, getSessionContext } from "@/lib/auth/active-clinic";
import { can, permissionHint } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { CodigoAcesso, PendentesList, type Pendente } from "./equipe-client";
import { InviteForm } from "./invite-form";

// Configuracoes, bloco de Usuarios (o restante da Tela 12 chega na tarefa
// 5.3): equipe ativa, pedidos de entrada por codigo aguardando liberacao,
// convite por e-mail e o codigo da clinica.
export default async function ConfiguracoesPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const [memberResult, clinicResult, codigoResult] = await Promise.all([
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
    // O codigo mora em tabela propria, legivel so por administrador.
    supabase
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
  ]);

  // E-mails e nomes vivem no GoTrue, nao em tabela exposta: leitura pontual
  // via admin no servidor. Nenhum dado de paciente envolvido.
  const admin = createAdminClient();
  const { data: usersPage } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const userById = new Map(
    (usersPage?.users ?? []).map((user) => [
      user.id,
      {
        email: user.email ?? "",
        name:
          typeof user.user_metadata?.name === "string"
            ? (user.user_metadata.name as string)
            : (user.email ?? ""),
      },
    ]),
  );

  type MemberRow = {
    user_id: string;
    role: Role;
    status: "ativo" | "pendente";
  };
  const rows = (memberResult.data ?? []) as MemberRow[];
  const membros = rows
    .filter((row) => row.status === "ativo")
    .map((row) => ({
      userId: row.user_id,
      role: row.role,
      name: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
    }));
  const pendentes: Pendente[] = rows
    .filter((row) => row.status === "pendente")
    .map((row) => ({
      userId: row.user_id,
      nome: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
    }));

  const canInvite = can(active.role, "configuracoes") === "tudo";
  const hint = permissionHint(active.role, "configuracoes");

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Configurações"
        description={`Clínica, usuários e permissões de ${active.clinicName}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Usuários e permissões</CardTitle>
          <CardDescription>
            Quem tem acesso a esta clínica e com qual papel.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <PendentesList pendentes={pendentes} podeGerenciar={canInvite} />

          <ul className="grid gap-1">
            {membros.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {member.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0] ?? "")
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {member.name}
                  </span>
                  <span className="truncate text-xs text-text-tertiary">
                    {member.email}
                  </span>
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-text-secondary">
                  {ROLE_LABELS[member.role]}
                </span>
              </li>
            ))}
          </ul>

          <div className="border-t pt-6">
            <h3 className="mb-4 text-sm font-semibold">Convidar por e-mail</h3>
            <InviteForm canInvite={canInvite} hint={hint} />
          </div>

          <CodigoAcesso
            codigo={codigoResult.data?.code ?? ""}
            ativo={clinicResult.data?.allow_code_signup ?? false}
            podeGerenciar={canInvite}
          />
        </CardContent>
      </Card>

      <p className="text-sm text-text-tertiary">
        As demais seções de Configurações (clínica, marca, modelos, limite de
        gastos, privacidade) chegam nas próximas fases.
      </p>
    </div>
  );
}
