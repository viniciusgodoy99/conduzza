import { beforeEach, describe, expect, it } from "vitest";

import {
  COLUNAS_DA_EXPORTACAO_DE_LEADS,
  DICA_EXPORTAR_LEADS,
  MENSAGEM_EXPORTACAO_CLINICA_MUDOU,
  MENSAGEM_EXPORTACAO_FALHOU,
  MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
  MENSAGEM_EXPORTACAO_TRILHA_FALHOU,
  TETO_DA_EXPORTACAO_DE_LEADS,
} from "@/lib/domain/exportacao-de-leads";
import {
  compararPorProximaAcao,
  filtrarLeads,
  filtrosDeLeadsDosValores,
  type FiltrosDeLeads,
  type ValoresDosFiltrosDeLeads,
} from "@/lib/domain/leads-ui";
import type { Role } from "@/lib/domain/permissions";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  exportarLeads,
  lerLeadsParaExportar,
  PAGINA_DA_EXPORTACAO,
  type SessaoDaExportacao,
} from "@/lib/queries/exportacao-de-leads";
import {
  aplicarFiltrosDeLeads,
  consultaDosLeads,
  linhasDosLeads,
  normalizarLead,
} from "@/lib/queries/leads";
import { parseCsv } from "@/lib/utils/csv";

import { SupabaseEmMemoria, type Linha } from "./supabase-em-memoria";

// A exportacao no servidor (lib/queries/exportacao-de-leads.ts) contra um
// PostgREST em memoria que compara instantes em microssegundos, como o
// Postgres: a guarda de papel antes de qualquer leitura, o recorte no banco
// IGUAL ao filtrarLeads da tela, a paginacao ate o fim, o teto, a trilha
// (uma linha, sem dado de paciente, e sem ela nada sai) e a falha que nunca
// vira arquivo pela metade.

const FORTALEZA = "America/Fortaleza";
const CLINICA = "c1111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "c2222222-2222-4222-8222-222222222222";
const EU = "a0000000-0000-4000-8000-000000000001";
const RESP_A = "b0000000-0000-4000-8000-00000000000a";
const RESP_B = "b0000000-0000-4000-8000-00000000000b";
const AD_ID = "120240624148610289";
const AGORA = new Date("2026-10-20T15:00:00.000Z");

