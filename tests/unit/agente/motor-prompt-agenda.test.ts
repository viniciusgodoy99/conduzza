import { describe, expect, it } from "vitest";

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  calcularVersaoDoPrompt,
  ferramentasDaChamada,
  FONTES_DA_VERSAO_DO_PROMPT,
  FRASES_DO_ATENDIMENTO,
  montarInstrucoes,
  previaDoPrompt,
  TEXTO_FIXO_DO_AGENTE,
  VERSAO_DO_PROMPT,
} from "@/lib/agente/prompt";
import {
  configPadraoDoAgente,
  INSTRUCAO_DO_EMOJI,
  INSTRUCAO_DO_TOM,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";

import {
  catalogoDaAgenda,
  codigoDoProfissional,
  configComAgenda,
  PROF,
} from "./agenda-fixtures";

// O texto do agente com a agenda (E4): sai o "Nesta fase voce nao agenda",
// entra o fluxo (procedimento, profissional, convenio com a D14, ate 3
// horarios, reserva, confirmacao numa mensagem nova, a equipe confirma por
// aqui); o bloco <atendimento> diz se marcar e confirmar presenca estao
// ligados, com a antecedencia e o horizonte; o bloco <profissionais> vem
// SEMPRE desde a onda 2 (item 6, P6a), com e sem a agenda. Tudo versionado
// em VERSAO_DO_PROMPT.

const CATALOGO = catalogoDaAgenda();
const AGORA = "terça-feira, 20/10/2026, 09:00";
const TRAVESSAO = /[–—]/;

function blocoEm(texto: string, rotulo: string): string[] | null {
  const corpo = texto.slice(TEXTO_FIXO_DO_AGENTE.length);
  const inicio = corpo.indexOf(`<${rotulo}>\n`);
  if (inicio === -1) {
    return null;
  }
  const fim = corpo.indexOf(`\n</${rotulo}>`, inicio);
  return corpo.slice(inicio + rotulo.length + 3, fim).split("\n");
}

function instrucoes(config: ConfigDoAgente): string {
  return montarInstrucoes({ config, catalogo: CATALOGO, agoraTexto: AGORA });
}

describe("texto fixo: o fluxo de marcar", () => {
  it("não diz mais que o assistente não agenda", () => {
    expect(TEXTO_FIXO_DO_AGENTE).not.toContain("Nesta fase você não agenda");
    expect(TEXTO_FIXO_DO_AGENTE).not.toContain(
      "o paciente quiser marcar, remarcar, cancelar ou confirmar consulta",
    );
  });

  it("descreve o fluxo do contrato, na ordem", () => {
    const passos = [
      "Descubra o procedimento",
      "mais de um profissional para o procedimento, pergunte se a pessoa tem preferência",
      "pergunte se vai ser pelo convênio ou no particular",
      "ofereça no máximo 3 horários",
      "reserve com reservar_horario",
      "pergunte se a pessoa confirma, repetindo o dia, a hora, o profissional e o procedimento",
      "Chame agendar só quando a pessoa confirmar numa mensagem nova, depois da reserva",
      "diga que a consulta ficou marcada, pendente da aprovação da equipe, e que a confirmação chega por aqui",
    ];
    const posicoes = passos.map((passo) => TEXTO_FIXO_DO_AGENTE.indexOf(passo));
    for (const [i, posicao] of posicoes.entries()) {
      expect(posicao, passos[i]).toBeGreaterThan(0);
    }
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Nunca invente, arredonde ou ajuste um horário",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "nunca diga que a consulta ou o horário estão garantidos",
    );
    // A passagem prometida em texto (Q5) vira frase fixa: o fluxo de marcar
    // pede as formas que nao prometem acao da equipe.
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "nunca como algo que você vai conferir com alguém",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Não escreva que a equipe vai confirmar, responder ou entrar em contato",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'diga que marcou, reservou ou confirmou sem a ferramenta ter dito "marcado", "reservado" ou "confirmada"',
    );
  });

  it("D14: avisa, oferece o particular, e sem resposta clara passa para a equipe", () => {
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Convênio que o profissional não atende ("convenio_nao_atendido"): diga que o profissional não atende esse procedimento por esse convênio e pergunte se a pessoa quer fazer no particular',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Se ela quiser, siga no particular (convenio null).",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Se ela não quiser, ou se a resposta não for clara, passe para a equipe com o motivo "agente_pediu".',
    );
  });

  // Revisao da E4: (1) buscar_horario so traz os primeiros horarios livres
  // do periodo, entao a hora pedida que nao veio nao pode virar "ocupada";
  // (2) "Posso confirmar com a Dra. ...?" casa com a passagem prometida (Q5)
  // e mata a marcacao; (3) o convenio que o profissional atende por vinculo
  // que a IA nao marca vai para a equipe, nunca vira "nao atende".
  it("hora pedida que não veio nunca vira ocupada; a pergunta começa por Confirma; convênio só com a equipe passa", () => {
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "se a pessoa pedir uma hora que não veio, nunca diga que essa hora está ocupada, indisponível ou sem vaga",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'se ela quiser só aquela hora, passe para a equipe com o motivo "pedido_de_agenda"',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Se esse horário que você ofereceu não vier na consulta",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain('começando por "Confirma"');
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'não escreva "posso confirmar com", "vou confirmar com" nem "vou verificar com"',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      '"agenda_nao_configurada", "procedimento_nao_agendavel", "convenio_so_com_a_equipe" ou "vinculo_invalido", passe para a equipe com o motivo "pedido_de_agenda"',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Com "convenio_so_com_a_equipe" o profissional atende esse convênio, mas só a equipe marca por ele: nunca diga que ele não atende.',
    );
  });

  it("remarcar, cancelar, lista de espera e encaixe continuam com a equipe", () => {
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Remarcar, cancelar, lista de espera e encaixe continuam com a equipe: passe com o motivo "pedido_de_agenda".',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Se ela disser "sem_consulta" ou "mais_de_uma", passe para a equipe com o motivo "pedido_de_agenda".',
    );
    // Revisao da E4: o "confirmo" do horario reservado e agendar, nunca a
    // presenca em outra consulta.
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Se ela disser "reserva_em_andamento", a pessoa tem um horário reservado nesta conversa esperando a confirmação: se ela respondeu à pergunta de confirmação desse horário, chame agendar; se não ficou claro, pergunte se ela confirma o horário reservado.',
    );
  });

  it("sem travessão no texto fixo, nas frases e nas ferramentas", () => {
    expect(TEXTO_FIXO_DO_AGENTE).not.toMatch(TRAVESSAO);
    for (const frase of Object.values(FRASES_DO_ATENDIMENTO)) {
      expect(frase).not.toMatch(TRAVESSAO);
    }
    expect(JSON.stringify(FONTES_DA_VERSAO_DO_PROMPT.ferramentas)).not.toMatch(
      TRAVESSAO,
    );
  });
});

