"use client";

import {
  BookOpenText,
  CircleDollarSign,
  RotateCcw,
  Send,
  ShieldBan,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  CENARIOS_DO_SIMULADOR,
  ehCenario,
  FALAS_ENVIADAS_PELO_SIMULADOR,
  LIMITE_DA_MENSAGEM_DO_SIMULADOR,
  TEXTOS_DO_AGENTE as T,
  type CenarioDoSimulador,
} from "@/components/agente/textos";
import type {
  FalaDoSimulador,
  PassoDaTrilha,
  ResultadoDaSimulacao,
} from "@/components/agente/tipos";
import {
  CASCA_DA_BOLHA,
  PELES_DA_BOLHA,
} from "@/components/atendimento/message-bubble";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Simulador da Tela 6 (coluna direita, fixa na rolagem): a pessoa conversa
// como se fosse o paciente e o assistente responde com o RASCUNHO, pela
// mesma montagem, portao de entrada e filtro do CFM do atendimento de
// verdade (a acao simularAction roda tudo no servidor). Nada daqui vai para
// o WhatsApp nem grava conversa: a conversa vive so nesta tela e some ao
// reiniciar ou recarregar.
//
// - Cenarios do brief: escolher um preenche a primeira mensagem.
// - Bolhas leves com as peles do Atendimento (paciente a esquerda, IA a
//   direita com o selo "IA").
// - Resposta trocada pela frase fixa, e a conversa encerra, como na conversa
//   de verdade (a IA nao volta sozinha). Dois desenhos (achado 31, C18): o
//   bloqueio da conformidade igual ao cartao do Atendimento (ShieldBan,
//   alert) e o passar para a equipe sem bloqueio com UsersRound, neutro (o
//   mesmo icone do passo "Passou para a equipe" da trilha). O ShieldBan sai
//   sempre em alert, inclusive na trilha.
// - "Ver o que o assistente ia responder" so aparece quando o servidor manda
//   o texto barrado (so para o super admin).
// - "Por que a IA respondeu isso": acordeao com a trilha (o que consultou),
//   sem texto de paciente.
// - Cada resposta volta com a assinatura do servidor, guardada na fala e
//   mandada de volta na rodada seguinte: sem ela o servidor recusa a
//   conversa (lib/agente/assinatura).
// - O cartao rola por dentro (achado 4): numa tela baixa (1366x768,
//   1024x768, 1280x720) a conversa guarda um piso de altura e nada fica
//   cortado; a caixa de texto cresce ate um teto e rola. Quem rola e o
//   CardContent (o Card fica com o overflow-hidden dele e o cabecalho,
//   parado). O espaco de baixo e o padding do formulario, DENTRO da area
//   que rola (o padding de baixo do proprio corpo pode ficar fora da
//   rolagem), e o scroll-padding deixa o anel de foco inteiro quando o
//   teclado leva o Enviar para a vista.
// - Quem nao pode usar (recepcao) ve tudo desabilitado, com a dica; quando o
//   assistente nao pode responder (ambiente, interruptor, teto), o motivo
//   aparece em texto e o Enviar fica desabilitado.

export type EntradaDaSimulacao = {
  mensagens: {
    autor: FalaDoSimulador["autor"];
    texto: string;
    /** So nas falas do assistente, exatamente como o servidor mandou. */
    assinatura?: string | null;
  }[];
  cenario: CenarioDoSimulador | null;
};

const ICONE_DO_PASSO: Record<PassoDaTrilha["tipo"], LucideIcon> = {
  preco: CircleDollarSign,
  base: BookOpenText,
  equipe: UsersRound,
  bloqueio: ShieldBan,
  outro: Sparkles,
};

/** O ShieldBan e do bloqueio, sempre em alert (C18); o resto, neutro. */
const COR_DO_PASSO: Record<PassoDaTrilha["tipo"], string> = {
  preco: "text-text-secondary",
  base: "text-text-secondary",
  equipe: "text-text-secondary",
  bloqueio: "text-alert-text",
  outro: "text-text-secondary",
};

