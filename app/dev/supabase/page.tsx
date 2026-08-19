import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Pagina de verificacao da tarefa 0.2: um Server Component lendo uma tabela
// de teste. Nao existe em producao.
export default async function SupabaseHealthPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("health_check")
    .select("label, created_at")
    .limit(1)
    .maybeSingle();

  return (
    <main className="grid min-h-dvh place-items-center p-8">
      <div className="grid max-w-md gap-2 rounded-lg border bg-card p-6">
        <h1 className="text-[15px] font-semibold">Conexão com o Supabase</h1>
        {error ? (
          <p className="text-sm text-alert">
            Falha ao ler a tabela de teste: {error.message}
          </p>
        ) : data ? (
          <p className="text-sm text-success">{data.label}</p>
        ) : (
          <p className="text-sm text-text-secondary">
            Tabela de teste vazia. Rode as migrations com npm run db:reset.
          </p>
        )}
      </div>
    </main>
  );
}
