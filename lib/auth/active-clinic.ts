import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Labels } from "@/lib/branding/labels";
import type { Role } from "@/lib/domain/permissions";

// Contexto de sessao e clinica ativa da area logada.
// O cookie e SO conveniencia de selecao: toda leitura e validada contra
// clinic_member na hora, e a barreira real continua sendo a RLS no banco.

export const ACTIVE_CLINIC_COOKIE = "conduzza-clinica-ativa";

export type Membership = {
  clinicId: string;
  clinicName: string;
  slug: string;
  role: Role;
  productName: string;
  primaryColor: string;
  labels: Partial<Labels> | null;
};

export type SessionContext = {
  userId: string;
  userName: string;
  userEmail: string;
  memberships: Membership[];
  /** null quando o usuario pertence a mais de uma clinica e ainda nao escolheu */
  active: Membership | null;
  isProductAdmin: boolean;
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
  clinic_branding: BrandingEmbed | BrandingEmbed[] | null;
};

type MemberRow = {
  role: Role;
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

    const { data: memberRows } = await supabase
      .from("clinic_member")
      .select(
        "role, clinic:clinic_id (id, name, slug, clinic_branding (product_name, primary_color, labels))",
      )
      .eq("user_id", user.id);

    // Sem tipos gerados do banco (pendencia registrada), a inferencia do
    // supabase-js trata os embeds como array; em runtime clinic e branding
    // sao objetos (FK para PK). Conversao explicita + normalizacao defensiva.
    const rows = (memberRows ?? []) as unknown as MemberRow[];
    const memberships: Membership[] = rows
      .map((row) => {
        const clinic = Array.isArray(row.clinic)
          ? (row.clinic[0] ?? null)
          : row.clinic;
        if (!clinic) {
          return null;
        }
        const branding = Array.isArray(clinic.clinic_branding)
          ? (clinic.clinic_branding[0] ?? null)
          : clinic.clinic_branding;
        return {
          clinicId: clinic.id,
          clinicName: clinic.name,
          slug: clinic.slug,
          role: row.role,
          productName: branding?.product_name ?? "Conduzza Clínicas",
          primaryColor: branding?.primary_color ?? "#A8D318",
          labels: branding?.labels ?? null,
        };
      })
      .filter((m): m is Membership => m !== null)
      .sort((a, b) => a.clinicName.localeCompare(b.clinicName));

    const { data: productAdminRow } = await supabase
      .from("product_admin")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const cookieStore = await cookies();
    const wanted = cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value;
    const fromCookie = wanted
      ? (memberships.find((m) => m.clinicId === wanted) ?? null)
      : null;
    const active =
      fromCookie ??
      (memberships.length === 1 ? (memberships[0] ?? null) : null);

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
      isProductAdmin: productAdminRow !== null,
    };
  },
);

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  recepcao: "Recepção",
  profissional: "Profissional",
  leitura: "Somente leitura",
};
