import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  config: null as unknown,
  catalogo: null as unknown,
  /** undefined: a funcao de verdade. */
  ilegiveis: undefined as string[] | null | undefined,
}));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

vi.mock("@/lib/agente/midia", async (original) => {
  const real = await original<typeof import("@/lib/agente/midia")>();
  return {
    ...real,
    lerIlegiveisDaJanela: async (
      ...args: Parameters<typeof real.lerIlegiveisDaJanela>
    ) =>
      estado.ilegiveis === undefined
        ? real.lerIlegiveisDaJanela(...args)
        : estado.ilegiveis,
  };
});

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  AVISO_DO_RESTO_DO_PEDIDO,
  DESCRICOES_DO_ARQUIVO,
  lerIlegiveisDaJanela,
} from "@/lib/agente/midia";
import { CABECALHO_DA_NOTA_DA_PASSAGEM, NOTAS_DA_LEITURA } from "@/lib/agente/nota-da-passagem";
import type { ResultadoDoLeitor } from "@/lib/integrations/llm/leitor-de-midia";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";
import {
  CLINICA,
  CONTATO,
  CONVERSA,
  FOTO,
  FOTO_2,
  linhaDeMidia,
} from "./ag6b-contrato";
import { DESDE } from "./ag6-contrato";
import {
  decisaoDo,
  EXECUTOR,
  GLICEMIA,
  HEMOGRAMA,
  leituraNoBanco,
  montarCenario,
  ultimaDoPacienteNoAgente,
  type OpcoesDoCenario,
} from "./ag6b-executor";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// A matriz de arquivos do dono de 06/11/2026 no EXECUTOR: o laco e a porta de
// verdade, o leitor falso, as RPCs em memoria. O numero sentinela da carteirinha
// procurado em tudo que foi gravado e mandado; o job repetido que nao pede foto
// de novo, nao conta a mesma leitura duas vezes e nao grava a nota duas vezes; a
// nota da equipe, com a conversa na IA; a janela do ilegivel. Nenhum teste chama
// a OpenAI.

/** Um numero que nao existe: aparecer fora do cadastro e vazamento. */
const SENTINELA = "99887766554433ZQ";
const UNIMED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AMIL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEDIDO = "pedido_de_exame_ou_procedimento";

const CATALOGO = montarCatalogoDoAgente({
  procedimentos: [
    { id: HEMOGRAMA, name: "Hemograma", active: true, bookable_by_ai: true },
    { id: GLICEMIA, name: "Glicemia de jejum", active: true, bookable_by_ai: true },
  ],
  vinculos: [HEMOGRAMA, GLICEMIA].map((procedure_id) => ({
    procedure_id,
    professional_id: PROF,
    insurance_id: null,
    price_cents: 4_000,
    covered_by_insurance: false,
    bookable_by_ai: true,
    active: true,
  })),
  profissionais: [{ id: PROF, name: "Dra. Helena", active: true }],
  convenios: [
    { id: UNIMED, name: "Unimed", plan_name: "Nacional", active: true, requires_card: true },
    { id: AMIL, name: "Amil", plan_name: null, active: true, requires_card: true },
  ],
});

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  estado.ilegiveis = undefined;
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

function leitor(e: {
  tipo: string;
  confianca?: "alta" | "media" | "baixa";
  procedimentos?: string[];
  foraDoCadastro?: number;
  convenioId?: string | null;
  numeroDaCarteirinha?: string | null;
}): ResultadoDoLeitor {
  return {
    tipo: "lido",
    leitura: {
      tipo: e.tipo,
      procedimentos: e.procedimentos ?? [],
      codigos: [],
      foraDoCadastro: e.foraDoCadastro ?? 0,
      confianca: e.confianca ?? "alta",
      convenioId: e.convenioId ?? null,
      numeroDaCarteirinha: e.numeroDaCarteirinha ?? null,
    },
    modelo: "gpt-6-luna",
    uso: { tokensEntrada: 1_900, tokensSaida: 20, tokensCacheLidos: 0, tokensCacheGravados: 0 },
  } as ResultadoDoLeitor;
}

