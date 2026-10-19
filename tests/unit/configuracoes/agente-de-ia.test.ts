import {
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  Clock,
  Hourglass,
  TriangleAlert,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  avisoDeContatoDaClinica,
  avisosAoLigar,
  dicasDaIa,
  escolhaAtual,
  estadoDaIa,
  estadoDoNumero,
  estadoDoTelefone,
  faltasParaAEquipe,
  IA_NA_CLINICA_STATUS,
  LIGADO_DESLIGADO_STATUS,
  MODO_DA_ESCOLHA,
  motivoDoNumeroDesconectado,
  motorDaIaParadoNaAba,
  motivosDaParada,
  NUMERO_DO_ASSISTENTE_STATUS,
  numerosDoDialogo,
  numerosLigados,
  numerosLigadosDesconectados,
  oQueNaoDeuParaConferir,
  porQueNaoAciona,
  quantosTelefonesLigados,
  rotuloDoNumeroLigado,
  rotuloDoTelefoneLigado,
  TELEFONE_DA_EQUIPE_STATUS,
  telefoneComConversaAberta,
  telefoneDaEquipeSchema,
  telefoneParaExibir,
  TEXTOS_DA_IA,
  temTelefoneQueNaoAciona,
  textoDoTelefoneQueNaoAciona,
  textoDoTeto,
  textosDaParada,
  textosDosMotivos,
  type ContextoDaIa,
  type EstadoDaIa,
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
import {
  expedientePadrao,
  type HorarioDeOperacao,
} from "@/lib/domain/agente/config";
import { CLINICAS_DA_FASE_CONTROLADA } from "@/lib/ia/liberacao";
import {
  abaDaIaVisivel,
  type DadosDaIa,
  type LiberacaoDaClinica,
  type SituacaoDaIa,
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

const FUSO = "America/Fortaleza";
// Terca, 13/10/2026: 15:00 UTC = 12:00 em Fortaleza (dentro do expediente
// padrao, 08:00 a 18:00); 23:00 UTC = 20:00 (fora).
const MEIO_DIA = Date.parse("2026-10-13T15:00:00.000Z");
const NOITE = Date.parse("2026-10-13T23:00:00.000Z");

function horario(modo: HorarioDeOperacao["modo"]): HorarioDeOperacao {
  return { modo, minutosSemResposta: 10, expediente: expedientePadrao() };
}

function situacao(campos: Partial<SituacaoDaIa> = {}): SituacaoDaIa {
  return {
    tetoAtingido: false,
    versaoPublicada: 1,
    telefonesInvalidos: [],
    telefonesSemAutorizacao: [],
    telefonesComConversaAberta: [],
    horarioPublicado: horario("24h"),
    motorParado: false,
    ...campos,
  };
}

function dados(campos: Partial<DadosDaIa> = {}): DadosDaIa {
  return {
    liberacao: liberacao(),
    numerosLigados: [NUMERO],
    telefones: [
      {
        id: "t1",
        telefone: "+5584999990001",
        rotulo: "Vinicius, equipe",
        ativo: true,
      },
    ],
    interruptorLigado: true,
    situacao: situacao(),
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
    cor: "azul",
    ...campos,
  };
}

function contexto(campos: Partial<ContextoDaIa> = {}): ContextoDaIa {
  return {
    dados: dados(),
    numeros: [numero()],
    ambienteLigado: true,
    agoraMs: MEIO_DIA,
    fuso: FUSO,
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
        numerosLigados: [],
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
        numerosLigados: [],
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

  it("o único número ligado desconectado: motivo próprio, dizendo qual", () => {
    const desconectado = contexto({
      numeros: [numero({ status: "desconectado" })],
    });
    expect(motivosDaParada(desconectado)).toEqual(["numero_desconectado"]);
    expect(estadoDaIa(desconectado)).toBe("parado");
    expect(textosDaParada(desconectado)).toEqual([
      "O número Número principal está desconectado. Conecte o número na aba WhatsApp.",
    ]);
  });

  it("telefone desligado não conta; número desligado não conta", () => {
    const semLigados = contexto({
      dados: dados({
        numerosLigados: [],
        telefones: [
          { id: "t1", telefone: "+5584999990001", rotulo: null, ativo: false },
        ],
      }),
    });
    expect(motivosDaParada(semLigados)).toEqual(["sem_numero", "sem_telefone"]);
  });

  it("número ligado que saiu da clínica (removido) não conta", () => {
    const removido = contexto({ numeros: [numero({ id: OUTRO_NUMERO })] });
    expect(numerosLigados(removido.dados, removido.numeros)).toEqual([]);
    expect(motivosDaParada(removido)).toEqual(["sem_numero"]);
  });

  it("sem a lista de números: usa os ids ligados e não afirma nada da conexão", () => {
    expect(numerosLigados(dados(), null)).toEqual([
      { id: NUMERO, numero: null },
    ]);
    expect(motivosDaParada(contexto({ numeros: null }))).toEqual([]);
    // e nunca o verde (achado T3): "Não deu para conferir agora"
    expect(estadoDaIa(contexto({ numeros: null }))).toBe("nao_conferido");
  });
});

describe("o que falta para conversar com a equipe", () => {
  it("número e ao menos um telefone ligado", () => {
    expect(faltasParaAEquipe(dados(), [numero()])).toEqual([]);
    expect(
      faltasParaAEquipe(dados({ numerosLigados: [] }), [numero()]),
    ).toEqual(["sem_numero"]);
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
    ...Object.values(TELEFONE_DA_EQUIPE_STATUS),
    ...Object.values(NUMERO_DO_ASSISTENTE_STATUS),
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
      nao_conferido: "Não deu para conferir agora",
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
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      rotulo: "Vinicius, equipe",
      telefone: "+5584999990001",
      confirmarAvisoDaOpenai: true,
    });
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "Ana",
        telefone: "+55 84 99999-0002",
        confirmarAvisoDaOpenai: true,
      }).telefone,
    ).toBe("+5584999990002");
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "Ana",
        telefone: "5584999990003",
        confirmarAvisoDaOpenai: true,
      }).telefone,
    ).toBe("+5584999990003");
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "Ana",
        telefone: "+351912345678",
        confirmarAvisoDaOpenai: true,
      }).telefone,
    ).toBe("+351912345678");
  });

  it("telefone inválido e rótulo vazio ou longo: mensagem em português", () => {
    for (const telefone of ["", "abc", "123", "(23) 99999-0000"]) {
      const r = telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone,
        confirmarAvisoDaOpenai: true,
      });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(TEXTOS_DA_IA.telefoneInvalido);
    }
    const vazio = telefoneDaEquipeSchema.safeParse({
      rotulo: "   ",
      telefone: "84999990001",
      confirmarAvisoDaOpenai: true,
    });
    expect(vazio.error?.issues[0]?.message).toBe(TEXTOS_DA_IA.rotuloVazio);
    const longo = telefoneDaEquipeSchema.safeParse({
      rotulo: "a".repeat(81),
      telefone: "84999990001",
      confirmarAvisoDaOpenai: true,
    });
    expect(longo.error?.issues[0]?.message).toBe(TEXTOS_DA_IA.rotuloLongo);
    // campo a mais: recusado (strict)
    expect(
      telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarAvisoDaOpenai: true,
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
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      rotulo: "Ana",
      telefone: "+5584999990001",
      confirmarContato: true,
      confirmarAvisoDaOpenai: true,
    });
    expect(
      telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarContato: "sim",
        confirmarAvisoDaOpenai: true,
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
    // E3: o administrador desliga, mas ligar o atendimento pelo WhatsApp
    // (modo equipe e usar número) é só da equipe Conduzza. Telefone
    // (adicionar e ligar de novo): o administrador também, desde 19/10/2026
    // (decisão do dono).
    expect(
      dicasDaIa({
        podeEditar: true,
        superAdmin: false,
        faltasParaAEquipe: ["sem_numero"],
      }),
    ).toEqual({
      escolha: null,
      equipe: TEXTOS_DA_IA.soEquipeConduzzaLiga,
      numero: TEXTOS_DA_IA.soEquipeConduzzaLiga,
      telefone: null,
      interruptor: TEXTOS_DA_IA.soEquipeConduzza,
    });
    // a dica de hoje não fala de telefone (ela continua no modo e no número)
    expect(TEXTOS_DA_IA.soEquipeConduzzaLiga).not.toMatch(/telefone/i);
    expect(TEXTOS_DA_IA.soEquipeConduzzaLiga).toBe(
      "Nesta fase, só a equipe Conduzza liga o atendimento pelo WhatsApp.",
    );
    // o super admin liga; sem número ou telefone, o que falta
    expect(
      dicasDaIa({
        podeEditar: true,
        superAdmin: true,
        faltasParaAEquipe: ["sem_numero"],
      }),
    ).toEqual({
      escolha: null,
      equipe: TEXTOS_DA_IA.faltaParaAEquipe,
      numero: null,
      telefone: null,
      interruptor: null,
    });
    expect(
      dicasDaIa({ podeEditar: true, superAdmin: true, faltasParaAEquipe: [] })
        .interruptor,
    ).toBeNull();
  });

  it("aviso do diálogo de ligar: as travas que dizem não", () => {
    const pronto = {
      ambienteLigado: true,
      interruptorLigado: true,
      versaoPublicada: 2,
      motorParado: false,
      temTelefoneInvalido: false,
    };
    expect(avisosAoLigar(pronto)).toEqual([]);
    expect(
      avisosAoLigar({
        ...pronto,
        ambienteLigado: false,
        interruptorLigado: false,
      }),
    ).toEqual([
      "A equipe Conduzza ainda não ativou o assistente para esta clínica.",
      TEXTOS_DA_IA.motivos.interruptor,
    ]);
    expect(avisosAoLigar({ ...pronto, interruptorLigado: false })).toEqual([
      TEXTOS_DA_IA.motivos.interruptor,
    ]);
    // E3: versão publicada, motor da IA e telefone que não aciona
    expect(
      avisosAoLigar({
        ...pronto,
        versaoPublicada: null,
        motorParado: true,
        temTelefoneInvalido: true,
      }),
    ).toEqual([
      TEXTOS_DA_IA.motivos.sem_versao_publicada,
      TEXTOS_DA_IA.motivos.motor_parado,
      TEXTOS_DA_IA.avisoTelefoneInvalido,
    ]);
    // no "Só simulador", só o ambiente e o interruptor contam
    expect(
      avisosAoLigar({
        ...pronto,
        interruptorLigado: false,
        versaoPublicada: null,
        motorParado: true,
        temTelefoneInvalido: true,
        modo: "simulador",
      }),
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
      ...avisosAoLigar({
        ambienteLigado: false,
        interruptorLigado: false,
        versaoPublicada: null,
        motorParado: true,
        temTelefoneInvalido: true,
      }),
      ...Object.values(TELEFONE_DA_EQUIPE_STATUS).map((d) => d.label),
      ...Object.values(NUMERO_DO_ASSISTENTE_STATUS).map((d) => d.label),
      motivoDoNumeroDesconectado("Recepção"),
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

// E3 (13/10/2026): a aba diz a verdade sobre o WhatsApp. O verde so aparece
// sem nenhum motivo; teto, versao publicada, horario e motor da IA viram
// motivos de "Ligado, mas parado"; o telefone que e numero de WhatsApp do
// Conduzza nao aciona o assistente e tem estado proprio.
describe("mapa de estados do E3", () => {
  it("os motivos novos, na ordem da tela", () => {
    const tudoParado = contexto({
      dados: dados({
        liberacao: liberacao({ pausadaPelaClinica: true }),
        numerosLigados: [],
        telefones: [],
        interruptorLigado: false,
        situacao: situacao({
          tetoAtingido: true,
          versaoPublicada: null,
          horarioPublicado: null,
          motorParado: true,
        }),
      }),
      ambienteLigado: false,
    });
    expect(motivosDaParada(tudoParado)).toEqual([
      "servidor",
      "interruptor",
      "pausada",
      "teto_atingido",
      "sem_versao_publicada",
      "motor_parado",
      "sem_numero",
      "sem_telefone",
    ]);
    expect(estadoDaIa(tudoParado)).toBe("parado");
  });

  it("teto atingido para também o simulador; o resto do WhatsApp não", () => {
    const simulador = contexto({
      dados: dados({
        liberacao: liberacao({ modo: "simulador" }),
        numerosLigados: [],
        telefones: [],
        situacao: situacao({
          tetoAtingido: true,
          versaoPublicada: null,
          motorParado: true,
        }),
      }),
    });
    expect(motivosDaParada(simulador)).toEqual(["teto_atingido"]);
    const simuladorSemTeto = contexto({
      dados: dados({
        liberacao: liberacao({ modo: "simulador" }),
        situacao: situacao({ versaoPublicada: null, motorParado: false }),
      }),
    });
    expect(motivosDaParada(simuladorSemTeto)).toEqual([]);
    expect(estadoDaIa(simuladorSemTeto)).toBe("simulador");
  });

  it("nunca publicado: Ligado, mas parado, com o motivo", () => {
    const semVersao = contexto({
      dados: dados({
        situacao: situacao({ versaoPublicada: null, horarioPublicado: null }),
      }),
    });
    expect(motivosDaParada(semVersao)).toEqual(["sem_versao_publicada"]);
    expect(estadoDaIa(semVersao)).toBe("parado");
  });

  it("horário: fallback não funciona no WhatsApp; fora do expediente depende da hora", () => {
    const fallback = contexto({
      dados: dados({
        situacao: situacao({ horarioPublicado: horario("fallback") }),
      }),
    });
    expect(motivosDaParada(fallback)).toEqual(["horario_nao_suportado"]);

    const foraDoExpediente = situacao({
      horarioPublicado: horario("fora_expediente"),
    });
    // ao meio-dia de uma terça, o expediente está aberto: o assistente não
    // atende agora
    expect(
      motivosDaParada(
        contexto({
          dados: dados({ situacao: foraDoExpediente }),
          agoraMs: MEIO_DIA,
        }),
      ),
    ).toEqual(["fora_do_horario_agora"]);
    // às 20:00 em Fortaleza, sim
    const deNoite = contexto({
      dados: dados({ situacao: foraDoExpediente }),
      agoraMs: NOITE,
    });
    expect(motivosDaParada(deNoite)).toEqual([]);
    expect(estadoDaIa(deNoite)).toBe("equipe");
    // 24 horas atende sempre
    expect(motivosDaParada(contexto({ agoraMs: MEIO_DIA }))).toEqual([]);
  });

  it("o horário sai no fuso da clínica, não no do servidor", () => {
    const foraDoExpediente = situacao({
      horarioPublicado: horario("fora_expediente"),
    });
    // 23:00 UTC é 20:00 em Fortaleza (fora) e 08:00 do dia seguinte em
    // Tóquio (dentro do expediente)
    expect(
      motivosDaParada(
        contexto({
          dados: dados({ situacao: foraDoExpediente }),
          agoraMs: NOITE,
          fuso: "Asia/Tokyo",
        }),
      ),
    ).toEqual(["fora_do_horario_agora"]);
  });

  it("motor da IA: motor_parado da situação da clínica vira motivo", () => {
    // revisao do E3 (B8 e T3): o motor vem de situacao_da_ia_na_clinica,
    // leitura obrigatoria; nao existe mais o motor "que nao deu para ler"
    // tratado como motor de pe (ele deixava a aba verde sem conferir)
    const parado = dados({ situacao: situacao({ motorParado: true }) });
    expect(motorDaIaParadoNaAba(parado)).toBe(true);
    expect(motivosDaParada(contexto({ dados: parado }))).toEqual([
      "motor_parado",
    ]);
    expect(estadoDaIa(contexto({ dados: parado }))).toBe("parado");
    const dePe = dados({ situacao: situacao({ motorParado: false }) });
    expect(motorDaIaParadoNaAba(dePe)).toBe(false);
    expect(motivosDaParada(contexto({ dados: dePe }))).toEqual([]);
  });

  it("os textos dos motivos novos, palavra por palavra", () => {
    expect(TEXTOS_DA_IA.motivos.sem_versao_publicada).toBe(
      "Publique a primeira versão do assistente na tela Agente de IA.",
    );
    expect(TEXTOS_DA_IA.motivos.teto_atingido).toBe(
      "O gasto do dia chegou ao limite. O assistente volta sozinho quando o gasto das últimas 24 horas baixar.",
    );
    expect(TEXTOS_DA_IA.motivos.motor_parado).toBe(
      "O motor do assistente não está rodando. Avise a equipe Conduzza.",
    );
    expect(TEXTOS_DA_IA.motivos.fora_do_horario_agora).toBe(
      "Agora está fora do horário escolhido para o assistente.",
    );
    expect(TEXTOS_DA_IA.motivos.horario_nao_suportado).toBe(
      "Este modo de horário ainda não funciona no WhatsApp. Use 24 horas ou Só fora do expediente.",
    );
  });
});

describe("telefone que não aciona o assistente", () => {
  const comInvalido = dados({
    telefones: [
      { id: "t1", telefone: "+5584999990001", rotulo: "Ana", ativo: true },
      { id: "t2", telefone: "+5584999990002", rotulo: "Bia", ativo: true },
      { id: "t3", telefone: "+5584999990003", rotulo: "Caio", ativo: false },
    ],
    situacao: situacao({ telefonesInvalidos: ["t2", "t3"] }),
  });

  it("não conta como telefone ligado", () => {
    expect(quantosTelefonesLigados(comInvalido)).toBe(1);
    const soInvalido = dados({
      telefones: [
        { id: "t2", telefone: "+5584999990002", rotulo: "Bia", ativo: true },
      ],
      situacao: situacao({ telefonesInvalidos: ["t2"] }),
    });
    expect(quantosTelefonesLigados(soInvalido)).toBe(0);
    expect(faltasParaAEquipe(soInvalido, [numero()])).toEqual(["sem_telefone"]);
    expect(motivosDaParada(contexto({ dados: soInvalido }))).toEqual([
      "sem_telefone",
    ]);
  });

  it("estado próprio, ligado ou não", () => {
    expect(estadoDoTelefone(comInvalido, "t1")).toBe("ligado");
    expect(estadoDoTelefone(comInvalido, "t2")).toBe("invalido");
    expect(estadoDoTelefone(comInvalido, "t3")).toBe("invalido");
    expect(estadoDoTelefone(dados(), "t1")).toBe("ligado");
    expect(
      estadoDoTelefone(
        dados({
          telefones: [
            {
              id: "t9",
              telefone: "+5584999990009",
              rotulo: null,
              ativo: false,
            },
          ],
        }),
        "t9",
      ),
    ).toBe("desligado");
  });

  // Conferencia da revisao (telas N1): o contato que revogou a autorizacao
  // para receber mensagens nao conversa (o executor passa sem responder).
  it("contato sem autorização para receber mensagens: não aciona, com a frase própria", () => {
    const semAutorizacao = dados({
      telefones: [
        { id: "t1", telefone: "+5584999990001", rotulo: "Ana", ativo: true },
        { id: "t2", telefone: "+5584999990002", rotulo: "Bia", ativo: true },
      ],
      situacao: situacao({
        telefonesInvalidos: ["t2"],
        telefonesSemAutorizacao: ["t1", "t2"],
      }),
    });
    expect(porQueNaoAciona(semAutorizacao, "t1")).toBe("sem_autorizacao");
    // invalido vem antes (o banco recusa ligar)
    expect(porQueNaoAciona(semAutorizacao, "t2")).toBe("invalido");
    expect(porQueNaoAciona(dados(), "t1")).toBeNull();
    expect(estadoDoTelefone(semAutorizacao, "t1")).toBe("invalido");
    expect(quantosTelefonesLigados(semAutorizacao)).toBe(0);
    expect(motivosDaParada(contexto({ dados: semAutorizacao }))).toEqual([
      "sem_telefone",
    ]);
    expect(textoDoTelefoneQueNaoAciona("sem_autorizacao")).toBe(
      TEXTOS_DA_IA.telefoneSemAutorizacaoNaLinha,
    );
    expect(textoDoTelefoneQueNaoAciona("invalido")).toBe(
      TEXTOS_DA_IA.telefoneInvalidoNaLinha,
    );
    expect(temTelefoneQueNaoAciona(semAutorizacao)).toBe(true);
    expect(
      temTelefoneQueNaoAciona(
        dados({ situacao: situacao({ telefonesSemAutorizacao: ["t1"] }) }),
      ),
    ).toBe(true);
    expect(temTelefoneQueNaoAciona(dados())).toBe(false);
  });

  it("três camadas: Hourglass, rótulo e tom de aviso, distinto de ligado e desligado", () => {
    expect(TELEFONE_DA_EQUIPE_STATUS.invalido).toEqual({
      label: "Não aciona o assistente",
      tone: "warning",
      icon: Hourglass,
    });
    const icones = Object.values(TELEFONE_DA_EQUIPE_STATUS).map((d) => d.icon);
    expect(new Set(icones).size).toBe(icones.length);
    expect(TELEFONE_DA_EQUIPE_STATUS.ligado.icon).toBe(
      LIGADO_DESLIGADO_STATUS.ligado.icon,
    );
  });

  it("conversa aberta com a equipe num dos números ligados (vários desde 19/10/2026)", () => {
    const aberta = dados({
      situacao: situacao({ telefonesComConversaAberta: ["t1"] }),
    });
    expect(telefoneComConversaAberta(aberta, "t1")).toBe(true);
    expect(telefoneComConversaAberta(dados(), "t1")).toBe(false);
    // não para o assistente: ele começa na próxima conversa
    expect(motivosDaParada(contexto({ dados: aberta }))).toEqual([]);
    expect(TEXTOS_DA_IA.conversaAbertaNoNumero).toBe(
      "Tem conversa aberta com a equipe num dos números ligados: nesse número, o assistente começa na próxima conversa.",
    );
  });
});

describe("formulário do telefone: LGPD e recusas", () => {
  it("a confirmação do aviso da OpenAI é obrigatória, sempre", () => {
    for (const valor of [undefined, false, "true"]) {
      const r = telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarAvisoDaOpenai: valor,
      });
      expect(r.success).toBe(false);
      expect(
        r.error?.issues.find((i) => i.path[0] === "confirmarAvisoDaOpenai")
          ?.message,
      ).toBe(TEXTOS_DA_IA.avisoDaOpenaiObrigatorio);
    }
    expect(TEXTOS_DA_IA.avisoDaOpenaiObrigatorio).toBe(
      "Confirme o aviso sobre a OpenAI antes de adicionar o telefone.",
    );
    expect(TEXTOS_DA_IA.confirmarAvisoDaOpenai).toBe(
      "Quem usa este celular sabe que o que escrever vai para a OpenAI, nos EUA, e vai usar só dados de teste.",
    );
  });

  it("forçar contato de paciente: opcional, só booleano", () => {
    expect(
      telefoneDaEquipeSchema.parse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarAvisoDaOpenai: true,
        forcarContatoDePaciente: true,
      }).forcarContatoDePaciente,
    ).toBe(true);
    expect(
      telefoneDaEquipeSchema.safeParse({
        rotulo: "Ana",
        telefone: "84999990001",
        confirmarAvisoDaOpenai: true,
        forcarContatoDePaciente: "sim",
      }).success,
    ).toBe(false);
  });

  it("os textos das recusas, palavra por palavra", () => {
    expect(TEXTOS_DA_IA.telefoneDaPlataforma).toBe(
      "Este telefone não pode ser usado como telefone da equipe. Use o celular pessoal de alguém da equipe.",
    );
    expect(TEXTOS_DA_IA.telefoneInvalidoNaLinha).toBe(
      "Este telefone não pode ser usado como telefone da equipe.",
    );
    expect(TEXTOS_DA_IA.contatoDePaciente).toBe(
      "Este telefone é de um paciente da clínica. A IA só conversa com telefones da equipe.",
    );
    expect(TEXTOS_DA_IA.forcarContatoDePaciente).toBe(
      "Usar mesmo assim (fica registrado)",
    );
    // o forcar de quem não é a equipe Conduzza (19/10/2026)
    expect(TEXTOS_DA_IA.soEquipeConduzzaForca).toBe(
      "Somente a equipe Conduzza usa o telefone de um paciente como telefone da equipe.",
    );
    expect(TEXTOS_DA_IA.avisoTelefoneInvalido).toBe(
      "Há telefone da equipe que não aciona o assistente. Veja a lista de telefones.",
    );
  });
});

