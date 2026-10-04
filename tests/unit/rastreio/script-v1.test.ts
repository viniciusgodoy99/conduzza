import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { extrairToken } from "@/lib/domain/attribution";
import {
  caminhoDasFrases,
  FORMATO_DO_CODIGO,
  FRASE_PADRAO,
  frasesDaResposta,
  lerCorpoDoClique,
  linkComCodigo,
  sinaisDaUrl,
  sortearFrase,
} from "@/lib/domain/rastreio-do-site";

// O script que roda no site da clinica (public/rastreio/v1.js), executado de
// verdade num contexto isolado do Node com um navegador falso minimo. O
// Vitest roda em node (sem jsdom); o e2e (tests/e2e/rastreio-do-site.spec.ts)
// prova o mesmo num Chromium.
//
// Duas coisas sao provadas aqui:
// 1. PARIDADE: o script faz exatamente o que lib/domain/rastreio-do-site.ts
//    diz (sinais da URL, frases da resposta, sorteio, link com o codigo,
//    corpo que a rota aceita). O script nao importa o modulo (e estatico,
//    sem build), entao este teste e o que impede os dois de divergirem.
// 2. O SCRIPT NUNCA QUEBRA O SITE: sessionStorage bloqueado, sem crypto, sem
//    sendBeacon, sendBeacon que lanca, link que nao e do WhatsApp, busca das
//    frases que falha, demora ou volta lixo. Em nenhum caso ele chama
//    preventDefault ou deixa escapar excecao.

const CODIGO_DO_SCRIPT = readFileSync(
  join(process.cwd(), "public", "rastreio", "v1.js"),
  "utf-8",
);

const CHAVE = "0123456789abcdef0123";
const SRC = "https://app.conduzza.test/rastreio/v1.js";
const DESTINO = "https://app.conduzza.test/api/publico/clique";
/** Onde o script busca as frases da clinica (GET pela chave). */
const BUSCA = new URL(caminhoDasFrases(CHAVE) ?? "", SRC).href;
/** O item do sessionStorage e da chave (outra clinica no mesmo site nao o le). */
const guardadoDa = (chave: string) => `conduzza_rastreio_v1_${chave}`;
const GUARDADO = guardadoDa(CHAVE);
/** Outra clinica do Conduzza com pagina no MESMO site (mesma origem). */
const CHAVE_DE_OUTRA_CLINICA = "b".repeat(20);

type Ouvinte = {
  tipo: string;
  fn: (evento: unknown) => void;
  captura: unknown;
};

class ElementoFalso {
  parentNode: ElementoFalso | null = null;
  private readonly atributos = new Map<string, string>();

  constructor(
    readonly tagName: string,
    atributos: Record<string, string> = {},
  ) {
    for (const [nome, valor] of Object.entries(atributos)) {
      this.atributos.set(nome, valor);
    }
  }

  getAttribute(nome: string): string | null {
    return this.atributos.get(nome) ?? null;
  }

  setAttribute(nome: string, valor: string): void {
    this.atributos.set(nome, valor);
  }
}

/**
 * O que a rota das frases responde ao script: status e corpo (JSON), JSON
 * quebrado, falha de rede ou nada ainda (o teste libera depois).
 */
type RespostaDaBusca =
  | { status: number; corpo?: unknown; jsonQuebrado?: boolean }
  | "falha"
  | "pendente";

type Opcoes = {
  busca?: string;
  chave?: string | null;
  semCurrentScript?: boolean;
  scriptPeloSeletor?: boolean;
  armazenamento?: "ok" | "quebrado";
  guardado?: string;
  /**
   * sessionStorage da aba, dividido entre montagens: duas paginas do mesmo
   * site (mesma origem) na mesma aba, uma depois da outra.
   */
  sessao?: Map<string, string>;
  sendBeacon?: "ok" | "recusa" | "lanca" | "ausente";
  crypto?: "real" | "ausente" | ((bytes: Uint8Array) => void);
  /** Quantas vezes a linha foi colada na pagina (GTM e HTML, por exemplo). */
  vezes?: number;
  /** Resposta da rota das frases (padrao: 404, sem frases). */
  frases?: RespostaDaBusca;
  /** fetch ausente (navegador antigo) ou que lanca na chamada. */
  fetch?: "ok" | "ausente" | "lanca";
  /** Navegador sem AbortController: busca sem tempo limite. */
  semAbortController?: boolean;
};

