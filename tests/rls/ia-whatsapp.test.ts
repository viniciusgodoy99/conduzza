import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// E3, a IA no WhatsApp so com os telefones da equipe (migrations
// 20261013100000, 20261013110000 e 20261013120000), pela API com JWT real de
// cada papel. O que esta em jogo:
//   - as funcoes do servidor (fila, guarda do envio, decisao, passagem para
//     a equipe) nao sao da sessao: anon e authenticated recebem 42501;
//   - ai_turno, ai_rascunho_bloqueado e ia_janela_da_conversa: nenhum papel
//     le nem escreve (sem grant, RLS ligada, sem policy);
//   - ai_decision_log: a sessao le por coluna, SEM blocked_draft (42501 ao
//     pedir a coluna ou select *); as outras colunas seguem legiveis; A nao
//     le B;
//   - ler_rascunho_bloqueado: so a equipe Conduzza (D25). Administrador,
//     gestor, recepcao e a service role: 42501, sem trilha. O caminho do
//     super admin (com audit_log) e provado no harness local do E3
//     (scratchpad/e3-pglite): esta suite nunca cria super admin na producao;
//   - devolver_para_ia: P0002 para quem nao e da clinica (nao revela nada),
//     42501 para leitura, CZ409 para quem nao esta com a conversa ou com
//     pergunta pendente, 42501 nao_liberada para telefone fora da lista,
//     42501 contato_de_paciente para contato que virou paciente depois de
//     ligado SEM o forcar; o telefone forcado pela equipe Conduzza passa (D-B
//     da revisao de 13/10/2026); com tudo liberado passa, com evento no nome
//     de quem devolveu, janela e trilha;
//   - ia_contato_liberado.forcado: a sessao nao escreve; so
//     definir_contato_liberado_da_ia forca (o gatilho recusa ate o servidor);
//   - message: a sessao nao grava nem promove linha com author 'ia';
//   - saude_do_motor: a chave ia detalhada so para o servidor (e o super
//     admin); a sessao recebe ia nulo (B8 da revisao);
//   - ia_devolver_disponivel: os motivos por papel (recepcao recebe
//     nao_disponivel no lugar dos que revelam a lista de telefones), P0002
//     para outra clinica;
//   - conversation em 'ia_atendendo' pela sessao: 42501 (so_pelo_devolver)
//     no UPDATE e no INSERT, mesmo com tudo liberado; troca de contact_id
//     com a conversa na IA tambem 42501;
//   - ligar o atendimento pelo WhatsApp (modo contatos e numero) so pela
//     equipe Conduzza: o administrador recebe 42501 e consegue desligar; o
//     servidor (service role) liga;
//   - telefone da equipe (decisao do dono de 19/10/2026, migration
//     20261019100000): o administrador da clinica liga (sem forcar),
//     desliga e liga de novo, com a trilha no nome dele; gestor, recepcao,
//     leitura e o administrador da outra clinica recebem 42501; o forcar
//     do administrador da 42501 (so a equipe Conduzza), com e sem sinal de
//     paciente;
//   - definir_contato_liberado_da_ia recusa numero de WhatsApp da
//     plataforma (23514 telefone_invalido_para_equipe) e contato com sinal
//     de paciente (23514 contato_de_paciente), para o servidor e para o
//     administrador; o forcar passa so por quem e equipe Conduzza (aqui, o
//     servidor) e grava audit_log proprio;
//   - situacao_da_ia_na_clinica: administrador e gestor da propria clinica
//     (com o booleano motor_parado); recepcao e outra clinica 42501;
//   - varios numeros (decisao do dono de 19/10/2026, migration
//     20261019110000): o servidor liga o segundo numero da A sem desligar o
//     primeiro; o administrador desliga um sem mexer no outro e nao liga
//     nenhum (42501, mesmo com o outro ligado); a situacao ve a conversa
//     aberta com a equipe em qualquer numero ligado e deixa de ver a do
//     numero desligado.
//   - revisao de producao de 19/10/2026 (migration 20261019120000): a
//     situacao diz em QUAL numero e qual conversa (conversas_abertas, com a
//     chave antiga ao lado); telefone NOVO exige a confirmacao do aviso da
//     OpenAI (23514 aviso_da_openai_nao_confirmado, ate para o servidor), e
//     o banco grava a trilha dela no nome de quem liga; desligar telefone
//     fora da lista nao cria linha; o Devolver confere a liberacao ANTES da
//     pergunta pendente (conversa de paciente nunca diz pergunta_pendente).
//   - onda 2 (migration 20261022110000, M2): ia_horario_do_assistente,
//     ia_publico_aceita e ia_retomar_conversas_no_horario sao so do
//     servidor (42501 para a sessao e anon); ia_conversa_fora_do_horario
//     nao e lida por nenhum papel (sem grant: 42501); o FORCAR deixa de ser
//     so da equipe Conduzza (P3 (a), decisao do dono de 21/10/2026): o
//     administrador forca com a confirmacao do teste com paciente
//     (p_confirmou_teste_com_paciente), com as trilhas no nome dele; sem
//     ela, 23514 teste_com_paciente_nao_confirmado, com e sem sinal de
//     paciente (ate para o servidor); gestor continua 42501;
//     excluir_contato_liberado_da_ia: o administrador da propria clinica
//     exclui (trilha no nome dele, sem o telefone; a conversa do telefone
//     volta para a equipe), gestor, recepcao, leitura, outra clinica e anon
//     recebem 42501.
//     ESCRITO NA ONDA 2 E NAO RODADO por quem escreveu (grava no banco):
//     quem roda e o coordenador, DEPOIS de aplicar a migration.
// disparar_ciclo_da_ia, motor_ia_agendar e motor_ia_desagendar NUNCA sao
// chamados aqui pela API: se o grant regredisse, a chamada mexeria no pg_cron
// e no pg_net da producao antes de a assercao falhar. O grant deles e
// conferido pelo catalogo (has_function_privilege) no ensaio da M1 e no
// harness local; aqui, so a leitura da migration.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: so clinicas e_de_teste (fora da lista
// fechada: nao dependem do interruptor e so atendem em numero 'fake'),
// apagadas no afterAll. O interruptor global NUNCA e tocado. Nada aqui usa a
// id da salud-care, da teste123 nem da Conduzza Teste. Nenhuma mensagem sai
// para o WhatsApp (numero fake, e nenhum job e executado).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'ia-whatsapp-%';
//   delete from public.clinic where slug like 'ia-whatsapp-%' and e_de_teste;
// e os usuarios 'ia-whatsapp-%@teste.dev' pela API de administracao.

const PERMISSAO_NEGADA = "42501";
const NAO_ENCONTRADO = "P0002";
const CONVERSA_MUDOU = "CZ409";
const CHECK = "23514";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `IaWhatsapp!${sufixo}`;
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");