// Achado T4 da revisao do E3: a linha do telefone ligado e a do numero
// ligado so dizem que o assistente conversa quando ele conversa mesmo
// (estado equipe) e, no numero, so se ELE esta conectado (com varios
// numeros, desde 19/10/2026, o verde pode vir de outro). Antes, com a
// clinica Desligada, em So simulador ou parada, cada telefone dizia em
// verde "Conversa com o assistente" e o numero, "Em uso pelo assistente".
describe("rótulo do telefone ligado e do número ligado (T4)", () => {
  const FORA_DE_USO: readonly EstadoDaIa[] = [
    "desligado",
    "simulador",
    "parado",
  ];

  it("só no estado equipe: Conversa com o assistente e Em uso pelo assistente", () => {
    expect(rotuloDoTelefoneLigado("equipe")).toBe("Conversa com o assistente");
    expect(rotuloDoNumeroLigado("equipe", true)).toBe("Em uso pelo assistente");
  });

  it("no estado equipe, o número ligado que caiu não diz Em uso", () => {
    expect(rotuloDoNumeroLigado("equipe", false)).toBe("Ligado ao assistente");
  });

  it("desligado, só simulador ou parado: Ligado (contrato 3.11) e Ligado ao assistente", () => {
    for (const estado of FORA_DE_USO) {
      expect(rotuloDoTelefoneLigado(estado), estado).toBe("Ligado");
      expect(rotuloDoTelefoneLigado(estado)).toBe(
        TELEFONE_DA_EQUIPE_STATUS.ligado.label,
      );
      for (const conectado of [true, false]) {
        expect(rotuloDoNumeroLigado(estado, conectado), estado).toBe(
          "Ligado ao assistente",
        );
      }
    }
  });

  it("a clínica desligada com o telefone ligado: a linha não diz que conversa", () => {
    const desligada = contexto({
      dados: dados({ liberacao: liberacao({ liberada: false }) }),
    });
    expect(estadoDaIa(desligada)).toBe("desligado");
    expect(estadoDoTelefone(desligada.dados, "t1")).toBe("ligado");
    expect(rotuloDoTelefoneLigado(estadoDaIa(desligada))).toBe("Ligado");
    // parada por uma trava qualquer
    const parada = contexto({ ambienteLigado: false });
    expect(estadoDaIa(parada)).toBe("parado");
    expect(rotuloDoTelefoneLigado(estadoDaIa(parada))).toBe("Ligado");
    expect(rotuloDoNumeroLigado(estadoDaIa(parada), true)).toBe(
      "Ligado ao assistente",
    );
  });
});