function montar(opcoes: Opcoes = {}) {
  const ouvintes: Ouvinte[] = [];
  const avisos: { url: string; corpo: string }[] = [];
  const fetches: { url: string; init: Record<string, unknown> }[] = [];
  const buscas: { url: string; init: Record<string, unknown> }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let liberar: (resposta: RespostaDaBusca) => void = () => undefined;
  const responder = (resposta: RespostaDaBusca): Promise<unknown> => {
    if (resposta === "falha") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (resposta === "pendente") {
      return new Promise((resolve, reject) => {
        liberar = (depois) => {
          responder(depois).then(resolve, reject);
        };
      });
    }
    return Promise.resolve({
      status: resposta.status,
      ok: resposta.status >= 200 && resposta.status < 300,
      json: () =>
        resposta.jsonQuebrado
          ? Promise.reject(new SyntaxError("Unexpected token"))
          : Promise.resolve(resposta.corpo),
    });
  };
  const armazenado = opcoes.sessao ?? new Map<string, string>();
  if (opcoes.guardado !== undefined) {
    armazenado.set(GUARDADO, opcoes.guardado);
  }

  const atributosDoScript: Record<string, string> = { src: SRC };
  if (opcoes.chave !== null) {
    atributosDoScript["data-chave"] = opcoes.chave ?? CHAVE;
  }
  const script = Object.assign(new ElementoFalso("SCRIPT", atributosDoScript), {
    src: SRC,
  });

  const sessionStorage = {
    getItem: (k: string) => armazenado.get(k) ?? null,
    setItem: (k: string, v: string) => {
      armazenado.set(k, String(v));
    },
  };

  const navigator: Record<string, unknown> = {};
  if (opcoes.sendBeacon !== "ausente") {
    navigator.sendBeacon = (url: string, corpo: string) => {
      if (opcoes.sendBeacon === "lanca") {
        throw new TypeError("Illegal invocation");
      }
      avisos.push({ url, corpo });
      return opcoes.sendBeacon !== "recusa";
    };
  }

  const contexto: Record<string, unknown> = {
    document: {
      currentScript: opcoes.semCurrentScript ? null : script,
      querySelector: (seletor: string) =>
        opcoes.scriptPeloSeletor &&
        seletor === 'script[data-chave][src*="/rastreio/v1.js"]'
          ? script
          : null,
      addEventListener: (
        tipo: string,
        fn: (e: unknown) => void,
        captura: unknown,
      ) => {
        ouvintes.push({ tipo, fn, captura });
      },
    },
    location: {
      search: opcoes.busca ?? "",
      href: `https://clinica.test/${opcoes.busca ?? ""}`,
    },
    navigator,
    fetch: (url: string, init: Record<string, unknown>) => {
      if (opcoes.fetch === "lanca") {
        throw new TypeError("fetch bloqueado");
      }
      if (url.startsWith(BUSCA.slice(0, -CHAVE.length))) {
        buscas.push({ url, init });
        return responder(opcoes.frases ?? { status: 404 });
      }
      fetches.push({ url, init });
      return Promise.resolve(undefined);
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    URL,
    URLSearchParams,
  };
  if (opcoes.fetch === "ausente") {
    delete contexto.fetch;
  }
  if (!opcoes.semAbortController) {
    contexto.AbortController = AbortController;
  }
  contexto.window = contexto;
  Object.defineProperty(contexto, "sessionStorage", {
    get() {
      if (opcoes.armazenamento === "quebrado") {
        throw new DOMException("bloqueado", "SecurityError");
      }
      return sessionStorage;
    },
  });
  const crypto = opcoes.crypto ?? "real";
  if (crypto !== "ausente") {
    contexto.crypto = {
      getRandomValues: (bytes: Uint8Array) => {
        if (crypto === "real") {
          randomFillSync(bytes);
        } else {
          crypto(bytes);
        }
        return bytes;
      },
    };
  }

  for (let vez = 0; vez < (opcoes.vezes ?? 1); vez++) {
    runInNewContext(CODIGO_DO_SCRIPT, contexto);
  }

  function disparar(
    alvo: ElementoFalso,
    parcial: { type?: string; button?: number; semComposedPath?: boolean } = {},
  ) {
    const caminho: unknown[] = [];
    for (let no: ElementoFalso | null = alvo; no; no = no.parentNode) {
      caminho.push(no);
    }
    caminho.push(contexto.document, contexto);
    const evento: Record<string, unknown> = {
      type: parcial.type ?? "click",
      button: parcial.button ?? 0,
      target: alvo,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    if (!parcial.semComposedPath) {
      evento.composedPath = () => caminho;
    }
    for (const ouvinte of ouvintes) {
      if (ouvinte.tipo === evento.type) {
        expect(() => ouvinte.fn(evento)).not.toThrow();
      }
    }
    expect(evento.preventDefault).not.toHaveBeenCalled();
    expect(evento.stopPropagation).not.toHaveBeenCalled();
    expect(evento.stopImmediatePropagation).not.toHaveBeenCalled();
  }

  return {
    ouvintes,
    avisos,
    fetches,
    buscas,
    timers,
    armazenado,
    disparar,
    liberar: (resposta: RespostaDaBusca) => liberar(resposta),
  };
}

/** Deixa a busca das frases (promessas) terminar antes do clique. */
async function assentar(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Os timers que devolvem o link original (1,5 s depois do clique). */
function devolucoes(timers: { fn: () => void; ms: number }[]) {
  return timers.filter((timer) => timer.ms === 1500);
}

function link(href: string): ElementoFalso {
  return new ElementoFalso("A", { href });
}

/** O codigo que o script mandou no aviso (e que tem de estar no link). */
function codigoDoAviso(corpo: string | undefined): string {
  const leitura = lerCorpoDoClique(corpo ?? "");
  if (!leitura.ok) {
    throw new Error(`corpo recusado pela rota: ${leitura.motivo}`);
  }
  return leitura.corpo.codigo;
}

const WA = "https://wa.me/5584999990000?text=Quero%20agendar";

describe("rastreio v1: sem sinal do Google nao faz nada", () => {
  it("visita sem parametro do Google: nenhum ouvinte, nada guardado", () => {
    const ambiente = montar({ busca: "?utm_source=instagram" });
    expect(ambiente.ouvintes).toHaveLength(0);
    expect(ambiente.armazenado.size).toBe(0);
    // Nem busca as frases: visita sem anuncio nao chama o sistema.
    expect(ambiente.buscas).toHaveLength(0);
  });

  it("chave ausente ou fora do formato: nada", () => {
    expect(montar({ busca: "?gclid=abc", chave: null }).ouvintes).toHaveLength(
      0,
    );
    expect(
      montar({ busca: "?gclid=abc", chave: "slug-da-clinica" }).ouvintes,
    ).toHaveLength(0);
    expect(
      montar({ busca: "?gclid=abc", chave: CHAVE.toUpperCase() }).ouvintes,
    ).toHaveLength(0);
  });

  it("sem currentScript usa o seletor; sem nenhum dos dois, nada", () => {
    expect(
      montar({ busca: "?gclid=abc", semCurrentScript: true }).ouvintes,
    ).toHaveLength(0);
    expect(
      montar({
        busca: "?gclid=abc",
        semCurrentScript: true,
        scriptPeloSeletor: true,
      }).ouvintes,
    ).toHaveLength(2);
  });
});

describe("rastreio v1: com sinal do Google", () => {
  it("ouve click e auxclick na fase de captura e guarda os sinais na sessao", () => {
    const busca =
      "?gclid=Cj0K_a-b&gad_campaignid=123&cz_grupo=&utm_source=google";
    const ambiente = montar({ busca });
    expect(ambiente.ouvintes.map((o) => [o.tipo, o.captura])).toEqual([
      ["click", true],
      ["auxclick", true],
    ]);
    expect(JSON.parse(ambiente.armazenado.get(GUARDADO) ?? "null")).toEqual(
      sinaisDaUrl(busca),
    );
  });

  it("no clique do wa.me: codigo no texto, aviso por sendBeacon que a rota aceita", () => {
    const busca =
      "?gclid=Cj0K_a-b&gad_campaignid=123&cz_campanha=456&cz_grupo=789";
    const ambiente = montar({ busca });
    const botao = link(WA);
    ambiente.disparar(botao);

    expect(ambiente.avisos).toHaveLength(1);
    expect(ambiente.avisos[0]?.url).toBe(DESTINO);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    expect(FORMATO_DO_CODIGO.test(codigo)).toBe(true);
    expect(JSON.parse(ambiente.avisos[0]?.corpo ?? "{}")).toEqual({
      chave: CHAVE,
      codigo,
      ...sinaisDaUrl(busca),
    });

    // PARIDADE: o href e exatamente o que o modulo de dominio monta.
    expect(botao.getAttribute("href")).toBe(linkComCodigo(WA, codigo));
    const texto = new URL(botao.getAttribute("href") ?? "").searchParams.get(
      "text",
    );
    expect(texto).toBe(`Quero agendar [#${codigo}]`);
    // A ingestao le o mesmo codigo do texto.
    expect(extrairToken(texto ?? "")).toBe(codigo);
    expect(ambiente.fetches).toHaveLength(0);
  });

  it("paridade com linkComCodigo em todo tipo de link", () => {
    const hrefs = [
      "https://wa.me/5584999990000",
      "https://wa.me/5584999990000/",
      "https://wa.me/5584999990000?text=",
      "https://wa.me/5584999990000?text=Quero+agendar",
      "https://wa.me/5584999990000?text=Ol%C3%A1%21",
      "  https://wa.me/5584999990000?text=Oi \n",
      "https://api.whatsapp.com/send?phone=5584999990000&text=Oi&type=phone_number",
      "https://api.whatsapp.com/send/?phone=5584999990000",
      "https://web.whatsapp.com/send?phone=5584999990000&text=Oi#topo",
      "whatsapp://send?phone=5584999990000",
      "//WA.ME/5584999990000?text=Oi",
      "https://wa.me/5584999990000?text",
      // Os que NAO podem ser tocados:
      "https://wa.me/5584999990000?text=Oi%20%5B%23AB2CDE%5D",
      "https://wa.me/message/ABCDEF123",
      "https://wa.link/abc123",
      "https://wa.me/5584999990000?text=%E0%A4%A",
      "/contato",
      "https://clinica.test/agendar",
      "mailto:contato@clinica.test",
    ];
    for (const href of hrefs) {
      const ambiente = montar({ busca: "?gclid=abc" });
      const botao = link(href);
      ambiente.disparar(botao);
      const aviso = ambiente.avisos[0];
      if (aviso) {
        const codigo = codigoDoAviso(aviso.corpo);
        expect(botao.getAttribute("href"), href).toBe(
          linkComCodigo(href, codigo),
        );
      } else {
        // Sem aviso, o link fica intacto, e o dominio tambem nao tocaria.
        expect(botao.getAttribute("href"), href).toBe(href);
        expect(linkComCodigo(href, "K7Q2MX"), href).toBeNull();
      }
    }
  });

  it("link sem texto pronto e sem frases da clinica: a frase de fabrica antes do codigo", async () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    await assentar();
    const botao = link("https://wa.me/5584999990000");
    ambiente.disparar(botao);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    // A mesma do dominio e do default do banco (tests/unit/rastreio/frases).
    expect(
      new URL(botao.getAttribute("href") ?? "").searchParams.get("text"),
    ).toBe(
      `Olá! Vim pelo site e gostaria de agendar uma consulta. [#${codigo}]`,
    );
    expect(botao.getAttribute("href")).toBe(
      linkComCodigo("https://wa.me/5584999990000", codigo, FRASE_PADRAO),
    );
  });

  it("clique em elemento dentro do link (e sem composedPath) tambem vale", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    const botao = link(WA);
    const icone = new ElementoFalso("SPAN");
    icone.parentNode = botao;
    ambiente.disparar(icone, { semComposedPath: true });
    expect(ambiente.avisos).toHaveLength(1);
    expect(botao.getAttribute("href")).not.toBe(WA);
  });

  it("link que nao e do WhatsApp: intacto e sem aviso", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    const outro = link("https://clinica.test/servicos");
    ambiente.disparar(outro);
    ambiente.disparar(new ElementoFalso("BUTTON"));
    expect(outro.getAttribute("href")).toBe("https://clinica.test/servicos");
    expect(ambiente.avisos).toHaveLength(0);
  });

  it("auxclick so com o botao do meio (o direito abre o menu)", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    const botao = link(WA);
    ambiente.disparar(botao, { type: "auxclick", button: 2 });
    expect(ambiente.avisos).toHaveLength(0);
    expect(botao.getAttribute("href")).toBe(WA);
    ambiente.disparar(botao, { type: "auxclick", button: 1 });
    expect(ambiente.avisos).toHaveLength(1);
  });

  it("dois cliques seguidos: cada um com um codigo, sem acumular no texto", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    const botao = link(WA);
    ambiente.disparar(botao);
    ambiente.disparar(botao);
    expect(ambiente.avisos).toHaveLength(2);
    const primeiro = codigoDoAviso(ambiente.avisos[0]?.corpo);
    const segundo = codigoDoAviso(ambiente.avisos[1]?.corpo);
    expect(segundo).not.toBe(primeiro);
    expect(botao.getAttribute("href")).toBe(linkComCodigo(WA, segundo));
  });

  it("devolve o link original depois, a nao ser que o site tenha trocado", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    const botao = link(WA);
    ambiente.disparar(botao);
    expect(devolucoes(ambiente.timers)).toHaveLength(1);
    devolucoes(ambiente.timers)[0]?.fn();
    expect(botao.getAttribute("href")).toBe(WA);

    ambiente.disparar(botao);
    botao.setAttribute("href", "https://wa.me/5584999990000?text=Outro");
    devolucoes(ambiente.timers)[1]?.fn();
    expect(botao.getAttribute("href")).toBe(
      "https://wa.me/5584999990000?text=Outro",
    );
  });
});

