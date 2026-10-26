import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { descricoesDoHistorico } from "@/components/painel-geral/painel-geral";
import { lerHistoricoDoBanco } from "@/lib/queries/painel-geral";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Segunda leva do Painel geral (CS; migration 20261026110000_painel_cs_2.sql),
// contra o banco REAL. Pedido do dono de 26/10/2026 ("Esse gasto de IA ta
// certo? Era bom fazer por clinica..."), com o que ele escolheu: o gasto por
// clinica com a precisao real, os sinais de alerta e a saude, a
// implantacao, a tendencia, as notas internas e o historico da conta. O que
// esta em jogo:
// - o gasto em MICRODOLARES e as CHAMADAS (as linhas reais de ia_uso, sem
//   as reservas): a A gasta 1000 microdolares em 2 chamadas (US$ 0,001, que
//   em centavos e 0), 400 sem o simulador;
// - os sinais e a saude: a A sem sinal (saudavel); a B com o WhatsApp
//   desconectado (em risco), um pedido de entrada de 3 dias, uma mensagem
//   de saida que falhou e o gasto em 80% do teto; a C saudavel;
// - a implantacao: a A com os 6 passos (WhatsApp conectado, 2 pessoas
//   ativas, procedimento, profissional, a regua de confirmacao ligada e a
//   Meta ligada pela conta de anuncios com o token de leitura, mais o
//   rastreio do Google); a B e a C pela metade;
// - a tendencia: a C com 3 leads contra 2 (subindo, 50%) e 1 conversa
//   contra 0 (sem base);
// - as notas, pela service role (autor nulo): o texto sem as pontas, as
//   recusas de texto e de clinica, a ordem, o limite e tem_mais, excluir, e
//   a ultima nota na lista;
// - o historico da B, pelas funcoes de sempre (suspender, reativar e o
//   teto, pela service role: sem quem), na ordem, com os detalhes; a
//   leitura de ficha na trilha da B nao entra;
// - linha estranha na trilha da C (gravada pela service role, como o SQL
//   editor; a sessao nao grava mais as acoes da conta): os detalhes fora do
//   formato saem nulos, o historico nao cai e o leitor da tela aceita
//   (revisao de 26/10/2026);
// - com INTEGRACAO_COM_SUPER_ADMIN=1 (opt-in, como em painel-cs.test.ts:
//   cria um product_admin sintetico NA PRODUCAO, com senha aleatoria e
//   e-mail em example.com, e o apaga no fim): o super admin escreve a nota
//   pela sessao (a dele, "minha"), exclui, e o historico diz quem.
// Os limites exatos (2 dias, 7 dias, 30 e 60 dias, 80% com os centavos
// arredondados, o arredondamento da variacao) e a regra recalculada para
// toda linha do painel ficam no ensaio da migration
// (~/.claude/plans/painel-cs/ensaio-20261026110000.sql), que monta os
// instantes exatos dentro da transacao.
//
// CUIDADO, o banco e o da producao: tres clinicas e_de_teste, apagadas no
// afterAll (vinculos, numeros, contatos, conversas, mensagens, gasto,
// notas, a conta da Meta, o rastreio e as linhas de trilha delas vao em
// cascata; o beforeAll apaga a sobra de uma execucao que morreu ha mais de
// uma hora), e os usuarios desta execucao. Nada aqui usa a id da Salud
// Care, da teste123 nem da Conduzza Teste, nada liga o agente nem envia
// mensagem (o numero e do provedor falso). ESCRITO, AINDA NAO RODADO (roda
// depois de aplicar a migration: npm run test:integration -- painel-cs-2).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'painel-cs2-int-%';
//   delete from public.clinic where slug like 'painel-cs2-int-%';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'painel-cs2-int-super-%@example.com';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-cs2-int-%@teste.dev'
//       or u.email like 'painel-cs2-int-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'painel-cs2-int-%@teste.dev'
//       or u.email like 'painel-cs2-int-super-%@example.com';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelCs2Int!${sufixo}`;
const COM_SUPER_ADMIN = process.env.INTEGRACAO_COM_SUPER_ADMIN === "1";

