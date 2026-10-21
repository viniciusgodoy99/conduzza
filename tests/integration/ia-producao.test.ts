import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Onda 2, item 11 (migration 20261022120000_producao_do_agente.sql, M3),
// contra o banco REAL, pelo cliente de servico e, no Devolver, pela sessao
// de uma recepcionista sintetica. O que esta em jogo:
// - numero_inteiro (todos os contatos) no WhatsApp falso, numa clinica
//   e_de_teste ligada pelo caminho das suites (definir_liberacao_da_ia: o
//   gatilho deixa a e_de_teste passar): o contato fora da lista nasce na IA
//   com o publico da versao publicada; a trava K nao vale (o paciente fora
//   da lista entra com o publico "leads e pacientes"); o publico vale (so
//   leads recusa o paciente; o nulo recusa todo mundo: falha fechada); o
//   Devolver de qualquer contato; a reserva de gasto do WhatsApp; a pausa
//   (devolve as conversas e para a IA; retomar volta);
// - a producao pelo painel, numa clinica que deixa de ser de teste SO
//   DENTRO do teste (N, sem paciente de verdade, so numero fake): recusada
//   com requisito faltando (P0001 requisitos_pendentes, com as chaves no
//   hint); com os requisitos da propria N registrados (NUNCA um requisito
//   geral: ele valeria para as clinicas de verdade), liga numero_inteiro;
//   de producao para teste, as conversas de quem nao e telefone da equipe
//   voltam para a equipe e a do telefone da equipe fica; revogar um
//   requisito da N devolve a N para teste.
//
// ESTE BANCO E O DE PRODUCAO. A N deixa de ser de teste so no bloco da
// producao e volta a ser no finally (desligada antes). Se a execucao
// morrer antes do finally, o beforeAll da execucao seguinte acha a N pela
// slug e pelo nome, desliga o agente, devolve a marca de teste e so entao a
// apaga com as outras sobras (o delete continua so de clinica de teste). O
// interruptor global NUNCA e tocado. Nada usa a id da salud-care, da
// teste123 nem da Conduzza Teste. Telefones ficticios; nenhuma mensagem
// sai (numero fake, nenhum executor roda aqui).
// ESCRITO NA ONDA 2 E NAO RODADO por quem escreveu (grava no banco): roda
// depois de aplicar a migration (npm run test:integration -- ia-producao).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name, e_de_teste from public.clinic where slug like 'ia-producao-int-%';
//   select public.definir_agente_da_clinica(id, 'desligado', 'limpeza')
//     from public.clinic where slug like 'ia-producao-int-%' and not e_de_teste;
//   update public.clinic set e_de_teste = true where slug like 'ia-producao-int-%';
//   delete from public.clinic where slug like 'ia-producao-int-%' and e_de_teste;
// e o usuario 'ia-producao-int-%@teste.dev' pela API de administracao.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `IaProducaoInt!${sufixo}`;
const telefone = (final: string) => `+558491${final}${digitos}`;

const clinicas: string[] = [];
let clinicaT = ""; // e_de_teste, numero_inteiro pelo caminho das suites
let numeroT = "";
let clinicaN = ""; // deixa de ser de teste so no bloco da producao
let numeroN = "";
let recepcionista = "";
let sessao: SupabaseClient;
let seq = 0;
const wa = () => `ia-producao-int:${sufixo}:${++seq}`;

type Erro = { code?: string; message?: string; hint?: string } | null;

type Ingestao = {
  conversation_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  ia_atendendo?: boolean;
};

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function inserir(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function ingerir(
  clinica: string,
  numero: string,
  telefoneE164: string,
): Promise<Ingestao> {
  return rpcOk<Ingestao>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefoneE164,
    p_name: "Contato sintético",
    p_wa_message_id: wa(),
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numero,
  });
}

async function publicar(clinica: string, publico: string | null) {
  const { data } = await admin
    .from("ai_agent_config")
    .select("version")
    .eq("clinic_id", clinica)
    .order("version", { ascending: false })
    .limit(1)
    .throwOnError();
  const versao = ((data ?? []) as { version: number }[])[0]?.version ?? 0;
  await admin
    .from("ai_agent_config")
    .insert({
      clinic_id: clinica,
      version: versao + 1,
      status: "publicada",
      publico_atendido: publico,
    })
    .throwOnError();
}

