"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  FileUser,
  MessageSquareText,
  UserRoundX,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { abrirDetalheDoContatoAction } from "@/app/(app)/leads/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { ChipDeOrigem } from "@/components/leads/chip-de-origem";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CONSENT_STATUS,
  CONTACT_RECENCY,
  STATUS_TONE_VARS,
} from "@/lib/design/status";
import {
  definicaoDaEtapa,
  porChave,
  type EtapaDaJornada,
} from "@/lib/domain/jornada";
import { recencyDe } from "@/lib/domain/leads-ui";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  leadsKeys,
  type LeadResumo,
  type MensagemDoLead,
} from "@/lib/queries/leads";

// Drawer da ficha rapida do lead (480px, docs/06 secao 5.4): resumo, dados de
// origem e as ultimas 3 mensagens da conversa aberta. O detalhe vem da
// abrirDetalheDoContatoAction, nao de uma consulta do navegador: a conversa e
// dado de paciente, entao a leitura precisa deixar rastro de QUEM abriu a
// ficha de QUEM (regra 3.1). O conteudo de mensagem aparece aqui e nunca em
// log.
//
// Botoes do rodape (achados 99 e 100 da revisao):
// - Abrir ficha: /pacientes/<id>, que funciona tambem para lead (a ficha nao
//   filtra por tipo e grava a trilha de leitura). E o unico caminho para
//   registrar a autorizacao ou corrigir o cadastro de quem nao tem conversa;
// - Abrir conversa: leva a conversa aberta do contato e fica desabilitado,
//   com dica, quando nao ha conversa aberta. Para o profissional, a RLS so
//   mostra as conversas atribuidas a ele: o texto diz isso, em vez de afirmar
//   que o contato nao tem conversa (achado 7);
// - Agendar: abre a Agenda ja com o agendamento deste contato. Respeita a
//   permissao da Agenda: sem ela, visivel, desabilitado e com dica, porque a
//   Agenda nao abre o modal do link para quem nao agenda (achados 6 e 22).

const AUTOR_LABEL: Record<MensagemDoLead["author"], string> = {
  paciente: "Paciente",
  ia: "IA",
  usuario: "Equipe",
  sistema: "Sistema",
};

function Linha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
      <span className="text-text-secondary">{rotulo}</span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

function Autorizacao({ autorizado }: { autorizado: boolean }) {
  const definicao = autorizado
    ? CONSENT_STATUS.autorizado
    : CONSENT_STATUS.sem_autorizacao;
  const Icone = definicao.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-medium"
      style={{ color: STATUS_TONE_VARS[definicao.tone].text }}
    >
      {Icone ? (
        <Icone className="size-[15px] shrink-0 self-center" aria-hidden />
      ) : null}
      {autorizado ? "Autorizado" : "Sem autorização"}
    </span>
  );
}

