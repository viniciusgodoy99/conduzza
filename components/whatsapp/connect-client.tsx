"use client";

import {
  CircleCheck,
  FlaskConical,
  Info,
  Plug,
  QrCode,
  RefreshCw,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
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

// Painel de conexao do numero da clinica. Vive em dois lugares: o onboarding
// de primeiro acesso (/whatsapp) e a aba de WhatsApp das Configuracoes, entao
// nao carrega largura, moldura nem texto de onboarding: a tela de fora e que
// decide o enquadramento. O TooltipProvider e local porque o onboarding roda
// fora do shell e a dica de acao desabilitada precisa dele.

const STATUS_LABEL: Record<ConnectState["status"], string> = {
  desconectado: "Desconectado",
  aguardando_qr: "Aguardando leitura do QR code",
  conectando: "Conectando",
  conectado: "Conectado",
};

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

function Aviso({ texto }: { texto: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 text-sm [color:var(--warning-text)]"
    >
      <TriangleAlert strokeWidth={1.5} className="mt-0.5 size-4 shrink-0" />
      {texto}
    </p>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <p role="alert" className="text-alert-text text-sm">
      {texto}
    </p>
  );
}

function Orientacao() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-text-secondary">
      <Info strokeWidth={1.5} className="mt-px size-3.5 shrink-0" />
      {ORIENTACAO_BUSINESS}
    </p>
  );
}

export type ConnectClientProps = {
  initial: ConnectState;
  connectedAt: string | null;
  canManage: boolean;
  /** dica da acao desabilitada; cai no texto padrao quando vem nula */
  hint?: string | null;
  providerName: string;
};

export function ConnectClient({
  initial,
  connectedAt,
  canManage,
  hint,
  providerName,
}: ConnectClientProps) {
  const [state, setState] = useState<ConnectState>(initial);
  const [pending, startTransition] = useTransition();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enquanto o pareamento esta em andamento, consulta o status a cada 2,5s.
  useEffect(() => {
    const shouldPoll =
      state.status === "aguardando_qr" || state.status === "conectando";
    if (shouldPoll && pollingRef.current === null) {
      pollingRef.current = setInterval(() => {
        startTransition(async () => {
          const next = await pollWhatsAppStatusAction();
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
  }, [state.status]);

  const connect = () => {
    startTransition(async () => {
      setState(await connectWhatsAppAction());
    });
  };
  const disconnect = () => {
    startTransition(async () => {
      setState(await disconnectWhatsAppAction());
    });
  };

  const dica = hint ?? DICA_PADRAO;
  const demonstracao = providerName === "fake";

  const connectButton = (
    <Button onClick={connect} disabled={!canManage || pending}>
      <Plug strokeWidth={1.5} className="size-4" />
      {pending ? "Conectando..." : "Conectar WhatsApp"}
    </Button>
  );

  const verificarAgora = () => {
    startTransition(async () => {
      const proximo = await pollWhatsAppStatusAction();
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
      <RefreshCw strokeWidth={1.5} className="size-4" />
      {pending ? "Verificando..." : "Verificar agora"}
    </Button>
  );

  const disconnectButton = (
    <Button
      variant="outline"
      onClick={disconnect}
      disabled={!canManage || pending}
    >
      <Unplug strokeWidth={1.5} className="size-4" />
      Desconectar
    </Button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-4">
        {state.status === "conectado" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleCheck
                  strokeWidth={1.5}
                  className="size-5 text-success"
                />
                WhatsApp conectado
              </CardTitle>
              <CardDescription>
                {state.displayPhone
                  ? `Número ${state.displayPhone}`
                  : "Número conectado"}
                {connectedAt
                  ? ` · desde ${new Date(connectedAt).toLocaleDateString("pt-BR")}`
                  : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {state.aviso ? <Aviso texto={state.aviso} /> : null}
              {state.error ? <Erro texto={state.error} /> : null}
              {demonstracao ? (
                // O selo aparece tambem CONECTADO: e nesse estado que o
                // simulador engana, porque todo envio vira "enviada" sem sair
                // nada para o paciente.
                <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <FlaskConical
                    strokeWidth={1.5}
                    className="size-3.5 shrink-0"
                  />
                  Ambiente de demonstração: a conexão é simulada e nenhuma
                  mensagem sai de verdade para o paciente.
                </p>
              ) : null}
              <Orientacao />
              <div>
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
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Conectar o número da clínica</CardTitle>
              <CardDescription>
                O WhatsApp da clínica é pareado com a plataforma, como no
                WhatsApp Web: clique em conectar e leia o QR code no celular em
                Aparelhos conectados. Recomendamos um número WhatsApp Business
                dedicado da clínica.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm text-text-secondary">
                Situação atual: {STATUS_LABEL[state.status]}
              </p>

              {state.qrCode ? (
                <div className="grid justify-items-center gap-2 rounded-lg border bg-card p-6">
                  {state.qrCode.startsWith("data:image") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={state.qrCode}
                      alt="QR code para parear o WhatsApp"
                      className="size-56"
                    />
                  ) : (
                    <p className="max-w-sm text-center font-mono text-xs break-all text-text-secondary">
                      {state.qrCode}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <QrCode strokeWidth={1.5} className="size-3.5" />O QR expira
                    em instantes; se falhar, conecte de novo
                  </p>
                </div>
              ) : null}

              {state.error ? <Erro texto={state.error} /> : null}
              {state.aviso ? <Aviso texto={state.aviso} /> : null}

              <Orientacao />

              <div className="flex flex-wrap gap-2">
                {canManage ? (
                  connectButton
                ) : (
                  <DisabledWithHint hint={dica}>
                    {connectButton}
                  </DisabledWithHint>
                )}
                {canManage ? (
                  verifyButton
                ) : (
                  <DisabledWithHint hint={dica}>{verifyButton}</DisabledWithHint>
                )}
              </div>

              {demonstracao ? (
                <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <FlaskConical
                    strokeWidth={1.5}
                    className="size-3.5 shrink-0"
                  />
                  Ambiente de demonstração: a conexão é simulada e conecta na
                  hora, sem QR code.
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
