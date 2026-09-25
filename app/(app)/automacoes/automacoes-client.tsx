"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarX,
  CircleDashed,
  Hourglass,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AbaRegua } from "@/components/automacoes/aba-regua";
import {
  AbaFollowup,
  type EtapaParaFollowup,
} from "@/components/automacoes/aba-followup";
import { Excecoes } from "@/components/automacoes/excecoes";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { REGUA_STATUS, type StatusDefinition } from "@/lib/design/status";
import { createClient } from "@/lib/supabase/client";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import { cn } from "@/lib/utils";
import {
  automacoesKeys,
  fetchExcecoesDeConfirmacao,
  fetchFollowups,
  type ExcecaoDeConfirmacao,
  type ProcedimentoParaExcecao,
  type ReguaDeFollowup,
  type VolumesDaEstimativa,
} from "@/lib/queries/automacoes";
import {
  confirmacoesKeys,
  fetchReguasDaClinica,
  type ReguasDaClinica,
} from "@/lib/queries/confirmacoes";

// Tela 7, Automacoes: a aba vive na URL (?aba=confirmacao) para link direto,
// mesmo padrao de Configuracoes. As reguas usam a MESMA chave de cache do
// painel da Tela 2: mexer aqui atualiza la e vice-versa.
//
// A aba Lista de espera nao tem regua propria: a reoferta e mecanica de
// fila e mora na Tela 10 (/espera), entao aqui ela vira o cartao que explica
// e leva para la.
//
// Desenho do design system (docs/06 secao 5.10): as abas viram quatro
// cartoes seletores, ainda Tabs do Radix (role=tab, setas e ?aba= iguais).
// Cada cartao diz o nome (nome acessivel exato) e a situacao em 3 camadas
// (REGUA_STATUS), ligada ao cartao por aria-describedby, com o numero de
// mensagens enviadas em 24 horas que a tela ja busca.

const ABAS: readonly {
  chave: "confirmacao" | "pos_falta" | "followup" | "espera";
  rotulo: string;
  icone: LucideIcon;
}[] = [
  { chave: "confirmacao", rotulo: "Confirmação", icone: CalendarCheck },
  { chave: "pos_falta", rotulo: "Pós falta", icone: CalendarX },
  { chave: "followup", rotulo: "Follow-up de leads", icone: Repeat },
  { chave: "espera", rotulo: "Lista de espera", icone: Hourglass },
];

type AbaKey = (typeof ABAS)[number]["chave"];

/** Regua que ainda nao existe: ausencia, neutra, como nos outros mapas. */
const NAO_CONFIGURADA: StatusDefinition = {
  label: "Não configurada",
  tone: "neutral",
  icon: CircleDashed,
};

type SituacaoDoCartao = {
  /** O cartao acende o ladrilho quando ha regua ligada. */
  ligada: boolean;
  chip: StatusDefinition | null;
  nota: React.ReactNode;
};

function enviadas(total: number): React.ReactNode {
  return (
    <>
      <span className="cz-num">{total}</span>{" "}
      {total === 1 ? "enviada" : "enviadas"} em{" "}
      <span className="cz-num">24</span> h
    </>
  );
}
const ABAS_PRONTAS: AbaKey[] = [
  "confirmacao",
  "pos_falta",
  "followup",
  "espera",
];