const TELEFONE_DA_EQUIPE = `+5584981${digitos}`;
const TELEFONE_FORA = `+5584982${digitos}`;
const TELEFONE_DO_PACIENTE = `+5584983${digitos}`;
const TELEFONE_DA_B = `+5584984${digitos}`;
// Ligado como telefone da equipe quando ainda era lead; vira paciente depois.
const TELEFONE_VIROU_PACIENTE = `+5584986${digitos}`;
// Sem contato: o administrador da A liga, desliga e liga de novo (decisao
// do dono de 19/10/2026, migration 20261019100000); desligado no fim.
const TELEFONE_DO_ADMIN = `+5584987${digitos}`;
// Telefone da equipe com conversa aberta com a recepcao no SEGUNDO numero da
// A (varios numeros, decisao do dono de 19/10/2026).
const TELEFONE_DO_SEGUNDO_NUMERO = `+5584988${digitos}`;
// Sem contato: a confirmacao do aviso da OpenAI no banco (migration
// 20261019120000); desligado no fim.
const TELEFONE_DA_CONFIRMACAO = `+5584989${digitos}`;
// O numero fake da A, com display_phone de 12 digitos: e "numero da
// plataforma" para definir_contato_liberado_da_ia.
const DISPLAY_DA_A = `+55 84 3${digitos}-0`;
const NUMERO_DA_A_E164 = `+55843${digitos}0`;

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
// O segundo numero fake da A (sem display_phone): so o teste de varios
// numeros o liga, e ele termina desligado.
let segundoNumeroA = "";
let numeroB = "";
let contatoDaEquipe = "";
let contatoFora = "";
let contatoDoPaciente = "";
let conversaDaEquipe = "";
let conversaFora = "";
let conversaDoPaciente = "";
let conversaDaB = "";
let conversaVirouPaciente = "";
let decisaoBloqueada = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) => `ia-whatsapp-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  nome: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: nome },
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
      status: "ativo",
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

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `IA WhatsApp ${nome} ${sufixo}`,
      slug: `ia-whatsapp-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function contatoCom(
  clinicId: string,
  telefone: string,
  kind: "lead" | "paciente" = "lead",
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Contato",
      kind,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Conversa com a recepcao da A, sem pergunta pendente. */
async function conversaComARecepcao(
  contactId: string,
  whatsappAccountId = numeroA,
  clinicId = clinicaA,
  responsavel = ids.get("recepcao-a")!,
): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: whatsappAccountId,
      status: "em_atendimento",
      assignee_user_id: responsavel,
      awaiting_reply: false,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function conversa(id: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, assignee_user_id, awaiting_reply")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    assignee_user_id: string | null;
    awaiting_reply: boolean;
  };
}

async function rpcDoSistema(nome: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data;
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  numeroA = (
    await criarNumeroDeTeste(admin, clinicaA, {
      nome: "Recepção",
      display_phone: DISPLAY_DA_A,
    })
  ).id;
  segundoNumeroA = (
    await criarNumeroDeTeste(admin, clinicaA, { nome: "Segundo" })
  ).id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" }))
    .id;

  await criarPessoa("admin-a", clinicaA, "admin", "Ana Admin");
  await criarPessoa("gestor-a", clinicaA, "gestor", "Gustavo Gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao", "Rita Recepção");
  await criarPessoa("recepcao2-a", clinicaA, "recepcao", "Rui Recepção");
  await criarPessoa("leitura-a", clinicaA, "leitura", "Lia Leitura");
  await criarPessoa("admin-b", clinicaB, "admin", "Bia Admin");

  contatoDaEquipe = await contatoCom(clinicaA, TELEFONE_DA_EQUIPE);
  contatoFora = await contatoCom(clinicaA, TELEFONE_FORA);
  contatoDoPaciente = await contatoCom(
    clinicaA,
    TELEFONE_DO_PACIENTE,
    "paciente",
  );
  const daB = await contatoCom(clinicaB, TELEFONE_DA_B);
  const contatoVirouPaciente = await contatoCom(
    clinicaA,
    TELEFONE_VIROU_PACIENTE,
  );

  // A liberada pelo SISTEMA (o servidor e equipe Conduzza para o banco):
  // modo contatos, o numero fake da A, o telefone da equipe e, forcado, o
  // do paciente (para o Devolver recusar pelo sinal de paciente). Versao
  // publicada (sem ela o assistente nao atende).
  await rpcDoSistema("definir_liberacao_da_ia", {
    p_clinic_id: clinicaA,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de RLS do E3",
  });
  await rpcDoSistema("definir_numero_da_ia", {
    p_clinic_id: clinicaA,
    p_whatsapp_account_id: numeroA,
    p_ativo: true,
  });
  // Telefone novo exige a confirmacao do aviso da OpenAI, ate para o
  // servidor (migration 20261019120000).
  await rpcDoSistema("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaA,
    p_telefone_e164: TELEFONE_DA_EQUIPE,
    p_rotulo: "Equipe de teste",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  // Ligado ainda como lead (sem sinal de paciente: sem o forcar).
  await rpcDoSistema("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaA,
    p_telefone_e164: TELEFONE_VIROU_PACIENTE,
    p_rotulo: "Vira paciente",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  await admin
    .from("ai_agent_config")
    .insert({ clinic_id: clinicaA, version: 1, status: "publicada" })
    .throwOnError();

  conversaDaEquipe = await conversaComARecepcao(contatoDaEquipe);
  conversaFora = await conversaComARecepcao(contatoFora);
  conversaDoPaciente = await conversaComARecepcao(contatoDoPaciente);
  conversaVirouPaciente = await conversaComARecepcao(
    contatoVirouPaciente,
    numeroA,
    clinicaA,
    ids.get("admin-a")!,
  );
  // Depois de ligado, a recepcao cadastra a pessoa como paciente.
  await admin
    .from("contact")
    .update({ kind: "paciente" })
    .eq("id", contatoVirouPaciente)
    .throwOnError();
  conversaDaB = await conversaComARecepcao(
    daB,
    numeroB,
    clinicaB,
    ids.get("admin-b")!,
  );

  // Uma decisao bloqueada na A e o rascunho dela (fora de ai_decision_log).
  const { data: decisao } = await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinicaA,
      conversation_id: conversaFora,
      compliance_blocked: true,
      compliance_rule: "triagem",
      escalation_reason: "conformidade",
      desfecho: "bloqueou",
    })
    .select("id")
    .single()
    .throwOnError();
  decisaoBloqueada = (decisao as { id: string }).id;
  await admin
    .from("ai_rascunho_bloqueado")
    .insert({
      clinic_id: clinicaA,
      decision_id: decisaoBloqueada,
      conversation_id: conversaFora,
      job_id: crypto.randomUUID(),
      texto: "Rascunho sintético de teste.",
    })
    .throwOnError();
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinicaB,
      conversation_id: conversaDaB,
      desfecho: "escalou",
      escalation_reason: "pedido_de_agenda",
    })
    .throwOnError();
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

