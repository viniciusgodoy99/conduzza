import { describe, expect, it } from "vitest";

import { ROTULO_ANUNCIO_NAO_IDENTIFICADO } from "@/lib/domain/anuncio-do-whatsapp";
import {
  COLUNAS_DA_EXPORTACAO_DE_LEADS,
  corpoDoPedidoDeExportacao,
  DICA_EXPORTAR_LEADS,
  dataHoraNoFuso,
  detalhesDaTrilhaDaExportacao,
  filtrosDaExportacaoSchema,
  linhaDoLead,
  linhasDaExportacaoDeLeads,
  mensagemAcimaDoTeto,
  MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR,
  nomeDoArquivoDaExportacao,
  podeExportarLeads,
  textoDoAnuncio,
  textoDoMotivoDaPerda,
  valoresDaExportacao,
  type ContextoDaPlanilha,
  type LeadParaExportar,
} from "@/lib/domain/exportacao-de-leads";
import { ROTULO_ANUNCIO_NAO_IDENTIFICADO as REEXPORTADO } from "@/lib/domain/exportacao-de-resultados";
import {
  filtrosDeLeadsDosValores,
  situacaoDoConsentimentoDeLinhas,
  consentimentoVigenteDeLinhas,
  type AnuncioDaMeta,
} from "@/lib/domain/leads-ui";
import { ROLES } from "@/lib/domain/permissions";
import { gerarCsv, parseCsv } from "@/lib/utils/csv";

// Exportacao dos leads (pedido do dono em 20/10/2026): as colunas na ordem
// pedida, com os rotulos da tela; data e hora no fuso da clinica; o telefone
// como a tela mostra; formula neutralizada; etiquetas; a autorizacao pela
// regra vigente (a linha mais recente do WhatsApp manda); a coluna Anuncio
// com e sem titulo; e o que vai para a trilha, que nunca leva dado de
// paciente.

const FORTALEZA = "America/Fortaleza";
const AD_ID = "120240624148610289";
const CONTEXTO: ContextoDaPlanilha = {
  etapas: new Map([
    ["novo", "Novo"],
    ["em_contato", "Em contato"],
    ["perdido", "Perdido"],
  ]),
  timezone: FORTALEZA,
};

const ANUNCIO: AnuncioDaMeta = {
  ad_id: AD_ID,
  campaign_id: "120240624148610001",
  campaign_name: "Botox Fortaleza Outubro",
  adset_id: "120240624148610002",
  adset_name: "Mulheres 30 a 45",
  ad_name: "Botox carrossel 3",
};

function lead(campos: Partial<LeadParaExportar> = {}): LeadParaExportar {
  return {
    name: "Maria Silva",
    phone_e164: "+5585999990001",
    kind: "lead",
    funnel_stage: "novo",
    lost_reason: null,
    lost_reason_note: null,
    tags: [],
    source_channel: null,
    source_campaign: null,
    source_origin: null,
    source_medium: null,
    source_method: null,
    source_ad_id: null,
    source_google_campaign_id: null,
    first_contact_at: "2026-10-05T12:30:00.000000+00:00",
    last_contact_at: null,
    consentimento: "sem_autorizacao",
    anuncio_meta: { estado: "lida", anuncio: null },
    titulo_do_anuncio: null,
    ...campos,
  };
}

function leadDeAnuncio(
  campos: Partial<LeadParaExportar> = {},
): LeadParaExportar {
  return lead({
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_medium: "Instagram",
    source_method: "anuncio_ctwa",
    source_ad_id: AD_ID,
    anuncio_meta: { estado: "lida", anuncio: ANUNCIO },
    ...campos,
  });
}

function celula(linha: string[], coluna: string): string {
  const indice = (COLUNAS_DA_EXPORTACAO_DE_LEADS as readonly string[]).indexOf(
    coluna,
  );
  expect(indice, coluna).toBeGreaterThanOrEqual(0);
  return linha[indice] ?? "";
}

