"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, History, MoreVertical, Printer } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  ConteudoDaLinhaDoHistorico,
  momentoNoFuso,
} from "@/components/agenda/linha-do-historico";
import { PrintDay } from "@/components/agenda/print-day";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
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
// consulta, quem mudou e quando (achado 84), inclusive as remarcacoes. Sem o
// dado do dia (busca falhou), imprimir e exportar ficam visiveis e
// desabilitados, com o porque: antes saia papel vazio (achado 83).

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
  dados: AgendaDia | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const idSemDado = useId();

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
    if (!dados) {
      return;
    }
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
    if (!dados) {
      return;
    }
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
            className="print:hidden"
            aria-label="Mais ações da agenda"
          >
            <MoreVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            disabled={!dados}
            aria-describedby={!dados ? idSemDado : undefined}
            onSelect={() => void imprimir()}
          >
            <Printer aria-hidden />
            Imprimir agenda do dia
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!dados}
            aria-describedby={!dados ? idSemDado : undefined}
            onSelect={() => void exportarCsv()}
          >
            <Download aria-hidden />
            Exportar CSV
          </DropdownMenuItem>
          {!dados ? (
            <p
              id={idSemDado}
              className="px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary"
            >
              A agenda deste dia não carregou. Tente de novo antes de imprimir
              ou exportar.
            </p>
          ) : null}
          <DropdownMenuItem onSelect={() => setHistoricoAberto(true)}>
            <History aria-hidden />
            Ver histórico de alterações
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <SheetContent className="cz-scroll overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Histórico de alterações</SheetTitle>
            <SheetDescription>
              Mudanças de situação e remarcações das consultas de{" "}
              <span className="cz-num">{dataFormatada}</span>.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-3 px-5 pb-6">
            {historicoQuery.isPending ? (
              <div className="grid gap-2" aria-label="Carregando histórico">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : historicoQuery.isError ? (
              <Aviso
                tom="alert"
                role="alert"
                acao={
                  <Button
                    variant="outline"
                    onClick={() => void historicoQuery.refetch()}
                  >
                    Tentar de novo
                  </Button>
                }
              >
                Não foi possível carregar o histórico.
              </Aviso>
            ) : (historicoQuery.data ?? []).length === 0 ? (
              <EmptyState
                compact
                icon={History}
                title="Nenhuma alteração neste dia"
              />
            ) : (
              <ol className="grid">
                {(historicoQuery.data ?? []).map((linha) => (
                  <li
                    key={linha.id}
                    className="grid min-h-10 gap-1.5 border-b border-border py-2.5 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-semibold text-text-strong">
                        {linha.consulta?.paciente ?? "Paciente"}
                      </span>
                      {linha.consulta ? (
                        <span className="text-xs text-text-secondary">
                          consulta de{" "}
                          <span className="cz-num">
                            {momentoNoFuso(
                              contexto.timezone,
                              linha.consulta.starts_at,
                            )}
                          </span>
                          {nomeDoProfissional(linha.consulta.professional_id)
                            ? ` com ${nomeDoProfissional(linha.consulta.professional_id)}`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <ConteudoDaLinhaDoHistorico
                        linha={linha}
                        timezone={contexto.timezone}
                        nomeDoProfissional={nomeDoProfissional}
                      />
                      <span className="ml-auto cz-num text-xs text-text-secondary">
                        {momentoNoFuso(contexto.timezone, linha.changed_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Portal no body: com a tela da Agenda print:hidden, um PrintDay
          filho dela nunca imprimiria. */}
      {imprimindo && dados
        ? createPortal(
            <PrintDay contexto={contexto} dia={dia} dados={dados} />,
            document.body,
          )
        : null}
    </>
  );
}
