import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O painel e a gaveta importam as Server Actions das secoes vizinhas; aqui
// so o bloco de origem importa. Qualquer acao pedida vira um vi.fn().
function acoesFalsas() {
  return new Proxy(
    {},
    {
      get: (_alvo, chave) =>
        chave === "then" || typeof chave === "symbol" ? undefined : vi.fn(),
      has: (_alvo, chave) => chave !== "then",
    },
  );
}
vi.mock("@/app/(app)/leads/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atividades/actions", () => acoesFalsas());

import { BlocoDeOrigem } from "@/components/atendimento/context-panel";
import {
  DetalhesDoAnuncio,
  montarBlocoDosDetalhes,
} from "@/components/leads/detalhes-do-anuncio";
import { OrigemPaciente } from "@/components/pacientes/origem-paciente";
import {
  LEITURA_SEM_DETALHES,
  TEXTO_SEM_DETALHES_DO_ANUNCIO,
  type DetalhesDoAnuncio as Detalhes,
  type LeituraDosDetalhes,
  type TelaDosDetalhes,
} from "@/lib/domain/anuncio-do-whatsapp";
import type {
  AnuncioDaMeta,
  LeituraDoAnuncio,
  TextoDeAtribuicao,
} from "@/lib/domain/leads-ui";
import { lerDetalhesDoAnuncio } from "@/lib/queries/anuncio-do-whatsapp";
import type { ContactSummary } from "@/lib/queries/conversations";
import { fetchLeadDetalhe } from "@/lib/queries/leads";
import type { ContatoDaFicha } from "@/lib/queries/pacientes";

// Bloco "Detalhes do anúncio" (pedido do dono em 20/10/2026) no painel do
// Atendimento, na ficha e (pelo mesmo componente) na gaveta de Leads: titulo
// e descricao como vieram na mensagem, "Ver mais" na descricao longa (pela
// largura de cada tela), "Abrir anúncio" so com link de um endereco do
// anuncio, a campanha e o conjunto DA META (a do link ou do Google fica nas
// linhas), a frase neutra quando so ha o codigo e os estados numa regiao
// role="status" fixa.

const FUSO = "America/Fortaleza";
const AD_ID = "120240624148610289";
const CLINICA = "22222222-2222-4222-8222-222222222222";
const TITULO = "Limpeza de pele com 30% de desconto";
const DESCRICAO_CURTA = "Agende sua avaliação gratuita.";
const DESCRICAO_LONGA =
  "Agende sua avaliação gratuita com a nossa equipe. Vagas limitadas para outubro.\nAtendemos de segunda a sábado, com estacionamento no local.\nFale com a gente!";
const LINK = "https://fb.me/abcXYZ";

const ANUNCIO_META: AnuncioDaMeta = {
  ad_id: AD_ID,
  campaign_id: "120240624148610001",
  campaign_name: "Botox Fortaleza Setembro",
  adset_id: "120240624148610002",
  adset_name: "Mulheres 30 a 45",
};
const META_LIDA: LeituraDoAnuncio = { estado: "lida", anuncio: ANUNCIO_META };

function detalhes(campos: Partial<Detalhes> = {}): LeituraDosDetalhes {
  return {
    estado: "lida",
    detalhes: {
      ad_id: AD_ID,
      titulo: TITULO,
      descricao: DESCRICAO_CURTA,
      link: LINK,
      ...campos,
    },
  };
}

const CAMPANHA: TextoDeAtribuicao = {
  texto: "Botox Fortaleza Setembro",
  tipo: "nome",
};
const CONJUNTO: TextoDeAtribuicao = { texto: "Mulheres 30 a 45", tipo: "nome" };

function bloco(
  leitura: LeituraDosDetalhes,
  extra: Partial<{
    campanha: TextoDeAtribuicao | null;
    conjunto: TextoDeAtribuicao | null;
    complementoDoErro: string;
    tela: TelaDosDetalhes;
  }> = {},
): string {
  return renderToStaticMarkup(
    <DetalhesDoAnuncio
      leitura={leitura}
      campanha={extra.campanha === undefined ? CAMPANHA : extra.campanha}
      conjunto={extra.conjunto === undefined ? CONJUNTO : extra.conjunto}
      complementoDoErro={extra.complementoDoErro}
      tela={extra.tela ?? "painel"}
    />,
  );
}

