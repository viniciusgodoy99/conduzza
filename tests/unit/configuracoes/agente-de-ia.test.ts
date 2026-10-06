import { Clock, TriangleAlert } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  avisoDeContatoDaClinica,
  avisosAoLigar,
  dicasDaIa,
  escolhaAtual,
  estadoDaIa,
  faltasParaAEquipe,
  IA_NA_CLINICA_STATUS,
  LIGADO_DESLIGADO_STATUS,
  MODO_DA_ESCOLHA,
  motivosDaParada,
  numeroDaIa,
  telefoneDaEquipeSchema,
  telefoneParaExibir,
  TEXTOS_DA_IA,
  textoDoTeto,
  textosDosMotivos,
  type ContextoDaIa,
} from "@/components/configuracoes/agente-de-ia";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import {
  ACCESS_LEVEL_STATUS,
  ATIVIDADE_STATUS,
  CONSENT_STATUS,
  CONVERSAO_STATUS,
  IA_AGENDA_STATUS,
  LEITURA_META_STATUS,
  RECORD_STATUS,
  REGUA_STATUS,
  TOKEN_META_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import { CLINICAS_DA_FASE_CONTROLADA } from "@/lib/ia/liberacao";
import {
  abaDaIaVisivel,
  type DadosDaIa,
  type LiberacaoDaClinica,
} from "@/lib/queries/ia-liberacao";

// Regras puras da aba "Agente de IA" de Configuracoes (Fase 3; decisao do
// dono em 05/10/2026): a aba so existe nas duas clinicas da fase
// controlada; o estado em 3 camadas diz a verdade (ligado pela clinica, mas
// parado por alguma trava, vira "Ligado, mas parado" com os motivos);
// "Conversar com a equipe" exige numero e telefone; o telefone novo vira
// E.164 com o 55 do Brasil; e as dicas de quem nao altera.

const TESTE123 = "acd9c539-585e-4f2a-a195-712c70099564";
const CONDUZZA_TESTE = "f0c115dd-e98c-4767-a1bb-93d517844852";
const SALUD_CARE = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
const NUMERO = "11111111-1111-4111-8111-111111111111";
const OUTRO_NUMERO = "22222222-2222-4222-8222-222222222222";

function liberacao(
  campos: Partial<LiberacaoDaClinica> = {},
): LiberacaoDaClinica {
  return {
    liberada: true,
    modo: "contatos",
    pausadaPelaClinica: false,
    tetoDiarioCentavosUsd: 500,
    ...campos,
  };
}

function dados(campos: Partial<DadosDaIa> = {}): DadosDaIa {
  return {
    liberacao: liberacao(),
    numeros: [{ whatsappAccountId: NUMERO, ativo: true }],
    telefones: [
      {
        id: "t1",
        telefone: "+5584999990001",
        rotulo: "Vinicius, equipe",
        ativo: true,
      },
    ],
    interruptorLigado: true,
    ...campos,
  };
}

function numero(campos: Partial<NumeroDoWhatsapp> = {}): NumeroDoWhatsapp {
  return {
    id: NUMERO,
    nome: "Número principal",
    principal: true,
    unitId: null,
    displayPhone: "5584999990000",
    status: "conectado",
    connectedAt: null,
    provider: "uazapi",
    ...campos,
  };
}

function contexto(campos: Partial<ContextoDaIa> = {}): ContextoDaIa {
  return {
    dados: dados(),
    numeros: [numero()],
    ambienteLigado: true,
    ...campos,
  };
}

describe("visibilidade da aba (decidida no servidor)", () => {
  it("só nas duas clínicas da fase controlada", () => {
    expect(abaDaIaVisivel(TESTE123)).toBe(true);
    expect(abaDaIaVisivel(CONDUZZA_TESTE)).toBe(true);
    expect(abaDaIaVisivel(TESTE123.toUpperCase())).toBe(true);
    expect(abaDaIaVisivel(SALUD_CARE)).toBe(false);
    expect(abaDaIaVisivel("")).toBe(false);
    expect(abaDaIaVisivel("11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("usa a constante da trava de ambiente (sem lista própria)", () => {
    expect(CLINICAS_DA_FASE_CONTROLADA).toEqual([TESTE123, CONDUZZA_TESTE]);
    for (const id of CLINICAS_DA_FASE_CONTROLADA) {
      expect(abaDaIaVisivel(id)).toBe(true);
    }
  });
});

describe("escolha e modo", () => {
  it("sem linha ou não liberada é Desligado; contatos é a equipe", () => {
    expect(escolhaAtual(null)).toBe("desligado");
    expect(escolhaAtual(liberacao({ liberada: false }))).toBe("desligado");
    expect(escolhaAtual(liberacao({ modo: "simulador" }))).toBe("simulador");
    expect(escolhaAtual(liberacao({ modo: "contatos" }))).toBe("equipe");
    expect(MODO_DA_ESCOLHA).toEqual({
      simulador: "simulador",
      equipe: "contatos",
    });
  });
});

describe("estado e motivos", () => {
  it("tudo ligado: Conversando com a equipe, sem motivo", () => {
    expect(motivosDaParada(contexto())).toEqual([]);
    expect(estadoDaIa(contexto())).toBe("equipe");
  });

  it("desligado pela clínica: Desligado, sem motivo, mesmo com travas", () => {
    const desligado = contexto({
      dados: dados({
        liberacao: liberacao({ liberada: false }),
        interruptorLigado: false,
      }),
      ambienteLigado: false,
    });
    expect(motivosDaParada(desligado)).toEqual([]);
    expect(estadoDaIa(desligado)).toBe("desligado");
    expect(estadoDaIa(contexto({ dados: dados({ liberacao: null }) }))).toBe(
      "desligado",
    );
  });

  it("só simulador: não pede número nem telefone", () => {
    const simulador = contexto({
      dados: dados({
        liberacao: liberacao({ modo: "simulador" }),
        numeros: [],
        telefones: [],
      }),
    });
    expect(motivosDaParada(simulador)).toEqual([]);
    expect(estadoDaIa(simulador)).toBe("simulador");
  });

  it("ligado mas parado: os motivos na ordem da tela", () => {
    const parado = contexto({
      dados: dados({
        liberacao: liberacao({ pausadaPelaClinica: true }),
        numeros: [],
        telefones: [],
        interruptorLigado: false,
      }),
      ambienteLigado: false,
    });
    expect(motivosDaParada(parado)).toEqual([
      "servidor",
      "interruptor",
      "pausada",
      "sem_numero",
      "sem_telefone",
    ]);
    expect(estadoDaIa(parado)).toBe("parado");
    expect(textosDosMotivos(motivosDaParada(parado))).toEqual([
      TEXTOS_DA_IA.motivos.servidor,
      TEXTOS_DA_IA.motivos.interruptor,
      TEXTOS_DA_IA.motivos.pausada,
      TEXTOS_DA_IA.motivos.sem_numero,
      TEXTOS_DA_IA.motivos.sem_telefone,
    ]);
  });

  it("só simulador com o interruptor desligado também fica parado", () => {
    const simulador = contexto({
      dados: dados({
        liberacao: liberacao({ modo: "simulador" }),
        interruptorLigado: false,
      }),
    });
    expect(motivosDaParada(simulador)).toEqual(["interruptor"]);
    expect(estadoDaIa(simulador)).toBe("parado");
  });

  it("número escolhido desconectado: motivo próprio", () => {
    const desconectado = contexto({
      numeros: [numero({ status: "desconectado" })],
    });
    expect(motivosDaParada(desconectado)).toEqual(["numero_desconectado"]);
    expect(estadoDaIa(desconectado)).toBe("parado");
  });

  it("telefone desligado não conta; número desligado não conta", () => {
    const semLigados = contexto({
      dados: dados({
        numeros: [{ whatsappAccountId: NUMERO, ativo: false }],
        telefones: [
          { id: "t1", telefone: "+5584999990001", rotulo: null, ativo: false },
        ],
      }),
    });
    expect(motivosDaParada(semLigados)).toEqual(["sem_numero", "sem_telefone"]);
  });

  it("número liberado que saiu da clínica (removido) não é o número da IA", () => {
    const removido = contexto({ numeros: [numero({ id: OUTRO_NUMERO })] });
    expect(numeroDaIa(removido.dados, removido.numeros)).toBeNull();
    expect(motivosDaParada(removido)).toEqual(["sem_numero"]);
  });

  it("sem a lista de números: usa o id liberado e não afirma nada da conexão", () => {
    expect(numeroDaIa(dados(), null)).toEqual({ id: NUMERO, numero: null });
    expect(motivosDaParada(contexto({ numeros: null }))).toEqual([]);
  });
});

describe("o que falta para conversar com a equipe", () => {
  it("número e ao menos um telefone ligado", () => {
    expect(faltasParaAEquipe(dados(), [numero()])).toEqual([]);
    expect(faltasParaAEquipe(dados({ numeros: [] }), [numero()])).toEqual([
      "sem_numero",
    ]);
    expect(faltasParaAEquipe(dados({ telefones: [] }), [numero()])).toEqual([
      "sem_telefone",
    ]);
    // número desconectado não é falta (a tela avisa; o motivo é outro)
    expect(
      faltasParaAEquipe(dados(), [numero({ status: "desconectado" })]),
    ).toEqual([]);
  });
});

describe("status em 3 camadas", () => {
  const TODOS: StatusDefinition[] = [
    ...Object.values(RECORD_STATUS),
    ...Object.values(REGUA_STATUS),
    ...Object.values(WHATSAPP_CONNECTION_STATUS),
    ...Object.values(ACCESS_LEVEL_STATUS),
    ...Object.values(IA_AGENDA_STATUS),
    ...Object.values(CONVERSAO_STATUS),
    ...Object.values(TOKEN_META_STATUS),
    ...Object.values(LEITURA_META_STATUS),
    ...Object.values(CONSENT_STATUS),
    ...Object.values(ATIVIDADE_STATUS),
  ];
  const DA_ABA = [
    ...Object.values(IA_NA_CLINICA_STATUS),
    ...Object.values(LIGADO_DESLIGADO_STATUS),
  ];

  it("os rótulos fixos", () => {
    expect(
      Object.fromEntries(
        Object.entries(IA_NA_CLINICA_STATUS).map(([chave, d]) => [
          chave,
          d.label,
        ]),
      ),
    ).toEqual({
      desligado: "Desligado",
      simulador: "Só simulador",
      equipe: "Conversando com a equipe",
      parado: "Ligado, mas parado",
    });
  });

  it("forma própria em cada estado do assistente", () => {
    const icones = Object.values(IA_NA_CLINICA_STATUS).map((d) => d.icon);
    expect(new Set(icones).size).toBe(icones.length);
    for (const definicao of DA_ABA) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(2);
    }
  });

  it("um ícone, uma cor: o mesmo tom dos mapas do produto", () => {
    for (const definicao of DA_ABA) {
      for (const dono of TODOS.filter((o) => o.icon === definicao.icon)) {
        expect(dono.tone).toBe(definicao.tone);
      }
    }
    // o mesmo ícone dentro da aba também tem uma cor só
    for (const a of DA_ABA) {
      for (const b of DA_ABA.filter((o) => o.icon === a.icon)) {
        expect(b.tone).toBe(a.tone);
      }
    }
  });

  it("nunca o triângulo (só do Faltou) nem o relógio (só do Aguardando)", () => {
    for (const definicao of DA_ABA) {
      expect(definicao.icon).not.toBe(TriangleAlert);
      expect(definicao.icon).not.toBe(Clock);
    }
  });
});

describe("telefone novo da equipe", () => {
  it("sem o código do país, ganha o 55; com +, fica como veio", () => {
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "  Vinicius, equipe ",
        telefone: "(84) 99999-0001",
      }),
    ).toEqual({ rotulo: "Vinicius, equipe", telefone: "+5584999990001" });
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "Ana",
        telefone: "+55 84 99999-0002",
      }).telefone,
    ).toBe("+5584999990002");
    expect(
      telefoneDaEquipeSchema.parse({ rotulo: "Ana", telefone: "5584999990003" })
        .telefone,
    ).toBe("+5584999990003");
    expect(
      telefoneDaEquipeSchema.parse({ rotulo: "Ana", telefone: "+351912345678" })
        .telefone,
    ).toBe("+351912345678");
  });

  it("telefone inválido e rótulo vazio ou longo: mensagem em português", () => {
    for (const telefone of ["", "abc", "123", "(23) 99999-0000"]) {
      const r = telefoneDaEquipeSchema.safeParse({ rotulo: "Ana", telefone });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(TEXTOS_DA_IA.telefoneInvalido);
    }
    const vazio = telefoneDaEquipeSchema.safeParse({
      rotulo: "   ",
      telefone: "84999990001",
    });
    expect(vazio.error?.issues[0]?.message).toBe(TEXTOS_DA_IA.rotuloVazio);
    const longo = telefoneDaEquipeSchema.safeParse({
      rotulo: "a".repeat(81),
      telefone: "84999990001",
    });
    expect(longo.error?.issues[0]?.message).toBe(TEXTOS_DA_IA.rotuloLongo);
    // campo a mais: recusado (strict)
    expect(
      telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone: "84999990001",
        clinic_id: "x",
      }).success,
    ).toBe(false);
  });

  it("confirmação de contato da clínica: opcional, só booleano", () => {
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarContato: true,
      }),
    ).toEqual({
      rotulo: "Ana",
      telefone: "+5584999990001",
      confirmarContato: true,
    });
    expect(
      telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarContato: "sim",
      }).success,
    ).toBe(false);
  });

  it("aviso de telefone que já é de um contato: com o nome, ou sem nome", () => {
    expect(avisoDeContatoDaClinica("  Maria Souza ")).toBe(
      "Este telefone já é de um contato da clínica (Maria Souza). Só confirme se for de alguém da equipe.",
    );
    for (const nome of [null, "", "   "]) {
      expect(avisoDeContatoDaClinica(nome)).toBe(
        "Este telefone já é de um contato da clínica (cadastro sem nome). Só confirme se for de alguém da equipe.",
      );
    }
  });

  it("exibe como a recepção disca", () => {
    expect(telefoneParaExibir("+5584999990001")).toBe("(84) 99999-0001");
    expect(telefoneParaExibir("+558499990001")).toBe("(84) 99999-0001");
  });
});

