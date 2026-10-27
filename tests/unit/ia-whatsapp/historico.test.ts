import { describe, expect, it, vi } from "vitest";

import {
  carregarHistoricoDaConversa,
  idsRespondidos,
  MARCA_DO_NOME,
  mascararNome,
  mensagemDaLinha,
  montarHistorico,
} from "@/lib/agente/historico";
import { semAMarcaDoNome } from "@/lib/agente/marca-do-nome";
import {
  executarTurnoDoAgente,
  historicoParaOModelo,
  MENSAGENS_NO_HISTORICO,
  mensagemParaOModelo,
  mensagensPendentes,
  type ClienteDoAgente,
} from "@/lib/agente/laco";
import {
  aberturaDaJanela,
  lerJanela,
  type AberturaDaJanela,
} from "@/lib/agente/whatsapp";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";
import { ErroComCodigoDeJob } from "@/lib/jobs/erro-de-job";

import { BancoEmMemoria } from "./banco-em-memoria";

// Carregador do historico da conversa do WhatsApp (E3): so a janela, sem
// nota, evento, apagada nem resposta automatica do app Business; midia
// disfarcada de texto vira midia; nome do contato mascarado; pendente por
// id (as lidas de turno encerrado, ou de outro job decidido, nao contam) e
// no fim, para o laco enxergar o mesmo conjunto; limite de 20.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const OUTRA_CLINICA = "f0c115dd-e98c-4767-a1bb-93d517844852";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const OUTRO_JOB = "10000000-0000-4000-8000-000000000002";
const DESDE = "2026-10-13T12:00:00.000Z";

let sequencia = 0;
function mensagem(campos: Record<string, unknown>) {
  sequencia += 1;
  return {
    id: `m${String(sequencia).padStart(3, "0")}`,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: campos.author === "paciente" ? "entrada" : "saida",
    content_type: "texto",
    body: "texto",
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: `2026-10-13T12:${String(sequencia).padStart(2, "0")}:00.000Z`,
    ...campos,
  };
}

function carregar(
  banco: BancoEmMemoria,
  nome: string | null = null,
  abertaPor: AberturaDaJanela = "devolver",
) {
  return carregarHistoricoDaConversa(banco.cliente(), {
    clinicId: CLINICA,
    conversationId: CONVERSA,
    desde: DESDE,
    abertaPor,
    nomeDoContato: nome,
    jobId: JOB,
  });
}