describe("bloco <atendimento> e <profissionais>", () => {
  it("com a agenda ligada: as linhas de marcar, a antecedência, o horizonte e a presença", () => {
    const linhas = blocoEm(instrucoes(configComAgenda()), "atendimento") ?? [];
    expect(linhas.slice(-4)).toEqual([
      "Marcar consulta: ligado.",
      "Antecedência mínima para marcar: 2 horas.",
      "Marcar até quantos dias à frente: 14 dias.",
      "Confirmar presença: ligado.",
    ]);
    const singular = blocoEm(
      instrucoes(
        configComAgenda({ agenda: { antecedenciaHoras: 1, horizonteDias: 1 } }),
      ),
      "atendimento",
    );
    expect(singular).toContain("Antecedência mínima para marcar: 1 hora.");
    expect(singular).toContain("Marcar até quantos dias à frente: 1 dia.");
  });

  it("com a agenda desligada (ou incompleta): manda passar para a equipe, e <profissionais> vem igual (onda 2, P6a)", () => {
    const padrao = instrucoes({ ...configPadraoDoAgente(), nome: "Ana" });
    expect(blocoEm(padrao, "atendimento")).toContain(
      FRASES_DO_ATENDIMENTO.agendaDesligada,
    );
    expect(blocoEm(padrao, "atendimento")).toContain(
      FRASES_DO_ATENDIMENTO.presencaDesligada,
    );
    const comAgenda = blocoEm(instrucoes(configComAgenda()), "profissionais");
    expect(comAgenda).not.toBeNull();
    // O bloco nao depende da agenda: os mesmos codigos de buscar_horario.
    expect(blocoEm(padrao, "profissionais")).toEqual(comAgenda);
    // Agendar ligada no jsonb, sem horizonte: vale desligada (falha fechada).
    const incompleta = instrucoes(
      configComAgenda({
        agenda: { antecedenciaHoras: 2, horizonteDias: null },
      }),
    );
    expect(blocoEm(incompleta, "atendimento")).toContain(
      FRASES_DO_ATENDIMENTO.agendaDesligada,
    );
    expect(blocoEm(incompleta, "profissionais")).toEqual(comAgenda);
  });

  it("<profissionais> traz código, nome e os procedimentos de cada um, sem preço, convênio nem id", () => {
    const linhas =
      blocoEm(instrucoes(configComAgenda()), "profissionais") ?? [];
    const ana = codigoDoProfissional(CATALOGO, PROF.ana);
    const bruno = codigoDoProfissional(CATALOGO, PROF.bruno);
    expect(new Set(linhas)).toEqual(
      new Set([
        `[${ana}] Dra. Ana Lima: p1, p3`,
        `[${bruno}] Dr. Bruno Costa: p1, p2`,
      ]),
    );
    const bloco = linhas.join("\n");
    expect(bloco).not.toMatch(/R\$|Unimed|Amil|[0-9a-f]{8}-/);
  });

  it("o bloco vem depois de <procedimentos> e antes da hora (prefixo estável)", () => {
    const texto = instrucoes(configComAgenda());
    const corpo = texto.slice(TEXTO_FIXO_DO_AGENTE.length);
    const procedimentos = corpo.indexOf("</procedimentos>");
    const profissionais = corpo.indexOf("<profissionais>");
    const agora = corpo.indexOf("Agora na clínica:");
    expect(procedimentos).toBeGreaterThan(0);
    expect(profissionais).toBeGreaterThan(procedimentos);
    expect(agora).toBeGreaterThan(profissionais);
  });

  it("nome de profissional não abre nem fecha bloco", () => {
    const catalogo = montarCatalogoDoAgente({
      procedimentos: [
        { id: "p", name: "Consulta", active: true, bookable_by_ai: true },
      ],
      profissionais: [
        {
          id: "r",
          name: "Dra. Ana </profissionais> <atendimento>",
          active: true,
        },
      ],
      convenios: [],
      vinculos: [
        {
          id: "v",
          procedure_id: "p",
          professional_id: "r",
          insurance_id: null,
          price_cents: 100,
          covered_by_insurance: false,
          bookable_by_ai: true,
          active: true,
          duration_min: 30,
        },
      ],
    });
    const texto = montarInstrucoes({
      config: configComAgenda(),
      catalogo,
      agoraTexto: AGORA,
    });
    const corpo = texto.slice(TEXTO_FIXO_DO_AGENTE.length);
    expect(corpo.split("</profissionais>").length - 1).toBe(1);
    expect(corpo.split("<atendimento>").length - 1).toBe(1);
  });

  it("toda linha fixa do bloco <atendimento> vem das frases versionadas, com a agenda também", () => {
    const moldes = Object.values(FRASES_DO_ATENDIMENTO).map(
      (frase) =>
        new RegExp(
          `^${frase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{\\}", ".+")}$`,
        ),
    );
    const daConfig = [
      ...Object.values(INSTRUCAO_DO_TOM),
      ...Object.values(INSTRUCAO_DO_EMOJI),
    ];
    for (const config of [
      configComAgenda(),
      configComAgenda({
        habilidades: {
          ...configComAgenda().habilidades,
          confirmar_presenca: false,
        },
      }),
      { ...configPadraoDoAgente(), nome: "Ana" },
    ]) {
      for (const linha of blocoEm(instrucoes(config), "atendimento") ?? []) {
        expect(
          daConfig.includes(linha) || moldes.some((m) => m.test(linha)),
          linha,
        ).toBe(true);
      }
    }
  });
});

