"use client";

import { useState } from "react";

import { CartoesDeEscolha } from "@/components/agente/cartoes-de-escolha";
import {
  useAvisarNaoSalvo,
  type AvisarNaoSalvo,
} from "@/components/agente/nao-salvo";
import { TEXTOS_DO_AGENTE as T } from "@/components/agente/textos";
import type { RetornoDaAcao } from "@/components/agente/tipos";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  PUBLICOS_DO_AGENTE,
  ROTULO_DO_CAMPO_PUBLICO,
  ROTULO_DO_PUBLICO,
  ROTULO_DO_PUBLICO_NAO_ESCOLHIDO,
  type PublicoDoAgente,
} from "@/lib/domain/agente/config";

// "Quem o assistente atende" (onda 2, item 4; decisao P4a do dono: mora na
// configuracao do agente, versionada, e vale ao publicar), na aba Regras e
// limites da Tela 6: Só leads, Só pacientes ou Leads e pacientes. A coluna
// publico_atendido nasce nula ("Ainda não escolhido"): no teste o
// assistente atende os telefones da equipe, sejam leads ou pacientes, e
// antes da producao a clinica escolhe (o Painel geral confere). O banco
// aplica o publico na ENTRADA da conversa na IA (ia_publico_aceita), tambem
// para os telefones da equipe (P4b; a aba WhatsApp diz por que um telefone
// fora do publico nao aciona).
//
// Cartoes de radio com o proprio Salvar (grava no RASCUNHO pela acao
// salvarPublicoAction): escolher com as setas do teclado anda pelos
// cartoes sem gravar a cada passo. O que foi escolhido e nao salvo avisa o
// painel (o publicar confere). Sem permissao (recepcao), os cartoes ficam
// travados e o Salvar, visivel e desabilitado com a dica.

/** O que cada opcao quer dizer, embaixo do rotulo. */
export const DESCRICAO_DO_PUBLICO: Readonly<Record<PublicoDoAgente, string>> = {
  leads: "Quem ainda não é paciente da clínica.",
  pacientes: "Quem já é paciente da clínica.",
  todos: "Todos os contatos, sejam leads ou pacientes.",
};

export function CartaoDoPublico({
  publico,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  /** O publico do rascunho; nulo: a clinica ainda nao escolheu. */
  publico: PublicoDoAgente | null;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (publico: PublicoDoAgente, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi escolhido e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const [escolhido, setEscolhido] = useState<PublicoDoAgente | null>(publico);
  const [erro, setErro] = useState<string | null>(null);
  const travado = !podeEditar;
  const naoSalvo = escolhido !== publico && !travado;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);

  const salvar = () => {
    if (escolhido === null) {
      return;
    }
    setErro(null);
    aoSalvar(escolhido, { seFalhar: setErro });
  };

  const motivoParaNaoSalvar =
    dica ??
    (escolhido === null
      ? T.publicoEscolhaAntes
      : escolhido === publico
        ? T.publicoSemMudanca
        : null);

  const botaoSalvar = (
    <Button
      variant="solid"
      disabled={motivoParaNaoSalvar !== null || pendente}
      aria-busy={salvando || undefined}
      onClick={salvar}
    >
      {salvando ? "Salvando..." : T.salvarPublico}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby="agente-publico-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-publico-titulo">
            {ROTULO_DO_CAMPO_PUBLICO}
          </CardTitle>
          <CardDescription>{T.publicoDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {publico === null ? (
          <Aviso
            tom="info"
            role="note"
            titulo={ROTULO_DO_PUBLICO_NAO_ESCOLHIDO}
          >
            {T.publicoNaoEscolhido}
          </Aviso>
        ) : null}
        <CartoesDeEscolha
          nome="agente-publico"
          rotuloDoGrupo={ROTULO_DO_CAMPO_PUBLICO}
          className="lg:grid-cols-3"
          desabilitado={travado}
          valor={escolhido}
          aoEscolher={(valor) => {
            setEscolhido(valor);
            setErro(null);
          }}
          opcoes={PUBLICOS_DO_AGENTE.map((valor) => ({
            valor,
            rotulo: ROTULO_DO_PUBLICO[valor],
            descricao: DESCRICAO_DO_PUBLICO[valor],
          }))}
        />
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {motivoParaNaoSalvar && !pendente ? (
            <DisabledWithHint hint={motivoParaNaoSalvar}>
              {botaoSalvar}
            </DisabledWithHint>
          ) : (
            botaoSalvar
          )}
          {naoSalvo ? (
            <span className="text-[13px] text-text-secondary">
              Alterações ainda não salvas.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
