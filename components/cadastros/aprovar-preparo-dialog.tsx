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

export type PedidoDeAprovacao = {
  modo: "aprovar" | "aprovar_de_novo";
  /** A versao aguardando (aprovar) ou a ultima ja aprovada (de novo). */
  versao: VersaoDoPreparo;
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
  avisos,
  marcado,
  aoMarcar,
  etapa,
  comentario,
  aoMudarComentario,
  enviando,
  erro,
  aoAprovar,
  aoDevolver,
  aoCancelar,
}: {
  modo: PedidoDeAprovacao["modo"];
  /** A mensagem inteira como o paciente recebe. */
  mensagem: string;
  /** null: nao ha texto em vigor; []: nenhuma linha mudou. */
  mudancas: LinhaDaDiferenca[] | null;
  avisos: AvisosDoTexto;
  marcado: boolean;
  aoMarcar: (marcado: boolean) => void;
  etapa: EtapaDoDialogo;
  comentario: string;
  aoMudarComentario: (texto: string) => void;
  enviando: EnvioDoDialogo;
  erro: string | null;
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
            {T.oQueMudou}
          </h3>
          {mudancas === null ? (
            <p className="text-[13px] text-text-secondary">
              {T.semTextoEmVigor}
            </p>
          ) : mudancas.length === 0 || modo === "aprovar_de_novo" ? (
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
            {T.avisoRemedio}
          </Aviso>
        ) : null}

        <div className="flex items-start gap-3">
          <Checkbox
            id={idDaCaixa}
            checked={marcado}
            onCheckedChange={(valor) => aoMarcar(valor === true)}
            disabled={ocupado}
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

      {erro ? (
        <div className="shrink-0 px-5 pb-4">
          <Aviso tom="alert" role="alert">
            {erro}
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
            disabled={ocupado}
          >
            {enviando === "devolver"
              ? T.devolvendo
              : etapa === "devolvendo"
                ? T.devolverTexto
                : T.devolver}
          </Button>
        ) : null}
        {etapa === "lendo" ? (
          <Button
            className="h-10"
            onClick={aoAprovar}
            disabled={ocupado || conferindo}
          >
            {enviando === "aprovar" ? T.aprovando : T.aprovar}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

/** A recusa da action em frase da tela: o 42501 do RT que deixou de ser. */
export function erroDoDialogo(resultado: ResultadoDoPreparo): string | null {
  if (resultado.ok) {
    return null;
  }
  return resultado.code === "sem_permissao" ? T.naoEMaisORt : resultado.error;
}

/** Codigos de quem chegou depois: a tela recarrega o que mostra. */
const CODIGOS_QUE_RECARREGAM: ReadonlySet<string> = new Set([
  "texto_mudou",
  "texto_igual_ao_em_vigor",
  "nao_aguarda_aprovacao",
  "nome_mudou",
  "outra_aprovacao",
  "sem_permissao",
]);

export function AprovarPreparoDialog({
  pedido,
  aoFechar,
  procedureId,
  procedimento,
  rt,
  textoEmVigor,
  versaoLida,
  aoConcluir,
}: {
  /** null: fechado. */
  pedido: PedidoDeAprovacao | null;
  aoFechar: () => void;
  procedureId: string;
  /** O nome gravado do procedimento agora. */
  procedimento: string;
  /** O RT vigente (quem abre o dialogo). */
  rt: ResponsavelTecnico;
  /** O texto da versao aprovada (em vigor ou parada), para a diferenca. */
  textoEmVigor: string | null;
  /** A maior versao lida (o "aprovar de novo" salva antes de aprovar). */
  versaoLida: number;
  /** Recarrega a secao (sucesso ou recusa de quem chegou depois). */
  aoConcluir: () => void;
}) {
  const [marcado, setMarcado] = useState(false);
  const [etapa, setEtapa] = useState<EtapaDoDialogo>("lendo");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState<EnvioDoDialogo>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisosDoTexto>("carregando");

  const versaoId = pedido?.versao.id ?? null;
  useEffect(() => {
    // Cada abertura comeca do zero e confere o texto no servidor.
    setMarcado(false);
    setEtapa("lendo");
    setComentario("");
    setEnviando(null);
    setErro(null);
    if (versaoId === null) {
      return;
    }
    let vivo = true;
    setAvisos("carregando");
    void avisosDoPreparoAction({ versaoId })
      .then((resultado) => {
        if (vivo) {
          setAvisos(resultado.ok ? resultado.avisos : "falhou");
        }
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
    // nome_mudou). De novo: a versao nova nasce com o nome de agora.
    procedimento: modo === "aprovar" ? versao.nomeDoProcedimento : procedimento,
    rt: { nome: rt.nome, conselho: rt.conselho, uf: rt.uf, numero: rt.numero },
    texto: versao.texto,
  });
  const mudancas = linhasQueMudaram(textoEmVigor, versao.texto);

  const concluirComRecusa = (resultado: ResultadoDoPreparo) => {
    setErro(erroDoDialogo(resultado));
    if (!resultado.ok && CODIGOS_QUE_RECARREGAM.has(resultado.code ?? "")) {
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
          : await aprovarDeNovoAction({
              procedureId,
              versaoLida,
              textoSha256: versao.textoSha256,
            });
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
    if (etapa === "devolvendo") {
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
          <DialogTitle>{aprovarTitulo(procedimento)}</DialogTitle>
          <DialogDescription>{T.ajuda}</DialogDescription>
        </DialogHeader>
        <ConteudoDoAprovarPreparo
          modo={modo}
          mensagem={mensagem}
          mudancas={mudancas}
          avisos={avisos}
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
          aoAprovar={() => void aprovar()}
          aoDevolver={() => void devolver()}
          aoCancelar={cancelar}
        />
      </DialogContent>
    </Dialog>
  );
}
