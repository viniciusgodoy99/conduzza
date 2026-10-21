"use client";

import { Bot, CircleQuestionMark, Power } from "lucide-react";
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
} from "@/components/configuracoes/agente-de-ia";
import {
  AGENTE_DA_CLINICA_STATUS,
  dolares,
  MOTIVO_MAXIMO,
  OPCOES_DO_ESTADO_DO_AGENTE,
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
import type { EstadoDoAgente } from "@/lib/queries/painel-geral";

// O agente de IA da clinica no detalhe do Painel geral (onda 1, decisao do
// dono de 20/10/2026): Desligado, Teste e Producao. Producao fica visivel e
// travada ate a onda 2, com os pre-requisitos escritos logo abaixo (o
// segmentado nao abre dica numa opcao desabilitada). Ligar em teste pede
// confirmacao, com o efeito e um motivo opcional (vai para a trilha);
// desligar e na hora (o lado seguro: as conversas do agente voltam para a
// equipe).
//
// Com o agente em teste e a conta ativa, "Na clínica agora" diz a verdade
// de hoje pela mesma regra da aba de Configuracoes (estadoDaIa): o
// ambiente, a escolha da propria clinica, o interruptor geral, o teto, o
// motor, os numeros e os telefones. Leitura que falhou vira o aviso de que
// nao deu para conferir, nunca o verde. Com a conta suspensa, so o aviso
// de que o agente nao atende.

export function textoDoAgenteMudou(
  nome: string,
  estado: EstadoDoAgente,
): string {
  return estado === "teste"
    ? `Agente da ${nome} ligado em teste.`
    : `Agente da ${nome} desligado.`;
}

export function AgenteDaClinica({
  clinicId,
  nome,
  estado,
  suspensa,
  tetoDiarioCentavos,
  contexto,
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
}) {
  const ids = useId();
  const [confirmando, setConfirmando] = useState(false);
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
        setConfirmando(false);
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

  const trocar = (opcao: OpcaoDoAgente) => {
    if (
      opcao === estado ||
      opcao === "producao" ||
      (opcao === "teste" && testeTravado) ||
      pendente
    ) {
      return;
    }
    if (opcao === "teste") {
      setErro(null);
      setConfirmando(true);
      return;
    }
    mudar("desligado", "");
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
          {erro && !confirmando ? (
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
                opcao.value === "producao" ||
                (opcao.value === "teste" && testeTravado) ||
                pendente,
            }))}
          />
          {pendente && !confirmando ? (
            <span className="text-[13px] text-text-secondary">Salvando...</span>
          ) : null}
        </div>
        <p className="text-[13px] text-text-secondary">
          {TEXTOS_DO_PAINEL.dicaDaProducao}
        </p>

        {suspensa ? (
          <Aviso tom="info" role="note">
            {TEXTOS_DO_PAINEL.agenteComContaSuspensa}
            {testeTravado ? ` ${TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente}` : ""}
          </Aviso>
        ) : null}

        {/* Com a conta suspensa, o aviso acima ja diz tudo: o agente nao
            atende, e a lista de motivos culparia outra trava. */}
        {estado === "teste" && !suspensa ? (
          <NaClinicaAgora contexto={contexto} />
        ) : null}
      </CardContent>

      <Dialog
        open={confirmando}
        onOpenChange={(aberto) => {
          if (!aberto && !pendente) {
            setConfirmando(false);
            setMotivo("");
            setErro(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{`Ligar o agente em teste na ${nome}?`}</DialogTitle>
            <DialogDescription>
              Confira o que acontece ao ligar.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-foreground">
            {TEXTOS_DO_PAINEL.efeitoDoTeste.map((efeito) => (
              <li key={efeito}>{efeito}</li>
            ))}
            {tetoDiarioCentavos !== null ? (
              <li>
                O teto de gasto desta clínica é de{" "}
                <span className="cz-num">{dolares(tetoDiarioCentavos)}</span> a
                cada 24 horas.
              </li>
            ) : null}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-motivo`}>Motivo (opcional)</Label>
            <Textarea
              id={`${ids}-motivo`}
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              rows={2}
              maxLength={MOTIVO_MAXIMO}
              placeholder="Ex.: clínica entrou na fase de testes"
              disabled={pendente}
            />
            <p className="text-[11px] text-text-tertiary">
              {TEXTOS_DO_PAINEL.motivoRegistrado}
            </p>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {erro && confirmando ? (
              <Aviso tom="alert" role="note">
                {erro}
              </Aviso>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => {
                setConfirmando(false);
                setMotivo("");
                setErro(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={pendente}
              aria-busy={pendente || undefined}
              onClick={() => mudar("teste", motivo)}
            >
              <Power aria-hidden />
              {pendente ? "Ligando..." : "Ligar em teste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Os motivos da parada para a equipe Conduzza (os textos da aba), com o do
 * interruptor dizendo onde ele fica: o cartao Interruptor geral e da aba de
 * Configuracoes, nao do painel.
 */
export function textosDaParadaNoPainel(contexto: ContextoDaIa): string[] {
  return textosDaParada(contexto, true).map((texto) =>
    texto === TEXTOS_DA_IA.motivosParaAEquipeConduzza.interruptor
      ? TEXTOS_DO_PAINEL.interruptorNoPainel
      : texto,
  );
}

/**
 * Como o agente esta de verdade na clinica (a mesma regra e os mesmos
 * textos da aba de Configuracoes; para a equipe Conduzza, os motivos dizem
 * o que conferir).
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
