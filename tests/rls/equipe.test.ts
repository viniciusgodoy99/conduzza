import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Travas de equipe e papeis da migration 20260825160000, contra o banco real:
// administrador E gestor gerenciam a equipe; gestor nao encosta em quem tem
// papel admin; tirar acesso desativa o vinculo em vez de apagar (e o vinculo
// inativo perde o acesso sozinho na RLS); a clinica nunca fica sem
// administrador ativo.
//
// Sufixo FIXO, e nao aleatorio como em cadastro-pendente.test.ts, de proposito:
// hoje o gatilho exigir_admin_ativo tambem recusa apagar a clinica (o cascade
// de clinic tira o ultimo administrador ativo e a excecao derruba a transacao),
// entao sufixo aleatorio deixaria uma clinica nova presa no banco a cada
// execucao. Com sufixo fixo a suite reaproveita sempre a mesma clinica
// descartavel e devolve o estado inicial no fim. O afterAll ainda tenta apagar
// a clinica: quando a correcao de exigir_admin_ativo entrar (migration
// 20260825170000), a limpeza volta a ser completa sozinha.

const RLS_VIOLATION = "42501";
const SUFIXO = "fixo";
const SENHA = "Rls-equipe-fixo!1";
const SLUG = `rls-equipe-${SUFIXO}`;

const admin = adminClient();

type Chave = "admin1" | "admin2" | "gestor" | "recepcao" | "convidada";
type Papel = "admin" | "gestor" | "recepcao" | "leitura";
type Pessoa = { user: User; client: SupabaseClient };

// Estado inicial da equipe, restaurado no comeco e no fim de cada execucao.
// convidada existe no sistema mas NAO faz parte da clinica: e o alvo dos
// cenarios de insercao.
const EQUIPE: { chave: Chave; nome: string; papel: Papel | null }[] = [
  { chave: "admin1", nome: "Alice Administradora", papel: "admin" },
  { chave: "admin2", nome: "Artur Administrador", papel: "admin" },
  { chave: "gestor", nome: "Gilda Gestora", papel: "gestor" },
  { chave: "recepcao", nome: "Rita Recepção", papel: "recepcao" },
  { chave: "convidada", nome: "Vera Convidada", papel: null },
];

const pessoas = {} as Record<Chave, Pessoa>;
let clinicId: string;
let contatoId: string;

function endereco(chave: Chave): string {
  return `rls-equipe-${chave}-${SUFIXO}@teste.dev`;
}

function idDe(chave: Chave): string {
  return pessoas[chave].user.id;
}

// listUsers nao filtra por e-mail, entao pagina ate achar. O projeto acumula
// usuarios de teste e a primeira pagina nao basta.
async function localizarUsuario(email: string): Promise<User | null> {
  const alvo = email.toLowerCase();
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    const achado = usuarios.find((u) => u.email?.toLowerCase() === alvo);
    if (achado) {
      return achado;
    }
    if (usuarios.length < 200) {
      return null;
    }
  }
  return null;
}

async function garantirUsuario(chave: Chave, nome: string): Promise<User> {
  const email = endereco(chave);
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: nome },
  });
  if (data?.user) {
    return data.user;
  }
  const existente = await localizarUsuario(email);
  if (!existente) {
    throw new Error(`Não foi possível criar nem localizar ${email}`);
  }
  await admin.auth.admin.updateUserById(existente.id, {
    password: SENHA,
    user_metadata: { name: nome },
  });
  return existente;
}

async function entrar(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`Falha no login de ${email}: ${error.message}`);
  }
  return client;
}

// Devolve a equipe ao estado inicial. Roda com service role, que nao dispara
// os gatilhos de papel (eles saem cedo quando auth.uid() e nulo).
async function restaurarEquipe(): Promise<void> {
  await admin
    .from("clinic_member")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("user_id", idDe("convidada"));
  for (const { chave, papel } of EQUIPE) {
    if (!papel) {
      continue;
    }
    await admin.from("clinic_member").upsert({
      clinic_id: clinicId,
      user_id: idDe(chave),
      role: papel,
      status: "ativo",
    });
  }
}

