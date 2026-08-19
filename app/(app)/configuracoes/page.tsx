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
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/domain/permissions";

import { InviteForm } from "./invite-form";

// Configuracoes, bloco de Usuarios (o restante da Tela 12 chega na tarefa
// 5.3). Aceite da 0.5: gestor ve tudo com edicao travada e dica; a recepcao
// nem chega aqui (guarda no layout).
export default async function ConfiguracoesPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const { data: memberRows } = await supabase
    .from("clinic_member")
    .select("user_id, role, created_at")
    .eq("clinic_id", active.clinicId)
    .order("created_at", { ascending: true });

  // E-mails e nomes vivem no GoTrue, nao em tabela exposta: leitura pontual
  // via admin no servidor. Nenhum dado de paciente envolvido.
  const admin = createAdminClient();
  const { data: usersPage } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 100,
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

  const members = (memberRows ?? []).map(
    (row: { user_id: string; role: Role }) => ({
      userId: row.user_id,
      role: row.role,
      name: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
    }),
  );

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
          <ul className="grid gap-1">
            {members.map((member) => (
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
            <h3 className="mb-4 text-sm font-semibold">Convidar usuário</h3>
            <InviteForm canInvite={canInvite} hint={hint} />
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-text-tertiary">
        As demais seções de Configurações (clínica, marca, modelos, limite de
        gastos, privacidade) chegam nas próximas fases.
      </p>
    </div>
  );
}
