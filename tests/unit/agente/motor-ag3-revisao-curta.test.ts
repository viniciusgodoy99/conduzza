import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  portaDaAgendaDoSimulador,
  portaDaAgendaDoWhatsapp,
  type MemoriaDoSimulador,
} from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  perguntaConfirmaAReserva,
  type EstadoDoAtendimento,
  type ReservaPerguntada,
} from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { mascararNome } from "@/lib/agente/historico";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  mascararParaOVerificador,
  pareceNomeDePessoa,
} from "@/lib/domain/conformidade/minimizar";
import type {
  EntradaDoVerificador,
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import { bancoDaAg3, rpcsDaAg3 } from "./ag3-contrato";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, UNID } from "./cadastro-fixtures";

// A revisao curta das correcoes da AG3 (27/10/2026), em pecas e em
// conversas de varias falas com um LLM FALSO de roteiro sobre o contrato das
// RPCs em memoria (ag3-contrato.ts):
//  - achado 1 (ALTO, CFM): o classificador le o texto sem mascara de nome e
//    de nascimento; o verificador recebe so o nome que o servidor validou no
//    turno e que parece nome, e o nascimento. O sintoma dito depois do nome
//    chega aos dois;
//  - achado 2: "Confirma" com outro profissional citado so pelo primeiro
//    nome ou pelo sobrenome nao arma a etapa;
//  - achado 8: a pergunta "Confirma" conferida pela mensagem inteira (todo
//    dia e hora sao os da reserva; "hoje" e "amanha" batem com o dia dela);
//  - achado 10: o simulador na ordem do banco (reserva_inexistente,
//    reserva_diferente, reserva_vencida) e a unidade da consulta lida.
// Nenhum teste fala com a OpenAI nem com o banco.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const IDENTIFICADOR = "a".repeat(64);
const NOME_DO_CONTATO = "Maria Souza";
const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};
const USO_LIDO = {
  tokensEntrada: 1_000,
  tokensSaida: 60,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
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

function ferramenta(name: string, args: unknown) {
  const callId = randomUUID();
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

const aprovador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
});

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

/** O sintoma que o portao deterministico NAO pega e um modelo pegaria. */
const SINTOMA_DO_MODELO =
  /dente mole|empipocad|pontada|cabelo ta caindo|unha encravada/i;

/** Um classificador "esperto": ve o sintoma quando ele chega no texto. */
function classificadorQueVe(vistos: string[]): ClassificadorDeEntrada {
  return async ({ mensagens }) => {
    vistos.push(...mensagens);
    return mensagens.some((m) => SINTOMA_DO_MODELO.test(m))
      ? {
          tipo: "classificacao",
          classificacao: { gatilhos: ["sintoma"], confianca: "alta" },
          modelo: "gpt-6-luna",
          uso: { ...USO_LIDO },
        }
      : LIMPO;
  };
}

/** Um verificador "esperto": reprova o "pode sim" quando ve o sintoma. */
function verificadorQueVe(vistos: EntradaDoVerificador[]): Verificador {
  return async (pedido) => {
    vistos.push(pedido);
    const ve = pedido.mensagensDoPaciente.some((m) => SINTOMA_DO_MODELO.test(m));
    const aprovado = !(ve && /pode sim/i.test(pedido.rascunho));
    return {
      tipo: "veredicto",
      veredicto: aprovado
        ? { aprovado: true, violacoes: [], confianca: "alta" }
        : {
            aprovado: false,
            violacoes: [{ categoria: "triagem", gravidade: "alta" }],
            confianca: "alta",
          },
      modelo: "gpt-6-luna",
      uso: { ...USO_LIDO },
    };
  };
}

/** A busca de buscar_horario com todas as chaves (strict). */
function busca(extra: Record<string, unknown> = {}) {
  return {
    procedimento: P_CONSULTA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...extra,
  };
}

const REGISTRO = {
  nome_completo: "Fulano da Silva Souza",
  data_nascimento: "1985-03-12",
  para_o_titular: true,
  campos_mascarados: [],
};

const CONFIRMA_QUARTA =
  "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";

let banco: AgendaEmMemoria;
let agora = AGORA;

type Fala = { texto: string; roteiro: unknown[] };

/**
 * Uma conversa: cada fala do paciente roda um turno inteiro, com o estado
 * do turno anterior e um job novo, dois minutos depois.
 */
