"use client";

import { Bot, CircleQuestionMark, Power, RadioTower } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  definirAgenteDaClinicaAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
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
  AGENTE_DA_CLINICA_STATUS,
  dolares,
  MOTIVO_MAXIMO,
  motivoValido,
  OPCOES_DO_ESTADO_DO_AGENTE,
  producaoLiberada,
  publicoNoDialogo,
  TEXTOS_DO_PAINEL,
  type OpcaoDoAgente,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { SegmentedControl } from "@/components/shared/segmented-control";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/** O dialogo aberto: ligar em teste, ligar a producao ou voltar para teste. */
type Confirmacao = "teste" | "producao" | "volta";

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
  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const mudar = (novo: EstadoDoAgente, motivoDigitado: string) => {
    setErro(null);
    startTransition(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await definirAgenteDaClinicaAction({
          clinicId,
          estado: novo,
          ...(motivoDigitado.trim() ? { motivo: motivoDigitado.trim() } : {}),
        });
      } catch {
        r = null;
      }
      if (r?.ok) {
        toast.success(textoDoAgenteMudou(nome, novo));
        setConfirmando(null);
        setMotivo("");
        return;
      }
      const texto = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErro(texto);
      toast.error(texto);
    });
  };

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
      if (producaoTravada) {
        return;
      }
      setErro(null);
      setConfirmando("producao");
      return;
    }
    if (opcao === "teste") {
      if (testeTravado) {
        return;
      }
      setErro(null);
      setConfirmando(estado === "producao" ? "volta" : "teste");
      return;
    }
    mudar("desligado", "");
  };

  const fechar = () => {
    if (pendente) {
      return;
    }
    setConfirmando(null);
    setMotivo("");
    setErro(null);
  };

  const publico = publicoNoDialogo(publicoPublicado);
  // Producao: motivo obrigatorio (3 a 300); teste e a volta: opcional.
  const podeConfirmar =
    !pendente && (confirmando !== "producao" || motivoValido(motivo));

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

      <Dialog
        open={confirmando !== null}
        onOpenChange={(aberto) => (!aberto ? fechar() : null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {confirmando === "producao"
                ? `Ligar a produção do agente na ${nome}?`
                : confirmando === "volta"
                  ? `Voltar o agente da ${nome} para Teste?`
                  : `Ligar o agente em teste na ${nome}?`}
            </DialogTitle>
            <DialogDescription>
              {confirmando === "volta"
                ? "Confira o que acontece ao voltar para Teste."
                : "Confira o que acontece ao ligar."}
            </DialogDescription>
          </DialogHeader>
          <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-foreground">
            {confirmando === "producao" ? (
              <>
                {publico ? (
                  <li>{TEXTOS_DO_PAINEL.efeitoDaProducao(publico)}</li>
                ) : null}
                {TEXTOS_DO_PAINEL.efeitosDaProducao.map((efeito) => (
                  <li key={efeito}>{efeito}</li>
                ))}
              </>
            ) : confirmando === "volta" ? (
              TEXTOS_DO_PAINEL.efeitoDaVoltaParaTeste.map((efeito) => (
                <li key={efeito}>{efeito}</li>
              ))
            ) : (
              TEXTOS_DO_PAINEL.efeitoDoTeste.map((efeito) => (
                <li key={efeito}>{efeito}</li>
              ))
            )}
            {tetoDiarioCentavos !== null ? (
              <li>
                O teto de gasto desta clínica é de{" "}
                <span className="cz-num">{dolares(tetoDiarioCentavos)}</span> a
                cada 24 horas.
              </li>
            ) : null}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-motivo`}>
              {confirmando === "producao"
                ? "Motivo (obrigatório)"
                : "Motivo (opcional)"}
            </Label>
            <Textarea
              id={`${ids}-motivo`}
              value={motivo}
              onChange={(evento) => {
                setMotivo(evento.target.value);
                setErro(null);
              }}
              rows={2}
              maxLength={MOTIVO_MAXIMO}
              aria-describedby={`${ids}-motivo-apoio`}
              placeholder={
                confirmando === "producao"
                  ? "Ex.: requisitos conferidos com o dono, clínica pronta"
                  : "Ex.: clínica entrou na fase de testes"
              }
              disabled={pendente}
            />
            <p
              id={`${ids}-motivo-apoio`}
              className="text-[11px] text-text-tertiary"
            >
              {confirmando === "producao"
                ? TEXTOS_DO_PAINEL.regraDoMotivoDaProducao
                : TEXTOS_DO_PAINEL.motivoRegistrado}
            </p>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {erro && confirmando !== null ? (
              <Aviso tom="alert" role="note">
                {erro}
              </Aviso>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={pendente} onClick={fechar}>
              Cancelar
            </Button>
            <Button
              disabled={!podeConfirmar}
              aria-busy={pendente || undefined}
              aria-describedby={`${ids}-motivo-apoio`}
              onClick={() =>
                mudar(confirmando === "producao" ? "producao" : "teste", motivo)
              }
            >
              {confirmando === "producao" ? (
                <RadioTower aria-hidden />
              ) : (
                <Power aria-hidden />
              )}
              {pendente
                ? "Salvando..."
                : confirmando === "producao"
                  ? "Ligar a produção"
                  : confirmando === "volta"
                    ? "Voltar para Teste"
                    : "Ligar em teste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
