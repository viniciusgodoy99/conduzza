import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nascerDeMensagem } from "../rls/lead-de-verdade";
import { adminClient } from "../rls/stack";

// Venda pela Jornada (decisao do dono de 23/11/2026, migration
// 20261123110000) contra o banco REAL, com o cliente de servico (auth.uid()
// nulo: ve as vendas). O gatilho registrar_venda_da_jornada em contact:
// entrar numa etapa com is_sale grava com o valor da etapa; sair e voltar
// grava de novo; etapa comum nao grava; erro no registro nunca trava a
// mudanca de etapa. vendas_do_periodo (total, valor, sem valor, o recorte
// por grupo de origem e tem_etapa_de_venda) e as colunas de venda de
// campanhas_do_periodo (pela campanha do contato, pelo momento da venda).
// Escrito em 23/11/2026 com a migration NAO aplicada e NAO rodado: so passa
// depois dela (npm run test:integration -- venda-pela-jornada). A carga
// inicial e o caminho de erro com a funcao de valor quebrada foram provados
// no Postgres local (docs/04, secao 52).
//
// Clinica e_de_teste (o motor de producao a ignora), com a jornada padrao
// semeada, apagada no fim. Etapas de venda desta clinica:
//   em_contato   is_sale, valor fixo R$ 250,00
//   compareceu   is_sale, preco da consulta do agendamento (service_link)
// Contatos:
//   X  clique de anuncio (grupo Meta), anuncio da campanha CAMPANHA; nao e
//      lead (nao nasceu de mensagem): a linha da campanha so existe pela venda
//   Y  campanha digitada "Check-up", indicacao (grupo Outras), lead do periodo,
//      consulta de R$ 300,00
//   Z  sem origem (Nao rastreada), sem consulta: venda sem valor
//   W  consulta com preco negativo: o registro falha e a etapa muda mesmo assim

const admin = adminClient();
const sufixo = Date.now().toString(36);
const CAMPANHA = `9${Date.now()}`.slice(0, 15);
// Uma hora para cada lado: as vendas nascem com o now() do banco.
const JANELA = {
  p_de: new Date(Date.now() - 3_600_000).toISOString(),
  p_ate: new Date(Date.now() + 3_600_000).toISOString(),
};

let clinicId = "";
let clinicaSemVenda = "";
let profissional = "";
let procedimento = "";
const contatos: Record<"X" | "Y" | "Z" | "W", string> = {
  X: "",
  Y: "",
  Z: "",
  W: "",
};

type Vendas = {
  tem_etapa_de_venda: boolean;
  vendas: number;
  valor_cents: number;
  sem_valor: number;
};

async function vendasDoPeriodo(
  clinica: string,
  grupo?: string,
): Promise<Vendas> {
  const { data, error } = await admin.rpc("vendas_do_periodo", {
    p_clinic_id: clinica,
    ...JANELA,
    ...(grupo ? { p_grupo: grupo } : {}),
  });
  expect(error).toBeNull();
  return data as Vendas;
}

async function linhasDe(contato: string) {
  const { data } = await admin
    .from("venda_da_jornada")
    .select("etapa_chave, value_cents")
    .eq("contact_id", contato)
    .order("vendido_em")
    .throwOnError();
  return data ?? [];
}

async function mover(contato: string, etapa: string): Promise<void> {
  await admin
    .from("contact")
    .update({ funnel_stage: etapa })
    .eq("id", contato)
    .throwOnError();
}

