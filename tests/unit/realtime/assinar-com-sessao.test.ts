import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { assinarComSessao } from "@/lib/realtime/assinar-com-sessao";

// Canal de tempo real so entra depois de o token da sessao estar no cliente
// (defeito de 06/10/2026: o join saia sem token e a assinatura ficava
// anonima, sem receber evento nenhum, ate a renovacao do token).

function montar(setAuth: () => Promise<void>) {
  const ordem: string[] = [];
  const canal = {
    subscribe: vi.fn(() => {
      ordem.push("subscribe");
      return canal;
    }),
  } as unknown as RealtimeChannel;
  const supabase = {
    realtime: {
      setAuth: vi.fn(async () => {
        await setAuth();
        ordem.push("setAuth");
      }),
    },
    removeChannel: vi.fn(async () => {
      ordem.push("removeChannel");
      return "ok";
    }),
  } as unknown as SupabaseClient;
  return { canal, supabase, ordem };
}

const esperar = () => new Promise((resolver) => setTimeout(resolver, 0));

describe("assinarComSessao", () => {
  it("só entra no canal depois de o token da sessão ser gravado", async () => {
    let liberar: () => void = () => undefined;
    const token = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const { canal, supabase, ordem } = montar(() => token);
    const aoMudar = vi.fn();
    assinarComSessao(supabase, canal, aoMudar);
    await esperar();
    expect(canal.subscribe).not.toHaveBeenCalled();
    liberar();
    await esperar();
    expect(ordem).toEqual(["setAuth", "subscribe"]);
    expect(canal.subscribe).toHaveBeenCalledWith(aoMudar);
  });

  it("tela que fecha antes do token não entra no canal e desassina", async () => {
    let liberar: () => void = () => undefined;
    const token = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const { canal, supabase, ordem } = montar(() => token);
    const parar = assinarComSessao(supabase, canal);
    parar();
    liberar();
    await esperar();
    expect(canal.subscribe).not.toHaveBeenCalled();
    expect(ordem).toEqual(["removeChannel", "setAuth"]);
  });

  it("token ilegível não deixa a tela sem canal: entra como antes", async () => {
    const { canal, supabase } = montar(() =>
      Promise.reject(new Error("sem sessão")),
    );
    assinarComSessao(supabase, canal);
    await esperar();
    await esperar();
    expect(canal.subscribe).toHaveBeenCalledTimes(1);
  });
});
