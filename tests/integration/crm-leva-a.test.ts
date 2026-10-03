import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diaCivil, limitesDoDia, somarDias } from "@/lib/domain/horarios";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// CRM, Leva A (migration 20261002120000) contra o banco REAL, pelo service
// role (sem sessao: auth.uid() nulo, o caminho do motor da Leva B). O que a
// RLS por papel decide esta em tests/rls/crm-leva-a.test.ts. Aqui ficam o
// que so o banco calcula:
//   - due_on sai de due_at no fuso DA CLINICA, com a virada do dia certa, e
//     acompanha o instante quando a clinica troca de fuso (com hora, quem
//     manda e due_at; sem hora, o dia escolhido nao muda);
//   - carimbos de concluida e cancelada sem sessao (autor nulo);
//   - regras de origem (manual exige autor; automacao exige a regra);
//   - responsavel que saiu da equipe nao trava a atividade;
//   - conversa apagada solta a atividade; clinica apagada leva tudo;
//   - contagem_de_atividades com o "hoje" no fuso da clinica.
// Mesmos cenarios do ensaio (scratchpad fluxo/corrigir/banco-a/asserts.sql).
// Clinicas e_de_teste: o motor de producao as ignora.
//
// ORDEM DE APLICACAO: os casos de origem 'automacao' usam uma automacao_fluxo
// real, porque a migration da Leva B (20261002130000) poe FK em
// contact_activity.automacao_id. Este arquivo pressupoe as DUAS migrations
// aplicadas (elas sobem juntas); so com a Leva A, novaRegra falha porque a
// tabela automacao_fluxo ainda nao existe.

const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = Date.now().toString(36);
const TZ = "America/Fortaleza";
const hoje = diaCivil(TZ, new Date());

let clinica = "";
let clinicaFuso = "";
let contato = "";
let contatoFuso = "";
let conversa = "";
let responsavel = "";
let autor = "";
const usuarios: string[] = [];

async function novoUsuario(apelido: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `crm-leva-a-int-${apelido}-${sufixo}@teste.dev`,
    password: "CrmLevaA!Int2026",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.push(data.user.id);
  return data.user.id;
}

async function novaClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `crm-leva-a-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function novoContato(clinicId: string, final: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+5584966${Date.now().toString().slice(-4)}${final}`,
      kind: "lead",
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/**
 * Uma regra de automacao real da clinica (Leva B), para o automacao_id que a
 * FK confere. Nasce desligada (ativa false por padrao): o motor nao a roda.
 * A etapa 'novo' e a etiqueta 'urgente' vem da semeadura de toda clinica.
 */