class Conversa {
  mensagens: MensagemDaConversa[] = [];
  atendimento: AtendimentoDoTurno;
  corpos: Record<string, unknown>[] = [];
  jobs: string[] = [];
  config = configComAgenda();
  chamadasDoModelo = 0;

  constructor(atendimento?: AtendimentoDoTurno) {
    this.atendimento = atendimento ?? {
      estado: estadoVazio(),
      dados: dadosVazios(["nome_completo", "data_nascimento"]),
    };
  }

  async fala(
    { texto, roteiro }: Fala,
    extra: Partial<EntradaDoTurno> = {},
  ): Promise<ResultadoDoTurno> {
    if (this.jobs.length > 0) {
      agora += 2 * 60_000;
    }
    const job = randomUUID();
    this.jobs.push(job);
    this.mensagens.push({
      autor: "paciente",
      texto: mascararNome(texto, NOME_DO_CONTATO),
      textoOriginal: texto,
    });
    const create = vi.fn(async (corpo: unknown) => {
      this.chamadasDoModelo += 1;
      this.corpos.push(structuredClone(corpo) as Record<string, unknown>);
      return roteiro.shift();
    });
    const momento = agora;
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: IDENTIFICADOR,
      config: this.config,
      catalogo: CATALOGO,
      mensagens: [...this.mensagens],
      agoraMs: momento,
      fuso: FUSO,
      verificador: aprovador,
      classificador,
      agenda: portaDaAgendaDoWhatsapp(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: job,
        agora: () => momento,
      }),
      atendimento: this.atendimento,
      agora: () => momento,
      ...extra,
    });
    this.mensagens.push({ autor: "assistente", texto: r.resposta });
    if (r.atendimento) {
      this.atendimento = {
        estado: r.atendimento.estado,
        dados: r.atendimento.dados,
      };
    }
    return r;
  }

  get estado(): EstadoDoAtendimento {
    return this.atendimento.estado;
  }
}

function saidas(corpo: Record<string, unknown> | undefined) {
  return ((corpo?.input as { type?: string; output?: string }[]) ?? [])
    .filter((item) => item.type === "function_call_output")
    .map((item) => JSON.parse(item.output ?? "{}") as Record<string, unknown>);
}

