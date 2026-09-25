"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  Hand,
  Lock,
  Send,
  ShieldOff,
  ShieldX,
  Smartphone,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { enviarArquivoAction } from "@/app/(app)/atendimento/actions";
import { SO_ACOMPANHA } from "@/components/atendimento/acoes-da-conversa";
import {
  BarraDeAnexo,
  useArquivoSolto,
} from "@/components/atendimento/media/barra-de-anexo";
import {
  autorDaCitacao,
  BlocoDeCitacao,
} from "@/components/atendimento/citacao";
import {
  dataNaClinica,
  FUSO_PADRAO,
} from "@/components/atendimento/fuso-da-clinica";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import type { TravaDoNumero } from "@/lib/domain/numeros-do-inbox";
import { conversationKeys } from "@/lib/queries/conversations";
import type {
  ConsentInfo,
  ConversationListItem,
  MessageItem,
} from "@/lib/queries/conversations";
import { estadoDoConsentimento } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Compositor, SO A ESCRITA (decisao do dono, C29): as acoes da conversa
// (Assumir, Transferir, Resolver, Reabrir) moram no cabecalho do fio. Aqui:
// 1. IA atendendo, aguardando humano, com colega ou resolvida: um aviso que
//    diz o estado e aponta para a acao no topo. Campo fora da tela.
// 2. Em atendimento (meu): Responder / Nota interna (fundo ambar), distintos
//    tambem pelo botao ("Enviar" e "Salvar nota").
// 3. Autorizacao revogada ou inexistente: a resposta ao paciente fica
//    desabilitada com o motivo e o caminho para a ficha; a nota interna
//    continua liberada.
// 4. Numero da conversa desconectado ou removido (so com mais de um numero,
//    docs/07): a resposta sai SO pelo numero da conversa, entao fica
//    desabilitada com o motivo (e o caminho para reconectar, para quem pode);
//    a nota interna continua liberada. Removido fora do meu atendimento vira
//    so o aviso, porque nenhuma acao do topo faz a resposta sair.
// A janela de 24h e conceito do canal oficial (isOfficialChannel) e nao
// renderiza com uazapi/fake; o dominio windowState ja esta pronto e testado.

export type Mode = "responder" | "nota";

// Igual ao bodySchema das Server Actions (z.string().trim().max(4096)).
const TETO_DE_CARACTERES = 4096;

/**
 * Enter envia SÓ onde existe teclado de verdade.
 *
 * Em teclado virtual de celular e tablet a tecla de retorno não produz
 * shiftKey, então "Enter envia, Shift+Enter quebra linha" deixaria a recepção
 * sem NENHUMA forma de escrever duas linhas: toda quebra viraria mensagem
 * disparada ao paciente. O Atendimento é explicitamente uma tela de toque
 * (a alternância entre lista e fio abaixo de 1024px existe para isso).
 *
 * `pointer: fine` é a pergunta certa: existe um apontador preciso, logo existe
 * um teclado físico. No toque, continuam valendo o botão Enviar e o Ctrl+Enter.
 */
function temTecladoDeVerdade(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(pointer: fine)").matches;
}