async function novaRegra(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("automacao_fluxo")
    .insert({
      clinic_id: clinicId,
      nome: "Regra",
      gatilho: "entrou_na_etapa",
      etapa: "novo",
      acao: "etiquetar",
      etiqueta: "urgente",
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

type Prazo = { due_on: string; due_at: string | null };

async function prazo(atividadeId: string): Promise<Prazo> {
  const { data } = await admin
    .from("contact_activity")
    .select("due_on, due_at")
    .eq("id", atividadeId)
    .single()
    .throwOnError();
  return data as Prazo;
}

/** Cria sem sessao, como pessoa (created_by = autor), e devolve o id. */
async function novaAtividade(campos: Record<string, unknown>): Promise<string> {
  const { data } = await admin
    .from("contact_activity")
    .insert({
      clinic_id: clinica,
      contact_id: contato,
      titulo: "Atividade de teste",
      due_on: hoje,
      created_by: autor,
      ...campos,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

beforeAll(async () => {
  clinica = await novaClinica("Fortaleza");
  clinicaFuso = await novaClinica("Fuso");
  autor = await novoUsuario("autor");
  responsavel = await novoUsuario("responsavel");
  await admin
    .from("clinic_member")
    .insert([
      { clinic_id: clinica, user_id: autor, role: "recepcao", status: "ativo" },
      {
        clinic_id: clinica,
        user_id: responsavel,
        role: "recepcao",
        status: "ativo",
      },
      {
        clinic_id: clinicaFuso,
        user_id: autor,
        role: "recepcao",
        status: "ativo",
      },
    ])
    .throwOnError();
  contato = await novoContato(clinica, "01");
  contatoFuso = await novoContato(clinicaFuso, "02");
  const numero = await criarNumeroDeTeste(admin, clinica);
  const { data: conv } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinica,
      contact_id: contato,
      whatsapp_account_id: numero.id,
    })
    .select("id")
    .single()
    .throwOnError();
  conversa = conv!.id as string;
});

afterAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .in("id", [clinica, clinicaFuso].filter(Boolean));
  for (const usuario of usuarios) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

describe("due_on no fuso da clínica", () => {
  it("vira o dia à meia-noite de Fortaleza (03:00 UTC), não à meia-noite UTC", async () => {
    const antes = await novaAtividade({
      due_on: "2030-01-01",
      due_at: "2026-12-01T02:59:59Z",
    });
    expect((await prazo(antes)).due_on).toBe("2026-11-30");

    const depois = await novaAtividade({ due_at: "2026-12-01T03:00:00Z" });
    expect((await prazo(depois)).due_on).toBe("2026-12-01");
  });

  it("mexer só no due_on com hora marcada não descasa; tirar a hora vale o dia mandado", async () => {
    const atividade = await novaAtividade({ due_at: "2026-12-05T12:00:00Z" });
    await admin
      .from("contact_activity")
      .update({ due_on: "2031-01-01" })
      .eq("id", atividade)
      .throwOnError();
    expect((await prazo(atividade)).due_on).toBe("2026-12-05");

    await admin
      .from("contact_activity")
      .update({ due_at: null, due_on: "2026-12-10" })
      .eq("id", atividade)
      .throwOnError();
    expect(await prazo(atividade)).toEqual({
      due_on: "2026-12-10",
      due_at: null,
    });
  });

  it("usa o fuso DA CLÍNICA e recalcula o dia quando o fuso da clínica muda", async () => {
    await admin
      .from("clinic")
      .update({ timezone: "Asia/Tokyo" })
      .eq("id", clinicaFuso)
      .throwOnError();
    const { data } = await admin
      .from("contact_activity")
      .insert({
        clinic_id: clinicaFuso,
        contact_id: contatoFuso,
        titulo: "Em Tóquio",
        due_on: "2026-12-01",
        due_at: "2026-12-01T15:30:00Z",
        created_by: autor,
      })
      .select("id, due_on")
      .single()
      .throwOnError();
    // 15:30 UTC = 00:30 do dia 2 em Tóquio (UTC+9)
    expect(data!.due_on).toBe("2026-12-02");

    // Sem hora: o dia escolhido nao acompanha o fuso.
    const semHora = await admin
      .from("contact_activity")
      .insert({
        clinic_id: clinicaFuso,
        contact_id: contatoFuso,
        titulo: "Sem hora em Tóquio",
        due_on: "2026-12-02",
        created_by: autor,
      })
      .select("id")
      .single()
      .throwOnError();

    // A clinica volta para Fortaleza: o MESMO instante (15:30 UTC) e 12:30
    // do dia 1 la, e o dia acompanha sem ninguem editar a atividade.
    await admin
      .from("clinic")
      .update({ timezone: TZ })
      .eq("id", clinicaFuso)
      .throwOnError();
    const depoisDaTroca = await prazo(data!.id as string);
    expect(depoisDaTroca.due_on).toBe("2026-12-01");
    expect(new Date(depoisDaTroca.due_at!).toISOString()).toBe(
      "2026-12-01T15:30:00.000Z",
    );
    expect((await prazo(semHora.data!.id as string)).due_on).toBe(
      "2026-12-02",
    );

    // Editar so o titulo depois nao mexe no dia (ja certo).
    await admin
      .from("contact_activity")
      .update({ titulo: "Em Tóquio, editada" })
      .eq("id", data!.id)
      .throwOnError();
    expect((await prazo(data!.id as string)).due_on).toBe("2026-12-01");

    await admin
      .from("contact_activity")
      .update({ due_at: "2026-12-01T15:30:01Z" })
      .eq("id", data!.id)
      .throwOnError();
    expect((await prazo(data!.id as string)).due_on).toBe("2026-12-01");
  });
});

describe("carimbos e origem sem sessão", () => {
  it("concluir e cancelar sem sessão carimbam a hora com autor nulo; reabrir limpa", async () => {
    const atividade = await novaAtividade({ titulo: "Carimbo do motor" });
    await admin
      .from("contact_activity")
      .update({ status: "concluida", completed_by: autor })
      .eq("id", atividade)
      .throwOnError();
    const { data: concluida } = await admin
      .from("contact_activity")
      .select("completed_at, completed_by, canceled_at")
      .eq("id", atividade)
      .single()
      .throwOnError();
    expect(concluida!.completed_at).not.toBeNull();
    expect(concluida!.completed_by).toBeNull();
    expect(concluida!.canceled_at).toBeNull();

    await admin
      .from("contact_activity")
      .update({ status: "cancelada" })
      .eq("id", atividade)
      .throwOnError();
    const { data: cancelada } = await admin
      .from("contact_activity")
      .select("completed_at, canceled_at, canceled_by")
      .eq("id", atividade)
      .single()
      .throwOnError();
    expect(cancelada).toMatchObject({ completed_at: null, canceled_by: null });
    expect(cancelada!.canceled_at).not.toBeNull();

    await admin
      .from("contact_activity")
      .update({ status: "pendente" })
      .eq("id", atividade)
      .throwOnError();
    const { data: reaberta } = await admin
      .from("contact_activity")
      .select("completed_at, canceled_at")
      .eq("id", atividade)
      .single()
      .throwOnError();
    expect(reaberta).toEqual({ completed_at: null, canceled_at: null });
  });

  it("manual exige autor; automação exige a regra; regra só com origem automação", async () => {
    const base = {
      clinic_id: clinica,
      contact_id: contato,
      titulo: "Origem",
      due_on: hoje,
    };
    const semAutor = await admin.from("contact_activity").insert(base);
    expect(semAutor.error?.code).toBe(CHECK_VIOLATION);

    const semRegra = await admin
      .from("contact_activity")
      .insert({ ...base, origem: "automacao" });
    expect(semRegra.error?.code).toBe(CHECK_VIOLATION);

    const manualComRegra = await admin
      .from("contact_activity")
      .insert({
        ...base,
        created_by: autor,
        automacao_id: crypto.randomUUID(),
      });
    expect(manualComRegra.error?.code).toBe(CHECK_VIOLATION);

    const regra = await novaRegra(clinica);
    const { data, error } = await admin
      .from("contact_activity")
      .insert({
        ...base,
        origem: "automacao",
        automacao_id: regra,
        assignee_user_id: responsavel,
      })
      .select("id, created_by, automacao_id")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ created_by: null, automacao_id: regra });

    // automacao_id so pode virar nulo
    const trocar = await admin
      .from("contact_activity")
      .update({ automacao_id: crypto.randomUUID() })
      .eq("id", data!.id);
    expect(trocar.error?.code).toBe(CHECK_VIOLATION);
    const limpar = await admin
      .from("contact_activity")
      .update({ automacao_id: null })
      .eq("id", data!.id);
    expect(limpar.error).toBeNull();
  });

  it("responsável que saiu da equipe não trava a atividade; reatribuir para ele é recusado", async () => {
    const atividade = await novaAtividade({
      titulo: "Do responsável",
      assignee_user_id: responsavel,
    });
    await admin
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinica)
      .eq("user_id", responsavel)
      .throwOnError();
    try {
      const editar = await admin
        .from("contact_activity")
        .update({ titulo: "Do responsável que saiu", status: "concluida" })
        .eq("id", atividade);
      expect(editar.error).toBeNull();

      const outra = await novaAtividade({ titulo: "Sem responsável" });
      const reatribuir = await admin
        .from("contact_activity")
        .update({ assignee_user_id: responsavel })
        .eq("id", outra);
      expect(reatribuir.error?.code).toBe(CHECK_VIOLATION);
    } finally {
      await admin
        .from("clinic_member")
        .update({ status: "ativo" })
        .eq("clinic_id", clinica)
        .eq("user_id", responsavel)
        .throwOnError();
    }
  });

  it("conversa apagada solta a atividade", async () => {
    const atividade = await novaAtividade({
      titulo: "Da conversa",
      conversation_id: conversa,
    });
    await admin.from("conversation").delete().eq("id", conversa).throwOnError();
    const { data } = await admin
      .from("contact_activity")
      .select("conversation_id")
      .eq("id", atividade)
      .single()
      .throwOnError();
    expect(data!.conversation_id).toBeNull();
  });
});

describe("contagem_de_atividades no fuso da clínica", () => {
  type Contagem = {
    atrasadas: number;
    hoje: number;
    minhas_atrasadas: number;
    minhas_hoje: number;
  };

  async function contar(clinicId: string): Promise<Contagem> {
    const { data, error } = await admin.rpc("contagem_de_atividades", {
      p_clinic_id: clinicId,
    });
    expect(error).toBeNull();
    return data as Contagem;
  }

  it("hora de hoje que passou é atrasada; hora de hoje que vem é para hoje", async () => {
    await admin
      .from("contact_activity")
      .delete()
      .eq("clinic_id", clinica)
      .throwOnError();
    const agora = Date.now();
    const { fim } = limitesDoDia(TZ, hoje);
    const aindaHoje = new Date(
      agora + (fim.getTime() - agora) / 2,
    ).toISOString();
    await novaAtividade({ titulo: "ontem", due_on: somarDias(hoje, -1) });
    await novaAtividade({ titulo: "hoje sem hora", due_on: hoje });
    await novaAtividade({
      titulo: "hora que passou",
      due_at: new Date(agora - 60_000).toISOString(),
    });
    await novaAtividade({ titulo: "hora ainda hoje", due_at: aindaHoje });
    await novaAtividade({ titulo: "amanhã", due_on: somarDias(hoje, 1) });
    const concluida = await novaAtividade({
      titulo: "concluída ontem",
      due_on: somarDias(hoje, -1),
    });
    await admin
      .from("contact_activity")
      .update({ status: "concluida" })
      .eq("id", concluida)
      .throwOnError();

    // Sem sessao, "minhas" e sempre zero.
    expect(await contar(clinica)).toEqual({
      atrasadas: 2,
      hoje: 2,
      minhas_atrasadas: 0,
      minhas_hoje: 0,
    });
  });

  it("o hoje é o da clínica: Kiritimati (UTC+14) está à frente de Pago Pago (UTC-11)", async () => {
    await admin
      .from("contact_activity")
      .delete()
      .eq("clinic_id", clinicaFuso)
      .throwOnError();
    const agora = new Date();
    await admin
      .from("contact_activity")
      .insert([
        {
          clinic_id: clinicaFuso,
          contact_id: contatoFuso,
          titulo: "dia de Kiritimati",
          due_on: diaCivil("Pacific/Kiritimati", agora),
          created_by: autor,
        },
        {
          clinic_id: clinicaFuso,
          contact_id: contatoFuso,
          titulo: "dia de Pago Pago",
          due_on: diaCivil("Pacific/Pago_Pago", agora),
          created_by: autor,
        },
      ])
      .throwOnError();

    await admin
      .from("clinic")
      .update({ timezone: "Pacific/Kiritimati" })
      .eq("id", clinicaFuso)
      .throwOnError();
    expect(await contar(clinicaFuso)).toMatchObject({ atrasadas: 1, hoje: 1 });

    await admin
      .from("clinic")
      .update({ timezone: "Pacific/Pago_Pago" })
      .eq("id", clinicaFuso)
      .throwOnError();
    expect(await contar(clinicaFuso)).toMatchObject({ atrasadas: 0, hoje: 1 });

    await admin
      .from("clinic")
      .update({ timezone: TZ })
      .eq("id", clinicaFuso)
      .throwOnError();
  });

  it("prazo com hora acompanha a troca de fuso: o que vence hoje no fuso novo conta em hoje", async () => {
    await admin
      .from("contact_activity")
      .delete()
      .eq("clinic_id", clinicaFuso)
      .throwOnError();
    // Kiritimati fica 25 horas a frente de Pago Pago: um instante de HOJE em
    // Pago Pago e 1 ou 2 dias depois em Kiritimati.
    await admin
      .from("clinic")
      .update({ timezone: "Pacific/Kiritimati" })
      .eq("id", clinicaFuso)
      .throwOnError();
    try {
      const agora = Date.now();
      const diaPagoPago = diaCivil("Pacific/Pago_Pago", new Date(agora));
      const { fim } = limitesDoDia("Pacific/Pago_Pago", diaPagoPago);
      const venceHoje = new Date(
        agora + (fim.getTime() - agora) / 2,
      ).toISOString();
      const { data } = await admin
        .from("contact_activity")
        .insert({
          clinic_id: clinicaFuso,
          contact_id: contatoFuso,
          titulo: "Vence hoje em Pago Pago",
          due_on: diaPagoPago,
          due_at: venceHoje,
          created_by: autor,
        })
        .select("id, due_on")
        .single()
        .throwOnError();
      expect(data!.due_on).not.toBe(diaPagoPago);

      await admin
        .from("clinic")
        .update({ timezone: "Pacific/Pago_Pago" })
        .eq("id", clinicaFuso)
        .throwOnError();
      expect((await prazo(data!.id as string)).due_on).toBe(diaPagoPago);
      expect(await contar(clinicaFuso)).toMatchObject({
        atrasadas: 0,
        hoje: 1,
      });
    } finally {
      await admin
        .from("clinic")
        .update({ timezone: TZ })
        .eq("id", clinicaFuso)
        .throwOnError();
    }
  });
});

describe("apagamento em cascata", () => {
  it("a clínica apagada leva as atividades e as mensagens padrão", async () => {
    const descartavel = await novaClinica("Descartavel");
    const contatoDescartavel = await novoContato(descartavel, "09");
    await admin
      .from("contact_activity")
      .insert({
        clinic_id: descartavel,
        contact_id: contatoDescartavel,
        titulo: "Vai junto",
        due_on: hoje,
        origem: "automacao",
        automacao_id: await novaRegra(descartavel),
      })
      .throwOnError();
    await admin
      .from("resposta_rapida")
      .insert({
        clinic_id: descartavel,
        atalho: "vai_junto",
        titulo: "Vai junto",
        corpo: "x",
      })
      .throwOnError();

    await admin.from("clinic").delete().eq("id", descartavel).throwOnError();
    const atividades = await admin
      .from("contact_activity")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", descartavel);
    const respostas = await admin
      .from("resposta_rapida")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", descartavel);
    expect(atividades.count).toBe(0);
    expect(respostas.count).toBe(0);
  });
});