describe("papel: só administrador e gestor exportam (decisão do dono)", () => {
  it("admin e gestor podem; recepção, profissional e leitura não", () => {
    const podem = ROLES.filter((role) => podeExportarLeads(role));
    expect(podem).toEqual(["admin", "gestor"]);
  });

  it("a dica é a frase do dono, sem travessão", () => {
    expect(DICA_EXPORTAR_LEADS).toBe(
      "Só o administrador e o gestor exportam os leads.",
    );
    expect(MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR).toBe(
      "Nenhum lead para exportar com esses filtros.",
    );
  });
});

describe("colunas do arquivo", () => {
  it("na ordem pedida, com os rótulos da tela", () => {
    expect([...COLUNAS_DA_EXPORTACAO_DE_LEADS]).toEqual([
      "Nome",
      "Telefone",
      "Tipo",
      "Etapa da jornada",
      "Canal",
      "Origem",
      "Plataforma",
      "Como chegou",
      "Campanha",
      "Conjunto",
      "Anúncio",
      "Primeiro contato",
      "Último contato",
      "Etiquetas",
      "Autorização para receber mensagens",
      "Motivo da perda",
    ]);
  });

  it("a primeira linha é o cabeçalho e cada lead tem uma célula por coluna", () => {
    const linhas = linhasDaExportacaoDeLeads(
      [lead(), leadDeAnuncio()],
      CONTEXTO,
    );
    expect(linhas[0]).toEqual([...COLUNAS_DA_EXPORTACAO_DE_LEADS]);
    expect(linhas).toHaveLength(3);
    for (const linha of linhas.slice(1)) {
      expect(linha).toHaveLength(COLUNAS_DA_EXPORTACAO_DE_LEADS.length);
    }
  });

  it("lead de anúncio da Meta: canal, origem, plataforma e método em linguagem de recepção", () => {
    const linha = linhaDoLead(leadDeAnuncio(), CONTEXTO);
    expect(celula(linha, "Canal")).toBe("Tráfego pago");
    expect(celula(linha, "Origem")).toBe("Meta");
    expect(celula(linha, "Plataforma")).toBe("Instagram");
    expect(celula(linha, "Como chegou")).toBe(
      "Anúncio de clique para WhatsApp",
    );
    expect(celula(linha, "Campanha")).toBe("Botox Fortaleza Outubro");
    expect(celula(linha, "Conjunto")).toBe("Mulheres 30 a 45");
    // Nada cru do banco.
    expect(linha.join(" ")).not.toContain("trafego_pago");
    expect(linha.join(" ")).not.toContain("anuncio_ctwa");
  });

  it("tipo, etapa pelo nome da jornada e a chave crua quando a etapa saiu da jornada", () => {
    expect(celula(linhaDoLead(lead(), CONTEXTO), "Tipo")).toBe("Lead");
    expect(
      celula(linhaDoLead(lead({ kind: "paciente" }), CONTEXTO), "Tipo"),
    ).toBe("Paciente");
    expect(
      celula(
        linhaDoLead(lead({ funnel_stage: "em_contato" }), CONTEXTO),
        "Etapa da jornada",
      ),
    ).toBe("Em contato");
    expect(
      celula(
        linhaDoLead(lead({ funnel_stage: "etapa_apagada" }), CONTEXTO),
        "Etapa da jornada",
      ),
    ).toBe("etapa_apagada");
  });

  it("campo vazio fica vazio (sem travessão nem 'Sem nome')", () => {
    const linha = linhaDoLead(lead({ name: null }), CONTEXTO);
    expect(celula(linha, "Nome")).toBe("");
    for (const coluna of [
      "Canal",
      "Origem",
      "Plataforma",
      "Como chegou",
      "Campanha",
      "Conjunto",
      "Anúncio",
      "Último contato",
      "Etiquetas",
      "Motivo da perda",
    ]) {
      expect(celula(linha, coluna), coluna).toBe("");
    }
    expect(linha.join("")).not.toMatch(/[–—]/);
  });
});

