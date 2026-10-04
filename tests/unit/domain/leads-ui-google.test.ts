import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  CAMPANHA_DO_GOOGLE_SEM_ID,
  CAMPANHA_SEM_ANUNCIO,
  campanhaDoContato,
  conjuntoDoContato,
  ehLeadDeAnuncio,
  ehLeadDoCliqueNoSite,
  idDeCampanhaDoGoogle,
  LEITURA_SEM_ANUNCIO,
  METODO_CLIQUE_SITE,
  METODO_LABELS,
  rotuloDaCampanhaDoGoogle,
  rotuloDoMetodo,
  textoDaOrigem,
  type LeituraDoAnuncio,
  type OrigemDoContato,
} from "@/lib/domain/leads-ui";
import { fetchConversations } from "@/lib/queries/conversations";
import { fetchLead, type LeadResumo } from "@/lib/queries/leads";
import { fetchFichaPaciente } from "@/lib/queries/pacientes";
import {
  mesclarLinhaNoLead,
  type ContactRow,
} from "@/lib/realtime/use-leads-channel";

// Clique rastreado pelo site (F1 do Google, migration 20261005100000): o
// lead que veio de anuncio do Google pelo botao de WhatsApp do site. O banco
// grava canal trafego_pago, origem 'Google', meio e source_campaign nulos,
// metodo clique_site e o id da campanha em source_google_campaign_id (check
// contact_origem_do_clique_do_site_coerente). As telas mostram "Tráfego
// pago, Google", "Clique no site" e "Campanha do Google {id}" (o nome so
// chega na F2). O Google nunca grava source_ad_id: o lead do Google nao e
// "lead de anuncio" da Meta.

const CAMPANHA_DO_GOOGLE = "21987654321";

/** Lead do clique no site como casar_clique_do_site grava. */
function leadDoGoogle(campos: Partial<OrigemDoContato> = {}): OrigemDoContato {
  return {
    source_channel: "trafego_pago",
    source_origin: "Google",
    source_medium: null,
    source_method: "clique_site",
    source_campaign: null,
    source_ad_id: null,
    source_google_campaign_id: CAMPANHA_DO_GOOGLE,
    ...campos,
  };
}

const LEITURAS: LeituraDoAnuncio[] = [
  LEITURA_SEM_ANUNCIO,
  { estado: "carregando" },
  { estado: "erro" },
];

describe("origem do lead do Google", () => {
  it('canal e origem viram "Tráfego pago, Google"', () => {
    expect(textoDaOrigem(leadDoGoogle())).toBe("Tráfego pago, Google");
  });

  it('o método clique_site vira "Clique no site"', () => {
    expect(METODO_CLIQUE_SITE).toBe("clique_site");
    expect(rotuloDoMetodo("clique_site")).toBe("Clique no site");
    expect(METODO_LABELS.clique_site).toBe("Clique no site");
  });

  it("todo método do check do banco (com clique_site) tem rótulo humano", () => {
    // O check vigente vem da migration do clique do site.
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261005100000_clique_do_site.sql",
      ),
      "utf-8",
    );
    const bloco =
      /add constraint contact_source_method_valido check \(([\s\S]*?)\)\s*\),/.exec(
        sql,
      )?.[1];
    expect(bloco, "check contact_source_method_valido").toBeDefined();
    const metodos = [...(bloco ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (casamento) => casamento[1] ?? "",
    );
    expect(metodos).toContain("clique_site");
    expect(metodos).toContain("anuncio_ctwa");
    for (const metodo of metodos) {
      const rotulo = rotuloDoMetodo(metodo);
      expect(rotulo, metodo).toBe(METODO_LABELS[metodo]);
      expect(rotulo).not.toContain("_");
    }
  });
});