function cena(o: OpcoesDoCenario) {
  const montado = montarCenario(estado, { catalogo: CATALOGO, ...o });
  for (const id of [UNIMED, AMIL]) {
    montado.banco.linhas("insurance").push({ id, clinic_id: CLINICA, active: true });
  }
  return montado;
}

const foto = (id = FOTO, criadaEm?: string) =>
  linhaDeMidia({ id, contentType: "imagem", ...(criadaEm === undefined ? {} : { criadaEm }) });

const contatoDa = (banco: BancoEmMemoria) =>
  banco.linhas("contact").find((k) => k.id === CONTATO);
const notasDa = (banco: BancoEmMemoria) =>
  banco.linhas("message").filter((m) => m.is_internal_note === true);

/** A foto ja respondida, e a fala nova da pessoa: o turno seguinte. */
function comHistorico(leitura: Parameters<typeof leituraNoBanco>[0]) {
  const montado = cena({
    mensagens: [
      foto(FOTO, "2026-10-13T14:58:10.000Z"),
      {
        id: "ia-1",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        author: "ia",
        direction: "saida",
        content_type: "texto",
        body: "Pode mandar uma foto mais nítida?",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:58:20.000Z",
      },
      {
        id: "t-2",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        author: "paciente",
        direction: "entrada",
        content_type: "texto",
        body: "agora nao consigo tirar outra",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:58:50.000Z",
      },
    ],
  });
  montado.banco.linhas("ai_turno").push({
    job_id: "99999999-0000-4000-8000-000000000001",
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    estado: "enviado",
    mensagens_lidas: [FOTO],
  });
  montado.banco.linhas("ia_leitura_da_midia").push(leituraNoBanco(leitura));
  return montado;
}

