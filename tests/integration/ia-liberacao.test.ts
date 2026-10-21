import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { lerClinicasHabilitadasDaIa } from "@/lib/ia/liberacao";
import {
  abaDaIaVisivel,
  fetchLiberacaoDaIa,
  fetchNumeroDaClinica,
} from "@/lib/queries/ia-liberacao";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, stackCredentials } from "../rls/stack";

// Agente de IA, E0: travas de liberacao (migration 20261006100000) contra o
// banco REAL, com o cliente de servico (quem a RLS nao barra):
// - a lista das clinicas com o agente habilitado (onda 1: dado em
//   ia_clinica_habilitada, estado 'teste', sem clinica suspensa) e a MESMA
//   que o codigo le (lerClinicasHabilitadasDaIa), e clinica e_de_teste nunca
//   esta nela (so leitura; a lista fixa do codigo saiu);
// - T3a: clinica fora da lista e sem e_de_teste nao ganha liberacao NEM pela
//   service role (42501), pela RPC ou pelo insert direto;
// - tabela verdade de ia_pode_atender e ia_pode_simular numa clinica
//   e_de_teste (fora da lista: nao depende do interruptor, mas so atende em
//   numero de provedor 'fake'): sem linha, modo simulador, sem numero, sem
//   telefone, outro numero, numero uazapi, outro telefone, numero de outra
//   clinica, numero removido, pausa, teto das ultimas 24 horas (janela
//   movel, sem o fuso da clinica) e a chave canonica do telefone;
// - desligar (telefone, numero, clinica) devolve para a equipe so as
//   conversas que perderam a liberacao, com awaiting_reply, e nada e enviado;
// - varios numeros (decisao do dono de 19/10/2026, migration
//   20261019110000; antes, de 06/10 ate ela, um numero por vez): ligar um
//   numero NAO desliga os outros da clinica, com uma linha de trilha por
//   chamada; desligar um nao mexe nos outros e devolve so as conversas
//   dele (bloco de desligar); com erro, nada muda; a outra clinica nunca e
//   tocada;
// - o gatilho de status barra so SESSAO: a service role (o servidor, as
//   fixtures e o seed) poe a conversa em 'ia_atendendo' mesmo sem liberacao,
//   porque o servidor e guardado por ia_pode_atender ao enfileirar, antes do
//   modelo e antes do envio (E3). A sessao barrada (42501) esta em
//   tests/rls/ia-liberacao.test.ts;
// - erros de entrada (22004, 22023, 23503, P0002), audit_log, 3.1
//   (versao publicada imutavel), llm_preco e os CHECKs de ai_decision_log;
// - a aba Agente de IA (migration 20261006120000): a leitura que a tela faz
//   (lib/queries/ia-liberacao) contra o banco real, numa clinica e_de_teste
//   sem linha e depois liberada; ia_interruptor_ligado igual a linha do
//   interruptor; e a aba so existe nas duas clinicas da lista (clinica de
//   teste nunca ganha a aba, mesmo com o banco aceitando a escrita dela).
//   O guarda novo das RPCs nao muda nada para a service role (todas as
//   chamadas daqui seguem passando); quem a sessao pode ou nao pode chamar
//   esta em tests/rls/ia-liberacao.test.ts.
// - E3 (migration 20261013100000): ligar o WhatsApp (modo contatos, numero,
//   telefone) passou a ser so da equipe Conduzza; desde 19/10/2026 (decisao
//   do dono, migration 20261019100000) o telefone volta a ser ligado tambem
//   pelo administrador da clinica, e o forcar continua so da equipe
//   Conduzza. A service role continua ligando (ela e o servidor e o SQL
//   editor), entao as chamadas daqui nao mudam; o que o administrador pode
//   ou nao ao ligar esta em tests/rls/ia-liberacao.test.ts e
//   tests/rls/ia-whatsapp.test.ts. Desligar
//   agora grava o evento "O assistente foi desligado..." em cada conversa
//   devolvida (nenhuma mensagem ao contato), a leitura da aba ganha a
//   situacao (situacao_da_ia_na_clinica) e ai_decision_log ganha desfecho e
//   motivo_da_falha com CHECK.
// Mesmos cenarios do ensaio (scratchpad/e0/asserts.sql). Quem le o que esta
// em tests/rls/ia-liberacao.test.ts.
//
// CUIDADO, o banco e o da producao. Clinicas e_de_teste (o motor de producao
// ignora), apagadas no afterAll; a unica clinica sem e_de_teste nasce e
// morre dentro do teste de T3a. O interruptor global NUNCA e tocado
// (definir_interruptor_da_ia nao aparece aqui): a clinica de teste nao
// depende dele. Nada grava com a id da salud-care.

const SALUD_CARE = "682edca6-cc7d-4bb7-8db6-4c68e2510549";

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const clinicas: string[] = [];

// Celulares sinteticos: o da equipe entra SEM o nono digito (a chave
// canonica ganha o 9).
const EQUIPE_SEM_NONO = `+558494${digitos}`;
const EQUIPE = `+5584994${digitos}`;
const OUTRA_PESSOA = `+5584995${digitos}`;
const SEGUNDA_EQUIPE = `+5584996${digitos}`;

