import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

import { respostaDosRequisitosSchema } from "@/lib/domain/cadastro-para-o-agente";
import {
  fetchCadastroParaOAgente,
  fetchProntidaoDoCadastro,
} from "@/lib/queries/cadastro-para-o-agente";

// Cadastro para o agente (AG1, migration 20261027100000_cadastro_para_o_agente
// .sql), contra o banco REAL, pela service role: os leitores do codigo
// (lib/queries/cadastro-para-o-agente.ts) contra o que o banco devolve de
// verdade. O que esta em jogo:
// - fetchProntidaoDoCadastro le a resposta da funcao com o Zod do codigo
//   (prontidaoDoCadastroSchema): o formato exato que o cartao da Tela 6 le,
//   com os valores de uma clinica montada aqui (profissional sem jornada,
//   procedimento da IA sem vinculo e outro sem preco, o "Coberto" que conta
//   como preco, unidade sem bairro e sem horario, convenio que so cobre
//   procedimento inativo, requisito inativo que nao conta);
// - fetchCadastroParaOAgente le as colunas novas e os requisitos (o horario
//   com as faixas em ordem, o requisito com o tipo e o numero);
// - a clinica vazia: tudo zero e "nenhuma unidade ativa";
// - salvar_requisitos_do_procedimento (o Salvar de "O que o paciente
//   precisa" numa transacao so), sem sessao como a service role chega: a
//   troca de CONVENIO entre dois ativos do mesmo tipo salva numa chamada (a
//   mesma troca em dois UPDATE bate no indice: contraprova), com a trilha de
//   user_id nulo; a falha no meio (o convenio de outra clinica no ultimo
//   item, depois de o texto do primeiro ja ter mudado) nao deixa nada nem
//   trilha; o id que sumiu e o ativo igual ao que outra pessoa criou dao
//   CZ409; o que ela criou fica; e a resposta passa no Zod que a action le
//   (respostaDosRequisitosSchema), com os valores exatos.
// Os papeis, a RLS e os CHECKs pela sessao estao em
// tests/rls/cadastro-para-o-agente.test.ts; o resto (cada CHECK, a
// unicidade, a cascata, as 6 clinicas reais) no ensaio da migration
// (~/.claude/plans/agente-completo/ag1/ensaio-20261027100000.sql).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// cadastro-agente-int-*, apagadas no afterAll (prazo de 60 s; tudo vai em
// cascata, a trilha da RPC inclusive; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora). Nenhum usuario e criado. Nada aqui usa a id da Salud Care, da
// teste123 nem da Conduzza Teste. ESCRITO, AINDA NAO RODADO (roda depois de
// aplicar a migration: npm run test:integration -- cadastro-para-o-agente).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'cadastro-agente-int-%';
//   delete from public.clinic where slug like 'cadastro-agente-int-%';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const slug = (nome: string) => `cadastro-agente-int-${nome}-${sufixo}`;

let clinica = "";
let clinicaVazia = "";

