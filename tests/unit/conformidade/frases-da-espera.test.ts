import { describe, expect, it, vi } from "vitest";

import {
  fatosVazios,
  type EntradaDaEsperaDoFato,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DO_ASSISTENTE_VIRTUAL } from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  LEMBRETE_DA_OFERTA,
  textoDoLembreteDaOferta,
} from "@/lib/domain/lembrete-da-oferta";
import {
  PERGUNTA_DA_LISTA_DE_ESPERA,
  perguntaDaListaDeEspera,
  preferenciaEmTexto,
  RESPOSTA_DA_LISTA_DE_ESPERA,
  respostaDaListaDeEspera,
  type PedidoDaEsperaEmTexto,
} from "@/lib/domain/textos-da-lista-de-espera";
import {
  CADASTRO_DA_AGENDA,
  CONTEXTO_PADRAO,
  CONVENIOS_DA_BATERIA,
  PROCEDIMENTOS_DA_BATERIA,
} from "@/tests/fixtures/ia/conformidade/casos";

// AG5 (27/10/2026, D-40, proposta): as frases fixas da lista de espera, T-E1
// (a pergunta) e T-E2 (a entrada feita), preenchidas pelos construtores de
// verdade (lib/domain/textos-da-lista-de-espera.ts), passam no filtro de
// saida INTEIRO com os fatos do turno delas, byte a byte, com e sem o aviso
// da primeira resposta. A T-E4 (o lembrete da oferta, do sistema, frente das
// telas) tambem passa: como texto colado do sistema e, nas regras do CFM,
// com o texto inteiro. Nenhum texto tem "vaga", "garantido", prazo nem
// travessao. O verificador e um duble que aprova: nenhum teste chama a
// OpenAI.

