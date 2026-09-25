"use client";

import {
  FlaskConical,
  Lightbulb,
  MessageCircle,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  pollWhatsAppStatusAction,
  type ConnectState,
} from "@/lib/actions/whatsapp-connect";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";

import { dataNoFusoDaClinica, telefoneFormatado } from "./numeros";

// Painel de conexao de UM numero da clinica. Vive em dois lugares: o
// onboarding de primeiro acesso (/whatsapp), como cartao do principal, e o
// dialogo "Conectar" de cada cartao da aba de WhatsApp das Configuracoes
// (lista-de-numeros.tsx), sem moldura. Nao carrega largura nem texto de
// onboarding: a tela de fora e que decide o enquadramento. O TooltipProvider
// e local porque o onboarding roda fora do shell e a dica de acao
// desabilitada precisa dele.
//
// Desenho do design system (docs/06 secao 5.12): cartao unico com o ladrilho
// do WhatsApp (decorativo), a situacao da conexao em StatusChip (icone,
// rotulo e cor, de WHATSAPP_CONNECTION_STATUS) e os avisos no Banner do DS.
//
// Um painel e UM numero (docs/07): toda acao leva o id dele.

const DICA_PADRAO = "Somente administradores e gestores conectam o WhatsApp";

// A saudacao e a ausencia do WhatsApp Business saem do celular pareado, e o
// sistema as recebe como resposta da clinica: a conversa de quem escreveu
// fora do horario sai da fila "Aguardando você" um segundo depois.
const ORIENTACAO_BUSINESS =
  "Se o número usa o WhatsApp Business, desligue a mensagem de saudação e a mensagem de ausência no aplicativo. O sistema já atende os pacientes, e essas respostas automáticas tiram as conversas da fila Aguardando você.";

/**
 * A consulta de status nao sabe do aviso da conexao (ele nasce so no clique
 * de conectar). Sem esta juncao, o aviso de que as respostas dos pacientes
 * nao vao chegar sumia na primeira consulta, 2,5 segundos depois.
 */
function comAvisoMantido(
  atual: ConnectState,
  proximo: ConnectState,
): ConnectState {
  const aviso = proximo.aviso ?? atual.aviso;
  return aviso ? { ...proximo, aviso } : proximo;
}

/**
 * Numero para exibir: o provedor guarda so digitos ("5584..."); a tela mostra
 * como a recepcao discaria. Texto que nao e telefone volta como esta.
 */
function telefoneParaExibir(bruto: string): string {
  return telefoneFormatado(bruto) ?? bruto;
}

// Ladrilho de identidade do canal. A cor do WhatsApp e decorativa: o estado
// da conexao e dito pelo StatusChip, nunca por ela.
export function IdentidadeDoWhatsapp() {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-md bg-whatsapp/12"
    >
      <MessageCircle className="size-5 text-whatsapp" />
    </span>
  );
}

/** Orientacao do WhatsApp Business (saudacao e ausencia), para todo numero. */
export function OrientacaoDoWhatsappBusiness() {
  return (
    <Aviso tom="neutral" icone={Lightbulb} role="note">
      {ORIENTACAO_BUSINESS}
    </Aviso>
  );
}

// D1 do docs/07: o nome com que o numero nasce. Com esse nome o cartao nao
// repete o nome; renomeado, o cartao diz qual numero e.
const NOME_PADRAO = "Número principal";

export type ConnectClientProps = {
  /**
   * O numero deste cartao (whatsapp_account.id). Nulo: a clinica ainda nao
   * tem numero, e Conectar cria o principal (o id volta na resposta).
   */
  accountId: string | null;
  /** Nome do numero, quando ele ja existe */
  nome?: string | null;
  initial: ConnectState;
  connectedAt: string | null;
  canManage: boolean;
  /** dica da acao desabilitada; cai no texto padrao quando vem nula */
  hint?: string | null;
  /**
   * Provedor da conta, ou o do ambiente quando a conta ainda nao existe.
   * Nulo: producao sem provedor real configurado (a conexao e recusada).
   */
  providerName: string | null;
  /** Fuso da clinica, para a data "desde" */
  timezone: string;
  /**
   * "cartao" (padrao): o cartao com titulo, do onboarding. "dialogo": sem
   * moldura e sem titulo, dentro do dialogo de conexao das Configuracoes, que
   * ja diz qual numero e; ali o Desconectar fica no cartao do numero.
   */
  moldura?: "cartao" | "dialogo";
  /**
   * Comeca o pareamento ao abrir: o clique que abriu o dialogo ("Conectar",
   * "Criar e conectar") ja foi o pedido de conexao.
   */
  conectarAoAbrir?: boolean;
  /** Avisa quem abriu o painel quando a situacao da conexao muda. */
  aoMudarDeSituacao?: (situacao: ConnectState["status"]) => void;
};

