"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { toast } from "sonner";

import { checarConexaoAction } from "@/lib/actions/whatsapp-connect";
import { createClient } from "@/lib/supabase/client";

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

  // Estado 5 da secao 8 do brief: faixa vermelha fixa, com acao de
  // reconexao. As 3 camadas: forma (triangulo), rotulo em texto e cor.
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-sm font-medium [color:var(--on-alert)] [background:var(--alert)]"
    >
      <TriangleAlert strokeWidth={1.5} className="size-4 shrink-0" />
      <span>WhatsApp desconectado: os pacientes não estão sendo atendidos</span>
      <Link
        href="/configuracoes?aba=whatsapp"
        className="flex min-h-10 items-center rounded-md bg-black/15 px-3 text-xs font-semibold underline-offset-2 hover:underline"
      >
        Reconectar
      </Link>
      <button
        type="button"
        onClick={verificarAgora}
        disabled={verificando}
        className="flex min-h-10 items-center gap-1.5 rounded-md bg-black/15 px-3 text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-60"
      >
        <RefreshCw
          strokeWidth={1.5}
          className={`size-3.5 ${verificando ? "animate-spin" : ""}`}
          aria-hidden
        />
        {verificando ? "Verificando..." : "Verificar conexão"}
      </button>
    </div>
  );
}
