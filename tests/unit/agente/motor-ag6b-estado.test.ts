import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({ config: null as unknown, catalogo: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

import { MARCADOR_DE_MIDIA } from "@/lib/agente/laco";
import { PREFIXO_DO_AUDIO } from "@/lib/agente/midia";

import {
  AUDIO,
  AUDIO_2,
  FOTO,
  linhaDeMidia,
} from "./ag6b-contrato";
import {
  AGORA,
  CATALOGO_DA_AG6B,
  configComMidia,
  decisaoDo,
  EXECUTOR,
  FALA_PADRAO,
  GLICEMIA,
  HEMOGRAMA,
  leituraNoBanco,
  montarCenario,
  ultimaDoPacienteNoAgente,
  type OpcoesDoCenario,
} from "./ag6b-executor";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// AG6b, o ESTADO da midia no executor (desenho 5.1, 7d): o plano do turno
// (a habilidade da versao publicada, o telefone com o aviso novo, o preco,
// a calibragem, ate 3 midias), a espera do download (15 em 15 s ate 90 s,
// sem estado e sem reserva; o portao nos textos antes de esperar), a
// leitura gravada (o job repetido nunca chama o modelo de novo), o
// historico com as leituras das midias antigas e a falha fechada das
// leituras. Nenhum teste chama a OpenAI: o laco e o de verdade com o LLM
// falso, a porta e a de verdade com as integracoes falsas.

let escrito: string[] = [];
let cenarioAtual: ReturnType<typeof montarCenario> | null = null;

beforeEach(() => {
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function rodar(o: OpcoesDoCenario) {
  const cenario = montarCenario(estado, o);
  const promessa = executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
  return { cenario, promessa };
}

const audio = (extra: Partial<Parameters<typeof linhaDeMidia>[0]> = {}) =>
  linhaDeMidia({ id: AUDIO, contentType: "audio", ...extra });

describe("o caminho feliz pelo executor", () => {
  it("o audio e transcrito, gravado na leitura e respondido; o agente ve '(áudio) ...'", async () => {
    const { cenario, promessa } = rodar({ mensagens: [audio()] });
    expect(await promessa).toEqual({ ok: true });
    // A leitura gravada pela RPC, com a posse e a versao.
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({
        message_id: AUDIO,
        midia: "audio",
        tipo: "transcricao",
        transcricao: FALA_PADRAO,
        segundos_de_audio: 16,
        modelo: "whisper-1",
        versao: "transcricao-0123456789ab",
        job_id: cenario.job.id,
      }),
    ]);
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([
      expect.objectContaining({ p_worker: EXECUTOR, p_message_id: AUDIO }),
    ]);
    // O Storage foi lido com o limite do audio; a transcricao com os segundos medidos.
    expect(cenario.lerArquivo).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: AUDIO, maximoDeBytes: 5 * 1024 * 1024 }),
    );
    expect(cenario.transcrever.mock.calls[0]?.[0]).toMatchObject({ messageId: AUDIO });
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(
      `${PREFIXO_DO_AUDIO} ${FALA_PADRAO}`,
    );
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
    expect(decisaoDo(cenario.banco)).toMatchObject({ desfecho: "respondeu" });
    // O turno gravou as midias lidas ANTES da gravacao (mensagem_nao_lida).
    expect(cenario.banco.linhas("ai_turno")[0]?.mensagens_lidas).toEqual([AUDIO]);
    // Nada do audio em log.
    expect(escrito.join("")).not.toContain("hemograma");
  });

  it("o pedido de exame e lido, gravado com o resumo do Cadastro e respondido", async () => {
    const { cenario, promessa } = rodar({
      mensagens: [linhaDeMidia({ id: FOTO, contentType: "imagem", body: "quanto fica?" })],
      leitura: {
        [FOTO]: {
          tipo: "lido",
          leitura: {
            tipo: "pedido_de_exame_ou_procedimento",
            procedimentos: [HEMOGRAMA, GLICEMIA],
            codigos: ["p2", "p1"],
            foraDoCadastro: 0,
            confianca: "alta",
          },
          modelo: "gpt-6-luna",
          uso: { tokensEntrada: 1_900, tokensSaida: 20, tokensCacheLidos: 0, tokensCacheGravados: 0 },
        },
      },
      resposta: "No pedido que você mandou, vi Hemograma e Glicemia de jejum. É isso mesmo?",
    });
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({
        message_id: FOTO,
        midia: "imagem",
        tipo: "pedido_de_exame_ou_procedimento",
        procedimentos: [HEMOGRAMA, GLICEMIA],
        confianca: "alta",
        resumo: "pedido com Hemograma e Glicemia de jejum",
        modelo: "gpt-6-luna",
      }),
    ]);
    const ultima = String(ultimaDoPacienteNoAgente(cenario.agente.corpos));
    expect(ultima).toContain("(a pessoa mandou um pedido de exame ou procedimento com:");
    expect(ultima).toContain("Hemograma");
    expect(ultima.endsWith(" quanto fica?")).toBe(true);
  });
});