export function ConnectClient({
  accountId,
  nome,
  initial,
  connectedAt,
  canManage,
  hint,
  providerName,
  timezone,
  moldura = "cartao",
  conectarAoAbrir = false,
  aoMudarDeSituacao,
}: ConnectClientProps) {
  const [state, setState] = useState<ConnectState>(initial);
  // O id pode chegar depois: a clinica sem numero ganha o principal no
  // primeiro Conectar, e toda chamada seguinte vai para ele.
  const [numeroId, setNumeroId] = useState<string | null>(accountId);
  const [pending, startTransition] = useTransition();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conexaoAoAbrirPedida = useRef(false);
  const situacaoAvisada = useRef(initial.status);

  const lembrarNumero = (proximo: ConnectState) => {
    if (proximo.accountId) {
      setNumeroId(proximo.accountId);
    }
  };

  // Quem abriu o painel (o dialogo das Configuracoes) recarrega a lista de
  // numeros quando a situacao muda: o poll do pareamento nao revalida a
  // pagina, entao o cartao atras do dialogo ficaria com a situacao antiga.
  useEffect(() => {
    if (state.status === situacaoAvisada.current) {
      return;
    }
    situacaoAvisada.current = state.status;
    aoMudarDeSituacao?.(state.status);
  }, [state.status, aoMudarDeSituacao]);

  // Enquanto o pareamento esta em andamento, consulta o status a cada 2,5s.
  useEffect(() => {
    const shouldPoll =
      state.status === "aguardando_qr" || state.status === "conectando";
    if (shouldPoll && pollingRef.current === null) {
      pollingRef.current = setInterval(() => {
        startTransition(async () => {
          const next = await pollWhatsAppStatusAction(numeroId);
          if (next.accountId) {
            setNumeroId(next.accountId);
          }
          setState((current) =>
            current.status === "conectado"
              ? current
              : comAvisoMantido(current, next),
          );
        });
      }, 2500);
    }
    if (!shouldPoll && pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [state.status, numeroId]);

  const connect = useCallback(() => {
    startTransition(async () => {
      const proximo = await connectWhatsAppAction(numeroId);
      if (proximo.accountId) {
        setNumeroId(proximo.accountId);
      }
      setState(proximo);
    });
  }, [numeroId]);

  // Uma vez so, mesmo com o efeito repetido do modo estrito: dois pedidos
  // seguidos ao provedor recusam o segundo ("fluxo em andamento").
  useEffect(() => {
    if (!conectarAoAbrir || conexaoAoAbrirPedida.current) {
      return;
    }
    conexaoAoAbrirPedida.current = true;
    connect();
  }, [conectarAoAbrir, connect]);
  const disconnect = () => {
    if (!numeroId) {
      return;
    }
    startTransition(async () => {
      const proximo = await disconnectWhatsAppAction(numeroId);
      lembrarNumero(proximo);
      setState(proximo);
    });
  };

  const dica = hint ?? DICA_PADRAO;
  const demonstracao = providerName === "fake";
  const canalNaoConfigurado = providerName === null;
  const desde = connectedAt ? dataNoFusoDaClinica(connectedAt, timezone) : null;

  const connectButton = (
    <Button onClick={connect} disabled={!canManage || pending}>
      <Plug className="size-4" />
      {pending ? "Conectando..." : "Conectar WhatsApp"}
    </Button>
  );

  const verificarAgora = () => {
    startTransition(async () => {
      const proximo = await pollWhatsAppStatusAction(numeroId);
      lembrarNumero(proximo);
      setState((atual) =>
        atual.status === "conectado" ? atual : comAvisoMantido(atual, proximo),
      );
    });
  };

  const verifyButton = (
    <Button
      variant="outline"
      onClick={verificarAgora}
      disabled={pending || !canManage}
    >
      <RefreshCw className="size-4" />
      {pending ? "Verificando..." : "Verificar agora"}
    </Button>
  );

  const disconnectButton = (
    <Button
      variant="destructive"
      onClick={disconnect}
      disabled={!canManage || pending || !numeroId}
    >
      <Unplug className="size-4" />
      Desconectar
    </Button>
  );

  const avisoDoCanal = canalNaoConfigurado ? (
    <Aviso tom="alert" role="alert">
      O canal de WhatsApp não está configurado no servidor, então o número não
      conecta agora. Fale com o suporte.
    </Aviso>
  ) : null;

  const noDialogo = moldura === "dialogo";

  // Rotulo e chip no MESMO elemento: o texto lido e "Situação atual:
  // Desconectado" (e2e do dialogo de conexao).
  const situacaoAtual = (
    <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
      Situação atual:{" "}
      <StatusChip definition={WHATSAPP_CONNECTION_STATUS[state.status]} />
    </p>
  );

  // "Número (84) 9... · desde dd/MM/yyyy": a mesma linha no cartao e no
  // dialogo.
  const linhaDoNumero = (
    <>
      {state.displayPhone ? (
        <>
          Número{" "}
          <span className="cz-num">
            {telefoneParaExibir(state.displayPhone)}
          </span>
        </>
      ) : (
        "Número conectado"
      )}
      {desde ? (
        <>
          {" "}
          · desde <span className="cz-num">{desde}</span>
        </>
      ) : null}
    </>
  );

  const avisosDoEstado = (
    <>
      {state.error ? (
        <Aviso tom="alert" role="alert">
          {state.error}
        </Aviso>
      ) : null}
      {state.aviso ? (
        <Aviso tom="warning" role="alert">
          {state.aviso}
        </Aviso>
      ) : null}
    </>
  );

  // O selo aparece tambem CONECTADO: e nesse estado que o simulador engana,
  // porque todo envio vira "enviada" sem sair nada para o paciente.
  const demonstracaoConectada = demonstracao ? (
    <Aviso tom="info" icone={FlaskConical}>
      Ambiente de demonstração: a conexão é simulada e nenhuma mensagem sai de
      verdade para o paciente.
    </Aviso>
  ) : null;

  if (state.status === "conectado" && noDialogo) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className="grid gap-3">
          {situacaoAtual}
          <p className="text-[13px] text-text-secondary">{linhaDoNumero}</p>
          {avisosDoEstado}
          {demonstracaoConectada}
          <OrientacaoDoWhatsappBusiness />
        </div>
      </TooltipProvider>
    );
  }

  if (state.status === "conectado") {
    return (
      <TooltipProvider delayDuration={200}>
        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <IdentidadeDoWhatsapp />
              <div className="grid min-w-0 gap-[3px]">
                <CardTitle>WhatsApp conectado</CardTitle>
                <CardDescription>
                  {nome && nome !== NOME_PADRAO ? <>{nome} · </> : null}
                  {linhaDoNumero}
                </CardDescription>
              </div>
            </div>
            <CardAction>
              <StatusChip definition={WHATSAPP_CONNECTION_STATUS.conectado} />
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3">
            {avisosDoEstado}
            {demonstracaoConectada}
            <OrientacaoDoWhatsappBusiness />
            <div className="pt-1">
              {canManage ? (
                disconnectButton
              ) : (
                <DisabledWithHint hint={dica}>
                  {disconnectButton}
                </DisabledWithHint>
              )}
            </div>
          </CardContent>
        </Card>
      </TooltipProvider>
    );
  }

  const pareamento = (
    <>
      {situacaoAtual}

      {state.qrCode ? (
        <div className="grid justify-items-center gap-3 rounded-xl bg-surface-4 p-5">
          {state.qrCode.startsWith("data:image") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.qrCode}
              alt="QR code para parear o WhatsApp"
              className="size-56 rounded-lg bg-(--qr-surface) p-3"
            />
          ) : (
            <p className="max-w-sm text-center cz-num text-xs break-all text-text-secondary">
              {state.qrCode}
            </p>
          )}
          <p className="text-center text-xs text-text-secondary">
            O QR expira em instantes; se falhar, conecte de novo.
          </p>
        </div>
      ) : null}

      {avisoDoCanal}
      {avisosDoEstado}
      {demonstracao ? (
        <Aviso tom="info" icone={FlaskConical}>
          Ambiente de demonstração: a conexão é simulada e conecta na hora, sem
          QR code.
        </Aviso>
      ) : null}

      <OrientacaoDoWhatsappBusiness />

      <div className="flex flex-wrap gap-2 pt-1">
        {canManage ? (
          connectButton
        ) : (
          <DisabledWithHint hint={dica}>{connectButton}</DisabledWithHint>
        )}
        {canManage ? (
          verifyButton
        ) : (
          <DisabledWithHint hint={dica}>{verifyButton}</DisabledWithHint>
        )}
      </div>
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      {noDialogo ? (
        <div className="grid gap-3">{pareamento}</div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <IdentidadeDoWhatsapp />
              <div className="grid min-w-0 gap-[3px]">
                <CardTitle>Conectar o número da clínica</CardTitle>
                <CardDescription>
                  O WhatsApp da clínica é pareado com a plataforma, como no
                  WhatsApp Web: clique em conectar e leia o QR code no celular
                  em Aparelhos conectados. Recomendamos um número WhatsApp
                  Business dedicado da clínica.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">{pareamento}</CardContent>
        </Card>
      )}
    </TooltipProvider>
  );
}
