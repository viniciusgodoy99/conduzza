"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Hand,
  Lock,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  enviarArquivoAction,
  assumirConversaAction,
  devolverParaIaAction,
  reabrirConversaAction,
  resolverConversaAction,
} from "@/app/(app)/atendimento/actions";
import {
  BarraDeAnexo,
  useArquivoSolto,
} from "@/components/atendimento/media/barra-de-anexo";
import {
  autorDaCitacao,
  BlocoDeCitacao,
} from "@/components/atendimento/citacao";
import { Button } from "@/components/ui/button";
import { conversationKeys } from "@/lib/queries/conversations";
import type {
  ConversationListItem,
  MessageItem,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Compositor (tarefa 1.6), estados do handoff:
// 1. IA atendendo: campo travado, callout com Assumir.
// 2. Aguardando humano: assumir explicitamente antes de responder.
// 3. Em atendimento (meu): abas Responder / Nota interna (fundo ambar).
// 4. Resolvida: reabrir para responder.
// A janela de 24h e conceito do canal oficial (isOfficialChannel) e nao
// renderiza com uazapi/fake; o dominio windowState ja esta pronto e testado.

export type Mode = "responder" | "nota";

export function Composer({
  conversation,
  viewerId,
  citando,
  aoCancelarCitacao,
  authorNames,
  modo,
  aoTrocarModo,
  aoEnviarTexto,
}: {
  conversation: ConversationListItem;
  viewerId: string;
  /** mensagem que está sendo respondida, quando houver */
  citando: MessageItem | null;
  aoCancelarCitacao: () => void;
  authorNames: Record<string, string>;
  /**
   * Para quem este texto vai: o paciente, ou o time.
   *
   * Mora FORA deste componente, junto da citação, e isso é a correção de um
   * defeito grave. Antes o plano era derivado da citação enquanto `mode` ficava
   * parado por baixo: citar uma nota interna ligava o modo âmbar, a pessoa
   * escrevia "convênio venceu, cobrar particular", cancelava a citação com
   * Escape, e o compositor voltava para Responder COM O TEXTO INTACTO. O
   * próximo Enter mandava a nota interna para o WhatsApp do paciente, e nenhuma
   * camada abaixo tinha como perceber: para a Server Action era uma mensagem
   * válida, na conversa certa, do dono certo.
   *
   * Dois estados que precisam concordar não podem viver em componentes
   * diferentes. Agora quem escolhe a citação escolhe o plano, no mesmo gesto.
   */
  modo: Mode;
  aoTrocarModo: (modo: Mode) => void;
  /**
   * Dispara o envio de texto e devolve o controle NA HORA.
   *
   * Quem espera pela resposta é o InboxClient, que mantém a bolha otimista. O
   * compositor não espera por nada: é isso que torna o envio fluido.
   */
  aoEnviarTexto: (envio: {
    corpo: string;
    ehNota: boolean;
    citandoId: string | null;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const caixaRef = useRef<HTMLTextAreaElement>(null);
  // AÇÕES DE CONVERSA (assumir, resolver, devolver, reabrir). Elas mudam a
  // interface inteira, então esperar é o comportamento certo.
  //
  // Antes existia UM `pending` só, que alimentava também a barra de anexo e o
  // botão de texto: por isso os dois botões diziam "Enviando..." ao mesmo
  // tempo, mesmo quando só um deles estava trabalhando.
  const [pendenteAcao, startTransition] = useTransition();
  // O upload de arquivo é trabalho real de segundos, e a barra não tem trava
  // de idempotência: o segundo clique reenviaria o mesmo arquivo.
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  // Arquivo que chegou por arrastar e soltar ou por colar. Fica aqui e nao na
  // barra porque os eventos precisam cobrir a area inteira do compositor: se
  // so o botao aceitasse, soltar a foto "no lugar errado" nao faria nada e a
  // pessoa concluiria que o sistema nao aceita arquivo.
  const [arquivoSolto, setArquivoSolto] = useState<File | null>(null);
  // Muda a cada envio de arquivo bem-sucedido, para a barra limpar a previa.
  const [enviadoEm, setEnviadoEm] = useState(0);
  const isNote = modo === "nota";
  // O compositor tem retornos antecipados por estado da conversa (resolvida,
  // com a IA, de outra pessoa), entao o hook precisa vir ANTES de todos eles.
  const solto = useArquivoSolto((arquivo) => setArquivoSolto(arquivo), !isNote);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: conversationKeys.messages(conversation.id),
    });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  /**
   * Ações que mudam o ESTADO DA CONVERSA.
   *
   * Substitui o antigo `run()`, que limpava o texto e a citação em qualquer
   * sucesso: resolver a conversa, ou enviar um anexo, apagava o rascunho que a
   * pessoa tinha começado a escrever.
   */
  const executarAcaoDeConversa = (
    tarefa: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setError(null);
    startTransition(async () => {
      const resultado = await tarefa();
      if (!resultado.ok) {
        setError(resultado.error ?? "Algo deu errado. Tente de novo.");
        return;
      }
      refresh();
    });
  };

  /**
   * Manda o texto e devolve a caixa vazia e focada IMEDIATAMENTE.
   *
   * É o único lugar onde as guardas de texto vazio moram, porque antes elas
   * estavam duplicadas entre o submit e o atalho de teclado, e só o botão
   * tinha a guarda. O que segura o Enter repetido é a caixa ficar vazia, não
   * um `disabled`: reintroduzir o bloqueio seria recriar o problema.
   */
  const enviarTexto = () => {
    const corpo = text.trim();
    if (corpo.length === 0) {
      return;
    }
    setError(null);
    setText("");
    caixaRef.current?.focus();
    aoEnviarTexto({ corpo, ehNota: isNote, citandoId: citando?.id ?? null });
    aoCancelarCitacao();
  };

  // Clicar em "Responder" numa bolha já deixa a pessoa digitando.
  //
  // Sem autoFocus: o compositor remonta a cada troca de conversa (key), então
  // autoFocus roubaria o foco de quem está navegando pela lista e abriria o
  // teclado sozinho no celular. Aqui o gesto é explícito.
  const citandoId = citando?.id ?? null;
  useEffect(() => {
    if (citandoId) {
      caixaRef.current?.focus();
    }
  }, [citandoId]);

  // Trocar de aba com uma citação incompatível pendurada.
  //
  // Nota interna e resposta ao paciente são planos separados (a Server Action
  // recusa o cruzamento). Em vez de deixar a pessoa escrever a mensagem inteira
  // para só então ver a recusa, a citação sai junto com a troca de aba. Aqui a
  // troca de plano é EXPLÍCITA: a pessoa clicou na aba, então ela sabe para
  // onde o texto vai.
  const trocarModo = (novo: Mode) => {
    aoTrocarModo(novo);
    if (citando && citando.is_internal_note !== (novo === "nota")) {
      aoCancelarCitacao();
    }
  };

  const isMine =
    conversation.status === "em_atendimento" &&
    conversation.assignee_user_id === viewerId;

  if (conversation.status === "resolvida") {
    return (
      <Callout
        icon={<CheckCircle2 strokeWidth={1.5} className="size-4" />}
        toneClass="[background:var(--success-bg)] [color:var(--success-text)]"
        text="Conversa resolvida."
        error={error}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={pendenteAcao}
          onClick={() =>
            executarAcaoDeConversa(() => reabrirConversaAction(conversation.id))
          }
        >
          <RotateCcw strokeWidth={1.5} className="size-4" />
          Reabrir e responder
        </Button>
      </Callout>
    );
  }

  if (conversation.status === "ia_atendendo") {
    return (
      <Callout
        icon={<Sparkles strokeWidth={1.5} className="size-4" />}
        toneClass="[background:var(--ai-bg)] [color:var(--ai-text)]"
        text="A IA está atendendo esta conversa."
        error={error}
      >
        <TakeoverButton
          pending={pendenteAcao}
          onClick={() =>
            executarAcaoDeConversa(() => assumirConversaAction(conversation.id))
          }
        />
      </Callout>
    );
  }

  if (conversation.status === "aguardando_humano") {
    return (
      <Callout
        icon={<Hand strokeWidth={1.5} className="size-4" />}
        toneClass="[background:var(--warning-bg)] [color:var(--warning-text)]"
        text="Ninguém está atendendo. Assuma para responder."
        error={error}
      >
        <TakeoverButton
          pending={pendenteAcao}
          onClick={() =>
            executarAcaoDeConversa(() => assumirConversaAction(conversation.id))
          }
        />
      </Callout>
    );
  }

  if (!isMine) {
    return (
      <Callout
        icon={<Hand strokeWidth={1.5} className="size-4" />}
        toneClass="bg-surface-3 text-text-secondary"
        text="Outra pessoa está com esta conversa."
        error={error}
      >
        <TakeoverButton
          pending={pendenteAcao}
          label="Assumir do colega"
          onClick={() =>
            executarAcaoDeConversa(() => assumirConversaAction(conversation.id))
          }
        />
      </Callout>
    );
  }

  return (
    <div
      {...solto.props}
      className={cn(
        "grid gap-2 px-4 py-3",
        isNote && "[background:var(--warning-bg)]",
        solto.classes,
      )}
    >
      {solto.sobrevoando ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-center text-[12.5px] text-text-secondary">
          Solte o arquivo para anexar
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-surface-3 p-0.5 text-[12px] font-medium">
          <button
            type="button"
            onClick={() => trocarModo("responder")}
            className={cn(
              "h-7 rounded-md px-3",
              !isNote ? "bg-surface-5" : "text-text-secondary",
            )}
          >
            Responder
          </button>
          <button
            type="button"
            onClick={() => trocarModo("nota")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-3",
              isNote
                ? "bg-surface-5 [color:var(--warning-text)]"
                : "text-text-secondary",
            )}
          >
            <Lock strokeWidth={1.5} className="size-3" />
            Nota interna
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={pendenteAcao}
            onClick={() =>
              executarAcaoDeConversa(() =>
                devolverParaIaAction(conversation.id),
              )
            }
          >
            <Undo2 strokeWidth={1.5} className="size-4" />
            Devolver para a IA
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pendenteAcao}
            onClick={() =>
              executarAcaoDeConversa(() =>
                resolverConversaAction(conversation.id),
              )
            }
          >
            <CheckCircle2 strokeWidth={1.5} className="size-4" />
            Resolver
          </Button>
        </div>
      </div>

      {isNote ? (
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium [color:var(--warning-text)]">
          <Lock strokeWidth={1.5} className="size-3" />
          Nota interna: o paciente não vê.
        </p>
      ) : null}

      {/* Anexo só na aba de resposta: nota interna nunca sai da clínica, então
          arquivo nela não teria para onde ir.

          ESCONDIDA, e não desmontada: o arquivo escolhido mora no estado da
          barra, então desmontá-la ao trocar de aba jogava fora, sem avisar, a
          foto que a pessoa acabara de anexar. Escondida, ela volta com o
          arquivo intacto quando a pessoa retorna para Responder. */}
      <div className={isNote ? "hidden" : undefined}>
        <BarraDeAnexo
          pendente={enviandoArquivo}
          desabilitado={enviandoArquivo}
          arquivoDeFora={arquivoSolto}
          aoConsumirArquivoDeFora={() => setArquivoSolto(null)}
          enviadoEm={enviadoEm}
          aoEnviar={(arquivo, legenda, notaDeVoz) => {
            const dados = new FormData();
            dados.set("arquivo", arquivo);
            dados.set("legenda", legenda);
            dados.set("nota_de_voz", notaDeVoz ? "1" : "0");
            if (citando) {
              dados.set("citando", citando.id);
            }
            // Caminho próprio, sem `useTransition` e sem tocar no texto: o
            // rascunho que a pessoa tem na caixa não pode sumir porque ela
            // mandou uma foto.
            setError(null);
            setEnviandoArquivo(true);
            void enviarArquivoAction(conversation.id, dados)
              .then((resultado) => {
                if (!resultado.ok) {
                  setError(resultado.error ?? "Não foi possível enviar.");
                  return;
                }
                setEnviadoEm(Date.now());
                aoCancelarCitacao();
                toast.success("Arquivo enviado.");
                refresh();
              })
              .finally(() => setEnviandoArquivo(false));
          }}
        />
      </div>

      {citando ? (
        <div className="flex items-center gap-2">
          <BlocoDeCitacao
            autor={autorDaCitacao(
              citando,
              conversation.contact.name ?? conversation.contact.phone_e164,
              authorNames,
            )}
            mensagem={citando}
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={aoCancelarCitacao}
            aria-label="Cancelar a resposta a esta mensagem"
            className="grid size-10 shrink-0 place-items-center rounded-full text-text-tertiary hover:bg-surface-3 hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X strokeWidth={1.5} className="size-4" />
          </button>
        </div>
      ) : null}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          enviarTexto();
        }}
      >
        <textarea
          ref={caixaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          placeholder={
            citando
              ? "Escreva a resposta a esta mensagem"
              : isNote
                ? "Escreva a nota para o time"
                : "Escreva a resposta"
          }
          aria-label={isNote ? "Nota interna" : "Resposta ao paciente"}
          className={cn(
            "min-h-[76px] flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            isNote && "[border-color:var(--warning)]",
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape" && citando) {
              event.preventDefault();
              aoCancelarCitacao();
              return;
            }
            // Enter envia, Shift+Enter quebra linha. A condição não olha Ctrl
            // nem Cmd, então o antigo Ctrl+Enter continua enviando: quem
            // decorou o atalho não perde nada.
            //
            // isComposing é obrigatório: sem ele, teclado com acentuação envia
            // no meio da palavra, porque o Enter que fecha o acento vira envio.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              enviarTexto();
            }
          }}
        />
        {/* Sem "Enviando...": o envio não bloqueia mais nada. O disabled fica
            só como afordância de que não há o que mandar. */}
        <Button type="submit" disabled={text.trim().length === 0}>
          <Send strokeWidth={1.5} className="size-4" />
          {isNote ? "Salvar nota" : "Enviar"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-[12px] [color:var(--alert-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TakeoverButton({
  pending,
  onClick,
  label = "Assumir conversa",
}: {
  pending: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button size="sm" disabled={pending} onClick={onClick}>
      {pending ? "Assumindo..." : label}
    </Button>
  );
}

function Callout({
  icon,
  toneClass,
  text,
  error,
  children,
}: {
  icon: React.ReactNode;
  toneClass: string;
  text: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 px-4 py-3">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium",
          toneClass,
        )}
      >
        {icon}
        <span className="flex-1">{text}</span>
        {children}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] [color:var(--alert-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