describe("funcoes do servidor: nao sao da sessao", () => {
  it("anon e authenticated recebem 42501; a service role chega", async () => {
    const z = "00000000-0000-4000-a000-000000000000";
    const chamadas = (cliente: SupabaseClient) => [
      cliente.rpc("enfileirar_resposta_da_ia", {
        p_clinic_id: clinicaA,
        p_conversation_id: conversaDaEquipe,
        p_message_id: z,
        p_incluir_teste: true,
      }),
      cliente.rpc("claim_jobs_da_ia", {
        p_worker: "rls",
        p_max: 1,
        p_clinic_ids: [clinicaA],
        p_incluir_teste: true,
      }),
      cliente.rpc("passar_conversa_da_ia_para_equipe", {
        p_job_id: z,
        p_worker: "rls",
        p_motivo: "sintoma",
      }),
      cliente.rpc("gravar_evento_da_ia", {
        p_job_id: z,
        p_worker: "rls",
        p_motivo: "aviso_nao_enviado",
      }),
      cliente.rpc("tirar_conversa_da_ia_pelo_servidor", {
        p_clinic_id: clinicaA,
        p_conversation_id: conversaDaEquipe,
        p_motivo: "nao_individual",
      }),
      cliente.rpc("ia_pode_enviar_agora", {
        p_job_id: z,
        p_worker: "rls",
        p_conversation_id: conversaDaEquipe,
        p_whatsapp_account_id: numeroA,
        p_telefone: TELEFONE_DA_EQUIPE,
        p_tipo: "resposta",
      }),
      cliente.rpc("ia_atende_no_whatsapp", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: numeroA,
        p_telefone: TELEFONE_DA_EQUIPE,
      }),
      cliente.rpc("ia_pode_falar_com", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: numeroA,
        p_telefone: TELEFONE_DA_EQUIPE,
      }),
      cliente.rpc("ia_marcar_respondida", { p_job_id: z, p_worker: "rls" }),
      cliente.rpc("contato_tem_sinal_de_paciente", {
        p_clinic_id: clinicaA,
        p_phone_key: TELEFONE_DO_PACIENTE,
      }),
      cliente.rpc("telefone_e_numero_da_plataforma", {
        p_telefone: NUMERO_DA_A_E164,
      }),
      // So leitura (stable): chamar com um grant regredido nao mexe em nada.
      cliente.rpc("ia_jobs_devidos", {
        p_clinic_ids: [clinicaA],
        p_incluir_teste: true,
        p_folga: "0 seconds",
      }),
      // Onda 2 (M2): o horario e o publico (so leitura) e a retomada com
      // limite 0 (com um grant regredido, nao pega linha nenhuma).
      cliente.rpc("ia_horario_do_assistente", { p_clinic_id: clinicaA }),
      cliente.rpc("ia_publico_aceita", {
        p_clinic_id: clinicaA,
        p_telefone: TELEFONE_DA_EQUIPE,
      }),
      cliente.rpc("ia_retomar_conversas_no_horario", {
        p_limite: 0,
        p_incluir_teste: true,
      }),
    ];
    for (const cliente of [
      anonClient(),
      como("admin-a"),
      como("gestor-a"),
      como("recepcao-a"),
      como("admin-b"),
    ]) {
      for (const chamada of chamadas(cliente)) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    // contraprova: o servidor pergunta e a resposta e a da liberacao
    expect(
      await rpcDoSistema("ia_atende_no_whatsapp", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: numeroA,
        p_telefone: TELEFONE_DA_EQUIPE,
      }),
    ).toBe(true);
    expect(
      await rpcDoSistema("telefone_e_numero_da_plataforma", {
        p_telefone: NUMERO_DA_A_E164,
      }),
    ).toBe(true);
    expect(
      await rpcDoSistema("contato_tem_sinal_de_paciente", {
        p_clinic_id: clinicaA,
        p_phone_key: TELEFONE_DO_PACIENTE,
      }),
    ).toBe(true);
    // Onda 2: o servidor pergunta o horario (24h: atende), o publico (nulo
    // no modo contatos: aceita) e chama a retomada (nada a retomar).
    expect(
      await rpcDoSistema("ia_horario_do_assistente", { p_clinic_id: clinicaA }),
    ).toBe("atende");
    expect(
      await rpcDoSistema("ia_publico_aceita", {
        p_clinic_id: clinicaA,
        p_telefone: TELEFONE_DA_EQUIPE,
      }),
    ).toBe(true);
    expect(
      await rpcDoSistema("ia_retomar_conversas_no_horario", {
        p_limite: 0,
        p_incluir_teste: true,
      }),
    ).toEqual({
      retomadas: 0,
      descartadas: 0,
      enfileiradas: 0,
      erros_por_linha: 0,
    });
  });

  it("disparar_ciclo_da_ia, motor_ia_agendar e motor_ia_desagendar: so a service role, pela migration (nunca chamados aqui)", () => {
    const m1 = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261013100000_ia_whatsapp_fila.sql",
      ),
      "utf-8",
    );
    for (const assinatura of [
      "public.disparar_ciclo_da_ia()",
      "public.motor_ia_agendar()",
      "public.motor_ia_desagendar()",
    ]) {
      expect(m1).toContain(
        `revoke execute on function ${assinatura} from public, anon, authenticated;`,
      );
      expect(m1).toContain(
        `grant execute on function ${assinatura} to service_role;`,
      );
      // nenhum outro grant para a sessao
      expect(m1).not.toMatch(
        new RegExp(
          `grant execute on function ${assinatura.replace(/[.()]/g, "\\$&")} to [^;]*(anon|authenticated)`,
        ),
      );
    }
  });

  it("as funcoes internas nao sao de ninguem pela API (42501 ate para a service role)", async () => {
    for (const cliente of [admin, como("admin-a")]) {
      const { error } = await cliente.rpc("ia_tirar_conversa", {
        p_conversation_id: conversaDaEquipe,
        p_aguardando: true,
        p_motivo: "sintoma",
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect((await conversa(conversaDaEquipe)).status).toBe("em_atendimento");
  });
});

describe("tabelas novas: nenhuma sessao le nem escreve", () => {
  it("ai_turno, ai_rascunho_bloqueado, ia_janela_da_conversa e ia_conversa_fora_do_horario: 42501 para todo papel e para anon", async () => {
    for (const cliente of [
      anonClient(),
      como("admin-a"),
      como("gestor-a"),
      como("recepcao-a"),
      como("admin-b"),
    ]) {
      for (const tabela of [
        "ai_turno",
        "ai_rascunho_bloqueado",
        "ia_janela_da_conversa",
        // onda 2 (M2): a espera do horario do assistente
        "ia_conversa_fora_do_horario",
      ] as const) {
        const { error: leitura } = await cliente.from(tabela).select("*");
        expect(leitura?.code, tabela).toBe(PERMISSAO_NEGADA);
      }
      const { error: escrita } = await cliente
        .from("ia_janela_da_conversa")
        .insert({
          conversation_id: conversaDaEquipe,
          clinic_id: clinicaA,
          contact_id: contatoDaEquipe,
          phone_key: TELEFONE_DA_EQUIPE,
          desde: new Date().toISOString(),
          aberta_por: "devolver",
        });
      expect(escrita?.code).toBe(PERMISSAO_NEGADA);
    }
    // contraprova: o servidor le o rascunho
    const { data } = await admin
      .from("ai_rascunho_bloqueado")
      .select("texto")
      .eq("decision_id", decisaoBloqueada)
      .throwOnError();
    expect(data).toEqual([{ texto: "Rascunho sintético de teste." }]);
  });
});

describe("ai_decision_log e o rascunho bloqueado", () => {
  it("nenhuma sessao le blocked_draft (42501); as outras colunas seguem legiveis; A nao le B", async () => {
    for (const apelido of ["admin-a", "gestor-a", "recepcao-a"] as const) {
      const cliente = como(apelido);
      const { error: coluna } = await cliente
        .from("ai_decision_log")
        .select("id, blocked_draft");
      expect(coluna?.code).toBe(PERMISSAO_NEGADA);
      const { error: tudo } = await cliente.from("ai_decision_log").select("*");
      expect(tudo?.code).toBe(PERMISSAO_NEGADA);
      const { data, error } = await cliente
        .from("ai_decision_log")
        .select(
          "id, clinic_id, compliance_rule, escalation_reason, desfecho, motivo_da_falha, created_at",
        );
      expect(error).toBeNull();
      expect(data).toEqual([
        expect.objectContaining({
          id: decisaoBloqueada,
          clinic_id: clinicaA,
          compliance_rule: "triagem",
          desfecho: "bloqueou",
        }),
      ]);
    }
    const { data: daB } = await como("admin-b")
      .from("ai_decision_log")
      .select("clinic_id, escalation_reason");
    expect(daB).toEqual([
      { clinic_id: clinicaB, escalation_reason: "pedido_de_agenda" },
    ]);
    // nenhuma sessao escreve
    const { error: escrita } = await como("admin-a")
      .from("ai_decision_log")
      .insert({ clinic_id: clinicaA, conversation_id: conversaFora });
    expect(escrita?.code).toBe(PERMISSAO_NEGADA);
  });

  it("ler_rascunho_bloqueado: administrador, gestor, recepcao, outra clinica e o servidor recebem 42501, sem trilha", async () => {
    for (const cliente of [
      como("admin-a"),
      como("gestor-a"),
      como("recepcao-a"),
      como("admin-b"),
      admin,
    ]) {
      const { error } = await cliente.rpc("ler_rascunho_bloqueado", {
        p_decision_id: decisaoBloqueada,
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
      expect(error?.message).toBe("sem_permissao");
    }
    const { error: anon } = await anonClient().rpc("ler_rascunho_bloqueado", {
      p_decision_id: decisaoBloqueada,
    });
    expect(anon?.code).toBe(PERMISSAO_NEGADA);
    const { data: trilha } = await admin
      .from("audit_log")
      .select("id")
      .eq("action", "leu_rascunho_bloqueado")
      .eq("entity_id", decisaoBloqueada)
      .throwOnError();
    expect(trilha).toEqual([]);
  });
});

describe("conversation: pela sessao, so devolver_para_ia poe na IA", () => {
  it("PATCH e INSERT em 'ia_atendendo' dao 42501 mesmo com tudo liberado, para todo papel", async () => {
    for (const apelido of ["admin-a", "gestor-a", "recepcao-a"] as const) {
      const cliente = como(apelido);
      const { error: naUpdate } = await cliente
        .from("conversation")
        .update({ status: "ia_atendendo", assignee_user_id: null })
        .eq("id", conversaDaEquipe);
      expect(naUpdate?.code).toBe(PERMISSAO_NEGADA);
      expect(naUpdate?.message).toBe("so_pelo_devolver");
    }
    const novo = await contatoCom(clinicaA, `+5584985${digitos}`);
    const { error: noInsert } = await como("recepcao-a")
      .from("conversation")
      .insert({
        clinic_id: clinicaA,
        contact_id: novo,
        whatsapp_account_id: numeroA,
        status: "ia_atendendo",
      });
    expect(noInsert?.code).toBe(PERMISSAO_NEGADA);
    expect((await conversa(conversaDaEquipe)).status).toBe("em_atendimento");
  });
});

describe("devolver_para_ia e ia_devolver_disponivel", () => {
  it("outra clinica: P0002 nas duas, sem revelar nada", async () => {
    for (const nome of [
      "devolver_para_ia",
      "ia_devolver_disponivel",
    ] as const) {
      const { error } = await como("admin-b").rpc(nome, {
        p_conversation_id: conversaDaEquipe,
      });
      expect(error?.code).toBe(NAO_ENCONTRADO);
      expect(error?.message).toBe("conversa_nao_encontrada");
    }
    const { error: anon } = await anonClient().rpc("devolver_para_ia", {
      p_conversation_id: conversaDaEquipe,
    });
    expect(anon?.code).toBe(PERMISSAO_NEGADA);
    expect((await conversa(conversaDaEquipe)).status).toBe("em_atendimento");
  });

  it("leitura: 42501; quem nao esta com a conversa: CZ409 (o botao diz nao_e_sua)", async () => {
    const { data: leitura } = await como("leitura-a").rpc(
      "ia_devolver_disponivel",
      {
        p_conversation_id: conversaDaEquipe,
      },
    );
    expect(leitura).toEqual({ pode: false, motivo: "sem_permissao" });
    const { error: devolveLeitura } = await como("leitura-a").rpc(
      "devolver_para_ia",
      {
        p_conversation_id: conversaDaEquipe,
      },
    );
    expect(devolveLeitura?.code).toBe(PERMISSAO_NEGADA);

    const { data: outra } = await como("recepcao2-a").rpc(
      "ia_devolver_disponivel",
      {
        p_conversation_id: conversaDaEquipe,
      },
    );
    expect(outra).toEqual({ pode: false, motivo: "nao_e_sua" });
    const { error: devolveOutra } = await como("recepcao2-a").rpc(
      "devolver_para_ia",
      {
        p_conversation_id: conversaDaEquipe,
      },
    );
    expect(devolveOutra?.code).toBe(CONVERSA_MUDOU);
    expect((await conversa(conversaDaEquipe)).status).toBe("em_atendimento");
  });

  it("pergunta pendente: o botao diz pergunta_pendente e o Devolver da CZ409", async () => {
    await admin
      .from("conversation")
      .update({ awaiting_reply: true })
      .eq("id", conversaDaEquipe)
      .throwOnError();
    try {
      const { data } = await como("recepcao-a").rpc("ia_devolver_disponivel", {
        p_conversation_id: conversaDaEquipe,
      });
      expect(data).toEqual({ pode: false, motivo: "pergunta_pendente" });
      const { error } = await como("recepcao-a").rpc("devolver_para_ia", {
        p_conversation_id: conversaDaEquipe,
      });
      expect(error?.code).toBe(CONVERSA_MUDOU);
      expect(error?.message).toBe("conversa_mudou");
    } finally {
      await admin
        .from("conversation")
        .update({ awaiting_reply: false })
        .eq("id", conversaDaEquipe)
        .throwOnError();
    }
  });

  it("telefone fora da lista: 42501 nao_liberada; a recepcao ve nao_disponivel e o administrador ve nao_liberada", async () => {
    const { data: recepcao } = await como("recepcao-a").rpc(
      "ia_devolver_disponivel",
      {
        p_conversation_id: conversaFora,
      },
    );
    expect(recepcao).toEqual({ pode: false, motivo: "nao_disponivel" });
    const { error } = await como("recepcao-a").rpc("devolver_para_ia", {
      p_conversation_id: conversaFora,
    });
    expect(error?.code).toBe(PERMISSAO_NEGADA);
    expect(error?.message).toBe("nao_liberada");
    // o administrador com a conversa ve o motivo de verdade
    await admin
      .from("conversation")
      .update({ assignee_user_id: ids.get("admin-a") })
      .eq("id", conversaFora)
      .throwOnError();
    const { data: doAdmin } = await como("admin-a").rpc(
      "ia_devolver_disponivel",
      {
        p_conversation_id: conversaFora,
      },
    );
    expect(doAdmin).toEqual({ pode: false, motivo: "nao_liberada" });
    expect((await conversa(conversaFora)).status).toBe("em_atendimento");
  });

  it("contato que virou paciente depois de ligado, sem o forcar: 42501 contato_de_paciente", async () => {
    // a recepcao ve o motivo generico; o administrador, o de verdade
    await admin
      .from("conversation")
      .update({ assignee_user_id: ids.get("recepcao-a") })
      .eq("id", conversaVirouPaciente)
      .throwOnError();
    const { data: daRecepcao } = await como("recepcao-a").rpc(
      "ia_devolver_disponivel",
      { p_conversation_id: conversaVirouPaciente },
    );
    expect(daRecepcao).toEqual({ pode: false, motivo: "nao_disponivel" });
    await admin
      .from("conversation")
      .update({ assignee_user_id: ids.get("admin-a") })
      .eq("id", conversaVirouPaciente)
      .throwOnError();
    const { data } = await como("admin-a").rpc("ia_devolver_disponivel", {
      p_conversation_id: conversaVirouPaciente,
    });
    expect(data).toEqual({ pode: false, motivo: "contato_de_paciente" });
    const { error } = await como("admin-a").rpc("devolver_para_ia", {
      p_conversation_id: conversaVirouPaciente,
    });
    expect(error?.code).toBe(PERMISSAO_NEGADA);
    expect(error?.message).toBe("contato_de_paciente");
    expect((await conversa(conversaVirouPaciente)).status).toBe(
      "em_atendimento",
    );
    // e o servidor tambem nao fala mais com ele
    expect(
      await rpcDoSistema("ia_pode_falar_com", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: numeroA,
        p_telefone: TELEFONE_VIROU_PACIENTE,
      }),
    ).toBe(false);
  });

  it("pergunta pendente em conversa de paciente: nunca pergunta_pendente, a liberacao vem antes (migration 20261019120000)", async () => {
    const conversas = [conversaFora, conversaVirouPaciente];
    await admin
      .from("conversation")
      .update({ awaiting_reply: true, assignee_user_id: ids.get("admin-a") })
      .in("id", conversas)
      .throwOnError();
    try {
      // o administrador: o motivo de verdade da liberacao
      const { data: fora } = await como("admin-a").rpc(
        "ia_devolver_disponivel",
        { p_conversation_id: conversaFora },
      );
      expect(fora).toEqual({ pode: false, motivo: "nao_liberada" });
      const { data: virou } = await como("admin-a").rpc(
        "ia_devolver_disponivel",
        { p_conversation_id: conversaVirouPaciente },
      );
      expect(virou).toEqual({ pode: false, motivo: "contato_de_paciente" });
      // a recepcao: o generico, nunca "Responda o paciente antes de
      // devolver para a IA."
      await admin
        .from("conversation")
        .update({ assignee_user_id: ids.get("recepcao-a") })
        .in("id", conversas)
        .throwOnError();
      for (const id of conversas) {
        const { data } = await como("recepcao-a").rpc(
          "ia_devolver_disponivel",
          { p_conversation_id: id },
        );
        expect(data).toEqual({ pode: false, motivo: "nao_disponivel" });
      }
    } finally {
      await admin
        .from("conversation")
        .update({ awaiting_reply: false, assignee_user_id: ids.get("admin-a") })
        .in("id", conversas)
        .throwOnError();
    }
  });

  it("telefone de paciente FORCADO pela equipe Conduzza: o Devolver passa (D-B); a sessao nao forca", async () => {
    // so o servidor (equipe Conduzza para o banco) forca, com trilha propria
    const { error: semForcar } = await admin.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "Paciente",
        p_ativo: true,
      },
    );
    expect(semForcar?.code).toBe(CHECK);
    expect(semForcar?.message).toBe("contato_de_paciente");
    // Onda 2 (P3): o forcar, ate pelo servidor, exige a confirmacao do teste
    // com paciente; sem ela, 23514 e nada muda.
    const { error: semConfirmar } = await admin.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "Paciente",
        p_ativo: true,
        p_forcar_contato_existente: true,
        p_confirmou_aviso_da_openai: true,
      },
    );
    expect(semConfirmar?.code).toBe(CHECK);
    expect(semConfirmar?.message).toBe("teste_com_paciente_nao_confirmado");
    expect(
      await rpcDoSistema("definir_contato_liberado_da_ia", {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "Paciente",
        p_ativo: true,
        p_forcar_contato_existente: true,
        p_confirmou_aviso_da_openai: true,
        p_confirmou_teste_com_paciente: true,
      }),
    ).toBe(true);
    const { data: forcou } = await admin
      .from("audit_log")
      .select("action, entity")
      .eq("clinic_id", clinicaA)
      .eq("action", "forcou_telefone_de_paciente_na_ia")
      .throwOnError();
    expect(forcou).toEqual([
      {
        action: "forcou_telefone_de_paciente_na_ia",
        entity: "ia_contato_liberado",
      },
    ]);
    // a gestao le a coluna; ninguem da sessao escreve; nem o servidor forca
    // fora da funcao (o gatilho recusa)
    const { data: linha } = await como("admin-a")
      .from("ia_contato_liberado")
      .select("forcado")
      .eq("phone_key", TELEFONE_DO_PACIENTE)
      .single()
      .throwOnError();
    expect(linha).toEqual({ forcado: true });
    const { error: pelaSessao } = await como("admin-a")
      .from("ia_contato_liberado")
      .update({ forcado: true })
      .eq("phone_key", TELEFONE_VIROU_PACIENTE);
    expect(pelaSessao?.code).toBe(PERMISSAO_NEGADA);
    const { error: peloServidor } = await admin
      .from("ia_contato_liberado")
      .update({ forcado: true })
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_VIROU_PACIENTE);
    expect(peloServidor?.code).toBe(PERMISSAO_NEGADA);
    expect(peloServidor?.message).toBe("so_pelo_forcar");

    await admin
      .from("conversation")
      .update({ assignee_user_id: ids.get("admin-a") })
      .eq("id", conversaDoPaciente)
      .throwOnError();
    const { data } = await como("admin-a").rpc("ia_devolver_disponivel", {
      p_conversation_id: conversaDoPaciente,
    });
    expect(data).toEqual({ pode: true, motivo: null });
    const { data: devolveu, error } = await como("admin-a").rpc(
      "devolver_para_ia",
      { p_conversation_id: conversaDoPaciente },
    );
    expect(error).toBeNull();
    expect(devolveu).toEqual({ ok: true });
    expect((await conversa(conversaDoPaciente)).status).toBe("ia_atendendo");
  });

  it("contraprova: com tudo liberado, a recepcao devolve; evento no nome dela e trilha", async () => {
    const { data: pode } = await como("recepcao-a").rpc(
      "ia_devolver_disponivel",
      {
        p_conversation_id: conversaDaEquipe,
      },
    );
    expect(pode).toEqual({ pode: true, motivo: null });
    const { data, error } = await como("recepcao-a").rpc("devolver_para_ia", {
      p_conversation_id: conversaDaEquipe,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(await conversa(conversaDaEquipe)).toEqual({
      status: "ia_atendendo",
      assignee_user_id: null,
      awaiting_reply: false,
    });
    const { data: eventos } = await admin
      .from("message")
      .select("author, content_type, body")
      .eq("conversation_id", conversaDaEquipe)
      .eq("content_type", "evento")
      .throwOnError();
    expect(eventos).toEqual([
      {
        author: "sistema",
        content_type: "evento",
        body: "Rita Recepção devolveu a conversa para a IA",
      },
    ]);
    const { data: janela } = await admin
      .from("ia_janela_da_conversa")
      .select("contact_id, phone_key, aberta_por")
      .eq("conversation_id", conversaDaEquipe)
      .single()
      .throwOnError();
    expect(janela).toEqual({
      contact_id: contatoDaEquipe,
      phone_key: TELEFONE_DA_EQUIPE,
      aberta_por: "devolver",
    });
    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id, entity")
      .eq("action", "devolveu_para_ia")
      .eq("entity_id", conversaDaEquipe)
      .throwOnError();
    expect(trilha).toEqual([
      { user_id: ids.get("recepcao-a"), entity: "conversation" },
    ]);
  });

  it("conversa ja na IA: a sessao nao troca o contato (42501)", async () => {
    expect((await conversa(conversaDaEquipe)).status).toBe("ia_atendendo");
    const { error } = await como("admin-a")
      .from("conversation")
      .update({ contact_id: contatoFora })
      .eq("id", conversaDaEquipe);
    expect(error?.code).toBe(PERMISSAO_NEGADA);
    // contraprova: Assumir (sair da IA) continua pela sessao
    const { error: assumir } = await como("recepcao-a")
      .from("conversation")
      .update({
        status: "em_atendimento",
        assignee_user_id: ids.get("recepcao-a"),
      })
      .eq("id", conversaDaEquipe);
    expect(assumir).toBeNull();
  });
});