describe("telefone e datas", () => {
  it("telefone no formato da tela", () => {
    expect(celula(linhaDoLead(lead(), CONTEXTO), "Telefone")).toBe(
      "(85) 99999-0001",
    );
    // Celular sem o nono dígito, como o WhatsApp entrega: a tela mostra com ele.
    expect(
      celula(
        linhaDoLead(lead({ phone_e164: "+558599990000" }), CONTEXTO),
        "Telefone",
      ),
    ).toBe("(85) 99999-0000");
  });

  it("telefone fora do formato brasileiro sai como texto, nunca como número da planilha", () => {
    for (const [e164, esperado] of [
      ["+14155550101", "'+14155550101"],
      ["+447911123456", "'+447911123456"],
      // DDD que não existe: a tela mostra cru, como o de fora.
      ["+5500999990001", "'+5500999990001"],
    ] as const) {
      const linha = linhaDoLead(lead({ phone_e164: e164 }), CONTEXTO);
      expect(celula(linha, "Telefone"), e164).toBe(esperado);
      // O CSV não mexe de novo: o apóstrofo já tira o "+" do começo.
      const csv = gerarCsv(
        linhasDaExportacaoDeLeads([lead({ phone_e164: e164 })], CONTEXTO),
      );
      expect(celula(parseCsv(csv).linhas[1] ?? [], "Telefone"), e164).toBe(
        esperado,
      );
    }
  });

  it("primeiro e último contato em dd/mm/aaaa hh:mm no fuso da clínica (regra 3.6)", () => {
    // 02:30 UTC de 05/10 ainda é 04/10 em Fortaleza (UTC-3).
    const linha = linhaDoLead(
      lead({
        first_contact_at: "2026-10-05T02:30:00.000000+00:00",
        last_contact_at: "2026-10-19T21:05:59.999999+00:00",
      }),
      CONTEXTO,
    );
    expect(celula(linha, "Primeiro contato")).toBe("04/10/2026 23:30");
    expect(celula(linha, "Último contato")).toBe("19/10/2026 18:05");
  });

  it("o mesmo instante muda de dia com o fuso da clínica", () => {
    const instante = "2026-10-05T03:30:00.000000+00:00";
    expect(dataHoraNoFuso(instante, "America/Fortaleza")).toBe(
      "05/10/2026 00:30",
    );
    expect(dataHoraNoFuso(instante, "America/Manaus")).toBe("04/10/2026 23:30");
  });

  it("nome do arquivo com o dia civil da clínica, não o do servidor", () => {
    // 01:30 UTC de 21/10 ainda é 20/10 em Fortaleza.
    const agora = new Date("2026-10-21T01:30:00.000Z");
    expect(nomeDoArquivoDaExportacao(agora, FORTALEZA)).toBe(
      "leads-2026-10-20.csv",
    );
    expect(nomeDoArquivoDaExportacao(agora, "UTC")).toBe(
      "leads-2026-10-21.csv",
    );
  });
});

describe("etiquetas, autorização e motivo da perda", () => {
  it("etiquetas separadas por vírgula, sem as vazias", () => {
    expect(
      celula(
        linhaDoLead(
          lead({ tags: ["vip", " botox ", "", "retorno"] }),
          CONTEXTO,
        ),
        "Etiquetas",
      ),
    ).toBe("vip, botox, retorno");
  });

  it("autorização: Sim, Não ou Revogada", () => {
    const texto = (consentimento: LeadParaExportar["consentimento"]) =>
      celula(
        linhaDoLead(lead({ consentimento }), CONTEXTO),
        "Autorização para receber mensagens",
      );
    expect(texto("autorizado")).toBe("Sim");
    expect(texto("sem_autorizacao")).toBe("Não");
    expect(texto("revogado")).toBe("Revogada");
  });

  it("a regra vigente: a linha mais recente do WhatsApp manda", () => {
    expect(situacaoDoConsentimentoDeLinhas([])).toBe("sem_autorizacao");
    expect(
      situacaoDoConsentimentoDeLinhas([
        {
          channel: "whatsapp",
          granted_at: "2026-09-01T10:00:00Z",
          revoked_at: null,
        },
      ]),
    ).toBe("autorizado");
    // Uma autorização antiga ativa não mascara a revogação mais recente.
    const revogadaDepois = [
      {
        channel: "whatsapp",
        granted_at: "2026-09-01T10:00:00Z",
        revoked_at: null,
      },
      {
        channel: "whatsapp",
        granted_at: "2026-10-01T10:00:00Z",
        revoked_at: "2026-10-02T10:00:00Z",
      },
    ];
    expect(situacaoDoConsentimentoDeLinhas(revogadaDepois)).toBe("revogado");
    expect(consentimentoVigenteDeLinhas(revogadaDepois)).toBe(false);
    // Outro canal não conta.
    expect(
      situacaoDoConsentimentoDeLinhas([
        {
          channel: "email",
          granted_at: "2026-10-01T10:00:00Z",
          revoked_at: null,
        },
      ]),
    ).toBe("sem_autorizacao");
  });

  it("motivo da perda pelo rótulo, com a descrição quando a equipe escreveu", () => {
    expect(textoDoMotivoDaPerda("preco", null)).toBe("Preço");
    expect(textoDoMotivoDaPerda("outro", "Mudou de cidade")).toBe(
      "Outro: Mudou de cidade",
    );
    expect(textoDoMotivoDaPerda(null, null)).toBe("");
    expect(
      celula(
        linhaDoLead(
          lead({ funnel_stage: "perdido", lost_reason: "nao_respondeu" }),
          CONTEXTO,
        ),
        "Motivo da perda",
      ),
    ).toBe("Não respondeu");
  });
});

