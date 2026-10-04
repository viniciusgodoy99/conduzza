import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O painel importa as acoes das secoes vizinhas (Server Actions); aqui so o
// bloco Origem importa.
vi.mock("@/app/(app)/leads/actions", () => ({
  mudarEtapaAction: vi.fn(),
}));
vi.mock("@/app/(app)/atendimento/actions", () => ({
  etiquetarConversaAction: vi.fn(),
}));
vi.mock("@/app/(app)/atividades/actions", () => ({
  atividadesDoContatoAction: vi.fn(),
}));

import { BlocoDeOrigem } from "@/components/atendimento/context-panel";
import { ListaLeads } from "@/components/leads/lista-leads";
import { OrigemPaciente } from "@/components/pacientes/origem-paciente";
import type { AnuncioDaMeta, LeituraDoAnuncio } from "@/lib/domain/leads-ui";
import type { ContactSummary } from "@/lib/queries/conversations";
import type { LeadResumo } from "@/lib/queries/leads";
import type { ContatoDaFicha } from "@/lib/queries/pacientes";

// Origem real do anuncio (frente E, 04/10/2026), nas tres telas que mostram
// a origem do contato: o painel do Atendimento (que mostrava trafego_pago
// cru), a ficha do paciente e a lista de Leads. Canal, origem e plataforma
// numa frase, campanha e conjunto da Meta pelo id do anuncio, o metodo em
// linguagem de recepcao e os estados de carregando, erro e "ainda nao
// identificada".

const FUSO = "America/Fortaleza";
const AD_ID = "120240624148610289";
const ANUNCIO: AnuncioDaMeta = {
  ad_id: AD_ID,
  campaign_id: "120240624148610001",
  campaign_name: "Botox Fortaleza Setembro",
  adset_id: "120240624148610002",
  adset_name: "Mulheres 30 a 45",
};
const LIDA: LeituraDoAnuncio = { estado: "lida", anuncio: ANUNCIO };

function contatoDoPainel(campos: Partial<ContactSummary> = {}): ContactSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clinic_id: "22222222-2222-4222-8222-222222222222",
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
    first_contact_at: "2026-10-04T12:00:00.000Z",
    ...campos,
  };
}

function painel(
  contato: ContactSummary,
  leitura: LeituraDoAnuncio = LIDA,
): string {
  return renderToStaticMarkup(
    <BlocoDeOrigem
      contact={contato}
      leitura={leitura}
      timezone={FUSO}
      aoTentarDeNovo={() => undefined}
    />,
  );
}

