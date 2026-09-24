"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  ConteudoDaLinhaDoHistorico,
  momentoNoFuso,
} from "@/components/agenda/linha-do-historico";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  agendaKeys,
  fetchHistorico,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";
import { createClient } from "@/lib/supabase/client";

// Historico da consulta, em folha lateral e em ordem cronologica: cada linha
// traz a situacao (chip em 3 camadas) ou a remarcacao (de qual horario para
// qual), o nome de quem mudou e o momento no fuso da clinica.

export function StatusHistorySheet({
  contexto,
  consulta,
  aberto,
  onFechar,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  aberto: boolean;
  onFechar: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);

  const historicoQuery = useQuery({
    queryKey: agendaKeys.historico(consulta.id),
    queryFn: () => fetchHistorico(supabase, consulta.id),
    enabled: aberto,
    staleTime: 30_000,
  });

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const nomes = useMemo(
    () => new Map(contexto.catalogo.profissionais.map((p) => [p.id, p.name])),
    [contexto.catalogo.profissionais],
  );
  const nomeDoProfissional = (id: string | null) =>
    id ? (nomes.get(id) ?? null) : null;

  return (
    <Sheet open={aberto} onOpenChange={(open) => (!open ? onFechar() : null)}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Histórico da consulta</SheetTitle>
          <SheetDescription>
            {nome}
            {" · "}
            {consulta.service_link?.procedure?.name ?? "Procedimento"}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-3 overflow-y-auto px-4 pb-6">
          {historicoQuery.isPending && aberto ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : historicoQuery.isError ? (
            <p
              role="alert"
              className="rounded-md px-3 py-2 text-sm"
              style={{
                color: "var(--alert-text)",
                backgroundColor: "var(--alert-bg)",
              }}
            >
              Não foi possível carregar o histórico. Feche e tente de novo.
            </p>
          ) : (historicoQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-text-tertiary">
              Sem mudanças registradas
            </p>
          ) : (
            <ol className="grid gap-2">
              {(historicoQuery.data ?? []).map((linha) => (
                <li
                  key={linha.id}
                  className="flex min-h-10 flex-wrap items-start gap-x-2 gap-y-1 border-b border-border pb-2 last:border-b-0"
                >
                  <ConteudoDaLinhaDoHistorico
                    linha={linha}
                    timezone={contexto.timezone}
                    nomeDoProfissional={nomeDoProfissional}
                  />
                  <span className="ml-auto font-mono text-xs text-text-tertiary tabular-nums">
                    {momentoNoFuso(contexto.timezone, linha.changed_at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
