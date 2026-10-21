import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "../rls/stack";

// Onda 5, item 18 (migration 20261025110000_implementador.sql): os caminhos
// da tela para o Implementador pelas RPCs, contra o banco REAL, com JWT
// real (as RPCs sao SECURITY INVOKER: so authenticated executa). O que esta
// em jogo:
// - convite: a conta ja existe (o GoTrue a cria no convite) e
//   entrar_como_implementador cria o vinculo admin ativo e a marca na mesma
//   transacao ('convidado'); o convidado entra e e administrador nas tres
//   funcoes de acesso, mas nao e administrador pleno; convidar de novo da
//   23505 (como o convite de sempre);
// - liberacao do pedido de entrada: a pessoa pediu entrada pelo codigo da
//   clinica (handle_new_user, o caminho real: leitura pendente) e a RPC a
//   libera como Implementador ('liberado');
// - promocao e volta: 'promovido' e deixar_de_ser_implementador para o
//   papel de antes (a marca sai pelo gatilho) e para administrador pleno;
// - a aba desatualizada: o papel mudou em outra aba e a RPC recusa com
//   P0001 papel_mudou, sem mudar nada;
// - as recusas chegam com o codigo e a chave que a tela traduz (P0001
//   papel_mudou e ja_e_implementador, 22023 situacao_invalida e
//   papel_invalido, 42501 para quem nao e administrador pleno), sem laco de
//   retentativa do PostgREST (nenhuma e 40001).
// O painel do super admin com a lista "Implementadores" (P18-5) fica para
// depois da juncao com a onda 2 (que muda painel_geral_das_clinicas): o
// teste dele entra junto.
//
// CUIDADO, o banco e o da producao: uma clinica e_de_teste, apagada no
// afterAll (vinculos e marcas vao em cascata), e os usuarios desta
// execucao. Nada aqui usa a id da salud-care, da teste123 nem da Conduzza
// Teste. ESCRITO, AINDA NAO RODADO (roda depois de aplicar a migration:
// npm run test:integration -- implementador).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'implementador-int-%';
//   delete from public.clinic where slug like 'implementador-int-%';
//   select u.id, u.email from auth.users u where u.email like 'implementador-int-%@teste.dev';
//   delete from auth.users u where u.email like 'implementador-int-%@teste.dev';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `ImplementadorInt!${sufixo}`;

const email = (papel: string) =>
  `implementador-int-${papel}-${sufixo}@teste.dev`;

let clinicaA = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string } | null;

function idDe(papel: string): string {
  const id = ids.get(papel);
  if (!id) {
    throw new Error(`sem usuário ${papel}`);
  }
  return id;
}

async function criarConta(
  papel: string,
  metadados: Record<string, string> = {},
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papel),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Implementador ${papel}`, ...metadados },
  });
  if (error || !data.user) {
    throw new Error(`criar ${papel}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(papel, data.user.id);
  return data.user.id;
}

async function criarMembro(papel: string, role: string): Promise<void> {
  const userId = await criarConta(papel);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicaA, user_id: userId, role, status: "ativo" })
    .throwOnError();
}

const sessoes = new Map<string, SupabaseClient>();

async function logado(papel: string): Promise<SupabaseClient> {
  const pronta = sessoes.get(papel);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papel),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papel}: ${error.message}`);
  }
  sessoes.set(papel, cliente);
  return cliente;
}

async function vinculo(papel: string): Promise<string> {
  const { data: membro } = await admin
    .from("clinic_member")
    .select("role, status")
    .eq("clinic_id", clinicaA)
    .eq("user_id", idDe(papel))
    .maybeSingle();
  const { data: marca } = await admin
    .from("membro_implementador")
    .select("marcado_por")
    .eq("clinic_id", clinicaA)
    .eq("user_id", idDe(papel))
    .maybeSingle();
  const m = membro as { role: string; status: string } | null;
  return `${m ? `${m.role}:${m.status}` : "sem vinculo"}:${marca ? "marca" : "sem marca"}`;
}

async function entrar(
  quem: string,
  pessoa: string,
  situacaoLida?: string,
  papelLido?: string,
) {
  return (await logado(quem)).rpc("entrar_como_implementador", {
    p_clinic_id: clinicaA,
    p_user_id: idDe(pessoa),
    ...(situacaoLida !== undefined ? { p_situacao_lida: situacaoLida } : {}),
    ...(papelLido !== undefined ? { p_papel_lido: papelLido } : {}),
  });
}

async function deixar(quem: string, pessoa: string, papelNovo: string) {
  return (await logado(quem)).rpc("deixar_de_ser_implementador", {
    p_clinic_id: clinicaA,
    p_user_id: idDe(pessoa),
    p_papel_novo: papelNovo,
  });
}

beforeAll(async () => {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Implementador Int ${sufixo}`,
      slug: `implementador-int-${sufixo}`,
      e_de_teste: true,
      allow_code_signup: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicaA = (data as { id: string }).id;

  await criarMembro("admin", "admin");
  await criarMembro("gestor", "gestor");
  await criarMembro("recepcao", "recepcao");
  // A conta do convite (o GoTrue cria a conta; o vinculo vem da RPC).
  await criarConta("convidado");
  // O pedido de entrada pelo codigo da clinica, pelo caminho real
  // (handle_new_user: leitura pendente).
  const { data: codigo } = await admin
    .from("clinic_access_code")
    .select("code")
    .eq("clinic_id", clinicaA)
    .single()
    .throwOnError();
  await criarConta("pedido", {
    tipo: "codigo",
    codigo: (codigo as { code: string }).code,
  });
});

