"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListFilter, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { AbaAgenteIa } from "@/components/relatorios/aba-agente-ia";
import { AbaComercial } from "@/components/relatorios/aba-comercial";
import { AbaMarketing } from "@/components/relatorios/aba-marketing";
import { AbaVisaoGeral } from "@/components/relatorios/aba-visao-geral";
import { ExportarRelatorio } from "@/components/relatorios/exportar-relatorio";
import { Aviso } from "@/components/shared/aviso";
import { CardsSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  montarExportavelDaAba,
  type DimensaoDaAgenda,
  type DimensaoDaOrigem,
} from "@/lib/domain/exportacao-de-resultados";
import {
  GRUPOS_DE_ORIGEM,
  ROTULO_DO_GRUPO_DE_ORIGEM,
  ROTULO_TODAS_AS_ORIGENS,
  avisoDoFiltroDeOrigem,
  lerGrupoDeOrigem,
  textoDeLeads,
  type GrupoDeOrigem,
} from "@/lib/domain/grupos-de-origem";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import {
  ABAS_DE_RESULTADOS,
  fetchAgendaDoPeriodo,
  fetchAnunciosDoPeriodo,
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
// O detalhe por anuncio (anuncios_do_periodo, 20/10/2026) so e buscado com a
// aba Marketing e essa dimensao escolhida; a exportacao espera por ele.
//
// Painel por origem (decisao do dono de 17/11/2026): o seletor "Origem" vive
// na URL (?origem=meta, google, outras ou nao_rastreada; sem o parametro,
// todas as origens). So funil_do_periodo e serie_diaria_do_periodo recebem o
// filtro; o aviso abaixo das abas diz, pelos nomes da tela, o que acompanha
// a origem na aba aberta e o que continua com todas (avisoDoFiltroDeOrigem).

/** Valor do seletor para "Todas as origens" (nunca vai para a URL). */
const TODAS_AS_ORIGENS = "todas";

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
  grupoInicial,
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
  /** A origem validada que o servidor usou no funil e na serie iniciais. */
  grupoInicial: GrupoDeOrigem | null;
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
  // Mesma validacao do servidor: valor fora da lista e "todas as origens".
  const grupo = lerGrupoDeOrigem(searchParams.get("origem"));
  // Funil e serie do servidor so servem ao mesmo recorte E a mesma origem.
  const filtroInicial = recorteInicial && grupo === grupoInicial;
  // O MESMO recorte vai para a lista de Leads quando uma linha da origem e
  // clicada (pedido do dono em 20/10/2026): os dias civis da clinica, que a
  // lista converte no mesmo fuso.
  const periodo = useMemo(() => ({ diaDe, diaAte }), [diaDe, diaAte]);

  const [dimensaoOrigem, setDimensaoOrigem] =
    useState<DimensaoDaOrigem>("canal");
  const [dimensaoAgenda, setDimensaoAgenda] =
    useState<DimensaoDaAgenda>("profissional");

  // O que a tela acabou de pedir para o endereco e ainda nao voltou em
  // searchParams. Duas mudancas seguidas (trocar de aba e, logo depois, a
  // origem) partem do ultimo pedido, nao do endereco velho: sem isto a
  // segunda desfazia a primeira (achado do teste do painel por origem,
  // 17/11/2026). Vale por 2 segundos; depois manda o endereco, que tambem
  // muda pelo botao de voltar do navegador.
  const pedido = useRef<{ qs: string; em: number } | null>(null);
  const paramsAtuais = () => {
    const ultimo = pedido.current;
    return new URLSearchParams(
      ultimo && Date.now() - ultimo.em < 2000
        ? ultimo.qs
        : searchParams.toString(),
    );
  };

  const setParams = (mudancas: Record<string, string | null>) => {
    const params = paramsAtuais();
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") {
        params.delete(chave);
      } else {
        params.set(chave, valor);
      }
    }
    const qs = params.toString();
    pedido.current = { qs, em: Date.now() };
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Atalho de dentro de um bloco ("Ver detalhes em Comercial"): troca a aba
  // e leva ao topo da vista nova, ou a ancora pedida.
  const irParaAba = (aba: AbaDeResultados, ancora?: string) => {
    const params = paramsAtuais();
    params.set("aba", aba);
    pedido.current = { qs: params.toString(), em: Date.now() };
    router.replace(
      `${pathname}?${params.toString()}${ancora ? `#${ancora}` : ""}`,
    );
  };

  // O que cada aba precisa. Funil, agenda e atendimento sao o corpo da aba
  // (sem eles a aba nao abre); serie e faturamento sao blocos com estado
  // proprio de carregando e erro.
  const precisaFunil = abaAtiva !== "ia";
  const precisaAgenda = abaAtiva === "geral" || abaAtiva === "comercial";
  const precisaAtendimento = abaAtiva === "geral" || abaAtiva === "ia";
  // Marketing desenha "Origem dos leads por dia" com a serie.
  const precisaSerie = abaAtiva === "geral" || abaAtiva === "marketing";
  const precisaFaturamento =
    podeVerValores && (abaAtiva === "geral" || abaAtiva === "comercial");
  const precisaCampanhas = abaAtiva === "geral" || abaAtiva === "marketing";
  // Desde 26/10/2026 os anuncios entram na Visao geral e no Marketing: sem
  // campanha, o quadro Campanhas mostra os anuncios, e a Origem dos leads, a
  // divisao por plataforma (pedido do dono).
  const precisaAnuncios = abaAtiva === "geral" || abaAtiva === "marketing";

  useDadosDoServidor(
    relatoriosKeys.funil(clinicId, diaDeInicial, diaAteInicial, grupoInicial),
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
    relatoriosKeys.serie(clinicId, diaDeInicial, diaAteInicial, grupoInicial),
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
    queryKey: relatoriosKeys.funil(clinicId, diaDe, diaAte, grupo),
    queryFn: () =>
      fetchFunilDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte, {
        grupo,
      }),
    initialData: filtroInicial ? funilInicial : undefined,
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
    queryKey: relatoriosKeys.serie(clinicId, diaDe, diaAte, grupo),
    queryFn: () =>
      fetchSerieDiariaDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte, {
        grupo,
      }),
    initialData: filtroInicial ? serieInicial : undefined,
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
  const anunciosQuery = useQuery({
    queryKey: relatoriosKeys.anuncios(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchAnunciosDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    staleTime: 60_000,
    enabled: precisaAnuncios,
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
      (campanhasQuery.data !== undefined && !campanhasQuery.isError)) &&
    (!precisaAnuncios ||
      (anunciosQuery.data !== undefined && !anunciosQuery.isError));

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
      anuncios: precisaAnuncios ? anunciosQuery.data : undefined,
      timezone,
      grupo,
      dimensaoOrigem,
      dimensaoAgenda,
    });

  const funil = funilQuery.data;
  const agenda = agendaQuery.data;
  const atendimento = atendimentoQuery.data;

  // Leads do periodo em cada origem, sempre sem o filtro: o numero ao lado
  // de cada opcao. null (banco sem o campo, ou funil ainda carregando): as
  // opcoes saem so com o nome.
  const leadsPorGrupo = funil?.atual.porGrupo ?? null;
  const aviso = grupo
    ? avisoDoFiltroDeOrigem(abaAtiva, grupo, dimensaoOrigem)
    : null;

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
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-secondary">Origem</span>
          <Select
            value={grupo ?? TODAS_AS_ORIGENS}
            onValueChange={(valor) =>
              setParams({ origem: lerGrupoDeOrigem(valor) })
            }
          >
            <SelectTrigger className="w-44" aria-label="Origem">
              <SelectValue>
                {grupo
                  ? ROTULO_DO_GRUPO_DE_ORIGEM[grupo]
                  : ROTULO_TODAS_AS_ORIGENS}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS_AS_ORIGENS}>
                {ROTULO_TODAS_AS_ORIGENS}
                {leadsPorGrupo ? (
                  <span className="cz-num text-text-secondary">
                    {textoDeLeads(
                      GRUPOS_DE_ORIGEM.reduce(
                        (soma, chave) => soma + leadsPorGrupo[chave],
                        0,
                      ),
                    )}
                  </span>
                ) : null}
              </SelectItem>
              {GRUPOS_DE_ORIGEM.map((chave) => (
                <SelectItem key={chave} value={chave}>
                  {ROTULO_DO_GRUPO_DE_ORIGEM[chave]}
                  {leadsPorGrupo ? (
                    <span className="cz-num text-text-secondary">
                      {textoDeLeads(leadsPorGrupo[chave])}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto">
          <ExportarRelatorio
            aba={abaAtiva}
            grupo={grupo}
            periodoRotulo={periodoRotulo}
            montar={montarExportavel}
            desabilitado={carregando || comErro || !blocosProntos}
            periodo={periodo}
            podeExportarParaOGoogle={podeVerValores}
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

      {aviso ? (
        <Aviso tom="neutral" icone={ListFilter} titulo={aviso.titulo}>
          {aviso.texto}
          {aviso.notaDaTela ? ` ${aviso.notaDaTela}` : null}
        </Aviso>
      ) : null}

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
              periodo={periodo}
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
              anuncios={anunciosQuery.data}
              anunciosComErro={anunciosQuery.isError}
              filtrado={grupo !== null}
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
              periodo={periodo}
              campanhas={campanhasQuery.data}
              campanhasComErro={campanhasQuery.isError}
              aoTentarCampanhasDeNovo={() => void campanhasQuery.refetch()}
              anuncios={anunciosQuery.data}
              anunciosComErro={anunciosQuery.isError}
              aoTentarAnunciosDeNovo={() => void anunciosQuery.refetch()}
              serie={serieQuery.data}
              serieComErro={serieQuery.isError}
              aoTentarSerieDeNovo={() => void serieQuery.refetch()}
              grupo={grupo}
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
