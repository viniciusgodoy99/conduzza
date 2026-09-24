"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { toast } from "sonner";

import { checarConexaoAction } from "@/lib/actions/whatsapp-connect";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Vigia da CONEXAO do WhatsApp no cliente, irmao do MotorStatus e pelo mesmo
// motivo: o layout e preservado em navegacao suave, entao a faixa renderizada
// no servidor congelava, e reconectar o celular exigia F5 para ela sumir
// (bug relatado pelo dono em 19/09/2026). A faixa aparecer sozinha em
// qualquer tela E o aviso de desconexao escolhido ("so dentro do sistema").
//
// Duas fontes de verdade em camadas: o Realtime de whatsapp_account (a
// tabela e publicada e todo membro tem SELECT) atualiza na hora, e um
// polling de reserva de 60s LE O BANCO pelo browser client, nunca o
// provedor, cobrindo canal de Realtime que caiu. O botao "Verificar
// conexao" e o unico caminho que consulta o provedor, por action de MEMBRO
// que devolve so o status (sem QR, sem segredo).

const INTERVALO_MS = 60_000;

export function WhatsappStatus({
  clinicId,
  statusInicial,
}: {
  clinicId: string;
  /** null = clinica sem conta de WhatsApp: nenhuma faixa. */
  statusInicial: string | null;
}) {
  const [status, setStatus] = useState(statusInicial);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let ativo = true;
    const canal = supabase
      .channel(`whatsapp-status-${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "whatsapp_account",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const novo = (payload.new as { connection_status?: string })
            .connection_status;
          if (ativo && novo) {
            setStatus(novo);
          }
        },
      )
      .subscribe();
    const consultar = async () => {
      const { data, error } = await supabase
        .from("whatsapp_account")
        .select("connection_status")
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (ativo && !error) {
        setStatus(data?.connection_status ?? null);
      }
    };
    const timer = setInterval(() => {
      void consultar();
    }, INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, [clinicId]);

  const verificarAgora = () => {
    setVerificando(true);
    void checarConexaoAction()
      .then((resultado) => {
        if (resultado.error) {
          toast.error(resultado.error);
          return;
        }
        setStatus(resultado.status);
        if (resultado.status !== "conectado") {
          toast.info("Ainda desconectado. Abra Configurações para reconectar.");
        }
      })
      .catch(() => {
        toast.error("Não foi possível verificar agora. Tente de novo.");
      })
      .finally(() => setVerificando(false));
  };

  if (status === null || status === "conectado") {
    return null;
  }

  // Estado 5 da secao 8 do brief: faixa fixa no topo de todas as telas, com
  // acao de reconexao, na linguagem do DS (conflito C22): fundo de alerta
  // suave, texto de alerta e fio vermelho embaixo. As 3 camadas: forma
  // (WifiOff, reservado para esta faixa), rotulo em texto e cor.
  return (
    <div
      role="alert"
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-alert bg-alert-bg px-4 py-2 text-alert-text md:px-6"
    >
      <WifiOff aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[13.5px] font-semibold">
        WhatsApp desconectado:{" "}
        <span className="font-normal">
          os pacientes não estão sendo atendidos
        </span>
      </p>
      <Link
        href="/configuracoes?aba=whatsapp"
        className="inline-flex h-10 items-center rounded-lg bg-inverse px-3.5 text-[13px] font-semibold text-inverse-foreground shadow-xs cz-transition hover:bg-inverse-hover"
      >
        Reconectar
      </Link>
      <button
        type="button"
        onClick={verificarAgora}
        disabled={verificando}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-alert-text cz-transition hover:bg-alert-bg-hover disabled:cursor-not-allowed disabled:opacity-45"
      >
        <RefreshCw
          aria-hidden
          className={cn(
            "size-3.5",
            verificando && "animate-spin motion-reduce:animate-none",
          )}
        />
        {verificando ? "Verificando..." : "Verificar conexão"}
      </button>
    </div>
  );
}