describe("teto e dicas", () => {
  it("teto em dólar, a cada 24 horas; sem linha, nulo", () => {
    expect(textoDoTeto(liberacao())).toBe("US$ 5,00 a cada 24 horas");
    expect(textoDoTeto(liberacao({ tetoDiarioCentavosUsd: 1250 }))).toBe(
      "US$ 12,50 a cada 24 horas",
    );
    expect(textoDoTeto(null)).toBeNull();
  });

  it("sem permissão: tudo com a dica do administrador; interruptor só do super admin", () => {
    expect(
      dicasDaIa({
        podeEditar: false,
        superAdmin: false,
        faltasParaAEquipe: [],
      }),
    ).toEqual({
      escolha: TEXTOS_DA_IA.semPermissao,
      equipe: TEXTOS_DA_IA.semPermissao,
      numero: TEXTOS_DA_IA.semPermissao,
      telefone: TEXTOS_DA_IA.semPermissao,
      interruptor: TEXTOS_DA_IA.soEquipeConduzza,
    });
    expect(
      dicasDaIa({
        podeEditar: true,
        superAdmin: false,
        faltasParaAEquipe: ["sem_numero"],
      }),
    ).toEqual({
      escolha: null,
      equipe: TEXTOS_DA_IA.faltaParaAEquipe,
      numero: null,
      telefone: null,
      interruptor: TEXTOS_DA_IA.soEquipeConduzza,
    });
    expect(
      dicasDaIa({ podeEditar: true, superAdmin: true, faltasParaAEquipe: [] })
        .interruptor,
    ).toBeNull();
  });

  it("aviso do diálogo de ligar: as travas da equipe Conduzza que dizem não", () => {
    expect(
      avisosAoLigar({ ambienteLigado: true, interruptorLigado: true }),
    ).toEqual([]);
    expect(
      avisosAoLigar({ ambienteLigado: false, interruptorLigado: false }),
    ).toEqual([
      "A equipe Conduzza ainda não ativou o assistente para esta clínica.",
      TEXTOS_DA_IA.motivos.interruptor,
    ]);
    expect(
      avisosAoLigar({ ambienteLigado: true, interruptorLigado: false }),
    ).toEqual([TEXTOS_DA_IA.motivos.interruptor]);
  });

  it("o teto explicado sem jargão do canal oficial", () => {
    expect(TEXTOS_DA_IA.tetoExplicacao).toBe(
      "Ao chegar no teto, o assistente para de responder até o gasto mais antigo completar 24 horas. Só a equipe Conduzza muda o teto nesta fase.",
    );
  });

  it("nenhum travessão nem jargão nos textos", () => {
    const textos = [
      ...Object.values(TEXTOS_DA_IA).flatMap((valor) =>
        typeof valor === "string" ? [valor] : Object.values(valor),
      ),
      ...Object.values(IA_NA_CLINICA_STATUS).map((d) => d.label),
      ...avisosAoLigar({ ambienteLigado: false, interruptorLigado: false }),
      avisoDeContatoDaClinica("Maria"),
      avisoDeContatoDaClinica(null),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(tenant|opt-in|handoff|kill switch)\b/i);
      // "janela de 24 horas" e conceito do canal oficial (CLAUDE.md 3.3) e
      // "no servidor" e jargao de programador: a recepcao nao fala assim.
      expect(texto).not.toMatch(/janela de 24 horas/i);
      expect(texto).not.toMatch(/\bno servidor\b/i);
    }
  });
});
