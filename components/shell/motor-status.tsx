"use client";

import { useEffect, useState } from "react";

import { MotorBanner } from "@/components/shell/motor-banner";
import { motorParado } from "@/lib/domain/motor";
import { createClient } from "@/lib/supabase/client";

// Vigia do motor no CLIENTE. O layout da area logada e preservado em
// navegacao suave, entao a versao renderizada no servidor so mudava em carga
// dura ou revalidate: um motor que morre com a aba aberta ficava invisivel
// ate alguem dar F5. Aqui a ultima batida chega do servidor (primeiro paint
// certo mesmo com o motor ja parado) e o polling mantem a faixa honesta.
//
// Polling autocontido (setInterval + browser client), sem TanStack Query de
// proposito: o slot de banner do AppShell renderiza FORA do QueryProvider,
// que envolve so o conteudo da pagina. A policy "logado le a saude do motor"
// permite a leitura por qualquer usuario logado.
//
// Motor parado tem precedencia sobre o fallback (faixa de WhatsApp): com ele
// fora do ar nem reconectar adianta. Duas faixas seriam ruido; a mais grave
// manda.

const INTERVALO_MS = 60_000;

export function MotorStatus({
  ultimaBatidaInicial,
  timezone,
  fallback,
}: {
  ultimaBatidaInicial: string | null;
  timezone: string;
  fallback: React.ReactNode;
}) {
  const [ultimaBatida, setUltimaBatida] = useState(ultimaBatidaInicial);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const supabase = createClient();
    let ativo = true;
    const consultar = async () => {
      const { data, error } = await supabase
        .from("worker_heartbeat")
        .select("batida_em")
        .order("batida_em", { ascending: false })
        .limit(1);
      // Erro de rede nao muda o que sabemos: melhor manter o ultimo estado
      // do que piscar a faixa por uma oscilacao de conexao.
      if (!ativo || error) {
        return;
      }
      setUltimaBatida((data?.[0]?.batida_em as string | undefined) ?? null);
      setAgora(new Date());
    };
    const timer = setInterval(() => {
      void consultar();
    }, INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, []);

  if (motorParado(ultimaBatida, agora)) {
    return (
      <MotorBanner
        desde={
          ultimaBatida
            ? new Date(ultimaBatida).toLocaleString("pt-BR", {
                timeZone: timezone,
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : null
        }
      />
    );
  }
  return <>{fallback}</>;
}
