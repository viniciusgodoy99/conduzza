"use client";

import { CircleCheck, Plug, QrCode, Unplug } from "lucide-react";
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
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  pollWhatsAppStatusAction,
  type ConnectState,
} from "./actions";

const STATUS_LABEL: Record<ConnectState["status"], string> = {
  desconectado: "Desconectado",
  aguardando_qr: "Aguardando leitura do QR code",
  conectando: "Conectando",
  conectado: "Conectado",
};

export function ConnectClient({
  initial,
  connectedAt,
  canManage,
  providerName,
}: {
  initial: ConnectState;
  connectedAt: string | null;
  canManage: boolean;
  providerName: string;
}) {
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
            current.status === "conectado" ? current : next,
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

  const connectButton = (
    <Button onClick={connect} disabled={!canManage || pending}>
      <Plug strokeWidth={1.5} className="size-4" />
      {pending ? "Conectando..." : "Conectar WhatsApp"}
    </Button>
  );

  return (
    <div className="grid gap-4">
      {state.status === "conectado" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck strokeWidth={1.5} className="size-5 text-success" />
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
          <CardContent>
            {canManage ? (
              <Button variant="outline" onClick={disconnect} disabled={pending}>
                <Unplug strokeWidth={1.5} className="size-4" />
                Desconectar
              </Button>
            ) : (
              <p className="text-sm text-text-secondary">
                Somente administradores alteram a conexão.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Conectar o número da clínica</CardTitle>
            <CardDescription>
              O WhatsApp da clínica é pareado com a plataforma, como no WhatsApp
              Web: clique em conectar e leia o QR code no celular em Aparelhos
              conectados. Recomendamos um número WhatsApp Business dedicado da
              clínica.
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

            {state.error ? (
              <p role="alert" className="text-alert-text text-sm">
                {state.error}
              </p>
            ) : null}

            <div>
              {canManage ? (
                connectButton
              ) : (
                <DisabledWithHint hint="Somente administradores conectam o WhatsApp">
                  {connectButton}
                </DisabledWithHint>
              )}
            </div>

            {providerName === "fake" ? (
              <p className="text-xs text-text-tertiary">
                Ambiente de demonstração: a conexão é simulada e conecta na
                hora, sem QR code.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
