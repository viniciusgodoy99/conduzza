import type { SupabaseClient } from "@supabase/supabase-js";

import { enviarEventosCapi } from "@/lib/integrations/meta/capi";
import { montarEventoDoCliqueDoLink } from "@/lib/integrations/meta/payload";
import { log } from "@/lib/log";

// O Contact do clique no link rastreado, pelo SERVIDOR (etapa 3e do plano de
// 16/11/2026). A rota do link chama isto DEPOIS de responder ao visitante
// (after), entao nada aqui atrasa a ida ao WhatsApp, e nenhuma falha daqui
// aparece para a pessoa: melhor esforco, com as novas tentativas e o prazo do
// proprio adaptador (lib/integrations/meta/capi.ts).
//
// O banco ja disse que a origem pediu o aviso e que a clinica tem o Pixel e
// o envio ligados; aqui tudo e conferido DE NOVO na hora do envio (a clinica
// pode ter desligado), e o token e lido so aqui, com a service role.
//
// PRIVACIDADE: o IP e o navegador do visitante vao a Meta e a mais nenhum
// lugar. Nao sao gravados nem escritos em log: o log leva so a clinica e o
// resultado.

export type CliqueParaAMeta = {
  clinicId: string;
  pixelId: string;
  /** O id do clique: o mesmo eventID que o Pixel usou no navegador. */
  eventId: string;
  cliqueEmMs: number;
  /** O endereco do link, sem a query. */
  eventSourceUrl: string;
  userAgent: string;
  ip: string | null;
  fbclid: string | null;
};

export async function enviarEventoDoCliqueDoLink(
  admin: SupabaseClient,
  clique: CliqueParaAMeta,
  fetchFn?: typeof fetch,
): Promise<void> {
  try {
    const [{ data: conta }, { data: segredo }] = await Promise.all([
      admin
        .from("meta_ads_account")
        .select("pixel_id, envio_ativado, test_event_code")
        .eq("clinic_id", clique.clinicId)
        .maybeSingle(),
      admin
        .from("meta_ads_account_secret")
        .select("capi_access_token")
        .eq("clinic_id", clique.clinicId)
        .maybeSingle(),
    ]);
    if (
      !conta?.envio_ativado ||
      conta.pixel_id !== clique.pixelId ||
      !segredo?.capi_access_token
    ) {
      log.info("evento_do_clique", {
        clinic_id: clique.clinicId,
        status: "sem_configuracao",
      });
      return;
    }
    const resultado = await enviarEventosCapi(
      {
        pixelId: clique.pixelId,
        accessToken: segredo.capi_access_token as string,
        testEventCode: (conta.test_event_code as string | null) ?? null,
        ...(fetchFn ? { fetchFn } : {}),
      },
      [
        montarEventoDoCliqueDoLink({
          eventId: clique.eventId,
          cliqueEmMs: clique.cliqueEmMs,
          eventSourceUrl: clique.eventSourceUrl,
          userAgent: clique.userAgent,
          ip: clique.ip,
          fbclid: clique.fbclid,
        }),
      ],
    );
    if (resultado.ok) {
      log.info("evento_do_clique", {
        clinic_id: clique.clinicId,
        status: "enviado",
      });
    } else {
      log.error("evento_do_clique_falhou", {
        clinic_id: clique.clinicId,
        error_code: resultado.errorCode,
      });
    }
  } catch (erro) {
    log.error("evento_do_clique_falhou", {
      clinic_id: clique.clinicId,
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
  }
}
