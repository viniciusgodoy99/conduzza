"use client";

import {
  AudioLines,
  CircleSlash,
  CloudOff,
  CornerUpLeft,
  Ellipsis,
  FileText,
  Image as ImageIcon,
  Lock,
  OctagonAlert,
  ShieldBan,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  FUSO_PADRAO,
  horaNaClinica,
} from "@/components/atendimento/fuso-da-clinica";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CartaoDeDocumento } from "@/components/atendimento/media/cartao-de-documento";
import { impedimentoParaTodos } from "@/components/atendimento/dialogo-apagar";
import { CitacaoDaBolha } from "@/components/atendimento/citacao";
import { FotoDaConversa } from "@/components/atendimento/media/foto-da-conversa";
import { PlayerDeAudio } from "@/components/atendimento/media/player-de-audio";
import {
  estadoDaMidia,
  exibicaoDaMidiaDeTexto,
  nomeOriginalDoArquivo,
  nomeSeguroDeArquivo,
  type EstadoDaMidia,
  type MotivoDeIndisponivel,
} from "@/lib/domain/midia-recebida";
import type {
  ComplianceDecision,
  MessageItem,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Bolhas da conversa na pele do ChatBubble do design system Conduzza (docs/06
// secao 5.3): raio 18 com o canto da cauda em 6, do lado de quem falou.
// Paciente a esquerda em branco; atendente a direita em lime suave
// (--bubble-out); IA a direita em tinta (--bubble-ai), sempre com o selo
// textual "IA"; nota interna a direita em ambar, com cadeado e o aviso de que
// o paciente nao ve. Autoria nunca so por cor: lado, rotulo e pele.
//
// --bolha-meta e a cor de apoio de cada pele (hora, legenda, rotulos de
// midia). Tudo o que fica DENTRO da bolha usa ela, e nao text-text-secondary:
// na bolha de tinta da IA o cinza do tema claro sumiria.

const PELES = {
  paciente:
    "rounded-bl-[6px] border-border bg-card text-foreground [--bolha-meta:var(--text-secondary)]",
  atendente:
    "rounded-br-[6px] border-transparent bg-bubble-out text-bubble-out-foreground [--bolha-meta:var(--bubble-out-meta)]",
  ia: "rounded-br-[6px] border-(--bubble-ai-border) bg-bubble-ai text-bubble-ai-foreground [--bolha-meta:var(--bubble-ai-meta)]",
  nota: "rounded-br-[6px] border-warning/20 bg-warning-bg text-warning-text [--bolha-meta:var(--warning-text)]",
} as const;

// Ladrilho de arquivo (documento, audio, arquivo que nao veio): fundo de
// cartao dentro de qualquer pele, entao zera a cor herdada da bolha.
const LADRILHO =
  "flex items-center gap-2.5 rounded-md border border-border bg-card p-2.5 text-foreground [--bolha-meta:var(--text-secondary)]";

export function SystemEventCard({
  message,
  timezone = FUSO_PADRAO,
}: {
  message: MessageItem;
  timezone?: string;
}) {
  return (
    <div className="flex justify-center">
      <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-xl bg-surface-4 px-3 py-1 text-[11.5px] text-text-secondary">
        <span className="min-w-0">{message.body}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 cz-num">
          {horaNaClinica(message.created_at, timezone)}
        </span>
      </span>
    </div>
  );
}

export function ComplianceBlockCard({
  decision,
}: {
  decision: ComplianceDecision;
}) {
  const RULE_LABEL: Record<string, string> = {
    triagem: "triagem de sintoma",
    promessa_resultado: "promessa de resultado",
    medicamento: "indicação de medicamento",
    oferta_casada: "oferta casada",
  };
  return (
    <div className="flex justify-center">
      <Aviso
        tom="alert"
        icone={ShieldBan}
        titulo="Resposta da IA bloqueada pela conformidade"
        className="w-full max-w-md"
      >
        <p>
          Motivo:{" "}
          {RULE_LABEL[decision.compliance_rule ?? ""] ??
            "regra de conformidade"}
          . A conversa foi passada para a recepção.
        </p>
        {decision.blocked_draft ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="mt-2 w-fit">
                Ver o que a IA ia responder
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rascunho bloqueado</DialogTitle>
                <DialogDescription>
                  Registrado para auditoria. Este texto nunca foi enviado ao
                  paciente.
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-xl bg-surface-4 p-3 text-sm">
                {decision.blocked_draft}
              </p>
            </DialogContent>
          </Dialog>
        ) : null}
      </Aviso>
    </div>
  );
}

/**
 * Estado do arquivo, reavaliado sozinho quando a janela de download vence.
 *
 * Nada muda no banco quando o prazo passa sem arquivo (o job pode nem ter
 * nascido), entao a bolha "baixando" arma UM timer para virar indisponivel na
 * hora certa. Quando o worker grava storage:// ou a sentinela, o fio recarrega
 * e o estado sai direto da coluna.
 */
function useEstadoDaMidia(message: MessageItem): EstadoDaMidia {
  const [agora, setAgora] = useState(() => Date.now());
  const estado = estadoDaMidia(message.media_url, message.created_at, agora);
  const venceEm = estado.tipo === "baixando" ? estado.venceEm : null;
  useEffect(() => {
    if (venceEm === null) {
      return;
    }
    const timer = setTimeout(
      () => setAgora(Date.now()),
      Math.max(0, venceEm - Date.now()) + 1_000,
    );
    return () => clearTimeout(timer);
  }, [venceEm]);
  return estado;
}

/**
 * O arquivo nao vem mais. Icone proprio (nuvem cortada), que nao se confunde
 * com o de foto, documento ou video: e um estado, nao um tipo de arquivo.
 */
function MidiaIndisponivel({
  rotulo,
  motivo,
  fromPatient,
}: {
  rotulo: string;
  motivo: MotivoDeIndisponivel | null;
  fromPatient: boolean;
}) {
  const explicacao = !fromPatient
    ? "Este arquivo não está disponível."
    : motivo === "grande_demais"
      ? "O arquivo passou do tamanho que o sistema consegue receber. Peça ao paciente para enviar um arquivo menor."
      : "Não foi possível receber este arquivo. Peça ao paciente para enviar de novo.";
  return (
    <div className={cn(LADRILHO, "items-start")}>
      <CloudOff
        aria-hidden
        className="mt-px size-4 shrink-0 text-warning-text"
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[12.5px] font-semibold text-warning-text">
          {rotulo}
        </span>
        <span className="text-[12px] leading-snug text-text-secondary">
          {explicacao}
        </span>
      </span>
    </div>
  );
}

/** Arquivo ainda chegando: ladrilho com o tipo e o que esta acontecendo. */
function MidiaChegando({
  Icone,
  rotulo,
  demonstracao,
}: {
  Icone: typeof ImageIcon;
  rotulo: string;
  demonstracao: boolean;
}) {
  return (
    <div className={LADRILHO}>
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-4">
        <Icone aria-hidden className="size-5 text-text-secondary" />
      </span>
      <span className="grid min-w-0">
        <span className="text-[12.5px] font-semibold">{rotulo}</span>
        <span className="text-[11.5px] text-text-secondary">
          {demonstracao ? "Indisponível na demonstração" : "Baixando o arquivo"}
        </span>
      </span>
    </div>
  );
}

function AudioBody({ message }: { message: MessageItem }) {
  const [expanded, setExpanded] = useState(false);
  const estado = useEstadoDaMidia(message);
  const fromPatient = message.direction === "entrada";
  return (
    <div className="grid gap-1.5">
      {estado.tipo === "pronta" ? (
        <div className={LADRILHO}>
          <PlayerDeAudio messageId={message.id} />
        </div>
      ) : estado.tipo === "indisponivel" ? (
        <MidiaIndisponivel
          rotulo={fromPatient ? "Áudio não recebido" : "Áudio indisponível"}
          motivo={estado.motivo}
          fromPatient={fromPatient}
        />
      ) : (
        <MidiaChegando
          Icone={AudioLines}
          rotulo={fromPatient ? "Áudio recebido" : "Áudio"}
          demonstracao={estado.tipo === "demonstracao"}
        />
      )}
      {/* A legenda que a atendente escreveu junto com o audio: ela FOI para o
          paciente, entao precisa aparecer aqui tambem. */}
      {message.body ? (
        <p className="break-words whitespace-pre-wrap">{message.body}</p>
      ) : null}
      {message.transcript ? (
        <div className="grid gap-1">
          <p className={cn("break-words", !expanded && "line-clamp-2")}>
            <span className="text-(--bolha-meta)">Transcrição: </span>
            {message.transcript}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="hit-40 relative w-fit rounded-sm text-[12px] font-semibold text-(--bolha-meta) underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            {expanded ? "ver menos" : "ver mais"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A mensagem carrega arquivo?
 *
 * Precisa olhar `media_url` e nao so `content_type`, por um motivo concreto:
 * o parser de entrada mapeia VIDEO para 'texto' (lib/integrations/whatsapp/
 * inbound.ts nao tem caso para video, e o enum do banco tambem nao o preve).
 * Sem esta checagem, todo video recebido continuaria como bolha vazia, que e
 * exatamente o defeito que este componente esta corrigindo.
 */
function ehMidia(message: MessageItem): boolean {
  if (
    message.content_type === "imagem" ||
    message.content_type === "documento"
  ) {
    return true;
  }
  return (
    message.content_type === "texto" &&
    (Boolean(message.media_url) || Boolean(message.media_mimetype))
  );
}

type TipoDaMidia = "foto" | "documento" | "video" | "imagem" | "audio";

/**
 * O que a midia E, para escolher o elemento e o rotulo.
 *
 * Midia que chega como 'texto' (o enum do banco nao preve video nem
 * figurinha) e decidida pelo tipo REAL guardado em media_mimetype: figurinha
 * e image/webp e vai para <img>. Antes todo 'texto com midia' virava <video>,
 * e a figurinha aparecia como um player quebrado.
 */
function tipoDaMidia(message: MessageItem): TipoDaMidia {
  if (message.content_type === "imagem") return "foto";
  if (message.content_type === "documento") return "documento";
  const exibicao = exibicaoDaMidiaDeTexto(message.media_mimetype);
  return exibicao === "foto" ? "imagem" : exibicao;
}

const ROTULOS: Record<
  TipoDaMidia,
  {
    Icone: typeof ImageIcon;
    recebido: string;
    naoRecebido: string;
    nome: string;
  }
> = {
  foto: {
    Icone: ImageIcon,
    recebido: "Foto recebida",
    naoRecebido: "Foto não recebida",
    nome: "Foto",
  },
  imagem: {
    Icone: ImageIcon,
    recebido: "Imagem recebida",
    naoRecebido: "Imagem não recebida",
    nome: "Imagem",
  },
  documento: {
    Icone: FileText,
    recebido: "Documento recebido",
    naoRecebido: "Documento não recebido",
    nome: "Documento",
  },
  video: {
    Icone: Video,
    recebido: "Vídeo recebido",
    naoRecebido: "Vídeo não recebido",
    nome: "Vídeo",
  },
  audio: {
    Icone: AudioLines,
    recebido: "Áudio recebido",
    naoRecebido: "Áudio não recebido",
    nome: "Áudio",
  },
};

function Legenda({ texto }: { texto: string | null }) {
  return texto ? (
    <p className="break-words whitespace-pre-wrap">{texto}</p>
  ) : null;
}

function MidiaBody({ message }: { message: MessageItem }) {
  const estado = useEstadoDaMidia(message);
  const fromPatient = message.direction === "entrada";
  const tipo = tipoDaMidia(message);
  const rotulos = ROTULOS[tipo];

  // O nome do arquivo e a legenda sao coisas diferentes. body so vira nome no
  // dado antigo (quando termina em extensao); com media_filename, body e
  // sempre a legenda e aparece embaixo.
  const nomeDoArquivo = nomeOriginalDoArquivo(message);
  const legenda =
    nomeDoArquivo !== null && !nomeSeguroDeArquivo(message.media_filename)
      ? null
      : message.body;

  if (estado.tipo === "pronta") {
    if (tipo === "documento") {
      return (
        <div className="grid gap-1.5">
          <CartaoDeDocumento
            messageId={message.id}
            nomeDoArquivo={
              nomeDoArquivo ??
              (fromPatient ? "Documento recebido" : "Documento enviado")
            }
          />
          <Legenda texto={legenda} />
        </div>
      );
    }
    if (tipo === "foto" || tipo === "imagem") {
      return (
        <div className="grid gap-1.5">
          <FotoDaConversa messageId={message.id} legenda={message.body} />
          <Legenda texto={message.body} />
        </div>
      );
    }
    if (tipo === "audio") {
      return (
        <div className="grid gap-1.5">
          <PlayerDeAudio messageId={message.id} />
          <Legenda texto={message.body} />
        </div>
      );
    }
    return (
      <div className="grid gap-1.5">
        <video
          src={`/api/atendimento/midia/${message.id}`}
          controls
          preload="metadata"
          className="max-h-[280px] w-[240px] rounded-xl bg-surface-4"
        />
        <Legenda texto={message.body} />
      </div>
    );
  }

  const nomeVisivel =
    nomeDoArquivo !== null ? (
      <span
        className="truncate text-[12.5px] font-medium text-(--bolha-meta)"
        title={nomeDoArquivo}
      >
        {nomeDoArquivo}
      </span>
    ) : null;

  if (estado.tipo === "indisponivel") {
    return (
      <div className="grid gap-1">
        <MidiaIndisponivel
          rotulo={
            fromPatient ? rotulos.naoRecebido : `${rotulos.nome} indisponível`
          }
          motivo={estado.motivo}
          fromPatient={fromPatient}
        />
        {nomeVisivel}
        <Legenda texto={legenda} />
      </div>
    );
  }

  const { Icone } = rotulos;
  const demonstracao = estado.tipo === "demonstracao";
  // Foto e video reservam os 240x180 que vao ocupar quando chegarem: o fio
  // rola para o fim a cada mensagem, e um arquivo sem altura reservada faria
  // o conteudo pular na cara de quem esta lendo.
  if (tipo === "foto" || tipo === "imagem" || tipo === "video") {
    return (
      <div className="grid gap-1">
        <div className="grid h-[180px] w-[240px] place-items-center rounded-xl bg-surface-4 text-text-secondary">
          <span className="grid justify-items-center gap-1.5 px-4 text-center">
            <Icone aria-hidden className="size-6" />
            <span className="text-[12.5px] font-semibold">
              {rotulos.recebido}
            </span>
            <span className="text-[11.5px]">
              {demonstracao
                ? "Indisponível na demonstração"
                : "Baixando o arquivo"}
            </span>
          </span>
        </div>
        <Legenda texto={legenda} />
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <MidiaChegando
        Icone={Icone}
        rotulo={rotulos.recebido}
        demonstracao={demonstracao}
      />
      {nomeVisivel}
      <Legenda texto={legenda} />
    </div>
  );
}

/**
 * A lapide de uma mensagem apagada.
 *
 * NUNCA some da conversa. Sumir por completo faria uma atendente conseguir
 * tirar uma mensagem da tela sem deixar rastro nenhum para a colega, e este e
 * um sistema onde varias pessoas atendem o mesmo paciente. O conteudo foi para
 * o cofre; o que fica aqui e o fato de que existiu e quem apagou.
 *
 * O escopo importa muito na redacao: "apagada so aqui" significa que o
 * paciente CONTINUA VENDO a mensagem no celular dele. Uma atendente que leia
 * "apagada" e conclua que sumiu de todo lugar pode escrever a proxima mensagem
 * contando com um contexto que o paciente nao tem.
 */
function Lapide({
  message,
  authorNames,
  viewerId,
}: {
  message: MessageItem;
  authorNames: Record<string, string>;
  viewerId: string;
}) {
  const soAqui = message.deleted_escopo === "local";
  // Nota interna nunca saiu da clínica, então "o paciente ainda vê" seria
  // exatamente o contrário da verdade sobre ela.
  const nota = message.is_internal_note;
  const quem =
    message.deleted_source === "paciente"
      ? "O paciente apagou"
      : message.deleted_by === viewerId
        ? "Você apagou"
        : message.deleted_by
          ? `${authorNames[message.deleted_by] ?? "A clínica"} apagou`
          : "A clínica apagou";
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-text-secondary italic">
      <CircleSlash aria-hidden className="size-4 shrink-0" />
      {soAqui && !nota
        ? `${quem} esta mensagem só aqui. O paciente ainda vê.`
        : nota
          ? `${quem} esta nota interna.`
          : `${quem} esta mensagem.`}
    </span>
  );
}

/** O menu de ações da bolha: responder e apagar. */
const MOTIVO_SEM_APAGAR =
  "Só quem escreveu a mensagem pode apagar. Um administrador ou gestor também pode.";

function AcoesDaBolha({
  podeResponder,
  podeApagar,
  motivoSemPermissao,
  onResponder,
  onApagar,
}: {
  podeResponder: boolean;
  podeApagar: boolean;
  motivoSemPermissao: string;
  onResponder: () => void;
  onApagar: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Ações da mensagem"
          // Aparece no toque desde sempre (celular nao tem passar o mouse) e
          // no computador quando o cursor ou o teclado chegam na bolha.
          className={cn(
            "rounded-full text-text-secondary",
            "sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100",
            "data-[state=open]:opacity-100",
          )}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onResponder} disabled={!podeResponder}>
          <CornerUpLeft aria-hidden />
          Responder
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={onApagar}
          disabled={!podeApagar}
        >
          <Trash2 aria-hidden />
          Apagar
        </DropdownMenuItem>
        {/* O motivo fica VISÍVEL no menu, e não num title.
            A regra 5 do CLAUDE.md pede ação desabilitada com dica, e o title
            não cumpria isso em lugar nenhum: o item desabilitado recebe
            pointer-events-none (o navegador nunca dispara o tooltip) e o Radix
            o tira da ordem de foco (o teclado nunca chega nele). O motivo era
            inalcançável para todo mundo. */}
        {!podeResponder || !podeApagar ? (
          <p className="border-t border-border px-2 pt-1.5 pb-1 text-[11.5px] leading-snug text-text-secondary">
            {!podeResponder ? motivoSemPermissao : MOTIVO_SEM_APAGAR}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MessageBubble({
  message,
  authorName,
  authorNames = {},
  contato = "Paciente",
  viewerId = "",
  podeEditar = false,
  podeResponder = false,
  ehChefia = false,
  onResponder,
  onApagar,
  onIrParaCitada,
  citadaEstaNaTela = false,
  deConversaAnterior = false,
  timezone = FUSO_PADRAO,
}: {
  message: MessageItem;
  authorName: string | null;
  authorNames?: Record<string, string>;
  /** nome do paciente, para nomear a citação de uma mensagem dele */
  contato?: string;
  viewerId?: string;
  /** o papel permite escrever (a matriz de papéis) */
  podeEditar?: boolean;
  /**
   * Dá para responder AGORA: o papel permite e a conversa é sua.
   *
   * Separado de podeEditar porque as duas ações têm donos diferentes. Apagar
   * é sobre a mensagem (quem escreveu, mais a chefia) e vale mesmo com a
   * conversa na mão de outra pessoa: uma mensagem errada precisa sair. Já
   * responder exige a posse, senão duas atendentes escrevem por cima uma da
   * outra.
   */
  podeResponder?: boolean;
  /** administrador ou gestor: apaga mensagem de qualquer pessoa */
  ehChefia?: boolean;
  onResponder?: (message: MessageItem) => void;
  onApagar?: (message: MessageItem) => void;
  onIrParaCitada?: (id: string) => void;
  /** a mensagem citada já está entre as carregadas no fio */
  citadaEstaNaTela?: boolean;
  /**
   * A mensagem é de uma conversa anterior do mesmo contato (histórico). Dá
   * para ler e apagar, mas não para citar: a resposta sairia nesta conversa
   * citando outra, e o servidor recusa.
   */
  deConversaAnterior?: boolean;
  /** fuso da clínica, para a hora da bolha */
  timezone?: string;
}) {
  if (message.content_type === "evento") {
    return <SystemEventCard message={message} timezone={timezone} />;
  }

  const fromPatient = message.direction === "entrada";
  const fromIa = message.author === "ia";
  const note = message.is_internal_note;
  const apagada = message.deleted_at !== null;
  const pele: keyof typeof PELES = fromPatient
    ? "paciente"
    : note
      ? "nota"
      : fromIa
        ? "ia"
        : "atendente";

  // Apagada SÓ AQUI ainda pode ser tirada do celular do paciente.
  //
  // Sem isto, apagar "só aqui" por engano virava beco sem saída: a mensagem
  // seguia no celular do paciente e a tela não oferecia mais ação nenhuma para
  // tirá-la de lá, mesmo com as 60 horas inteiras pela frente.
  const podeAmpliar =
    apagada &&
    message.deleted_escopo === "local" &&
    impedimentoParaTodos(message) === null;

  // Espelha pode_apagar_mensagem no banco. Espelhar NAO e duplicar a regra: o
  // banco continua sendo quem decide, e esta copia existe só para a tela não
  // oferecer um botão que vai falhar. Se as duas divergirem, quem vale é o
  // banco, e o usuário vê a recusa em texto.
  const podeApagar =
    podeEditar &&
    (!apagada || podeAmpliar) &&
    (ehChefia ||
      (message.author_user_id !== null && message.author_user_id === viewerId));
  const mostrarAcoes =
    Boolean(onResponder && onApagar) && (!apagada || podeAmpliar);

  // O menu fica do lado de FORA da bolha, e no lado oposto ao dono da
  // mensagem, para não cobrir o texto nem empurrar a hora.
  const acoes = mostrarAcoes ? (
    <AcoesDaBolha
      podeResponder={podeResponder && !apagada && !deConversaAnterior}
      podeApagar={podeApagar}
      motivoSemPermissao={
        apagada
          ? "Mensagem apagada não pode ser citada."
          : deConversaAnterior
            ? "Mensagem de uma conversa anterior não pode ser citada."
            : podeEditar
              ? "Assuma a conversa antes de responder."
              : "Seu perfil pode acompanhar o atendimento, mas não responder."
      }
      onResponder={() => onResponder?.(message)}
      onApagar={() => onApagar?.(message)}
    />
  ) : null;

  const falhou = message.delivery_status === "falhou" && !apagada;

  return (
    <div
      id={`mensagem-${message.id}`}
      className={cn(
        "group flex scroll-mt-4 items-end gap-1",
        fromPatient ? "justify-start" : "justify-end",
      )}
    >
      {!fromPatient ? acoes : null}

      <div
        className={cn(
          "flex max-w-[85%] min-w-0 flex-col gap-[3px] sm:max-w-[68%]",
          fromPatient ? "items-start" : "items-end",
        )}
      >
        {/* Autoria ACIMA da bolha, fora dela: o selo "IA" e o aviso da nota
            interna sao a camada de texto da autoria, nunca so a cor. */}
        {fromIa && !apagada ? (
          <span className="flex items-center gap-1 px-1 text-[11px] font-semibold text-text-secondary">
            <Sparkles aria-hidden className="size-3 text-ai-text" />
            {authorName ?? "Assistente"}
            <span className="inline-flex h-4 items-center rounded-full bg-ai-bg px-1.5 text-[10px] font-bold text-ai-text">
              IA
            </span>
          </span>
        ) : null}
        {!fromPatient && !fromIa && authorName && !apagada ? (
          <span
            className={cn(
              "flex items-center gap-1 px-1 text-[11px] font-semibold",
              note ? "text-warning-text" : "text-text-secondary",
            )}
          >
            {note ? <Lock aria-hidden className="size-3" /> : null}
            {authorName}
            {note ? " · Nota interna, o paciente não vê" : null}
          </span>
        ) : null}

        <div
          data-bolha
          className={cn(
            "grid max-w-full min-w-24 gap-1 rounded-bubble border px-3 pt-[9px] pb-[7px] text-[13.5px] leading-[1.5] shadow-xs",
            PELES[pele],
            // Mensagem apagada perde a cor de autoria: ela não é mais fala de
            // ninguém, é o registro de que houve uma.
            apagada &&
              "border-dashed border-border-heavy bg-transparent text-text-secondary shadow-none [--bolha-meta:var(--text-secondary)]",
          )}
        >
          {apagada ? (
            <Lapide
              message={message}
              authorNames={authorNames}
              viewerId={viewerId}
            />
          ) : (
            <>
              <CitacaoDaBolha
                message={message}
                contato={contato}
                nomes={authorNames}
                aoIrParaCitada={onIrParaCitada}
                citadaEstaNaTela={citadaEstaNaTela}
              />
              {message.content_type === "audio" ? (
                <AudioBody message={message} />
              ) : ehMidia(message) ? (
                <MidiaBody message={message} />
              ) : (
                <p className="break-words whitespace-pre-wrap">
                  {message.body}
                </p>
              )}
            </>
          )}

          <span className="mt-[3px] flex items-center justify-end gap-1 cz-num text-[11px] text-(--bolha-meta)">
            {horaNaClinica(message.created_at, timezone)}
          </span>
        </div>

        {falhou ? (
          <span className="flex items-center gap-1 px-1 text-[11px] font-semibold text-alert-text">
            <OctagonAlert aria-hidden className="size-3" />
            Não foi entregue
          </span>
        ) : null}
      </div>

      {fromPatient ? acoes : null}
    </div>
  );
}