async function statusDa(id: string): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .select("status")
    .eq("id", id)
    .single()
    .throwOnError();
  return (data as { status: string }).status;
}

async function estadoDa(clinica: string) {
  const [{ data: h }, { data: l }] = await Promise.all([
    admin
      .from("ia_clinica_habilitada")
      .select("estado")
      .eq("clinic_id", clinica)
      .maybeSingle()
      .throwOnError(),
    admin
      .from("ia_liberacao")
      .select("modo, liberada, pausada_pela_clinica")
      .eq("clinic_id", clinica)
      .maybeSingle()
      .throwOnError(),
  ]);
  return {
    estado: (h as { estado: string } | null)?.estado ?? "desligado",
    liberacao: l as {
      modo: string;
      liberada: boolean;
      pausada_pela_clinica: boolean;
    } | null,
  };
}

async function novaClinica(nome: string): Promise<string> {
  const id = await inserir("clinic", {
    name: `IA producao ${nome} ${sufixo}`,
    slug: `ia-producao-int-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
  });
  clinicas.push(id);
  return id;
}

beforeAll(async () => {
  // Sobra de uma execucao que caiu no meio: a N sem a marca de teste.
  const { data: sobras } = await admin
    .from("clinic")
    .select("id")
    .like("slug", "ia-producao-int-n-%")
    .like("name", "IA producao N %")
    .eq("e_de_teste", false)
    .throwOnError();
  for (const { id } of (sobras ?? []) as { id: string }[]) {
    await admin.rpc("definir_agente_da_clinica", {
      p_clinic_id: id,
      p_estado: "desligado",
      p_motivo: "Limpeza de sobra do teste de integracao",
    });
    await admin
      .from("clinic")
      .update({ e_de_teste: true })
      .eq("id", id)
      .throwOnError();
  }
  await admin
    .from("clinic")
    .delete()
    .like("slug", "ia-producao-int-%")
    .eq("e_de_teste", true);

  clinicaT = await novaClinica("T");
  numeroT = (await criarNumeroDeTeste(admin, clinicaT, { nome: "Recepção" }))
    .id;
  clinicaN = await novaClinica("N");
  numeroN = (await criarNumeroDeTeste(admin, clinicaN, { nome: "Recepção" }))
    .id;

  // T: liberada em numero_inteiro pelo caminho das suites (o servidor e
  // equipe Conduzza; a e_de_teste passa no gatilho), com o numero e uma
  // versao publicada para leads e pacientes.
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaT,
    p_liberada: true,
    p_modo: "numero_inteiro",
    p_motivo: "teste de integracao da onda 2",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaT,
    p_whatsapp_account_id: numeroT,
    p_ativo: true,
  });
  await publicar(clinicaT, "todos");

  // A recepcionista sintetica (so para o Devolver pela sessao).
  const { data: criada, error } = await admin.auth.admin.createUser({
    email: `ia-producao-int-${sufixo}@teste.dev`,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: "Recepcionista Sintética" },
  });
  if (error || !criada.user) {
    throw new Error(`criar recepcionista: ${error?.message ?? "sem usuário"}`);
  }
  recepcionista = criada.user.id;
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicaT,
      user_id: recepcionista,
      role: "recepcao",
      status: "ativo",
    })
    .throwOnError();
  sessao = anonClient();
  const { error: erroLogin } = await sessao.auth.signInWithPassword({
    email: `ia-producao-int-${sufixo}@teste.dev`,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login: ${erroLogin.message}`);
  }
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
  if (recepcionista) {
    await admin.auth.admin.deleteUser(recepcionista);
  }
});

