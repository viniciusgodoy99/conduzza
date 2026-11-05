import { describe, expect, it } from "vitest";

import {
  fatosValidos,
  fatosVazios,
  FONTES_DOS_FATOS,
  regrasDosFatos,
  type EntradaDaEsperaDoFato,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  CADASTRO_DA_AGENDA,
  CONTEXTO_PADRAO,
  CONVENIOS_DA_BATERIA,
  PROCEDIMENTOS_DA_BATERIA,
} from "@/tests/fixtures/ia/conformidade/casos";

// AG5 (27/10/2026, o desenho da AG5, 4.5): as regras dos fatos da lista de
// espera, so bloqueando, como toda regra deterministica:
//  - "coloquei voce na lista de espera" so com a acao do turno ou a entrada
//    desta conversa relida; "voce esta na lista" tambem com a entrada que
//    ja existia (ja_na_lista); a pergunta de verdade nao afirma;
//  - espera_fora_da_entrada: a frase da lista com outro profissional, outro
//    procedimento ou outra preferencia que a da entrada (a entrada com
//    qualquer profissional nao libera nome);
//  - vaga_prometida: promessa de vaga, de prazo ou de posicao; nenhum fato
//    libera; a negacao e a pergunta nao prometem;
//  - a excecao estreita: "vaga" numa condicao futura sem dia nem hora nao e
//    horario livre, so com a lista de espera ligada;
//  - na frase da lista, o dia da semana e o periodo sao a preferencia (nao o
//    horario da acao nem o fechamento).

const ANA_MANHA_SEG_QUA: EntradaDaEsperaDoFato = {
  procedimento: "Limpeza de pele",
  profissional: "Dra. Ana Lima",
  turnos: ["manha"],
  dias: [1, 3],
  origem: "turno",
};

function fatos(parcial: Partial<FatosDoTurno> = {}): FatosDoTurno {
  return {
    ...fatosVazios(2026),
    ...CADASTRO_DA_AGENDA,
    profissionais: [...CADASTRO_DA_AGENDA.profissionais, "Dra. Bruna Reis"],
    unidades: [],
    convenios: CONVENIOS_DA_BATERIA,
    procedimentos: PROCEDIMENTOS_DA_BATERIA,
    hoje: { dia: 27, mes: 10, ano: 2026 },
    listaDeEsperaLigada: true,
    ...parcial,
  };
}

/** A entrada feita neste turno (a acao e a entrada). */
const ENTROU = fatos({
  acoes: ["lista_de_espera"],
  entradasDaEspera: [ANA_MANHA_SEG_QUA],
});
/** A entrada desta conversa, relida no turno seguinte (sem a acao). */
const RELIDA = fatos({
  entradasDaEspera: [{ ...ANA_MANHA_SEG_QUA, origem: "conversa" }],
});
/** A entrada que ja existia no grupo (ja_na_lista). */
const JA_EXISTIA = fatos({
  entradasDaEspera: [{ ...ANA_MANHA_SEG_QUA, origem: "existente" }],
});

function regras(rascunho: string, f: FatosDoTurno): string[] {
  return regrasDosFatos(rascunho, {
    fatos: f,
    nomesDoCatalogo: [
      ...CONTEXTO_PADRAO.nomesDoCatalogo,
      "Dra. Ana Lima",
      "Dr. Bruno Costa",
      "Dra. Bruna Reis",
    ],
    mensagensDoPaciente: [],
  }).map((a) => a.regra);
}

describe("a alegação da lista de espera", () => {
  it("coloquei/entrou: com a ação do turno ou a entrada desta conversa; sem elas, barra", () => {
    for (const texto of [
      "Coloquei você na lista de espera.",
      "Pronto, você entrou na lista de espera.",
      "Você foi incluída na lista de espera.",
    ]) {
      expect(regras(texto, ENTROU), texto).toEqual([]);
      expect(regras(texto, RELIDA), texto).toEqual([]);
      expect(regras(texto, fatos()), texto).toContain(
        "lista_de_espera_sem_ferramenta",
      );
      // A entrada que ja existia nao sustenta "coloquei": a IA nao fez.
      expect(regras(texto, JA_EXISTIA), texto).toContain(
        "lista_de_espera_sem_ferramenta",
      );
    }
  });

  it("está na lista: também com a entrada que já existia; a pergunta de verdade não afirma", () => {
    for (const f of [ENTROU, RELIDA, JA_EXISTIA]) {
      expect(regras("Você já está na lista de espera.", f)).toEqual([]);
      expect(regras("Você continua na lista de espera.", f)).toEqual([]);
    }
    expect(regras("Você já está na lista de espera.", fatos())).toContain(
      "lista_de_espera_sem_ferramenta",
    );
    expect(regras("Você já está na lista de espera?", fatos())).toEqual([]);
  });

  it("a negação colada não afirma", () => {
    expect(regras("Não coloquei você na lista de espera.", fatos())).toEqual([]);
  });
});

