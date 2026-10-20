import { zodResolver } from "@hookform/resolvers/zod";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import {
  AbaHabilidades,
  HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA,
  motivoDaChaveTravada,
} from "@/components/agente/aba-habilidades";
import { AbaRegras } from "@/components/agente/aba-regras";
import {
  avisoDeAgendaIncompleta,
  CartaoDaAgenda,
  textoDoCampoDaAgenda,
  valorDoCampoDaAgenda,
} from "@/components/agente/cartao-da-agenda";
import {
  abasNaoSalvas,
  formulariosNaoSalvos,
  NADA_NAO_SALVO,
  rotuloDoFormulario,
} from "@/components/agente/nao-salvo";
import { Trilha } from "@/components/agente/simulador";
import {
  CENARIOS_DO_SIMULADOR,
  TEXTOS_DO_AGENTE,
} from "@/components/agente/textos";
import type { DadosDoPainel } from "@/components/agente/tipos";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  agendaDoAgenteSchema,
  ANTECEDENCIA_DA_AGENDA,
  DICA_DA_AGENDA_INCOMPLETA,
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  horarioPadrao,
  HORIZONTE_DA_AGENDA,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";

import {
  configDeTeste,
  dadosDeTeste,
  DICA_RECEPCAO,
  ITEM_ATIVO,
} from "./tela-fixtures";

// E4 na Tela 6 (contrato da E4, secao 3; decisoes D12 e D13 do dono de
// 20/10/2026): as habilidades "Agendar consulta" e "Confirmar presença" na
// aba Habilidades (Agendar desabilitada com a dica enquanto faltar a
// antecedencia ou o horizonte), o cartao "Limites para marcar consulta" em
// Regras e limites (os dois campos, a validacao do Zod da frente de IA, o
// aviso de habilidade desligada, a recepcao travada com a dica), os dois
// formularios da mesma aba no "o que nao foi salvo" e o cenario de agendar
// do simulador. Tudo renderizado no servidor (renderToStaticMarkup); nada
// aqui chama acao nem rede.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarItemDaBase: vi.fn(),
    ativarItemDaBase: vi.fn(),
    excluirItemDaBase: vi.fn(),
    salvarInstrucoes: vi.fn(),
    publicar: vi.fn(),
    restaurarVersao: vi.fn(),
    simular: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { chavesDosFormularios, PainelDoAgente } =
  await import("@/components/agente/painel-do-agente");

const SEM_AGENDA: AgendaDoAgente = {
  antecedenciaHoras: null,
  horizonteDias: null,
};
const SO_ANTECEDENCIA: AgendaDoAgente = {
  antecedenciaHoras: 2,
  horizonteDias: null,
};
const AGENDA_COMPLETA: AgendaDoAgente = {
  antecedenciaHoras: 2,
  horizonteDias: 30,
};

/** O texto visivel (sem as tags), para procurar copia. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** A chave (Switch) de uma habilidade, pelo rotulo que ela aponta. */
function chaveDa(html: string, habilidade: string): string {
  const chaves = html.match(/<button[^>]*role="switch"[^>]*>/g) ?? [];
  const achada = chaves.find((tag) =>
    tag.includes(`aria-labelledby="agente-habilidade-${habilidade}"`),
  );
  if (!achada) {
    throw new Error(`chave de ${habilidade} nao encontrada`);
  }
  return achada;
}

