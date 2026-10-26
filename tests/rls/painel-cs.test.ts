import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Painel geral como acompanhamento de cliente (CS; migration
// 20261026100000_painel_cs.sql), pela API com JWT real de cada papel. O que
// esta em jogo:
// - painel_cs_das_clinicas (a lista e os totais),
//   equipe_da_clinica_no_painel (a equipe no detalhe, com os
//   Implementadores a parte) e definir_agente_da_clinica_no_painel (o agente
//   pelo painel, conferindo o estado que a tela mostrava; revisao de
//   26/10/2026) sao so da equipe Conduzza: 42501 para TODO papel da clinica
//   (o administrador e o Implementador inclusive, o pendente e o
//   administrador da outra clinica) e para anon. Ninguem da clinica le a
//   propria equipe nem a da outra por aqui (a clinica A nao ve a B). Na do
//   agente, o 42501 vem ANTES de olhar o estado: com o estado visto errado,
//   quem nao e da equipe Conduzza nunca recebe agente_mudou (que diria o
//   estado de agora no hint);
// - a service role passa da guarda (contraprova): le as duas clinicas de
//   teste com p_incluir_teste, sem a flag elas nao aparecem, e a equipe da A
//   traz o Implementador na lista dele; na do agente, o estado visto errado
//   recebe agente_mudou, e o certo chega a definir_agente_da_clinica, que
//   recusa a clinica de teste (P0001 clinica_de_teste): nada muda;
// - nenhum dado de paciente: o contato e a conversa sinteticos da A (nome,
//   telefone e previa com um marcador) nao aparecem no que as duas devolvem,
//   nem os ids deles.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// O SUPER ADMIN pela sessao so roda com RLS_COM_SUPER_ADMIN=1 (o mesmo
// opt-in de painel-geral.test.ts): o teste cria um usuario sintetico com
// product_admin NO BANCO DE PRODUCAO, com senha aleatoria da execucao,
// e-mail em example.com (dominio reservado, nenhuma caixa recebe), e apaga
// o product_admin no afterAll do bloco e o usuario no afterAll geral. Sem a
// variavel, esse bloco e pulado; o ensaio da migration
// (~/.claude/plans/painel-cs/ensaio-20261026100000.sql) prova o mesmo no SQL,
// com os super admins de ensaio dentro da transacao desfeita.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (o motor de producao
// e o painel as ignoram), apagadas no afterAll (prazo de 60 s; o beforeAll
// apaga a sobra de uma execucao que morreu ha mais de uma hora). Nada aqui
// usa a id da Salud Care, da teste123 nem da Conduzza Teste, e nada liga o
// agente: toda chamada da funcao do agente aqui e recusada (42501,
// agente_mudou ou clinica_de_teste), e a recusa nao grava nada. ESCRITO,
// AINDA NAO RODADO (roda depois de aplicar a migration: npm run test:rls --
// painel-cs).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar, NESTA ORDEM (as clinicas primeiro).
//   select id, name from public.clinic where slug like 'painel-cs-rls-%';
//   delete from public.clinic where slug like 'painel-cs-rls-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-cs-rls-%@teste.dev'
//       or u.email like 'painel-cs-rls-super-%@example.com';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'painel-cs-rls-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'painel-cs-rls-%@teste.dev'
//       or u.email like 'painel-cs-rls-super-%@example.com';

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelCs!Rls${sufixo}`;
const COM_SUPER_ADMIN = process.env.RLS_COM_SUPER_ADMIN === "1";

const email = (papel: string) => `painel-cs-rls-${papel}-${sufixo}@teste.dev`;
/** O super admin sintetico do bloco opt-in (apagado no afterAll geral). */
const EMAIL_DO_SUPER = `painel-cs-rls-super-${sufixo}@example.com`;

/** Marcador do paciente sintetico: nao pode aparecer no painel. */
const MARCADOR = `PACIENTE SINTETICO CS ${sufixo}`;
const DIGITOS = sufixo.replace(/\D/g, "").padEnd(4, "7").slice(0, 4);
const TELEFONE_DO_PACIENTE = `+55849783${DIGITOS}1`;

/** Os usuarios desta execucao (os papeis e o super admin sintetico). */
function eDestaExecucao(enderecoDeEmail: string | undefined): boolean {
  return (
    (enderecoDeEmail?.startsWith("painel-cs-rls-") ?? false) &&
    ((enderecoDeEmail?.endsWith(`-${sufixo}@teste.dev`) ?? false) ||
      enderecoDeEmail === EMAIL_DO_SUPER)
  );
}

/** Todo vinculo de clinica desta suite: nenhum le o painel. */
const TODOS_OS_PAPEIS = [
  "admin-a",
  "impl-a",
  "gestor-a",
  "recepcao-a",
  "leitura-a",
  "prof-a",
  "pendente-a",
  "admin-b",
] as const;

let clinicaA = "";
let clinicaB = "";
let contatoA = "";
let conversaA = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string; hint?: string } | null;

type LinhaDoPainel = {
  id: string;
  ultimo_acesso: { user_id: string } | null;
};
type PainelCs = {
  totais: Record<string, number>;
  clinicas: LinhaDoPainel[];
};
type PessoaDaEquipe = { user_id: string };
type EquipeNoPainel = {
  clinic_id: string;
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
      name: `Painel CS RLS ${nome} ${sufixo}`,
      slug: `painel-cs-rls-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarUsuario(
  papelNoEmail: string,
  clinicId: string,
  role: string,
  opcoes: { status?: string; professionalId?: string } = {},
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Painel CS ${papelNoEmail}` },
  });
  if (error || !data.user) {
    throw new Error(
      `criar ${papelNoEmail}: ${error?.message ?? "sem usuário"}`,
    );
  }
  ids.set(papelNoEmail, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: opcoes.status ?? "ativo",
      ...(opcoes.professionalId
        ? { professional_id: opcoes.professionalId }
        : {}),
    })
    .throwOnError();
  return data.user.id;
}

// Uma sessao por papel, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, SupabaseClient>();

async function logado(papelNoEmail: string): Promise<SupabaseClient> {
  const pronta = sessoes.get(papelNoEmail);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papelNoEmail),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papelNoEmail}: ${error.message}`);
  }
  sessoes.set(papelNoEmail, cliente);
  return cliente;
}

