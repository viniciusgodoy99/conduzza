import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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
vi.mock("@/app/(app)/configuracoes/rastreio-do-site-actions", () => ({
  alternarRastreioDoSiteAction: vi.fn(),
  salvarFrasesDoRastreioAction: vi.fn(),
  trocarChaveDoRastreioAction: vi.fn(),
}));
vi.mock("@/app/(app)/configuracoes/regras-de-origem-actions", () => ({
  salvarRegraDeOrigemAction: vi.fn(),
  ativarRegraDeOrigemAction: vi.fn(),
  desativarRegraDeOrigemAction: vi.fn(),
  excluirRegraDeOrigemAction: vi.fn(),
  salvarNumerosDoLinkAction: vi.fn(),
  definirAvisoDaMetaNoLinkAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/configuracoes",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  AnunciosERastreioTab,
  type DadosDaMeta,
} from "@/components/configuracoes/anuncios-e-rastreio-tab";
import type { DadosDoRastreio } from "@/components/configuracoes/google-ads-tab";
import type { DadosDasOrigens } from "@/components/configuracoes/origem-dos-leads-tab";
import { TooltipProvider } from "@/components/ui/tooltip";

// A aba "Anuncios e rastreio" (decisao do dono de 17/11/2026): a lista dos
// passos com a situacao de cada um e as secoes que abrem.

const META: DadosDaMeta = {
  conta: {
    pixel_id: "123456789012345",
    ad_account_id: "act_123456789",
    // Com a conta do WhatsApp Business o passo 1 fica pronto (sem ela, falta).
    whatsapp_business_account_id: "109876543210987",
    test_event_code: null,
    envio_ativado: false,
    modo_user_data: null,
    send_unmatched: false,
  },
  temToken: false,
  temTokenDeLeitura: false,
  leitura: null,
  timezone: "America/Fortaleza",
  agoraMs: Date.UTC(2026, 10, 17, 12),
};

const GOOGLE: DadosDoRastreio = {
  linha: null,
  situacao: null,
  enderecoDoSistema: "https://app.exemplo.test",
  timezone: "America/Fortaleza",
  agoraMs: META.agoraMs,
};

const ORIGENS: DadosDasOrigens = {
  regras: [],
  numeros: [],
  frasesDoSite: [],
  enderecoDosLinks: null,
  resumoDosLinks: {},
  numerosDosLinks: {},
  metaProntaParaOClique: false,
};

function aba(
  props: Partial<React.ComponentProps<typeof AnunciosERastreioTab>> = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AnunciosERastreioTab
        meta={META}
        google={GOOGLE}
        origens={ORIGENS}
        podeGerenciar
        dica="Somente administradores e gestores alteram as configurações"
        {...props}
      />
    </TooltipProvider>,
  );
}

const texto = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** Os passos abertos: o gatilho de cada secao diz aria-expanded. */
function abertos(html: string): string[] {
  return [...html.matchAll(/<div[^>]*data-state="open"[^>]*data-passo="([a-z]+)"|<div[^>]*data-passo="([a-z]+)"[^>]*data-state="open"/g)].map(
    (achado) => achado[1] ?? achado[2] ?? "",
  );
}

describe("AnunciosERastreioTab", () => {
  it("lista os seis passos, numerados, com a situação em chip e o botão de abrir", () => {
    const html = aba();
    const visivel = texto(html);
    expect(visivel).toContain("Passo a passo");
    expect(visivel).toContain("1 de 6 prontos");
    for (const titulo of [
      "Conta da Meta",
      "Token das conversões",
      "Envio das conversões",
      "Investimento nos anúncios",
      "Rastreio do site",
      "Links e origens",
    ]) {
      expect(visivel).toContain(titulo);
    }
    expect(html.match(/aria-label="Abrir o passo \d, /g)).toHaveLength(6);
    // As tres camadas do status: o rotulo escrito, alem do icone e da cor.
    expect(visivel).toContain("Pronto");
    expect(visivel).toContain("Falta fazer");
    expect(visivel).toContain("Desligado");
  });

  it("nasce com o primeiro passo que falta aberto, e só ele", () => {
    const html = aba();
    expect(abertos(html)).toEqual(["token"]);
    expect(html).toContain("Gerar token de acesso");
    // O cartao da conta (passo 1, pronto) fica fechado, mas MONTADO e so
    // escondido: fechar um passo nao pode apagar o que foi digitado nele
    // (revisao de 17/11/2026).
    expect(html).toContain('id="meta-pixel"');
    expect(html).toMatch(
      /data-state="closed"[^>]*class="[^"]*data-\[state=closed\]:hidden/,
    );
  });

  it("conta sem o WhatsApp Business: o passo 1 falta e é ele que nasce aberto", () => {
    const html = aba({
      meta: {
        ...META,
        conta: { ...META.conta!, whatsapp_business_account_id: null },
      },
    });
    expect(abertos(html)).toEqual(["conta"]);
    expect(texto(html)).toContain("Falta a conta do WhatsApp Business.");
  });

  it("?passo= abre o passo pedido; o link antigo de aba abre os passos dela", () => {
    expect(abertos(aba({ passoDoEndereco: "site" }))).toEqual(["site"]);
    const daMeta = aba({ abaDoEndereco: "meta" });
    expect(abertos(daMeta)).toEqual(["conta", "token", "envio", "investimento"]);
    expect(daMeta).toContain('id="meta-pixel"');
    expect(daMeta).toContain("Token de leitura de anúncios");
    expect(abertos(aba({ abaDoEndereco: "origem" }))).toEqual(["origens"]);
  });

  it("leitura que falhou: o passo avisa que não carregou e o resto da aba continua", () => {
    const html = aba({ meta: null, abaDoEndereco: "meta" });
    const visivel = texto(html);
    expect(visivel).toContain("Não carregou");
    expect(visivel).toContain("Não foi possível carregar a conta de anúncios");
    expect(visivel).toContain("Rastreio do site");
    expect(html).not.toContain('id="meta-pixel"');
  });

  it("o passo do site traz onde colar os parâmetros na Meta e como ligar a codificação no Google", () => {
    const html = aba({ passoDoEndereco: "site" });
    expect(html).toContain("Parâmetros de URL");
    expect(html).toContain('href="https://ads.google.com/aw/settings/account"');
    expect(html).toContain(
      'href="https://ads.google.com/aw/conversions/uploads"',
    );
  });

  it("nenhum travessão e nenhuma cor solta, com tudo aberto e sem permissão", () => {
    for (const html of [
      aba({ abaDoEndereco: "meta" }),
      aba({ passoDoEndereco: "site", podeGerenciar: false }),
      aba({ passoDoEndereco: "origens" }),
      aba({ meta: null, google: null, origens: null }),
    ]) {
      expect(html).not.toMatch(/[–—]/);
      expect(html).not.toMatch(/(?:text|bg|border)-\[#/);
    }
  });
});
