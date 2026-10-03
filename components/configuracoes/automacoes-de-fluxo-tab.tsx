"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  alternarAutomacaoDeFluxoAction,
  excluirAutomacaoDeFluxoAction,
  usoDasAutomacoesDeFluxoAction,
} from "@/app/(app)/configuracoes/automacoes-de-fluxo-actions";
import { DialogoDeExclusao } from "@/components/automacoes/dialogo-de-exclusao";
import { DialogoDaAutomacao } from "@/components/configuracoes/automacoes-de-fluxo/dialogo-da-automacao";
import { DialogoParaLigar } from "@/components/configuracoes/automacoes-de-fluxo/dialogo-para-ligar";
import { HistoricoDasAutomacoes } from "@/components/configuracoes/automacoes-de-fluxo/historico-das-automacoes";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { REGUA_STATUS } from "@/lib/design/status";
import {
  AVISOS_FIXOS,
  descreverAcao,
  descreverGatilho,
  quandoNaClinica,
  resolvedorDeNomes,
  textoDoUso,
  type AutomacaoDeFluxo,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import { automacoesDeFluxoKeys } from "@/lib/queries/automacoes-de-fluxo";

// Aba "Automacoes de fluxo" (Configuracoes, logo depois de "Jornada e
// conversoes"; pedido do dono em 02/10/2026). Administrador e gestor criam,
// editam, ligam, desligam e excluem; os demais papeis nem chegam a esta tela
// (o layout redireciona), e ainda assim tudo fica visivel e desabilitado com
// a dica se a permissao faltar.
//
// Cada regra numa linha: nome, a situacao em 3 camadas (REGUA_STATUS, o
// mesmo par Ligada/Desligada das reguas), "Quando" e "Faz" em portugues, e
// quantas vezes rodou com a ultima vez (contagem sob demanda, sem paciente).
// Ligar pede confirmacao com a previa (nao e retroativa); desligar e direto.
// Criar e editar num dialogo. Embaixo, os avisos fixos, o atalho para a
// mensagem ao paciente (que e a regua de follow-up, em Automacoes) e o
// historico das ultimas execucoes.

type Dialogo = { regra: AutomacaoDeFluxo | null };

export function AutomacoesDeFluxoTab({
  automacoes,
  jornada,
  etiquetas,
  clinicId,
  timezone,
  podeGerenciar,
  dica,
}: {
  automacoes: AutomacaoDeFluxo[];
  jornada: EtapaDaJornada[];
  /** nulo: a leitura das etiquetas falhou */
  etiquetas: EtiquetaDeConversa[] | null;
  clinicId: string;
  timezone: string;
  podeGerenciar: boolean;
  dica: string;
}) {
  const queryClient = useQueryClient();
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [ligando, setLigando] = useState<AutomacaoDeFluxo | null>(null);
  const [excluindo, setExcluindo] = useState<AutomacaoDeFluxo | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const nomes = {
    etapa: resolvedorDeNomes(jornada),
    etiqueta: resolvedorDeNomes(etiquetas),
  };
  const ids = automacoes.map((regra) => regra.id);

  const uso = useQuery({
    queryKey: automacoesDeFluxoKeys.uso(clinicId, ids),
    queryFn: async () => {
      const resultado = await usoDasAutomacoesDeFluxoAction(ids);
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.uso;
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
  const agora = new Date();

  const invalidar = () =>
    void queryClient.invalidateQueries({
      queryKey: automacoesDeFluxoKeys.todas,
    });

  const alternar = (regra: AutomacaoDeFluxo, ativa: boolean) => {
    iniciarTransicao(async () => {
      const resultado = await alternarAutomacaoDeFluxoAction(regra.id, ativa);
      if (resultado.ok) {
        toast.success(ativa ? "Automação ligada." : "Automação desligada.");
        setLigando(null);
        invalidar();
        return;
      }
      toast.error(resultado.error);
    });
  };

  const excluir = () => {
    if (!excluindo) {
      return;
    }
    const alvo = excluindo;
    iniciarTransicao(async () => {
      const resultado = await excluirAutomacaoDeFluxoAction(alvo.id);
      if (resultado.ok) {
        toast.success("Automação excluída.");
        setExcluindo(null);
        invalidar();
        return;
      }
      toast.error(resultado.error);
    });
  };

  const botaoNova = (
    <Button
      variant="outline"
      disabled={!podeGerenciar || pendente}
      onClick={() => setDialogo({ regra: null })}
    >
      <Plus className="size-4" aria-hidden />
      Nova automação
    </Button>
  );

  const comDica = (controle: React.ReactNode) =>
    podeGerenciar ? (
      controle
    ) : (
      <DisabledWithHint hint={dica}>{controle}</DisabledWithHint>
    );

  const usoDaRegra = (regra: AutomacaoDeFluxo) => {
    if (uso.isPending) {
      return (
        <span role="status" className="inline-flex">
          <span className="sr-only">Contando as execuções</span>
          <Skeleton aria-hidden className="h-3 w-32" />
        </span>
      );
    }
    if (uso.isError) {
      return "Não foi possível contar as execuções.";
    }
    const daRegra = uso.data[regra.id] ?? { vezes: 0, ultima: null };
    return (
      <>
        {textoDoUso(daRegra)}
        {daRegra.ultima ? (
          <>
            , a última{" "}
            <time dateTime={daRegra.ultima} className="cz-num">
              {quandoNaClinica(daRegra.ultima, timezone, agora)}
            </time>
          </>
        ) : null}
      </>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Automações de fluxo da clínica</CardTitle>
          <CardDescription>
            Quando o lead fica parado, deixa de responder, entra numa etapa ou
            manda mensagem, a automação move de etapa, coloca etiqueta, cria uma
            atividade ou deixa uma nota interna.
          </CardDescription>
          <CardAction>{comDica(botaoNova)}</CardAction>
        </CardHeader>

        {automacoes.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="Nenhuma automação de fluxo ainda"
            description="Por exemplo: quem ficou 3 dias sem responder em Aguardando resposta vai para Perdido, ou quem entrou em Em contato ganha uma atividade de ligar."
          >
            {comDica(
              <Button
                disabled={!podeGerenciar || pendente}
                onClick={() => setDialogo({ regra: null })}
              >
                <Plus className="size-4" aria-hidden />
                Criar a primeira
              </Button>,
            )}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {automacoes.map((regra) => (
              <li key={regra.id} className="grid gap-2 px-4 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-bold text-text-strong">
                        {regra.nome}
                      </span>
                      <StatusChip
                        size="sm"
                        definition={
                          REGUA_STATUS[regra.ativa ? "ligada" : "desligada"]
                        }
                      />
                    </div>
                    <p className="text-[13px] text-foreground">
                      <span className="font-semibold">Quando:</span>{" "}
                      {descreverGatilho(regra, nomes.etapa)}
                    </p>
                    <p className="text-[13px] text-foreground">
                      <span className="font-semibold">Faz:</span>{" "}
                      {descreverAcao(regra, nomes)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {usoDaRegra(regra)}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {comDica(
                      <span className="inline-flex size-10 items-center justify-center">
                        <Switch
                          checked={regra.ativa}
                          disabled={!podeGerenciar || pendente}
                          aria-label={
                            regra.ativa
                              ? `Desligar ${regra.nome}`
                              : `Ligar ${regra.nome}`
                          }
                          onCheckedChange={(ligar) =>
                            ligar ? setLigando(regra) : alternar(regra, false)
                          }
                        />
                      </span>,
                    )}
                    {comDica(
                      <Button
                        variant="ghost"
                        disabled={!podeGerenciar || pendente}
                        aria-label={`Editar ${regra.nome}`}
                        onClick={() => setDialogo({ regra })}
                      >
                        <Pencil className="size-4" aria-hidden />
                        Editar
                      </Button>,
                    )}
                    {comDica(
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!podeGerenciar || pendente}
                        aria-label={`Excluir ${regra.nome}`}
                        onClick={() => setExcluindo(regra)}
                      >
                        <Trash2 aria-hidden />
                      </Button>,
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como as automações de fluxo funcionam</CardTitle>
          <CardDescription>
            Rodam sozinhas, em até 1 minuto depois do que aconteceu, e cada uma
            roda uma vez por entrada do lead na etapa.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-foreground marker:text-text-secondary">
            {AVISOS_FIXOS.map((aviso) => (
              <li key={aviso}>{aviso}</li>
            ))}
          </ul>
          <Aviso
            tom="info"
            icone={MessageSquareText}
            acao={
              <Button asChild variant="outline" size="sm">
                <Link href="/automacoes?aba=followup">Abrir o follow-up</Link>
              </Button>
            }
          >
            A mensagem para o paciente ao entrar na etapa fica em Automações
            &gt; Follow-up, com horário de envio e autorização para receber
            mensagens.
          </Aviso>
        </CardContent>
      </Card>

      <HistoricoDasAutomacoes
        automacoes={automacoes}
        jornada={jornada}
        etiquetas={etiquetas}
        clinicId={clinicId}
        timezone={timezone}
      />

      {dialogo ? (
        <DialogoDaAutomacao
          key={dialogo.regra?.id ?? "nova"}
          aberto
          aoFechar={() => setDialogo(null)}
          aoSalvar={invalidar}
          regra={dialogo.regra}
          automacoes={automacoes}
          jornada={jornada}
          etiquetas={etiquetas}
          clinicId={clinicId}
        />
      ) : null}

      <DialogoParaLigar
        regra={ligando}
        automacoes={automacoes}
        jornada={jornada}
        etiquetas={etiquetas}
        clinicId={clinicId}
        pendente={pendente}
        aoFechar={() => setLigando(null)}
        aoConfirmar={() => (ligando ? alternar(ligando, true) : undefined)}
      />

      <DialogoDeExclusao
        aberto={excluindo !== null}
        titulo={`Excluir ${excluindo?.nome ?? "a automação"}?`}
        descricao="A automação para de rodar na hora."
        consequencias={[
          "O histórico de execuções dela é apagado junto.",
          "As atividades e as notas que ela já criou continuam onde estão.",
          "Os leads que ela já moveu ficam na etapa em que estão.",
        ]}
        rotuloConfirmar="Excluir automação"
        pendente={pendente}
        onFechar={() => setExcluindo(null)}
        onConfirmar={excluir}
      />
    </>
  );
}
