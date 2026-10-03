"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { atividadesDoContatoAction } from "@/app/(app)/atividades/actions";
import { SecaoDeAtividades } from "@/components/atividades/secao-de-atividades";
import { atividadesKeys } from "@/lib/queries/atividades";
import { leadsKeys } from "@/lib/queries/leads";

// Secao "Atividades" do painel de contexto do Atendimento: cumpre o "criar
// lembrete" das acoes rapidas do Inbox (spec 1.9). O dado vem da
// atividadesDoContatoAction, que grava a trilha de leitura com o id do
// contato antes de devolver o texto (regra 3.1); o navegador nunca le
// contact_activity direto. A atividade criada aqui guarda a conversa.

export function AtividadesDaConversa({
  contato,
  conversationId,
  timezone,
  podeEditar,
  dica,
}: {
  contato: { id: string; name: string | null; phone_e164: string };
  conversationId: string;
  timezone: string;
  podeEditar: boolean;
  dica: string;
}) {
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: atividadesKeys.doContato(contato.id),
    queryFn: async () => {
      const resultado = await atividadesDoContatoAction(contato.id);
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado;
    },
    staleTime: 30_000,
  });

  return (
    <SecaoDeAtividades
      contato={{
        id: contato.id,
        nome: contato.name,
        telefone: contato.phone_e164,
      }}
      conversationId={conversationId}
      timezone={timezone}
      estado={
        consulta.isPending ? "carregando" : consulta.isError ? "erro" : "pronto"
      }
      atividades={consulta.data?.atividades ?? null}
      aoTentarDeNovo={() => void consulta.refetch()}
      aoMudar={() => {
        void queryClient.invalidateQueries({ queryKey: atividadesKeys.todas });
        void queryClient.invalidateQueries({
          queryKey: leadsKeys.detalhe(contato.id),
        });
      }}
      equipe={consulta.data?.equipe}
      nomes={consulta.data?.equipe.nomes ?? {}}
      podeEditar={podeEditar}
      dica={dica}
      // Ja estamos na conversa: o atalho dela sairia daqui para ela mesma.
      comAtalhos={{ conversa: false, ficha: true }}
    />
  );
}
