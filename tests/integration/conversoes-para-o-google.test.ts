import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  gerarCsvDoGoogle,
  lerConversoesParaOGoogle,
  linhasDoArquivoDoGoogle,
} from "@/lib/domain/conversoes-google";
import { adminClient } from "../rls/stack";

// conversoes_para_o_google (etapa 6A do plano de 16/11/2026, migration
// 20261116170000), contra o banco REAL. Aceite: so sai a conversao de contato
// que chegou por anuncio do Google, com o gclid do clique confirmado mais
// recente de antes da conversao; o clique so com gbraid ou wbraid (iPhone) e
// contado a parte; o provavel, o clique depois da conversao, o contato sem
// clique, a conversao fora do periodo e a de outra clinica ficam de fora.
//
// CUIDADO, o banco de desenvolvimento e a producao: clinicas de teste
// (e_de_teste), apagadas no afterAll. RLS em tests/rls/clique-do-site.test.ts.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const DIA = 86_400_000;
const agora = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

let clinicId = "";
let outraClinica = "";
let telefone = 0;
let codigo = 0;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Google ${nome} ${sufixo}`,
      slug: `google-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function contato(clinica: string): Promise<string> {
  telefone += 1;
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinica,
      phone_e164: `+55849722${String(telefone).padStart(5, "0")}`,
      name: "Contato Google",
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Clique ja casado com o contato, criado `diasAtras` dias atras. */
async function clique(
  clinica: string,
  contactId: string,
  diasAtras: number,
  campos: Record<string, unknown>,
): Promise<void> {
  codigo += 1;
  const criado = agora - diasAtras * DIA;
  // Alfabeto dos codigos: sem 0, 1, I, L e O.
  const digitos = String(codigo).padStart(3, "2").replace(/[01]/g, "9");
  await admin
    .from("clique_do_site")
    .insert({
      clinic_id: clinica,
      codigo: `GGG${digitos}`,
      criado_em: iso(criado),
      valido_ate: iso(criado + 6 * DIA),
      contact_id: contactId,
      casado_em: iso(criado + 60_000),
      ...campos,
    })
    .throwOnError();
}

async function conversao(
  clinica: string,
  contactId: string,
  diasAtras: number,
  campos: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("conversion_event")
    .insert({
      clinic_id: clinica,
      contact_id: contactId,
      stage_chave: "agendou",
      event_name: "Schedule",
      value_cents: 25000,
      created_at: iso(agora - diasAtras * DIA),
      ...campos,
    })
    .select("event_id")
    .single()
    .throwOnError();
  return data!.event_id as string;
}

async function exportar(clinica = clinicId, de = agora - 30 * DIA, ate = agora + DIA) {
  const { data, error } = await admin.rpc("conversoes_para_o_google", {
    p_clinic_id: clinica,
    p_de: iso(de),
    p_ate: iso(ate),
  });
  expect(error).toBeNull();
  return data as {
    linhas: Record<string, unknown>[];
    sem_gclid: number;
  };
}

const eventos: Record<string, string> = {};

beforeAll(async () => {
  clinicId = await criarClinica("a");
  outraClinica = await criarClinica("b");

  // 1. Veio do Google: dois cliques antes da conversao, vale o mais recente.
  const comGclid = await contato(clinicId);
  await clique(clinicId, comGclid, 10, { gclid: `gclid-velho-${sufixo}` });
  await clique(clinicId, comGclid, 5, { gclid: `gclid-novo-${sufixo}` });
  eventos.comGclid = await conversao(clinicId, comGclid, 2);
  // A mesma pessoa em outra etapa, sem valor.
  eventos.semValor = await conversao(clinicId, comGclid, 1, {
    stage_chave: "compareceu",
    event_name: "Purchase",
    value_cents: null,
  });

  // 2. iPhone: so gbraid. Contado a parte.
  const soBraid = await contato(clinicId);
  await clique(clinicId, soBraid, 5, { gbraid: `gbraid-${sufixo}` });
  await conversao(clinicId, soBraid, 2);

  // 3. Clique provavel (casado so pela janela): nao prova o anuncio.
  const provavel = await contato(clinicId);
  await clique(clinicId, provavel, 5, {
    gclid: `gclid-provavel-${sufixo}`,
    provavel: true,
  });
  await conversao(clinicId, provavel, 2);

  // 4. O clique veio DEPOIS da conversao: nao e dele.
  const depois = await contato(clinicId);
  await clique(clinicId, depois, 1, { gclid: `gclid-depois-${sufixo}` });
  await conversao(clinicId, depois, 3);

  // 5. Sem clique do Google (so da Meta): fora.
  const daMeta = await contato(clinicId);
  await clique(clinicId, daMeta, 5, { fbclid: `fbclid-${sufixo}` });
  await conversao(clinicId, daMeta, 2);

  // 6. Conversao antiga, fora do periodo pedido.
  const antiga = await contato(clinicId);
  await clique(clinicId, antiga, 80, { gclid: `gclid-antigo-${sufixo}` });
  await conversao(clinicId, antiga, 60);

  // 7. Outra clinica.
  const daOutra = await contato(outraClinica);
  await clique(outraClinica, daOutra, 5, { gclid: `gclid-outra-${sufixo}` });
  await conversao(outraClinica, daOutra, 2);
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicId, outraClinica]);
});