beforeEach(() => {
  agora = AGORA;
  banco = bancoDaAg3();
  rpcsDaAg3(banco, {
    catalogo: CATALOGO,
    exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
    agora: () => agora,
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A oferta e a reserva de quarta, 21/10 as 14:00 (h2, Dra. Ana, Centro). */
async function ateAReserva(conversa: Conversa) {
  await conversa.fala({
    texto: "Quero marcar uma consulta à tarde, no particular",
    roteiro: [
      ferramenta("buscar_horario", busca({ periodo: "tarde" })),
      final(
        "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
      ),
    ],
  });
  await conversa.fala({
    texto: "Pode ser quarta às 14h",
    roteiro: [
      ferramenta("reservar_horario", { horario: "h2" }),
      final(
        "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
      ),
    ],
  });
}

/** O turno dos dados, com a resposta dada. */
async function turnoDosDados(conversa: Conversa, mensagem: string) {
  return conversa.fala({
    texto: "Maria da Silva Souza, nascida em 12/03/1985",
    roteiro: [ferramenta("registrar_dados_do_paciente", REGISTRO), final(mensagem)],
  });
}

// ---------------------------------------------------------------------------
// Achado 1 (ALTO, CFM): a mascara do nome nao esconde sintoma
// ---------------------------------------------------------------------------

describe("achado 1: o que parece nome (pareceNomeDePessoa)", () => {
  it.each([
    "Maria da Silva Souza",
    "Ana Lima",
    "carla mendes",
    "Fulano Aparecida da Silva Souza",
    "Aparecida da Silva Souza",
    "MARIA DAS DORES SILVA",
    "Maria do Socorro Lima",
    "João D'Ávila",
    "Ana-Maria Ramos Dias",
    "José Carlos de Oliveira Filho",
  ])("parece nome: %s", (nome) => {
    expect(pareceNomeDePessoa(nome)).toBe(true);
  });

  it.each([
    // O sintoma dito depois do nome, mesmo que o modelo mande registrar.
    "ana e to com o dente mole",
    "Ana e to com o dente mole",
    "carla mendes e tomo remedio pra pressao",
    "ana e to toda empipocada desde ontem",
    "Ana Paula e to sentindo uma pontada forte",
    "joao e meu peito esta apertado",
    "Joana Lima Santos estou gravida",
    "ana e minha boca ta toda ferida",
    "ana lima sinto dor",
    "ana tô com dor",
    "carla mendes uso marcapasso",
    // Fora da forma: uma palavra, so particula, digito, sete palavras.
    "Ana",
    "Ana e",
    "da Silva",
    "Maria 2",
    "Ana Lima Souza Costa Ramos Dias Neto",
  ])("não parece nome: %s", (nome) => {
    expect(pareceNomeDePessoa(nome)).toBe(false);
  });
});

describe("achado 1: a cópia do verificador (mascararParaOVerificador)", () => {
  const ANO = 2026;
  it.each([
    // Os tres exemplos da revisao: com o registro ruim (a frase inteira como
    // nome) ou sem nome validado, o texto chega inteiro.
    [
      "Oi, boa tarde! Me chamo Ana e to com o dente mole, posso fazer a limpeza?",
      ["Ana e to com o dente mole"],
      "Oi, boa tarde! Me chamo Ana e to com o dente mole, posso fazer a limpeza?",
    ],
    [
      "Oi, boa tarde! Me chamo Ana e to com o dente mole, posso fazer a limpeza?",
      [],
      "Oi, boa tarde! Me chamo Ana e to com o dente mole, posso fazer a limpeza?",
    ],
    [
      "me chamo ana e to toda empipocada desde ontem, posso fazer a limpeza amanha?",
      ["ana e to toda empipocada desde ontem"],
      "me chamo ana e to toda empipocada desde ontem, posso fazer a limpeza amanha?",
    ],
    [
      "meu nome é carla mendes e tomo remedio pra pressao, tem problema?",
      ["carla mendes e tomo remedio pra pressao"],
      "meu nome é carla mendes e tomo remedio pra pressao, tem problema?",
    ],
    // Com o nome validado, so ele some: o sintoma fica.
    [
      "meu nome é carla mendes e tomo remedio pra pressao, tem problema?",
      ["Carla Mendes"],
      "meu nome é [nome] e tomo remedio pra pressao, tem problema?",
    ],
    [
      "Me chamo Ana Paula e to sentindo uma pontada forte do lado direito, da pra ir assim mesmo?",
      ["Ana Paula"],
      "Me chamo [nome] e to sentindo uma pontada forte do lado direito, da pra ir assim mesmo?",
    ],
    [
      "Me chamo Carla Mendes, nasci em 12/03/1985 e to com o dente mole. Posso fazer a limpeza?",
      ["Carla Mendes"],
      "Me chamo [nome], nasci em [nascimento] e to com o dente mole. Posso fazer a limpeza?",
    ],
    [
      "Maria da Silva Souza, nascida em 12/03/1985",
      ["Maria da Silva Souza"],
      "[nome], nascida em [nascimento]",
    ],
    // A heuristica da deixa nao existe mais: sem nome validado, "me chamo"
    // nao esconde nada (o nascimento, sim).
    [
      "me chamo ana e minha vista anda embacada, nasci em 1985-03-12",
      [],
      "me chamo ana e minha vista anda embacada, nasci em [nascimento]",
    ],
    // O nome validado que nao esta no texto nao mexe em nada.
    [
      "me chamo ana e to com o rosto todo inchado, da pra fazer?",
      ["Ana Lima"],
      "me chamo ana e to com o rosto todo inchado, da pra fazer?",
    ],
    // A data da consulta (deste ano) fica.
    [
      "Pode ser quarta, 21/10/2026 às 14h?",
      [],
      "Pode ser quarta, 21/10/2026 às 14h?",
    ],
  ])("%s", (texto, nomesValidados, esperado) => {
    expect(mascararParaOVerificador(texto, { anoCorrente: ANO, nomesValidados })).toBe(
      esperado,
    );
  });

  it("o portão determinístico não pega 'dente mole' nem 'empipocada': por isso o classificador precisa do texto inteiro", () => {
    for (const texto of [
      "Oi, boa tarde! Me chamo Ana e to com o dente mole, posso fazer a limpeza?",
      "me chamo ana e to toda empipocada desde ontem, posso fazer a limpeza amanha?",
    ]) {
      expect(detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] })).toEqual(
        [],
      );
    }
  });
});

describe("achado 1: o sintoma dito depois do nome chega ao classificador (conversa)", () => {
  it("primeira mensagem, numa clínica que pede nome e nascimento: o classificador lê o texto e passa por sintoma", async () => {
    const conversa = new Conversa();
    const vistos: string[] = [];
    const texto =
      "Oi, boa tarde! Me chamo Ana e to com o dente mole, posso fazer a limpeza?";
    const r = await conversa.fala(
      { texto, roteiro: [final("Pode sim! Quer marcar?")] },
      { classificador: classificadorQueVe(vistos) },
    );
    expect(vistos).toEqual([texto]);
    expect(conversa.chamadasDoModelo).toBe(0);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "sintoma",
      gatilho: "sintoma",
      origem: "classificador",
    });
  });

  it.each([
    "me chamo ana e to toda empipocada desde ontem, posso fazer a limpeza amanha?",
    "me chamo ana e to com o dente mole, posso fazer a limpeza?",
    "Meu nome é Ana Paula Lima e to com o dente mole, posso fazer a limpeza?",
    "Nome completo: Joana Lima Santos e to toda empipocada, posso ir assim?",
    "me chamo ana e meu cabelo ta caindo muito, posso fazer?",
    "me chamo ana e to com a unha encravada, posso ir?",
  ])("no turno da coleta (reserva viva): '%s' chega inteiro e passa por sintoma", async (texto) => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const antes = conversa.chamadasDoModelo;
    const vistos: string[] = [];
    const r = await conversa.fala(
      { texto, roteiro: [final("Pode sim! Me envie sua data de nascimento, por favor.")] },
      { classificador: classificadorQueVe(vistos) },
    );
    expect(vistos).toEqual([texto]);
    expect(conversa.chamadasDoModelo).toBe(antes);
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "sintoma",
      origem: "classificador",
    });
  });

  it("'meu nome é carla mendes e tomo remedio pra pressao' passa antes de qualquer modelo (portão)", async () => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const antes = conversa.chamadasDoModelo;
    const vistos: string[] = [];
    const r = await conversa.fala(
      {
        texto: "meu nome é carla mendes e tomo remedio pra pressao, tem problema?",
        roteiro: [final("Pode sim!")],
      },
      { classificador: classificadorQueVe(vistos) },
    );
    expect(conversa.chamadasDoModelo).toBe(antes);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
  });
});