const USO = {
  tokensEntrada: 900,
  tokensSaida: 30,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function verificadorQueSempreAprova() {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
}

type Caso = { nome: string; pedido: PedidoDaEsperaEmTexto };

const CASOS: readonly Caso[] = [
  {
    nome: "Limpeza de pele, Dra. Ana, particular, de manha, segunda e quarta",
    pedido: {
      procedimento: "Limpeza de pele",
      profissional: "Dra. Ana Lima",
      convenio: null,
      turnos: ["manha"],
      dias: [1, 3],
    },
  },
  {
    nome: "Toxina, qualquer profissional, Unimed (Nacional), qualquer dia e horario",
    pedido: {
      procedimento: "Toxina botulínica",
      profissional: null,
      convenio: "Unimed (Nacional)",
      turnos: [],
      dias: [],
    },
  },
  {
    nome: "Peeling, Dr. Bruno, Bradesco Saude, tarde ou noite, aos sabados",
    pedido: {
      procedimento: "Peeling químico",
      profissional: "Dr. Bruno Costa",
      convenio: "Bradesco Saúde",
      turnos: ["tarde", "noite"],
      dias: [6],
    },
  },
  {
    nome: "Consulta dermatologica, Dra. Ana, particular, de segunda a sexta",
    pedido: {
      procedimento: "Consulta dermatológica",
      profissional: "Dra. Ana Lima",
      convenio: null,
      turnos: [],
      dias: [1, 2, 3, 4, 5],
    },
  },
  {
    nome: "Limpeza de pele, qualquer profissional, Unimed, a noite, domingo e sabado",
    pedido: {
      procedimento: "Limpeza de pele",
      profissional: null,
      convenio: "Unimed",
      turnos: ["noite"],
      dias: [0, 6],
    },
  },
];

/** O convenio da bateria do texto (nome e plano), ou null no particular. */
function convenioDoPedido(
  pedido: PedidoDaEsperaEmTexto,
): { nome: string; plano: string | null } | null {
  if (pedido.convenio === null) {
    return null;
  }
  const comPlano = /^(.*) \((.*)\)$/.exec(pedido.convenio);
  return comPlano === null
    ? { nome: pedido.convenio, plano: null }
    : { nome: comPlano[1] ?? "", plano: comPlano[2] ?? null };
}

function fatos(
  pedido: PedidoDaEsperaEmTexto,
  parcial: Partial<FatosDoTurno>,
): FatosDoTurno {
  const convenio = convenioDoPedido(pedido);
  return {
    ...fatosVazios(2026),
    ...CADASTRO_DA_AGENDA,
    unidades: [],
    convenios: CONVENIOS_DA_BATERIA,
    procedimentos: PROCEDIMENTOS_DA_BATERIA,
    hoje: { dia: 27, mes: 10, ano: 2026 },
    listaDeEsperaLigada: true,
    // O fato "atende" do convenio do pedido no procedimento (a T-E1 e a
    // T-E2 citam o convenio ao lado do procedimento).
    coberturas:
      convenio === null
        ? []
        : [{ ...convenio, estado: "atende", procedimento: pedido.procedimento }],
    ...parcial,
  };
}

/** T-E1: o pedido gravado (pedir_lista_de_espera), nada feito ainda. */
function fatosDaTE1(pedido: PedidoDaEsperaEmTexto): FatosDoTurno {
  return fatos(pedido, {
    saidasDasFerramentas: [JSON.stringify({ resultado: "pergunta_da_espera" })],
  });
}

function entradaDoTurno(pedido: PedidoDaEsperaEmTexto): EntradaDaEsperaDoFato {
  return {
    procedimento: pedido.procedimento,
    profissional: pedido.profissional,
    turnos: [...pedido.turnos],
    dias: [...pedido.dias],
    origem: "turno",
  };
}

/** T-E2: a entrada feita (entrar_na_lista_de_espera). */
function fatosDaTE2(pedido: PedidoDaEsperaEmTexto): FatosDoTurno {
  return fatos(pedido, {
    saidasDasFerramentas: [JSON.stringify({ resultado: "entrou_na_lista" })],
    acoes: ["lista_de_espera"],
    entradasDaEspera: [entradaDoTurno(pedido)],
  });
}

async function noFiltro(rascunho: string, f: FatosDoTurno, colados: string[] = []) {
  const verificador = verificadorQueSempreAprova();
  const decisao = await filtrarSaida({
    rascunho,
    contexto: {
      ...CONTEXTO_PADRAO,
      nomesDoCatalogo: [
        ...CONTEXTO_PADRAO.nomesDoCatalogo,
        "Dra. Ana Lima",
        "Dr. Bruno Costa",
      ],
      fatos: { ...f, textosColados: [...f.textosColados, ...colados] },
    },
    verificador,
  });
  return { decisao, verificador };
}

describe("T-E1 e T-E2 preenchidas passam no filtro inteiro", () => {
  it.each(CASOS.map((c) => [c.nome, c] as const))(
    "T-E1: %s",
    async (_nome, { pedido }) => {
      const texto = perguntaDaListaDeEspera(pedido);
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\bvagas?\b|garant/i);
      for (const rascunho of [
        texto,
        `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${texto}`,
      ]) {
        const { decisao, verificador } = await noFiltro(
          rascunho,
          fatosDaTE1(pedido),
          [FRASE_DO_ASSISTENTE_VIRTUAL],
        );
        expect(decisao, rascunho).toMatchObject({ aprovado: true });
        if (decisao.aprovado) {
          expect(decisao.texto).toBe(rascunho);
        }
        expect(verificador).toHaveBeenCalledTimes(1);
        // O resumo dos fatos monta e nao leva o procedimento nem o
        // profissional da lista (minimizacao).
        const resumo = verificador.mock.calls[0]?.[0].resumoDosFatos ?? "";
        expect(resumo).not.toContain("lista de espera");
      }
    },
  );

  it.each(CASOS.map((c) => [c.nome, c] as const))(
    "T-E2: %s",
    async (_nome, { pedido }) => {
      const texto = respostaDaListaDeEspera(pedido);
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\bvagas?\b|garant/i);
      for (const rascunho of [
        texto,
        `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${texto}`,
      ]) {
        const { decisao, verificador } = await noFiltro(
          rascunho,
          fatosDaTE2(pedido),
          [FRASE_DO_ASSISTENTE_VIRTUAL],
        );
        expect(decisao, rascunho).toMatchObject({ aprovado: true });
        if (decisao.aprovado) {
          expect(decisao.texto).toBe(rascunho);
        }
        const resumo = verificador.mock.calls[0]?.[0].resumoDosFatos ?? "";
        expect(resumo).toContain("colocou a pessoa na lista de espera");
        // Minimizacao: a linha da lista nao leva o procedimento, o
        // profissional nem a preferencia (o convenio confirmado tem a linha
        // dele, com o procedimento do Cadastro, como sempre).
        const daLista = resumo
          .split("\n")
          .filter((linha) => linha.includes("lista de espera"));
        expect(daLista.length).toBeGreaterThan(0);
        for (const linha of daLista) {
          expect(linha).not.toContain(pedido.procedimento);
          expect(linha).not.toMatch(/Ana Lima|Bruno Costa|manhã|segunda/);
        }
        expect(resumo).not.toContain("Ana Lima");
      }
    },
  );

  it("o texto exato do desenho (T-E1 e T-E2 do exemplo da secao 1.3)", () => {
    const pedido = CASOS[0]!.pedido;
    expect(perguntaDaListaDeEspera(pedido)).toBe(
      "Confirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, de manhã, às segundas e às quartas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
    expect(respostaDaListaDeEspera(pedido)).toBe(
      "Pronto, você entrou na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, de manhã, às segundas e às quartas. Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp.",
    );
    expect(perguntaDaListaDeEspera(CASOS[1]!.pedido)).toBe(
      "Confirma a sua entrada na lista de espera para Toxina botulínica, com qualquer profissional, pelo convênio Unimed (Nacional), em qualquer dia e horário? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
  });

  it("a preferência em texto (os casos do desenho, 4.3)", () => {
    expect(preferenciaEmTexto(["manha"], [])).toBe("de manhã, em qualquer dia");
    expect(preferenciaEmTexto(["manha", "tarde"], [])).toBe(
      "de manhã ou à tarde, em qualquer dia",
    );
    expect(preferenciaEmTexto([], [1, 3])).toBe(
      "às segundas e às quartas, em qualquer horário",
    );
    expect(preferenciaEmTexto([], [6])).toBe("aos sábados, em qualquer horário");
    expect(preferenciaEmTexto(["tarde"], [1, 2, 3, 4, 5])).toBe(
      "à tarde, de segunda a sexta",
    );
    expect(preferenciaEmTexto([], [])).toBe("em qualquer dia e horário");
    // Os tres periodos e os sete dias sao "qualquer" (o banco tambem).
    expect(preferenciaEmTexto(["manha", "tarde", "noite"], [0, 1, 2, 3, 4, 5, 6])).toBe(
      "em qualquer dia e horário",
    );
    expect(preferenciaEmTexto(["noite"], [5, 1, 3])).toBe(
      "à noite, às segundas, às quartas e às sextas",
    );
  });

  it("os modelos não têm travessão, vaga, garantia nem prazo", () => {
    for (const modelo of [PERGUNTA_DA_LISTA_DE_ESPERA, RESPOSTA_DA_LISTA_DE_ESPERA]) {
      expect(modelo).not.toMatch(/[—–]/);
      expect(modelo).not.toMatch(/\bvagas?\b|garant|logo|em breve|primeir/i);
    }
  });

  it("revisão da AG5 (achado 5): a mensagem da oferta chega pelo WhatsApp, nunca 'por aqui' (o número fixo da lista de espera pode ser outro)", () => {
    for (const modelo of [PERGUNTA_DA_LISTA_DE_ESPERA, RESPOSTA_DA_LISTA_DE_ESPERA]) {
      expect(modelo).not.toMatch(/por aqui|neste número|nesta conversa/i);
      expect(modelo).toContain("você recebe uma mensagem pelo WhatsApp");
    }
    for (const { pedido } of CASOS) {
      expect(perguntaDaListaDeEspera(pedido)).toMatch(
        /\? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele\.$/,
      );
      expect(respostaDaListaDeEspera(pedido)).toMatch(
        /\. Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp\.$/,
      );
    }
  });

  it("a T-E2 sem a entrada do turno (a ação feita) bloqueia", async () => {
    const pedido = CASOS[0]!.pedido;
    const { decisao, verificador } = await noFiltro(
      respostaDaListaDeEspera(pedido),
      fatosDaTE1(pedido),
    );
    expect(decisao).toMatchObject({ aprovado: false, camada: "regra" });
    expect(verificador).not.toHaveBeenCalled();
  });

  it("a T-E2 com outra preferência que a da entrada bloqueia (espera_fora_da_entrada)", () => {
    const pedido = CASOS[0]!.pedido;
    const outra = { ...pedido, turnos: ["tarde" as const], dias: [5] };
    const r = avaliarRegras(respostaDaListaDeEspera(outra), {
      ...CONTEXTO_PADRAO,
      fatos: fatosDaTE2(pedido),
    });
    expect(r.achados.map((a) => a.regra)).toContain("espera_fora_da_entrada");
  });
});

describe("T-E4 (o lembrete da oferta, do sistema)", () => {
  const lembrete = textoDoLembreteDaOferta({
    inicioDoHorario: "2026-11-03T12:00:00Z",
    venceEm: "2026-10-27T13:30:00Z",
    fuso: "America/Fortaleza",
  });

  it("é o modelo da frente das telas preenchido no fuso da clínica", () => {
    // Revisao da AG5: o texto e da frente do interceptador (que acrescentou
    // "Se for outro assunto, é só escrever de novo."); aqui, o preenchimento
    // (a data, a hora e o prazo no fuso) e o que a bateria exige do texto.
    expect(lembrete).toBe(
      LEMBRETE_DA_OFERTA.replace("{{data}}", "03/11/2026")
        .replace("{{hora}}", "09:00")
        .replace("{{prazo}}", "10:30"),
    );
    expect(lembrete).toMatch(
      /^Sobre o horário de 03\/11\/2026 às 09:00: para ficar com ele, responda SIM até as 10:30\. Se não quiser, responda NÃO QUERO, que você continua na lista de espera\./,
    );
    expect(lembrete).not.toMatch(/\{\{|\}\}/);
    expect(lembrete).not.toMatch(/[—–]/);
    expect(lembrete).not.toMatch(/\bvagas?\b|garant|logo|em breve|primeir|prioridade/i);
  });

  it("passa no filtro inteiro como texto do sistema (colado), e nas regras do CFM", async () => {
    const f = fatos(CASOS[0]!.pedido, { listaDeEsperaLigada: true });
    const { decisao } = await noFiltro(lembrete, f, [lembrete]);
    expect(decisao).toMatchObject({ aprovado: true });
    // Sem os fatos (so as regras do CFM e de formato): nada dispara.
    expect(avaliarRegras(lembrete, CONTEXTO_PADRAO).achados).toEqual([]);
  });

  it("com os fatos honestos da oferta, só o par do prazo: por isso a T-E4 vai como texto do sistema (colado)", () => {
    const pedido = CASOS[0]!.pedido;
    const f = fatos(pedido, {
      saidasDasFerramentas: [
        JSON.stringify({
          oferta: { dia: "terça, 03/11/2026", hora: "09:00" },
          // O prazo e hoje (a janela de resposta e de minutos), so a hora.
          prazo: { dia: "terça, 27/10/2026", hora: "10:30" },
        }),
      ],
      // "que você continua na lista de espera": a entrada que recebeu a
      // oferta (a que ja existia).
      entradasDaEspera: [{ ...entradaDoTurno(pedido), origem: "existente" }],
    });
    // A regra do par le "ate as 10:30" junto do dia do horario (a mesma
    // frase): nenhuma outra regra dispara. A T-E4 e do sistema, nunca
    // afirmacao da IA: colada, passa (o teste acima).
    expect(
      avaliarRegras(lembrete, { ...CONTEXTO_PADRAO, fatos: f }).achados,
    ).toEqual([{ categoria: "horario_nao_verificado", regra: "par_fora_dos_fatos" }]);
    // Sem a entrada, "voce continua na lista de espera" tambem nao tem fato.
    expect(
      avaliarRegras(lembrete, {
        ...CONTEXTO_PADRAO,
        fatos: { ...f, entradasDaEspera: [] },
      }).achados.map((a) => a.regra),
    ).toContain("lista_de_espera_sem_ferramenta");
  });
});