describe("o numero sentinela da carteirinha", () => {
  async function rodarComSentinela() {
    const cenario = cena({
      mensagens: [
        linhaDeMidia({ id: FOTO, contentType: "imagem", body: "segue minha carteirinha" }),
      ],
      leitura: {
        [FOTO]: leitor({ tipo: "carteirinha", convenioId: UNIMED, numeroDaCarteirinha: SENTINELA }),
      },
      resposta: "Obrigada! Recebi sua carteirinha do convênio Unimed Nacional.",
    });
    const pedidosAoVerificador: unknown[] = [];
    const pedidosAoClassificador: unknown[] = [];
    const verificadorDoCenario = cenario.deps.criarVerificador;
    const classificadorDoCenario = cenario.deps.criarClassificador;
    cenario.deps.criarVerificador = (...a) => {
      const v = verificadorDoCenario(...a);
      return async (pedido) => {
        pedidosAoVerificador.push(pedido);
        return v(pedido);
      };
    };
    cenario.deps.criarClassificador = (...a) => {
      const c = classificadorDoCenario(...a);
      return async (pedido) => {
        pedidosAoClassificador.push(pedido);
        return c(pedido);
      };
    };
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({ ok: true });
    return { cenario, pedidosAoVerificador, pedidosAoClassificador };
  }

  it("grava so no cadastro; a RPC e o unico lugar por onde ele passa", async () => {
    const { cenario } = await rodarComSentinela();
    expect(contatoDa(cenario.banco)).toMatchObject({
      insurance_card: SENTINELA,
      insurance_id: UNIMED,
    });
    const chamadas = cenario.banco.chamadasDe("gravar_leitura_da_midia");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.p_numero_da_carteirinha).toBe(SENTINELA);
    expect(chamadas[0]?.p_convenio_lido).toBe(UNIMED);
    expect(JSON.stringify({ ...chamadas[0], p_numero_da_carteirinha: null })).not.toContain(SENTINELA);
  });

  it("nunca em leitura, decisao, turno, nota, trilha, fila ou qualquer outra tabela", async () => {
    const { cenario } = await rodarComSentinela();
    const tabelas = [...cenario.banco.tabelas.entries()]
      .filter(([nome]) => nome !== "contact")
      .map(([nome, linhas]) => [nome, JSON.stringify(linhas)] as const);
    expect(tabelas.map(([nome]) => nome)).toEqual(
      expect.arrayContaining([
        "ia_leitura_da_midia",
        "ai_decision_log",
        "ai_turno",
        "message",
        "audit_log",
      ]),
    );
    for (const [nome, conteudo] of tabelas) {
      expect(conteudo, nome).not.toContain(SENTINELA);
    }
    // Nenhuma outra RPC recebeu o numero.
    for (const chamada of cenario.banco.chamadas.filter((c) => c.nome !== "gravar_leitura_da_midia")) {
      expect(JSON.stringify(chamada), chamada.nome).not.toContain(SENTINELA);
    }
    // Nenhuma escrita em tabela o levou, fora do cadastro.
    for (const operacao of cenario.banco.operacoes.filter((o) => o.tabela !== "contact")) {
      expect(JSON.stringify(operacao), operacao.tabela).not.toContain(SENTINELA);
    }
    // A trilha diz quais campos, nunca o valor.
    expect(cenario.banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        action: "gravou_carteirinha_lida",
        detalhes: { campos: ["insurance_card", "insurance_id"], message_id: FOTO },
      }),
    ]);
  });

  it("nunca no log, no modelo do agente, no verificador, no classificador nem no envio", async () => {
    const { cenario, pedidosAoVerificador, pedidosAoClassificador } = await rodarComSentinela();
    expect(escrito.join("")).not.toContain(SENTINELA);
    expect(cenario.agente.corpos.length).toBeGreaterThan(0);
    expect(JSON.stringify(cenario.agente.corpos)).not.toContain(SENTINELA);
    expect(pedidosAoVerificador.length).toBeGreaterThan(0);
    expect(JSON.stringify(pedidosAoVerificador)).not.toContain(SENTINELA);
    expect(pedidosAoClassificador.length).toBeGreaterThan(0);
    expect(JSON.stringify(pedidosAoClassificador)).not.toContain(SENTINELA);
    expect(JSON.stringify(cenario.enviarResposta.mock.calls)).not.toContain(SENTINELA);
    expect(JSON.stringify(cenario.enviarFrase.mock.calls)).not.toContain(SENTINELA);
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(
      "(a pessoa mandou a carteirinha do convênio Unimed Nacional) segue minha carteirinha",
    );
  });

  it("nos turnos seguintes, nenhum bloco do prompt leva o numero do cadastro", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "carteirinha", convenioId: UNIMED, numeroDaCarteirinha: SENTINELA }) },
    });
    // O cadastro ja tem o numero, e a leitura ja existe (o turno seguinte).
    const contato = contatoDa(cenario.banco)!;
    contato.insurance_card = SENTINELA;
    contato.insurance_id = UNIMED;
    cenario.banco.linhas("ia_leitura_da_midia").push({
      ...leituraNoBanco({ messageId: FOTO, midia: "imagem", tipo: "carteirinha", resumo: "carteirinha do convênio" }),
      convenio_lido_id: UNIMED,
    });
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({ ok: true });
    expect(cenario.lerComOModelo).not.toHaveBeenCalled();
    expect(JSON.stringify(cenario.agente.corpos)).not.toContain(SENTINELA);
    expect(escrito.join("")).not.toContain(SENTINELA);
  });

  it("o numero descartado pelo leitor nunca chega a RPC", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "carteirinha", confianca: "media", convenioId: UNIMED, numeroDaCarteirinha: null }) },
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")[0]?.p_numero_da_carteirinha).toBeNull();
    expect(contatoDa(cenario.banco)?.insurance_card ?? null).toBeNull();
  });

  it("fora da carteirinha, os parametros novos nem vao", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "outro" }) },
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    const chamada = cenario.banco.chamadasDe("gravar_leitura_da_midia")[0];
    expect(chamada).toBeDefined();
    expect(chamada).not.toHaveProperty("p_numero_da_carteirinha");
    expect(chamada).not.toHaveProperty("p_convenio_lido");
  });
});