describe("coluna Anúncio", () => {
  it("com título guardado: o título", () => {
    expect(
      textoDoAnuncio(leadDeAnuncio({ titulo_do_anuncio: "Botox com 20% off" })),
    ).toBe("Botox com 20% off");
  });

  it("sem título: o nome do anúncio na Meta", () => {
    expect(textoDoAnuncio(leadDeAnuncio())).toBe("Botox carrossel 3");
  });

  it("sem título e sem nome na Meta: o código inteiro, dentro do texto", () => {
    expect(
      textoDoAnuncio(
        leadDeAnuncio({ anuncio_meta: { estado: "lida", anuncio: null } }),
      ),
    ).toBe(`Anúncio sem título (id ${AD_ID})`);
  });

  it("lead de anúncio sem código: Anúncio não identificado (o mesmo de Resultados)", () => {
    expect(textoDoAnuncio(leadDeAnuncio({ source_ad_id: null }))).toBe(
      ROTULO_ANUNCIO_NAO_IDENTIFICADO,
    );
    expect(REEXPORTADO).toBe(ROTULO_ANUNCIO_NAO_IDENTIFICADO);
  });

  it("quem não veio de anúncio fica vazio", () => {
    expect(textoDoAnuncio(lead({ source_channel: "indicacao" }))).toBe("");
  });

  it("campanha do link vence; lead do clique no site leva a campanha do Google", () => {
    const doLink = linhaDoLead(
      lead({
        source_channel: "redes_sociais",
        source_campaign: "Limpeza de pele outubro",
        source_method: "link_token",
      }),
      CONTEXTO,
    );
    expect(celula(doLink, "Campanha")).toBe("Limpeza de pele outubro");
    expect(celula(doLink, "Conjunto")).toBe("");

    const doGoogle = linhaDoLead(
      lead({
        source_channel: "trafego_pago",
        source_origin: "Google",
        source_method: "clique_site",
        source_google_campaign_id: "987654321",
      }),
      CONTEXTO,
    );
    expect(celula(doGoogle, "Campanha")).toBe("Campanha do Google 987654321");
  });

  it("anúncio que a Meta ainda não identificou: os textos da tela", () => {
    const linha = linhaDoLead(
      leadDeAnuncio({ anuncio_meta: { estado: "lida", anuncio: null } }),
      CONTEXTO,
    );
    expect(celula(linha, "Campanha")).toBe(
      "Campanha da Meta ainda não identificada",
    );
    expect(celula(linha, "Conjunto")).toBe("Conjunto ainda não identificado");
  });
});

