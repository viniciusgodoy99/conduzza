"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, MessageSquareText, UserRoundX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import {
  dataLocal,
  rotuloDoCanal,
  tempoRelativo,
} from "@/components/leads/rotulos";
import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CONTACT_RECENCY,
  FUNNEL_STAGE,
  STATUS_TONE_VARS,
} from "@/lib/design/status";
import { recencyDe } from "@/lib/domain/leads-ui";
import {
  fetchLeadDetalhe,
  leadsKeys,
  type LeadResumo,
  type MensagemDoLead,
} from "@/lib/queries/leads";
import { createClient } from "@/lib/supabase/client";

// Drawer da ficha rapida do lead: resumo, dados de origem e as ultimas 3
// mensagens da conversa aberta (fetchLeadDetalhe, query propria que so roda
// com o drawer aberto). A leitura da tela ja esta na trilha de auditoria da
// page; o conteudo de mensagem aparece aqui e nunca em log.

const AUTOR_LABEL: Record<MensagemDoLead["author"], string> = {
  paciente: "Paciente",
  ia: "IA",
  usuario: "Equipe",
  sistema: "Sistema",
};

function Linha({ rotulo, children }: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-2 text-sm">
      <span className="text-text-tertiary">{rotulo}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function DrawerLead({
  clinicId,
  lead,
  timezone,
  membros,
  podeEditar,
  dica,
  onFechar,
}: {
  clinicId: string;
  lead: LeadResumo | null;
  timezone: string;
  membros: Record<string, string>;
  podeEditar: boolean;
  dica: string;
  onFechar: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);

  const detalheQuery = useQuery({
    queryKey: leadsKeys.detalhe(lead?.id ?? "nenhum"),
    queryFn: () => fetchLeadDetalhe(supabase, lead?.id ?? ""),
    enabled: lead !== null,
    staleTime: 30_000,
  });
  const detalhe = detalheQuery.data ?? null;

  const recencia = lead ? recencyDe(lead.last_contact_at, new Date()) : null;
  const origem = lead ? rotuloDoCanal(lead.source_channel) : null;
  const neutro = STATUS_TONE_VARS.neutral;
  const jaPerdido = lead?.funnel_stage === "perdido";

  return (
    <Sheet open={lead !== null} onOpenChange={(a) => (!a ? onFechar() : null)}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        {lead ? (
          <>
            <SheetHeader className="gap-2 border-b p-5">
              <SheetTitle className="text-base font-semibold">
                {lead.name ?? lead.phone_e164}
              </SheetTitle>
              {lead.name ? (
                <p className="font-mono text-[13px] text-text-secondary">
                  {lead.phone_e164}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusChip definition={FUNNEL_STAGE[lead.funnel_stage]} />
                {origem ? (
                  <span
                    className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap"
                    style={{ color: neutro.text, backgroundColor: neutro.bg }}
                  >
                    {origem}
                  </span>
                ) : null}
                {recencia && lead.last_contact_at ? (
                  <StatusChip
                    definition={CONTACT_RECENCY[recencia]}
                    label={tempoRelativo(lead.last_contact_at)}
                  />
                ) : null}
              </div>
            </SheetHeader>

            <div className="grid gap-2.5 border-b p-5">
              <Linha rotulo="Entrou em">
                {dataLocal(lead.first_contact_at, timezone)}
              </Linha>
              <Linha rotulo="Responsável">
                {lead.owner_user_id
                  ? (membros[lead.owner_user_id] ?? "Sem responsável")
                  : "Sem responsável"}
              </Linha>
              <Linha rotulo="Etiquetas">
                {lead.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {lead.tags.map((etiqueta) => (
                      <span
                        key={etiqueta}
                        className="inline-flex h-6 items-center rounded-full bg-surface-3 px-2.5 text-xs font-medium"
                      >
                        {etiqueta}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-text-tertiary">Nenhuma</span>
                )}
              </Linha>
              <Linha rotulo="Campanha">
                {detalhe?.campanha_nome ?? lead.source_campaign ?? (
                  <span className="text-text-tertiary">Sem campanha</span>
                )}
              </Linha>
            </div>

            <div className="grid gap-3 border-b p-5">
              <h3 className="text-sm font-semibold">Conversa</h3>
              {detalheQuery.isLoading ? (
                <ListSkeleton rows={3} />
              ) : detalheQuery.isError ? (
                <div className="grid justify-items-start gap-2">
                  <p className="text-sm text-text-secondary">
                    Não foi possível carregar a conversa.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void detalheQuery.refetch()}
                  >
                    Tentar de novo
                  </Button>
                </div>
              ) : !detalhe?.conversation_id ||
                detalhe.mensagens.length === 0 ? (
                <p className="text-sm text-text-tertiary">
                  Nenhuma conversa aberta com este contato.
                </p>
              ) : (
                <div className="grid gap-2">
                  {detalhe.mensagens.map((mensagem) => (
                    <div
                      key={mensagem.id}
                      className="grid gap-0.5 rounded-lg bg-surface-3 px-3 py-2"
                    >
                      <span className="text-[11px] font-medium text-text-tertiary">
                        {AUTOR_LABEL[mensagem.author]}
                        {" · "}
                        {new Date(mensagem.created_at).toLocaleString("pt-BR", {
                          timeZone: timezone,
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-sm break-words">
                        {mensagem.body ?? `(${mensagem.content_type})`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-2 p-5">
              <Button variant="outline" className="h-10 w-full" asChild>
                <Link href="/atendimento">
                  <MessageSquareText strokeWidth={1.5} className="size-4" />
                  Abrir conversa
                </Link>
              </Button>
              <Button variant="outline" className="h-10 w-full" asChild>
                <Link href="/agenda">
                  <CalendarPlus strokeWidth={1.5} className="size-4" />
                  Agendar
                </Link>
              </Button>
              {podeEditar && !jaPerdido ? (
                <Button
                  variant="outline"
                  className="h-10 w-full [color:var(--alert-text)]"
                  onClick={() => setPerdaIds([lead.id])}
                >
                  <UserRoundX strokeWidth={1.5} className="size-4" />
                  Marcar perdido
                </Button>
              ) : (
                <DisabledWithHint
                  hint={jaPerdido ? "Este lead já está em Perdido" : dica}
                >
                  <Button variant="outline" className="h-10 w-full" disabled>
                    <UserRoundX strokeWidth={1.5} className="size-4" />
                    Marcar perdido
                  </Button>
                </DisabledWithHint>
              )}
            </div>
          </>
        ) : null}

        <ModalMotivoPerda
          contactIds={perdaIds}
          onFechar={() => setPerdaIds(null)}
          onSucesso={(ids, motivo, nota) => {
            queryClient.setQueryData<LeadResumo[]>(
              leadsKeys.lista(clinicId),
              (atual) =>
                atual
                  ? atual.map((l) =>
                      ids.includes(l.id)
                        ? {
                            ...l,
                            funnel_stage: "perdido" as const,
                            lost_reason: motivo,
                            lost_reason_note: nota,
                          }
                        : l,
                    )
                  : atual,
            );
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