describe("ligar o WhatsApp: modo e numero so pela equipe Conduzza; telefone tambem pelo administrador", () => {
  const SO_A_EQUIPE = "Somente a equipe do Conduzza libera a IA.";

  it("o administrador recebe 42501 ao ligar modo contatos e numero; o forcar sem a confirmacao do teste da 23514 (com e sem sinal de paciente); e desliga", async () => {
    const adminA = como("admin-a");
    for (const [nome, args] of [
      [
        "definir_liberacao_da_ia",
        { p_clinic_id: clinicaA, p_liberada: true, p_modo: "contatos" },
      ],
      [
        "definir_numero_da_ia",
        {
          p_clinic_id: clinicaA,
          p_whatsapp_account_id: numeroA,
          p_ativo: true,
        },
      ],
    ] as const) {
      const { error } = await adminA.rpc(nome, args);
      expect(error?.code, nome).toBe(PERMISSAO_NEGADA);
      expect(error?.message, nome).toBe(SO_A_EQUIPE);
    }
    // Onda 2 (P3 (a), migration 20261022110000): o forcar do administrador
    // nao e mais 42501; sem a confirmacao do teste com paciente, 23514,
    // mesmo sem sinal de paciente (o erro nao revela se o telefone e de
    // paciente), e nada e gravado.
    const { error: forcarSemConfirmar } = await adminA.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_FORA,
        p_rotulo: "Forjado",
        p_ativo: true,
        p_forcar_contato_existente: true,
        p_confirmou_aviso_da_openai: true,
      },
    );
    expect(forcarSemConfirmar?.code).toBe(CHECK);
    expect(forcarSemConfirmar?.message).toBe(
      "teste_com_paciente_nao_confirmado",
    );
    // desligar: o administrador consegue (o telefone do paciente, forcado antes)
    const { data, error } = await adminA.rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaA,
      p_telefone_e164: TELEFONE_DO_PACIENTE,
      p_rotulo: null,
      p_ativo: false,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
    // religar o paciente: sem o forcar, a recusa de paciente; com o forcar
    // e sem a confirmacao do teste, 23514 teste_com_paciente_nao_confirmado
    const { error: semForcar } = await adminA.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "",
        p_ativo: true,
      },
    );
    expect(semForcar?.code).toBe(CHECK);
    expect(semForcar?.message).toBe("contato_de_paciente");
    const { error: comForcar } = await adminA.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "",
        p_ativo: true,
        p_forcar_contato_existente: true,
      },
    );
    expect(comForcar?.code).toBe(CHECK);
    expect(comForcar?.message).toBe("teste_com_paciente_nao_confirmado");
    const { data: doPaciente } = await admin
      .from("ia_contato_liberado")
      .select("ativo, forcado")
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_DO_PACIENTE)
      .single()
      .throwOnError();
    expect(doPaciente).toEqual({ ativo: false, forcado: false });
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("ativo")
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_FORA);
    expect(linha).toEqual([]);
    // ate aqui, o forcar so existe na trilha do servidor (o teste do D-B)
    const { data: forcou } = await admin
      .from("audit_log")
      .select("user_id")
      .eq("clinic_id", clinicaA)
      .eq("action", "forcou_telefone_de_paciente_na_ia")
      .throwOnError();
    expect(forcou).toEqual([{ user_id: null }]);
  });

  it("onda 2 (P3): o administrador forca o telefone do paciente com a confirmacao do teste, com as trilhas no nome dele; o gestor nao (42501)", async () => {
    const { error: doGestor } = await como("gestor-a").rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "",
        p_ativo: true,
        p_forcar_contato_existente: true,
        p_confirmou_teste_com_paciente: true,
      },
    );
    expect(doGestor?.code).toBe(PERMISSAO_NEGADA);
    const { data, error } = await como("admin-a").rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: "",
        p_ativo: true,
        p_forcar_contato_existente: true,
        p_confirmou_teste_com_paciente: true,
      },
    );
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("id, ativo, forcado")
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_DO_PACIENTE)
      .single()
      .throwOnError();
    const { id, ...estado } = linha as {
      id: string;
      ativo: boolean;
      forcado: boolean;
    };
    expect(estado).toEqual({ ativo: true, forcado: true });
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action")
      .eq("clinic_id", clinicaA)
      .eq("entity_id", id)
      .eq("user_id", ids.get("admin-a")!)
      .in("action", [
        "forcou_telefone_de_paciente_na_ia",
        "confirmou_teste_com_paciente",
      ])
      .throwOnError();
    expect(
      ((trilha ?? []) as { action: string }[]).map((l) => l.action).sort(),
    ).toEqual([
      "confirmou_teste_com_paciente",
      "forcou_telefone_de_paciente_na_ia",
    ]);
    // volta como estava (desligado; desligar zera o forcado)
    const { data: desligou } = await como("admin-a").rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_PACIENTE,
        p_rotulo: null,
        p_ativo: false,
      },
    );
    expect(desligou).toBe(false);
  });

  it("telefone da equipe (19/10/2026): o administrador liga sem forcar, desliga e liga de novo, com a trilha no nome dele; gestor, recepcao, leitura e o administrador da B: 42501", async () => {
    for (const apelido of [
      "gestor-a",
      "recepcao-a",
      "leitura-a",
      "admin-b",
    ] as const) {
      const { error } = await como(apelido).rpc(
        "definir_contato_liberado_da_ia",
        {
          p_clinic_id: clinicaA,
          p_telefone_e164: TELEFONE_DO_ADMIN,
          p_rotulo: "Forjado",
          p_ativo: true,
        },
      );
      expect(error?.code, apelido).toBe(PERMISSAO_NEGADA);
    }
    const { data: nenhuma } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_DO_ADMIN)
      .throwOnError();
    expect(nenhuma).toEqual([]);

    const adminA = como("admin-a");
    const chamar = async (args: Record<string, unknown>, esperado: boolean) => {
      const { data, error } = await adminA.rpc(
        "definir_contato_liberado_da_ia",
        { p_clinic_id: clinicaA, p_telefone_e164: TELEFONE_DO_ADMIN, ...args },
      );
      expect(error).toBeNull();
      expect(data).toBe(esperado);
    };
    const linhaDoAdmin = async () => {
      const { data } = await admin
        .from("ia_contato_liberado")
        .select("id, ativo, forcado, rotulo, alterado_por")
        .eq("clinic_id", clinicaA)
        .eq("phone_key", TELEFONE_DO_ADMIN)
        .single()
        .throwOnError();
      return data as {
        id: string;
        ativo: boolean;
        forcado: boolean;
        rotulo: string | null;
        alterado_por: string | null;
      };
    };

    // telefone novo: com a confirmacao do aviso da OpenAI (migration
    // 20261019120000), que o banco grava na trilha no nome dele
    await chamar(
      {
        p_rotulo: "Admin pela tela",
        p_ativo: true,
        p_confirmou_aviso_da_openai: true,
      },
      true,
    );
    expect(await linhaDoAdmin()).toMatchObject({
      ativo: true,
      forcado: false,
      rotulo: "Admin pela tela",
      alterado_por: ids.get("admin-a"),
    });
    await chamar({ p_rotulo: null, p_ativo: false }, false);
    expect((await linhaDoAdmin()).ativo).toBe(false);
    // "Ligar de novo": rotulo vazio mantem o gravado
    await chamar({ p_rotulo: "", p_ativo: true }, true);
    const religado = await linhaDoAdmin();
    expect(religado).toMatchObject({
      ativo: true,
      forcado: false,
      rotulo: "Admin pela tela",
    });
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action")
      .eq("clinic_id", clinicaA)
      .eq("user_id", ids.get("admin-a")!)
      .eq("entity", "ia_contato_liberado")
      .eq("entity_id", religado.id)
      .throwOnError();
    // ligar (com a confirmacao), desligar e ligar de novo (sem ela: o
    // "Ligar de novo" nao grava outra confirmacao)
    expect(
      (trilha as { action: string }[]).map((linha) => linha.action).sort(),
    ).toEqual(["confirmou_aviso_da_openai", "editou", "editou", "editou"]);
    // desligado no fim: o resto da suite nao conta com este telefone
    await chamar({ p_rotulo: null, p_ativo: false }, false);
  });

  it("numero de WhatsApp da plataforma: 23514 ate para o servidor, sem o telefone na mensagem; desligar passa", async () => {
    // a B ganha a linha de liberacao DESLIGADA (a lista de telefones exige a linha)
    expect(
      await rpcDoSistema("definir_liberacao_da_ia", {
        p_clinic_id: clinicaB,
        p_liberada: false,
        p_motivo: "teste de RLS do E3",
      }),
    ).toBe(false);
    const { error } = await admin.rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaB,
      p_telefone_e164: NUMERO_DA_A_E164,
      p_rotulo: "Numero da A",
      p_ativo: true,
    });
    expect(error?.code).toBe(CHECK);
    expect(error?.message).toBe("telefone_invalido_para_equipe");
    expect(error?.message).not.toContain(digitos);
    // o numero da propria clinica tambem
    const { error: daPropria } = await admin.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: NUMERO_DA_A_E164,
        p_rotulo: "Numero da A",
        p_ativo: true,
      },
    );
    expect(daPropria?.message).toBe("telefone_invalido_para_equipe");
    // e para o administrador, que agora liga telefone (19/10/2026)
    const { error: peloAdmin } = await como("admin-a").rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: NUMERO_DA_A_E164,
        p_rotulo: "Numero da A",
        p_ativo: true,
      },
    );
    expect(peloAdmin?.code).toBe(CHECK);
    expect(peloAdmin?.message).toBe("telefone_invalido_para_equipe");
    expect(peloAdmin?.message).not.toContain(digitos);
    // desligar nunca e recusado; fora da lista, nao cria linha (migration
    // 20261019120000)
    expect(
      await rpcDoSistema("definir_contato_liberado_da_ia", {
        p_clinic_id: clinicaB,
        p_telefone_e164: NUMERO_DA_A_E164,
        p_rotulo: "Numero da A",
        p_ativo: false,
      }),
    ).toBe(false);
    const { data: semLinha } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicaB)
      .throwOnError();
    expect(semLinha).toEqual([]);
  });
});

