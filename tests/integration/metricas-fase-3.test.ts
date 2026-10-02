import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  diaCivil,
  instanteLocal,
  limitesDoDia,
  somarDias,
} from "@/lib/domain/horarios";
import { adminClient } from "../rls/stack";

// Fase 3, metricas (migration 20261002110000) contra o banco REAL, com
// fixtures data a data no fuso da clinica. Mesmos cenarios do ensaio da
// migration (scratchpad fase3/banco/asserts.sql). O cliente de servico passa
// pelas travas de papel (auth.uid() nulo); quem recebe null esta em
// tests/rls/metricas-fase-3.test.ts. Clinicas e_de_teste: o motor de
// producao as ignora.
//
// Toda consulta dura 1 minuto, para nao esbarrar na trava de sobreposicao do
// profissional.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const TZ = "America/Fortaleza";

const hoje = diaCivil(TZ, new Date());
const inicioDoMes = `${hoje.slice(0, 7)}-01`;
const dia = (deslocamento: number) => somarDias(hoje, deslocamento);
const local = (diaLocal: string, hora: string) =>
  instanteLocal(TZ, diaLocal, hora).toISOString();
const maisMinutos = (instante: string, minutos: number) =>
  new Date(new Date(instante).getTime() + minutos * 60_000).toISOString();

const clinicas: string[] = [];

type Cadastro = {
  clinicId: string;
  profissional: string;
};

