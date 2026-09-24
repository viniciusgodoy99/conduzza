"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AbaRegua } from "@/components/automacoes/aba-regua";
import {
  AbaFollowup,
  type EtapaParaFollowup,
} from "@/components/automacoes/aba-followup";
import { Excecoes } from "@/components/automacoes/excecoes";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
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

const ABAS = [
  ["confirmacao", "Confirmação"],
  ["pos_falta", "Pós falta"],
  ["followup", "Follow-up de leads"],
  ["espera", "Lista de espera"],
] as const;

type AbaKey = (typeof ABAS)[number][0];
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

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
      <TabsList className="h-auto flex-wrap justify-start">
        {ABAS.map(([key, label]) => (
          <TabsTrigger key={key} value={key} className="min-h-9">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="confirmacao" className="grid gap-4">
        <p className="max-w-prose text-sm text-text-secondary">
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
          aoMudar={invalidar}
        />
      </TabsContent>

      <TabsContent value="pos_falta" className="grid gap-4">
        <p className="max-w-prose text-sm text-text-secondary">
          As mensagens que buscam o paciente de volta depois de uma falta. Saem
          só para quem foi marcado como falta na tela de Confirmações.
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
          aoMudar={invalidar}
        />
      </TabsContent>

      <TabsContent value="followup" className="grid gap-4">
        <p className="max-w-prose text-sm text-text-secondary">
          Mensagens de acompanhamento por etapa da jornada: o lead entrou na
          etapa, esperou o tempo configurado e ainda não respondeu nem se
          moveu, a mensagem sai. Quem responde, agenda ou muda de etapa sai da
          régua na hora.
        </p>
        <AbaFollowup
          clinicId={clinicId}
          followups={followups}
          etapas={etapasParaFollowup}
          nomeDaClinica={nomeDaClinica}
          precoCents={volumes.precoCents}
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          aoMudar={invalidar}
        />
      </TabsContent>

      <TabsContent value="espera" className="grid gap-4">
        <div className="grid max-w-prose gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Hourglass
              strokeWidth={1.5}
              className="size-4 text-text-secondary"
              aria-hidden
            />
            <h2 className="text-[15px] font-semibold">
              A reoferta não é uma régua de texto
            </h2>
          </div>
          <p className="text-sm text-text-secondary">
            Quando uma consulta é cancelada, o sistema oferece o horário para
            quem está na lista de espera, em ondas, e o primeiro que responde
            SIM leva. A fila, a configuração da onda e o acompanhamento das
            ofertas moram na tela de Lista de espera.
          </p>
          <Button asChild variant="outline" className="h-10 w-fit">
            <Link href="/espera">Abrir a Lista de espera</Link>
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