describe("rastreio v1: linha colada duas vezes", () => {
  it("um codigo so no texto e um aviso so", () => {
    const ambiente = montar({ busca: "?gclid=abc", vezes: 2 });
    expect(ambiente.ouvintes).toHaveLength(4);
    const botao = link(WA);
    ambiente.disparar(botao);
    expect(ambiente.avisos).toHaveLength(1);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    expect(botao.getAttribute("href")).toBe(linkComCodigo(WA, codigo));
  });
});

describe("rastreio v1: navegacao entre paginas (sessionStorage)", () => {
  it("o sinal guardado na pagina do anuncio vale na pagina seguinte", () => {
    const primeira = montar({ busca: "?gbraid=0AAA&gad_source=1" });
    const guardado = primeira.armazenado.get(GUARDADO);
    const segunda = montar({ busca: "", guardado });
    expect(segunda.ouvintes).toHaveLength(2);
    segunda.disparar(link(WA));
    expect(JSON.parse(segunda.avisos[0]?.corpo ?? "{}")).toMatchObject({
      gbraid: "0AAA",
      gad_source: "1",
    });
  });

  it("sinal novo na URL substitui o guardado", () => {
    const ambiente = montar({
      busca: "?gclid=novo",
      guardado: JSON.stringify({ gclid: "velho", cz_campanha: "1" }),
    });
    expect(JSON.parse(ambiente.armazenado.get(GUARDADO) ?? "{}")).toEqual({
      gclid: "novo",
    });
  });

  it("guardado adulterado: so o que esta no formato vale, o resto e ignorado", () => {
    const ambiente = montar({
      guardado: JSON.stringify({
        gclid: "<script>",
        cz_campanha: "123",
        pagina: "/tratamento-x",
      }),
    });
    ambiente.disparar(link(WA));
    const corpo = JSON.parse(ambiente.avisos[0]?.corpo ?? "{}") as Record<
      string,
      unknown
    >;
    expect(corpo).toEqual({
      chave: CHAVE,
      codigo: corpo.codigo,
      cz_campanha: "123",
    });
  });

  it("guardado ilegivel ou sem sinal: nada", () => {
    expect(montar({ guardado: "{quebrado" }).ouvintes).toHaveLength(0);
    expect(montar({ guardado: '"texto"' }).ouvintes).toHaveLength(0);
    expect(
      montar({ guardado: JSON.stringify({ gclid: "" }) }).ouvintes,
    ).toHaveLength(0);
  });
});