describe("achado 1: o sintoma dito depois do nome chega ao verificador (conversa)", () => {
  it("o nome validado some, o nascimento some, o sintoma fica: o verificador barra o 'pode sim'", async () => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const vistos: EntradaDoVerificador[] = [];
    const r = await conversa.fala(
      {
        texto:
          "Me chamo Carla Mendes, nasci em 12/03/1985 e to com o dente mole. Posso fazer a limpeza?",
        roteiro: [
          ferramenta("registrar_dados_do_paciente", {
            ...REGISTRO,
            nome_completo: "Carla Mendes",
          }),
          final(`Pode sim! ${CONFIRMA_QUARTA}`),
        ],
      },
      { verificador: verificadorQueVe(vistos) },
    );
    expect(saidas(conversa.corpos.at(-1))[0]).toMatchObject({
      resultado: "registrado",
    });
    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.mensagensDoPaciente).toEqual([
      "Me chamo [nome], nasci em [nascimento] e to com o dente mole. Posso fazer a limpeza?",
    ]);
    expect(vistos[0]?.rascunho).not.toMatch(/Carla|Mendes|1985/);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "triagem",
      camada: "modelo",
    });
    // Barrado e passado para a equipe: a etapa nao arma.
    expect(r.atendimento?.estado.etapa).not.toBe("aguardando_confirmacao");
  });

  it("o modelo manda registrar a frase inteira como nome: o servidor aceita, mas ela não parece nome e chega inteira ao verificador", async () => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const vistos: EntradaDoVerificador[] = [];
    const texto =
      "me chamo ana e to com o dente mole, nasci em 12/03/1985, posso fazer a limpeza?";
    const r = await conversa.fala(
      {
        texto,
        roteiro: [
          ferramenta("registrar_dados_do_paciente", {
            ...REGISTRO,
            nome_completo: "ana e to com o dente mole",
          }),
          final("Pode sim! Anotei seus dados."),
        ],
      },
      { verificador: verificadorQueVe(vistos) },
    );
    expect(vistos[0]?.mensagensDoPaciente).toEqual([
      "me chamo ana e to com o dente mole, nasci em [nascimento], posso fazer a limpeza?",
    ]);
    expect(vistos[0]?.mensagensDoPaciente.join(" ")).not.toContain("[nome]");
    expect(r.desfecho).toMatchObject({ tipo: "bloqueou", camada: "modelo" });
  });

  it("fora do turno da coleta e sem nome validado, o verificador recebe o texto como está", async () => {
    const conversa = new Conversa({ estado: estadoVazio(), dados: dadosVazios() });
    const vistos: EntradaDoVerificador[] = [];
    const texto = "Me chamo Ana Lima, nasci em 12/03/1985. Vocês abrem sábado?";
    await conversa.fala(
      { texto, roteiro: [final("Abrimos sim, de 8h às 12h.")] },
      { verificador: verificadorQueVe(vistos) },
    );
    // (o filtro pode barrar o horario sem fato antes do verificador: so
    // importa que, quando ele roda, recebe o texto inteiro)
    for (const pedido of vistos) {
      expect(pedido.mensagensDoPaciente).toEqual([texto]);
    }
  });
});