describe("carregarHistoricoDaConversa", () => {
  it("só a janela, sem nota, evento, apagada nem resposta automática do app", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    banco.linhas("message").push(
      mensagem({
        author: "paciente",
        body: "antes da janela",
        created_at: "2026-10-13T11:59:59.000Z",
      }),
      mensagem({ author: "paciente", body: "Oi" }),
      mensagem({
        author: "sistema",
        body: "Olá! Já te respondo.",
        pelo_celular: true,
      }),
      mensagem({ author: "usuario", body: "nota", is_internal_note: true }),
      mensagem({ author: "sistema", content_type: "evento", body: "evento" }),
      mensagem({ author: "paciente", body: "apagada", deleted_at: DESDE }),
      mensagem({
        author: "usuario",
        body: "pelo celular, gente",
        pelo_celular: true,
      }),
      mensagem({ author: "paciente", body: "Quanto custa?" }),
      mensagem({
        author: "paciente",
        body: "de outra clinica",
        clinic_id: OUTRA_CLINICA,
      }),
    );
    const historico = await carregar(banco);
    expect(historico.mensagens.map((m) => m.texto)).toEqual([
      "pelo celular, gente",
      "Oi",
      "Quanto custa?",
    ]);
    expect(historico.mensagens.map((m) => m.autor)).toEqual([
      "assistente",
      "paciente",
      "paciente",
    ]);
  });

  it("janela aberta pela ingestão (conversa nova): a mensagem da rajada gravada um instante antes de desde entra e é pendente", async () => {
    // Revisao do E3 (concorrencia 5): duas mensagens juntas no primeiro
    // contato; a transacao da segunda comecou antes da que criou a conversa,
    // entao o created_at dela fica antes do desde. Sem esta regra o turno
    // respondia so a primeira e a segunda sumia em silencio.
    sequencia = 0;
    const banco = new BancoEmMemoria();
    banco.linhas("message").push(
      mensagem({
        author: "paciente",
        body: "segunda da rajada",
        created_at: "2026-10-13T11:59:59.970Z",
      }),
      mensagem({ author: "paciente", body: "primeira" }),
    );
    const daIngestao = await carregar(banco, null, "ingestao");
    expect(daIngestao.mensagens.map((m) => m.texto)).toEqual([
      "segunda da rajada",
      "primeira",
    ]);
    expect(daIngestao.pendentes).toHaveLength(2);
    // Na janela do Devolver o filtro por desde continua valendo.
    const doDevolver = await carregar(banco, null, "devolver");
    expect(doDevolver.mensagens.map((m) => m.texto)).toEqual(["primeira"]);
  });

  // Onda 2 (contrato 4.1): a janela da retomada no horario do assistente
  // ('horario') e a de valor que o codigo nao conhece leem so a partir do
  // desde, como a do Devolver. Antes, o valor desconhecido era lido como
  // 'ingestao' e a IA via a conversa inteira.
  it("janela do horário e de valor desconhecido: o corte do desde vale (falha fechada)", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    banco.linhas("message").push(
      mensagem({
        author: "paciente",
        body: "da equipe, antes de esperar",
        created_at: "2026-10-13T11:30:00.000Z",
      }),
      mensagem({
        author: "usuario",
        body: "resposta da equipe",
        created_at: "2026-10-13T11:40:00.000Z",
      }),
      mensagem({ author: "paciente", body: "no expediente" }),
    );
    for (const abertaPor of ["horario", "desconhecida"] as const) {
      const historico = await carregar(banco, null, abertaPor);
      expect(
        historico.mensagens.map((m) => m.texto),
        abertaPor,
      ).toEqual(["no expediente"]);
      expect(historico.pendentes, abertaPor).toHaveLength(1);
    }
  });

  // Onda 2 (P11a): o aviso de assistente virtual vai na primeira resposta
  // da IA na janela; a fala da equipe ou do sistema nao conta.
  it("iaRespondeuNaJanela: só a resposta da IA (autor 'ia') no trecho lido conta", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    banco
      .linhas("message")
      .push(
        mensagem({ author: "paciente", body: "Oi" }),
        mensagem({ author: "usuario", body: "Olá, aqui é a equipe." }),
        mensagem({ author: "sistema", body: "Lembrete da consulta." }),
        mensagem({ author: "paciente", body: "Tem estacionamento?" }),
      );
    expect((await carregar(banco)).iaRespondeuNaJanela).toBe(false);
    banco
      .linhas("message")
      .push(mensagem({ author: "ia", body: "Temos sim." }));
    expect((await carregar(banco)).iaRespondeuNaJanela).toBe(true);
    // Antes da janela (fora do corte), nao conta.
    sequencia = 0;
    const antes = new BancoEmMemoria();
    antes.linhas("message").push(
      mensagem({
        author: "ia",
        body: "Resposta de outra janela.",
        created_at: "2026-10-13T11:00:00.000Z",
      }),
      mensagem({ author: "paciente", body: "Oi de novo" }),
    );
    expect((await carregar(antes, null, "devolver")).iaRespondeuNaJanela).toBe(
      false,
    );
  });

  it("aberturaDaJanela: só 'ingestao' é a conversa inteira; valor desconhecido vira 'desconhecida'", async () => {
    expect(aberturaDaJanela("ingestao")).toBe("ingestao");
    expect(aberturaDaJanela("devolver")).toBe("devolver");
    expect(aberturaDaJanela("horario")).toBe("horario");
    for (const valor of ["", "INGESTAO", "turno", null, undefined, 1]) {
      expect(aberturaDaJanela(valor), String(valor)).toBe("desconhecida");
    }

    const banco = new BancoEmMemoria();
    banco.linhas("ia_janela_da_conversa").push({
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      contact_id: "c1",
      phone_key: "+5585999990000",
      desde: DESDE,
      aberta_por: "algo_novo",
    });
    expect(
      (await lerJanela(banco.cliente(), CLINICA, CONVERSA))?.abertaPor,
    ).toBe("desconhecida");
    banco.linhas("ia_janela_da_conversa")[0]!.aberta_por = "horario";
    expect(
      (await lerJanela(banco.cliente(), CLINICA, CONVERSA))?.abertaPor,
    ).toBe("horario");
  });

  it("pendente por id: as lidas de turno encerrado e de outro job decidido não contam; as do próprio job, sim", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    const m1 = mensagem({ author: "paciente", body: "primeira" });
    const r1 = mensagem({ author: "ia", body: "resposta" });
    const m2 = mensagem({ author: "paciente", body: "segunda" });
    const m3 = mensagem({ author: "paciente", body: "terceira" });
    banco.linhas("message").push(m1, r1, m2, m3);
    banco.linhas("ai_turno").push(
      {
        job_id: OUTRO_JOB,
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        estado: "enviado",
        mensagens_lidas: [m1.id],
      },
      {
        job_id: JOB,
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        estado: "reservado",
        mensagens_lidas: [m2.id],
      },
    );
    const historico = await carregar(banco);
    expect(historico.pendentes).toEqual([m2.id, m3.id]);
  });

  it("a resposta que saiu depois de uma mensagem nova: a pendente vai para o fim e o laço vê o mesmo conjunto", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    const m1 = mensagem({ author: "paciente", body: "pergunta" });
    const m2 = mensagem({ author: "paciente", body: "chegou durante o turno" });
    const r1 = mensagem({ author: "ia", body: "resposta da primeira" });
    banco.linhas("message").push(m1, m2, r1);
    banco.linhas("ai_turno").push({
      job_id: OUTRO_JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "enviado",
      mensagens_lidas: [m1.id],
    });
    const historico = await carregar(banco);
    expect(historico.pendentes).toEqual([m2.id]);
    expect(historico.mensagens.map((m) => m.texto)).toEqual([
      "pergunta",
      "resposta da primeira",
      "chegou durante o turno",
    ]);
    expect(mensagensPendentes(historico.mensagens).map((m) => m.texto)).toEqual(
      ["chegou durante o turno"],
    );
  });

  it("nada pendente: lista vazia (o executor conclui sem chamar o modelo)", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    const m1 = mensagem({ author: "paciente" });
    banco.linhas("message").push(m1);
    banco.linhas("ai_turno").push({
      job_id: OUTRO_JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "decidido",
      mensagens_lidas: [m1.id],
    });
    expect((await carregar(banco)).pendentes).toEqual([]);
  });

  it("limite de 20 depois dos filtros", async () => {
    sequencia = 0;
    const banco = new BancoEmMemoria();
    for (let i = 0; i < 30; i += 1) {
      banco
        .linhas("message")
        .push(
          mensagem({ author: "usuario", body: "nota", is_internal_note: true }),
          mensagem({ author: i % 2 === 0 ? "paciente" : "ia", body: `m${i}` }),
        );
    }
    const historico = await carregar(banco);
    expect(historico.mensagens).toHaveLength(MENSAGENS_NO_HISTORICO);
    // As 20 mais recentes (nenhuma nota): sem turno nenhum, as do paciente
    // sao pendentes e vao para o fim, na ordem.
    expect(historico.mensagens.map((m) => m.texto)).toEqual([
      ...["m11", "m13", "m15", "m17", "m19", "m21", "m23", "m25", "m27", "m29"],
      ...["m10", "m12", "m14", "m16", "m18", "m20", "m22", "m24", "m26", "m28"],
    ]);
  });

  it("leitura que falha: ErroComCodigoDeJob leitura_falhou", async () => {
    const banco = new BancoEmMemoria();
    banco.erros.set("message:select", { code: "08006" });
    await expect(carregar(banco)).rejects.toEqual(
      new ErroComCodigoDeJob("leitura_falhou"),
    );
    const outro = new BancoEmMemoria();
    outro.erros.set("ai_turno:select", { code: "08006" });
    await expect(carregar(outro)).rejects.toBeInstanceOf(ErroComCodigoDeJob);
  });
});

