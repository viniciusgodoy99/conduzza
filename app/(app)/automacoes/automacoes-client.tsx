"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AbaRegua } from "@/components/automacoes/aba-regua";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import type { VolumesDaEstimativa } from "@/lib/queries/automacoes";
import {
  confirmacoesKeys,
  fetchReguasDaClinica,
  type ReguasDaClinica,
} from "@/lib/queries/confirmacoes";

// Tela 7, Automacoes: a aba vive na URL (?aba=confirmacao) para link direto,
// mesmo padrao de Configuracoes. As reguas usam a MESMA chave de cache do
// painel da Tela 2: mexer aqui atualiza la e vice-versa.
//
// Follow-up de leads e Lista de espera aparecem DESABILITADAS com dica, nunca
// escondidas (regra 5): follow-up chega na fase seguinte desta tarefa, lista
// de espera e a 4.9.

const ABAS = [
  ["confirmacao", "Confirmação"],
  ["pos_falta", "Pós falta"],
  ["followup", "Follow-up de leads"],
  ["espera", "Lista de espera"],
] as const;

type AbaKey = (typeof ABAS)[number][0];
const ABAS_PRONTAS: AbaKey[] = ["confirmacao", "pos_falta"];

const DICA_POR_ABA: Partial<Record<AbaKey, string>> = {
  followup: "Chega na próxima atualização, junto com o motor por etapa.",
  espera: "Chega com a Lista de espera.",
};

export function AutomacoesClient({
  clinicId,
  nomeDaClinica,
  abaInicial,
  reguasIniciais,
  volumes,
  podeEditar,
  dicaSemPermissao,
}: {
  clinicId: string;
  nomeDaClinica: string;
  abaInicial?: string;
  reguasIniciais: ReguasDaClinica;
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

  const invalidar = () =>
    queryClient.invalidateQueries({
      queryKey: confirmacoesKeys.regua(clinicId),
    });

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
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

      <TabsContent value="confirmacao" className="grid gap-4">
        <p className="max-w-prose text-sm text-text-secondary">
          As mensagens que confirmam a consulta antes da hora, com os botões
          Confirmar, Remarcar e Cancelar. A resposta do paciente muda a agenda
          sozinha, com autoria registrada.
        </p>
        <AbaRegua
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
            precoCents: volumes.precoCents,
          }}
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
            precoCents: volumes.precoCents,
          }}
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          aoMudar={invalidar}
        />
      </TabsContent>
    </Tabs>
  );
}