describe("numero_inteiro no WhatsApp falso (clinica de teste)", () => {
  it("o contato fora da lista nasce na IA; a trava K nao vale; o publico vale (nulo recusa)", async () => {
    // Lead sem cadastro, fora da lista.
    expect((await ingerir(clinicaT, numeroT, telefone("1"))).ia_atendendo).toBe(
      true,
    );
    // Paciente fora da lista, com leads e pacientes: entra (sem trava K).
    await inserir("contact", {
      clinic_id: clinicaT,
      phone_e164: telefone("2"),
      name: "Contato sintético",
      kind: "paciente",
    });
    expect((await ingerir(clinicaT, numeroT, telefone("2"))).ia_atendendo).toBe(
      true,
    );
    // So leads: o paciente nao entra (conversa nova de outro paciente).
    await publicar(clinicaT, "leads");
    await inserir("contact", {
      clinic_id: clinicaT,
      phone_e164: telefone("3"),
      name: "Contato sintético",
      kind: "paciente",
    });
    expect((await ingerir(clinicaT, numeroT, telefone("3"))).ia_atendendo).toBe(
      false,
    );
    // Publico nulo no numero_inteiro: ninguem entra (falha fechada).
    await publicar(clinicaT, null);
    expect(
      await rpcOk<boolean>("ia_atende_no_whatsapp", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_telefone: telefone("4"),
      }),
    ).toBe(false);
    await publicar(clinicaT, "todos");
  });

  it("a reserva de gasto do WhatsApp aceita o numero_inteiro", async () => {
    const reserva = await rpcOk<string | null>("reservar_gasto_da_ia", {
      p_clinic_id: clinicaT,
      p_origem: "whatsapp",
      p_custo_microdolar: 1,
    });
    expect(typeof reserva).toBe("string");
  });

  it("o Devolver de qualquer contato (fora da lista)", async () => {
    const contato = await inserir("contact", {
      clinic_id: clinicaT,
      phone_e164: telefone("5"),
      name: "Contato sintético",
      kind: "paciente",
    });
    const conversa = await inserir("conversation", {
      clinic_id: clinicaT,
      contact_id: contato,
      whatsapp_account_id: numeroT,
      status: "em_atendimento",
      assignee_user_id: recepcionista,
      awaiting_reply: false,
    });
    const { data: disponivel } = await sessao.rpc("ia_devolver_disponivel", {
      p_conversation_id: conversa,
    });
    expect(disponivel).toEqual({ pode: true, motivo: null });
    const { data, error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: conversa,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(await statusDa(conversa)).toBe("ia_atendendo");
  });

  it("a pausa devolve as conversas e para a IA; retomar volta", async () => {
    const naIa = await ingerir(clinicaT, numeroT, telefone("6"));
    expect(naIa.ia_atendendo).toBe(true);
    expect(
      await rpcOk<boolean>("definir_pausa_da_ia", {
        p_clinic_id: clinicaT,
        p_pausada: true,
        p_motivo: "Pausa do teste de integração",
      }),
    ).toBe(true);
    expect(await statusDa(naIa.conversation_id!)).toBe("aguardando_humano");
    expect(
      await rpcOk<boolean>("ia_pode_atender", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_phone_key: telefone("7"),
      }),
    ).toBe(false);
    expect(
      await rpcOk<boolean>("definir_pausa_da_ia", {
        p_clinic_id: clinicaT,
        p_pausada: false,
        p_motivo: "",
      }),
    ).toBe(false);
    expect(
      await rpcOk<boolean>("ia_pode_atender", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_phone_key: telefone("7"),
      }),
    ).toBe(true);
  });
});

