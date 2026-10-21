"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { etiquetarAction } from "@/app/(app)/leads/actions";
import { PainelEtiquetarLead } from "@/components/leads/etiquetar-lead";
import { PopoverSobDemanda } from "@/components/leads/popover-sob-demanda";
import { nomeOuTelefone } from "@/components/leads/rotulos";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  outrasGrafias,
  type LeituraDasEtiquetas,
  type OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";
import { leadsKeys, type LeadResumo } from "@/lib/queries/leads";

// Etiquetar UM lead, no "+" da linha da lista e da gaveta, e o X dos chips
// da gaveta (pedido do dono em 20/10/2026: "nao consigo ... adicionar uma
// etiqueta por aqui, era pra eu conseguir"). O "+" abre o MESMO painel da
// barra em massa (PainelEtiquetarLead, alvo "lead"): as etiquetas da
// clinica e as em uso, a grafia que ja existe, criar uma nova e tirar as
// que o lead tem. Grava pelo mesmo etiquetarAction, com um id so, e a lista
// muda na hora; se o servidor recusar, a mudanca volta e o aviso diz o
// motivo. Como na barra, o popover fecha depois de etiquetar.

/** Junta e tira, na ordem do banco: entra o que falta, sai o que foi pedido. */
function trocarEtiquetas(
  tags: readonly string[],
  entram: readonly string[],
  saem: readonly string[],
): string[] {
  return [...new Set([...tags, ...entram])].filter(
    (tag) => !saem.includes(tag),
  );
}

/**
 * Etiqueta um lead na cache da lista e grava. Se o servidor recusar, desfaz
 * so o que ESTE pedido mudou (outra etiqueta posta enquanto isso fica) e
 * avisa. Devolve se gravou.
 */
export async function etiquetarNaHora(
  queryClient: QueryClient,
  clinicId: string,
  leadId: string,
  adicionar: readonly string[],
  remover: readonly string[],
): Promise<boolean> {
  const chave = leadsKeys.lista(clinicId);
  const antes =
    queryClient
      .getQueryData<LeadResumo[]>(chave)
      ?.find((lead) => lead.id === leadId)?.tags ?? [];
  const entraram = adicionar.filter((tag) => !antes.includes(tag));
  const sairam = remover.filter((tag) => antes.includes(tag));
  const aplicar = (entram: readonly string[], saem: readonly string[]) =>
    queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
      atual?.map((lead) =>
        lead.id === leadId
          ? { ...lead, tags: trocarEtiquetas(lead.tags, entram, saem) }
          : lead,
      ),
    );

  aplicar(entraram, sairam);
  let resultado: { ok: boolean; error?: string };
  try {
    resultado = await etiquetarAction({
      contact_ids: [leadId],
      adicionar: [...adicionar],
      remover: [...remover],
    });
  } catch {
    resultado = { ok: false };
  }
  if (resultado.ok) {
    return true;
  }
  aplicar(sairam, entraram);
  toast.error(resultado.error ?? "Não foi possível etiquetar o lead.");
  return false;
}

/** Adicionar e remover uma etiqueta de um lead, com o aviso de cada uma. */
export function useEtiquetarUmLead(clinicId: string): {
  adicionar: (lead: Pick<LeadResumo, "id" | "tags">, nome: string) => void;
  remover: (lead: Pick<LeadResumo, "id">, nome: string) => void;
} {
  const queryClient = useQueryClient();

  // A grafia ja vem resolvida pelo painel (a da clinica, quando existe);
  // outra grafia da mesma etiqueta sai no mesmo pedido, como na barra.
  const adicionar = (lead: Pick<LeadResumo, "id" | "tags">, nome: string) => {
    const trocar = outrasGrafias(nome, [lead]);
    if (lead.tags.includes(nome) && trocar.length === 0) {
      toast.info(`Este lead já tem a etiqueta ${nome}.`);
      return;
    }
    void etiquetarNaHora(queryClient, clinicId, lead.id, [nome], trocar).then(
      (gravou) => {
        if (gravou) {
          toast.success(`Etiqueta ${nome} adicionada`);
        }
      },
    );
  };

  const remover = (lead: Pick<LeadResumo, "id">, nome: string) => {
    void etiquetarNaHora(queryClient, clinicId, lead.id, [], [nome]).then(
      (gravou) => {
        if (gravou) {
          toast.success(`Etiqueta ${nome} removida`);
        }
      },
    );
  };

  return { adicionar, remover };
}

/**
 * O "+" de um lead: abre o painel de etiquetar para ele. Sem permissao,
 * visivel e desabilitado com a dica, nunca escondido.
 */
export function BotaoEtiquetarLead({
  lead,
  podeEditar,
  dica,
  opcoes,
  leitura,
  aoTentarDeNovo,
  aoAdicionar,
  aoRemover,
  tamanho = "icon",
}: {
  lead: Pick<LeadResumo, "name" | "phone_e164" | "tags">;
  podeEditar: boolean;
  dica: string;
  /** As cadastradas e as em uso, sem repetir (opcoesDeEtiqueta) */
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  aoTentarDeNovo?: () => void;
  /** Recebe a grafia que vai para o lead */
  aoAdicionar: (nome: string) => void;
  aoRemover: (nome: string) => void;
  /** icon (40px) na linha da lista; icon-sm (28px com 40px de alvo) na gaveta */
  tamanho?: "icon" | "icon-sm";
}) {
  const [aberto, setAberto] = useState(false);
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const rotulo = `Etiquetar ${nomeOuTelefone(lead)}`;
  const etiquetasDoLead = [...lead.tags].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  const botao = (
    <Button
      variant="ghost"
      size={tamanho}
      aria-label={rotulo}
      disabled={!podeEditar}
      className="text-text-secondary hover:text-text-strong"
    >
      <Plus aria-hidden />
    </Button>
  );

  if (!podeEditar) {
    return <DisabledWithHint hint={dica}>{botao}</DisabledWithHint>;
  }

  return (
    <PopoverSobDemanda
      aberto={aberto}
      aoMudar={setAberto}
      gatilho={botao}
      align="start"
      className="w-72 gap-0 p-[5px]"
    >
      <PainelEtiquetarLead
        alvo="lead"
        novaEtiqueta={novaEtiqueta}
        aoDigitar={setNovaEtiqueta}
        opcoes={opcoes}
        leitura={leitura}
        aoTentarDeNovo={aoTentarDeNovo}
        etiquetasDosSelecionados={etiquetasDoLead}
        ocupado={false}
        aoAdicionar={(nome) => {
          setNovaEtiqueta("");
          setAberto(false);
          aoAdicionar(nome);
        }}
        aoRemover={(nome) => {
          setAberto(false);
          aoRemover(nome);
        }}
      />
    </PopoverSobDemanda>
  );
}
