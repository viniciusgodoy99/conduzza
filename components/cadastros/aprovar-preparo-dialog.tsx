"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  aprovarDeNovoAction,
  aprovarPreparoAction,
  avisosDoPreparoAction,
  devolverPreparoAction,
  type ResultadoDoPreparo,
} from "@/app/(app)/cadastros/preparo-actions";
import {
  aprovarTitulo,
  diferencaDasLinhas,
  rotulosDosAvisos,
  FRASE_DA_EQUIPE_CONDUZZA,
  TEXTOS_DO_PREPARO as T,
  type LinhaDaDiferenca,
} from "@/components/cadastros/preparo-na-tela";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mensagemDoPreparo } from "@/lib/domain/preparo";
import type {
  ResponsavelTecnico,
  VersaoDoPreparo,
} from "@/lib/queries/preparo";
import { cn } from "@/lib/utils";

// O dialogo "Aprovar orientacao de preparo de {procedimento}" (AG7, desenho
// 5.2), SO para o responsavel tecnico (RT) vigente: quem nao e o RT ve o
// "Revisar e aprovar" visivel e desabilitado, com a dica, e a action e a RPC
// recusam de novo. Mostra a mensagem inteira como o paciente recebe
// (cabecalho, texto e rodape, as quebras preservadas), o que mudou desde o
// texto em vigor (rotulo em texto e fundo neutro: e conteudo, nao status), o
// aviso de remedio, dose ou jejum (calculado no servidor; o navegador nunca
// roda o filtro) e a caixa obrigatoria. Sem pedir a senha de novo (D-82).
//
// Dois modos: "aprovar" a versao que espera o RT (com "Devolver") e
// "aprovar_de_novo" o texto que ja foi aprovado e parou de valer (RT novo,
// nome do procedimento mudado, envio suspenso; D-72 e D-73).
//
// Tudo o que o RT le e guardado no pedido quando o dialogo abre (revisao das
// telas, TELA-1, TELA-2 e TELA-11): o texto, a maior versao lida, o RT e o
// nome do procedimento da previa, e o texto da diferenca. A tela rele os
// dados na volta do foco e depois de cada acao, e o que vai para a action e
// sempre o que a pessoa leu, nunca o relido em segundo plano. Depois de uma
// recusa de quem chegou depois ("Feche e abra de novo"), Aprovar e Devolver
// travam. Se a sessao deixa de ser o RT (ou o RT muda) com o dialogo aberto,
// ele continua aberto, diz isso e trava, ate a pessoa fechar.

export type PedidoDeAprovacao = {
  modo: "aprovar" | "aprovar_de_novo";
  /** A versao aguardando (aprovar) ou a ultima ja aprovada (de novo). */
  versao: VersaoDoPreparo;
  /** O texto da versao, como foi lido na abertura. */
  texto: string;
  /** A maior versao do procedimento na abertura (o p_versao_lida). */
  versaoLida: number;
  /** O RT vigente na abertura: a previa mostra o registro dele. */
  rt: ResponsavelTecnico;
  /** O nome gravado do procedimento na abertura (o titulo e o "de novo"). */
  procedimento: string;
  /**
   * O ultimo texto aprovado, para a diferenca, e se ele esta em vigor (o
   * titulo); null sem texto aprovado antes.
   */
  comparacao: { texto: string; emVigor: boolean } | null;
};

/** Os avisos do texto: carregando, a lista (vazia: sem aviso) ou a falha. */
export type AvisosDoTexto = "carregando" | "falhou" | readonly string[];

export type EtapaDoDialogo = "lendo" | "devolvendo";
export type EnvioDoDialogo = "aprovar" | "devolver" | null;

/** O aviso aparece com algum aviso do servidor ou sem conseguir conferir. */
export function mostraAvisoDeRemedio(avisos: AvisosDoTexto): boolean {
  return avisos === "falhou" || (Array.isArray(avisos) && avisos.length > 0);
}

/** So as linhas que mudaram: a mensagem inteira ja esta logo acima. */
export function linhasQueMudaram(
  textoEmVigor: string | null,
  texto: string,
): LinhaDaDiferenca[] | null {
  if (textoEmVigor === null) {
    return null;
  }
  return diferencaDasLinhas(textoEmVigor, texto).filter(
    (linha) => linha.tipo !== "igual",
  );
}

