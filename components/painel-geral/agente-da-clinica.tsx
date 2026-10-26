"use client";

import { Bot, CircleQuestionMark } from "lucide-react";
import { useId } from "react";

import {
  estadoDaIa,
  IA_NA_CLINICA_STATUS,
  motivosDaParada,
  oQueNaoDeuParaConferir,
  textosDaParada,
  TEXTOS_DA_IA,
  type ContextoDaIa,
} from "@/components/agente/whatsapp/agente-de-ia";
import {
  DialogoDoAgente,
  useMudancaDoAgente,
} from "@/components/painel-geral/dialogo-do-agente";
import {
  AGENTE_DA_CLINICA_STATUS,
  OPCOES_DO_ESTADO_DO_AGENTE,
  producaoLiberada,
  publicoNoDialogo,
  TEXTOS_DO_PAINEL,
  type OpcaoDoAgente,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  EstadoDoAgente,
  RequisitosDaProducao,
} from "@/lib/queries/painel-geral";

// O agente de IA da clinica no detalhe do Painel geral (onda 1, decisao do
// dono de 20/10/2026): Desligado, Teste e Producao. Ligar em teste pede
// confirmacao, com o efeito e um motivo opcional (vai para a trilha);
// desligar e na hora (o lado seguro: as conversas do agente voltam para a
// equipe).
//
// Producao (onda 2, item 11, decisoes P11a a P11e): so a partir de Teste e
// so com todos os requisitos de "Para liberar a produção" cumpridos; fora
// disso a opcao fica visivel e desabilitada, com o porque escrito logo
// abaixo (o segmentado nao abre dica numa opcao desabilitada). O dialogo
// diz o efeito, com o publico publicado ("O assistente passa a responder aos
// leads que escreverem..."), e pede o motivo obrigatorio. De Producao para
// Teste tambem pede confirmacao: as conversas com quem nao e telefone da
// equipe voltam para a equipe, sem mensagem ao paciente. O banco confere
// tudo de novo.
//
// Com o agente em teste ou em producao e a conta ativa, "Na clínica agora"
// diz a verdade de hoje pela mesma regra da aba WhatsApp da Tela 6
// (estadoDaIa): o ambiente, a escolha da propria clinica, a pausa, o
// interruptor geral, o teto, o motor, os numeros e os telefones. Leitura
// que falhou vira o aviso de que nao deu para conferir, nunca o verde. Com
// a conta suspensa, so o aviso de que o agente nao atende.
//
// O dialogo e o estado da mudanca sao os mesmos do "Liberar agente" e do
// "Retirar agente" da linha da lista (dialogo-do-agente.tsx, 26/10/2026):
// toda mudanca leva o estado que o cartao mostrava, e o banco recusa sem
// mudar nada se a pagina estiver velha (outra aba, outra pessoa).

export function textoDoAgenteMudou(
  nome: string,
  estado: EstadoDoAgente,
): string {
  switch (estado) {
    case "producao":
      return `Agente da ${nome} em produção.`;
    case "teste":
      return `Agente da ${nome} ligado em teste.`;
    case "desligado":
      return `Agente da ${nome} desligado.`;
  }
}

/**
 * Por que a Producao nao liga agora (a linha embaixo do seletor). Nulo: liga
 * (ou ja esta em producao).
 */
export function porQueAProducaoNaoLiga(entrada: {
  estado: EstadoDoAgente;
  suspensa: boolean;
  requisitos: RequisitosDaProducao | "erro";
}): string | null {
  const { estado, suspensa, requisitos } = entrada;
  if (estado === "producao") {
    return null;
  }
  if (requisitos === "erro") {
    return TEXTOS_DO_PAINEL.requisitosSemLeitura;
  }
  if (requisitos.estado === "indisponivel") {
    return TEXTOS_DO_PAINEL.dicaDaProducao;
  }
  if (estado !== "teste") {
    return TEXTOS_DO_PAINEL.dicaDaProducaoSoDeTeste;
  }
  if (suspensa || !producaoLiberada(requisitos)) {
    return TEXTOS_DO_PAINEL.dicaDaProducaoComRequisitos;
  }
  return null;
}

