import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoFalso, eUpdate, type Resposta } from "./banco-falso";

// O job que devolve a conversao para a Meta (lib/jobs/conversao-meta.ts).
// Revisao de 17/11/2026: com "Enviar tambem conversoes sem identificador"
// desligado, o clique do anuncio de WhatsApp SEM a conta do WhatsApp Business
// nao identifica nada; o evento sairia so com o telefone, que e o envio que a
// clinica deixou desligado. Nada de rede: o adaptador da CAPI e trocado.

const enviar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/meta/capi", () => ({ enviarEventosCapi: enviar }));

import { executarEnvioDeConversao } from "@/lib/jobs/conversao-meta";
import type { Job } from "@/lib/jobs/worker";

const JOB = {
  id: "job-1",
  clinic_id: "clinica-1",
  kind: "enviar_conversao_meta",
  payload: { conversion_event_id: "evento-1" },
  attempts: 1,
  max_attempts: 5,
} as Job;

function banco(conta: { waba: string | null; semIdentificador: boolean }) {
  const ok = (data: unknown): Resposta => ({ data, error: null });
  return bancoFalso({
    tabelas: {
      conversion_event: (chamada) =>
        eUpdate(chamada)
          ? ok(null)
          : ok({
              id: "evento-1",
              clinic_id: "clinica-1",
              contact_id: "contato-1",
              stage_chave: "agendou",
              event_name: "Schedule",
              event_id: "9d3b2c1a-0000-4000-8000-000000000001",
              value_cents: null,
              currency: "BRL",
              ctwa_clid: null,
              status: "enfileirado",
              created_at: new Date().toISOString(),
            }),
      meta_ads_account: () =>
        ok({
          pixel_id: "123456789012345",
          envio_ativado: true,
          modo_user_data: "telefone_hasheado",
          send_unmatched: conta.semIdentificador,
          test_event_code: null,
          whatsapp_business_account_id: conta.waba,
        }),
      meta_ads_account_secret: () => ok({ capi_access_token: "token-de-teste" }),
      contact: () => ok({ phone_e164: "+5584999990000", ctwa_clid: "clique-do-anuncio" }),
      clique_do_site: () => ok(null),
    },
  });
}

describe("executarEnvioDeConversao: o que conta como identificador", () => {
  beforeEach(() => {
    enviar.mockReset();
    enviar.mockResolvedValue({ ok: true, eventsReceived: 1 });
  });

  it("clique do anúncio sem a conta do WhatsApp Business e sem o envio sem identificador: descarta, não manda só o telefone", async () => {
    const falso = banco({ waba: null, semIdentificador: false });
    const resultado = await executarEnvioDeConversao(falso.admin, JOB);
    expect(resultado).toEqual({ ok: true });
    expect(enviar).not.toHaveBeenCalled();
    expect(falso.updatesEm("conversion_event")).toEqual([
      { status: "descartado", erro: "sem_waba_id" },
    ]);
  });

  it("com a conta do WhatsApp Business, o clique identifica e o evento sai", async () => {
    const falso = banco({ waba: "109876543210987", semIdentificador: false });
    await executarEnvioDeConversao(falso.admin, JOB);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("com o envio sem identificador ligado, sai mesmo sem a conta do WhatsApp Business", async () => {
    const falso = banco({ waba: null, semIdentificador: true });
    await executarEnvioDeConversao(falso.admin, JOB);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