/**
 * O corpo do dialogo, sem estado (o estado mora em AprovarPreparoDialog):
 * as leituras de quem decide e os botoes. Separado para o teste conferir
 * cada etapa sem clique.
 */
export function ConteudoDoAprovarPreparo({
  modo,
  mensagem,
  mudancas,
  emVigor = true,
  avisos,
  recusa = null,
  marcado,
  aoMarcar,
  etapa,
  comentario,
  aoMudarComentario,
  enviando,
  erro,
  bloqueio = null,
  travado = false,
  aoAprovar,
  aoDevolver,
  aoCancelar,
}: {
  modo: PedidoDeAprovacao["modo"];
  /** A mensagem inteira como o paciente recebe. */
  mensagem: string;
  /** null: nao ha texto aprovado antes; []: nenhuma linha mudou. */
  mudancas: LinhaDaDiferenca[] | null;
  /** O texto da diferenca esta em vigor (senao, e o ultimo aprovado). */
  emVigor?: boolean;
  avisos: AvisosDoTexto;
  /** As regras de hoje recusam o texto (CFM-2): o que tirar. Sem Aprovar. */
  recusa?: string | null;
  marcado: boolean;
  aoMarcar: (marcado: boolean) => void;
  etapa: EtapaDoDialogo;
  comentario: string;
  aoMudarComentario: (texto: string) => void;
  enviando: EnvioDoDialogo;
  erro: string | null;
  /** A sessao deixou de ser o RT (ou o RT mudou) com o dialogo aberto. */
  bloqueio?: string | null;
  /** Uma recusa de quem chegou depois: Aprovar e Devolver travam. */
  travado?: boolean;
  aoAprovar: () => void;
  /** Na etapa "lendo" abre o comentario; na "devolvendo", envia. */
  aoDevolver: () => void;
  aoCancelar: () => void;
}) {
  const id = useId();
  const idDaCaixa = `${id}-caixa`;
  const idDoComentario = `${id}-comentario`;
  const ocupado = enviando !== null;
  const conferindo = avisos === "carregando";
  // Ninguem decide mais neste dialogo: so Cancelar (ou Voltar) fica.
  const semDecisao = travado || bloqueio !== null;
  const semAprovar = ocupado || conferindo || semDecisao || recusa !== null;
  const alerta = erro ?? bloqueio;
  return (
    <>
      <div className="grid cz-scroll min-h-0 flex-auto gap-4 overflow-y-auto px-5 pt-1 pb-5">
        <section className="grid gap-2" aria-labelledby={`${id}-recebe`}>
          <h3
            id={`${id}-recebe`}
            className="text-sm font-bold text-text-strong"
          >
            {T.comoRecebe}
          </h3>
          <div
            data-parte="mensagem-do-preparo"
            className="max-w-[92%] rounded-2xl bg-bubble-out px-3.5 py-2.5 text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-bubble-out-foreground"
          >
            {mensagem}
          </div>
        </section>

        <section className="grid gap-2" aria-labelledby={`${id}-mudou`}>
          <h3 id={`${id}-mudou`} className="text-sm font-bold text-text-strong">
            {emVigor ? T.oQueMudou : T.oQueMudouDesdeOUltimo}
          </h3>
          {/* O "aprovar de novo" e sempre o mesmo texto, inclusive o suspenso
              (que nao tem texto em vigor para comparar; TELA-12). */}
          {modo === "aprovar_de_novo" ? (
            <p className="text-[13px] text-text-secondary">{T.mesmoTexto}</p>
          ) : mudancas === null ? (
            <p className="text-[13px] text-text-secondary">
              {T.semTextoEmVigor}
            </p>
          ) : mudancas.length === 0 ? (
            <p className="text-[13px] text-text-secondary">{T.mesmoTexto}</p>
          ) : (
            <ul className="grid gap-1" data-parte="diferenca">
              {mudancas.map((linha, indice) => (
                <li
                  key={`${linha.tipo}-${indice}`}
                  data-tipo={linha.tipo}
                  className="flex items-start gap-2 rounded-lg bg-surface-subtle px-2.5 py-1.5 text-[13px]"
                >
                  <span className="shrink-0 rounded-full bg-neutral-bg px-2 py-0.5 text-[11px] font-semibold text-neutral-text">
                    {linha.tipo === "entrou" ? T.entrou : T.saiu}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 break-words whitespace-pre-wrap text-foreground",
                      linha.tipo === "saiu" && "line-through",
                    )}
                  >
                    {linha.texto === "" ? " " : linha.texto}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {conferindo ? (
          <p role="status" className="text-[13px] text-text-secondary">
            {T.conferindo}
          </p>
        ) : mostraAvisoDeRemedio(avisos) ? (
          <Aviso tom="info" role="note">
            {avisos === "falhou" ? (
              T.avisoRemedio
            ) : (
              <>
                <p>{T.avisoDoQueOTextoTem}</p>
                <ul className="my-1 list-disc pl-5">
                  {rotulosDosAvisos(avisos).map((rotulo) => (
                    <li key={rotulo}>{rotulo}</li>
                  ))}
                </ul>
                <p>{T.avisoAoAprovar}</p>
              </>
            )}
          </Aviso>
        ) : null}

        {recusa !== null ? (
          <Aviso tom="alert" role="alert" titulo={T.naoPodeSerAprovado}>
            {recusa}
          </Aviso>
        ) : null}

        <div className="flex items-start gap-3">
          <Checkbox
            id={idDaCaixa}
            checked={marcado}
            onCheckedChange={(valor) => aoMarcar(valor === true)}
            disabled={ocupado || semDecisao || recusa !== null}
            className="mt-px"
          />
          <Label
            htmlFor={idDaCaixa}
            className="text-[13.5px] leading-[1.35] font-semibold"
          >
            {T.caixa}
          </Label>
        </div>

        {etapa === "devolvendo" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={idDoComentario}>{T.comentario}</Label>
            <Textarea
              id={idDoComentario}
              value={comentario}
              onChange={(e) => aoMudarComentario(e.target.value)}
              maxLength={300}
              rows={3}
              disabled={ocupado}
            />
            <span className="justify-self-end cz-num text-xs text-text-secondary">
              {Array.from(comentario).length}/300
            </span>
          </div>
        ) : null}
      </div>

      {alerta ? (
        <div className="shrink-0 px-5 pb-4">
          <Aviso tom="alert" role="alert">
            {alerta}
          </Aviso>
        </div>
      ) : null}

      <DialogFooter className="m-0 shrink-0">
        <Button
          variant="ghost"
          className="h-10"
          onClick={aoCancelar}
          disabled={ocupado}
        >
          {etapa === "devolvendo" ? T.voltar : T.cancelar}
        </Button>
        {modo === "aprovar" ? (
          <Button
            variant="outline"
            className="h-10"
            onClick={aoDevolver}
            disabled={ocupado || semDecisao}
          >
            {enviando === "devolver"
              ? T.devolvendo
              : etapa === "devolvendo"
                ? T.devolverTexto
                : T.devolver}
          </Button>
        ) : null}
        {etapa === "lendo" ? (
          <Button className="h-10" onClick={aoAprovar} disabled={semAprovar}>
            {enviando === "aprovar" ? T.aprovando : T.aprovar}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

/**
 * A recusa da action em frase da tela: o 42501 do RT que deixou de ser (ou
 * da equipe Conduzza, que nunca aprova).
 */
export function erroDoDialogo(resultado: ResultadoDoPreparo): string | null {
  if (resultado.ok) {
    return null;
  }
  if (resultado.code === "sem_permissao") {
    return resultado.error === FRASE_DA_EQUIPE_CONDUZZA
      ? FRASE_DA_EQUIPE_CONDUZZA
      : T.naoEMaisORt;
  }
  return resultado.error;
}

/**
 * Os codigos de quem chegou depois (o texto, o nome, o RT ou a aprovacao
 * mudaram; o "aprovar de novo" ficou aguardando): a tela recarrega o que
 * mostra e o dialogo trava Aprovar e Devolver, com a caixa desmarcada. O que
 * a pessoa leu nao vale mais, e decidir de novo pede fechar e abrir.
 */
export const CODIGOS_QUE_TRAVAM: ReadonlySet<string> = new Set([
  "texto_mudou",
  "texto_igual_ao_em_vigor",
  "nao_aguarda_aprovacao",
  "nome_mudou",
  "outra_aprovacao",
  "sem_permissao",
  "versao_inexistente",
  "texto_novo_aguardando",
  "ficou_aguardando",
]);

/** A frase da recusa do texto sem o "Este texto nao pode ser aprovado." */
function semOPrefixoDaRecusa(frase: string): string {
  const prefixo = `${T.naoPodeSerAprovado} `;
  return frase.startsWith(prefixo) ? frase.slice(prefixo.length) : frase;
}

/**
 * O bloqueio de quem abriu o dialogo como RT e deixou de ser (a releitura
 * dos dados diz), ou de um RT que mudou no meio (outra designacao): null
 * quando a pessoa continua o RT que a previa mostra.
 */
export function bloqueioDoRt(
  pedido: Pick<PedidoDeAprovacao, "rt">,
  souRt: boolean,
  rtDeAgora: Pick<ResponsavelTecnico, "id"> | null,
): string | null {
  if (!souRt) {
    return T.naoEMaisORt;
  }
  return rtDeAgora?.id === pedido.rt.id ? null : T.rtMudouAoLer;
}

/**
 * A entrada do "Aprovar de novo": tudo do que o RT leu na abertura (a versao
 * lida, o hash e o nome da previa), nunca o relido em segundo plano (TELA-1
 * e TELA-11).
 */
export function entradaDoAprovarDeNovo(
  pedido: Pick<PedidoDeAprovacao, "versao" | "versaoLida" | "procedimento">,
  procedureId: string,
): {
  procedureId: string;
  versaoLida: number;
  textoSha256: string;
  nomeLido: string;
} {
  return {
    procedureId,
    versaoLida: pedido.versaoLida,
    textoSha256: pedido.versao.textoSha256,
    nomeLido: pedido.procedimento,
  };
}

export function AprovarPreparoDialog({
  pedido,
  aoFechar,
  procedureId,
  souRt,
  rtDeAgora,
  aoConcluir,
}: {
  /** null: fechado. */
  pedido: PedidoDeAprovacao | null;
  aoFechar: () => void;
  procedureId: string;
  /** A sessao e o RT vigente agora (relido a cada carga dos dados). */
  souRt: boolean;
  /** A designacao aberta agora (relida), para conferir com a da abertura. */
  rtDeAgora: ResponsavelTecnico | null;
  /** Recarrega a secao (sucesso ou recusa de quem chegou depois). */
  aoConcluir: () => void;
}) {
  const [marcado, setMarcado] = useState(false);
  const [etapa, setEtapa] = useState<EtapaDoDialogo>("lendo");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState<EnvioDoDialogo>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisosDoTexto>("carregando");
  const [recusa, setRecusa] = useState<string | null>(null);
  const [travado, setTravado] = useState(false);

  const versaoId = pedido?.versao.id ?? null;
  useEffect(() => {
    // Cada abertura comeca do zero e confere o texto no servidor.
    setMarcado(false);
    setEtapa("lendo");
    setComentario("");
    setEnviando(null);
    setErro(null);
    setRecusa(null);
    setTravado(false);
    if (versaoId === null) {
      return;
    }
    let vivo = true;
    setAvisos("carregando");
    void avisosDoPreparoAction({ versaoId })
      .then((resultado) => {
        if (!vivo) {
          return;
        }
        setAvisos(resultado.ok ? resultado.avisos : "falhou");
        setRecusa(resultado.ok ? resultado.recusa : null);
      })
      .catch(() => {
        if (vivo) {
          setAvisos("falhou");
        }
      });
    return () => {
      vivo = false;
    };
  }, [versaoId]);

  if (pedido === null) {
    return null;
  }
  const { modo, versao } = pedido;
  const mensagem = mensagemDoPreparo({
    // Aprovar: o banco monta com o nome da versao (igual ao de agora, senao
    // nome_mudou). De novo: a versao nova nasce com o nome de agora, que a
    // action confere com o da previa (nome_mudou).
    procedimento:
      modo === "aprovar" ? versao.nomeDoProcedimento : pedido.procedimento,
    rt: {
      nome: pedido.rt.nome,
      conselho: pedido.rt.conselho,
      uf: pedido.rt.uf,
      numero: pedido.rt.numero,
    },
    texto: pedido.texto,
  });
  const mudancas = linhasQueMudaram(
    pedido.comparacao?.texto ?? null,
    pedido.texto,
  );
  const bloqueio = bloqueioDoRt(pedido, souRt, rtDeAgora);

  const concluirComRecusa = (resultado: ResultadoDoPreparo) => {
    if (resultado.ok) {
      return;
    }
    if (resultado.code === "texto_recusado") {
      // As regras de hoje recusam o texto: a recusa fica no lugar do aviso,
      // e Aprovar trava (Devolver continua).
      setRecusa(semOPrefixoDaRecusa(resultado.error));
      setMarcado(false);
      setErro(null);
      return;
    }
    setErro(erroDoDialogo(resultado));
    if (CODIGOS_QUE_TRAVAM.has(resultado.code ?? "")) {
      setTravado(true);
      setMarcado(false);
      aoConcluir();
    }
  };

  const aprovar = async () => {
    if (!marcado) {
      setErro(T.marqueACaixa);
      return;
    }
    setEnviando("aprovar");
    setErro(null);
    let resultado: ResultadoDoPreparo;
    try {
      resultado =
        modo === "aprovar"
          ? await aprovarPreparoAction({
              versaoId: versao.id,
              textoSha256: versao.textoSha256,
            })
          : await aprovarDeNovoAction(
              entradaDoAprovarDeNovo(pedido, procedureId),
            );
    } catch {
      resultado = {
        ok: false,
        error: "Não foi possível aprovar agora. Tente de novo.",
      };
    }
    setEnviando(null);
    if (resultado.ok) {
      toast.success(T.aprovado);
      aoConcluir();
      aoFechar();
      return;
    }
    concluirComRecusa(resultado);
  };

  const devolver = async () => {
    if (etapa === "lendo") {
      setEtapa("devolvendo");
      setErro(null);
      return;
    }
    const texto = comentario.trim();
    if (texto === "" || Array.from(texto).length > 300) {
      setErro("Escreva o que precisa mudar, em até 300 caracteres.");
      return;
    }
    setEnviando("devolver");
    setErro(null);
    let resultado: ResultadoDoPreparo;
    try {
      resultado = await devolverPreparoAction({
        versaoId: versao.id,
        comentario: texto,
      });
    } catch {
      resultado = {
        ok: false,
        error: "Não foi possível devolver agora. Tente de novo.",
      };
    }
    setEnviando(null);
    if (resultado.ok) {
      toast.success(T.devolvido);
      aoConcluir();
      aoFechar();
      return;
    }
    concluirComRecusa(resultado);
  };

  const cancelar = () => {
    if (etapa === "devolvendo" && !travado && bloqueio === null) {
      setEtapa("lendo");
      setErro(null);
      return;
    }
    aoFechar();
  };

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && enviando === null) {
          aoFechar();
        }
      }}
    >
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="shrink-0 px-5 pt-[18px] pr-14 pb-3.5">
          <DialogTitle>{aprovarTitulo(pedido.procedimento)}</DialogTitle>
          <DialogDescription>{T.ajuda}</DialogDescription>
        </DialogHeader>
        <ConteudoDoAprovarPreparo
          modo={modo}
          mensagem={mensagem}
          mudancas={mudancas}
          emVigor={modo === "aprovar" && (pedido.comparacao?.emVigor ?? true)}
          avisos={avisos}
          recusa={recusa}
          marcado={marcado}
          aoMarcar={(valor) => {
            setMarcado(valor);
            if (valor) {
              setErro(null);
            }
          }}
          etapa={etapa}
          comentario={comentario}
          aoMudarComentario={setComentario}
          enviando={enviando}
          erro={erro}
          bloqueio={bloqueio}
          travado={travado}
          aoAprovar={() => void aprovar()}
          aoDevolver={() => void devolver()}
          aoCancelar={cancelar}
        />
      </DialogContent>
    </Dialog>
  );
}