describe("CSV: fórmula neutralizada e separador do Excel", () => {
  it("nome e título forjados saem como texto, nunca como fórmula", () => {
    const csv = gerarCsv(
      linhasDaExportacaoDeLeads(
        [
          leadDeAnuncio({
            name: '=HYPERLINK("https://exemplo.invalid";"oi")',
            titulo_do_anuncio: "@SOMA(A1:A2)",
            tags: ["+vip"],
          }),
        ],
        CONTEXTO,
      ),
    );
    expect(csv.startsWith("﻿")).toBe(true);
    const { linhas, delimitador } = parseCsv(csv);
    expect(delimitador).toBe(";");
    const linha = linhas[1] ?? [];
    expect(celula(linha, "Nome")).toBe(
      `'=HYPERLINK("https://exemplo.invalid";"oi")`,
    );
    expect(celula(linha, "Anúncio")).toBe("'@SOMA(A1:A2)");
    expect(celula(linha, "Etiquetas")).toBe("'+vip");
    // O telefone formatado e as datas não mudam.
    expect(celula(linha, "Telefone")).toBe("(85) 99999-0001");
  });
});

describe("filtros do pedido", () => {
  it("a tela manda só os filtros preenchidos; dia que não existe fica de fora, como na tela", () => {
    expect(
      corpoDoPedidoDeExportacao({
        etapa: "novo",
        origem: "",
        campanha: "",
        anuncio: "",
        resp: "",
        de: "2026-02-30",
        ate: "2026-10-20",
      }),
    ).toEqual({ etapa: "novo", ate: "2026-10-20" });
    expect(
      filtrosDeLeadsDosValores(
        {
          etapa: "",
          origem: "",
          campanha: "",
          anuncio: "",
          resp: "",
          de: "2026-02-30",
          ate: "",
        },
        FORTALEZA,
      ).deISO,
    ).toBeUndefined();
  });

  it("o servidor aceita os valores da tela e recusa o que a tela nunca manda", () => {
    const resp = crypto.randomUUID();
    const ok = filtrosDaExportacaoSchema.safeParse({
      etapa: "em_contato",
      origem: "trafego_pago",
      resp,
      de: "2026-10-01",
      ate: "",
    });
    expect(ok.success).toBe(true);
    expect(valoresDaExportacao(ok.success ? ok.data : {})).toEqual({
      etapa: "em_contato",
      origem: "trafego_pago",
      campanha: "",
      anuncio: "",
      resp,
      de: "2026-10-01",
      ate: "",
    });
    expect(filtrosDaExportacaoSchema.safeParse({}).success).toBe(true);
    for (const ruim of [
      undefined,
      null,
      [],
      { etapa: "Novo Lead" },
      { origem: "x".repeat(41) },
      { resp: "nao-e-uuid" },
      { de: "2026-13-01" },
      { ate: "01/10/2026" },
      { visao: "lista" },
      { etapa: 7 },
    ]) {
      expect(
        filtrosDaExportacaoSchema.safeParse(ruim).success,
        JSON.stringify(ruim),
      ).toBe(false);
    }
  });
});

describe("trilha da exportação (LGPD)", () => {
  it("quantidade e resumo dos filtros, só chaves, ids de membro e datas", () => {
    const resp = crypto.randomUUID();
    expect(
      detalhesDaTrilhaDaExportacao(128, {
        etapa: "novo",
        origem: "trafego_pago",
        resp,
        de: "2026-10-01",
        ate: "2026-10-20",
      }),
    ).toEqual({
      quantidade: 128,
      filtros: {
        etapa: "novo",
        origem: "trafego_pago",
        responsavel: resp,
        de: "2026-10-01",
        ate: "2026-10-20",
      },
    });
    expect(detalhesDaTrilhaDaExportacao(3, {})).toEqual({
      quantidade: 3,
      filtros: {},
    });
  });
});

describe("mensagem acima do teto", () => {
  it("diz quantos são, o teto e o que fazer, sem travessão", () => {
    const texto = mensagemAcimaDoTeto(23456);
    expect(texto).toContain("23.456");
    expect(texto).toContain("20.000");
    expect(texto).toContain("Filtre");
    expect(texto).not.toMatch(/[–—]/);
    expect(mensagemAcimaDoTeto(null)).toContain("mais de 20.000");
  });
});