describe("rastreio v1: duas clinicas no mesmo site (mesma origem, mesma aba)", () => {
  // Agencia com paginas de varias clinicas no mesmo dominio, ou rede com uma
  // pagina por unidade, cada unidade uma clinica: o sessionStorage e da
  // origem, nao do script. O anuncio de uma clinica nunca pode virar a
  // origem (imutavel) de um contato da outra.

  it("o sinal guardado pela clinica A nao vale na pagina da clinica B", () => {
    const sessao = new Map<string, string>();
    const paginaDeA = montar({
      busca: "?gclid=G&gad_campaignid=111",
      sessao,
    });
    expect(paginaDeA.ouvintes).toHaveLength(2);
    expect(sessao.has(GUARDADO)).toBe(true);

    const paginaDeB = montar({ chave: CHAVE_DE_OUTRA_CLINICA, sessao });
    expect(paginaDeB.ouvintes).toHaveLength(0);
    expect(paginaDeB.buscas).toHaveLength(0);
    const botao = link(WA);
    paginaDeB.disparar(botao);
    expect(paginaDeB.avisos).toHaveLength(0);
    expect(paginaDeB.fetches).toHaveLength(0);
    expect(botao.getAttribute("href")).toBe(WA);
    // E a pagina de B nao apaga nem copia o guardado de A.
    expect(sessao.has(guardadoDa(CHAVE_DE_OUTRA_CLINICA))).toBe(false);
    expect(JSON.parse(sessao.get(GUARDADO) ?? "null")).toEqual({
      gclid: "G",
      gad_campaignid: "111",
    });
  });

  it("o item antigo, sem a chave no nome, e ignorado", () => {
    const sessao = new Map([
      ["conduzza_rastreio_v1", JSON.stringify({ gclid: "G" })],
    ]);
    expect(montar({ sessao }).ouvintes).toHaveLength(0);
  });

  it("sinal na URL de B nao sobrescreve o guardado de A", () => {
    const sessao = new Map<string, string>();
    montar({ busca: "?gclid=deA&cz_campanha=111", sessao });
    const paginaDeB = montar({
      chave: CHAVE_DE_OUTRA_CLINICA,
      busca: "?gclid=deB&cz_campanha=222",
      sessao,
    });
    expect(JSON.parse(sessao.get(GUARDADO) ?? "null")).toEqual({
      gclid: "deA",
      cz_campanha: "111",
    });
    expect(
      JSON.parse(sessao.get(guardadoDa(CHAVE_DE_OUTRA_CLINICA)) ?? "null"),
    ).toEqual({ gclid: "deB", cz_campanha: "222" });
    paginaDeB.disparar(link(WA));
    expect(JSON.parse(paginaDeB.avisos[0]?.corpo ?? "{}")).toMatchObject({
      chave: CHAVE_DE_OUTRA_CLINICA,
      gclid: "deB",
      cz_campanha: "222",
    });
  });

  it("com a mesma chave, o guardado continua valendo na pagina seguinte", () => {
    const sessao = new Map<string, string>();
    montar({ busca: "?gclid=G&gad_campaignid=111", sessao });
    const seguinte = montar({ sessao });
    expect(seguinte.ouvintes).toHaveLength(2);
    seguinte.disparar(link(WA));
    expect(JSON.parse(seguinte.avisos[0]?.corpo ?? "{}")).toMatchObject({
      chave: CHAVE,
      gclid: "G",
      gad_campaignid: "111",
    });
  });
});