export function AgenteDaClinica({
  clinicId,
  nome,
  estado,
  suspensa,
  tetoDiarioCentavos,
  contexto,
  requisitos,
  publicoPublicado,
}: {
  clinicId: string;
  nome: string;
  estado: EstadoDoAgente;
  suspensa: boolean;
  /** Nulo: a clinica ainda nao tem teto (nunca teve o agente). */
  tetoDiarioCentavos: number | null;
  /**
   * Os dados da aba (liberacao, numeros, telefones e situacao) para o
   * "Na clínica agora". Nulo: a leitura falhou.
   */
  contexto: ContextoDaIa | null;
  /** Os requisitos da producao (a Producao so liga com todos cumpridos). */
  requisitos: RequisitosDaProducao | "erro";
  /**
   * O publico da ultima versao publicada ("leads", "pacientes", "todos"),
   * para o dialogo da producao. Nulo: ainda nao escolhido ou nao lido.
   */
  publicoPublicado: string | null;
}) {
  const ids = useId();
  const {
    confirmando,
    abrir,
    fechar,
    motivo,
    setMotivo,
    erro,
    pendente,
    mudar,
    confirmar,
  } = useMudancaDoAgente({ clinicId, estado });

  // O banco recusa ligar em teste a clinica suspensa (P0001
  // clinica_suspensa): a opcao fica visivel e desabilitada, com o porque
  // escrito. Desligar continua livre.
  const testeTravado = suspensa && estado !== "teste";
  const motivoDaProducao = porQueAProducaoNaoLiga({
    estado,
    suspensa,
    requisitos,
  });
  const producaoTravada = estado !== "producao" && motivoDaProducao !== null;

  const trocar = (opcao: OpcaoDoAgente) => {
    if (opcao === estado || pendente) {
      return;
    }
    if (opcao === "producao") {
      if (!producaoTravada) {
        abrir("producao");
      }
      return;
    }
    if (opcao === "teste") {
      if (!testeTravado) {
        abrir(estado === "producao" ? "volta" : "teste");
      }
      return;
    }
    // Desligar e na hora: o lado seguro (as conversas do agente voltam para
    // a equipe). Vai com o estado que o cartao mostra agora.
    mudar("desligado", estado, "", textoDoAgenteMudou(nome, "desligado"));
  };

  return (
    <Card role="region" aria-labelledby={`${ids}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Bot className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${ids}-titulo`}>Agente de IA</CardTitle>
            <CardDescription>
              {TEXTOS_DO_PAINEL.descricaoDoAgente}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <StatusChip definition={AGENTE_DA_CLINICA_STATUS[estado]} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Sempre montada: o leitor de tela anuncia o erro novo. */}
        <div aria-live="polite" aria-atomic="true" className="grid gap-2">
          {erro && confirmando === null ? (
            <Aviso tom="alert" role="note">
              {erro}
            </Aviso>
          ) : null}
        </div>

        <div className="flex min-h-10 flex-wrap items-center gap-3">
          <SegmentedControl<OpcaoDoAgente>
            ariaLabel="Agente de IA desta clínica"
            className="max-w-full overflow-x-auto"
            value={estado}
            onChange={trocar}
            options={OPCOES_DO_ESTADO_DO_AGENTE.map((opcao) => ({
              ...opcao,
              disabled:
                (opcao.value === "producao" && producaoTravada) ||
                (opcao.value === "teste" && testeTravado) ||
                pendente,
            }))}
          />
          {pendente && confirmando === null ? (
            <span className="text-[13px] text-text-secondary">Salvando...</span>
          ) : null}
        </div>
        {motivoDaProducao ? (
          <p className="text-[13px] text-text-secondary">{motivoDaProducao}</p>
        ) : null}

        {suspensa ? (
          <Aviso tom="info" role="note">
            {TEXTOS_DO_PAINEL.agenteComContaSuspensa}
            {testeTravado ? ` ${TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente}` : ""}
          </Aviso>
        ) : null}

        {/* Com a conta suspensa, o aviso acima ja diz tudo: o agente nao
            atende, e a lista de motivos culparia outra trava. */}
        {estado !== "desligado" && !suspensa ? (
          <NaClinicaAgora contexto={contexto} />
        ) : null}
      </CardContent>

      <DialogoDoAgente
        nome={nome}
        confirmacao={confirmando}
        publico={publicoNoDialogo(publicoPublicado)}
        emProducao={estado === "producao"}
        tetoDiarioCentavos={tetoDiarioCentavos}
        motivo={motivo}
        onMotivo={setMotivo}
        erro={erro}
        pendente={pendente}
        onFechar={fechar}
        onConfirmar={() =>
          confirmar((novo) => textoDoAgenteMudou(nome, novo))
        }
      />
    </Card>
  );
}

/**
 * Os motivos da parada para a equipe Conduzza (os textos da aba WhatsApp da
 * Tela 6, com os do super admin: o do interruptor ja diz que ele mora no
 * topo do Painel geral).
 */
export function textosDaParadaNoPainel(contexto: ContextoDaIa): string[] {
  return textosDaParada(contexto, true);
}

/**
 * Como o agente esta de verdade na clinica (a mesma regra e os mesmos
 * textos da aba WhatsApp da Tela 6; para a equipe Conduzza, os motivos
 * dizem o que conferir).
 */
function NaClinicaAgora({ contexto }: { contexto: ContextoDaIa | null }) {
  if (!contexto) {
    return (
      <Aviso tom="neutral" icone={CircleQuestionMark} role="note">
        {TEXTOS_DO_PAINEL.agenteSemLeitura}
      </Aviso>
    );
  }
  const estado = estadoDaIa(contexto);
  const temMotivo = motivosDaParada(contexto).length > 0;
  const naoConferido = oQueNaoDeuParaConferir(contexto);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-text-secondary">
          Na clínica agora
        </span>
        <StatusChip size="sm" definition={IA_NA_CLINICA_STATUS[estado]} />
      </div>
      {temMotivo ? (
        <Aviso
          tom="warning"
          role="note"
          titulo="Por que o agente ainda não responde"
        >
          <ul className="grid list-disc gap-1 pl-4">
            {textosDaParadaNoPainel(contexto).map((texto) => (
              <li key={texto}>{texto}</li>
            ))}
          </ul>
        </Aviso>
      ) : estado === "nao_conferido" ? (
        <Aviso
          tom="neutral"
          icone={CircleQuestionMark}
          role="note"
          titulo={TEXTOS_DA_IA.naoConferidoTitulo}
        >
          <ul className="grid list-disc gap-1 pl-4">
            {naoConferido.map((qual) => (
              <li key={qual}>{TEXTOS_DA_IA.naoConferido[qual]}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}
    </div>
  );
}
