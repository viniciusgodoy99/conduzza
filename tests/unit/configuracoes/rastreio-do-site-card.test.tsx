import { Clock, TriangleAlert } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O cartao importa as Server Actions; aqui so a renderizacao e as regras
// puras importam.
vi.mock("@/app/(app)/configuracoes/rastreio-do-site-actions", () => ({
  alternarRastreioDoSiteAction: vi.fn(),
  salvarFrasesDoRastreioAction: vi.fn(),
  trocarChaveDoRastreioAction: vi.fn(),
}));

import { EXECUCAO_STATUS } from "@/components/configuracoes/automacoes-de-fluxo/status-da-execucao";
import { GoogleAdsTab } from "@/components/configuracoes/google-ads-tab";
import {
  acompanharOServidor,
  chegouCliqueComAChaveAtual,
  dicasDasFrases,
  dicasDoRastreio,
  enderecoDeTeste,
  errosDasFrases,
  estadoDoRastreio,
  frasesDaLinha,
  JANELA_DE_CLIQUES_MS,
  linhaParaColar,
  mesmasFrases,
  origemDoSistema,
  previaDaFrase,
  RASTREIO_DO_SITE_STATUS,
  RastreioDoSiteCard,
  situacaoDaResposta,
  SUFIXO_DO_GOOGLE_ADS,
  TEXTOS_DAS_FRASES,
  TEXTOS_DO_RASTREIO,
  textoDaChaveEmUso,
  textoDoUltimoClique,
  type LinhaDoRastreio,
  type SituacaoDoRastreio,
} from "@/components/configuracoes/rastreio-do-site-card";
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
import {
  FRASE_PADRAO,
  fraseDoRastreioSchema,
  frasesDoRastreioSchema,
  LIMITE_DE_FRASES,
  linhaDoScript,
  linkComCodigo,
  PARAMETROS_DO_GOOGLE,
  SUFIXO_DE_URL_FINAL,
  TAMANHO_MAXIMO_DA_FRASE,
} from "@/lib/domain/rastreio-do-site";

// Cartao "Rastreio do site" e aba Anuncios do Google (F1 do Google): o chip
// em tres camadas, a linha do site com a chave e o endereco de producao, os
// botoes visiveis e desabilitados com a dica, a situacao so com totais no
// fuso da clinica, o passo a passo, o "Conectar com o Google (em breve)"
// desabilitado com dica e nenhum travessao em estado nenhum.

const TZ = "America/Fortaleza";
const DICA = "Somente administradores e gestores alteram as configurações";
const CHAVE = "a1b2c3d4e5f60718293a";
const ENDERECO = "https://app.conduzza.com.br";
// A linha do contrato, com o referrerpolicy que a frente da rota publica pos
// no linhaDoScript (a carga do v1.js nao leva o endereco da pagina).
const LINHA_ESPERADA = `<script src="https://app.conduzza.com.br/rastreio/v1.js" data-chave="${CHAVE}" referrerpolicy="no-referrer" async></script>`;
/** A hora de referencia fixa (a pagina manda Date.now() do servidor). */
const AGORA = Date.parse("2026-10-05T12:00:00Z");
const DIA_MS = 24 * 60 * 60 * 1000;

/** ISO de `dias` antes de AGORA (mais `ms`, para a borda). */
function antes(dias: number, ms = 0): string {
  return new Date(AGORA - dias * DIA_MS - ms).toISOString();
}

function linha(campos: Partial<LinhaDoRastreio> = {}): LinhaDoRastreio {
  return {
    chave: CHAVE,
    ativo: true,
    chave_trocada_em: "2026-10-01T12:00:00+00:00",
    ultimo_clique_em: null,
    frases: [FRASE_PADRAO],
    ...campos,
  };
}

function situacao(
  campos: Partial<SituacaoDoRastreio> = {},
): SituacaoDoRastreio {
  return {
    configurado: true,
    ativo: true,
    chaveTrocadaEm: "2026-10-01T12:00:00+00:00",
    ultimoCliqueEm: null,
    cliques7Dias: 0,
    casados7Dias: 0,
    ...campos,
  };
}

function cartao(
  props: Partial<React.ComponentProps<typeof RastreioDoSiteCard>> = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <RastreioDoSiteCard
        linha={linha()}
        situacao={situacao()}
        enderecoDoSistema={ENDERECO}
        timezone={TZ}
        agoraMs={AGORA}
        podeGerenciar
        dica={DICA}
        {...props}
      />
    </TooltipProvider>,
  );
}

