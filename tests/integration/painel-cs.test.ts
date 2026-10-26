import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "../rls/stack";

// Painel geral como acompanhamento de cliente (CS; migration
// 20261026100000_painel_cs.sql), contra o banco REAL, com login de verdade
// no Auth (o que grava auth.users.last_sign_in_at e cria uma sessao em
// auth.sessions; a saida, signOut, apaga as sessoes da pessoa). O que esta
// em jogo:
// - o ultimo acesso de uma pessoa e a ULTIMA ATIVIDADE dela (decisao do
//   dono de 26/10/2026, "Pela ultima atividade"): o maior entre o login e a
//   renovacao das sessoes. Quem entra e FICA conectado, com a sessao
//   renovada depois (o que o sistema faz enquanto a pessoa usa), aparece
//   com o instante da renovacao, nao o do login; a renovacao de quem e
//   inativo aparece no detalhe, mas nao conta; e quem sai (signOut) volta
//   ao login (as sessoes somem: o limite escrito na migration);
// - o ultimo acesso da clinica e a ultima atividade mais recente dos
//   vinculos ATIVOS: o Implementador que entrou por ultimo aparece (com
//   implementador verdadeiro); o pendente e o inativo que entram DEPOIS nao
//   mudam nada; quem nunca entrou fica de fora; clinica sem login de
//   ninguem vem com o ultimo acesso nulo, "sem uso", e no fim da lista;
// - as contagens da equipe (ativas, pendentes, equipe Conduzza) e as pessoas
//   da busca (todo vinculo, qualquer situacao);
// - os totais: em_uso + sem_uso = clinicas, e em_uso e o numero de linhas
//   em uso;
// - a equipe no detalhe: os Implementadores numa lista separada, cada
//   pessoa com papel, situacao e ultimo acesso, na ordem (situacao, papel,
//   nome); clinica que nao existe: nulo; clinica nula: 22004;
// - o agente pelo painel (definir_agente_da_clinica_no_painel, revisao de
//   26/10/2026): com o estado que a tela mostrava, muda como
//   definir_agente_da_clinica; com um estado velho (a lista aberta em outra
//   aba), recusa com P0001 agente_mudou e o estado de agora no hint, sem
//   mudar nada (nem passar por cima do "So simulador" da clinica); o mesmo
//   estado de novo, 22023 mudanca_invalida. A B deixa de ser de teste SO
//   DENTRO desse teste (definir_agente_da_clinica recusa as de teste) e
//   volta a ser no finally, desligada; ela nao tem numero nem telefone,
//   entao nem em Teste a IA atende nela;
// - com INTEGRACAO_COM_SUPER_ADMIN=1 (opt-in, como o RLS_COM_SUPER_ADMIN de
//   painel-geral.test.ts: cria um product_admin sintetico NA PRODUCAO, com
//   senha aleatoria e e-mail em example.com, e o apaga no fim): o super
//   admin com vinculo ativo na A entra por ultimo e VIRA o ultimo acesso da
//   A, marcado (equipe_conduzza), e conta nas ativas (o desenho: "dos
//   membros ATIVOS"); aparece na equipe, marcado.
// A regra dos 30 dias (30 dias exatos em uso, 30 dias e 1 microssegundo
// sem uso), o empate pelo menor user_id e a sessao renovada ha dias com o
// login de mais de 30 nao se montam pela API (o Auth nao deixa escolher a
// data do login nem da renovacao): o ensaio da migration
// (~/.claude/plans/painel-cs/ensaio-20261026100000.sql) prova os tres, e o
// refreshed_at (sem fuso) lido em UTC.
//
// CUIDADO, o banco e o da producao: tres clinicas e_de_teste, apagadas no
// afterAll (vinculos e marcas vao em cascata; o beforeAll apaga a sobra de
// uma execucao que morreu ha mais de uma hora), e os usuarios desta
// execucao (as sessoes deles saem com eles, em cascata; as que o teste da
// ultima atividade abre tambem saem no fim dele, pelo signOut). Nada aqui
// usa a id da Salud Care, da teste123 nem da Conduzza
// Teste. As duas funcoes de leitura so leem; a do agente grava pela
// definir_agente_da_clinica de sempre, so na B, que sai no afterAll (o
// estado e a liberacao vao em cascata). ESCRITO, AINDA NAO RODADO (roda
// depois de aplicar a migration: npm run test:integration -- painel-cs).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name, e_de_teste from public.clinic where slug like 'painel-cs-int-%';
//   delete from public.clinic where slug like 'painel-cs-int-%';
// (A B que ficou sem a marca de teste sai junto: apagar a clinica leva a
// linha de ia_clinica_habilitada e a de ia_liberacao, em cascata.)
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'painel-cs-int-super-%@example.com';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-cs-int-%@teste.dev'
//       or u.email like 'painel-cs-int-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'painel-cs-int-%@teste.dev'
//       or u.email like 'painel-cs-int-super-%@example.com';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelCsInt!${sufixo}`;
const COM_SUPER_ADMIN = process.env.INTEGRACAO_COM_SUPER_ADMIN === "1";