describe("mapeamento", () => {
  it("mídia disfarçada de texto e corpo vazio viram mídia; áudio sem transcrição", () => {
    expect(
      mensagemDaLinha(
        {
          author: "paciente",
          content_type: "texto",
          body: null,
          media_url: "https://mmg.whatsapp.net/video.enc",
        },
        null,
      ),
    ).toEqual({ autor: "paciente", texto: null, tipo: "midia" });
    expect(
      mensagemDaLinha(
        {
          author: "paciente",
          content_type: "texto",
          body: "  ",
          media_url: null,
        },
        null,
      ),
    ).toEqual({ autor: "paciente", texto: null, tipo: "midia" });
    expect(
      mensagemDaLinha(
        {
          author: "paciente",
          content_type: "audio",
          body: null,
          media_url: null,
        },
        null,
      ),
    ).toEqual({ autor: "paciente", texto: null, tipo: "audio" });
  });

  it("o marcador da mídia da clínica não diz que foi o paciente", () => {
    const daClinica = mensagemDaLinha(
      {
        author: "usuario",
        content_type: "imagem",
        body: null,
        media_url: "storage://x",
      },
      null,
    );
    expect(mensagemParaOModelo(daClinica)).toBe(
      "(a clínica mandou um conteúdo que não é texto)",
    );
    const doPaciente = mensagemDaLinha(
      {
        author: "paciente",
        content_type: "imagem",
        body: null,
        media_url: "storage://x",
      },
      null,
    );
    expect(mensagemParaOModelo(doPaciente)).toBe(
      "(o paciente mandou um conteúdo que não é texto)",
    );
  });

  it("o nome do contato vira a marca: inteiro e primeiro nome, sem maiúsculas nem acentos, palavra inteira", () => {
    const nome = "Mária Souza";
    expect(mascararNome("Olá MARIA SOUZA, tudo bem?", nome)).toBe(
      `Olá ${MARCA_DO_NOME}, tudo bem?`,
    );
    expect(mascararNome("Oi maria! Aqui é a Mariana.", nome)).toBe(
      `Oi ${MARCA_DO_NOME}! Aqui é a Mariana.`,
    );
    expect(mascararNome("sem nome aqui", nome)).toBe("sem nome aqui");
    expect(mascararNome("Oi A", "A")).toBe("Oi A");
    expect(mascararNome("Oi Maria", null)).toBe("Oi Maria");
    const mascarada = mensagemDaLinha(
      {
        author: "usuario",
        content_type: "texto",
        body: "Olá Maria, sua consulta",
        media_url: null,
      },
      nome,
    );
    expect(mascarada.texto).toBe(`Olá ${MARCA_DO_NOME}, sua consulta`);
  });

  it("montarHistorico corta para 20 com as pendentes por último", () => {
    const linhas = Array.from({ length: 25 }, (_, i) => ({
      id: `x${String(i).padStart(2, "0")}`,
      author: i === 0 ? "paciente" : "ia",
      content_type: "texto",
      body: `t${i}`,
      media_url: null,
      created_at: `2026-10-13T12:${String(i).padStart(2, "0")}:00.000Z`,
    }));
    // A mais antiga e do paciente e ninguem a respondeu por id: vai para o fim.
    const historico = montarHistorico(linhas, new Set(), null);
    expect(historico.mensagens).toHaveLength(20);
    expect(historico.mensagens.at(-1)?.texto).toBe("t0");
    expect(historico.pendentes).toEqual(["x00"]);
  });

  it("idsRespondidos: enviado e passou_para_equipe encerram; decidido só de outro job", () => {
    const ids = idsRespondidos(
      [
        { job_id: "a", estado: "enviado", mensagens_lidas: ["1"] },
        { job_id: "b", estado: "passou_para_equipe", mensagens_lidas: ["2"] },
        { job_id: "c", estado: "sem_envio", mensagens_lidas: ["3"] },
        { job_id: "d", estado: "reservado", mensagens_lidas: ["4"] },
        { job_id: "e", estado: "decidido", mensagens_lidas: ["5"] },
        { job_id: JOB, estado: "decidido", mensagens_lidas: ["6"] },
      ],
      JOB,
    );
    expect([...ids].sort()).toEqual(["1", "2", "5"]);
  });
});

