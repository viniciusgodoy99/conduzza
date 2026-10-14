"use client";

import { FileX, ShieldBan } from "lucide-react";
import { useRef, useState } from "react";

import { lerRascunhoBloqueadoAction } from "@/app/(app)/atendimento/actions";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { CategoriaDeConformidade } from "@/lib/domain/conformidade/categorias";
import type { ComplianceDecision } from "@/lib/queries/conversations";

// Cartao de bloqueio de conformidade no fio (E3, 13/10/2026). O rascunho que
// o filtro barrou pode conter dado de saude: ele mora em
// ai_rascunho_bloqueado (a coluna antiga de ai_decision_log nao e mais
// legivel pela sessao) e so a equipe Conduzza le,
// ate o dono decidir (D25). O texto NAO viaja com o fio: e buscado so ao
// abrir o dialogo, pela action ler_rascunho_bloqueado, que grava a leitura
// em audit_log. Para os outros papeis, o botao fica visivel e desabilitado
// com a dica (regra do brief: acao sem permissao nunca some).
//
// O titulo e "Ver o que a IA ia responder" sao lidos pelo e2e e nao mudam.

export const TEXTOS_DO_BLOQUEIO = {
  titulo: "Resposta da IA bloqueada pela conformidade",
  linha: (rotulo: string) =>
    `Motivo: ${rotulo}. A conversa foi passada para a equipe.`,
  verRascunho: "Ver o que a IA ia responder",
  soEquipeConduzza: "Só a equipe Conduzza vê o rascunho bloqueado.",
  dialogoTitulo: "Rascunho bloqueado",
  dialogoDescricao:
    "Registrado para auditoria. Este texto nunca foi enviado ao paciente.",
  carregando: "Carregando o rascunho...",
  erro: "Não foi possível carregar o rascunho. Tente de novo.",
  vazio: "O rascunho já foi apagado (guardamos por 90 dias).",
  tentarDeNovo: "Tentar de novo",
} as const;

// Uma entrada por categoria do filtro (lib/domain/conformidade): o tipo
// obriga a cobrir todas, e o banco tem CHECK com a mesma lista.
const RULE_LABEL: Record<CategoriaDeConformidade, string> = {
  triagem: "triagem de sintoma",
  diagnostico: "diagnóstico",
  orientacao_clinica: "orientação clínica",
  medicamento: "indicação de medicamento",
  dosagem: "indicação de dose",
  promessa_resultado: "promessa de resultado",
  oferta_casada: "oferta casada",
  antes_depois: "imagem de antes e depois",
  preco_nao_verificado: "preço fora do cadastro",
  formato_invalido: "formato de resposta não permitido",
  falha_verificador: "verificação de conformidade indisponível",
};

/** O rotulo da regra que bloqueou, em linguagem de recepcionista. */
export function rotuloDaRegra(regra: string | null): string {
  return regra !== null && Object.hasOwn(RULE_LABEL, regra)
    ? RULE_LABEL[regra as CategoriaDeConformidade]
    : "regra de conformidade";
}

/** A leitura do rascunho dentro do dialogo. */
export type LeituraDoRascunhoNaTela =
  | { tipo: "carregando" }
  | { tipo: "erro"; texto: string }
  | { tipo: "vazio" }
  | { tipo: "texto"; texto: string };