let clinicaT = "";
let clinicaU = "";
let numero1 = "";
let numero2 = "";
// O terceiro numero fake da T: so o bloco de desligar o liga (varios
// numeros, 19/10/2026).
let numero3 = "";
let numeroUazapi = "";
let numeroDaU = "";

async function novaClinica(
  nome: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `IA liberacao ${nome} ${sufixo}`,
      slug: `ia-liberacao-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  clinicas.push(id);
  return id;
}

async function contato(clinicId: string, telefone: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Contato" })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function rpc(
  nome: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; codigo: string | null }> {
  const { data, error } = await admin.rpc(nome, args);
  return { data, codigo: error ? (error.code ?? "sem_codigo") : null };
}

async function rpcOk(nome: string, args: Record<string, unknown>) {
  const { data, codigo } = await rpc(nome, args);
  expect(codigo).toBeNull();
  return data;
}

const liberar = (modo: "simulador" | "contatos" | null, liberada = true) =>
  rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaT,
    p_liberada: liberada,
    p_modo: modo,
    p_motivo: "teste de integracao",
  });

const numero = (whatsappAccountId: string, ativo: boolean) =>
  rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaT,
    p_whatsapp_account_id: whatsappAccountId,
    p_ativo: ativo,
  });

// Sempre com a confirmacao do aviso da OpenAI: telefone novo so entra com
// ela (migration 20261019120000), e ao desligar ou religar ela nao muda nada.
const telefone = (e164: string, ativo: boolean, rotulo: string | null = null) =>
  rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaT,
    p_telefone_e164: e164,
    p_rotulo: rotulo,
    p_ativo: ativo,
    p_confirmou_aviso_da_openai: true,
  });

async function podeAtender(
  whatsappAccountId: string,
  phoneKey: string,
  clinicId = clinicaT,
): Promise<boolean> {
  return (await rpcOk("ia_pode_atender", {
    p_clinic_id: clinicId,
    p_whatsapp_account_id: whatsappAccountId,
    p_phone_key: phoneKey,
  })) as boolean;
}

/** ativo de cada numero liberado da T, por id. */
async function ativos(): Promise<Record<string, boolean>> {
  const { data } = await admin
    .from("ia_numero_liberado")
    .select("whatsapp_account_id, ativo")
    .eq("clinic_id", clinicaT)
    .throwOnError();
  return Object.fromEntries(
    (data as { whatsapp_account_id: string; ativo: boolean }[]).map((linha) => [
      linha.whatsapp_account_id,
      linha.ativo,
    ]),
  );
}

async function podeSimular(clinicId = clinicaT): Promise<boolean> {
  return (await rpcOk("ia_pode_simular", {
    p_clinic_id: clinicId,
  })) as boolean;
}

async function conversa(id: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, awaiting_reply")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as { status: string; awaiting_reply: boolean };
}

async function conversaNaIa(contactId: string, whatsappAccountId: string) {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaT,
      contact_id: contactId,
      whatsapp_account_id: whatsappAccountId,
      status: "ia_atendendo",
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

beforeAll(async () => {
  clinicaT = await novaClinica("T");
  clinicaU = await novaClinica("U");
  numero1 = (await criarNumeroDeTeste(admin, clinicaT, { nome: "Um" })).id;
  numero2 = (await criarNumeroDeTeste(admin, clinicaT, { nome: "Dois" })).id;
  numero3 = (await criarNumeroDeTeste(admin, clinicaT, { nome: "Tres" })).id;
  // So a linha no banco: sem instancia nem token, nada fala com o uazapi.
  numeroUazapi = (
    await criarNumeroDeTeste(admin, clinicaT, {
      nome: "Uazapi",
      provider: "uazapi",
      connection_status: "desconectado",
    })
  ).id;
  numeroDaU = (await criarNumeroDeTeste(admin, clinicaU, { nome: "Um" })).id;
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
});

describe("lista das clínicas habilitadas (T3a)", () => {
  it("a função do banco é a tabela (estado teste, sem suspensa) e é a mesma lista que o código lê", async () => {
    const lista = ((await rpcOk("ia_clinicas_da_fase_controlada", {})) ??
      []) as string[];
    const [habilitadas, suspensas] = await Promise.all([
      admin
        .from("ia_clinica_habilitada")
        .select("clinic_id")
        .eq("estado", "teste")
        .throwOnError(),
      admin.from("clinica_suspensa").select("clinic_id").throwOnError(),
    ]);
    const fora = new Set(
      ((suspensas.data ?? []) as { clinic_id: string }[]).map(
        (linha) => linha.clinic_id,
      ),
    );
    const daTabela = ((habilitadas.data ?? []) as { clinic_id: string }[])
      .map((linha) => linha.clinic_id)
      .filter((id) => !fora.has(id))
      .sort();
    expect([...lista].sort()).toEqual(daTabela);
    expect(await lerClinicasHabilitadasDaIa(admin)).toEqual(
      lista.map((id) => id.toLowerCase()),
    );
    // Clinica de teste das suites nunca esta na lista (o banco aceita a
    // escrita dela so para os testes).
    expect(lista).not.toContain(clinicaT);
    expect(lista).not.toContain(clinicaU);
  });

  it("clinica fora da lista e sem e_de_teste: 42501 ate para a service role", async () => {
    const { data } = await admin
      .from("clinic")
      .insert({
        name: `IA fora da lista ${sufixo}`,
        slug: `ia-fora-da-lista-${sufixo}`,
      })
      .select("id")
      .single()
      .throwOnError();
    const foraDaLista = (data as { id: string }).id;
    try {
      const pelaRpc = await rpc("definir_liberacao_da_ia", {
        p_clinic_id: foraDaLista,
        p_liberada: true,
        p_modo: "contatos",
        p_motivo: "nao pode",
      });
      expect(pelaRpc.codigo).toBe("42501");
      const { error: direto } = await admin
        .from("ia_liberacao")
        .insert({ clinic_id: foraDaLista, liberada: false });
      expect(direto?.code).toBe("42501");
      const { data: linhas } = await admin
        .from("ia_liberacao")
        .select("clinic_id")
        .eq("clinic_id", foraDaLista)
        .throwOnError();
      expect(linhas).toEqual([]);
      expect(await podeSimular(foraDaLista)).toBe(false);
    } finally {
      await admin.from("clinic").delete().eq("id", foraDaLista);
    }
  });
});

describe("tabela verdade (clinica e_de_teste)", () => {
  it("sem linha de liberacao: nada; numero antes da clinica: 23503", async () => {
    expect(await podeSimular()).toBe(false);
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    const antes = await rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaT,
      p_whatsapp_account_id: numero1,
      p_ativo: true,
    });
    expect(antes.codigo).toBe("23503");
    // com a confirmacao (migration 20261019120000), para chegar ao INSERT:
    // sem a linha de liberacao, a chave estrangeira recusa
    const telefoneAntes = await rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: EQUIPE,
      p_rotulo: null,
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
    expect(telefoneAntes.codigo).toBe("23503");
  });

  it("modo simulador: simula, mas nao atende no WhatsApp", async () => {
    expect(await liberar(null)).toBe(true);
    const { data } = await admin
      .from("ia_liberacao")
      .select("modo, liberada, teto_diario_centavos_usd")
      .eq("clinic_id", clinicaT)
      .single()
      .throwOnError();
    expect(data).toEqual({
      modo: "simulador",
      liberada: true,
      teto_diario_centavos_usd: 500,
    });
    expect(await podeSimular()).toBe(true);
    expect(await rpcOk("ia_clinica_liberada", { p_clinic_id: clinicaT })).toBe(
      true,
    );
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
  });

  it("modo contatos: so com numero E telefone liberados, pela chave canonica", async () => {
    await liberar("contatos");
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    await numero(numero1, true);
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    await telefone(EQUIPE_SEM_NONO, true, "Equipe de teste");
    const { data } = await admin
      .from("ia_contato_liberado")
      .select("phone_key, rotulo, ativo")
      .eq("clinic_id", clinicaT)
      .throwOnError();
    expect(data).toEqual([
      { phone_key: EQUIPE, rotulo: "Equipe de teste", ativo: true },
    ]);
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    // o E.164 sem o nono digito vira a mesma chave
    expect(await podeAtender(numero1, EQUIPE_SEM_NONO)).toBe(true);
    expect(await podeSimular()).toBe(true);
  });

  it("clinica e_de_teste fora da lista: numero uazapi nao atende, mesmo liberado", async () => {
    await numero(numeroUazapi, true);
    const { data } = await admin
      .from("ia_numero_liberado")
      .select("ativo")
      .eq("whatsapp_account_id", numeroUazapi)
      .single()
      .throwOnError();
    expect(data).toEqual({ ativo: true });
    expect(await podeAtender(numeroUazapi, EQUIPE)).toBe(false);
    // contraprova: o numero fake da mesma clinica continuou ligado junto
    // (varios numeros, 19/10/2026) e atende o mesmo telefone
    expect(await ativos()).toEqual({
      [numero1]: true,
      [numeroUazapi]: true,
    });
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    // o uazapi sai, e o 1 continua
    expect(await numero(numeroUazapi, false)).toBe(false);
    expect(await ativos()).toEqual({
      [numero1]: true,
      [numeroUazapi]: false,
    });
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
  });

  it("varios numeros: ligar um nao desliga os outros, uma linha de trilha por chamada; desligar um nao mexe no outro; erro nao muda nada", async () => {
    const trilha = async () => {
      const { count } = await admin
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicaT)
        .eq("entity", "ia_numero_liberado");
      return count ?? 0;
    };
    const trilhaAntes = await trilha();
    expect(await numero(numero2, true)).toBe(true);
    expect(await ativos()).toEqual({
      [numero1]: true,
      [numero2]: true,
      [numeroUazapi]: false,
    });
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    expect(await podeAtender(numero2, EQUIPE)).toBe(true);
    // so o 2 ligado: uma linha na trilha (nenhuma de "desligado junto")
    expect((await trilha()) - trilhaAntes).toBe(1);
    // erro adiante (numero de outra clinica, 23503): os dois continuam
    const daOutra = await rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaT,
      p_whatsapp_account_id: numeroDaU,
      p_ativo: true,
    });
    expect(daOutra.codigo).toBe("23503");
    expect(await ativos()).toEqual({
      [numero1]: true,
      [numero2]: true,
      [numeroUazapi]: false,
    });
    // desligar o 1 nao mexe no 2, e o 2 continua atendendo
    expect(await numero(numero1, false)).toBe(false);
    expect(await ativos()).toEqual({
      [numero1]: false,
      [numero2]: true,
      [numeroUazapi]: false,
    });
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    expect(await podeAtender(numero2, EQUIPE)).toBe(true);
    // o 1 de volta, e o 2 sai (os dois sozinhos, cada um na sua chamada)
    expect(await numero(numero1, true)).toBe(true);
    expect(await numero(numero2, false)).toBe(false);
    expect(await ativos()).toEqual({
      [numero1]: true,
      [numero2]: false,
      [numeroUazapi]: false,
    });
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    expect((await trilha()) - trilhaAntes).toBe(4);
  });

  it("outro numero, outro telefone, numero de outra clinica e nulos: falso", async () => {
    expect(await podeAtender(numero2, EQUIPE)).toBe(false);
    expect(await podeAtender(numero1, OUTRA_PESSOA)).toBe(false);
    expect(await podeAtender(numeroDaU, EQUIPE)).toBe(false);
    expect(await podeAtender(numeroDaU, EQUIPE, clinicaU)).toBe(false);
    const daOutra = await rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaT,
      p_whatsapp_account_id: numeroDaU,
      p_ativo: true,
    });
    expect(daOutra.codigo).toBe("23503");
    expect(
      await rpcOk("ia_pode_atender", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: null,
        p_phone_key: EQUIPE,
      }),
    ).toBe(false);
    expect(
      await rpcOk("ia_pode_atender", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numero1,
        p_phone_key: null,
      }),
    ).toBe(false);
  });

  it("pausa da clinica derruba atender e simular", async () => {
    await admin
      .from("ia_liberacao")
      .update({ pausada_pela_clinica: true })
      .eq("clinic_id", clinicaT)
      .throwOnError();
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    expect(await podeSimular()).toBe(false);
    await admin
      .from("ia_liberacao")
      .update({ pausada_pela_clinica: false })
      .eq("clinic_id", clinicaT)
      .throwOnError();
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
  });

  it("teto das ultimas 24 horas: janela movel, e no teto para", async () => {
    // US$ 5,00 = 500 centavos = 5.000.000 microdolares. 25 h atras fica
    // fora; 23 h atras entra (no dia civil do fuso quase sempre ficaria
    // fora). Uma hora de folga cobre a diferenca de relogio com o banco.
    const HORA = 3_600_000;
    await admin
      .from("ia_uso")
      .insert([
        {
          clinic_id: clinicaT,
          origem: "simulador",
          papel: "agente",
          modelo: "claude-opus-5",
          custo_microdolar: 9_000_000,
          created_at: new Date(Date.now() - 25 * HORA).toISOString(),
        },
        {
          clinic_id: clinicaT,
          origem: "whatsapp",
          papel: "agente",
          modelo: "claude-opus-5",
          custo_microdolar: 4_999_999,
          created_at: new Date(Date.now() - 23 * HORA).toISOString(),
        },
      ])
      .throwOnError();
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    await admin
      .from("ia_uso")
      .insert({
        clinic_id: clinicaT,
        origem: "whatsapp",
        papel: "verificador",
        modelo: "claude-haiku-4-5",
        custo_microdolar: 1,
      })
      .throwOnError();
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    expect(await podeSimular()).toBe(false);
    await admin
      .from("ia_uso")
      .delete()
      .eq("clinic_id", clinicaT)
      .throwOnError();
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
  });

  it("numero removido deixa de atender, mesmo liberado", async () => {
    // o 2 ligado junto com o 1 (varios numeros); o 1 nunca sai
    await numero(numero2, true);
    expect(await podeAtender(numero2, EQUIPE)).toBe(true);
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    await admin
      .from("whatsapp_account")
      .update({ removido_em: new Date().toISOString() })
      .eq("id", numero2)
      .throwOnError();
    expect(await podeAtender(numero2, EQUIPE)).toBe(false);
    // religar um numero removido: 23514
    const religar = await rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaT,
      p_whatsapp_account_id: numero2,
      p_ativo: true,
    });
    expect(religar.codigo).toBe("23514");
    // desligar passa
    expect(await numero(numero2, false)).toBe(false);
    expect(await numero(numero1, true)).toBe(true);
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
  });

  it("entradas invalidas: 22004, 22023 e P0002, sem gravar", async () => {
    const casos: [string, Record<string, unknown>, string][] = [
      [
        "definir_liberacao_da_ia",
        { p_clinic_id: clinicaT, p_liberada: null },
        "22004",
      ],
      // Um modo que nao existe (numero_inteiro passou a valer na onda 2,
      // M3: na clinica e_de_teste ele grava, entao nao e entrada invalida).
      [
        "definir_liberacao_da_ia",
        { p_clinic_id: clinicaT, p_liberada: true, p_modo: "todos_os_contatos" },
        "22023",
      ],
      [
        "definir_liberacao_da_ia",
        { p_clinic_id: clinicaT, p_liberada: true, p_motivo: "x".repeat(501) },
        "22023",
      ],
      [
        "definir_liberacao_da_ia",
        { p_clinic_id: crypto.randomUUID(), p_liberada: false },
        "P0002",
      ],
      [
        "definir_contato_liberado_da_ia",
        {
          p_clinic_id: clinicaT,
          p_telefone_e164: "84999990000",
          p_rotulo: null,
          p_ativo: true,
        },
        "22023",
      ],
      [
        "definir_contato_liberado_da_ia",
        {
          p_clinic_id: clinicaT,
          p_telefone_e164: SEGUNDA_EQUIPE,
          p_rotulo: "x".repeat(81),
          p_ativo: true,
        },
        "22023",
      ],
      [
        "definir_contato_liberado_da_ia",
        {
          p_clinic_id: clinicaT,
          p_telefone_e164: null,
          p_rotulo: null,
          p_ativo: true,
        },
        "22004",
      ],
      [
        "definir_numero_da_ia",
        {
          p_clinic_id: clinicaT,
          p_whatsapp_account_id: numero1,
          p_ativo: null,
        },
        "22004",
      ],
    ];
    for (const [nome, args, esperado] of casos) {
      const { codigo } = await rpc(nome, args);
      expect(codigo, nome).toBe(esperado);
    }
    const { data } = await admin
      .from("ia_liberacao")
      .select("modo, liberada")
      .eq("clinic_id", clinicaT)
      .single()
      .throwOnError();
    expect(data).toEqual({ modo: "contatos", liberada: true });
  });
});

describe("gatilho de status e desligamento", () => {
  let equipe = "";
  let segunda = "";
  let outra = "";
  let conversaDaEquipe = "";
  let conversaDaSegunda = "";

  it("a service role entra em 'ia_atendendo' sem liberacao (o gatilho barra so sessao)", async () => {
    equipe = await contato(clinicaT, EQUIPE);
    segunda = await contato(clinicaT, SEGUNDA_EQUIPE);
    outra = await contato(clinicaT, OUTRA_PESSOA);
    // OUTRA_PESSOA nao tem telefone liberado: para a sessao seria 42501
    expect(await podeAtender(numero1, OUTRA_PESSOA)).toBe(false);
    const { data: criada, error: noInsert } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicaT,
        contact_id: outra,
        whatsapp_account_id: numero1,
        status: "ia_atendendo",
      })
      .select("id")
      .single();
    expect(noInsert).toBeNull();
    const daOutra = (criada as { id: string }).id;
    expect((await conversa(daOutra)).status).toBe("ia_atendendo");
    // UPDATE vindo de outro status tambem passa
    await admin
      .from("conversation")
      .update({ status: "aguardando_humano" })
      .eq("id", daOutra)
      .throwOnError();
    const { error: naUpdate } = await admin
      .from("conversation")
      .update({ status: "ia_atendendo" })
      .eq("id", daOutra);
    expect(naUpdate).toBeNull();
    expect((await conversa(daOutra)).status).toBe("ia_atendendo");
    // e o desligamento a devolve para a equipe (o telefone nunca foi liberado)
    await telefone(OUTRA_PESSOA, false);
    expect((await conversa(daOutra)).status).toBe("aguardando_humano");
  });

  it("desligar um telefone devolve so a conversa dele, com espera, com o evento e sem envio", async () => {
    await telefone(SEGUNDA_EQUIPE, true, "Segunda pessoa da equipe");
    conversaDaEquipe = await conversaNaIa(equipe, numero1);
    conversaDaSegunda = await conversaNaIa(segunda, numero1);
    await admin
      .from("message")
      .insert({
        clinic_id: clinicaT,
        conversation_id: conversaDaSegunda,
        direction: "entrada",
        author: "paciente",
        body: "Mensagem sintética",
      })
      .throwOnError();
    const { count: antes } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaT)
      .neq("content_type", "evento");

    await telefone(SEGUNDA_EQUIPE, false);

    expect(await conversa(conversaDaSegunda)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await conversa(conversaDaEquipe)).status).toBe("ia_atendendo");
    // o rotulo continua; nenhuma mensagem nova (desligar nao envia nada)
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("rotulo, ativo")
      .eq("clinic_id", clinicaT)
      .eq("phone_key", SEGUNDA_EQUIPE)
      .single()
      .throwOnError();
    expect(linha).toEqual({ rotulo: "Segunda pessoa da equipe", ativo: false });
    // nada a mais alem dos eventos: desligar nao envia nada ao contato
    const { count: depois } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaT)
      .neq("content_type", "evento");
    expect(depois).toBe(antes);
    // o evento so na conversa devolvida (E3): sistema, sem envio
    const { data: eventos } = await admin
      .from("message")
      .select(
        "conversation_id, direction, author, body, wa_message_id, delivery_status",
      )
      .eq("clinic_id", clinicaT)
      .eq("content_type", "evento")
      .in("conversation_id", [conversaDaSegunda, conversaDaEquipe])
      .throwOnError();
    expect(eventos).toEqual([
      {
        conversation_id: conversaDaSegunda,
        direction: "saida",
        author: "sistema",
        body: "O assistente foi desligado. A conversa voltou para a equipe.",
        wa_message_id: null,
        delivery_status: null,
      },
    ]);
  });

  it("varios numeros: desligar um devolve so as conversas dele; a do outro numero ligado continua na IA", async () => {
    expect(await numero(numero3, true)).toBe(true);
    // o mesmo telefone da equipe, uma conversa por numero
    const conversaNoTres = await conversaNaIa(equipe, numero3);
    expect((await conversa(conversaDaEquipe)).status).toBe("ia_atendendo");
    await numero(numero3, false);
    expect(await conversa(conversaNoTres)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: false,
    });
    expect((await conversa(conversaDaEquipe)).status).toBe("ia_atendendo");
    expect((await ativos())[numero1]).toBe(true);
    expect(await podeAtender(numero1, EQUIPE)).toBe(true);
    expect(await podeAtender(numero3, EQUIPE)).toBe(false);
    // o evento so na conversa do numero desligado
    const { data: eventos } = await admin
      .from("message")
      .select("conversation_id, body")
      .eq("clinic_id", clinicaT)
      .eq("content_type", "evento")
      .in("conversation_id", [conversaNoTres, conversaDaEquipe])
      .throwOnError();
    expect(eventos).toEqual([
      {
        conversation_id: conversaNoTres,
        body: "O assistente foi desligado. A conversa voltou para a equipe.",
      },
    ]);
  });

  it("desligar o numero e depois a clinica devolve o resto", async () => {
    await numero(numero1, false);
    expect(await conversa(conversaDaEquipe)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: false,
    });
    await numero(numero1, true);
    await admin
      .from("conversation")
      .update({ status: "ia_atendendo" })
      .eq("id", conversaDaEquipe)
      .throwOnError();
    expect(await liberar(null, false)).toBe(false);
    expect((await conversa(conversaDaEquipe)).status).toBe("aguardando_humano");
    expect(await podeAtender(numero1, EQUIPE)).toBe(false);
    expect(await podeSimular()).toBe(false);
    expect(await rpcOk("ia_clinica_liberada", { p_clinic_id: clinicaT })).toBe(
      false,
    );
  });

  it("cada mudanca ficou na trilha (audit_log), sem telefone", async () => {
    const { data } = await admin
      .from("audit_log")
      .select("action, entity, entity_id, user_id")
      .eq("clinic_id", clinicaT)
      .in("entity", [
        "ia_liberacao",
        "ia_numero_liberado",
        "ia_contato_liberado",
      ])
      .throwOnError();
    const linhas = data as {
      action: string;
      entity: string;
      entity_id: string | null;
      user_id: string | null;
    }[];
    expect(linhas.length).toBeGreaterThanOrEqual(10);
    // editou em toda mudanca; e, desde a migration 20261019120000, a
    // confirmacao do aviso da OpenAI de cada ligar de telefone com ela
    expect(
      linhas.every(
        (linha) =>
          linha.action === "editou" ||
          (linha.action === "confirmou_aviso_da_openai" &&
            linha.entity === "ia_contato_liberado"),
      ),
    ).toBe(true);
    expect(
      linhas.some((linha) => linha.action === "confirmou_aviso_da_openai"),
    ).toBe(true);
    expect(linhas.every((linha) => linha.user_id === null)).toBe(true);
    expect(
      linhas
        .filter((linha) => linha.entity === "ia_liberacao")
        .every((linha) => linha.entity_id === clinicaT),
    ).toBe(true);
    expect(
      linhas.some(
        (linha) =>
          linha.entity === "ia_numero_liberado" && linha.entity_id === numero1,
      ),
    ).toBe(true);
  });
});

describe("interruptor global (so leitura)", () => {
  it("existe uma linha so; o teste nunca a muda", async () => {
    const { data } = await admin
      .from("ia_interruptor")
      .select("id")
      .throwOnError();
    expect(data).toEqual([{ id: true }]);
  });

  it("ia_interruptor_ligado devolve o booleano da linha", async () => {
    const { data } = await admin
      .from("ia_interruptor")
      .select("ligado")
      .single()
      .throwOnError();
    expect(await rpcOk("ia_interruptor_ligado", {})).toBe(
      (data as { ligado: boolean }).ligado,
    );
  });
});

describe("aba Agente de IA: a leitura da tela", () => {
  // Celular sintetico da equipe da U, sem o nono digito (a tela mostra a
  // chave canonica, com o 9).
  const EQUIPE_DA_U_SEM_NONO = `+558498${digitos}`;
  const EQUIPE_DA_U = `+5584998${digitos}`;

  it("a aba so existe nas clinicas que o banco habilita; clinica de teste nunca", async () => {
    // abaDaIaVisivel le a lista pelo createAdminClient de verdade: as
    // credenciais da pilha dos testes vao para o ambiente so neste caso.
    const { url, serviceRoleKey } = stackCredentials();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
    try {
      const lista = await lerClinicasHabilitadasDaIa(admin);
      for (const id of lista) {
        expect(await abaDaIaVisivel(id)).toBe(true);
      }
      expect(await abaDaIaVisivel(clinicaT)).toBe(false);
      expect(await abaDaIaVisivel(clinicaU)).toBe(false);
      expect(await abaDaIaVisivel(SALUD_CARE)).toBe(lista.includes(SALUD_CARE));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("clinica sem linha: liberacao nula e listas vazias, com o interruptor", async () => {
    const { data } = await admin
      .from("ia_interruptor")
      .select("ligado")
      .single()
      .throwOnError();
    expect(await fetchLiberacaoDaIa(admin, clinicaU)).toEqual({
      liberacao: null,
      numerosLigados: [],
      telefones: [],
      interruptorLigado: (data as { ligado: boolean }).ligado,
      // E3: a situacao da aba (situacao_da_ia_na_clinica, com o booleano
      // motor_parado desde a revisao: o motor e global, entao so o tipo)
      situacao: {
        tetoAtingido: false,
        versaoPublicada: null,
        telefonesInvalidos: [],
        telefonesSemAutorizacao: [],
        conversasAbertas: [],
        horarioPublicado: null,
        motorParado: expect.any(Boolean),
        // Onda 2 (M2): o leitor sempre devolve a lista (vazia sem a chave
        // ou sem telefone fora do publico).
        telefonesForaDoPublico: [],
      },
    });
  });

  it("clinica liberada: o modo, o teto, o numero e o telefone pela chave canonica", async () => {
    for (const [nome, args] of [
      [
        "definir_liberacao_da_ia",
        {
          p_clinic_id: clinicaU,
          p_liberada: true,
          p_modo: "simulador",
          p_motivo: "teste de integracao da aba",
        },
      ],
      [
        "definir_numero_da_ia",
        {
          p_clinic_id: clinicaU,
          p_whatsapp_account_id: numeroDaU,
          p_ativo: true,
        },
      ],
      [
        "definir_contato_liberado_da_ia",
        {
          p_clinic_id: clinicaU,
          p_telefone_e164: EQUIPE_DA_U_SEM_NONO,
          p_rotulo: "Equipe da U",
          p_ativo: true,
          p_confirmou_aviso_da_openai: true,
        },
      ],
    ] as const) {
      expect(await rpcOk(nome, args)).toBe(true);
    }
    const dados = await fetchLiberacaoDaIa(admin, clinicaU);
    expect(dados.liberacao).toEqual({
      liberada: true,
      modo: "simulador",
      pausadaPelaClinica: false,
      tetoDiarioCentavosUsd: 500,
    });
    expect(dados.numerosLigados).toEqual([numeroDaU]);
    expect(dados.telefones).toEqual([
      {
        id: expect.any(String),
        telefone: EQUIPE_DA_U,
        rotulo: "Equipe da U",
        ativo: true,
      },
    ]);
    // a leitura e por clinica: nada da T aparece na U
    expect(dados.numerosLigados).not.toContain(numero1);
  });

  it("varios numeros ligados: a lista dos ligados, na ordem de criacao da linha; o desligado sai da lista", async () => {
    const segundoDaU = (
      await criarNumeroDeTeste(admin, clinicaU, { nome: "Dois da U" })
    ).id;
    expect(
      await rpcOk("definir_numero_da_ia", {
        p_clinic_id: clinicaU,
        p_whatsapp_account_id: segundoDaU,
        p_ativo: true,
      }),
    ).toBe(true);
    expect((await fetchLiberacaoDaIa(admin, clinicaU)).numerosLigados).toEqual([
      numeroDaU,
      segundoDaU,
    ]);
    expect(
      await rpcOk("definir_numero_da_ia", {
        p_clinic_id: clinicaU,
        p_whatsapp_account_id: numeroDaU,
        p_ativo: false,
      }),
    ).toBe(false);
    expect((await fetchLiberacaoDaIa(admin, clinicaU)).numerosLigados).toEqual([
      segundoDaU,
    ]);
    // de volta ao estado do teste anterior (so o primeiro da U ligado)
    expect(
      await rpcOk("definir_numero_da_ia", {
        p_clinic_id: clinicaU,
        p_whatsapp_account_id: numeroDaU,
        p_ativo: true,
      }),
    ).toBe(true);
    expect(
      await rpcOk("definir_numero_da_ia", {
        p_clinic_id: clinicaU,
        p_whatsapp_account_id: segundoDaU,
        p_ativo: false,
      }),
    ).toBe(false);
    expect((await fetchLiberacaoDaIa(admin, clinicaU)).numerosLigados).toEqual([
      numeroDaU,
    ]);
  });

  it("o numero da acao de ligar: so numero ativo da propria clinica", async () => {
    expect(await fetchNumeroDaClinica(admin, clinicaU, numeroDaU)).toEqual({
      id: numeroDaU,
      connectionStatus: expect.any(String),
    });
    // numero da T pedido como da U: nulo
    expect(await fetchNumeroDaClinica(admin, clinicaU, numero1)).toBeNull();
  });
});

describe("3.1, precos e ai_decision_log", () => {
  it("versao publicada: carimbada e imutavel ate para o sistema", async () => {
    const { data } = await admin
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaU, version: 1, status: "publicada" })
      .select("id, published_at, published_by")
      .single()
      .throwOnError();
    const versao = data as {
      id: string;
      published_at: string | null;
      published_by: string | null;
    };
    expect(versao.published_at).not.toBeNull();
    expect(versao.published_by).toBeNull();
    const { error } = await admin
      .from("ai_agent_config")
      .update({ agent_name: "Outro nome" })
      .eq("id", versao.id);
    expect(error?.code).toBe("P0001");
    const { error: despublicar } = await admin
      .from("ai_agent_config")
      .update({ status: "rascunho" })
      .eq("id", versao.id);
    expect(despublicar?.code).toBe("P0001");
    // contraprova: rascunho muda; a versao repetida da 23505
    const { data: rascunho } = await admin
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaU, version: 2 })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("ai_agent_config")
      .update({ agent_name: "Rascunho novo" })
      .eq("id", (rascunho as { id: string }).id)
      .throwOnError();
    const { error: repetida } = await admin
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaU, version: 2 });
    expect(repetida?.code).toBe("23505");
  });

  it("knowledge_item: origem fechada e texto obrigatorio", async () => {
    const { error: origem } = await admin.from("knowledge_item").insert({
      clinic_id: clinicaU,
      question: "Tem estacionamento?",
      answer: "Sim.",
      source: "inventada",
    });
    expect(origem?.code).toBe("23514");
    const { error: vazia } = await admin.from("knowledge_item").insert({
      clinic_id: clinicaU,
      question: "  ",
      answer: "Sim.",
    });
    expect(vazia?.code).toBe("23514");
    await admin
      .from("knowledge_item")
      .insert({
        clinic_id: clinicaU,
        question: "Tem estacionamento?",
        answer: "Sim.",
        source: "correcao_humana",
      })
      .throwOnError();
  });

  it("llm_preco: os tres modelos com a fonte, em microdolar por milhao", async () => {
    const { data } = await admin
      .from("llm_preco")
      .select(
        "modelo, entrada_microdolar_por_milhao, saida_microdolar_por_milhao, cache_leitura_microdolar_por_milhao, cache_escrita_microdolar_por_milhao, fonte",
      )
      .in("modelo", ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"])
      .order("modelo")
      .throwOnError();
    const linhas = data as {
      modelo: string;
      entrada_microdolar_por_milhao: number;
      saida_microdolar_por_milhao: number;
      cache_leitura_microdolar_por_milhao: number;
      cache_escrita_microdolar_por_milhao: number;
      fonte: string;
    }[];
    expect(
      linhas.map(({ fonte, ...resto }) => {
        expect(fonte.length).toBeGreaterThan(0);
        return resto;
      }),
    ).toEqual([
      {
        modelo: "claude-haiku-4-5",
        entrada_microdolar_por_milhao: 1_000_000,
        saida_microdolar_por_milhao: 5_000_000,
        cache_leitura_microdolar_por_milhao: 100_000,
        cache_escrita_microdolar_por_milhao: 1_250_000,
      },
      {
        modelo: "claude-opus-5",
        entrada_microdolar_por_milhao: 5_000_000,
        saida_microdolar_por_milhao: 25_000_000,
        cache_leitura_microdolar_por_milhao: 500_000,
        cache_escrita_microdolar_por_milhao: 6_250_000,
      },
      {
        modelo: "claude-sonnet-5",
        entrada_microdolar_por_milhao: 2_000_000,
        saida_microdolar_por_milhao: 10_000_000,
        cache_leitura_microdolar_por_milhao: 200_000,
        cache_escrita_microdolar_por_milhao: 2_500_000,
      },
    ]);
  });

  it("ai_decision_log: categoria, motivo, camada e gatilho so da lista; aprovado exige hash", async () => {
    const outra = await contato(clinicaU, `+5584997${digitos}`);
    const { data: criada } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicaU,
        contact_id: outra,
        whatsapp_account_id: numeroDaU,
      })
      .select("id")
      .single()
      .throwOnError();
    const conversationId = (criada as { id: string }).id;
    const base = { clinic_id: clinicaU, conversation_id: conversationId };
    const recusadas: Record<string, unknown>[] = [
      { compliance_rule: "regra_inventada" },
      { escalation_reason: "paciente descreveu sintoma" },
      { camada: "humano" },
      { gatilho_entrada: "qualquer" },
      { texto_sha256: "abc" },
      { tokens_entrada: -1 },
      // E3: desfecho e motivo da falha so da lista, e coerentes
      { desfecho: "inventado" },
      { motivo_da_falha: "inventado" },
      { desfecho: "respondeu" },
      { desfecho: "bloqueou" },
      { aprovado: true },
      {
        aprovado: true,
        texto_sha256: "a".repeat(64),
        compliance_blocked: true,
      },
    ];
    for (const extra of recusadas) {
      const { error } = await admin
        .from("ai_decision_log")
        .insert({ ...base, ...extra });
      expect(error?.code, JSON.stringify(Object.keys(extra))).toBe("23514");
    }
    await admin
      .from("ai_decision_log")
      .insert([
        {
          ...base,
          compliance_blocked: true,
          compliance_rule: "triagem",
          escalation_reason: "sintoma",
          camada: "regra",
          gatilho_entrada: "sintoma",
        },
        {
          // Insert em lote: o PostgREST grava nulo na coluna que falta numa
          // das linhas (nao o default), entao a linha diz compliance_blocked.
          ...base,
          compliance_blocked: false,
          aprovado: true,
          texto_sha256: "0".repeat(64),
          agente_modelo: "claude-opus-5",
          verificador_modelo: "claude-haiku-4-5",
          job_id: crypto.randomUUID(),
          tokens_entrada: 10,
          tokens_saida: 5,
          tokens_cache: 0,
        },
      ])
      .throwOnError();
  });
});
