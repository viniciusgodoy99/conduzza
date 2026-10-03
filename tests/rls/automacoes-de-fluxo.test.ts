import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Automacoes de fluxo (Leva B, migration 20261002130000), pela API com JWT
// real de cada papel. O que esta em jogo:
//   - automacao_fluxo: membro ATIVO le; admin e gestor escrevem; autoria e
//     vigente_desde sao do banco; a B nunca le nem aponta para a A (FK
//     composta por clinica); validacao ao salvar (Agenda nunca e destino,
//     Perdido so com "nao_respondeu", ciclo recusado) com hint curto, que
//     so quem gerencia a clinica recebe (os outros, 42501: sem oraculo).
//   - automacao_execucao: so o motor escreve (INSERT, UPDATE e DELETE pela
//     API dao 42501); membro ativo le o historico; pendente e a B nao.
//   - previa_da_automacao_de_fluxo: SECURITY INVOKER, a B recebe zeros.
//   - relogios do contato: a sessao nao reescreve funnel_stage_changed_at
//     nem last_contact_at.
//   - etapa e etiqueta usadas por automacao nao se excluem.
//   - planejar e executar sao so do servico.
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Mesmos
// cenarios do ensaio (scratchpad fluxo/banco-b/asserts.sql).

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "FluxoLevaB!Rls2026";
const HORA_MS = 60 * 60_000;

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let regraA = "";
let contatoA = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) =>
  `fluxo-leva-b-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;
const id = (apelido: string) => ids.get(apelido)!;
const telefone = (final: string) =>
  `+5584976${sufixo.replace(/\D/g, "1").slice(0, 4)}${final}`;

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
  professionalId?: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status,
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: email(apelido),
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}

/** Lead na etapa, com a entrada na etapa recuada (servico, que e livre). */
async function novoLead(
  clinicId: string,
  fone: string,
  etapa: string,
  horasNaEtapa: number,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: fone,
      kind: "lead",
      funnel_stage: etapa,
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  await admin
    .from("contact")
    .update({
      created_at: new Date(Date.now() - 30 * 24 * HORA_MS).toISOString(),
      funnel_stage_changed_at: new Date(
        Date.now() - horasNaEtapa * HORA_MS,
      ).toISOString(),
    })
    .eq("id", contactId)
    .throwOnError();
  return contactId;
}

/** Regra de etiqueta por entrada na etapa (o caso mais simples). */
function regraDeEtiqueta(clinicId: string, etapa: string, nome: string) {
  return {
    clinic_id: clinicId,
    nome,
    gatilho: "entrou_na_etapa",
    etapa,
    acao: "etiquetar",
    etiqueta: "urgente",
  };
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Fluxo A ${sufixo}`,
        slug: `fluxo-leva-b-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Fluxo B ${sufixo}`,
        slug: `fluxo-leva-b-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `fluxo-leva-b-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `fluxo-leva-b-b-${sufixo}`)!
    .id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Fluxo" })
    .select("id")
    .single()
    .throwOnError();

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa(
    "prof-a",
    clinicaA,
    "profissional",
    "ativo",
    prof!.id as string,
  );
  await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");

  // Etapas proprias da A (a B nao tem: a FK composta tem de recusar).
  await admin
    .from("funnel_stage_def")
    .insert([
      { clinic_id: clinicaA, chave: "so_da_a", nome: "Só da A", posicao: 61 },
      { clinic_id: clinicaA, chave: "c1", nome: "C1", posicao: 62 },
      { clinic_id: clinicaA, chave: "c2", nome: "C2", posicao: 63 },
      { clinic_id: clinicaA, chave: "livre", nome: "Livre", posicao: 64 },
    ])
    .throwOnError();
  await admin
    .from("conversation_tag_def")
    .insert({ clinic_id: clinicaA, chave: "so_da_a", nome: "Só da A" })
    .throwOnError();

  numeroA = (await criarNumeroDeTeste(admin, clinicaA)).id;
  await criarNumeroDeTeste(admin, clinicaB);

  contatoA = await novoLead(clinicaA, telefone("01"), "novo", 48);
  await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      whatsapp_account_id: numeroA,
    })
    .throwOnError();
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const usuario of ids.values()) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

