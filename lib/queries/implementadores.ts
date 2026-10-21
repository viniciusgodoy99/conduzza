import type { SupabaseClient } from "@supabase/supabase-js";

// Marca de Implementador (onda 5, item 18; contrato B.0 e B.2): no banco, o
// Implementador e um vinculo 'admin' com uma linha em membro_implementador
// (migration 20261025110000). A marca so muda o rotulo e liga as travas de
// equipe escolhidas pelo dono (P18-2 a P18-6); o acesso e o do
// administrador.
//
// Leitura SEMPRE tolerante e numa consulta PROPRIA, nunca por embed na
// leitura dos vinculos: se a tabela ainda nao existir (codigo publicado
// antes da migration) ou a leitura falhar, ninguem aparece como
// Implementador e o sistema segue. Com embed, um erro derrubaria a sessao de
// todo mundo. As travas que importam moram no banco (gatilhos de
// clinic_member e a policy da marca); a tela so explica antes.
//
// Funciona com o cliente de servidor e com o de navegador: a policy da marca
// deixa ler a propria linha, as de quem e membro ativo da mesma clinica e o
// super admin ler tudo.

export type LeituraDasMarcas =
  | { ok: true; ids: ReadonlySet<string> }
  | { ok: false };

// A tabela ainda nao existe: o PostgREST responde PGRST205 (fora do cache de
// esquema) e o Postgres, 42P01. Sem tabela, ninguem tem marca.
const TABELA_AUSENTE = new Set(["PGRST205", "42P01"]);

const NINGUEM: LeituraDasMarcas = { ok: true, ids: new Set() };

function lerColuna(
  dados: unknown,
  coluna: "clinic_id" | "user_id",
): Set<string> {
  const ids = new Set<string>();
  for (const linha of (dados ?? []) as Record<string, unknown>[]) {
    const valor = linha[coluna];
    if (typeof valor === "string") {
      ids.add(valor);
    }
  }
  return ids;
}

// A consulta e montada DENTRO do try: nem um cliente que lanca ao montar
// derruba quem chama.
async function lerMarcas(
  consulta: () => PromiseLike<{
    data: unknown;
    error: { code?: string } | null;
  }>,
  coluna: "clinic_id" | "user_id",
): Promise<LeituraDasMarcas> {
  try {
    const { data, error } = await consulta();
    if (error) {
      return TABELA_AUSENTE.has(error.code ?? "") ? NINGUEM : { ok: false };
    }
    return { ok: true, ids: lerColuna(data, coluna) };
  } catch {
    return { ok: false };
  }
}

/** As clinicas em que o usuario tem a marca (ids de clinica). */
export function lerMinhasMarcas(
  supabase: SupabaseClient,
  userId: string,
): Promise<LeituraDasMarcas> {
  return lerMarcas(
    () =>
      supabase
        .from("membro_implementador")
        .select("clinic_id")
        .eq("user_id", userId),
    "clinic_id",
  );
}

/** Quem tem a marca nesta clinica (ids de usuario). */
export function lerMarcasDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<LeituraDasMarcas> {
  return lerMarcas(
    () =>
      supabase
        .from("membro_implementador")
        .select("user_id")
        .eq("clinic_id", clinicId),
    "user_id",
  );
}

/** Os ids marcados, ou nenhum quando a leitura falhou (o rotulo cai em Administrador). */
export function marcadosOuNinguem(leitura: LeituraDasMarcas): ReadonlySet<string> {
  return leitura.ok ? leitura.ids : new Set();
}