// Achado T3 da revisao do E3: a aba nunca fica verde sem ter conferido o
// que o executor exige. Com a leitura dos numeros de WhatsApp falhando, ela
// nao sabe se o numero escolhido esta conectado: "Não deu para conferir
// agora", nunca "Conversando com a equipe" (antes ficava verde com o erro
// dos numeros no cartao de baixo). Um motivo conhecido continua vencendo.
describe("não conferido (T3)", () => {
  it("leitura dos números que falhou, no modo equipe: Não deu para conferir agora", () => {
    const semNumeros = contexto({ numeros: null });
    expect(oQueNaoDeuParaConferir(semNumeros)).toEqual(["numero"]);
    expect(motivosDaParada(semNumeros)).toEqual([]);
    expect(estadoDaIa(semNumeros)).toBe("nao_conferido");
    expect(estadoDaIa(semNumeros)).not.toBe("equipe");
  });

  it("um motivo conhecido vence: Ligado, mas parado", () => {
    const parado = contexto({ numeros: null, ambienteLigado: false });
    expect(estadoDaIa(parado)).toBe("parado");
    // sem número liberado, a aba sabe sem a lista: sem_numero
    const semNumero = contexto({
      numeros: null,
      dados: dados({ numerosLigados: [] }),
    });
    expect(oQueNaoDeuParaConferir(semNumero)).toEqual([]);
    expect(motivosDaParada(semNumero)).toEqual(["sem_numero"]);
    expect(estadoDaIa(semNumero)).toBe("parado");
  });

  it("só no modo equipe: desligado e só simulador não dependem dos números", () => {
    const simulador = contexto({
      numeros: null,
      dados: dados({ liberacao: liberacao({ modo: "simulador" }) }),
    });
    expect(oQueNaoDeuParaConferir(simulador)).toEqual([]);
    expect(estadoDaIa(simulador)).toBe("simulador");
    const desligado = contexto({
      numeros: null,
      dados: dados({ liberacao: liberacao({ liberada: false }) }),
    });
    expect(estadoDaIa(desligado)).toBe("desligado");
  });

  it("tudo conferido: o verde", () => {
    expect(oQueNaoDeuParaConferir(contexto())).toEqual([]);
    expect(estadoDaIa(contexto())).toBe("equipe");
  });

  it("três camadas: ícone próprio, rótulo e tom neutro (a aba não sabe)", () => {
    expect(IA_NA_CLINICA_STATUS.nao_conferido).toEqual({
      label: "Não deu para conferir agora",
      tone: "neutral",
      icon: CircleQuestionMark,
    });
    expect(TEXTOS_DA_IA.naoConferido.numero).toBe(
      "Não foi possível carregar os números de WhatsApp, então não dá para saber se o número do assistente está conectado. Recarregue a página.",
    );
  });

  it("o telefone e o número fora de uso também no não conferido (T4)", () => {
    expect(rotuloDoTelefoneLigado("nao_conferido")).toBe("Ligado");
    expect(rotuloDoNumeroLigado("nao_conferido", true)).toBe(
      "Ligado ao assistente",
    );
  });
});

