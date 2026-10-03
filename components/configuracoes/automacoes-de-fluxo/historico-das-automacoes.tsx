"use client";

import { useQuery } from "@tanstack/react-query";
import { History, RefreshCw } from "lucide-react";
import { useState } from "react";

import { historicoDeAutomacoesDeFluxoAction } from "@/app/(app)/configuracoes/automacoes-de-fluxo-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  descreverExecucao,
  quandoNaClinica,
  resolvedorDeNomes,
  type AutomacaoDeFluxo,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import {
  automacoesDeFluxoKeys,
  LIMITE_DO_HISTORICO,
} from "@/lib/queries/automacoes-de-fluxo";

import { EXECUCAO_STATUS } from "./status-da-execucao";

// Historico das ultimas execucoes: o que a automacao fez (de/para quando
// moveu), por que pulou ou que falhou, com quem e quando, no relogio da
// clinica. Nunca o conteudo de mensagem. O que fez sai do retrato gravado na
// propria execucao (acao e etiqueta da hora), nunca da regra como esta hoje;
// da regra atual so vem o nome. O nome do lead e dado de paciente: vem da
// historicoDeAutomacoesDeFluxoAction, que grava a trilha de leitura antes de
// devolver.

/** Valor do Select para "todas" (o Radix nao aceita vazio). */
const TODAS = "__todas__";

export function HistoricoDasAutomacoes({
  automacoes,
  jornada,
  etiquetas,
  clinicId,
  timezone,
}: {
  automacoes: readonly AutomacaoDeFluxo[];
  jornada: readonly EtapaDaJornada[];
  etiquetas: readonly EtiquetaDeConversa[] | null;
  clinicId: string;
  timezone: string;
}) {
  const [filtro, setFiltro] = useState<string | null>(null);
  // Regra excluida some do filtro: volta para todas.
  const automacaoId =
    filtro !== null && automacoes.some((regra) => regra.id === filtro)
      ? filtro
      : null;

  const consulta = useQuery({
    queryKey: automacoesDeFluxoKeys.historico(clinicId, automacaoId),
    queryFn: async () => {
      const resultado = await historicoDeAutomacoesDeFluxoAction(automacaoId);
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.execucoes;
    },
    staleTime: 30_000,
  });

  const porId = new Map(automacoes.map((regra) => [regra.id, regra]));
  const nomes = {
    etapa: resolvedorDeNomes(jornada),
    etiqueta: resolvedorDeNomes(etiquetas),
  };
  const agora = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico</CardTitle>
        <CardDescription>
          As últimas {LIMITE_DO_HISTORICO} vezes que uma automação rodou: o que
          fez, com qual lead e quando. Sem o conteúdo das mensagens.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Atualizar o histórico"
            disabled={consulta.isFetching}
            onClick={() => void consulta.refetch()}
          >
            <RefreshCw
              aria-hidden
              className={
                consulta.isFetching ? "motion-safe:animate-spin" : undefined
              }
            />
          </Button>
        </CardAction>
      </CardHeader>

      {automacoes.length > 1 ? (
        <div className="grid max-w-[360px] gap-1.5 px-4 pb-3">
          <label
            htmlFor="historico-filtro"
            className="text-xs font-semibold text-foreground"
          >
            Automação
          </label>
          <Select
            value={automacaoId ?? TODAS}
            onValueChange={(valor) => setFiltro(valor === TODAS ? null : valor)}
          >
            <SelectTrigger id="historico-filtro" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas as automações</SelectItem>
              {automacoes.map((regra) => (
                <SelectItem key={regra.id} value={regra.id}>
                  {regra.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {consulta.isPending ? (
        <div role="status" className="grid gap-3 px-4 pb-4">
          <span className="sr-only">Carregando o histórico</span>
          {Array.from({ length: 4 }).map((_, indice) => (
            <div key={indice} aria-hidden className="grid gap-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      ) : consulta.isError ? (
        <EmptyState
          compact
          tom="erro"
          title="Não foi possível carregar o histórico"
          description="Tente de novo. Se continuar, fale com o suporte."
        >
          <Button variant="outline" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </Button>
        </EmptyState>
      ) : consulta.data.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title="Nenhuma execução ainda"
          description={
            automacaoId
              ? "Esta automação ainda não rodou. Quando rodar, aparece aqui o que ela fez, com qual lead e quando."
              : "Quando uma automação ligada rodar, aparece aqui o que ela fez, com qual lead e quando."
          }
        />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {consulta.data.map((execucao) => {
            const regra = porId.get(execucao.automacao_id);
            const frase = descreverExecucao(execucao, nomes);
            const instante = execucao.executada_em ?? execucao.created_at;
            return (
              <li
                key={execucao.id}
                className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3"
              >
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip
                      size="sm"
                      definition={EXECUCAO_STATUS[execucao.status]}
                    />
                    <span className="truncate text-[13px] font-semibold text-text-strong">
                      {execucao.contato ?? "Contato sem nome"}
                    </span>
                    <span className="truncate text-xs text-text-secondary">
                      {regra?.nome ?? "Automação"}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground">
                    {frase.texto}
                    {frase.codigo ? (
                      <span className="ml-1.5 cz-num text-[11.5px] text-text-secondary">
                        ({frase.codigo})
                      </span>
                    ) : null}
                  </p>
                </div>
                <time
                  dateTime={instante}
                  className="cz-num text-xs whitespace-nowrap text-text-secondary"
                >
                  {quandoNaClinica(instante, timezone, agora)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