/** A frase fixa veio de um bloqueio da conformidade (e nao so de passar). */
export function fraseFixaPorBloqueio(
  trilha: readonly PassoDaTrilha[],
): boolean {
  return trilha.some((passo) => passo.tipo === "bloqueio");
}

/** As falas como a acao recebe: a do assistente leva a assinatura. */
export function mensagensParaOServidor(
  falas: readonly FalaDoSimulador[],
): EntradaDaSimulacao["mensagens"] {
  return falas.slice(-FALAS_ENVIADAS_PELO_SIMULADOR).map((fala) =>
    fala.autor === "assistente"
      ? {
          autor: fala.autor,
          texto: fala.texto,
          assinatura: fala.assinatura ?? null,
        }
      : { autor: fala.autor, texto: fala.texto },
  );
}

export function Trilha({ trilha }: { trilha: readonly PassoDaTrilha[] }) {
  if (trilha.length === 0) {
    return <p className="text-text-secondary">{T.porQueVazio}</p>;
  }
  return (
    <ul className="grid gap-1.5">
      {trilha.map((passo, indice) => {
        const Icone = ICONE_DO_PASSO[passo.tipo];
        return (
          <li
            key={`${passo.tipo}-${indice}`}
            className="flex items-start gap-2"
          >
            <Icone
              aria-hidden
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                COR_DO_PASSO[passo.tipo],
              )}
            />
            <span className="min-w-0 break-words">{passo.texto}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PorQue({
  id,
  trilha,
}: {
  id: string;
  trilha: readonly PassoDaTrilha[];
}) {
  return (
    <Accordion type="single" collapsible className="w-full max-w-[85%]">
      <AccordionItem value={id} className="border-b-0">
        <AccordionTrigger className="min-h-10 py-2 text-[12.5px] text-text-secondary">
          {T.porQue}
        </AccordionTrigger>
        <AccordionContent className="pb-2 text-[12.5px]">
          <Trilha trilha={trilha} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function Fala({
  fala,
  nomeDoAssistente,
}: {
  fala: FalaDoSimulador;
  nomeDoAssistente: string;
}) {
  if (fala.autor === "paciente") {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[85%] min-w-0 flex-col items-start gap-[3px]">
          <span className="px-1 text-[11px] font-semibold text-text-secondary">
            {T.paciente}
          </span>
          <div className={cn(CASCA_DA_BOLHA, PELES_DA_BOLHA.paciente)}>
            <p className="break-words whitespace-pre-wrap">{fala.texto}</p>
          </div>
        </div>
      </div>
    );
  }
  const trilha = fala.trilha ?? [];
  if (fala.tipo === "frase_fixa") {
    const corpo = (
      <>
        <p className="break-words whitespace-pre-wrap">{`“${fala.texto}”`}</p>
        <p className="mt-1">{T.fraseFixaTexto}</p>
      </>
    );
    return (
      <div className="grid justify-items-end gap-1">
        {fraseFixaPorBloqueio(trilha) ? (
          <Aviso
            tom="alert"
            icone={ShieldBan}
            titulo={T.bloqueioTitulo}
            role="note"
            className="w-full max-w-[92%]"
          >
            {corpo}
          </Aviso>
        ) : (
          <Aviso
            tom="neutral"
            icone={UsersRound}
            titulo={T.escalonamentoTitulo}
            role="note"
            className="w-full max-w-[92%]"
          >
            {corpo}
          </Aviso>
        )}
        <PorQue id={fala.id} trilha={trilha} />
        {fala.rascunhoBloqueado ? (
          <Accordion type="single" collapsible className="w-full max-w-[85%]">
            <AccordionItem value={`${fala.id}-rascunho`} className="border-b-0">
              <AccordionTrigger className="min-h-10 py-2 text-[12.5px] text-text-secondary">
                {T.verRascunhoBloqueado}
              </AccordionTrigger>
              <AccordionContent className="grid gap-1.5 pb-2 text-[12.5px]">
                <p className="text-text-secondary">
                  {T.rascunhoBloqueadoExplicacao}
                </p>
                <p className="rounded-xl bg-card p-3 break-words whitespace-pre-wrap">
                  {fala.rascunhoBloqueado}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-[3px]">
        <span className="flex items-center gap-1 px-1 text-[11px] font-semibold text-text-secondary">
          <Sparkles aria-hidden className="size-3 text-ai-text" />
          {nomeDoAssistente}
          <span className="inline-flex h-4 items-center rounded-full bg-ai-bg px-1.5 text-[10px] font-bold text-ai-text">
            IA
          </span>
        </span>
        <div className={cn(CASCA_DA_BOLHA, PELES_DA_BOLHA.ia)}>
          <p className="break-words whitespace-pre-wrap">{fala.texto}</p>
        </div>
      </div>
      <PorQue id={fala.id} trilha={trilha} />
    </div>
  );
}

export function Simulador({
  nomeDoAssistente,
  podeUsar,
  dica,
  motivo,
  aoSimular,
  className,
}: {
  nomeDoAssistente: string;
  /** Administrador, gestor ou super admin. */
  podeUsar: boolean;
  /** A dica de quem nao pode usar (recepcao). */
  dica: string | null;
  /** Por que o assistente nao pode responder agora; nulo: pode tentar. */
  motivo: string | null;
  aoSimular: (entrada: EntradaDaSimulacao) => Promise<ResultadoDaSimulacao>;
  className?: string;
}) {
  const [falas, setFalas] = useState<FalaDoSimulador[]>([]);
  const [texto, setTexto] = useState("");
  const [cenario, setCenario] = useState<CenarioDoSimulador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const contador = useRef(0);
  const conversa = useRef<HTMLDivElement>(null);

  const encerrada = falas.some((fala) => fala.tipo === "frase_fixa");
  const bloqueado = !podeUsar || motivo !== null;
  const podeEnviar =
    !bloqueado && !encerrada && !pendente && texto.trim() !== "";

  // A ultima fala sempre a vista (a conversa rola por dentro do cartao).
  useEffect(() => {
    const no = conversa.current;
    if (no) {
      no.scrollTop = no.scrollHeight;
    }
  }, [falas, pendente]);

  const novoId = () => {
    contador.current += 1;
    return `fala-${contador.current}`;
  };

  const reiniciar = () => {
    if (pendente) {
      return;
    }
    setFalas([]);
    setTexto("");
    setCenario(null);
    setErro(null);
  };

  const escolherCenario = (valor: string) => {
    if (!ehCenario(valor)) {
      return;
    }
    const escolhido = CENARIOS_DO_SIMULADOR.find(
      (item) => item.chave === valor,
    );
    setCenario(valor);
    if (escolhido) {
      setTexto(escolhido.mensagem);
    }
  };

  const enviar = () => {
    const mensagem = texto.trim();
    if (!podeEnviar || mensagem === "") {
      return;
    }
    const doPaciente: FalaDoSimulador = {
      id: novoId(),
      autor: "paciente",
      texto: mensagem,
    };
    const historico = [...falas, doPaciente];
    setFalas(historico);
    setTexto("");
    setErro(null);
    startTransition(async () => {
      let resultado: ResultadoDaSimulacao;
      try {
        resultado = await aoSimular({
          mensagens: mensagensParaOServidor(historico),
          cenario,
        });
      } catch {
        resultado = { ok: false, erro: T.semResposta };
      }
      if (resultado.ok) {
        const resposta: FalaDoSimulador = {
          id: novoId(),
          autor: "assistente",
          texto: resultado.resposta,
          tipo: resultado.tipo,
          trilha: resultado.trilha,
          rascunhoBloqueado: resultado.rascunhoBloqueado,
          assinatura: resultado.assinatura,
        };
        setFalas((atuais) => [...atuais, resposta]);
        return;
      }
      // Nao respondeu: a mensagem volta para o campo, para tentar de novo.
      setFalas((atuais) => atuais.filter((fala) => fala.id !== doPaciente.id));
      setTexto(mensagem);
      setErro(resultado.erro);
    });
  };

  const botaoEnviar = (
    <Button
      type="submit"
      variant="solid"
      disabled={!podeEnviar}
      aria-busy={pendente || undefined}
    >
      <Send className="size-4" aria-hidden />
      {T.enviar}
    </Button>
  );

  return (
    <Card
      role="region"
      aria-labelledby="agente-simulador-titulo"
      // O Card fica com o overflow-hidden dele e quem rola e o corpo
      // (achado 4): o cabecalho fica parado e o que nao cabe rola por dentro.
      className={cn("min-h-0", className)}
    >
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-simulador-titulo">
            {T.simuladorTitulo}
          </CardTitle>
          <CardDescription>{T.simuladorDescricao}</CardDescription>
        </div>
        <CardAction>
          <Button
            variant="outline"
            disabled={pendente || falas.length === 0}
            onClick={reiniciar}
          >
            <RotateCcw className="size-4" aria-hidden />
            {T.reiniciar}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex cz-scroll min-h-0 flex-1 scroll-p-4 flex-col gap-3 overflow-y-auto pb-0">
        <Aviso tom="warning" role="note">
          {T.simuladorAviso}
        </Aviso>
        {podeUsar && motivo ? (
          <Aviso
            tom="info"
            role="note"
            titulo="O assistente ainda não responde aqui"
          >
            {motivo}
          </Aviso>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="agente-simulador-cenario">{T.cenario}</Label>
          <Select
            value={cenario ?? ""}
            onValueChange={escolherCenario}
            disabled={bloqueado || encerrada || pendente}
          >
            <SelectTrigger id="agente-simulador-cenario" className="w-full">
              <SelectValue placeholder={T.cenarioPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {CENARIOS_DO_SIMULADOR.map((item) => (
                <SelectItem key={item.chave} value={item.chave}>
                  {item.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          ref={conversa}
          role="log"
          aria-label="Conversa de teste"
          aria-live="polite"
          tabIndex={0}
          className="grid cz-scroll min-h-[220px] flex-1 content-start gap-3 overflow-y-auto rounded-xl bg-surface-4 p-3 lg:min-h-48"
        >
          {falas.length === 0 ? (
            <p className="self-center p-4 text-center text-[13px] text-text-secondary">
              {T.conversaVazia}
            </p>
          ) : (
            falas.map((fala) => (
              <Fala
                key={fala.id}
                fala={fala}
                nomeDoAssistente={nomeDoAssistente}
              />
            ))
          )}
          {pendente ? (
            <p className="flex items-center justify-end gap-1.5 text-[12.5px] text-text-secondary">
              <Sparkles aria-hidden className="size-3.5 text-ai-text" />
              {T.escrevendo}
            </p>
          ) : null}
        </div>

        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        {encerrada ? (
          <p className="text-[13px] text-text-secondary">
            {T.conversaEncerrada}
          </p>
        ) : null}

        <form
          noValidate
          aria-label="Mensagem para o simulador"
          className="grid gap-2 pb-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            enviar();
          }}
        >
          <Label htmlFor="agente-simulador-mensagem" className="sr-only">
            {T.mensagemDoPaciente}
          </Label>
          <Textarea
            id="agente-simulador-mensagem"
            value={texto}
            rows={2}
            maxLength={LIMITE_DA_MENSAGEM_DO_SIMULADOR}
            placeholder={T.mensagemPlaceholder}
            disabled={bloqueado || encerrada}
            className="max-h-32 min-h-[64px] overflow-y-auto text-sm"
            onChange={(evento) => setTexto(evento.target.value)}
            onKeyDown={(evento) => {
              // Enter envia, Shift+Enter quebra a linha (como no Atendimento).
              if (
                evento.key === "Enter" &&
                !evento.shiftKey &&
                !evento.nativeEvent.isComposing
              ) {
                evento.preventDefault();
                enviar();
              }
            }}
          />
          <div className="flex justify-end">
            {!podeUsar && dica ? (
              <DisabledWithHint hint={dica}>{botaoEnviar}</DisabledWithHint>
            ) : motivo && podeUsar ? (
              <DisabledWithHint hint={motivo}>{botaoEnviar}</DisabledWithHint>
            ) : (
              botaoEnviar
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