/** O HTML do texto, como o React escapa. */
function escapado(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** O botao com aquele texto esta desabilitado? */
function botaoDesabilitado(html: string, texto: string): boolean {
  const indice = html.indexOf(`${texto}</button>`);
  expect(indice, `botão "${texto}"`).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return /disabled=""/.test(html.slice(abertura, html.indexOf(">", abertura)));
}

/** O botao esta dentro do span com tabIndex da dica (DisabledWithHint)? */
function botaoComDica(html: string, texto: string): boolean {
  const indice = html.indexOf(`${texto}</button>`);
  const abertura = html.lastIndexOf("<button", indice);
  const antes = html.slice(Math.max(0, abertura - 200), abertura);
  return /<span[^>]*tabindex="0"[^>]*>$/.test(antes);
}

function chaveDoSwitch(html: string): string {
  const inicio = html.indexOf('role="switch"');
  expect(inicio).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", inicio);
  return html.slice(abertura, html.indexOf(">", abertura));
}

describe("situacaoDaResposta", () => {
  it("aceita a resposta da função do banco e troca para camelCase", () => {
    expect(
      situacaoDaResposta({
        configurado: true,
        ativo: false,
        chave_trocada_em: "2026-10-01T12:00:00+00:00",
        ultimo_clique_em: null,
        cliques_7_dias: 12,
        casados_7_dias: 3,
      }),
    ).toEqual({
      configurado: true,
      ativo: false,
      chaveTrocadaEm: "2026-10-01T12:00:00+00:00",
      ultimoCliqueEm: null,
      cliques7Dias: 12,
      casados7Dias: 3,
    });
  });

  it("clínica sem linha: datas nulas e zeros", () => {
    expect(
      situacaoDaResposta({
        configurado: false,
        ativo: false,
        chave_trocada_em: null,
        ultimo_clique_em: null,
        cliques_7_dias: 0,
        casados_7_dias: 0,
      }),
    ).toEqual({
      configurado: false,
      ativo: false,
      chaveTrocadaEm: null,
      ultimoCliqueEm: null,
      cliques7Dias: 0,
      casados7Dias: 0,
    });
  });

  it.each([
    ["nulo", null],
    ["lista", []],
    ["texto", "ok"],
    ["sem os totais", { configurado: true, ativo: true }],
    [
      "contagem negativa",
      {
        configurado: true,
        ativo: true,
        chave_trocada_em: null,
        ultimo_clique_em: null,
        cliques_7_dias: -1,
        casados_7_dias: 0,
      },
    ],
    [
      "contagem fracionada",
      {
        configurado: true,
        ativo: true,
        chave_trocada_em: null,
        ultimo_clique_em: null,
        cliques_7_dias: 1.5,
        casados_7_dias: 0,
      },
    ],
    [
      "data que não é texto",
      {
        configurado: true,
        ativo: true,
        chave_trocada_em: 123,
        ultimo_clique_em: null,
        cliques_7_dias: 1,
        casados_7_dias: 0,
      },
    ],
  ])("formato inesperado (%s) vira nulo, nunca zero", (_caso, valor) => {
    expect(situacaoDaResposta(valor)).toBeNull();
  });
});

describe("estado do rastreio", () => {
  it("sem linha ou desligado: Desligado", () => {
    expect(estadoDoRastreio(null, AGORA)).toBe("desligado");
    expect(
      estadoDoRastreio(
        linha({ ativo: false, ultimo_clique_em: "2026-10-03T12:00:00Z" }),
        AGORA,
      ),
    ).toBe("desligado");
    // Desligado com clique velho continua Desligado (nao o aviso de parado).
    expect(
      estadoDoRastreio(
        linha({ ativo: false, ultimo_clique_em: antes(90) }),
        AGORA,
      ),
    ).toBe("desligado");
  });

  it("ligado sem clique: esperando", () => {
    expect(estadoDoRastreio(linha(), AGORA)).toBe("esperando");
  });

  it("ligado com clique da chave atual há 3 dias: recebendo", () => {
    expect(estadoDoRastreio(linha({ ultimo_clique_em: antes(3) }), AGORA)).toBe(
      "recebendo",
    );
  });

  it("a janela é de 7 dias, inclusive (a mesma dos totais da situação)", () => {
    expect(JANELA_DE_CLIQUES_MS).toBe(7 * DIA_MS);
    expect(
      estadoDoRastreio(
        linha({ chave_trocada_em: antes(30), ultimo_clique_em: antes(7) }),
        AGORA,
      ),
    ).toBe("recebendo");
    expect(
      estadoDoRastreio(
        linha({ chave_trocada_em: antes(30), ultimo_clique_em: antes(7, 1) }),
        AGORA,
      ),
    ).toBe("sem_cliques_recentes");
  });

  it("último clique há 8 dias: sem cliques recentes, nunca o verde para sempre", () => {
    expect(
      estadoDoRastreio(
        linha({ chave_trocada_em: antes(60), ultimo_clique_em: antes(8) }),
        AGORA,
      ),
    ).toBe("sem_cliques_recentes");
  });

  it("religado depois de meses parado, sem trocar a chave: sem cliques recentes", () => {
    // Religar so muda o ativo: a chave e o ultimo clique ficam como estavam.
    const religado = linha({
      ativo: true,
      chave_trocada_em: antes(200),
      ultimo_clique_em: antes(120),
    });
    expect(chegouCliqueComAChaveAtual(religado)).toBe(true);
    expect(estadoDoRastreio(religado, AGORA)).toBe("sem_cliques_recentes");
  });

  it("chave trocada depois do último clique: volta a esperar", () => {
    const trocada = linha({
      chave_trocada_em: "2026-10-04T12:00:00Z",
      ultimo_clique_em: "2026-10-03T12:00:00Z",
    });
    expect(chegouCliqueComAChaveAtual(trocada)).toBe(false);
    expect(estadoDoRastreio(trocada, AGORA)).toBe("esperando");
    // Mesmo com o clique antigo fora da janela: esperando, nao parado.
    expect(
      estadoDoRastreio(
        linha({ chave_trocada_em: antes(1), ultimo_clique_em: antes(40) }),
        AGORA,
      ),
    ).toBe("esperando");
  });
});

describe("endereço e linha do site", () => {
  it("https, só a origem", () => {
    expect(origemDoSistema("https://app.conduzza.com.br")).toBe(ENDERECO);
    expect(origemDoSistema("https://app.conduzza.com.br/")).toBe(ENDERECO);
    expect(origemDoSistema("  https://app.conduzza.com.br/painel?x=1 ")).toBe(
      ENDERECO,
    );
  });

  it("http só em localhost (desenvolvimento), a regra do módulo do rastreio", () => {
    expect(origemDoSistema("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(origemDoSistema("http://127.0.0.1:3000/")).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["indefinido", undefined],
    ["http fora de localhost", "http://app.conduzza.com.br"],
    ["sem protocolo", "app.conduzza.com.br"],
    ["com usuário e senha", "https://a:b@app.conduzza.com.br"],
    ["outro protocolo", "javascript:alert(1)"],
  ])("endereço inválido (%s) não monta linha", (_caso, valor) => {
    expect(origemDoSistema(valor)).toBeNull();
    expect(linhaParaColar(valor, CHAVE)).toBeNull();
  });

  it("localhost e túnel de desenvolvimento são endereço de teste; produção não", () => {
    expect(enderecoDeTeste("http://localhost:3000")).toBe(true);
    expect(enderecoDeTeste("https://abc-def.trycloudflare.com")).toBe(true);
    expect(enderecoDeTeste("https://abc.ngrok-free.app")).toBe(true);
    expect(enderecoDeTeste(ENDERECO)).toBe(false);
  });

  it("a linha é a do contrato (script v1 com data-chave, sem referrer e async), montada pelo módulo do rastreio", () => {
    expect(linhaParaColar(ENDERECO, CHAVE)).toBe(LINHA_ESPERADA);
    expect(linhaParaColar(`${ENDERECO}/painel/`, CHAVE)).toBe(LINHA_ESPERADA);
    expect(linhaParaColar(ENDERECO, CHAVE)).toBe(
      linhaDoScript(ENDERECO, CHAVE),
    );
  });

  it.each([
    ["maiúsculas", "A1B2C3D4E5F60718293A"],
    ["curta", "a1b2c3"],
    ["com aspas", 'a1b2c3d4e5f6071829"x'],
  ])("chave fora do formato do banco (%s) não vira linha", (_caso, chave) => {
    expect(linhaParaColar(ENDERECO, chave)).toBeNull();
  });

  it("o sufixo que a clínica copia é o que o script do site lê", () => {
    expect(SUFIXO_DO_GOOGLE_ADS).toBe(SUFIXO_DE_URL_FINAL);
    // Cada parametro do sufixo esta entre os que o script le da URL, e os
    // valores sao os ValueTrack da campanha e do grupo.
    const parametros = new URLSearchParams(SUFIXO_DO_GOOGLE_ADS);
    const nomes = [...parametros.keys()];
    expect(nomes.length).toBe(2);
    for (const nome of nomes) {
      expect(PARAMETROS_DO_GOOGLE as readonly string[]).toContain(nome);
    }
    expect([...parametros.values()]).toEqual(["{campaignid}", "{adgroupid}"]);
  });
});

describe("datas no fuso da clínica", () => {
  it("último clique em Fortaleza (UTC-3)", () => {
    expect(textoDoUltimoClique("2026-10-04T17:32:00Z", TZ)).toBe(
      "04/10/2026 às 14:32",
    );
  });

  it("perto da meia-noite o dia é o da clínica, não o do UTC", () => {
    expect(textoDaChaveEmUso("2026-10-05T01:00:00Z", TZ)).toBe(
      "Chave em uso desde 04/10/2026",
    );
    expect(textoDoUltimoClique("2026-10-05T01:00:00Z", TZ)).toBe(
      "04/10/2026 às 22:00",
    );
  });

  it("sem clique: o texto diz que nenhum chegou", () => {
    expect(textoDoUltimoClique(null, TZ)).toBe("Nenhum clique recebido ainda");
    expect(textoDoUltimoClique("data ruim", TZ)).toBe(
      "Nenhum clique recebido ainda",
    );
    expect(textoDaChaveEmUso(null, TZ)).toBeNull();
  });
});

describe("dicasDoRastreio", () => {
  it("sem permissão: a dica do papel em tudo que altera", () => {
    expect(
      dicasDoRastreio({
        podeGerenciar: false,
        dica: DICA,
        temLinha: false,
        temEndereco: true,
      }),
    ).toEqual({ alternar: DICA, copiarLinha: DICA, trocarChave: DICA });
  });

  it("sem permissão e com linha: copiar continua liberado (é leitura)", () => {
    expect(
      dicasDoRastreio({
        podeGerenciar: false,
        dica: DICA,
        temLinha: true,
        temEndereco: true,
      }),
    ).toEqual({ alternar: DICA, copiarLinha: null, trocarChave: DICA });
  });

  it("gestão sem linha: liga primeiro", () => {
    expect(
      dicasDoRastreio({
        podeGerenciar: true,
        dica: DICA,
        temLinha: false,
        temEndereco: true,
      }),
    ).toEqual({
      alternar: null,
      copiarLinha: TEXTOS_DO_RASTREIO.ligueParaGerar,
      trocarChave: TEXTOS_DO_RASTREIO.chaveNasceAoLigar,
    });
  });

  it("gestão com linha e sem endereço: copiar preso, trocar liberado", () => {
    expect(
      dicasDoRastreio({
        podeGerenciar: true,
        dica: DICA,
        temLinha: true,
        temEndereco: false,
      }),
    ).toEqual({
      alternar: null,
      copiarLinha: TEXTOS_DO_RASTREIO.semEndereco,
      trocarChave: null,
    });
  });
});

describe("RASTREIO_DO_SITE_STATUS", () => {
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
    ...Object.values(LEITURA_META_STATUS),
    ...Object.values(CONSENT_STATUS),
    ...Object.values(ATIVIDADE_STATUS),
    ...Object.values(EXECUCAO_STATUS),
  ];

  it("os rótulos fixos dos chips", () => {
    expect(
      Object.fromEntries(
        Object.entries(RASTREIO_DO_SITE_STATUS).map(([chave, d]) => [
          chave,
          d.label,
        ]),
      ),
    ).toEqual({
      desligado: "Desligado",
      esperando: "Esperando o primeiro clique",
      recebendo: "Recebendo cliques",
      sem_cliques_recentes: "Sem cliques nos últimos 7 dias",
    });
  });

  it("três camadas e forma própria em cada estado", () => {
    const icones = Object.values(RASTREIO_DO_SITE_STATUS).map((d) => d.icon);
    expect(new Set(icones).size).toBe(icones.length);
    for (const definicao of Object.values(RASTREIO_DO_SITE_STATUS)) {
      expect(definicao.icon).not.toBeNull();
      expect(definicao.label.length).toBeGreaterThan(2);
      expect(definicao.tone.length).toBeGreaterThan(2);
    }
  });

  it("um ícone, uma cor: só ícones que já têm dono, no mesmo tom", () => {
    for (const definicao of Object.values(RASTREIO_DO_SITE_STATUS)) {
      const donos = TODOS.filter((outro) => outro.icon === definicao.icon);
      expect(donos.length).toBeGreaterThan(0);
      for (const dono of donos) {
        expect(dono.tone).toBe(definicao.tone);
      }
    }
  });

  it("nunca o triângulo (só do Faltou) nem o relógio (só do Aguardando)", () => {
    for (const definicao of Object.values(RASTREIO_DO_SITE_STATUS)) {
      expect(definicao.icon).not.toBe(TriangleAlert);
      expect(definicao.icon).not.toBe(Clock);
    }
  });
});

describe("cartão Rastreio do site", () => {
  it("sem linha: Desligado, a chave liga, copiar e trocar presos com a dica", () => {
    const html = cartao({
      linha: null,
      situacao: situacao({
        configurado: false,
        ativo: false,
        chaveTrocadaEm: null,
      }),
    });
    expect(html).toContain("Desligado");
    expect(html).toContain("Rastrear os cliques do site");
    expect(html).toContain(TEXTOS_DO_RASTREIO.ligueParaGerar);
    expect(html).not.toContain("<pre");
    expect(chaveDoSwitch(html)).toContain('aria-checked="false"');
    expect(chaveDoSwitch(html)).not.toContain('disabled=""');
    expect(botaoDesabilitado(html, "Copiar a linha")).toBe(true);
    expect(botaoComDica(html, "Copiar a linha")).toBe(true);
    expect(botaoDesabilitado(html, "Gerar nova chave")).toBe(true);
    expect(botaoComDica(html, "Gerar nova chave")).toBe(true);
    expect(html).toContain("Nenhum clique recebido ainda");
  });

  it("ligado sem clique: Esperando o primeiro clique e a linha pronta para copiar", () => {
    const html = cartao();
    expect(html).toContain("Esperando o primeiro clique");
    expect(html).toContain("Rastreando os cliques do site");
    expect(chaveDoSwitch(html)).toContain('aria-checked="true"');
    expect(html).toContain(escapado(LINHA_ESPERADA));
    expect(botaoDesabilitado(html, "Copiar a linha")).toBe(false);
    expect(botaoComDica(html, "Copiar a linha")).toBe(false);
    expect(botaoDesabilitado(html, "Gerar nova chave")).toBe(false);
    expect(botaoComDica(html, "Gerar nova chave")).toBe(false);
    expect(html).toContain("Chave em uso desde 01/10/2026");
    // Sem aviso de troca: nunca houve clique.
    expect(html).not.toContain(TEXTOS_DO_RASTREIO.semCliqueComAChaveAtual);
  });

  it("recebendo: os três totais, o último clique no fuso da clínica", () => {
    const html = cartao({
      linha: linha({ ultimo_clique_em: "2026-10-04T17:32:00Z" }),
      situacao: situacao({
        ultimoCliqueEm: "2026-10-04T17:32:00Z",
        cliques7Dias: 42,
        casados7Dias: 7,
      }),
    });
    expect(html).toContain("Recebendo cliques");
    expect(html).toContain("Último clique recebido");
    expect(html).toContain("04/10/2026 às 14:32");
    expect(html).toContain("Cliques nos últimos 7 dias");
    expect(html).toMatch(/>42<\/dd>/);
    expect(html).toContain("Chegaram ao WhatsApp nos últimos 7 dias");
    expect(html).toMatch(/>7<\/dd>/);
    expect(html).toContain("Só totais.");
    expect(html).not.toContain(TEXTOS_DO_RASTREIO.semCliquesRecentes);
  });

  it("último clique há mais de 7 dias: chip de atenção e o aviso de conferir o site", () => {
    const html = cartao({
      linha: linha({
        chave_trocada_em: antes(60),
        ultimo_clique_em: antes(10),
      }),
      situacao: situacao({ ultimoCliqueEm: antes(10), cliques7Dias: 0 }),
    });
    expect(html).toContain("Sem cliques nos últimos 7 dias");
    expect(html).not.toContain("Recebendo cliques");
    expect(html).toContain(TEXTOS_DO_RASTREIO.semCliquesRecentes);
    // O aviso da troca de chave e so do esperando.
    expect(html).not.toContain(TEXTOS_DO_RASTREIO.semCliqueComAChaveAtual);
    expect(TEXTOS_DO_RASTREIO.semCliquesRecentes).toBe(
      "Nenhum clique chegou nos últimos 7 dias. Confira se a linha continua no site e se os anúncios do Google estão no ar.",
    );
  });

  it("chave trocada depois do último clique: avisa para trocar a linha no site", () => {
    const html = cartao({
      linha: linha({
        chave_trocada_em: "2026-10-04T12:00:00Z",
        ultimo_clique_em: "2026-10-03T12:00:00Z",
      }),
    });
    expect(html).toContain("Esperando o primeiro clique");
    expect(html).toContain(TEXTOS_DO_RASTREIO.semCliqueComAChaveAtual);
  });

  it("desligado com linha: a linha continua visível, com o aviso do desligado", () => {
    const html = cartao({ linha: linha({ ativo: false }) });
    expect(html).toContain("Desligado");
    expect(html).toContain("Rastrear os cliques do site");
    expect(html).toContain(escapado(LINHA_ESPERADA));
    expect(html).toContain(TEXTOS_DO_RASTREIO.desligadoComLinha);
  });

  it("o aviso do desligado conta que a linha no site continua pondo o código na mensagem", () => {
    // O script nao sabe se o rastreio esta ligado: so o registro para.
    expect(TEXTOS_DO_RASTREIO.desligadoComLinha).toBe(
      "Com o rastreio desligado, nenhum clique é registrado, mas a linha que está no site continua acrescentando o código à mensagem de quem vem de anúncio do Google. Para parar de vez, tire a linha do site.",
    );
  });

  it("sem endereço público: nenhuma linha montada, copiar preso, aviso", () => {
    for (const endereco of [null, "http://app.conduzza.com.br"]) {
      const html = cartao({ enderecoDoSistema: endereco });
      expect(html).not.toContain("<pre");
      expect(html).not.toContain(CHAVE);
      expect(html).toContain(TEXTOS_DO_RASTREIO.semEndereco);
      expect(botaoDesabilitado(html, "Copiar a linha")).toBe(true);
    }
  });

  it("endereço de túnel: monta a linha, mas avisa que é de teste", () => {
    const html = cartao({
      enderecoDoSistema: "https://abc-def.trycloudflare.com",
    });
    expect(html).toContain("abc-def.trycloudflare.com/rastreio/v1.js");
    expect(html).toContain(TEXTOS_DO_RASTREIO.enderecoDeTeste);
  });

  it("situação que não carregou: aviso de erro, e o resto do cartão funciona", () => {
    const html = cartao({ situacao: null });
    expect(html).toContain(TEXTOS_DO_RASTREIO.situacaoIlegivel);
    expect(html).not.toContain("Cliques nos últimos 7 dias");
    expect(html).toContain(escapado(LINHA_ESPERADA));
    expect(botaoDesabilitado(html, "Copiar a linha")).toBe(false);
  });

  it("sem permissão: a chave e o trocar ficam visíveis, desabilitados e com a dica", () => {
    const html = cartao({ podeGerenciar: false });
    expect(chaveDoSwitch(html)).toContain('disabled=""');
    expect(botaoDesabilitado(html, "Gerar nova chave")).toBe(true);
    expect(botaoComDica(html, "Gerar nova chave")).toBe(true);
    // Copiar e leitura: segue liberado quando a linha existe.
    expect(botaoDesabilitado(html, "Copiar a linha")).toBe(false);
  });

  it("o passo a passo: fim da página, Gerenciador de Tags, wa.me, marcação automática e o sufixo", () => {
    const html = cartao();
    expect(html).toContain("Como instalar no site");
    expect(html).toContain("&lt;/body&gt;");
    expect(html).toContain("Gerenciador de Tags do Google");
    expect(html).toContain("https://wa.me/");
    expect(html).toContain("codificação automática (marcação");
    // O link exato que o script aceita, e os que ele ignora.
    expect(html).toContain("https://wa.me/5584999990000");
    expect(html).toContain("sem o sinal de mais");
    expect(html).toContain("https://api.whatsapp.com/send");
    expect(html).toMatch(
      /WhatsApp Business \(<code[^>]*>wa\.me\/message\/\.\.\.<\/code>\)/,
    );
    expect(html).toContain("não recebem o código");
    expect(html).toContain("Sufixo de URL final");
    // A origem e imutavel: a mensagem de teste nao pode ser enviada.
    expect(html).toContain(
      "Não envie a mensagem de teste: o seu número ficaria com a origem do Google para sempre.",
    );
    expect(html).toContain(escapado(SUFIXO_DO_GOOGLE_ADS));
    expect(botaoDesabilitado(html, "Copiar o sufixo")).toBe(false);
    expect(html).toContain("O endereço do Conduzza nunca vai no anúncio.");
    expect(html).toContain("?gclid=teste");
    // Uma lista numerada: o li nao vira grade (o numero sumiria).
    expect(html).toMatch(/<ol class="[^"]*list-decimal/);
    expect(html).not.toMatch(/<li class="[^"]*\bgrid\b/);
  });

  it("o passo a passo bate com a regra do script: o exemplo recebe o código e o link curto não", () => {
    const codigo = "K7Q2MX";
    expect(linkComCodigo("https://wa.me/5584999990000", codigo)).not.toBeNull();
    expect(
      linkComCodigo(
        "https://api.whatsapp.com/send?phone=5584999990000",
        codigo,
      ),
    ).not.toBeNull();
    expect(linkComCodigo("https://wa.me/message/ABCDEF123", codigo)).toBeNull();
    expect(linkComCodigo("https://wa.me/+5584999990000", codigo)).toBeNull();
  });

  it("a região do resultado das ações está sempre montada", () => {
    expect(cartao()).toMatch(/aria-live="polite"/);
    expect(cartao({ linha: null })).toMatch(/aria-live="polite"/);
  });

  it("o cartão é uma região com nome (para o leitor de tela e o e2e)", () => {
    const html = cartao();
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/role="region"/);
  });

  it("nenhum travessão no texto do cartão, em nenhum estado", () => {
    const estados = [
      cartao(),
      cartao({ linha: null }),
      cartao({ linha: linha({ ativo: false }) }),
      cartao({ linha: linha({ ultimo_clique_em: "2026-10-04T17:32:00Z" }) }),
      cartao({
        linha: linha({
          chave_trocada_em: antes(60),
          ultimo_clique_em: antes(9),
        }),
      }),
      cartao({
        linha: linha({
          chave_trocada_em: "2026-10-04T12:00:00Z",
          ultimo_clique_em: "2026-10-03T12:00:00Z",
        }),
      }),
      cartao({ enderecoDoSistema: null }),
      cartao({ enderecoDoSistema: "https://x.trycloudflare.com" }),
      cartao({ situacao: null }),
      cartao({ podeGerenciar: false }),
    ];
    for (const html of estados) {
      expect(html).not.toMatch(/[—–]/);
    }
    for (const texto of Object.values(TEXTOS_DO_RASTREIO)) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });

  it("linguagem de recepção: nada de jargão técnico na tela", () => {
    const html = cartao();
    for (const termo of ["tenant", "opt-in", "PUBLIC_APP_URL", "handoff"]) {
      expect(html).not.toContain(termo);
    }
  });
});