const email = (papel: string) => `painel-cs-int-${papel}-${sufixo}@teste.dev`;
const EMAIL_DO_SUPER = `painel-cs-int-super-${sufixo}@example.com`;

let clinicaA = "";
let clinicaB = "";
let clinicaC = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string; hint?: string } | null;

type UltimoAcesso = {
  em: string;
  user_id: string;
  nome: string | null;
  email: string | null;
  papel: string;
  implementador: boolean;
  equipe_conduzza: boolean;
};
type LinhaDoPainel = {
  id: string;
  nome: string;
  em_uso: boolean;
  ultimo_acesso: UltimoAcesso | null;
  membros_ativos: number;
  membros_pendentes: number;
  membros_equipe_conduzza: number;
  pessoas: { nome: string | null; email: string | null }[];
};
type PainelCs = {
  gerado_em: string;
  totais: {
    clinicas: number;
    em_uso: number;
    sem_uso: number;
    suspensas: number;
    agente_liberado: number;
    gasto_mes_centavos_usd: number;
  };
  clinicas: LinhaDoPainel[];
};
type PessoaDaEquipe = {
  user_id: string;
  nome: string | null;
  email: string | null;
  papel: string;
  situacao: string;
  ultimo_acesso_em: string | null;
  na_equipe_desde: string;
  equipe_conduzza: boolean;
  conta_no_uso: boolean;
  marcado_em: string | null;
};
type EquipeNoPainel = {
  clinic_id: string;
  gerado_em: string;
  equipe: PessoaDaEquipe[];
  implementadores: PessoaDaEquipe[];
};

function idDe(papel: string): string {
  const id = ids.get(papel);
  if (!id) {
    throw new Error(`sem usuário ${papel}`);
  }
  return id;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Painel CS Int ${nome} ${sufixo}`,
      slug: `painel-cs-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarMembro(
  papel: string,
  clinicId: string,
  role: string,
  status = "ativo",
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papel),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Painel CS ${papel}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${papel}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(papel, data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: data.user.id, role, status })
    .throwOnError();
}

/**
 * Um login de verdade (grava last_sign_in_at e cria uma sessao em
 * auth.sessions), e a saida (o signOut apaga as sessoes da pessoa: a ultima
 * atividade dela fica o login).
 */
async function entrar(enderecoDeEmail: string, senha: string): Promise<void> {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: enderecoDeEmail,
    password: senha,
  });
  if (error) {
    throw new Error(`login: ${error.message}`);
  }
  await cliente.auth.signOut();
}

type Conectado = {
  cliente: ReturnType<typeof anonClient>;
  refreshToken: string;
};