describe("espera_fora_da_entrada", () => {
  it("outro profissional do Cadastro (nome inteiro ou título com o nome) barra", () => {
    for (const texto of [
      "Você está na lista de espera da Dra. Bruna.",
      "Você está na lista de espera com o Dr. Bruno Costa.",
      "Pronto, você entrou na lista de espera com Dra. Maria das Dores.",
    ]) {
      expect(regras(texto, ENTROU), texto).toContain("espera_fora_da_entrada");
    }
    expect(
      regras("Você está na lista de espera com a Dra. Ana Lima.", ENTROU),
    ).toEqual([]);
  });

  it("a entrada com qualquer profissional não libera nome nenhum", () => {
    const qualquer = fatos({
      acoes: ["lista_de_espera"],
      entradasDaEspera: [{ ...ANA_MANHA_SEG_QUA, profissional: null }],
    });
    expect(
      regras("Você está na lista de espera com a Dra. Ana Lima.", qualquer),
    ).toContain("espera_fora_da_entrada");
    expect(
      regras("Você está na lista de espera com qualquer profissional.", qualquer),
    ).toEqual([]);
  });

  it("outro procedimento do Cadastro barra; o da entrada passa", () => {
    expect(
      regras("Você está na lista de espera para Peeling químico.", ENTROU),
    ).toContain("espera_fora_da_entrada");
    expect(
      regras("Você está na lista de espera para Limpeza de pele.", ENTROU),
    ).toEqual([]);
  });

  it("a preferência (dia da semana e período) só a da entrada; vazio é qualquer", () => {
    expect(
      regras("Você está na lista de espera de manhã, às segundas.", ENTROU),
    ).toEqual([]);
    expect(
      regras("Você está na lista de espera de manhã, às segundas e às quartas.", ENTROU),
    ).toEqual([]);
    expect(
      regras("Você está na lista de espera à tarde.", ENTROU),
    ).toContain("espera_fora_da_entrada");
    expect(
      regras("Você está na lista de espera para as sextas.", ENTROU),
    ).toContain("espera_fora_da_entrada");
    const qualquerDia = fatos({
      entradasDaEspera: [
        { ...ANA_MANHA_SEG_QUA, turnos: [], dias: [], origem: "conversa" },
      ],
    });
    expect(
      regras("Você está na lista de espera à noite, aos sábados.", qualquerDia),
    ).toEqual([]);
  });

  it("dia com data ou hora na frase da lista é horário, e nenhum fato da lista o libera", () => {
    expect(
      regras("Você está na lista de espera para terça, 03/11 às 09:00.", ENTROU),
    ).toEqual(
      expect.arrayContaining(["hora_fora_dos_fatos"]),
    );
  });

  it("sem entrada conhecida (só a ação), não se sabe: não barra pelo nome", () => {
    const soAcao = fatos({ acoes: ["lista_de_espera"] });
    expect(
      regras("Coloquei você na lista de espera com o Dr. Bruno Costa.", soAcao),
    ).not.toContain("espera_fora_da_entrada");
  });
});

describe("vaga_prometida", () => {
  it("promessa de vaga, de prazo e de posição barra, com qualquer fato", () => {
    for (const texto of [
      "Assim que abrir uma vaga, ela é sua.",
      "Logo abre um horário para você.",
      "Você é a primeira da fila.",
      "Você é a próxima da lista de espera.",
      "Em breve surge uma vaga.",
      "Vai abrir um horário em breve, pode ficar tranquila.",
      "Com certeza vai abrir um horário essa semana.",
      "Há duas pessoas na sua frente na lista.",
      "Vai surgir uma vaga para você.",
      "Quando abrir, o horário é seu.",
    ]) {
      for (const f of [fatos(), ENTROU, JA_EXISTIA]) {
        expect(regras(texto, f), texto).toContain("vaga_prometida");
      }
    }
  });

  it("a negação, a pergunta e a condição sem promessa não prometem", () => {
    for (const texto of [
      "Não dá para dizer quando abre um horário.",
      "Não sei quando vai abrir um horário.",
      "Ninguém consegue prever quando abre um horário.",
      "Você não é a primeira da fila, mas fica na lista.",
      "Quer que eu avise se abrir um horário?",
      "Se abrir um horário assim, você recebe uma mensagem por aqui.",
      "A clínica abre logo cedo, às 8h.",
    ]) {
      expect(regras(texto, ENTROU), texto).not.toContain("vaga_prometida");
    }
  });

  it("parafrase nova fica com o verificador (a lista costuma andar rápido)", () => {
    expect(regras("A lista costuma andar rápido.", ENTROU)).toEqual([]);
  });
});

