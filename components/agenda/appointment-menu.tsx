"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  FileUser,
  History,
  Trash2,
  X,
} from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  aprovarEncaixeAction,
  mudarStatusAction,
  recusarEncaixeAction,
  remarcarAgendamentoAction,
  type AgendaActionResult,
} from "@/app/(app)/agenda/actions";
import { DICA_REMOVER_SEM_PERMISSAO } from "@/components/agenda/bloqueio-comum";
import {
  contatoDaConsulta,
  DialogoDosDadosInformados,
  TEXTOS_DOS_DADOS_INFORMADOS,
  useDadosInformados,
} from "@/components/agenda/dados-informados";
import {
  ConfirmarRemocaoDoBloqueio,
  podeRemoverBloqueio,
  ResumoDoBloqueio,
} from "@/components/agenda/detalhe-do-bloqueio";
import {
  mostrarRetornoDaPendencia,
  retornoDaPendencia,
  type AcaoDaPendencia,
  type RetornoNaTela,
} from "@/components/agenda/pending-panel";
import {
  ChaveAvisarPaciente,
  ERROS_CORRIGIVEIS_NA_REMARCACAO,
  NotaDaConfirmacao,
  profissionaisParaRemarcar,
} from "@/components/agenda/remarcacao-comum";
import { StatusHistorySheet } from "@/components/agenda/status-history-sheet";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { APPOINTMENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import { situacaoDaConsulta } from "@/lib/domain/dados-informados";
import type { AppointmentStatus } from "@/lib/design/status";
import {
  aguardaAprovacao,
  comparecimentoLiberado,
  DICA_COMPARECEU_ANTES_DO_DIA,
  DICA_CONSULTA_PENDENTE,
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  eCancelamento,
  faltaLiberada,
  MENSAGEM_PROFISSIONAL_INATIVO,
  mudancaEsperaAprovacao,
  podeRemarcar,
  saldoDescontadoAoComparecer,
  transicoesPermitidas,
} from "@/lib/domain/appointment-status";
import { diaCivil, instanteLocal } from "@/lib/domain/horarios";
import {
  fraseDoDescontoAoComparecer,
  fraseDoQueSobra,
} from "@/lib/domain/pacotes-ui";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  agendaKeys,
  cancelarContaComoRecusa,
  ehConsultaDaIa,
  fetchListaDeEsperaDaClinica,
  type BloqueioDaAgenda,
  type ConsultaDaAgenda,
} from "@/lib/queries/agenda";
import { fetchSaldosParaComparecimento } from "@/lib/queries/pacientes";
import { createClient } from "@/lib/supabase/client";

// Menu do bloco de consulta: cabecalho de contexto, mudanca de situacao
// (transicoes validas do dominio, com confirmacao explicita para falta e para
// os dois cancelamentos, e pergunta de canal para confirmacao da recepcao),
// remarcar e historico. Sem permissao: tudo visivel, desabilitado, com a
// dica. Acao que a regra impede agora (falta antes do horario, Compareceu
// antes do dia da consulta, remarcar consulta encerrada) tambem fica visivel
// e desabilitada, com o porque. Na falta, "Marcar nova consulta" abre o modal
// com o paciente e o procedimento, e a falta fica registrada no dia em que
// aconteceu (achado 78). Compareceu que vai descontar sessao de pacote pede
// confirmacao nomeando paciente e pacote (achado L11); sem saldo a
// descontar, sai direto (decisao do dono). Bloqueio do mesmo profissional
// que cruza o horario (criado "mesmo assim" por cima da consulta) fica
// coberto pelo bloco na grade: o menu mostra a secao "Horario bloqueado"
// com o mesmo detalhe e o mesmo "Remover bloqueio" da faixa.

// Pendencia (revisao da E4): a consulta que a IA marcou (ehConsultaDaIa) nao
// e encaixe. O menu, unico caminho em tela menor que 1280 px (o painel
// "Pendente de voce" so aparece de xl para cima), diz qual e qual e mostra o
// mesmo retorno do painel: o aviso da conversa que nao voltou para a equipe
// e warning por 10 s, nunca sucesso calado. Cancelar a pendencia da IA pela
// mudanca de situacao conta como recusar (decisao do dono de 20/10/2026): o
// retorno e o do Recusar (retornoDaMudancaDeSituacao) e o dialogo de
// cancelar nao pergunta da lista de espera, que a recusa nunca aciona.
//
// Onda 2, item 10 (decisoes do dono P10a e P10b): a consulta que espera
// aprovacao (qualquer pendente) so aprova, recusa ou cancela. As outras
// situacoes ficam visiveis e desabilitadas, com a dica uma vez so, logo
// abaixo de "Mudar situação" (DICA_CONSULTA_PENDENTE, a mesma que a acao
// devolve e que o gatilho do banco confere). Cancelar continua liberado.
//
// AG3 (D-7): a consulta que a IA marcou tem "Ver dados informados" (o que o
// paciente informou ao assistente para marcar; a aprovacao aplica ao
// cadastro o nome vazio ou o do WhatsApp, e o resto so vazio). Pendente, e o
// primeiro item do grupo da pendencia, antes de Aprovar; depois de tratada,
// fica junto de "Ver histórico" (mostra se os dados ja entraram no cadastro,
// quando e por quem, ou por que nao entram). A leitura so acontece no clique
// (grava trilha). Sem permissao, visivel e desabilitado com o porque logo
// abaixo.