describe("confirmacao do aviso da OpenAI no banco (migration 20261019120000)", () => {
  it("telefone novo sem a confirmacao: 23514 para o administrador e para o servidor, sem linha; desligar fora da lista nao cria linha; com ela, a linha e a trilha no nome de quem liga", async () => {
    const adminA = como("admin-a");
    const linhas = async () => {
      const { data } = await admin
        .from("ia_contato_liberado")
        .select("id, ativo")
        .eq("clinic_id", clinicaA)
        .eq("phone_key", TELEFONE_DA_CONFIRMACAO)
        .throwOnError();
      return data as { id: string; ativo: boolean }[];
    };
    for (const [quem, cliente, confirmou] of [
      ["administrador sem o parametro", adminA, undefined],
      ["administrador com falso", adminA, false],
      ["servidor sem o parametro", admin, undefined],
    ] as const) {
      const { error } = await cliente.rpc("definir_contato_liberado_da_ia", {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DA_CONFIRMACAO,
        p_rotulo: "Sem confirmar",
        p_ativo: true,
        ...(confirmou === undefined
          ? {}
          : { p_confirmou_aviso_da_openai: confirmou }),
      });
      expect(error?.code, quem).toBe(CHECK);
      expect(error?.message, quem).toBe("aviso_da_openai_nao_confirmado");
      expect(error?.message, quem).not.toContain(digitos);
    }
    expect(await linhas()).toEqual([]);

    // desligar telefone fora da lista: passa, sem linha nem trilha
    const { data: desligou, error: erroAoDesligar } = await adminA.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DA_CONFIRMACAO,
        p_rotulo: "Fora da lista",
        p_ativo: false,
      },
    );
    expect(erroAoDesligar).toBeNull();
    expect(desligou).toBe(false);
    expect(await linhas()).toEqual([]);

    // com a confirmacao: a linha e a trilha (editou e confirmou), no nome
    // do administrador, na mesma transacao
    const { data: ligou, error: erroAoLigar } = await adminA.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DA_CONFIRMACAO,
        p_rotulo: "Confirmado",
        p_ativo: true,
        p_confirmou_aviso_da_openai: true,
      },
    );
    expect(erroAoLigar).toBeNull();
    expect(ligou).toBe(true);
    const [criada] = await linhas();
    expect(criada?.ativo).toBe(true);
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action, user_id")
      .eq("clinic_id", clinicaA)
      .eq("entity", "ia_contato_liberado")
      .eq("entity_id", criada!.id)
      .throwOnError();
    expect(
      (trilha as { action: string; user_id: string | null }[])
        .map((linha) => `${linha.action}|${linha.user_id}`)
        .sort(),
    ).toEqual([
      `confirmou_aviso_da_openai|${ids.get("admin-a")}`,
      `editou|${ids.get("admin-a")}`,
    ]);

    // desligado no fim: o resto da suite nao conta com este telefone
    const { error: erroNoFim } = await adminA.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DA_CONFIRMACAO,
        p_rotulo: null,
        p_ativo: false,
      },
    );
    expect(erroNoFim).toBeNull();
  });
});

