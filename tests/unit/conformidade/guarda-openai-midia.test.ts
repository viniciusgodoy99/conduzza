import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import { executarTurnoDoAgente } from "@/lib/agente/laco";
import { portaDaMidiaDoWhatsapp } from "@/lib/agente/midia";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import type {
  EntradaDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";
import type { ArquivoParaOLeitor } from "@/lib/integrations/llm/leitor-de-midia";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";
import {
  agenteQueResponde,
  AUDIO,
  audioNoLaco,
  FOTO,
  fotoNoLaco,
  lida,
  mp3Sintetico,
  portaFalsa,
  rpcsDaAg6b,
  transcrita,
} from "../agente/ag6b-contrato";

// A guarda da MIDIA na OpenAI (AG6b, desenho 4 e 7; CLAUDE.md, secao 2):
//  - o AGENTE, o classificador e o verificador nunca recebem o arquivo
//    (nenhuma parte input_image, input_file nem input_audio, nenhuma data
//    URL, nenhum byte): so o texto transcrito e a descricao do servidor;
//  - a porta do WhatsApp so entrega a transcricao e ao leitor os bytes SEM
//    metadados (o ID3 do audio, o EXIF com GPS da foto), e nunca o nome do
//    arquivo do paciente.
// Nenhum teste chama a OpenAI.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const HEMOGRAMA = "11111111-1111-4111-8111-111111111111";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOGO = montarCatalogoDoAgente({
  procedimentos: [{ id: HEMOGRAMA, name: "Hemograma", active: true, bookable_by_ai: true }],
  vinculos: [
    {
      procedure_id: HEMOGRAMA,
      professional_id: PROF,
      insurance_id: null,
      price_cents: 4_000,
      covered_by_insurance: false,
      bookable_by_ai: true,
      active: true,
    },
  ],
  profissionais: [{ id: PROF, name: "Dra. Helena", active: true }],
  convenios: [],
});
const USO = { tokensEntrada: 600, tokensSaida: 10, tokensCacheLidos: 0, tokensCacheGravados: 0 };

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o agente, o classificador e o verificador nunca recebem o arquivo", () => {
  it("num turno com audio e pedido de exame: so texto vai aos tres", async () => {
    const pedidos: EntradaDoVerificador[] = [];
    const textos: (readonly string[])[] = [];
    const verificador: Verificador = async (pedido) => {
      pedidos.push(pedido);
      return {
        tipo: "veredicto",
        veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
        modelo: "gpt-6-luna",
        uso: USO,
      };
    };
    const classificador: ClassificadorDeEntrada = async ({ mensagens }) => {
      textos.push(mensagens);
      return {
        tipo: "classificacao",
        classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
        modelo: "gpt-6-luna",
        uso: USO,
      };
    };
    const { porta } = portaFalsa({
      transcricao: { [AUDIO]: transcrita("Quero saber o valor, por favor.") },
      leitura: {
        [FOTO]: lida({ tipo: "pedido_de_exame_ou_procedimento", procedimentos: [HEMOGRAMA] }),
      },
    });
    const agente = agenteQueResponde("No pedido que você mandou, vi Hemograma. É isso mesmo?");
    const config = configPadraoDoAgente();
    const r = await executarTurnoDoAgente({
      cliente: agente.cliente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: {
        ...config,
        habilidades: { ...config.habilidades, ler_audio: true, ler_imagem_e_documento: true },
      },
      catalogo: CATALOGO,
      mensagens: [fotoNoLaco(FOTO, "segue o pedido"), audioNoLaco(AUDIO)],
      agoraMs: Date.UTC(2026, 9, 30, 15, 0),
      fuso: "America/Fortaleza",
      verificador,
      classificador,
      midia: porta,
    });
    expect(r.tipo).toBe("resposta");
    const tudo = JSON.stringify({ agente: agente.corpos, textos, pedidos });
    for (const proibido of [
      "input_image",
      "input_file",
      "input_audio",
      "data:image",
      "data:application",
      "data:audio",
      "base64",
      "image_url",
      "file_data",
    ]) {
      expect(tudo, proibido).not.toContain(proibido);
    }
    // O agente continua com os parametros fixos (store false, sem estado).
    for (const corpo of agente.corpos) {
      expect(corpo.store).toBe(false);
      expect(corpo).not.toHaveProperty("previous_response_id");
      expect(corpo).not.toHaveProperty("conversation");
    }
  });
});