afterAll(async () => {
  const { error: erroDaClinica } = await admin
    .from("clinic")
    .delete()
    .eq("id", clinicaA);
  expect(erroDaClinica, "apagar a clinica do teste").toBeNull();
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
});

describe("os caminhos da tela", () => {
  it("convite: vínculo administrador ativo e marca na mesma chamada", async () => {
    const { data, error } = await entrar("admin", "convidado");
    expect(error).toBeNull();
    expect(data).toBe("convidado");
    expect(await vinculo("convidado")).toBe("admin:ativo:marca");
    const { data: marca } = await admin
      .from("membro_implementador")
      .select("marcado_por")
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("convidado"))
      .single()
      .throwOnError();
    expect((marca as { marcado_por: string }).marcado_por).toBe(idDe("admin"));

    // O convidado e administrador nas tres funcoes, mas nao pleno.
    const convidado = await logado("convidado");
    const { data: ehAdmin } = await convidado.rpc("user_has_role", {
      p_clinic_id: clinicaA,
      p_roles: ["admin"],
    });
    const { data: ehImplementador } = await convidado.rpc(
      "user_e_implementador",
      { p_clinic_id: clinicaA },
    );
    const { data: ehPleno } = await convidado.rpc("user_e_admin_pleno", {
      p_clinic_id: clinicaA,
    });
    expect([ehAdmin, ehImplementador, ehPleno]).toEqual([true, true, false]);

    // Convidar de novo: 23505, como o convite de sempre.
    const { error: deNovo } = await entrar("admin", "convidado");
    expect((deNovo as Erro)?.code).toBe("23505");
  });

  it("liberação do pedido de entrada pelo código", async () => {
    expect(await vinculo("pedido")).toBe("leitura:pendente:sem marca");
    const { data, error } = await entrar(
      "admin",
      "pedido",
      "pendente",
      "leitura",
    );
    expect(error).toBeNull();
    expect(data).toBe("liberado");
    expect(await vinculo("pedido")).toBe("admin:ativo:marca");
    // A aba que ainda mostrava o pedido: papel_mudou, nada muda.
    const { error: abaVelha } = await entrar(
      "admin",
      "pedido",
      "pendente",
      "leitura",
    );
    expect((abaVelha as Erro)?.code).toBe("P0001");
    expect((abaVelha as Erro)?.message).toBe("papel_mudou");
    expect(await vinculo("pedido")).toBe("admin:ativo:marca");
  });

  it("aba desatualizada na promoção: papel_mudou, sem mudar nada", async () => {
    // Outra aba muda a recepcao para leitura depois de a tela ler "recepcao".
    await admin
      .from("clinic_member")
      .update({ role: "leitura" })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("recepcao"))
      .throwOnError();
    const { error } = await entrar("admin", "recepcao", "ativo", "recepcao");
    expect((error as Erro)?.code).toBe("P0001");
    expect((error as Erro)?.message).toBe("papel_mudou");
    expect(await vinculo("recepcao")).toBe("leitura:ativo:sem marca");
    await admin
      .from("clinic_member")
      .update({ role: "recepcao" })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("recepcao"))
      .throwOnError();
  });

  it("promoção e volta ao papel de antes; a marca sai junto", async () => {
    const { data, error } = await entrar(
      "admin",
      "recepcao",
      "ativo",
      "recepcao",
    );
    expect(error).toBeNull();
    expect(data).toBe("promovido");
    expect(await vinculo("recepcao")).toBe("admin:ativo:marca");

    const { error: erroDeixar } = await deixar("admin", "recepcao", "recepcao");
    expect(erroDeixar).toBeNull();
    expect(await vinculo("recepcao")).toBe("recepcao:ativo:sem marca");

    const { error: deNovo } = await deixar("admin", "recepcao", "recepcao");
    expect((deNovo as Erro)?.code).toBe("P0001");
    expect((deNovo as Erro)?.message).toBe("papel_mudou");
  });

  it("deixar de ser implementador como administrador: vira administrador pleno", async () => {
    const { error } = await deixar("admin", "convidado", "admin");
    expect(error).toBeNull();
    expect(await vinculo("convidado")).toBe("admin:ativo:sem marca");
    const { data: ehPleno } = await (
      await logado("convidado")
    ).rpc("user_e_admin_pleno", { p_clinic_id: clinicaA });
    expect(ehPleno).toBe(true);
  });
});