describe("varios numeros ligados (decisao do dono de 19/10/2026)", () => {
  const SO_A_EQUIPE = "Somente a equipe do Conduzza libera a IA.";

  async function numerosDaA(): Promise<Record<string, boolean>> {
    const { data } = await admin
      .from("ia_numero_liberado")
      .select("whatsapp_account_id, ativo")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    return Object.fromEntries(
      (data as { whatsapp_account_id: string; ativo: boolean }[]).map(
        (linha) => [linha.whatsapp_account_id, linha.ativo],
      ),
    );
  }

  async function abertasNaSituacao(): Promise<string[]> {
    const { data, error } = await como("admin-a").rpc(
      "situacao_da_ia_na_clinica",
      { p_clinic_id: clinicaA },
    );
    expect(error).toBeNull();
    return (data as { telefones_com_conversa_aberta: string[] })
      .telefones_com_conversa_aberta;
  }

  type ConversaAberta = {
    telefone_id: string;
    whatsapp_account_id: string;
    conversation_id: string;
  };

  async function conversasAbertasNaSituacao(): Promise<ConversaAberta[]> {
    const { data, error } = await como("admin-a").rpc(
      "situacao_da_ia_na_clinica",
      { p_clinic_id: clinicaA },
    );
    expect(error).toBeNull();
    return (data as { conversas_abertas: ConversaAberta[] }).conversas_abertas;
  }

  it("o servidor liga o segundo sem desligar o primeiro; o administrador desliga um sem mexer no outro e nao liga (42501); a situacao acompanha o numero", async () => {
    const adminA = como("admin-a");
    const { count: trilhaDoPrimeiroAntes } = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .eq("entity", "ia_numero_liberado")
      .eq("entity_id", numeroA);

    // o servidor (equipe Conduzza para o banco) liga o segundo: os dois
    // ficam ligados ao mesmo tempo
    expect(
      await rpcDoSistema("definir_numero_da_ia", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: segundoNumeroA,
        p_ativo: true,
      }),
    ).toBe(true);
    expect(await numerosDaA()).toEqual({
      [numeroA]: true,
      [segundoNumeroA]: true,
    });

    // um telefone da equipe com conversa aberta com a recepcao no segundo
    // numero: a situacao conta (todos os numeros ligados)
    const contato = await contatoCom(clinicaA, TELEFONE_DO_SEGUNDO_NUMERO);
    await rpcDoSistema("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaA,
      p_telefone_e164: TELEFONE_DO_SEGUNDO_NUMERO,
      p_rotulo: "Equipe do segundo numero",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
    const conversaDoSegundo = await conversaComARecepcao(
      contato,
      segundoNumeroA,
    );
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_DO_SEGUNDO_NUMERO)
      .single()
      .throwOnError();
    const idDoTelefone = (linha as { id: string }).id;
    expect(await abertasNaSituacao()).toContain(idDoTelefone);
    // e diz em QUAL numero, com a conversa (migration 20261019120000)
    expect(await conversasAbertasNaSituacao()).toContainEqual({
      telefone_id: idDoTelefone,
      whatsapp_account_id: segundoNumeroA,
      conversation_id: conversaDoSegundo,
    });

    // o administrador desliga o segundo: o primeiro continua ligado
    const { data: desligou, error: erroAoDesligar } = await adminA.rpc(
      "definir_numero_da_ia",
      {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: segundoNumeroA,
        p_ativo: false,
      },
    );
    expect(erroAoDesligar).toBeNull();
    expect(desligou).toBe(false);
    expect(await numerosDaA()).toEqual({
      [numeroA]: true,
      [segundoNumeroA]: false,
    });
    // a conversa aberta do numero desligado sai da situacao
    expect(await abertasNaSituacao()).not.toContain(idDoTelefone);
    expect(
      (await conversasAbertasNaSituacao()).filter(
        (aberta) => aberta.telefone_id === idDoTelefone,
      ),
    ).toEqual([]);

    // o administrador nao liga de novo, mesmo com o outro ligado: 42501, a
    // mensagem de hoje, e nada muda
    const { error: aoLigar } = await adminA.rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaA,
      p_whatsapp_account_id: segundoNumeroA,
      p_ativo: true,
    });
    expect(aoLigar?.code).toBe(PERMISSAO_NEGADA);
    expect(aoLigar?.message).toBe(SO_A_EQUIPE);
    expect(await numerosDaA()).toEqual({
      [numeroA]: true,
      [segundoNumeroA]: false,
    });

    // a trilha do segundo: a do servidor ao ligar e a do administrador ao
    // desligar; nenhuma do primeiro (ninguem o desligou junto)
    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id")
      .eq("clinic_id", clinicaA)
      .eq("entity", "ia_numero_liberado")
      .eq("entity_id", segundoNumeroA)
      .throwOnError();
    expect(
      (trilha as { user_id: string | null }[]).map((l) => l.user_id).sort(),
    ).toEqual([ids.get("admin-a")!, null].sort());
    const { count: trilhaDoPrimeiroDepois } = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .eq("entity", "ia_numero_liberado")
      .eq("entity_id", numeroA);
    expect(trilhaDoPrimeiroDepois).toBe(trilhaDoPrimeiroAntes);
  });
});

