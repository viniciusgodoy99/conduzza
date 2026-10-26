"use client";

import { Power, PowerOff, RadioTower } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  definirAgenteDaClinicaAction,
  type ResultadoDoPainel,
} from "@/app/(app)/painel-geral/actions";
import {
  dolares,
  estadoDaConfirmacao,
  MOTIVO_MAXIMO,
  motivoValido,
  TEXTOS_DO_PAINEL,
  type ConfirmacaoDoAgente,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
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

// O dialogo de confirmacao do agente de IA de uma clinica, o mesmo no
// detalhe do Painel geral (ligar em teste, ligar a producao, voltar para
// teste) e na linha da lista (liberar, que vai para Teste, e retirar, que
// vai para Desligado; acompanhamento de cliente, 26/10/2026). Uma acao so,
// a de sempre (definirAgenteDaClinicaAction, que confere o super admin e o
// Zod no servidor e chama definir_agente_da_clinica_no_painel); o banco
// grava a trilha com o motivo. O motivo e obrigatorio so na Producao (3 a
// 300); nos outros, opcional (vazio vira o texto padrao do painel). Nada
// daqui vai para log: o motivo e texto livre da equipe Conduzza.
//
// O estado que a tela mostrava vai junto (revisao de 26/10/2026): o banco
// recusa, sem mudar nada, se ele nao e mais o de agora (a lista aberta
// numa aba velha nao rebaixa a Producao nem passa por cima da escolha da
// clinica). Com dialogo, vale o estado de quando ele abriu (a pessoa
// decidiu olhando para ele).

/** O texto de cada confirmacao (titulo, apoio e botao). */
type TextosDaConfirmacao = {
  titulo: string;
  descricao: string;
  botao: string;
  placeholder: string;
};

export function textosDaConfirmacao(
  confirmacao: ConfirmacaoDoAgente,
  nome: string,
): TextosDaConfirmacao {
  switch (confirmacao) {
    case "producao":
      return {
        titulo: `Ligar a produção do agente na ${nome}?`,
        descricao: "Confira o que acontece ao ligar.",
        botao: "Ligar a produção",
        placeholder: "Ex.: requisitos conferidos com o dono, clínica pronta",
      };
    case "volta":
      return {
        titulo: `Voltar o agente da ${nome} para Teste?`,
        descricao: "Confira o que acontece ao voltar para Teste.",
        botao: "Voltar para Teste",
        placeholder: "Ex.: clínica pediu para voltar aos testes",
      };
    case "liberar":
      return {
        titulo: `Liberar o agente de IA na ${nome}?`,
        descricao: "Ele começa em Teste. Confira o que acontece ao liberar.",
        botao: TEXTOS_DO_PAINEL.liberarAgente,
        placeholder: "Ex.: clínica entrou na fase de testes",
      };
    case "retirar":
      return {
        titulo: `Retirar o agente de IA da ${nome}?`,
        descricao: "Confira o que acontece ao retirar.",
        botao: TEXTOS_DO_PAINEL.retirarAgente,
        placeholder: "Ex.: clínica pediu para parar o agente",
      };
    case "teste":
      return {
        titulo: `Ligar o agente em teste na ${nome}?`,
        descricao: "Confira o que acontece ao ligar.",
        botao: "Ligar em teste",
        placeholder: "Ex.: clínica entrou na fase de testes",
      };
  }
}

/**
 * O que acontece, item a item. A producao diz a quem o assistente passa a
 * responder (o publico publicado, quando a tela sabe); retirar da producao
 * diz como voltar. O teto vem a parte (tetoNoDialogo).
 */
export function efeitosDaConfirmacao(entrada: {
  confirmacao: ConfirmacaoDoAgente;
  /** "aos leads", "aos pacientes" ou "aos leads e aos pacientes"; nulo: nao sabe. */
  publico: string | null;
  /** Retirar: a clinica esta em producao agora. */
  emProducao: boolean;
}): string[] {
  const { confirmacao, publico, emProducao } = entrada;
  switch (confirmacao) {
    case "producao":
      return [
        ...(publico ? [TEXTOS_DO_PAINEL.efeitoDaProducao(publico)] : []),
        ...TEXTOS_DO_PAINEL.efeitosDaProducao,
      ];
    case "volta":
      return [...TEXTOS_DO_PAINEL.efeitoDaVoltaParaTeste];
    case "liberar":
      return [
        ...TEXTOS_DO_PAINEL.efeitoDoTeste,
        TEXTOS_DO_PAINEL.efeitoDaLiberacaoNoDetalhe,
      ];
    case "retirar":
      return [
        ...TEXTOS_DO_PAINEL.efeitoDaRetirada,
        ...(emProducao ? [TEXTOS_DO_PAINEL.efeitoDaRetiradaDaProducao] : []),
      ];
    case "teste":
      return [...TEXTOS_DO_PAINEL.efeitoDoTeste];
  }
}

/**
 * O teto de gasto no dialogo: em tudo o que deixa o agente gastando (nao no
 * retirar) e so quando a clinica ja tem teto.
 */
export function tetoNoDialogo(
  confirmacao: ConfirmacaoDoAgente,
  tetoDiarioCentavos: number | null,
): number | null {
  return confirmacao === "retirar" ? null : tetoDiarioCentavos;
}

/**
 * A entrada de definirAgenteDaClinicaAction: o estado pedido, o estado que
 * a tela mostrava (o banco confere se ainda e o de agora) e o motivo sem as
 * pontas (vazio fica de fora: o servidor usa o texto padrao do painel).
 */
export function entradaDaMudanca(entrada: {
  clinicId: string;
  novo: EstadoDoAgente;
  visto: EstadoDoAgente;
  motivo: string;
}): {
  clinicId: string;
  estadoVisto: EstadoDoAgente;
  estado: EstadoDoAgente;
  motivo?: string;
} {
  const motivo = entrada.motivo.trim();
  return {
    clinicId: entrada.clinicId,
    estadoVisto: entrada.visto,
    estado: entrada.novo,
    ...(motivo ? { motivo } : {}),
  };
}

/**
 * O estado da mudanca do agente de uma clinica: qual confirmacao esta
 * aberta, o estado que a tela mostrava quando ela abriu, o motivo digitado,
 * o erro e a acao em andamento. Uma acao por vez: enquanto uma roda, abrir
 * e fechar nao fazem nada.
 */
export function useMudancaDoAgente({
  clinicId,
  estado,
}: {
  clinicId: string;
  /** O estado do agente que a tela mostra agora. */
  estado: EstadoDoAgente;
}) {
  const [confirmando, setConfirmando] = useState<ConfirmacaoDoAgente | null>(
    null,
  );
  const [vistoAoAbrir, setVistoAoAbrir] = useState<EstadoDoAgente>(estado);
  const [motivo, setMotivoDigitado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  /**
   * Muda o agente para `novo`, dizendo ao banco o estado que a tela
   * mostrava (`visto`): com dialogo, o de quando ele abriu (vistoAoAbrir);
   * sem dialogo (desligar no detalhe), o de agora.
   */
  const mudar = (
    novo: EstadoDoAgente,
    visto: EstadoDoAgente,
    motivoDigitado: string,
    sucesso: string,
  ) => {
    setErro(null);
    startTransition(async () => {
      let r: ResultadoDoPainel | null = null;
      try {
        r = await definirAgenteDaClinicaAction(
          entradaDaMudanca({
            clinicId,
            novo,
            visto,
            motivo: motivoDigitado,
          }),
        );
      } catch {
        r = null;
      }
      if (r?.ok) {
        toast.success(sucesso);
        setConfirmando(null);
        setMotivoDigitado("");
        return;
      }
      const texto = r ? r.error : TEXTOS_DO_PAINEL.semResposta;
      setErro(texto);
      toast.error(texto);
    });
  };

  const abrir = (confirmacao: ConfirmacaoDoAgente) => {
    if (pendente) {
      return;
    }
    setErro(null);
    setVistoAoAbrir(estado);
    setConfirmando(confirmacao);
  };

  const fechar = () => {
    if (pendente) {
      return;
    }
    setConfirmando(null);
    setMotivoDigitado("");
    setErro(null);
  };

  const setMotivo = (texto: string) => {
    setMotivoDigitado(texto);
    setErro(null);
  };

  /**
   * Confirma o dialogo aberto: o estado que a confirmacao grava, com o
   * estado de quando ele abriu. `sucesso` diz o aviso de cada tela.
   */
  const confirmar = (sucesso: (novo: EstadoDoAgente) => string) => {
    if (confirmando === null) {
      return;
    }
    const novo = estadoDaConfirmacao(confirmando);
    mudar(novo, vistoAoAbrir, motivo, sucesso(novo));
  };

  return {
    confirmando,
    abrir,
    fechar,
    motivo,
    setMotivo,
    erro,
    pendente,
    mudar,
    confirmar,
  };
}

export type DialogoDoAgenteProps = {
  nome: string;
  /** Nula: o dialogo esta fechado. */
  confirmacao: ConfirmacaoDoAgente | null;
  /** O publico no texto da producao ("aos leads"); nulo: nao sabe. */
  publico: string | null;
  /** Retirar: a clinica esta em producao agora. */
  emProducao: boolean;
  tetoDiarioCentavos: number | null;
  motivo: string;
  onMotivo: (texto: string) => void;
  erro: string | null;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
};

export function DialogoDoAgente({
  nome,
  confirmacao,
  publico,
  emProducao,
  tetoDiarioCentavos,
  motivo,
  onMotivo,
  erro,
  pendente,
  onFechar,
  onConfirmar,
}: DialogoDoAgenteProps) {
  const ids = useId();
  // Fechado, o conteudo continua com o texto da ultima confirmacao: a
  // animacao de saida do dialogo nao troca de texto no meio (o estado
  // acompanha a prop durante a renderizacao, o padrao do React para guardar
  // o valor anterior).
  const [ultima, setUltima] = useState<ConfirmacaoDoAgente>(
    confirmacao ?? "teste",
  );
  if (confirmacao !== null && confirmacao !== ultima) {
    setUltima(confirmacao);
  }
  const qual = confirmacao ?? ultima;
  const textos = textosDaConfirmacao(qual, nome);
  const efeitos = efeitosDaConfirmacao({
    confirmacao: qual,
    publico,
    emProducao,
  });
  const teto = tetoNoDialogo(qual, tetoDiarioCentavos);
  const obrigatorio = qual === "producao";
  // Producao: motivo obrigatorio (3 a 300); nos outros, opcional.
  const podeConfirmar = !pendente && (!obrigatorio || motivoValido(motivo));
  const Icone =
    qual === "producao" ? RadioTower : qual === "retirar" ? PowerOff : Power;

  return (
    <Dialog
      open={confirmacao !== null}
      onOpenChange={(aberto) => (!aberto ? onFechar() : null)}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{textos.titulo}</DialogTitle>
          <DialogDescription>{textos.descricao}</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-foreground">
          {efeitos.map((efeito) => (
            <li key={efeito}>{efeito}</li>
          ))}
          {teto !== null ? (
            <li>
              O teto de gasto desta clínica é de{" "}
              <span className="cz-num">{dolares(teto)}</span> a cada 24 horas.
            </li>
          ) : null}
        </ul>
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-motivo`}>
            {obrigatorio ? "Motivo (obrigatório)" : "Motivo (opcional)"}
          </Label>
          <Textarea
            id={`${ids}-motivo`}
            value={motivo}
            onChange={(evento) => onMotivo(evento.target.value)}
            rows={2}
            maxLength={MOTIVO_MAXIMO}
            aria-describedby={`${ids}-motivo-apoio`}
            placeholder={textos.placeholder}
            disabled={pendente}
          />
          <p
            id={`${ids}-motivo-apoio`}
            className="text-[11px] text-text-tertiary"
          >
            {obrigatorio
              ? TEXTOS_DO_PAINEL.regraDoMotivoDaProducao
              : TEXTOS_DO_PAINEL.motivoRegistrado}
          </p>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {erro && confirmacao !== null ? (
            <Aviso tom="alert" role="note">
              {erro}
            </Aviso>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!podeConfirmar}
            aria-busy={pendente || undefined}
            aria-describedby={`${ids}-motivo-apoio`}
            onClick={onConfirmar}
          >
            <Icone aria-hidden />
            {pendente ? "Salvando..." : textos.botao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