describe("o convenio que a RPC recusa", () => {
  it("inativo ou fora da clinica: a leitura nao grava, nada muda, e a conversa vai para a equipe", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "carteirinha", convenioId: UNIMED, numeroDaCarteirinha: SENTINELA }) },
    });
    cenario.banco.linhas("insurance").find((i) => i.id === UNIMED)!.active = false;
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
    expect(contatoDa(cenario.banco)?.insurance_card ?? null).toBeNull();
    expect(cenario.agente.create).not.toHaveBeenCalled();
    expect(cenario.banco.linhas("conversation")[0]).toMatchObject({ status: "aguardando_humano" });
    expect(escrito.join("")).not.toContain(SENTINELA);
  });
});

describe("a carteirinha com o cadastro preenchido", () => {
  it("o numero diferente nao muda: nota sem o numero, e a conversa continua na IA", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "carteirinha", numeroDaCarteirinha: SENTINELA }) },
    });
    contatoDa(cenario.banco)!.insurance_card = "1234.5678-9";
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(contatoDa(cenario.banco)?.insurance_card).toBe("1234.5678-9");
    const [nota] = notasDa(cenario.banco);
    expect(nota?.body).toBe(
      `${CABECALHO_DA_NOTA_DA_PASSAGEM}\n${NOTAS_DA_LEITURA.carteirinhaDiferente.replace("{}", "número")}`,
    );
    expect(nota).toMatchObject({ author: "sistema", billable: false, cost_cents: 0 });
    expect(nota?.job_id).toBeUndefined();
    expect(JSON.stringify(notasDa(cenario.banco))).not.toContain(SENTINELA);
    expect(cenario.banco.linhas("conversation")[0]).toMatchObject({ status: "ia_atendendo" });
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
  });

  it("o plano nao reconhecido nao apaga nem troca o do cadastro", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "carteirinha", numeroDaCarteirinha: SENTINELA }) },
    });
    contatoDa(cenario.banco)!.insurance_id = AMIL;
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(contatoDa(cenario.banco)?.insurance_id).toBe(AMIL);
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(DESCRICOES_DO_ARQUIVO.carteirinhaSemPlano);
  });
});

