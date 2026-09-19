"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { mudarEtapaAction } from "@/app/(app)/leads/actions";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";
import { STATUS_TONE_VARS } from "@/lib/design/status";

// Trocar a etapa do contato SEM sair da conversa (pedido do dono em
// 19/09/2026): o mesmo mudarEtapaAction do Kanban, com o mesmo desvio por
// PAPEL para perdido (motivo obrigatorio via ModalMotivoPerda) e a mesma
// matriz de permissao de leads (profissional e leitura veem desabilitado
// com dica, nunca escondido).

export function EtapaDoContato({
  contactId,
  etapaAtual,
  jornada,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  contactId: string;
  etapaAtual: string;
  jornada: EtapaDaJornada[];
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);

  const trocar = (chave: string) => {
    if (chave === etapaAtual) {
      return;
    }
    const destino = jornada.find((etapa) => etapa.chave === chave);
    if (!destino) {
      return;
    }
    if (destino.papel === "perdido") {
      // Nada persiste antes do motivo: o modal e a unica porta (mesma regra
      // do Kanban).
      setPerdaIds([contactId]);
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await mudarEtapaAction({
        contact_ids: [contactId],
        etapa: chave,
      });
      if (resultado.ok) {
        toast.success(`Etapa alterada para ${destino.nome}.`);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível mudar a etapa.");
    });
  };

  const seletor = (
    <Select
      value={etapaAtual}
      onValueChange={trocar}
      disabled={!podeEditar || pendente}
    >
      <SelectTrigger className="h-10 w-full text-[12.5px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {jornada.map((etapa) => {
          const definicao = definicaoDaEtapa(etapa);
          const Icone = definicao.icon;
          const cores = STATUS_TONE_VARS[definicao.tone];
          return (
            <SelectItem key={etapa.chave} value={etapa.chave}>
              <span className="flex items-center gap-2">
                {Icone ? (
                  <Icone
                    strokeWidth={1.5}
                    className="size-3.5 shrink-0"
                    style={{ color: cores.text }}
                    aria-hidden
                  />
                ) : null}
                {etapa.nome}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-[12.5px]">
      <span className="text-text-tertiary">Etapa</span>
      {podeEditar ? (
        seletor
      ) : (
        <DisabledWithHint hint={dicaSemPermissao}>{seletor}</DisabledWithHint>
      )}
      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={async () => {
          setPerdaIds(null);
          await aoMudar();
        }}
      />
    </div>
  );
}