// ---------------------------------------------------------------------------
// Achados 2 e 8: a pergunta "Confirma" conferida pela mensagem inteira
// ---------------------------------------------------------------------------

const RESERVA: ReservaPerguntada = {
  dia: "quarta, 21/10",
  hora: "14:00",
  profissional: "Dra. Ana Lima",
  unidade: "Centro",
  profissionais: ["Dra. Ana Lima", "Dr. Bruno Costa"],
  unidades: ["Centro", "Aldeota"],
  diaNaClinica: "2026-10-21",
  hojeNaClinica: "2026-10-20",
};

const RESERVA_BRUNO: ReservaPerguntada = {
  ...RESERVA,
  profissional: "Dr. Bruno Costa",
  unidade: null,
};

describe("achados 2 e 8: perguntaConfirmaAReserva", () => {
  const casos: [string, ReservaPerguntada, boolean, string][] = [
    // Achado 2: outro profissional so pelo primeiro nome ou sobrenome.
    ["Confirma a consulta com a Ana na quarta, 21/10 às 14:00?", RESERVA_BRUNO, false, "primeiro nome de outro sem título"],
    ["Confirma a consulta com a doutora Ana na quarta, 21/10 às 14:00?", RESERVA_BRUNO, false, "doutora + primeiro nome de outro"],
    ["Confirma a consulta com a Dra Ana na quarta, 21/10 às 14:00?", RESERVA_BRUNO, false, "Dra sem ponto"],
    ["Confirma a consulta com a Lima na quarta, 21/10 às 14:00?", RESERVA_BRUNO, false, "sobrenome de outro"],
    ["Confirma a consulta com Ana Lima na quarta, 21/10 às 14:00?", RESERVA_BRUNO, false, "nome completo de outro sem título"],
    ["Confirma a consulta com a Costa na quarta, 21/10 às 14:00?", RESERVA, false, "sobrenome do outro (reserva Ana)"],
    ["Confirma a consulta com o Bruno na quarta, 21/10 às 14:00?", RESERVA, false, "primeiro nome do outro (reserva Ana)"],
    ["Confirma a Consulta com o Bruno na quarta, 21/10 às 14:00, na unidade Centro, no particular?", RESERVA, false, "o exemplo da revisão"],
    ["Confirma a consulta com a Ana na quarta, 21/10 às 14:00?", RESERVA, true, "o primeiro nome da própria reserva"],
    ["Confirma a consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00?", RESERVA, true, "o nome inteiro da reserva"],
    // A unidade.
    ["Confirma a consulta na quarta, 21/10 às 14:00, no Centro?", RESERVA_BRUNO, false, "unidade citada sem a palavra, reserva sem unidade"],
    ["Confirma a consulta na quarta, 21/10 às 14:00, na Aldeota?", RESERVA, false, "outra unidade sem a palavra"],
    ["Confirma a consulta na quarta, 21/10 às 14:00, na unidade Centro?", RESERVA, true, "a unidade da reserva"],
    // Dia e hora.
    ["Confirma a consulta na quarta, 21/11 às 14:00?", RESERVA, false, "mês errado"],
    ["Confirma a consulta na quarta, 21/10 às 14h?", RESERVA, true, "14h"],
    ["Confirma a consulta na quarta, 21/10 às 14 horas?", RESERVA, true, "14 horas"],
    ["Confirma a consulta na quarta, 21/10 às 2 da tarde?", RESERVA, true, "2 da tarde"],
    ["Confirma a consulta na quarta, 21/10 às 14:00 (duração de 30 minutos)?", RESERVA, true, "duração"],
    ["Confirma a consulta na quarta, 21/10, das 14:00 às 14:30?", RESERVA, false, "intervalo"],
    ["Confirma a consulta na quarta, 21/10 às 14:00, valor R$ 150,00?", RESERVA, true, "preço"],
    ["Confirma a consulta na quarta, 21/10 às 14:00, valor R$ 1.500?", RESERVA, true, "preço com milhar"],
    ["Confirma a consulta na quarta-feira, 21/10/2026 às 14:00?", RESERVA, true, "com o ano da reserva"],
    ["Confirma a consulta na quarta-feira, 21/10/2027 às 14:00?", RESERVA, false, "com outro ano"],
    ["Confirma a consulta na quarta (21/10) às 14:00?", RESERVA, true, "parênteses"],
    ["Confirma: quarta, 21/10 às 14:00 com a Dra. Ana Lima?", RESERVA, true, "confirma dois pontos"],
    ["Posso confirmar quarta, 21/10 às 14:00?", RESERVA, false, "posso confirmar"],
    ["Tudo certo para confirmar quarta, 21/10 às 14:00?", RESERVA, false, "tudo certo para confirmar"],
    ["Confirma a consulta na quarta, dia 21 de outubro, às 14:00?", RESERVA, true, "mês por extenso"],
    ["Confirma a consulta de amanhã às 14:00?", RESERVA, false, "amanhã sem dd/mm"],
    // Achado 8: a mensagem inteira.
    ["Ficou assim: quarta, 21/10 às 14:00 com a Dra. Ana Lima, unidade Centro, particular. Confirma?", RESERVA, true, "resumo e Confirma? curto"],
    ["Sua consulta seria quarta, 21/10 às 14:00. Confirma?", RESERVA, true, "a frase antes e Confirma? curto"],
    ["Confirma quarta, 21/10 às 14:00? Ou prefere quinta, 22/10 às 13:00?", RESERVA, false, "segunda pergunta com outro par"],
    ["Confirma a consulta na quarta, 21/10 às 14:00?\nSe preferir, posso ver quinta, 22/10 às 13:00.", RESERVA, false, "outra oferta fora da pergunta"],
    ["Confirma a consulta na quarta, 21/10 às 14:00? Lembrando que a reserva vence às 14:10.", RESERVA, false, "outra hora fora da pergunta"],
    ["Confirma a consulta na quarta, 21/10 às 14:00 (chegue às 13:45)?", RESERVA, false, "chegada dentro da pergunta"],
    ["Confirma a consulta na quarta, 21/10 às 14:00 com a Dra. Ana Lima e o Dr. Bruno Costa?", RESERVA, false, "dois profissionais"],
    ["A Dra. Ana Lima atende quarta, 21/10 às 14:00 e quinta, 22/10 às 13:00. Confirma quarta, 21/10 às 14:00?", RESERVA, false, "outro par antes da pergunta"],
    ["Confirma a consulta na quarta, 21/10 às 14:00? Atendemos de segunda a sexta.", RESERVA, false, "outro dia da semana fora da pergunta"],
    // Achado 8: hoje e amanha no fuso da clinica (hoje e 20/10).
    ["Confirma para amanhã, 21/10 às 14:00?", RESERVA, true, "amanhã que é o dia da reserva"],
    ["Confirma o agendamento para amanhã, quarta, 21/10 às 14:00?", RESERVA, true, "amanhã com o dia da semana"],
    ["Confirma para hoje, 21/10 às 14:00?", RESERVA, false, "hoje com dd/mm de outro dia"],
    ["Confirma para depois de amanhã, 21/10 às 14:00?", RESERVA, false, "depois de amanhã que não é o dia"],
  ];
  it.each(casos)("%s [%#: %s]", (texto, reserva, arma) => {
    expect(perguntaConfirmaAReserva(texto, reserva)).toBe(arma);
  });

  it("hoje e amanhã sem saber o dia da reserva ou hoje não armam", () => {
    const semDias: ReservaPerguntada = {
      ...RESERVA,
      diaNaClinica: null,
      hojeNaClinica: null,
    };
    expect(
      perguntaConfirmaAReserva("Confirma para amanhã, 21/10 às 14:00?", semDias),
    ).toBe(false);
    expect(
      perguntaConfirmaAReserva("Confirma a consulta na quarta, 21/10 às 14:00?", semDias),
    ).toBe(true);
    // Hoje e o dia da reserva: "hoje" arma, "amanha" nao.
    const hojeE21 = { ...RESERVA, hojeNaClinica: "2026-10-21" };
    expect(
      perguntaConfirmaAReserva("Confirma para hoje, 21/10 às 14:00?", hojeE21),
    ).toBe(true);
    expect(
      perguntaConfirmaAReserva("Confirma para amanhã, 21/10 às 14:00?", hojeE21),
    ).toBe(false);
    // Depois de amanha, na virada do mes e do ano.
    expect(
      perguntaConfirmaAReserva("Confirma para depois de amanhã, 21/10 às 14:00?", {
        ...RESERVA,
        hojeNaClinica: "2026-10-19",
      }),
    ).toBe(true);
    expect(
      perguntaConfirmaAReserva("Confirma para amanhã, sexta, 01/01 às 14:00?", {
        ...RESERVA,
        dia: "sexta, 01/01/2027",
        diaNaClinica: "2027-01-01",
        hojeNaClinica: "2026-12-31",
      }),
    ).toBe(true);
  });

  it("a palavra distintiva é a que não está no nome da reserva", () => {
    const duasAnas: ReservaPerguntada = {
      ...RESERVA,
      profissionais: ["Dra. Ana Lima", "Dra. Ana Costa"],
    };
    // "Ana" e das duas: nao distingue (o dia e a hora sao os da reserva).
    expect(
      perguntaConfirmaAReserva("Confirma a consulta com a Dra. Ana na quarta, 21/10 às 14:00?", duasAnas),
    ).toBe(true);
    expect(
      perguntaConfirmaAReserva("Confirma a consulta com a Ana Costa na quarta, 21/10 às 14:00?", duasAnas),
    ).toBe(false);
    expect(
      perguntaConfirmaAReserva("Confirma a consulta com a Costa na quarta, 21/10 às 14:00?", duasAnas),
    ).toBe(false);
    // Particula nao distingue ("da", "de"); a unidade tambem tem palavra
    // distintiva.
    const duasUnidades: ReservaPerguntada = {
      ...RESERVA,
      profissionais: ["Dra. Ana Lima", "Dr. Bruno da Costa"],
      unidades: ["Centro", "Centro Sul"],
    };
    expect(
      perguntaConfirmaAReserva(
        "Confirma a consulta da Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro?",
        duasUnidades,
      ),
    ).toBe(true);
    expect(
      perguntaConfirmaAReserva(
        "Confirma a consulta na quarta, 21/10 às 14:00, na unidade Centro Sul?",
        duasUnidades,
      ),
    ).toBe(false);
    expect(
      perguntaConfirmaAReserva(
        "Confirma a consulta na quarta, 21/10 às 14:00, lá no Sul?",
        duasUnidades,
      ),
    ).toBe(false);
  });
});

