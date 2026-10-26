import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Terceira leva do Painel geral (CS; migration 20261026120000_painel_cs_3.sql),
// contra o banco REAL. Decisoes do dono de 26/10/2026:
// 1. "Atencao nos 30 primeiros dias": a clinica sem uso criada ha menos de
//    30 dias aparece com o sinal novo ainda_sem_acesso (Atencao, desde a
//    criacao), e nao mais sem_uso (Em risco); com 30 dias ou mais, sem_uso,
//    como antes. Os totais em_uso e sem_uso nao mudam.
// 2. "Sim, numa migration pequena": o gatilho validar_dados_da_clinica recusa
//    (23514) o nome vazio ou so de brancos (nome_da_clinica_vazio) e o fuso
//    fora da regra barata (fuso_invalido, com o motivo no DETAIL): nome IANA
//    de regiao com barra ou UTC, digito ou + so nos Etc/GMT da tabela, fora
//    de posix/ e right/ (sem caixa) e reconhecido pelo Postgres; no INSERT e
//    no UPDATE que muda o nome ou o fuso.
// O que esta em jogo aqui:
// - a clinica nova sem acesso (a A): ainda_sem_acesso com o desde igual a
//   criacao, Atencao;
// - a antiga sem acesso (a B, com created_at gravado 40 dias atras pela
//   service role; o set_updated_at e os outros gatilhos de clinic nao mexem
//   na criacao): sem_uso, Em risco;
// - os totais: sem_uso conta a nova sem acesso; as tres saudes somam as
//   clinicas;
// - o gatilho pela service role: INSERT e UPDATE recusados com 23514, a
//   mensagem e o motivo certos (nada gravado, a linha intacta): o fuso
//   inexistente, em minusculas, POSIX, POSIX disfarcado de nome
//   (America/Sao_Paulo-3), Factory, posix/ e Posix/ (na producao o Postgres
//   acha Posix/America/Fortaleza sem caixa: so a exclusao o recusa); e os que
//   passam (Asia/Tokyo, UTC, outra coluna). A sessao da administradora fica
//   em tests/rls/painel-cs-3.test.ts.
// As bordas exatas (30 dias exatos e 1 microssegundo a menos), a ordem dos
// sinais, a regra recalculada para toda linha, a linha antiga fora da regra,
// o cadastro (handle_new_user) e cada um dos brancos do .trim() ficam no
// ensaio da migration (~/.claude/plans/painel-cs/ensaio-20261026120000.sql),
// que monta os instantes e as linhas dentro da transacao desfeita.
//
// CUSTO: a regra do fuso nao le lista (microssegundos por fuso; a primeira
// vez numa conexao, de 5 a 8 ms na producao para o Postgres carregar o
// arquivo do fuso).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// painel-cs3-int-*, apagadas no afterAll (prazo de 60 s; vinculos e numeros
// vao em cascata; o beforeAll apaga a sobra de uma execucao que morreu ha
// mais de uma hora), e os usuarios desta execucao. Nada aqui usa a id da
// Salud Care, da teste123 nem da Conduzza Teste, nada liga o agente nem
// envia mensagem (o numero e do provedor falso). ESCRITO, AINDA NAO RODADO
// (roda depois de aplicar a migration: npm run test:integration --
// painel-cs-3).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'painel-cs3-int-%';
//   delete from public.clinic where slug like 'painel-cs3-int-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-cs3-int-%@teste.dev';
//   delete from auth.users u where u.email like 'painel-cs3-int-%@teste.dev';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelCs3Int!${sufixo}`;

const email = (papel: string) => `painel-cs3-int-${papel}-${sufixo}@teste.dev`;
const slug = (nome: string) => `painel-cs3-int-${nome}-${sufixo}`;

/** Os brancos que o .trim() do JavaScript tira, montados pelo codigo. */
const ESPACO_NAO_SEPARAVEL = String.fromCharCode(0xa0);
const TAB_E_QUEBRA = String.fromCharCode(0x09, 0x0a);
const ESPACO_IDEOGRAFICO_E_BOM = String.fromCharCode(0x3000, 0xfeff);

/** A clinica nova sem acesso. */
let clinicaNova = "";
/** A clinica antiga sem acesso (created_at 40 dias atras). */
let clinicaAntiga = "";
/** A clinica das recusas do gatilho pela service role. */
let clinicaDoGatilho = "";
const ids = new Map<string, string>();