describe("a producao pelo painel (a N, fora de teste so aqui)", () => {
  const EQUIPE_N = `+5584918${digitos}`;
  const LEAD_N = `+5584919${digitos}`;

  it("requisito faltando, producao e de volta: a lista, numero_inteiro, as conversas e a revogacao", async () => {
    await admin
      .from("clinic")
      .update({ e_de_teste: false })
      .eq("id", clinicaN)
      .throwOnError();
    try {
      await rpcOk("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "teste",
        p_motivo: "teste de integracao da onda 2",
      });
      // Sem versao, numero, publico e os requisitos: P0001 com as chaves.
      const { error: pendente } = await admin.rpc("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "producao",
        p_motivo: "teste de integracao da onda 2",
      });
      expect((pendente as Erro)?.code).toBe("P0001");
      expect((pendente as Erro)?.message).toBe("requisitos_pendentes");
      expect((pendente as Erro)?.hint).toContain("versao_publicada");
      expect((pendente as Erro)?.hint).toContain("rodada_cfm");

      // O que o banco confere e os requisitos da PROPRIA N (nunca geral).
      await publicar(clinicaN, "todos");
      await rpcOk("definir_numero_da_ia", {
        p_clinic_id: clinicaN,
        p_whatsapp_account_id: numeroN,
        p_ativo: true,
      });
      await admin
        .from("whatsapp_account")
        .update({ connection_status: "conectado" })
        .eq("id", numeroN)
        .throwOnError();
      await rpcOk("definir_contato_liberado_da_ia", {
        p_clinic_id: clinicaN,
        p_telefone_e164: EQUIPE_N,
        p_rotulo: "Equipe sintética",
        p_ativo: true,
        p_confirmou_aviso_da_openai: true,
      });
      const registrados: Record<string, string> = {};
      for (const chave of [
        "rodada_cfm",
        "contrato_openai",
        "aviso_assistente_virtual",
        "termo_da_clinica",
        "transcricao_com_nossa_chave",
      ]) {
        registrados[chave] = await rpcOk<string>(
          "registrar_requisito_da_producao",
          {
            p_chave: chave,
            p_evidencia: "Evidência sintética do teste de integração",
            p_clinic_id: clinicaN,
          },
        );
      }
      const checklist = await rpcOk<{ chave: string; ok: boolean }[]>(
        "requisitos_da_producao",
        { p_clinic_id: clinicaN },
      );
      expect(checklist.filter((item) => !item.ok)).toEqual([]);

      await rpcOk("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "producao",
        p_motivo: "teste de integracao da onda 2",
      });
      expect(await estadoDa(clinicaN)).toEqual({
        estado: "producao",
        liberacao: {
          modo: "numero_inteiro",
          liberada: true,
          pausada_pela_clinica: false,
        },
      });
      expect(await rpcOk<string[]>("ia_clinicas_da_fase_controlada")).toContain(
        clinicaN,
      );

      // Em producao: o lead fora da lista e o telefone da equipe entram.
      const lead = await ingerir(clinicaN, numeroN, LEAD_N);
      expect(lead.ia_atendendo).toBe(true);
      const equipe = await ingerir(clinicaN, numeroN, EQUIPE_N);
      expect(equipe.ia_atendendo).toBe(true);

      // Revisao da onda 2: em producao, a liberacao so muda pelo painel
      // (definir_agente_da_clinica). Pela liberacao, nem o servidor grava
      // outro modo nem desliga: P0001 clinica_em_producao, nada muda.
      for (const args of [
        { p_liberada: true, p_modo: "simulador" },
        { p_liberada: true, p_modo: "contatos" },
        { p_liberada: false },
      ]) {
        const { error: recusa } = await admin.rpc("definir_liberacao_da_ia", {
          p_clinic_id: clinicaN,
          p_motivo: "teste de integracao da onda 2",
          ...args,
        });
        expect((recusa as Erro)?.code, JSON.stringify(args)).toBe("P0001");
        expect((recusa as Erro)?.message).toBe("clinica_em_producao");
      }
      expect((await estadoDa(clinicaN)).liberacao).toMatchObject({
        modo: "numero_inteiro",
        liberada: true,
      });

      // De producao para teste: a do lead volta para a equipe; a da equipe fica.
      await rpcOk("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "teste",
        p_motivo: "teste de integracao da onda 2",
      });
      expect((await estadoDa(clinicaN)).liberacao?.modo).toBe("contatos");
      expect(await statusDa(lead.conversation_id!)).toBe("aguardando_humano");
      expect(await statusDa(equipe.conversation_id!)).toBe("ia_atendendo");

      // De volta a producao; revogar o termo da N devolve a N para teste.
      await rpcOk("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "producao",
        p_motivo: "teste de integracao da onda 2",
      });
      expect(
        await rpcOk<{ clinicas_de_volta_ao_teste: number }>(
          "revogar_requisito_da_producao",
          {
            p_id: registrados.termo_da_clinica,
            p_motivo: "Revogação do teste de integração",
          },
        ),
      ).toEqual({ clinicas_de_volta_ao_teste: 1 });
      expect((await estadoDa(clinicaN)).estado).toBe("teste");
    } finally {
      await admin.rpc("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "desligado",
        p_motivo: "Limpeza do teste de integracao",
      });
      await admin
        .from("clinic")
        .update({ e_de_teste: true })
        .eq("id", clinicaN)
        .throwOnError();
    }
  });
});
