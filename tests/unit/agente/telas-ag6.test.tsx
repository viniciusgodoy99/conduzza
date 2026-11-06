import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  // [AG6b mídia] início
  DECISAO_DO_TIPO_DO_LEITOR,
  TIPOS_DO_LEITOR,
  type TipoDoLeitor,
  // [AG6b mídia] fim
  GATILHOS_OBRIGATORIOS,
  MOTIVOS_QUE_NUNCA_ATRIBUEM,
  regrasDaPassagemPadrao,
  type PassagemDaConversa,
} from "@/lib/domain/agente/config";

import { DICA_RECEPCAO, ITEM_ATIVO, VERSAO_2 } from "./tela-fixtures";

// AG6a na Tela 6 (desenho da AG6, secao 6; D-15 do dono, e D-53, D-54 e
// D-55 pela recomendacao, pendentes): na aba Regras e limites, o cartao
// "Para quem vai a conversa" (a fila por padrao, ou o responsavel do lead;
// cartoes de radio com o proprio Salvar, versionado no rascunho) e o cartao
// "Urgência" (so o texto nesta rodada; a chave do aviso do SAMU e da AG6c),
// os dois com o ladrilho decorativo; o gatilho obrigatorio da emergencia na
// lista travada; o "o que mudou" da passagem; o cenario do simulador; e a
// recepcao vendo tudo travado, com a dica. O audio ("Entender áudio") fica
// fora desta rodada: a aba Habilidades nao muda. Tudo renderizado no
// servidor; nada aqui chama acao nem rede.
// [AG6b mídia] Desde a AG6b, o audio, a foto e o documento entram na aba
// Habilidades (o bloco do audio, no fim; o resto em telas-ag6b.test.tsx).

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarPublico: vi.fn(),
    salvarDadosExigidos: vi.fn(),
    salvarPrazos: vi.fn(),
    salvarPassagem: vi.fn(),
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

const { CartaoDaPassagem } =
  await import("@/components/agente/cartao-da-passagem");
const { CartaoDaUrgencia } =
  await import("@/components/agente/cartao-da-urgencia");
const { chavesDosFormularios, PainelDoAgente } =
  await import("@/components/agente/painel-do-agente");
const { comAPassagem, NADA_NAO_SALVO, formulariosNaoSalvos } =
  await import("@/components/agente/nao-salvo");
const { CENARIOS_DO_SIMULADOR, TEXTOS_DA_PASSAGEM, TEXTOS_DA_URGENCIA } =
  await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function passagem(
  props: Partial<Parameters<typeof CartaoDaPassagem>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CartaoDaPassagem
        passagemPara="fila"
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

/** Os radios do grupo, com o valor e se esta marcado ou travado. */
function radios(html: string) {
  return [...html.matchAll(/<input([^>]*)type="radio"([^>]*)>/g)].map(
    ([, antes = "", depois = ""]) => {
      const atributos = `${antes} ${depois}`;
      return {
        valor: /value="([^"]*)"/.exec(atributos)?.[1] ?? "",
        marcado: atributos.includes("checked"),
        travado: atributos.includes("disabled"),
      };
    },
  );
}

/**
 * Os termos da ajuda para cada motivo que nunca atribui (a lista do banco,
 * MOTIVOS_QUE_NUNCA_ATRIBUEM). O fora do horario fica de fora: e passagem
 * sem a frase de sempre, e o cartao fala da passagem com a frase. O tipo
 * cobre a lista inteira: motivo novo no banco sem termo aqui nao compila, e
 * o teste confere de novo em tempo de execucao (revisao curta da AG6a: a
 * ajuda tinha esquecido a conformidade). [AG6b mídia] Desde a revisao das
 * telas da AG6b, mais de um termo por motivo: o arquivo clinico e o
 * resultado ou laudo, a receita e a foto do corpo (a ajuda dizia so "exame
 * ou foto do corpo" e esquecia a receita).
 */
const TERMO_DO_MOTIVO_NA_AJUDA: Readonly<
  Record<
    Exclude<(typeof MOTIVOS_QUE_NUNCA_ATRIBUEM)[number], "fora_do_horario">,
    readonly string[]
  >
> = {
  urgencia: ["urgência"],
  sintoma: ["sintoma"],
  assunto_clinico: ["assunto clínico"],
  midia_nao_suportada: ["arquivo que o assistente não leu"],
  conformidade: ["resposta barrada pela conformidade"],
  // [AG6b mídia] início
  midia_clinica: ["resultado de exame", "laudo", "receita", "foto do corpo"],
  midia_nao_identificada: ["não identificou"],
  // [AG6b mídia] fim
};