export function AutomacoesClient({
  clinicId,
  nomeDaClinica,
  abaInicial,
  reguasIniciais,
  excecoesIniciais,
  followupsIniciais,
  etapasParaFollowup,
  volumes,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
}: {
  clinicId: string;
  nomeDaClinica: string;
  abaInicial?: string;
  reguasIniciais: ReguasDaClinica;
  excecoesIniciais: {
    excecoes: ExcecaoDeConfirmacao[];
    procedimentos: ProcedimentoParaExcecao[];
  };
  followupsIniciais: ReguaDeFollowup[];
  etapasParaFollowup: EtapaParaFollowup[];
  volumes: VolumesDaEstimativa;
  podeEditar: boolean;
  dicaSemPermissao: string;
  /** So o administrador registra a linha de base (aviso ao ligar). */
  ehAdministrador: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const supabase = createClient();

  const abaAtiva: AbaKey = ABAS_PRONTAS.includes(abaInicial as AbaKey)
    ? (abaInicial as AbaKey)
    : "confirmacao";

  const trocarAba = (aba: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aba", aba);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const { data: reguas } = useQuery({
    queryKey: confirmacoesKeys.regua(clinicId),
    queryFn: () => fetchReguasDaClinica(supabase, clinicId),
    initialData: reguasIniciais,
  });
  const { data: dadosDeExcecao } = useQuery({
    queryKey: automacoesKeys.excecoes(clinicId),
    queryFn: () => fetchExcecoesDeConfirmacao(supabase, clinicId),
    initialData: excecoesIniciais,
  });
  const { data: followups } = useQuery({
    queryKey: automacoesKeys.followups(clinicId),
    queryFn: () => fetchFollowups(supabase, clinicId),
    initialData: followupsIniciais,
  });

  const invalidar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: confirmacoesKeys.regua(clinicId),
      }),
      queryClient.invalidateQueries({
        queryKey: automacoesKeys.excecoes(clinicId),
      }),
      queryClient.invalidateQueries({
        queryKey: automacoesKeys.followups(clinicId),
      }),
    ]);
  };

  // Situacao de cada cartao, com dado que a tela ja tem (nada novo buscado).
  const situacaoDaRegua = (
    regua: ReguasDaClinica["confirmacao"],
    enviadas24h: number,
  ): SituacaoDoCartao =>
    regua
      ? {
          ligada: regua.active,
          chip: REGUA_STATUS[regua.active ? "ligada" : "desligada"],
          nota: enviadas(enviadas24h),
        }
      : { ligada: false, chip: NAO_CONFIGURADA, nota: null };

  const followupsLigados = followups.filter((regua) => regua.active).length;
  const situacoes: Record<AbaKey, SituacaoDoCartao> = {
    // A confirmacao inclui as excecoes: todas sao reguas desta aba.
    confirmacao: situacaoDaRegua(
      reguas.confirmacao,
      (reguas.confirmacao?.enviados_24h ?? 0) +
        dadosDeExcecao.excecoes.reduce(
          (soma, regua) => soma + regua.enviados_24h,
          0,
        ),
    ),
    pos_falta: situacaoDaRegua(
      reguas.pos_falta,
      reguas.pos_falta?.enviados_24h ?? 0,
    ),
    followup:
      followups.length === 0
        ? {
            ligada: false,
            chip: { ...NAO_CONFIGURADA, label: "Nenhuma régua" },
            nota: null,
          }
        : {
            ligada: followupsLigados > 0,
            chip: REGUA_STATUS[followupsLigados > 0 ? "ligada" : "desligada"],
            nota: (
              <>
                <span className="cz-num">{followupsLigados}</span> de{" "}
                <span className="cz-num">{followups.length}</span> ligadas,{" "}
                {enviadas(
                  followups.reduce(
                    (soma, regua) => soma + regua.enviados_24h,
                    0,
                  ),
                )}
              </>
            ),
          },
    espera: {
      ligada: false,
      chip: null,
      nota: "A reoferta mora na Lista de espera",
    },
  };

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
      <TabsList
        variant="cartoes"
        className="grid-cols-1 items-stretch sm:grid-cols-2 xl:grid-cols-4"
      >
        {ABAS.map((aba) => {
          const situacao = situacoes[aba.chave];
          const Icone = aba.icone;
          const idSituacao = `automacoes-situacao-${aba.chave}`;
          return (
            <TabsTrigger
              key={aba.chave}
              value={aba.chave}
              aria-label={aba.rotulo}
              aria-describedby={idSituacao}
              className="flex h-auto min-h-[88px] items-start justify-start gap-3 rounded-card border border-border bg-card p-3.5 text-left whitespace-normal shadow-sm transition-[box-shadow,translate,background-color,border-color] duration-(--dur-base) ease-standard hover:-translate-y-px hover:shadow-md motion-reduce:hover:translate-y-0 data-active:border-primary-edge data-active:bg-primary-soft"
            >
              <span
                className={cn(
                  "grid size-[34px] shrink-0 place-items-center rounded-md",
                  situacao.ligada
                    ? "bg-primary-soft text-primary-text"
                    : "bg-surface-4 text-text-secondary",
                )}
              >
                <Icone className="size-[17px]" aria-hidden />
              </span>
              <span className="grid min-w-0 gap-1.5">
                <span className="text-[13.5px] leading-tight font-bold text-text-strong">
                  {aba.rotulo}
                </span>
                <span
                  id={idSituacao}
                  className="grid justify-items-start gap-1"
                >
                  {situacao.chip ? (
                    <StatusChip size="sm" definition={situacao.chip} />
                  ) : null}
                  {situacao.nota ? (
                    <span className="text-[11px] leading-snug text-text-secondary">
                      {situacao.nota}
                    </span>
                  ) : null}
                </span>
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="confirmacao" className="grid gap-4">
        <p className="max-w-[62ch] text-[13.5px] text-text-secondary">
          As mensagens que confirmam a consulta antes da hora, com os botões
          Confirmar, Remarcar e Cancelar. A resposta do paciente muda a agenda
          sozinha, com autoria registrada.
        </p>
        <AbaRegua
          clinicId={clinicId}
          regua={reguas.confirmacao}
          copy={{
            ligar: "Ligar a régua de confirmação",
            ligada: "Régua ligada",
            desligada: "Régua desligada",
            inicioDaLinha: "Agendou",
            fimDaLinha: "Consulta",
            vazio:
              "Esta clínica ainda não tem a régua de confirmação configurada.",
          }}
          nomeDaClinica={nomeDaClinica}
          botoesDaPreview={MENU_CONFIRMACAO.map((opcao) => opcao.text)}
          estimativa={{
            eventos30d: volumes.consultas30d,
            rotuloDoEvento: "consultas marcadas",
            rotuloDoEventoSingular: "consulta marcada",
            precoCents: volumes.precoCents,
          }}
          sentidoDoPasso="antes"
          tipoDaRegua="confirmacao"
          eventoRotulo="a consulta"
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          ehAdministrador={ehAdministrador}
          aoMudar={invalidar}
        />
        <Excecoes
          clinicId={clinicId}
          excecoes={dadosDeExcecao.excecoes}
          procedimentos={dadosDeExcecao.procedimentos}
          nomeDaClinica={nomeDaClinica}
          precoCents={volumes.precoCents}
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          ehAdministrador={ehAdministrador}
          aoMudar={invalidar}
        />
      </TabsContent>

      <TabsContent value="pos_falta" className="grid gap-4">
        {/* A falta so se marca na Agenda (achados 54 e 64). */}
        <p className="max-w-[62ch] text-[13.5px] text-text-secondary">
          As mensagens que buscam o paciente de volta depois de uma falta. Saem
          só para quem foi marcado como falta na Agenda.
        </p>
        <AbaRegua
          clinicId={clinicId}
          regua={reguas.pos_falta}
          copy={{
            ligar: "Ligar a régua de recuperação depois da falta",
            ligada: "Recuperação ligada",
            desligada: "Recuperação desligada",
            inicioDaLinha: "Falta registrada",
            fimDaLinha: null,
            vazio:
              "Esta clínica ainda não tem a régua de recuperação configurada.",
          }}
          nomeDaClinica={nomeDaClinica}
          estimativa={{
            eventos30d: volumes.faltas30d,
            rotuloDoEvento: "faltas registradas",
            rotuloDoEventoSingular: "falta registrada",
            precoCents: volumes.precoCents,
          }}
          sentidoDoPasso="depois"
          tipoDaRegua="pos_falta"
          eventoRotulo="a falta"
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          ehAdministrador={ehAdministrador}
          aoMudar={invalidar}
        />
      </TabsContent>

      <TabsContent value="followup" className="grid gap-4">
        <p className="max-w-[62ch] text-[13.5px] text-text-secondary">
          Mensagens de acompanhamento por etapa da jornada: o lead entrou na
          etapa, esperou o tempo configurado e ainda não respondeu nem se moveu,
          a mensagem sai. Quem responde, agenda ou muda de etapa sai da régua na
          hora.
        </p>
        <AbaFollowup
          clinicId={clinicId}
          followups={followups}
          etapas={etapasParaFollowup}
          nomeDaClinica={nomeDaClinica}
          precoCents={volumes.precoCents}
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          ehAdministrador={ehAdministrador}
          aoMudar={invalidar}
        />
      </TabsContent>

      <TabsContent value="espera" className="grid gap-4">
        <Card className="max-w-[62ch]">
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-[34px] shrink-0 place-items-center rounded-md bg-surface-4 text-text-secondary">
                <Hourglass className="size-[17px]" aria-hidden />
              </span>
              <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
                A reoferta não é uma régua de texto
              </h2>
            </div>
            <p className="text-[13.5px] text-text-secondary">
              Quando uma consulta é cancelada, o sistema oferece o horário para
              quem está na lista de espera, em ondas, e o primeiro que responde
              SIM leva. A fila, a configuração da onda e o acompanhamento das
              ofertas moram na tela de Lista de espera.
            </p>
            <Button asChild variant="outline" className="w-fit">
              <Link href="/espera">Abrir a Lista de espera</Link>
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