describe("campanha do lead do Google", () => {
  it('com o id: "Campanha do Google {id}", em qualquer leitura da Meta', () => {
    for (const leitura of LEITURAS) {
      expect(campanhaDoContato(leadDoGoogle(), leitura)).toEqual({
        texto: `Campanha do Google ${CAMPANHA_DO_GOOGLE}`,
        tipo: "nome",
      });
    }
    expect(rotuloDaCampanhaDoGoogle("123")).toBe("Campanha do Google 123");
  });

  it("sem o id (o clique chegou sem o número da campanha): não informada, nunca a frase da Meta", () => {
    for (const contato of [
      leadDoGoogle({ source_google_campaign_id: null }),
      leadDoGoogle({ source_google_campaign_id: undefined }),
      leadDoGoogle({ source_google_campaign_id: "  " }),
    ]) {
      const campanha = campanhaDoContato(contato, LEITURA_SEM_ANUNCIO);
      expect(campanha).toEqual({
        texto: CAMPANHA_DO_GOOGLE_SEM_ID,
        tipo: "nenhuma",
      });
      expect(campanha.texto).not.toBe(CAMPANHA_SEM_ANUNCIO);
    }
    expect(CAMPANHA_DO_GOOGLE_SEM_ID).toBe("Campanha do Google não informada");
  });

  it("id fora do formato do banco não aparece", () => {
    expect(idDeCampanhaDoGoogle("abc")).toBeNull();
    expect(idDeCampanhaDoGoogle("1".repeat(21))).toBeNull();
    expect(idDeCampanhaDoGoogle(" 123 ")).toBe("123");
    expect(
      campanhaDoContato(
        leadDoGoogle({ source_google_campaign_id: "<b>1</b>" }),
        LEITURA_SEM_ANUNCIO,
      ).texto,
    ).toBe(CAMPANHA_DO_GOOGLE_SEM_ID);
  });

  it("o id do Google só vale com o método clique_site (o check do banco garante)", () => {
    // Contato de outra origem com o campo preenchido por engano: a regra de
    // sempre (aqui, sem campanha), nunca uma campanha do Google inventada.
    const manual: OrigemDoContato = {
      source_channel: "indicacao",
      source_campaign: null,
      source_method: "manual",
      source_google_campaign_id: CAMPANHA_DO_GOOGLE,
    };
    expect(campanhaDoContato(manual, LEITURA_SEM_ANUNCIO)).toEqual({
      texto: "Sem campanha",
      tipo: "nenhuma",
    });
  });
});