// Revisao do E3 (achado 1 do executor): a marca do nome nao pode parecer
// marcacao. Com "[nome]", "Oi, aqui e a Maria" do proprio telefone da equipe
// escalava como tentativa de manipulacao, e o modelo repetindo a marca tinha
// a resposta barrada por formato_invalido/marcacao.
describe("a marca do nome não dispara o portão nem as regras de saída", () => {
  it("a marca é uma palavra, sem colchete nem sinal de marcação", () => {
    expect(MARCA_DO_NOME).toMatch(/^[\p{L}]+$/u);
  });

  it.each([
    ["Maria Souza", "Oi, aqui é a Maria. Quanto custa a consulta?"],
    ["Vinicius", "Bom dia, sou o Vinicius, vocês atendem Unimed?"],
    ["Ana Paula", "ana paula aqui, qual o valor da limpeza de pele?"],
  ])("%s escrevendo o próprio nome passa no portão", (nome, texto) => {
    const historico = montarHistorico(
      [
        {
          id: "m1",
          author: "paciente",
          content_type: "texto",
          body: texto,
          media_url: null,
          created_at: "2026-10-13T15:00:00.000Z",
        },
      ],
      new Set(),
      nome,
    );
    const [lida] = historico.mensagens;
    expect(lida?.texto).toContain(MARCA_DO_NOME);
    // O texto mascarado (o que a OpenAI e a regra de contexto do filtro de
    // saida leem) e o original (o que o portao le, desde 19/10/2026).
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: lida?.texto ?? null }],
      }),
    ).toEqual([]);
    expect(lida?.textoOriginal).toBe(texto);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: lida?.textoOriginal ?? null }],
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "Olá, Fulano! A consulta custa R$ 150,00.",
      "Olá! A consulta custa R$ 150,00.",
    ],
    [
      "Oi Fulano, tudo bem? Temos horário amanhã.",
      "Oi, tudo bem? Temos horário amanhã.",
    ],
    ["Fulano, a consulta custa R$ 150,00.", "A consulta custa R$ 150,00."],
    ["Tudo bem, Fulano? Temos horário.", "Tudo bem? Temos horário."],
    ["Obrigada, Fulano.\nAté logo!", "Obrigada.\nAté logo!"],
    // Conferência final: o feminino (o artigo da mensagem é "a Fulano"),
    // qualquer caixa e o tratamento colado na frente também saem.
    [
      "Olá, Fulana! A consulta custa R$ 150,00.",
      "Olá! A consulta custa R$ 150,00.",
    ],
    ["Oi, fulano! Tudo bem?", "Oi! Tudo bem?"],
    ["Olá, FULANO! Temos horário.", "Olá! Temos horário."],
    ["Olá, Sr. Fulano! Temos horário.", "Olá! Temos horário."],
    ["Bom dia, Dona Fulana. Temos horário.", "Bom dia. Temos horário."],
    [
      "Sem marca nenhuma, Fulanos e Fulaninho ficam.",
      "Sem marca nenhuma, Fulanos e Fulaninho ficam.",
    ],
  ])(
    "a marca nunca vira vocativo na resposta (conferência executor N2): %s",
    (doModelo, enviada) => {
      expect(MARCA_DO_NOME).toBe("Fulano");
      expect(semAMarcaDoNome(doModelo)).toBe(enviada);
    },
  );

  it("o modelo repetindo a marca passa nas regras de saída", () => {
    const resultado = avaliarRegras(
      `Olá, ${MARCA_DO_NOME}! Temos horário amanhã de manhã. Quer que eu passe para a equipe?`,
      { precosDoTurno: [], nomesDoCatalogo: [], mensagensDoPaciente: [] },
    );
    expect(resultado.achados).toEqual([]);
  });

  it("do histórico ao laço: a mensagem com o próprio nome chega ao classificador, sem escalar no portão", async () => {
    const historico = montarHistorico(
      [
        {
          id: "m1",
          author: "paciente",
          content_type: "texto",
          body: "Oi, aqui é a Maria. Quanto custa a consulta?",
          media_url: null,
          created_at: "2026-10-13T15:00:00.000Z",
        },
      ],
      new Set(),
      "Maria Souza",
    );
    const create = vi.fn();
    const classificador = vi.fn<ClassificadorDeEntrada>(async () => ({
      tipo: "falha",
      motivo: "sem_cliente",
      modelo: null,
      uso: null,
      httpStatus: null,
    }));
    const resultado = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: { ...configPadraoDoAgente(), status: "publicada", versao: 1 },
      catalogo: {
        procedimentos: [],
        vinculos: [],
        convenios: [],
        conveniosDoCadastro: [],
        nomeDaClinica: null,
      },
      mensagens: historico.mensagens,
      agoraMs: Date.UTC(2026, 9, 13, 15, 0),
      fuso: "America/Fortaleza",
      verificador: async () => ({
        tipo: "falha",
        motivo: "sem_cliente",
        modelo: null,
        uso: null,
        httpStatus: null,
      }),
      classificador,
    });
    expect(classificador).toHaveBeenCalledTimes(1);
    expect(resultado.desfecho).not.toMatchObject({ origem: "portao" });
    expect(resultado.desfecho).not.toMatchObject({
      motivo: "tentativa_de_manipulacao",
    });
  });
});