describe("a porta do WhatsApp so manda os bytes sem metadados, com o nome fixo", () => {
  function banco() {
    const b = new BancoEmMemoria();
    rpcsDaAg6b(b, { liberado: () => true });
    return b;
  }

  it("o audio vai a transcricao sem ID3 (o nome e a capa nunca saem)", async () => {
    const id3 = Buffer.concat([
      Buffer.from("ID3"),
      Buffer.from([3, 0, 0, 0, 0, 0, 30]),
      Buffer.from("TIT2 Nome do Paciente Capa ..."),
    ]);
    const comId3 = Uint8Array.from(Buffer.concat([id3, Buffer.from(mp3Sintetico(5))]));
    const transcrever = vi.fn(async () => ({
      tipo: "falhou" as const,
      motivo: "timeout" as const,
      uso: null,
    }));
    const porta = portaDaMidiaDoWhatsapp(banco().cliente(), {
      clinicId: CLINICA,
      conversationId: "c",
      jobId: "j",
      workerId: "w",
      mascarar: (t) => t,
      lerArquivo: async () => ({ tipo: "ok", bytes: comId3 }),
      transcrever,
      lerComOModelo: async () => {
        throw new Error("nao");
      },
      versaoDaTranscricao: "transcricao-0123456789ab",
      modeloDoLeitor: "gpt-6-luna",
    });
    const [pronta] = await porta.preparar(
      [{ messageId: AUDIO, midia: "audio", mediaUrl: "storage://x", mimetype: "audio/mpeg" }],
      8_000,
    );
    expect(pronta?.tipo).toBe("audio");
    if (pronta?.tipo !== "audio") {
      return;
    }
    await porta.transcrever(pronta, 12_000);
    const enviado = (transcrever.mock.calls[0] as unknown as [{ bytes: Uint8Array }])[0].bytes;
    expect(Buffer.from(enviado).includes(Buffer.from("Nome do Paciente"))).toBe(false);
    expect(Buffer.from(enviado).includes(Buffer.from("ID3"))).toBe(false);
    expect(enviado[0]).toBe(0xff);
  });

  it("a foto vai ao leitor sem o EXIF (sem GPS nem aparelho)", async () => {
    const exif = Buffer.concat([
      Buffer.from("Exif\0\0II*\0"),
      Buffer.from([8, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from("GPS -3.7319 -38.5267 IPHONE DA MARIA"),
    ]);
    const seg = (m: number, corpo: Buffer) =>
      Buffer.concat([Buffer.from([0xff, m, (corpo.length + 2) >> 8, (corpo.length + 2) & 0xff]), corpo]);
    const jpeg = Uint8Array.from(
      Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        seg(0xe1, exif),
        seg(0xdb, Buffer.alloc(65)),
        seg(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
        seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
        Buffer.from([0x12, 0x34, 0xff, 0xd9]),
      ]),
    );
    const lerComOModelo = vi.fn(async () => ({
      tipo: "falha" as const,
      motivo: "timeout" as const,
      modelo: "gpt-6-luna",
      uso: null,
    }));
    const porta = portaDaMidiaDoWhatsapp(banco().cliente(), {
      clinicId: CLINICA,
      conversationId: "c",
      jobId: "j",
      workerId: "w",
      mascarar: (t) => t,
      lerArquivo: async () => ({ tipo: "ok", bytes: jpeg }),
      transcrever: async () => {
        throw new Error("nao");
      },
      lerComOModelo,
      versaoDaTranscricao: "transcricao-0123456789ab",
      modeloDoLeitor: "gpt-6-luna",
    });
    const [pronta] = await porta.preparar(
      [{ messageId: FOTO, midia: "imagem", mediaUrl: "storage://x", mimetype: "image/jpeg" }],
      8_000,
    );
    expect(pronta?.tipo).toBe("arquivo");
    if (pronta?.tipo !== "arquivo") {
      return;
    }
    await porta.ler(pronta, [], 12_000);
    const arquivo = (lerComOModelo.mock.calls[0] as unknown as [{ arquivo: ArquivoParaOLeitor }])[0]
      .arquivo;
    const bytes = Buffer.from(arquivo.bytes);
    expect(bytes.includes(Buffer.from("GPS"))).toBe(false);
    expect(bytes.includes(Buffer.from("IPHONE"))).toBe(false);
    expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
  });
});
