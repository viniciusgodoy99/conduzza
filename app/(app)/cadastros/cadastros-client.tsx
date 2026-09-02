"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { BloqueiosTab } from "@/components/cadastros/bloqueios-tab";
import { ConveniosTab } from "@/components/cadastros/convenios-tab";
import { PacotesTab } from "@/components/cadastros/pacotes-tab";
import { ProcedimentosTab } from "@/components/cadastros/procedimentos-tab";
import { ProfissionaisTab } from "@/components/cadastros/profissionais-tab";
import { RecursosTab } from "@/components/cadastros/recursos-tab";
import { UnidadesTab } from "@/components/cadastros/unidades-tab";
import { VinculosTab } from "@/components/cadastros/vinculos-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  catalogoKeys,
  fetchCatalogo,
  type Catalogo,
} from "@/lib/queries/catalogo";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { createClient } from "@/lib/supabase/client";

// Tela 8: as oito abas do catalogo. A aba vive na URL (?aba=vinculos) para
// link direto. O catalogo inteiro vem numa query so (tabelas pequenas) e
// toda mutacao invalida essa chave unica.

const ABAS = [
  ["profissionais", "Profissionais"],
  ["procedimentos", "Procedimentos"],
  ["convenios", "Convênios"],
  ["vinculos", "Vínculos"],
  ["pacotes", "Pacotes"],
  ["recursos", "Recursos"],
  ["unidades", "Unidades"],
  ["bloqueios", "Bloqueios"],
] as const;

type AbaKey = (typeof ABAS)[number][0];

export type TabProps = {
  catalogo: Catalogo;
  podeEditar: boolean;
  dica: string;
  aoMudar: () => void;
  timezone: string;
};

export function CadastrosClient({
  clinicId,
  catalogoInicial,
  abaInicial,
  podeEditar,
  dica,
  timezone,
}: {
  clinicId: string;
  catalogoInicial: Catalogo;
  abaInicial?: string;
  podeEditar: boolean;
  dica: string;
  timezone: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const abaAtiva: AbaKey = ABAS.some(([key]) => key === abaInicial)
    ? (abaInicial as AbaKey)
    : "profissionais";

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(catalogoKeys.tudo(clinicId), catalogoInicial);

  const catalogoQuery = useQuery({
    queryKey: catalogoKeys.tudo(clinicId),
    queryFn: () => fetchCatalogo(supabase, clinicId),
    initialData: catalogoInicial,
    staleTime: 30_000,
  });
  const catalogo = catalogoQuery.data;

  const aoMudar = () => {
    void queryClient.invalidateQueries({
      queryKey: catalogoKeys.tudo(clinicId),
    });
  };

  const trocarAba = (aba: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aba", aba);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const tabProps: TabProps = { catalogo, podeEditar, dica, aoMudar, timezone };

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
      <TabsList className="h-auto flex-wrap justify-start">
        {ABAS.map(([key, label]) => (
          <TabsTrigger key={key} value={key} className="min-h-9">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="profissionais">
        <ProfissionaisTab {...tabProps} />
      </TabsContent>
      <TabsContent value="procedimentos">
        <ProcedimentosTab {...tabProps} />
      </TabsContent>
      <TabsContent value="convenios">
        <ConveniosTab {...tabProps} />
      </TabsContent>
      <TabsContent value="vinculos">
        <VinculosTab {...tabProps} />
      </TabsContent>
      <TabsContent value="pacotes">
        <PacotesTab {...tabProps} />
      </TabsContent>
      <TabsContent value="recursos">
        <RecursosTab {...tabProps} />
      </TabsContent>
      <TabsContent value="unidades">
        <UnidadesTab {...tabProps} />
      </TabsContent>
      <TabsContent value="bloqueios">
        <BloqueiosTab {...tabProps} />
      </TabsContent>
    </Tabs>
  );
}
