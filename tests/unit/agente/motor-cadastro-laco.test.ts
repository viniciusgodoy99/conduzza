import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoSimulador } from "@/lib/agente/agenda";
import type { PortaDaAgenda } from "@/lib/agente/ferramentas/agenda-do-turno";
import {
  custoMaximoDoTurno,
  executarTurnoDoAgente,
  PASSO_SEM_CONSULTA,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { ferramentaDoTurno } from "@/lib/agente/whatsapp";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  catalogoDaAgenda,
  CLINICA,
  configComAgenda,
  FUSO,
} from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  ENDERECO_DA_ALDEOTA,
  linhasDoCadastro,
  UNID,
} from "./cadastro-fixtures";

// O turno do agente com as consultas do Cadastro (AG2, 27/10/2026), com um
// LLM FALSO de roteiro: consultar_unidades, consultar_requisitos e
// buscar_profissionais rodam sobre o catalogo do turno, o resultado volta ao
// modelo e entra nos fatos do turno. O endereco e o horario de funcionamento
// que a ferramenta trouxe passam no filtro; o inventado e barrado pela regra
// (frase fixa e a equipe), sem chamar o verificador. Nenhum teste fala com a
// OpenAI.

const CATALOGO = catalogoDoCadastro();
const IDENTIFICADOR = "a".repeat(64);
const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO,
    _request_id: "req_1",
  };
}

function ferramenta(name: string, args: unknown, callId = randomUUID()) {
  return resposta([
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

function final(mensagem: string) {
  return resposta([
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            mensagem,
            encerra_a_conversa: false,
            perguntas_da_base: [],
          }),
          annotations: [],
        },
      ],
    },
  ]);
}

type Corpo = { input: unknown[]; tools: { name: string }[] };

function clienteComRoteiro(roteiro: unknown[]) {
  const corpos: Corpo[] = [];
  const create = vi.fn(async (corpo: Corpo) => {
    corpos.push(JSON.parse(JSON.stringify(corpo)) as Corpo);
    return roteiro.shift();
  });
  return {
    cliente: { responses: { create } } as unknown as ClienteDoAgente,
    corpos,
  };
}

/** As saidas de ferramenta que voltaram ao modelo numa rodada. */
function saidasDasFerramentas(corpo: Corpo | undefined): unknown[] {
  return (corpo?.input ?? [])
    .filter(
      (item): item is { type: string; output: string } =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: unknown }).type === "function_call_output",
    )
    .map((item) => JSON.parse(item.output) as unknown);
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

let verificador: ReturnType<typeof vi.fn<Verificador>>;
let banco: AgendaEmMemoria;

function paciente(texto: string): MensagemDaConversa {
  return { autor: "paciente", texto };
}

function porta(): PortaDaAgenda {
  return portaDaAgendaDoSimulador(banco.cliente(), {
    clinicId: CLINICA,
    agora: () => AGORA,
  });
}

function entrada(
  extra: Partial<EntradaDoTurno> & { cliente: ClienteDoAgente | null },
): EntradaDoTurno {
  return {
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: IDENTIFICADOR,
    config: configComAgenda(),
    catalogo: CATALOGO,
    // Uma resposta do assistente ja saiu: sem saudacao e sem aviso.
    mensagens: [
      paciente("Oi"),
      { autor: "assistente", texto: "Olá! Como posso ajudar?" },
      paciente("Onde fica a clínica e até que horas abre?"),
    ],
    agoraMs: AGORA,
    fuso: FUSO,
    verificador,
    classificador,
    agenda: porta(),
    ...extra,
  };
}

async function turno(roteiro: unknown[], extra: Partial<EntradaDoTurno> = {}) {
  const { cliente, corpos } = clienteComRoteiro(roteiro);
  verificador.mockClear();
  const r = await executarTurnoDoAgente(entrada({ cliente, ...extra }));
  return { r, corpos };
}

beforeEach(() => {
  banco = bancoComJornadas();
  verificador = vi.fn<Verificador>(
    async (): Promise<ResultadoDoVerificador> => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    }),
  );
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function barrouPor(
  r: Awaited<ReturnType<typeof executarTurnoDoAgente>>,
  categoria: string,
) {
  expect(r.tipo).toBe("frase_fixa");
  expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
  expect(r.desfecho).toEqual({
    tipo: "bloqueou",
    categoria,
    camada: "regra",
    motivoDaFalha: null,
  });
  expect(verificador).not.toHaveBeenCalled();
}

const UNIDADE_ALDEOTA = { unidade: "u1" };