const email = (papel: string) => `painel-cs2-int-${papel}-${sufixo}@teste.dev`;
const EMAIL_DO_SUPER = `painel-cs2-int-super-${sufixo}@example.com`;
const DIGITOS = sufixo.replace(/\D/g, "").padEnd(4, "6").slice(0, 4);

let clinicaA = "";
let clinicaB = "";
let clinicaC = "";
// So do teste da linha estranha: as notas da C tambem entram no historico.
let clinicaD = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string; hint?: string } | null;

type Sinal = {
  chave: string;
  nivel: string;
  quantidade: number | null;
  desde: string | null;
};
type Passo = { chave: string; feito: boolean; quantidade: number };
type Tendencia = {
  atual: number;
  anterior: number;
  variacao_percentual: number | null;
  direcao: string;
};
type LinhaDoPainel = {
  id: string;
  saude: string;
  sinais: Sinal[];
  implantacao: {
    feitos: number;
    total: number;
    passos: Passo[];
    anuncios: { meta: boolean; google: boolean };
  };
  tendencia: { leads: Tendencia; conversas: Tendencia };
  ultima_nota_em: string | null;
  gasto: Gasto;
};
/** O gasto da linha: os quatro em centavos, os quatro em microdolares e as chamadas. */
type Gasto = {
  ultimas_24h_centavos_usd: number;
  mes_centavos_usd: number;
  ultimas_24h_sem_simulador_centavos_usd: number;
  mes_sem_simulador_centavos_usd: number;
  ultimas_24h_microdolares: number;
  mes_microdolares: number;
  ultimas_24h_sem_simulador_microdolares: number;
  mes_sem_simulador_microdolares: number;
  ultimas_24h_chamadas: number;
  mes_chamadas: number;
  ultimas_24h_sem_simulador_chamadas: number;
  mes_sem_simulador_chamadas: number;
};
type PainelCs = {
  gerado_em: string;
  totais: {
    clinicas: number;
    gasto_mes_microdolares: number;
    chamadas_mes: number;
    saude: { saudavel: number; atencao: number; em_risco: number };
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
      name: `Painel CS2 Int ${nome} ${sufixo}`,
      slug: `painel-cs2-int-${nome.toLowerCase()}-${sufixo}`,
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
    user_metadata: { name: `Painel CS2 ${papel}` },
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

/** Um login de verdade (grava last_sign_in_at: a clinica fica em uso). */
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

const diasAtras = (dias: number) =>
  new Date(Date.now() - dias * 24 * 60 * 60_000).toISOString();

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

async function notas(
  clinicId: string,
  limite?: number,
): Promise<NotasDaClinica> {
  const { data, error } = await admin.rpc("notas_da_clinica_no_painel", {
    p_clinic_id: clinicId,
    ...(limite !== undefined ? { p_limite: limite } : {}),
  });
  expect(error).toBeNull();
  return data as NotasDaClinica;
}

async function historico(clinicId: string): Promise<Historico> {
  const { data, error } = await admin.rpc("historico_da_clinica_no_painel", {
    p_clinic_id: clinicId,
  });
  expect(error).toBeNull();
  return data as Historico;
}

/** Contatos sinteticos (sem nome) com o primeiro contato no dia dado. */
async function criarContatos(
  clinicId: string,
  prefixo: string,
  dias: number[],
): Promise<string[]> {
  const { data } = await admin
    .from("contact")
    .insert(
      dias.map((dia, i) => ({
        clinic_id: clinicId,
        phone_e164: `+55849${prefixo}${DIGITOS}${String(i).padStart(2, "0")}`,
        first_contact_at: diasAtras(dia),
      })),
    )
    .select("id")
    .throwOnError();
  return ((data ?? []) as { id: string }[]).map((c) => c.id);
}

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "painel-cs2-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  clinicaC = await criarClinica("C");
  clinicaD = await criarClinica("D");
  await criarMembro("admin-a", clinicaA, "admin");
  await criarMembro("recepcao-a", clinicaA, "recepcao");
  await criarMembro("admin-b", clinicaB, "admin");
  await criarMembro("pendente-b", clinicaB, "leitura", "pendente");
  await criarMembro("admin-c", clinicaC, "admin");
  // As tres em uso (o administrador entra); o pedido de entrada da B
  // esperando ha 3 dias (o pedido so nasce por insert; a data e movida pela
  // service role).
  for (const papel of ["admin-a", "admin-b", "admin-c"]) {
    await entrar(email(papel), SENHA);
  }
  await admin
    .from("clinic_member")
    .update({ created_at: diasAtras(3) })
    .eq("clinic_id", clinicaB)
    .eq("user_id", idDe("pendente-b"))
    .throwOnError();

  // A: a implantacao inteira e o gasto abaixo de 1 centavo.
  await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" });
  await admin
    .from("procedure")
    .insert({
      clinic_id: clinicaA,
      name: "Consulta CS2",
      default_duration_min: 30,
    })
    .throwOnError();
  await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. CS2" })
    .throwOnError();
  // A regua de confirmacao padrao nasce com a clinica, desligada.
  await admin
    .from("cadence")
    .update({
      active: true,
      send_window_start: "08:00",
      send_window_end: "18:00",
      send_weekdays: [1, 2, 3, 4, 5],
    })
    .eq("clinic_id", clinicaA)
    .eq("kind", "confirmacao")
    .eq("for_no_show_history", false)
    .is("procedure_id", null)
    .is("professional_id", null)
    .is("specialty", null)
    .throwOnError();
  await admin
    .from("meta_ads_account_secret")
    .insert({
      clinic_id: clinicaA,
      insights_access_token: `token-de-teste-${sufixo}-cs2`,
    })
    .throwOnError();
  await admin
    .from("meta_ads_account")
    .insert({ clinic_id: clinicaA, ad_account_id: `act_${DIGITOS}1234` })
    .throwOnError();
  await admin
    .from("rastreio_do_site")
    .insert({ clinic_id: clinicaA, ativo: true })
    .throwOnError();
  await admin
    .from("ia_uso")
    .insert([
      {
        clinic_id: clinicaA,
        origem: "whatsapp",
        papel: "agente",
        modelo: "teste-cs2",
        custo_microdolar: 400,
      },
      {
        clinic_id: clinicaA,
        origem: "simulador",
        papel: "agente",
        modelo: "teste-cs2",
        custo_microdolar: 600,
      },
    ])
    .throwOnError();

  // B: o numero desconectado, uma mensagem de saida que falhou e o gasto
  // em 80% do teto (100 centavos).
  const numeroB = await criarNumeroDeTeste(admin, clinicaB, {
    nome: "Recepção",
    connection_status: "desconectado",
  });
  const [contatoB] = await criarContatos(clinicaB, "62", [90]);
  const { data: conversaB } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaB,
      contact_id: contatoB,
      whatsapp_account_id: numeroB.id,
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("message")
    .insert({
      clinic_id: clinicaB,
      conversation_id: (conversaB as { id: string }).id,
      direction: "saida",
      author: "usuario",
      content_type: "texto",
      body: "Mensagem sintética que falhou",
      delivery_status: "falhou",
    })
    .throwOnError();
  await admin
    .from("ia_liberacao")
    .insert({ clinic_id: clinicaB, teto_diario_centavos_usd: 100 })
    .throwOnError();
  await admin
    .from("ia_uso")
    .insert({
      clinic_id: clinicaB,
      origem: "simulador",
      papel: "agente",
      modelo: "teste-cs2",
      custo_microdolar: 800_000,
    })
    .throwOnError();

  // C: a tendencia (3 leads nos ultimos 30 dias, 2 nos 30 anteriores; 1
  // conversa, nenhuma antes).
  const numeroC = await criarNumeroDeTeste(admin, clinicaC, {
    nome: "Recepção",
  });
  const contatosC = await criarContatos(clinicaC, "63", [1, 2, 3, 40, 45]);
  await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaC,
      contact_id: contatosC[0],
      whatsapp_account_id: numeroC.id,
    })
    .throwOnError();
}, 120_000);