describe("rastreio v1: nunca quebra o link", () => {
  it("sessionStorage bloqueado com gclid: o codigo entra do mesmo jeito", () => {
    const ambiente = montar({ busca: "?gclid=abc", armazenamento: "quebrado" });
    const botao = link(WA);
    ambiente.disparar(botao);
    expect(ambiente.avisos).toHaveLength(1);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    expect(botao.getAttribute("href")).toBe(linkComCodigo(WA, codigo));
  });

  it("sessionStorage bloqueado sem gclid: nada, e nada lanca", () => {
    expect(() => montar({ armazenamento: "quebrado" })).not.toThrow();
    expect(montar({ armazenamento: "quebrado" }).ouvintes).toHaveLength(0);
  });

  it("sendBeacon recusado, ausente ou que lanca: reserva por fetch sem credencial", () => {
    for (const sendBeacon of ["recusa", "ausente", "lanca"] as const) {
      const ambiente = montar({ busca: "?gclid=abc", sendBeacon });
      const botao = link(WA);
      ambiente.disparar(botao);
      expect(ambiente.fetches, sendBeacon).toHaveLength(1);
      expect(ambiente.fetches[0]?.url).toBe(DESTINO);
      expect(ambiente.fetches[0]?.init).toMatchObject({
        method: "POST",
        mode: "no-cors",
        credentials: "omit",
        keepalive: true,
      });
      const codigo = codigoDoAviso(String(ambiente.fetches[0]?.init.body));
      expect(botao.getAttribute("href")).toBe(linkComCodigo(WA, codigo));
    }
  });

  it("sem crypto: o link segue intacto e nada e avisado", () => {
    const ambiente = montar({ busca: "?gclid=abc", crypto: "ausente" });
    const botao = link(WA);
    ambiente.disparar(botao);
    expect(botao.getAttribute("href")).toBe(WA);
    expect(ambiente.avisos).toHaveLength(0);
    expect(ambiente.fetches).toHaveLength(0);
  });
});