export function Composer({
  conversation,
  viewerId,
  podeEditar,
  autorizacao,
  timezone = FUSO_PADRAO,
  citando,
  aoCancelarCitacao,
  aoCancelarCitacaoSeFor,
  authorNames,
  modo,
  aoTrocarModo,
  texto,
  aoMudarTexto,
  aoEnviarTexto,
  aoPerderConversa,
  travaDoNumero = null,
  podeReconectar = false,
}: {
  conversation: ConversationListItem;
  viewerId: string;
  /** o papel escreve no Atendimento (a matriz); leitura so acompanha */
  podeEditar: boolean;
  /**
   * A autorizacao de mensagens do contato, quando ja conferida. Undefined
   * enquanto carrega ou se a consulta falhou: ai o compositor nao trava
   * (quem decide e o envio no servidor), so o painel mostra o estado.
   */
  autorizacao?: ConsentInfo;
  /** fuso da clinica, para a data da revogacao */
  timezone?: string;
  /** mensagem que está sendo respondida, quando houver */
  citando: MessageItem | null;
  aoCancelarCitacao: () => void;
  /** cancela SÓ se a citação pendurada ainda for aquela; ver o envio de arquivo */
  aoCancelarCitacaoSeFor: (id: string) => void;
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
   * O rascunho, que mora no pai junto do plano e da citação.
   *
   * As três coisas decidem para onde este texto vai, então mudam juntas ou não
   * mudam. Ver o comentário longo no InboxClient.
   */
  texto: string;
  aoMudarTexto: (texto: string) => void;
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
  /**
   * A conversa deixou de estar disponivel para esta pessoa (o servidor
   * respondeu conversaIndisponivel): o InboxClient tira da lista e fecha.
   */
  aoPerderConversa?: (conversationId: string) => void;
  /**
   * O numero da conversa impede a resposta (travaDoNumero, em
   * lib/domain/numeros-do-inbox.ts): desconectado ou removido. Null quando
   * nao impede ou quando a clinica tem um numero so (ai quem avisa e a faixa
   * do topo, e o envio no servidor recusa com o motivo, como sempre).
   */
  travaDoNumero?: TravaDoNumero | null;
  /** Quem pode reconectar o numero (Configuracoes: administrador e gestor) */
  podeReconectar?: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const caixaRef = useRef<HTMLTextAreaElement>(null);
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
  // Autorizacao revogada ou inexistente: a RESPOSTA ao paciente nao sai (o
  // envio no servidor recusa, e a regra 3.4 diz que a mensagem do paciente
  // nao reautoriza sozinha). A nota interna nunca sai da clinica e continua.
  const estadoDaAutorizacao =
    autorizacao === undefined ? null : estadoDoConsentimento(autorizacao);
  const autorizacaoBloqueia =
    estadoDaAutorizacao === "revogado" ||
    estadoDaAutorizacao === "sem_autorizacao";
  // A resposta ao paciente nao sai: pela autorizacao ou pelo numero da
  // conversa (desconectado ou removido). A nota interna continua nos dois.
  const respostaBloqueada = autorizacaoBloqueia || travaDoNumero !== null;
  const autorizacaoTrava = !isNote && respostaBloqueada;
  // Quem esta com a conversa mas perdeu a escrita (o papel virou Somente
  // leitura com conversa atribuida, achado L5): o compositor aparece, mas
  // tudo que escreve fica desabilitado com o motivo. O servidor recusa de
  // novo (exigeEdicao).
  const escritaTravada = !podeEditar || autorizacaoTrava;
  // O compositor tem retornos antecipados por estado da conversa (resolvida,
  // com a IA, de outra pessoa), entao o hook precisa vir ANTES de todos eles.
  const solto = useArquivoSolto(
    (arquivo) => setArquivoSolto(arquivo),
    podeEditar && !isNote && !respostaBloqueada,
  );

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: conversationKeys.messages(conversation.id),
    });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
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
    const corpo = texto.trim();
    if (corpo.length === 0 || escritaTravada) {
      return;
    }
    if (corpo.length > TETO_DE_CARACTERES) {
      // Guarda no cliente porque o servidor recusa com uma mensagem que fala de
      // texto vazio, e agora a caixa esvazia no envio: sem isto, um texto longo
      // demais iria para o cartão de falha, onde não dá para editá-lo, e o
      // "Tentar de novo" repetiria a mesma recusa para sempre.
      setError(
        `A mensagem tem ${corpo.length} caracteres e o limite é ${TETO_DE_CARACTERES}. Encurte antes de enviar.`,
      );
      return;
    }
    setError(null);
    aoMudarTexto("");
    caixaRef.current?.focus();
    aoEnviarTexto({ corpo, ehNota: isNote, citandoId: citando?.id ?? null });
    aoCancelarCitacao();
  };

  // Clicar em "Responder" numa bolha já deixa a pessoa digitando.
  //
  // Sem autoFocus: o compositor remonta a cada troca de conversa (key), então
  // autoFocus roubaria o foco de quem está navegando pela lista e abriria o
  // teclado sozinho no celular. Aqui o gesto é explícito.
  // Medido uma vez, e não a cada tecla: matchMedia é barato mas isto roda no
  // caminho de digitação.
  const [tecladoFisico] = useState(temTecladoDeVerdade);
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

  // Quem so acompanha le o estado, sem ser mandado para um botao que nao
  // pode usar (o botao no topo aparece desabilitado com a MESMA frase na
  // dica, SO_ACOMPANHA).

  // Numero removido fora do meu atendimento: nenhuma acao do topo (Reabrir,
  // Assumir) faz a resposta sair por ele, entao o aviso de estado mandaria a
  // pessoa para um caminho sem saida. O motivo vem primeiro.
  if (travaDoNumero?.motivo === "removido" && !isMine) {
    return (
      <AvisoDoCompositor>
        <AvisoDoNumero trava={travaDoNumero} podeReconectar={false} />
      </AvisoDoCompositor>
    );
  }

  if (conversation.status === "resolvida") {
    return (
      <AvisoDoCompositor>
        <Aviso tom="success" titulo="Conversa resolvida.">
          {podeEditar
            ? "Para responder de novo, use Reabrir e responder, no topo da conversa."
            : SO_ACOMPANHA}
        </Aviso>
      </AvisoDoCompositor>
    );
  }

  if (conversation.status === "ia_atendendo") {
    return (
      <AvisoDoCompositor>
        <Aviso tom="ia" titulo="A IA está atendendo esta conversa.">
          {podeEditar
            ? "Para responder, use Assumir conversa, no topo da conversa."
            : SO_ACOMPANHA}
        </Aviso>
      </AvisoDoCompositor>
    );
  }

  if (conversation.status === "aguardando_humano") {
    return (
      <AvisoDoCompositor>
        <Aviso
          tom="warning"
          icone={Hand}
          // Quem so acompanha nao e mandado assumir: o Assumir dele esta
          // desabilitado (achado L25).
          titulo={
            podeEditar
              ? "Ninguém está atendendo. Assuma para responder."
              : "Ninguém está atendendo."
          }
        >
          {podeEditar
            ? "Use Assumir conversa, no topo da conversa."
            : SO_ACOMPANHA}
        </Aviso>
      </AvisoDoCompositor>
    );
  }

  if (!isMine) {
    const quemAtende = conversation.assignee_user_id
      ? (authorNames[conversation.assignee_user_id] ?? "Outra pessoa")
      : "Outra pessoa";
    return (
      <AvisoDoCompositor>
        <AvisoDeColega nome={quemAtende}>
          {podeEditar
            ? `${quemAtende} está atendendo. Para responder, use Assumir do colega, no topo da conversa.`
            : `${quemAtende} está atendendo. ${SO_ACOMPANHA}`}
        </AvisoDeColega>
      </AvisoDoCompositor>
    );
  }

  return (
    <div
      {...solto.props}
      className={cn(
        // minmax(0, 1fr): sem ela a trilha implicita cresce ate o conteudo
        // mais largo e, no celular, empurrava o Enviar para fora da tela.
        "grid grid-cols-[minmax(0,1fr)] gap-2 px-4 py-3 cz-transition",
        isNote && "bg-warning-bg",
        solto.classes,
      )}
    >
      {!podeEditar ? (
        <Aviso
          tom="neutral"
          icone={Eye}
          titulo="Esta conversa está com você, mas seu perfil só acompanha."
        >
          {SO_ACOMPANHA} Peça a um administrador ou gestor para passar a
          conversa a outra pessoa.
        </Aviso>
      ) : null}
      {solto.sobrevoando ? (
        <p className="rounded-xl border border-dashed border-primary-edge bg-primary-soft px-3 py-2 text-center text-[12.5px] font-semibold text-primary-text">
          Solte o arquivo para anexar
        </p>
      ) : null}
      {/* Anexo só na aba de resposta: nota interna nunca sai da clínica, então
          arquivo nela não teria para onde ir.

          ESCONDIDA, e não desmontada: o arquivo escolhido mora no estado da
          barra, então desmontá-la ao trocar de aba jogava fora, sem avisar, a
          foto que a pessoa acabara de anexar. A barra fica montada sempre; o
          compositor só esconde as partes dela na nota interna. */}
      <BarraDeAnexo
        pendente={enviandoArquivo}
        desabilitado={enviandoArquivo || respostaBloqueada || !podeEditar}
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
          // A citação que ESTE envio levou, capturada agora. O upload demora
          // segundos, e cancelar "a citação" na volta alcançaria a que a
          // pessoa escolheu enquanto esperava, ou até a de outra conversa,
          // porque quem guarda a citação é o InboxClient, que não remonta.
          const citadaDesteEnvio = citando?.id ?? null;
          void enviarArquivoAction(conversation.id, dados)
            .then((resultado) => {
              if (!resultado.ok) {
                if (resultado.conversaIndisponivel) {
                  // A conversa saiu do alcance desta pessoa (passada para
                  // outra): a tela inteira sai dela, com o aviso.
                  aoPerderConversa?.(conversation.id);
                  return;
                }
                setError(resultado.error ?? "Não foi possível enviar.");
                return;
              }
              setEnviadoEm(Date.now());
              if (citadaDesteEnvio) {
                aoCancelarCitacaoSeFor(citadaDesteEnvio);
              }
              toast.success("Arquivo enviado.");
              refresh();
            })
            // Sem isto, uma rejeição (rede caindo no meio do upload) destrava
            // o botão pelo finally e não avisa nada: a pessoa fica sem erro e
            // sem arquivo, achando que mandou.
            .catch(() => {
              setError(
                "Não foi possível falar com o servidor. O arquivo não foi enviado.",
              );
            })
            .finally(() => setEnviandoArquivo(false));
        }}
      >
        {({ botoes, previa }) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                size="sm"
                ariaLabel="Para quem vai o texto"
                value={modo}
                onChange={trocarModo}
                options={[
                  { value: "responder", label: "Responder" },
                  { value: "nota", label: "Nota interna", icon: Lock },
                ]}
              />
              {isNote ? (
                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warning-text">
                  <Lock aria-hidden className="size-3" />
                  Nota interna: o paciente não vê.
                </p>
              ) : null}
              <div
                className={cn(
                  "ml-auto",
                  (isNote || respostaBloqueada) && "hidden",
                )}
              >
                {botoes}
              </div>
            </div>
            {podeEditar && !isNote && travaDoNumero ? (
              <AvisoDoNumero
                trava={travaDoNumero}
                podeReconectar={podeReconectar}
                comNota
              />
            ) : null}
            {podeEditar && !isNote && autorizacaoBloqueia ? (
              <AvisoDeAutorizacao
                revogadaEm={autorizacao?.revoked_at ?? null}
                contactId={conversation.contact.id}
                timezone={timezone}
              />
            ) : null}
            <div className={isNote || respostaBloqueada ? "hidden" : undefined}>
              {previa}
            </div>
          </>
        )}
      </BarraDeAnexo>

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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={aoCancelarCitacao}
            aria-label="Cancelar a resposta a esta mensagem"
            className="rounded-full text-text-secondary"
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <form
        className={cn(
          "flex items-end gap-2 rounded-card border p-2 cz-transition focus-within:border-focus focus-within:ring-3 focus-within:ring-ring/55",
          isNote
            ? "border-(--warning-text) bg-card"
            : "border-input bg-surface-subtle",
          escritaTravada && "opacity-60",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          enviarTexto();
        }}
      >
        <textarea
          ref={caixaRef}
          value={texto}
          onChange={(event) => aoMudarTexto(event.target.value)}
          maxLength={TETO_DE_CARACTERES}
          rows={2}
          disabled={escritaTravada}
          placeholder={
            citando
              ? "Escreva a resposta a esta mensagem"
              : isNote
                ? "Escreva a nota para o time"
                : "Escreva a resposta"
          }
          aria-label={isNote ? "Nota interna" : "Resposta ao paciente"}
          className="field-sizing-content max-h-[120px] min-h-[52px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-[5px] text-base leading-[1.5] text-text-strong outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed md:text-[13.5px]"
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
            if (event.key !== "Enter" || event.nativeEvent.isComposing) {
              return;
            }
            // Ctrl/Cmd+Enter envia em qualquer aparelho, inclusive no tablet
            // onde o Enter puro precisa continuar quebrando linha.
            const atalhoExplicito = event.metaKey || event.ctrlKey;
            if (atalhoExplicito || (!event.shiftKey && tecladoFisico)) {
              event.preventDefault();
              enviarTexto();
            }
          }}
        />
        {/* Sem "Enviando...": o envio não bloqueia mais nada. O disabled fica
            só como afordância de que não há o que mandar. Os dois planos se
            distinguem pelo TEXTO e pela pele do botão (lime para o paciente,
            tinta com cadeado para a nota): houve nota indo ao paciente. */}
        {podeEditar ? (
          <Button
            type="submit"
            variant={isNote ? "solid" : "default"}
            disabled={texto.trim().length === 0 || escritaTravada}
          >
            {isNote ? <Lock aria-hidden /> : <Send aria-hidden />}
            {isNote ? "Salvar nota" : "Enviar"}
          </Button>
        ) : (
          // Sem escrita: visivel e desabilitado, com o motivo na dica.
          <DisabledWithHint hint={SO_ACOMPANHA}>
            <Button
              type="submit"
              variant={isNote ? "solid" : "default"}
              disabled
            >
              {isNote ? <Lock aria-hidden /> : <Send aria-hidden />}
              {isNote ? "Salvar nota" : "Enviar"}
            </Button>
          </DisabledWithHint>
        )}
      </form>

      {error ? (
        <p role="alert" className="text-[12px] text-alert-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** O aviso de estado ocupa o lugar do compositor, com o mesmo respiro. */
function AvisoDoCompositor({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 px-4 py-3">{children}</div>;
}

/**
 * Conversa com um colega: aviso neutro com as INICIAIS de quem atende, e nao
 * a mao, que ja e o icone ambar de "Aguardando você". O Aviso compartilhado
 * so aceita icone Lucide, por isso a casca e montada aqui com as mesmas
 * classes do tom neutro.
 */
function AvisoDeColega({
  nome,
  children,
}: {
  nome: string;
  children: React.ReactNode;
}) {
  const iniciais = nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      role="status"
      data-tom="neutral"
      className="flex items-start gap-[11px] rounded-xl bg-neutral-bg px-3.5 py-3 text-neutral-text"
    >
      <span
        aria-hidden
        className="mt-px grid size-[17px] shrink-0 place-items-center rounded-full bg-surface-5 text-[8px] font-bold text-text-strong"
      >
        {iniciais || "?"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13.5px] leading-[1.35] font-bold">
          Outra pessoa está com esta conversa.
        </p>
        <div className="text-[13px] leading-[1.45]">{children}</div>
      </div>
    </div>
  );
}

// Quem nao reconecta ve o botao desabilitado com o porque (regra de interface
// do CLAUDE.md), com a frase das acoes de conexao (whatsapp-connect.ts).
const DICA_SEM_RECONECTAR =
  "Somente administradores e gestores conectam o WhatsApp.";

/**
 * Resposta ao paciente presa ao numero da conversa (docs/07). Desconectado:
 * a resposta so sai por aquele numero, e nunca troca de numero sozinha, entao
 * espera a reconexao; quem pode reconectar ganha o caminho, quem nao pode ve
 * o botao desabilitado com o motivo. Removido: nao sai mais, e nao ha o que
 * reconectar. `comNota` acrescenta que a nota interna continua liberada (o
 * compositor esta aberto).
 */
function AvisoDoNumero({
  trava,
  podeReconectar,
  comNota = false,
}: {
  trava: TravaDoNumero;
  podeReconectar: boolean;
  comNota?: boolean;
}) {
  const nota = comNota ? " A nota interna continua liberada." : "";
  if (trava.motivo === "removido") {
    return (
      <Aviso
        tom="neutral"
        icone={Smartphone}
        titulo={`Esta conversa era do número ${trava.nome}, que foi removido.`}
      >
        {`Nenhuma resposta sai mais por ele. O histórico continua aqui.${nota}`}
      </Aviso>
    );
  }
  const reconectar = (
    <Button asChild variant="outline" size="sm">
      <Link href="/configuracoes?aba=whatsapp">Reconectar</Link>
    </Button>
  );
  return (
    <Aviso
      tom="alert"
      icone={WifiOff}
      titulo={`O número ${trava.nome} está desconectado.`}
      acao={
        podeReconectar ? (
          reconectar
        ) : (
          <DisabledWithHint hint={DICA_SEM_RECONECTAR}>
            <Button variant="outline" size="sm" disabled>
              Reconectar
            </Button>
          </DisabledWithHint>
        )
      }
    >
      {`A resposta sai quando ele reconectar.${nota}`}
    </Aviso>
  );
}

/**
 * Resposta ao paciente travada por falta de autorização (achado 15). O
 * motivo, a data e o caminho para a ficha, onde a nova autorização é
 * registrada com evidência. A nota interna continua liberada.
 */
function AvisoDeAutorizacao({
  revogadaEm,
  contactId,
  timezone,
}: {
  revogadaEm: string | null;
  contactId: string;
  timezone: string;
}) {
  const abrirFicha = (
    <Button asChild variant="outline" size="sm">
      <Link href={`/pacientes/${contactId}`}>Abrir a ficha</Link>
    </Button>
  );
  if (revogadaEm) {
    return (
      <Aviso
        tom="alert"
        icone={ShieldX}
        titulo="Este contato pediu para não receber mensagens."
        acao={abrirFicha}
      >
        Desde{" "}
        <span className="cz-num">{dataNaClinica(revogadaEm, timezone)}</span>. A
        resposta só sai depois de registrar a nova autorização na ficha. A nota
        interna continua liberada.
      </Aviso>
    );
  }
  return (
    <Aviso
      tom="neutral"
      icone={ShieldOff}
      titulo="Sem autorização registrada para mensagens."
      acao={abrirFicha}
    >
      A resposta só sai depois de registrar a autorização na ficha. A nota
      interna continua liberada.
    </Aviso>
  );
}