/** As chamadas do painel CS (montadas depois do beforeAll). */
function chamadas(): {
  rotulo: string;
  nome: string;
  args: Record<string, unknown>;
}[] {
  return [
    { rotulo: "lista padrão", nome: "painel_cs_das_clinicas", args: {} },
    {
      rotulo: "lista com as de teste",
      nome: "painel_cs_das_clinicas",
      args: { p_incluir_teste: true },
    },
    {
      rotulo: "equipe da A",
      nome: "equipe_da_clinica_no_painel",
      args: { p_clinic_id: clinicaA },
    },
    {
      rotulo: "equipe da B",
      nome: "equipe_da_clinica_no_painel",
      args: { p_clinic_id: clinicaB },
    },
    // O estado visto errado (a A esta desligada): a recusa por permissao
    // vem antes de olhar o estado.
    {
      rotulo: "agente da A pelo painel",
      nome: "definir_agente_da_clinica_no_painel",
      args: {
        p_clinic_id: clinicaA,
        p_estado_visto: "teste",
        p_estado: "desligado",
        p_motivo: "Teste de RLS do painel CS",
      },
    },
    {
      rotulo: "agente da B pelo painel",
      nome: "definir_agente_da_clinica_no_painel",
      args: {
        p_clinic_id: clinicaB,
        p_estado_visto: "desligado",
        p_estado: "teste",
        p_motivo: "Teste de RLS do painel CS",
      },
    },
  ];
}

// Sobra de uma execucao que morreu antes do afterAll: so clinicas de teste
// desta suite, criadas ha mais de uma hora.
beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "painel-cs-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Painel CS" })
    .select("id")
    .single()
    .throwOnError();

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("impl-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("prof-a", clinicaA, "profissional", {
    professionalId: (prof as { id: string }).id,
  });
  await criarUsuario("pendente-a", clinicaA, "recepcao", {
    status: "pendente",
  });
  await criarUsuario("admin-b", clinicaB, "admin");

  // A marca de Implementador pela service role (sem sessao: o gatilho pula
  // a permissao; sobra a admin-a como administradora plena).
  await admin
    .from("membro_implementador")
    .insert({ clinic_id: clinicaA, user_id: idDe("impl-a") })
    .throwOnError();

  // O paciente sintetico da A, com o marcador no nome e na previa.
  const numeroA = await criarNumeroDeTeste(admin, clinicaA, {
    nome: "Recepção",
  });
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: TELEFONE_DO_PACIENTE,
      name: MARCADOR,
    })
    .select("id")
    .single()
    .throwOnError();
  contatoA = (contato as { id: string }).id;
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      whatsapp_account_id: numeroA.id,
    })
    .select("id")
    .single()
    .throwOnError();
  conversaA = (conversa as { id: string }).id;
  await admin
    .from("message")
    .insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "entrada",
      author: "paciente",
      content_type: "texto",
      body: `${MARCADOR}: mensagem sintética`,
    })
    .throwOnError();
}, 120_000);