async function novaClinica(nome: string): Promise<Cadastro> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `metr-f3-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicas.push(clinica!.id as string);
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinica!.id, name: `Dra. ${nome}` })
    .select("id")
    .single()
    .throwOnError();
  return { clinicId: clinica!.id as string, profissional: prof!.id as string };
}

async function novoProcedimento(
  clinicId: string,
  nome: string,
  base: number | null,
): Promise<string> {
  const { data } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: nome, base_price_cents: base })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function novoVinculo(
  c: Cadastro,
  procedimento: string,
  extra: {
    price_cents?: number | null;
    insurance_id?: string;
    covered_by_insurance?: boolean;
  } = {},
): Promise<string> {
  const { data } = await admin
    .from("service_link")
    .insert({
      clinic_id: c.clinicId,
      professional_id: c.profissional,
      procedure_id: procedimento,
      duration_min: 30,
      price_cents: null,
      ...extra,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function novoContato(
  clinicId: string,
  telefone: string,
  extra: { funnel_stage?: string; first_contact_at?: string } = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, ...extra })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

type Consulta = {
  contato: string;
  vinculo: string;
  inicio: string;
  status: string;
  canal?: string | null;
  unidade?: string | null;
  criadaEm?: string;
  profissional?: string;
};

async function novasConsultas(
  c: Cadastro,
  consultas: Consulta[],
): Promise<string[]> {
  const { data } = await admin
    .from("appointment")
    .insert(
      consultas.map((k) => ({
        clinic_id: c.clinicId,
        contact_id: k.contato,
        professional_id: k.profissional ?? c.profissional,
        service_link_id: k.vinculo,
        starts_at: k.inicio,
        ends_at: maisMinutos(k.inicio, 1),
        status: k.status,
        confirmation_channel: k.canal ?? null,
        unit_id: k.unidade ?? null,
        ...(k.criadaEm ? { created_at: k.criadaEm } : {}),
      })),
    )
    .select("id, starts_at")
    .throwOnError();
  // Na ordem do pedido, casando pelo inicio (unico em cada lote daqui): o
  // RETURNING do insert em lote nao promete ordem.
  const linhas = (data ?? []) as { id: string; starts_at: string }[];
  return consultas.map((k) => {
    const instante = new Date(k.inicio).getTime();
    const linha = linhas.find(
      (l) => new Date(l.starts_at).getTime() === instante,
    );
    if (!linha) {
      throw new Error("consulta da fixture nao voltou do insert");
    }
    return linha.id;
  });
}

async function passoDaRegua(clinicId: string, kind: string): Promise<string> {
  const { data } = await admin
    .from("cadence_step")
    .select("id, cadence:cadence_id!inner(kind)")
    .eq("clinic_id", clinicId)
    .eq("cadence.kind", kind)
    .order("offset_minutes", { ascending: true })
    .limit(1)
    .single()
    .throwOnError();
  return data!.id as string;
}

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
});

describe("consulta_foi_confirmada", () => {
  it("confirmada pelo status ou pelo canal com a consulta já em andamento ou encerrada", async () => {
    const casos: [string, string | null, boolean][] = [
      ["agendado", null, false],
      ["agendado", "whatsapp", false],
      ["aguardando_confirmacao", "whatsapp", false],
      ["confirmado_paciente", null, true],
      ["confirmado_recepcao", null, true],
      ["na_recepcao", null, false],
      ["na_recepcao", "telefone", true],
      ["em_atendimento", "presencial", true],
      ["compareceu", null, false],
      ["compareceu", "whatsapp", true],
      ["faltou", null, false],
      ["faltou", "whatsapp", true],
      ["cancelado_paciente", "whatsapp", false],
      ["cancelado_clinica", "whatsapp", false],
    ];
    for (const [status, canal, esperado] of casos) {
      const { data, error } = await admin.rpc("consulta_foi_confirmada", {
        p_status: status,
        p_canal: canal,
      });
      expect(error).toBeNull();
      expect({ status, canal, confirmada: data }).toEqual({
        status,
        canal,
        confirmada: esperado,
      });
    }
  });
});

describe("resumo_do_dia e funil_da_jornada", () => {
  let c: Cadastro;
  let ultimoDisparo = "";

  beforeAll(async () => {
    c = await novaClinica("Dia");
    const proc = await novoProcedimento(c.clinicId, "Consulta", 10000);
    const vinculo = await novoVinculo(c, proc);
    const { data: unidades } = await admin
      .from("unit")
      .insert([
        { clinic_id: c.clinicId, name: "Centro" },
        { clinic_id: c.clinicId, name: "Bairro" },
        { clinic_id: c.clinicId, name: "Norte" },
      ])
      .select("id, name")
      .throwOnError();
    const unidade = (nome: string) =>
      unidades!.find((u) => u.name === nome)!.id as string;
    const contato = await novoContato(c.clinicId, "+5584990040001", {
      funnel_stage: "novo",
    });
    await novoContato(c.clinicId, "+5584990040002", { funnel_stage: "novo" });
    await novoContato(c.clinicId, "+5584990040003", { funnel_stage: "novo" });
    await novoContato(c.clinicId, "+5584990040004", {
      funnel_stage: "em_contato",
    });
    const k = (
      inicio: string,
      status: string,
      canal: string | null = null,
      unidadeId: string | null = null,
    ): Consulta => ({
      contato,
      vinculo,
      inicio,
      status,
      canal,
      unidade: unidadeId,
    });

    const ids = await novasConsultas(c, [
      k(local(dia(-8), "23:59"), "agendado"),
      // D-7: 4 consultas, 2 confirmadas
      k(local(dia(-7), "00:00"), "agendado"),
      k(local(dia(-7), "10:00"), "compareceu", "presencial"),
      k(local(dia(-7), "11:00"), "faltou"),
      k(local(dia(-7), "23:59"), "confirmado_paciente", "whatsapp"),
      k(local(dia(-6), "00:00"), "agendado"),
      k(local(dia(-3), "15:00"), "cancelado_clinica"),
      // 23:30 de ontem e 02:30 UTC de hoje: e de ontem
      k(local(dia(-1), "23:30"), "agendado"),
      // hoje: 9 consultas
      k(local(hoje, "00:30"), "agendado"),
      k(local(hoje, "07:00"), "faltou", "telefone"),
      k(local(hoje, "08:00"), "compareceu", "whatsapp", unidade("Bairro")),
      k(
        local(hoje, "09:00"),
        "confirmado_paciente",
        "whatsapp",
        unidade("Centro"),
      ),
      k(
        local(hoje, "10:00"),
        "confirmado_recepcao",
        "telefone",
        unidade("Centro"),
      ),
      k(
        local(hoje, "12:00"),
        "cancelado_paciente",
        "whatsapp",
        unidade("Norte"),
      ),
      k(local(hoje, "13:00"), "aguardando_confirmacao"),
      k(local(hoje, "14:00"), "compareceu"),
      k(local(hoje, "23:59"), "agendado"),
      k(local(dia(1), "00:00"), "agendado"),
    ]);
    // Remarcada de volta: o gatilho preparar_remarcacao devolve para
    // agendado e limpa o canal; deixa de contar como confirmada.
    const remarcada = ids[12]!;
    await admin
      .from("appointment")
      .update({
        starts_at: local(hoje, "11:00"),
        ends_at: local(hoje, "11:01"),
      })
      .eq("id", remarcada)
      .throwOnError();

    const passoConfirmacao = await passoDaRegua(c.clinicId, "confirmacao");
    const passoPosFalta = await passoDaRegua(c.clinicId, "pos_falta");
    ultimoDisparo = local(hoje, "08:40");
    const run = (passo: string, agendada: string, enviada: string) => ({
      clinic_id: c.clinicId,
      cadence_step_id: passo,
      contact_id: contato,
      scheduled_for: agendada,
      sent_at: enviada,
    });
    await admin
      .from("cadence_run")
      .insert([
        run(passoConfirmacao, local(hoje, "06:00"), local(hoje, "07:15")),
        run(passoConfirmacao, local(hoje, "06:01"), ultimoDisparo),
        run(passoConfirmacao, local(dia(-1), "06:00"), local(dia(-1), "23:50")),
        // regua de pos falta nao e "disparo de confirmacao"
        run(passoPosFalta, local(hoje, "06:02"), local(hoje, "09:30")),
      ])
      .throwOnError();
  });

  it("conta o dia no fuso da clínica com o predicado único de confirmada", async () => {
    const { data, error } = await admin.rpc("resumo_do_dia", {
      p_clinic_id: c.clinicId,
      p_inicios: [6, 5, 4, 3, 2, 1, 0].map((n) =>
        limitesDoDia(TZ, dia(-n)).inicio.toISOString(),
      ),
      p_fim: limitesDoDia(TZ, hoje).fim.toISOString(),
      p_semana_passada_de: limitesDoDia(TZ, dia(-7)).inicio.toISOString(),
      p_semana_passada_ate: limitesDoDia(TZ, dia(-7)).fim.toISOString(),
    });
    expect(error).toBeNull();
    const resumo = data as {
      hoje: Record<string, number>;
      semana_passada: Record<string, number>;
      ultimo_disparo: string | null;
      por_dia: { ordem: number; total: number }[];
    };
    // Confirmadas: a que compareceu com canal, a que faltou com canal e a
    // confirmada. Fora: remarcada de volta, cancelada depois de confirmar e
    // a que compareceu sem confirmar.
    expect(resumo.hoje).toEqual({
      total: 9,
      confirmadas: 3,
      aguardando: 4,
      canceladas: 1,
      // a unidade da cancelada nao conta
      unidades: 2,
    });
    expect(resumo.semana_passada).toEqual({ total: 4, confirmadas: 2 });
    expect(new Date(resumo.ultimo_disparo!).getTime()).toBe(
      new Date(ultimoDisparo).getTime(),
    );
    expect(resumo.por_dia).toEqual([
      { ordem: 1, total: 1 },
      { ordem: 2, total: 0 },
      { ordem: 3, total: 0 },
      { ordem: 4, total: 1 },
      { ordem: 5, total: 0 },
      { ordem: 6, total: 1 },
      { ordem: 7, total: 9 },
    ]);
  });

  it("o funil é o retrato atual por etapa, com zero para etapa vazia, na ordem da jornada", async () => {
    const { data, error } = await admin.rpc("funil_da_jornada", {
      p_clinic_id: c.clinicId,
    });
    expect(error).toBeNull();
    const etapas = data as {
      chave: string;
      nome: string;
      papel: string | null;
      posicao: number;
      total: number;
    }[];
    expect(etapas.map((e) => [e.chave, e.total])).toEqual([
      ["novo", 2],
      ["em_contato", 1],
      ["aguardando_resposta", 0],
      // o contato das consultas avancou ao agendar
      ["agendou", 1],
      ["compareceu", 0],
      ["perdido", 0],
    ]);
    expect(etapas[0]).toEqual({
      chave: "novo",
      nome: "Novo",
      papel: "entrada",
      posicao: 10,
      total: 2,
    });
  });
});

describe("metricas_de_pacientes", () => {
  let c: Cadastro;
  let primeiroComparecimento = "";

  beforeAll(async () => {
    c = await novaClinica("Pacientes");
    const proc = await novoProcedimento(c.clinicId, "Consulta", null);
    const vinculo = await novoVinculo(c, proc);
    const contatos = new Map<string, string>();
    const nomes = [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
      "p11",
      "p12",
      "p13",
      "n1",
      "n2",
      "n3",
      "n4",
    ];
    for (const [i, nome] of nomes.entries()) {
      contatos.set(
        nome,
        await novoContato(
          c.clinicId,
          `+55849900410${String(i).padStart(2, "0")}`,
        ),
      );
    }
    const k = (
      nome: string,
      inicio: string,
      status: string,
      canal: string | null = null,
    ): Consulta => ({
      contato: contatos.get(nome)!,
      vinculo,
      inicio,
      status,
      canal,
    });
    primeiroComparecimento = local(dia(-400), "15:00");
    await novasConsultas(c, [
      // ativo so agora; consulta aberta antiga para nao ser "novo no mes"
      k("p1", local(dia(-10), "08:00"), "compareceu"),
      k("p1", local(dia(-400), "08:00"), "agendado"),
      // outra consulta no MESMO dia civil nao e retorno
      k("p2", local(dia(-100), "09:00"), "compareceu"),
      k("p2", local(dia(-100), "14:00"), "agendado"),
      // falta nao e retorno
      k("p3", local(dia(-120), "10:00"), "compareceu"),
      k("p3", local(dia(-100), "10:00"), "faltou"),
      // voltou em 80 dias
      k("p4", local(dia(-150), "11:00"), "compareceu"),
      k("p4", local(dia(-70), "11:00"), "compareceu"),
      // voltou so em 100 dias (os dois comparecimentos sao base)
      k("p5", local(dia(-200), "12:00"), "compareceu"),
      k("p5", local(dia(-100), "12:00"), "compareceu"),
      // cancelada nao e retorno; sem consulta ha mais de 6 meses
      k("p6", local(dia(-300), "13:00"), "compareceu"),
      k("p6", local(dia(-280), "13:00"), "cancelado_paciente"),
      // fora dos 13 meses: so "sem consulta" e o primeiro comparecimento
      k("p7", primeiroComparecimento, "compareceu"),
      // consulta futura marcada: nao e "sem consulta"
      k("p8", local(dia(-250), "16:00"), "compareceu"),
      k("p8", local(dia(10), "16:00"), "agendado"),
      k("p9", local(dia(-20), "17:00"), "compareceu"),
      k("p9", local(dia(-400), "17:00"), "agendado"),
      // ativo so ha 30 dias
      k("p10", local(dia(-380), "18:00"), "compareceu"),
      // voltou com consulta viva (confirmada, ainda aberta)
      k("p11", local(dia(-180), "19:00"), "compareceu"),
      k("p11", local(dia(-140), "19:00"), "confirmado_paciente", "whatsapp"),
      // 20:00 e 22:30 locais caem em dias UTC diferentes, mas no mesmo dia
      // civil da clinica: nao e retorno
      k("p12", local(dia(-160), "20:00"), "compareceu"),
      k("p12", local(dia(-160), "22:30"), "agendado"),
      // compareceu ha 250 dias, faltou ha 30, futura cancelada
      k("p13", local(dia(-250), "07:00"), "compareceu"),
      k("p13", local(dia(-30), "07:00"), "faltou"),
      k("p13", local(dia(5), "07:00"), "cancelado_paciente"),
      // novos no mes: n1 e n4 sim; n2 so cancelada; n3 ja tinha consulta
      k("n1", local(inicioDoMes, "06:00"), "agendado"),
      k("n2", local(inicioDoMes, "06:10"), "cancelado_clinica"),
      k("n3", local(somarDias(inicioDoMes, -5), "06:20"), "agendado"),
      k("n3", local(inicioDoMes, "06:20"), "agendado"),
      k(
        "n4",
        local(somarDias(inicioDoMes, -10), "06:30"),
        "cancelado_paciente",
      ),
      k("n4", local(inicioDoMes, "06:30"), "agendado"),
    ]);
  });

  it("ativos, novos, retorno em 90 dias e sem consulta há 6 meses, no fuso da clínica", async () => {
    const { data, error } = await admin.rpc("metricas_de_pacientes", {
      p_clinic_id: c.clinicId,
    });
    expect(error).toBeNull();
    const linha = (data as Record<string, number | string | null>[])[0]!;
    expect({ ...linha, primeiro_comparecimento: undefined }).toEqual({
      ativos: 11,
      ativos_30d_atras: 10,
      novos_no_mes: 2,
      retorno_base: 10,
      retorno_voltaram: 2,
      sem_contato_6m: 4,
      primeiro_comparecimento: undefined,
    });
    expect(new Date(linha.primeiro_comparecimento as string).getTime()).toBe(
      new Date(primeiroComparecimento).getTime(),
    );
  });

  it("clínica sem consulta: zeros e primeiro comparecimento nulo", async () => {
    const vazia = await novaClinica("Vazia");
    const { data } = await admin.rpc("metricas_de_pacientes", {
      p_clinic_id: vazia.clinicId,
    });
    expect((data as unknown[])[0]).toEqual({
      ativos: 0,
      ativos_30d_atras: 0,
      novos_no_mes: 0,
      retorno_base: 0,
      retorno_voltaram: 0,
      sem_contato_6m: 0,
      primeiro_comparecimento: null,
    });
  });
});

describe("faturamento, série diária e lista de espera", () => {
  let c: Cadastro;
  let vinculos: Record<
    "preco" | "base" | "coberto" | "copart" | "sem" | "zero",
    string
  >;
  let contato = "";

  beforeAll(async () => {
    c = await novaClinica("Faturamento");
    const comBase = await novoProcedimento(c.clinicId, "Com base", 20000);
    const comBase2 = await novoProcedimento(c.clinicId, "Com base 2", 20000);
    const semBase = await novoProcedimento(c.clinicId, "Sem base", null);
    const gratuito = await novoProcedimento(c.clinicId, "Gratuito", 5000);
    const { data: convenio } = await admin
      .from("insurance")
      .insert({ clinic_id: c.clinicId, name: "Convênio" })
      .select("id")
      .single()
      .throwOnError();
    vinculos = {
      preco: await novoVinculo(c, comBase, { price_cents: 15000 }),
      base: await novoVinculo(c, comBase2),
      coberto: await novoVinculo(c, comBase, {
        insurance_id: convenio!.id as string,
        covered_by_insurance: true,
      }),
      copart: await novoVinculo(c, comBase2, {
        insurance_id: convenio!.id as string,
        covered_by_insurance: true,
        price_cents: 3000,
      }),
      sem: await novoVinculo(c, semBase),
      zero: await novoVinculo(c, gratuito, { price_cents: 0 }),
    };
    contato = await novoContato(c.clinicId, "+5584990042001");
    const k = (vinculo: string, inicio: string, status: string): Consulta => ({
      contato,
      vinculo,
      inicio,
      status,
    });
    await novasConsultas(c, [
      k(vinculos.preco, local(dia(-50), "09:00"), "compareceu"),
      k(vinculos.base, local(dia(-50), "10:00"), "compareceu"),
      k(vinculos.coberto, local(dia(-50), "11:00"), "compareceu"),
      k(vinculos.sem, local(dia(-50), "12:00"), "compareceu"),
      k(vinculos.zero, local(dia(-50), "13:00"), "compareceu"),
      k(vinculos.preco, local(dia(-50), "14:00"), "faltou"),
      k(vinculos.copart, local(dia(-50), "15:00"), "compareceu"),
      k(vinculos.preco, local(dia(-50), "16:00"), "cancelado_paciente"),
      k(vinculos.preco, local(dia(-60), "00:00"), "compareceu"),
      k(vinculos.preco, local(dia(-30), "00:00"), "compareceu"),
      // periodo anterior
      k(vinculos.preco, local(dia(-75), "09:00"), "compareceu"),
      k(vinculos.base, local(dia(-61), "23:59"), "compareceu"),
    ]);
  });

  it("faturamento: preço do vínculo, senão o base; Coberto e sem preço à parte; falta não soma", async () => {
    const { data, error } = await admin.rpc("faturamento_do_periodo", {
      p_clinic_id: c.clinicId,
      p_de: local(dia(-60), "00:00"),
      p_ate: local(dia(-30), "00:00"),
      p_de_anterior: local(dia(-90), "00:00"),
    });
    expect(error).toBeNull();
    expect(data).toEqual({
      // 15000 + 20000 (base) + 0 (gratuito) + 3000 (coparticipacao) + 15000
      // (00:00 do primeiro dia). O Coberto NAO cai no base de 20000.
      atual: {
        comparecimentos: 7,
        valor_cents: 53000,
        com_valor: 5,
        cobertas: 1,
        sem_preco: 1,
      },
      anterior: {
        comparecimentos: 2,
        valor_cents: 35000,
        com_valor: 2,
        cobertas: 0,
        sem_preco: 0,
      },
    });

    const semAnterior = await admin.rpc("faturamento_do_periodo", {
      p_clinic_id: c.clinicId,
      p_de: local(dia(-60), "00:00"),
      p_ate: local(dia(-30), "00:00"),
    });
    expect(Object.keys(semAnterior.data as object)).toEqual(["atual"]);
  });

  it("série diária: dia civil da clínica, sem pular dia, soma igual ao funil", async () => {
    const lead = (telefone: string, chegada: string) =>
      novoContato(c.clinicId, telefone, { first_contact_at: chegada });
    const s1 = await lead("+5584990043001", local(dia(-12), "23:30"));
    await lead("+5584990043002", local(dia(-11), "00:30"));
    await lead("+5584990043003", local(dia(-11), "15:00"));
    const s4 = await lead("+5584990043004", local(dia(-9), "23:59"));
    const s5 = await lead("+5584990043005", local(dia(-8), "00:00"));
    await lead("+5584990043006", local(dia(-13), "23:59"));
    await novasConsultas(c, [
      {
        contato: s1,
        vinculo: vinculos.preco,
        inicio: local(dia(20), "09:00"),
        status: "agendado",
        criadaEm: local(dia(-12), "23:30"),
      },
      {
        contato: s4,
        vinculo: vinculos.preco,
        inicio: local(dia(20), "10:00"),
        status: "agendado",
        criadaEm: local(dia(-9), "10:00"),
      },
      {
        contato: s5,
        vinculo: vinculos.preco,
        inicio: local(dia(20), "11:00"),
        status: "agendado",
        criadaEm: local(dia(-8), "00:00"),
      },
    ]);
    const janela = {
      p_clinic_id: c.clinicId,
      p_de: local(dia(-12), "00:00"),
      p_ate: local(dia(-8), "00:00"),
    };
    const { data, error } = await admin.rpc("serie_diaria_do_periodo", janela);
    expect(error).toBeNull();
    // 23:30 local e 02:30 UTC do dia seguinte: conta no dia local.
    expect(data).toEqual([
      { dia: dia(-12), leads: 1, agendadas: 1 },
      { dia: dia(-11), leads: 2, agendadas: 0 },
      { dia: dia(-10), leads: 0, agendadas: 0 },
      { dia: dia(-9), leads: 1, agendadas: 1 },
    ]);

    const { data: funil } = await admin.rpc("funil_do_periodo", janela);
    const atual = (
      funil as { atual: { leads: number; agendamentos_criados: number } }
    ).atual;
    const pontos = data as { leads: number; agendadas: number }[];
    expect(pontos.reduce((s, p) => s + p.leads, 0)).toBe(atual.leads);
    expect(pontos.reduce((s, p) => s + p.agendadas, 0)).toBe(
      atual.agendamentos_criados,
    );
  });

  it("lista de espera: safra pela 1ª onda no mês, aceite na 1ª oferta, tempo médio e receita", async () => {
    const tMes = local(inicioDoMes, "00:00");
    const k = (vinculo: string, inicio: string, status: string): Consulta => ({
      contato,
      vinculo,
      inicio,
      status,
    });
    const origens = await novasConsultas(
      c,
      Array.from({ length: 8 }, (_, i) =>
        k(
          vinculos.preco,
          maisMinutos(local(dia(30), "08:00"), (i + 1) * 10),
          "cancelado_clinica",
        ),
      ),
    );
    const [v1, v2, v6, v7, v8] = await novasConsultas(c, [
      k(vinculos.preco, local(dia(40), "09:00"), "agendado"),
      k(vinculos.coberto, local(dia(40), "10:00"), "agendado"),
      k(vinculos.preco, local(dia(40), "13:00"), "agendado"),
      k(vinculos.base, local(dia(40), "11:00"), "agendado"),
      k(vinculos.sem, local(dia(40), "12:00"), "agendado"),
    ]);
    const onda = (
      origem: number,
      status: string,
      criadaMin: number,
      respostaMin: number | null = null,
      nova: string | null = null,
    ) => ({
      clinic_id: c.clinicId,
      source_appointment_id: origens[origem]!,
      professional_id: c.profissional,
      slot_starts_at: local(dia(40 + origem), "09:00"),
      slot_ends_at: local(dia(40 + origem), "09:01"),
      offered_to: [contato],
      expires_at:
        status === "aberta"
          ? new Date(Date.now() + 3_600_000).toISOString()
          : maisMinutos(tMes, criadaMin + 60),
      status,
      responded_by: respostaMin === null ? null : contato,
      responded_at:
        respostaMin === null ? null : maisMinutos(tMes, respostaMin),
      appointment_id: nova,
      created_at: maisMinutos(tMes, criadaMin),
    });
    await admin
      .from("waitlist_offer")
      .insert([
        onda(0, "preenchida", 10, 50, v1!), // 40 min, na 1a onda
        onda(1, "expirada", 20),
        onda(1, "preenchida", 80, 140, v2!), // 120 min desde a 1a onda; Coberto
        onda(2, "expirada", 30),
        onda(2, "expirada", 90), // esgotada
        onda(3, "aberta", 40), // em andamento
        onda(4, "cancelada", 50),
        onda(5, "expirada", -24 * 60), // 1a onda no mes anterior: fora da safra
        onda(5, "preenchida", 5, 6, v6!),
        onda(6, "preenchida", 60, 80, v7!), // 20 min; preco base
        onda(7, "preenchida", 70, 130, v8!), // 60 min; sem preco
      ])
      .throwOnError();

    const { data, error } = await admin.rpc("metricas_da_espera", {
      p_clinic_id: c.clinicId,
    });
    expect(error).toBeNull();
    expect((data as unknown[])[0]).toEqual({
      vagas_oferecidas: 7,
      vagas_preenchidas: 4,
      vagas_em_andamento: 1,
      vagas_canceladas: 1,
      vagas_esgotadas: 1,
      primeira_onda_base: 5,
      primeira_onda_aceita: 3,
      tempo_medio_min: 60,
      // 15000 (vinculo) + 20000 (base); Coberto e sem preco nao somam e
      // sao contados a parte (a tela nunca mostra R$ 0,00 sem explicar)
      receita_cents: 35000,
      vagas_com_valor: 2,
      vagas_cobertas: 1,
      vagas_sem_preco: 1,
    });

    // agenda_do_periodo: a regra de preco das recuperadas NAO mudou nesta
    // fase (so o vinculo, sem base), e o service role ainda ve a receita.
    const { data: agenda } = await admin.rpc("agenda_do_periodo", {
      p_clinic_id: c.clinicId,
      p_de: local(dia(-500), "00:00"),
      p_ate: local(dia(500), "00:00"),
    });
    expect(
      (agenda as { atual: { recuperadas: unknown } }).atual.recuperadas,
    ).toEqual({ total: 5, receita_cents: 30000, sem_preco: 3 });
  });
});

describe("fechar_runs_orfas grava o motivo da falha", () => {
  it("código curto do job mais recente; fora do formato vira 'desconhecido'", async () => {
    const c = await novaClinica("Orfas");
    const contato = await novoContato(c.clinicId, "+5584990044001");
    const passo = await passoDaRegua(c.clinicId, "confirmacao");
    const { data: runs } = await admin
      .from("cadence_run")
      .insert(
        Array.from({ length: 6 }, (_, i) => ({
          clinic_id: c.clinicId,
          cadence_step_id: passo,
          contact_id: contato,
          scheduled_for: maisMinutos(local(dia(400), "08:00"), i),
        })),
      )
      .select("id, scheduled_for")
      .throwOnError();
    const porOrdem = [...runs!]
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
      .map((r) => r.id as string);
    const agora = Date.now();
    const job = (run: number, lastError: string | null, horasAtras = 1) => ({
      clinic_id: c.clinicId,
      kind: "executar_passo_de_regua",
      payload: { cadence_run_id: porOrdem[run] },
      status: "falhou",
      last_error: lastError,
      updated_at: new Date(agora - horasAtras * 3_600_000).toISOString(),
    });
    await admin
      .from("job_queue")
      .insert([
        job(0, "uazapi_500"),
        job(1, "pular_run_falhou: 42501"),
        job(2, "Fetch Failed (timeout)"),
        job(3, null),
        job(4, "envio_incerto", 2),
        job(4, "whatsapp_463", 1),
        job(5, "STORAGE_FALHOU:413:EntityTooLarge"),
      ])
      .throwOnError();

    await admin.rpc("fechar_runs_orfas").throwOnError();

    const { data: depois } = await admin
      .from("cadence_run")
      .select("id, skipped_reason, motivo_da_falha")
      .in("id", porOrdem)
      .throwOnError();
    const motivo = (i: number) => depois!.find((r) => r.id === porOrdem[i]);
    expect(porOrdem.map((_, i) => motivo(i)?.motivo_da_falha)).toEqual([
      "uazapi_500",
      "pular_run_falhou",
      "desconhecido",
      "desconhecido",
      "whatsapp_463",
      "storage_falhou",
    ]);
    expect(depois!.every((r) => r.skipped_reason === "falha_envio")).toBe(true);
  });
});
