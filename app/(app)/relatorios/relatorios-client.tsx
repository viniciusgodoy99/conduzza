"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  AbaAgendamentos,
  montarDetalheDaAgenda,
  type DimensaoDaAgenda,
} from "@/components/relatorios/aba-agendamentos";
import { AbaConfirmacao } from "@/components/relatorios/aba-confirmacao";
import { AbaCustos } from "@/components/relatorios/aba-custos";
import { AbaIa, formatarDuracao } from "@/components/relatorios/aba-ia";
import {
  AbaOrigem,
  montarDetalheDeOrigem,
} from "@/components/relatorios/aba-origem";
import {
  ExportarRelatorio,
  type ExportavelDaAba,
} from "@/components/relatorios/exportar-relatorio";
import { CardsSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import {
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchFunilDoPeriodo,
  fetchLinhaDeBase,
  relatoriosKeys,
  type AgendaDoPeriodo,
  type AtendimentoDoPeriodo,
  type FunilDoPeriodo,
  type LinhaDeBase,
  type Periodizado,
  type PivoDaRegua,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos } from "@/lib/utils/moeda";

// Tela 11, Relatorios: aba e periodo vivem na URL (?aba=&de=&ate=) para link
// direto, padrao de Automacoes e Confirmacoes. O periodo e em DIAS CIVIS da
// clinica; a conversao para instante acontece no fetcher (regra 3.6). A
// exportacao sempre reflete a aba ATIVA, na dimensao ativa.

const ABAS = [
  ["origem", "Origem"],
  ["agendamentos", "Agendamentos"],
  ["ia", "IA"],
  ["confirmacao", "Confirmação"],
  ["custos", "Custos"],
] as const;

type AbaKey = (typeof ABAS)[number][0];
const TODAS: AbaKey[] = ["origem", "agendamentos", "ia", "confirmacao", "custos"];

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function RelatoriosClient({
  clinicId,
  timezone,
  ehAdmin,
  abaInicial,
  diaDeInicial,
  diaAteInicial,
  diaDePadrao,
  diaAtePadrao,
  funilInicial,
  agendaInicial,
  atendimentoInicial,
  conversoes,
  linhaDeBaseInicial,
}: {
  clinicId: string;
  timezone: string;
  ehAdmin: boolean;
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
  conversoes: ConversoesResumo;
  linhaDeBaseInicial: LinhaDeBase;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);

  const abaAtiva: AbaKey = TODAS.includes(abaInicial as AbaKey)
    ? (abaInicial as AbaKey)
    : "origem";

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

  const [dimensaoOrigem, setDimensaoOrigem] = useState<"canal" | "campanha">(
    "canal",
  );
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
  useDadosDoServidor(relatoriosKeys.linhaDeBase(clinicId), linhaDeBaseInicial);

  const funilQuery = useQuery({
    queryKey: relatoriosKeys.funil(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchFunilDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? funilInicial : undefined,
    staleTime: 60_000,
    enabled: abaAtiva === "origem",
  });
  const agendaQuery = useQuery({
    queryKey: relatoriosKeys.agenda(clinicId, diaDe, diaAte, null),
    queryFn: () =>
      fetchAgendaDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? agendaInicial : undefined,
    staleTime: 60_000,
    enabled: abaAtiva === "agendamentos" || abaAtiva === "confirmacao",
  });
  const atendimentoQuery = useQuery({
    queryKey: relatoriosKeys.atendimento(clinicId, diaDe, diaAte),
    queryFn: () =>
      fetchAtendimentoDoPeriodo(supabase, clinicId, timezone, diaDe, diaAte),
    initialData: recorteInicial ? atendimentoInicial : undefined,
    staleTime: 60_000,
    enabled: abaAtiva === "ia" || abaAtiva === "custos",
  });
  const linhaDeBaseQuery = useQuery({
    queryKey: relatoriosKeys.linhaDeBase(clinicId),
    queryFn: () => fetchLinhaDeBase(supabase, clinicId),
    initialData: linhaDeBaseInicial,
    staleTime: 60_000,
  });

  const periodoRotulo = `${formatarDia(diaDe)} a ${formatarDia(diaAte)}`;
  const filtroAtivo = diaDe !== diaDePadrao || diaAte !== diaAtePadrao;

  const montarExportavel = (): ExportavelDaAba => {
    // A exportacao e o retrato da aba ATIVA, sem linha inventada: quando a
    // aba e de cartoes, o CSV vira "Indicador;Valor" com os MESMOS numeros.
    if (abaAtiva === "origem") {
      const funil = funilQuery.data;
      const detalhe = funil
        ? montarDetalheDeOrigem(funil.atual, dimensaoOrigem)
        : [];
      return {
        titulo:
          dimensaoOrigem === "canal"
            ? "Resultados por canal"
            : "Resultados por campanha",
        linhas: [
          ["Origem", "Leads", "Agendaram", "Compareceram", "Conversão"],
          ...detalhe.map((linha) => [
            linha.rotulo,
            String(linha.leads),
            String(linha.agendaram),
            String(linha.compareceram),
            linha.conversao,
          ]),
        ],
      };
    }
    if (abaAtiva === "agendamentos") {
      const agenda = agendaQuery.data;
      const detalhe = agenda
        ? montarDetalheDaAgenda(agenda.atual, dimensaoAgenda)
        : [];
      return {
        titulo: "Agendamentos no período",
        linhas: [
          ["Detalhe", "Consultas", "Compareceram", "Faltaram"],
          ...detalhe.map((linha) => [
            linha.rotulo,
            String(linha.total),
            linha.compareceu === null ? "" : String(linha.compareceu),
            linha.faltou === null ? "" : String(linha.faltou),
          ]),
        ],
      };
    }
    if (abaAtiva === "confirmacao") {
      const agenda = agendaQuery.data;
      const linhaDeBase = linhaDeBaseQuery.data;
      const atual = agenda?.atual;
      return {
        titulo: "Confirmação e faltas no período",
        linhas: [
          ["Indicador", "Valor"],
          ...(atual
            ? [
                ["Consultas no período", String(atual.total)],
                [
                  "Confirmadas em algum momento",
                  `${atual.confirmadasAlgumaVez} de ${atual.total}`,
                ],
                ["Faltas", String(atual.porStatus.faltou)],
                [
                  "Recuperadas pela lista de espera",
                  String(atual.recuperadas.total),
                ],
                [
                  "Receita recuperada",
                  formatarCentavos(atual.recuperadas.receitaCents),
                ],
                [
                  "Remarcaram após a falta",
                  `${atual.remarcadasAposFalta.remarcadas} de ${atual.remarcadasAposFalta.faltas}`,
                ],
              ]
            : []),
          ...(linhaDeBase
            ? [
                [
                  "Linha de base (informada pela clínica)",
                  `${linhaDeBase.ratePercent}%`,
                ],
              ]
            : []),
        ],
      };
    }
    if (abaAtiva === "ia") {
      const atual = atendimentoQuery.data?.atual;
      return {
        titulo: "Atendimento no período",
        linhas: [
          ["Indicador", "Valor"],
          ...(atual
            ? [
                ["Conversas iniciadas", String(atual.conversasIniciadas)],
                [
                  "Novas conversas respondidas",
                  `${atual.primeiraResposta.respondidas} de ${atual.primeiraResposta.conversas}`,
                ],
                [
                  "Primeira resposta (mediana)",
                  formatarDuracao(atual.primeiraResposta.medianaSegundos),
                ],
                [
                  "Primeira resposta (90% em até)",
                  formatarDuracao(atual.primeiraResposta.p90Segundos),
                ],
              ]
            : []),
        ],
      };
    }
    const atual = atendimentoQuery.data?.atual;
    return {
      titulo: "Mensagens no período",
      linhas: [
        ["Indicador", "Valor"],
        ...(atual
          ? [
              ["Mensagens enviadas", String(atual.mensagens.saida)],
              ["Mensagens recebidas", String(atual.mensagens.entrada)],
              ["Notas internas", String(atual.mensagens.notasInternas)],
              ...Object.entries(atual.mensagens.porAutor).map(
                ([autor, total]) => [`Enviadas por ${autor}`, String(total)],
              ),
            ]
          : []),
      ],
    };
  };

  const carregando =
    (abaAtiva === "origem" && !funilQuery.data) ||
    ((abaAtiva === "agendamentos" || abaAtiva === "confirmacao") &&
      !agendaQuery.data) ||
    ((abaAtiva === "ia" || abaAtiva === "custos") && !atendimentoQuery.data);
  const comErro =
    funilQuery.isError || agendaQuery.isError || atendimentoQuery.isError;

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
            className="h-10 w-[150px]"
            aria-label="Período a partir de"
          />
          <span className="text-xs text-text-tertiary">até</span>
          <Input
            type="date"
            value={diaAte}
            onChange={(evento) => {
              const valor = evento.target.value;
              if (valor && DIA_RE.test(valor)) {
                setParams({ ate: valor, de: valor >= diaDe ? diaDe : valor });
              }
            }}
            className="h-10 w-[150px]"
            aria-label="Período até"
          />
        </div>
        <span className="text-sm text-text-tertiary">
          comparado com os {contarDias(diaDe, diaAte)} dias anteriores
        </span>
        {filtroAtivo ? (
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => setParams({ de: null, ate: null })}
          >
            <X strokeWidth={1.5} className="size-4" aria-hidden />
            Últimos 30 dias
          </Button>
        ) : null}
        <div className="ml-auto">
          <ExportarRelatorio
            aba={abaAtiva}
            periodoRotulo={periodoRotulo}
            montar={montarExportavel}
          />
        </div>
      </div>

      <Tabs
        value={abaAtiva}
        onValueChange={(aba) => setParams({ aba })}
        className="gap-4"
      >
        <TabsList className="h-auto flex-wrap justify-start">
          {ABAS.map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="min-h-9">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {comErro ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          Não foi possível carregar os resultados agora. Tente de novo em
          instantes.
        </p>
      ) : carregando ? (
        <CardsSkeleton cards={4} />
      ) : (
        <>
          {abaAtiva === "origem" && funilQuery.data ? (
            <AbaOrigem
              funil={funilQuery.data}
              conversoes={conversoes}
              timezone={timezone}
              dimensao={dimensaoOrigem}
              aoMudarDimensao={setDimensaoOrigem}
            />
          ) : null}
          {abaAtiva === "agendamentos" && agendaQuery.data ? (
            <AbaAgendamentos
              agenda={agendaQuery.data}
              dimensao={dimensaoAgenda}
              aoMudarDimensao={setDimensaoAgenda}
            />
          ) : null}
          {abaAtiva === "confirmacao" && agendaQuery.data ? (
            <AbaConfirmacao
              agenda={agendaQuery.data}
              pivo={agendaQuery.data.pivo}
              linhaDeBase={linhaDeBaseQuery.data ?? null}
              ehAdmin={ehAdmin}
              timezone={timezone}
              aoMudarLinhaDeBase={() =>
                queryClient.invalidateQueries({
                  queryKey: relatoriosKeys.linhaDeBase(clinicId),
                })
              }
            />
          ) : null}
          {abaAtiva === "ia" && atendimentoQuery.data ? (
            <AbaIa atendimento={atendimentoQuery.data} />
          ) : null}
          {abaAtiva === "custos" && atendimentoQuery.data ? (
            <AbaCustos atendimento={atendimentoQuery.data} />
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