/** Todos os elementos da arvore (sem renderizar os componentes). */
function elementos(no: ReactNode): ReactElement[] {
  const achados: ReactElement[] = [];
  const visitar = (atual: ReactNode) => {
    if (Array.isArray(atual)) {
      atual.forEach(visitar);
      return;
    }
    if (!isValidElement(atual)) {
      return;
    }
    achados.push(atual);
    visitar((atual.props as { children?: ReactNode }).children);
  };
  visitar(no);
  return achados;
}

/** A regiao role="status" fixa do bloco, com o que estiver dentro. */
function regiaoDeStatus(html: string): string | null {
  return (
    /<div role="status" class="[^"]*">(.*?)<\/div><dl|<div role="status" class="[^"]*">(.*?)<\/div><\/section>|<div role="status" class="[^"]*">(.*?)<\/div><a /.exec(
      html,
    )?.slice(1).find((parte) => parte !== undefined) ?? null
  );
}

/** Texto sem tags, com os espacos normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("bloco Detalhes do anúncio", () => {
  it("com título e descrição: os dois, a campanha e o conjunto, sem a frase neutra", () => {
    const html = bloco(detalhes());
    const lido = texto(html);
    expect(lido).toContain("Detalhes do anúncio");
    expect(lido).toContain(`Título ${TITULO}`);
    expect(lido).toContain(`Descrição ${DESCRICAO_CURTA}`);
    expect(lido).toContain("Campanha Botox Fortaleza Setembro");
    expect(lido).toContain("Conjunto Mulheres 30 a 45");
    expect(lido).not.toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
    // Rotulo e valor em lista de definicao, para o leitor de tela.
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
  });

  it("descrição curta: sem Ver mais", () => {
    const html = bloco(detalhes());
    expect(html).not.toContain("Ver mais");
    expect(html).toContain("line-clamp-3");
  });

  it("descrição longa: corta em 3 linhas, com Ver mais de 40px reais", () => {
    const html = bloco(detalhes({ descricao: DESCRICAO_LONGA }));
    expect(html).toContain("line-clamp-3");
    expect(html).toContain("whitespace-pre-line");
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*>Ver mais<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*class="[^"]*min-h-10[^"]*"[^>]*>Ver mais/,
    );
    // O botao diz o que controla.
    const controla = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controla).toBeTruthy();
    expect(html).toContain(`id="${controla}"`);
    // O texto inteiro continua no HTML (o corte e so visual).
    expect(html).toContain("Fale com a gente!");
  });

  it("link do anúncio: Abrir anúncio em outra aba, sem referrer, com 40px", () => {
    const html = bloco(detalhes());
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/fb\.me\/abcXYZ"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
    expect(texto(html)).toContain("Abrir anúncio (abre em outra aba)");
    expect(html).toMatch(/<a[^>]*data-size="default"/);
  });

  it("link guardado que não passa na conferência (http, outro endereço): sem Abrir anúncio", () => {
    for (const link of ["http://fb.me/abc", "https://golpe.example.com/x"]) {
      const html = bloco(detalhes({ link }));
      expect(html).not.toContain("Abrir anúncio");
      expect(html).not.toContain("golpe.example.com");
    }
  });

  it("redirecionador, convite de grupo e conversa nunca viram Abrir anúncio", () => {
    for (const link of [
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://lm.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://l.instagram.com/?u=https%3A%2F%2Fgolpe.example%2F",
      "https://www.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://chat.whatsapp.com/ConviteDeGrupo123",
      "https://wa.me/5585999990000?text=Pague%20o%20sinal",
      "https://api.whatsapp.com/send?phone=5585999990000",
      "https://m.me/golpista",
      "https://ig.me/m/golpista",
      "https://www.messenger.com/t/golpista",
    ]) {
      const html = bloco(detalhes({ link }));
      expect(html, link).not.toContain("Abrir anúncio");
      expect(html, link).not.toContain("href=");
    }
    // O endereco do anuncio continua virando botao.
    expect(
      bloco(detalhes({ link: "https://www.instagram.com/p/abc/" })),
    ).toContain("Abrir anúncio");
  });

  it("só com o código (nada guardado): a frase neutra, com a campanha e o conjunto", () => {
    const lido = texto(bloco(LEITURA_SEM_DETALHES));
    expect(lido).toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
    expect(lido).toContain("Campanha Botox Fortaleza Setembro");
    expect(lido).not.toContain("Título");
    expect(lido).not.toContain("Abrir anúncio");
  });

  it("linha guardada só com o link: Abrir anúncio, sem a frase neutra", () => {
    const lido = texto(bloco(detalhes({ titulo: null, descricao: null })));
    expect(lido).toContain("Abrir anúncio");
    expect(lido).not.toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
    expect(lido).not.toContain("Título");
  });

  it("sem nada (nem detalhe, nem campanha, nem conjunto): só a frase", () => {
    const html = bloco(LEITURA_SEM_DETALHES, {
      campanha: null,
      conjunto: null,
    });
    expect(texto(html)).toBe(
      `Detalhes do anúncio ${TEXTO_SEM_DETALHES_DO_ANUNCIO}`,
    );
    expect(html).not.toContain("<dl");
  });

  it("carregando: esqueleto com o texto para o leitor de tela", () => {
    const html = bloco({ estado: "carregando" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Carregando os detalhes do anúncio");
    expect(html).not.toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
  });

  it("a mesma região role=status em todos os estados: o erro que chega depois é anunciado", () => {
    // Carregando, erro e sem detalhes ficam DENTRO da região fixa.
    expect(regiaoDeStatus(bloco({ estado: "carregando" }))).toContain(
      "Carregando os detalhes do anúncio",
    );
    expect(regiaoDeStatus(bloco({ estado: "erro" }))).toContain(
      "Não foi possível carregar os detalhes do anúncio.",
    );
    expect(regiaoDeStatus(bloco(LEITURA_SEM_DETALHES))).toContain(
      TEXTO_SEM_DETALHES_DO_ANUNCIO,
    );
    // Com os detalhes lidos a região continua lá, vazia e fora do fluxo.
    const lida = bloco(detalhes());
    expect(lida).toContain('<div role="status" class="sr-only"></div>');
    // Uma região só por bloco, no mesmo lugar (logo depois do título).
    for (const html of [
      bloco({ estado: "carregando" }),
      bloco({ estado: "erro" }),
      bloco(LEITURA_SEM_DETALHES),
      lida,
    ]) {
      expect(html).toMatch(
        /^<section[^>]*><h4[^>]*>Detalhes do anúncio<\/h4><div role="status"/,
      );
      expect(html.match(/<div role="status"/g)).toHaveLength(1);
    }
  });

  it("campanha e conjunto em erro também são anunciados (span role=status)", () => {
    const html = bloco(detalhes(), {
      campanha: { texto: "Não foi possível carregar a campanha", tipo: "erro" },
      conjunto: { texto: "Não foi possível carregar o conjunto", tipo: "erro" },
    });
    expect(html).toMatch(
      /<span role="status"[^>]*>Não foi possível carregar a campanha<\/span>/,
    );
    expect(html).toMatch(
      /<span role="status"[^>]*>Não foi possível carregar o conjunto<\/span>/,
    );
  });

  it("a chave da descrição muda com o anúncio e com o texto (o Ver mais aberto não passa adiante)", () => {
    const chaveDaDescricao = (leitura: LeituraDosDetalhes) =>
      elementos(
        montarBlocoDosDetalhes({
          leitura,
          campanha: null,
          conjunto: null,
          tela: "painel",
          idDoTitulo: "titulo",
        }),
      ).find(
        (elemento) =>
          typeof elemento.type === "function" &&
          elemento.type.name === "Descricao",
      )?.key;
    const doAnuncioA = chaveDaDescricao(detalhes({ descricao: DESCRICAO_LONGA }));
    const doAnuncioB = chaveDaDescricao({
      estado: "lida",
      detalhes: {
        ad_id: "120248355615910289",
        titulo: null,
        descricao: DESCRICAO_LONGA,
        link: null,
      },
    });
    const outroTexto = chaveDaDescricao(detalhes({ descricao: DESCRICAO_CURTA }));
    expect(doAnuncioA).toBeTruthy();
    expect(new Set([doAnuncioA, doAnuncioB, outroTexto]).size).toBe(3);
    // A mesma leitura, a mesma chave (o React nao remonta a toa).
    expect(chaveDaDescricao(detalhes({ descricao: DESCRICAO_LONGA }))).toBe(
      doAnuncioA,
    );
  });

  it("Ver mais pela largura da tela: a mesma descrição é longa no painel e cabe na ficha e na gaveta", () => {
    // ~125 caracteres num parágrafo: mais de 3 linhas no painel (texto de
    // 259px), 3 linhas na ficha (320px) e na gaveta (412px).
    const media = detalhes({
      descricao:
        "Agende sua avaliação gratuita com a nossa equipe de dermatologia. Vagas limitadas para outubro, com condições especiais.",
    });
    expect(bloco(media, { tela: "painel" })).toContain("Ver mais");
    expect(bloco(media, { tela: "ficha" })).not.toContain("Ver mais");
    expect(bloco(media, { tela: "gaveta" })).not.toContain("Ver mais");
  });

  it("erro: ícone, texto e cor de alerta; com o complemento da ficha", () => {
    const html = bloco({ estado: "erro" });
    expect(html).toContain("Não foi possível carregar os detalhes do anúncio.");
    expect(html).toContain("text-alert-text");
    expect(html).toMatch(/<svg[^>]*lucide-octagon-alert/);
    const daFicha = bloco(
      { estado: "erro" },
      { complementoDoErro: "Atualize a página para tentar de novo." },
    );
    expect(texto(daFicha)).toContain(
      "Não foi possível carregar os detalhes do anúncio. Atualize a página para tentar de novo.",
    );
  });

  it("texto do anúncio aparece como texto, nunca como HTML", () => {
    const html = bloco(
      detalhes({
        titulo: '<img src=x onerror="alert(1)">',
        descricao: "<script>alert(1)</script>",
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("nenhum travessão em nenhum estado", () => {
    for (const leitura of [
      detalhes(),
      detalhes({ descricao: DESCRICAO_LONGA }),
      LEITURA_SEM_DETALHES,
      { estado: "carregando" } as const,
      { estado: "erro" } as const,
    ]) {
      expect(bloco(leitura)).not.toMatch(/[\u{2013}\u{2014}]/u);
    }
  });
});

function contatoDoPainel(campos: Partial<ContactSummary> = {}): ContactSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clinic_id: CLINICA,
    name: "Paciente de Anúncio",
    phone_e164: "+5585999990000",
    kind: "lead",
    funnel_stage: "novo",
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_medium: "Instagram",
    source_method: "anuncio_ctwa",
    source_campaign: null,
    source_ad_id: AD_ID,
    first_contact_at: "2026-10-05T12:00:00.000Z",
    ...campos,
  };
}

function painel(
  contato: ContactSummary,
  leituraDosDetalhes: LeituraDosDetalhes,
  leitura: LeituraDoAnuncio = META_LIDA,
): string {
  return renderToStaticMarkup(
    <BlocoDeOrigem
      contact={contato}
      leitura={leitura}
      detalhes={leituraDosDetalhes}
      timezone={FUSO}
      aoTentarDeNovo={() => undefined}
    />,
  );
}

describe("painel do Atendimento, Origem com os detalhes do anúncio", () => {
  it("lead de anúncio: Canal, Método e Primeiro contato nas linhas; título, descrição, campanha e conjunto no bloco", () => {
    const lido = texto(painel(contatoDoPainel(), detalhes()));
    expect(lido).toContain("Tráfego pago, Meta (Instagram)");
    expect(lido).toContain("Anúncio de clique para WhatsApp");
    expect(lido).toContain(TITULO);
    expect(lido).toContain(DESCRICAO_CURTA);
    // Campanha e conjunto vem dentro do bloco, depois do titulo.
    expect(lido.indexOf("Detalhes do anúncio")).toBeLessThan(
      lido.indexOf("Botox Fortaleza Setembro"),
    );
    expect(lido.indexOf("Detalhes do anúncio")).toBeGreaterThan(
      lido.indexOf("Primeiro contato"),
    );
    expect(lido.match(/Botox Fortaleza Setembro/g)).toHaveLength(1);
  });

  it("só com o código: a frase neutra (os detalhes ainda não estão disponíveis)", () => {
    const lido = texto(
      painel(contatoDoPainel(), { estado: "lida", detalhes: null }),
    );
    expect(lido).toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
    expect(lido).toContain(
      "Os detalhes deste anúncio ainda não estão disponíveis.",
    );
    expect(lido).not.toContain("não vieram na mensagem");
  });

  it("o bloco tem a chave do contato: o painel continua ao trocar de conversa, o estado do bloco não", () => {
    const contato = contatoDoPainel();
    const arvore = BlocoDeOrigem({
      contact: contato,
      leitura: META_LIDA,
      detalhes: detalhes(),
      timezone: FUSO,
      aoTentarDeNovo: () => undefined,
    });
    const doBloco = elementos(arvore).find(
      (elemento) => elemento.type === DetalhesDoAnuncio,
    );
    expect(doBloco?.key).toBe(contato.id);
  });

  it("chegou por link e depois tocou num anúncio: a campanha do link nas linhas, a da Meta no bloco", () => {
    const lido = texto(
      painel(
        contatoDoPainel({
          source_channel: "redes_sociais",
          source_origin: null,
          source_medium: null,
          source_method: "link_token",
          source_campaign: "Botox Outubro (link da bio)",
        }),
        detalhes(),
      ),
    );
    const [linhas, doBloco] = lido.split("Detalhes do anúncio");
    expect(linhas).toContain("Campanha Botox Outubro (link da bio)");
    expect(doBloco).toContain("Campanha Botox Fortaleza Setembro");
    expect(doBloco).toContain("Conjunto Mulheres 30 a 45");
    expect(doBloco).not.toContain("Botox Outubro (link da bio)");
  });

  it("clique no site (Google) e depois um anúncio da Meta: a campanha do Google nas linhas, a da Meta no bloco", () => {
    const lido = texto(
      painel(
        contatoDoPainel({
          source_channel: "trafego_pago",
          source_origin: "Google",
          source_medium: null,
          source_method: "clique_site",
          source_google_campaign_id: "21456789012",
        }),
        detalhes(),
      ),
    );
    const [linhas, doBloco] = lido.split("Detalhes do anúncio");
    expect(linhas).toContain("Campanha Campanha do Google 21456789012");
    expect(doBloco).toContain("Campanha Botox Fortaleza Setembro");
    expect(doBloco).not.toContain("Google");
  });

  it("erro na campanha da Meta (no bloco): o Tentar de novo aparece", () => {
    const lido = texto(
      painel(
        contatoDoPainel({
          source_method: "link_token",
          source_channel: "redes_sociais",
          source_origin: null,
          source_campaign: "Botox Outubro",
        }),
        detalhes(),
        { estado: "erro" },
      ),
    );
    expect(lido).toContain("Não foi possível carregar a campanha");
    expect(lido).toContain("Tentar de novo");
  });

  it("lead de anúncio sem o código (só o clique): a frase neutra, e a campanha não informada", () => {
    const lido = texto(
      painel(contatoDoPainel({ source_ad_id: null }), LEITURA_SEM_DETALHES, {
        estado: "lida",
        anuncio: null,
      }),
    );
    expect(lido).toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
    expect(lido).toContain("Campanha da Meta não informada");
  });

  it("erro nos detalhes: o aviso no bloco e o Tentar de novo", () => {
    const lido = texto(painel(contatoDoPainel(), { estado: "erro" }));
    expect(lido).toContain("Não foi possível carregar os detalhes do anúncio.");
    expect(lido).toContain("Tentar de novo");
  });

  it("contato que não veio de anúncio: sem o bloco, a Campanha nas linhas como antes", () => {
    const lido = texto(
      painel(
        contatoDoPainel({
          source_channel: "redes_sociais",
          source_origin: null,
          source_medium: null,
          source_method: "link_token",
          source_campaign: "Botox Outubro",
          source_ad_id: null,
        }),
        LEITURA_SEM_DETALHES,
        { estado: "lida", anuncio: null },
      ),
    );
    expect(lido).not.toContain("Detalhes do anúncio");
    expect(lido).toContain("Campanha Botox Outubro");
  });
});

function contatoDaFicha(campos: Partial<ContatoDaFicha> = {}): ContatoDaFicha {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clinic_id: CLINICA,
    name: "Paciente de Anúncio",
    phone_e164: "+5585999990000",
    cpf: null,
    email: null,
    birth_date: null,
    insurance_card: null,
    notes: null,
    kind: "paciente",
    tags: [],
    no_show_count: 0,
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_medium: "Instagram",
    source_campaign: null,
    source_captured_at: "2026-10-05T15:00:00.000Z",
    source_method: "anuncio_ctwa",
    source_ad_id: AD_ID,
    source_google_campaign_id: null,
    anuncio_meta: META_LIDA,
    anuncio_whatsapp: detalhes({ descricao: DESCRICAO_LONGA }),
    first_contact_at: "2026-10-05T15:00:00.000Z",
    last_contact_at: null,
    created_at: "2026-10-05T15:00:00.000Z",
    insurance: null,
    ...campos,
  };
}

describe("ficha do paciente (e do lead), Origem com os detalhes do anúncio", () => {
  it("HTML do servidor: a descrição que cabe em 3 linhas na ficha sai sem Ver mais (nada some na hidratação)", () => {
    // O caso da revisão: ~125 caracteres num parágrafo. A ficha é a única
    // tela renderizada no servidor; o Ver mais do HTML sumia ao hidratar.
    const html = renderToStaticMarkup(
      <OrigemPaciente
        contato={contatoDaFicha({
          anuncio_whatsapp: detalhes({
            descricao:
              "Agende sua avaliação gratuita com a nossa equipe de dermatologia. Vagas limitadas para outubro, com condições especiais.",
          }),
        })}
        timezone={FUSO}
      />,
    );
    expect(html).not.toContain("Ver mais");
    expect(html).toContain("line-clamp-3");
  });

  it("chegou por link e depois tocou num anúncio: a campanha do link nas linhas da ficha, a da Meta no bloco", () => {
    const lido = texto(
      renderToStaticMarkup(
        <OrigemPaciente
          contato={contatoDaFicha({
            source_channel: "redes_sociais",
            source_origin: null,
            source_medium: null,
            source_method: "link_token",
            source_campaign: "Botox Outubro (link da bio)",
          })}
          timezone={FUSO}
        />,
      ),
    );
    const [linhas, doBloco] = lido.split("Detalhes do anúncio");
    expect(linhas).toContain("Campanha Botox Outubro (link da bio)");
    expect(doBloco).toContain("Campanha Botox Fortaleza Setembro");
    expect(doBloco).toContain("Conjunto Mulheres 30 a 45");
    expect(doBloco).not.toContain("Botox Outubro (link da bio)");
  });

  it("título, descrição longa com Ver mais, Abrir anúncio, campanha e conjunto no cartão Origem", () => {
    const html = renderToStaticMarkup(
      <OrigemPaciente contato={contatoDaFicha()} timezone={FUSO} />,
    );
    const lido = texto(html);
    expect(lido).toContain("Tráfego pago, Meta (Instagram)");
    expect(lido).toContain(TITULO);
    expect(lido).toContain("Ver mais");
    expect(lido).toContain("Abrir anúncio");
    expect(lido).toContain("Botox Fortaleza Setembro");
    expect(lido).toContain("Mulheres 30 a 45");
    // h2 do cartao, h3 do bloco.
    expect(html).toMatch(/<h3[^>]*>Detalhes do anúncio<\/h3>/);
  });

  it("só com o código: a frase neutra; erro na leitura: manda atualizar a página", () => {
    const sem = texto(
      renderToStaticMarkup(
        <OrigemPaciente
          contato={contatoDaFicha({ anuncio_whatsapp: LEITURA_SEM_DETALHES })}
          timezone={FUSO}
        />,
      ),
    );
    expect(sem).toContain(TEXTO_SEM_DETALHES_DO_ANUNCIO);
    const erro = texto(
      renderToStaticMarkup(
        <OrigemPaciente
          contato={contatoDaFicha({ anuncio_whatsapp: { estado: "erro" } })}
          timezone={FUSO}
        />,
      ),
    );
    expect(erro).toContain(
      "Não foi possível carregar os detalhes do anúncio. Atualize a página para tentar de novo.",
    );
  });
});

// ---------------------------------------------------------------------------
// Das consultas as telas: a leitura de anuncio_do_whatsapp pela sessao
// ---------------------------------------------------------------------------

type Pedido = { tabela: string; select: string; filtros: [string, unknown][] };

/**
 * Cliente falso: devolve, por tabela, as linhas dadas (ou o erro dado) e
 * anota o que foi pedido. Encadeia os metodos que as consultas usam.
 */