function idDoContato(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function contato(n: number, campos: Partial<Linha> = {}): Linha {
  return {
    id: idDoContato(n),
    clinic_id: CLINICA,
    name: `Paciente ${n}`,
    phone_e164: `+55859${String(99000000 + n).padStart(8, "0")}`,
    kind: "lead",
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
    first_contact_at: "2026-10-05T12:00:00.000000+00:00",
    last_contact_at: null,
    insurance: null,
    contact_consent: [],
    ...campos,
  };
}

const JORNADA: Linha[] = [
  { clinic_id: CLINICA, chave: "novo", nome: "Novo", posicao: 1 },
  { clinic_id: CLINICA, chave: "em_contato", nome: "Em contato", posicao: 2 },
  { clinic_id: CLINICA, chave: "agendou", nome: "Agendou", posicao: 3 },
  { clinic_id: CLINICA, chave: "perdido", nome: "Perdido", posicao: 6 },
];

// Inicio do filtro de 01/10 em Fortaleza: 03:00Z; fim do filtro de 10/10:
// 11/10 02:59:59.999Z. Os instantes encostam nas duas pontas, com
// microssegundos que o JavaScript corta.
const INSTANTES = [
  "2026-10-01T02:59:59.999999+00:00", // fora (antes do inicio)
  "2026-10-01T03:00:00+00:00", // dentro (o inicio exato)
  "2026-10-01T03:00:00.000500+00:00", // dentro
  "2026-10-05T12:00:00.123456+00:00", // dentro
  "2026-10-11T02:59:59.999000+00:00", // dentro (o ultimo milissegundo)
  "2026-10-11T02:59:59.999999+00:00", // dentro: a tela corta para .999
  "2026-10-11T03:00:00+00:00", // fora (o dia seguinte)
  "2026-10-11T03:00:00.000001+00:00", // fora
];
const ETAPAS = ["novo", "em_contato", "agendou", "perdido"];
const CANAIS = [null, "trafego_pago", "indicacao", "redes_sociais"];
const RESPONSAVEIS = [null, RESP_A, RESP_B];

/** 96 contatos que cruzam etapa, canal, responsavel e os instantes. */
function baseVariada(): Linha[] {
  const linhas: Linha[] = [];
  let n = 1;
  for (const instante of INSTANTES) {
    for (let i = 0; i < 12; i += 1) {
      linhas.push(
        contato(n, {
          funnel_stage: ETAPAS[i % ETAPAS.length],
          source_channel: CANAIS[i % CANAIS.length],
          owner_user_id: RESPONSAVEIS[i % RESPONSAVEIS.length],
          first_contact_at: instante,
          last_contact_at:
            i % 5 === 0 ? null : `2026-10-1${i % 9}T10:00:00.000000+00:00`,
        }),
      );
      n += 1;
    }
  }
  return linhas;
}

function sessao(role: Role): SessaoDaExportacao {
  return { userId: EU, clinicId: CLINICA, role, timezone: FORTALEZA };
}

let banco: SupabaseEmMemoria;

function bancoCom(contatos: Linha[], extras: Record<string, Linha[]> = {}) {
  banco = new SupabaseEmMemoria({
    contact: [
      ...contatos,
      // Outra clinica no mesmo banco: o recorte por clinic_id precisa valer.
      contato(9001, {
        clinic_id: OUTRA_CLINICA,
        name: "Paciente de Outra Clinica",
        phone_e164: "+5584988887777",
      }),
    ],
    funnel_stage_def: JORNADA,
    meta_anuncio: [],
    anuncio_do_whatsapp: [],
    audit_log: [],
    ...extras,
  });
  return banco;
}

beforeEach(() => {
  bancoCom(baseVariada());
});

async function exportar(
  role: Role,
  entrada: unknown = {},
): ReturnType<typeof exportarLeads> {
  return exportarLeads({
    supabase: banco.comoCliente(),
    sessao: sessao(role),
    clinicaDaTela: CLINICA,
    entrada,
    agora: AGORA,
  });
}

function linhasDoCsv(conteudo: string): string[][] {
  return parseCsv(conteudo).linhas;
}

describe("guarda de papel no servidor", () => {
  for (const role of ["recepcao", "profissional", "leitura"] as const) {
    it(`${role}: 403 com a dica do dono, sem ler nada nem gravar trilha`, async () => {
      const resultado = await exportar(role);
      expect(resultado).toEqual({
        tipo: "recusada",
        status: 403,
        mensagem: DICA_EXPORTAR_LEADS,
      });
      expect(banco.consultas).toHaveLength(0);
      expect(banco.inserts).toHaveLength(0);
    });
  }

  for (const role of ["admin", "gestor"] as const) {
    it(`${role}: recebe o CSV com todos os leads da clínica`, async () => {
      const resultado = await exportar(role);
      expect(resultado.tipo).toBe("arquivo");
      if (resultado.tipo !== "arquivo") {
        return;
      }
      expect(resultado.nome).toBe("leads-2026-10-20.csv");
      expect(resultado.conteudo.startsWith("﻿")).toBe(true);
      const linhas = linhasDoCsv(resultado.conteudo);
      expect(linhas[0]).toEqual([...COLUNAS_DA_EXPORTACAO_DE_LEADS]);
      expect(linhas).toHaveLength(96 + 1);
      expect(resultado.quantidade).toBe(96);
      // Nada da outra clinica.
      expect(resultado.conteudo).not.toContain("Paciente de Outra Clinica");
      expect(resultado.conteudo).not.toContain(
        formatarTelefone("+5584988887777"),
      );
      // Toda consulta recorta a clinica ativa.
      for (const consulta of banco.consultas) {
        expect(consulta.filtros).toContainEqual({
          operador: "eq",
          coluna: "clinic_id",
          valor: CLINICA,
        });
      }
    });
  }

  it("filtro inválido: 400 depois da guarda, sem ler nada", async () => {
    const resultado = await exportar("admin", { etapa: "Novo Lead" });
    expect(resultado).toEqual({
      tipo: "recusada",
      status: 400,
      mensagem: MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
    });
    expect(banco.consultas).toHaveLength(0);
    // Sem corpo não é "sem filtro" (a tela manda {} quando não há filtro).
    const semCorpo = await exportarLeads({
      supabase: banco.comoCliente(),
      sessao: sessao("admin"),
      clinicaDaTela: CLINICA,
      entrada: undefined,
      agora: AGORA,
    });
    expect(semCorpo).toMatchObject({ tipo: "recusada", status: 400 });
    expect(banco.consultas).toHaveLength(0);
  });
});

describe("os mesmos filtros da lista", () => {
  const combinacoes: Partial<ValoresDosFiltrosDeLeads>[] = [
    {},
    { etapa: "perdido" },
    { origem: "trafego_pago" },
    { resp: RESP_A },
    { de: "2026-10-01" },
    { ate: "2026-10-10" },
    { de: "2026-10-01", ate: "2026-10-10" },
    { etapa: "em_contato", origem: "trafego_pago", resp: RESP_B },
    { etapa: "novo", de: "2026-10-01", ate: "2026-10-10" },
    { de: "2026-10-11", ate: "2026-10-11" },
    { de: "2026-10-12", ate: "2026-10-01" },
    { etapa: "nao_existe" },
  ];

  function filtrosDe(
    valores: Partial<ValoresDosFiltrosDeLeads>,
  ): FiltrosDeLeads {
    return filtrosDeLeadsDosValores(
      {
        etapa: "",
        origem: "",
        campanha: "",
        anuncio: "",
        resp: "",
        de: "",
        ate: "",
        ...valores,
      },
      FORTALEZA,
    );
  }

  function daTela(filtros: FiltrosDeLeads): string[] {
    const daClinica = baseVariada().map(normalizarLead);
    return filtrarLeads(daClinica, filtros)
      .map((lead) => lead.id)
      .sort();
  }

  for (const valores of combinacoes) {
    it(`o recorte no banco é o da tela: ${JSON.stringify(valores)}`, async () => {
      const filtros = filtrosDe(valores);
      // So o banco (sem a passada final do filtrarLeads), com microssegundos.
      const { data, error } = await aplicarFiltrosDeLeads(
        consultaDosLeads(banco.comoCliente(), CLINICA),
        filtros,
      );
      expect(error).toBeNull();
      const doBanco = linhasDosLeads(data)
        .map((linha) => linha.id as string)
        .sort();
      expect(doBanco).toEqual(daTela(filtros));

      // E a exportacao inteira devolve o mesmo conjunto.
      const leitura = await lerLeadsParaExportar(
        banco.comoCliente(),
        CLINICA,
        filtros,
      );
      expect(leitura.tipo).toBe("lidos");
      if (leitura.tipo === "lidos") {
        expect(leitura.leads.map((lead) => lead.phone_e164).sort()).toEqual(
          baseVariada()
            .filter((linha) => daTela(filtros).includes(linha.id as string))
            .map((linha) => linha.phone_e164 as string)
            .sort(),
        );
      }
    });
  }

  it("as pontas do período: microssegundo antes fica fora, o último milissegundo do dia fica dentro", () => {
    const filtros = filtrosDe({ de: "2026-10-01", ate: "2026-10-10" });
    expect(filtros.deISO).toBe("2026-10-01T03:00:00.000Z");
    expect(filtros.ateISO).toBe("2026-10-11T02:59:59.999Z");
    const dentro = new Set(daTela(filtros));
    const porInstante = (instante: string) =>
      baseVariada().filter((linha) => linha.first_contact_at === instante);
    expect(
      porInstante("2026-10-01T02:59:59.999999+00:00").some((l) =>
        dentro.has(l.id as string),
      ),
    ).toBe(false);
    expect(
      porInstante("2026-10-11T02:59:59.999999+00:00").every((l) =>
        dentro.has(l.id as string),
      ),
    ).toBe(true);
    expect(
      porInstante("2026-10-11T03:00:00+00:00").some((l) =>
        dentro.has(l.id as string),
      ),
    ).toBe(false);
  });

  it("os filtros do pedido chegam ao banco na forma da tela", async () => {
    await exportar("admin", {
      etapa: "em_contato",
      origem: "trafego_pago",
      resp: RESP_B,
      de: "2026-10-01",
      ate: "2026-10-10",
    });
    const [primeira] = banco.consultasDe("contact");
    expect(primeira?.filtros).toEqual([
      { operador: "eq", coluna: "clinic_id", valor: CLINICA },
      { operador: "eq", coluna: "funnel_stage", valor: "em_contato" },
      { operador: "eq", coluna: "source_channel", valor: "trafego_pago" },
      { operador: "eq", coluna: "owner_user_id", valor: RESP_B },
      {
        operador: "gte",
        coluna: "first_contact_at",
        valor: "2026-10-01T03:00:00.000Z",
      },
      {
        operador: "lt",
        coluna: "first_contact_at",
        valor: "2026-10-11T03:00:00.000Z",
      },
    ]);
  });
});

describe("paginação e teto", () => {
  it("lê TODOS os leads, página a página pelo id, não só os da tela", async () => {
    const muitos = Array.from({ length: 2345 }, (_, i) => contato(i + 1));
    bancoCom(muitos);
    const resultado = await exportar("admin");
    expect(resultado.tipo).toBe("arquivo");
    if (resultado.tipo !== "arquivo") {
      return;
    }
    expect(resultado.quantidade).toBe(2345);
    const telefones = linhasDoCsv(resultado.conteudo)
      .slice(1)
      .map((linha) => linha[1]);
    expect(new Set(telefones).size).toBe(2345);

    const paginas = banco.consultasDe("contact");
    expect(paginas).toHaveLength(3);
    expect(paginas.map((pagina) => pagina.limite)).toEqual([
      PAGINA_DA_EXPORTACAO,
      PAGINA_DA_EXPORTACAO,
      PAGINA_DA_EXPORTACAO,
    ]);
    expect(paginas.map((pagina) => pagina.contar)).toEqual([
      true,
      false,
      false,
    ]);
    expect(paginas[1]?.filtros).toContainEqual({
      operador: "gt",
      coluna: "id",
      valor: idDoContato(1000),
    });
    expect(paginas[2]?.filtros).toContainEqual({
      operador: "gt",
      coluna: "id",
      valor: idDoContato(2000),
    });
    for (const pagina of paginas) {
      expect(pagina.ordem).toEqual([{ coluna: "id", ascendente: true }]);
    }
  });

  it(`acima de ${TETO_DA_EXPORTACAO_DE_LEADS} leads: recusa pedindo para filtrar, sem ler o resto nem gravar trilha`, async () => {
    banco.contagemForcada = TETO_DA_EXPORTACAO_DE_LEADS + 1;
    const resultado = await exportar("admin");
    expect(resultado.tipo).toBe("recusada");
    if (resultado.tipo !== "recusada") {
      return;
    }
    expect(resultado.status).toBe(422);
    expect(resultado.mensagem).toContain("20.001");
    expect(resultado.mensagem).toContain("Filtre");
    expect(banco.consultas).toHaveLength(1);
    expect(banco.inserts).toHaveLength(0);
  });

  it("no teto exato ainda exporta", async () => {
    const leitura = await lerLeadsParaExportar(
      banco.comoCliente(),
      CLINICA,
      {},
      96,
    );
    expect(leitura.tipo).toBe("lidos");
    const acima = await lerLeadsParaExportar(
      banco.comoCliente(),
      CLINICA,
      {},
      95,
    );
    expect(acima).toEqual({ tipo: "acima_do_teto", total: 96 });
  });

  it("na ordem da tela: nunca contatado primeiro, depois o contato mais antigo", async () => {
    bancoCom([
      contato(1, {
        name: "Recente",
        last_contact_at: "2026-10-19T10:00:00+00:00",
      }),
      contato(2, { name: "Sem contato", last_contact_at: null }),
      contato(3, {
        name: "Antigo",
        last_contact_at: "2026-10-02T10:00:00+00:00",
      }),
    ]);
    const resultado = await exportar("gestor");
    expect(resultado.tipo).toBe("arquivo");
    if (resultado.tipo === "arquivo") {
      expect(
        linhasDoCsv(resultado.conteudo)
          .slice(1)
          .map((linha) => linha[0]),
      ).toEqual(["Sem contato", "Antigo", "Recente"]);
    }
  });
});

describe("zero lead", () => {
  it("devolve vazio, sem trilha e sem ler anúncio nem jornada", async () => {
    const resultado = await exportar("admin", { etapa: "nao_existe" });
    expect(resultado).toEqual({ tipo: "vazio" });
    expect(banco.inserts).toHaveLength(0);
    expect(banco.consultasDe("meta_anuncio")).toHaveLength(0);
    expect(banco.consultasDe("funnel_stage_def")).toHaveLength(0);
  });
});

describe("anúncio, campanha e jornada no arquivo", () => {
  it("título guardado, campanha e conjunto da Meta e o nome da etapa", async () => {
    bancoCom(
      [
        contato(1, {
          source_channel: "trafego_pago",
          source_origin: "Meta",
          source_medium: "Instagram",
          source_method: "anuncio_ctwa",
          source_ad_id: AD_ID,
          funnel_stage: "em_contato",
        }),
      ],
      {
        meta_anuncio: [
          {
            clinic_id: CLINICA,
            ad_id: AD_ID,
            campaign_id: "1",
            campaign_name: "Botox Outubro",
            adset_id: "2",
            adset_name: "Mulheres 30 a 45",
            ad_name: "Carrossel 3",
          },
        ],
        anuncio_do_whatsapp: [
          {
            clinic_id: CLINICA,
            ad_id: AD_ID,
            titulo: "Botox com 20% off",
            descricao: null,
            link: null,
          },
        ],
      },
    );
    const resultado = await exportar("admin");
    expect(resultado.tipo).toBe("arquivo");
    if (resultado.tipo !== "arquivo") {
      return;
    }
    const [, linha] = linhasDoCsv(resultado.conteudo);
    expect(linha).toEqual([
      "Paciente 1",
      "(85) 99900-0001",
      "Lead",
      "Em contato",
      "Tráfego pago",
      "Meta",
      "Instagram",
      "Anúncio de clique para WhatsApp",
      "Botox Outubro",
      "Mulheres 30 a 45",
      "Botox com 20% off",
      "05/10/2026 09:00",
      "",
      "",
      "Não",
      "",
    ]);
    // O nome na Meta e lido junto (coluna Anuncio sem titulo).
    expect(banco.consultasDe("meta_anuncio")[0]?.colunas).toContain("ad_name");
  });
});

describe("trilha (LGPD)", () => {
  it("UMA linha: exportou, leads, sem id, com a quantidade e os filtros; nenhum dado de paciente", async () => {
    const resultado = await exportar("admin", {
      origem: "trafego_pago",
      de: "2026-10-01",
    });
    expect(resultado.tipo).toBe("arquivo");
    expect(banco.inserts).toHaveLength(1);
    const [insert] = banco.inserts;
    expect(insert?.tabela).toBe("audit_log");
    const quantidade = resultado.tipo === "arquivo" ? resultado.quantidade : -1;
    expect(insert?.linha).toEqual({
      clinic_id: CLINICA,
      user_id: EU,
      action: "exportou",
      entity: "leads",
      entity_id: null,
      detalhes: {
        quantidade,
        filtros: { origem: "trafego_pago", de: "2026-10-01" },
      },
    });
    const trilha = JSON.stringify(insert?.linha);
    for (const linha of baseVariada()) {
      expect(trilha).not.toContain(linha.name as string);
      expect(trilha).not.toContain(linha.phone_e164 as string);
      expect(trilha).not.toContain(
        formatarTelefone(linha.phone_e164 as string),
      );
      expect(trilha).not.toContain(linha.id as string);
    }
  });

  it("sem a trilha gravada, nada sai (503)", async () => {
    banco.errosDeInsert.audit_log = [{ code: "42501", message: "negado" }];
    const resultado = await exportar("admin");
    expect(resultado).toEqual({
      tipo: "falhou",
      status: 503,
      mensagem: MENSAGEM_EXPORTACAO_TRILHA_FALHOU,
      motivo: "trilha",
      codigo: null,
    });
  });

  it("a coluna detalhes recusada (qualquer erro, inclusive PGRST204): 503 sem tentar de novo sem ela", async () => {
    banco.errosDeInsert.audit_log = [
      { code: "PGRST204", message: "coluna desconhecida" },
      null,
    ];
    const resultado = await exportar("admin");
    expect(resultado).toMatchObject({ tipo: "falhou", status: 503 });
    // Uma tentativa so: nunca uma linha sem os detalhes.
    expect(banco.inserts).toHaveLength(1);
  });

  it("a linha sai com os detalhes, uma tentativa so", async () => {
    const resultado = await exportar("gestor");
    expect(resultado.tipo).toBe("arquivo");
    expect(banco.inserts).toHaveLength(1);
    expect(banco.inserts[0]?.linha).toMatchObject({
      action: "exportou",
      entity: "leads",
      entity_id: null,
    });
    expect(banco.inserts[0]?.linha.detalhes).toBeDefined();
  });
});

describe("falha de leitura nunca vira arquivo pela metade", () => {
  for (const tabela of ["contact", "meta_anuncio", "funnel_stage_def"]) {
    it(`erro em ${tabela}: 500, sem trilha`, async () => {
      bancoCom([
        contato(1, { source_method: "anuncio_ctwa", source_ad_id: AD_ID }),
      ]);
      banco.errosDeLeitura[tabela] = { message: "fora do ar" };
      const resultado = await exportar("admin");
      expect(resultado).toEqual({
        tipo: "falhou",
        status: 500,
        mensagem: MENSAGEM_EXPORTACAO_FALHOU,
        motivo: "leitura",
        // So a leitura dos contatos carrega o codigo (o fake nao manda um).
        codigo: null,
      });
      expect(banco.inserts).toHaveLength(0);
    });
  }

  it("o código do PostgREST da leitura dos contatos vai para o log, a mensagem não", async () => {
    banco.errosDeLeitura.contact = {
      code: "57014",
      message: "Paciente 1 +5585999000001",
    };
    const resultado = await exportar("admin");
    expect(resultado).toMatchObject({
      tipo: "falhou",
      motivo: "leitura",
      codigo: "57014",
    });
  });
});

describe("a clínica que a tela mostra", () => {
  it("diferente da ativa (troca em outra aba): 409 depois da guarda de papel, sem ler nada", async () => {
    const outra = await exportarLeads({
      supabase: banco.comoCliente(),
      sessao: sessao("admin"),
      clinicaDaTela: OUTRA_CLINICA,
      entrada: {},
      agora: AGORA,
    });
    expect(outra).toEqual({
      tipo: "recusada",
      status: 409,
      mensagem: MENSAGEM_EXPORTACAO_CLINICA_MUDOU,
    });
    const semDizer = await exportarLeads({
      supabase: banco.comoCliente(),
      sessao: sessao("gestor"),
      clinicaDaTela: null,
      entrada: {},
      agora: AGORA,
    });
    expect(semDizer).toMatchObject({ tipo: "recusada", status: 409 });
    // O papel vem antes: a recepcao recebe a dica, nao o 409.
    const recepcao = await exportarLeads({
      supabase: banco.comoCliente(),
      sessao: sessao("recepcao"),
      clinicaDaTela: OUTRA_CLINICA,
      entrada: {},
      agora: AGORA,
    });
    expect(recepcao).toMatchObject({ tipo: "recusada", status: 403 });
    expect(banco.consultas).toHaveLength(0);
    expect(banco.inserts).toHaveLength(0);
  });
});

describe("a ordem do arquivo é a da tela", () => {
  // A tela: o banco ordena por ultimo contato (mais novo, nulo por ultimo),
  // primeiro contato (mais novo) e id, e o sort estavel por proxima acao
  // vem depois (fetchLeads). O arquivo le por id e reordena sozinho.
  function ordemDaTela(linhas: Linha[]): string[] {
    const leads = linhas.map((linha) => normalizarLead(linha));
    const doBanco = [...leads].sort((a, b) => {
      if (a.last_contact_at !== b.last_contact_at) {
        if (a.last_contact_at === null) {
          return 1;
        }
        if (b.last_contact_at === null) {
          return -1;
        }
        return a.last_contact_at < b.last_contact_at ? 1 : -1;
      }
      if (a.first_contact_at !== b.first_contact_at) {
        return a.first_contact_at < b.first_contact_at ? 1 : -1;
      }
      return a.id < b.id ? -1 : 1;
    });
    return doBanco.sort(compararPorProximaAcao).map((lead) => lead.name ?? "");
  }

  it("nunca contatados por primeiro contato mais novo, e o id no empate", async () => {
    // Ids fora da ordem do primeiro contato: a leitura por id daria outra.
    const contatos = [
      contato(1, {
        name: "Antigo",
        first_contact_at: "2026-10-01T12:00:00+00:00",
      }),
      contato(2, {
        name: "Novo",
        first_contact_at: "2026-10-10T12:00:00+00:00",
      }),
      contato(3, {
        name: "Meio",
        first_contact_at: "2026-10-05T12:00:00+00:00",
      }),
      // Mesmo milissegundo, microssegundos diferentes.
      contato(4, {
        name: "Meio micro",
        first_contact_at: "2026-10-05T12:00:00.000400+00:00",
      }),
      // Mesmo instante: o id decide.
      contato(6, {
        name: "Empate id 6",
        first_contact_at: "2026-10-03T12:00:00+00:00",
      }),
      contato(5, {
        name: "Empate id 5",
        first_contact_at: "2026-10-03T12:00:00+00:00",
      }),
      // Contatados: o mais antigo primeiro; empate no ultimo contato cai no
      // primeiro contato.
      contato(7, {
        name: "Respondeu ontem",
        last_contact_at: "2026-10-19T10:00:00+00:00",
      }),
      contato(8, {
        name: "Mesmo último, entrou antes",
        first_contact_at: "2026-10-02T12:00:00+00:00",
        last_contact_at: "2026-10-12T10:00:00+00:00",
      }),
      contato(9, {
        name: "Mesmo último, entrou depois",
        first_contact_at: "2026-10-04T12:00:00+00:00",
        last_contact_at: "2026-10-12T10:00:00+00:00",
      }),
    ];
    bancoCom(contatos);
    const resultado = await exportar("admin");
    expect(resultado.tipo).toBe("arquivo");
    if (resultado.tipo !== "arquivo") {
      return;
    }
    const nomes = linhasDoCsv(resultado.conteudo)
      .slice(1)
      .map((linha) => linha[0]);
    expect(nomes).toEqual(ordemDaTela(contatos));
    expect(nomes).toEqual([
      "Novo",
      "Meio micro",
      "Meio",
      "Empate id 5",
      "Empate id 6",
      "Antigo",
      "Mesmo último, entrou depois",
      "Mesmo último, entrou antes",
      "Respondeu ontem",
    ]);
  });

  it("a base variada inteira na mesma ordem da tela", async () => {
    const resultado = await exportar("gestor");
    if (resultado.tipo !== "arquivo") {
      throw new Error("sem arquivo");
    }
    const nomes = linhasDoCsv(resultado.conteudo)
      .slice(1)
      .map((linha) => linha[0]);
    expect(nomes).toEqual(ordemDaTela(baseVariada()));
  });
});

describe("o Max rows do PostgREST menor que a página", () => {
  it("lê até o fim: página curta só encerra depois de ler o que o banco contou", async () => {
    banco.maxLinhasPorResposta = 7;
    const resultado = await exportar("admin");
    expect(resultado.tipo === "arquivo" && resultado.quantidade).toBe(96);
    // 96 linhas de 7 em 7: 14 paginas, sem a pagina vazia no fim.
    expect(banco.consultasDe("contact")).toHaveLength(14);
  });
});