// [AG6b mídia] início
/**
 * O termo da ajuda para cada tipo do leitor que vai para a equipe como
 * arquivo clinico (DECISAO_DO_TIPO_DO_LEITOR = midia_clinica). O tipo cobre
 * os tipos do leitor: tipo clinico novo sem termo aqui falha no teste.
 */
const TERMO_DO_TIPO_CLINICO_NA_AJUDA: Readonly<
  Partial<Record<TipoDoLeitor, readonly string[]>>
> = {
  resultado_ou_laudo: ["resultado de exame", "laudo"],
  receita: ["receita"],
  foto_do_corpo: ["foto do corpo"],
};
// [AG6b mídia] fim

/** O botao Salvar do cartao (o unico botao dele). */
function botaoSalvar(html: string): string {
  const botao = html
    .match(/<button[^>]*>[^<]*<\/button>/g)
    ?.find(
      (tag) =>
        tag.includes(TEXTOS_DA_PASSAGEM.salvar) ||
        tag.includes(TEXTOS_DA_PASSAGEM.salvando),
    );
  if (!botao) {
    throw new Error("Salvar da passagem nao encontrado");
  }
  return botao;
}

// ---------------------------------------------------------------------------
// "Para quem vai a conversa"
// ---------------------------------------------------------------------------