describe("achados 2 e 8: a etapa só arma com a reserva, e o sim seguinte só marca com ela (conversa)", () => {
  it("'Confirma ... com o Bruno' (a reserva é da Dra. Ana): não arma, e 'Sim, com o Bruno mesmo' não marca nada", async () => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const t3 = await turnoDosDados(
      conversa,
      "Obrigada! Confirma a Consulta com o Bruno na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
    );
    // A resposta sai (o filtro aprova): quem nao arma e a conferencia da
    // pergunta.
    expect(t3.tipo).toBe("resposta");
    expect(t3.atendimento?.estado.etapa).toBe("oferta");
    const t4 = await conversa.fala({
      texto: "Sim, com o Bruno mesmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(`Antes de marcar, só para confirmar: ${CONFIRMA_QUARTA}`),
      ],
    });
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toHaveLength(0);
    expect(banco.linhas("appointment")).toHaveLength(0);
    expect(t4.tipo).toBe("resposta");
  });

  it.each([
    "Obrigada! Confirma a Consulta com a Costa na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular? Ou prefere quinta, 22/10 às 13:00?",
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima para hoje, 21/10 às 14:00, na unidade Centro, no particular?",
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?\nSe preferir, posso ver quinta, 22/10 às 13:00.",
  ])("'%s' não arma a etapa", async (pergunta) => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const t3 = await turnoDosDados(conversa, pergunta);
    expect(t3.tipo, pergunta).toBe("resposta");
    expect(t3.atendimento?.estado.etapa, pergunta).toBe("oferta");
  });

  it.each([
    "Obrigada! Seus dados estão ok. Ficou assim: quarta, 21/10 às 14:00 com a Dra. Ana Lima, unidade Centro, particular. Confirma?",
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima para amanhã, quarta, 21/10 às 14:00, na unidade Centro, no particular?",
  ])("'%s' arma a etapa, e o sim seguinte marca a reserva perguntada", async (pergunta) => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const hold = banco.linhas("slot_hold")[0];
    const t3 = await turnoDosDados(conversa, pergunta);
    expect(t3.tipo).toBe("resposta");
    expect(t3.atendimento?.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      slot_hold_id: hold?.id,
    });
    const t4 = await conversa.fala({
      texto: "Sim, confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.",
        ),
      ],
    });
    expect(t4.tipo).toBe("resposta");
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([
      expect.objectContaining({ p_slot_hold_id: hold?.id }),
    ]);
    expect(banco.linhas("appointment")[0]).toMatchObject({
      starts_at: iso("2026-10-21", "14:00"),
      professional_id: PROF.ana,
    });
  });
});

