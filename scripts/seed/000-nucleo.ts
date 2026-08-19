import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureUser } from "./lib";

// Incremento nucleo do seed (Fase 0): clinicas, branding, unidades, usuarios
// por papel e o super admin do produto. Idempotente: UUIDs fixos + upsert;
// usuarios resolvidos por e-mail. Dados ficticios de desenvolvimento.

// Senha compartilhada de DESENVOLVIMENTO para todos os usuarios do seed.
export const SEED_PASSWORD = "Conduzza!Dev2026";

const CLINIC_VITALIS = "00000000-0000-4000-a000-000000000001";
const CLINIC_BELEZA = "00000000-0000-4000-a000-000000000002";

const UNITS = [
  {
    id: "00000000-0000-4000-a000-000000000101",
    clinic_id: CLINIC_VITALIS,
    name: "Unidade Centro",
    address: "Av. Prudente de Morais, 1200, Natal, RN",
    phone: "(84) 3222-1100",
  },
  {
    id: "00000000-0000-4000-a000-000000000102",
    clinic_id: CLINIC_VITALIS,
    name: "Unidade Zona Sul",
    address: "R. das Camélias, 45, Natal, RN",
    phone: "(84) 3222-1200",
  },
  {
    id: "00000000-0000-4000-a000-000000000201",
    clinic_id: CLINIC_BELEZA,
    name: "Unidade Única",
    address: "R. Mossoró, 380, Natal, RN",
    phone: "(84) 3333-2200",
  },
];

type SeedMember = {
  email: string;
  role: "admin" | "gestor" | "recepcao" | "profissional" | "leitura";
  clinics: string[];
};

const MEMBERS: SeedMember[] = [
  { email: "admin@vitalis.dev", role: "admin", clinics: [CLINIC_VITALIS] },
  { email: "gestor@vitalis.dev", role: "gestor", clinics: [CLINIC_VITALIS] },
  {
    email: "recepcao@vitalis.dev",
    role: "recepcao",
    clinics: [CLINIC_VITALIS],
  },
  {
    email: "profissional@vitalis.dev",
    role: "profissional",
    clinics: [CLINIC_VITALIS],
  },
  { email: "leitura@vitalis.dev", role: "leitura", clinics: [CLINIC_VITALIS] },
  { email: "admin@belezapura.dev", role: "admin", clinics: [CLINIC_BELEZA] },
  // Persona agencia: admin nas duas clinicas, exercita o seletor de clinica.
  {
    email: "agencia@conduzza.dev",
    role: "admin",
    clinics: [CLINIC_VITALIS, CLINIC_BELEZA],
  },
];

const PRODUCT_ADMIN_EMAIL = "dono@conduzza.dev";

export async function seedNucleo(admin: SupabaseClient): Promise<string[]> {
  const log: string[] = [];

  const { error: clinicError } = await admin.from("clinic").upsert(
    [
      {
        id: CLINIC_VITALIS,
        name: "Clínica Vitalis",
        slug: "clinica-vitalis",
        timezone: "America/Fortaleza",
      },
      {
        id: CLINIC_BELEZA,
        name: "Espaço Beleza Pura",
        slug: "espaco-beleza-pura",
        timezone: "America/Fortaleza",
      },
    ],
    { onConflict: "id" },
  );
  if (clinicError) {
    throw new Error(`clinic: ${clinicError.message}`);
  }
  log.push("2 clínicas");

  const { error: brandingError } = await admin
    .from("clinic_branding")
    .upsert([{ clinic_id: CLINIC_VITALIS }, { clinic_id: CLINIC_BELEZA }], {
      onConflict: "clinic_id",
      ignoreDuplicates: true,
    });
  if (brandingError) {
    throw new Error(`clinic_branding: ${brandingError.message}`);
  }
  log.push("branding padrão das 2 clínicas");

  const { error: unitError } = await admin
    .from("unit")
    .upsert(UNITS, { onConflict: "id" });
  if (unitError) {
    throw new Error(`unit: ${unitError.message}`);
  }
  log.push(`${UNITS.length} unidades`);

  const memberRows: {
    clinic_id: string;
    user_id: string;
    role: SeedMember["role"];
  }[] = [];
  for (const member of MEMBERS) {
    const userId = await ensureUser(admin, member.email, SEED_PASSWORD);
    for (const clinicId of member.clinics) {
      memberRows.push({
        clinic_id: clinicId,
        user_id: userId,
        role: member.role,
      });
    }
  }
  const { error: memberError } = await admin
    .from("clinic_member")
    .upsert(memberRows, { onConflict: "clinic_id,user_id" });
  if (memberError) {
    throw new Error(`clinic_member: ${memberError.message}`);
  }
  log.push(`${MEMBERS.length} usuários com papéis`);

  const donoId = await ensureUser(admin, PRODUCT_ADMIN_EMAIL, SEED_PASSWORD);
  const { error: productAdminError } = await admin
    .from("product_admin")
    .upsert([{ user_id: donoId }], { onConflict: "user_id" });
  if (productAdminError) {
    throw new Error(`product_admin: ${productAdminError.message}`);
  }
  log.push("1 super admin do produto");

  return log;
}