describe("cartão Para quem vai a conversa", () => {
  it("título, descrição, as duas opções e a ajuda do desenho", () => {
    const html = passagem();
    const lido = texto(html);
    expect(html).toContain('aria-labelledby="agente-passagem-titulo"');
    expect(lido).toContain("Para quem vai a conversa");
    expect(lido).toContain(TEXTOS_DA_PASSAGEM.descricao);
    expect(lido).toContain("Para a fila (Sem atendente)");
    expect(lido).toContain("Para o responsável do lead, quando houver");
    expect(lido).toContain(TEXTOS_DA_PASSAGEM.ajuda);
    expect(html).toContain(
      'role="radiogroup" aria-label="Para quem vai a conversa"',
    );
  });

  it("os textos acompanham a atribuição depois da frase de sempre (revisão da AG6a)", () => {
    expect(TEXTOS_DA_PASSAGEM.descricao).toBe(
      "Salvo no rascunho, vale ao publicar. Conta quando o assistente passa a conversa para a equipe com a frase de sempre.",
    );
    expect(TEXTOS_DA_PASSAGEM.opcoes.responsavel_do_lead.descricao).toBe(
      "Logo depois da frase de sempre, a conversa passa para o responsável, em atendimento, em Minhas, com um aviso na tela.",
    );
    const ajuda = TEXTOS_DA_PASSAGEM.ajuda;
    expect(ajuda).toContain(
      "Se alguém assumir antes, a conversa fica com quem assumiu.",
    );
    expect(ajuda).toContain("vai sempre para a fila");
    // O que o texto antigo prometia e nao e mais verdade: a atribuicao e
    // tentada mesmo quando a frase nao sai, e nao "ja fica" com ninguem.
    expect(
      TEXTOS_DA_PASSAGEM.opcoes.responsavel_do_lead.descricao,
    ).not.toContain("já fica");
    expect(TEXTOS_DA_PASSAGEM.descricao).not.toContain("o contato recebe");
    expect(TEXTOS_DA_PASSAGEM.descricao).not.toContain("frase fixa");
    // Revisao curta: sem o "vale ao publicar. Vale quando" repetido.
    expect(TEXTOS_DA_PASSAGEM.descricao.match(/\bvale\b/gi)).toHaveLength(1);
    const lido = texto(passagem());
    expect(lido).toContain(TEXTOS_DA_PASSAGEM.descricao);
    expect(lido).toContain(
      TEXTOS_DA_PASSAGEM.opcoes.responsavel_do_lead.descricao,
    );
  });

  it("a ajuda cita cada motivo que nunca atribui, a partir da lista do banco (revisão curta: faltava a conformidade)", () => {
    const ajuda = TEXTOS_DA_PASSAGEM.ajuda;
    expect(ajuda).toContain(
      "Quando o motivo é urgência, sintoma, assunto clínico, resultado de exame, laudo, receita ou foto do corpo, arquivo que o assistente não leu ou não identificou, ou resposta barrada pela conformidade, a conversa vai sempre para a fila.",
    );
    // Os termos de cada motivo de MOTIVOS_QUE_NUNCA_ATRIBUEM (o espelho de
    // c_motivos_que_nunca_atribuem), menos o fora do horario (passagem sem
    // a frase). Motivo novo na lista sem termo aqui falha.
    const termos: Record<string, readonly string[]> = TERMO_DO_MOTIVO_NA_AJUDA;
    const motivos = MOTIVOS_QUE_NUNCA_ATRIBUEM.filter(
      (motivo) => motivo !== "fora_do_horario",
    );
    expect(motivos).toContain("conformidade");
    for (const motivo of motivos) {
      const doMotivo = termos[motivo] ?? [];
      expect(doMotivo, `o motivo ${motivo} sem termo na ajuda`).not.toHaveLength(
        0,
      );
      for (const termo of doMotivo) {
        expect(ajuda, `${motivo}: ${termo}`).toContain(termo);
      }
    }
    // Nenhum termo sobrando (de motivo que saiu da lista).
    expect(Object.keys(termos).sort()).toEqual([...motivos].sort());
    // [AG6b mídia] início
    // Cada tipo do leitor que vai como arquivo clinico (a decisao do
    // servidor) tem o termo dele na ajuda, e os termos do motivo sao
    // exatamente os dos tipos: a receita nunca some de novo.
    const tiposClinicos = TIPOS_DO_LEITOR.filter(
      (tipo) => DECISAO_DO_TIPO_DO_LEITOR[tipo] === "midia_clinica",
    );
    expect(tiposClinicos).toEqual([
      "resultado_ou_laudo",
      "receita",
      "foto_do_corpo",
    ]);
    const doTipo: Partial<Record<string, readonly string[]>> =
      TERMO_DO_TIPO_CLINICO_NA_AJUDA;
    for (const tipo of tiposClinicos) {
      const termosDoTipo = doTipo[tipo] ?? [];
      expect(termosDoTipo, `o tipo ${tipo} sem termo na ajuda`).not.toHaveLength(
        0,
      );
      for (const termo of termosDoTipo) {
        expect(ajuda, `${tipo}: ${termo}`).toContain(termo);
      }
    }
    expect(Object.keys(doTipo).sort()).toEqual([...tiposClinicos].sort());
    expect(
      tiposClinicos.flatMap((tipo) => doTipo[tipo] ?? []),
    ).toEqual(TERMO_DO_MOTIVO_NA_AJUDA.midia_clinica);
    // [AG6b mídia] fim
    // A pessoa que escreve de novo antes da atribuicao (o banco recusa com
    // mensagem_nova) tambem fica na fila.
    expect(ajuda).toContain(
      "Se a pessoa escrever de novo antes, também fica na fila.",
    );
    // O leitor de tela ouve a ajuda inteira no cartao.
    expect(texto(passagem())).toContain(ajuda);
  });

  it("a ajuda é a descrição do grupo de cartões (aria-describedby)", () => {
    const html = passagem();
    const grupo = /<div role="radiogroup"[^>]*>/.exec(html)?.[0] ?? "";
    expect(grupo).toContain('aria-describedby="agente-passagem-ajuda"');
    expect(html).toMatch(
      /<p id="agente-passagem-ajuda"[^>]*>[^<]*Se alguém assumir antes/,
    );
    // So um paragrafo com o id na tela.
    expect(html.match(/id="agente-passagem-ajuda"/g)).toHaveLength(1);
    // Travado (recepcao), a ajuda continua ligada ao grupo.
    const travado = passagem({ podeEditar: false, dica: DICA_RECEPCAO });
    expect(/<div role="radiogroup"[^>]*>/.exec(travado)?.[0]).toContain(
      'aria-describedby="agente-passagem-ajuda"',
    );
  });

  it("a fila vem marcada por padrão (D-55), e a regra salva vem marcada", () => {
    expect(regrasDaPassagemPadrao().passagemPara).toBe("fila");
    expect(radios(passagem())).toEqual([
      { valor: "fila", marcado: true, travado: false },
      { valor: "responsavel_do_lead", marcado: false, travado: false },
    ]);
    expect(
      radios(passagem({ passagemPara: "responsavel_do_lead" })).map(
        (r) => r.marcado,
      ),
    ).toEqual([false, true]);
  });

  it("sem mudança, o Salvar fica desabilitado com a dica (e com 40px)", () => {
    const html = passagem();
    const salvar = botaoSalvar(html);
    expect(salvar).toContain("disabled");
    expect(salvar).toContain("Salvar regra");
    expect(salvar).toContain("h-10");
    // A dica mora no gatilho focavel do DisabledWithHint.
    expect(html).toContain('tabindex="0"');
  });

  it("salvando: o rótulo muda e o botão fica ocupado", () => {
    const salvar = botaoSalvar(passagem({ salvando: true }));
    expect(salvar).toContain("Salvando...");
    expect(salvar).toContain('aria-busy="true"');
  });

  it("recepção: tudo visível e travado, com a dica de permissão", () => {
    const html = passagem({ podeEditar: false, dica: DICA_RECEPCAO });
    expect(radios(html).every((r) => r.travado)).toBe(true);
    expect(html).toContain('aria-disabled="true"');
    expect(botaoSalvar(html)).toContain("disabled");
    expect(texto(html)).toContain("Para o responsável do lead, quando houver");
  });

  it("o ladrilho é decorativo (UserRoundCheck, escondido do leitor de tela)", () => {
    const html = passagem();
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><svg[^>]*lucide-user-round-check/,
    );
  });

  it("o não salvo do cartão conta como o do público (mesma aba, descartar remonta os dois)", () => {
    expect(comAPassagem(NADA_NAO_SALVO, false)).toBe(NADA_NAO_SALVO);
    const pendente = comAPassagem(NADA_NAO_SALVO, true);
    expect(pendente.publico).toBe(true);
    expect(formulariosNaoSalvos(pendente, false)).toEqual(["publico"]);
    const jaPendente = { ...NADA_NAO_SALVO, publico: true };
    expect(comAPassagem(jaPendente, true)).toBe(jaPendente);
  });
});