/** Um login de verdade que FICA conectado (a sessao continua em auth.sessions). */
async function entrarEFicar(
  enderecoDeEmail: string,
  senha: string,
): Promise<Conectado> {
  const cliente = anonClient();
  const { data, error } = await cliente.auth.signInWithPassword({
    email: enderecoDeEmail,
    password: senha,
  });
  if (error || !data.session) {
    throw new Error(`login: ${error?.message ?? "sem sessão"}`);
  }
  return { cliente, refreshToken: data.session.refresh_token };
}

/**
 * Renova a sessao, o que o sistema faz enquanto a pessoa usa (o middleware
 * e o navegador, quando o token de acesso vence): o Auth grava refreshed_at
 * e updated_at da sessao, e o last_sign_in_at NAO muda.
 */
async function renovar(conectado: Conectado): Promise<void> {
  const { data, error } = await conectado.cliente.auth.refreshSession({
    refresh_token: conectado.refreshToken,
  });
  if (error || !data.session) {
    throw new Error(`renovar: ${error?.message ?? "sem sessão"}`);
  }
  conectado.refreshToken = data.session.refresh_token;
}

/** O ultimo login gravado pelo Auth (auth.users.last_sign_in_at), em ms. */
async function ultimoLogin(papel: string): Promise<number> {
  const { data, error } = await admin.auth.admin.getUserById(idDe(papel));
  if (error || !data.user?.last_sign_in_at) {
    throw new Error(`sem login de ${papel}: ${error?.message ?? "nulo"}`);
  }
  return Date.parse(data.user.last_sign_in_at);
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

async function equipe(clinicId: string): Promise<EquipeNoPainel> {
  const { data, error } = await admin.rpc("equipe_da_clinica_no_painel", {
    p_clinic_id: clinicId,
  });
  expect(error).toBeNull();
  return data as EquipeNoPainel;
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora): a B pode ter
  // ficado sem a marca de teste, no meio do teste do agente.
  await admin
    .from("clinic")
    .delete()
    .like("slug", "painel-cs-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  clinicaC = await criarClinica("C");
  await criarMembro("admin-a", clinicaA, "admin");
  await criarMembro("impl-a", clinicaA, "admin");
  await criarMembro("recepcao-a", clinicaA, "recepcao");
  await criarMembro("pendente-a", clinicaA, "leitura", "pendente");
  await criarMembro("inativo-a", clinicaA, "recepcao", "inativo");
  await criarMembro("admin-b", clinicaB, "admin");
  // A C e da ultima atividade: quem fica conectado e renova a sessao, e um
  // inativo que renova depois (nao conta).
  await criarMembro("renova-c", clinicaC, "admin");
  await criarMembro("inativo-c", clinicaC, "recepcao", "inativo");
  await admin
    .from("membro_implementador")
    .insert({ clinic_id: clinicaA, user_id: idDe("impl-a") })
    .throwOnError();

  // A ordem dos logins: o administrador, o Implementador (o ultimo que
  // conta) e, DEPOIS, o pendente e o inativo (que nao contam). A recepcao e
  // o administrador da B nunca entram. A pausa separa os instantes.
  for (const papel of ["admin-a", "impl-a", "pendente-a", "inativo-a"]) {
    await entrar(email(papel), SENHA);
    await pausa(1_100);
  }
}, 120_000);