describe("consultar_unidades no turno", () => {
  it("o endereço que a ferramenta trouxe passa; a saída volta ao modelo e a trilha diz o que foi consultado", async () => {
    const { r, corpos } = await turno([
      ferramenta("consultar_unidades", UNIDADE_ALDEOTA),
      final(`A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`),
    ]);
    expect(r.tipo).toBe("resposta");
    expect(verificador).toHaveBeenCalledTimes(1);
    expect(r.ferramentasUsadas).toEqual(["consultar_unidades"]);
    expect(r.trilha).toContainEqual({
      tipo: "cadastro",
      texto: "Consultou a unidade Aldeota",
    });
    expect(r.trilha.map((p) => p.texto)).not.toContain(PASSO_SEM_CONSULTA);
    const [saida] = saidasDasFerramentas(corpos[1]);
    expect(saida).toMatchObject({
      resultado: "unidades",
      unidades: [{ codigo: "u1", endereco: ENDERECO_DA_ALDEOTA }],
    });
    expect(JSON.stringify(saida)).not.toMatch(/60150|https|\(85\)/);
    // As tres consultas vao ao modelo com o agente ligado.
    expect(corpos[0]?.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "consultar_unidades",
        "consultar_requisitos",
        "buscar_profissionais",
      ]),
    );
  });

  it("o endereço abreviado de outro jeito passa; outro número ou outra rua são barrados", async () => {
    const ok = await turno([
      ferramenta("consultar_unidades", { unidade: null }),
      final(
        "Temos a unidade Aldeota, na Avenida Santos Dumont, 1500, e a do Centro, na R. Barão do Rio Branco, 900.",
      ),
    ]);
    expect(ok.r.tipo).toBe("resposta");
    const outroNumero = await turno([
      ferramenta("consultar_unidades", UNIDADE_ALDEOTA),
      final("A unidade Aldeota fica na Av. Santos Dumont, 1600."),
    ]);
    barrouPor(outroNumero.r, "endereco_nao_verificado");
    const outraRua = await turno([
      ferramenta("consultar_unidades", UNIDADE_ALDEOTA),
      final("A unidade Aldeota fica na Rua Monsenhor Tabosa, 1500."),
    ]);
    barrouPor(outraRua.r, "endereco_nao_verificado");
  });

  it("sem a ferramenta no turno (e sem a base), o endereço é barrado", async () => {
    const { r } = await turno([
      final(`A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`),
    ]);
    barrouPor(r, "endereco_nao_verificado");
  });

  it("o horário de funcionamento que a ferramenta trouxe passa, em outro formato; o inventado é barrado", async () => {
    const ok = await turno([
      ferramenta("consultar_unidades", UNIDADE_ALDEOTA),
      final(
        "A Aldeota funciona de segunda a sexta, das 8h às 12h e das 14h às 18h, e no sábado das 8h às 12h.",
      ),
    ]);
    expect(ok.r.tipo).toBe("resposta");
    const inventado = await turno([
      ferramenta("consultar_unidades", UNIDADE_ALDEOTA),
      final("A Aldeota funciona de segunda a sexta, das 7h às 19h."),
    ]);
    barrouPor(inventado.r, "horario_nao_verificado");
    const semFerramenta = await turno([
      final("A clínica funciona de segunda a sexta, das 8h às 18h."),
    ]);
    barrouPor(semFerramenta.r, "horario_nao_verificado");
  });

  it("sem unidade cadastrada, a ferramenta diz e o modelo passa para a equipe", async () => {
    const { r, corpos } = await turno(
      [
        ferramenta("consultar_unidades", { unidade: null }),
        ferramenta("escalar_humano", { motivo: "agente_pediu" }),
      ],
      { catalogo: catalogoDaAgenda() },
    );
    expect(saidasDasFerramentas(corpos[1])).toEqual([
      { resultado: "sem_unidade_cadastrada" },
    ]);
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "agente_pediu",
      gatilho: null,
      origem: "agente",
    });
  });
});