async function contato(
  final: string,
  campos: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849900711${final}`,
      ...campos,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function consulta(contatoId: string, precoCents: number): Promise<void> {
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: profissional,
      procedure_id: procedimento,
      insurance_id: null,
      price_cents: precoCents,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const inicio = new Date(Date.now() + 86_400_000 + Math.random() * 3_600_000);
  await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contatoId,
      professional_id: profissional,
      service_link_id: vinculo!.id,
      status: "agendado",
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
    })
    .throwOnError();
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Venda pela Jornada ${sufixo}`,
        slug: `venda-jornada-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Sem venda ${sufixo}`,
        slug: `sem-venda-jornada-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicId = clinicas!.find((c) => c.slug === `venda-jornada-${sufixo}`)!
    .id as string;
  clinicaSemVenda = clinicas!.find(
    (c) => c.slug === `sem-venda-jornada-${sufixo}`,
  )!.id as string;

  await admin
    .from("funnel_stage_def")
    .update({ is_sale: true, value_source: "fixo", value_cents: 25_000 })
    .eq("clinic_id", clinicId)
    .eq("chave", "em_contato")
    .throwOnError();
  await admin
    .from("funnel_stage_def")
    .update({ is_sale: true, value_source: "service_link", value_cents: null })
    .eq("clinic_id", clinicId)
    .eq("chave", "compareceu")
    .throwOnError();

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Venda" })
    .select("id")
    .single()
    .throwOnError();
  profissional = prof!.id as string;
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Avaliação",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  procedimento = proc!.id as string;

  await admin
    .from("meta_anuncio")
    .insert({
      clinic_id: clinicId,
      ad_id: `7${CAMPANHA}`,
      ad_account_id: "act_7654321",
      campaign_id: CAMPANHA,
      campaign_name: "Implante Novembro",
    })
    .throwOnError();

  contatos.X = await contato("01", {
    ctwa_clid: `clid-venda-${sufixo}`,
    source_ad_id: `7${CAMPANHA}`,
  });
  contatos.Y = await contato("02", {
    source_campaign: "Check-up",
    source_channel: "indicacao",
  });
  await nascerDeMensagem(admin, [clinicId], [contatos.Y]);
  contatos.Z = await contato("03");
  contatos.W = await contato("04");
}, 60_000);

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicId, clinicaSemVenda]);
});

describe("o gatilho de venda", () => {
  it("entrar numa etapa de venda grava uma linha com o valor da etapa", async () => {
    await mover(contatos.X, "em_contato");
    expect(await linhasDe(contatos.X)).toEqual([
      { etapa_chave: "em_contato", value_cents: 25_000 },
    ]);
  });

  it("sair e voltar grava de novo; etapa comum não grava", async () => {
    await mover(contatos.X, "novo");
    await mover(contatos.X, "em_contato");
    await mover(contatos.X, "agendou");
    expect(await linhasDe(contatos.X)).toEqual([
      { etapa_chave: "em_contato", value_cents: 25_000 },
      { etapa_chave: "em_contato", value_cents: 25_000 },
    ]);
  });

  it("pelo preço da consulta do agendamento, ou sem valor sem consulta", async () => {
    // A consulta leva o contato a Agendou (etapa comum: nada grava).
    await consulta(contatos.Y, 30_000);
    expect(await linhasDe(contatos.Y)).toEqual([]);
    await mover(contatos.Y, "compareceu");
    expect(await linhasDe(contatos.Y)).toEqual([
      { etapa_chave: "compareceu", value_cents: 30_000 },
    ]);
    await mover(contatos.Z, "compareceu");
    expect(await linhasDe(contatos.Z)).toEqual([
      { etapa_chave: "compareceu", value_cents: null },
    ]);
  });

  it("o registro falha (valor negativo) e a mudança de etapa acontece mesmo assim", async () => {
    await consulta(contatos.W, -1);
    await mover(contatos.W, "compareceu");
    const { data } = await admin
      .from("contact")
      .select("funnel_stage")
      .eq("id", contatos.W)
      .single()
      .throwOnError();
    expect(data!.funnel_stage).toBe("compareceu");
    expect(await linhasDe(contatos.W)).toEqual([]);
  });
});

describe("vendas_do_periodo", () => {
  it("o total, o valor somado e as sem valor, pelo momento da venda", async () => {
    expect(await vendasDoPeriodo(clinicId)).toEqual({
      tem_etapa_de_venda: true,
      vendas: 4,
      valor_cents: 80_000,
      sem_valor: 1,
    });
    // Fora da janela: nenhuma.
    const { data } = await admin.rpc("vendas_do_periodo", {
      p_clinic_id: clinicId,
      p_de: "2026-01-01T03:00:00.000Z",
      p_ate: "2026-02-01T03:00:00.000Z",
    });
    expect(data).toMatchObject({ vendas: 0, valor_cents: 0 });
  });

  it("o recorte por grupo de origem", async () => {
    expect(await vendasDoPeriodo(clinicId, "meta")).toMatchObject({
      vendas: 2,
      valor_cents: 50_000,
    });
    expect(await vendasDoPeriodo(clinicId, "outras")).toMatchObject({
      vendas: 1,
      valor_cents: 30_000,
    });
    expect(await vendasDoPeriodo(clinicId, "nao_rastreada")).toMatchObject({
      vendas: 1,
      valor_cents: 0,
      sem_valor: 1,
    });
    expect(await vendasDoPeriodo(clinicId, "google")).toMatchObject({
      vendas: 0,
    });
  });

  it("clínica sem etapa de venda diz isso", async () => {
    expect(await vendasDoPeriodo(clinicaSemVenda)).toEqual({
      tem_etapa_de_venda: false,
      vendas: 0,
      valor_cents: 0,
      sem_valor: 0,
    });
  });
});

describe("campanhas_do_periodo: Vendas e Valor das vendas", () => {
  type Linha = {
    chave: string;
    leads: number;
    vendas: number | null;
    valor_das_vendas_cents: number | null;
    vendas_sem_valor: number | null;
  };
  type Bloco = { linhas: Linha[]; tem_etapa_de_venda: boolean | null };

  it("a venda entra na campanha do contato; a campanha só com venda vira linha", async () => {
    const { data, error } = await admin.rpc("campanhas_do_periodo", {
      p_clinic_id: clinicId,
      ...JANELA,
    });
    expect(error).toBeNull();
    const atual = (data as { atual: Bloco }).atual;
    expect(atual.tem_etapa_de_venda).toBe(true);
    const porChave = Object.fromEntries(
      atual.linhas.map((linha) => [linha.chave, linha]),
    );
    // X nao e lead: a linha da campanha existe so pela venda.
    expect(porChave[`meta:${CAMPANHA}`]).toMatchObject({
      leads: 0,
      vendas: 2,
      valor_das_vendas_cents: 50_000,
      vendas_sem_valor: 0,
    });
    // Y e lead do periodo e vendeu: os dois na mesma linha de texto.
    expect(porChave["texto:Check-up"]).toMatchObject({
      leads: 1,
      vendas: 1,
      valor_das_vendas_cents: 30_000,
      vendas_sem_valor: 0,
    });
  });
});