// Decisao do dono de 19/10/2026 (migration 20261019110000): a IA pode
// atender MAIS DE UM numero da mesma clinica. Cada numero liga e desliga
// sozinho; o assistente responde por qualquer numero ligado e conectado, e o
// verde exige pelo menos um. Nenhum ligado: "Nenhum número ligado ao
// assistente."; ligados, mas nenhum conectado: um motivo por numero, com o
// nome dele. O ligado que caiu, com outro conectado, e aviso na linha dele.
describe("vários números ligados (19/10/2026)", () => {
  const PRINCIPAL = numero();
  const SEGUNDO = numero({
    id: OUTRO_NUMERO,
    nome: "Numero 2 teste pessoal",
    principal: false,
    displayPhone: "5584999999018",
  });
  const TERCEIRO_ID = "33333333-3333-4333-8333-333333333333";
  const TERCEIRO = numero({
    id: TERCEIRO_ID,
    nome: "Unidade Centro",
    principal: false,
    displayPhone: "5584999990003",
  });
  const DOIS_LIGADOS = dados({ numerosLigados: [NUMERO, OUTRO_NUMERO] });

  it("dois ligados e conectados: os dois na ordem da lista, e o verde", () => {
    const ctx = contexto({
      dados: DOIS_LIGADOS,
      numeros: [PRINCIPAL, SEGUNDO],
    });
    expect(numerosLigados(ctx.dados, ctx.numeros)).toEqual([
      { id: NUMERO, numero: PRINCIPAL },
      { id: OUTRO_NUMERO, numero: SEGUNDO },
    ]);
    expect(motivosDaParada(ctx)).toEqual([]);
    expect(estadoDaIa(ctx)).toBe("equipe");
    // a ordem e a da lista de numeros, nao a de quando foram ligados
    expect(
      numerosLigados(dados({ numerosLigados: [OUTRO_NUMERO, NUMERO] }), [
        PRINCIPAL,
        SEGUNDO,
      ]).map((ligado) => ligado.id),
    ).toEqual([NUMERO, OUTRO_NUMERO]);
  });

  it("um ligado conectado e outro caído: o verde continua; o caído não é motivo, é aviso da linha", () => {
    const ctx = contexto({
      dados: DOIS_LIGADOS,
      numeros: [PRINCIPAL, { ...SEGUNDO, status: "desconectado" }],
    });
    expect(motivosDaParada(ctx)).toEqual([]);
    expect(estadoDaIa(ctx)).toBe("equipe");
    expect(numerosLigadosDesconectados(ctx.dados, ctx.numeros)).toEqual([
      { ...SEGUNDO, status: "desconectado" },
    ]);
    // a linha do caído nunca diz Em uso (o verde vem do outro)
    expect(rotuloDoNumeroLigado(estadoDaIa(ctx), true)).toBe(
      "Em uso pelo assistente",
    );
    expect(rotuloDoNumeroLigado(estadoDaIa(ctx), false)).toBe(
      "Ligado ao assistente",
    );
  });

  it("ligados, mas nenhum conectado: Ligado, mas parado, dizendo quais", () => {
    const ctx = contexto({
      dados: DOIS_LIGADOS,
      numeros: [
        { ...PRINCIPAL, status: "desconectado" },
        { ...SEGUNDO, status: "aguardando_qr" },
      ],
    });
    expect(motivosDaParada(ctx)).toEqual(["numero_desconectado"]);
    expect(estadoDaIa(ctx)).toBe("parado");
    expect(textosDaParada(ctx)).toEqual([
      "O número Número principal está desconectado. Conecte o número na aba WhatsApp.",
      "O número Numero 2 teste pessoal está desconectado. Conecte o número na aba WhatsApp.",
    ]);
    // o desligado que caiu nao entra: so os ligados
    const comUmDesligado = contexto({
      dados: dados({ numerosLigados: [NUMERO] }),
      numeros: [
        { ...PRINCIPAL, status: "desconectado" },
        { ...SEGUNDO, status: "desconectado" },
      ],
    });
    expect(textosDaParada(comUmDesligado)).toEqual([
      motivoDoNumeroDesconectado("Número principal"),
    ]);
  });

  it("nenhum ligado, com números na clínica: Nenhum número ligado ao assistente", () => {
    const ctx = contexto({
      dados: dados({ numerosLigados: [] }),
      numeros: [PRINCIPAL, SEGUNDO],
    });
    expect(motivosDaParada(ctx)).toEqual(["sem_numero"]);
    expect(textosDaParada(ctx)).toEqual([
      "Nenhum número ligado ao assistente.",
    ]);
    expect(faltasParaAEquipe(ctx.dados, ctx.numeros)).toEqual(["sem_numero"]);
  });

  it("um ligado removido e outro ativo: conta só o ativo", () => {
    const ctx = contexto({
      dados: dados({ numerosLigados: [TERCEIRO_ID, NUMERO] }),
      numeros: [PRINCIPAL, SEGUNDO],
    });
    expect(numerosLigados(ctx.dados, ctx.numeros)).toEqual([
      { id: NUMERO, numero: PRINCIPAL },
    ]);
    expect(estadoDaIa(ctx)).toBe("equipe");
    const soRemovidos = contexto({
      dados: dados({ numerosLigados: [TERCEIRO_ID] }),
      numeros: [PRINCIPAL, SEGUNDO],
    });
    expect(motivosDaParada(soRemovidos)).toEqual(["sem_numero"]);
  });

  it("sem a lista de números, com dois ligados: Não deu para conferir agora", () => {
    const ctx = contexto({ dados: DOIS_LIGADOS, numeros: null });
    expect(numerosLigados(ctx.dados, null)).toEqual([
      { id: NUMERO, numero: null },
      { id: OUTRO_NUMERO, numero: null },
    ]);
    expect(motivosDaParada(ctx)).toEqual([]);
    expect(oQueNaoDeuParaConferir(ctx)).toEqual(["numero"]);
    expect(estadoDaIa(ctx)).toBe("nao_conferido");
  });

  it("ligado e desconectado não é falta para conversar com a equipe", () => {
    expect(
      faltasParaAEquipe(DOIS_LIGADOS, [
        { ...PRINCIPAL, status: "desconectado" },
        { ...SEGUNDO, status: "desconectado" },
      ]),
    ).toEqual([]);
  });

  it("estado de cada número, em 3 camadas: ligado e desligado com forma, rótulo e cor próprios", () => {
    expect(estadoDoNumero(DOIS_LIGADOS, NUMERO)).toBe("ligado");
    expect(estadoDoNumero(DOIS_LIGADOS, OUTRO_NUMERO)).toBe("ligado");
    expect(estadoDoNumero(DOIS_LIGADOS, TERCEIRO_ID)).toBe("desligado");
    expect(NUMERO_DO_ASSISTENTE_STATUS).toEqual({
      ligado: {
        label: "Ligado ao assistente",
        tone: "success",
        icon: CircleCheck,
      },
      desligado: {
        label: "Desligado do assistente",
        tone: "neutral",
        icon: CirclePause,
      },
    });
    // o mesmo par do ligado e do desligado do resto da aba
    expect(NUMERO_DO_ASSISTENTE_STATUS.ligado.icon).toBe(
      LIGADO_DESLIGADO_STATUS.ligado.icon,
    );
    expect(NUMERO_DO_ASSISTENTE_STATUS.desligado.icon).toBe(
      LIGADO_DESLIGADO_STATUS.desligado.icon,
    );
  });

  it("o diálogo de ligar cita os números ligados", () => {
    expect(numerosDoDialogo([{ id: NUMERO, numero: PRINCIPAL }])).toBe(
      "do número Número principal, (84) 99999-0000",
    );
    expect(
      numerosDoDialogo([
        { id: NUMERO, numero: PRINCIPAL },
        { id: OUTRO_NUMERO, numero: SEGUNDO },
      ]),
    ).toBe("dos números Número principal e Numero 2 teste pessoal");
    expect(
      numerosDoDialogo([
        { id: NUMERO, numero: PRINCIPAL },
        { id: OUTRO_NUMERO, numero: SEGUNDO },
        { id: TERCEIRO_ID, numero: TERCEIRO },
      ]),
    ).toBe(
      "dos números Número principal, Numero 2 teste pessoal e Unidade Centro",
    );
    // sem a lista de numeros (nomes desconhecidos), nao cita numero
    expect(numerosDoDialogo([{ id: NUMERO, numero: null }])).toBeNull();
    expect(numerosDoDialogo([])).toBeNull();
  });

  it("os textos novos, palavra por palavra, sem um número por vez", () => {
    expect(TEXTOS_DA_IA.descricaoDosNumeros).toBe(
      "O assistente responde só pelos números ligados aqui, e só para os telefones da equipe.",
    );
    expect(TEXTOS_DA_IA.motivos.sem_numero).toBe(
      "Nenhum número ligado ao assistente.",
    );
    expect(TEXTOS_DA_IA.faltaParaAEquipe).toBe(
      "Ligue ao menos um número e um telefone da equipe antes.",
    );
    const todos = Object.values(TEXTOS_DA_IA).flatMap((valor) =>
      typeof valor === "string" ? [valor] : Object.values(valor),
    );
    for (const texto of todos) {
      expect(texto).not.toMatch(/um número por vez/i);
      expect(texto).not.toMatch(/número escolhido/i);
    }
  });
});