describe("consultar_requisitos no turno", () => {
  it("os requisitos administrativos que a ferramenta trouxe passam", async () => {
    const mensagens: MensagemDaConversa[] = [
      paciente("Oi"),
      { autor: "assistente", texto: "Olá! Como posso ajudar?" },
      paciente("O que preciso levar para a consulta pela Unimed Nacional?"),
    ];
    const requisitos = () =>
      ferramenta("consultar_requisitos", {
        procedimento: "p1",
        convenio: "Unimed Nacional",
      });
    const resposta =
      "Para a Consulta pela Unimed Nacional, leve um documento com foto e a carteirinha do convênio, chegue 15 minutos antes e tenha a autorização prévia do convênio.";
    // Revisao 2 da AG2: citar o convenio afirmando (regra invertida) exige o
    // fato dele; consultar_requisitos nao diz que a clinica atende o
    // convenio, buscar_procedimento diz.
    const { r } = await turno(
      [
        ferramenta("buscar_procedimento", {
          procedimento: "p1",
          convenio: "Unimed Nacional",
        }),
        requisitos(),
        final(resposta),
      ],
      { mensagens },
    );
    expect(r.tipo).toBe("resposta");
    expect(r.trilha).toContainEqual({
      tipo: "cadastro",
      texto:
        "Consultou o que o paciente precisa para Consulta pelo convênio Unimed (Nacional): 4 itens",
    });
    // So com os requisitos, o nome do convenio afirmado e barrado; sem o
    // nome ("a carteirinha do convenio"), os itens passam.
    barrouPor(
      (await turno([requisitos(), final(resposta)], { mensagens })).r,
      "cobertura_nao_verificada",
    );
    const semONome = await turno(
      [
        requisitos(),
        final(
          "Para a Consulta, leve um documento com foto e a carteirinha do convênio, chegue 15 minutos antes e tenha a autorização prévia do convênio.",
        ),
      ],
      { mensagens },
    );
    expect(semONome.r.tipo).toBe("resposta");
  });

  it("preparo clínico (jejum) nunca passa, venha de onde vier", async () => {
    const { r } = await turno([
      ferramenta("consultar_requisitos", {
        procedimento: "p2",
        convenio: null,
      }),
      final("Para o Exame, traga o pedido médico e venha em jejum de 8 horas."),
    ]);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "orientacao_clinica",
      camada: "regra",
    });
  });
});

describe("buscar_profissionais no turno", () => {
  it("o convênio que o profissional atende vira fato: 'atende pelo Amil' passa; sem a ferramenta, é barrado", async () => {
    const texto = "O Dr. Bruno Costa atende pelo Amil.";
    const ok = await turno([
      ferramenta("buscar_profissionais", {
        especialidade: null,
        procedimento: null,
        convenio: "Amil",
        unidade: null,
      }),
      final(texto),
    ]);
    expect(ok.r.tipo).toBe("resposta");
    expect(ok.r.trilha).toContainEqual({
      tipo: "cadastro",
      texto: "Consultou os profissionais (convênio Amil): Dr. Bruno Costa",
    });
    const sem = await turno([final(texto)]);
    barrouPor(sem.r, "cobertura_nao_verificada");
  });

  it("o código da unidade vem de consultar_unidades no mesmo turno; quatro consultas cabem nas rodadas", async () => {
    const { r, corpos } = await turno([
      ferramenta("consultar_unidades", { unidade: null }),
      ferramenta("buscar_profissionais", {
        especialidade: "Dermatologia",
        procedimento: null,
        convenio: null,
        unidade: "u1",
      }),
      ferramenta("buscar_procedimento", { procedimento: "p4", convenio: null }),
      final(
        "Na Aldeota, a Dra. Ana Lima faz o Botox, que custa R$ 1.200,00. A marcação dele é feita pela equipe.",
      ),
    ]);
    expect(r.tipo).toBe("resposta");
    expect(r.ferramentasUsadas).toEqual([
      "consultar_unidades",
      "buscar_profissionais",
      "buscar_procedimento",
    ]);
    expect(saidasDasFerramentas(corpos[2])[1]).toMatchObject({
      resultado: "profissionais",
      profissionais: [{ nome: "Dra. Ana Lima", unidades: ["Aldeota"] }],
    });
    expect(r.trilha.map((p) => p.tipo)).toEqual(
      expect.arrayContaining(["cadastro", "preco"]),
    );
  });

  it("entrada fora do formato volta ao modelo como resultado, sem derrubar o turno", async () => {
    const { r, corpos } = await turno([
      ferramenta("buscar_profissionais", { especialidade: "Dermatologia" }),
      final("Pode me dizer qual especialidade você procura?"),
    ]);
    expect(r.tipo).toBe("resposta");
    expect(saidasDasFerramentas(corpos[1])).toEqual([
      { resultado: "entrada_invalida" },
    ]);
  });

  it("com 'Informar preço e convênio' desligada, a consulta não fala do convênio e buscar_procedimento não vai", async () => {
    const base = configComAgenda();
    const config = configComAgenda({
      habilidades: { ...base.habilidades, informar_preco_e_convenio: false },
    });
    const { r, corpos } = await turno(
      [
        ferramenta("buscar_profissionais", {
          especialidade: null,
          procedimento: null,
          convenio: "Amil",
          unidade: null,
        }),
        ferramenta("escalar_humano", { motivo: "agente_pediu" }),
      ],
      { config },
    );
    expect(corpos[0]?.tools.map((t) => t.name)).not.toContain(
      "buscar_procedimento",
    );
    expect(corpos[0]?.tools.map((t) => t.name)).toContain(
      "buscar_profissionais",
    );
    expect(saidasDasFerramentas(corpos[1])).toEqual([
      { resultado: "informar_convenio_desligado" },
    ]);
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "agente_pediu",
    });
  });
});