describe("situacao_da_ia_na_clinica", () => {
  it("administrador e gestor da propria clinica leem; recepcao e outra clinica 42501", async () => {
    for (const apelido of ["admin-a", "gestor-a"] as const) {
      const { data, error } = await como(apelido).rpc(
        "situacao_da_ia_na_clinica",
        {
          p_clinic_id: clinicaA,
        },
      );
      expect(error).toBeNull();
      expect(data).toMatchObject({ teto_atingido: false, versao_publicada: 1 });
      expect(typeof (data as { motor_parado?: unknown }).motor_parado).toBe(
        "boolean",
      );
    }
    for (const [apelido, clinica] of [
      ["recepcao-a", clinicaA],
      ["leitura-a", clinicaA],
      ["admin-b", clinicaA],
      ["admin-a", clinicaB],
    ] as const) {
      const { error } = await como(apelido).rpc("situacao_da_ia_na_clinica", {
        p_clinic_id: clinica,
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });
});

describe("message: a sessao nao grava a resposta da IA", () => {
  it("INSERT com author 'ia' recusado (sem job: 42501 da policy; com job: CZIA2 do gatilho); UPDATE para 'ia' nao muda nada", async () => {
    // O gatilho de message (BEFORE) roda antes da policy: com job_id ele
    // recusa primeiro (CZIA2, o job nao existe); sem job_id, numa clinica de
    // teste, a policy de INSERT (so 'usuario' ou evento) recusa.
    for (const apelido of ["admin-a", "recepcao-a"] as const) {
      for (const [jobId, codigo] of [
        [null, PERMISSAO_NEGADA],
        [crypto.randomUUID(), "CZIA2"],
      ] as const) {
        const { error } = await como(apelido).from("message").insert({
          clinic_id: clinicaA,
          conversation_id: conversaFora,
          direction: "saida",
          author: "ia",
          content_type: "texto",
          body: "Resposta forjada.",
          job_id: jobId,
        });
        expect(error?.code, apelido).toBe(codigo);
      }
    }
    // contraprova: a mesma pessoa grava a propria mensagem
    const { data: propria, error: erroDaPropria } = await como("recepcao-a")
      .from("message")
      .insert({
        clinic_id: clinicaA,
        conversation_id: conversaFora,
        direction: "saida",
        author: "usuario",
        author_user_id: ids.get("recepcao-a"),
        content_type: "texto",
        body: "Mensagem sintética da recepção.",
        is_internal_note: true,
      })
      .select("id")
      .single();
    expect(erroDaPropria).toBeNull();
    const id = (propria as { id: string }).id;
    await como("recepcao-a")
      .from("message")
      .update({ author: "ia", author_user_id: null })
      .eq("id", id);
    const { data: depois } = await admin
      .from("message")
      .select("author")
      .eq("id", id)
      .single()
      .throwOnError();
    expect(depois).toEqual({ author: "usuario" });
    const { data: daIa } = await admin
      .from("message")
      .select("id")
      .eq("conversation_id", conversaFora)
      .eq("author", "ia")
      .throwOnError();
    expect(daIa).toEqual([]);
  });
});

describe("saude_do_motor: a chave ia detalhada so para o servidor", () => {
  it("a sessao recebe ia nulo (fila e planner como hoje); o servidor recebe o objeto", async () => {
    for (const apelido of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "admin-b",
    ] as const) {
      const { data, error } = await como(apelido).rpc("saude_do_motor");
      expect(error).toBeNull();
      const saude = data as Record<string, unknown>;
      expect(saude).toHaveProperty("fila");
      expect(saude).toHaveProperty("planner");
      expect(saude.ia, apelido).toBeNull();
    }
    const { data } = await admin.rpc("saude_do_motor");
    expect((data as { ia: unknown }).ia).toMatchObject({
      agendado: expect.any(Boolean),
      vigiado: expect.any(Boolean),
      devidos: expect.any(Number),
      alerta: expect.any(Boolean),
    });
  });
});

describe("onda 2 (M2): excluir telefone da equipe", () => {
  // Um telefone novo da A, ligado pelo servidor, com contato e conversa na
  // IA (a service role poe a conversa na IA; a sessao nunca).
  const TELEFONE_EXCLUIR = `+5584985${digitos}`;
  let telefoneId = "";
  let conversaExcluir = "";

  beforeAll(async () => {
    await rpcDoSistema("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaA,
      p_telefone_e164: TELEFONE_EXCLUIR,
      p_rotulo: "Para excluir",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("phone_key", TELEFONE_EXCLUIR)
      .single()
      .throwOnError();
    telefoneId = (linha as { id: string }).id;
    const contato = await contatoCom(clinicaA, TELEFONE_EXCLUIR);
    const { data: nova } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicaA,
        contact_id: contato,
        whatsapp_account_id: numeroA,
        status: "ia_atendendo",
      })
      .select("id")
      .single()
      .throwOnError();
    conversaExcluir = (nova as { id: string }).id;
  });

  it("gestor, recepcao, leitura, a outra clinica e anon: 42501, e o telefone fica", async () => {
    for (const cliente of [
      como("gestor-a"),
      como("recepcao-a"),
      como("leitura-a"),
      como("admin-b"),
      anonClient(),
    ]) {
      const { error } = await cliente.rpc("excluir_contato_liberado_da_ia", {
        p_clinic_id: clinicaA,
        p_contato_liberado_id: telefoneId,
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    // a B pela propria clinica, com o id da A: nada (false), sem erro
    const { data: pelaB, error: erroDaB } = await como("admin-b").rpc(
      "excluir_contato_liberado_da_ia",
      { p_clinic_id: clinicaB, p_contato_liberado_id: telefoneId },
    );
    expect(erroDaB).toBeNull();
    expect(pelaB).toBe(false);
    const { data } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("id", telefoneId);
    expect(data).toEqual([{ id: telefoneId }]);
  });

  it("o administrador da propria clinica exclui: a linha sai, a conversa do telefone volta para a equipe e a trilha fica no nome dele, sem o telefone", async () => {
    const { data, error } = await como("admin-a").rpc(
      "excluir_contato_liberado_da_ia",
      { p_clinic_id: clinicaA, p_contato_liberado_id: telefoneId },
    );
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("id", telefoneId);
    expect(linha).toEqual([]);
    expect((await conversa(conversaExcluir)).status).toBe("aguardando_humano");
    const { data: eventos } = await admin
      .from("message")
      .select("body")
      .eq("conversation_id", conversaExcluir)
      .eq("content_type", "evento")
      .throwOnError();
    expect(eventos).toEqual([
      { body: "O assistente foi desligado. A conversa voltou para a equipe." },
    ]);
    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id, entity, detalhes")
      .eq("clinic_id", clinicaA)
      .eq("action", "excluiu_telefone_da_ia")
      .eq("entity_id", telefoneId)
      .throwOnError();
    expect(trilha).toEqual([
      {
        user_id: ids.get("admin-a"),
        entity: "ia_contato_liberado",
        detalhes: null,
      },
    ]);
    // de novo: false, sem outra trilha
    const { data: deNovo } = await como("admin-a").rpc(
      "excluir_contato_liberado_da_ia",
      { p_clinic_id: clinicaA, p_contato_liberado_id: telefoneId },
    );
    expect(deNovo).toBe(false);
  });
});
