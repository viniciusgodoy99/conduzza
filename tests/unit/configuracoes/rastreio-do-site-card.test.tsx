import { Clock, TriangleAlert } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O cartao importa as Server Actions; aqui so a renderizacao e as regras
// puras importam.
vi.mock("@/app/(app)/configuracoes/rastreio-do-site-actions", () => ({
  alternarRastreioDoSiteAction: vi.fn(),
  trocarChaveDoRastreioAction: vi.fn(),
}));

import { EXECUCAO_STATUS } from "@/components/configuracoes/automacoes-de-fluxo/status-da-execucao";
import { GoogleAdsTab } from "@/components/configuracoes/google-ads-tab";
import {
  chegouCliqueComAChaveAtual,
  dicasDoRastreio,
  enderecoDeTeste,
  estadoDoRastreio,
  JANELA_DE_CLIQUES_MS,
  linhaParaColar,
  origemDoSistema,
  RASTREIO_DO_SITE_STATUS,
  RastreioDoSiteCard,
  situacaoDaResposta,
  SUFIXO_DO_GOOGLE_ADS,
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
  linhaDoScript,
  linkComCodigo,
  PARAMETROS_DO_GOOGLE,
  SUFIXO_DE_URL_FINAL,
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
    expect(
      estadoDoRastreio(linha({ ultimo_clique_em: antes(3) }), AGORA),
    ).toBe("recebendo");
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
      linha: linha({ chave_trocada_em: antes(60), ultimo_clique_em: antes(10) }),
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
    expect(html).toMatch(/WhatsApp Business \(<code[^>]*>wa\.me\/message\/\.\.\.<\/code>\)/);
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
      linkComCodigo("https://api.whatsapp.com/send?phone=5584999990000", codigo),
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
        linha: linha({ chave_trocada_em: antes(60), ultimo_clique_em: antes(9) }),
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