describe("buscar_procedimento ampliada no turno", () => {
  it("o valor do procedimento que só a equipe marca entra nos preços do turno; outro valor é barrado", async () => {
    const ok = await turno([
      ferramenta("buscar_procedimento", { procedimento: "p4", convenio: null }),
      final(
        "O Botox custa R$ 1.200,00 com a Dra. Ana Lima. A marcação é feita pela nossa equipe.",
      ),
    ]);
    expect(ok.r.tipo).toBe("resposta");
    const outro = await turno([
      ferramenta("buscar_procedimento", { procedimento: "p4", convenio: null }),
      final("O Botox custa R$ 1.100,00 com a Dra. Ana Lima."),
    ]);
    barrouPor(outro.r, "preco_nao_verificado");
  });
});

describe("buscar_horario: agenda não cadastrada", () => {
  it("sem jornada de quem faz, o resultado diz e o modelo passa para a equipe", async () => {
    banco = new AgendaEmMemoria();
    const { r, corpos } = await turno([
      ferramenta("buscar_horario", {
        procedimento: "p1",
        profissional: null,
        convenio: null,
        a_partir_de: null,
        periodo: null,
      }),
      ferramenta("escalar_humano", { motivo: "pedido_de_agenda" }),
    ]);
    expect(saidasDasFerramentas(corpos[1])).toEqual([
      {
        resultado: "agenda_nao_cadastrada",
        procedimento: "Consulta",
        convenio: "particular",
      },
    ]);
    expect(r.trilha).toContainEqual({
      tipo: "agenda",
      texto:
        "Consultou a agenda de Consulta, no particular: a agenda de quem faz este procedimento não está cadastrada",
    });
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "pedido_de_agenda",
    });
  });
});

describe("tool_used e custo", () => {
  it("a consulta do Cadastro pesa menos que o preço e a agenda", () => {
    const respondeu = { tipo: "respondeu" as const };
    expect(
      ferramentaDoTurno({
        desfecho: respondeu,
        trilha: [],
        ferramentasUsadas: ["consultar_unidades"],
      }),
    ).toBe("consultar_unidades");
    expect(
      ferramentaDoTurno({
        desfecho: respondeu,
        trilha: [],
        ferramentasUsadas: ["consultar_requisitos", "buscar_profissionais"],
      }),
    ).toBe("buscar_profissionais");
    expect(
      ferramentaDoTurno({
        desfecho: respondeu,
        trilha: [],
        ferramentasUsadas: ["consultar_unidades", "buscar_procedimento"],
      }),
    ).toBe("buscar_procedimento");
    expect(
      ferramentaDoTurno({
        desfecho: respondeu,
        trilha: [],
        ferramentasUsadas: ["consultar_requisitos", "buscar_horario"],
      }),
    ).toBe("buscar_horario");
  });

  it("o custo máximo do turno conta a maior saída das consultas do Cadastro", () => {
    const precos = [
      {
        modelo: "gpt-6-luna",
        entrada: 100_000,
        saida: 500_000,
        cacheLeitura: 10_000,
        cacheEscrita: 125_000,
      },
    ];
    const custo = (catalogo: typeof CATALOGO) =>
      custoMaximoDoTurno({
        config: configComAgenda(),
        catalogo,
        mensagens: [paciente("Onde fica?")],
        agoraMs: AGORA,
        fuso: FUSO,
        modelo: "gpt-6-luna",
        modeloDosClassificadores: "gpt-6-luna",
        precos,
      }) ?? 0;
    // Muitas unidades com textos longos: a saida de consultar_unidades e a
    // maior e o custo sobe (o bloco das instrucoes nao muda: unidade nao vai
    // a ele).
    const linhas = linhasDoCadastro();
    const muitas = catalogoDoCadastro({
      unidades: Array.from({ length: 30 }, (_, i) => ({
        id: `${UNID.aldeota.slice(0, -2)}${String(i).padStart(2, "0")}`,
        name: `Unidade ${i + 1}`,
        active: true,
        logradouro: "Av. Santos Dumont",
        numero: String(100 + i),
        bairro: "Aldeota",
        cidade: "Fortaleza",
        uf: "CE",
        referencia: "Em frente à praça Portugal, ao lado do banco.".repeat(4),
        estacionamento: "Estacionamento no subsolo do prédio.",
        acessibilidade: "Acesso por rampa e elevador.",
      })),
      jornadas: linhas.jornadas,
    });
    expect(custo(muitas)).toBeGreaterThan(custo(CATALOGO));
  });
});