describe("o lead do Google não é lead de anúncio da Meta", () => {
  it("ehLeadDeAnuncio fica falso e o conjunto some", () => {
    expect(ehLeadDoCliqueNoSite(leadDoGoogle())).toBe(true);
    expect(ehLeadDeAnuncio(leadDoGoogle())).toBe(false);
    expect(conjuntoDoContato(leadDoGoogle(), LEITURA_SEM_ANUNCIO)).toBeNull();
  });

  it("o lead da Meta continua com as regras dele", () => {
    const daMeta: OrigemDoContato = {
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_campaign: null,
      source_ad_id: null,
    };
    expect(ehLeadDoCliqueNoSite(daMeta)).toBe(false);
    expect(campanhaDoContato(daMeta, LEITURA_SEM_ANUNCIO).texto).toBe(
      CAMPANHA_SEM_ANUNCIO,
    );
  });

  it("nenhum texto do Google tem travessão", () => {
    const textos = [
      textoDaOrigem(leadDoGoogle()),
      rotuloDoMetodo("clique_site"),
      campanhaDoContato(leadDoGoogle(), LEITURA_SEM_ANUNCIO).texto,
      CAMPANHA_DO_GOOGLE_SEM_ID,
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});

// ---------------------------------------------------------------------------
// Das consultas as telas (achado da revisao da F1): o id gravado pelo
// casamento precisa CHEGAR na tela. As consultas da lista de Leads, da ficha
// e do Atendimento leem a coluna, e o tempo real a leva para a lista aberta.
// O cliente falso devolve SO as colunas pedidas no select, como o PostgREST:
// consulta que esquecer a coluna devolve o lead sem ela e o teste reprova.
// ---------------------------------------------------------------------------

const CONTATO_ID = "44444444-4444-4444-8444-444444444444";
const CLINICA_ID = "55555555-5555-4555-8555-555555555555";

/** O contato como o banco guarda depois de casar_clique_do_site. */
const LINHA_DO_BANCO: Record<string, unknown> = {
  id: CONTATO_ID,
  clinic_id: CLINICA_ID,
  name: "Lead do Google",
  phone_e164: "+5584999990000",
  cpf: null,
  email: null,
  birth_date: null,
  insurance_card: null,
  notes: null,
  kind: "lead",
  funnel_stage: "novo",
  lost_reason: null,
  lost_reason_note: null,
  owner_user_id: null,
  tags: [],
  no_show_count: 0,
  source_channel: "trafego_pago",
  source_origin: "Google",
  source_medium: null,
  source_campaign: null,
  source_captured_at: "2026-10-04T15:00:00.000Z",
  source_method: "clique_site",
  source_ad_id: null,
  source_google_campaign_id: CAMPANHA_DO_GOOGLE,
  source_google_adgroup_id: "1234567",
  first_contact_at: "2026-10-04T15:00:00.000Z",
  last_contact_at: "2026-10-04T15:00:00.000Z",
  created_at: "2026-10-04T15:00:00.000Z",
  insurance: null,
  contact_consent: [],
};

/** Divide a lista do select no nivel de cima (virgula fora de parenteses). */
function itensDoSelect(colunas: string): string[] {
  const itens: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const letra of colunas) {
    if (letra === "(") nivel += 1;
    if (letra === ")") nivel -= 1;
    if (letra === "," && nivel === 0) {
      itens.push(atual.trim());
      atual = "";
    } else {
      atual += letra;
    }
  }
  if (atual.trim()) itens.push(atual.trim());
  return itens;
}

/** A linha so com as colunas pedidas (embeds recortados pelo de dentro). */
function recortar(
  linha: Record<string, unknown>,
  colunas: string,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const item of itensDoSelect(colunas)) {
    const embed = /^([a-z_]+)(?::[a-z_]+)?\s*\(([\s\S]*)\)$/.exec(item);
    if (embed) {
      const [, nome = "", dentro = ""] = embed;
      const valor = linha[nome];
      saida[nome] =
        valor && typeof valor === "object" && !Array.isArray(valor)
          ? recortar(valor as Record<string, unknown>, dentro)
          : valor;
      continue;
    }
    if (item in linha) {
      saida[item] = linha[item];
    }
  }
  return saida;
}

/**
 * Cliente falso: toda consulta encadeia e, no await, devolve a linha da
 * tabela recortada pelo select. O que a tabela devolve vem de `linhas`.
 */
function clienteFalso(
  linhas: Record<string, { lista: boolean; linha: Record<string, unknown> }>,
): SupabaseClient {
  return {
    from(tabela: string) {
      let colunas = "*";
      let unica = false;
      const consulta = {
        select(pedido: string) {
          colunas = pedido;
          return consulta;
        },
        eq: () => consulta,
        neq: () => consulta,
        in: () => consulta,
        order: () => consulta,
        limit: () => consulta,
        maybeSingle() {
          unica = true;
          return consulta;
        },
        then(
          resolver: (valor: { data: unknown; error: null }) => unknown,
          rejeitar?: (motivo: unknown) => unknown,
        ) {
          const fonte = linhas[tabela];
          let data: unknown = unica ? null : [];
          if (fonte) {
            const recortada = recortar(fonte.linha, colunas);
            data = unica || !fonte.lista ? recortada : [recortada];
          }
          return Promise.resolve({ data, error: null }).then(
            resolver,
            rejeitar,
          );
        },
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

const TEXTO_DA_CAMPANHA = `Campanha do Google ${CAMPANHA_DO_GOOGLE}`;

describe("das consultas às telas: a campanha do Google chega", () => {
  it("lista de Leads e drawer (fetchLead): a coluna vem e vira Campanha do Google {id}", async () => {
    const lead = await fetchLead(
      clienteFalso({ contact: { lista: false, linha: LINHA_DO_BANCO } }),
      CLINICA_ID,
      CONTATO_ID,
    );
    expect(lead?.source_google_campaign_id).toBe(CAMPANHA_DO_GOOGLE);
    expect(campanhaDoContato(lead!, lead!.anuncio_meta).texto).toBe(
      TEXTO_DA_CAMPANHA,
    );
  });

  it("ficha do paciente (fetchFichaPaciente): a coluna vem e vira Campanha do Google {id}", async () => {
    const ficha = await fetchFichaPaciente(
      clienteFalso({ contact: { lista: false, linha: LINHA_DO_BANCO } }),
      CLINICA_ID,
      CONTATO_ID,
    );
    expect(ficha?.contato.source_google_campaign_id).toBe(CAMPANHA_DO_GOOGLE);
    expect(
      campanhaDoContato(ficha!.contato, ficha!.contato.anuncio_meta).texto,
    ).toBe(TEXTO_DA_CAMPANHA);
  });

  it("painel do Atendimento (fetchConversations): o contato da conversa traz a coluna", async () => {
    const [conversa] = await fetchConversations(
      clienteFalso({
        conversation: {
          lista: true,
          linha: {
            id: "66666666-6666-4666-8666-666666666666",
            status: "aberta",
            contact: LINHA_DO_BANCO,
          },
        },
      }),
      CLINICA_ID,
    );
    expect(conversa?.contact.source_google_campaign_id).toBe(
      CAMPANHA_DO_GOOGLE,
    );
    expect(
      campanhaDoContato(conversa!.contact, LEITURA_SEM_ANUNCIO).texto,
    ).toBe(TEXTO_DA_CAMPANHA);
  });

  it("tempo real: o UPDATE do casamento leva a campanha para a lista aberta", () => {
    // O contato nasceu sem origem (a ingestao cria antes de casar) e o
    // casamento grava a origem por UPDATE, com source_ad_id nulo como antes.
    const antes: LeadResumo = {
      id: CONTATO_ID,
      name: "Lead do Google",
      phone_e164: "+5584999990000",
      funnel_stage: "novo",
      lost_reason: null,
      lost_reason_note: null,
      owner_user_id: null,
      tags: [],
      source_channel: null,
      source_campaign: null,
      source_origin: null,
      source_medium: null,
      source_method: null,
      source_ad_id: null,
      source_google_campaign_id: null,
      first_contact_at: "2026-10-04T15:00:00.000Z",
      last_contact_at: "2026-10-04T15:00:00.000Z",
      insurance: { id: "c1", name: "Convênio" },
      consent_ativo: true,
      anuncio_meta: LEITURA_SEM_ANUNCIO,
    };
    const linhaNova: ContactRow = {
      id: CONTATO_ID,
      name: "Lead do Google",
      phone_e164: "+5584999990000",
      funnel_stage: "novo",
      lost_reason: null,
      lost_reason_note: null,
      owner_user_id: null,
      tags: [],
      source_channel: "trafego_pago",
      source_campaign: null,
      source_origin: "Google",
      source_medium: null,
      source_method: "clique_site",
      source_ad_id: null,
      source_google_campaign_id: "123",
      first_contact_at: "2026-10-04T15:00:00.000Z",
      last_contact_at: "2026-10-04T15:00:00.000Z",
    };
    const depois = mesclarLinhaNoLead(antes, linhaNova);
    expect(textoDaOrigem(depois)).toBe("Tráfego pago, Google");
    expect(rotuloDoMetodo(depois.source_method)).toBe("Clique no site");
    expect(campanhaDoContato(depois, depois.anuncio_meta).texto).toBe(
      "Campanha do Google 123",
    );
    // O que o payload nao traz continua o da lista.
    expect(depois.insurance).toEqual({ id: "c1", name: "Convênio" });
    expect(depois.consent_ativo).toBe(true);
  });
});