describe("a leitura ja gravada (o job repetido) e o historico", () => {
  it("o job repetido com a transcricao gravada nunca chama o modelo de novo", async () => {
    const { cenario, promessa } = rodar({ mensagens: [audio()] });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({
        messageId: AUDIO,
        midia: "audio",
        tipo: "transcricao",
        transcricao: "Tem horário no sábado?",
      }),
    );
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.lerArquivo).not.toHaveBeenCalled();
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(
      `${PREFIXO_DO_AUDIO} Tem horário no sábado?`,
    );
  });

  it("o historico leva a leitura das midias antigas (o arquivo nunca vai de novo)", async () => {
    const mensagens = [
      linhaDeMidia({ id: AUDIO_2, contentType: "audio", criadaEm: "2026-10-13T14:50:00.000Z" }),
      linhaDeMidia({
        id: FOTO,
        contentType: "imagem",
        body: "segue o pedido",
        criadaEm: "2026-10-13T14:51:00.000Z",
      }),
      {
        ...linhaDeMidia({ id: "f0700000-0000-4000-8000-000000000009", contentType: "imagem", criadaEm: "2026-10-13T14:52:00.000Z" }),
      },
      {
        id: "ia-1",
        clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
        conversation_id: "c0000000-0000-4000-8000-000000000001",
        author: "ia",
        direction: "saida",
        content_type: "texto",
        body: "Recebi, vou te ajudar.",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:53:00.000Z",
      },
      {
        id: "m-texto",
        clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
        conversation_id: "c0000000-0000-4000-8000-000000000001",
        author: "paciente",
        direction: "entrada",
        content_type: "texto",
        body: "e quanto fica?",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:58:30.000Z",
      },
    ];
    const { cenario, promessa } = rodar({ mensagens });
    // As tres midias antigas foram respondidas por um turno encerrado.
    cenario.banco.linhas("ai_turno").push({
      job_id: "20000000-0000-4000-8000-000000000009",
      clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
      conversation_id: "c0000000-0000-4000-8000-000000000001",
      estado: "enviado",
      mensagens_lidas: [AUDIO_2, FOTO, "f0700000-0000-4000-8000-000000000009"],
    });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({ messageId: AUDIO_2, midia: "audio", tipo: "transcricao", transcricao: "Oi, é sobre exames" }),
      leituraNoBanco({
        messageId: FOTO,
        midia: "imagem",
        tipo: "pedido_de_exame_ou_procedimento",
        procedimentos: [HEMOGRAMA],
        resumo: "pedido com Hemograma",
      }),
      leituraNoBanco({
        messageId: "f0700000-0000-4000-8000-000000000009",
        midia: "imagem",
        tipo: "resultado_ou_laudo",
        resumo: "resultado de exame ou laudo, passado para a equipe",
      }),
    );
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(cenario.lerComOModelo).not.toHaveBeenCalled();
    const input = (cenario.agente.corpos[0]?.input ?? []) as { role: string; content: string }[];
    const conteudos = input.map((i) => i.content);
    expect(conteudos).toContain(`${PREFIXO_DO_AUDIO} Oi, é sobre exames`);
    const codigo = CATALOGO_DA_AG6B.procedimentos.find((p) => p.id === HEMOGRAMA)?.codigo;
    expect(conteudos).toContain(
      `(a pessoa mandou um pedido de exame ou procedimento com: ${codigo} Hemograma) segue o pedido`,
    );
    // O resultado de exame continua o marcador (nunca o conteudo).
    expect(conteudos).toContain(MARCADOR_DE_MIDIA.paciente);
    expect(conteudos.at(-1)).toBe("e quanto fica?");
  });

  it("a primeira leitura vale: a corrida que grava antes devolve a leitura do banco", async () => {
    let jaGravou = false;
    const { cenario, promessa } = rodar({
      mensagens: [audio()],
      opcoesDoBanco: {
        antesDeGravar: () => {
          if (!jaGravou) {
            jaGravou = true;
            // Outro job gravou "sem fala" um instante antes.
            cenarioAtual?.banco.linhas("ia_leitura_da_midia").push(
              leituraNoBanco({ messageId: AUDIO, midia: "audio", tipo: "sem_fala" }),
            );
          }
        },
      },
    });
    cenarioAtual = cenario;
    expect(await promessa).toEqual({ ok: true });
    // Vale o "sem fala" do banco: a conversa passa como midia.
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "midia_nao_suportada",
      gatilho_entrada: "midia",
    });
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toHaveLength(1);
    expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
  });
});