/** Os textos do grupo de pendencia do menu, pelo tipo da pendencia. */
export function rotulosDaPendenciaNoMenu(daIa: boolean): {
  grupo: string;
  aprovar: string;
  recusar: string;
} {
  return daIa
    ? {
        grupo: "Consulta marcada pela IA",
        aprovar: "Aprovar consulta",
        recusar: "Recusar consulta",
      }
    : {
        grupo: "Encaixe pendente",
        aprovar: "Aprovar encaixe",
        recusar: "Recusar encaixe",
      };
}

/**
 * Aprova ou recusa pela acao e devolve o que a tela diz, como o painel
 * (retornoDaPendencia). A acao que lanca vira o erro de sempre.
 */
export async function tratarPendenciaNoMenu(
  consulta: Pick<ConsultaDaAgenda, "id" | "created_by" | "is_overbooking">,
  decisao: AcaoDaPendencia,
): Promise<RetornoNaTela> {
  const daIa = ehConsultaDaIa(consulta);
  try {
    const resultado =
      decisao === "aprovar"
        ? await aprovarEncaixeAction(consulta.id)
        : await recusarEncaixeAction(consulta.id);
    return retornoDaPendencia(resultado, decisao, daIa);
  } catch {
    return retornoDaPendencia({ ok: false }, decisao, daIa);
  }
}

/**
 * O que a tela diz depois de mudar a situacao. Cancelar uma pendencia da IA
 * conta como recusar (decisao do dono de 20/10/2026; a acao devolve
 * `recusada`): o retorno e o do Recusar (retornoDaPendencia), com o aviso da
 * conversa que nao voltou para a equipe como atencao, nunca sucesso calado.
 * O resto, como sempre.
 */
export function retornoDaMudancaDeSituacao(
  resultado: AgendaActionResult,
  novoStatus: AppointmentStatus,
): RetornoNaTela {
  if (resultado.ok && resultado.recusada) {
    return retornoDaPendencia(
      resultado,
      "recusar",
      resultado.recusada === "consulta_da_ia",
    );
  }
  if (resultado.ok) {
    return {
      tipo: "success",
      texto: `Situação mudada para ${APPOINTMENT_STATUS[novoStatus].label}.`,
    };
  }
  return {
    tipo: "error",
    texto: resultado.error ?? "Não foi possível mudar a situação.",
  };
}

