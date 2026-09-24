"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, MoreVertical } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  ConteudoDaLinhaDoHistorico,
  momentoNoFuso,
} from "@/components/agenda/linha-do-historico";
import { PrintDay } from "@/components/agenda/print-day";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { registrarExportacaoAction } from "@/app/(app)/agenda/actions";
import { APPOINTMENT_STATUS } from "@/lib/design/status";
import {
  agendaKeys,
  fetchHistoricoDia,
  type AgendaDia,
} from "@/lib/queries/agenda";
import { createClient } from "@/lib/supabase/client";
import { baixarCsv, gerarCsv } from "@/lib/utils/csv";

// Menu de tres pontos da barra da Agenda: imprimir, exportar CSV e ver o
// historico de alteracoes do dia. Impressao e exportacao registram trilha
// (LGPD) antes do dado sair da tela. O historico diz de qual paciente e qual
// consulta, quem mudou e quando (achado 84), inclusive as remarcacoes.

function horaNoFuso(instante: string, timezone: string): string {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AgendaActionsMenu({
  contexto,
  dia,
  dados,
}: {
  contexto: ContextoAgenda;
  dia: string;
  dados: AgendaDia;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const historicoQuery = useQuery({
    queryKey: agendaKeys.historicoDia(contexto.clinicId, dia),
    queryFn: () =>
      fetchHistoricoDia(supabase, contexto.clinicId, dia, contexto.timezone),
    enabled: historicoAberto,
    staleTime: 30_000,
  });
  const nomesDosProfissionais = useMemo(
    () => new Map(contexto.catalogo.profissionais.map((p) => [p.id, p.name])),
    [contexto.catalogo.profissionais],
  );
  const nomeDoProfissional = (id: string | null) =>
    id ? (nomesDosProfissionais.get(id) ?? null) : null;

  const [imprimindo, setImprimindo] = useState(false);
  const imprimir = async () => {
    // A trilha vai ANTES de o dado sair da tela (regra 3.1): sem gravar a
    // auditoria, nao imprime.
    const auditoria = await registrarExportacaoAction(dia, "impressao");
    if (!auditoria.ok) {
      toast.error("Não foi possível registrar a impressão. Tente de novo.");
      return;
    }
    // Monta o layout de impressao SO agora: mante-lo sempre no DOM duplicava
    // os textos da grade para leitores de tela e testes. afterprint desmonta.
    setImprimindo(true);
    setTimeout(() => {
      const aoTerminar = () => {
        setImprimindo(false);
        window.removeEventListener("afterprint", aoTerminar);
      };
      window.addEventListener("afterprint", aoTerminar);
      window.print();
    }, 80);
  };

  const exportarCsv = async () => {
    const auditoria = await registrarExportacaoAction(dia, "csv");
    if (!auditoria.ok) {
      toast.error("Não foi possível registrar a exportação. Tente de novo.");
      return;
    }
    const nomeDoProfissional = new Map(
      contexto.catalogo.profissionais.map((p) => [p.id, p.name]),
    );
    const linhas: string[][] = [
      [
        "Hora",
        "Paciente",
        "Telefone",
        "Profissional",
        "Procedimento",
        "Convênio",
        "Situação",
        "Duração (min)",
      ],
      ...[...dados.consultas]
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((consulta) => {
          const duracao =
            consulta.service_link?.duration_min ??
            Math.round(
              (new Date(consulta.ends_at).getTime() -
                new Date(consulta.starts_at).getTime()) /
                60_000,
            );
          return [
            horaNoFuso(consulta.starts_at, contexto.timezone),
            consulta.contact?.name ?? "Sem nome",
            consulta.contact?.phone_e164 ?? "",
            nomeDoProfissional.get(consulta.professional_id) ?? "",
            consulta.service_link?.procedure?.name ?? "",
            consulta.service_link?.insurance?.name ?? "Particular",
            APPOINTMENT_STATUS[consulta.status].label,
            String(duracao),
          ];
        }),
    ];
    baixarCsv(`agenda-${dia}.csv`, gerarCsv(linhas));
  };

  const [ano, mes, diaN] = dia.split("-");
  const dataFormatada = `${diaN}/${mes}/${ano}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 print:hidden"
            aria-label="Mais ações da agenda"
          >
            <MoreVertical strokeWidth={1.5} className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void imprimir()}>
            Imprimir agenda do dia
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportarCsv()}>
            Exportar CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setHistoricoAberto(true)}>
            Ver histórico de alterações
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Histórico de alterações</SheetTitle>
            <SheetDescription>
              Mudanças de situação e remarcações das consultas de{" "}
              {dataFormatada}.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-3 px-4 pb-6">
            {historicoQuery.isPending ? (
              <div className="grid gap-2" aria-label="Carregando histórico">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : historicoQuery.isError ? (
              <p
                role="alert"
                className="text-sm text-[color:var(--alert-text)]"
              >
                Não foi possível carregar o histórico. Tente de novo.
              </p>
            ) : (historicoQuery.data ?? []).length === 0 ? (
              <div className="grid place-items-center gap-2 py-8 text-center">
                <History
                  strokeWidth={1.5}
                  className="size-6 text-text-tertiary"
                  aria-hidden
                />
                <p className="text-sm text-text-secondary">
                  Nenhuma alteração neste dia
                </p>
              </div>
            ) : (
              (historicoQuery.data ?? []).map((linha) => (
                <div
                  key={linha.id}
                  className="grid gap-1.5 rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-semibold">
                      {linha.consulta?.paciente ?? "Paciente"}
                    </span>
                    {linha.consulta ? (
                      <span className="text-xs text-text-secondary">
                        consulta de{" "}
                        {momentoNoFuso(
                          contexto.timezone,
                          linha.consulta.starts_at,
                        )}
                        {nomeDoProfissional(linha.consulta.professional_id)
                          ? ` com ${nomeDoProfissional(linha.consulta.professional_id)}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex min-h-10 flex-wrap items-start gap-2">
                    <ConteudoDaLinhaDoHistorico
                      linha={linha}
                      timezone={contexto.timezone}
                      nomeDoProfissional={nomeDoProfissional}
                    />
                    <span className="ml-auto font-mono text-xs text-text-secondary tabular-nums">
                      {momentoNoFuso(contexto.timezone, linha.changed_at)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Portal no body: com a tela da Agenda print:hidden, um PrintDay
          filho dela nunca imprimiria. */}
      {imprimindo
        ? createPortal(
            <PrintDay contexto={contexto} dia={dia} dados={dados} />,
            document.body,
          )
        : null}
    </>
  );
}