// ---------------------------------------------------------------------------
// automacao_fluxo
// ---------------------------------------------------------------------------

describe("automacao_fluxo: quem escreve e quem le", () => {
  it("gestor cria; autoria e vigente_desde sao do banco, o forjado e ignorado", async () => {
    const antes = Date.now();
    const { data, error } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        ...regraDeEtiqueta(clinicaA, "em_contato", "Etiquetar ao entrar"),
        ativa: true,
        vigente_desde: "2020-01-01T00:00:00Z",
        created_by: id("admin-a"),
      })
      .select("id, created_by, updated_by, vigente_desde")
      .single();
    expect(error).toBeNull();
    regraA = data!.id as string;
    expect(data!.created_by).toBe(id("gestor-a"));
    expect(data!.updated_by).toBe(id("gestor-a"));
    expect(new Date(data!.vigente_desde as string).getTime()).toBeGreaterThan(
      antes - 60_000,
    );
  });

  it("admin edita; updated_by vira o admin e created_by fica", async () => {
    const { data, error } = await como("admin-a")
      .from("automacao_fluxo")
      .update({ nome: "Etiquetar urgente ao entrar" })
      .eq("id", regraA)
      .select("created_by, updated_by");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.created_by).toBe(id("gestor-a"));
    expect(data![0]!.updated_by).toBe(id("admin-a"));
  });

  it("recepcao, leitura, profissional e pendente nao criam (42501)", async () => {
    for (const apelido of ["recepcao-a", "leitura-a", "prof-a", "pendente-a"]) {
      const { error } = await como(apelido)
        .from("automacao_fluxo")
        .insert(regraDeEtiqueta(clinicaA, "novo", `Tentativa ${apelido}`));
      expect(error?.code, apelido).toBe(RLS_VIOLATION);
    }
  });

  it("recepcao nao edita nem apaga (0 linhas), e a regra segue igual", async () => {
    const { data: editadas } = await como("recepcao-a")
      .from("automacao_fluxo")
      .update({ nome: "Recepção mexeu" })
      .eq("id", regraA)
      .select("id");
    expect(editadas ?? []).toHaveLength(0);
    const { data: apagadas } = await como("recepcao-a")
      .from("automacao_fluxo")
      .delete()
      .eq("id", regraA)
      .select("id");
    expect(apagadas ?? []).toHaveLength(0);
    const { data } = await admin
      .from("automacao_fluxo")
      .select("nome")
      .eq("id", regraA)
      .single()
      .throwOnError();
    expect(data!.nome).toBe("Etiquetar urgente ao entrar");
  });

  it("membro ativo le; pendente e a outra clinica nao", async () => {
    for (const apelido of ["recepcao-a", "leitura-a", "prof-a"]) {
      const { data } = await como(apelido)
        .from("automacao_fluxo")
        .select("id")
        .eq("id", regraA);
      expect(data, apelido).toHaveLength(1);
    }
    for (const apelido of ["pendente-a", "admin-b"]) {
      const { data } = await como(apelido)
        .from("automacao_fluxo")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(data ?? [], apelido).toHaveLength(0);
    }
  });

  it("a B nao cria na A nem aponta para etapa ou etiqueta que so a A tem", async () => {
    const { error: naA } = await como("admin-b")
      .from("automacao_fluxo")
      .insert(regraDeEtiqueta(clinicaA, "novo", "B na A"));
    expect(naA?.code).toBe(RLS_VIOLATION);

    const { error: etapaDaA } = await como("admin-b")
      .from("automacao_fluxo")
      .insert(regraDeEtiqueta(clinicaB, "so_da_a", "Etapa da A"));
    expect(etapaDaA?.code).toBe(FK_VIOLATION);

    const { error: etiquetaDaA } = await como("admin-b")
      .from("automacao_fluxo")
      .insert({
        ...regraDeEtiqueta(clinicaB, "novo", "Etiqueta da A"),
        etiqueta: "so_da_a",
      });
    expect(etiquetaDaA?.code).toBe(FK_VIOLATION);

    // positivo: a B cria a dela
    const { error: propria } = await como("admin-b")
      .from("automacao_fluxo")
      .insert(regraDeEtiqueta(clinicaB, "novo", "Da B"));
    expect(propria).toBeNull();
  });
});