describe("aba Anúncios do Google", () => {
  function aba(props: Partial<React.ComponentProps<typeof GoogleAdsTab>> = {}) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <GoogleAdsTab
          rastreio={{
            linha: linha({ ultimo_clique_em: "2026-10-04T17:32:00Z" }),
            situacao: {
              configurado: true,
              ativo: true,
              chave_trocada_em: "2026-10-01T12:00:00+00:00",
              ultimo_clique_em: "2026-10-04T17:32:00Z",
              cliques_7_dias: 9,
              casados_7_dias: 4,
            },
            enderecoDoSistema: ENDERECO,
            timezone: TZ,
            agoraMs: AGORA,
          }}
          podeGerenciar
          dica={DICA}
          {...props}
        />
      </TooltipProvider>,
    );
  }

  it("o cartão do rastreio lê a resposta crua da situação", () => {
    const html = aba();
    expect(html).toContain("Rastreio do site");
    expect(html).toContain("Recebendo cliques");
    expect(html).toMatch(/>9<\/dd>/);
    expect(html).toMatch(/>4<\/dd>/);
  });

  it("resposta crua fora do formato: o cartão diz que a situação não carregou", () => {
    const html = aba({
      rastreio: {
        linha: linha(),
        situacao: { erro: true },
        enderecoDoSistema: ENDERECO,
        timezone: TZ,
        agoraMs: AGORA,
      },
    });
    expect(html).toContain(TEXTOS_DO_RASTREIO.situacaoIlegivel);
  });

  it("Conectar com o Google (em breve): visível, desabilitado e com a dica, para qualquer papel", () => {
    for (const podeGerenciar of [true, false]) {
      const html = aba({ podeGerenciar });
      expect(html).toContain("Conectar com o Google (em breve)");
      expect(botaoDesabilitado(html, "Conectar com o Google")).toBe(true);
      expect(botaoComDica(html, "Conectar com o Google")).toBe(true);
    }
    expect(TEXTOS_DO_RASTREIO.conectarEmBreve).toMatch(/^Em breve\./);
  });

  it("nenhum travessão na aba", () => {
    expect(aba()).not.toMatch(/[—–]/);
    expect(aba({ podeGerenciar: false })).not.toMatch(/[—–]/);
  });
});