describe("rastreio v1: o codigo", () => {
  it("sorteio sem vicio: byte de 248 para cima e descartado", () => {
    // 31 * 8 = 248. Os bytes 255, 250 e 248 saem; 0, 1, 30, 31, 247 e 62
    // entram como 0, 1, 30, 0, 30 e 0.
    const ambiente = montar({
      busca: "?gclid=abc",
      crypto: (bytes) => {
        bytes.fill(255);
        bytes.set([255, 250, 248, 0, 1, 30, 31, 247, 62]);
      },
    });
    ambiente.disparar(link(WA));
    expect(codigoDoAviso(ambiente.avisos[0]?.corpo)).toBe("23Z2Z2");
  });

  it("codigos do gerador forte sempre no formato e espalhados pelo alfabeto", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    const vistos = new Set<string>();
    const letras = new Set<string>();
    for (let i = 0; i < 400; i++) {
      ambiente.disparar(link(WA));
    }
    for (const aviso of ambiente.avisos) {
      const codigo = codigoDoAviso(aviso.corpo);
      vistos.add(codigo);
      for (const letra of codigo) letras.add(letra);
    }
    expect(vistos.size).toBe(400);
    expect(letras.size).toBe(31);
  });
});

const WA_SEM_TEXTO = "https://wa.me/5584999990000";
const FRASE_A = "Oi! Vi o anúncio no site. Quero marcar uma avaliação.";
const FRASE_B = "Bom dia, gostaria de saber os horários (pode ser sábado?).";
const FRASE_C = "Olá! Quero agendar: limpeza & clareamento, 50% à vista?";

function textoDo(botao: ElementoFalso): string {
  return (
    new URL(botao.getAttribute("href") ?? "").searchParams.get("text") ?? ""
  );
}

/**
 * crypto falso: o codigo (16 bytes por vez) vem do gerador forte; o sorteio
 * da frase (1 byte por vez) vem da fila, na ordem.
 */
function cryptoComSorteio(fila: number[]): (bytes: Uint8Array) => void {
  return (bytes) => {
    if (bytes.length === 1) {
      bytes[0] = fila.shift() ?? 0;
    } else {
      randomFillSync(bytes);
    }
  };
}