describe("automacao_fluxo: validacao ao salvar", () => {
  it("Agendou e Compareceu nunca sao destino", async () => {
    for (const destino of ["agendou", "compareceu"]) {
      const { error } = await como("gestor-a")
        .from("automacao_fluxo")
        .insert({
          clinic_id: clinicaA,
          nome: `Para ${destino}`,
          gatilho: "entrou_na_etapa",
          etapa: "c1",
          acao: "mover_etapa",
          etapa_destino: destino,
        });
      expect(error?.code, destino).toBe(CHECK_VIOLATION);
      expect(error?.hint, destino).toBe("automacao_destino_da_agenda");
    }
  });

  it("Perdido so com o motivo nao_respondeu", async () => {
    const base = {
      clinic_id: clinicaA,
      gatilho: "tempo_na_etapa",
      etapa: "c1",
      espera_minutos: 60,
      acao: "mover_etapa",
      etapa_destino: "perdido",
    };
    const { error: semMotivo } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({ ...base, nome: "Perdido sem motivo" });
    expect(semMotivo?.code).toBe(CHECK_VIOLATION);
    expect(semMotivo?.hint).toBe("automacao_perdido_sem_motivo");

    const { error: outroMotivo } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({ ...base, nome: "Perdido por preço", motivo_perda: "preco" });
    expect(outroMotivo?.code).toBe(CHECK_VIOLATION);

    const { error } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        ...base,
        nome: "Perdido certo",
        motivo_perda: "nao_respondeu",
      });
    expect(error).toBeNull();
  });

  it("espera so nos gatilhos de tempo, de 60 a 129600 minutos", async () => {
    const base = regraDeEtiqueta(clinicaA, "c1", "Espera");
    const casos: { gatilho: string; espera: number | null; ok: boolean }[] = [
      { gatilho: "entrou_na_etapa", espera: 60, ok: false },
      { gatilho: "tempo_na_etapa", espera: null, ok: false },
      { gatilho: "tempo_na_etapa", espera: 59, ok: false },
      { gatilho: "sem_resposta_na_etapa", espera: 129601, ok: false },
      { gatilho: "sem_resposta_na_etapa", espera: 129600, ok: true },
    ];
    for (const caso of casos) {
      const { error } = await como("gestor-a")
        .from("automacao_fluxo")
        .insert({
          ...base,
          nome: `Espera ${caso.gatilho} ${caso.espera ?? "nula"}`,
          gatilho: caso.gatilho,
          espera_minutos: caso.espera,
        });
      if (caso.ok) {
        expect(error, JSON.stringify(caso)).toBeNull();
      } else {
        expect(error?.code, JSON.stringify(caso)).toBe(CHECK_VIOLATION);
      }
    }
  });

  it("ciclo entre regras ligadas e recusado; aresta de mensagem nao conta", async () => {
    const { error: ida } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        clinic_id: clinicaA,
        nome: "C1 para C2",
        ativa: true,
        gatilho: "tempo_na_etapa",
        etapa: "c1",
        espera_minutos: 60,
        acao: "mover_etapa",
        etapa_destino: "c2",
      });
    expect(ida).toBeNull();

    const volta = {
      clinic_id: clinicaA,
      ativa: true,
      etapa: "c2",
      acao: "mover_etapa",
      etapa_destino: "c1",
    };
    const { error: ciclo } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        ...volta,
        nome: "C2 volta sozinho",
        gatilho: "sem_resposta_na_etapa",
        espera_minutos: 60,
      });
    expect(ciclo?.code).toBe(CHECK_VIOLATION);
    expect(ciclo?.hint).toBe("automacao_ciclo");

    const { error: porMensagem } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        ...volta,
        nome: "C2 volta se escrever",
        gatilho: "mensagem_recebida",
      });
    expect(porMensagem).toBeNull();
  });

  it("quem não gerencia a A não lê a configuração dela pelo código de erro", async () => {
    // O gatilho BEFORE (definer) roda antes do WITH CHECK da RLS: sem a
    // guarda, o hint revelaria o papel das etapas da A (destino da Agenda,
    // Perdido) e o grafo das regras ligadas dela (ciclo com a C1 para C2 do
    // caso acima). Com a guarda, todos recebem 42501, como a RLS.
    const tentativas = [
      {
        rotulo: "destino da Agenda",
        nome: "Oraculo agendou",
        gatilho: "entrou_na_etapa",
        etapa: "novo",
        etapa_destino: "agendou",
      },
      {
        rotulo: "Perdido sem motivo",
        nome: "Oraculo perdido",
        gatilho: "entrou_na_etapa",
        etapa: "novo",
        etapa_destino: "perdido",
      },
      {
        rotulo: "ciclo",
        nome: "Oraculo ciclo",
        gatilho: "tempo_na_etapa",
        espera_minutos: 60,
        etapa: "c2",
        etapa_destino: "c1",
      },
    ];
    for (const apelido of ["admin-b", "pendente-a", "recepcao-a"]) {
      for (const { rotulo, ...campos } of tentativas) {
        const { error } = await como(apelido)
          .from("automacao_fluxo")
          .insert({
            clinic_id: clinicaA,
            ativa: true,
            acao: "mover_etapa",
            ...campos,
          });
        expect(error?.code, `${apelido}: ${rotulo}`).toBe(RLS_VIOLATION);
        // hint ausente vira "" (o toMatch do Vitest lança com null, mesmo
        // com .not, e hint nulo é justamente o resultado certo aqui)
        expect(error?.hint ?? "", `${apelido}: ${rotulo}`).not.toMatch(
          /^automacao_/,
        );
      }
    }
    // positivo: o gestor da A recebe a validacao de verdade (o hint)
    const { error: doGestor } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        clinic_id: clinicaA,
        nome: "Gestor agendou",
        ativa: true,
        gatilho: "entrou_na_etapa",
        etapa: "novo",
        acao: "mover_etapa",
        etapa_destino: "agendou",
      });
    expect(doGestor?.code).toBe(CHECK_VIOLATION);
    expect(doGestor?.hint).toBe("automacao_destino_da_agenda");
  });
});