afterAll(async () => {
  // As clinicas PRIMEIRO (vinculos, marca, contato e conversa vao em
  // cascata). Depois, os usuarios desta execucao, o super admin sintetico
  // inclusive, com o erro conferido: limpeza que falha calada deixaria
  // usuario sintetico na producao.
  const clinicas = [clinicaA, clinicaB].filter((id) => id !== "");
  if (clinicas.length > 0) {
    const { error: erroDasClinicas } = await admin
      .from("clinic")
      .delete()
      .in("id", clinicas);
    expect(erroDasClinicas, "apagar as clinicas do teste").toBeNull();
  }
  const usuarios: string[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const lista = data?.users ?? [];
    for (const usuario of lista) {
      if (eDestaExecucao(usuario.email)) {
        usuarios.push(usuario.id);
      }
    }
    if (lista.length < 200) {
      break;
    }
  }
  const falhas: string[] = [];
  for (const id of usuarios) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("o painel CS é só da equipe Conduzza", () => {
  it("42501 para todo papel da clínica (o administrador e o Implementador inclusive) e para anon", async () => {
    for (const chamada of chamadas()) {
      for (const papel of TODOS_OS_PAPEIS) {
        const { data, error } = await (
          await logado(papel)
        ).rpc(chamada.nome, chamada.args);
        expect((error as Erro)?.code, `${chamada.rotulo} por ${papel}`).toBe(
          PERMISSAO_NEGADA,
        );
        expect(data, `${chamada.rotulo} por ${papel}: nada volta`).toBeNull();
      }
      const { data: dadosAnon, error: erroAnon } = await anonClient().rpc(
        chamada.nome,
        chamada.args,
      );
      expect((erroAnon as Erro)?.code, `${chamada.rotulo} por anon`).toBe(
        PERMISSAO_NEGADA,
      );
      expect(dadosAnon, `${chamada.rotulo} por anon: nada volta`).toBeNull();
    }
  });

  it("a service role passa da guarda (contraprova): as duas de teste com a flag, nenhuma sem", async () => {
    const { data: comTeste, error } = await admin.rpc(
      "painel_cs_das_clinicas",
      { p_incluir_teste: true },
    );
    expect(error).toBeNull();
    const idsComTeste = (comTeste as PainelCs).clinicas.map((c) => c.id);
    expect(idsComTeste).toEqual(expect.arrayContaining([clinicaA, clinicaB]));

    const { data: semTeste, error: erroSemTeste } = await admin.rpc(
      "painel_cs_das_clinicas",
    );
    expect(erroSemTeste).toBeNull();
    const idsSemTeste = (semTeste as PainelCs).clinicas.map((c) => c.id);
    expect(idsSemTeste).not.toContain(clinicaA);
    expect(idsSemTeste).not.toContain(clinicaB);

    const { data: equipe, error: erroEquipe } = await admin.rpc(
      "equipe_da_clinica_no_painel",
      { p_clinic_id: clinicaA },
    );
    expect(erroEquipe).toBeNull();
    const lida = equipe as EquipeNoPainel;
    expect(lida.clinic_id).toBe(clinicaA);
    expect(lida.implementadores.map((p) => p.user_id)).toEqual([
      idDe("impl-a"),
    ]);
    expect(lida.equipe.map((p) => p.user_id)).not.toContain(idDe("impl-a"));
    expect(lida.equipe.map((p) => p.user_id)).toContain(idDe("admin-a"));
    // A equipe da B nao tem ninguem da A (e vice-versa).
    const { data: equipeB } = await admin.rpc("equipe_da_clinica_no_painel", {
      p_clinic_id: clinicaB,
    });
    expect((equipeB as EquipeNoPainel).equipe.map((p) => p.user_id)).toEqual([
      idDe("admin-b"),
    ]);
  });

  it("o agente pelo painel pela service role (contraprova): o estado visto errado recebe agente_mudou; o certo chega à função de sempre, que recusa a clínica de teste; nada muda", async () => {
    const velho = await admin.rpc("definir_agente_da_clinica_no_painel", {
      p_clinic_id: clinicaA,
      p_estado_visto: "teste",
      p_estado: "desligado",
      p_motivo: "Teste de RLS do painel CS",
    });
    expect((velho.error as Erro)?.code).toBe("P0001");
    expect((velho.error as Erro)?.message).toBe("agente_mudou");
    expect((velho.error as Erro)?.hint).toBe("desligado");
    const certo = await admin.rpc("definir_agente_da_clinica_no_painel", {
      p_clinic_id: clinicaA,
      p_estado_visto: "desligado",
      p_estado: "teste",
      p_motivo: "Teste de RLS do painel CS",
    });
    expect((certo.error as Erro)?.code).toBe("P0001");
    expect((certo.error as Erro)?.message).toBe("clinica_de_teste");
    const { data: estado } = await admin
      .from("ia_clinica_habilitada")
      .select("estado")
      .in("clinic_id", [clinicaA, clinicaB]);
    expect(estado ?? []).toEqual([]);
    const { data: trilha } = await admin
      .from("audit_log")
      .select("id")
      .in("clinic_id", [clinicaA, clinicaB])
      .eq("action", "mudou_agente_da_clinica");
    expect(trilha ?? []).toEqual([]);
  });

  it("nenhum dado de paciente no que as duas devolvem", async () => {
    const { data: lista } = await admin.rpc("painel_cs_das_clinicas", {
      p_incluir_teste: true,
    });
    const { data: equipe } = await admin.rpc("equipe_da_clinica_no_painel", {
      p_clinic_id: clinicaA,
    });
    const texto = JSON.stringify(lista) + JSON.stringify(equipe);
    // Contraprova: a A esta no texto (o painel foi lido).
    expect(texto).toContain(clinicaA);
    for (const marcador of [
      MARCADOR,
      TELEFONE_DO_PACIENTE,
      TELEFONE_DO_PACIENTE.slice(1),
      contatoA,
      conversaA,
      "mensagem sintética",
    ]) {
      expect(texto, "dado de paciente no painel").not.toContain(marcador);
    }
  });
});

// O super admin pela sessao: so com RLS_COM_SUPER_ADMIN=1 (cabecalho).
describe.skipIf(!COM_SUPER_ADMIN)("o super admin pela sessão (opt-in)", () => {
  const senhaDoSuper = `${crypto.randomUUID()}!Aa1`;
  let superAdmin = "";
  let sessaoDoSuper: SupabaseClient | null = null;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL_DO_SUPER,
      password: senhaDoSuper,
      email_confirm: true,
      user_metadata: { name: "Super admin sintético" },
    });
    if (error || !data.user) {
      throw new Error(`criar super admin: ${error?.message ?? "sem usuário"}`);
    }
    superAdmin = data.user.id;
    await admin
      .from("product_admin")
      .insert({ user_id: superAdmin })
      .throwOnError();
    const cliente = anonClient();
    const { error: erroLogin } = await cliente.auth.signInWithPassword({
      email: EMAIL_DO_SUPER,
      password: senhaDoSuper,
    });
    if (erroLogin) {
      throw new Error(`login do super admin: ${erroLogin.message}`);
    }
    sessaoDoSuper = cliente;
  }, 60_000);

  afterAll(async () => {
    if (superAdmin) {
      // So o product_admin sai aqui; o usuario sai no afterAll geral.
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  it("lê a lista e a equipe, igual à service role", async () => {
    const sessao = sessaoDoSuper!;
    const { data: lista, error } = await sessao.rpc("painel_cs_das_clinicas", {
      p_incluir_teste: true,
    });
    expect(error).toBeNull();
    expect((lista as PainelCs).clinicas.map((c) => c.id)).toEqual(
      expect.arrayContaining([clinicaA, clinicaB]),
    );
    const { data: equipe, error: erroEquipe } = await sessao.rpc(
      "equipe_da_clinica_no_painel",
      { p_clinic_id: clinicaA },
    );
    expect(erroEquipe).toBeNull();
    const { data: equipePeloServidor } = await admin.rpc(
      "equipe_da_clinica_no_painel",
      { p_clinic_id: clinicaA },
    );
    const semInstante = (valor: unknown) => ({
      ...(valor as EquipeNoPainel & { gerado_em?: string }),
      gerado_em: null,
    });
    expect(semInstante(equipe)).toEqual(semInstante(equipePeloServidor));
  });

  it("muda o agente pelo painel: passa da guarda e recebe agente_mudou com o estado visto errado", async () => {
    const { error } = await sessaoDoSuper!.rpc(
      "definir_agente_da_clinica_no_painel",
      {
        p_clinic_id: clinicaA,
        p_estado_visto: "producao",
        p_estado: "teste",
        p_motivo: "Teste de RLS do painel CS",
      },
    );
    expect((error as Erro)?.code).toBe("P0001");
    expect((error as Erro)?.message).toBe("agente_mudou");
    expect((error as Erro)?.hint).toBe("desligado");
  });
});