export function DrawerLead({
  clinicId,
  lead,
  jornada,
  timezone,
  membros,
  podeEditar,
  dica,
  podeAgendar,
  dicaAgendar,
  soAtribuidas,
  onFechar,
}: {
  clinicId: string;
  lead: LeadResumo | null;
  jornada: EtapaDaJornada[];
  timezone: string;
  membros: Record<string, string>;
  podeEditar: boolean;
  dica: string;
  /** Permissao da Agenda (modulo de destino do "Agendar") */
  podeAgendar: boolean;
  dicaAgendar: string;
  /** Profissional: a RLS so mostra as conversas atribuidas a ele */
  soAtribuidas: boolean;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);

  const detalheQuery = useQuery({
    queryKey: leadsKeys.detalhe(lead?.id ?? "nenhum"),
    queryFn: async () => {
      const resultado = await abrirDetalheDoContatoAction(lead?.id ?? "");
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.detalhe;
    },
    enabled: lead !== null,
    staleTime: 30_000,
  });
  const detalhe = detalheQuery.data ?? null;

  const recencia = lead ? recencyDe(lead.last_contact_at, new Date()) : null;
  const origem = lead ? rotuloDoCanal(lead.source_channel) : null;
  const defs = porChave(jornada);
  const defDoLead = lead ? defs.get(lead.funnel_stage) : undefined;
  const jaPerdido = defDoLead?.papel === "perdido";
  const conversaId = detalhe?.conversation_id ?? null;
  const semConversa = soAtribuidas
    ? "Nenhuma conversa aberta deste contato atribuída a você."
    : "Este contato não tem conversa aberta no WhatsApp.";
  const dicaSemConversa = detalheQuery.isLoading
    ? "Conferindo se este contato tem conversa aberta."
    : detalheQuery.isError
      ? "Não foi possível conferir a conversa deste contato."
      : semConversa;

  return (
    <Sheet open={lead !== null} onOpenChange={(a) => (!a ? onFechar() : null)}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        {lead ? (
          <>
            <SheetHeader className="flex-row items-start gap-3">
              <ContactAvatar
                name={lead.name}
                phone={lead.phone_e164}
                size={44}
              />
              <div className="grid min-w-0 gap-1">
                <SheetTitle className="truncate">
                  {lead.name ?? formatarTelefone(lead.phone_e164)}
                </SheetTitle>
                {lead.name ? (
                  <p className="cz-num text-[13px] text-text-secondary">
                    {formatarTelefone(lead.phone_e164)}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {defDoLead ? (
                    <StatusChip definition={definicaoDaEtapa(defDoLead)} />
                  ) : (
                    <span className="text-[13px] text-text-secondary">
                      {lead.funnel_stage}
                    </span>
                  )}
                  {origem ? <ChipDeOrigem rotulo={origem} size="md" /> : null}
                  {recencia && lead.last_contact_at ? (
                    <StatusChip
                      definition={CONTACT_RECENCY[recencia]}
                      label={tempoRelativo(lead.last_contact_at)}
                    />
                  ) : null}
                </div>
              </div>
            </SheetHeader>

            <div className="cz-scroll min-h-0 flex-1 overflow-y-auto">
              <section className="grid gap-2.5 border-b border-border px-5 py-4">
                <h3 className="cz-eyebrow text-text-secondary">Dados</h3>
                <Linha rotulo="Entrou em">
                  <span className="cz-num">
                    {dataLocal(lead.first_contact_at, timezone)}
                  </span>
                </Linha>
                <Linha rotulo="Responsável">
                  {lead.owner_user_id ? (
                    (membros[lead.owner_user_id] ?? (
                      <span className="text-text-secondary">
                        Sem responsável
                      </span>
                    ))
                  ) : (
                    <span className="text-text-secondary">Sem responsável</span>
                  )}
                </Linha>
                <Linha rotulo="Autorização">
                  <Autorizacao autorizado={lead.consent_ativo} />
                </Linha>
                <Linha rotulo="Etiquetas do lead">
                  {lead.tags.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {lead.tags.map((etiqueta) => (
                        <span
                          key={etiqueta}
                          className="inline-flex h-6 max-w-full items-center rounded-sm border border-border-strong bg-card px-2.5 text-xs font-medium text-foreground"
                        >
                          <span className="truncate">{etiqueta}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-text-secondary">Nenhuma</span>
                  )}
                </Linha>
                <Linha rotulo="Campanha">
                  {detalhe?.campanha_nome ?? lead.source_campaign ?? (
                    <span className="text-text-secondary">Sem campanha</span>
                  )}
                </Linha>
              </section>

              <section className="grid gap-3 px-5 py-4">
                <h3 className="cz-eyebrow text-text-secondary">Conversa</h3>
                {detalheQuery.isLoading ? (
                  <ListSkeleton rows={3} />
                ) : detalheQuery.isError ? (
                  <div className="grid justify-items-start gap-2">
                    <p className="text-[13px] text-text-secondary">
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
                ) : !conversaId || !detalhe ? (
                  <p className="text-[13px] text-text-secondary">
                    {semConversa}
                  </p>
                ) : detalhe.mensagens.length === 0 ? (
                  <p className="text-[13px] text-text-secondary">
                    A conversa aberta ainda não tem mensagens com o contato.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {detalhe.mensagens.map((mensagem) => (
                      <div
                        key={mensagem.id}
                        className="grid gap-0.5 rounded-xl bg-surface-4 px-3 py-2"
                      >
                        <span className="text-[11px] font-semibold text-text-secondary">
                          {AUTOR_LABEL[mensagem.author]}
                          {" · "}
                          <span className="cz-num font-medium">
                            {new Date(mensagem.created_at).toLocaleString(
                              "pt-BR",
                              {
                                timeZone: timezone,
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                        </span>
                        <span className="text-[13px] break-words text-foreground">
                          {mensagem.body ?? `(${mensagem.content_type})`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <SheetFooter className="grid grid-cols-2 gap-2 sm:grid">
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/pacientes/${lead.id}`} prefetch={false}>
                  <FileUser className="size-4" />
                  Abrir ficha
                </Link>
              </Button>
              {conversaId ? (
                <Button variant="outline" className="w-full" asChild>
                  <Link
                    href={`/atendimento?conversa=${conversaId}`}
                    prefetch={false}
                  >
                    <MessageSquareText className="size-4" />
                    Abrir conversa
                  </Link>
                </Button>
              ) : (
                <DisabledWithHint hint={dicaSemConversa} className="w-full">
                  <Button variant="outline" className="w-full" disabled>
                    <MessageSquareText className="size-4" />
                    Abrir conversa
                  </Button>
                </DisabledWithHint>
              )}
              {podeAgendar ? (
                <Button variant="outline" className="w-full" asChild>
                  <Link href={`/agenda?agendar=${lead.id}`} prefetch={false}>
                    <CalendarPlus className="size-4" />
                    Agendar
                  </Link>
                </Button>
              ) : (
                <DisabledWithHint hint={dicaAgendar} className="w-full">
                  <Button variant="outline" className="w-full" disabled>
                    <CalendarPlus className="size-4" />
                    Agendar
                  </Button>
                </DisabledWithHint>
              )}
              {podeEditar && !jaPerdido ? (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setPerdaIds([lead.id])}
                >
                  <UserRoundX className="size-4" />
                  Marcar perdido
                </Button>
              ) : (
                <DisabledWithHint
                  hint={jaPerdido ? "Este lead já está em Perdido" : dica}
                  className="w-full"
                >
                  <Button variant="destructive" className="w-full" disabled>
                    <UserRoundX className="size-4" />
                    Marcar perdido
                  </Button>
                </DisabledWithHint>
              )}
            </SheetFooter>
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
                            funnel_stage: "perdido",
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
