"use client";

import { UserRoundCheck, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { CartoesDeEscolha } from "@/components/agente/cartoes-de-escolha";
import {
  useAvisarNaoSalvo,
  type AvisarNaoSalvo,
} from "@/components/agente/nao-salvo";
import { TEXTOS_DA_PASSAGEM as T } from "@/components/agente/textos";
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
  PASSAGENS_DA_CONVERSA,
  type PassagemDaConversa,
} from "@/lib/domain/agente/config";

// [AG6 passagem] início "Para quem vai a conversa" (AG6a, desenho da secao 6; D-15
// do dono, e D-54 e D-55 pela recomendacao, pendentes), na aba Regras e
// limites da Tela 6, logo depois dos prazos: quando o assistente passa a
// conversa para a equipe com a frase de sempre, ela vai para a fila
// ("Aguardando você", sem responsavel; o padrao) ou, logo depois da frase,
// para o responsavel do lead (o de Leads, ativo e com papel que atende
// conversa), que a recebe "Em atendimento", em Minhas, com um aviso na
// tela. Sem responsavel, com ele fora da equipe ou so com leitura, a fila;
// quem assumir antes fica com a conversa; urgencia, sintoma, assunto
// clinico, midia e a resposta barrada pela conformidade vao sempre para a
// fila (MOTIVOS_QUE_NUNCA_ATRIBUEM, menos o fora do horario, que e passagem
// sem a frase), e a pessoa que escreve de novo antes da atribuicao tambem
// fica nela. Quem decide e o banco, depois da frase
// (atribuir_conversa_passada_pela_ia), pela ultima versao publicada: a tela
// so guarda a escolha. O paragrafo de ajuda e a descricao do grupo de
// cartoes (aria-describedby), para o leitor de tela ouvir as excecoes.
//
// Molde do cartao "Quem o assistente atende": cartoes de radio com o proprio
// Salvar (grava no RASCUNHO pela acao salvarPassagemAction, vale ao
// publicar e volta no restaurar). Escolher com as setas do teclado anda
// pelos cartoes sem gravar a cada passo. O que foi escolhido e nao salvo
// avisa o painel (o publicar confere). Sem permissao (recepcao), os cartoes
// ficam travados e o Salvar, visivel e desabilitado com a dica.
//
// O ladrilho do cabecalho (UserRoundCheck) e decorativo e neutro: a cor nao
// diz estado (docs/06, 4.6: sem dono de status).

/** O paragrafo de ajuda, que descreve o grupo de cartoes (um so na tela). */
const ID_DA_AJUDA = "agente-passagem-ajuda";

/** Ladrilho decorativo do cabecalho dos cartoes da AG6: a cor nao diz estado. */
export function LadrilhoDoCartao({ icone: Icone }: { icone: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
    >
      <Icone className="size-5 text-text-strong" />
    </span>
  );
}

export function CartaoDaPassagem({
  passagemPara,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  /** A regra do rascunho (ou da publicada, sem rascunho); a fila por padrao. */
  passagemPara: PassagemDaConversa;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (passagemPara: PassagemDaConversa, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi escolhido e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const [escolhida, setEscolhida] = useState<PassagemDaConversa>(passagemPara);
  const [erro, setErro] = useState<string | null>(null);
  const travado = !podeEditar;
  const naoSalvo = escolhida !== passagemPara && !travado;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);

  const salvar = () => {
    setErro(null);
    aoSalvar(escolhida, { seFalhar: setErro });
  };

  const motivoParaNaoSalvar =
    dica ?? (escolhida === passagemPara ? T.semMudanca : null);

  const botaoSalvar = (
    <Button
      variant="solid"
      disabled={motivoParaNaoSalvar !== null || pendente}
      aria-busy={salvando || undefined}
      onClick={salvar}
    >
      {salvando ? T.salvando : T.salvar}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby="agente-passagem-titulo">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <LadrilhoDoCartao icone={UserRoundCheck} />
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id="agente-passagem-titulo">{T.titulo}</CardTitle>
            <CardDescription>{T.descricao}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <CartoesDeEscolha
          nome="agente-passagem"
          rotuloDoGrupo={T.titulo}
          idDaAjuda={ID_DA_AJUDA}
          className="lg:grid-cols-2"
          desabilitado={travado}
          valor={escolhida}
          aoEscolher={(valor) => {
            setEscolhida(valor);
            setErro(null);
          }}
          opcoes={PASSAGENS_DA_CONVERSA.map((valor) => ({
            valor,
            rotulo: T.opcoes[valor].rotulo,
            descricao: T.opcoes[valor].descricao,
          }))}
        />
        <p id={ID_DA_AJUDA} className="text-[12.5px] text-text-secondary">
          {T.ajuda}
        </p>
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
              {T.naoSalva}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
// [AG6 passagem] fim