// ---------------------------------------------------------------------------
// "Urgência"
// ---------------------------------------------------------------------------

describe("cartão Urgência", () => {
  it("só o texto nesta rodada, com o chip do Atendimento de exemplo", () => {
    const html = renderToStaticMarkup(<CartaoDaUrgencia />);
    const lido = texto(html);
    expect(html).toContain('aria-labelledby="agente-urgencia-titulo"');
    expect(lido).toContain("Urgência");
    expect(lido).toContain(
      "Quando a pessoa descreve algo que pode ser uma emergência, a conversa passa para a equipe marcada como Urgente, no topo do Atendimento.",
    );
    expect(lido).toContain(TEXTOS_DA_URGENCIA.marca);
    expect(html).toContain("lucide-bell-ring");
    expect(lido).toContain("Urgente");
    // Nada para ligar nem salvar: sem botao, sem chave, sem campo.
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("<input");
  });

  it("o ladrilho é decorativo (LifeBuoy, escondido do leitor de tela)", () => {
    const html = renderToStaticMarkup(<CartaoDaUrgencia />);
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><svg[^>]*lucide-life-buoy/,
    );
  });
});

// ---------------------------------------------------------------------------
// Na aba Regras e limites do painel
// ---------------------------------------------------------------------------

describe("aba Regras e limites com a AG6a", () => {
  it("a passagem vem depois dos prazos, a urgência depois dela e os gatilhos depois", () => {
    const html = painel();
    const prazos = html.indexOf('aria-labelledby="agente-prazos-titulo"');
    const daPassagem = html.indexOf('aria-labelledby="agente-passagem-titulo"');
    const daUrgencia = html.indexOf('aria-labelledby="agente-urgencia-titulo"');
    const gatilhos = html.indexOf('aria-labelledby="agente-gatilhos-titulo"');
    expect(prazos).toBeGreaterThan(-1);
    expect(daPassagem).toBeGreaterThan(prazos);
    expect(daUrgencia).toBeGreaterThan(daPassagem);
    expect(gatilhos).toBeGreaterThan(daUrgencia);
  });

  it("o cartão lê a regra do rascunho (config.regras)", () => {
    const html = painel(
      dadosDeTeste({
        config: configDeTeste({
          base: [ITEM_ATIVO],
          regras: {
            passagemPara: "responsavel_do_lead",
            avisoDeUrgencia: false,
          },
        }),
      }),
    );
    const inicio = html.indexOf('aria-labelledby="agente-passagem-titulo"');
    const fim = html.indexOf('aria-labelledby="agente-urgencia-titulo"');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    expect(radios(html.slice(inicio, fim))).toEqual([
      { valor: "fila", marcado: false, travado: false },
      { valor: "responsavel_do_lead", marcado: true, travado: false },
    ]);
  });

  it("o gatilho obrigatório da emergência aparece travado na lista", () => {
    expect(GATILHOS_OBRIGATORIOS.map((g) => g.chave)).toContain("urgencia");
    expect(texto(painel())).toContain(
      "Algo que pode ser uma emergência (passa como Urgente)",
    );
  });

  it("recepção vê os dois cartões, com a passagem travada e a dica", () => {
    const html = painel(
      dadosDeTeste({ podeEditar: false, dicaSemPermissao: DICA_RECEPCAO }),
    );
    const inicio = html.indexOf('aria-labelledby="agente-passagem-titulo"');
    const fim = html.indexOf('aria-labelledby="agente-urgencia-titulo"');
    const doCartao = html.slice(inicio, fim);
    expect(radios(doCartao).length).toBe(2);
    expect(radios(doCartao).every((r) => r.travado)).toBe(true);
    expect(fim).toBeGreaterThan(-1);
  });

  it("salvar a passagem não remonta os outros formulários (a chave é só dela)", () => {
    const antes = chavesDosFormularios(configDeTeste());
    const depois = chavesDosFormularios(
      configDeTeste({
        regras: { passagemPara: "responsavel_do_lead", avisoDeUrgencia: false },
      }),
    );
    expect(depois.passagem).not.toBe(antes.passagem);
    expect(depois.publico).toBe(antes.publico);
    expect(depois.horario).toBe(antes.horario);
    expect(depois.prazos).toBe(antes.prazos);
    // Sem a regra (configuracao montada a mao), a fila.
    const semRegras: Record<string, unknown> = { ...configDeTeste() };
    delete semRegras.regras;
    expect(
      chavesDosFormularios(
        semRegras as Parameters<typeof chavesDosFormularios>[0],
      ).passagem,
    ).toBe(antes.passagem);
  });

  it("o que mudou: a passagem conta uma vez, com o destino escrito", () => {
    const publicada = {
      ...configDeTeste({ base: [ITEM_ATIVO] }),
      status: "publicada" as const,
    };
    const comRegra = (passagemPara: PassagemDaConversa) =>
      painel(
        dadosDeTeste({
          config: configDeTeste({
            base: [ITEM_ATIVO],
            regras: { passagemPara, avisoDeUrgencia: false },
          }),
          publicada,
          versoes: [VERSAO_2],
        }),
        "versoes",
      );
    expect(texto(comRegra("responsavel_do_lead"))).toContain(
      "Passar a conversa para: o responsável do lead",
    );
    expect(texto(comRegra("fila"))).not.toContain("Passar a conversa para");
  });
});