// ---------------------------------------------------------------------------
// Mensagem do botao sem texto pronto (frases do rastreio, 04/10/2026)
// ---------------------------------------------------------------------------
//
// As regras de cada frase sao as do modulo do rastreio (o mesmo schema da
// acao e dos checks do banco): os textos esperados aqui saem do proprio
// schema, para o teste provar que a tela nao tem regra propria.

/** A mensagem que o schema do modulo da para uma frase (ou nula). */
function mensagemDoModulo(frase: string): string | null {
  const resultado = fraseDoRastreioSchema.safeParse(frase);
  return resultado.success
    ? null
    : (resultado.error.issues[0]?.message ?? null);
}

/** A mensagem que o schema do modulo da para a lista inteira (ou nula). */
function mensagemDaListaNoModulo(lista: string[]): string | null {
  const resultado = frasesDoRastreioSchema.safeParse(lista);
  if (resultado.success) {
    return null;
  }
  const daLista = resultado.error.issues.find(
    (problema) => problema.path.length === 0,
  );
  return daLista?.message ?? null;
}

/** O botao com aquele aria-label (os de remover sao so icone). */
function botaoPorRotulo(html: string, rotulo: string): string {
  const indice = html.indexOf(`aria-label="${rotulo}"`);
  expect(indice, `botão "${rotulo}"`).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return html.slice(abertura, html.indexOf(">", indice));
}