describe("rastreio v1: frases da clinica", () => {
  it("com sinal, busca as frases uma vez ao carregar: GET pela chave, sem cookie, sem referrer, com tempo limite", () => {
    const ambiente = montar({ busca: "?gclid=abc" });
    expect(ambiente.buscas).toHaveLength(1);
    expect(ambiente.buscas[0]?.url).toBe(BUSCA);
    expect(BUSCA).toBe(
      `https://app.conduzza.test/api/publico/rastreio/${CHAVE}`,
    );
    const init = ambiente.buscas[0]?.init ?? {};
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(init).not.toHaveProperty("body");
    expect(init).not.toHaveProperty("keepalive");
    expect(init).not.toHaveProperty("headers");
    // Tempo limite: 4 s depois, a busca e abortada (e fica a de fabrica).
    const sinal = init.signal as AbortSignal;
    expect(sinal).toBeInstanceOf(AbortSignal);
    const espera = ambiente.timers.filter((timer) => timer.ms === 4000);
    expect(espera).toHaveLength(1);
    expect(sinal.aborted).toBe(false);
    espera[0]?.fn();
    expect(sinal.aborted).toBe(true);
    // O aviso do clique continua indo pelo sendBeacon, nao por aqui.
    expect(ambiente.fetches).toHaveLength(0);
  });

  it("o sinal guardado da pagina anterior tambem busca; a pagina de outra clinica busca pela propria chave", () => {
    const sessao = new Map<string, string>();
    montar({ busca: "?gclid=G", sessao });
    const seguinte = montar({ sessao });
    expect(seguinte.buscas.map((b) => b.url)).toEqual([BUSCA]);
    const deB = montar({
      chave: CHAVE_DE_OUTRA_CLINICA,
      busca: "?gclid=B",
      sessao,
    });
    expect(deB.buscas.map((b) => b.url)).toEqual([
      new URL(caminhoDasFrases(CHAVE_DE_OUTRA_CLINICA) ?? "", SRC).href,
    ]);
  });

  it("link sem texto: a frase da clinica antes do codigo (paridade com o dominio)", async () => {
    const ambiente = montar({
      busca: "?gclid=abc",
      frases: { status: 200, corpo: { frases: [FRASE_A] } },
    });
    await assentar();
    for (const href of [
      WA_SEM_TEXTO,
      "https://wa.me/5584999990000?text=",
      "https://api.whatsapp.com/send?phone=5584999990000&type=phone_number",
      "whatsapp://send?phone=5584999990000",
    ]) {
      const botao = link(href);
      ambiente.disparar(botao);
      const codigo = codigoDoAviso(ambiente.avisos.at(-1)?.corpo);
      expect(textoDo(botao), href).toBe(`${FRASE_A} [#${codigo}]`);
      expect(botao.getAttribute("href"), href).toBe(
        linkComCodigo(href, codigo, FRASE_A),
      );
    }
  });

  it("frase com & = + % e acento vai codificada e o resto do link fica", async () => {
    const frase = `${FRASE_C} a=b+c`;
    const ambiente = montar({
      busca: "?gclid=abc",
      frases: { status: 200, corpo: { frases: [frase] } },
    });
    await assentar();
    const href =
      "https://api.whatsapp.com/send?phone=5584999990000&type=phone_number#x";
    const botao = link(href);
    ambiente.disparar(botao);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    const url = new URL(botao.getAttribute("href") ?? "");
    expect(url.searchParams.get("text")).toBe(`${frase} [#${codigo}]`);
    expect(url.searchParams.get("phone")).toBe("5584999990000");
    expect(url.hash).toBe("#x");
    expect(botao.getAttribute("href")).toBe(linkComCodigo(href, codigo, frase));
  });

  it("link com texto pronto: nada muda, a frase nao entra", async () => {
    const ambiente = montar({
      busca: "?gclid=abc",
      frases: { status: 200, corpo: { frases: [FRASE_A, FRASE_B] } },
    });
    await assentar();
    const botao = link(WA);
    ambiente.disparar(botao);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    expect(textoDo(botao)).toBe(`Quero agendar [#${codigo}]`);
    expect(botao.getAttribute("href")).toBe(linkComCodigo(WA, codigo));
  });

  it("sorteio: um byte por tentativa, igual ao sortearFrase do dominio", async () => {
    // Com 3 frases o limite e 255: o 255 e descartado e vale o byte seguinte.
    const fila = [1, 0, 255, 2, 5, 3];
    const frases = [FRASE_A, FRASE_B, FRASE_C];
    const ambiente = montar({
      busca: "?gclid=abc",
      frases: { status: 200, corpo: { frases } },
      crypto: cryptoComSorteio([...fila]),
    });
    await assentar();
    const doDominio = cryptoComSorteio([...fila]);
    const esperadas = [FRASE_B, FRASE_A, FRASE_C, FRASE_C, FRASE_A];
    for (const esperada of esperadas) {
      expect(sortearFrase(frases, doDominio)).toBe(esperada);
      const botao = link(WA_SEM_TEXTO);
      ambiente.disparar(botao);
      const codigo = codigoDoAviso(ambiente.avisos.at(-1)?.corpo);
      expect(textoDo(botao)).toBe(`${esperada} [#${codigo}]`);
    }
  });

  it("sorteio com o gerador forte: as duas frases saem, mais ou menos por igual", async () => {
    const ambiente = montar({
      busca: "?gclid=abc",
      frases: { status: 200, corpo: { frases: [FRASE_A, FRASE_B] } },
    });
    await assentar();
    const contagem = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const botao = link(WA_SEM_TEXTO);
      ambiente.disparar(botao);
      const frase = textoDo(botao).replace(/ \[#[^\]]+\]$/, "");
      contagem.set(frase, (contagem.get(frase) ?? 0) + 1);
    }
    expect([...contagem.keys()].sort()).toEqual([FRASE_A, FRASE_B].sort());
    for (const vezes of contagem.values()) {
      expect(vezes).toBeGreaterThan(100);
    }
  });

  it("uma frase so: nem sorteia (o crypto so gera o codigo)", async () => {
    const pedidos: number[] = [];
    const ambiente = montar({
      busca: "?gclid=abc",
      frases: { status: 200, corpo: { frases: [FRASE_A] } },
      crypto: (bytes) => {
        pedidos.push(bytes.length);
        randomFillSync(bytes);
      },
    });
    await assentar();
    ambiente.disparar(link(WA_SEM_TEXTO));
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every((tamanho) => tamanho === 16)).toBe(true);
  });

  it("resposta fora da regra ou estranha: a frase de fabrica (paridade com frasesDaResposta)", async () => {
    const corpos: unknown[] = [
      { frases: [] },
      { frases: ["1", "2", "3", "4", "5", "6"] },
      { frases: [""] },
      { frases: ["   "] },
      { frases: ["a".repeat(301)] },
      { frases: ["😀".repeat(301)] },
      { frases: ["Agende #AB2CDE"] },
      { frases: ["Quero [agendar]"] },
      { frases: ["linha\nnova"] },
      { frases: ["com\u2028separador"] },
      { frases: ["c1\u0085"] },
      { frases: [FRASE_A, null] },
      { frases: [FRASE_A, 1] },
      { frases: FRASE_A },
      { outra: [FRASE_A] },
      [FRASE_A],
      FRASE_A,
      null,
      // E as que passam, para a paridade valer nos dois sentidos.
      { frases: ["😀".repeat(300)] },
      { frases: ["  Oi  "] },
      { frases: [FRASE_B], versao: 2 },
    ];
    for (const corpo of corpos) {
      const ambiente = montar({
        busca: "?gclid=abc",
        frases: { status: 200, corpo },
      });
      await assentar();
      const botao = link(WA_SEM_TEXTO);
      ambiente.disparar(botao);
      const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
      const esperada = (frasesDaResposta(corpo) ?? [FRASE_PADRAO])[0];
      expect(textoDo(botao), JSON.stringify(corpo)).toBe(
        `${esperada} [#${codigo}]`,
      );
    }
  });

  it("busca que falha, 404, 500, JSON quebrado, fetch ausente ou que lanca: frase de fabrica, e o link funciona", async () => {
    const casos: Opcoes[] = [
      { frases: "falha" },
      { frases: { status: 404 } },
      { frases: { status: 204 } },
      { frases: { status: 500, corpo: { frases: [FRASE_A] } } },
      { frases: { status: 200, jsonQuebrado: true } },
      { fetch: "ausente" },
      { fetch: "lanca" },
      {
        semAbortController: true,
        frases: { status: 404 },
      },
    ];
    for (const caso of casos) {
      const ambiente = montar({ busca: "?gclid=abc", ...caso });
      await assentar();
      const botao = link(WA_SEM_TEXTO);
      ambiente.disparar(botao);
      expect(ambiente.avisos, JSON.stringify(caso)).toHaveLength(1);
      const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
      expect(textoDo(botao), JSON.stringify(caso)).toBe(
        `${FRASE_PADRAO} [#${codigo}]`,
      );
    }
  });

  it("sem AbortController: busca sem sinal e sem timer de espera, e a frase chega do mesmo jeito", async () => {
    const ambiente = montar({
      busca: "?gclid=abc",
      semAbortController: true,
      frases: { status: 200, corpo: { frases: [FRASE_A] } },
    });
    expect(ambiente.buscas[0]?.init).not.toHaveProperty("signal");
    expect(ambiente.timers).toHaveLength(0);
    await assentar();
    const botao = link(WA_SEM_TEXTO);
    ambiente.disparar(botao);
    expect(textoDo(botao)).toMatch(
      new RegExp(`^${FRASE_A.replace(/[.?()]/g, "\\$&")} \\[#`),
    );
  });

  it("clique antes de a busca voltar: frase de fabrica; o clique seguinte ja usa a da clinica", async () => {
    const ambiente = montar({ busca: "?gclid=abc", frases: "pendente" });
    await assentar();
    const primeiro = link(WA_SEM_TEXTO);
    ambiente.disparar(primeiro);
    expect(textoDo(primeiro)).toMatch(
      /^Olá! Vim pelo site e gostaria de agendar uma consulta\. \[#/,
    );

    ambiente.liberar({ status: 200, corpo: { frases: [FRASE_B] } });
    await assentar();
    const segundo = link(WA_SEM_TEXTO);
    ambiente.disparar(segundo);
    const codigo = codigoDoAviso(ambiente.avisos[1]?.corpo);
    expect(textoDo(segundo)).toBe(`${FRASE_B} [#${codigo}]`);
  });

  it("busca que nunca volta: todo clique com a frase de fabrica, sem esperar nada", async () => {
    const ambiente = montar({ busca: "?gclid=abc", frases: "pendente" });
    for (let i = 0; i < 3; i++) {
      const botao = link(WA_SEM_TEXTO);
      ambiente.disparar(botao);
      const codigo = codigoDoAviso(ambiente.avisos[i]?.corpo);
      expect(textoDo(botao)).toBe(`${FRASE_PADRAO} [#${codigo}]`);
    }
  });

  it("sem crypto: nem sorteia, o link segue intacto", async () => {
    const ambiente = montar({
      busca: "?gclid=abc",
      crypto: "ausente",
      frases: { status: 200, corpo: { frases: [FRASE_A, FRASE_B] } },
    });
    await assentar();
    const botao = link(WA_SEM_TEXTO);
    ambiente.disparar(botao);
    expect(botao.getAttribute("href")).toBe(WA_SEM_TEXTO);
    expect(ambiente.avisos).toHaveLength(0);
  });

  it("linha colada duas vezes: duas buscas, um codigo so e a frase da clinica", async () => {
    const ambiente = montar({
      busca: "?gclid=abc",
      vezes: 2,
      frases: { status: 200, corpo: { frases: [FRASE_A] } },
    });
    expect(ambiente.buscas).toHaveLength(2);
    await assentar();
    const botao = link(WA_SEM_TEXTO);
    ambiente.disparar(botao);
    expect(ambiente.avisos).toHaveLength(1);
    const codigo = codigoDoAviso(ambiente.avisos[0]?.corpo);
    expect(textoDo(botao)).toBe(`${FRASE_A} [#${codigo}]`);
  });
});

describe("rastreio v1: o arquivo", () => {
  it("pequeno", () => {
    // Era 8 KB; a busca e o sorteio das frases (04/10/2026) levaram a uns
    // 9,5 KB, quase tudo comentario (o servidor entrega comprimido).
    expect(Buffer.byteLength(CODIGO_DO_SCRIPT)).toBeLessThan(10 * 1024);
  });

  it("sintaxe que navegador antigo entende e texto so em ASCII", () => {
    // Um erro de sintaxe derruba o script inteiro (o site segue, o rastreio
    // nao). Nada de arrow function, let/const, ?., ??, catch sem variavel,
    // template string ou virgula antes de fechar parenteses (o Prettier pode
    // por virgula no fim de objeto e lista, que e ES5, mas nunca deve por em
    // chamada ou parametro); e o "Ola!" vai com escape para nao depender do
    // charset da pagina da clinica (a frase de fabrica tambem).
    const semComentarios = CODIGO_DO_SCRIPT.replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    ).replace(/^\s*\/\/.*$/gm, "");
    expect(semComentarios).not.toMatch(
      /=>|\blet\b|\bconst\b|\?\.|\?\?|catch\s*\{|`|,\s*\)/,
    );
    expect(CODIGO_DO_SCRIPT).toMatch(/^[\x00-\x7F]*$/);
  });

  it("nao le nem manda IP, user agent, caminho ou cookie", () => {
    expect(CODIGO_DO_SCRIPT).not.toMatch(
      /userAgent|document\.cookie|location\.pathname|location\.href|document\.referrer|localStorage/,
    );
  });
});