describe("o pedido com parte fora do Cadastro: a nota para a equipe", () => {
  const PARCIAL = leitor({ tipo: PEDIDO, procedimentos: [HEMOGRAMA], foraDoCadastro: 2 });

  it("a nota interna, do sistema, sem cobranca, com a conversa ainda na IA; a resposta sai", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: PARCIAL },
      resposta: "No pedido que você mandou, vi Hemograma. É isso mesmo?",
    });
    expect(await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps)).toEqual({ ok: true });
    const notas = notasDa(cenario.banco);
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({
      author: "sistema",
      direction: "saida",
      content_type: "texto",
      billable: false,
      cost_cents: 0,
      body: `${CABECALHO_DA_NOTA_DA_PASSAGEM}\n${NOTAS_DA_LEITURA.pedidoParcial.replace("{}", "2")}`,
    });
    expect(cenario.banco.linhas("conversation")[0]).toMatchObject({
      status: "ia_atendendo",
      assignee_user_id: null,
    });
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(cenario.enviarResposta.mock.calls[0])).toContain(AVISO_DO_RESTO_DO_PEDIDO);
    // O nome do exame nunca vai na nota: o arquivo e a equipe contam.
    expect(notas[0]?.body).not.toContain("Hemograma");
  });

  it("o agente nunca le a nota: ela nao entra no historico do modelo", async () => {
    const cenario = cena({
      mensagens: [
        foto(FOTO, "2026-10-13T14:58:10.000Z"),
        {
          id: "nota-1",
          clinic_id: CLINICA,
          conversation_id: CONVERSA,
          author: "sistema",
          direction: "saida",
          content_type: "texto",
          body: `${CABECALHO_DA_NOTA_DA_PASSAGEM}\n${NOTAS_DA_LEITURA.pedidoParcial.replace("{}", "2")}`,
          media_url: null,
          deleted_at: null,
          is_internal_note: true,
          pelo_celular: false,
          created_at: "2026-10-13T14:58:11.000Z",
        },
      ],
    });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({
        messageId: FOTO,
        midia: "imagem",
        tipo: PEDIDO,
        procedimentos: [HEMOGRAMA],
        foraDoCadastro: 2,
        resumo: "pedido com Hemograma; 2 fora do Cadastro, para a equipe conferir",
      }),
    );
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(JSON.stringify(cenario.agente.corpos)).not.toContain("item fora do Cadastro (2)");
  });

  it("o job repetido com a leitura gravada: nao le de novo, nao grava a nota de novo, e o aviso ainda sai", async () => {
    const cenario = cena({ mensagens: [foto()], resposta: "No pedido que você mandou, vi Hemograma." });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({
        messageId: FOTO,
        midia: "imagem",
        tipo: PEDIDO,
        procedimentos: [HEMOGRAMA],
        foraDoCadastro: 2,
        resumo: "pedido com Hemograma; 2 fora do Cadastro, para a equipe conferir",
      }),
    );
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.lerComOModelo).not.toHaveBeenCalled();
    expect(cenario.banco.chamadasDe("gravar_leitura_da_midia")).toEqual([]);
    expect(notasDa(cenario.banco)).toEqual([]);
    expect(JSON.stringify(cenario.enviarResposta.mock.calls[0])).toContain(AVISO_DO_RESTO_DO_PEDIDO);
  });

  it("o mesmo job de novo, depois de enviar: a nota e a resposta nao saem de novo", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: PARCIAL },
      resposta: "No pedido que você mandou, vi Hemograma.",
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(notasDa(cenario.banco)).toHaveLength(1);
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
    expect(cenario.lerComOModelo).toHaveBeenCalledTimes(1);
  });

  it("a corrida: outro job gravou entre o plano e a gravacao; vale a primeira, sem nota nem cadastro novos", async () => {
    const cenario: ReturnType<typeof cena> = cena({
      mensagens: [foto()],
      leitura: {
        [FOTO]: leitor({ tipo: "carteirinha", convenioId: AMIL, numeroDaCarteirinha: "11112222333344" }),
      },
      opcoesDoBanco: {
        antesDeGravar: () => {
          const leituras = cenario.banco.linhas("ia_leitura_da_midia");
          if (leituras.length === 0) {
            leituras.push({
              ...leituraNoBanco({ messageId: FOTO, midia: "imagem", tipo: "carteirinha", resumo: "carteirinha do convênio" }),
              convenio_lido_id: UNIMED,
            });
          }
        },
      },
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(contatoDa(cenario.banco)?.insurance_card ?? null).toBeNull();
    expect(contatoDa(cenario.banco)?.insurance_id ?? null).toBeNull();
    expect(notasDa(cenario.banco)).toEqual([]);
    expect(cenario.banco.linhas("audit_log")).toEqual([]);
    // O agente le o plano da PRIMEIRA leitura.
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(
      "(a pessoa mandou a carteirinha do convênio Unimed Nacional)",
    );
  });

  it("a leitura recusada nao grava nada (fora da IA)", async () => {
    const cenario: ReturnType<typeof cena> = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: PARCIAL },
      opcoesDoBanco: {
        antesDeGravar: () => {
          cenario.banco.linhas("conversation")[0]!.status = "em_atendimento";
        },
      },
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(notasDa(cenario.banco)).toEqual([]);
    expect(cenario.enviarResposta).not.toHaveBeenCalled();
  });
});