// Revisao de producao de 19/10/2026 (achado de seguranca): a mascara do nome
// existe so para a OpenAI. Com o portao no texto mascarado, uma contato
// chamada Socorro que escrevia "socorro, me ajuda" chegava ao portao como
// "Fulano, me ajuda" e nao escalava. O portao deterministico (local, sem
// rede) le o texto original; classificador, agente e verificador continuam
// so com o mascarado. A prova pelo executor, com o cliente falso da OpenAI,
// esta em ponta-a-ponta.test.ts.
describe("o portão lê o texto original do contato; a OpenAI, só o mascarado", () => {
  function doContato(body: string, nome: string) {
    return montarHistorico(
      [
        {
          id: "m1",
          author: "paciente",
          content_type: "texto",
          body,
          media_url: null,
          created_at: "2026-10-13T15:00:00.000Z",
        },
      ],
      new Set(),
      nome,
    );
  }

  function falhaDoModelo() {
    return {
      tipo: "falha" as const,
      motivo: "sem_cliente" as const,
      modelo: null,
      uso: null,
      httpStatus: null,
    };
  }

  function turno(
    mensagens: ReturnType<typeof doContato>["mensagens"],
    classificador: ClassificadorDeEntrada,
  ) {
    const create = vi.fn();
    const parse = vi.fn();
    const verificador = vi.fn(async () => falhaDoModelo());
    const resultado = executarTurnoDoAgente({
      cliente: { responses: { create, parse } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: { ...configPadraoDoAgente(), status: "publicada", versao: 1 },
      catalogo: {
        procedimentos: [],
        vinculos: [],
        convenios: [],
        conveniosDoCadastro: [],
        nomeDaClinica: null,
      },
      mensagens,
      agoraMs: Date.UTC(2026, 9, 13, 15, 0),
      fuso: "America/Fortaleza",
      verificador,
      classificador,
    });
    return { resultado, create, parse, verificador };
  }

  it("mensagemDaLinha: o texto mascarado vai para a OpenAI; o original, só na mensagem de texto do contato", () => {
    expect(
      mensagemDaLinha(
        {
          author: "paciente",
          content_type: "texto",
          body: "socorro, me ajuda",
          media_url: null,
        },
        "Socorro",
      ),
    ).toEqual({
      autor: "paciente",
      texto: `${MARCA_DO_NOME}, me ajuda`,
      tipo: "texto",
      textoOriginal: "socorro, me ajuda",
    });
    // A fala da clinica e a midia nao levam o original (o portao so le as
    // mensagens do contato, e midia ja escala).
    const daClinica = mensagemDaLinha(
      {
        author: "usuario",
        content_type: "texto",
        body: "Olá Socorro, tudo bem?",
        media_url: null,
      },
      "Socorro",
    );
    // Revisao da AG4 (achado 1): com a autoria real (so o servidor le; a
    // pergunta do cancelamento e da remarcacao so vale quando e da IA).
    expect(daClinica).toEqual({
      autor: "assistente",
      autoria: "usuario",
      texto: `Olá ${MARCA_DO_NOME}, tudo bem?`,
      tipo: "texto",
    });
    expect(daClinica).not.toHaveProperty("textoOriginal");
    for (const [author, autoria] of [
      ["ia", "ia"],
      ["sistema", "sistema"],
      ["outro", null],
    ] as const) {
      expect(
        mensagemDaLinha(
          { author, content_type: "texto", body: "Oi", media_url: null },
          "Socorro",
        ).autoria,
        author,
      ).toBe(autoria);
    }
    // A autoria nunca vai a OpenAI: o historico do modelo so tem o papel e
    // o texto.
    expect(
      historicoParaOModelo([
        { autor: "assistente", autoria: "sistema", texto: "Oi" },
      ]),
    ).toEqual([{ role: "assistant", content: "Oi" }]);
    expect(
      mensagemDaLinha(
        {
          author: "paciente",
          content_type: "audio",
          body: null,
          media_url: null,
        },
        "Socorro",
      ),
    ).not.toHaveProperty("textoOriginal");
  });

  it.each([
    ["Socorro", "socorro, me ajuda"],
    ["Socorro Lima", "Socorro"],
    ["Socorro", "SOCORRO"],
  ])(
    "contato %s escrevendo %j: o portão escala (sintoma) sem chamar a OpenAI",
    async (nome, texto) => {
      const historico = doContato(texto, nome);
      const [lida] = historico.mensagens;
      // A mascara escondia o gatilho: so pelo texto mascarado, nada escala.
      expect(lida?.texto).not.toMatch(/socorro/i);
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: lida?.texto ?? null }],
        }),
      ).toEqual([]);
      const classificador = vi.fn<ClassificadorDeEntrada>(async () =>
        falhaDoModelo(),
      );
      const { resultado, create, parse, verificador } = turno(
        historico.mensagens,
        classificador,
      );
      const r = await resultado;
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toEqual({
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: "sintoma",
        origem: "portao",
      });
      expect(classificador).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expect(verificador).not.toHaveBeenCalled();
      expect(r.uso).toEqual([]);
    },
  );

  it("'Aqui é a Socorro, quanto custa a consulta?' passa no portão (Q4 no texto original) e o classificador recebe só o mascarado", async () => {
    const historico = doContato(
      "Aqui é a Socorro, quanto custa a consulta?",
      "Socorro",
    );
    const classificador = vi.fn<ClassificadorDeEntrada>(async () =>
      falhaDoModelo(),
    );
    const { resultado } = turno(historico.mensagens, classificador);
    const r = await resultado;
    expect(r.desfecho).not.toMatchObject({ origem: "portao" });
    expect(classificador).toHaveBeenCalledTimes(1);
    expect(classificador.mock.calls[0]![0].mensagens).toEqual([
      `Aqui é a ${MARCA_DO_NOME}, quanto custa a consulta?`,
    ]);
  });
});