describe("as recusas que a tela traduz", () => {
  it("chegam com o código e a chave, sem laço de retentativa", async () => {
    const inicio = Date.now();
    const casos: {
      rotulo: string;
      chamada: () => Promise<{ error: unknown }>;
      codigo: string;
      chave?: string;
    }[] = [
      {
        rotulo: "situação inativo",
        chamada: () => entrar("admin", "gestor", "inativo", "gestor"),
        codigo: "22023",
        chave: "situacao_invalida",
      },
      {
        rotulo: "papel sem situação",
        chamada: () => entrar("admin", "gestor", undefined, "gestor"),
        codigo: "22023",
        chave: "situacao_invalida",
      },
      {
        rotulo: "papel fora da lista",
        chamada: () => entrar("admin", "gestor", "ativo", "dono"),
        codigo: "22023",
        chave: "papel_invalido",
      },
      {
        rotulo: "já é implementador",
        chamada: () => entrar("admin", "pedido", "ativo", "admin"),
        codigo: "P0001",
        chave: "ja_e_implementador",
      },
      {
        rotulo: "o gestor marca",
        chamada: () => entrar("gestor", "recepcao", "ativo", "recepcao"),
        codigo: "42501",
      },
      {
        rotulo: "o implementador marca",
        chamada: () => entrar("pedido", "recepcao", "ativo", "recepcao"),
        codigo: "42501",
      },
      {
        rotulo: "o gestor tira a marca",
        chamada: () => deixar("gestor", "pedido", "admin"),
        codigo: "42501",
      },
      {
        rotulo: "a própria pessoa",
        chamada: () => entrar("admin", "admin", "ativo", "admin"),
        codigo: "P0001",
        chave: "Você não altera o próprio papel.",
      },
    ];
    for (const caso of casos) {
      const { error } = await caso.chamada();
      expect((error as Erro)?.code, caso.rotulo).toBe(caso.codigo);
      if (caso.chave) {
        expect((error as Erro)?.message, caso.rotulo).toBe(caso.chave);
      }
    }
    // Oito recusas em bem menos que o timeout: nenhuma ficou em retentativa.
    expect(Date.now() - inicio).toBeLessThan(20_000);
    expect(await vinculo("recepcao")).toBe("recepcao:ativo:sem marca");
    expect(await vinculo("gestor")).toBe("gestor:ativo:sem marca");
    expect(await vinculo("pedido")).toBe("admin:ativo:marca");
  });

  it("a service role e anon não executam as RPCs", async () => {
    const { error: erroServidor } = await admin.rpc(
      "entrar_como_implementador",
      {
        p_clinic_id: clinicaA,
        p_user_id: idDe("gestor"),
        p_situacao_lida: "ativo",
        p_papel_lido: "gestor",
      },
    );
    expect((erroServidor as Erro)?.code).toBe("42501");
    const { error: erroAnon } = await anonClient().rpc(
      "deixar_de_ser_implementador",
      {
        p_clinic_id: clinicaA,
        p_user_id: idDe("pedido"),
        p_papel_novo: "admin",
      },
    );
    expect((erroAnon as Erro)?.code).toBe("42501");
    expect(await vinculo("gestor")).toBe("gestor:ativo:sem marca");
    expect(await vinculo("pedido")).toBe("admin:ativo:marca");
  });
});