type Erro = {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
} | null;

/** Os motivos (DETAIL) das recusas do fuso. */
const MOTIVO_FORMATO =
  "O fuso não é um nome IANA de região (Área/Lugar) nem UTC.";
const MOTIVO_SISTEMA =
  "O fuso é de um diretório do sistema (posix/ ou right/), que a tela não reconhece.";
const MOTIVO_POSTGRES = "O Postgres não reconhece o fuso.";

type Sinal = {
  chave: string;
  nivel: string;
  quantidade: number | null;
  desde: string | null;
};
type LinhaDoPainel = {
  id: string;
  criada_em: string;
  em_uso: boolean;
  ultimo_acesso: { em: string } | null;
  saude: string;
  sinais: Sinal[];
};
type PainelCs = {
  totais: {
    clinicas: number;
    em_uso: number;
    sem_uso: number;
    saude: { saudavel: number; atencao: number; em_risco: number };
  };
  clinicas: LinhaDoPainel[];
};
type DadosDaClinica = {
  name: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Painel CS3 Int ${nome} ${sufixo}`,
      slug: slug(nome.toLowerCase()),
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Um administrador que NUNCA entra (sem login, sem sessao). */
async function criarAdministrador(
  papel: string,
  clinicId: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papel),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Painel CS3 ${papel}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${papel}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(papel, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role: "admin",
      status: "ativo",
    })
    .throwOnError();
}

async function painel(): Promise<PainelCs> {
  const { data, error } = await admin.rpc("painel_cs_das_clinicas", {
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  return data as PainelCs;
}

function linha(p: PainelCs, clinicId: string): LinhaDoPainel {
  const achada = p.clinicas.find((c) => c.id === clinicId);
  if (!achada) {
    throw new Error("clinica fora do painel");
  }
  return achada;
}

async function dadosDa(clinicId: string): Promise<DadosDaClinica> {
  const { data } = await admin
    .from("clinic")
    .select("name, timezone, created_at, updated_at")
    .eq("id", clinicId)
    .single()
    .throwOnError();
  return data as DadosDaClinica;
}

/**
 * Recusa que nao recusou (a migration ainda nao aplicada): a linha sai ja,
 * para nao deixar clinica fora da regra no banco (um fuso inexistente
 * derruba o Painel geral com as clinicas de teste).
 */
async function apagarSeGravou(
  gravadas: { id: string }[] | null,
): Promise<void> {
  const idsGravados = (gravadas ?? []).map((g) => g.id);
  if (idsGravados.length > 0) {
    await admin.from("clinic").delete().in("id", idsGravados).throwOnError();
  }
}

const diasAtras = (dias: number) =>
  new Date(Date.now() - dias * 24 * 60 * 60_000).toISOString();

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "painel-cs3-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaNova = await criarClinica("Nova");
  clinicaAntiga = await criarClinica("Antiga");
  clinicaDoGatilho = await criarClinica("Gatilho");
  // Ninguem entra na nova nem na antiga; as duas com um numero conectado
  // (sem o sinal de sem numero).
  await criarAdministrador("admin-nova", clinicaNova);
  await criarAdministrador("admin-antiga", clinicaAntiga);
  await criarNumeroDeTeste(admin, clinicaNova, {
    nome: "Recepção",
    connection_status: "conectado",
  });
  await criarNumeroDeTeste(admin, clinicaAntiga, {
    nome: "Recepção",
    connection_status: "conectado",
  });
  // A antiga: a criacao 40 dias atras, gravada pela service role (so o
  // set_updated_at dispara nesse UPDATE: o gatilho novo e o de numeros so
  // olham as colunas deles).
  await admin
    .from("clinic")
    .update({ created_at: diasAtras(40) })
    .eq("id", clinicaAntiga)
    .throwOnError();
}, 120_000);

afterAll(async () => {
  // As clinicas desta execucao pelo slug (a do INSERT bom inclusive);
  // vinculos e numeros vao em cascata. Depois os usuarios, com o erro
  // conferido: limpeza que falha calada deixaria usuario sintetico na
  // producao.
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `painel-cs3-int-%-${sufixo}`);
  expect(erroDasClinicas, "apagar as clinicas do teste").toBeNull();
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("o sinal de sem uso pela idade da clínica", () => {
  it("a criação gravada no passado pela service role fica (o set_updated_at e os outros gatilhos não mexem nela)", async () => {
    const antiga = await dadosDa(clinicaAntiga);
    const idadeEmDias =
      (Date.now() - new Date(antiga.created_at).getTime()) / (24 * 60 * 60_000);
    expect(idadeEmDias).toBeGreaterThan(39.9);
    expect(idadeEmDias).toBeLessThan(40.1);
    // O UPDATE passou pelo set_updated_at (a ultima mudanca e de agora) e o
    // nome e o fuso ficaram.
    expect(Date.now() - new Date(antiga.updated_at).getTime()).toBeLessThan(
      10 * 60_000,
    );
    expect(antiga.name).toBe(`Painel CS3 Int Antiga ${sufixo}`);
    expect(antiga.timezone).toBe("America/Fortaleza");
  });

  it("a clínica nova em que ninguém entrou: ainda_sem_acesso desde a criação, Atenção", async () => {
    const nova = linha(await painel(), clinicaNova);
    expect(nova.em_uso).toBe(false);
    expect(nova.ultimo_acesso).toBeNull();
    expect(nova.sinais).toEqual([
      {
        chave: "ainda_sem_acesso",
        nivel: "atencao",
        quantidade: null,
        desde: nova.criada_em,
      },
    ]);
    expect(nova.saude).toBe("atencao");
    // O desde e a criacao gravada na tabela.
    const dados = await dadosDa(clinicaNova);
    expect(new Date(nova.sinais[0]?.desde ?? "").getTime()).toBe(
      new Date(dados.created_at).getTime(),
    );
  });

  it("a clínica de 40 dias em que ninguém entrou: sem_uso, Em risco, como antes", async () => {
    const antiga = linha(await painel(), clinicaAntiga);
    expect(antiga.em_uso).toBe(false);
    expect(antiga.sinais).toEqual([
      { chave: "sem_uso", nivel: "em_risco", quantidade: null, desde: null },
    ]);
    expect(antiga.saude).toBe("em_risco");
  });

  it("os totais: sem_uso conta a nova sem acesso; as três saúdes somam as clínicas; sem uso, sempre um dos dois sinais", async () => {
    const p = await painel();
    expect(p.totais.em_uso + p.totais.sem_uso).toBe(p.totais.clinicas);
    expect(p.totais.sem_uso).toBe(p.clinicas.filter((c) => !c.em_uso).length);
    expect(
      p.totais.saude.saudavel +
        p.totais.saude.atencao +
        p.totais.saude.em_risco,
    ).toBe(p.totais.clinicas);
    for (const c of p.clinicas) {
      const deSemUso = c.sinais.filter(
        (s) => s.chave === "sem_uso" || s.chave === "ainda_sem_acesso",
      );
      expect(deSemUso, `os sinais de sem uso de ${c.id}`).toHaveLength(
        c.em_uso ? 0 : 1,
      );
    }
  });
});

describe("o gatilho de clinic pela service role", () => {
  it("INSERT com o nome vazio ou só de brancos: 23514 nome_da_clinica_vazio, nada gravado", async () => {
    const nomes = [
      "",
      "   ",
      ESPACO_NAO_SEPARAVEL,
      TAB_E_QUEBRA,
      ESPACO_IDEOGRAFICO_E_BOM,
    ];
    for (const [i, nome] of nomes.entries()) {
      const { data: gravadas, error } = await admin
        .from("clinic")
        .insert({
          name: nome,
          slug: slug(`recusada-nome-${i}`),
          e_de_teste: true,
        })
        .select("id");
      await apagarSeGravou(gravadas);
      expect((error as Erro)?.code, `o nome ${i}`).toBe("23514");
      expect((error as Erro)?.message, `o nome ${i}`).toBe(
        "nome_da_clinica_vazio",
      );
    }
    const { data } = await admin
      .from("clinic")
      .select("id")
      .like("slug", `painel-cs3-int-recusada-nome-%-${sufixo}`)
      .throwOnError();
    expect(data).toEqual([]);
  });

  it("INSERT com o fuso fora da regra: 23514 fuso_invalido com o motivo, nada gravado", async () => {
    const fusos: [string, string][] = [
      ["Fuso/Inexistente", MOTIVO_POSTGRES],
      ["america/fortaleza", MOTIVO_FORMATO],
      ["UTC+3", MOTIVO_FORMATO],
      // POSIX disfarcado de nome: o Postgres aceitaria, o JavaScript nao.
      ["America/Sao_Paulo-3", MOTIVO_FORMATO],
      ["Factory", MOTIVO_FORMATO],
      ["posix/America/Fortaleza", MOTIVO_FORMATO],
      // Na producao o Postgres acha este sem caixa: so a exclusao recusa.
      ["Posix/America/Fortaleza", MOTIVO_SISTEMA],
    ];
    for (const [i, [fuso, motivo]] of fusos.entries()) {
      const { data: gravadas, error } = await admin
        .from("clinic")
        .insert({
          name: `Painel CS3 Int recusada ${sufixo}`,
          slug: slug(`recusada-fuso-${i}`),
          e_de_teste: true,
          timezone: fuso,
        })
        .select("id");
      await apagarSeGravou(gravadas);
      expect((error as Erro)?.code, fuso).toBe("23514");
      expect((error as Erro)?.message, fuso).toBe("fuso_invalido");
      expect((error as Erro)?.details, fuso).toBe(motivo);
    }
    const { data } = await admin
      .from("clinic")
      .select("id")
      .like("slug", `painel-cs3-int-recusada-fuso-%-${sufixo}`)
      .throwOnError();
    expect(data).toEqual([]);
  }, 30_000);

  it("os INSERT que passam: um fuso de fora do Brasil (Asia/Tokyo) e UTC", async () => {
    for (const [nome, fuso] of [
      ["toquio", "Asia/Tokyo"],
      ["utc", "UTC"],
    ] as const) {
      const { data, error } = await admin
        .from("clinic")
        .insert({
          name: `Painel CS3 Int ${fuso} ${sufixo}`,
          slug: slug(nome),
          e_de_teste: true,
          timezone: fuso,
        })
        .select("timezone")
        .single();
      expect(error, fuso).toBeNull();
      expect((data as { timezone: string }).timezone).toBe(fuso);
    }
  });

  it("UPDATE para o nome vazio ou o fuso inexistente: 23514, e a linha fica como estava", async () => {
    const antes = await dadosDa(clinicaDoGatilho);
    try {
      for (const nome of ["", ESPACO_NAO_SEPARAVEL, TAB_E_QUEBRA]) {
        const { error } = await admin
          .from("clinic")
          .update({ name: nome })
          .eq("id", clinicaDoGatilho);
        expect((error as Erro)?.code).toBe("23514");
        expect((error as Erro)?.message).toBe("nome_da_clinica_vazio");
      }
      for (const fuso of ["Fuso/Inexistente", "BRT"]) {
        const { error } = await admin
          .from("clinic")
          .update({ timezone: fuso })
          .eq("id", clinicaDoGatilho);
        expect((error as Erro)?.code, fuso).toBe("23514");
        expect((error as Erro)?.message, fuso).toBe("fuso_invalido");
      }
      const depois = await dadosDa(clinicaDoGatilho);
      expect(depois.name).toBe(antes.name);
      expect(depois.timezone).toBe(antes.timezone);
    } finally {
      // Sem o gatilho (a migration ainda nao aplicada), a linha mudaria:
      // volta ja (o mesmo nome e o mesmo fuso de novo nao custam nada).
      await admin
        .from("clinic")
        .update({ name: antes.name, timezone: antes.timezone })
        .eq("id", clinicaDoGatilho)
        .throwOnError();
    }
  }, 30_000);

  it("os UPDATE que passam: o nome bom, um fuso de fora do Brasil e outra coluna", async () => {
    const { error: nome } = await admin
      .from("clinic")
      .update({ name: `Painel CS3 Int Gatilho renomeada ${sufixo}` })
      .eq("id", clinicaDoGatilho);
    expect(nome).toBeNull();
    for (const fuso of ["Pacific/Kiritimati", "America/Fortaleza"]) {
      const { error } = await admin
        .from("clinic")
        .update({ timezone: fuso })
        .eq("id", clinicaDoGatilho);
      expect(error, fuso).toBeNull();
      expect((await dadosDa(clinicaDoGatilho)).timezone).toBe(fuso);
    }
    const { error: outraColuna } = await admin
      .from("clinic")
      .update({ waitlist_wave_size: 6 })
      .eq("id", clinicaDoGatilho);
    expect(outraColuna).toBeNull();
  }, 30_000);
});
