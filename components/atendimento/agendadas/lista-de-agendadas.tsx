"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  dispensarAgendadaAction,
  enviarAgendadaAgoraAction,
  excluirAgendadaAction,
} from "@/app/(app)/atendimento/agendadas-actions";
import {
  textoDoAnuncio,
  type Anuncio,
} from "@/components/atendimento/agendadas/anuncio";
import {
  ConfirmacaoDeEnviarAgora,
  ConfirmacaoDeExcluir,
} from "@/components/atendimento/agendadas/confirmacoes-da-agendada";
import {
  desfechoDaFalhaDeRede,
  desfechoDoEnviarAgora,
  type DevolucaoDoTexto,
} from "@/components/atendimento/agendadas/enviar-agora";
import { ItemDeAgendada } from "@/components/atendimento/agendadas/item-de-agendada";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConversationStatus } from "@/lib/design/status";
import {
  acoesDoItem,
  agendadasKeys,
  estaAntesDoEnvio,
  estadoDoItem,
  ficaSempreAVista,
  quandoEmTexto,
  resumoDaLista,
  type AgendadaDaLista,
  type ContextoDaListaDeAgendadas,
  type EstadoDoItemDaAgendada,
  type SituacaoDaAgendada,
} from "@/lib/domain/mensagem-agendada";
import {
  conversationKeys,
  type NumerosDoInbox,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Lista das mensagens agendadas do contato, logo acima da caixa de escrever
// (secao 4.4 do desenho; A1, A2 e A3 do desenho final). Irma do Composer no
// InboxClient, FORA dos retornos antecipados dele: aparece em toda conversa
// do contato (aberta, resolvida, com a IA, de colega, de numero removido).
//
// - Vazio: nada, sem caixa. Carregando: nada nos primeiros 300 ms, depois
//   uma linha-esqueleto de 40px. Erro: aviso compacto com Tentar de novo.
// - Com 1 item, a linha inteira. Com 2 ou mais, o resumo com Ver todas. Os
//   itens que pedem atencao (nao enviada, envio nao confirmado, esperando o
//   numero, e o que ainda vai sair depois que o paciente escreveu) ficam
//   sempre a vista. A lista tem SEMPRE teto de 40% da altura da tela e
//   rolagem propria (fechada, com 1 item ou aberta): o fio nao pode ser
//   espremido por ela (achado 11 da revisao).
// - A conexao de cada numero vem do cache vivo dos numeros do Inbox (tempo
//   real de whatsapp_account), por cima do retrato da ultima leitura: o
//   Enviar agora destrava assim que o numero reconecta.
// - Um role=status montado sempre anuncia o que muda; depois de excluir, o
//   foco vai para o proximo item ou para o titulo.
// - Nenhum texto de paciente sai daqui para log: erros so viram aviso na
//   tela.

/** O que a lista sabe da leitura (InboxClient, useQuery). */
export type EstadoDaListaDeAgendadas = "carregando" | "erro" | "pronto";

export type DadosDaListaDeAgendadas = {
  itens: AgendadaDaLista[];
  contexto: ContextoDaListaDeAgendadas;
};

/** A conversa aberta na tela, para as acoes de cada item. */
export type ConversaDaListaDeAgendadas = {
  id: string;
  status: ConversationStatus;
  assigneeUserId: string | null;
  whatsappAccountId: string | null;
  contactId: string;
  /** Nome do contato, ou o telefone formatado */
  contato: string | null;
};

/** Atraso do esqueleto: leitura rapida nao pisca nada na tela. */
export const ATRASO_DO_ESQUELETO_MS = 300;

/**
 * O contexto da leitura com a conexao dos numeros que o Inbox ja conhece
 * (ativos e removidos), que o tempo real mantem vivos. Inclui o numero da
 * conversa aberta mesmo sem agendada nele: o Agendar de novo trava quando
 * ele foi removido. Numero que o Inbox nao conhece fica como a leitura viu.
 */
export function contextoComNumerosAoVivo(
  contexto: ContextoDaListaDeAgendadas,
  numeros: NumerosDoInbox | undefined,
): ContextoDaListaDeAgendadas {
  if (
    !numeros ||
    (numeros.ativos.length === 0 && numeros.removidos.length === 0)
  ) {
    return contexto;
  }
  const conexaoPorNumero = { ...contexto.conexaoPorNumero };
  for (const numero of numeros.ativos) {
    conexaoPorNumero[numero.id] = {
      nome: numero.nome,
      conectado: numero.connection_status === "conectado",
      removido: false,
      cor: numero.cor,
    };
  }
  for (const numero of numeros.removidos) {
    conexaoPorNumero[numero.id] = {
      nome: numero.nome,
      conectado: false,
      removido: true,
      cor: contexto.conexaoPorNumero[numero.id]?.cor ?? null,
    };
  }
  return { ...contexto, conexaoPorNumero };
}

/** Itens visiveis na ordem da lista, com o estado de cada um. */
export function itensVisiveis(
  itens: readonly AgendadaDaLista[],
  contexto: ContextoDaListaDeAgendadas,
  agora: number,
  fuso: string,
): { agendada: AgendadaDaLista; estado: EstadoDoItemDaAgendada }[] {
  const visiveis: {
    agendada: AgendadaDaLista;
    estado: EstadoDoItemDaAgendada;
  }[] = [];
  for (const agendada of itens) {
    const estado = estadoDoItem(agendada, contexto, agora, fuso);
    if (estado !== null) {
      visiveis.push({ agendada, estado });
    }
  }
  return visiveis;
}

/**
 * Quem vai para o foco depois que um item sai da lista: o proximo entre os
 * que estao na tela, ou o titulo da secao (null).
 */
export function proximoFoco(
  naTela: readonly string[],
  removido: string,
): string | null {
  const indice = naTela.indexOf(removido);
  if (indice < 0) {
    return null;
  }
  return naTela[indice + 1] ?? null;
}

type Confirmacao = {
  tipo: "excluir" | "enviar_agora";
  agendada: AgendadaDaLista;
};

export type ListaDeAgendadasProps = {
  clinicId: string;
  estado: EstadoDaListaDeAgendadas;
  dados: DadosDaListaDeAgendadas | undefined;
  aoTentarDeNovo: () => void;
  conversa: ConversaDaListaDeAgendadas;
  viewerId: string;
  /** O papel escreve no Atendimento (Somente leitura nao) */
  podeEscrever: boolean;
  /** Nomes da equipe por user_id */
  nomes: Record<string, string>;
  timezone: string;
  /** Relogio inicial (o do servidor na carga) */
  agoraInicial?: number;
  /** A clinica tem mais de um numero ativo */
  mostrarNumero: boolean;
  /** O que a regiao role=status diz agora */
  anuncio: Anuncio;
  anunciar: (texto: string) => void;
  aoEditar: (agendada: AgendadaDaLista) => void;
  aoAgendarDeNovo: (agendada: AgendadaDaLista) => void;
  /**
   * Enviar agora retirou a agendada e nada saiu (ou a resposta se perdeu):
   * o texto volta para o campo, com o aviso e a certeza de cada caso.
   */
  aoDevolverTexto: (devolucao: DevolucaoDoTexto) => void;
  /** Leva a tela ate outra conversa (a enviada saiu por outro numero) */
  aoIrParaConversa: (conversationId: string) => void;
  /**
   * Os numeros da clinica como o Inbox os ve agora (tempo real). Sem eles,
   * vale a conexao da ultima leitura da lista.
   */
  numerosAoVivo?: NumerosDoInbox;
};

export function ListaDeAgendadas({
  clinicId,
  estado,
  dados,
  aoTentarDeNovo,
  conversa,
  viewerId,
  podeEscrever,
  nomes,
  timezone,
  agoraInicial,
  mostrarNumero,
  anuncio,
  anunciar,
  aoEditar,
  aoAgendarDeNovo,
  aoDevolverTexto,
  aoIrParaConversa,
  numerosAoVivo,
}: ListaDeAgendadasProps) {
  const queryClient = useQueryClient();
  const base = useId();
  const idDoTitulo = `${base}-titulo`;
  const idDaLista = `${base}-lista`;
  const chave = agendadasKeys.doContato(clinicId, conversa.contactId);

  // O relogio da lista: "Agendada" vira "Na fila para sair" na hora marcada,
  // e a enviada some depois de 24 horas, sem esperar evento.
  const [agora, setAgora] = useState(() => agoraInicial ?? Date.now());
  useEffect(() => {
    setAgora(Date.now());
    const relogio = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(relogio);
  }, []);

  // Esqueleto so depois de 300 ms carregando.
  const [esqueleto, setEsqueleto] = useState(false);
  useEffect(() => {
    if (estado !== "carregando") {
      setEsqueleto(false);
      return;
    }
    const espera = window.setTimeout(
      () => setEsqueleto(true),
      ATRASO_DO_ESQUELETO_MS,
    );
    return () => window.clearTimeout(espera);
  }, [estado]);

  const [aberta, setAberta] = useState(false);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [erroDaConfirmacao, setErroDaConfirmacao] = useState<string | null>(
    null,
  );
  const [ocupado, setOcupado] = useState<string | null>(null);

  const contexto = useMemo(
    () =>
      dados ? contextoComNumerosAoVivo(dados.contexto, numerosAoVivo) : null,
    [dados, numerosAoVivo],
  );
  const visiveis = useMemo(
    () =>
      dados && contexto
        ? itensVisiveis(dados.itens, contexto, agora, timezone)
        : [],
    [dados, contexto, agora, timezone],
  );

  // "A mensagem agendada saiu." / "não saiu.": so as mudancas vistas com a
  // lista aberta (a primeira leitura nao anuncia nada).
  const estadosAnteriores = useRef<Map<string, EstadoDoItemDaAgendada> | null>(
    null,
  );
  useEffect(() => {
    if (!dados) {
      return;
    }
    const atuais = new Map(
      visiveis.map((item) => [item.agendada.id, item.estado] as const),
    );
    const anteriores = estadosAnteriores.current;
    estadosAnteriores.current = atuais;
    if (!anteriores) {
      return;
    }
    let saiu = false;
    let naoSaiu = false;
    for (const [id, atual] of atuais) {
      const antes = anteriores.get(id);
      if (!antes || !estaAntesDoEnvio(antes)) {
        continue;
      }
      if (atual === "enviada") {
        saiu = true;
      } else if (atual === "nao_enviada" || atual === "nao_confirmada") {
        naoSaiu = true;
      }
    }
    if (naoSaiu) {
      anunciar("A mensagem agendada não saiu.");
    } else if (saiu) {
      anunciar("A mensagem agendada saiu.");
    }
  }, [dados, visiveis, anunciar]);

  // Foco depois que um item sai da lista (excluir, dispensar, enviar agora):
  // o proximo item na tela, senao o titulo da secao. Sem secao (a lista
  // esvaziou), a caixa de escrever, quando ela existe. O texto que voltou
  // para o campo leva o foco direto para a caixa.
  const secaoRef = useRef<HTMLElement>(null);
  const tituloRef = useRef<HTMLDivElement>(null);
  const alvoDoFoco = useRef<
    { tipo: "item"; id: string | null } | { tipo: "caixa" } | null
  >(null);
  const focarAlvo = () => {
    const alvo = alvoDoFoco.current;
    if (!alvo) {
      return false;
    }
    alvoDoFoco.current = null;
    // Depois do proximo desenho: o item que saiu ja nao esta na tela.
    window.requestAnimationFrame(() => {
      const caixa = document.querySelector<HTMLElement>(
        "[data-caixa-do-compositor]",
      );
      if (alvo.tipo === "caixa") {
        caixa?.focus();
        return;
      }
      const item = alvo.id
        ? secaoRef.current?.querySelector<HTMLElement>(
            `li[data-agendada="${alvo.id}"]`,
          )
        : null;
      (item ?? tituloRef.current ?? caixa)?.focus();
    });
    return true;
  };

  const tirarDaLista = (id: string) => {
    queryClient.setQueryData<DadosDaListaDeAgendadas>(chave, (atual) =>
      atual
        ? { ...atual, itens: atual.itens.filter((item) => item.id !== id) }
        : atual,
    );
    void queryClient.invalidateQueries({ queryKey: chave });
  };

  const recarregar = () =>
    void queryClient.invalidateQueries({ queryKey: chave });

  const marcarFoco = (id: string) => {
    const naTela = [
      ...(secaoRef.current?.querySelectorAll<HTMLElement>(
        "li[data-agendada]",
      ) ?? []),
    ].map((item) => item.dataset.agendada ?? "");
    alvoDoFoco.current = { tipo: "item", id: proximoFoco(naTela, id) };
  };

  const fecharConfirmacao = () => {
    setConfirmacao(null);
    setErroDaConfirmacao(null);
  };

  const excluir = (agendada: AgendadaDaLista) => {
    setErroDaConfirmacao(null);
    setOcupado(agendada.id);
    excluirAgendadaAction({ id: agendada.id })
      .then((resultado) => {
        if (!resultado.ok) {
          setErroDaConfirmacao(resultado.error);
          recarregar();
          return;
        }
        marcarFoco(agendada.id);
        setConfirmacao(null);
        tirarDaLista(agendada.id);
        anunciar("Mensagem agendada excluída.");
      })
      .catch(() => {
        setErroDaConfirmacao(
          "Não foi possível falar com o servidor. A mensagem continua agendada.",
        );
        recarregar();
      })
      .finally(() => setOcupado(null));
  };

  // O fio da conversa aberta (e o da conversa da agendada, quando for
  // outra) e a lista de conversas: a mensagem pode ter saido.
  const recarregarFio = (agendada: AgendadaDaLista) => {
    void queryClient.invalidateQueries({
      queryKey: conversationKeys.messages(conversa.id),
    });
    if (agendada.conversationId && agendada.conversationId !== conversa.id) {
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.messages(agendada.conversationId),
      });
    }
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  /**
   * Depois de uma falha de rede, a lista rele para saber se a agendada
   * ainda esta marcada. null: a releitura tambem falhou.
   */
  const relerDepoisDaFalha = async (
    id: string,
  ): Promise<{ situacao: SituacaoDaAgendada | null } | null> => {
    const desde = Date.now();
    try {
      await queryClient.refetchQueries({ queryKey: chave, exact: true });
    } catch {
      return null;
    }
    const estadoDaLeitura =
      queryClient.getQueryState<DadosDaListaDeAgendadas>(chave);
    if (
      !estadoDaLeitura ||
      estadoDaLeitura.status !== "success" ||
      estadoDaLeitura.dataUpdatedAt < desde ||
      !estadoDaLeitura.data
    ) {
      return null;
    }
    const item = estadoDaLeitura.data.itens.find((a) => a.id === id);
    return { situacao: item?.situacao ?? null };
  };

  // Tira o item que saiu da agenda e devolve o texto ao campo (o foco vai
  // direto para a caixa).
  const devolverAoCampo = (
    agendada: AgendadaDaLista,
    devolucao: DevolucaoDoTexto,
  ) => {
    alvoDoFoco.current = { tipo: "caixa" };
    setConfirmacao(null);
    tirarDaLista(agendada.id);
    aoDevolverTexto(devolucao);
  };

  // Envio incerto: o texto NAO volta para o campo (mandar de novo poderia
  // duplicar), mas a pessoa pode copia-lo, por gesto proprio, depois de
  // conferir a conversa. Sem isso, uma excecao antes de a mensagem existir
  // perderia o texto (a agendada ja foi retirada; revisao de 06/10/2026).
  const avisarIncerto = (aviso: string, texto: string | null) => {
    toast.warning(aviso, {
      duration: texto ? 20_000 : 10_000,
      ...(texto
        ? {
            action: {
              label: "Copiar a mensagem",
              onClick: () => {
                void navigator.clipboard
                  ?.writeText(texto)
                  .catch(() => undefined);
              },
            },
          }
        : {}),
    });
  };

  const enviarAgora = (agendada: AgendadaDaLista) => {
    setErroDaConfirmacao(null);
    setOcupado(agendada.id);
    // O texto que a lista ja tem: se a resposta se perder no caminho, ele
    // ainda pode voltar para o campo (achado 24).
    const textoDoItem = agendada.texto;
    enviarAgendadaAgoraAction({ id: agendada.id })
      .then(
        (resultado) => {
          const desfecho = desfechoDoEnviarAgora(resultado);
          switch (desfecho.tipo) {
            case "saiu":
              marcarFoco(agendada.id);
              setConfirmacao(null);
              tirarDaLista(agendada.id);
              anunciar("A mensagem agendada saiu.");
              void queryClient.invalidateQueries({
                queryKey: conversationKeys.messages(desfecho.conversationId),
              });
              void queryClient.invalidateQueries({
                queryKey: ["conversations"],
              });
              return;
            case "devolver":
              // Saiu da agenda e e CERTO que nao saiu para o paciente: o
              // texto volta para o campo, nunca se perde.
              devolverAoCampo(agendada, desfecho.devolucao);
              return;
            case "incerto":
              // Pode ter chegado ao paciente: o texto NAO volta (mandar de
              // novo duplicaria). O fio mostra o que de fato aconteceu.
              marcarFoco(agendada.id);
              setConfirmacao(null);
              tirarDaLista(agendada.id);
              recarregarFio(agendada);
              avisarIncerto(desfecho.aviso, textoDoItem);
              return;
            case "recusado":
              setErroDaConfirmacao(desfecho.aviso);
              recarregar();
              return;
          }
        },
        async () => {
          // Sem resposta nao da para saber se saiu: a lista rele antes de
          // decidir, e o fio confere.
          const releitura = await relerDepoisDaFalha(agendada.id);
          recarregarFio(agendada);
          const desfecho = desfechoDaFalhaDeRede({
            releitura,
            texto: textoDoItem,
          });
          switch (desfecho.tipo) {
            case "devolver":
              devolverAoCampo(agendada, desfecho.devolucao);
              return;
            case "incerto":
              marcarFoco(agendada.id);
              setConfirmacao(null);
              tirarDaLista(agendada.id);
              avisarIncerto(desfecho.aviso, textoDoItem);
              return;
            case "recusado":
              setErroDaConfirmacao(desfecho.aviso);
              return;
          }
        },
      )
      // Uma excecao na propria tela: a lista e o fio conferem o que houve.
      .catch(() => {
        recarregar();
        recarregarFio(agendada);
      })
      .finally(() => setOcupado(null));
  };

  const dispensar = (agendada: AgendadaDaLista) => {
    setOcupado(agendada.id);
    dispensarAgendadaAction({ id: agendada.id })
      .then((resultado) => {
        if (!resultado.ok) {
          toast.error(resultado.error);
          recarregar();
          return;
        }
        marcarFoco(agendada.id);
        tirarDaLista(agendada.id);
        focarAlvo();
      })
      .catch(() => {
        toast.error("Não foi possível falar com o servidor. Tente de novo.");
      })
      .finally(() => setOcupado(null));
  };

  const verNaConversa = (agendada: AgendadaDaLista) => {
    const alvo = agendada.messageId
      ? document.getElementById(`mensagem-${agendada.messageId}`)
      : null;
    if (alvo) {
      alvo.scrollIntoView({ behavior: "smooth", block: "center" });
      const bolha = alvo.querySelector<HTMLElement>("[data-bolha]") ?? alvo;
      const realce = [
        "outline-2",
        "outline-offset-4",
        "outline-solid",
        "outline-focus",
      ];
      bolha.classList.add(...realce);
      window.setTimeout(() => bolha.classList.remove(...realce), 1400);
      return;
    }
    if (agendada.conversationId && agendada.conversationId !== conversa.id) {
      aoIrParaConversa(agendada.conversationId);
      return;
    }
    toast.info(
      "A mensagem está mais acima na conversa. Use Carregar mensagens anteriores.",
    );
  };

  const regiaoViva = (
    <span role="status" className="sr-only">
      {textoDoAnuncio(anuncio)}
    </span>
  );

  // As confirmacoes ficam montadas com a lista: excluir o ultimo item tira a
  // secao da tela, mas o dialogo ainda precisa fechar e devolver o foco.
  const confirmando = confirmacao?.agendada ?? null;
  const numeroDaConfirmacao =
    confirmando && mostrarNumero && contexto
      ? (contexto.conexaoPorNumero[confirmando.whatsappAccountId]?.nome ?? null)
      : null;
  const confirmacoes = (
    <>
      <ConfirmacaoDeExcluir
        aberto={confirmacao?.tipo === "excluir"}
        aoFechar={fecharConfirmacao}
        pendente={ocupado !== null && ocupado === confirmando?.id}
        erro={erroDaConfirmacao}
        aoConfirmar={() => {
          if (confirmando) {
            excluir(confirmando);
          }
        }}
        aoFecharFoco={focarAlvo}
        contato={conversa.contato}
      />
      <ConfirmacaoDeEnviarAgora
        aberto={confirmacao?.tipo === "enviar_agora"}
        aoFechar={fecharConfirmacao}
        pendente={ocupado !== null && ocupado === confirmando?.id}
        erro={erroDaConfirmacao}
        aoConfirmar={() => {
          if (confirmando) {
            enviarAgora(confirmando);
          }
        }}
        aoFecharFoco={focarAlvo}
        contato={conversa.contato}
        quando={
          confirmando
            ? quandoEmTexto(confirmando.enviarEm, agora, timezone)
            : ""
        }
        numero={numeroDaConfirmacao}
      />
    </>
  );

  if (estado === "erro" && !dados) {
    return (
      <>
        {regiaoViva}
        <div className="px-4 pt-3">
          <Aviso
            tom="alert"
            className="py-2"
            acao={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={aoTentarDeNovo}
              >
                <RotateCcw aria-hidden />
                Tentar de novo
              </Button>
            }
          >
            Não foi possível carregar as mensagens agendadas.
          </Aviso>
        </div>
      </>
    );
  }

  if (!dados || !contexto) {
    return (
      <>
        {regiaoViva}
        {esqueleto ? (
          <div role="status" className="px-4 pt-3">
            <span className="sr-only">Carregando as mensagens agendadas</span>
            <Skeleton aria-hidden className="h-10 w-full rounded-xl" />
          </div>
        ) : null}
      </>
    );
  }

  if (visiveis.length === 0) {
    return (
      <>
        {regiaoViva}
        {confirmacoes}
      </>
    );
  }

  const variosItens = visiveis.length > 1;
  const naTela =
    variosItens && !aberta
      ? visiveis.filter((item) =>
          ficaSempreAVista(item.estado, item.agendada, contexto),
        )
      : visiveis;
  const resumo = variosItens
    ? resumoDaLista(
        visiveis.map((item) => ({
          enviarEm: item.agendada.enviarEm,
          estado: item.estado,
        })),
        agora,
        timezone,
      )
    : null;

  const conversaComigo =
    conversa.status === "em_atendimento" &&
    conversa.assigneeUserId === viewerId;

  return (
    <>
      {regiaoViva}
      <section
        ref={secaoRef}
        aria-labelledby={idDoTitulo}
        className="grid gap-2 px-4 pt-3"
      >
        <div
          ref={tituloRef}
          tabIndex={-1}
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <h2
            id={idDoTitulo}
            className={cn(
              "text-[12px] font-semibold text-text-secondary",
              // Com o resumo, o titulo fica so para o leitor de tela: o
              // resumo ja diz "{n} mensagens agendadas".
              variosItens && "sr-only",
            )}
          >
            Mensagens agendadas
          </h2>
          {resumo ? (
            <p className="min-w-0 flex-1 text-[12.5px] text-text-strong">
              {resumo}
            </p>
          ) : null}
          {variosItens ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={aberta}
              aria-controls={idDaLista}
              onClick={() => setAberta((atual) => !atual)}
              className="text-text-secondary"
            >
              {aberta ? "Ocultar" : "Ver todas"}
            </Button>
          ) : null}
        </div>

        {naTela.length > 0 ? (
          <ul
            id={idDaLista}
            // Teto de 40% da altura e rolagem propria SEMPRE: fechada, com 1
            // item ou aberta, a lista nao espreme o fio. O respiro de 4px
            // (p-1 com -m-1) deixa o contorno de foco do item inteiro.
            className="-m-1 grid cz-scroll max-h-[40svh] gap-2 overflow-y-auto overscroll-contain p-1"
          >
            {naTela.map(({ agendada, estado: estadoDoItem }) => (
              <ItemDeAgendada
                key={agendada.id}
                agendada={agendada}
                estado={estadoDoItem}
                acoes={acoesDoItem(agendada, {
                  viewerId,
                  podeEscrever,
                  conversaComigo,
                  statusDaConversa: conversa.status,
                  nomeDoResponsavel: conversa.assigneeUserId
                    ? (nomes[conversa.assigneeUserId] ?? null)
                    : null,
                  estado: estadoDoItem,
                  numeroDaConversa: conversa.whatsappAccountId,
                  nomeDoNumeroDaAgendada:
                    contexto.conexaoPorNumero[agendada.whatsappAccountId]
                      ?.nome ?? null,
                  conexaoPorNumero: contexto.conexaoPorNumero,
                })}
                contexto={contexto}
                agora={agora}
                timezone={timezone}
                viewerId={viewerId}
                nomes={nomes}
                contato={conversa.contato}
                mostrarNumero={mostrarNumero}
                ocupado={ocupado === agendada.id}
                aoEditar={() => aoEditar(agendada)}
                aoExcluir={() => {
                  setErroDaConfirmacao(null);
                  setConfirmacao({ tipo: "excluir", agendada });
                }}
                aoEnviarAgora={() => {
                  setErroDaConfirmacao(null);
                  setConfirmacao({ tipo: "enviar_agora", agendada });
                }}
                aoAgendarDeNovo={() => aoAgendarDeNovo(agendada)}
                aoDispensar={() => dispensar(agendada)}
                aoVerNaConversa={() => verNaConversa(agendada)}
              />
            ))}
          </ul>
        ) : (
          // Fechada e sem item que peca atencao: a lista existe (o botao
          // Ver todas a controla), so sem itens a mostra.
          <ul id={idDaLista} className="hidden" />
        )}
      </section>
      {confirmacoes}
    </>
  );
}
