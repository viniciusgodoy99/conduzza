import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";

// Resposta automatica do app WhatsApp Business que correu NA FRENTE da
// ingestao (frente "Pelo WhatsApp", 05/10/2026). O eco da ausencia sai do
// celular 1 ou 2 s depois da mensagem do paciente; se ele grava primeiro,
// registrar_mensagem_do_celular o grava como fala de pessoa, e o
// interceptador (que a rota chama logo depois da ingestao) calaria a
// confirmacao do toque. A ingestao chama reclassificar_resposta_automatica
// para cada mensagem do paciente que acabou de gravar. O que se prova aqui,
// com o rpc do banco dublado:
//   - chama so quando inseriu (nunca na reentrega, na ignorada nem com erro
//     da ingestao), logo depois da insercao e antes dos outros passos;
//   - leva o horario de envio do payload (p_enviada_em), que o banco grava
//     na linha do paciente e usa para separar a resposta automatica da fala
//     de pessoa; null quando nao veio;
//   - erro ou excecao da correcao nunca derruba a ingestao, e o log leva so
//     ids e codigo.
// A regra em si (janelas de chegada e de envio, so pelo_celular de pessoa,
// previa) vive no banco:
// supabase/migrations/20261005120000_mensagem_pelo_celular.sql, secao 4.

const { mover } = vi.hoisted(() => ({ mover: vi.fn() }));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: mover,
}));

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;
type Resultado = { data: unknown; error: { code: string } | null };

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "33333333-3333-4333-8333-333333333333";
const CONVERSA = "44444444-4444-4444-8444-444444444444";
const MENSAGEM = "55555555-5555-4555-8555-555555555555";

let ingestao: Resultado;
let correcao: Resultado | Error;
/** Ordem de tudo o que a ingestao fez: o nome da RPC, ou "termo". */
let ordem: string[] = [];
let chamadas: { nome: string; args: Record<string, unknown> }[] = [];
let linhasDeLog: string[] = [];

