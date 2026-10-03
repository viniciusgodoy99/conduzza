"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { ConveniosTab } from "@/components/cadastros/convenios-tab";
import { PacotesTab } from "@/components/cadastros/pacotes-tab";
import { ProcedimentosTab } from "@/components/cadastros/procedimentos-tab";
import { ProfissionaisTab } from "@/components/cadastros/profissionais-tab";
import { UnidadesTab } from "@/components/cadastros/unidades-tab";
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  catalogoKeys,
  fetchCatalogo,
  fetchMatrizDeConvenios,
  fetchUsoDosPacotes,
  type Catalogo,
  type MatrizDeConvenios,
  type UsoDoPacote,
} from "@/lib/queries/catalogo";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { createClient } from "@/lib/supabase/client";

import { ABAS_DE_CADASTROS, abaDeCadastros, type AbaDeCadastros } from "./abas";

// Tela 8: as cinco abas do catalogo (lista e motivo em ./abas). A aba vive
// na URL (?aba=procedimentos) para link direto. O catalogo inteiro vem numa
// query so (tabelas pequenas) e toda mutacao invalida essa chave unica (a
// matriz de convenios e o uso dos pacotes moram sob o mesmo prefixo). Abas
// sublinhadas do design system (5 ou mais vistas), com a contagem de cada
// lista; em tela estreita a fileira rola na horizontal em vez de quebrar
// linha.

export type TabProps = {
  catalogo: Catalogo;
  /**
   * Quem atende e o que cobre (professional_insurance e procedure_insurance),
   * completos. Usada pelos modais do Profissional e do Procedimento; as
   * outras abas ignoram.
   */
  matriz: MatrizDeConvenios;
  podeEditar: boolean;
  dica: string;
  aoMudar: () => void;
  timezone: string;
};

export function CadastrosClient({
  clinicId,
  catalogoInicial,
  matrizInicial,
  usoDosPacotesInicial,
  abaInicial,
  podeEditar,
  dica,
  timezone,
}: {
  clinicId: string;
  catalogoInicial: Catalogo;
  matrizInicial: MatrizDeConvenios;
  // null quando a leitura no servidor falhou: a aba tenta de novo aqui.
  usoDosPacotesInicial: Record<string, UsoDoPacote> | null;
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

  const abaAtiva = abaDeCadastros(abaInicial);

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

  // Matriz de convenios: chave sob o prefixo do catalogo, entao o aoMudar
  // abaixo recarrega os dois. Se um refetch falhar, fica a ultima matriz
  // lida; os modais mandam o que leram na abertura e a RPC recusa a aba
  // parada (CZ409), entao uma matriz velha nunca grava por cima.
  useDadosDoServidor(catalogoKeys.matriz(clinicId), matrizInicial);
  const matrizQuery = useQuery({
    queryKey: catalogoKeys.matriz(clinicId),
    queryFn: () => fetchMatrizDeConvenios(supabase, clinicId),
    initialData: matrizInicial,
    staleTime: 30_000,
  });
  const matriz = matrizQuery.data;

  // Vendas e pacientes com saldo por pacote (aba Pacotes). A chave comeca
  // com o prefixo do catalogo: o invalidate de aoMudar recarrega os dois.
  useDadosDoServidor(
    catalogoKeys.usoDosPacotes(clinicId),
    usoDosPacotesInicial ?? undefined,
  );
  const usoDosPacotesQuery = useQuery({
    queryKey: catalogoKeys.usoDosPacotes(clinicId),
    queryFn: () => fetchUsoDosPacotes(supabase, clinicId),
    initialData: usoDosPacotesInicial ?? undefined,
    staleTime: 30_000,
  });

  // Invalida o PREFIXO ["catalogo", clinicId]: catalogo, matriz de
  // convenios e uso dos pacotes. As telas chamam tambem quando a RPC recusa
  // a aba parada (code "cadastro_mudou"), para o modal reabrir com o atual.
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

  const tabProps: TabProps = {
    catalogo,
    matriz,
    podeEditar,
    dica,
    aoMudar,
    timezone,
  };

  const contagem: Record<AbaDeCadastros, number> = {
    profissionais: catalogo.profissionais.length,
    procedimentos: catalogo.procedimentos.length,
    convenios: catalogo.convenios.length,
    pacotes: catalogo.pacotes.length,
    unidades: catalogo.unidades.length,
  };

  return (
    // min-w-0: sem ele a tabela mais larga alarga a grade da pagina e a tela
    // inteira rola de lado; com ele, so a tabela rola dentro do cartao.
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="min-w-0 gap-4">
      <TabsList className="cz-scroll">
        {ABAS_DE_CADASTROS.map(([key, label]) => (
          <TabsTrigger key={key} value={key}>
            {label} <TabsCount className="ml-0">{contagem[key]}</TabsCount>
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
      <TabsContent value="pacotes">
        <PacotesTab
          {...tabProps}
          usoDosPacotes={usoDosPacotesQuery.data}
          usoIndisponivel={usoDosPacotesQuery.isError}
          aoRecarregarUso={() => void usoDosPacotesQuery.refetch()}
        />
      </TabsContent>
      <TabsContent value="unidades">
        <UnidadesTab {...tabProps} />
      </TabsContent>
    </Tabs>
  );
}
