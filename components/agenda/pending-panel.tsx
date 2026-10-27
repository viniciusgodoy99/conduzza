"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarCog, CalendarFold, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  aprovarEncaixeAction,
  recusarEncaixeAction,
  type AgendaActionResult,
} from "@/app/(app)/agenda/actions";
import {
  BotaoDosDadosInformados,
  contatoDaConsulta,
  DialogoDosDadosInformados,
  useDadosInformados,
} from "@/components/agenda/dados-informados";
import { DialogoDaRemarcacao } from "@/components/agenda/dialogo-da-remarcacao";
import {
  linhasDoCartaoDaRemarcacao,
  TEXTOS_DA_REMARCACAO,
  type AcaoDaRemarcacao,
} from "@/components/agenda/remarcacao-da-ia";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  APPOINTMENT_STATUS,
  STATUS_TONE_VARS,
  type AppointmentStatus,
  type StatusDefinition,
} from "@/lib/design/status";
import { situacaoDaConsulta } from "@/lib/domain/dados-informados";
import {
  ehConsultaDaIa,
  ehRemarcacaoDaIa,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";

// Painel lateral "Pendente de voce" (264px, cartao do design system, docs/06
// secao 5.6): o que a IA deixou para a equipe aprovar. Abaixo, a legenda
// compacta dos 10 status da agenda (3 camadas: icone, rotulo e cor).
// "Aprovar" vai no botao suave: o unico lime cheio da tela e o "Novo
// agendamento".
//
// Duas pendencias, cada uma com o seu chip em 3 camadas, os dois no tom da
// IA (lime suave, reservado a IA) e com icones de forma distinta:
// - "Encaixe da IA" (Sparkles): o encaixe sugerido pela IA, como sempre;
// - "Marcada pela IA" (CalendarCog, E4 de 20/10/2026, decisao D12 do dono):
//   a consulta que a IA marcou pelo WhatsApp (created_by 'ia', sem encaixe).
//   CalendarCog nao tinha dono em nenhuma tela nem mapa (tabela de icones
//   reservados, docs/06 secao 4.6): a agenda que se marca sozinha.
// Aprovar a consulta da IA liga a confirmacao automatica; recusar devolve a
// conversa para a equipe avisar o paciente (as duas regras moram na acao).
// Se a conversa nao voltou, a recusa vale do mesmo jeito e a tela mostra o
// aviso por mais tempo, para a recepcao agir.
//
// O cartao traz paciente, procedimento com o convenio (ou "Particular"),
// profissional e o dia com a hora no fuso da clinica: e o que a equipe
// confere antes de aprovar o que a IA escolheu.
//
// AG3 (D-7): o cartao da consulta da IA ganha "Ver dados informados" (40px,
// acima de Aprovar e Recusar), o que o paciente informou ao assistente para
// marcar, que a aprovacao aplica ao cadastro (o nome se estiver vazio ou
// for o do WhatsApp; nascimento e CPF so vazios; a carteirinha so vazia e na
// consulta pelo convenio, o mesmo do cadastro ou com ele vazio). A
// leitura grava trilha e por isso so acontece no clique
// (components/agenda/dados-informados.tsx). O encaixe nao tem: a IA nao
// pede dado para sugerir encaixe.
//
// AG4 (D-10; desenho da secao 5): a terceira pendencia, "Remarcação pela
// IA" (CalendarFold, tom da IA): a consulta NOVA que a IA pediu para
// remarcar outra, pendente e ligada a antiga. CalendarFold nao tinha dono em
// nenhuma tela nem mapa (conferido em 27/10/2026; nunca CalendarSync, do
// "Remarcada" da agenda, nem CalendarCog, da "Marcada pela IA"): o
// calendario com a folha dobrada, a data que vira. O cartao diz "De ..." (a
// antiga, com "(já cancelada)" quando ela foi cancelada nesse meio) e
// "Para ..." (a nova), sem "Ver dados informados" (a remarcacao nao pede
// dado, D-26). Aprovar e Recusar abrem os dialogos da remarcacao
// (dialogo-da-remarcacao.tsx), com o aviso ao paciente na aprovacao (D-28).
// A antiga vem numa leitura a parte (fetchPendencias): se ela falhar, so o
// cartao da remarcacao diz que a antiga nao carregou (Aviso de atencao no
// lugar do "De"), e o resto do painel e da Agenda abre normalmente.

export const CHIP_ENCAIXE_IA: StatusDefinition = {
  label: "Encaixe da IA",
  tone: "ai",
  icon: Sparkles,
};

export const CHIP_MARCADA_PELA_IA: StatusDefinition = {
  label: "Marcada pela IA",
  tone: "ai",
  icon: CalendarCog,
};

export const CHIP_REMARCACAO_PELA_IA: StatusDefinition = {
  label: TEXTOS_DA_REMARCACAO.chip,
  tone: "ai",
  icon: CalendarFold,
};

/**
 * O chip de cada pendencia: a remarcacao que a IA pediu, a consulta que a
 * IA marcou ou o encaixe.
 */
export function chipDaPendencia(
  consulta: Pick<ConsultaDaAgenda, "created_by" | "is_overbooking"> & {
    remarcacao_de?: string | null;
  },
): StatusDefinition {
  if (ehRemarcacaoDaIa(consulta)) {
    return CHIP_REMARCACAO_PELA_IA;
  }
  return ehConsultaDaIa(consulta) ? CHIP_MARCADA_PELA_IA : CHIP_ENCAIXE_IA;
}

export const TEXTOS_DO_PAINEL = {
  titulo: "Pendente de você",
  vazioTitulo: "Nada pendente de você",
  vazioTexto:
    "Quando a IA marcar ou remarcar uma consulta, ou sugerir um encaixe, aparece aqui para a equipe aprovar.",
  semProcedimento: "Procedimento não informado",
  particular: "Particular",
  paciente: "Paciente",
  aprovar: "Aprovar",
  recusar: "Recusar",
  legenda: "Legenda de situações",
} as const;

export type AcaoDaPendencia = "aprovar" | "recusar";

/** O toast de cada resultado, pelo tipo da pendencia. */
export type RetornoNaTela = {
  tipo: "success" | "info" | "warning" | "error";
  texto: string;
};

/**
 * O que a tela diz depois de aprovar ou recusar. A consulta da IA pede que a
 * equipe avise o paciente (a IA disse a ele que a equipe confirma por aqui).
 * Aviso da acao (a conversa nao voltou para a equipe) e warning, nunca
 * sucesso calado, e vai SOZINHO: por isso todo aviso da recusa e
 * autocontido ("A consulta foi recusada, mas ...", e na remarcacao da IA "A
 * remarcação foi recusada, mas ..."; revisao da AG4, achado 5).
 */
export function retornoDaPendencia(
  resultado: AgendaActionResult,
  acao: AcaoDaPendencia,
  daIa: boolean,
): RetornoNaTela {
  if (resultado.ok) {
    if (resultado.aviso) {
      return { tipo: "warning", texto: resultado.aviso };
    }
    // AG4: o texto do servidor (a remarcacao da IA, com o horario da antiga
    // lido do banco) vale mais que o generico.
    if (resultado.mensagem) {
      return { tipo: "success", texto: resultado.mensagem };
    }
    if (daIa) {
      return {
        tipo: "success",
        texto:
          acao === "aprovar"
            ? "Consulta aprovada. Avise o paciente pelo Atendimento."
            : "Consulta recusada. Avise o paciente pelo Atendimento.",
      };
    }
    return {
      tipo: "success",
      texto: acao === "aprovar" ? "Encaixe aprovado" : "Encaixe recusado",
    };
  }
  if (resultado.code === "ja_tratado") {
    return {
      tipo: "info",
      texto:
        resultado.error ??
        (daIa
          ? "Esta consulta já foi tratada."
          : "Este encaixe já foi tratado."),
    };
  }
  return { tipo: "error", texto: resultado.error ?? semResposta(daIa) };
}

function semResposta(daIa: boolean): string {
  return daIa
    ? "Não foi possível tratar a consulta. Tente de novo."
    : "Não foi possível tratar o encaixe. Tente de novo.";
}

function diaEHora(instante: string, timezone: string): string {
  const data = new Date(instante);
  const dia = data.toLocaleDateString("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  });
  const hora = data.toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dia} · ${hora}`;
}

/**
 * O toast de cada retorno, o mesmo no painel e no menu da consulta (revisao
 * da E4: o menu mostrava sucesso calado quando a conversa nao voltava).
 */
export function mostrarRetornoDaPendencia(retorno: RetornoNaTela): void {
  if (retorno.tipo === "success") {
    toast.success(retorno.texto);
  } else if (retorno.tipo === "info") {
    toast.info(retorno.texto);
  } else if (retorno.tipo === "warning") {
    // A recusa valeu, mas a conversa nao voltou: a recepcao precisa ler.
    toast.warning(retorno.texto, { duration: 10_000 });
  } else {
    toast.error(retorno.texto);
  }
}

export function PendingPanel({
  contexto,
  pendencias,
}: {
  contexto: ContextoAgenda;
  pendencias: ConsultaDaAgenda[];
}) {
  const queryClient = useQueryClient();
  const [emAndamento, setEmAndamento] = useState<{
    id: string;
    acao: AcaoDaPendencia;
  } | null>(null);
  // "Ver dados informados" (AG3): a consulta do dialogo fica guardada aqui,
  // para o dialogo nao perder o nome se ela sair da lista enquanto aberto.
  const dadosInformados = useDadosInformados();
  const [consultaDosDados, setConsultaDosDados] =
    useState<ConsultaDaAgenda | null>(null);
  const verDadosInformados = (consulta: ConsultaDaAgenda) => {
    setConsultaDosDados(consulta);
    dadosInformados.abrir(consulta.id);
  };
  // AG4: a remarcacao da IA aprova e recusa pelo dialogo dela. A consulta
  // fica guardada aqui, como a dos dados, para o dialogo nao perder o texto
  // se ela sair da lista enquanto aberto.
  const [remarcacaoAberta, setRemarcacaoAberta] = useState<{
    consulta: ConsultaDaAgenda;
    acao: AcaoDaRemarcacao;
  } | null>(null);

  const escolher = (consulta: ConsultaDaAgenda, acao: AcaoDaPendencia) => {
    if (ehRemarcacaoDaIa(consulta)) {
      setRemarcacaoAberta({ consulta, acao });
      return;
    }
    void tratar(consulta, acao);
  };

  async function tratar(consulta: ConsultaDaAgenda, acao: AcaoDaPendencia) {
    const daIa = ehConsultaDaIa(consulta);
    setEmAndamento({ id: consulta.id, acao });
    try {
      const resultado =
        acao === "aprovar"
          ? await aprovarEncaixeAction(consulta.id)
          : await recusarEncaixeAction(consulta.id);
      mostrarRetornoDaPendencia(retornoDaPendencia(resultado, acao, daIa));
    } catch {
      toast.error(semResposta(daIa));
    } finally {
      setEmAndamento(null);
      await queryClient.invalidateQueries({
        queryKey: ["agenda", contexto.clinicId],
      });
    }
  }

  const nomeDoProfissional = (id: string): string | null =>
    contexto.catalogo.profissionais.find((p) => p.id === id)?.name ?? null;

  return (
    <aside
      aria-label={TEXTOS_DO_PAINEL.titulo}
      className="hidden w-[264px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm xl:flex"
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-base font-bold tracking-[-0.01em]">
          {TEXTOS_DO_PAINEL.titulo}
        </h2>
      </div>

      <div className="relative flex cz-scroll min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
        {pendencias.length === 0 ? (
          // Vazio compacto no tom da IA (ladrilho lime suave com o Sparkles):
          // quem deixa pendencia aqui e a IA.
          <div className="flex flex-col items-center justify-center gap-2 px-2 py-7 text-center">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-card bg-ai-bg">
              <Sparkles className="size-[18px] text-ai-text" aria-hidden />
            </span>
            <p className="text-sm font-bold tracking-[-0.01em] text-text-strong">
              {TEXTOS_DO_PAINEL.vazioTitulo}
            </p>
            <p className="text-[13px] text-text-secondary">
              {TEXTOS_DO_PAINEL.vazioTexto}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pendencias.map((consulta) => {
              const ocupado = emAndamento?.id === consulta.id;
              const profissional = nomeDoProfissional(consulta.professional_id);
              const remarcacao = ehRemarcacaoDaIa(consulta);
              const horarios = remarcacao
                ? linhasDoCartaoDaRemarcacao(consulta, contexto.timezone)
                : null;
              return (
                <li
                  key={consulta.id}
                  className="flex flex-col gap-2.5 rounded-xl border border-border p-3"
                >
                  <span className="flex">
                    <StatusChip
                      size="sm"
                      definition={chipDaPendencia(consulta)}
                    />
                  </span>
                  <div className="grid gap-0.5">
                    <p className="truncate text-[13px] font-semibold text-text-strong">
                      {consulta.contact?.name ??
                        consulta.contact?.phone_e164 ??
                        TEXTOS_DO_PAINEL.paciente}
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {consulta.service_link?.procedure?.name ??
                        TEXTOS_DO_PAINEL.semProcedimento}
                      {" · "}
                      {consulta.service_link?.insurance?.name ??
                        TEXTOS_DO_PAINEL.particular}
                    </p>
                    {profissional ? (
                      <p className="truncate text-xs text-text-secondary">
                        {profissional}
                      </p>
                    ) : null}
                    {horarios ? (
                      <>
                        {horarios.de ? (
                          <p className="cz-num text-xs text-text-secondary">
                            {horarios.de}
                          </p>
                        ) : null}
                        <p className="cz-num text-xs text-text-secondary">
                          {horarios.para}
                        </p>
                        {horarios.naoCarregada ? (
                          <Aviso tom="warning" className="mt-1.5 px-3 py-2.5">
                            {TEXTOS_DA_REMARCACAO.antigaNaoCarregada}
                          </Aviso>
                        ) : null}
                      </>
                    ) : (
                      <p className="cz-num text-xs text-text-secondary">
                        {diaEHora(consulta.starts_at, contexto.timezone)}
                      </p>
                    )}
                  </div>
                  {ehConsultaDaIa(consulta) && !remarcacao ? (
                    <BotaoDosDadosInformados
                      podeLer={contexto.podeEditar}
                      aoAbrir={() => verDadosInformados(consulta)}
                    />
                  ) : null}
                  <div className="flex gap-2">
                    {contexto.podeEditar ? (
                      <>
                        <Button
                          variant="secondary"
                          className="h-10 flex-1"
                          disabled={ocupado}
                          aria-busy={
                            (ocupado && emAndamento?.acao === "aprovar") ||
                            undefined
                          }
                          onClick={() => escolher(consulta, "aprovar")}
                        >
                          {ocupado && emAndamento?.acao === "aprovar" ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : null}
                          {TEXTOS_DO_PAINEL.aprovar}
                        </Button>
                        <Button
                          variant="outline"
                          className="h-10 flex-1"
                          disabled={ocupado}
                          aria-busy={
                            (ocupado && emAndamento?.acao === "recusar") ||
                            undefined
                          }
                          onClick={() => escolher(consulta, "recusar")}
                        >
                          {ocupado && emAndamento?.acao === "recusar" ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : null}
                          {TEXTOS_DO_PAINEL.recusar}
                        </Button>
                      </>
                    ) : (
                      <>
                        <DisabledWithHint
                          hint={contexto.dica}
                          className="flex-1"
                        >
                          <Button
                            variant="secondary"
                            className="h-10 w-full"
                            disabled
                          >
                            {TEXTOS_DO_PAINEL.aprovar}
                          </Button>
                        </DisabledWithHint>
                        <DisabledWithHint
                          hint={contexto.dica}
                          className="flex-1"
                        >
                          <Button
                            variant="outline"
                            className="h-10 w-full"
                            disabled
                          >
                            {TEXTOS_DO_PAINEL.recusar}
                          </Button>
                        </DisabledWithHint>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <DialogoDosDadosInformados
          aberto={dadosInformados.aberta !== null && consultaDosDados !== null}
          nome={consultaDosDados ? contatoDaConsulta(consultaDosDados) : null}
          fuso={contexto.timezone}
          situacao={
            consultaDosDados ? situacaoDaConsulta(consultaDosDados) : "pendente"
          }
          estado={dadosInformados.estado}
          aoFechar={() => {
            dadosInformados.fechar();
            setConsultaDosDados(null);
          }}
          aoTentarDeNovo={dadosInformados.tentarDeNovo}
          aoRevelar={dadosInformados.revelar}
        />

        {remarcacaoAberta ? (
          <DialogoDaRemarcacao
            key={`${remarcacaoAberta.consulta.id}-${remarcacaoAberta.acao}`}
            contexto={contexto}
            // A da lista AGORA (o tempo real a renova, com a antiga lida de
            // novo); a guardada so quando ela ja saiu da lista.
            consulta={
              pendencias.find(
                (pendencia) => pendencia.id === remarcacaoAberta.consulta.id,
              ) ?? remarcacaoAberta.consulta
            }
            acao={remarcacaoAberta.acao}
            aoFechar={() => setRemarcacaoAberta(null)}
            aoTerminar={() =>
              queryClient.invalidateQueries({
                queryKey: ["agenda", contexto.clinicId],
              })
            }
          />
        ) : null}

        <div className="grid gap-2 border-t border-border pt-4">
          <h3 className="cz-eyebrow text-text-secondary">
            {TEXTOS_DO_PAINEL.legenda}
          </h3>
          <ul className="grid gap-1.5">
            {(
              Object.entries(APPOINTMENT_STATUS) as [
                AppointmentStatus,
                StatusDefinition,
              ][]
            ).map(([status, definicao]) => {
              const tone = STATUS_TONE_VARS[definicao.tone];
              const Icone = definicao.icon;
              return (
                <li key={status} className="flex items-center gap-2">
                  {Icone ? (
                    <Icone
                      className="size-3.5 shrink-0"
                      style={{ color: tone.text }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="text-xs text-text-secondary">
                    {definicao.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}