/** O botao so de icone esta dentro do span da dica? */
function rotuloComDica(html: string, rotulo: string): boolean {
  const indice = html.indexOf(`aria-label="${rotulo}"`);
  const abertura = html.lastIndexOf("<button", indice);
  const antes = html.slice(Math.max(0, abertura - 200), abertura);
  return /<span[^>]*tabindex="0"[^>]*>$/.test(antes);
}

/** Os campos de frase (input de texto do bloco), na ordem. */
function camposDeFrase(html: string): string[] {
  return [...html.matchAll(/<input type="text"[^>]*\/>/g)].map((m) => m[0]);
}

/** O HTML do bloco das frases (do titulo ate a regiao do resultado dele). */
function blocoDasFrases(html: string): string {
  const inicio = html.indexOf(TEXTOS_DAS_FRASES.titulo);
  expect(inicio).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<section", inicio);
  return html.slice(abertura, html.indexOf("</section>", inicio));
}

const DUAS_SENTENCAS =
  "Oi! Vi o anúncio no Google. Quero saber os horários da semana.";

describe("frases: regras puras", () => {
  it("o padrão do bloco é a frase de fábrica do módulo (o default do banco)", () => {
    expect(FRASE_PADRAO).toBe(
      "Olá! Vim pelo site e gostaria de agendar uma consulta.",
    );
    expect(frasesDaLinha(null)).toEqual([FRASE_PADRAO]);
  });

  it("frasesDaLinha: as gravadas, na ordem, quando passam nas regras do banco", () => {
    const frases = ["Primeira.", DUAS_SENTENCAS, "Terceira frase 😀"];
    expect(frasesDaLinha(linha({ frases }))).toEqual(frases);
  });

  it.each([
    ["lista vazia", []],
    ["seis frases", ["a", "b", "c", "d", "e", "f"]],
    ["frase com #", ["Agende #AGORA"]],
    ["frase com colchete", ["Olá [site]"]],
    ["frase em branco", ["   "]],
    ["frase com quebra de linha", ["Olá\ntudo bem"]],
  ])(
    "frasesDaLinha: fora da regra (%s) vira a padrão, como o site faria",
    (_caso, frases) => {
      expect(frasesDaLinha(linha({ frases }))).toEqual([FRASE_PADRAO]);
    },
  );

  it("previaDaFrase: a frase aparada e o código de exemplo no fim", () => {
    expect(previaDaFrase(FRASE_PADRAO)).toBe(`${FRASE_PADRAO} [#K7Q2MX]`);
    expect(previaDaFrase("  Oi, tudo bem?  ")).toBe("Oi, tudo bem? [#K7Q2MX]");
    expect(previaDaFrase("")).toBeNull();
    expect(previaDaFrase("   ")).toBeNull();
  });

  it("a prévia é o texto que o script põe no link do WhatsApp", () => {
    for (const frase of [FRASE_PADRAO, DUAS_SENTENCAS, "Oi 😀 tudo bem?"]) {
      const link = linkComCodigo(
        "https://wa.me/5584999990000",
        "K7Q2MX",
        frase,
      );
      expect(link).not.toBeNull();
      const texto = new URL(link ?? "").searchParams.get("text");
      expect(texto).toBe(previaDaFrase(frase));
    }
  });

  it("errosDasFrases: lista válida passa (várias sentenças, emoji, espaço nas pontas)", () => {
    expect(errosDasFrases([FRASE_PADRAO])).toBeNull();
    expect(errosDasFrases([DUAS_SENTENCAS, "  Oi!  ", "Olá 😀"])).toBeNull();
    expect(
      errosDasFrases(
        Array.from({ length: LIMITE_DE_FRASES }, () =>
          "a".repeat(TAMANHO_MAXIMO_DA_FRASE),
        ),
      ),
    ).toBeNull();
  });

  it.each([
    ["em branco", ""],
    ["só espaços", "    "],
    ["com 301 caracteres", "a".repeat(TAMANHO_MAXIMO_DA_FRASE + 1)],
    ["com cerquilha", "Agende já #promo"],
    ["com colchete", "Olá [site]"],
    ["com tabulação", "Olá\ttudo bem"],
    ["com separador de linha", "Olá\u2028tudo bem"],
  ])("errosDasFrases: frase %s leva a mensagem do módulo", (_caso, frase) => {
    const esperada = mensagemDoModulo(frase);
    expect(esperada).not.toBeNull();
    expect(errosDasFrases(["Frase boa.", frase])).toEqual({
      porFrase: [null, esperada],
      daLista: null,
    });
  });

  it("errosDasFrases: nenhuma frase ou mais de cinco é problema da lista", () => {
    expect(errosDasFrases([])).toEqual({
      porFrase: [],
      daLista: mensagemDaListaNoModulo([]),
    });
    const seis = ["a", "b", "c", "d", "e", "f"];
    expect(errosDasFrases(seis)?.daLista).toBe(mensagemDaListaNoModulo(seis));
    expect(errosDasFrases(seis)?.daLista).not.toBeNull();
  });

  it("as mensagens das frases não têm travessão nem jargão", () => {
    const mensagens = [
      mensagemDoModulo(""),
      mensagemDoModulo("a".repeat(301)),
      mensagemDoModulo("#"),
      mensagemDaListaNoModulo([]),
      mensagemDaListaNoModulo(["a", "b", "c", "d", "e", "f"]),
    ];
    for (const mensagem of mensagens) {
      expect(mensagem).not.toBeNull();
      expect(mensagem).not.toMatch(/[—–]/);
      expect(mensagem).not.toMatch(/regex|string|array|Invalid/i);
    }
  });

  it("mesmasFrases compara item a item, sem aparar", () => {
    expect(mesmasFrases(["a", "b"], ["a", "b"])).toBe(true);
    expect(mesmasFrases(["a", "b"], ["b", "a"])).toBe(false);
    expect(mesmasFrases(["a"], ["a", "b"])).toBe(false);
    expect(mesmasFrases(["a "], ["a"])).toBe(false);
  });

  describe("acompanharOServidor (outra pessoa salvou e a página revalidou)", () => {
    const X = "Oi! Vim pelo site.";
    const Y = "Quero marcar uma avaliação.";

    it("sem alteração local, a lista acompanha o servidor e Restaurar fica liberado", () => {
      const passo = acompanharOServidor({
        textos: [FRASE_PADRAO],
        salvas: [FRASE_PADRAO],
        doServidor: [X, Y],
      });
      expect(passo).toEqual({ trocarItens: true, trocarSalvas: true });
      // Depois da troca, a lista e o salvo sao [X, Y]: restaurar liberado,
      // salvar preso com a dica verdadeira.
      const dicas = dicasDasFrases({
        podeGerenciar: true,
        dica: "",
        quantidade: 2,
        soAPadrao: mesmasFrases([X, Y], [FRASE_PADRAO]),
        alterou: !mesmasFrases([X, Y], [X, Y]),
      });
      expect(dicas.restaurar).toBeNull();
      expect(dicas.salvar).toBe(TEXTOS_DAS_FRASES.semAlteracao);
      // Restaurada a padrao, salvar libera (antes ficava preso).
      expect(
        dicasDasFrases({
          podeGerenciar: true,
          dica: "",
          quantidade: 1,
          soAPadrao: true,
          alterou: !mesmasFrases([FRASE_PADRAO], [X, Y]),
        }).salvar,
      ).toBeNull();
    });

    it("com alteração local, a edição fica e só o que está salvo muda", () => {
      expect(
        acompanharOServidor({
          textos: ["Olá! Vi o anúncio."],
          salvas: [FRASE_PADRAO],
          doServidor: [X],
        }),
      ).toEqual({ trocarItens: false, trocarSalvas: true });
    });

    it("depois do próprio salvar, o servidor traz o mesmo: nada muda (o Frases salvas. fica)", () => {
      expect(
        acompanharOServidor({
          textos: [X, Y],
          salvas: [X, Y],
          doServidor: [X, Y],
        }),
      ).toEqual({ trocarItens: false, trocarSalvas: false });
    });

    it("o servidor chega antes da resposta do salvar: a edição não aparada fica até a resposta", () => {
      expect(
        acompanharOServidor({
          textos: [`  ${X}  `],
          salvas: [FRASE_PADRAO],
          doServidor: [X],
        }),
      ).toEqual({ trocarItens: false, trocarSalvas: true });
    });

    it("a edição já igual ao servidor: nada a trocar na lista", () => {
      expect(
        acompanharOServidor({
          textos: [X],
          salvas: [FRASE_PADRAO],
          doServidor: [X],
        }),
      ).toEqual({ trocarItens: false, trocarSalvas: true });
    });

    it("quem passa a ler a linha (sem frases antes) recebe a lista do servidor", () => {
      expect(
        acompanharOServidor({ textos: [], salvas: [], doServidor: [X] }),
      ).toEqual({ trocarItens: true, trocarSalvas: true });
    });
  });

  it("dicasDasFrases: sem permissão, a dica do papel em tudo", () => {
    expect(
      dicasDasFrases({
        podeGerenciar: false,
        dica: DICA,
        quantidade: 3,
        soAPadrao: false,
        alterou: true,
      }),
    ).toEqual({
      adicionar: DICA,
      remover: DICA,
      restaurar: DICA,
      salvar: DICA,
    });
  });

  it("dicasDasFrases: uma frase só não sai; cinco não deixam adicionar", () => {
    expect(
      dicasDasFrases({
        podeGerenciar: true,
        dica: DICA,
        quantidade: 1,
        soAPadrao: true,
        alterou: false,
      }),
    ).toEqual({
      adicionar: null,
      remover: TEXTOS_DAS_FRASES.minimo,
      restaurar: TEXTOS_DAS_FRASES.jaEPadrao,
      salvar: TEXTOS_DAS_FRASES.semAlteracao,
    });
    expect(
      dicasDasFrases({
        podeGerenciar: true,
        dica: DICA,
        quantidade: LIMITE_DE_FRASES,
        soAPadrao: false,
        alterou: true,
      }),
    ).toEqual({
      adicionar: TEXTOS_DAS_FRASES.limite,
      remover: null,
      restaurar: null,
      salvar: null,
    });
    expect(TEXTOS_DAS_FRASES.limite).toContain(`${LIMITE_DE_FRASES} frases`);
  });
});