function cliente(): SupabaseClient {
  return {
    // Nenhuma tabela e lida nestes casos (sem anuncio, contato antigo, sem
    // token): uma leitura aqui e regressao.
    from: () => {
      throw new Error("leitura de tabela inesperada");
    },
    rpc: async (
      nome: string,
      args: Record<string, unknown>,
    ): Promise<Resultado> => {
      ordem.push(nome);
      chamadas.push({ nome, args });
      if (nome === "ingest_inbound_message") {
        return ingestao;
      }
      if (nome === "reclassificar_resposta_automatica") {
        if (correcao instanceof Error) {
          throw correcao;
        }
        return correcao;
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

function inserida(extra: Record<string, unknown> = {}): Resultado {
  return {
    data: {
      inserted: true,
      contact_id: "contato-1",
      contact_created: false,
      conversation_id: CONVERSA,
      message_id: MENSAGEM,
      whatsapp_account_id: NUMERO,
      ...extra,
    },
    error: null,
  };
}

function recebida(extra: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    kind: "message_received",
    phone: "+5584970000001",
    name: "Dona Rita",
    waMessageId: "wa-pac-1",
    contentType: "texto",
    body: "Confirmar",
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    anuncio: null,
    instanceToken: null,
    ...extra,
  };
}

function chamadasDaCorrecao(): Record<string, unknown>[] {
  return chamadas
    .filter((c) => c.nome === "reclassificar_resposta_automatica")
    .map((c) => c.args);
}

function eventosDeLog(): Record<string, unknown>[] {
  return linhasDeLog.map(
    (linha) => JSON.parse(linha) as Record<string, unknown>,
  );
}

async function ingerir(evento: MensagemRecebida = recebida()) {
  return ingerirMensagemRecebida(cliente(), CLINICA, NUMERO, evento);
}

beforeEach(() => {
  ingestao = inserida();
  correcao = { data: 0, error: null };
  ordem = [];
  chamadas = [];
  linhasDeLog = [];
  mover.mockReset();
  mover.mockImplementation(async () => {
    ordem.push("termo");
  });
  const capturar = (pedaco: string | Uint8Array): boolean => {
    linhasDeLog.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ingestão: resposta automática que correu na frente", () => {
  it("mensagem inserida: corrige logo depois da inserção, antes da citação e do termo", async () => {
    const { data, error } = await ingerir(
      recebida({ quotedWaMessageId: "WA-TOQUE" }),
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({ inserted: true, message_id: MENSAGEM });
    expect(chamadasDaCorrecao()).toEqual([
      { p_clinic_id: CLINICA, p_message_id: MENSAGEM, p_enviada_em: null },
    ]);
    expect(ordem).toEqual([
      "ingest_inbound_message",
      "reclassificar_resposta_automatica",
      "vincular_citacao_recebida",
      "termo",
    ]);
  });

  it("repassa o horário de envio do payload (p_enviada_em)", async () => {
    await ingerir(recebida({ enviadaEm: "2026-10-05T12:00:00.000Z" }));
    expect(chamadasDaCorrecao()).toEqual([
      {
        p_clinic_id: CLINICA,
        p_message_id: MENSAGEM,
        p_enviada_em: "2026-10-05T12:00:00.000Z",
      },
    ]);
  });

  it.each([
    ["null", null],
    ["ausente (evento montado sem o campo)", undefined],
  ])(
    "horário de envio %s vai como null: o banco fica com a regra da chegada",
    async (_nome, enviadaEm) => {
      const evento = recebida();
      if (enviadaEm === undefined) {
        delete evento.enviadaEm;
      } else {
        evento.enviadaEm = enviadaEm;
      }
      await ingerir(evento);
      expect(chamadasDaCorrecao()).toEqual([
        { p_clinic_id: CLINICA, p_message_id: MENSAGEM, p_enviada_em: null },
      ]);
    },
  );

  it("mensagem sem texto (áudio, foto) também corrige: a ausência responde qualquer mensagem", async () => {
    await ingerir(recebida({ contentType: "audio", body: null }));
    expect(chamadasDaCorrecao()).toHaveLength(1);
  });

  it("reentrega (inserted=false) não corrige de novo", async () => {
    ingestao = inserida({ inserted: false });
    await ingerir();
    expect(chamadasDaCorrecao()).toHaveLength(0);
  });

  it("inserida sem id de mensagem (fora do contrato) não chama", async () => {
    ingestao = inserida({ message_id: null });
    await ingerir();
    expect(chamadasDaCorrecao()).toHaveLength(0);
  });

  it.each(["numero_proprio", "numero_removido"])(
    "ignorada (%s) não corrige",
    async (motivo) => {
      ingestao = {
        data: {
          inserted: false,
          ignorada: motivo,
          contact_id: null,
          contact_created: false,
          conversation_id: null,
          message_id: null,
          whatsapp_account_id: NUMERO,
        },
        error: null,
      };
      const { data, error } = await ingerir();
      expect(error).toBeNull();
      expect(data?.ignorada).toBe(motivo);
      expect(chamadasDaCorrecao()).toHaveLength(0);
    },
  );

  it("erro da ingestão: devolve o erro e não corrige", async () => {
    ingestao = { data: null, error: { code: "XX000" } };
    const { data, error } = await ingerir();
    expect(data).toBeNull();
    expect(error).toEqual({ code: "XX000" });
    expect(chamadasDaCorrecao()).toHaveLength(0);
  });

  it("erro da correção não derruba a ingestão, e o log leva só ids e código", async () => {
    correcao = { data: null, error: { code: "PGRST202" } };

    const { data, error } = await ingerir();

    expect(error).toBeNull();
    expect(data).toMatchObject({ inserted: true, message_id: MENSAGEM });
    // A ingestao segue: o termo-chave ainda roda.
    expect(mover).toHaveBeenCalledTimes(1);
    const falha = eventosDeLog().find(
      (linha) => linha.evento === "reclassificar_automatica_falhou",
    );
    expect(falha).toMatchObject({
      nivel: "error",
      clinic_id: CLINICA,
      whatsapp_account_id: NUMERO,
      conversation_id: CONVERSA,
      message_id: MENSAGEM,
      error_code: "PGRST202",
    });
    const tudo = linhasDeLog.join("");
    expect(tudo).not.toContain("Confirmar");
    expect(tudo).not.toContain("Dona Rita");
    expect(tudo).not.toContain("84970000001");
  });

  it("exceção da correção também não derruba, e a mensagem do erro não vai para o log", async () => {
    correcao = new Error("Dona Rita escreveu Confirmar");

    const { data, error } = await ingerir();

    expect(error).toBeNull();
    expect(data).toMatchObject({ inserted: true });
    expect(mover).toHaveBeenCalledTimes(1);
    const falha = eventosDeLog().find(
      (linha) => linha.evento === "reclassificar_automatica_falhou",
    );
    expect(falha).toMatchObject({ clinic_id: CLINICA, message_id: MENSAGEM });
    const tudo = linhasDeLog.join("");
    expect(tudo).not.toContain("Confirmar");
    expect(tudo).not.toContain("Dona Rita");
  });

  it("quando corrige, deixa rastro com a contagem; sem correção, nenhum log", async () => {
    correcao = { data: 1, error: null };
    await ingerir();
    expect(
      eventosDeLog().find(
        (linha) => linha.evento === "resposta_automatica_reclassificada",
      ),
    ).toMatchObject({
      nivel: "info",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      message_id: MENSAGEM,
      count: 1,
    });

    linhasDeLog = [];
    correcao = { data: 0, error: null };
    await ingerir();
    expect(linhasDeLog.join("")).not.toContain("reclassific");
  });

  it("sem número no resultado, o log usa o número da URL", async () => {
    ingestao = inserida({ whatsapp_account_id: null });
    correcao = { data: null, error: { code: "57014" } };
    await ingerir();
    expect(
      eventosDeLog().find(
        (linha) => linha.evento === "reclassificar_automatica_falhou",
      ),
    ).toMatchObject({ whatsapp_account_id: NUMERO });
  });
});