function clienteFalso(
  respostas: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >,
  pedidos: Pedido[] = [],
): SupabaseClient {
  return {
    from(tabela: string) {
      const pedido: Pedido = { tabela, select: "", filtros: [] };
      pedidos.push(pedido);
      let unica = false;
      const consulta = {
        select(colunas: string) {
          pedido.select = colunas;
          return consulta;
        },
        eq(coluna: string, valor: unknown) {
          pedido.filtros.push([coluna, valor]);
          return consulta;
        },
        in(coluna: string, valor: unknown) {
          pedido.filtros.push([coluna, valor]);
          return consulta;
        },
        neq: () => consulta,
        order: () => consulta,
        limit: () => consulta,
        maybeSingle() {
          unica = true;
          return consulta;
        },
        then(
          resolver: (valor: { data: unknown; error: unknown }) => unknown,
          rejeitar?: (motivo: unknown) => unknown,
        ) {
          const resposta = respostas[tabela] ?? {
            data: unica ? null : [],
            error: null,
          };
          return Promise.resolve(resposta).then(resolver, rejeitar);
        },
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

const LINHA_GUARDADA = {
  ad_id: AD_ID,
  titulo: TITULO,
  descricao: DESCRICAO_CURTA,
  link: LINK,
};

describe("lerDetalhesDoAnuncio", () => {
  it("lê a linha do anúncio da clínica pedida", async () => {
    const pedidos: Pedido[] = [];
    const leitura = await lerDetalhesDoAnuncio(
      clienteFalso(
        { anuncio_do_whatsapp: { data: [LINHA_GUARDADA], error: null } },
        pedidos,
      ),
      CLINICA,
      ` ${AD_ID} `,
    );
    expect(leitura).toEqual({ estado: "lida", detalhes: LINHA_GUARDADA });
    expect(pedidos).toEqual([
      {
        tabela: "anuncio_do_whatsapp",
        select: "ad_id, titulo, descricao, link",
        filtros: [
          ["clinic_id", CLINICA],
          ["ad_id", [AD_ID]],
        ],
      },
    ]);
  });

  it("sem linha: lida sem detalhes; erro: estado de erro, sem lançar", async () => {
    expect(
      await lerDetalhesDoAnuncio(
        clienteFalso({ anuncio_do_whatsapp: { data: [], error: null } }),
        CLINICA,
        AD_ID,
      ),
    ).toEqual({ estado: "lida", detalhes: null });
    expect(
      await lerDetalhesDoAnuncio(
        clienteFalso({
          anuncio_do_whatsapp: {
            data: null,
            error: { message: "relation does not exist" },
          },
        }),
        CLINICA,
        AD_ID,
      ),
    ).toEqual({ estado: "erro" });
  });

  it("id fora do formato: nem consulta", async () => {
    const pedidos: Pedido[] = [];
    expect(
      await lerDetalhesDoAnuncio(clienteFalso({}, pedidos), CLINICA, "abc"),
    ).toEqual(LEITURA_SEM_DETALHES);
    expect(
      await lerDetalhesDoAnuncio(clienteFalso({}, pedidos), CLINICA, null),
    ).toEqual(LEITURA_SEM_DETALHES);
    expect(pedidos).toEqual([]);
  });
});

describe("gaveta de Leads: o detalhe da action traz os detalhes do anúncio", () => {
  it("fetchLeadDetalhe lê anuncio_do_whatsapp pelo id do anúncio do contato", async () => {
    const detalhe = await fetchLeadDetalhe(
      clienteFalso({
        contact: {
          data: { id: "c1", source_campaign: null, source_ad_id: AD_ID },
          error: null,
        },
        anuncio_do_whatsapp: { data: [LINHA_GUARDADA], error: null },
      }),
      CLINICA,
      "c1",
    );
    expect(detalhe?.anuncio_whatsapp).toEqual({
      estado: "lida",
      detalhes: LINHA_GUARDADA,
    });
  });

  it("falha só na leitura dos detalhes não derruba o detalhe da gaveta", async () => {
    const detalhe = await fetchLeadDetalhe(
      clienteFalso({
        contact: {
          data: { id: "c1", source_campaign: null, source_ad_id: AD_ID },
          error: null,
        },
        anuncio_do_whatsapp: { data: null, error: { message: "timeout" } },
      }),
      CLINICA,
      "c1",
    );
    expect(detalhe).not.toBeNull();
    expect(detalhe?.anuncio_whatsapp).toEqual({ estado: "erro" });
  });
});