describe("o plano: o que fica fora (nada sai do servidor)", () => {
  const casos: [string, Partial<OpcoesDoCenario>][] = [
    ["a habilidade desligada na versao publicada", { config: configComMidia({ audio: false, arquivo: true }) }],
    ["o telefone sem o aviso novo (versao 1)", { liberado: () => false }],
    ["sem o preco por minuto da transcricao", { precoDoAudio: null }],
    ["o preco por minuto zerado", { precoDoAudio: 0 }],
    ["a transcricao sem calibragem (a prova paga)", { midia: { transcricaoCalibrada: false } }],
    ["sem a midia nas dependencias", { midia: null }],
    ["o modelo da transcricao fora da lista", { midia: { modeloDaTranscricao: null } }],
    ["o download que desistiu", { mensagens: [audio({ mediaUrl: "indisponivel://desistiu" })] }],
    ["o mimetype fora da lista (OGG)", { mensagens: [audio({ mimetype: "audio/ogg; codecs=opus" })] }],
  ];
  it.each(casos)("%s: passa como midia, sem ler o arquivo nem transcrever", async (_nome, extra) => {
    const { cenario, promessa } = rodar({ mensagens: [audio()], ...extra });
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.lerArquivo).not.toHaveBeenCalled();
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "midia_nao_suportada",
      gatilho_entrada: "midia",
    });
    expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("midia_da_ia_liberada ausente (PGRST202: o codigo antes da migration): tudo fora", async () => {
    const { cenario, promessa } = rodar({
      mensagens: [audio()],
      opcoesDoBanco: { erroDoPortao: () => "PGRST202" },
    });
    await promessa;
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_suportada" });
  });

  it("a leitura das leituras que falha: as pendentes ficam fora", async () => {
    const { cenario, promessa } = rodar({ mensagens: [audio()] });
    cenario.banco.erros.set("ia_leitura_da_midia:select", { code: "42P01" });
    await promessa;
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_suportada" });
  });

  it("mais de 3 midias no turno: a quarta fica fora e nada e transcrito", async () => {
    const mensagens = [1, 2, 3, 4].map((n) =>
      linhaDeMidia({
        id: `a0d10000-0000-4000-8000-00000000000${n}`,
        contentType: "audio",
        criadaEm: `2026-10-13T14:58:3${n}.000Z`,
      }),
    );
    const { cenario, promessa } = rodar({ mensagens });
    await promessa;
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_suportada" });
  });
});

describe("a espera do download (15 em 15 s, ate 90 s)", () => {
  it("o arquivo ainda baixando: volta em 15 s, sem estado, sem reserva, sem modelo", async () => {
    const { cenario, promessa } = rodar({
      mensagens: [audio({ mediaUrl: null, criadaEm: new Date(AGORA - 30_000).toISOString() })],
    });
    expect(await promessa).toEqual({
      reagendar: new Date(AGORA + 15_000).toISOString(),
      motivo: "esperando_midia",
    });
    expect(cenario.banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
    expect(cenario.banco.linhas("ai_turno")).toEqual([]);
    expect(cenario.banco.linhas("ai_decision_log")).toEqual([]);
    expect(cenario.agente.create).not.toHaveBeenCalled();
  });

  it("passou de 90 s: a midia fica fora e a conversa passa", async () => {
    const { cenario, promessa } = rodar({
      mensagens: [audio({ mediaUrl: null, criadaEm: new Date(AGORA - 91_000).toISOString() })],
    });
    expect(await promessa).toEqual({ ok: true });
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_suportada" });
  });

  it("o texto do turno ja escala: segue sem esperar (o audio nunca sai)", async () => {
    const { cenario, promessa } = rodar({
      mensagens: [
        {
          id: "m-texto",
          clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
          conversation_id: "c0000000-0000-4000-8000-000000000001",
          author: "paciente",
          direction: "entrada",
          content_type: "texto",
          body: "quero falar com uma pessoa",
          media_url: null,
          deleted_at: null,
          is_internal_note: false,
          pelo_celular: false,
          created_at: new Date(AGORA - 40_000).toISOString(),
        },
        audio({ mediaUrl: null, criadaEm: new Date(AGORA - 30_000).toISOString() }),
      ],
    });
    expect(await promessa).toEqual({ ok: true });
    expect(cenario.lerArquivo).not.toHaveBeenCalled();
    expect(decisaoDo(cenario.banco)).toMatchObject({
      escalation_reason: "pedido_humano",
      gatilho_entrada: "pedido_humano",
    });
  });

  it("o prazo curto para a midia: volta para a fila sem custo", async () => {
    const { cenario, promessa } = rodar({
      mensagens: [audio()],
      prazoFinalMs: AGORA + 45_000,
    });
    expect(await promessa).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "orcamento_da_passagem",
    });
    expect(cenario.banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
    expect(cenario.transcrever).not.toHaveBeenCalled();
  });
});