async function inserirId(
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

async function criarClinica(nome: string): Promise<string> {
  return inserirId("clinic", {
    name: `Cadastro Agente Int ${nome} ${sufixo}`,
    slug: slug(nome.toLowerCase()),
    e_de_teste: true,
  });
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "cadastro-agente-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinica = await criarClinica("A");
  clinicaVazia = await criarClinica("Vazia");

  const ana = await inserirId("professional", {
    clinic_id: clinica,
    name: "Ana Lima",
  });
  await inserirId("professional", { clinic_id: clinica, name: "Bruno Reis" });
  await inserirId("professional_schedule", {
    clinic_id: clinica,
    professional_id: ana,
    weekday: 1,
    starts_at: "08:00",
    ends_at: "12:00",
  });
  const unimed = await inserirId("insurance", {
    clinic_id: clinica,
    name: "Unimed",
    plan_name: "Nacional",
  });
  const hapvida = await inserirId("insurance", {
    clinic_id: clinica,
    name: "Hapvida",
  });
  const consulta = await inserirId("procedure", {
    clinic_id: clinica,
    name: "Consulta",
  });
  const retorno = await inserirId("procedure", {
    clinic_id: clinica,
    name: "Retorno",
  });
  await inserirId("procedure", { clinic_id: clinica, name: "Ultrassom" });
  const antigo = await inserirId("procedure", {
    clinic_id: clinica,
    name: "Antigo",
    active: false,
  });
  // Consulta: so o vinculo "Coberto" da Unimed (conta como preco).
  await inserirId("service_link", {
    clinic_id: clinica,
    professional_id: ana,
    procedure_id: consulta,
    insurance_id: unimed,
    covered_by_insurance: true,
    duration_min: 30,
  });
  // Retorno: vinculo particular sem preco.
  await inserirId("service_link", {
    clinic_id: clinica,
    professional_id: ana,
    procedure_id: retorno,
    duration_min: 20,
  });
  await inserirId("procedure_insurance", {
    clinic_id: clinica,
    procedure_id: consulta,
    insurance_id: unimed,
  });
  // Hapvida so cobre o procedimento inativo: conta como sem cobertura.
  await inserirId("procedure_insurance", {
    clinic_id: clinica,
    procedure_id: antigo,
    insurance_id: hapvida,
  });
  await inserirId("unit", {
    clinic_id: clinica,
    name: "Sede",
    logradouro: "Rua das Flores",
    numero: "123",
    bairro: "Centro",
    cidade: "Fortaleza",
    uf: "CE",
    horario_de_funcionamento: {
      "1": [
        { inicio: "13:00", fim: "18:00" },
        { inicio: "08:00", fim: "12:00" },
      ],
    },
  });
  await inserirId("unit", {
    clinic_id: clinica,
    name: "Filial",
    logradouro: "Avenida Central",
    numero: "S/N",
    cidade: "Fortaleza",
    uf: "CE",
  });
  await inserirId("procedure_requirement", {
    clinic_id: clinica,
    procedure_id: consulta,
    tipo: "chegar_antes_minutos",
    valor_inteiro: 15,
  });
  await inserirId("procedure_requirement", {
    clinic_id: clinica,
    procedure_id: retorno,
    tipo: "pedido_medico",
    ativo: false,
  });
}, 120_000);

afterAll(async () => {
  const { error } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `cadastro-agente-int-%-${sufixo}`);
  expect(error, "apagar as clinicas do teste").toBeNull();
}, 60_000);

describe("prontidao do cadastro (o leitor do cartao da Tela 6)", () => {
  it("os valores exatos da clinica montada", async () => {
    expect(await fetchProntidaoDoCadastro(admin, clinica)).toEqual({
      profissionais_sem_jornada: { total: 1, nomes: ["Bruno Reis"] },
      procedimentos_sem_vinculo: { total: 1, nomes: ["Ultrassom"] },
      procedimentos_sem_preco: { total: 1, nomes: ["Retorno"] },
      unidades_ativas: 2,
      nenhuma_unidade_ativa: false,
      unidades_sem_endereco: { total: 1, nomes: ["Filial"] },
      unidades_sem_horario: { total: 1, nomes: ["Filial"] },
      convenios_sem_cobertura: { total: 1, nomes: ["Hapvida"] },
      procedimentos_sem_requisitos: {
        total: 2,
        nomes: ["Retorno", "Ultrassom"],
      },
    });
  });

  it("a clinica vazia: tudo zero e nenhuma unidade ativa", async () => {
    const vazia = { total: 0, nomes: [] };
    expect(await fetchProntidaoDoCadastro(admin, clinicaVazia)).toEqual({
      profissionais_sem_jornada: vazia,
      procedimentos_sem_vinculo: vazia,
      procedimentos_sem_preco: vazia,
      unidades_ativas: 0,
      nenhuma_unidade_ativa: true,
      unidades_sem_endereco: vazia,
      unidades_sem_horario: vazia,
      convenios_sem_cobertura: vazia,
      procedimentos_sem_requisitos: vazia,
    });
  });

  it("clinica que nao existe: o leitor lanca (o cartao mostra o erro)", async () => {
    await expect(
      fetchProntidaoDoCadastro(admin, crypto.randomUUID()),
    ).rejects.toThrow();
  });
});

