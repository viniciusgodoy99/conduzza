"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { mudarEtapaAction } from "@/app/(app)/leads/actions";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import {
  decidirMudancaDeEtapa,
  DialogoMoverParaEtapa,
  OpcoesDeEtapa,
  type ConfirmacaoDeEtapa,
} from "@/components/leads/mudar-etapa";
import { PopoverSobDemanda } from "@/components/leads/popover-sob-demanda";
import { nomeOuTelefone } from "@/components/leads/rotulos";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";
import {
  leadsKeys,
  type LeadResumo,
  type ReguaDaEtapa,
} from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// A etapa de UM lead, na linha da lista e na gaveta (pedido do dono em
// 20/10/2026, com o print da lista: "nao consigo alterar a etapa ... por
// aqui, era pra eu conseguir"). O chip da etapa vira um botao com a seta,
// que abre a lista das etapas da jornada com a atual marcada. Escolher segue
// as regras da barra em massa (mudar-etapa.tsx): Perdido abre o motivo da
// perda, etapa com regua confirma antes, sem regua move direto. Mover e
// otimista como o arrasto do Kanban: a lista muda na hora e, se o servidor
// recusar, volta e avisa.
//
// Sem permissao (profissional e leitura) o chip continua legivel, com a
// seta apagada, desabilitado e com a dica do projeto: nunca escondido.

/**
 * Muda a etapa de um lead na cache da lista e grava. Se o servidor recusar,
 * so ESTE lead volta para onde estava, e so se ninguem mexeu nele enquanto
 * isso (outra mudanca ou o tempo real); o aviso diz o motivo. O arrasto do
 * Kanban e a etapa da linha e da gaveta usam o mesmo. Devolve se gravou.
 */
export async function moverEtapaNaHora(
  queryClient: QueryClient,
  clinicId: string,
  leadId: string,
  destino: string,
): Promise<boolean> {
  const chave = leadsKeys.lista(clinicId);
  const antes = queryClient
    .getQueryData<LeadResumo[]>(chave)
    ?.find((lead) => lead.id === leadId);
  queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
    atual?.map((lead) =>
      lead.id === leadId
        ? {
            ...lead,
            funnel_stage: destino,
            lost_reason: null,
            lost_reason_note: null,
          }
        : lead,
    ),
  );
  let resultado: { ok: boolean; error?: string };
  try {
    resultado = await mudarEtapaAction({
      contact_ids: [leadId],
      etapa: destino,
    });
  } catch {
    resultado = { ok: false };
  }
  if (resultado.ok) {
    return true;
  }
  if (antes) {
    queryClient.setQueryData<LeadResumo[]>(chave, (atual) =>
      atual?.map((lead) =>
        lead.id === leadId && lead.funnel_stage === destino
          ? {
              ...lead,
              funnel_stage: antes.funnel_stage,
              lost_reason: antes.lost_reason,
              lost_reason_note: antes.lost_reason_note,
            }
          : lead,
      ),
    );
  }
  toast.error(resultado.error ?? "Não foi possível mudar a etapa.");
  return false;
}

/**
 * Os leads que o motivo da perda gravou, ja em Perdido na lista (sem
 * esperar o tempo real). A chave de sistema 'perdido' existe em toda
 * jornada, e e ela que o motivo grava.
 */
export function aplicarPerdaNaCache(
  queryClient: QueryClient,
  clinicId: string,
  ids: readonly string[],
  motivo: string,
  nota: string | null,
): void {
  queryClient.setQueryData<LeadResumo[]>(leadsKeys.lista(clinicId), (atual) =>
    atual?.map((lead) =>
      ids.includes(lead.id)
        ? {
            ...lead,
            funnel_stage: "perdido",
            lost_reason: motivo,
            lost_reason_note: nota,
          }
        : lead,
    ),
  );
}

type ConfirmacaoDoLead = ConfirmacaoDeEtapa & { lead: LeadResumo };

/**
 * O que a linha e a gaveta precisam para mudar a etapa de um lead: escolher
 * (as regras da barra em massa), pedir o motivo da perda (o "Marcar
 * perdido" da gaveta) e os dois dialogos, montados uma vez por quem usa.
 */