// ---------------------------------------------------------------------------
// Simulador, habilidades e textos
// ---------------------------------------------------------------------------

describe("simulador, habilidades e textos da AG6a", () => {
  it("o cenário do sinal de emergência, sem dado de paciente", () => {
    const cenario = CENARIOS_DO_SIMULADOR.find((c) => c.chave === "urgencia");
    expect(cenario?.rotulo).toBe("Paciente com sinal de emergência");
    expect(cenario?.mensagem).toMatch(/falta de ar/);
    // A acao aceita o mesmo cenario (o enum CENARIOS confere os dois).
    expect(readFileSync("app/(app)/agente/actions.ts", "utf8")).toMatch(
      /"urgencia",/,
    );
  });

  // [AG6b mídia] início
  // Ate a AG6b, este teste exigia a AUSENCIA de "Entender áudio" (o audio
  // ficava fora da AG6a). A AG6b o traz (desenho da AG6b, secao 6): a aba
  // Habilidades ganha "Entender áudio" e "Ler imagem e documento", com as
  // notas (tests/unit/agente/telas-ag6b.test.tsx tem o resto).
  it("áudio, foto e PDF valem sempre: a aba Habilidades não tem chave deles (decisão do dono de 06/11/2026)", () => {
    const html = painel(dadosDeTeste(), "habilidades");
    expect(texto(html)).not.toContain("Entender áudio");
    expect(texto(html)).not.toContain("Ler imagem e documento");
  });
  // [AG6b mídia] fim

  it("sem travessão e com linguagem de recepcionista", () => {
    const textos = [
      ...Object.values(TEXTOS_DA_PASSAGEM).flatMap((valor) =>
        typeof valor === "string"
          ? [valor]
          : Object.values(valor).flatMap((opcao) => [
              opcao.rotulo,
              opcao.descricao,
            ]),
      ),
      ...Object.values(TEXTOS_DA_URGENCIA),
    ];
    expect(textos.length).toBeGreaterThan(10);
    for (const frase of textos) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).not.toMatch(
        /\b(handoff|tenant|opt-in|escalation|owner|assignee|fallback)\b/i,
      );
    }
  });
});