describe("o ilegivel na janela", () => {
  const PEDE = "Não consegui ler o arquivo. Pode mandar uma foto mais nítida?";

  it("a primeira vez: pede a foto, com a conversa na IA", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "ilegivel" }) },
      resposta: PEDE,
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(DESCRICOES_DO_ARQUIVO.ilegivel);
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
    expect(cenario.banco.linhas("conversation")[0]).toMatchObject({ status: "ia_atendendo" });
  });

  it("o job repetido com o mesmo ilegivel pendente: nao conta a mesma leitura como segunda vez", async () => {
    const cenario = cena({ mensagens: [foto()], resposta: PEDE });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({ messageId: FOTO, midia: "imagem", tipo: "ilegivel", resumo: "arquivo ilegível" }),
    );
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.lerComOModelo).not.toHaveBeenCalled();
    expect(decisaoDo(cenario.banco)?.escalation_reason ?? null).toBeNull();
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(DESCRICOES_DO_ARQUIVO.ilegivel);
  });

  it("o mesmo job de novo, depois de enviar: nao pede a foto de novo", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "ilegivel" }) },
      resposta: PEDE,
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
    expect(cenario.lerComOModelo).toHaveBeenCalledTimes(1);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toHaveLength(1);
    expect(decisaoDo(cenario.banco)?.escalation_reason ?? null).toBeNull();
  });

  it("dois ilegiveis no mesmo turno, gravados pelo job repetido: uma vez so", async () => {
    const cenario = cena({
      mensagens: [foto(FOTO), foto(FOTO_2)],
      resposta: PEDE,
    });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({ messageId: FOTO, midia: "imagem", tipo: "ilegivel", resumo: "arquivo ilegível" }),
      leituraNoBanco({ messageId: FOTO_2, midia: "imagem", tipo: "ilegivel", resumo: "arquivo ilegível" }),
    );
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(decisaoDo(cenario.banco)?.escalation_reason ?? null).toBeNull();
    expect(cenario.enviarResposta).toHaveBeenCalledTimes(1);
  });

  it("no historico o agente nao pede a foto de novo: a descricao diz para nao pedir", async () => {
    const cenario = comHistorico({
      messageId: FOTO,
      midia: "imagem",
      tipo: "ilegivel",
      resumo: "arquivo ilegível",
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    const conteudos = JSON.stringify(cenario.agente.corpos[0]?.input);
    expect(conteudos).toContain(DESCRICOES_DO_ARQUIVO.ilegivelAntes);
    expect(conteudos).not.toContain(DESCRICOES_DO_ARQUIVO.ilegivel);
    expect(decisaoDo(cenario.banco)?.escalation_reason ?? null).toBeNull();
  });

  it("de novo na mesma janela: a equipe, sem o agente", async () => {
    const cenario = cena({
      mensagens: [
        foto(FOTO, "2026-10-13T14:58:10.000Z"),
        {
          id: "ia-1",
          clinic_id: CLINICA,
          conversation_id: CONVERSA,
          author: "ia",
          direction: "saida",
          content_type: "texto",
          body: PEDE,
          media_url: null,
          deleted_at: null,
          is_internal_note: false,
          pelo_celular: false,
          created_at: "2026-10-13T14:58:20.000Z",
        },
        foto(FOTO_2, "2026-10-13T14:58:40.000Z"),
      ],
      leitura: { [FOTO_2]: leitor({ tipo: "ilegivel" }) },
    });
    cenario.banco.linhas("ai_turno").push({
      job_id: "99999999-0000-4000-8000-000000000001",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "enviado",
      mensagens_lidas: [FOTO],
    });
    cenario.banco.linhas("ia_leitura_da_midia").push(
      leituraNoBanco({ messageId: FOTO, midia: "imagem", tipo: "ilegivel", resumo: "arquivo ilegível" }),
    );
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(cenario.lerComOModelo).toHaveBeenCalledTimes(1);
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_identificada" });
    expect(cenario.agente.create).not.toHaveBeenCalled();
    // A bolha diz que foi para a equipe, porque foi.
    const segunda = cenario.banco.chamadasDe("gravar_leitura_da_midia")[0];
    expect(segunda?.p_resumo).toBe("arquivo ilegível de novo, passado para a equipe");
  });

  it("o ilegivel de antes do Devolver (outra janela) nao conta", async () => {
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "ilegivel" }) },
      resposta: PEDE,
    });
    cenario.banco.linhas("ia_leitura_da_midia").push({
      ...leituraNoBanco({ messageId: "f0700000-0000-4000-8000-000000000099", midia: "imagem", tipo: "ilegivel", resumo: "arquivo ilegível" }),
      created_at: new Date(Date.parse(DESDE) - 60_000).toISOString(),
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(decisaoDo(cenario.banco)?.escalation_reason ?? null).toBeNull();
    expect(ultimaDoPacienteNoAgente(cenario.agente.corpos)).toBe(DESCRICOES_DO_ARQUIVO.ilegivel);
  });

  it("sem conseguir ler a janela: o lado seguro, a equipe", async () => {
    estado.ilegiveis = null;
    const cenario = cena({
      mensagens: [foto()],
      leitura: { [FOTO]: leitor({ tipo: "ilegivel" }) },
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_identificada" });
    expect(cenario.agente.create).not.toHaveBeenCalled();
  });

  it("lerIlegiveisDaJanela: erro ou sem janela devolvem null; so a janela atual e so ilegivel", async () => {
    const banco = new BancoEmMemoria();
    const ids = { clinicId: CLINICA, conversationId: CONVERSA };
    expect(await lerIlegiveisDaJanela(banco.cliente(), ids)).toBeNull();
    banco.linhas("ia_janela_da_conversa").push({
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      desde: DESDE,
    });
    expect(await lerIlegiveisDaJanela(banco.cliente(), ids)).toEqual([]);
    banco.linhas("ia_leitura_da_midia").push(
      { clinic_id: CLINICA, conversation_id: CONVERSA, tipo: "ilegivel", message_id: "a", created_at: DESDE },
      { clinic_id: CLINICA, conversation_id: CONVERSA, tipo: "outro", message_id: "b", created_at: DESDE },
      { clinic_id: CLINICA, conversation_id: CONVERSA, tipo: "ilegivel", message_id: "c", created_at: "2026-01-01T00:00:00.000Z" },
      { clinic_id: "outra", conversation_id: CONVERSA, tipo: "ilegivel", message_id: "d", created_at: DESDE },
      { clinic_id: CLINICA, conversation_id: "outra", tipo: "ilegivel", message_id: "e", created_at: DESDE },
    );
    expect(await lerIlegiveisDaJanela(banco.cliente(), ids)).toEqual(["a"]);
    banco.erros.set("ia_leitura_da_midia:select", { code: "XX000" });
    expect(await lerIlegiveisDaJanela(banco.cliente(), ids)).toBeNull();
    banco.erros.delete("ia_leitura_da_midia:select");
    banco.erros.set("ia_janela_da_conversa:select", { code: "XX000" });
    expect(await lerIlegiveisDaJanela(banco.cliente(), ids)).toBeNull();
  });
});