afterAll(async () => {
  const clinicas = [clinicaA, clinicaB, clinicaC].filter((id) => id !== "");
  if (clinicas.length > 0) {
    const { error } = await admin.from("clinic").delete().in("id", clinicas);
    expect(error, "apagar as clinicas do teste").toBeNull();
  }
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("a lista do painel CS", () => {
  it("o último acesso da A é o Implementador; pendente e inativo que entraram depois não contam", async () => {
    const a = linha(await painel(), clinicaA);
    expect(a.ultimo_acesso?.user_id).toBe(idDe("impl-a"));
    expect(a.ultimo_acesso?.implementador).toBe(true);
    expect(a.ultimo_acesso?.equipe_conduzza).toBe(false);
    expect(a.ultimo_acesso?.papel).toBe("admin");
    expect(a.ultimo_acesso?.email).toBe(email("impl-a"));
    expect(a.ultimo_acesso?.nome).toBe("Painel CS impl-a");
    expect(a.em_uso).toBe(true);
    expect(Date.parse(a.ultimo_acesso?.em ?? "")).toBeGreaterThan(
      Date.now() - 10 * 60_000,
    );
  });

  it("as contagens da equipe e as pessoas da busca", async () => {
    const a = linha(await painel(), clinicaA);
    expect(a.membros_ativos).toBe(3);
    expect(a.membros_pendentes).toBe(1);
    expect(a.membros_equipe_conduzza).toBe(0);
    expect(a.pessoas.map((p) => p.email).sort()).toEqual(
      ["admin-a", "impl-a", "recepcao-a", "pendente-a", "inativo-a"]
        .map(email)
        .sort(),
    );
  });

  it("a B, sem login de ninguém: último acesso nulo, sem uso, depois da A", async () => {
    const p = await painel();
    const b = linha(p, clinicaB);
    expect(b.ultimo_acesso).toBeNull();
    expect(b.em_uso).toBe(false);
    expect(b.membros_ativos).toBe(1);
    const posicao = (id: string) => p.clinicas.findIndex((c) => c.id === id);
    expect(posicao(clinicaA)).toBeLessThan(posicao(clinicaB));
    // Quem nunca entrou fica no fim: depois da B, so linhas sem acesso.
    expect(
      p.clinicas
        .slice(posicao(clinicaB))
        .every((c) => c.ultimo_acesso === null),
    ).toBe(true);
  });

  it("os totais batem com as linhas", async () => {
    const p = await painel();
    expect(p.totais.clinicas).toBe(p.clinicas.length);
    expect(p.totais.em_uso).toBe(p.clinicas.filter((c) => c.em_uso).length);
    expect(p.totais.em_uso + p.totais.sem_uso).toBe(p.totais.clinicas);
  });

  it("sem a flag, as clínicas de teste ficam de fora", async () => {
    const { data, error } = await admin.rpc("painel_cs_das_clinicas");
    expect(error).toBeNull();
    const idsDaLista = (data as PainelCs).clinicas.map((c) => c.id);
    expect(idsDaLista).not.toContain(clinicaA);
    expect(idsDaLista).not.toContain(clinicaB);
    expect(idsDaLista).not.toContain(clinicaC);
  });
});

describe("a equipe no detalhe", () => {
  it("os Implementadores à parte, e a equipe na ordem (situação, papel, nome)", async () => {
    const e = await equipe(clinicaA);
    expect(e.clinic_id).toBe(clinicaA);
    expect(e.implementadores.map((p) => p.user_id)).toEqual([idDe("impl-a")]);
    expect(e.equipe.map((p) => p.user_id)).toEqual([
      idDe("admin-a"),
      idDe("recepcao-a"),
      idDe("pendente-a"),
      idDe("inativo-a"),
    ]);
    const impl = e.implementadores[0]!;
    expect(impl.papel).toBe("admin");
    expect(impl.situacao).toBe("ativo");
    expect(impl.conta_no_uso).toBe(true);
    expect(impl.marcado_em).not.toBeNull();
    for (const pessoa of e.equipe) {
      expect(pessoa.marcado_em).toBeNull();
      expect(pessoa.equipe_conduzza).toBe(false);
    }
  });

  it("papel, situação, último acesso e se conta no uso, de cada pessoa", async () => {
    const e = await equipe(clinicaA);
    const pessoa = (papel: string) => {
      const achada = e.equipe.find((p) => p.user_id === idDe(papel));
      if (!achada) {
        throw new Error(`sem ${papel} na equipe`);
      }
      return achada;
    };
    expect(pessoa("admin-a")).toMatchObject({
      papel: "admin",
      situacao: "ativo",
      conta_no_uso: true,
      email: email("admin-a"),
      nome: "Painel CS admin-a",
    });
    expect(pessoa("admin-a").ultimo_acesso_em).not.toBeNull();
    expect(pessoa("recepcao-a")).toMatchObject({
      papel: "recepcao",
      situacao: "ativo",
      conta_no_uso: true,
      ultimo_acesso_em: null,
    });
    // O pendente e o inativo entraram (a ultima atividade aparece), mas nao
    // contam.
    expect(pessoa("pendente-a")).toMatchObject({
      papel: "leitura",
      situacao: "pendente",
      conta_no_uso: false,
    });
    expect(pessoa("pendente-a").ultimo_acesso_em).not.toBeNull();
    expect(pessoa("inativo-a")).toMatchObject({
      situacao: "inativo",
      conta_no_uso: false,
    });
    expect(pessoa("inativo-a").ultimo_acesso_em).not.toBeNull();
  });

  it("clínica que não existe: nulo; clínica nula: 22004", async () => {
    const { data, error } = await admin.rpc("equipe_da_clinica_no_painel", {
      p_clinic_id: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
    const { error: erroNulo } = await admin.rpc("equipe_da_clinica_no_painel", {
      p_clinic_id: null,
    });
    expect((erroNulo as Erro)?.code).toBe("22004");
  });
});

// A ultima atividade (decisao do dono de 26/10/2026): a renovacao da sessao
// conta, nao so o login. Os instantes comparados sao todos do servidor (o
// login pelo Auth, a renovacao pelo banco): o relogio desta maquina nao
// entra.
describe("o último acesso é a última atividade, não só o login", () => {
  it("quem fica conectado e renova a sessão aparece com a renovação; o inativo que renova depois não conta; a saída volta ao login", async () => {
    const renova = await entrarEFicar(email("renova-c"), SENHA);
    let inativo: Conectado | null = null;
    try {
      // O login, e mais de 2 s depois a renovacao (sem login novo).
      await pausa(2_100);
      await renovar(renova);
      // O inativo entra e renova DEPOIS: a atividade dele e a mais nova da
      // C, mas ele nao conta.
      inativo = await entrarEFicar(email("inativo-c"), SENHA);
      await pausa(1_100);
      await renovar(inativo);

      const login = await ultimoLogin("renova-c");
      const c = linha(await painel(), clinicaC);
      expect(c.ultimo_acesso?.user_id).toBe(idDe("renova-c"));
      const em = Date.parse(c.ultimo_acesso?.em ?? "");
      // A renovacao, e nao o login: pelo menos os 2 s da pausa depois dele.
      expect(em - login).toBeGreaterThanOrEqual(2_000);
      expect(c.em_uso).toBe(true);
      expect(c.membros_ativos).toBe(1);

      // O detalhe conta igual: a mesma ultima atividade para quem renovou;
      // a do inativo aparece (mais nova), sem contar no uso.
      const e = await equipe(clinicaC);
      const pessoa = (papel: string) => {
        const achada = e.equipe.find((p) => p.user_id === idDe(papel));
        if (!achada) {
          throw new Error(`sem ${papel} na equipe`);
        }
        return achada;
      };
      expect(Date.parse(pessoa("renova-c").ultimo_acesso_em ?? "")).toBe(em);
      expect(pessoa("inativo-c")).toMatchObject({
        situacao: "inativo",
        conta_no_uso: false,
      });
      expect(
        Date.parse(pessoa("inativo-c").ultimo_acesso_em ?? ""),
      ).toBeGreaterThan(em);

      // A saida (signOut) apaga as sessoes da pessoa: o ultimo acesso volta
      // ao login, o limite escrito na migration.
      const { error: erroDaSaida } = await renova.cliente.auth.signOut();
      expect(erroDaSaida).toBeNull();
      const depois = linha(await painel(), clinicaC);
      expect(depois.ultimo_acesso?.user_id).toBe(idDe("renova-c"));
      expect(
        Math.abs(Date.parse(depois.ultimo_acesso?.em ?? "") - login),
      ).toBeLessThan(1_000);
    } finally {
      // As sessoes que o teste abriu saem aqui (e, de todo jeito, com os
      // usuarios no afterAll).
      await renova.cliente.auth.signOut();
      await inativo?.cliente.auth.signOut();
    }
  }, 60_000);
});

// O agente pelo painel, conferindo o estado que a tela mostrava. A B sem a
// marca de teste so aqui dentro (definir_agente_da_clinica recusa as de
// teste), e de volta no finally, desligada.
describe("o agente pelo painel confere o estado que a tela mostrava", () => {
  async function agente(
    estadoVisto: string,
    estado: string,
  ): Promise<Erro> {
    const { error } = await admin.rpc("definir_agente_da_clinica_no_painel", {
      p_clinic_id: clinicaB,
      p_estado_visto: estadoVisto,
      p_estado: estado,
      p_motivo: "Teste de integração do painel CS",
    });
    return error as Erro;
  }

  async function comoEsta(): Promise<{
    estado: string | null;
    modo: string | null;
    liberada: boolean | null;
  }> {
    const { data: h } = await admin
      .from("ia_clinica_habilitada")
      .select("estado")
      .eq("clinic_id", clinicaB)
      .maybeSingle()
      .throwOnError();
    const { data: l } = await admin
      .from("ia_liberacao")
      .select("modo, liberada")
      .eq("clinic_id", clinicaB)
      .maybeSingle()
      .throwOnError();
    const linha = l as { modo: string; liberada: boolean } | null;
    return {
      estado: (h as { estado: string } | null)?.estado ?? null,
      modo: linha?.modo ?? null,
      liberada: linha?.liberada ?? null,
    };
  }

  it("com o estado certo muda; com a tela velha recusa sem mudar nada; o mesmo estado de novo não é mudança", async () => {
    await admin
      .from("clinic")
      .update({ e_de_teste: false })
      .eq("id", clinicaB)
      .throwOnError();
    try {
      // A tela mostrava Teste, mas a B esta desligada (sem linha).
      const velha = await agente("teste", "desligado");
      expect(velha?.code).toBe("P0001");
      expect(velha?.message).toBe("agente_mudou");
      expect(velha?.hint).toBe("desligado");
      expect(await comoEsta()).toEqual({
        estado: null,
        modo: null,
        liberada: null,
      });

      // Liberar com o estado certo: Teste, liberada em contatos.
      expect(await agente("desligado", "teste")).toBeNull();
      expect(await comoEsta()).toEqual({
        estado: "teste",
        modo: "contatos",
        liberada: true,
      });

      // A clinica escolhe "So simulador"; a lista velha (Nao liberado)
      // clica "Liberar agente": recusado, a escolha da clinica fica.
      await admin
        .from("ia_liberacao")
        .update({ modo: "simulador" })
        .eq("clinic_id", clinicaB)
        .throwOnError();
      const listaVelha = await agente("desligado", "teste");
      expect(listaVelha?.code).toBe("P0001");
      expect(listaVelha?.message).toBe("agente_mudou");
      expect(listaVelha?.hint).toBe("teste");
      expect((await comoEsta()).modo).toBe("simulador");

      // Teste sobre Teste: 22023 mudanca_invalida, nada muda.
      const mesmo = await agente("teste", "teste");
      expect(mesmo?.code).toBe("22023");
      expect(mesmo?.message).toBe("mudanca_invalida");
      expect((await comoEsta()).modo).toBe("simulador");

      // Retirar com o estado certo (Teste): desligada.
      expect(await agente("teste", "desligado")).toBeNull();
      expect(await comoEsta()).toMatchObject({
        estado: "desligado",
        liberada: false,
      });

      // A trilha: as duas mudancas que passaram, nenhuma das recusas.
      const { data: trilha } = await admin
        .from("audit_log")
        .select("detalhes")
        .eq("clinic_id", clinicaB)
        .eq("action", "mudou_agente_da_clinica")
        .order("id")
        .throwOnError();
      expect(
        (trilha as { detalhes: { estado: string } }[]).map(
          (linha) => linha.detalhes.estado,
        ),
      ).toEqual(["teste", "desligado"]);
    } finally {
      // Desligada antes de voltar a ser de teste (o caminho de sempre, que
      // nao confere o estado visto), e de volta com a marca.
      await admin.rpc("definir_agente_da_clinica", {
        p_clinic_id: clinicaB,
        p_estado: "desligado",
        p_motivo: "Fim do teste de integração do painel CS",
      });
      await admin
        .from("clinic")
        .update({ e_de_teste: true })
        .eq("id", clinicaB)
        .throwOnError();
    }
  });

  it("a clínica que não existe: P0002, qualquer que seja o estado visto", async () => {
    for (const [visto, estado] of [
      ["desligado", "teste"],
      ["teste", "desligado"],
    ]) {
      const { error } = await admin.rpc("definir_agente_da_clinica_no_painel", {
        p_clinic_id: crypto.randomUUID(),
        p_estado_visto: visto,
        p_estado: estado,
        p_motivo: null,
      });
      expect((error as Erro)?.code).toBe("P0002");
    }
  });
});

// O super admin com vinculo na A: so com INTEGRACAO_COM_SUPER_ADMIN=1.
describe.skipIf(!COM_SUPER_ADMIN)(
  "a equipe Conduzza conta no uso, marcada (opt-in)",
  () => {
    const senhaDoSuper = `${crypto.randomUUID()}!Aa1`;
    let superAdmin = "";

    beforeAll(async () => {
      const { data, error } = await admin.auth.admin.createUser({
        email: EMAIL_DO_SUPER,
        password: senhaDoSuper,
        email_confirm: true,
        user_metadata: { name: "Super admin sintético" },
      });
      if (error || !data.user) {
        throw new Error(
          `criar super admin: ${error?.message ?? "sem usuário"}`,
        );
      }
      superAdmin = data.user.id;
      ids.set("super", superAdmin);
      await admin
        .from("product_admin")
        .insert({ user_id: superAdmin })
        .throwOnError();
      await admin
        .from("clinic_member")
        .insert({
          clinic_id: clinicaA,
          user_id: superAdmin,
          role: "admin",
          status: "ativo",
        })
        .throwOnError();
      // O super admin entra por ULTIMO, depois de todo mundo.
      await pausa(1_100);
      await entrar(EMAIL_DO_SUPER, senhaDoSuper);
    }, 60_000);

    afterAll(async () => {
      if (superAdmin) {
        // So o product_admin sai aqui; o vinculo sai com a clinica e o
        // usuario no afterAll geral.
        const { error } = await admin
          .from("product_admin")
          .delete()
          .eq("user_id", superAdmin);
        expect(error, "tirar o product_admin sintetico").toBeNull();
      }
    });

    it("o login do super admin (o último) vira o último acesso da A, marcado, e ele conta nas ativas", async () => {
      const a = linha(await painel(), clinicaA);
      expect(a.ultimo_acesso?.user_id).toBe(superAdmin);
      expect(a.ultimo_acesso?.equipe_conduzza).toBe(true);
      expect(a.ultimo_acesso?.implementador).toBe(false);
      expect(a.em_uso).toBe(true);
      expect(a.membros_ativos).toBe(4);
      expect(a.membros_equipe_conduzza).toBe(1);
      expect(a.pessoas.map((p) => p.email)).toContain(EMAIL_DO_SUPER);
      const e = await equipe(clinicaA);
      const doSuper = e.equipe.find((p) => p.user_id === superAdmin);
      expect(doSuper).toMatchObject({
        equipe_conduzza: true,
        conta_no_uso: true,
        situacao: "ativo",
        papel: "admin",
      });
      expect(doSuper?.ultimo_acesso_em).not.toBeNull();
    });
  },
);
