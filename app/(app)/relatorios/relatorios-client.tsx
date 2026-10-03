"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { AbaAgenteIa } from "@/components/relatorios/aba-agente-ia";
import { AbaComercial } from "@/components/relatorios/aba-comercial";
import { AbaMarketing } from "@/components/relatorios/aba-marketing";
import { AbaVisaoGeral } from "@/components/relatorios/aba-visao-geral";
import { ExportarRelatorio } from "@/components/relatorios/exportar-relatorio";
import { Aviso } from "@/components/shared/aviso";
import { CardsSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  montarExportavelDaAba,
  type DimensaoDaAgenda,
  type DimensaoDaOrigem,
} from "@/lib/domain/exportacao-de-resultados";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import {
  ABAS_DE_RESULTADOS,
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchCampanhasDoPeriodo,
  fetchFaturamentoDoPeriodo,
  fetchFunilDoPeriodo,
  fetchLinhaDeBase,
  fetchObjetivoDeConversao,
  fetchSerieDiariaDoPeriodo,
  relatoriosKeys,
  resolverAbaDeResultados,
  type AbaDeResultados,
  type AgendaDoPeriodo,
  type AtendimentoDoPeriodo,
  type CampanhasDoPeriodo,
  type FaturamentoDoPeriodo,
  type FunilDoPeriodo,
  type LinhaDeBase,
  type ObjetivoDeConversao,
  type Periodizado,
  type PivoDaRegua,
  type PontoDaSerie,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/client";

// Tela 11, Resultados: aba e periodo vivem na URL (?aba=&de=&ate=) para link
// direto, padrao de Automacoes e Confirmacoes. Desde a Fase 3 sao 4 vistas
// (Visao geral, Marketing, Comercial, Agente de IA) em abas segmentadas com
// role=tab; as chaves antigas continuam abrindo a vista que recebeu o
// conteudo (resolverAbaDeResultados). O periodo e em DIAS CIVIS da clinica; a
// conversao para instante acontece no fetcher (regra 3.6). A exportacao
// sempre reflete a aba ATIVA, nas dimensoes ativas.
//
// Valores em reais (faturamento, receita das recuperadas, custo) so para
// admin e gestor: podeVerValores vem do servidor, o faturamento so e buscado
// nesse caso, e o banco devolve null para os outros papeis de qualquer jeito.
// Fase 4: campanhas_do_periodo (Custo por lead, Campanhas e o detalhe por
// campanha) e buscada para todos; o investimento vem null fora da gestao.

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function RelatoriosClient({
  clinicId,
  timezone,
  ehAdmin,
  podeVerValores,
  podeDefinirObjetivo,
  canalOficial,
  abaInicial,
  diaDeInicial,
  diaAteInicial,
  diaDePadrao,
  diaAtePadrao,
  funilInicial,
  agendaInicial,
  atendimentoInicial,
  serieInicial,
  faturamentoInicial,
  campanhasInicial,
  conversoes,
  linhaDeBaseInicial,
  objetivoInicial,
}: {
  clinicId: string;
  timezone: string;
  /** Registra a linha de base de faltas (so admin). */
  ehAdmin: boolean;
  /** admin ou gestor: ve valores em reais. */
  podeVerValores: boolean;
  /** admin ou gestor: define o objetivo de conversao. */
  podeDefinirObjetivo: boolean;
  /** A clinica tem numero no canal oficial (isOfficialChannel). */
  canalOficial: boolean;
  abaInicial?: string;
  /** Recorte validado que o servidor usou para buscar os dados iniciais. */
  diaDeInicial: string;
  diaAteInicial: string;
  /** Default da tela (últimos 30 dias civis), alvo do "Limpar". */
  diaDePadrao: string;
  diaAtePadrao: string;
  funilInicial: Periodizado<FunilDoPeriodo>;
  agendaInicial: Periodizado<AgendaDoPeriodo> & { pivo: PivoDaRegua };
  atendimentoInicial: Periodizado<AtendimentoDoPeriodo>;
  serieInicial: PontoDaSerie[];
  /** undefined = nao buscado (papel sem acesso a valores); null = recusado */
  faturamentoInicial?: Periodizado<FaturamentoDoPeriodo> | null;
  /** undefined = o servidor nao conseguiu (o cliente busca de novo) */
  campanhasInicial?: Periodizado<CampanhasDoPeriodo>;
  conversoes: ConversoesResumo;
  linhaDeBaseInicial: LinhaDeBase;
  objetivoInicial: ObjetivoDeConversao;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);

  const abaAtiva: AbaDeResultados = resolverAbaDeResultados(
    searchParams.get("aba") ?? abaInicial,
  );

  // Mesma validacao do servidor: dia fora do formato (ou intervalo invertido)
  // cai no padrao, para um link torto nunca virar consulta com recorte
  // invalido.
  const deURL = searchParams.get("de");
  const ateURL = searchParams.get("ate");
  const recorteDaURLValido =
    deURL !== null &&
    ateURL !== null &&
    DIA_RE.test(deURL) &&
    DIA_RE.test(ateURL) &&
    deURL <= ateURL;
  const diaDe = recorteDaURLValido ? deURL : diaDePadrao;
  const diaAte = recorteDaURLValido ? ateURL : diaAtePadrao;
  const recorteInicial = diaDe === diaDeInicial && diaAte === diaAteInicial;

  const [dimensaoOrigem, setDimensaoOrigem] =
    useState<DimensaoDaOrigem>("canal");
  const [dimensaoAgenda, setDimensaoAgenda] =
    useState<DimensaoDaAgenda>("profissional");

  const setParams = (mudancas: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") {
        params.delete(chave);
      } else {
        params.set(chave, valor);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Atalho de dentro de um bloco ("Ver detalhes em Comercial"): troca a aba
  // e leva ao topo da vista nova, ou a ancora pedida.
  const irParaAba = (aba: AbaDeResultados, ancora?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aba", aba);
    router.replace(`${pathname}?${params.toString()}${ancora ? `#${ancora}` : ""}`);
  };

  // O que cada aba precisa. Funil, agenda e atendimento sao o corpo da aba
  // (sem eles a aba nao abre); serie e faturamento sao blocos com estado
  // proprio de carregando e erro.
  const precisaFunil = abaAtiva !== "ia";
  const precisaAgenda = abaAtiva === "geral" || abaAtiva === "comercial";
  const precisaAtendimento = abaAtiva === "geral" || abaAtiva === "ia";
  const precisaSerie = abaAtiva === "geral";
  const precisaFaturamento =
    podeVerValores && (abaAtiva === "geral" || abaAtiva === "comercial");
  const precisaCampanhas = abaAtiva === "geral" || abaAtiva === "marketing";

  useDadosDoServidor(
    relatoriosKeys.funil(clinicId, diaDeInicial, diaAteInicial),
    funilInicial,
  );
  useDadosDoServidor(
    relatoriosKeys.agenda(clinicId, diaDeInicial, diaAteInicial, null),
    agendaInicial,
  );
  useDadosDoServidor(
    relatoriosKeys.atendimento(clinicId, diaDeInicial, diaAteInicial),
    atendimentoInicial,
  );
  useDadosDoServidor(
    relatoriosKeys.serie(clinicId, diaDeInicial, diaAteInicial),
    serieInicial,
  );
  useDadosDoServidor(
    relatoriosKeys.faturamento(clinicId, diaDeInicial, diaAteInicial),
    faturamentoInicial,
  );
  useDadosDoServidor(
    relatoriosKeys.campanhas(clinicId, diaDeInicial, diaAteInicial),
    campanhasInicial,
  );
  useDadosDoServidor(relatoriosKeys.linhaDeBase(clinicId), linhaDeBaseInicial);
  useDadosDoServidor(relatoriosKeys.objetivo(clinicId), objetivoInicial);

  const funilQuery = useQuery({
    queryKey: relatoriosKeys.funil(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchFunilDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? funilInicial : undefined,
    staleTime: 60_000,
    enabled: precisaFunil,
  });
  const agendaQuery = useQuery({
    queryKey: relatoriosKeys.agenda(clinicId, diaDe, diaAte, null),
    queryFn: () =>
      fetchAgendaDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? agendaInicial : undefined,
    staleTime: 60_000,
    enabled: precisaAgenda,
  });
  const atendimentoQuery = useQuery({
    queryKey: relatoriosKeys.atendimento(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchAtendimentoDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? atendimentoInicial : undefined,
    staleTime: 60_000,
    enabled: precisaAtendimento,
  });
  const serieQuery = useQuery({
    queryKey: relatoriosKeys.serie(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchSerieDiariaDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? serieInicial : undefined,
    staleTime: 60_000,
    enabled: precisaSerie,
  });
  const faturamentoQuery = useQuery({
    queryKey: relatoriosKeys.faturamento(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchFaturamentoDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData:
      recorteInicial && faturamentoInicial !== undefined
        ? faturamentoInicial
        : undefined,
    staleTime: 60_000,
    enabled: precisaFaturamento,
  });
  const campanhasQuery = useQuery({
    queryKey: relatoriosKeys.campanhas(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchCampanhasDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData:
      recorteInicial && campanhasInicial !== undefined
        ? campanhasInicial
        : undefined,
    staleTime: 60_000,
    enabled: precisaCampanhas,
  });
  const linhaDeBaseQuery = useQuery({
    queryKey: relatoriosKeys.linhaDeBase(clinicId),
    queryFn: () => fetchLinhaDeBase(supabase, clinicId),
    initialData: linhaDeBaseInicial,
    staleTime: 60_000,
  });
  const objetivoQuery = useQuery({
    queryKey: relatoriosKeys.objetivo(clinicId),
    queryFn: () => fetchObjetivoDeConversao(supabase, clinicId),
    initialData: objetivoInicial,
    staleTime: 60_000,
  });

  const periodoRotulo = `${formatarDia(diaDe)} a ${formatarDia(diaAte)}`;
  const filtroAtivo = diaDe !== diaDePadrao || diaAte !== diaAtePadrao;

  const consultasDoCorpo = [
    ...(precisaFunil ? [funilQuery] : []),
    ...(precisaAgenda ? [agendaQuery] : []),
    ...(precisaAtendimento ? [atendimentoQuery] : []),
  ];
  const comErro = consultasDoCorpo.some((consulta) => consulta.isError);
  const carregando = consultasDoCorpo.some(
    (consulta) => consulta.data === undefined,
  );
  // Exportar com um bloco ainda carregando, ou em erro, gravaria a trilha de
  // um arquivo incompleto: o botao espera tudo o que a aba exporta.
  const blocosProntos =
    (!precisaSerie || (serieQuery.data !== undefined && !serieQuery.isError)) &&
    (!precisaFaturamento ||
      (faturamentoQuery.data !== undefined && !faturamentoQuery.isError)) &&
    (!precisaCampanhas ||
      (campanhasQuery.data !== undefined && !campanhasQuery.isError));

  const montarExportavel = () =>
    montarExportavelDaAba({
      aba: abaAtiva,
      podeVerValores,
      canalOficial,
      funil: funilQuery.data,
      agenda: agendaQuery.data,
      atendimento: atendimentoQuery.data,
      serie: serieQuery.data,
      faturamento: podeVerValores ? faturamentoQuery.data : undefined,
      linhaDeBase: linhaDeBaseQuery.data,
      objetivo: objetivoQuery.data,
      conversoes,
      campanhas: campanhasQuery.data,
      timezone,
      dimensaoOrigem,
      dimensaoAgenda,
    });

  const funil = funilQuery.data;
  const agenda = agendaQuery.data;
  const atendimento = atendimentoQuery.data;

  return (
    <div className="grid gap-4 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={diaDe}
            onChange={(evento) => {
              const valor = evento.target.value;
              if (valor && DIA_RE.test(valor)) {
                setParams({ de: valor, ate: valor <= diaAte ? diaAte : valor });
              }
            }}
            className="h-10 w-[152px] cz-num"
            aria-label="Período a partir de"
          />
          <span className="text-xs text-text-secondary">até</span>
          <Input
            type="date"
            value={diaAte}
            onChange={(evento) => {
              const valor = evento.target.value;
              if (valor && DIA_RE.test(valor)) {
                setParams({ ate: valor, de: valor >= diaDe ? diaDe : valor });
              }
            }}
            className="h-10 w-[152px] cz-num"
            aria-label="Período até"
          />
        </div>
        <span className="text-[13px] text-text-secondary">
          comparado com os{" "}
          <span className="cz-num">{contarDias(diaDe, diaAte)}</span> dias
          anteriores
        </span>
        {filtroAtivo ? (
          <Button
            variant="ghost"
            onClick={() => setParams({ de: null, ate: null })}
          >
            <X aria-hidden />
            Últimos 30 dias
          </Button>
        ) : null}
        <div className="ml-auto">
          <ExportarRelatorio
            aba={abaAtiva}
            periodoRotulo={periodoRotulo}
            montar={montarExportavel}
            desabilitado={carregando || comErro || !blocosProntos}
          />
        </div>
      </div>

      <Tabs value={abaAtiva} onValueChange={(aba) => setParams({ aba })}>
        {/* No celular as 4 abas quebram linha em vez de rolar: rolagem
            cortaria a area de toque de 40px (hit-40) dos gatilhos. */}
        <TabsList
          variant="segmented"
          aria-label="Vistas de Resultados"
          className="max-w-full max-sm:h-auto max-sm:flex-wrap"
        >
          {ABAS_DE_RESULTADOS.map((aba) => (
            <TabsTrigger key={aba.chave} value={aba.chave}>
              {aba.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {comErro ? (
        <Aviso
          tom="alert"
          role="alert"
          titulo="Não foi possível carregar os resultados agora."
          acao={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const consulta of consultasDoCorpo) {
                  if (consulta.isError) {
                    void consulta.refetch();
                  }
                }
              }}
            >
              Tentar de novo
            </Button>
          }
        >
          Tente de novo em instantes.
        </Aviso>
      ) : carregando ? (
        <CardsSkeleton
          cards={abaAtiva === "geral" ? 5 : 4}
          className={
            abaAtiva === "geral"
              ? "gap-3 lg:grid-cols-3 xl:grid-cols-5"
              : "gap-3"
          }
        />
      ) : (
        <>
          {abaAtiva === "geral" && funil && agenda && atendimento ? (
            <AbaVisaoGeral
              funil={funil}
              agenda={agenda}
              atendimento={atendimento}
              serie={serieQuery.data}
              serieComErro={serieQuery.isError}
              aoTentarSerieDeNovo={() => void serieQuery.refetch()}
              faturamento={podeVerValores ? faturamentoQuery.data : null}
              faturamentoComErro={podeVerValores && faturamentoQuery.isError}
              aoTentarFaturamentoDeNovo={() => void faturamentoQuery.refetch()}
              campanhas={campanhasQuery.data}
              campanhasComErro={campanhasQuery.isError}
              aoTentarCampanhasDeNovo={() => void campanhasQuery.refetch()}
              linhaDeBase={linhaDeBaseQuery.data ?? null}
              objetivo={objetivoQuery.data}
              podeVerValores={podeVerValores}
              podeDefinirObjetivo={podeDefinirObjetivo}
              timezone={timezone}
              aoMudarObjetivo={() =>
                queryClient.invalidateQueries({
                  queryKey: relatoriosKeys.objetivo(clinicId),
                })
              }
              irParaAba={(aba) =>
                irParaAba(aba, aba === "comercial" ? "confirmacao" : undefined)
              }
            />
          ) : null}
          {abaAtiva === "marketing" && funil ? (
            <AbaMarketing
              funil={funil}
              campanhas={campanhasQuery.data}
              campanhasComErro={campanhasQuery.isError}
              aoTentarCampanhasDeNovo={() => void campanhasQuery.refetch()}
              conversoes={conversoes}
              timezone={timezone}
              podeVerValores={podeVerValores}
              dimensao={dimensaoOrigem}
              aoMudarDimensao={setDimensaoOrigem}
            />
          ) : null}
          {abaAtiva === "comercial" && funil && agenda ? (
            <AbaComercial
              funil={funil}
              agenda={agenda}
              pivo={agenda.pivo}
              faturamento={podeVerValores ? faturamentoQuery.data : null}
              faturamentoComErro={podeVerValores && faturamentoQuery.isError}
              aoTentarFaturamentoDeNovo={() => void faturamentoQuery.refetch()}
              linhaDeBase={linhaDeBaseQuery.data ?? null}
              ehAdmin={ehAdmin}
              podeVerValores={podeVerValores}
              timezone={timezone}
              dimensao={dimensaoAgenda}
              aoMudarDimensao={setDimensaoAgenda}
              aoMudarLinhaDeBase={() =>
                queryClient.invalidateQueries({
                  queryKey: relatoriosKeys.linhaDeBase(clinicId),
                })
              }
            />
          ) : null}
          {abaAtiva === "ia" && atendimento ? (
            <AbaAgenteIa
              atendimento={atendimento}
              canalOficial={canalOficial}
              podeVerValores={podeVerValores}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function formatarDia(dia: string): string {
  const [ano, mes, diaN] = dia.split("-");
  return `${diaN}/${mes}/${ano!.slice(2)}`;
}

function contarDias(diaDe: string, diaAte: string): number {
  const de = new Date(`${diaDe}T00:00:00Z`).getTime();
  const ate = new Date(`${diaAte}T00:00:00Z`).getTime();
  return Math.round((ate - de) / 86_400_000) + 1;
}
