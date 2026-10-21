import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Jornada configuravel (migration 20260909100000): as etapas do funil por
// clinica. As regras aqui nao sao decoracao: a jornada define para onde o
// gatilho da agenda move o lead e qual evento vai para a Meta, entao uma
// clinica ler ou escrever a jornada da outra seria vazamento de estrategia
// comercial e sabotagem de funil. E as protecoes de estrutura (etapa de
// sistema indelevel, chave imutavel) valem por gatilho, nao por tela.

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Jornada!Rls2026";

let clinicaA = "";
let clinicaB = "";

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  await admin.from("clinic_member").insert({
    clinic_id: clinicId,
    user_id: data.user!.id,
    role,
    status: "ativo",
  });
}

async function logado(email: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

const email = (papel: string) => `jornada-${papel}-${sufixo}@teste.dev`;

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Jornada A ${sufixo}`,
        slug: `jornada-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Jornada B ${sufixo}`,
        slug: `jornada-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `jornada-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `jornada-b-${sufixo}`)!
    .id as string;

  await Promise.all([
    criarUsuario(email("gestor-a"), clinicaA, "gestor"),
    criarUsuario(email("recepcao-a"), clinicaA, "recepcao"),
    criarUsuario(email("admin-b"), clinicaB, "admin"),
  ]);
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    for (const usuario of usuarios) {
      if (usuario.email?.includes(`-${sufixo}@teste.dev`)) {
        await admin.auth.admin.deleteUser(usuario.id);
      }
    }
    if (usuarios.length < 200) {
      break;
    }
  }
});

describe("a jornada nasce com a clínica", () => {
  // Onda 3 (21/10/2026, migration 20261023100000): a semente poe Aguardando
  // resposta logo antes de Em contato, e as duas nascem etapas de sistema
  // (papeis 'aguardando' e 'em_contato'). As seis sao obrigatorias.
  it("clínica nova já tem as 6 etapas, todas de sistema, na ordem nova", async () => {
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, papel, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    expect(data).toHaveLength(6);
    expect(data!.map((e) => e.chave)).toEqual([
      "novo",
      "aguardando_resposta",
      "em_contato",
      "agendou",
      "compareceu",
      "perdido",
    ]);
    expect(data!.map((e) => e.papel)).toEqual([
      "entrada",
      "aguardando",
      "em_contato",
      "agendou",
      "compareceu",
      "perdido",
    ]);
    expect(data!.map((e) => e.posicao)).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe("isolamento entre clínicas", () => {
  it("membro lê a própria jornada; a da outra clínica volta vazia", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { data: minha } = await cliente
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaA);
    expect(minha).toHaveLength(6);

    const { data: alheia, error } = await cliente
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaB);
    expect(error).toBeNull();
    expect(alheia).toHaveLength(0);
    // Contraprova anti falso-positivo.
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaB);
    expect(prova).toHaveLength(6);
  });

  it("gestor de A não cria etapa em B", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente.from("funnel_stage_def").insert({
      clinic_id: clinicaB,
      chave: "invasao",
      nome: "Invasão",
      posicao: 99,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe("quem escreve", () => {
  it("recepção não cria nem edita etapa", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { error: erroInsert } = await cliente
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicaA,
        chave: "tentativa",
        nome: "Tentativa",
        posicao: 70,
      });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    const { error: erroUpdate } = await cliente
      .from("funnel_stage_def")
      .update({ nome: "Renomeada" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo");
    // Update barrado afeta zero linhas sem erro; a contraprova é o nome intacto.
    expect(erroUpdate).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("nome")
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo")
      .single();
    expect(prova!.nome).toBe("Novo");
  });

  it("gestor cria etapa livre, renomeia etapa de sistema, e o nome muda de verdade", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error: erroInsert } = await cliente
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicaA,
        chave: "comprou_pacote",
        nome: "Comprou pacote",
        posicao: 55,
        tom: "success",
        icone: "package",
      });
    expect(erroInsert).toBeNull();

    const { error: erroRenome } = await cliente
      .from("funnel_stage_def")
      .update({ nome: "Chegou agora" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo");
    expect(erroRenome).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("nome")
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo")
      .single();
    expect(prova!.nome).toBe("Chegou agora");
  });
});

// A conversao da Meta mora NA etapa (fase 3 absorveu a funnel_conversion_map;
// estas provas vieram do teste daquela tabela junto com as colunas).
describe("a conversão da etapa", () => {
  it("gestor configura o evento com valor fixo, e persiste", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente
      .from("funnel_stage_def")
      .update({
        meta_event_name: "Purchase",
        is_sale: true,
        value_source: "fixo",
        value_cents: 25_000,
      })
      .eq("clinic_id", clinicaA)
      .eq("chave", "compareceu");
    expect(error).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("meta_event_name, is_sale, value_cents")
      .eq("clinic_id", clinicaA)
      .eq("chave", "compareceu")
      .single();
    expect(prova).toEqual({
      meta_event_name: "Purchase",
      is_sale: true,
      value_cents: 25_000,
    });
  });

  it("recepção não configura conversão", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { error } = await cliente
      .from("funnel_stage_def")
      .update({ meta_event_name: "Lead" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou");
    expect(error).toBeNull(); // zero linhas afetadas, sem erro
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("meta_event_name")
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou")
      .single();
    expect(prova!.meta_event_name).toBeNull();
  });

  it("a etapa de perda não vira conversão (check do banco)", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ meta_event_name: "Purchase" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "perdido");
    expect(error?.code).toBe("23514");
  });

  it("valor fixo exige o valor em centavos (check do banco)", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ value_source: "fixo", value_cents: null })
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou");
    expect(error?.code).toBe("23514");
  });
});

// RPC reordenar_etapa_da_jornada (migration 20260909150000): transacao unica
// com renumeracao completa, SECURITY INVOKER. Correcao da revisao adversarial
// de 09/09/2026: o swap em duas escritas soltas podia empatar posicoes para
// sempre e desligar o avanco automatico do funil.
describe("reordenar pela RPC", () => {
  // Desde a onda 3 (decisao D6) as etapas de sistema do caminho do lead nao
  // trocam entre si; a prova da renumeracao usa a etapa livre comprou_pacote
  // (criada acima, na posicao 55, entre Compareceu e Perdido).
  it("gestor sobe uma etapa e a jornada inteira sai renumerada", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente.rpc("reordenar_etapa_da_jornada", {
      p_clinic_id: clinicaA,
      p_chave: "comprou_pacote",
      p_direcao: "subir",
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    const ordem = data!.map((e) => e.chave);
    expect(ordem.indexOf("comprou_pacote")).toBeLessThan(
      ordem.indexOf("compareceu"),
    );
    // Renumeracao canonica: posicoes 10, 20, 30... sem buraco nem empate.
    expect(data!.map((e) => e.posicao)).toEqual(
      data!.map((_, i) => (i + 1) * 10),
    );
  });

  it("recepção não reordena: a RLS esconde as linhas da troca", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { error } = await cliente.rpc("reordenar_etapa_da_jornada", {
      p_clinic_id: clinicaA,
      p_chave: "comprou_pacote",
      p_direcao: "subir",
    });
    expect(error?.message).toContain("Etapa não encontrada");
  });

  it("subir a primeira etapa avisa que já está na ponta", async () => {
    const cliente = await logado(email("gestor-a"));
    const { data: jornada } = await admin
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaA)
      .order("posicao")
      .limit(1);
    const { error } = await cliente.rpc("reordenar_etapa_da_jornada", {
      p_clinic_id: clinicaA,
      p_chave: jornada![0]!.chave,
      p_direcao: "subir",
    });
    expect(error?.message).toContain("ponta da jornada");
  });

  it("empate histórico de posição é consertado pela próxima reordenação", async () => {
    // Força o defeito antigo: duas etapas na MESMA posicao. Desde a onda 3
    // (revisao de 21/10/2026) o banco recusa empate entre duas etapas da
    // cadeia (gatilho conferir_ordem_da_jornada, provado abaixo); o empate
    // que ainda pode existir e o de uma livre com uma de sistema: Comprou
    // pacote na posicao de Agendou, que vem logo antes dela.
    const { data: agendou } = await admin
      .from("funnel_stage_def")
      .select("posicao")
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou")
      .single()
      .throwOnError();
    await admin
      .from("funnel_stage_def")
      .update({ posicao: (agendou as { posicao: number }).posicao })
      .eq("clinic_id", clinicaA)
      .eq("chave", "comprou_pacote")
      .throwOnError();
    // Compareceu desce para depois de Perdido: Perdido fica fora da ordem
    // fixa (decisao D6), entao a troca vale e renumera tudo.
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente.rpc("reordenar_etapa_da_jornada", {
      p_clinic_id: clinicaA,
      p_chave: "compareceu",
      p_direcao: "descer",
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    const posicoes = data!.map((e) => e.posicao);
    expect(new Set(posicoes).size).toBe(posicoes.length);
    // O desempate (posicao, chave) manteve Agendou antes de Comprou pacote.
    const ordem = data!.map((e) => e.chave);
    expect(ordem.indexOf("agendou")).toBeLessThan(
      ordem.indexOf("comprou_pacote"),
    );
  });
});

// Decisao D6 do dono (21/10/2026; migration 20261023100000): a RPC recusa
// trocar duas etapas de sistema do caminho do lead (Novo, Aguardando
// resposta, Em contato, Agendou e Compareceu) com P0001 e o hint
// ordem_de_sistema; etapa livre continua passando por entre elas.
describe("a ordem fixa das etapas de sistema", () => {
  it("gestor não troca Aguardando resposta com Em contato, em nenhum sentido", async () => {
    const cliente = await logado(email("gestor-a"));
    const antes = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    for (const [chave, direcao] of [
      ["aguardando_resposta", "descer"],
      ["em_contato", "subir"],
      ["novo", "descer"],
    ] as const) {
      const { error } = await cliente.rpc("reordenar_etapa_da_jornada", {
        p_clinic_id: clinicaA,
        p_chave: chave,
        p_direcao: direcao,
      });
      expect(error?.code, `${chave} ${direcao}`).toBe("P0001");
      expect(error?.hint, `${chave} ${direcao}`).toBe("ordem_de_sistema");
      expect(error?.message).toContain(
        "A ordem das etapas de sistema não muda",
      );
    }
    // Contraprova: nada mudou de lugar.
    const depois = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    expect(depois.data).toEqual(antes.data);
  });

  it("etapa livre entra entre Aguardando resposta e Em contato e sai de novo", async () => {
    const cliente = await logado(email("gestor-a"));
    // Entra no fim e sobe ate ficar logo depois de Aguardando resposta.
    await cliente
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicaA,
        chave: "pediu_valor",
        nome: "Pediu valor",
        posicao: 990,
      })
      .throwOnError();
    for (let passo = 0; passo < 20; passo++) {
      const { data: atual } = await admin
        .from("funnel_stage_def")
        .select("chave")
        .eq("clinic_id", clinicaA)
        .order("posicao")
        .order("chave");
      const ordem = atual!.map((e) => e.chave);
      if (
        ordem.indexOf("pediu_valor") ===
        ordem.indexOf("aguardando_resposta") + 1
      ) {
        break;
      }
      const { error } = await cliente.rpc("reordenar_etapa_da_jornada", {
        p_clinic_id: clinicaA,
        p_chave: "pediu_valor",
        p_direcao: "subir",
      });
      expect(error).toBeNull();
    }
    const { data: entre } = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    const ordem = entre!.map((e) => e.chave);
    expect(ordem.indexOf("pediu_valor")).toBe(
      ordem.indexOf("aguardando_resposta") + 1,
    );
    expect(ordem.indexOf("em_contato")).toBe(ordem.indexOf("pediu_valor") + 1);
    // Com a livre no meio, Aguardando resposta e Em contato trocam com ela.
    const { error: erroDoAguardando } = await cliente.rpc(
      "reordenar_etapa_da_jornada",
      {
        p_clinic_id: clinicaA,
        p_chave: "aguardando_resposta",
        p_direcao: "descer",
      },
    );
    expect(erroDoAguardando).toBeNull();
    const { error: erroDaLivre } = await cliente.rpc(
      "reordenar_etapa_da_jornada",
      { p_clinic_id: clinicaA, p_chave: "pediu_valor", p_direcao: "subir" },
    );
    expect(erroDaLivre).toBeNull();
    // A livre saiu e a ordem do caminho voltou a ser a de antes.
    const { data: fim } = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    const ordemFinal = fim!.map((e) => e.chave);
    expect(ordemFinal.indexOf("aguardando_resposta")).toBeLessThan(
      ordemFinal.indexOf("em_contato"),
    );
    expect(ordemFinal.indexOf("pediu_valor")).toBeLessThan(
      ordemFinal.indexOf("aguardando_resposta"),
    );
    await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "pediu_valor")
      .throwOnError();
  });
});

// A cadeia como invariante do banco (revisao de 21/10/2026): a policy
// "gestao gerencia a jornada" e FOR ALL, entao a sessao do gestor muda
// posicao DIRETO pela tabela (o PATCH do PostgREST), sem passar pela RPC. O
// gatilho de restricao conferir_ordem_da_jornada (migration 20261023100000)
// recusa no fim do comando, com o mesmo P0001 e o mesmo hint da RPC, quando
// a cadeia Novo < Aguardando resposta < Em contato < Agendou < Compareceu
// inverte ou empata pela posicao; vale ate para o service role. Etapa livre
// continua indo direto para qualquer lugar.
describe("a ordem fixa vale também para quem muda a posição direto", () => {
  async function jornadaDeA(): Promise<{ chave: string; posicao: number }[]> {
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", clinicaA)
      .order("posicao")
      .order("chave")
      .throwOnError();
    return data as { chave: string; posicao: number }[];
  }

  function posicaoNa(
    jornada: { chave: string; posicao: number }[],
    chave: string,
  ): number {
    return jornada.find((etapa) => etapa.chave === chave)!.posicao;
  }

  it("gestor não inverte nem empata a cadeia pelo PATCH direto", async () => {
    const cliente = await logado(email("gestor-a"));
    const antes = await jornadaDeA();
    for (const [chave, posicao] of [
      // Aguardando resposta para depois de Em contato (o achado da revisao).
      ["aguardando_resposta", posicaoNa(antes, "em_contato") + 5],
      // Novo para depois de Aguardando resposta.
      ["novo", posicaoNa(antes, "aguardando_resposta") + 5],
      // Em contato empatada com Aguardando resposta.
      ["em_contato", posicaoNa(antes, "aguardando_resposta")],
    ] as const) {
      const { error } = await cliente
        .from("funnel_stage_def")
        .update({ posicao })
        .eq("clinic_id", clinicaA)
        .eq("chave", chave);
      expect(error?.code, chave).toBe("P0001");
      expect(error?.hint, chave).toBe("ordem_de_sistema");
      expect(error?.message, chave).toContain(
        "A ordem das etapas de sistema não muda",
      );
    }
    // Contraprova: nada mudou de lugar.
    expect(await jornadaDeA()).toEqual(antes);
  });

  it("o service role também não põe Compareceu antes de Agendou", async () => {
    const antes = await jornadaDeA();
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ posicao: posicaoNa(antes, "agendou") - 5 })
      .eq("clinic_id", clinicaA)
      .eq("chave", "compareceu");
    expect(error?.code).toBe("P0001");
    expect(error?.hint).toBe("ordem_de_sistema");
    expect(await jornadaDeA()).toEqual(antes);
  });

  it("etapa livre vai direto para o meio da cadeia, e Perdido para o topo", async () => {
    const cliente = await logado(email("gestor-a"));
    await cliente
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicaA,
        chave: "livre_direta",
        nome: "Livre direta",
        posicao: 995,
      })
      .throwOnError();
    const antes = await jornadaDeA();
    const { error: erroDaLivre } = await cliente
      .from("funnel_stage_def")
      .update({ posicao: posicaoNa(antes, "novo") + 5 })
      .eq("clinic_id", clinicaA)
      .eq("chave", "livre_direta");
    expect(erroDaLivre).toBeNull();
    const perdidoAntes = posicaoNa(antes, "perdido");
    const { error: erroDoPerdido } = await cliente
      .from("funnel_stage_def")
      .update({ posicao: 1 })
      .eq("clinic_id", clinicaA)
      .eq("chave", "perdido");
    expect(erroDoPerdido).toBeNull();
    const ordem = (await jornadaDeA()).map((etapa) => etapa.chave);
    expect(ordem[0]).toBe("perdido");
    expect(ordem.indexOf("livre_direta")).toBe(ordem.indexOf("novo") + 1);
    expect(ordem.indexOf("livre_direta")).toBeLessThan(
      ordem.indexOf("aguardando_resposta"),
    );
    // Volta como estava.
    await admin
      .from("funnel_stage_def")
      .update({ posicao: perdidoAntes })
      .eq("clinic_id", clinicaA)
      .eq("chave", "perdido")
      .throwOnError();
    await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "livre_direta")
      .throwOnError();
  });
});

describe("as travas de estrutura (por gatilho, valem até para o service role)", () => {
  it("a chave de uma etapa não muda", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ chave: "outra_chave" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "em_contato");
    expect(error?.message).toContain("chave de uma etapa não muda");
  });

  it("o papel de sistema não muda", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ papel: null })
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou");
    expect(error?.message).toContain("papel de sistema");
  });

  it("etapa de sistema não pode ser excluída", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "perdido");
    expect(error?.message).toContain("Etapa de sistema");
  });

  // Onda 3 (21/10/2026): Em contato e Aguardando resposta viraram etapas de
  // sistema. Quem gerencia a jornada (o gestor, pela RLS) renomeia, mas nao
  // exclui nem tira o papel delas: a trava e o gatilho proteger_jornada.
  it("gestor não exclui Em contato nem Aguardando resposta", async () => {
    const cliente = await logado(email("gestor-a"));
    for (const chave of ["em_contato", "aguardando_resposta"]) {
      const { error } = await cliente
        .from("funnel_stage_def")
        .delete()
        .eq("clinic_id", clinicaA)
        .eq("chave", chave);
      expect(error?.message, chave).toContain("Etapa de sistema");
    }
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaA)
      .in("chave", ["em_contato", "aguardando_resposta"]);
    expect(prova).toHaveLength(2);
  });

  it("gestor não muda o papel delas, mas renomeia", async () => {
    const cliente = await logado(email("gestor-a"));
    for (const [chave, papel] of [
      ["em_contato", null],
      ["aguardando_resposta", "em_contato"],
    ] as const) {
      const { error } = await cliente
        .from("funnel_stage_def")
        .update({ papel })
        .eq("clinic_id", clinicaA)
        .eq("chave", chave);
      expect(error?.message, chave).toContain("papel de sistema");
    }
    const { error: erroDoNome } = await cliente
      .from("funnel_stage_def")
      .update({ nome: "Contato inicial" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "em_contato");
    expect(erroDoNome).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("chave, nome, papel")
      .eq("clinic_id", clinicaA)
      .in("chave", ["em_contato", "aguardando_resposta"])
      .order("chave");
    expect(prova).toEqual([
      {
        chave: "aguardando_resposta",
        nome: "Aguardando resposta",
        papel: "aguardando",
      },
      { chave: "em_contato", nome: "Contato inicial", papel: "em_contato" },
    ]);
  });

  it("etapa livre com contato dentro não pode ser excluída", async () => {
    await admin
      .from("contact")
      .insert({
        clinic_id: clinicaA,
        phone_e164: `+5511${Date.now() % 100000000}`,
        funnel_stage: "comprou_pacote",
      })
      .throwOnError();
    const { error } = await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "comprou_pacote");
    expect(error?.message).toContain("Mova os contatos");
  });

  it("contato não entra em etapa que não existe na jornada", async () => {
    const { error } = await admin.from("contact").insert({
      clinic_id: clinicaA,
      phone_e164: `+5511${(Date.now() + 7) % 100000000}`,
      funnel_stage: "etapa_fantasma",
    });
    expect(error?.code).toBe("23514");
  });
});