describe("o cadastro para o agente (o leitor de Cadastros)", () => {
  it("as colunas novas e os requisitos, com o horario em ordem", async () => {
    const cadastro = await fetchCadastroParaOAgente(admin, clinica);
    const sede = cadastro.unidades.find(
      (u) => u.logradouro === "Rua das Flores",
    );
    expect(sede).toMatchObject({
      numero: "123",
      bairro: "Centro",
      cidade: "Fortaleza",
      uf: "CE",
      cep: null,
      horario_de_funcionamento: {
        "1": [
          { inicio: "08:00", fim: "12:00" },
          { inicio: "13:00", fim: "18:00" },
        ],
      },
    });
    expect(cadastro.unidades).toHaveLength(2);
    expect(cadastro.profissionais).toHaveLength(2);
    expect(cadastro.profissionais.every((p) => p.grade_minutos === null)).toBe(
      true,
    );
    expect(cadastro.procedimentos.every((p) => p.ia_pode_informar)).toBe(true);
    expect(
      cadastro.requisitos.map((r) => [r.tipo, r.valor_inteiro, r.ativo]),
    ).toEqual([
      ["chegar_antes_minutos", 15, true],
      ["pedido_medico", null, false],
    ]);
  });
});

// ---------------------------------------------------------------------------
// O Salvar de "O que o paciente precisa" (RPC, uma transacao so)
// ---------------------------------------------------------------------------

type RequisitoLido = {
  id: string;
  tipo: string;
  insurance_id: string | null;
  texto_ao_paciente: string | null;
  ativo: boolean;
};