afterAll(async () => {
  const clinicas = [clinicaA, clinicaB, clinicaC, clinicaD].filter(
    (id) => id !== "",
  );
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

describe("a lista com a segunda leva", () => {
  it("o gasto em microdólares e as chamadas: US$ 0,001 em 2 chamadas na A, que em centavos é 0", async () => {
    const a = linha(await painel(), clinicaA);
    expect(a.gasto).toMatchObject({
      ultimas_24h_centavos_usd: 0,
      mes_centavos_usd: 0,
      ultimas_24h_microdolares: 1000,
      mes_microdolares: 1000,
      ultimas_24h_sem_simulador_microdolares: 400,
      mes_sem_simulador_microdolares: 400,
      ultimas_24h_chamadas: 2,
      mes_chamadas: 2,
      ultimas_24h_sem_simulador_chamadas: 1,
      mes_sem_simulador_chamadas: 1,
    });
  });

  it("os sinais e a saúde: a A saudável, a B em risco com quatro sinais, a C saudável", async () => {
    const p = await painel();
    const a = linha(p, clinicaA);
    expect(a.sinais).toEqual([]);
    expect(a.saude).toBe("saudavel");
    const b = linha(p, clinicaB);
    expect(b.sinais.map((s) => [s.chave, s.nivel, s.quantidade])).toEqual([
      ["whatsapp_desconectado", "em_risco", 1],
      ["pedido_de_entrada_esperando", "atencao", 1],
      ["falhas_de_envio", "atencao", 1],
      ["perto_do_teto_da_ia", "atencao", 80],
    ]);
    expect(b.saude).toBe("em_risco");
    const c = linha(p, clinicaC);
    expect(c.sinais).toEqual([]);
    expect(c.saude).toBe("saudavel");
    // Os totais: as tres saudes somam as clinicas; o gasto e as chamadas
    // somam as linhas.
    expect(
      p.totais.saude.saudavel +
        p.totais.saude.atencao +
        p.totais.saude.em_risco,
    ).toBe(p.totais.clinicas);
    expect(p.totais.gasto_mes_microdolares).toBe(
      p.clinicas.reduce((soma, l) => soma + l.gasto.mes_microdolares, 0),
    );
    expect(p.totais.chamadas_mes).toBe(
      p.clinicas.reduce((soma, l) => soma + l.gasto.mes_chamadas, 0),
    );
  });

  it("a implantação: a A com os 6 passos; a B e a C pela metade", async () => {
    const p = await painel();
    const a = linha(p, clinicaA);
    expect(a.implantacao).toEqual({
      feitos: 6,
      total: 6,
      passos: [
        { chave: "whatsapp_conectado", feito: true, quantidade: 1 },
        { chave: "equipe_com_duas_pessoas", feito: true, quantidade: 2 },
        { chave: "procedimentos_cadastrados", feito: true, quantidade: 1 },
        { chave: "profissionais_cadastrados", feito: true, quantidade: 1 },
        { chave: "regua_de_confirmacao_ligada", feito: true, quantidade: 1 },
        { chave: "anuncios_conectados", feito: true, quantidade: 2 },
      ],
      anuncios: { meta: true, google: true },
    });
    const b = linha(p, clinicaB);
    expect(b.implantacao.feitos).toBe(0);
    expect(b.implantacao.passos[0]).toEqual({
      chave: "whatsapp_conectado",
      feito: false,
      quantidade: 0,
    });
    const c = linha(p, clinicaC);
    expect(c.implantacao.feitos).toBe(1);
    expect(
      c.implantacao.passos
        .filter((passo) => passo.feito)
        .map((passo) => passo.chave),
    ).toEqual(["whatsapp_conectado"]);
  });

  it("a tendência: a C com 3 leads contra 2 (subindo) e 1 conversa contra nenhuma (sem base)", async () => {
    const c = linha(await painel(), clinicaC);
    expect(c.tendencia).toEqual({
      leads: {
        atual: 3,
        anterior: 2,
        variacao_percentual: 50,
        direcao: "subindo",
      },
      conversas: {
        atual: 1,
        anterior: 0,
        variacao_percentual: null,
        direcao: "sem_base",
      },
    });
  });
});

describe("as notas internas", () => {
  it("escrever, ler, recusar e excluir pela service role; a última nota na lista", async () => {
    expect(linha(await painel(), clinicaC).ultima_nota_em).toBeNull();
    const idsDasNotas: string[] = [];
    for (const texto of [
      "  Primeira nota de teste\n",
      "Segunda nota de teste",
    ]) {
      const { data, error } = await admin.rpc("escrever_nota_da_clinica", {
        p_clinic_id: clinicaC,
        p_texto: texto,
      });
      expect(error).toBeNull();
      idsDasNotas.push(data as string);
    }
    const lidas = await notas(clinicaC);
    expect(lidas.tem_mais).toBe(false);
    expect(lidas.notas.map((n) => n.texto).sort()).toEqual([
      "Primeira nota de teste",
      "Segunda nota de teste",
    ]);
    expect(lidas.notas.every((n) => n.autor === null && !n.minha)).toBe(true);
    const comLimite = await notas(clinicaC, 1);
    expect(comLimite.notas).toHaveLength(1);
    expect(comLimite.tem_mais).toBe(true);
    expect(linha(await painel(), clinicaC).ultima_nota_em).toBe(
      lidas.notas[0]?.criada_em,
    );

    // As recusas: texto longo, vazio e so espacos (22023 texto_invalido),
    // nulos (22004) e a clinica que nao existe (P0002). Nada e gravado.
    for (const texto of ["x".repeat(2001), "", "   \n\t "]) {
      const { error } = await admin.rpc("escrever_nota_da_clinica", {
        p_clinic_id: clinicaC,
        p_texto: texto,
      });
      expect((error as Erro)?.code).toBe("22023");
      expect((error as Erro)?.message).toBe("texto_invalido");
    }
    const { error: semTexto } = await admin.rpc("escrever_nota_da_clinica", {
      p_clinic_id: clinicaC,
      p_texto: null,
    });
    expect((semTexto as Erro)?.code).toBe("22004");
    const { error: semClinica } = await admin.rpc("escrever_nota_da_clinica", {
      p_clinic_id: crypto.randomUUID(),
      p_texto: "Nota sem clínica",
    });
    expect((semClinica as Erro)?.code).toBe("P0002");
    const { error: limiteRuim } = await admin.rpc(
      "notas_da_clinica_no_painel",
      {
        p_clinic_id: clinicaC,
        p_limite: 0,
      },
    );
    expect((limiteRuim as Erro)?.message).toBe("limite_invalido");
    expect((await notas(clinicaC)).notas).toHaveLength(2);

    // Excluir (a service role exclui qualquer uma); de novo, P0002.
    const { error: excluir } = await admin.rpc("excluir_nota_da_clinica", {
      p_nota_id: idsDasNotas[0],
    });
    expect(excluir).toBeNull();
    const { error: deNovo } = await admin.rpc("excluir_nota_da_clinica", {
      p_nota_id: idsDasNotas[0],
    });
    expect((deNovo as Erro)?.code).toBe("P0002");
    expect((await notas(clinicaC)).notas.map((n) => n.id)).toEqual([
      idsDasNotas[1],
    ]);

    // A trilha leva o id da nota, nunca o texto.
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action, entity_id, detalhes")
      .eq("clinic_id", clinicaC)
      .in("action", ["escreveu_nota_interna", "excluiu_nota_interna"])
      .order("id")
      .throwOnError();
    const linhas = (trilha ?? []) as {
      action: string;
      entity_id: string;
      detalhes: Record<string, unknown> | null;
    }[];
    expect(linhas.map((l) => [l.action, l.entity_id])).toEqual([
      ["escreveu_nota_interna", idsDasNotas[0]],
      ["escreveu_nota_interna", idsDasNotas[1]],
      ["excluiu_nota_interna", idsDasNotas[0]],
    ]);
    expect(JSON.stringify(linhas)).not.toContain("nota de teste");
  });
});

describe("o histórico da conta", () => {
  it("as ações da B pelas funções de sempre, do mais novo para o mais antigo, com os detalhes; a leitura de ficha não entra", async () => {
    const suspender = await admin.rpc("suspender_clinica", {
      p_clinic_id: clinicaB,
      p_motivo: "Teste de integração do painel CS 2",
    });
    expect(suspender.error).toBeNull();
    const reativar = await admin.rpc("reativar_clinica", {
      p_clinic_id: clinicaB,
      p_motivo: "Fim do teste de integração do painel CS 2",
    });
    expect(reativar.error).toBeNull();
    const teto = await admin.rpc("definir_teto_da_ia", {
      p_clinic_id: clinicaB,
      p_teto_diario_centavos_usd: 200,
      p_teto_respostas_por_conversa_hora: 15,
    });
    expect(teto.error).toBeNull();
    await admin
      .from("audit_log")
      .insert({
        clinic_id: clinicaB,
        user_id: idDe("admin-b"),
        action: "leu",
        entity: "ficha_paciente",
        entity_id: null,
      })
      .throwOnError();

    const h = await historico(clinicaB);
    expect(h.tem_mais).toBe(false);
    expect(h.eventos.map((e) => e.acao)).toEqual([
      "mudou_teto_da_ia",
      "reativou_clinica",
      "suspendeu_clinica",
    ]);
    expect(h.eventos.every((e) => e.quem === null)).toBe(true);
    expect(h.eventos[0]?.detalhes).toMatchObject({
      teto_diario_centavos_usd: 200,
      teto_respostas_por_conversa_hora: 15,
      teto_diario_antes_centavos_usd: 100,
      motivo: null,
      estado: null,
    });
    expect(h.eventos[2]?.detalhes).toMatchObject({
      motivo: "Teste de integração do painel CS 2",
      teto_diario_centavos_usd: null,
    });
    expect(Object.keys(h.eventos[1]?.detalhes ?? {}).sort()).toEqual([
      "chave",
      "clinicas_de_volta_ao_teste",
      "estado",
      "jobs_vencidos",
      "motivo",
      "nota_escrita_em",
      "substituiu",
      "teto_diario_antes_centavos_usd",
      "teto_diario_centavos_usd",
      "teto_respostas_antes_por_conversa_hora",
      "teto_respostas_por_conversa_hora",
    ]);
    // A clinica que nao existe: nulo; a clinica nula: 22004.
    const { data: inexistente, error } = await admin.rpc(
      "historico_da_clinica_no_painel",
      { p_clinic_id: crypto.randomUUID() },
    );
    expect(error).toBeNull();
    expect(inexistente).toBeNull();
    const { error: nula } = await admin.rpc("historico_da_clinica_no_painel", {
      p_clinic_id: null,
    });
    expect((nula as Erro)?.code).toBe("22004");
  });
});

describe("o histórico da conta com linha estranha (revisão de 26/10/2026)", () => {
  it("os detalhes fora do formato saem nulos, sem derrubar o histórico, e a tela lê", async () => {
    const agora = Date.now();
    const quando = (minutos: number) =>
      new Date(agora - minutos * 60_000).toISOString();
    await admin
      .from("audit_log")
      .insert([
        {
          clinic_id: clinicaD,
          user_id: null,
          action: "excluiu_nota_interna",
          entity: "nota_interna_da_clinica",
          entity_id: crypto.randomUUID(),
          created_at: quando(1),
          detalhes: { escrita_em: "ontem" },
        },
        {
          clinic_id: clinicaD,
          user_id: null,
          action: "mudou_teto_da_ia",
          entity: "ia_liberacao",
          entity_id: clinicaD,
          created_at: quando(2),
          detalhes: {
            teto_diario_centavos_usd: 1e30,
            teto_respostas_por_conversa_hora: 1.5,
            antes: { teto_diario_centavos_usd: -5 },
          },
        },
        {
          clinic_id: clinicaD,
          user_id: null,
          action: "reativou_clinica",
          entity: "clinic",
          entity_id: clinicaD,
          created_at: quando(3),
          detalhes: { jobs_vencidos: -1 },
        },
        {
          clinic_id: clinicaD,
          user_id: null,
          action: "mudou_agente_da_clinica",
          entity: "ia_clinica_habilitada",
          entity_id: clinicaD,
          created_at: quando(4),
          detalhes: {
            estado: "teste",
            motivo: "Requisito da produção revogado: termo_da_clinica",
          },
        },
      ])
      .throwOnError();

    const h = await historico(clinicaD);
    expect(h.eventos.map((e) => e.acao)).toEqual([
      "excluiu_nota_interna",
      "mudou_teto_da_ia",
      "reativou_clinica",
      "mudou_agente_da_clinica",
    ]);
    expect(h.eventos[0]?.detalhes.nota_escrita_em).toBeNull();
    expect(h.eventos[1]?.detalhes).toMatchObject({
      teto_diario_centavos_usd: null,
      teto_respostas_por_conversa_hora: null,
      teto_diario_antes_centavos_usd: null,
    });
    expect(h.eventos[2]?.detalhes.jobs_vencidos).toBeNull();

    // O leitor da tela aceita (antes, o -1 lancava "painel geral ilegivel"),
    // e a volta pela revogacao sai como volta, com o nome do requisito.
    const lido = lerHistoricoDoBanco(h);
    expect(lido?.eventos).toHaveLength(4);
    const textos = descricoesDoHistorico(
      lido?.eventos ?? [],
      "America/Fortaleza",
    ).map((d) => d.descricao);
    expect(textos[3]).toEqual({
      titulo: "Agente voltou para Teste",
      linhas: [
        "Motivo: Requisito da produção revogado: Termo da clínica com a IA e a OpenAI",
      ],
    });
  });
});

// O super admin pela sessao: so com INTEGRACAO_COM_SUPER_ADMIN=1.
describe.skipIf(!COM_SUPER_ADMIN)(
  "o super admin escreve e exclui a própria nota pela sessão (opt-in)",
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
    }, 60_000);

    afterAll(async () => {
      if (superAdmin) {
        // So o product_admin sai aqui; as notas e a trilha saem com a
        // clinica, e o usuario no afterAll geral.
        const { error } = await admin
          .from("product_admin")
          .delete()
          .eq("user_id", superAdmin);
        expect(error, "tirar o product_admin sintetico").toBeNull();
      }
    });

    it('a nota dele é "minha", a exclusão é dele, e o histórico diz quem', async () => {
      const cliente = anonClient();
      const { error: erroLogin } = await cliente.auth.signInWithPassword({
        email: EMAIL_DO_SUPER,
        password: senhaDoSuper,
      });
      expect(erroLogin).toBeNull();
      try {
        const { data: id, error } = await cliente.rpc(
          "escrever_nota_da_clinica",
          {
            p_clinic_id: clinicaA,
            p_texto: "Nota do super admin sintético",
          },
        );
        expect(error).toBeNull();
        const { data: lidas } = await cliente.rpc(
          "notas_da_clinica_no_painel",
          {
            p_clinic_id: clinicaA,
          },
        );
        expect(
          (lidas as NotasDaClinica).notas.find((n) => n.id === id),
        ).toMatchObject({
          minha: true,
          autor: {
            user_id: superAdmin,
            equipe_conduzza: true,
            email: EMAIL_DO_SUPER,
          },
        });
        const { error: erroExcluir } = await cliente.rpc(
          "excluir_nota_da_clinica",
          {
            p_nota_id: id,
          },
        );
        expect(erroExcluir).toBeNull();
        const h = await historico(clinicaA);
        expect(
          h.eventos
            .filter((e) => e.quem?.user_id === superAdmin)
            .map((e) => e.acao),
        ).toEqual(["excluiu_nota_interna", "escreveu_nota_interna"]);
      } finally {
        await cliente.auth.signOut();
      }
    });
  },
);
