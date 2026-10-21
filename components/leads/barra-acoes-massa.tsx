"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  IdCard,
  Tag,
  UserRoundCog,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  etiquetarAction,
  marcarComoPacienteAction,
  mudarEtapaAction,
  reatribuirAction,
} from "@/app/(app)/leads/actions";
import {
  contarLeads,
  executarEmLotes,
  mensagemDeFalhaParcial,
  type ResultadoDaAcao,
  type ResultadoEmLotes,
} from "@/components/leads/em-lotes";
import { PainelEtiquetarLead } from "@/components/leads/etiquetar-lead";
import type { OpcaoDeResponsavel } from "@/components/leads/filtros-leads";
import {
  DialogoMarcarComoPaciente,
  ROTULO_MARCAR_COMO_PACIENTE,
} from "@/components/leads/marcar-como-paciente";
import { ModalMotivoPerda } from "@/components/leads/modal-motivo-perda";
import {
  decidirMudancaDeEtapa,
  DialogoMoverParaEtapa,
  ITEM_DO_POPOVER,
  OpcoesDeEtapa,
  type ConfirmacaoDeEtapa,
} from "@/components/leads/mudar-etapa";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  outrasGrafias,
  type LeituraDasEtiquetas,
  type OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import {
  leadsKeys,
  type LeadResumo,
  type ReguaDaEtapa,
} from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Barra flutuante das acoes em massa da lista, no desenho do design system
// Conduzza (docs/06 secao 5.4). Toda acao usa as Server Actions de Leads;
// Perdido passa pelo mesmo modal de motivo do Kanban.
//
// Correcoes da revisao de liberacao:
// - achado 95: selecao grande vai em lotes de 100 (o teto das actions), com
//   progresso; falha no meio diz quantos mudaram e deixa selecionados so os
//   que nao mudaram;
// - achado 96: depois de uma acao que deu certo, a selecao zera;
// - achado 97: "Disparar regua" continua visivel e desabilitado, agora com a
//   dica verdadeira (as reguas de follow-up sao por etapa e comecam sozinhas);
// - achado 98: no Mudar etapa, a etapa com regua de follow-up ligada vem
//   marcada, e mover para ela pede confirmacao dizendo quantos autorizados
//   vao receber as mensagens.
//
// "Marcar como paciente" (decisao do dono em 20/10/2026): os leads da
// selecao passam a aparecer em Pacientes, sem consulta e sem mudar de etapa.
// A confirmacao diz quantos mudam e quantos ja sao pacientes (esses ficam
// como estao e nem vao para o servidor); depois, em lotes de 100 com o
// progresso, como as outras acoes.
//
// "Etiquetar lead" (relato do dono em 20/10/2026, "nao aparecem as que ja
// existem"): o popover (etiquetar-lead.tsx) oferece as etiquetas da clinica,
// as cadastradas em Configuracoes e as que ja estao em uso nos leads, sem
// repetir. A etiqueta continua em contact.tags, pelo mesmo etiquetar. Quem
// adiciona "LEAD" tira, no mesmo pedido, outra grafia da mesma etiqueta
// ("lead") dos selecionados: o lead nao fica com as duas.
//
// "Mudar etapa" (20/10/2026): a regra (Perdido, regua, direto), a lista das
// etapas e a confirmacao moram em mudar-etapa.tsx, porque a linha da lista e
// a gaveta mudam a etapa de um lead com as MESMAS regras. Aqui nada mudou.

const SEM_OPCOES: readonly OpcaoDeEtiqueta[] = [];

const DICA_JA_SAO_PACIENTES = "Os contatos selecionados já são pacientes.";

const DICA_DISPARAR_REGUA =
  "As réguas de follow-up começam sozinhas quando o lead entra na etapa. Use Mudar etapa para colocar os selecionados numa etapa com régua.";

