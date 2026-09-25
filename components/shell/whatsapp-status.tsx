"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { toast } from "sonner";

import { checarConexaoAction } from "@/lib/actions/whatsapp-connect";
import {
  COLUNAS_DA_FAIXA,
  aplicarLinhaDoNumero,
  aplicarVerificacao,
  lerVerificacao,
  textoDaFaixa,
  type LinhaDoNumero,
  type NumeroDaFaixa,
} from "@/lib/domain/conexao-dos-numeros";
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
//
// VARIOS NUMEROS (docs/07, Fase 2): o estado e a LISTA de numeros ativos da
// clinica, e cada evento de Realtime atualiza a linha dele (pelo id), nunca
// "a clinica". A faixa considera o principal e os que ja conectaram alguma
// vez (D6), e o texto (lib/domain/conexao-dos-numeros.ts) e o de sempre
// quando a clinica tem um numero so.

const INTERVALO_MS = 60_000;

export function WhatsappStatus({
  clinicId,
  numerosIniciais,
}: {
  clinicId: string;
  /** Os numeros ATIVOS da clinica. Lista vazia: nenhuma faixa. */
  numerosIniciais: readonly NumeroDaFaixa[];
}) {
  const [numeros, setNumeros] = useState(numerosIniciais);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let ativo = true;
    const aplicar = (payload: { new: unknown }) => {
      const linha = payload.new as LinhaDoNumero | null;
      if (ativo && linha) {
        // Mesma lista de volta quando nada da faixa mudou (o UPDATE do slot
        // a cada envio): o React nao renderiza de novo.
        setNumeros((atuais) => aplicarLinhaDoNumero(atuais, linha));
      }
    };
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
        aplicar,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_account",
          filter: `clinic_id=eq.${clinicId}`,
        },
        aplicar,
      )
      .subscribe();
    const consultar = async () => {
      const { data, error } = await supabase
        .from("whatsapp_account")
        .select(COLUNAS_DA_FAIXA)
        .eq("clinic_id", clinicId)
        .is("removido_em", null)
        .order("principal", { ascending: false })
        .order("created_at", { ascending: true });
      if (ativo && !error) {
        setNumeros((data ?? []) as NumeroDaFaixa[]);
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
      .then((resultado: unknown) => {
        // A resposta e lida por lerVerificacao: a lista de numeros
        // verificados (Fase 2) ou o status unico de antes.
        const verificacao = lerVerificacao(resultado);
        if (verificacao.erro) {
          toast.error(verificacao.erro);
          return;
        }
        // Funcional: um evento de Realtime que chegou durante a verificacao
        // nao e desfeito. O aviso sai da lista que esta na tela.
        setNumeros((atuais) => aplicarVerificacao(atuais, verificacao));
        const proximos = aplicarVerificacao(numeros, verificacao);
        const aindaFora = textoDaFaixa(proximos);
        if (aindaFora) {
          toast.info(
            proximos.length <= 1
              ? "Ainda desconectado. Abra Configurações para reconectar."
              : `${aindaFora.titulo}. Abra Configurações para reconectar.`,
          );
        }
      })
      .catch(() => {
        toast.error("Não foi possível verificar agora. Tente de novo.");
      })
      .finally(() => setVerificando(false));
  };

  const faixa = textoDaFaixa(numeros);
  if (!faixa) {
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
        {faixa.titulo}: <span className="font-normal">{faixa.detalhe}</span>
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