describe("frases: bloco no cartão", () => {
  it("padrão de fábrica: uma frase, contador, prévia e as ações certas", () => {
    const html = blocoDasFrases(cartao());
    expect(html).toContain(TEXTOS_DAS_FRASES.titulo);
    expect(html).toContain(TEXTOS_DAS_FRASES.quandoUsa);
    const campos = camposDeFrase(html);
    expect(campos).toHaveLength(1);
    expect(campos[0]).toContain(`value="${escapado(FRASE_PADRAO)}"`);
    expect(campos[0]).toContain(`maxLength="${TAMANHO_MAXIMO_DA_FRASE}"`);
    expect(campos[0]).not.toContain('disabled=""');
    // O rotulo aponta para o campo.
    const id = /id="([^"]+)"/.exec(campos[0] ?? "")?.[1];
    expect(html).toContain(`for="${id}">Frase 1</label>`);
    expect(html).toContain(
      `>${FRASE_PADRAO.length}/${TAMANHO_MAXIMO_DA_FRASE}</span>`,
    );
    // A unica frase nao sai; a padrao ja esta; nada para salvar.
    expect(botaoPorRotulo(html, "Remover a frase 1")).toContain('disabled=""');
    expect(rotuloComDica(html, "Remover a frase 1")).toBe(true);
    expect(botaoDesabilitado(html, "Adicionar frase")).toBe(false);
    expect(botaoDesabilitado(html, "Restaurar a frase padrão")).toBe(true);
    expect(botaoComDica(html, "Restaurar a frase padrão")).toBe(true);
    expect(botaoDesabilitado(html, "Salvar frases")).toBe(true);
    expect(botaoComDica(html, "Salvar frases")).toBe(true);
    // A previa como chega no WhatsApp, com o codigo de exemplo.
    expect(html).toContain(TEXTOS_DAS_FRASES.previaTitulo);
    expect(html).toContain(`${escapado(FRASE_PADRAO)} [#K7Q2MX]`);
    expect(html).toContain(TEXTOS_DAS_FRASES.semColarDeNovo);
    // Uma frase: nada de sorteio.
    expect(html).not.toContain(TEXTOS_DAS_FRASES.sorteio);
    expect(html).not.toContain(TEXTOS_DAS_FRASES.desligado);
  });

  it("várias frases: um campo por frase, na ordem, o aviso do sorteio e uma prévia por frase", () => {
    const frases = ["Primeira.", DUAS_SENTENCAS, "Terceira."];
    const html = blocoDasFrases(cartao({ linha: linha({ frases }) }));
    const campos = camposDeFrase(html);
    expect(campos).toHaveLength(3);
    frases.forEach((frase, i) => {
      expect(campos[i]).toContain(`value="${escapado(frase)}"`);
      expect(html).toContain(`>Frase ${i + 1}</label>`);
      expect(html).toContain(`${escapado(frase)} [#K7Q2MX]</p>`);
      expect(botaoPorRotulo(html, `Remover a frase ${i + 1}`)).not.toContain(
        'disabled=""',
      );
    });
    expect(html).toContain(TEXTOS_DAS_FRASES.sorteio);
    expect(botaoDesabilitado(html, "Restaurar a frase padrão")).toBe(false);
    expect(botaoDesabilitado(html, "Adicionar frase")).toBe(false);
  });

  it("cinco frases: adicionar fica preso, com a dica do limite", () => {
    const frases = ["Um.", "Dois.", "Três.", "Quatro.", "Cinco."];
    const html = blocoDasFrases(cartao({ linha: linha({ frases }) }));
    expect(camposDeFrase(html)).toHaveLength(LIMITE_DE_FRASES);
    expect(botaoDesabilitado(html, "Adicionar frase")).toBe(true);
    expect(botaoComDica(html, "Adicionar frase")).toBe(true);
  });

  it("frases gravadas fora da regra: o bloco mostra a padrão (o que o site usa)", () => {
    const html = blocoDasFrases(
      cartao({ linha: linha({ frases: ["Agende #AGORA"] }) }),
    );
    const campos = camposDeFrase(html);
    expect(campos).toHaveLength(1);
    expect(campos[0]).toContain(`value="${escapado(FRASE_PADRAO)}"`);
    expect(html).not.toContain("AGORA");
  });

  it("sem linha, a gestão vê a padrão e pode editar (salvar cria a linha desligada)", () => {
    const html = blocoDasFrases(cartao({ linha: null }));
    const campos = camposDeFrase(html);
    expect(campos).toHaveLength(1);
    expect(campos[0]).toContain(`value="${escapado(FRASE_PADRAO)}"`);
    expect(campos[0]).not.toContain('disabled=""');
    expect(botaoDesabilitado(html, "Adicionar frase")).toBe(false);
    expect(html).toContain(TEXTOS_DAS_FRASES.desligado);
  });

  it("rastreio desligado: avisa que o site usa a frase padrão até ligar", () => {
    const html = blocoDasFrases(
      cartao({ linha: linha({ ativo: false, frases: ["Oi!", "Olá!"] }) }),
    );
    expect(html).toContain(TEXTOS_DAS_FRASES.desligado);
    expect(camposDeFrase(html)).toHaveLength(2);
  });

  it("sem permissão e sem linha: nenhum conteúdo, ações visíveis, presas e com a dica", () => {
    const html = blocoDasFrases(cartao({ linha: null, podeGerenciar: false }));
    expect(html).toContain(TEXTOS_DAS_FRASES.semAcesso);
    expect(camposDeFrase(html)).toHaveLength(0);
    expect(html).not.toContain(escapado(FRASE_PADRAO));
    expect(html).not.toContain(TEXTOS_DAS_FRASES.previaTitulo);
    for (const botao of [
      "Adicionar frase",
      "Restaurar a frase padrão",
      "Salvar frases",
    ]) {
      expect(botaoDesabilitado(html, botao)).toBe(true);
      expect(botaoComDica(html, botao)).toBe(true);
    }
  });

  it("sem permissão e com linha: as frases ficam visíveis, com os campos e as ações presos", () => {
    const html = blocoDasFrases(
      cartao({
        podeGerenciar: false,
        linha: linha({ frases: ["Oi!", "Olá!"] }),
      }),
    );
    const campos = camposDeFrase(html);
    expect(campos).toHaveLength(2);
    for (const campo of campos) {
      expect(campo).toContain('disabled=""');
    }
    expect(botaoPorRotulo(html, "Remover a frase 1")).toContain('disabled=""');
    expect(rotuloComDica(html, "Remover a frase 1")).toBe(true);
    for (const botao of [
      "Adicionar frase",
      "Restaurar a frase padrão",
      "Salvar frases",
    ]) {
      expect(botaoDesabilitado(html, botao)).toBe(true);
      expect(botaoComDica(html, botao)).toBe(true);
    }
  });

  it("os botões do bloco têm 40px (alvo de toque)", () => {
    const html = blocoDasFrases(
      cartao({ linha: linha({ frases: ["a", "b"] }) }),
    );
    const botoes = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(botoes.length).toBeGreaterThanOrEqual(5);
    for (const botao of botoes) {
      expect(botao).toMatch(/data-size="(default|icon)"/);
    }
    for (const campo of camposDeFrase(html)) {
      expect(campo).toContain("h-10");
    }
  });

  it("a região do resultado do bloco está sempre montada", () => {
    expect(blocoDasFrases(cartao())).toMatch(/aria-live="polite"/);
    expect(
      blocoDasFrases(cartao({ linha: null, podeGerenciar: false })),
    ).toMatch(/aria-live="polite"/);
  });

  it("nenhum travessão no bloco, em nenhum estado, nem nos textos", () => {
    const estados = [
      cartao(),
      cartao({ linha: null }),
      cartao({ linha: linha({ ativo: false }) }),
      cartao({ linha: linha({ frases: ["a", "b", "c", "d", "e"] }) }),
      cartao({ linha: null, podeGerenciar: false }),
      cartao({ podeGerenciar: false }),
    ];
    for (const html of estados) {
      expect(blocoDasFrases(html)).not.toMatch(/[—–]/);
    }
    for (const texto of Object.values(TEXTOS_DAS_FRASES)) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });

  it("linguagem de recepção no bloco", () => {
    const html = blocoDasFrases(
      cartao({ linha: linha({ frases: ["a", "b"] }) }),
    );
    for (const termo of [
      "tenant",
      "opt-in",
      "string",
      "array",
      "API",
      "fallback",
    ]) {
      expect(html).not.toContain(termo);
    }
  });
});