// ---------------------------------------------------------------------------
// Achado 10: o simulador na ordem do banco e com a unidade da consulta
// ---------------------------------------------------------------------------

describe("achado 10: o simulador espelha agendar_pela_ia", () => {
  const RESERVA_SIMULADA = "d0000000-0000-4000-8000-000000000001";
  const OUTRA_RESERVA = "d0000000-0000-4000-8000-000000000002";

  function porta(memoria: MemoriaDoSimulador) {
    return portaDaAgendaDoSimulador(banco.cliente(), {
      clinicId: CLINICA,
      agora: () => AGORA,
      memoria,
      atendimento: {
        dados: {
          ...dadosVazios(),
          nome_completo: true,
          data_nascimento: true,
          para_o_titular: true,
        },
      },
      catalogo: CATALOGO,
      config: {
        ...configComAgenda(),
        dadosExigidos: { nomeCompleto: true, nascimento: true, cpf: false },
      },
      fuso: FUSO,
    });
  }

  function memoriaCom(expiraEm: number): MemoriaDoSimulador {
    return {
      reserva: {
        holdId: RESERVA_SIMULADA,
        serviceLinkId: VINC.consultaAna,
        inicio: iso("2026-10-21", "14:00"),
        fim: iso("2026-10-21", "14:30"),
        unidadeId: UNID.centro,
        expiraEm: new Date(expiraEm).toISOString(),
      },
      consulta: null,
    };
  }

  it("a ordem: reserva_inexistente, reserva_diferente e só depois reserva_vencida", async () => {
    expect(await porta({ reserva: null, consulta: null }).agendar({ slotHoldId: OUTRA_RESERVA })).toEqual({
      ok: false,
      motivo: "reserva_inexistente",
    });
    const vencida = porta(memoriaCom(AGORA - 60_000));
    // A reserva da conversa venceu E nao e a perguntada: o banco diz
    // reserva_diferente antes de reserva_vencida.
    expect(await vencida.agendar({ slotHoldId: OUTRA_RESERVA })).toEqual({
      ok: false,
      motivo: "reserva_diferente",
    });
    expect(await vencida.agendar({ slotHoldId: RESERVA_SIMULADA })).toEqual({
      ok: false,
      motivo: "reserva_vencida",
    });
    expect(await vencida.agendar({ slotHoldId: null })).toEqual({
      ok: false,
      motivo: "reserva_vencida",
    });
  });

  it("a consulta simulada guarda e devolve a unidade da reserva, como lerConsultaDaIa", async () => {
    const memoria = memoriaCom(AGORA + 5 * 60_000);
    const p = porta(memoria);
    const marcada = await p.agendar({ slotHoldId: RESERVA_SIMULADA });
    expect(marcada).toMatchObject({ ok: true });
    const id = (marcada as { appointmentId: string }).appointmentId;
    expect(memoria.consulta).toMatchObject({ appointmentId: id, unidadeId: UNID.centro });
    expect(await p.lerConsulta?.(id)).toEqual({
      inicio: iso("2026-10-21", "14:00"),
      ativa: true,
      unidadeId: UNID.centro,
    });
    // O pacote de antes (sem a unidade na consulta): sem unidade.
    const antiga = porta({
      reserva: null,
      consulta: { appointmentId: id, inicio: iso("2026-10-21", "14:00") },
    });
    expect(await antiga.lerConsulta?.(id)).toEqual({
      inicio: iso("2026-10-21", "14:00"),
      ativa: true,
      unidadeId: null,
    });
  });
});
