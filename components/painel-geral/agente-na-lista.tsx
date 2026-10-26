"use client";

import { Power, PowerOff } from "lucide-react";

import {
  DialogoDoAgente,
  useMudancaDoAgente,
} from "@/components/painel-geral/dialogo-do-agente";
import {
  AGENTE_DA_CLINICA_STATUS,
  porQueNaoLibera,
  ROTULO_DA_LIBERACAO,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import type { EstadoDoAgente } from "@/lib/queries/painel-geral";

// O agente de IA na linha da lista do Painel geral (acompanhamento de
// cliente, 26/10/2026; decisao do dono: "Preciso poder liberar as
// funcionalidades de agente de IA ou nao para a clinica"). O estado em 3
// camadas, com o rotulo da liberacao ("Não liberado", "Liberado (Teste)",
// "Liberado (Produção)"), e a acao na propria linha:
// - "Liberar agente" liga em Teste, com o dialogo de confirmacao e o motivo
//   (o mesmo do detalhe). Com a conta suspensa o banco recusa: o botao fica
//   visivel e desabilitado, com a dica.
// - "Retirar agente" (liberado em Teste ou em Producao) desliga, tambem com
//   confirmacao: as conversas do agente voltam para a equipe.
// A Producao continua so no detalhe, com o checklist. A acao e a de sempre
// (definirAgenteDaClinicaAction: super admin e Zod no servidor), com o
// estado que a linha mostrava quando o dialogo abriu: se a clinica mudou
// desde que a pagina carregou (outra aba, outra pessoa), o banco recusa e
// nada muda (o dialogo pede para recarregar).

export function textoDaMudancaNaLista(
  nome: string,
  estado: EstadoDoAgente,
): string {
  return estado === "desligado"
    ? TEXTOS_DO_PAINEL.agenteRetiradoDaClinica(nome)
    : TEXTOS_DO_PAINEL.agenteLiberadoNaClinica(nome);
}

export function AgenteNaLista({
  clinicId,
  nome,
  estado,
  suspensa,
  tetoDiarioCentavos,
}: {
  clinicId: string;
  nome: string;
  estado: EstadoDoAgente;
  suspensa: boolean;
  /** Nulo: a clinica ainda nao tem teto (nunca teve o agente). */
  tetoDiarioCentavos: number | null;
}) {
  const {
    confirmando,
    abrir,
    fechar,
    motivo,
    setMotivo,
    erro,
    pendente,
    confirmar,
  } = useMudancaDoAgente({ clinicId, estado });
  const liberado = estado !== "desligado";
  const dica = porQueNaoLibera({ estado, suspensa });

  // O nome acessivel leva a clinica (a lista tem um botao por linha) e
  // comeca pelo texto visivel.
  const botao = liberado ? (
    <Button
      size="sm"
      variant="outline"
      disabled={pendente}
      aria-busy={pendente || undefined}
      aria-label={`${TEXTOS_DO_PAINEL.retirarAgente} da ${nome}`}
      onClick={() => abrir("retirar")}
    >
      <PowerOff aria-hidden />
      {TEXTOS_DO_PAINEL.retirarAgente}
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      disabled={pendente || dica !== null}
      aria-busy={pendente || undefined}
      aria-label={`${TEXTOS_DO_PAINEL.liberarAgente} na ${nome}`}
      onClick={() => abrir("liberar")}
    >
      <Power aria-hidden />
      {TEXTOS_DO_PAINEL.liberarAgente}
    </Button>
  );

  return (
    <div className="grid justify-items-start gap-1.5">
      <StatusChip
        size="sm"
        definition={AGENTE_DA_CLINICA_STATUS[estado]}
        label={ROTULO_DA_LIBERACAO[estado]}
      />
      {dica ? <DisabledWithHint hint={dica}>{botao}</DisabledWithHint> : botao}
      <DialogoDoAgente
        nome={nome}
        confirmacao={confirmando}
        publico={null}
        emProducao={estado === "producao"}
        tetoDiarioCentavos={tetoDiarioCentavos}
        motivo={motivo}
        onMotivo={setMotivo}
        erro={erro}
        pendente={pendente}
        onFechar={fechar}
        onConfirmar={() =>
          confirmar((novo) => textoDaMudancaNaLista(nome, novo))
        }
      />
    </div>
  );
}