/** "quinta-feira, 25/09 às 10:00" no fuso da clinica. */
function diaEHoraNoFuso(timezone: string, instante: string): string {
  const data = new Date(instante);
  const dia = data.toLocaleDateString("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
  const hora = data.toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dia} às ${hora}`;
}

type CanalConfirmacao = "whatsapp" | "telefone" | "presencial";

const CANAIS: { valor: CanalConfirmacao; rotulo: string }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "presencial", rotulo: "Presencial" },
];

function horaNoFuso(timezone: string, instante: string): string {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Saldo de pacote que o Compareceu desconta
// ---------------------------------------------------------------------------

/**
 * O item de saldo (procedimento de uma venda) que o Compareceu desta
 * consulta vai descontar (null: nenhum). Os itens vem de
 * fetchSaldosParaComparecimento (um por procedimento de cada venda) e quem
 * escolhe e saldoDescontadoAoComparecer, espelho do gatilho. A chave comeca
 * por ["agenda", clinicId]: toda mudanca na agenda a renova.
 */
function useSaldoDoComparecimento(
  contexto: ContextoAgenda,
  consulta: ConsultaDaAgenda,
  habilitado: boolean,
) {
  const supabase = useMemo(() => createClient(), []);
  const procedureId = consulta.service_link?.procedure?.id ?? null;
  return useQuery({
    queryKey: [
      "agenda",
      contexto.clinicId,
      "saldo-do-comparecimento",
      consulta.contact_id,
      procedureId,
    ],
    queryFn: async () => {
      if (!procedureId) {
        return null;
      }
      const saldos = await fetchSaldosParaComparecimento(
        supabase,
        contexto.clinicId,
        consulta.contact_id,
      );
      return saldoDescontadoAoComparecer(
        saldos,
        procedureId,
        diaCivil(contexto.timezone, new Date()),
      );
    },
    enabled: habilitado,
    staleTime: 30_000,
  });
}

export function AppointmentMenu({
  contexto,
  consulta,
  bloqueios,
  children,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  /** Bloqueios do mesmo profissional que cruzam o horario da consulta. */
  bloqueios: readonly BloqueioDaAgenda[];
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [pendente, iniciarTransicao] = useTransition();

  const [dialogFalta, setDialogFalta] = useState(false);
  const [dialogCanal, setDialogCanal] = useState(false);
  const [dialogRemarcar, setDialogRemarcar] = useState(false);
  const [cancelamento, setCancelamento] = useState<AppointmentStatus | null>(
    null,
  );
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [dialogComparecer, setDialogComparecer] = useState(false);
  const [bloqueioARemover, setBloqueioARemover] =
    useState<BloqueioDaAgenda | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  // O relogio do menu: renovado a cada abertura (falta so a partir do
  // horario da consulta, Compareceu so a partir do dia dela). O servidor
  // confere de novo com o horario do banco.
  const [agora, setAgora] = useState(() => Date.now());
  const idDicaFalta = useId();
  const idDicaComparecer = useId();
  const idDicaPendente = useId();
  const idDicaRemarcar = useId();
  const idBloqueio = useId();
  const idDicaDados = useId();
  const podeRemoverBloqueios = podeRemoverBloqueio(contexto);
  // "Ver dados informados" (AG3): so a consulta que a IA marcou.
  const daIa = ehConsultaDaIa(consulta);
  const dadosInformados = useDadosInformados();

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const transicoes = transicoesPermitidas(consulta.status);
  const faltaAindaNao = !faltaLiberada(consulta.starts_at, new Date(agora));
  const comparecerAindaNao = !comparecimentoLiberado(
    contexto.timezone,
    consulta.starts_at,
    new Date(agora),
  );
  const remarcavel = podeRemarcar(consulta.status);
  // Consulta pendente (item 10): alguma situacao da lista espera a
  // aprovacao? A dica aparece uma vez, embaixo do rotulo do grupo.
  const algumaEsperaAprovacao = transicoes.some((novoStatus) =>
    mudancaEsperaAprovacao(consulta.approval_status, novoStatus),
  );

  // Confere o pacote ja na abertura do menu: quando a recepcao escolhe
  // Compareceu, a tela ja sabe se precisa perguntar. A pendente nao
  // comparece antes da aprovacao: nem confere.
  const podeComparecerAgora =
    contexto.podeEditar &&
    transicoes.includes("compareceu") &&
    !comparecerAindaNao &&
    !mudancaEsperaAprovacao(consulta.approval_status, "compareceu");
  const saldoQuery = useSaldoDoComparecimento(
    contexto,
    consulta,
    menuAberto && podeComparecerAgora,
  );

  const atualizarAgenda = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["agenda", contexto.clinicId],
      }),
      queryClient.invalidateQueries({
        queryKey: agendaKeys.historico(consulta.id),
      }),
    ]);

  const aplicarStatus = (
    novoStatus: AppointmentStatus,
    canal: CanalConfirmacao | null,
    aoTerminar?: () => void,
    oferecerVaga?: boolean,
  ) => {
    iniciarTransicao(async () => {
      const resultado = await mudarStatusAction({
        id: consulta.id,
        status_atual: consulta.status,
        novo_status: novoStatus,
        canal,
        ...(oferecerVaga === undefined ? {} : { oferecer_vaga: oferecerVaga }),
      });
      mostrarRetornoDaPendencia(
        retornoDaMudancaDeSituacao(resultado, novoStatus),
      );
      if (resultado.ok) {
        await atualizarAgenda();
      }
      aoTerminar?.();
    });
  };

  const escolherTransicao = (novoStatus: AppointmentStatus) => {
    if (novoStatus === "faltou") {
      setDialogFalta(true);
      return;
    }
    if (novoStatus === "confirmado_recepcao") {
      setDialogCanal(true);
      return;
    }
    // Cancelar nao tem volta e pode acionar a lista de espera: sempre com
    // confirmacao que nomeia paciente, procedimento e horario (achado 80).
    if (eCancelamento(novoStatus)) {
      setCancelamento(novoStatus);
      return;
    }
    // Compareceu e situacao final e o banco desconta sessao de pacote: com
    // saldo a descontar (ou sem saber ainda), pergunta nomeando paciente e
    // pacote. Sem saldo, sai direto (achado L11).
    if (
      novoStatus === "compareceu" &&
      !(saldoQuery.isSuccess && saldoQuery.data === null)
    ) {
      setDialogComparecer(true);
      return;
    }
    aplicarStatus(novoStatus, null);
  };

  // Depois de uma falta, a nova consulta nasce com o mesmo paciente, o mesmo
  // procedimento pelo mesmo convenio e o mesmo profissional sugerido. A data
  // sugerida e hoje, nunca um dia que ja passou.
  const marcarNovaConsulta = () => {
    const hoje = diaCivil(contexto.timezone, new Date());
    const diaDaFalta = diaCivil(
      contexto.timezone,
      new Date(consulta.starts_at),
    );
    contexto.abrirAgendamento?.({
      contactId: consulta.contact_id,
      procedimentoId: consulta.service_link?.procedure?.id,
      convenioId: consulta.service_link?.insurance?.id ?? null,
      professionalId: consulta.professional_id,
      dia: diaDaFalta > hoje ? diaDaFalta : hoje,
    });
  };

  const rotulosDaPendencia = rotulosDaPendenciaNoMenu(daIa);
  const pendenteDeAprovacao = aguardaAprovacao(consulta);
  // O mesmo item nos dois lugares (no grupo da pendencia ou junto do
  // historico): a leitura so no clique.
  const itemDosDadosInformados = (
    <>
      <DropdownMenuItem
        disabled={!contexto.podeEditar}
        aria-describedby={contexto.podeEditar ? undefined : idDicaDados}
        className="h-10"
        onSelect={() => dadosInformados.abrir(consulta.id)}
      >
        <FileUser className="size-4 shrink-0" aria-hidden />
        <span>{TEXTOS_DOS_DADOS_INFORMADOS.ver}</span>
      </DropdownMenuItem>
      {contexto.podeEditar ? null : (
        <p
          id={idDicaDados}
          className="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary"
        >
          {TEXTOS_DOS_DADOS_INFORMADOS.semPermissao}
        </p>
      )}
    </>
  );
  const tratarPendencia = (decisao: AcaoDaPendencia) => {
    iniciarTransicao(async () => {
      mostrarRetornoDaPendencia(await tratarPendenciaNoMenu(consulta, decisao));
      await atualizarAgenda();
    });
  };

  return (
    <>
      <DropdownMenu
        onOpenChange={(aberto) => {
          if (aberto) {
            setAgora(Date.now());
          }
          setMenuAberto(aberto);
        }}
      >
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="truncate text-sm font-bold text-text-strong">
              {nome}
            </span>
            {consulta.contact?.phone_e164 ? (
              <span className="cz-num text-xs font-normal text-text-secondary">
                {formatarTelefone(consulta.contact.phone_e164)}
              </span>
            ) : null}
            <span className="truncate text-xs font-normal text-text-secondary">
              {consulta.service_link?.procedure?.name ?? "Procedimento"}
              {" · "}
              {consulta.service_link?.insurance?.name ?? "Particular"}
            </span>
            <span className="cz-num text-xs font-normal text-text-secondary">
              {horaNoFuso(contexto.timezone, consulta.starts_at)}
              {" às "}
              {horaNoFuso(contexto.timezone, consulta.ends_at)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {bloqueios.length > 0 ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="cz-eyebrow text-[10px] text-text-tertiary">
                  Horário bloqueado
                </DropdownMenuLabel>
                {bloqueios.map((bloqueio, indice) => {
                  const idResumo = `${idBloqueio}-resumo-${indice}`;
                  const idDica = `${idBloqueio}-dica-${indice}`;
                  return (
                    <div key={bloqueio.id} className="grid gap-1">
                      <div className="px-[9px] pb-1">
                        <ResumoDoBloqueio
                          contexto={contexto}
                          bloqueio={bloqueio}
                          comRotulo={false}
                          id={idResumo}
                        />
                      </div>
                      {/* Visivel sempre; sem permissao, desabilitado com o
                          porque logo abaixo, como na faixa. O item descreve
                          qual bloqueio sai (o menu le so os itens). */}
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!podeRemoverBloqueios}
                        aria-describedby={
                          podeRemoverBloqueios
                            ? idResumo
                            : `${idResumo} ${idDica}`
                        }
                        className="h-10"
                        onSelect={() => setBloqueioARemover(bloqueio)}
                      >
                        <Trash2 className="size-4 shrink-0" aria-hidden />
                        <span>Remover bloqueio</span>
                      </DropdownMenuItem>
                      {podeRemoverBloqueios ? null : (
                        <p
                          id={idDica}
                          className="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary"
                        >
                          {DICA_REMOVER_SEM_PERMISSAO}
                        </p>
                      )}
                    </div>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}

          {/* A pendente cancelada (o paciente cancelou) ja conta como
              recusada: sem Aprovar nem Recusar (revisao da onda 2). */}
          {pendenteDeAprovacao ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="cz-eyebrow text-[10px] text-text-tertiary">
                  {rotulosDaPendencia.grupo}
                </DropdownMenuLabel>
                {daIa ? itemDosDadosInformados : null}
                <DropdownMenuItem
                  disabled={!contexto.podeEditar || pendente}
                  className="h-10"
                  onSelect={() => tratarPendencia("aprovar")}
                >
                  <Check className="size-4 shrink-0" aria-hidden />
                  <span>{rotulosDaPendencia.aprovar}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!contexto.podeEditar || pendente}
                  className="h-10"
                  onSelect={() => tratarPendencia("recusar")}
                >
                  <X className="size-4 shrink-0" aria-hidden />
                  <span>{rotulosDaPendencia.recusar}</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}

          {transicoes.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="cz-eyebrow text-[10px] text-text-tertiary">
                Mudar situação
              </DropdownMenuLabel>
              {algumaEsperaAprovacao ? (
                <p
                  id={idDicaPendente}
                  className="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary"
                >
                  {DICA_CONSULTA_PENDENTE}
                </p>
              ) : null}
              {transicoes.map((novoStatus) => {
                const definicao = APPOINTMENT_STATUS[novoStatus];
                const tone = STATUS_TONE_VARS[definicao.tone];
                const Icone = definicao.icon;
                // A pendente (item 10) espera a aprovacao: a dica ja esta
                // embaixo do rotulo do grupo, e o item aponta para ela.
                const esperaAprovacao = mudancaEsperaAprovacao(
                  consulta.approval_status,
                  novoStatus,
                );
                // Faltou fica VISIVEL antes do horario (achado 81) e
                // Compareceu antes do dia da consulta (achado L11),
                // desabilitados e com o porque logo abaixo.
                const bloqueio = esperaAprovacao
                  ? null
                  : novoStatus === "faltou" && faltaAindaNao
                    ? { id: idDicaFalta, dica: DICA_FALTA_ANTES_DO_HORARIO }
                    : novoStatus === "compareceu" && comparecerAindaNao
                      ? {
                          id: idDicaComparecer,
                          dica: DICA_COMPARECEU_ANTES_DO_DIA,
                        }
                      : null;
                return (
                  <div key={novoStatus}>
                    <DropdownMenuItem
                      disabled={
                        !contexto.podeEditar ||
                        pendente ||
                        esperaAprovacao ||
                        bloqueio !== null
                      }
                      aria-describedby={
                        esperaAprovacao ? idDicaPendente : bloqueio?.id
                      }
                      className="h-10"
                      onSelect={() => escolherTransicao(novoStatus)}
                    >
                      {Icone ? (
                        <Icone
                          className="size-4 shrink-0"
                          style={{ color: tone.text }}
                          aria-hidden
                        />
                      ) : null}
                      <span>{definicao.label}</span>
                    </DropdownMenuItem>
                    {bloqueio ? (
                      <p
                        id={bloqueio.id}
                        className="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary"
                      >
                        {bloqueio.dica}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </DropdownMenuGroup>
          ) : (
            <DropdownMenuLabel className="text-xs font-normal text-text-secondary">
              Situação final, sem mudanças possíveis
            </DropdownMenuLabel>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!contexto.podeEditar || pendente || !remarcavel}
            aria-describedby={!remarcavel ? idDicaRemarcar : undefined}
            className="h-10"
            onSelect={() => setDialogRemarcar(true)}
          >
            <CalendarClock className="size-4" aria-hidden />
            <span>Remarcar</span>
          </DropdownMenuItem>
          {!remarcavel ? (
            <p
              id={idDicaRemarcar}
              className="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary"
            >
              {DICA_REMARCAR_ENCERRADA}
            </p>
          ) : null}
          {consulta.status === "faltou" && contexto.abrirAgendamento ? (
            <DropdownMenuItem
              disabled={!contexto.podeEditar}
              className="h-10"
              onSelect={() => marcarNovaConsulta()}
            >
              <CalendarPlus className="size-4" aria-hidden />
              <span>Marcar nova consulta</span>
            </DropdownMenuItem>
          ) : null}
          {daIa && !pendenteDeAprovacao ? itemDosDadosInformados : null}
          <DropdownMenuItem
            className="h-10"
            onSelect={() => setHistoricoAberto(true)}
          >
            <History className="size-4" aria-hidden />
            <span>Ver histórico</span>
          </DropdownMenuItem>

          {!contexto.podeEditar ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="max-w-64 text-xs font-normal whitespace-normal text-text-secondary">
                {contexto.dica}
              </DropdownMenuLabel>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmacao explicita de falta: nunca automatica */}
      <Dialog open={dialogFalta} onOpenChange={setDialogFalta}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Marcar falta de {nome}?</DialogTitle>
            <DialogDescription>
              Falta é sempre uma ação registrada, nunca automática.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              disabled={pendente}
              onClick={() => setDialogFalta(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={pendente}
              onClick={() =>
                aplicarStatus("faltou", null, () => setDialogFalta(false))
              }
            >
              Confirmar falta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Canal da confirmacao pela recepcao */}
      <Dialog open={dialogCanal} onOpenChange={setDialogCanal}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Como a confirmação chegou?</DialogTitle>
            <DialogDescription>
              O canal fica registrado junto com a confirmação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {CANAIS.map((canal) => (
              <Button
                key={canal.valor}
                variant="outline"
                className="h-10 justify-start"
                disabled={pendente}
                onClick={() =>
                  aplicarStatus("confirmado_recepcao", canal.valor, () =>
                    setDialogCanal(false),
                  )
                }
              >
                {canal.rotulo}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {cancelamento ? (
        <CancelarDialog
          contexto={contexto}
          consulta={consulta}
          status={cancelamento}
          pendente={pendente}
          onFechar={() => setCancelamento(null)}
          onConfirmar={(oferecerVaga) =>
            aplicarStatus(
              cancelamento,
              null,
              () => setCancelamento(null),
              oferecerVaga,
            )
          }
        />
      ) : null}

      {dialogComparecer ? (
        <ComparecimentoDialog
          contexto={contexto}
          consulta={consulta}
          pendente={pendente}
          onFechar={() => setDialogComparecer(false)}
          onConfirmar={() =>
            aplicarStatus("compareceu", null, () => setDialogComparecer(false))
          }
        />
      ) : null}

      {bloqueioARemover ? (
        <ConfirmarRemocaoDoBloqueio
          contexto={contexto}
          bloqueio={bloqueioARemover}
          onFechar={() => setBloqueioARemover(null)}
        />
      ) : null}

      {dialogRemarcar ? (
        <RemarcarDialog
          contexto={contexto}
          consulta={consulta}
          aberto={dialogRemarcar}
          onFechar={() => setDialogRemarcar(false)}
          onSucesso={atualizarAgenda}
        />
      ) : null}

      <StatusHistorySheet
        contexto={contexto}
        consulta={consulta}
        aberto={historicoAberto}
        onFechar={() => setHistoricoAberto(false)}
      />

      {daIa ? (
        <DialogoDosDadosInformados
          aberto={dadosInformados.aberta !== null}
          nome={contatoDaConsulta(consulta)}
          fuso={contexto.timezone}
          situacao={situacaoDaConsulta(consulta)}
          estado={dadosInformados.estado}
          aoFechar={dadosInformados.fechar}
          aoTentarDeNovo={dadosInformados.tentarDeNovo}
          aoRevelar={dadosInformados.revelar}
        />
      ) : null}
    </>
  );
}

function RemarcarDialog({
  contexto,
  consulta,
  aberto,
  onFechar,
  onSucesso,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  aberto: boolean;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [dia, setDia] = useState(() =>
    diaCivil(contexto.timezone, new Date(consulta.starts_at)),
  );
  const [hora, setHora] = useState(() =>
    horaNoFuso(contexto.timezone, consulta.starts_at),
  );
  // Profissional desativado nao recebe a consulta, nem a que ja e dele
  // (achado L12): o seletor nasce vazio e a recepcao escolhe outro.
  const profissionalAtual = contexto.catalogo.profissionais.find(
    (p) => p.id === consulta.professional_id,
  );
  const atualInativo = !profissionalAtual?.active;
  const [profissionalId, setProfissionalId] = useState(
    atualInativo ? "" : consulta.professional_id,
  );
  const [avisarPaciente, setAvisarPaciente] = useState(true);
  const idChaveAviso = useId();

  // So quem atende o MESMO procedimento pelo MESMO convenio (achado 85), e
  // ativo: o servidor recusa os demais, entao a lista nem os oferece.
  const profissionaisPossiveis = profissionaisParaRemarcar(contexto, consulta);
  // Troca no mesmo dia civil da clinica mantem quem ja esta na recepcao; para
  // outro dia, a situacao volta para Agendado (achado R4). A nota diz antes.
  const mesmoDia =
    dia === diaCivil(contexto.timezone, new Date(consulta.starts_at));

  const confirmar = () => {
    if (!dia || !hora) {
      setErro("Informe o dia e a hora do novo horário.");
      return;
    }
    if (!profissionalId) {
      setErro("Escolha o profissional que vai atender.");
      return;
    }
    setErro(null);
    iniciarTransicao(async () => {
      // A duracao sai do vinculo no servidor; a tela so manda o novo inicio.
      const novoInicio = instanteLocal(contexto.timezone, dia, hora);
      const resultado = await remarcarAgendamentoAction({
        id: consulta.id,
        starts_at_esperado: consulta.starts_at,
        novo_starts_at: novoInicio.toISOString(),
        novo_professional_id: profissionalId,
        avisar_paciente: avisarPaciente,
      });
      if (resultado.ok) {
        toast.success("Consulta remarcada.");
        if (resultado.aviso) {
          // O aviso NAO saiu: a recepcao precisa saber para ligar.
          toast.warning(resultado.aviso, { duration: 10_000 });
        }
        onSucesso();
        onFechar();
        return;
      }
      if (
        resultado.code &&
        ERROS_CORRIGIVEIS_NA_REMARCACAO.has(resultado.code)
      ) {
        // Mantem o dialogo aberto para escolher outro horario ou profissional
        setErro(resultado.error ?? "Não foi possível remarcar neste horário.");
        return;
      }
      toast.error(resultado.error ?? "Não foi possível remarcar.");
      onFechar();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remarcar consulta</DialogTitle>
          <DialogDescription>
            {consulta.contact?.name ?? "Paciente"}
            {" · "}
            {consulta.service_link?.procedure?.name ?? "Procedimento"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="remarcar-dia">Novo dia</Label>
              <Input
                id="remarcar-dia"
                type="date"
                className="cz-num"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="remarcar-hora">Nova hora</Label>
              <Input
                id="remarcar-hora"
                type="time"
                className="cz-num"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="remarcar-profissional">Profissional</Label>
            {atualInativo ? (
              <Aviso tom="warning">
                {profissionalAtual
                  ? `O cadastro de ${profissionalAtual.name} está inativo. Escolha outro profissional para a consulta.`
                  : MENSAGEM_PROFISSIONAL_INATIVO}
              </Aviso>
            ) : null}
            <Select
              value={profissionalId}
              onValueChange={setProfissionalId}
              disabled={profissionaisPossiveis.length === 0}
            >
              <SelectTrigger id="remarcar-profissional" className="h-10 w-full">
                <SelectValue placeholder="Escolha o profissional" />
              </SelectTrigger>
              <SelectContent>
                {profissionaisPossiveis.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-secondary">
              {profissionaisPossiveis.length === 0
                ? "Nenhum profissional ativo atende este procedimento por este convênio. Defina quem faz este procedimento em Cadastros > Procedimentos ou cancele a consulta."
                : "Aparecem só os profissionais ativos que atendem este procedimento por este convênio."}
            </p>
          </div>

          <ChaveAvisarPaciente
            id={idChaveAviso}
            marcada={avisarPaciente}
            aoMudar={setAvisarPaciente}
          />

          <NotaDaConfirmacao consulta={consulta} mesmoDia={mesmoDia} />

          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Cancelar
          </Button>
          <Button
            className="h-10"
            disabled={pendente || !profissionalId}
            onClick={confirmar}
          >
            {pendente ? "Remarcando..." : "Remarcar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirmacao do Compareceu que desconta sessao de pacote (achado L11).
 * Nomeia paciente, procedimento, profissional e horario, o pacote e o saldo
 * que fica, e diz que a situacao e final. So abre quando ha saldo a
 * descontar ou quando a tela ainda nao sabe (conferindo, ou a leitura
 * falhou): melhor perguntar a mais do que descontar sem perguntar.
 */
function ComparecimentoDialog({
  contexto,
  consulta,
  pendente,
  onFechar,
  onConfirmar,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  const saldoQuery = useSaldoDoComparecimento(contexto, consulta, true);
  const saldo = saldoQuery.data ?? null;

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const procedimento = consulta.service_link?.procedure?.name ?? "Consulta";
  const profissional = contexto.catalogo.profissionais.find(
    (p) => p.id === consulta.professional_id,
  )?.name;
  const quando = diaEHoraNoFuso(contexto.timezone, consulta.starts_at);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Confirmar que {nome} compareceu?</DialogTitle>
          <DialogDescription>
            {procedimento}
            {profissional ? ` com ${profissional}` : ""},{" "}
            <span className="cz-num">{quando}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {saldoQuery.isPending ? (
            <Skeleton
              className="h-14 w-full"
              aria-label="Conferindo os pacotes do paciente"
            />
          ) : saldoQuery.isError ? (
            <Aviso tom="warning">
              Não foi possível conferir os pacotes do paciente. Se ele tiver
              pacote de {procedimento}, uma sessão será descontada.
            </Aviso>
          ) : saldo ? (
            // Pacote com varios procedimentos: a frase nomeia o procedimento
            // que perde a sessao e o pacote de onde ela sai, com o estado
            // depois de marcar.
            <div className="grid gap-1 rounded-xl border border-border px-3.5 py-2.5">
              <p className="text-sm font-semibold text-text-strong">
                {fraseDoDescontoAoComparecer(saldo, procedimento)}
              </p>
              <p className="text-xs text-text-secondary">
                {fraseDoQueSobra(saldo, procedimento)}
              </p>
            </div>
          ) : null}

          <p className="text-sm">
            Compareceu é situação final.
            {saldo || saldoQuery.isError
              ? " Se for engano, a sessão só volta com Ajustar saldo, na ficha do paciente."
              : ""}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Voltar
          </Button>
          <Button
            className="h-10"
            disabled={pendente || saldoQuery.isPending}
            onClick={onConfirmar}
          >
            {pendente ? "Marcando..." : "Confirmar comparecimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirmacao dos dois cancelamentos (achado 80). Nomeia paciente,
 * procedimento, profissional e horario no fuso da clinica, diz que nao tem
 * volta e, quando a lista de espera vai ser acionada, deixa a recepcao
 * decidir se oferece o horario (appointment.oferecer_vaga_ao_cancelar).
 */
function CancelarDialog({
  contexto,
  consulta,
  status,
  pendente,
  onFechar,
  onConfirmar,
}: {
  contexto: ContextoAgenda;
  consulta: ConsultaDaAgenda;
  status: AppointmentStatus;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: (oferecerVaga: boolean | undefined) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [oferecerVaga, setOferecerVaga] = useState(true);
  const [abertoEm] = useState(() => Date.now());
  const idOferecer = useId();

  // Encaixe nao e reoferecido (o gatilho de reoferta ignora encaixe), nem a
  // pendencia da IA: cancelar conta como recusar, e a recusa nunca oferece
  // o horario (decisao do dono de 20/10/2026).
  const podeIrParaALista =
    !consulta.is_overbooking && !cancelarContaComoRecusa(consulta);
  const esperaQuery = useQuery({
    queryKey: agendaKeys.listaDeEspera(contexto.clinicId),
    queryFn: () => fetchListaDeEsperaDaClinica(supabase, contexto.clinicId),
    enabled: podeIrParaALista,
    staleTime: 60_000,
  });

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const procedimento = consulta.service_link?.procedure?.name ?? "Consulta";
  const profissional = contexto.catalogo.profissionais.find(
    (p) => p.id === consulta.professional_id,
  )?.name;
  const quando = diaEHoraNoFuso(contexto.timezone, consulta.starts_at);
  const titulo =
    status === "cancelado_paciente"
      ? `Cancelar a consulta de ${nome} a pedido do paciente?`
      : `Cancelar a consulta de ${nome} pela clínica?`;

  // A oferta so parte quando ha fila ativa e da tempo de o paciente da lista
  // responder antes do horario (a mesma guarda do job de reoferta).
  const espera = esperaQuery.data;
  const daTempoDeOferecer =
    espera !== undefined &&
    new Date(consulta.starts_at).getTime() >
      abertoEm + espera.janelaMinutos * 60_000;
  const vaParaALista =
    podeIrParaALista &&
    espera !== undefined &&
    espera.ativos > 0 &&
    daTempoDeOferecer;
  // Sem saber se ha fila (erro de leitura), a escolha continua na mao da
  // recepcao: melhor perguntar a mais do que oferecer sem perguntar.
  const mostrarEscolha =
    podeIrParaALista && (vaParaALista || esperaQuery.isError);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {procedimento}
            {profissional ? ` com ${profissional}` : ""},{" "}
            <span className="cz-num">{quando}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="text-sm">
            Cancelar não tem volta. Para atender o paciente de novo, marque uma
            nova consulta.
          </p>

          {podeIrParaALista && esperaQuery.isPending ? (
            <Skeleton
              className="h-10 w-full"
              aria-label="Conferindo a lista de espera"
            />
          ) : null}

          {mostrarEscolha ? (
            <div className="grid gap-2 rounded-xl border border-border px-3.5 py-2.5">
              <p className="text-sm text-text-secondary">
                {esperaQuery.isError
                  ? "Não foi possível conferir a lista de espera. Se houver pacientes nela, este horário pode ser oferecido a eles pelo WhatsApp."
                  : `Há ${espera?.ativos === 1 ? "1 paciente" : `${espera?.ativos ?? 0} pacientes`} na lista de espera. Com a opção marcada, este horário é oferecido pelo WhatsApp a quem combina com ele.`}
              </p>
              <div className="flex min-h-10 items-center gap-3">
                <Checkbox
                  id={idOferecer}
                  checked={oferecerVaga}
                  onCheckedChange={(valor) => setOferecerVaga(valor === true)}
                />
                <Label htmlFor={idOferecer}>
                  Oferecer este horário à lista de espera
                </Label>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Manter consulta
          </Button>
          <Button
            variant="destructive"
            className="h-10"
            disabled={pendente || (podeIrParaALista && esperaQuery.isPending)}
            onClick={() =>
              onConfirmar(mostrarEscolha ? oferecerVaga : undefined)
            }
          >
            {pendente ? "Cancelando..." : "Cancelar consulta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
