import { zodResolver } from "@hookform/resolvers/zod";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DICA_DA_REMARCACAO_INCOMPLETA,
  DICA_DO_PRAZO_DE_CANCELAR,
  ERRO_DO_PRAZO,
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  PRAZO_DA_IA,
  prazosDoAgenteSchema,
  prazosPadrao,
  type AgendaDoAgente,
  type PrazosDoAgente,
} from "@/lib/domain/agente/config";

import { DICA_RECEPCAO, ITEM_ATIVO, VERSAO_2 } from "./tela-fixtures";

// AG4 na Tela 6 (desenho da secao 5; decisoes D-9 e D-10 do dono, D-24 e
// D-26 pela recomendacao, pendentes): as habilidades "Cancelar consulta" e
// "Remarcar consulta" (desligadas por padrao, desabilitadas com a dica
// quando falta o prazo ou "Agendar consulta", com a nota da fase de teste),
// o cartao "Prazos para cancelar e remarcar" em Regras e limites (os dois
// campos vazios, a ajuda, o Salvar proprio, o aviso de habilidade
// desligada, o erro do Zod da configuracao e a recepcao travada com a
// dica), o lugar dele na aba, a chave propria, o "o que mudou" e os
// cenarios do simulador. Tudo renderizado no servidor; nada aqui chama acao
// nem rede.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarPublico: vi.fn(),
    salvarDadosExigidos: vi.fn(),
    salvarPrazos: vi.fn(),
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

const { AbaHabilidades } = await import("@/components/agente/aba-habilidades");
const { avisoDosPrazos, CartaoDosPrazos } =
  await import("@/components/agente/cartao-dos-prazos");
const { chavesDosFormularios, PainelDoAgente } =
  await import("@/components/agente/painel-do-agente");
const { CENARIOS_DO_SIMULADOR, TEXTOS_DO_AGENTE } =
  await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

const AGENDA: AgendaDoAgente = { antecedenciaHoras: 2, horizonteDias: 30 };
const SEM_AGENDA: AgendaDoAgente = {
  antecedenciaHoras: null,
  horizonteDias: null,
};
const PRAZOS: PrazosDoAgente = { cancelarHoras: 24, remarcarHoras: 48 };

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

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

