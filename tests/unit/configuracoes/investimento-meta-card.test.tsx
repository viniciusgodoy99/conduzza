import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O cartao importa as Server Actions e o roteador; aqui so a renderizacao e
// as regras puras importam.
vi.mock("@/app/(app)/configuracoes/anuncios-meta-actions", () => ({
  salvarTokenDeLeituraMetaAction: vi.fn(),
  testarLeituraMetaAction: vi.fn(),
  removerTokenDeLeituraMetaAction: vi.fn(),
}));
vi.mock("@/lib/actions/investimento-meta", () => ({
  atualizarInvestimentoMetaAction: vi.fn(),
}));
vi.mock("@/app/(app)/configuracoes/actions", () => ({
  alternarEnvioMetaAction: vi.fn(),
  salvarContaMetaAction: vi.fn(),
  salvarTokenMetaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

import { EXECUCAO_STATUS } from "@/components/configuracoes/automacoes-de-fluxo/status-da-execucao";
import {
  ATUALIZANDO_NO_MAXIMO_MS,
  estaAtualizando,
  estadoDaLeituraMeta,
  fusosComHorarioDiferente,
  INTERVALO_DO_PEDIDO_MANUAL_MS,
  leituraDaLinha,
  leituraPausada,
  problemaGravadoNaTela,
  resultadoLocalVale,
  TEXTOS_DA_LEITURA,
  textoDoAtualizadoEm,
  textoDoPedidoCedoDemais,
  type LeituraDoInvestimento,
} from "@/components/configuracoes/investimento-meta";
import {
  dicasDoCartao,
  InvestimentoMetaCard,
  resultadoDoTesteNaTela,
} from "@/components/configuracoes/investimento-meta-card";
import { MetaAdsTab } from "@/components/configuracoes/meta-ads-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ACCESS_LEVEL_STATUS,
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
  ATIVIDADE_STATUS,
  CONSENT_STATUS,
  CONTACT_RECENCY,
  CONVERSAO_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  IA_AGENDA_STATUS,
  LEITURA_META_STATUS,
  PATIENT_TAG,
  RECORD_STATUS,
  REGUA_STATUS,
  TOKEN_META_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import { textoDoProblemaDeLeitura } from "@/lib/domain/meta-anuncios";

// Cartao "Investimento nos anuncios" (Configuracoes, aba Anuncios da Meta;
// Fase 4): o chip em tres camadas para cada situacao, os botoes visiveis e
// desabilitados com a dica do porque, a regiao aria-live sempre montada, o
// "Atualizado em" no fuso da clinica, o campo do token write-only e sem o
// olho, e a conta de anuncios que nao se repete.

const AGORA = Date.parse("2026-10-03T17:30:00Z");
const DICA = "Somente administradores e gestores alteram as configurações";

function leitura(campos: Partial<LeituraDoInvestimento> = {}): LeituraDoInvestimento {
  return {
    situacao: "funcionando",
    problema: null,
    codigoDaMeta: null,
    nomeDaConta: "Clínica Sorriso Ads",
    moeda: "BRL",
    fusoDaConta: "America/Fortaleza",
    contaAtiva: true,
    testadaEm: "2026-10-01T12:00:00Z",
    sincronizadoEm: "2026-10-03T17:05:00Z",
    tentadoEm: "2026-10-03T17:05:00Z",
    atualizacaoPedidaEm: null,
    ...campos,
  };
}

function cartao(
  props: Partial<React.ComponentProps<typeof InvestimentoMetaCard>> = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <InvestimentoMetaCard
        adAccountId="act_123456789"
        temTokenDeLeitura
        leitura={leitura()}
        timezone="America/Fortaleza"
        agoraMs={AGORA}
        podeGerenciar
        dica={DICA}
        {...props}
      />
    </TooltipProvider>,
  );
}

/** O botao com aquele texto esta desabilitado? */
function botaoDesabilitado(html: string, texto: string): boolean {
  const indice = html.indexOf(`${texto}</button>`);
  expect(indice).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return /disabled=""/.test(html.slice(abertura, html.indexOf(">", abertura)));
}

/** O botao com aquele texto esta dentro do envoltorio da dica? */
function comEnvoltorioDeDica(html: string, texto: string): boolean {
  const indice = html.indexOf(`${texto}</button>`);
  const abertura = html.lastIndexOf("<button", indice);
  const antes = html.slice(Math.max(0, abertura - 200), abertura);
  return /<span[^>]*tabindex="0"[^>]*>\s*$/.test(antes);
}

describe("chip da situação", () => {
  it("sem conta ou sem token: Leitura não configurada, com os botões presos e a dica", () => {
    for (const props of [
      { adAccountId: null },
      { temTokenDeLeitura: false },
    ]) {
      const html = cartao({ leitura: null, ...props });
      expect(html).toContain("Leitura não configurada");
      expect(botaoDesabilitado(html, "Testar leitura")).toBe(true);
      expect(botaoDesabilitado(html, "Atualizar agora")).toBe(true);
      expect(comEnvoltorioDeDica(html, "Testar leitura")).toBe(true);
      expect(comEnvoltorioDeDica(html, "Atualizar agora")).toBe(true);
    }
  });

  it("conta e token sem teste: Ainda não testada, com o teste liberado", () => {
    const html = cartao({ leitura: null });
    expect(html).toContain("Ainda não testada");
    expect(botaoDesabilitado(html, "Testar leitura")).toBe(false);
    expect(comEnvoltorioDeDica(html, "Testar leitura")).toBe(false);
  });

  it("funcionando: Lendo o investimento, conta lida e Atualizado em no fuso da clínica", () => {
    const html = cartao();
    expect(html).toContain("Lendo o investimento");
    // 17:05 UTC e 14:05 em Fortaleza.
    expect(html).toContain("Atualizado em 03/10 às 14:05");
    expect(html).toContain("Conta lida: Clínica Sorriso Ads · BRL");
    expect(botaoDesabilitado(html, "Atualizar agora")).toBe(false);
    expect(botaoDesabilitado(html, "Testar leitura")).toBe(false);
  });

  it("com problema que pausa: o texto da Meta, a pausa dita e Atualizar agora preso", () => {
    const html = cartao({
      leitura: leitura({
        situacao: "com_problema",
        problema: "token_invalido",
        codigoDaMeta: 190,
      }),
    });
    expect(html).toContain("Leitura com problema");
    expect(html).toContain("A leitura diária está parada.");
    expect(html).toContain(textoDoProblemaDeLeitura("token_invalido"));
    expect(botaoDesabilitado(html, "Atualizar agora")).toBe(true);
    expect(comEnvoltorioDeDica(html, "Atualizar agora")).toBe(true);
    // Testar continua: e por ele que a pausa sai.
    expect(botaoDesabilitado(html, "Testar leitura")).toBe(false);
    // Conta lida e avisos so com a leitura funcionando.
    expect(html).not.toContain("Conta lida");
  });

  it("com problema passageiro: a última leitura teve problema, e dá para atualizar", () => {
    const html = cartao({
      leitura: leitura({ situacao: "com_problema", problema: "meta_indisponivel" }),
    });
    expect(html).toContain("Leitura com problema");
    expect(html).toContain("A última leitura teve problema.");
    expect(html).toContain(textoDoProblemaDeLeitura("meta_indisponivel"));
    expect(botaoDesabilitado(html, "Atualizar agora")).toBe(false);
  });

  it("conta sem acesso cita a conta salva", () => {
    const html = cartao({
      leitura: leitura({ situacao: "com_problema", problema: "conta_sem_acesso" }),
    });
    expect(html).toContain("A Meta não encontrou a conta act_123456789");
  });

  it("atualizando: chip girando e o botão preso com a dica", () => {
    const html = cartao({
      leitura: leitura({
        atualizacaoPedidaEm: "2026-10-03T17:29:00Z",
        tentadoEm: "2026-10-03T17:05:00Z",
      }),
    });
    expect(html).toContain("Atualizando");
    expect(html).toContain("motion-safe:animate-spin");
    expect(botaoDesabilitado(html, "Atualizar agora")).toBe(true);
    expect(comEnvoltorioDeDica(html, "Atualizar agora")).toBe(true);
  });
});

describe("campo do token e botões", () => {
  it("campo de senha write-only, sem valor, sem olho, com o rótulo e a ajuda", () => {
    const html = cartao();
    expect(html).toContain("Token de leitura de anúncios");
    expect(html).toMatch(/<input[^>]*type="password"[^>]*>/);
    expect(html).toMatch(/<input[^>]*autoComplete="off"[^>]*>/i);
    expect(html).toMatch(/<input[^>]*spellCheck="false"[^>]*>/i);
    expect(html).toMatch(/<input[^>]*value=""[^>]*>/);
    expect(html).not.toContain("Mostrar");
    expect(html).toContain("Pode ser o mesmo token da API de conversões");
    expect(html).toContain("ads_read");
    expect(html).toContain("sem validade");
    expect(html).toContain("Token salvo");
  });

  it("os quatro botões existem; salvar começa preso até colar o token", () => {
    const html = cartao();
    for (const texto of [
      "Salvar token",
      "Testar leitura",
      "Atualizar agora",
      "Remover token",
    ]) {
      expect(html).toContain(texto);
    }
    expect(botaoDesabilitado(html, "Salvar token")).toBe(true);
    expect(comEnvoltorioDeDica(html, "Salvar token")).toBe(true);
    expect(botaoDesabilitado(html, "Remover token")).toBe(false);
  });

  it("sem token salvo: Remover token preso e o chip Sem token", () => {
    const html = cartao({ temTokenDeLeitura: false, leitura: null });
    expect(html).toContain("Sem token");
    expect(botaoDesabilitado(html, "Remover token")).toBe(true);
  });

  it("quem não gerencia vê tudo desabilitado, com a dica alcançável", () => {
    const html = cartao({ podeGerenciar: false });
    for (const texto of [
      "Salvar token",
      "Testar leitura",
      "Atualizar agora",
      "Remover token",
    ]) {
      expect(botaoDesabilitado(html, texto)).toBe(true);
      expect(comEnvoltorioDeDica(html, texto)).toBe(true);
    }
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*>/);
  });

  it("a região do resultado está sempre montada, com aria-live", () => {
    for (const html of [cartao(), cartao({ leitura: null, adAccountId: null })]) {
      expect(html).toMatch(/aria-live="polite"/);
    }
  });

  it("o cartão é uma região com o nome do título", () => {
    const html = cartao();
    expect(html).toMatch(/role="region"[^>]*aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Investimento nos anúncios");
  });
});

describe("dicas dos botões desabilitados", () => {
  const base = {
    podeGerenciar: true,
    dica: DICA,
    tokenDigitado: "",
    configurada: true,
    pausada: false,
    atualizando: false,
    temTokenDeLeitura: true,
  };

  it("sem configuração: a dica fixa no testar e no atualizar", () => {
    const dicas = dicasDoCartao({ ...base, configurada: false });
    expect(dicas.testar).toBe(
      "Salve a conta de anúncios e o token de leitura antes de testar.",
    );
    expect(dicas.atualizar).toBe(TEXTOS_DA_LEITURA.semConfiguracao);
  });

  it("pausada e atualizando têm o próprio porquê", () => {
    expect(dicasDoCartao({ ...base, pausada: true }).atualizar).toBe(
      TEXTOS_DA_LEITURA.pausada,
    );
    expect(dicasDoCartao({ ...base, atualizando: true }).atualizar).toBe(
      TEXTOS_DA_LEITURA.atualizacaoEmAndamento,
    );
    expect(dicasDoCartao(base).atualizar).toBeNull();
  });

  it("salvar: vazio, incompleto ou liberado", () => {
    expect(dicasDoCartao(base).salvar).toBe(TEXTOS_DA_LEITURA.tokenVazio);
    expect(dicasDoCartao({ ...base, tokenDigitado: "EAAcurto" }).salvar).toBe(
      TEXTOS_DA_LEITURA.tokenInvalido,
    );
    expect(
      dicasDoCartao({
        ...base,
        tokenDigitado: "  EAAGtokendeleituradeteste1234567890  ",
      }).salvar,
    ).toBeNull();
  });

  it("sem permissão: a dica do papel em todos", () => {
    const dicas = dicasDoCartao({ ...base, podeGerenciar: false });
    expect(Object.values(dicas)).toEqual([DICA, DICA, DICA, DICA]);
  });
});

describe("resultado do teste na tela", () => {
  it("sucesso: a frase fixa, o gasto recente e a leitura pedida", () => {
    expect(
      resultadoDoTesteNaTela({
        ok: true,
        conta: {
          nome: "Clínica Sorriso Ads",
          adAccountId: "act_123456789",
          moeda: "BRL",
          fuso: "America/Fortaleza",
          ativa: true,
        },
        temGasto: true,
        avisos: [],
        leituraPedida: true,
      }),
    ).toEqual({
      tom: "success",
      texto: `Leitura funcionando: conta Clínica Sorriso Ads (act_123456789), em BRL. Há investimento nos últimos 30 dias. ${TEXTOS_DA_LEITURA.leituraPedida}`,
    });
  });

  it("sucesso sem nome da conta", () => {
    const tela = resultadoDoTesteNaTela({
      ok: true,
      conta: {
        nome: null,
        adAccountId: "act_123456789",
        moeda: "USD",
        fuso: "America/Fortaleza",
        ativa: true,
      },
      temGasto: false,
      avisos: ["outra_moeda"],
      leituraPedida: false,
    });
    expect(tela.texto).toBe(
      "Leitura funcionando: conta act_123456789, em USD. Nenhum investimento nos últimos 30 dias.",
    );
  });

  it("falha da Meta depois de salvar: alerta com o título do token salvo", () => {
    expect(
      resultadoDoTesteNaTela({
        ok: false,
        error: "texto",
        problema: "token_invalido",
        tokenSalvo: true,
      }),
    ).toEqual({
      tom: "alert",
      titulo: TEXTOS_DA_LEITURA.tokenSalvoComFalha,
      texto: "texto",
    });
  });

  it("token salvo sem conta: atenção, não erro", () => {
    expect(
      resultadoDoTesteNaTela({
        ok: false,
        error: TEXTOS_DA_LEITURA.tokenSalvoSemConta,
        tokenSalvo: true,
      }).tom,
    ).toBe("warning");
  });
});

describe("avisos da conta lida", () => {
  it("moeda estrangeira: diz a moeda e que Resultados não converte", () => {
    const html = cartao({ leitura: leitura({ moeda: "USD" }) });
    expect(html).toContain("A conta de anúncios está em USD");
    expect(html).toContain("Conta em outra moeda");
  });

  it("conta inativa e fuso com outro horário", () => {
    const html = cartao({
      leitura: leitura({ contaAtiva: false, fusoDaConta: "America/Los_Angeles" }),
    });
    expect(html).toContain("não está ativa");
    expect(html).toContain("fuso da conta de anúncios (America/Los_Angeles)");
  });

  it("fuso de outro nome com o mesmo horário não avisa", () => {
    const html = cartao({ leitura: leitura({ fusoDaConta: "America/Sao_Paulo" }) });
    expect(html).not.toContain("fuso da conta de anúncios");
  });
});

describe("regras puras", () => {
  it("estadoDaLeituraMeta segue a ordem: configuração, atualizando, problema", () => {
    const base = {
      adAccountId: "act_123456789",
      temTokenDeLeitura: true,
      agoraMs: AGORA,
    };
    expect(estadoDaLeituraMeta({ ...base, adAccountId: null, leitura: leitura() })).toBe(
      "nao_configurada",
    );
    expect(estadoDaLeituraMeta({ ...base, leitura: null })).toBe("nao_testada");
    expect(
      estadoDaLeituraMeta({ ...base, leitura: leitura({ situacao: "nao_testada" }) }),
    ).toBe("nao_testada");
    expect(estadoDaLeituraMeta({ ...base, leitura: leitura() })).toBe("funcionando");
    expect(
      estadoDaLeituraMeta({
        ...base,
        leitura: leitura({
          situacao: "com_problema",
          problema: "meta_indisponivel",
          atualizacaoPedidaEm: "2026-10-03T17:20:00Z",
        }),
      }),
    ).toBe("atualizando");
  });

  it("estaAtualizando: pedido mais novo que a tentativa, com teto de uma hora", () => {
    expect(
      estaAtualizando(
        { atualizacaoPedidaEm: "2026-10-03T17:20:00Z", tentadoEm: null },
        AGORA,
      ),
    ).toBe(true);
    expect(
      estaAtualizando(
        {
          atualizacaoPedidaEm: "2026-10-03T17:20:00Z",
          tentadoEm: "2026-10-03T17:21:00Z",
        },
        AGORA,
      ),
    ).toBe(false);
    expect(
      estaAtualizando(
        { atualizacaoPedidaEm: "2026-10-03T16:00:00Z", tentadoEm: null },
        AGORA,
      ),
    ).toBe(false);
    expect(ATUALIZANDO_NO_MAXIMO_MS).toBe(60 * 60_000);
    expect(estaAtualizando({ atualizacaoPedidaEm: null, tentadoEm: null }, AGORA)).toBe(
      false,
    );
  });

  it("leituraPausada só nos quatro problemas de configuração", () => {
    expect(leituraPausada(leitura({ situacao: "com_problema", problema: "sem_permissao" }))).toBe(true);
    expect(
      leituraPausada(leitura({ situacao: "com_problema", problema: "limite_da_meta" })),
    ).toBe(false);
    expect(leituraPausada(null)).toBe(false);
  });

  it("textoDoPedidoCedoDemais: n de 1 a 10, no singular quando é 1", () => {
    expect(INTERVALO_DO_PEDIDO_MANUAL_MS).toBe(10 * 60_000);
    const liberado = (minutosDesdeOPedido: number) =>
      new Date(AGORA - minutosDesdeOPedido * 60_000 + INTERVALO_DO_PEDIDO_MANUAL_MS).toISOString();
    expect(textoDoPedidoCedoDemais(liberado(0.2), AGORA)).toBe(
      "O investimento foi atualizado há 1 minuto. Tente de novo daqui a pouco.",
    );
    expect(textoDoPedidoCedoDemais(liberado(4.9), AGORA)).toBe(
      "O investimento foi atualizado há 4 minutos. Tente de novo daqui a pouco.",
    );
    expect(textoDoPedidoCedoDemais(liberado(25), AGORA)).toContain("há 10 minutos");
    // O formato do Postgres (microssegundos e +00:00) tambem vale.
    expect(
      textoDoPedidoCedoDemais("2026-10-03T17:34:59.123456+00:00", AGORA),
    ).toContain("há 5 minutos");
    expect(textoDoPedidoCedoDemais(null, AGORA)).toBe(
      "O investimento acabou de ser atualizado. Tente de novo daqui a pouco.",
    );
  });

  it("textoDoAtualizadoEm no fuso informado; sem sincronização, nulo", () => {
    expect(textoDoAtualizadoEm("2026-10-03T02:30:00Z", "America/Fortaleza")).toBe(
      "Atualizado em 02/10 às 23:30",
    );
    expect(textoDoAtualizadoEm(null, "America/Fortaleza")).toBeNull();
  });

  it("fusosComHorarioDiferente compara o horário, não o nome", () => {
    expect(fusosComHorarioDiferente("America/Sao_Paulo", "America/Fortaleza", AGORA)).toBe(false);
    expect(fusosComHorarioDiferente("America/Manaus", "America/Fortaleza", AGORA)).toBe(true);
    expect(fusosComHorarioDiferente("Nada/Isso", "America/Fortaleza", AGORA)).toBe(true);
  });

  it("leituraDaLinha nunca inventa funcionando", () => {
    const linha = {
      situacao: "algo_novo",
      problema: null,
      codigo_da_meta: null,
      nome_da_conta: null,
      moeda: null,
      fuso_da_conta: null,
      conta_ativa: null,
      testada_em: null,
      sincronizado_em: null,
      tentado_em: null,
      atualizacao_pedida_em: null,
    };
    expect(leituraDaLinha(linha)?.situacao).toBe("nao_testada");
    expect(leituraDaLinha({ ...linha, situacao: "com_problema" })?.problema).toBe("outro");
    expect(
      leituraDaLinha({ ...linha, situacao: "funcionando", problema: "token_invalido" })?.problema,
    ).toBeNull();
    expect(leituraDaLinha(null)).toBeNull();
  });
});

describe("resultado local e situação gravada", () => {
  // O "Atualizar agora" mostra um aviso local e a tela recarrega a cada 5 s
  // sem remontar o cartão. Quando o job registra a tentativa, a situação
  // gravada é a mais nova: o aviso sai e o problema dela aparece.
  const PEDIDO_FEITO_SOBRE = "2026-10-03T17:05:00Z";

  // O cartão faz isto a cada render: resultado vigente e problema gravado.
  function naTela(entrada: {
    tentadoEmBase: string | null;
    leitura: LeituraDoInvestimento;
  }) {
    const estado = estadoDaLeituraMeta({
      adAccountId: "act_123456789",
      temTokenDeLeitura: true,
      leitura: entrada.leitura,
      agoraMs: AGORA,
    });
    const vigente = resultadoLocalVale({
      tentadoEmBase: entrada.tentadoEmBase,
      tentadoEmAtual: entrada.leitura.tentadoEm,
    });
    return {
      estado,
      vigente,
      problema: problemaGravadoNaTela({
        temResultadoVigente: vigente,
        estado,
        leitura: entrada.leitura,
      }),
    };
  }

  it("pedido de atualização seguido de falha que pausa: o aviso sai e o problema aparece", () => {
    const tela = naTela({
      tentadoEmBase: PEDIDO_FEITO_SOBRE,
      leitura: leitura({
        situacao: "com_problema",
        problema: "token_invalido",
        codigoDaMeta: 190,
        atualizacaoPedidaEm: "2026-10-03T17:20:00Z",
        tentadoEm: "2026-10-03T17:20:40Z",
      }),
    });
    expect(tela).toEqual({
      estado: "com_problema",
      vigente: false,
      problema: "token_invalido",
    });
  });

  it("pedido de atualização seguido de leitura boa: o aviso de alguns minutos sai", () => {
    const tela = naTela({
      tentadoEmBase: PEDIDO_FEITO_SOBRE,
      leitura: leitura({
        atualizacaoPedidaEm: "2026-10-03T17:20:00Z",
        tentadoEm: "2026-10-03T17:20:40Z",
        sincronizadoEm: "2026-10-03T17:20:40Z",
      }),
    });
    expect(tela).toEqual({ estado: "funcionando", vigente: false, problema: null });
  });

  it("pedido de atualização ainda na fila: o aviso continua", () => {
    const tela = naTela({
      tentadoEmBase: PEDIDO_FEITO_SOBRE,
      leitura: leitura({
        atualizacaoPedidaEm: "2026-10-03T17:20:00Z",
        tentadoEm: PEDIDO_FEITO_SOBRE,
      }),
    });
    expect(tela).toEqual({ estado: "atualizando", vigente: true, problema: null });
  });

  it("teste que falhou sem tentativa nova do job: o resultado do teste fica e o gravado não se repete", () => {
    const tela = naTela({
      tentadoEmBase: PEDIDO_FEITO_SOBRE,
      leitura: leitura({
        situacao: "com_problema",
        problema: "sem_permissao",
        tentadoEm: PEDIDO_FEITO_SOBRE,
      }),
    });
    expect(tela).toEqual({ estado: "com_problema", vigente: true, problema: null });
  });

  it("sem resultado local, o problema gravado aparece só com o chip de problema", () => {
    expect(
      problemaGravadoNaTela({
        temResultadoVigente: false,
        estado: "com_problema",
        leitura: leitura({ situacao: "com_problema", problema: "limite_da_meta" }),
      }),
    ).toBe("limite_da_meta");
    expect(
      problemaGravadoNaTela({
        temResultadoVigente: false,
        estado: "atualizando",
        leitura: leitura({ situacao: "com_problema", problema: "limite_da_meta" }),
      }),
    ).toBeNull();
    expect(
      problemaGravadoNaTela({ temResultadoVigente: false, estado: "nao_testada", leitura: null }),
    ).toBeNull();
  });

  it("resultadoLocalVale compara instantes do servidor, não o texto", () => {
    // Nenhuma tentativa ainda: vale.
    expect(resultadoLocalVale({ tentadoEmBase: null, tentadoEmAtual: null })).toBe(true);
    // A primeira tentativa depois do resultado: caducou.
    expect(
      resultadoLocalVale({ tentadoEmBase: null, tentadoEmAtual: "2026-10-03T17:20:40Z" }),
    ).toBe(false);
    // O mesmo instante em outro formato (Postgres com +00:00): vale.
    expect(
      resultadoLocalVale({
        tentadoEmBase: "2026-10-03T17:05:00Z",
        tentadoEmAtual: "2026-10-03T17:05:00+00:00",
      }),
    ).toBe(true);
    expect(
      resultadoLocalVale({
        tentadoEmBase: "2026-10-03T17:05:00.000001+00:00",
        tentadoEmAtual: "2026-10-03T17:05:01+00:00",
      }),
    ).toBe(false);
  });
});

describe("LEITURA_META_STATUS", () => {
  const TODOS: StatusDefinition[] = [
    ...Object.values(APPOINTMENT_STATUS),
    ...Object.values(CONVERSATION_STATUS),
    ...Object.values(FUNNEL_STAGE),
    ...Object.values(CONTACT_RECENCY),
    ...Object.values(PATIENT_TAG),
    ...Object.values(APPOINTMENT_FLAG),
    ...Object.values(RECORD_STATUS),
    ...Object.values(REGUA_STATUS),
    ...Object.values(WHATSAPP_CONNECTION_STATUS),
    ...Object.values(ACCESS_LEVEL_STATUS),
    ...Object.values(IA_AGENDA_STATUS),
    ...Object.values(CONVERSAO_STATUS),
    ...Object.values(TOKEN_META_STATUS),
    ...Object.values(CONSENT_STATUS),
    ...Object.values(ATIVIDADE_STATUS),
    ...Object.values(EXECUCAO_STATUS),
  ];

  it("os rótulos fixos dos chips", () => {
    expect(Object.fromEntries(
      Object.entries(LEITURA_META_STATUS).map(([chave, d]) => [chave, d.label]),
    )).toEqual({
      nao_configurada: "Leitura não configurada",
      nao_testada: "Ainda não testada",
      funcionando: "Lendo o investimento",
      com_problema: "Leitura com problema",
      atualizando: "Atualizando",
    });
  });

  it("três camadas e forma própria em cada situação", () => {
    const icones = Object.values(LEITURA_META_STATUS).map((d) => d.icon);
    expect(new Set(icones).size).toBe(icones.length);
    for (const definicao of Object.values(LEITURA_META_STATUS)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.tone.length).toBeGreaterThan(2);
    }
  });

  it("um ícone, uma cor: só ícones que já têm dono, no mesmo tom", () => {
    for (const definicao of Object.values(LEITURA_META_STATUS)) {
      const donos = TODOS.filter((outro) => outro.icon === definicao.icon);
      expect(donos.length).toBeGreaterThan(0);
      for (const dono of donos) {
        expect(dono.tone).toBe(definicao.tone);
      }
    }
  });

  it("problema é OctagonAlert em alerta; o TriangleAlert segue só do Faltou", () => {
    expect(LEITURA_META_STATUS.com_problema.icon).toBe(OctagonAlert);
    expect(LEITURA_META_STATUS.com_problema.tone).toBe("alert");
    expect(LEITURA_META_STATUS.funcionando.icon).toBe(CircleCheck);
    expect(
      Object.values(LEITURA_META_STATUS).some((d) => d.icon === TriangleAlert),
    ).toBe(false);
  });
});

describe("aba Anúncios da Meta", () => {
  function aba(props: Partial<React.ComponentProps<typeof MetaAdsTab>> = {}) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <MetaAdsTab
          conta={{
            pixel_id: null,
            ad_account_id: "act_123456789",
            whatsapp_business_account_id: null,
            test_event_code: null,
            envio_ativado: false,
            modo_user_data: null,
            send_unmatched: false,
          }}
          temToken={false}
          temTokenDeLeitura
          leitura={leitura()}
          timezone="America/Fortaleza"
          agoraMs={AGORA}
          podeGerenciar
          dica={DICA}
          {...props}
        />
      </TooltipProvider>,
    );
  }

  it("o cartão do investimento entra sem repetir o campo da conta", () => {
    const html = aba();
    expect(html.match(/Investimento nos anúncios/g)).toHaveLength(1);
    // Um campo de conta so: o do cartao "Conta de anuncios".
    expect(html.match(/placeholder="act_1234567890"/g)).toHaveLength(1);
    expect(html.match(/id="meta-conta"/g)).toHaveLength(1);
    expect(html).toContain("Só os números, com ou sem act_ na frente.");
    // Os dois tokens tem campos proprios.
    expect(html).toContain("Token da API de conversões");
    expect(html).toContain("Token de leitura de anúncios");
  });

  it("nenhum travessão no texto da aba, em nenhum estado", () => {
    const estados = [
      aba(),
      aba({ conta: null, temTokenDeLeitura: false, leitura: null }),
      aba({
        leitura: leitura({ situacao: "com_problema", problema: "outro", codigoDaMeta: 1 }),
      }),
      aba({ leitura: leitura({ moeda: "EUR", contaAtiva: false, fusoDaConta: "Europe/Lisbon" }) }),
      aba({ podeGerenciar: false }),
    ];
    for (const html of estados) {
      expect(html).not.toMatch(/[–—]/);
    }
  });
});