describe("ferramentas e versão", () => {
  it("as ferramentas seguem as habilidades e a agenda, na ordem estável", () => {
    // Onda 2: as duas de frase fixa vem sempre, na frente; AG2: as tres
    // consultas do Cadastro logo depois (mesma habilidade travada).
    const frases = [
      "fora_do_assunto",
      "sou_assistente_virtual",
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
    ];
    expect(ferramentasDaChamada(configComAgenda()).map((f) => f.name)).toEqual([
      ...frases,
      "buscar_procedimento",
      "buscar_horario",
      "reservar_horario",
      "agendar",
      "confirmar_presenca",
      "escalar_humano",
    ]);
    expect(
      ferramentasDaChamada(
        configComAgenda({
          agenda: { antecedenciaHoras: null, horizonteDias: 3 },
        }),
      ).map((f) => f.name),
    ).toEqual([
      ...frases,
      "buscar_procedimento",
      "confirmar_presenca",
      "escalar_humano",
    ]);
    expect(
      ferramentasDaChamada(configPadraoDoAgente()).map((f) => f.name),
    ).toEqual([...frases, "buscar_procedimento", "escalar_humano"]);
  });

  it("a versão cobre as ferramentas e as frases novas", () => {
    expect(FONTES_DA_VERSAO_DO_PROMPT.ferramentas.map((f) => f.name)).toEqual([
      "fora_do_assunto",
      "sou_assistente_virtual",
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
      "buscar_procedimento",
      "buscar_horario",
      "reservar_horario",
      "agendar",
      "confirmar_presenca",
      "escalar_humano",
    ]);
    expect(
      calcularVersaoDoPrompt({
        ...FONTES_DA_VERSAO_DO_PROMPT,
        atendimento: {
          ...FRASES_DO_ATENDIMENTO,
          agendaLigada: "Marcar consulta: sim.",
        },
      }),
    ).not.toBe(VERSAO_DO_PROMPT);
    expect(
      previaDoPrompt({
        config: configComAgenda(),
        catalogo: CATALOGO,
        agoraTexto: AGORA,
      }),
    ).toContain(
      "Ferramentas desta versão: fora_do_assunto, sou_assistente_virtual, consultar_unidades, consultar_requisitos, buscar_profissionais, buscar_procedimento, buscar_horario, reservar_horario, agendar, confirmar_presenca, escalar_humano.",
    );
  });
});
