import type { SupabaseClient } from "@supabase/supabase-js";

import { provisionarDemonstracaoClinica } from "../dev/demo-catalogo";

// Fase 2 (tarefas 2.1 e 2.3): catalogo clinico e agenda de demonstracao para
// as clinicas ficticias do seed. Reaproveita a provisao canonica (o caso do
// Dr. Joao da spec, com Coberto e R$ 0,00, encaixe da IA pendente e hold).
// Roda SO sob a dupla trava do seed (ver index.ts).

export async function seedCatalogoEAgenda(
  admin: SupabaseClient,
): Promise<string[]> {
  const feito: string[] = [];
  const { data: clinicas } = await admin
    .from("clinic")
    .select("id, name, slug")
    .in("slug", ["clinica-vitalis", "espaco-beleza-pura"]);
  for (const clinica of clinicas ?? []) {
    const linhas = await provisionarDemonstracaoClinica(
      admin,
      clinica.id as string,
    );
    feito.push(`${clinica.name}: ${linhas.length} blocos de catálogo e agenda`);
  }
  return feito;
}