// Popover de acao protegida: com permissao abre o popover; sem permissao o
// botao fica visivel e desabilitado com a dica, sem popover nenhum.
function AcaoComPopover({
  podeEditar,
  dica,
  ocupado,
  rotulo,
  icone: Icone,
  aberto,
  onAberto,
  larguraClassName = "w-56",
  children,
}: {
  podeEditar: boolean;
  dica: string;
  ocupado: boolean;
  rotulo: string;
  icone: LucideIcon;
  aberto: boolean;
  onAberto: (a: boolean) => void;
  larguraClassName?: string;
  children: React.ReactNode;
}) {
  if (!podeEditar) {
    return (
      <DisabledWithHint hint={dica}>
        <Button variant="outline" disabled>
          <Icone className="size-4" /> {rotulo}
        </Button>
      </DisabledWithHint>
    );
  }
  return (
    <Popover open={aberto} onOpenChange={onAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={ocupado}>
          <Icone className="size-4" /> {rotulo}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("gap-0 p-[5px]", larguraClassName)}
        align="center"
        side="top"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

type Progresso = { verbo: string; feitos: number; total: number };

export function BarraAcoesMassa({
  jornada,
  clinicId,
  selecionados,
  responsaveis,
  reguas,
  podeEditar,
  dica,
  etiquetasDaClinica = SEM_OPCOES,
  leituraDasEtiquetas = "pronto",
  aoTentarDeNovoAsEtiquetas,
  onLimpar,
  aoConcluir,
}: {
  jornada: EtapaDaJornada[];
  clinicId: string;
  selecionados: LeadResumo[];
  /** Membros ativos, ja ordenados: os unicos que podem virar responsavel */
  responsaveis: OpcaoDeResponsavel[];
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: ReguaDaEtapa[] | null;
  podeEditar: boolean;
  dica: string;
  /** Cadastradas e em uso nos leads carregados, sem repetir */
  etiquetasDaClinica?: readonly OpcaoDeEtiqueta[];
  /** Leitura das cadastradas: sem ela, o popover avisa e fica com as em uso */
  leituraDasEtiquetas?: LeituraDasEtiquetas;
  aoTentarDeNovoAsEtiquetas?: () => void;
  onLimpar: () => void;
  /** Fim de uma acao: a selecao passa a ser so os que nao mudaram */
  aoConcluir: (restantes: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [reatribuirAberto, setReatribuirAberto] = useState(false);
  const [etapaAberto, setEtapaAberto] = useState(false);
  const [etiquetarAberto, setEtiquetarAberto] = useState(false);
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [perdaIds, setPerdaIds] = useState<string[] | null>(null);
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoDeEtapa | null>(
    null,
  );
  const [pacientesAberto, setPacientesAberto] = useState(false);

  const ids = selecionados.map((lead) => lead.id);
  const n = ids.length;
  const ocupado = progresso !== null;
  // Quem da selecao ainda e lead: so eles mudam no "Marcar como paciente".
  const idsDeLeads = selecionados
    .filter((lead) => lead.kind !== "paciente")
    .map((lead) => lead.id);
  const jaPacientes = n - idsDeLeads.length;

  const invalidar = () =>
    void queryClient.invalidateQueries({ queryKey: leadsKeys.lista(clinicId) });

  // Roda a acao em lotes de 100 com o progresso na barra. Recarrega a lista
  // se qualquer lote gravou. O alvo e a selecao inteira, salvo quando a
  // acao so vale para parte dela (Marcar como paciente: so os leads).
  const rodar = async (
    verbo: string,
    acao: (lote: string[]) => Promise<ResultadoDaAcao>,
    alvo: string[] = ids,
  ): Promise<ResultadoEmLotes> => {
    setProgresso({ verbo, feitos: 0, total: alvo.length });
    const resultado = await executarEmLotes(alvo, acao, (feitos) =>
      setProgresso({ verbo, feitos, total: alvo.length }),
    );
    setProgresso(null);
    if (resultado.feitos.length > 0) {
      invalidar();
    }
    return resultado;
  };

  // Tudo certo: aviso de sucesso e selecao limpa. Falha no meio: diz quantos
  // mudaram e deixa selecionados so os que nao mudaram, para tentar de novo.
  const concluir = (resultado: ResultadoEmLotes, sucesso: string) => {
    if (resultado.erro === null) {
      toast.success(sucesso);
      aoConcluir([]);
      return;
    }
    toast.error(mensagemDeFalhaParcial(resultado, n));
    aoConcluir(resultado.restantes);
  };

  const reatribuir = async (userId: string | null) => {
    setReatribuirAberto(false);
    const resultado = await rodar("Reatribuindo", (lote) =>
      reatribuirAction({ contact_ids: lote, owner_user_id: userId }),
    );
    concluir(
      resultado,
      n === 1 ? "1 lead reatribuído" : `${n} leads reatribuídos`,
    );
  };

  const moverPara = async (chave: string, nome: string) => {
    const resultado = await rodar("Movendo", (lote) =>
      mudarEtapaAction({ contact_ids: lote, etapa: chave }),
    );
    concluir(
      resultado,
      `${contarLeads(n)} ${n === 1 ? "movido" : "movidos"} para ${nome}`,
    );
  };

  // As regras de mudar-etapa.tsx, as mesmas da linha e da gaveta.
  const escolherEtapa = (def: EtapaDaJornada) => {
    setEtapaAberto(false);
    const decisao = decidirMudancaDeEtapa(def, reguas);
    if (decisao.tipo === "pedir_motivo") {
      setPerdaIds(ids);
      return;
    }
    if (decisao.tipo === "confirmar") {
      setConfirmacao({
        chave: def.chave,
        nome: def.nome,
        regua: decisao.regua,
      });
      return;
    }
    void moverPara(def.chave, def.nome);
  };

  const etiquetar = async (
    adicionar: string[],
    remover: string[],
    sucesso: string,
  ) => {
    const resultado = await rodar("Etiquetando", (lote) =>
      etiquetarAction({ contact_ids: lote, adicionar, remover }),
    );
    if (resultado.erro === null) {
      setNovaEtiqueta("");
      setEtiquetarAberto(false);
    }
    concluir(resultado, sucesso);
  };

  // A grafia ja vem resolvida pelo popover (a da clinica, quando existe).
  const adicionarEtiqueta = (nome: string) =>
    void etiquetar(
      [nome],
      outrasGrafias(nome, selecionados),
      `Etiqueta ${nome} adicionada em ${contarLeads(n)}`,
    );

  const removerEtiqueta = (nome: string) =>
    void etiquetar(
      [],
      [nome],
      `Etiqueta ${nome} removida de ${contarLeads(n)}`,
    );

  const marcarComoPacientes = async () => {
    setPacientesAberto(false);
    const alvo = idsDeLeads;
    let marcados = 0;
    const resultado = await rodar(
      "Marcando",
      async (lote) => {
        const parcial = await marcarComoPacienteAction({ contact_ids: lote });
        if (parcial.ok) {
          marcados += parcial.marcados;
        }
        return parcial;
      },
      alvo,
    );
    if (resultado.feitos.length > 0) {
      // A lista ja mostra paciente nos que mudaram, sem esperar o tempo real.
      const feitos = new Set(resultado.feitos);
      queryClient.setQueryData<LeadResumo[]>(
        leadsKeys.lista(clinicId),
        (atual) =>
          atual
            ? atual.map((lead) =>
                feitos.has(lead.id)
                  ? { ...lead, kind: "paciente" as const }
                  : lead,
              )
            : atual,
      );
      void queryClient.invalidateQueries({ queryKey: ["pacientes"] });
    }
    if (resultado.erro !== null) {
      toast.error(mensagemDeFalhaParcial(resultado, alvo.length));
      aoConcluir(resultado.restantes);
      return;
    }
    if (marcados === 0) {
      toast.info("Nenhum lead mudou: os selecionados já eram pacientes.");
    } else {
      toast.success(
        marcados === 1
          ? "1 lead marcado como paciente"
          : `${marcados} leads marcados como pacientes`,
      );
    }
    aoConcluir([]);
  };

  // Uniao das etiquetas dos selecionados, para remover em massa.
  const etiquetasAtuais = [
    ...new Set(selecionados.flatMap((lead) => lead.tags)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Quem de fato passa a receber a regua ao mudar para a etapa confirmada:
  // tem autorizacao e ainda nao estava nela (o relogio da etapa so anda
  // quando a etapa muda).
  const recebem = confirmacao
    ? selecionados.filter(
        (lead) => lead.consent_ativo && lead.funnel_stage !== confirmacao.chave,
      ).length
    : 0;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-card border border-border-strong bg-card px-3 py-2 shadow-pop">
        {progresso ? (
          <span
            role="status"
            className="flex items-center gap-2 px-1 text-[13px] font-semibold whitespace-nowrap text-text-strong"
          >
            {progresso.verbo} <span className="cz-num">{progresso.feitos}</span>{" "}
            de <span className="cz-num">{progresso.total}</span>
            <BarraDeProgresso
              valor={progresso.feitos}
              maximo={progresso.total}
              tamanho="sm"
              ariaLabel={`${progresso.feitos} de ${progresso.total} leads`}
              className="w-16"
            />
          </span>
        ) : (
          <span className="px-1 text-[13px] font-semibold whitespace-nowrap text-text-strong">
            <span className="cz-num">{n}</span>{" "}
            {n === 1 ? "selecionado" : "selecionados"}
          </span>
        )}
        <span aria-hidden className="h-6 w-px bg-border" />

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Reatribuir"
          icone={UserRoundCog}
          aberto={reatribuirAberto}
          onAberto={setReatribuirAberto}
        >
          <div className="grid cz-scroll max-h-64 overflow-y-auto">
            {responsaveis.length === 0 ? (
              <p className="px-[9px] py-2 text-xs text-text-secondary">
                Nenhum membro ativo na clínica.
              </p>
            ) : null}
            {responsaveis.map((membro) => (
              <button
                key={membro.id}
                type="button"
                className={ITEM_DO_POPOVER}
                onClick={() => void reatribuir(membro.id)}
              >
                <span className="truncate">{membro.nome}</span>
              </button>
            ))}
            <button
              type="button"
              className={cn(ITEM_DO_POPOVER, "text-text-secondary")}
              onClick={() => void reatribuir(null)}
            >
              Sem responsável
            </button>
          </div>
        </AcaoComPopover>

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Mudar etapa"
          icone={ArrowRightLeft}
          aberto={etapaAberto}
          onAberto={setEtapaAberto}
          larguraClassName="w-64"
        >
          <OpcoesDeEtapa
            jornada={jornada}
            reguas={reguas}
            aoEscolher={escolherEtapa}
          />
        </AcaoComPopover>

        <AcaoComPopover
          podeEditar={podeEditar}
          dica={dica}
          ocupado={ocupado}
          rotulo="Etiquetar lead"
          icone={Tag}
          aberto={etiquetarAberto}
          onAberto={setEtiquetarAberto}
          larguraClassName="w-72"
        >
          <PainelEtiquetarLead
            novaEtiqueta={novaEtiqueta}
            aoDigitar={setNovaEtiqueta}
            opcoes={etiquetasDaClinica}
            leitura={leituraDasEtiquetas}
            aoTentarDeNovo={aoTentarDeNovoAsEtiquetas}
            etiquetasDosSelecionados={etiquetasAtuais}
            ocupado={ocupado}
            aoAdicionar={adicionarEtiqueta}
            aoRemover={removerEtiqueta}
          />
        </AcaoComPopover>

        {podeEditar && idsDeLeads.length > 0 ? (
          <Button
            variant="outline"
            disabled={ocupado}
            onClick={() => setPacientesAberto(true)}
          >
            <IdCard className="size-4" /> {ROTULO_MARCAR_COMO_PACIENTE}
          </Button>
        ) : (
          <DisabledWithHint hint={podeEditar ? DICA_JA_SAO_PACIENTES : dica}>
            <Button variant="outline" disabled>
              <IdCard className="size-4" /> {ROTULO_MARCAR_COMO_PACIENTE}
            </Button>
          </DisabledWithHint>
        )}

        <DisabledWithHint hint={DICA_DISPARAR_REGUA}>
          <Button variant="outline" disabled>
            <Workflow className="size-4" /> Disparar régua
          </Button>
        </DisabledWithHint>

        <Button variant="ghost" onClick={onLimpar} disabled={ocupado}>
          <X className="size-4" /> Limpar seleção
        </Button>
      </div>

      <DialogoMoverParaEtapa
        confirmacao={confirmacao}
        quem={{ tipo: "selecao", total: n, recebem }}
        aoCancelar={() => setConfirmacao(null)}
        aoConfirmar={({ chave, nome }) => {
          setConfirmacao(null);
          void moverPara(chave, nome);
        }}
      />

      <DialogoMarcarComoPaciente
        aberto={pacientesAberto}
        leads={idsDeLeads.length}
        jaPacientes={jaPacientes}
        onConfirmar={() => void marcarComoPacientes()}
        onFechar={() => setPacientesAberto(false)}
      />

      <ModalMotivoPerda
        contactIds={perdaIds}
        onFechar={() => setPerdaIds(null)}
        onSucesso={(feitos) => {
          invalidar();
          const gravados = new Set(feitos);
          aoConcluir(ids.filter((id) => !gravados.has(id)));
        }}
      />
    </>
  );
}
