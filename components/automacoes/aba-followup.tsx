"use client";

import { Check, PenLine, Plus, Repeat, WandSparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  excluirReguaAction,
  ordenarReguasDeFollowupAction,
} from "@/app/(app)/automacoes/actions";
import {
  DialogoDeExclusao,
  PERDAS_DO_HISTORICO,
} from "@/components/automacoes/dialogo-de-exclusao";
import { CartaoDaRegua } from "@/components/automacoes/followup/cartao-da-regua";
import { DialogoNovaRegua } from "@/components/automacoes/followup/dialogo-nova-regua";
import { DialogoParaQuem } from "@/components/automacoes/followup/dialogo-para-quem";
import type { NumerosDasAutomaticas } from "@/components/automacoes/numeros-de-envio";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import {
  opcoesDeEtiqueta as opcoesDoCatalogo,
  SEM_TONS,
  tonsDasEtiquetas,
  type OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";
import {
  agruparReguasPorEtapa,
  avisoDeEtapaSemGeral,
  avisoDeGeralDesligada,
  avisoDeSemRegua,
  ehReguaGeral,
  novaOrdemDasReguas,
  REGRA_DA_ORDEM,
  REGRA_DA_PRECEDENCIA,
  textoDasEtiquetas,
} from "@/lib/domain/reguas-de-followup";
import type {
  DadosDosFollowups,
  ReguaDeFollowup,
} from "@/lib/queries/automacoes";

// Aba de follow-up de leads (spec modulo 7): regua por ETAPA da jornada.
// Gatilho = entrou na etapa; parada automatica quando responde, muda de
// etapa (agendou, perdido, qualquer movimento). Mensagem fixa por enquanto:
// deixar a IA escrever fica desabilitado ate o agente existir com o filtro
// de conformidade (regra 3.2; o banco recusa use_ai=true).
//
// Desde a onda 4 (item 16, decisoes do dono de 20/10/2026) a etapa pode ter
// varias reguas: as com etiqueta, na ordem de precedencia (vale a de cima,
// com Subir e Descer), e a geral por ultimo. A tela agrupa por etapa, na
// ordem da jornada; cada regua diz para quem e, quantos recebem hoje e
// quantos estao sem autorizacao; a etapa sem regua geral avisa quantos leads
// ficam sem nenhuma. "Nova régua" nao esconde mais a etapa que ja tem regua.
//
// Desenho do design system (docs/06 secao 5.10): o modo em uso como cartao
// escolhido (receita 4.7), cada regua num cartao com cabecalho de acordeao e
// a situacao em 3 camadas (REGUA_STATUS; achado 54), e "Excluir" suave que
// pergunta antes (achado 48).

export type EtapaParaFollowup = { chave: string; nome: string };

export function AbaFollowup({
  clinicId,
  followups,
  etapas,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  numeros = null,
  etiquetas = null,
  opcoesDeEtiqueta = null,
  aoMudar,
}: {
  clinicId: string;
  followups: DadosDosFollowups;
  /**
   * Etapas da jornada que aceitam follow-up: sem a de perda e sem a que
   * espera a resposta da equipe (etapaRecebeFollowup, lib/domain/jornada).
   */
  etapas: EtapaParaFollowup[];
  nomeDaClinica: string;
  precoCents: number | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ehAdministrador: boolean;
  /** Numeros ativos e politica: o teste de cada passo escolhe o numero. */
  numeros?: NumerosDasAutomaticas | null;
  /** O catalogo de etiquetas (o tom dos chips); nulo: nao carregou */
  etiquetas?: EtiquetaDeConversa[] | null;
  /** As etiquetas para escolher (catalogo e em uso); nulo: so o catalogo */
  opcoesDeEtiqueta?: OpcaoDeEtiqueta[] | null;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [paraQuem, setParaQuem] = useState<ReguaDeFollowup | null>(null);
  const [aExcluir, setAExcluir] = useState<ReguaDeFollowup | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const { reguas, semReguaPorEtapa } = followups;
  const grupos = agruparReguasPorEtapa(reguas, etapas);
  const tons = etiquetas ? tonsDasEtiquetas(etiquetas) : SEM_TONS;
  const opcoes =
    opcoesDeEtiqueta ?? (etiquetas ? opcoesDoCatalogo(etiquetas, []) : []);
  const leitura =
    opcoesDeEtiqueta !== null || etiquetas !== null ? "pronto" : "erro";
  const etapasDaNova = etapas.map((etapa) => ({
    ...etapa,
    temGeral: reguas.some(
      (regua) => regua.trigger_stage === etapa.chave && ehReguaGeral(regua),
    ),
  }));

  const excluir = (regua: ReguaDeFollowup) => {
    iniciarTransicao(async () => {
      const resultado = await excluirReguaAction({ cadence_id: regua.id });
      if (resultado.ok) {
        toast.success(`Régua ${regua.name} excluída.`);
        setAExcluir(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  const reordenar = (etapa: string, ids: string[]) => {
    iniciarTransicao(async () => {
      const resultado = await ordenarReguasDeFollowupAction({
        trigger_stage: etapa,
        ids,
      });
      if (resultado.ok) {
        toast.success("Ordem das réguas salva.");
        await aoMudar();
        return;
      }
      toast.error(
        resultado.error ?? "Não foi possível mudar a ordem das réguas.",
      );
    });
  };

  // O que se perde ao excluir, dito para quem a regua atende.
  const etapaDaExcluida = aExcluir
    ? grupos.find((grupo) => grupo.chave === aExcluir.trigger_stage)
    : undefined;
  const descricaoDaExclusao = !aExcluir
    ? ""
    : !ehReguaGeral(aExcluir)
      ? `Os leads com ${textoDasEtiquetas(aExcluir.etiquetas, aExcluir.etiquetas_modo)} passam a receber a régua geral da etapa ${aExcluir.etapa_nome}, se ela estiver ligada.`
      : (etapaDaExcluida?.comEtiqueta.length ?? 0) > 0
        ? `Os leads da etapa ${aExcluir.etapa_nome} sem as etiquetas das outras réguas deixam de receber mensagens de acompanhamento.`
        : `Os leads da etapa ${aExcluir.etapa_nome} deixam de receber mensagens de acompanhamento.`;

  const botaoNova = (
    <Button
      variant="outline"
      disabled={!podeEditar || pendente || etapas.length === 0}
      onClick={() => setCriando(true)}
    >
      <Plus aria-hidden />
      Nova régua
    </Button>
  );

  return (
    <div className="grid gap-4">
      {/* Os dois modos de escrever (spec 7.3): fixa hoje, IA com o agente.
          O modo em uso e o cartao escolhido (lime suave com borda); o da IA
          fica visivel, apagado e com a dica, porque o agente nao existe
          ainda (Fase 3) e nada de IA fica ativo. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-3 rounded-card border border-primary-edge bg-primary-soft p-3.5">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-md bg-card text-primary-text">
            <PenLine className="size-[17px]" aria-hidden />
          </span>
          <div className="grid gap-0.5">
            <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-text-strong">
              <Check className="size-3.5 text-primary-text" aria-hidden />
              Mensagem fixa
            </span>
            <span className="text-xs text-foreground">
              Você escreve o texto de cada passo. É o modo em uso.
            </span>
          </div>
        </div>
        <DisabledWithHint
          className="w-full"
          hint="Chega com o agente de IA. As travas de conformidade médica vêm antes de qualquer texto escrito por máquina."
        >
          <div className="flex w-full gap-3 rounded-card border border-border bg-card p-3.5 opacity-45">
            <span className="grid size-[34px] shrink-0 place-items-center rounded-md bg-surface-4 text-text-secondary">
              <WandSparkles className="size-[17px]" aria-hidden />
            </span>
            <div className="grid gap-0.5">
              <span className="text-[13.5px] font-bold text-text-strong">
                Deixar a IA escrever
              </span>
              <span className="text-xs text-text-secondary">
                A IA escreve dentro das regras da clínica.
              </span>
            </div>
          </div>
        </DisabledWithHint>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-text-secondary">
          A régua acompanha o lead enquanto ele está na etapa. Ela para sozinha
          quando ele responde, agenda ou muda de etapa. Uma etapa pode ter
          réguas por etiqueta e uma geral: cada lead recebe uma só.
        </p>
        {podeEditar && etapas.length > 0 ? (
          botaoNova
        ) : (
          <DisabledWithHint
            hint={
              podeEditar
                ? "Nenhuma etapa da jornada aceita follow-up."
                : dicaSemPermissao
            }
          >
            {botaoNova}
          </DisabledWithHint>
        )}
      </div>

      {reguas.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={Repeat}
            title="Nenhuma régua de follow-up ainda"
            description="Crie uma para a etapa onde os leads mais esfriam, como quem pediu preço e sumiu."
          />
        </Card>
      ) : (
        grupos.map((grupo) => {
          const idDoTitulo = `followup-etapa-${grupo.chave}`;
          const ordenadas = [
            ...grupo.comEtiqueta,
            ...(grupo.geral ? [grupo.geral] : []),
          ];
          const semRegua = semReguaPorEtapa?.[grupo.chave] ?? null;
          const temComEtiqueta = grupo.comEtiqueta.length > 0;
          return (
            <section
              key={grupo.chave}
              aria-labelledby={idDoTitulo}
              className="grid gap-3"
            >
              <div className="grid gap-1">
                <h2
                  id={idDoTitulo}
                  className="text-base leading-[1.3] font-bold tracking-[-0.01em]"
                >
                  {grupo.nome}
                </h2>
                {temComEtiqueta ? (
                  <p className="max-w-[72ch] text-[13px] text-text-secondary">
                    {grupo.geral?.active
                      ? REGRA_DA_PRECEDENCIA
                      : REGRA_DA_ORDEM}
                  </p>
                ) : null}
              </div>
              {/* A etapa sem geral ligada deixa sem regua quem nao tem as
                  etiquetas: o aviso diz quantos (o alcance conta) e por que. */}
              {temComEtiqueta && !grupo.geral?.active ? (
                <Aviso
                  tom={semRegua !== null && semRegua > 0 ? "warning" : "info"}
                >
                  {semRegua !== null && semRegua > 0
                    ? `${avisoDeSemRegua(semRegua, grupo.nome)} `
                    : null}
                  {grupo.geral
                    ? avisoDeGeralDesligada(grupo.nome)
                    : avisoDeEtapaSemGeral(grupo.nome)}
                </Aviso>
              ) : null}
              {ordenadas.map((regua) => {
                const posicao = grupo.comEtiqueta.findIndex(
                  (item) => item.id === regua.id,
                );
                const ordem =
                  posicao < 0
                    ? null
                    : {
                        podeSubir: posicao > 0,
                        podeDescer: posicao < grupo.comEtiqueta.length - 1,
                        aoSubir: () => {
                          const ids = novaOrdemDasReguas(
                            grupo.comEtiqueta,
                            regua.id,
                            -1,
                          );
                          if (ids) {
                            reordenar(grupo.chave, ids);
                          }
                        },
                        aoDescer: () => {
                          const ids = novaOrdemDasReguas(
                            grupo.comEtiqueta,
                            regua.id,
                            1,
                          );
                          if (ids) {
                            reordenar(grupo.chave, ids);
                          }
                        },
                      };
                return (
                  <CartaoDaRegua
                    key={regua.id}
                    regua={regua}
                    aberta={aberta === regua.id}
                    aoAlternar={() =>
                      setAberta(aberta === regua.id ? null : regua.id)
                    }
                    ordem={ordem}
                    tons={tons}
                    clinicId={clinicId}
                    nomeDaClinica={nomeDaClinica}
                    precoCents={precoCents}
                    podeEditar={podeEditar}
                    dicaSemPermissao={dicaSemPermissao}
                    ehAdministrador={ehAdministrador}
                    numeros={numeros}
                    pendente={pendente}
                    aoEditarParaQuem={() => setParaQuem(regua)}
                    aoExcluir={() => setAExcluir(regua)}
                    aoMudar={aoMudar}
                  />
                );
              })}
            </section>
          );
        })
      )}

      <DialogoDeExclusao
        aberto={aExcluir !== null}
        titulo={`Excluir a régua ${aExcluir?.name ?? ""}?`}
        descricao={descricaoDaExclusao}
        consequencias={[
          "Os textos e os anexos da régua são apagados.",
          "Todo o histórico de envios dela também é apagado e some das métricas.",
          PERDAS_DO_HISTORICO.resposta,
        ]}
        rotuloConfirmar="Excluir régua"
        pendente={pendente}
        onFechar={() => setAExcluir(null)}
        onConfirmar={() => {
          if (aExcluir) {
            excluir(aExcluir);
          }
        }}
      />

      <DialogoNovaRegua
        aberto={criando}
        aoFechar={() => setCriando(false)}
        aoCriar={aoMudar}
        etapas={etapasDaNova}
        opcoes={opcoes}
        leitura={leitura}
        tons={tons}
      />

      <DialogoParaQuem
        regua={paraQuem}
        aoFechar={() => setParaQuem(null)}
        aoSalvar={aoMudar}
        opcoes={opcoes}
        leitura={leitura}
        tons={tons}
      />
    </div>
  );
}
