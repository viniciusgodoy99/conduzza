"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  AbaOrigem,
  montarDetalheDeOrigem,
} from "@/components/relatorios/aba-origem";
import { ExportarRelatorio } from "@/components/relatorios/exportar-relatorio";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import {
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchFunilDoPeriodo,
  relatoriosKeys,
  type AgendaDoPeriodo,
  type AtendimentoDoPeriodo,
  type FunilDoPeriodo,
  type LinhaDeBase,
  type Periodizado,
  type PivoDaRegua,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/client";

// Tela 11, Relatorios: aba e periodo vivem na URL (?aba=&de=&ate=) para link
// direto, padrao de Automacoes e Confirmacoes. O periodo e em DIAS CIVIS da
// clinica; a conversao para instante acontece no fetcher (regra 3.6).

const ABAS = [
  ["origem", "Origem"],
  ["agendamentos", "Agendamentos"],
  ["ia", "IA"],
  ["confirmacao", "Confirmação"],
  ["custos", "Custos"],
] as const;

type AbaKey = (typeof ABAS)[number][0];
const ABAS_PRONTAS: AbaKey[] = ["origem"];

const DICA_POR_ABA: Partial<Record<AbaKey, string>> = {
  agendamentos: "Chega no próximo passo desta entrega.",
  ia: "Chega no próximo passo desta entrega.",
  confirmacao: "Chega no próximo passo desta entrega.",
  custos: "Chega no próximo passo desta entrega.",
};

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function RelatoriosClient({
  clinicId,
  timezone,
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
  const supabase = useMemo(() => createClient(), []);

  const abaAtiva: AbaKey = ABAS_PRONTAS.includes(abaInicial as AbaKey)
    ? (abaInicial as AbaKey)
    : "origem";

  // Mesma validacao do servidor: dia fora do formato (ou intervalo invertido)
  // cai no padrao, para um link torto nunca virar consulta com recorte
  // invalido.
  const deURL = searchParams.get("de");
  const ateURL = searchParams.get("ate");
  const diaDe =
    deURL && DIA_RE.test(deURL) && ateURL && DIA_RE.test(ateURL) && deURL <= ateURL
      ? deURL
      : diaDePadrao;
  const diaAte =
    deURL && DIA_RE.test(deURL) && ateURL && DIA_RE.test(ateURL) && deURL <= ateURL
      ? ateURL
      : diaAtePadrao;
  const recorteInicial = diaDe === diaDeInicial && diaAte === diaAteInicial;

  const [dimensao, setDimensao] = useState<"canal" | "campanha">("canal");

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
  void agendaQuery;
  void atendimentoQuery;

  const periodoRotulo = `${formatarDia(diaDe)} a ${formatarDia(diaAte)}`;
  const filtroAtivo = diaDe !== diaDePadrao || diaAte !== diaAtePadrao;

  const montarExportavel = () => {
    // Por aba: a tabela exportada e a MESMA que esta na tela (para a Origem,
    // na dimensao ativa). Sem linha inventada.
    const funil = funilQuery.data;
    const detalhe = funil ? montarDetalheDeOrigem(funil.atual, dimensao) : [];
    return {
      titulo:
        dimensao === "canal" ? "Resultados por canal" : "Resultados por campanha",
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
  };

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
          {ABAS.map(([key, label]) =>
            ABAS_PRONTAS.includes(key) ? (
              <TabsTrigger key={key} value={key} className="min-h-9">
                {label}
              </TabsTrigger>
            ) : (
              <DisabledWithHint key={key} hint={DICA_POR_ABA[key] ?? ""}>
                <TabsTrigger value={key} disabled className="min-h-9">
                  {label}
                </TabsTrigger>
              </DisabledWithHint>
            ),
          )}
        </TabsList>
      </Tabs>

      {abaAtiva === "origem" && funilQuery.data ? (
        <AbaOrigem
          funil={funilQuery.data}
          conversoes={conversoes}
          timezone={timezone}
          dimensao={dimensao}
          aoMudarDimensao={setDimensao}
        />
      ) : null}
      {funilQuery.isError ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          Não foi possível carregar os resultados agora. Tente de novo em
          instantes.
        </p>
      ) : null}
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