describe("conversoes_para_o_google", () => {
  it("só as conversões de quem veio do Google, com o gclid do clique mais recente de antes dela, na ordem em que aconteceram", async () => {
    const { linhas, sem_gclid } = await exportar();
    expect(linhas).toEqual([
      {
        gclid: `gclid-novo-${sufixo}`,
        etapa: "agendou",
        convertido_em: expect.any(String),
        valor_cents: 25000,
        moeda: "BRL",
        evento_id: eventos.comGclid,
      },
      {
        gclid: `gclid-novo-${sufixo}`,
        etapa: "compareceu",
        convertido_em: expect.any(String),
        valor_cents: null,
        moeda: "BRL",
        evento_id: eventos.semValor,
      },
    ]);
    // O clique de iPhone (so gbraid) fica de fora do arquivo e e contado.
    expect(sem_gclid).toBe(1);
    // Nada do provavel, do clique que veio depois, da Meta, do antigo ou da
    // outra clinica.
    const tudo = JSON.stringify(linhas);
    for (const fora of ["provavel", "depois", "fbclid", "antigo", "outra"]) {
      expect(tudo).not.toContain(fora);
    }
  });

  it("o retorno passa pelo leitor e vira o arquivo no formato do Google", async () => {
    const lido = lerConversoesParaOGoogle(await exportar());
    expect(lido).not.toBeNull();
    const csv = gerarCsvDoGoogle(
      linhasDoArquivoDoGoogle(lido!.linhas, "America/Fortaleza"),
    ).split("\r\n");
    expect(csv[0]).toBe(
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID",
    );
    expect(csv[1]).toMatch(
      new RegExp(
        `^gclid-novo-${sufixo},agendou,\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}-0300,250\\.00,BRL,${eventos.comGclid}$`,
      ),
    );
    // Sem valor: as duas celulas vazias.
    expect(csv[2]).toContain(",compareceu,");
    expect(csv[2]).toContain(`,,,${eventos.semValor}`);
  });

  it("o período recorta pela hora da conversão; a outra clínica só vê as dela", async () => {
    // So a conversao de 60 dias atras.
    const antigas = await exportar(clinicId, agora - 70 * DIA, agora - 40 * DIA);
    expect(antigas.linhas.map((linha) => linha.gclid)).toEqual([
      `gclid-antigo-${sufixo}`,
    ]);
    const daOutra = await exportar(outraClinica);
    expect(daOutra.linhas.map((linha) => linha.gclid)).toEqual([
      `gclid-outra-${sufixo}`,
    ]);
    expect(daOutra.sem_gclid).toBe(0);
  });

  it("sem clínica, sem período ou com o período invertido: 22023", async () => {
    const casos = [
      { p_clinic_id: null, p_de: iso(agora - DIA), p_ate: iso(agora) },
      { p_clinic_id: clinicId, p_de: null, p_ate: iso(agora) },
      { p_clinic_id: clinicId, p_de: iso(agora), p_ate: iso(agora - DIA) },
    ];
    for (const args of casos) {
      const { error } = await admin.rpc(
        "conversoes_para_o_google",
        args as { p_clinic_id: string; p_de: string; p_ate: string },
      );
      expect(error?.code).toBe("22023");
    }
  });
});