describe("salvar_requisitos_do_procedimento (pela service role)", () => {
  // Uma clinica so deste bloco (a R), para nao mexer nas contas acima, e o
  // convenio de outra (a R2) para a falha no meio.
  let clinicaR = "";
  let exame = "";
  let unimedR = "";
  let deOutraClinica = "";
  let comUnimed = "";
  let paraTodos = "";

  async function requisitosDoExame(): Promise<RequisitoLido[]> {
    const { data } = await admin
      .from("procedure_requirement")
      .select("id, tipo, insurance_id, texto_ao_paciente, ativo")
      .eq("procedure_id", exame)
      .order("created_at")
      .order("id")
      .throwOnError();
    return (data ?? []) as RequisitoLido[];
  }

  async function trilhaDoExame(): Promise<(string | null)[]> {
    const { data } = await admin
      .from("audit_log")
      .select("user_id")
      .eq("action", "editou_requisitos_do_procedimento")
      .eq("entity_id", exame)
      .throwOnError();
    return ((data ?? []) as { user_id: string | null }[]).map((l) => l.user_id);
  }

  const item = (r: Partial<RequisitoLido> & { tipo: string }) => ({
    ...(r.id ? { id: r.id } : {}),
    tipo: r.tipo,
    insurance_id: r.insurance_id ?? null,
    valor_inteiro: null,
    texto_ao_paciente: r.texto_ao_paciente ?? null,
    ativo: r.ativo ?? true,
  });

  beforeAll(async () => {
    clinicaR = await criarClinica("R");
    const clinicaR2 = await criarClinica("R2");
    exame = await inserirId("procedure", {
      clinic_id: clinicaR,
      name: "Exame da troca",
    });
    unimedR = await inserirId("insurance", {
      clinic_id: clinicaR,
      name: "Unimed da R",
    });
    deOutraClinica = await inserirId("insurance", {
      clinic_id: clinicaR2,
      name: "Convênio da R2",
    });
    // Na abertura do modal: a carteirinha so da Unimed e a carteirinha para
    // todos, as duas ativas.
    comUnimed = await inserirId("procedure_requirement", {
      clinic_id: clinicaR,
      procedure_id: exame,
      insurance_id: unimedR,
      tipo: "carteirinha",
      texto_ao_paciente: "Traga a carteirinha da Unimed.",
    });
    paraTodos = await inserirId("procedure_requirement", {
      clinic_id: clinicaR,
      procedure_id: exame,
      tipo: "carteirinha",
    });
  }, 60_000);

  it("a mesma troca em dois UPDATE diretos bate no indice (contraprova)", async () => {
    const antes = await requisitosDoExame();
    const { error } = await admin
      .from("procedure_requirement")
      .update({ insurance_id: null })
      .eq("id", comUnimed);
    expect((error as { code?: string } | null)?.code).toBe("23505");
    expect(await requisitosDoExame()).toEqual(antes);
  });

  it("a troca de convenio entre dois ativos do mesmo tipo salva numa chamada so, com a trilha", async () => {
    const { data, error } = await admin.rpc(
      "salvar_requisitos_do_procedimento",
      {
        p_procedure_id: exame,
        p_itens: [
          item({
            id: comUnimed,
            tipo: "carteirinha",
            insurance_id: null,
            texto_ao_paciente: "Traga a carteirinha da Unimed.",
          }),
          item({ id: paraTodos, tipo: "carteirinha", insurance_id: unimedR }),
        ],
        p_ids_na_abertura: [comUnimed, paraTodos],
      },
    );
    expect(error).toBeNull();
    // O formato que a action le, com os valores exatos (a lista em ordem de
    // criacao).
    expect(respostaDosRequisitosSchema.parse(data)).toEqual({
      apagados: 0,
      alterados: 2,
      criados: 0,
      requisitos: [
        {
          id: comUnimed,
          procedure_id: exame,
          insurance_id: null,
          tipo: "carteirinha",
          valor_inteiro: null,
          texto_ao_paciente: "Traga a carteirinha da Unimed.",
          ativo: true,
        },
        {
          id: paraTodos,
          procedure_id: exame,
          insurance_id: unimedR,
          tipo: "carteirinha",
          valor_inteiro: null,
          texto_ao_paciente: null,
          ativo: true,
        },
      ],
    });
    // Sem sessao, a trilha vai com user_id nulo.
    expect(await trilhaDoExame()).toEqual([null]);
  });

  it("falha no meio: o convenio de outra clinica no ultimo item da 23503 e nada fica", async () => {
    const antes = await requisitosDoExame();
    const { data, error } = await admin.rpc(
      "salvar_requisitos_do_procedimento",
      {
        p_procedure_id: exame,
        p_itens: [
          // O texto do primeiro muda antes da falha...
          item({ ...(antes[0] as RequisitoLido), texto_ao_paciente: null }),
          item(antes[1] as RequisitoLido),
          item({ tipo: "pedido_medico" }),
          // ...e o gatilho de mesma clinica recusa este no fim.
          item({ tipo: "autorizacao_previa", insurance_id: deOutraClinica }),
        ],
        p_ids_na_abertura: antes.map((r) => r.id),
      },
    );
    expect(data).toBeNull();
    expect((error as { code?: string } | null)?.code).toBe("23503");
    expect(await requisitosDoExame()).toEqual(antes);
    expect(await trilhaDoExame()).toEqual([null]);
  });

  it("o que mudou desde que o modal abriu: CZ409, nada gravado; o que outra pessoa criou fica", async () => {
    const antes = await requisitosDoExame();
    const sumiu = await admin.rpc("salvar_requisitos_do_procedimento", {
      p_procedure_id: exame,
      p_itens: [item({ id: crypto.randomUUID(), tipo: "pedido_medico" })],
      p_ids_na_abertura: [],
    });
    expect((sumiu.error as { code?: string } | null)?.code).toBe("CZ409");
    const deOutraPessoa = await inserirId("procedure_requirement", {
      clinic_id: clinicaR,
      procedure_id: exame,
      tipo: "acompanhante",
    });
    const bateu = await admin.rpc("salvar_requisitos_do_procedimento", {
      p_procedure_id: exame,
      p_itens: [...antes.map((r) => item(r)), item({ tipo: "acompanhante" })],
      p_ids_na_abertura: antes.map((r) => r.id),
    });
    expect((bateu.error as { code?: string } | null)?.code).toBe("CZ409");
    expect((await requisitosDoExame()).map((r) => r.id)).toEqual([
      ...antes.map((r) => r.id),
      deOutraPessoa,
    ]);
    // Apagar o que estava na abertura nao leva o da outra pessoa.
    const { data, error } = await admin.rpc(
      "salvar_requisitos_do_procedimento",
      {
        p_procedure_id: exame,
        p_itens: [],
        p_ids_na_abertura: antes.map((r) => r.id),
      },
    );
    expect(error).toBeNull();
    expect(respostaDosRequisitosSchema.parse(data)).toMatchObject({
      apagados: 2,
      alterados: 0,
      criados: 0,
    });
    expect((await requisitosDoExame()).map((r) => r.id)).toEqual([
      deOutraPessoa,
    ]);
    expect(await trilhaDoExame()).toEqual([null, null]);
  });
});