function renderHabilidades(
  props: Partial<Parameters<typeof AbaHabilidades>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AbaHabilidades
        habilidades={habilidadesEfetivas({})}
        agenda={SEM_AGENDA}
        podeEditar
        dica={null}
        pendente={false}
        ocupado={() => false}
        aoAlternar={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function renderCartao(
  props: Partial<Parameters<typeof CartaoDaAgenda>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CartaoDaAgenda
        agenda={SEM_AGENDA}
        podeEditar
        dica={null}
        pendente={false}
        salvando={false}
        aoSalvar={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function renderPainel(dados: DadosDoPainel, abaInicial?: string): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PainelDoAgente dados={dados} abaInicial={abaInicial} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------

describe("Habilidades: Agendar consulta e Confirmar presença", () => {
  it("as duas aparecem com título e descrição, desligadas por padrão", () => {
    const html = renderHabilidades();
    const visivel = texto(html);
    expect(visivel).toContain("Agendar consulta");
    expect(visivel).toContain("Confirmar presença");
    expect(chaveDa(html, "agendar")).toContain('aria-checked="false"');
    expect(chaveDa(html, "confirmar_presenca")).toContain(
      'aria-checked="false"',
    );
    // A descricao da aba nao diz mais que so a equipe agenda.
    expect(visivel).not.toContain("quem agenda, remarca e cancela");
    expect(visivel).toContain(
      "Remarcar, cancelar, lista de espera e encaixe continuam com a equipe.",
    );
  });

  it("sem a antecedência e o horizonte, Agendar fica desabilitada com a dica, escrita e no cursor", () => {
    for (const agenda of [SEM_AGENDA, SO_ANTECEDENCIA]) {
      const html = renderHabilidades({ agenda });
      const agendar = chaveDa(html, "agendar");
      expect(agendar).toMatch(/ disabled=""/);
      // A dica escrita embaixo da descricao, ligada a chave.
      expect(agendar).toContain(
        'aria-describedby="agente-habilidade-agendar-agenda"',
      );
      expect(html).toMatch(
        /<span id="agente-habilidade-agendar-agenda"[^>]*>Preencha a antecedência e o horizonte em Regras e limites\.<\/span>/,
      );
      // E a dica do cursor: a chave dentro do gatilho focavel.
      expect(html).toMatch(
        /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-agendar"/,
      );
      // Confirmar presenca nao depende da agenda.
      expect(chaveDa(html, "confirmar_presenca")).not.toMatch(/ disabled=""/);
    }
  });

  it("a dica é a do contrato, com os acentos certos", () => {
    expect(DICA_DA_AGENDA_INCOMPLETA).toBe(
      "Preencha a antecedência e o horizonte em Regras e limites.",
    );
  });

  it("com os dois preenchidos, Agendar liga e desliga", () => {
    const html = renderHabilidades({
      agenda: AGENDA_COMPLETA,
      habilidades: habilidadesEfetivas({ agendar: true }),
    });
    const agendar = chaveDa(html, "agendar");
    expect(agendar).not.toMatch(/ disabled=""/);
    expect(agendar).toContain('aria-checked="true"');
    expect(agendar).not.toContain("aria-describedby");
    expect(texto(html)).not.toContain(DICA_DA_AGENDA_INCOMPLETA);
  });

  it("ligada no rascunho mas sem a agenda completa: a tela diz Desligada (falha fechada)", () => {
    const html = renderHabilidades({
      agenda: SO_ANTECEDENCIA,
      habilidades: { ...habilidadesEfetivas({}), agendar: true },
    });
    expect(chaveDa(html, "agendar")).toContain('aria-checked="false"');
  });

  it("recepção: as chaves livres ficam desabilitadas com a dica de permissão", () => {
    const html = renderHabilidades({
      podeEditar: false,
      dica: DICA_RECEPCAO,
      agenda: AGENDA_COMPLETA,
    });
    for (const chave of [
      "informar_preco_e_convenio",
      "agendar",
      "confirmar_presenca",
    ]) {
      expect(chaveDa(html, chave), chave).toMatch(/ disabled=""/);
    }
  });

  it("o motivo da chave travada: a permissão vence, depois a agenda", () => {
    const agendar = { precisaDaAgenda: true };
    const outra = { precisaDaAgenda: false };
    expect(motivoDaChaveTravada(agendar, SEM_AGENDA, null)).toBe(
      DICA_DA_AGENDA_INCOMPLETA,
    );
    expect(motivoDaChaveTravada(agendar, SO_ANTECEDENCIA, null)).toBe(
      DICA_DA_AGENDA_INCOMPLETA,
    );
    expect(motivoDaChaveTravada(agendar, AGENDA_COMPLETA, null)).toBeNull();
    expect(motivoDaChaveTravada(outra, SEM_AGENDA, null)).toBeNull();
    expect(motivoDaChaveTravada(agendar, SEM_AGENDA, DICA_RECEPCAO)).toBe(
      DICA_RECEPCAO,
    );
  });

  it("só Agendar consulta depende da agenda", () => {
    expect(
      HABILIDADES_DO_AGENTE.filter((h) => h.precisaDaAgenda).map(
        (h) => h.chave,
      ),
    ).toEqual(["agendar"]);
  });

  // Decisao do dono de 20/10/2026: nesta fase de teste, marcar e confirmar
  // so com telefone da equipe cadastrado pela equipe Conduzza (o forcado),
  // porque a consulta marcada transforma o contato em paciente.
  it("a nota da fase de teste fica embaixo de Agendar consulta e de Confirmar presença, para todos os papéis", () => {
    const nota = TEXTOS_DO_AGENTE.habilidadeNaFaseDeTeste;
    for (const props of [
      {},
      { agenda: AGENDA_COMPLETA },
      { podeEditar: false, dica: DICA_RECEPCAO, agenda: AGENDA_COMPLETA },
    ]) {
      const html = renderHabilidades(props);
      for (const chave of ["agendar", "confirmar_presenca"]) {
        expect(html, chave).toContain(
          `<span id="agente-habilidade-${chave}-fase-de-teste" class="text-xs text-text-secondary">${nota}</span>`,
        );
      }
      // So nas duas: nem em Informar preço nem nas travadas.
      expect(html.split(nota)).toHaveLength(3);
    }
  });

  it("a nota fica logo abaixo da descrição, antes da dica da agenda", () => {
    const html = renderHabilidades({ agenda: SEM_AGENDA });
    const agendar = HABILIDADES_DO_AGENTE.find((h) => h.chave === "agendar");
    const descricao = html.indexOf(agendar?.descricao ?? "?");
    const nota = html.indexOf('id="agente-habilidade-agendar-fase-de-teste"');
    const dica = html.indexOf('id="agente-habilidade-agendar-agenda"');
    expect(descricao).toBeGreaterThan(-1);
    expect(nota).toBeGreaterThan(descricao);
    expect(dica).toBeGreaterThan(nota);
    // Nota, nao status: so texto, sem chip, sem icone e sem cor propria.
    expect(html.slice(nota, html.indexOf("</span>", nota))).not.toMatch(
      /<svg|role="status"/,
    );
  });

  it("a nota diz o motivo em linguagem de recepção, sem travessão", () => {
    const nota = TEXTOS_DO_AGENTE.habilidadeNaFaseDeTeste;
    expect(nota).toMatch(/^Nesta fase de teste, /);
    expect(nota).toContain(
      "só com telefone da equipe cadastrado pela equipe Conduzza",
    );
    expect(nota).toContain(
      "a consulta marcada transforma o contato em paciente",
    );
    expect(nota).toContain("um telefone comum deixa de acionar o assistente");
    expect(nota).not.toMatch(/[—–]/);
    expect(nota).not.toMatch(
      /\b(for[çc]ad[oa]|prompt|token|LLM|skill|tenant|handoff|opt-in|slot|hold)\b/i,
    );
  });

  it("a nota vale só para habilidades livres que existem", () => {
    const livres = HABILIDADES_DO_AGENTE.filter((h) => !h.travada).map(
      (h) => h.chave as string,
    );
    expect([...HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA].sort()).toEqual(
      ["agendar", "confirmar_presenca"].sort(),
    );
    for (const chave of HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA) {
      expect(livres, chave).toContain(chave);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Regras e limites: limites para marcar consulta", () => {
  it("os dois campos com os rótulos do contrato, inteiros nas faixas do banco", () => {
    const html = renderCartao({ agenda: AGENDA_COMPLETA });
    const visivel = texto(html);
    expect(visivel).toContain("Limites para marcar consulta");
    expect(visivel).toContain("Antecedência mínima para marcar (horas)");
    expect(visivel).toContain("Até quantos dias à frente");
    expect(visivel).toContain(
      "De 0 a 720 horas. O assistente só oferece horário que começa depois desse tempo.",
    );
    expect(visivel).toContain(
      "De 1 a 365 dias. O assistente não oferece horário além disso.",
    );
    const campos = html.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    expect(campos).toHaveLength(2);
    const [antecedencia, horizonte] = campos;
    expect(antecedencia).toContain('name="antecedenciaHoras"');
    expect(antecedencia).toContain(`min="${ANTECEDENCIA_DA_AGENDA.minimo}"`);
    expect(antecedencia).toContain(`max="${ANTECEDENCIA_DA_AGENDA.maximo}"`);
    expect(antecedencia).toContain('step="1"');
    expect(antecedencia).toContain('value="2"');
    expect(horizonte).toContain('name="horizonteDias"');
    expect(horizonte).toContain(`min="${HORIZONTE_DA_AGENDA.minimo}"`);
    expect(horizonte).toContain(`max="${HORIZONTE_DA_AGENDA.maximo}"`);
    expect(horizonte).toContain('value="30"');
    // Os dois preenchidos: sem o aviso de habilidade desligada.
    expect(visivel).not.toContain(TEXTOS_DO_AGENTE.agendaIncompleta);
  });

  it("nasce vazio (ninguém inventa valor) e avisa que Agendar fica desligada", () => {
    const html = renderCartao({ agenda: SEM_AGENDA });
    const campos = html.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    for (const campo of campos) {
      expect(campo).toContain('value=""');
      // Sem exemplo no campo, para nao sugerir um valor.
      expect(campo).not.toContain(' placeholder="');
    }
    expect(html).toMatch(
      /role="note"[^>]*data-tom="info"[^>]*>(?:(?!<\/div>).)*Com um dos campos vazio, a habilidade Agendar consulta fica desligada\./,
    );
    expect(texto(renderCartao({ agenda: SO_ANTECEDENCIA }))).toContain(
      TEXTOS_DO_AGENTE.agendaIncompleta,
    );
  });

  it("quem configura salva; a recepção vê os campos travados e o Salvar desabilitado com a dica", () => {
    const livre = renderCartao();
    const salvar = livre.match(
      /<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Salvar limites/,
    )?.[0];
    expect(salvar).toBeDefined();
    expect(salvar).not.toMatch(/<button[^>]*disabled=""/);
    expect(livre).not.toMatch(/<fieldset disabled=""/);

    const travado = renderCartao({ podeEditar: false, dica: DICA_RECEPCAO });
    expect(travado).toMatch(/<fieldset disabled=""/);
    expect(travado).toMatch(
      /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*type="submit"[^>]*disabled=""[^>]*>Salvar limites/,
    );
  });

  it("o cartão fica entre o horário e os gatilhos, na aba Regras e limites", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AbaRegras
          horario={horarioPadrao()}
          limitesDaAgenda={
            <CartaoDaAgenda
              agenda={SEM_AGENDA}
              podeEditar
              dica={null}
              pendente={false}
              salvando={false}
              aoSalvar={vi.fn()}
            />
          }
          podeEditar
          dica={null}
          pendente={false}
          salvando={false}
          aoSalvar={vi.fn()}
        />
      </TooltipProvider>,
    );
    const horario = html.indexOf('id="agente-horario-titulo"');
    const agenda = html.indexOf('id="agente-agenda-titulo"');
    const gatilhos = html.indexOf('id="agente-gatilhos-titulo"');
    expect(horario).toBeGreaterThan(-1);
    expect(agenda).toBeGreaterThan(horario);
    expect(gatilhos).toBeGreaterThan(agenda);
    // Cada formulario com o proprio Salvar.
    expect(texto(html)).toContain("Salvar horário");
    expect(texto(html)).toContain("Salvar limites");
  });
});

describe("Regras e limites: a validação é a do Zod da frente de IA", () => {
  type Valores = z.input<typeof agendaDoAgenteSchema>;

  async function erros(valores: Valores) {
    const { errors } = await zodResolver(agendaDoAgenteSchema)(
      valores,
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    return {
      antecedencia: errors.antecedenciaHoras?.message ?? null,
      horizonte: errors.horizonteDias?.message ?? null,
    };
  }

  const ERRO_DA_ANTECEDENCIA = "Use um número inteiro de 0 a 720 horas.";
  const ERRO_DO_HORIZONTE = "Use um número inteiro de 1 a 365 dias.";

  it("as pontas das faixas passam; vazio (nulo) também", async () => {
    for (const valores of [
      { antecedenciaHoras: 0, horizonteDias: 1 },
      { antecedenciaHoras: 720, horizonteDias: 365 },
      { antecedenciaHoras: null, horizonteDias: null },
      { antecedenciaHoras: 24, horizonteDias: null },
    ]) {
      expect(await erros(valores), JSON.stringify(valores)).toEqual({
        antecedencia: null,
        horizonte: null,
      });
    }
  });

  it("fora da faixa, quebrado ou ilegível: a mensagem do campo, sem travessão", async () => {
    expect(await erros({ antecedenciaHoras: 721, horizonteDias: 366 })).toEqual(
      { antecedencia: ERRO_DA_ANTECEDENCIA, horizonte: ERRO_DO_HORIZONTE },
    );
    expect(await erros({ antecedenciaHoras: -1, horizonteDias: 0 })).toEqual({
      antecedencia: ERRO_DA_ANTECEDENCIA,
      horizonte: ERRO_DO_HORIZONTE,
    });
    expect(
      await erros({ antecedenciaHoras: 1.5, horizonteDias: Number.NaN }),
    ).toEqual({
      antecedencia: ERRO_DA_ANTECEDENCIA,
      horizonte: ERRO_DO_HORIZONTE,
    });
    for (const mensagem of [ERRO_DA_ANTECEDENCIA, ERRO_DO_HORIZONTE]) {
      expect(mensagem).not.toMatch(/[—–]/);
    }
  });

  it("o campo vazio vira nulo; o que o navegador não leu como número vira NaN (nunca nulo calado)", () => {
    expect(valorDoCampoDaAgenda("", false)).toBeNull();
    expect(valorDoCampoDaAgenda("   ", false)).toBeNull();
    expect(valorDoCampoDaAgenda("12", false)).toBe(12);
    expect(valorDoCampoDaAgenda("0", false)).toBe(0);
    // "1e" num campo numerico: o navegador entrega "" com badInput.
    expect(valorDoCampoDaAgenda("", true)).toBeNaN();
    expect(textoDoCampoDaAgenda(null)).toBe("");
    expect(textoDoCampoDaAgenda(Number.NaN)).toBe("");
    expect(textoDoCampoDaAgenda(48)).toBe(48);
  });

  it("o aviso de Agendar desligada segue o que está no formulário", () => {
    expect(avisoDeAgendaIncompleta(SEM_AGENDA)).toBe(true);
    expect(avisoDeAgendaIncompleta(SO_ANTECEDENCIA)).toBe(true);
    expect(
      avisoDeAgendaIncompleta({ antecedenciaHoras: null, horizonteDias: 30 }),
    ).toBe(true);
    expect(avisoDeAgendaIncompleta(AGENDA_COMPLETA)).toBe(false);
    // Valor invalido digitado tambem nao liga nada.
    expect(
      avisoDeAgendaIncompleta({ antecedenciaHoras: 2, horizonteDias: 400 }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("dois formulários na aba Regras e limites", () => {
  it("o da agenda pertence à aba Regras e limites", () => {
    expect(rotuloDoFormulario("agenda")).toBe("Regras e limites");
    expect(rotuloDoFormulario("regras")).toBe("Regras e limites");
  });

  it("o publicar diz a aba uma vez só, na ordem das abas", () => {
    expect(abasNaoSalvas(["regras", "agenda"])).toEqual(["Regras e limites"]);
    expect(abasNaoSalvas(["persona", "agenda", "instrucoes"])).toEqual([
      "Persona",
      "Regras e limites",
      "Instruções do assistente",
    ]);
    expect(
      formulariosNaoSalvos({ ...NADA_NAO_SALVO, agenda: true }, false),
    ).toEqual(["agenda"]);
  });

  it("salvar a agenda não remonta o horário, e vice-versa (cada um com a sua chave)", () => {
    const antes = chavesDosFormularios(configDeTeste({ agenda: SEM_AGENDA }));
    const depois = chavesDosFormularios(
      configDeTeste({ agenda: AGENDA_COMPLETA }),
    );
    expect(depois.agenda).not.toBe(antes.agenda);
    expect(depois.horario).toBe(antes.horario);
    expect(depois.persona).toBe(antes.persona);
  });
});

describe("painel", () => {
  it("a aba Regras e limites traz o cartão da agenda; quem configura salva", () => {
    const html = renderPainel(dadosDeTeste(), "regras");
    expect(texto(html)).toContain("Limites para marcar consulta");
    const salvar = html.match(
      /<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Salvar limites/,
    )?.[0];
    expect(salvar).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("com a agenda completa no rascunho, Agendar consulta liga pela aba Habilidades", () => {
    const html = renderPainel(
      dadosDeTeste({
        config: configDeTeste({
          agenda: AGENDA_COMPLETA,
          habilidades: habilidadesEfetivas({ agendar: true }),
        }),
      }),
      "habilidades",
    );
    const agendar = chaveDa(html, "agendar");
    expect(agendar).toContain('aria-checked="true"');
    expect(agendar).not.toMatch(/ disabled=""/);
  });

  it("sem a agenda, a aba Habilidades trava Agendar e a Regras e limites avisa", () => {
    const html = renderPainel(dadosDeTeste());
    expect(chaveDa(html, "agendar")).toMatch(/ disabled=""/);
    const visivel = texto(html);
    expect(visivel).toContain(DICA_DA_AGENDA_INCOMPLETA);
    expect(visivel).toContain(TEXTOS_DO_AGENTE.agendaIncompleta);
  });

  it("salvar só os limites conta como alteração e libera o Publicar (a publicada não muda sozinha)", () => {
    const publicada = {
      ...configDeTeste({ base: [ITEM_ATIVO] }),
      status: "publicada" as const,
    };
    const html = renderPainel(
      dadosDeTeste({
        config: configDeTeste({ base: [ITEM_ATIVO], agenda: AGENDA_COMPLETA }),
        publicada,
        base: [ITEM_ATIVO],
      }),
    );
    // Antecedencia e horizonte: uma alteracao cada.
    expect(texto(html)).toContain("2 alterações não publicadas");
    const botao = html.match(/<button[^>]*data-variant="default"[^>]*>/)?.[0];
    expect(botao).toBeDefined();
    expect(botao).not.toMatch(/ disabled=""/);
  });
});

// ---------------------------------------------------------------------------

describe("simulador: o cenário de agendar", () => {
  it("existe e não tem dado pessoal", () => {
    const agendar = CENARIOS_DO_SIMULADOR.find((c) => c.chave === "agendar");
    expect(agendar?.rotulo).toBe("Paciente querendo agendar");
    expect(agendar?.mensagem).not.toMatch(/\d{4,}/);
  });

  it("a descrição diz que reservar e marcar no simulador não gravam nada", () => {
    expect(TEXTOS_DO_AGENTE.simuladorDescricao).toContain(
      "os horários vêm da Agenda, mas reservar e marcar aqui não gravam nada",
    );
  });

  it("o passo de agenda na trilha usa o ícone da Agenda, neutro como os outros", () => {
    const html = renderToStaticMarkup(
      <Trilha
        trilha={[
          {
            tipo: "agenda",
            texto: "Limpeza de pele: encontrou 3 horários",
          },
          { tipo: "preco", texto: "Consultou o preço de Limpeza de pele" },
        ]}
      />,
    );
    expect(html).toMatch(/lucide-calendar-days[^"]*text-text-secondary/);
    expect(texto(html)).toContain("Limpeza de pele: encontrou 3 horários");
    expect(html.match(/<svg/g)).toHaveLength(2);
  });
});

describe("cópia nova", () => {
  it("sem travessão e sem jargão", () => {
    const T = TEXTOS_DO_AGENTE;
    const amostras: [string, string][] = [
      ["agendaTitulo", T.agendaTitulo],
      ["agendaDescricao", T.agendaDescricao],
      ["antecedencia", T.antecedencia],
      ["antecedenciaDica", T.antecedenciaDica(0, 720)],
      ["horizonte", T.horizonte],
      ["horizonteDica", T.horizonteDica(1, 365)],
      ["agendaIncompleta", T.agendaIncompleta],
      ["salvarAgenda", T.salvarAgenda],
      ["agendaSalva", T.agendaSalva],
      ["habilidadesDescricao", T.habilidadesDescricao],
      ["habilidadeNaFaseDeTeste", T.habilidadeNaFaseDeTeste],
      ["semRascunho", T.semRascunho],
      ["restaurarDescricao", T.restaurarDescricao],
      ["simuladorDescricao", T.simuladorDescricao],
      ["dica", DICA_DA_AGENDA_INCOMPLETA],
      ...HABILIDADES_DO_AGENTE.flatMap((h): [string, string][] => [
        [`${h.chave}.titulo`, h.titulo],
        [`${h.chave}.descricao`, h.descricao],
      ]),
    ];
    for (const [chave, amostra] of amostras) {
      expect(amostra, chave).not.toMatch(/[—–]/);
      expect(amostra, chave).not.toMatch(
        /\b(prompt|token|LLM|skill|tenant|handoff|opt-in|slot|hold)\b/i,
      );
    }
  });
});
