import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Segunda leva do Painel geral (CS; migration 20261026110000_painel_cs_2.sql),
// pela API com JWT real de cada papel. O que esta em jogo:
// - as funcoes novas (notas_da_clinica_no_painel, escrever_nota_da_clinica,
//   excluir_nota_da_clinica e historico_da_clinica_no_painel) e a lista com
//   as chaves novas (painel_cs_das_clinicas) sao so da equipe Conduzza:
//   42501 para TODO papel da clinica (o administrador e o Implementador
//   inclusive, o pendente e o administrador da outra clinica) e para anon,
//   sem gravar nada (nem nota, nem trilha). Na de excluir, o 42501 vem ANTES
//   de olhar a nota: a nota que existe e a que nao existe recebem a mesma
//   recusa;
// - a tabela de notas (nota_interna_da_clinica): nenhum papel da clinica le
//   (a policy so deixa o super admin; a leitura volta vazia), nenhum escreve
//   direto (sem INSERT, UPDATE e DELETE para authenticated: 42501) e anon
//   nem le (42501);
// - a trilha da exportacao da lista (clinic_id nulo, pela policy de insert
//   de audit_log que ja existe) e so da equipe Conduzza: o administrador da
//   clinica recebe 42501 com clinic_id nulo e grava com a clinica dele
//   (contraprova);
// - a trilha da conta nao se forja pela sessao (revisao de 26/10/2026, a
//   policy restritiva "ninguem grava as acoes da conta pela sessao"): as
//   oito acoes do historico recebem 42501 de todo papel da clinica (o
//   leitura inclusive) e, no bloco opt-in, do super admin; nada entra no
//   historico; outra acao pela mesma sessao passa (contraprova);
// - a trilha das notas so para a equipe Conduzza (a restritiva "so a equipe
//   Conduzza le a trilha das notas internas"): o administrador e o gestor
//   da clinica nao leem as linhas das notas e seguem lendo o resto da
//   trilha; o super admin le (opt-in);
// - a service role passa da guarda (contraprova): a lista com as chaves
//   novas (a falha de envio da A aparece no sinal, so a contagem), as notas
//   e o historico da A; sem p_incluir_teste, as de teste nao aparecem;
// - nenhum dado de paciente no que as funcoes devolvem (o contato, a
//   conversa e a mensagem sinteticos da A, com marcadores).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// O SUPER ADMIN pela sessao so roda com RLS_COM_SUPER_ADMIN=1 (o mesmo
// opt-in de painel-cs.test.ts): o teste cria um usuario sintetico com
// product_admin NO BANCO DE PRODUCAO, com senha aleatoria da execucao,
// e-mail em example.com (dominio reservado, nenhuma caixa recebe), escreve e
// exclui a propria nota na A, grava uma linha de trilha da exportacao (sem
// clinica) e apaga a linha, o product_admin e o usuario no fim. Sem a
// variavel, esse bloco e pulado; o ensaio da migration
// (~/.claude/plans/painel-cs/ensaio-20261026110000.sql) prova o mesmo no SQL,
// com os super admins de ensaio dentro da transacao desfeita.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (o motor de producao
// e o painel as ignoram), apagadas no afterAll (prazo de 60 s; o beforeAll
// apaga a sobra de uma execucao que morreu ha mais de uma hora). Notas,
// vinculos, contato, conversa, mensagem e as linhas de trilha das clinicas
// vao em cascata. Nada aqui usa a id da Salud Care, da teste123 nem da
// Conduzza Teste. ESCRITO, AINDA NAO RODADO (roda depois de aplicar a
// migration: npm run test:rls -- painel-cs-2).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar, NESTA ORDEM (as clinicas primeiro; a trilha da
// exportacao, que nao tem clinica, antes dos usuarios).
//   select id, name from public.clinic where slug like 'painel-cs2-rls-%';
//   delete from public.clinic where slug like 'painel-cs2-rls-%';
//   delete from public.audit_log l using auth.users u
//    where u.id = l.user_id and l.clinic_id is null
//      and u.email like 'painel-cs2-rls-super-%@example.com';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'painel-cs2-rls-super-%@example.com';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-cs2-rls-%@teste.dev'
//       or u.email like 'painel-cs2-rls-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'painel-cs2-rls-%@teste.dev'
//       or u.email like 'painel-cs2-rls-super-%@example.com';

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelCs2!Rls${sufixo}`;
const COM_SUPER_ADMIN = process.env.RLS_COM_SUPER_ADMIN === "1";

const email = (papel: string) => `painel-cs2-rls-${papel}-${sufixo}@teste.dev`;
/** O super admin sintetico do bloco opt-in (apagado no afterAll geral). */
const EMAIL_DO_SUPER = `painel-cs2-rls-super-${sufixo}@example.com`;

/** Marcadores do paciente sintetico: nao podem aparecer no painel. */
const MARCADOR = `PACIENTE SINTETICO CS2 ${sufixo}`;
const TEXTO_DA_MENSAGEM = `${MARCADOR}: mensagem que falhou`;
const DIGITOS = sufixo.replace(/\D/g, "").padEnd(4, "7").slice(0, 4);
const TELEFONE_DO_PACIENTE = `+55849784${DIGITOS}1`;

/** Os usuarios desta execucao (os papeis e o super admin sintetico). */
function eDestaExecucao(enderecoDeEmail: string | undefined): boolean {
  return (
    (enderecoDeEmail?.startsWith("painel-cs2-rls-") ?? false) &&
    ((enderecoDeEmail?.endsWith(`-${sufixo}@teste.dev`) ?? false) ||
      enderecoDeEmail === EMAIL_DO_SUPER)
  );
}

/** As oito acoes do historico da conta: so as funcoes gravam. */
const ACOES_DA_CONTA = [
  "suspendeu_clinica",
  "reativou_clinica",
  "mudou_agente_da_clinica",
  "mudou_teto_da_ia",
  "registrou_requisito_da_producao",
  "revogou_requisito_da_producao",
  "escreveu_nota_interna",
  "excluiu_nota_interna",
] as const;

/** Todo vinculo de clinica desta suite: nenhum usa o painel. */
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
let mensagemA = "";
/** A nota que a service role escreve na A (autor nulo). */
let notaDoServidor = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string; hint?: string } | null;

type Sinal = {
  chave: string;
  nivel: string;
  quantidade: number | null;
  desde: string | null;
};
type LinhaDoPainel = {
  id: string;
  saude: string;
  sinais: Sinal[];
  implantacao: { feitos: number; total: number };
  tendencia: { leads: unknown; conversas: unknown };
  ultima_nota_em: string | null;
  gasto: { mes_microdolares: number; mes_chamadas: number };
};
type PainelCs = {
  totais: {
    saude: { saudavel: number; atencao: number; em_risco: number };
    chamadas_mes: number;
  };
  clinicas: LinhaDoPainel[];
};
type Autor = {
  user_id: string;
  nome: string | null;
  email: string | null;
  equipe_conduzza: boolean;
};
type Nota = {
  id: string;
  texto: string;
  criada_em: string;
  autor: Autor | null;
  minha: boolean;
};
type NotasDaClinica = {
  clinic_id: string;
  gerado_em: string;
  tem_mais: boolean;
  notas: Nota[];
};
type Evento = {
  id: number;
  em: string;
  acao: string;
  quem: Autor | null;
  detalhes: Record<string, unknown>;
};
type Historico = {
  clinic_id: string;
  gerado_em: string;
  tem_mais: boolean;
  eventos: Evento[];
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
      name: `Painel CS2 RLS ${nome} ${sufixo}`,
      slug: `painel-cs2-rls-${nome.toLowerCase()}-${sufixo}`,
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
    user_metadata: { name: `Painel CS2 ${papelNoEmail}` },
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

/** As chamadas da segunda leva (montadas depois do beforeAll). */
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
      rotulo: "notas da A",
      nome: "notas_da_clinica_no_painel",
      args: { p_clinic_id: clinicaA },
    },
    {
      rotulo: "notas da B",
      nome: "notas_da_clinica_no_painel",
      args: { p_clinic_id: clinicaB },
    },
    {
      rotulo: "histórico da A",
      nome: "historico_da_clinica_no_painel",
      args: { p_clinic_id: clinicaA },
    },
    {
      rotulo: "histórico da B",
      nome: "historico_da_clinica_no_painel",
      args: { p_clinic_id: clinicaB, p_limite: 5 },
    },
    {
      rotulo: "escrever nota na A",
      nome: "escrever_nota_da_clinica",
      args: { p_clinic_id: clinicaA, p_texto: "Nota que não pode entrar" },
    },
    {
      rotulo: "escrever nota na B",
      nome: "escrever_nota_da_clinica",
      args: { p_clinic_id: clinicaB, p_texto: "Nota que não pode entrar" },
    },
    // A recusa vem antes de olhar a nota: a que existe e a que nao existe.
    {
      rotulo: "excluir a nota da service role",
      nome: "excluir_nota_da_clinica",
      args: { p_nota_id: notaDoServidor },
    },
    {
      rotulo: "excluir uma nota que não existe",
      nome: "excluir_nota_da_clinica",
      args: { p_nota_id: crypto.randomUUID() },
    },
  ];
}

/** As notas da clinica, pela service role. */
async function notasPeloServidor(clinicId: string): Promise<NotasDaClinica> {
  const { data, error } = await admin.rpc("notas_da_clinica_no_painel", {
    p_clinic_id: clinicId,
  });
  expect(error).toBeNull();
  return data as NotasDaClinica;
}

/** O historico da clinica, pela service role. */
async function historicoPeloServidor(clinicId: string): Promise<Historico> {
  const { data, error } = await admin.rpc("historico_da_clinica_no_painel", {
    p_clinic_id: clinicId,
  });
  expect(error).toBeNull();
  return data as Historico;
}

/** Quantas linhas de trilha de notas as duas clinicas tem, por acao. */
async function trilhaDeNotas(): Promise<Record<string, number>> {
  const { data } = await admin
    .from("audit_log")
    .select("action")
    .in("clinic_id", [clinicaA, clinicaB])
    .in("action", ["escreveu_nota_interna", "excluiu_nota_interna"])
    .throwOnError();
  const contagem: Record<string, number> = {};
  for (const linha of (data ?? []) as { action: string }[]) {
    contagem[linha.action] = (contagem[linha.action] ?? 0) + 1;
  }
  return contagem;
}

// Sobra de uma execucao que morreu antes do afterAll: so clinicas de teste
// desta suite, criadas ha mais de uma hora.
beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "painel-cs2-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Painel CS2" })
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

  // O paciente sintetico da A, com o marcador no nome, e uma mensagem de
  // saida que falhou (o sinal de falhas de envio so conta).
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
  const { data: mensagem } = await admin
    .from("message")
    .insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "saida",
      author: "usuario",
      content_type: "texto",
      body: TEXTO_DA_MENSAGEM,
      delivery_status: "falhou",
    })
    .select("id")
    .single()
    .throwOnError();
  mensagemA = (mensagem as { id: string }).id;

  // A nota da service role na A (autor nulo), para as recusas de excluir.
  const { data: nota, error: erroDaNota } = await admin.rpc(
    "escrever_nota_da_clinica",
    { p_clinic_id: clinicaA, p_texto: "Nota da service role (teste de RLS)" },
  );
  if (erroDaNota || typeof nota !== "string") {
    throw new Error(`escrever a nota: ${erroDaNota?.message ?? "sem id"}`);
  }
  notaDoServidor = nota;
}, 120_000);

afterAll(async () => {
  // As clinicas PRIMEIRO (vinculos, marca, notas, contato, conversa,
  // mensagem e as linhas de trilha delas vao em cascata). Depois, a trilha
  // sem clinica desta execucao (a da exportacao, do bloco opt-in), que
  // seguraria o usuario (FK de audit_log.user_id). Por fim, os usuarios
  // desta execucao, o super admin sintetico inclusive, com o erro
  // conferido: limpeza que falha calada deixaria usuario sintetico na
  // producao.
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
  if (usuarios.length > 0) {
    const { error: erroDaTrilha } = await admin
      .from("audit_log")
      .delete()
      .is("clinic_id", null)
      .in("user_id", usuarios);
    expect(erroDaTrilha, "apagar a trilha sem clinica do teste").toBeNull();
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

describe("a segunda leva do painel CS é só da equipe Conduzza", () => {
  it("42501 em todas as funções para todo papel da clínica (o administrador e o Implementador inclusive) e para anon, sem gravar nada", async () => {
    const trilhaAntes = await trilhaDeNotas();
    for (const chamada of chamadas()) {
      for (const papel of TODOS_OS_PAPEIS) {
        const { data, error } = await (
          await logado(papel)
        ).rpc(chamada.nome, chamada.args);
        expect((error as Erro)?.code, `${chamada.rotulo} por ${papel}`).toBe(
          PERMISSAO_NEGADA,
        );
        // Nunca a recusa da nota de outra pessoa: a guarda vem antes.
        expect(
          (error as Erro)?.message,
          `${chamada.rotulo} por ${papel}: a recusa é a da guarda`,
        ).not.toBe("nota_de_outra_pessoa");
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
    // Nada mudou: so a nota da service role na A, nenhuma na B, e a trilha
    // de notas igual.
    const { data: notas } = await admin
      .from("nota_interna_da_clinica")
      .select("id, clinic_id")
      .in("clinic_id", [clinicaA, clinicaB])
      .throwOnError();
    expect(notas).toEqual([{ id: notaDoServidor, clinic_id: clinicaA }]);
    expect(await trilhaDeNotas()).toEqual(trilhaAntes);
    expect(trilhaAntes).toEqual({ escreveu_nota_interna: 1 });
  });

  it("a tabela de notas: nenhum papel da clínica lê nem escreve direto; anon nem lê", async () => {
    for (const papel of TODOS_OS_PAPEIS) {
      const sessao = await logado(papel);
      const leitura = await sessao.from("nota_interna_da_clinica").select("id");
      expect(leitura.error, `ler as notas por ${papel}`).toBeNull();
      expect(leitura.data, `ler as notas por ${papel}: nada`).toEqual([]);
      const gravar = await sessao.from("nota_interna_da_clinica").insert({
        clinic_id: clinicaA,
        autor_user_id: idDe(papel),
        texto: "Gravada direto",
      });
      expect((gravar.error as Erro)?.code, `gravar por ${papel}`).toBe(
        PERMISSAO_NEGADA,
      );
      const mudar = await sessao
        .from("nota_interna_da_clinica")
        .update({ texto: "Mudada direto" })
        .eq("id", notaDoServidor);
      expect((mudar.error as Erro)?.code, `mudar por ${papel}`).toBe(
        PERMISSAO_NEGADA,
      );
      const apagar = await sessao
        .from("nota_interna_da_clinica")
        .delete()
        .eq("id", notaDoServidor);
      expect((apagar.error as Erro)?.code, `apagar por ${papel}`).toBe(
        PERMISSAO_NEGADA,
      );
    }
    const anon = await anonClient()
      .from("nota_interna_da_clinica")
      .select("id");
    expect((anon.error as Erro)?.code, "ler as notas por anon").toBe(
      PERMISSAO_NEGADA,
    );
    // Contraprova: a nota esta la, como a service role escreveu.
    const { data: nota } = await admin
      .from("nota_interna_da_clinica")
      .select("texto, autor_user_id")
      .eq("id", notaDoServidor)
      .single()
      .throwOnError();
    expect(nota).toEqual({
      texto: "Nota da service role (teste de RLS)",
      autor_user_id: null,
    });
  });

  it("a trilha da exportação (sem clínica) é só da equipe Conduzza: o administrador recebe 42501 e grava com a clínica dele (contraprova)", async () => {
    const sessao = await logado("admin-a");
    const semClinica = await sessao.from("audit_log").insert({
      clinic_id: null,
      user_id: idDe("admin-a"),
      action: "exportou",
      entity: "painel_geral",
      entity_id: null,
      detalhes: {
        quantidade: 1,
        filtros: {},
        ordem: { coluna: "ultimo_acesso", sentido: "desc" },
      },
    });
    expect((semClinica.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const comClinica = await sessao.from("audit_log").insert({
      clinic_id: clinicaA,
      user_id: idDe("admin-a"),
      action: "exportou",
      entity: "leads",
      entity_id: null,
      detalhes: { quantidade: 0 },
    });
    expect(comClinica.error).toBeNull();
    const { data: semClinicaGravada } = await admin
      .from("audit_log")
      .select("id")
      .is("clinic_id", null)
      .eq("user_id", idDe("admin-a"))
      .throwOnError();
    expect(semClinicaGravada).toEqual([]);
  });

  it("a trilha da conta não se forja pela sessão: as oito ações do histórico recebem 42501 de todo papel da clínica, e nada aparece no histórico (revisão de 26/10/2026)", async () => {
    const historicoAntes = await historicoPeloServidor(clinicaA);
    for (const papel of TODOS_OS_PAPEIS) {
      const clinica = papel === "admin-b" ? clinicaB : clinicaA;
      const sessao = await logado(papel);
      for (const acao of ACOES_DA_CONTA) {
        // O caso do achado: o motivo forjado, para a equipe Conduzza ler.
        const { error } = await sessao.from("audit_log").insert({
          clinic_id: clinica,
          user_id: idDe(papel),
          action: acao,
          entity: "clinic",
          entity_id: clinica,
          detalhes: { motivo: `FORJADO ${sufixo}: ligue para 85 9999-0000` },
        });
        expect((error as Erro)?.code, `${acao} por ${papel}`).toBe(
          PERMISSAO_NEGADA,
        );
      }
    }
    // Nada entrou na trilha, e o historico da A e o mesmo.
    const { data: forjadas } = await admin
      .from("audit_log")
      .select("id")
      .in("clinic_id", [clinicaA, clinicaB])
      .in("action", [...ACOES_DA_CONTA])
      .in("user_id", TODOS_OS_PAPEIS.map(idDe))
      .throwOnError();
    expect(forjadas).toEqual([]);
    const historicoDepois = await historicoPeloServidor(clinicaA);
    expect(historicoDepois.eventos).toEqual(historicoAntes.eventos);
    expect(JSON.stringify(historicoDepois)).not.toContain("FORJADO");
    // Contraprova: a restritiva so tira as oito. A recepcao grava outra
    // acao na propria clinica, pela mesma sessao.
    const outra = await (await logado("recepcao-a")).from("audit_log").insert({
      clinic_id: clinicaA,
      user_id: idDe("recepcao-a"),
      action: "exportou",
      entity: "leads",
      entity_id: null,
      detalhes: { quantidade: 0 },
    });
    expect(outra.error).toBeNull();
  });

  it("a trilha das notas só para a equipe Conduzza: o administrador e o gestor não leem as linhas das notas e seguem lendo o resto da trilha da clínica (revisão de 26/10/2026)", async () => {
    // Contraprova: a linha da nota da service role existe.
    const { data: daNota } = await admin
      .from("audit_log")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("action", "escreveu_nota_interna")
      .throwOnError();
    expect((daNota ?? []).length).toBeGreaterThan(0);
    // Uma linha de outra acao na A, para a leitura que continua.
    const gravada = await (await logado("admin-a")).from("audit_log").insert({
      clinic_id: clinicaA,
      user_id: idDe("admin-a"),
      action: "exportou",
      entity: "leads",
      entity_id: null,
      detalhes: { quantidade: 0 },
    });
    expect(gravada.error).toBeNull();
    for (const papel of ["admin-a", "gestor-a"] as const) {
      const sessao = await logado(papel);
      const notas = await sessao
        .from("audit_log")
        .select("id")
        .eq("clinic_id", clinicaA)
        .in("action", ["escreveu_nota_interna", "excluiu_nota_interna"]);
      expect(notas.error, `a trilha das notas por ${papel}`).toBeNull();
      expect(notas.data, `a trilha das notas por ${papel}`).toEqual([]);
      const outras = await sessao
        .from("audit_log")
        .select("action")
        .eq("clinic_id", clinicaA)
        .eq("action", "exportou");
      expect(outras.error, `o resto da trilha por ${papel}`).toBeNull();
      expect(
        (outras.data ?? []).length,
        `o resto da trilha por ${papel}`,
      ).toBeGreaterThan(0);
    }
  });

  it("a service role passa da guarda (contraprova): a lista com as chaves novas, as notas e o histórico da A; sem a flag, as de teste não aparecem", async () => {
    const { data: comTeste, error } = await admin.rpc(
      "painel_cs_das_clinicas",
      { p_incluir_teste: true },
    );
    expect(error).toBeNull();
    const painel = comTeste as PainelCs;
    const a = painel.clinicas.find((c) => c.id === clinicaA);
    const b = painel.clinicas.find((c) => c.id === clinicaB);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(["saudavel", "atencao", "em_risco"]).toContain(a?.saude);
    expect(a?.sinais.find((s) => s.chave === "falhas_de_envio")).toEqual({
      chave: "falhas_de_envio",
      nivel: "atencao",
      quantidade: 1,
      desde: expect.any(String),
    });
    expect(a?.implantacao.total).toBe(6);
    expect(a?.ultima_nota_em).not.toBeNull();
    expect(b?.ultima_nota_em).toBeNull();
    expect(a?.gasto.mes_microdolares).toBe(0);
    expect(a?.gasto.mes_chamadas).toBe(0);
    expect(
      painel.totais.saude.saudavel +
        painel.totais.saude.atencao +
        painel.totais.saude.em_risco,
    ).toBe(painel.clinicas.length);

    const { data: semTeste, error: erroSemTeste } = await admin.rpc(
      "painel_cs_das_clinicas",
    );
    expect(erroSemTeste).toBeNull();
    const idsSemTeste = (semTeste as PainelCs).clinicas.map((c) => c.id);
    expect(idsSemTeste).not.toContain(clinicaA);
    expect(idsSemTeste).not.toContain(clinicaB);

    const notasA = await notasPeloServidor(clinicaA);
    expect(notasA.notas.map((n) => [n.id, n.autor, n.minha])).toEqual([
      [notaDoServidor, null, false],
    ]);
    expect((await notasPeloServidor(clinicaB)).notas).toEqual([]);

    const historicoA = await historicoPeloServidor(clinicaA);
    expect(historicoA.eventos.map((e) => [e.acao, e.quem])).toContainEqual([
      "escreveu_nota_interna",
      null,
    ]);
    expect(historicoA.eventos.map((e) => e.acao)).not.toContain("exportou");
    expect((await historicoPeloServidor(clinicaB)).eventos).toEqual([]);
  });

  it("nenhum dado de paciente no que as funções devolvem", async () => {
    const { data: lista } = await admin.rpc("painel_cs_das_clinicas", {
      p_incluir_teste: true,
    });
    const texto =
      JSON.stringify(lista) +
      JSON.stringify(await notasPeloServidor(clinicaA)) +
      JSON.stringify(await historicoPeloServidor(clinicaA));
    // Contraprova: a A esta no texto (o painel foi lido).
    expect(texto).toContain(clinicaA);
    for (const marcador of [
      MARCADOR,
      TEXTO_DA_MENSAGEM,
      TELEFONE_DO_PACIENTE,
      TELEFONE_DO_PACIENTE.slice(1),
      contatoA,
      conversaA,
      mensagemA,
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
      // So o product_admin sai aqui; a trilha sem clinica e o usuario saem
      // no afterAll geral.
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  it("lê a lista, as notas e o histórico, igual à service role", async () => {
    const sessao = sessaoDoSuper!;
    const semInstante = (valor: unknown) => ({
      ...(valor as Record<string, unknown>),
      gerado_em: null,
    });
    const { data: notas, error } = await sessao.rpc(
      "notas_da_clinica_no_painel",
      { p_clinic_id: clinicaA },
    );
    expect(error).toBeNull();
    expect(semInstante(notas)).toEqual(
      semInstante(await notasPeloServidor(clinicaA)),
    );
    const { data: historico, error: erroHistorico } = await sessao.rpc(
      "historico_da_clinica_no_painel",
      { p_clinic_id: clinicaA },
    );
    expect(erroHistorico).toBeNull();
    expect(semInstante(historico)).toEqual(
      semInstante(await historicoPeloServidor(clinicaA)),
    );
    const { data: lista, error: erroLista } = await sessao.rpc(
      "painel_cs_das_clinicas",
      { p_incluir_teste: true },
    );
    expect(erroLista).toBeNull();
    expect((lista as PainelCs).clinicas.map((c) => c.id)).toEqual(
      expect.arrayContaining([clinicaA, clinicaB]),
    );
    // A tabela pela policy: o super admin le a nota da A.
    const { data: direto, error: erroDireto } = await sessao
      .from("nota_interna_da_clinica")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(erroDireto).toBeNull();
    expect((direto ?? []).map((n) => n.id)).toContain(notaDoServidor);
  });

  it("escreve a nota (a sua), não exclui a de outra pessoa, exclui a própria; o histórico diz quem", async () => {
    const sessao = sessaoDoSuper!;
    const { data: id, error } = await sessao.rpc("escrever_nota_da_clinica", {
      p_clinic_id: clinicaA,
      p_texto: "  Nota do super admin sintético  ",
    });
    expect(error).toBeNull();
    expect(typeof id).toBe("string");
    const { data: notas } = await sessao.rpc("notas_da_clinica_no_painel", {
      p_clinic_id: clinicaA,
    });
    const lidas = (notas as NotasDaClinica).notas;
    expect(lidas.find((n) => n.id === id)).toMatchObject({
      texto: "Nota do super admin sintético",
      minha: true,
      autor: { user_id: superAdmin, equipe_conduzza: true },
    });
    expect(lidas.find((n) => n.id === notaDoServidor)?.minha).toBe(false);

    const deOutra = await sessao.rpc("excluir_nota_da_clinica", {
      p_nota_id: notaDoServidor,
    });
    expect((deOutra.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect((deOutra.error as Erro)?.message).toBe("nota_de_outra_pessoa");

    const propria = await sessao.rpc("excluir_nota_da_clinica", {
      p_nota_id: id,
    });
    expect(propria.error).toBeNull();
    const historico = await historicoPeloServidor(clinicaA);
    const doSuper = historico.eventos.filter(
      (e) => e.quem?.user_id === superAdmin,
    );
    expect(doSuper.map((e) => e.acao)).toEqual([
      "excluiu_nota_interna",
      "escreveu_nota_interna",
    ]);
  });

  it("o super admin também não grava as ações da conta pela sessão e lê a trilha das notas (revisão de 26/10/2026)", async () => {
    const sessao = sessaoDoSuper!;
    for (const acao of ACOES_DA_CONTA) {
      // Sem clinica, a permissiva deixaria o super admin: a restritiva nao.
      const { error } = await sessao.from("audit_log").insert({
        clinic_id: null,
        user_id: superAdmin,
        action: acao,
        entity: "clinic",
        entity_id: null,
      });
      expect((error as Erro)?.code, `${acao} sem clínica`).toBe(
        PERMISSAO_NEGADA,
      );
    }
    const { data, error } = await sessao
      .from("audit_log")
      .select("action")
      .eq("clinic_id", clinicaA)
      .eq("action", "escreveu_nota_interna");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("a trilha da exportação: o super admin grava a linha sem clínica pela sessão", async () => {
    const { error } = await sessaoDoSuper!.from("audit_log").insert({
      clinic_id: null,
      user_id: superAdmin,
      action: "exportou",
      entity: "painel_geral",
      entity_id: null,
      detalhes: {
        quantidade: 2,
        filtros: { saude: "em_risco", com_busca: true },
        ordem: { coluna: "saude", sentido: "desc" },
      },
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from("audit_log")
      .select("action, entity, detalhes")
      .is("clinic_id", null)
      .eq("user_id", superAdmin)
      .throwOnError();
    expect(data).toEqual([
      {
        action: "exportou",
        entity: "painel_geral",
        detalhes: {
          quantidade: 2,
          filtros: { saude: "em_risco", com_busca: true },
          ordem: { coluna: "saude", sentido: "desc" },
        },
      },
    ]);
  });
});