describe("painel do Atendimento, bloco Origem", () => {
  it("mostra Tráfego pago com origem e plataforma, nunca trafego_pago cru", () => {
    const html = painel(contatoDoPainel());
    expect(html).toContain("Tráfego pago, Meta (Instagram)");
    expect(html).not.toContain("trafego_pago");
    expect(html).not.toContain("anuncio_ctwa");
  });

  it("campanha e conjunto da Meta, e o método de captura", () => {
    const html = painel(contatoDoPainel());
    expect(html).toContain("Campanha");
    expect(html).toContain("Botox Fortaleza Setembro");
    expect(html).toContain("Conjunto");
    expect(html).toContain("Mulheres 30 a 45");
    expect(html).toContain("Método");
    expect(html).toContain("Anúncio de clique para WhatsApp");
  });

  it("canal de origem manual sai pelo rótulo humano (o bug do valor cru)", () => {
    const html = painel(
      contatoDoPainel({
        source_channel: "doctoralia_diretorios",
        source_origin: null,
        source_medium: null,
        source_method: "manual",
        source_ad_id: null,
      }),
    );
    expect(html).toContain("Doctoralia e diretórios");
    expect(html).not.toContain("doctoralia_diretorios");
    expect(html).toContain("Cadastro manual");
    // Sem anúncio: sem linha de Conjunto e sem "Sem campanha".
    expect(html).not.toContain("Conjunto");
    expect(html).not.toContain("Sem campanha");
  });

  it("anúncio ainda sem linha na Meta: Campanha da Meta ainda não identificada", () => {
    const html = painel(contatoDoPainel(), { estado: "lida", anuncio: null });
    expect(html).toContain("Campanha da Meta ainda não identificada");
    expect(html).toContain("Conjunto ainda não identificado");
  });

  it("carregando: esqueleto com o texto para o leitor de tela", () => {
    const html = painel(contatoDoPainel(), { estado: "carregando" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Carregando a campanha");
  });

  it("erro: diz que não carregou e oferece Tentar de novo", () => {
    const html = painel(contatoDoPainel(), { estado: "erro" });
    expect(html).toContain("Não foi possível carregar a campanha");
    expect(html).toContain("Tentar de novo");
  });

  it("sem origem nenhuma: o aviso de origem não identificada", () => {
    const html = painel(
      contatoDoPainel({
        source_channel: null,
        source_origin: null,
        source_medium: null,
        source_method: null,
        source_ad_id: null,
      }),
    );
    expect(html).toContain("Origem ainda não identificada");
    expect(html).toContain("anúncio de clique para WhatsApp");
  });

  it("nenhum travessão no bloco", () => {
    for (const leitura of [
      LIDA,
      { estado: "lida", anuncio: null } as const,
      { estado: "erro" } as const,
      { estado: "carregando" } as const,
    ]) {
      expect(painel(contatoDoPainel(), leitura)).not.toMatch(/[—–]/);
    }
  });
});

function contatoDaFicha(campos: Partial<ContatoDaFicha> = {}): ContatoDaFicha {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clinic_id: "22222222-2222-4222-8222-222222222222",
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
    source_medium: null,
    source_campaign: null,
    source_captured_at: "2026-10-01T15:00:00.000Z",
    source_method: "anuncio_ctwa",
    source_ad_id: AD_ID,
    anuncio_meta: LIDA,
    first_contact_at: "2026-10-01T15:00:00.000Z",
    last_contact_at: null,
    created_at: "2026-10-01T15:00:00.000Z",
    insurance: null,
    ...campos,
  };
}

describe("ficha do paciente, bloco Origem", () => {
  it("os 8 corrigidos (sem plataforma): Tráfego pago, Meta, com campanha e conjunto da Meta", () => {
    const html = renderToStaticMarkup(
      <OrigemPaciente contato={contatoDaFicha()} timezone={FUSO} />,
    );
    expect(html).toContain("Tráfego pago, Meta");
    expect(html).not.toContain("(Instagram)");
    expect(html).not.toContain("trafego_pago");
    expect(html).toContain("Botox Fortaleza Setembro");
    expect(html).toContain("Mulheres 30 a 45");
    expect(html).toContain("Anúncio de clique para WhatsApp");
    expect(html).toContain("01/10/2026");
  });

  it("sem linha na Meta: ainda não identificada; erro manda atualizar a página", () => {
    const pendente = renderToStaticMarkup(
      <OrigemPaciente
        contato={contatoDaFicha({
          anuncio_meta: { estado: "lida", anuncio: null },
        })}
        timezone={FUSO}
      />,
    );
    expect(pendente).toContain("Campanha da Meta ainda não identificada");
    const erro = renderToStaticMarkup(
      <OrigemPaciente
        contato={contatoDaFicha({ anuncio_meta: { estado: "erro" } })}
        timezone={FUSO}
      />,
    );
    expect(erro).toContain(
      "Não foi possível carregar a campanha. Atualize a página para tentar de novo.",
    );
  });

  it("paciente sem origem: Não informado, Sem campanha, sem Conjunto nem Método", () => {
    const html = renderToStaticMarkup(
      <OrigemPaciente
        contato={contatoDaFicha({
          source_channel: null,
          source_origin: null,
          source_method: null,
          source_ad_id: null,
          source_captured_at: null,
          anuncio_meta: { estado: "lida", anuncio: null },
        })}
        timezone={FUSO}
      />,
    );
    expect(html).toContain("Não informado");
    expect(html).toContain("Sem campanha");
    expect(html).not.toContain("Conjunto");
    expect(html).not.toContain("Método");
  });
});

function leadDaLista(campos: Partial<LeadResumo> = {}): LeadResumo {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Lead de Anúncio",
    phone_e164: "+5585999990001",
    funnel_stage: "novo",
    lost_reason: null,
    lost_reason_note: null,
    owner_user_id: null,
    tags: [],
    source_channel: "trafego_pago",
    source_campaign: null,
    source_origin: "Meta",
    source_medium: "Facebook",
    source_method: "anuncio_ctwa",
    source_ad_id: AD_ID,
    first_contact_at: "2026-10-04T12:00:00.000Z",
    last_contact_at: null,
    insurance: null,
    consent_ativo: true,
    anuncio_meta: LIDA,
    ...campos,
  };
}

function lista(leads: LeadResumo[]): string {
  return renderToStaticMarkup(
    <ListaLeads
      leads={leads}
      membros={{}}
      jornada={[]}
      timezone={FUSO}
      selecionados={new Set()}
      onSelecionar={() => undefined}
      onSelecionarTodos={() => undefined}
      onAbrirLead={() => undefined}
    />,
  );
}

describe("lista de Leads, colunas Origem e Campanha", () => {
  it("Origem com plataforma e Campanha vinda da Meta", () => {
    const html = lista([leadDaLista()]);
    expect(html).toContain("Tráfego pago, Meta (Facebook)");
    expect(html).toContain("Botox Fortaleza Setembro");
    expect(html).not.toContain("trafego_pago");
  });

  it("lead de anúncio sem linha na Meta e leitura com erro", () => {
    expect(
      lista([leadDaLista({ anuncio_meta: { estado: "lida", anuncio: null } })]),
    ).toContain("Campanha da Meta ainda não identificada");
    expect(
      lista([leadDaLista({ anuncio_meta: { estado: "erro" } })]),
    ).toContain("Não foi possível carregar a campanha");
  });

  it("contato sem anúncio e sem campanha deixa a célula vazia, como antes", () => {
    const html = lista([
      leadDaLista({
        source_channel: null,
        source_origin: null,
        source_medium: null,
        source_method: null,
        source_ad_id: null,
        anuncio_meta: { estado: "lida", anuncio: null },
      }),
    ]);
    expect(html).not.toContain("Sem campanha");
    expect(html).not.toContain("Campanha da Meta");
  });
});