export function useMudarEtapaDoLead({
  clinicId,
  reguas,
}: {
  clinicId: string;
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: ReguaDaEtapa[] | null;
}): {
  escolher: (
    lead: LeadResumo,
    etapa: EtapaDaJornada,
    gatilho?: HTMLElement | null,
  ) => void;
  pedirMotivo: (lead: LeadResumo) => void;
  dialogos: ReactNode;
} {
  const queryClient = useQueryClient();
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoDoLead | null>(
    null,
  );
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);
  // O chip que abriu o dialogo. Quando o dialogo fecha, a lista do popover
  // ja saiu da tela, e o padrao do Radix devolveria o foco a ela (ao nada).
  const voltarPara = useRef<HTMLElement | null>(null);

  const mover = (lead: LeadResumo, chave: string, nome: string) => {
    void moverEtapaNaHora(queryClient, clinicId, lead.id, chave).then(
      (gravou) => {
        if (gravou) {
          toast.success(`Etapa alterada para ${nome}.`);
        }
      },
    );
  };

  const escolher = (
    lead: LeadResumo,
    etapa: EtapaDaJornada,
    gatilho: HTMLElement | null = null,
  ) => {
    if (etapa.chave === lead.funnel_stage) {
      return;
    }
    const decisao = decidirMudancaDeEtapa(etapa, reguas);
    if (decisao.tipo === "mover") {
      mover(lead, etapa.chave, etapa.nome);
      return;
    }
    voltarPara.current = gatilho;
    if (decisao.tipo === "pedir_motivo") {
      setPerdaIds([lead.id]);
      return;
    }
    setConfirmacao({
      lead,
      chave: etapa.chave,
      nome: etapa.nome,
      regua: decisao.regua,
      reguas: decisao.reguas,
    });
  };

  const pedirMotivo = (lead: LeadResumo) => {
    voltarPara.current = null;
    setPerdaIds([lead.id]);
  };

  const devolverFoco = (evento: Event) => {
    const alvo = voltarPara.current;
    voltarPara.current = null;
    if (alvo?.isConnected) {
      evento.preventDefault();
      alvo.focus();
    }
  };

  const dialogos = (
    <>
      <DialogoMoverParaEtapa
        confirmacao={confirmacao}
        quem={{
          tipo: "lead",
          nome: confirmacao ? nomeOuTelefone(confirmacao.lead) : "",
          autorizado: confirmacao?.lead.consent_ativo ?? false,
        }}
        aoCancelar={() => setConfirmacao(null)}
        aoConfirmar={({ chave, nome }) => {
          if (confirmacao) {
            setConfirmacao(null);
            mover(confirmacao.lead, chave, nome);
          }
        }}
        aoDevolverFoco={devolverFoco}
      />
      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={(ids, motivo, nota) =>
          aplicarPerdaNaCache(queryClient, clinicId, ids, motivo, nota)
        }
        aoDevolverFoco={devolverFoco}
      />
    </>
  );

  return { escolher, pedirMotivo, dialogos };
}

/**
 * O chip da etapa como botao, com a lista das etapas. Escolher a etapa
 * atual so fecha a lista.
 */
export function SeletorDeEtapa({
  lead,
  jornada,
  reguas,
  podeEditar,
  dica,
  tamanho = "sm",
  aoEscolher,
}: {
  lead: Pick<LeadResumo, "name" | "phone_e164" | "funnel_stage">;
  jornada: readonly EtapaDaJornada[];
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: readonly ReguaDaEtapa[] | null;
  podeEditar: boolean;
  dica: string;
  /** sm (20px) na lista; md (24px) na gaveta. O alvo e de 40px nos dois */
  tamanho?: "sm" | "md";
  /** Recebe a etapa escolhida e o botao, para o foco voltar a ele */
  aoEscolher: (etapa: EtapaDaJornada, gatilho: HTMLElement | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);
  const def = jornada.find((etapa) => etapa.chave === lead.funnel_stage);
  // Etapa fora da jornada nao derruba nada: mostra a chave crua, que pelo
  // menos diz a verdade (o banco impede o caso; isto cobre cache velho na
  // troca de jornada), e a lista continua oferecendo as etapas de agora.
  const definicao = def ? definicaoDaEtapa(def) : null;
  const rotuloDaEtapa = definicao?.label ?? lead.funnel_stage;
  const seta = (
    <ChevronDown
      aria-hidden
      className={cn(
        "shrink-0 group-disabled/etapa:opacity-45",
        tamanho === "sm" ? "-mr-0.5 size-3" : "-mr-[3px] size-[13px]",
      )}
    />
  );

  const botao = (
    <button
      ref={gatilho}
      type="button"
      disabled={!podeEditar}
      aria-label={`Mudar etapa de ${nomeOuTelefone(lead)}, agora em ${rotuloDaEtapa}`}
      className="group/etapa hit-40 relative inline-flex max-w-full shrink-0 items-center rounded-full text-left outline-none cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid enabled:hover:ring-1 enabled:hover:ring-border-strong disabled:cursor-not-allowed aria-expanded:ring-1 aria-expanded:ring-border-strong"
    >
      {definicao ? (
        <StatusChip size={tamanho} definition={definicao}>
          {seta}
        </StatusChip>
      ) : (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-text-secondary",
            tamanho === "sm" ? "text-[13.5px]" : "text-[13px]",
          )}
        >
          {lead.funnel_stage}
          {seta}
        </span>
      )}
    </button>
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
      className="w-64 gap-0 p-[5px]"
      // Abre com o foco na etapa atual, nao na primeira da lista.
      onOpenAutoFocus={(evento) => {
        const atual = (
          evento.currentTarget as HTMLElement | null
        )?.querySelector<HTMLElement>('[aria-current="true"]');
        if (atual) {
          evento.preventDefault();
          atual.focus();
        }
      }}
    >
      <OpcoesDeEtapa
        jornada={jornada}
        reguas={reguas}
        etapaAtual={lead.funnel_stage}
        aoEscolher={(etapa) => {
          setAberto(false);
          if (etapa.chave !== lead.funnel_stage) {
            aoEscolher(etapa, gatilho.current);
          }
        }}
      />
    </PopoverSobDemanda>
  );
}