describe("a vaga numa condição futura (a exceção estreita)", () => {
  it("com a lista de espera ligada, sem dia nem hora: não é horário livre", () => {
    for (const texto of [
      "Se abrir uma vaga, você recebe uma mensagem por aqui.",
      "Quando surgir uma vaga, você recebe uma mensagem por aqui.",
      "Caso apareça uma vaga de manhã, você recebe uma mensagem por aqui.",
      "Se vagar um horário às segundas, você recebe uma mensagem por aqui.",
    ]) {
      expect(regras(texto, fatos()), texto).toEqual([]);
    }
  });

  it("sem a lista de espera ligada, a vaga sem a condição do 'se' continua horário livre sem ferramenta", () => {
    const desligada = fatos({ listaDeEsperaLigada: false });
    expect(
      regras("Quando surgir uma vaga, você recebe uma mensagem por aqui.", desligada),
    ).toContain("horario_livre_sem_ferramenta");
    // A oferta com a vaga, mesmo com a lista ligada, continua precisando da
    // ferramenta.
    expect(regras("Temos vaga essa semana.", fatos())).toContain(
      "horario_livre_sem_ferramenta",
    );
    expect(
      regras("Se abrir uma vaga na terça às 10h, te aviso.", fatos()),
    ).toEqual(expect.arrayContaining(["hora_fora_dos_fatos"]));
  });

  it("o encaixe continua horário livre sem ferramenta (nunca pela IA)", () => {
    const semHorario = fatos({
      saidasDasFerramentas: [
        JSON.stringify({ resultado: "sem_horario", ate: "quinta, 26/11" }),
      ],
    });
    expect(regras("Posso tentar um encaixe.", semHorario)).toContain(
      "horario_livre_sem_ferramenta",
    );
  });
});

describe("a frase da lista e o fechamento", () => {
  it("'Pronto' com a preferência na frase da lista não fecha horário", () => {
    expect(
      regras(
        "Pronto, você entrou na lista de espera de manhã, às segundas e às quartas.",
        ENTROU,
      ),
    ).toEqual([]);
    expect(
      regras(
        "Combinado! Você está na lista de espera de manhã, às quartas.",
        RELIDA,
      ),
    ).toEqual([]);
  });

  it("sem a alegação da lista, 'Pronto' com o dia continua fechamento sem ação", () => {
    expect(regras("Pronto, ficou para segunda de manhã.", fatos())).toEqual(
      expect.arrayContaining(["fechamento_sem_acao"]),
    );
  });
});

describe("a forma dos fatos novos", () => {
  it("as entradas e a habilidade são opcionais e conferidas", () => {
    expect(fatosValidos(ENTROU)).toBe(true);
    expect(fatosValidos(fatos({ listaDeEsperaLigada: undefined }))).toBe(true);
    expect(
      fatosValidos({ ...ENTROU, entradasDaEspera: [{ ...ANA_MANHA_SEG_QUA, dias: [7] }] }),
    ).toBe(false);
    expect(
      fatosValidos({
        ...ENTROU,
        entradasDaEspera: [{ ...ANA_MANHA_SEG_QUA, turnos: ["madrugada"] }],
      }),
    ).toBe(false);
    expect(
      fatosValidos({
        ...ENTROU,
        entradasDaEspera: [{ ...ANA_MANHA_SEG_QUA, origem: "outra" }],
      }),
    ).toBe(false);
    expect(fatosValidos({ ...ENTROU, listaDeEsperaLigada: "sim" })).toBe(false);
  });

  it("as regras novas entram na versão das regras", () => {
    expect(FONTES_DOS_FATOS.some((f) => f.includes("vaga_prometida"))).toBe(true);
    expect(
      FONTES_DOS_FATOS.some((f) => f.includes("espera_fora_da_entrada")),
    ).toBe(true);
  });

  it("pelo filtro determinístico inteiro, com a categoria certa", () => {
    const r = avaliarRegras("Você é a primeira da fila.", {
      ...CONTEXTO_PADRAO,
      fatos: ENTROU,
    });
    expect(r.categorias).toContain("horario_nao_verificado");
    const s = avaliarRegras("Você está na lista de espera da Dra. Bruna.", {
      ...CONTEXTO_PADRAO,
      nomesDoCatalogo: [...CONTEXTO_PADRAO.nomesDoCatalogo, "Dra. Bruna Reis"],
      fatos: ENTROU,
    });
    expect(s.categorias).toContain("acao_nao_executada");
  });
});