beforeAll(async () => {
  const { data: existente } = await admin
    .from("clinic")
    .select("id")
    .eq("slug", SLUG)
    .maybeSingle();
  if (existente) {
    clinicId = existente.id as string;
  } else {
    const { data, error } = await admin
      .from("clinic")
      .insert({ name: "Clínica Equipe RLS", slug: SLUG })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Falha ao criar a clínica: ${error?.message}`);
    }
    clinicId = data.id as string;
    await admin.from("clinic_branding").insert({ clinic_id: clinicId });
  }

  for (const { chave, nome } of EQUIPE) {
    pessoas[chave] = {
      user: await garantirUsuario(chave, nome),
      client: anonClient(),
    };
  }
  await restaurarEquipe();

  // Dado de paciente da clinica: prova que o vinculo desativado perde o acesso.
  await admin.from("contact").delete().eq("clinic_id", clinicId);
  const { data: contato, error: erroContato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: "+5584960000001",
      name: "Paciente da Equipe",
    })
    .select("id")
    .single();
  if (erroContato || !contato) {
    throw new Error(`Falha ao criar o contato: ${erroContato?.message}`);
  }
  contatoId = contato.id as string;

  for (const { chave } of EQUIPE) {
    pessoas[chave].client = await entrar(endereco(chave));
  }
});

afterAll(async () => {
  if (!clinicId) {
    return;
  }
  await admin.from("contact").delete().eq("clinic_id", clinicId);
  await restaurarEquipe();
  // Best effort: hoje exigir_admin_ativo recusa o cascade e a clinica fica.
  // Com a correcao aplicada, isso apaga tudo e os usuarios vao junto.
  await admin.from("clinic").delete().eq("id", clinicId);
  const { data: sobrou } = await admin
    .from("clinic")
    .select("id")
    .eq("id", clinicId);
  if ((sobrou ?? []).length === 0) {
    for (const { chave } of EQUIPE) {
      await admin.auth.admin.deleteUser(idDe(chave));
    }
  }
});

async function vinculo(chave: Chave) {
  const { data } = await admin
    .from("clinic_member")
    .select("role, status")
    .eq("clinic_id", clinicId)
    .eq("user_id", idDe(chave))
    .maybeSingle();
  return data as { role: string; status: string } | null;
}

describe("gestor gerencia a equipe", () => {
  it("muda o papel de quem não é administrador", async () => {
    const { data, error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ role: "leitura" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("recepcao"))
      .select("role");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.role).toBe("leitura");
    expect(await vinculo("recepcao")).toMatchObject({ role: "leitura" });

    // Devolve o papel: os cenários seguintes falam de "recepção".
    await admin
      .from("clinic_member")
      .update({ role: "recepcao" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("recepcao"));
  });

  it("adiciona alguém à clínica com papel comum", async () => {
    const { data, error } = await pessoas.gestor.client
      .from("clinic_member")
      .insert({
        clinic_id: clinicId,
        user_id: idDe("convidada"),
        role: "recepcao",
      })
      .select("role, status");
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ role: "recepcao", status: "ativo" });

    await admin
      .from("clinic_member")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("convidada"));
  });
});

describe("gestor não mexe em administrador", () => {
  it("não promove ninguém a administrador", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ role: "admin" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("recepcao"))
      .select("role");
    expect(error?.message).toContain(
      "Somente um administrador cria outro administrador.",
    );
    expect(await vinculo("recepcao")).toMatchObject({
      role: "recepcao",
      status: "ativo",
    });
  });

  it("não entra com alguém já como administrador", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .insert({
        clinic_id: clinicId,
        user_id: idDe("convidada"),
        role: "admin",
      })
      .select("role");
    expect(error?.message).toContain(
      "Somente um administrador cria outro administrador.",
    );
    expect(await vinculo("convidada")).toBeNull();
  });

  it("não rebaixa um administrador", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ role: "recepcao" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("role");
    expect(error?.message).toContain(
      "Somente um administrador altera o acesso de outro administrador.",
    );
    expect(await vinculo("admin2")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
  });

  it("não tira o acesso de um administrador", async () => {
    // Mesma trava (proteger_papel_admin), outra mensagem: como o papel da
    // linha continua sendo admin, a recusa cai no ramo de "cria outro
    // administrador" antes do ramo de "altera o acesso". A Server Action barra
    // antes disso com a frase certa, entao a tela nunca mostra esta mensagem.
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("status");
    expect(error?.message).toContain(
      "Somente um administrador cria outro administrador.",
    );
    expect(await vinculo("admin2")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
  });

  it("não exclui um administrador", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("user_id");
    expect(error?.message).toContain(
      "Somente um administrador remove outro administrador.",
    );
    expect(await vinculo("admin2")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
  });
});

describe("ninguém altera o próprio acesso", () => {
  it("gestor não se promove a administrador", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ role: "admin" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("gestor"))
      .select("role");
    expect(error?.message).toContain("Você não pode alterar o próprio papel");
    expect(await vinculo("gestor")).toMatchObject({
      role: "gestor",
      status: "ativo",
    });
  });

  it("administrador não tira o próprio acesso", async () => {
    const { error } = await pessoas.admin1.client
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin1"))
      .select("status");
    expect(error?.message).toContain("Você não pode alterar o próprio papel");
    expect(await vinculo("admin1")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
  });
});

describe("recepção não gerencia a equipe", () => {
  it("não adiciona ninguém à clínica", async () => {
    const { data, error } = await pessoas.recepcao.client
      .from("clinic_member")
      .insert({
        clinic_id: clinicId,
        user_id: idDe("convidada"),
        role: "recepcao",
      })
      .select("user_id");
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe(RLS_VIOLATION);
    expect(await vinculo("convidada")).toBeNull();
  });

  it("não muda o papel de ninguém (0 linhas afetadas)", async () => {
    // Sem 42501 aqui de proposito: em UPDATE, a linha que nao passa no USING
    // da policy simplesmente nao entra na atualizacao. O que prova a trava e o
    // par "nenhuma linha voltou" mais "o vinculo continua igual".
    const { data, error } = await pessoas.recepcao.client
      .from("clinic_member")
      .update({ role: "admin" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("gestor"))
      .select("role");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect(await vinculo("gestor")).toMatchObject({
      role: "gestor",
      status: "ativo",
    });
  });

  it("não exclui ninguém (0 linhas afetadas)", async () => {
    const { data, error } = await pessoas.recepcao.client
      .from("clinic_member")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("gestor"))
      .select("user_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect(await vinculo("gestor")).not.toBeNull();
  });
});

describe("a clínica nunca fica sem administrador ativo", () => {
  it("administrador tira o acesso do segundo administrador", async () => {
    const { data, error } = await pessoas.admin1.client
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("status");
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe("inativo");
  });

  // Com um administrador ativo so, nenhum usuario consegue chegar na linha
  // dele: o gestor esbarra em proteger_papel_admin e o proprio administrador
  // esbarra em impedir_auto_aprovacao. Quem exercita exigir_admin_ativo puro e
  // o service role, que ignora RLS e sai cedo nos gatilhos de papel (auth.uid()
  // nulo) mas passa por este, que nao olha para auth.uid().
  it("o último administrador ativo não é desativado nem pelo service role", async () => {
    const { error } = await admin
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin1"));
    expect(error?.message).toContain(
      "A clínica precisa de pelo menos um administrador ativo.",
    );
    expect(await vinculo("admin1")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
  });

  it("o último administrador ativo não é excluído nem pelo service role", async () => {
    const { error } = await admin
      .from("clinic_member")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin1"));
    expect(error?.message).toContain(
      "A clínica precisa de pelo menos um administrador ativo.",
    );
    expect(await vinculo("admin1")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
  });

  it("tirar o acesso é reversível", async () => {
    const { data, error } = await pessoas.admin1.client
      .from("clinic_member")
      .update({ status: "ativo" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("status");
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe("ativo");
  });
});

describe("vínculo desativado perde o acesso", () => {
  it("com acesso, a recepção enxerga o contato da clínica", async () => {
    const { data, error } = await pessoas.recepcao.client
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(contatoId);
  });

  it("sem acesso, a recepção não enxerga mais nenhum contato", async () => {
    const { error: erroDesativa } = await pessoas.admin1.client
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("recepcao"));
    expect(erroDesativa).toBeNull();

    const semAcesso = await entrar(endereco("recepcao"));
    const { data, error } = await semAcesso
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // Anti falso-positivo: o contato existe, quem sumiu foi o acesso.
    const { data: real } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(real).toHaveLength(1);
  });

  it("sem acesso, ainda enxerga o próprio vínculo (a tela explica o motivo)", async () => {
    const semAcesso = await entrar(endereco("recepcao"));
    const { data } = await semAcesso
      .from("clinic_member")
      .select("clinic_id, status")
      .eq("user_id", idDe("recepcao"));
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("inativo");
  });
});

// Regressao da falha ALTA da revisao de 25/08/2026, provada contra o banco
// real antes da correcao: clinic_id era mutavel e as travas perguntavam pela
// clinica de DESTINO. Quem fosse gestor aqui e administrador em outra clinica
// movia o vinculo do administrador daqui para la com um unico PATCH, deixando
// esta clinica sem administrador e sem trilha; e movia qualquer membro entre
// clinicas, que e vazamento de fronteira.
describe("o vínculo não muda de clínica nem de pessoa", () => {
  let outraClinicaId: string;

  beforeAll(async () => {
    const { data } = await admin
      .from("clinic")
      .insert({
        name: "Clínica Vizinha RLS",
        slug: `rls-equipe-vizinha-${SUFIXO}`,
      })
      .select("id")
      .single()
      .throwOnError();
    outraClinicaId = data!.id as string;
    // A gestora daqui e ADMINISTRADORA da clinica vizinha: e o cenario de
    // agencia que tornava o ataque possivel.
    await admin
      .from("clinic_member")
      .insert({
        clinic_id: outraClinicaId,
        user_id: idDe("gestor"),
        role: "admin",
        status: "ativo",
      })
      .throwOnError();
  });

  afterAll(async () => {
    if (outraClinicaId) {
      await admin.from("clinic").delete().eq("id", outraClinicaId);
    }
  });

  it("gestora daqui, administradora de outra clínica, não leva o administrador embora", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ clinic_id: outraClinicaId })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("clinic_id");
    expect(error?.message).toContain("pertence a uma clínica só");

    // O administrador continua aqui, e a clinica segue com administrador ativo.
    expect(await vinculo("admin2")).toMatchObject({
      role: "admin",
      status: "ativo",
    });
    const { data: admins } = await admin
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", clinicId)
      .eq("role", "admin")
      .eq("status", "ativo");
    expect((admins ?? []).length).toBeGreaterThan(0);
  });

  it("nem um membro comum é movido para outra clínica", async () => {
    const { error } = await pessoas.gestor.client
      .from("clinic_member")
      .update({ clinic_id: outraClinicaId })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("recepcao"))
      .select("clinic_id");
    expect(error?.message).toContain("pertence a uma clínica só");
    expect(await vinculo("recepcao")).not.toBeNull();
  });

  it("nem o service role move o vínculo: não existe caminho legítimo", async () => {
    const { error } = await admin
      .from("clinic_member")
      .update({ clinic_id: outraClinicaId })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("clinic_id");
    expect(error?.message).toContain("pertence a uma clínica só");
  });

  it("o vínculo também não troca de pessoa", async () => {
    const { error } = await admin
      .from("clinic_member")
      .update({ user_id: idDe("recepcao") })
      .eq("clinic_id", clinicId)
      .eq("user_id", idDe("admin2"))
      .select("user_id");
    expect(error?.message).toContain("pertence a uma pessoa só");
  });
});