describe("as descricoes no historico", () => {
  it("o outro respondido: nao pergunta de novo como pode ajudar", async () => {
    const cenario = comHistorico({ messageId: FOTO, midia: "imagem", tipo: "outro", resumo: "arquivo que não é pedido nem documento" });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    const conteudos = JSON.stringify(cenario.agente.corpos[0]?.input);
    expect(conteudos).toContain(DESCRICOES_DO_ARQUIVO.outroAntes);
    expect(conteudos).not.toContain("pergunte como pode ajudar");
  });

  it("a carteirinha sem plano respondida: nao pergunta de novo", async () => {
    const cenario = comHistorico({ messageId: FOTO, midia: "imagem", tipo: "carteirinha", resumo: "carteirinha do convênio" });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    const conteudos = JSON.stringify(cenario.agente.corpos[0]?.input);
    expect(conteudos).toContain(DESCRICOES_DO_ARQUIVO.carteirinhaSemPlanoAntes);
    expect(conteudos).not.toContain("pergunte qual é o convênio");
  });

  it("o pedido parcial respondido: o aviso nao sai de novo, e o resto ficou com a equipe", async () => {
    const cenario = comHistorico({
      messageId: FOTO,
      midia: "imagem",
      tipo: PEDIDO,
      procedimentos: [HEMOGRAMA],
      foraDoCadastro: 2,
      resumo: "pedido com Hemograma; 2 fora do Cadastro, para a equipe conferir",
    });
    await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
    const conteudos = JSON.stringify(cenario.agente.corpos[0]?.input);
    expect(conteudos).toContain("o resto do pedido ficou com a equipe");
    expect(conteudos).not.toContain("o sistema já avisa a pessoa)");
    expect(JSON.stringify(cenario.enviarResposta.mock.calls[0])).not.toContain(AVISO_DO_RESTO_DO_PEDIDO);
  });
});