function habilidades(
  props: Partial<Parameters<typeof AbaHabilidades>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AbaHabilidades
        habilidades={habilidadesEfetivas({})}
        agenda={SEM_AGENDA}
        prazos={prazosPadrao()}
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

function cartao(
  props: Partial<Parameters<typeof CartaoDosPrazos>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CartaoDosPrazos
        prazos={prazosPadrao()}
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

function painel(
  dados = dadosDeTeste(),
  abaInicial: string | undefined = "regras",
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PainelDoAgente dados={dados} abaInicial={abaInicial} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------

describe("Habilidades: Cancelar consulta e Remarcar consulta", () => {
  it("as duas aparecem depois de Agendar, com o título e a descrição do desenho, desligadas por padrão", () => {
    expect(HABILIDADES_DO_AGENTE.map((h) => h.chave)).toEqual([
      "responder_duvidas",
      "informar_preco_e_convenio",
      "agendar",
      "cancelar",
      "remarcar",
      "confirmar_presenca",
      "passar_para_equipe",
    ]);
    const html = habilidades();
    const visivel = texto(html);
    expect(visivel).toContain("Cancelar consulta");
    expect(visivel).toContain(
      "Cancela a consulta quando o paciente pede e confirma numa mensagem nova, até o prazo da clínica. Dentro do prazo, passa para a equipe.",
    );
    expect(visivel).toContain("Remarcar consulta");
    expect(visivel).toContain(
      "Pede a remarcação para um horário livre da Agenda, com o mesmo profissional. A nova fica pendente até a equipe aprovar, e a antiga continua valendo até lá.",
    );
    expect(chaveDa(html, "cancelar")).toContain('aria-checked="false"');
    expect(chaveDa(html, "remarcar")).toContain('aria-checked="false"');
    expect(visivel).toContain(
      "O que o assistente pode fazer na conversa. Lista de espera e encaixe continuam com a equipe.",
    );
  });

  it("sem os prazos: as duas desabilitadas com a dica escrita (ligada à chave) e no cursor", () => {
    const html = habilidades({ agenda: AGENDA });
    for (const [chave, dica] of [
      ["cancelar", DICA_DO_PRAZO_DE_CANCELAR],
      ["remarcar", DICA_DA_REMARCACAO_INCOMPLETA],
    ] as const) {
      const tag = chaveDa(html, chave);
      expect(tag, chave).toMatch(/ disabled=""/);
      expect(tag, chave).toContain(
        `aria-describedby="agente-habilidade-${chave}-agenda"`,
      );
      expect(html, chave).toContain(
        `<span id="agente-habilidade-${chave}-agenda" class="text-xs font-semibold text-text-secondary">${dica}</span>`,
      );
      expect(html, chave).toMatch(
        new RegExp(
          `<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-${chave}"`,
        ),
      );
    }
    expect(DICA_DO_PRAZO_DE_CANCELAR).toBe(
      "Preencha o prazo para cancelar em Regras e limites.",
    );
    expect(DICA_DA_REMARCACAO_INCOMPLETA).toBe(
      "Ligue Agendar consulta e preencha o prazo para remarcar em Regras e limites.",
    );
  });

  it("Cancelar só precisa do prazo dela; Remarcar precisa também de Agendar valendo", () => {
    // Prazos sem a agenda: Cancelar liga; Remarcar nao (Agendar nao vale).
    let html = habilidades({ agenda: SEM_AGENDA, prazos: PRAZOS });
    expect(chaveDa(html, "cancelar")).not.toMatch(/ disabled=""/);
    expect(chaveDa(html, "remarcar")).toMatch(/ disabled=""/);
    expect(texto(html)).toContain(DICA_DA_REMARCACAO_INCOMPLETA);
    expect(texto(html)).not.toContain(DICA_DO_PRAZO_DE_CANCELAR);

    // Agenda completa, mas Agendar desligada: Remarcar continua travada.
    html = habilidades({ agenda: AGENDA, prazos: PRAZOS });
    expect(chaveDa(html, "remarcar")).toMatch(/ disabled=""/);

    // Agendar ligada e os dois prazos: as duas livres, sem dica.
    html = habilidades({
      agenda: AGENDA,
      prazos: PRAZOS,
      habilidades: habilidadesEfetivas({ agendar: true, remarcar: true }),
    });
    expect(chaveDa(html, "cancelar")).not.toMatch(/ disabled=""/);
    expect(chaveDa(html, "remarcar")).not.toMatch(/ disabled=""/);
    expect(chaveDa(html, "remarcar")).toContain('aria-checked="true"');
    expect(texto(html)).not.toContain(DICA_DA_REMARCACAO_INCOMPLETA);
  });

  it("ligada no rascunho, mas sem o prazo (ou sem Agendar): a tela diz Desligada (falha fechada)", () => {
    const html = habilidades({
      agenda: AGENDA,
      prazos: { cancelarHoras: null, remarcarHoras: 48 },
      habilidades: {
        ...habilidadesEfetivas({}),
        cancelar: true,
        remarcar: true,
      },
    });
    expect(chaveDa(html, "cancelar")).toContain('aria-checked="false"');
    expect(chaveDa(html, "remarcar")).toContain('aria-checked="false"');
  });

  it("recepção: as duas desabilitadas com a dica de permissão (que vence a da dependência)", () => {
    const html = habilidades({
      podeEditar: false,
      dica: DICA_RECEPCAO,
      agenda: AGENDA,
      prazos: PRAZOS,
      habilidades: habilidadesEfetivas({ agendar: true }),
    });
    for (const chave of ["cancelar", "remarcar"]) {
      expect(chaveDa(html, chave), chave).toMatch(/ disabled=""/);
    }
  });

  it("as duas com a nota da fase de teste (quem tem consulta é paciente)", () => {
    const html = habilidades();
    for (const chave of ["cancelar", "remarcar"]) {
      expect(html, chave).toContain(
        `<span id="agente-habilidade-${chave}-fase-de-teste" class="text-xs text-text-secondary">${TEXTOS_DO_AGENTE.habilidadeNaFaseDeTeste}</span>`,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe("Regras e limites: o cartão Prazos para cancelar e remarcar", () => {
  it("o título, os dois campos vazios (ninguém inventa valor), a ajuda e o Salvar", () => {
    const html = cartao();
    const visivel = texto(html);
    expect(visivel).toContain("Prazos para cancelar e remarcar");
    expect(visivel).toContain(TEXTOS_DO_AGENTE.prazosDescricao);
    expect(visivel).toContain(
      "Cancelar pelo assistente até (horas antes da consulta)",
    );
    expect(visivel).toContain(
      "Remarcar pelo assistente até (horas antes da consulta)",
    );
    expect(
      visivel.split(
        "De 0 a 720 horas. Com menos tempo do que isso, o assistente passa o pedido para a equipe.",
      ),
    ).toHaveLength(3);
    const campos = html.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    expect(campos).toHaveLength(2);
    const [cancelar, remarcar] = campos;
    expect(cancelar).toContain('name="cancelarHoras"');
    expect(remarcar).toContain('name="remarcarHoras"');
    for (const campo of campos) {
      expect(campo).toContain(`min="${PRAZO_DA_IA.minimo}"`);
      expect(campo).toContain(`max="${PRAZO_DA_IA.maximo}"`);
      expect(campo).toContain('step="1"');
      expect(campo).toContain('value=""');
      expect(campo).not.toContain(' placeholder="');
      // O rotulo ligado ao campo.
      const id = campo.match(/ id="([^"]+)"/)?.[1];
      expect(html).toContain(`for="${id}"`);
    }
    const salvar = html.match(
      /<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Salvar prazos/,
    )?.[0];
    expect(salvar).toBeDefined();
    expect(salvar).not.toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toMatch(/<fieldset disabled=""/);
  });

  it("os valores salvos aparecem nos campos, e o zero vale (cancelar até a hora da consulta)", () => {
    const html = cartao({ prazos: { cancelarHoras: 0, remarcarHoras: 48 } });
    const [cancelar, remarcar] =
      html.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    expect(cancelar).toContain('value="0"');
    expect(remarcar).toContain('value="48"');
    expect(texto(html)).not.toContain("fica desligada");
  });

  it("o aviso de habilidade desligada segue o que está no formulário", () => {
    expect(texto(cartao())).toContain(
      "Com os dois campos vazios, Cancelar consulta e Remarcar consulta ficam desligadas.",
    );
    expect(
      texto(cartao({ prazos: { cancelarHoras: null, remarcarHoras: 48 } })),
    ).toContain(
      "Com o prazo para cancelar vazio, Cancelar consulta fica desligada.",
    );
    expect(
      texto(cartao({ prazos: { cancelarHoras: 24, remarcarHoras: null } })),
    ).toContain(
      "Com o prazo para remarcar vazio, Remarcar consulta fica desligada.",
    );
    expect(cartao()).toMatch(/role="note"[^>]*data-tom="info"/);
    expect(avisoDosPrazos(PRAZOS)).toBeNull();
    expect(
      avisoDosPrazos({ cancelarHoras: Number.NaN, remarcarHoras: 48 }),
    ).toBe(TEXTOS_DO_AGENTE.prazoDeCancelarVazio);
  });

  it("recepção: os campos travados e o Salvar visível e desabilitado, com a dica", () => {
    const html = cartao({ podeEditar: false, dica: DICA_RECEPCAO });
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(
      /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*type="submit"[^>]*disabled=""[^>]*>Salvar prazos/,
    );
  });

  it("salvando: o botão diz que está salvando e fica ocupado", () => {
    const html = cartao({ salvando: true, pendente: true });
    const salvando = html.match(/<button[^>]*>Salvando\.\.\.<\/button>/)?.[0];
    expect(salvando).toContain('aria-busy="true"');
    expect(salvando).toContain('disabled=""');
  });
});

describe("Regras e limites: a validação é a do Zod da configuração", () => {
  type Valores = z.input<typeof prazosDoAgenteSchema>;

  async function erros(valores: Valores) {
    const { errors } = await zodResolver(prazosDoAgenteSchema)(
      valores,
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    return {
      cancelar: errors.cancelarHoras?.message ?? null,
      remarcar: errors.remarcarHoras?.message ?? null,
    };
  }

  it("as pontas da faixa passam; vazio (nulo) também", async () => {
    for (const valores of [
      { cancelarHoras: 0, remarcarHoras: 720 },
      { cancelarHoras: null, remarcarHoras: null },
      { cancelarHoras: 24, remarcarHoras: null },
    ]) {
      expect(await erros(valores), JSON.stringify(valores)).toEqual({
        cancelar: null,
        remarcar: null,
      });
    }
  });

  it("fora da faixa, quebrado ou ilegível: Use um número inteiro de 0 a 720 horas.", async () => {
    expect(ERRO_DO_PRAZO).toBe("Use um número inteiro de 0 a 720 horas.");
    for (const valores of [
      { cancelarHoras: 721, remarcarHoras: -1 },
      { cancelarHoras: 1.5, remarcarHoras: Number.NaN },
    ]) {
      expect(await erros(valores), JSON.stringify(valores)).toEqual({
        cancelar: ERRO_DO_PRAZO,
        remarcar: ERRO_DO_PRAZO,
      });
    }
  });
});

// ---------------------------------------------------------------------------

describe("no painel", () => {
  it("o cartão fica depois dos dados para marcar e antes dos gatilhos, com os prazos do rascunho", () => {
    const html = painel(
      dadosDeTeste({ config: configDeTeste({ prazos: PRAZOS }) }),
    );
    const dados = html.indexOf('id="agente-dados-titulo"');
    const prazos = html.indexOf('id="agente-prazos-titulo"');
    const gatilhos = html.indexOf('id="agente-gatilhos-titulo"');
    expect(dados).toBeGreaterThan(-1);
    expect(prazos).toBeGreaterThan(dados);
    expect(gatilhos).toBeGreaterThan(prazos);
    const doCartao = html.slice(prazos, gatilhos);
    const [cancelar, remarcar] =
      doCartao.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    expect(cancelar).toContain('value="24"');
    expect(remarcar).toContain('value="48"');
  });

  it("recepção: o cartão trava como os outros da aba", () => {
    const html = painel(
      dadosDeTeste({ podeEditar: false, dicaSemPermissao: DICA_RECEPCAO }),
    );
    const prazos = html.indexOf('id="agente-prazos-titulo"');
    const gatilhos = html.indexOf('id="agente-gatilhos-titulo"');
    expect(html.slice(prazos, gatilhos)).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Salvar prazos/,
    );
  });

  it("a aba Habilidades usa os prazos do rascunho", () => {
    const html = painel(
      dadosDeTeste({
        config: configDeTeste({
          agenda: AGENDA,
          prazos: PRAZOS,
          habilidades: habilidadesEfetivas({ agendar: true, cancelar: true }),
        }),
      }),
      "habilidades",
    );
    expect(chaveDa(html, "cancelar")).toContain('aria-checked="true"');
    expect(chaveDa(html, "cancelar")).not.toMatch(/ disabled=""/);
    expect(chaveDa(html, "remarcar")).not.toMatch(/ disabled=""/);
  });

  it("salvar os prazos não remonta os outros formulários (cada um com a sua chave)", () => {
    const antes = chavesDosFormularios(configDeTeste());
    const depois = chavesDosFormularios(configDeTeste({ prazos: PRAZOS }));
    expect(depois.prazos).not.toBe(antes.prazos);
    expect(depois.agenda).toBe(antes.agenda);
    expect(depois.dados).toBe(antes.dados);
    expect(depois.horario).toBe(antes.horario);
  });

  it("o que mudou: cada prazo conta uma vez, com o número ou não preenchido", () => {
    // A mesma base nos dois lados: so os prazos mudam.
    const publicada = {
      ...configDeTeste({
        base: [ITEM_ATIVO],
        prazos: { cancelarHoras: 12, remarcarHoras: 48 },
      }),
      status: "publicada" as const,
    };
    const html = painel(
      dadosDeTeste({
        config: configDeTeste({
          base: [ITEM_ATIVO],
          prazos: { cancelarHoras: 24, remarcarHoras: null },
        }),
        publicada,
        base: [ITEM_ATIVO],
        versoes: [VERSAO_2],
      }),
      "versoes",
    );
    const visivel = texto(html);
    expect(visivel).toContain("Prazo para cancelar pelo assistente: 24 horas");
    expect(visivel).toContain(
      "Prazo para remarcar pelo assistente: não preenchido",
    );
    expect(visivel).toContain("2 alterações não publicadas");
  });

  it("restaurar diz que os prazos voltam junto", () => {
    expect(TEXTOS_DO_AGENTE.restaurarDescricao).toContain(
      "os prazos para cancelar e remarcar",
    );
  });
});

describe("simulador: os cenários de cancelar e remarcar", () => {
  it("existem, depois dos quatro do brief, e não têm dado pessoal", () => {
    const chaves = CENARIOS_DO_SIMULADOR.map((c) => c.chave);
    expect(chaves.slice(-2)).toEqual(["cancelar", "remarcar"]);
    for (const chave of ["cancelar", "remarcar"]) {
      const cenario = CENARIOS_DO_SIMULADOR.find((c) => c.chave === chave);
      expect(cenario?.mensagem, chave).not.toMatch(/\d{4,}|@/);
    }
    expect(
      CENARIOS_DO_SIMULADOR.find((c) => c.chave === "cancelar")?.rotulo,
    ).toBe("Paciente querendo cancelar");
    expect(
      CENARIOS_DO_SIMULADOR.find((c) => c.chave === "remarcar")?.rotulo,
    ).toBe("Paciente querendo remarcar");
  });
});

describe("cópia", () => {
  it("sem travessão e sem jargão", () => {
    const T = TEXTOS_DO_AGENTE;
    const amostras: [string, string][] = [
      ["prazosDescricao", T.prazosDescricao],
      ["prazoDica", T.prazoDica(0, 720, "x")],
      ["prazosVazios", T.prazosVazios],
      ["prazoDeCancelarVazio", T.prazoDeCancelarVazio],
      ["prazoDeRemarcarVazio", T.prazoDeRemarcarVazio],
      ["salvarPrazos", T.salvarPrazos],
      ["prazosSalvos", T.prazosSalvos],
      ["habilidadesDescricao", T.habilidadesDescricao],
      ["simuladorDescricao", T.simuladorDescricao],
      ["restaurarDescricao", T.restaurarDescricao],
      ["cartao", texto(cartao())],
      ["recepcao", texto(cartao({ podeEditar: false, dica: DICA_RECEPCAO }))],
      ["habilidades", texto(habilidades())],
      ...CENARIOS_DO_SIMULADOR.flatMap((c): [string, string][] => [
        [`${c.chave}.rotulo`, c.rotulo],
        [`${c.chave}.mensagem`, c.mensagem],
      ]),
    ];
    for (const [chave, amostra] of amostras) {
      expect(amostra, chave).not.toMatch(/[—–]/);
      expect(amostra, chave).not.toMatch(
        /\b(prompt|token|LLM|skill|tenant|handoff|opt-in|slot|hold|antecedencia_horas)\b/i,
      );
    }
  });
});