// ---------------------------------------------------------------------------
// automacao_execucao
// ---------------------------------------------------------------------------

describe("automacao_execucao: so o motor escreve, membro ativo le", () => {
  let execucao = "";

  beforeAll(async () => {
    const { data } = await admin
      .from("automacao_execucao")
      .insert({
        clinic_id: clinicaA,
        automacao_id: regraA,
        contact_id: contatoA,
        de_etapa: "em_contato",
        entrada_na_etapa: new Date().toISOString(),
        devida_em: new Date(Date.now() + 24 * HORA_MS).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    execucao = data!.id as string;
  });

  it("INSERT, UPDATE e DELETE pela API dao 42501, ate para o admin", async () => {
    const { error: inserir } = await como("admin-a")
      .from("automacao_execucao")
      .insert({
        clinic_id: clinicaA,
        automacao_id: regraA,
        contact_id: contatoA,
        de_etapa: "em_contato",
        entrada_na_etapa: new Date(Date.now() - HORA_MS).toISOString(),
        devida_em: new Date().toISOString(),
      });
    expect(inserir?.code).toBe(RLS_VIOLATION);
    const { error: atualizar } = await como("admin-a")
      .from("automacao_execucao")
      .update({ status: "pulada", motivo: "forjado" })
      .eq("id", execucao);
    expect(atualizar?.code).toBe(RLS_VIOLATION);
    const { error: apagar } = await como("admin-a")
      .from("automacao_execucao")
      .delete()
      .eq("id", execucao);
    expect(apagar?.code).toBe(RLS_VIOLATION);
  });

  it("recepcao, leitura e profissional leem o historico; pendente e a B nao", async () => {
    for (const apelido of ["recepcao-a", "leitura-a", "prof-a", "admin-a"]) {
      const { data } = await como(apelido)
        .from("automacao_execucao")
        .select("id, status")
        .eq("id", execucao);
      expect(data, apelido).toHaveLength(1);
      expect(data![0]!.status).toBe("pendente");
    }
    for (const apelido of ["pendente-a", "admin-b"]) {
      const { data } = await como(apelido)
        .from("automacao_execucao")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(data ?? [], apelido).toHaveLength(0);
    }
  });

  it("planejar e executar sao so do servico", async () => {
    const { error: planejar } = await como("admin-a").rpc(
      "planejar_automacoes_de_fluxo",
      { p_clinic_id: clinicaA, p_incluir_teste: true },
    );
    expect(planejar?.code).toBe(RLS_VIOLATION);
    const { error: executar } = await como("admin-a").rpc(
      "executar_automacoes_de_fluxo",
      { p_clinic_id: clinicaA, p_incluir_teste: true },
    );
    expect(executar?.code).toBe(RLS_VIOLATION);
    // positivo: o servico executa (a execucao do beforeAll nao esta devida)
    const { error } = await admin.rpc("executar_automacoes_de_fluxo", {
      p_clinic_id: clinicaA,
      p_incluir_teste: true,
    });
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// previa, relogios e exclusao
// ---------------------------------------------------------------------------

describe("previa_da_automacao_de_fluxo", () => {
  it("gestor ve a contagem; a B recebe zeros", async () => {
    await novoLead(clinicaA, telefone("11"), "livre", 5);
    await novoLead(clinicaA, telefone("12"), "livre", 0.5);
    const { data, error } = await como("gestor-a").rpc(
      "previa_da_automacao_de_fluxo",
      {
        p_clinic_id: clinicaA,
        p_gatilho: "tempo_na_etapa",
        p_etapa: "livre",
        p_espera_minutos: 60,
      },
    );
    expect(error).toBeNull();
    expect(data).toEqual({
      na_etapa: 2,
      ja_se_encaixam: 1,
      importados_fora: 0,
    });

    const { data: daB, error: erroDaB } = await como("admin-b").rpc(
      "previa_da_automacao_de_fluxo",
      {
        p_clinic_id: clinicaA,
        p_gatilho: "tempo_na_etapa",
        p_etapa: "livre",
        p_espera_minutos: 60,
      },
    );
    expect(erroDaB).toBeNull();
    expect(daB).toEqual({ na_etapa: 0, ja_se_encaixam: 0, importados_fora: 0 });
  });
});

describe("relogios do contato", () => {
  it("a sessao nao reescreve o tempo na etapa nem a ultima mensagem", async () => {
    const contato = await novoLead(clinicaA, telefone("21"), "novo", 240);
    const ultima = new Date(Date.now() - 3 * 24 * HORA_MS).toISOString();
    await admin
      .from("contact")
      .update({ last_contact_at: ultima })
      .eq("id", contato)
      .throwOnError();
    const { data: antes } = await admin
      .from("contact")
      .select("funnel_stage_changed_at, last_contact_at")
      .eq("id", contato)
      .single()
      .throwOnError();

    const { data: editados, error } = await como("recepcao-a")
      .from("contact")
      .update({
        funnel_stage_changed_at: new Date().toISOString(),
        last_contact_at: new Date().toISOString(),
      })
      .eq("id", contato)
      .select("id");
    expect(error).toBeNull();
    expect(editados).toHaveLength(1);

    const { data: depois } = await admin
      .from("contact")
      .select("funnel_stage_changed_at, last_contact_at")
      .eq("id", contato)
      .single()
      .throwOnError();
    expect(depois).toEqual(antes);
  });
});

describe("etapa e etiqueta usadas por automacao", () => {
  it("nao se excluem, com a mensagem que diz o que fazer", async () => {
    const { data: etapas, error: erroEtapa } = await como("admin-a")
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "c2")
      .select("id");
    expect(etapas ?? []).toHaveLength(0);
    expect(erroEtapa?.hint).toBe("etapa_usada_por_automacao");
    expect(erroEtapa?.message).toContain(
      "Esta etapa é usada por uma automação de fluxo.",
    );

    const { data: etiquetas, error: erroEtiqueta } = await como("admin-a")
      .from("conversation_tag_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "urgente")
      .select("id");
    expect(etiquetas ?? []).toHaveLength(0);
    expect(erroEtiqueta?.hint).toBe("etiqueta_usada_por_automacao");

    // positivo: etiqueta sem automacao se exclui
    const { data: livre, error } = await como("admin-a")
      .from("conversation_tag_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "so_da_a")
      .select("id");
    expect(error).toBeNull();
    expect(livre).toHaveLength(1);
  });
});