/** O miolo do dialogo em cada estado (separado para o teste estatico). */
export function ConteudoDoRascunho({
  leitura,
  aoTentarDeNovo,
}: {
  leitura: LeituraDoRascunhoNaTela;
  aoTentarDeNovo: () => void;
}) {
  switch (leitura.tipo) {
    case "carregando":
      return (
        <div role="status" className="grid gap-2">
          <span className="sr-only">{TEXTOS_DO_BLOQUEIO.carregando}</span>
          <Skeleton aria-hidden className="h-4 w-11/12" />
          <Skeleton aria-hidden className="h-4 w-8/12" />
          <p aria-hidden className="text-[12.5px] text-text-secondary">
            {TEXTOS_DO_BLOQUEIO.carregando}
          </p>
        </div>
      );
    case "erro":
      return (
        <Aviso
          tom="alert"
          role="alert"
          titulo={leitura.texto}
          acao={
            <Button variant="outline" size="sm" onClick={aoTentarDeNovo}>
              {TEXTOS_DO_BLOQUEIO.tentarDeNovo}
            </Button>
          }
        />
      );
    case "vazio":
      return (
        <p className="flex items-center gap-2 rounded-xl bg-surface-4 p-3 text-sm text-text-secondary">
          <FileX aria-hidden className="size-4 shrink-0" />
          {TEXTOS_DO_BLOQUEIO.vazio}
        </p>
      );
    case "texto":
      return (
        <p className="rounded-xl bg-surface-4 p-3 text-sm break-words whitespace-pre-wrap">
          {leitura.texto}
        </p>
      );
  }
}

export function ComplianceBlockCard({
  decision,
  podeVerRascunho,
}: {
  decision: ComplianceDecision;
  /** Super admin da sessao (D25: so a equipe Conduzza le o rascunho). */
  podeVerRascunho: boolean;
}) {
  const [leitura, setLeitura] = useState<LeituraDoRascunhoNaTela>({
    tipo: "carregando",
  });
  // A leitura em curso: fechar e abrir de novo nao deixa a resposta velha
  // sobrescrever a nova.
  const pedido = useRef(0);

  const buscar = async () => {
    const meu = ++pedido.current;
    setLeitura({ tipo: "carregando" });
    let proxima: LeituraDoRascunhoNaTela;
    try {
      const resultado = await lerRascunhoBloqueadoAction(decision.id);
      proxima = resultado.ok
        ? resultado.texto
          ? { tipo: "texto", texto: resultado.texto }
          : { tipo: "vazio" }
        : { tipo: "erro", texto: resultado.error };
    } catch {
      proxima = { tipo: "erro", texto: TEXTOS_DO_BLOQUEIO.erro };
    }
    if (meu === pedido.current) {
      setLeitura(proxima);
    }
  };

  const botao = (
    <Button
      variant="outline"
      size="sm"
      // Sem permissao, o respiro vai no span da dica (DisabledWithHint).
      className={podeVerRascunho ? "mt-2 w-fit" : "w-fit"}
      disabled={!podeVerRascunho}
    >
      {TEXTOS_DO_BLOQUEIO.verRascunho}
    </Button>
  );

  return (
    <div className="flex justify-center">
      <Aviso
        tom="alert"
        icone={ShieldBan}
        titulo={TEXTOS_DO_BLOQUEIO.titulo}
        className="w-full max-w-md"
      >
        <p>
          {TEXTOS_DO_BLOQUEIO.linha(rotuloDaRegra(decision.compliance_rule))}
        </p>
        {podeVerRascunho ? (
          <Dialog
            onOpenChange={(aberto) => {
              if (aberto) {
                void buscar();
              } else {
                // O texto nao fica na memoria da tela depois de fechar.
                pedido.current += 1;
                setLeitura({ tipo: "carregando" });
              }
            }}
          >
            <DialogTrigger asChild>{botao}</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{TEXTOS_DO_BLOQUEIO.dialogoTitulo}</DialogTitle>
                <DialogDescription>
                  {TEXTOS_DO_BLOQUEIO.dialogoDescricao}
                </DialogDescription>
              </DialogHeader>
              <ConteudoDoRascunho
                leitura={leitura}
                aoTentarDeNovo={() => void buscar()}
              />
            </DialogContent>
          </Dialog>
        ) : (
          <DisabledWithHint
            hint={TEXTOS_DO_BLOQUEIO.soEquipeConduzza}
            className="mt-2"
          >
            {botao}
          </DisabledWithHint>
        )}
      </Aviso>
    </div>
  );
}

/** As decisoes do fio nao carregaram: o fio diz, em vez de lista vazia. */
export const ERRO_DAS_DECISOES = "Não foi possível carregar o registro da IA.";
