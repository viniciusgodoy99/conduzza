"use client";

import { useEffect, useState } from "react";

import { MotorBanner } from "@/components/shell/motor-banner";
import { motorParado, type SaudeDoMotor } from "@/lib/domain/motor";
import { createClient } from "@/lib/supabase/client";

// Vigia do motor no CLIENTE. O layout da area logada e preservado em
// navegacao suave, entao a versao renderizada no servidor so mudaria em carga
// dura ou revalidate: um motor que morre com a aba aberta ficava invisivel
// ate alguem dar F5. Aqui a saude chega do servidor (primeiro paint certo
// mesmo com o motor ja parado) e o polling mantem a faixa honesta.
//
// Polling autocontido (setInterval + browser client), sem TanStack Query de
// proposito: o slot de banner do AppShell renderiza FORA do QueryProvider,
// que envolve so o conteudo da pagina.
//
// Motor parado tem precedencia sobre o fallback (faixa de WhatsApp): com ele
// fora do ar nem reconectar adianta. Duas faixas seriam ruido; a mais grave
// manda.

const INTERVALO_MS = 60_000;

export function MotorStatus({
  saudeInicial,
  timezone,
  fallback,
}: {
  saudeInicial: SaudeDoMotor | null;
  timezone: string;
  fallback: React.ReactNode;
}) {
  const [saude, setSaude] = useState(saudeInicial);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const supabase = createClient();
    let ativo = true;
    const consultar = async () => {
      const { data, error } = await supabase.rpc("saude_do_motor");
      if (!ativo) {
        return;
      }
      // O relogio avanca MESMO com a consulta falhando. Antes o erro dava
      // return antes de mexer no relogio, e a faixa congelava: com o banco
      // inalcancavel do navegador, a aba nunca mostrava o aviso, que e
      // justamente quando ele mais importa.
      setAgora(new Date());
      if (!error && data) {
        setSaude(data as SaudeDoMotor);
      }
    };
    const timer = setInterval(() => {
      void consultar();
    }, INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, []);

  if (motorParado(saude, agora)) {
    // Mostra a batida mais RECENTE das duas: e o instante em que o sistema
    // ainda dava sinal de vida, que e o que a clinica quer saber.
    const carimbos = [saude?.fila?.batida_em, saude?.planner?.batida_em]
      .filter((c): c is string => typeof c === "string")
      .sort();
    const desde = carimbos[carimbos.length - 1] ?? null;
    return (
      <MotorBanner
        desde={
          desde
            ? new Date(desde).toLocaleString("pt-BR", {
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
