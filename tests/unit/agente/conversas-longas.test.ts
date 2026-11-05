import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contexto = vi.hoisted(() => ({
  config: null as unknown,
  catalogo: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agente/contexto", async () => {
  const real = await vi.importActual<typeof import("@/lib/agente/contexto")>(
    "@/lib/agente/contexto",
  );
  return {
    carregarConfigPublicada: async () => contexto.config,
    carregarCatalogoDoAgente: async () => contexto.catalogo,
    lerPreparoParaEnvio: real.lerPreparoParaEnvio,
  };
});

import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import { PASSO_DO_PREPARO_FORA_DE_VIGOR } from "@/lib/agente/ferramentas/enviar-preparo";
import { PASSO_DA_URGENCIA } from "@/lib/agente/laco";
import { PREFIXO_DO_AUDIO } from "@/lib/agente/midia";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
  FRASE_FORA_DO_ASSUNTO,
} from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
  mensagemDoPreparo,
  substitutoDaMensagemDoPreparo,
} from "@/lib/domain/preparo";

import {
  FRASE_DO_PREPARO_SO_DO_TRECHO,
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";
import { C1, consultasDoContato, ferramenta, final } from "./ag4-conversa";
import {
  busca as buscaDaLimpeza,
  CATALOGO_DA_AG5,
  P_LIMPEZA,
  R_ANA,
  T_E1_ANA_NOITE_SEG_QUA,
  T_E2_ANA_NOITE_SEG_QUA,
} from "./ag5-conversa";
import {
  codigoDoProcedimento,
  CONV,
  iso,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  ENDERECO_DA_ALDEOTA,
  ENDERECO_DO_CENTRO,
  UNID,
} from "./cadastro-fixtures";
import {
  comPreparoEmVigor,
  configPublicada,
  ConversaLonga,
  prepararOTeste,
  saidasDoTurno,
  trilhaDoTurno,
  type FalaDaConversa,
  type TurnoDaConversa,
} from "./conversa-longa";

// As conversas longas do agente (AG0), com o LLM falso de roteiro: o mesmo
// paciente em muitas falas, em turnos separados, cruzando as etapas (AG1 a
// AG7). Cada fala roda o job inteiro (conversa-longa.ts): o executor, o laco, o
// filtro e o envio de verdade. O ajudante confere em TODO turno o que vale para
// a conversa inteira: nada depois da passagem, uma mensagem e uma decisao por
// job, a decisao com o mesmo texto do envio, as ferramentas pedidas, o estado na
// forma do banco, nunca duas consultas de pe, nada do paciente na decisao, na
// nota, no log e (o nome, o telefone, o preparo) na OpenAI. Os testes conferem o
// que muda a cada fala. O it.fails e o defeito achado: ver o comentario dele.
// Nenhum teste chama a OpenAI, a rede ou o banco. Tudo sintetico.

// Cada conversa roda dezenas de turnos inteiros: com a maquina ocupada, os 5 s
// padrao viram falso alarme.
vi.setConfig({ testTimeout: 60_000 });

const UM_MINUTO_MS = 60_000;
const UM_DIA_MS = 24 * 60 * 60_000;
const CADASTRO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CADASTRO, PROC.consulta);

// ---------------------------------------------------------------------------
// O que as falas repetem: os roteiros do LLM falso e os textos que passam
// ---------------------------------------------------------------------------

function busca(extra: Record<string, unknown> = {}) {
  return {
    procedimento: P_CONSULTA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...extra,
  };
}

function registrar(nome: boolean, nascimento: boolean) {
  return ferramenta("registrar_dados_do_paciente", {
    nome_completo: nome ? "Fulano da Silva Souza" : null,
    data_nascimento: nascimento ? "1985-03-12" : null,
    para_o_titular: true,
    campos_mascarados: [],
  });
}
const dadosCompletos = () => registrar(true, true);
const soONome = () => registrar(true, false);
const soONascimento = () => registrar(false, true);
const precoDaConsulta = () =>
  ferramenta("buscar_procedimento", {
    procedimento: P_CONSULTA,
    convenio: null,
  });
const precoDaLimpeza = () =>
  ferramenta("buscar_procedimento", { procedimento: P_LIMPEZA, convenio: null });
const pedirOCancelamento = () => [
  ferramenta("consultar_minhas_consultas", {}),
  ferramenta("pedir_cancelamento", { consulta: "c1" }),
];
const pedirAListaDaNoite = () =>
  ferramenta("pedir_lista_de_espera", {
    periodos: ["noite"],
    dias: ["segunda", "quarta"],
  });
const limpezaComAAna = (periodo: "manha" | "noite") =>
  ferramenta(
    "buscar_horario",
    buscaDaLimpeza({ profissional: R_ANA, periodo }),
  );

const PRECO_DA_CONSULTA =
  "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
const PRECO_DA_LIMPEZA =
  "A Limpeza de pele custa R$ 120,00 no particular, com a Dra. Ana Lima.";
const ESTACIONAMENTO =
  "Na unidade Aldeota tem estacionamento no subsolo do prédio.";
const CERTO = "Claro, é só me dizer.";
const TCHAU = "Por nada! Qualquer coisa, é só chamar por aqui.";

const OFERTA_DA_TARDE =
  "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?";
const RESERVOU_QUARTA =
  "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
const CONFIRMA_QUARTA =
  "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
const MARCOU_QUARTA =
  "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";

const OFERTA_DA_SEXTA =
  "Tenho sexta, 30/10 às 14:00 ou às 15:00 com a Dra. Ana Lima, na unidade Centro. Qual prefere?";
const RESERVOU_SEXTA =
  "Reservei sexta, 30/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
const CONFIRMA_SEXTA =
  "Obrigada! Confirma a Consulta com a Dra. Ana Lima na sexta, 30/10 às 14:00, na unidade Centro, no particular?";
const MARCOU_SEXTA =
  "Pronto! Sua Consulta de sexta, 30/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.";
const HORARIO_DA_SEXTA =
  "Sua Consulta está marcada para sexta, 30/10 às 14:00, pendente da aprovação da equipe.";

const OFERTA_DA_LIMPEZA =
  "Tenho quarta, 21/10 às 08:00 ou quinta, 22/10 às 08:00 com a Dra. Ana Lima. Qual prefere?";
const RESERVOU_LIMPEZA =
  "Reservei quinta, 22/10 às 08:00 com a Dra. Ana Lima por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
const CONFIRMA_LIMPEZA =
  "Obrigada! Confirma a Limpeza de pele com a Dra. Ana Lima na quinta, 22/10 às 08:00, no particular?";
const MARCOU_LIMPEZA =
  "Pronto! Sua Limpeza de pele de quinta, 22/10 às 08:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
const HORARIO_DA_LIMPEZA =
  "Sua Limpeza de pele está marcada para quinta, 22/10 às 08:00, pendente da aprovação da equipe.";
const SEM_NOITE =
  "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?";

const T1_QUINTA =
  "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
const T2_QUINTA =
  "Tudo bem, sua consulta de 22/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.";
const T3_TERCA =
  "Reservei terça, 03/11 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de sexta, 30/10 às 14:00 para terça, 03/11 às 08:00?";
const T4_TERCA =
  "Pronto, pedi a remarcação para terça, 03/11 às 08:00. Até a equipe aprovar, sua consulta de sexta, 30/10 às 14:00 continua marcada. A confirmação chega por aqui.";

// ---------------------------------------------------------------------------
// Os ajudantes das falas
// ---------------------------------------------------------------------------

let escrito: string[] = [];
let conversaDoTeste: ConversaLonga | null = null;

/** A clinica do Cadastro completo: duas unidades (nao tem lista de espera). */
function clinicaComDuasUnidades(
  config?: Parameters<typeof configPublicada>[0],
): ConversaLonga {
  const c = new ConversaLonga(contexto, {
    catalogo: CADASTRO,
    duasUnidades: true,
    ...(config === undefined ? {} : { config: configPublicada(config) }),
  });
  conversaDoTeste = c;
  return c;
}

/** A clinica de uma unidade so: a lista de espera vale (D-38). */
function clinicaDeUmaUnidade(
  catalogo: CatalogoDoAgente = CATALOGO_DA_AG5,
): ConversaLonga {
  const c = new ConversaLonga(contexto, { catalogo });
  conversaDoTeste = c;
  return c;
}

/** O que a decisao gravada diz (aparece inteiro quando o assert falha). */
function oQueDecidiu(t: TurnoDaConversa) {
  return {
    desfecho: t.decisao?.desfecho ?? null,
    regra: t.decisao?.compliance_rule ?? null,
    motivo: t.decisao?.escalation_reason ?? null,
    falha: t.decisao?.motivo_da_falha ?? null,
    gatilho: t.decisao?.gatilho_entrada ?? null,
    camada: t.decisao?.camada ?? null,
  };
}

/** O turno respondeu com o texto: so ele saiu e a conversa segue na IA. */
function respondeu(t: TurnoDaConversa, texto: string) {
  expect(oQueDecidiu(t)).toEqual({
    desfecho: "respondeu",
    regra: null,
    motivo: null,
    falha: null,
    gatilho: null,
    camada: null,
  });
  expect(t.enviadas).toEqual([texto]);
  expect(t.decisao).toMatchObject({ aprovado: true, compliance_blocked: false });
  expect(t.statusDaConversa).toBe("ia_atendendo");
}

/** O aviso de assistente virtual, so antes da primeira resposta da conversa. */
function comOAviso(c: ConversaLonga, texto: string): string {
  return c.recebidasPeloPaciente.length === 1
    ? `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${texto}`
    : texto;
}

/** A fala que o modelo responde: as ferramentas e o texto, que tem de sair. */
async function modeloResponde(
  c: ConversaLonga,
  texto: string,
  resposta: string,
  ferramentas: unknown[] = [],
  intervaloMs?: number,
): Promise<TurnoDaConversa> {
  const t = await c.fala(
    { texto, roteiro: [...ferramentas, final(resposta)] },
    intervaloMs,
  );
  respondeu(t, comOAviso(c, resposta));
  return t;
}

/** A fala em que o modelo so chama a ferramenta e o SISTEMA responde. */
async function sistemaResponde(
  c: ConversaLonga,
  texto: string,
  frase: string,
  ferramentas: unknown[],
  intervaloMs?: number,
): Promise<TurnoDaConversa> {
  const t = await c.fala({ texto, roteiro: ferramentas }, intervaloMs);
  respondeu(t, comOAviso(c, frase));
  return t;
}

/** Conversa sem efeito nenhum, para a fala interessante ser a tardia. */
async function conversaFiada(c: ConversaLonga, falas: readonly string[]) {
  for (const texto of falas) {
    await modeloResponde(c, texto, CERTO);
  }
}

/** O turno passou a conversa: so a frase fixa saiu, nada do modelo. */
function passou(
  t: TurnoDaConversa,
  esperado: Partial<ReturnType<typeof oQueDecidiu>>,
  chamadas?: number,
) {
  expect(oQueDecidiu(t)).toMatchObject(esperado);
  expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
  expect(t.statusDaConversa).toBe("aguardando_humano");
  expect(t.decisao).toMatchObject({ aprovado: false, texto_sha256: null });
  if (chamadas !== undefined) {
    expect(t.chamadasAoModelo).toBe(chamadas);
  }
}

/** Depois da passagem: nenhum modelo, nenhuma decisao, nada para o paciente. */
async function nadaMaisSai(c: ConversaLonga, falas: readonly string[]) {
  const recebidas = c.recebidasPeloPaciente.length;
  const decisoes = c.decisoes.length;
  const status = c.conversa.status;
  for (const texto of falas) {
    const t = await c.fala({ texto });
    expect(t.resultado).toEqual({ ok: true });
    expect(t.chamadasAoModelo).toBe(0);
    expect(t.enviadas).toEqual([]);
    expect(t.decisao).toBeUndefined();
    expect(t.statusDaConversa).toBe(status);
  }
  expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
  expect(c.decisoes).toHaveLength(decisoes);
}

/** Quatro falas: o preço, a oferta, a reserva de quarta e o "Confirma". */
async function ateOConfirmaDeQuarta(c: ConversaLonga) {
  await modeloResponde(c, "Oi, quanto custa a consulta?", PRECO_DA_CONSULTA, [
    precoDaConsulta(),
  ]);
  await modeloResponde(c, "Quero marcar à tarde", OFERTA_DA_TARDE, [
    ferramenta("buscar_horario", busca({ periodo: "tarde" })),
  ]);
  await modeloResponde(c, "Quarta às 14h", RESERVOU_QUARTA, [
    ferramenta("reservar_horario", { horario: "h2" }),
  ]);
  const t4 = await modeloResponde(
    c,
    "Maria da Silva Souza, nascida em 12/03/1985",
    CONFIRMA_QUARTA,
    [dadosCompletos()],
  );
  expect(t4.estado.etapa).toBe("aguardando_confirmacao");
  expect(c.reservasVivas).toHaveLength(1);
}

/**
 * Seis falas de uma conversa em andamento: o preço, o endereço, a oferta, a
 * reserva de quarta, o nome e o estacionamento. Falta só o nascimento.
 */
async function conversaEmAndamento(c: ConversaLonga) {
  await modeloResponde(c, "Oi, quanto custa a consulta?", PRECO_DA_CONSULTA, [
    precoDaConsulta(),
  ]);
  await modeloResponde(
    c,
    "Onde fica a clínica?",
    `A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`,
    [ferramenta("consultar_unidades", { unidade: "u1" })],
  );
  await modeloResponde(c, "Quero marcar à tarde", OFERTA_DA_TARDE, [
    ferramenta("buscar_horario", busca({ periodo: "tarde" })),
  ]);
  await modeloResponde(c, "Quarta às 14h", RESERVOU_QUARTA, [
    ferramenta("reservar_horario", { horario: "h2" }),
  ]);
  await modeloResponde(
    c,
    "Meu nome é Maria da Silva Souza",
    "Obrigada! Agora só falta sua data de nascimento.",
    [soONome()],
  );
  await modeloResponde(c, "Tem estacionamento?", ESTACIONAMENTO, [
    ferramenta("consultar_unidades", { unidade: "u1" }),
  ]);
  expect(c.dados).toMatchObject({
    nome_completo: true,
    data_nascimento: false,
    faltam: ["data_nascimento"],
  });
  expect(c.reservasVivas).toHaveLength(1);
}

/** Sete falas: a conversa em andamento, o nascimento e o "Confirma" no ar. */
async function comAPerguntaConfirmaNoAr(c: ConversaLonga) {
  await conversaEmAndamento(c);
  const t = await modeloResponde(c, "Nasci em 12/03/1985", CONFIRMA_QUARTA, [
    soONascimento(),
  ]);
  expect(t.estado.etapa).toBe("aguardando_confirmacao");
}

/** As quatro falas da marcação da sexta, 30/10 às 14:00 (longe do prazo). */
async function marcarASexta(c: ConversaLonga) {
  await modeloResponde(
    c,
    "Quero marcar uma consulta para a sexta da semana que vem, à tarde",
    OFERTA_DA_SEXTA,
    [
      ferramenta(
        "buscar_horario",
        busca({ a_partir_de: "2026-10-30", periodo: "tarde" }),
      ),
    ],
  );
  await modeloResponde(c, "Às 14h", RESERVOU_SEXTA, [
    ferramenta("reservar_horario", { horario: "h1" }),
  ]);
  const t3 = await modeloResponde(
    c,
    "Maria da Silva Souza, nascida em 12/03/1985",
    CONFIRMA_SEXTA,
    [dadosCompletos()],
  );
  expect(t3.estado.etapa).toBe("aguardando_confirmacao");
  const t4 = await modeloResponde(c, "Confirmo", MARCOU_SEXTA, [
    ferramenta("agendar", {}),
  ]);
  expect(c.consultas).toHaveLength(1);
  expect(t4.estado).toMatchObject({
    etapa: "pos_marcacao",
    desfecho: "marcou",
    appointment_id: c.consultas[0]?.id,
  });
  return c.consultas[0]!;
}

/** Três dias depois: a busca da remarcação e a pergunta fixa (T3). */
async function pedirARemarcacaoParaTerca(c: ConversaLonga) {
  const t1 = await modeloResponde(
    c,
    "Preciso remarcar minha consulta, pode ser na terça de manhã?",
    "Tenho terça, 03/11 às 08:00, na unidade Aldeota. Pode ser?",
    [
      ferramenta("consultar_minhas_consultas", {}),
      ferramenta("buscar_horario_para_remarcar", {
        consulta: "c1",
        a_partir_de: "2026-11-03",
        periodo: "manha",
        hora: null,
        unidade: null,
      }),
    ],
    3 * UM_DIA_MS,
  );
  expect(t1.estado).toMatchObject({
    etapa: "oferta",
    intencao: "remarcar",
    pedido_pendente: "remarcar",
  });
  const t2 = await sistemaResponde(c, "Às 8", T3_TERCA, [
    ferramenta("reservar_horario", { horario: "h1" }),
  ]);
  expect(t2.estado.etapa).toBe("aguardando_confirmacao");
  expect(t2.chamadasAoModelo).toBe(1);
}

/** As três falas da limpeza até o "Confirma". */
async function ateOConfirmaDaLimpeza(c: ConversaLonga) {
  await modeloResponde(
    c,
    "Quero marcar limpeza de pele com a Dra. Ana de manhã",
    OFERTA_DA_LIMPEZA,
    [limpezaComAAna("manha")],
  );
  await modeloResponde(c, "Quinta às 8", RESERVOU_LIMPEZA, [
    ferramenta("reservar_horario", { horario: "h2" }),
  ]);
  const t = await modeloResponde(
    c,
    "Maria da Silva Souza, 12/03/1985",
    CONFIRMA_LIMPEZA,
    [dadosCompletos()],
  );
  expect(t.estado.etapa).toBe("aguardando_confirmacao");
}

/** A busca à noite (sem horário) e a pergunta da lista de espera (T-E1). */
async function ateAPerguntaDaLista(c: ConversaLonga) {
  await modeloResponde(c, "Queria com a Dra. Ana, só à noite.", SEM_NOITE, [
    limpezaComAAna("noite"),
  ]);
  await sistemaResponde(
    c,
    "Lista de espera. Segunda ou quarta.",
    T_E1_ANA_NOITE_SEG_QUA,
    [pedirAListaDaNoite()],
  );
}

const verificadorForaDoAr: Verificador = async () => ({
  tipo: "falha",
  motivo: "timeout",
  modelo: null,
  uso: null,
  httpStatus: null,
});

beforeEach(() => {
  prepararOTeste();
  escrito = [];
  conversaDoTeste = null;
  const capturar = (linha: string | Uint8Array): boolean => {
    escrito.push(String(linha));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  conversaDoTeste?.conferirOsLogs(escrito);
  // O que esta suite promete: conversas longas, em turnos separados.
  expect(conversaDoTeste?.turnos.length ?? 0).toBeGreaterThanOrEqual(8);
  // O aviso de assistente virtual sai uma vez so, em toda a conversa.
  expect(
    conversaDoTeste?.recebidasPeloPaciente.filter((m) =>
      m.includes(FRASE_DO_ASSISTENTE_VIRTUAL),
    ).length ?? 0,
  ).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Os cenários
// ---------------------------------------------------------------------------

describe("1. preço, convênio, endereço, agenda, troca de horário e confirmação", () => {
  it("cada assunto responde com o fato do turno; a troca solta a reserva antiga; só a última vira consulta", async () => {
    const c = clinicaComDuasUnidades();

    const t1 = await modeloResponde(
      c,
      "Oi, quanto custa a consulta?",
      PRECO_DA_CONSULTA,
      [precoDaConsulta()],
    );
    expect(t1.decisao?.tool_used).toBe("buscar_procedimento");
    expect(t1.estado).toMatchObject({ etapa: "informacao", intencao: null });

    const convenio =
      "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional).";
    const t2 = await modeloResponde(c, "Vocês atendem Unimed?", convenio, [
      ferramenta("buscar_procedimento", {
        procedimento: P_CONSULTA,
        convenio: "Unimed Nacional",
      }),
    ]);
    expect(t2.estado).toMatchObject({ etapa: "informacao", intencao: null });

    const endereco = `Temos duas unidades: Aldeota, na ${ENDERECO_DA_ALDEOTA}, e Centro, na ${ENDERECO_DO_CENTRO}.`;
    const t3 = await modeloResponde(c, "Onde fica a clínica?", endereco, [
      ferramenta("consultar_unidades", { unidade: null }),
    ]);
    expect(t3.decisao?.tool_used).toBe("consultar_unidades");

    await modeloResponde(c, "Tem estacionamento?", ESTACIONAMENTO, [
      ferramenta("consultar_unidades", { unidade: "u1" }),
    ]);
    // Quatro respostas sem nenhum passo de agenda: nada reservado.
    expect(c.reservasVivas).toEqual([]);
    expect(c.cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);

    const t5 = await modeloResponde(
      c,
      "Quero marcar uma consulta à tarde, no particular",
      OFERTA_DA_TARDE,
      [ferramenta("buscar_horario", busca({ periodo: "tarde" }))],
    );
    expect(t5.estado).toMatchObject({
      etapa: "oferta",
      intencao: "agendar",
      procedure_id: PROC.consulta,
      particular: true,
    });
    expect(t5.estado.horarios_oferecidos.map((h) => h.codigo)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);

    const t6 = await modeloResponde(c, "Pode ser quarta às 14h", RESERVOU_QUARTA, [
      ferramenta("reservar_horario", { horario: "h2" }),
    ]);
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-21", "14:00") }),
    ]);
    const reservaDeQuarta = t6.estado.slot_hold_id;
    expect(reservaDeQuarta).toBe(c.reservasVivas[0]?.id);
    expect(t6.estado.falhas_seguidas).toBe(0);
    expect(c.dados.faltam).toEqual(["nome_completo", "data_nascimento"]);

    // Muda de horario no meio: a busca e a reserva nova; a antiga sai.
    const trocou =
      "Troquei: reservei quinta, 22/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Agora me envie seu nome completo e sua data de nascimento.";
    const t7 = await modeloResponde(
      c,
      "Mudei de ideia, prefiro quinta às 14h",
      trocou,
      [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-22", hora: "14:00" }),
        ),
        // h5 e o Dr. Bruno no mesmo horario; h6, a Dra. Ana.
        ferramenta("reservar_horario", { horario: "h6" }),
      ],
    );
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-22", "14:00") }),
    ]);
    expect(t7.estado.slot_hold_id).not.toBe(reservaDeQuarta);
    expect(t7.estado.slot_hold_id).toBe(c.reservasVivas[0]?.id);

    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quinta, 22/10 às 14:00, na unidade Centro, no particular?";
    const t8 = await modeloResponde(
      c,
      "Maria da Silva Souza, nascida em 12/03/1985",
      confirma,
      [dadosCompletos()],
    );
    expect(t8.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });
    // Ninguem marcou nada ate o "sim".
    expect(c.consultas).toEqual([]);

    const marcou =
      "Pronto! Sua Consulta de quinta, 22/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.";
    const t9 = await modeloResponde(c, "Sim, confirmo", marcou, [
      ferramenta("agendar", {}),
    ]);
    expect(t9.decisao?.tool_used).toBe("agendar");
    expect(c.consultas).toEqual([
      expect.objectContaining({
        starts_at: iso("2026-10-22", "14:00"),
        unit_id: UNID.centro,
        approval_status: "pendente",
        created_by: "ia",
      }),
    ]);
    expect(t9.estado).toMatchObject({
      etapa: "pos_marcacao",
      desfecho: "marcou",
      appointment_id: c.consultas[0]?.id,
      slot_hold_id: null,
      horarios_oferecidos: [],
      falhas_seguidas: 0,
    });
    expect(c.reservasVivas).toEqual([]);

    // Depois de marcar: o que levar e o agradecimento, sem mexer na consulta.
    const levar =
      "Para a Consulta, leve um documento com foto e chegue 15 minutos antes.";
    const t10 = await modeloResponde(c, "O que eu preciso levar?", levar, [
      ferramenta("consultar_requisitos", {
        procedimento: P_CONSULTA,
        convenio: null,
      }),
    ]);
    expect(t10.estado).toMatchObject({
      etapa: "pos_marcacao",
      appointment_id: c.consultas[0]?.id,
    });
    await modeloResponde(c, "Obrigada!", TCHAU);

    // A conversa inteira: uma mensagem por fala, na ordem; uma decisao aprovada
    // por resposta; uma consulta.
    expect(c.recebidasPeloPaciente).toEqual([
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${PRECO_DA_CONSULTA}`,
      convenio,
      endereco,
      ESTACIONAMENTO,
      OFERTA_DA_TARDE,
      RESERVOU_QUARTA,
      trocou,
      confirma,
      marcou,
      levar,
      TCHAU,
    ]);
    expect(c.decisoes.map((d) => d.desfecho)).toEqual(
      Array.from({ length: 11 }, () => "respondeu"),
    );
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(c.conversa.status).toBe("ia_atendendo");
  });
});

describe("2. marca, dias depois remarca, depois cancela: nunca duas consultas vivas", () => {
  it("outra consulta do mesmo procedimento é recusada; a remarcação aprovada troca uma pela outra; cancela e marca de novo", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);

    // No mesmo dia, outra consulta do mesmo procedimento: o banco recusa.
    const t5 = await modeloResponde(
      c,
      "Quero marcar mais uma consulta na segunda de tarde",
      "Você já tem Consulta marcada na sexta, 30/10 às 14:00. Se quiser, posso ajudar a remarcar ou cancelar.",
      [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-11-02", periodo: "tarde" }),
        ),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    );
    expect(saidasDoTurno(t5).at(-1)).toEqual({
      resultado: "ja_tem_consulta",
      dia: "sexta, 30/10",
      hora: "14:00",
    });
    expect(c.reservasVivas).toEqual([]);
    expect(c.consultas).toHaveLength(1);

    // A equipe aprova; tres dias depois a pessoa remarca.
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);
    expect(c.consultas).toHaveLength(1);

    const t8 = await sistemaResponde(c, "Confirmo", T4_TERCA, [
      ferramenta("agendar", {}),
    ]);
    const nova = c.consultas.find((a) => a.remarcacao_de === consulta.id);
    expect(nova).toMatchObject({
      starts_at: iso("2026-11-03", "08:00"),
      approval_status: "pendente",
      created_by: "ia",
    });
    // A antiga continua de pe ate a aprovacao: a de valer e uma so.
    expect(consulta.status).toBe("agendado");
    expect(c.consultasVivas).toHaveLength(2);
    expect(t8.estado).toMatchObject({
      etapa: "pos_marcacao",
      intencao: "remarcar",
      pedido_pendente: null,
      appointment_id: nova?.id,
      slot_hold_id: null,
      desfecho: "remarcou",
    });
    await modeloResponde(
      c,
      "Então está certo?",
      "Sua remarcação para terça, 03/11 às 08:00 está pendente da aprovação da equipe, e a consulta de sexta, 30/10 às 14:00 continua marcada até lá.",
    );

    // A equipe aprova a remarcacao: sobra uma de pe.
    c.equipeAprova(nova!);
    expect(c.consultasVivas).toEqual([nova]);

    // Dois dias depois, a pessoa cancela: a lista so traz a de pe.
    const t10 = await sistemaResponde(
      c,
      "Não vou poder ir, quero cancelar minha consulta",
      "Confirma o cancelamento da sua consulta de terça, 03/11 às 08:00?",
      pedirOCancelamento(),
      2 * UM_DIA_MS,
    );
    expect(saidasDoTurno(t10)[0]).toMatchObject({
      resultado: "consultas",
      consultas: [{ codigo: "c1", dia: "terça, 03/11", hora: "08:00" }],
    });
    expect(t10.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: nova?.id,
    });
    expect(nova?.status).toBe("agendado");

    const t11 = await sistemaResponde(
      c,
      "Sim",
      "Tudo bem, sua consulta de 03/11 às 08:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
      [ferramenta("cancelar_consulta", {})],
    );
    expect(nova?.status).toBe("cancelado_paciente");
    expect(c.consultasVivas).toEqual([]);
    expect(t11.decisao?.tool_used).toBe("cancelar_consulta");
    expect(c.cenario.banco.linhas("appointment_status_history")).toEqual([
      expect.objectContaining({
        appointment_id: nova?.id,
        changed_by: "ia",
        ia_job_id: t11.job,
      }),
    ]);
    expect(t11.estado).toMatchObject({
      etapa: "informacao",
      intencao: "cancelar",
      pedido_pendente: null,
      desfecho: "cancelou",
      falhas_seguidas: 0,
    });
    await modeloResponde(
      c,
      "Foi cancelada mesmo?",
      "Sim, sua consulta de terça, 03/11 às 08:00 foi cancelada.",
    );
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(2);

    // Cancelou: marcar de novo vale, e os dados voltam a ser pedidos (os de
    // antes foram com a consulta). A cancelada nao fica em foco.
    const t13 = await modeloResponde(
      c,
      "Quero marcar de novo, pode ser na sexta à tarde",
      "Tenho sexta, 30/10 às 14:00 com a Dra. Ana Lima, na unidade Centro. Pode ser?",
      [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-30", periodo: "tarde" }),
        ),
      ],
    );
    expect(t13.estado).toMatchObject({
      etapa: "oferta",
      intencao: "agendar",
      appointment_id: null,
    });
    await modeloResponde(c, "Pode", RESERVOU_SEXTA, [
      ferramenta("reservar_horario", { horario: "h1" }),
    ]);
    expect(c.dados.faltam).toEqual(["nome_completo", "data_nascimento"]);
    await modeloResponde(
      c,
      "Maria da Silva Souza, nascida em 12/03/1985",
      CONFIRMA_SEXTA,
      [dadosCompletos()],
    );
    await modeloResponde(c, "Sim", MARCOU_SEXTA, [ferramenta("agendar", {})]);
    expect(c.consultasVivas).toEqual([
      expect.objectContaining({
        starts_at: iso("2026-10-30", "14:00"),
        approval_status: "pendente",
      }),
    ]);
  });

  it("cancelar com a remarcação pendente fica com a equipe: as duas consultas continuam como estavam", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);
    await sistemaResponde(c, "Confirmo", T4_TERCA, [ferramenta("agendar", {})]);
    const nova = c.consultas.find((a) => a.remarcacao_de === consulta.id);

    const t = await c.fala({
      texto: "Mudei de ideia, quero cancelar a consulta",
      roteiro: pedirOCancelamento(),
    });
    passou(t, { desfecho: "escalou", motivo: "pedido_de_agenda" });
    expect(consulta.status).toBe("agendado");
    expect(nova?.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c.notasInternas.at(-1)).toContain("Resumo do assistente");

    await nadaMaisSai(c, ["Sim", "Pode cancelar", "Alguém aí?"]);
    expect(consulta.status).toBe("agendado");
    expect(nova?.status).toBe("agendado");
  });

  it("marca para perto e, já dentro do prazo, pede para cancelar: fica com a equipe, e a consulta não muda", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);
    await modeloResponde(c, "Sim", MARCOU_QUARTA, [ferramenta("agendar", {})]);
    const consulta = c.consultas[0]!;
    c.equipeAprova(consulta);

    // Oito horas depois, faltam 21 horas: o prazo da clinica e 24.
    const t9 = await c.fala(
      {
        texto: "Não vou poder ir, quero cancelar",
        roteiro: pedirOCancelamento(),
      },
      8 * 60 * 60_000,
    );
    passou(t9, { desfecho: "escalou", motivo: "fora_do_prazo" });
    expect(consulta.status).toBe("agendado");
    expect(c.notasInternas.at(-1)).toContain("prazo da clínica");
    await nadaMaisSai(c, ["Sim", "Pode cancelar"]);
    expect(consulta.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });
});

describe("3. sem horário bom: a lista de espera e depois a marcação do mesmo procedimento", () => {
  it("entra uma vez só; pedir de novo é ja_na_lista; marcar deixa uma consulta; repetir a marcação é recusado", async () => {
    const c = clinicaDeUmaUnidade();
    await modeloResponde(c, "Quanto custa a limpeza de pele?", PRECO_DA_LIMPEZA, [
      precoDaLimpeza(),
    ]);
    await ateAPerguntaDaLista(c);
    const t2 = c.turnos.at(-2)!;
    expect(saidasDoTurno(t2)[0]).toMatchObject({ resultado: "sem_horario" });
    expect(t2.estado).toMatchObject({
      procedure_id: PROC.limpeza,
      professional_id: PROF.ana,
      particular: true,
    });
    expect(c.cenario.fila).toEqual([]);
    expect(c.cenario.pedidos).toHaveLength(1);

    const t4 = await sistemaResponde(c, "Sim", T_E2_ANA_NOITE_SEG_QUA, [
      ferramenta("entrar_na_lista_de_espera", {}),
    ]);
    expect(c.cenario.fila).toEqual([
      expect.objectContaining({
        active: true,
        origem: "ia",
        ia_job_id: t4.job,
        procedure_id: PROC.limpeza,
        preferred_shifts: ["noite"],
        preferred_weekdays: [1, 3],
      }),
    ]);
    expect(t4.decisao?.tool_used).toBe("entrar_na_lista_de_espera");
    expect(c.eventos).toContain(
      "A IA colocou o paciente na lista de espera: Limpeza de pele, Dra. Ana Lima, particular. Preferência: noite; segunda e quarta.",
    );

    // O turno seguinte le a entrada: dizer que esta na lista vale.
    await modeloResponde(
      c,
      "Estou mesmo na lista?",
      "Sim, você está na lista de espera para Limpeza de pele, com Dra. Ana Lima, à noite, às segundas e às quartas.",
    );

    // Pedir de novo: uma entrada so.
    const t6 = await modeloResponde(
      c,
      "Me coloca também para as quintas",
      "Você já está na lista de espera para a Limpeza de pele com a Dra. Ana Lima, à noite, às segundas e às quartas.",
      [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["quinta"],
        }),
      ],
    );
    expect(saidasDoTurno(t6)[0]).toMatchObject({ resultado: "ja_na_lista" });
    expect(c.cenario.fila).toHaveLength(1);

    // Desiste de esperar: marca de manha, o mesmo procedimento.
    const t7 = await modeloResponde(
      c,
      "Melhor marcar de manhã mesmo",
      OFERTA_DA_LIMPEZA,
      [limpezaComAAna("manha")],
    );
    expect(t7.estado.etapa).toBe("oferta");
    await modeloResponde(c, "Quinta às 8", RESERVOU_LIMPEZA, [
      ferramenta("reservar_horario", { horario: "h2" }),
    ]);
    const t9 = await modeloResponde(
      c,
      "Maria da Silva Souza, 12/03/1985",
      CONFIRMA_LIMPEZA,
      [dadosCompletos()],
    );
    expect(t9.estado.etapa).toBe("aguardando_confirmacao");
    await modeloResponde(c, "Confirmo", MARCOU_LIMPEZA, [
      ferramenta("agendar", {}),
    ]);
    expect(c.consultas).toHaveLength(1);
    // A entrada fica na fila (a reoferta le o predicado e nao oferece a quem
    // ja tem a consulta do mesmo procedimento): nunca duas entradas.
    expect(c.cenario.fila).toEqual([
      expect.objectContaining({ active: true, ia_job_id: t4.job }),
    ]);

    // Com a consulta marcada, outra do mesmo procedimento: recusada.
    const t11 = await modeloResponde(
      c,
      "Queria marcar outra limpeza de pele na sexta de manhã",
      "Você já tem Limpeza de pele marcada na quinta, 22/10 às 08:00.",
      [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ a_partir_de: "2026-10-23", periodo: "manha" }),
        ),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    );
    expect(saidasDoTurno(t11).at(-1)).toEqual({
      resultado: "ja_tem_consulta",
      dia: "quinta, 22/10",
      hora: "08:00",
    });
    expect(c.consultas).toHaveLength(1);
    expect(c.reservasVivas).toEqual([]);
  });

  it("com a consulta já marcada, pedir a lista do mesmo procedimento é recusado (D-41); o 'sim' solto depois não entra em lista nenhuma", async () => {
    const c = clinicaDeUmaUnidade();
    await ateOConfirmaDaLimpeza(c);
    await modeloResponde(c, "Sim", MARCOU_LIMPEZA, [ferramenta("agendar", {})]);
    await modeloResponde(
      c,
      "Tem à noite, se abrir vaga?",
      "Não tenho horário à noite com a Dra. Ana Lima. Se preferir outro período, posso procurar.",
      [limpezaComAAna("noite")],
    );
    const t6 = await modeloResponde(
      c,
      "Então me coloca na lista de espera para a noite",
      "Você já tem Limpeza de pele marcada na quinta, 22/10 às 08:00, então não precisa da lista de espera.",
      [ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: [] })],
    );
    expect(saidasDoTurno(t6)[0]).toMatchObject({ resultado: "ja_tem_consulta" });
    expect(c.cenario.pedidos).toEqual([]);
    expect(c.cenario.fila).toEqual([]);

    const t7 = await modeloResponde(
      c,
      "Sim",
      "Tudo certo então. Posso ajudar em mais alguma coisa?",
      [ferramenta("entrar_na_lista_de_espera", {})],
    );
    expect(saidasDoTurno(t7)[0]).toEqual({ resultado: "sem_pergunta_de_espera" });
    expect(c.cenario.fila).toEqual([]);
    expect(t7.estado.falhas_seguidas).toBe(1);

    await modeloResponde(c, "Obrigada", TCHAU);
    expect(c.consultas).toHaveLength(1);
  });
});

describe("4. o sinal de emergência no meio da marcação", () => {
  /** A passagem por urgência: sem modelo, a marca e a frase de sempre. */
  function passouPorUrgencia(c: ConversaLonga, t: TurnoDaConversa) {
    passou(
      t,
      { desfecho: "escalou", motivo: "urgencia", gatilho: "urgencia" },
      0,
    );
    expect(t.doLaco).toBeNull();
    expect(c.conversa.assignee_user_id).toBeNull();
    expect(trilhaDoTurno(t)).toContain(PASSO_DA_URGENCIA);
    expect(c.passagens.at(-1)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: true,
    });
    expect(c.executor.linhas("conversa_urgente")).toEqual([
      expect.objectContaining({ job_id: t.job, encerrada_em: null }),
    ]);
    // A urgencia nunca atribui.
    expect(c.executor.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(t.decisao?.tokens_entrada).toBe(0);
  }

  it("com o 'Confirma' no ar: passa como urgente e nenhuma mensagem nova chega ao modelo, nem o 'sim'", async () => {
    const c = clinicaComDuasUnidades();
    await ateOConfirmaDeQuarta(c);
    passouPorUrgencia(
      c,
      await c.fala({ texto: "Espera, estou com dor no peito e falta de ar" }),
    );
    await nadaMaisSai(c, [
      "Sim, confirmo",
      "alô?",
      "tem alguém aí?",
      "Quanto custa a consulta?",
      "Quero cancelar tudo",
    ]);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(c.conversa.status).toBe("aguardando_humano");
    expect(
      c.recebidasPeloPaciente.filter((m) => m === FRASE_DE_ESCALONAMENTO),
    ).toHaveLength(1);
  });

  it("o sinal partido numa rajada ('to com dor' e 'no peito') também passa como urgente", async () => {
    const c = clinicaComDuasUnidades();
    await ateOConfirmaDeQuarta(c);
    passouPorUrgencia(c, await c.rajada(["to com dor", "no peito"], {}));
    await nadaMaisSai(c, ["Sim", "Confirmo", "oi?", "por favor"]);
    expect(c.consultas).toEqual([]);
  });

  it("a emergência que chega no meio do turno do 'sim': nada é marcado, nada sai, e o job seguinte passa como urgente", async () => {
    const c = clinicaComDuasUnidades();
    await ateOConfirmaDeQuarta(c);
    const t5 = await c.fala({
      texto: "Sim, confirmo",
      roteiro: [ferramenta("agendar", {})],
      durante: () => {
        c.escreve("to com dor no peito");
      },
    });
    expect(t5.enviadas).toEqual([]);
    expect(oQueDecidiu(t5)).toMatchObject({
      desfecho: "falhou",
      falha: "sem_mensagem",
      motivo: null,
    });
    expect(t5.statusDaConversa).toBe("ia_atendendo");
    expect(c.consultas).toEqual([]);
    expect(c.temJobPendente).toBe(true);

    passouPorUrgencia(c, await c.rodarOJobPendente({}));
    expect(c.consultas).toEqual([]);
    await nadaMaisSai(c, ["Sim", "alô?"]);
    expect(c.temJobPendente).toBe(false);
  });

  it("depois de marcar: a consulta fica como está, e o pedido de cancelar depois da passagem não chega a lugar nenhum", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    passouPorUrgencia(c, await c.fala({ texto: "to com falta de ar, o que eu faço" }));
    await nadaMaisSai(c, [
      "Preciso cancelar minha consulta",
      "Sim",
      "Quero remarcar",
      "Me responde",
    ]);
    expect(consulta.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });
});

describe("5. o pedido clínico no meio da conversa e o que fica com a equipe", () => {
  const CLINICA_DEPOIS = "E depois da consulta, como fica?";
  const USO = {
    tokensEntrada: 100,
    tokensSaida: 10,
    tokensCacheLidos: 0,
    tokensCacheGravados: 0,
  };
  type CasoClinico = {
    nome: string;
    fala: FalaDaConversa;
    esperado: Partial<ReturnType<typeof oQueDecidiu>>;
    /** O texto do modelo que nunca pode chegar ao paciente. */
    doModelo?: string;
    chamadas: number;
  };
  const casos: CasoClinico[] = [
    {
      nome: "'é normal doer?': o portão, sem modelo",
      fala: { texto: "É normal doer depois da consulta?" },
      esperado: { desfecho: "escalou", motivo: "sintoma", gatilho: "sintoma" },
      chamadas: 0,
    },
    {
      nome: "'posso tomar remédio?': o portão, sem modelo",
      fala: { texto: "Posso tomar remédio antes da consulta?" },
      esperado: {
        desfecho: "escalou",
        motivo: "assunto_clinico",
        gatilho: "assunto_clinico",
      },
      chamadas: 0,
    },
    {
      nome: "a paráfrase que o portão não pega: o classificador, sem o agente",
      fala: {
        texto: "Isso resolve meu problema?",
        classificacao: {
          tipo: "classificacao",
          classificacao: { gatilhos: ["assunto_clinico"], confianca: "alta" },
          modelo: "gpt-6-luna",
          uso: USO,
        },
      },
      esperado: {
        desfecho: "escalou",
        motivo: "assunto_clinico",
        gatilho: "assunto_clinico",
      },
      chamadas: 0,
    },
    {
      nome: "o classificador fora do ar: falha fechada, sem o agente",
      fala: {
        texto: CLINICA_DEPOIS,
        classificacao: {
          tipo: "falha",
          motivo: "timeout",
          modelo: null,
          uso: null,
          httpStatus: null,
        },
      },
      esperado: {
        desfecho: "falhou",
        motivo: "falha_tecnica",
        falha: "timeout",
      },
      chamadas: 0,
    },
    {
      nome: "o modelo que escreve orientação clínica: a regra barra",
      fala: {
        texto: CLINICA_DEPOIS,
        roteiro: [
          final(
            "É normal doer um pouco. Pode tomar dipirona 500 mg de 6 em 6 horas.",
          ),
        ],
      },
      doModelo:
        "É normal doer um pouco. Pode tomar dipirona 500 mg de 6 em 6 horas.",
      esperado: {
        desfecho: "bloqueou",
        motivo: "conformidade",
        camada: "regra",
      },
      chamadas: 1,
    },
    {
      nome: "a paráfrase que a regra não pega: o verificador por modelo barra",
      fala: {
        texto: CLINICA_DEPOIS,
        roteiro: [final("Fico à disposição para o que precisar.")],
        verificador: async () => ({
          tipo: "veredicto",
          veredicto: {
            aprovado: false,
            violacoes: [{ categoria: "orientacao_clinica", gravidade: "alta" }],
            confianca: "alta",
          },
          modelo: "gpt-6-luna",
          uso: USO,
        }),
      },
      doModelo: "Fico à disposição para o que precisar.",
      esperado: {
        desfecho: "bloqueou",
        motivo: "conformidade",
        regra: "orientacao_clinica",
        camada: "modelo",
      },
      chamadas: 1,
    },
    {
      nome: "o verificador fora do ar: falha fechada",
      fala: {
        texto: CLINICA_DEPOIS,
        roteiro: [final("Posso ajudar com a sua marcação.")],
        verificador: verificadorForaDoAr,
      },
      doModelo: "Posso ajudar com a sua marcação.",
      esperado: {
        desfecho: "bloqueou",
        motivo: "conformidade",
        regra: "falha_verificador",
        camada: "falha",
        falha: "timeout",
      },
      chamadas: 1,
    },
    {
      nome: "o modelo que passa para a equipe",
      fala: {
        texto: CLINICA_DEPOIS,
        roteiro: [ferramenta("escalar_humano", { motivo: "assunto_clinico" })],
      },
      esperado: { desfecho: "escalou", motivo: "assunto_clinico" },
      chamadas: 1,
    },
    {
      nome: "a consulta para outra pessoa adulta: o portão, sem modelo",
      fala: { texto: "Na verdade a consulta é para minha mãe" },
      esperado: { desfecho: "escalou", motivo: "consulta_para_outra_pessoa" },
      chamadas: 0,
    },
    {
      nome: "o pedido de falar com uma pessoa: o portão, sem modelo",
      fala: { texto: "Quero falar com uma pessoa" },
      esperado: {
        desfecho: "escalou",
        motivo: "pedido_humano",
        gatilho: "pedido_humano",
      },
      chamadas: 0,
    },
    {
      nome: "o nascimento de menor de idade: o banco recusa e o servidor passa, sem o texto do modelo",
      fala: {
        texto: "Nasci em 12/03/2012",
        roteiro: [
          ferramenta("registrar_dados_do_paciente", {
            nome_completo: null,
            data_nascimento: "2012-03-12",
            para_o_titular: true,
            campos_mascarados: [],
          }),
        ],
      },
      esperado: { desfecho: "escalou", motivo: "menor_de_idade" },
      chamadas: 1,
    },
    {
      nome: "a ferramenta que não existe, num turno tardio: falha fechada",
      fala: {
        texto: CLINICA_DEPOIS,
        roteiro: [ferramenta("apagar_a_agenda", {})],
      },
      esperado: {
        desfecho: "falhou",
        motivo: "falha_tecnica",
        falha: "ferramenta_invalida",
      },
      chamadas: 1,
    },
    {
      nome: "o modelo que não chega a uma resposta, num turno tardio: falha fechada",
      fala: {
        texto: CLINICA_DEPOIS,
        roteiro: [
          ferramenta("consultar_unidades", { unidade: null }),
          ferramenta("consultar_unidades", { unidade: "u1" }),
          ferramenta("consultar_unidades", { unidade: "u2" }),
          ferramenta("consultar_unidades", { unidade: null }),
        ],
      },
      esperado: {
        desfecho: "falhou",
        motivo: "falha_tecnica",
        falha: "rodadas_esgotadas",
      },
      chamadas: 4,
    },
  ];

  it.each(casos)("$nome", async ({ fala, esperado, doModelo, chamadas }) => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);

    const t = await c.fala(fala);
    passou(t, esperado, chamadas);
    if (doModelo !== undefined) {
      expect(c.recebidasPeloPaciente.join("\n")).not.toContain(doModelo);
      if (esperado.desfecho === "bloqueou") {
        // O rascunho fica so no lugar restrito, nunca na decisao.
        expect(c.rascunhosBloqueados).toHaveLength(1);
        expect(c.rascunhosBloqueados[0]?.decision_id).toBe(t.decisao?.id);
        expect(JSON.stringify(t.decisao)).not.toContain(doModelo);
      }
    }
    // O atendimento fica contado para a equipe (a reserva, nunca o valor de um
    // dado) e o que a pessoa ja informou nao se perde.
    expect(t.estado.desfecho).toBe("passou_para_equipe");
    expect(c.dados.nome_completo).toBe(true);
    const nota = c.notasInternas.at(-1) ?? "";
    expect(nota).toContain("Resumo do assistente");
    expect(nota).toContain("quarta, 21/10 às 14:00");

    await nadaMaisSai(c, ["Sim", "Nasci em 12/03/1985", "E aí, é normal?"]);
    expect(c.consultas).toEqual([]);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(
      c.recebidasPeloPaciente.filter((m) => m === FRASE_DE_ESCALONAMENTO),
    ).toHaveLength(1);
    expect(c.passagens).toHaveLength(1);
  });
});

describe("6. o modelo que diz que fez sem ter feito, num turno tardio", () => {
  function barrado(
    c: ConversaLonga,
    t: TurnoDaConversa,
    doModelo: string,
    regra = "acao_nao_executada",
  ) {
    passou(t, {
      desfecho: "bloqueou",
      regra,
      motivo: "conformidade",
      camada: "regra",
    });
    expect(t.ferramentas).toEqual([]);
    expect(c.rascunhosBloqueados).toEqual([
      expect.objectContaining({ texto: doModelo, decision_id: t.decisao?.id }),
    ]);
  }

  it("'Está marcado!' sem reservar nada: a regra barra, e o 'sim' seguinte não marca", async () => {
    const c = clinicaComDuasUnidades();
    await modeloResponde(c, "Oi, quanto custa a consulta?", PRECO_DA_CONSULTA, [
      precoDaConsulta(),
    ]);
    await modeloResponde(
      c,
      "Onde fica a clínica?",
      `A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`,
      [ferramenta("consultar_unidades", { unidade: "u1" })],
    );
    await modeloResponde(c, "Tem estacionamento?", ESTACIONAMENTO, [
      ferramenta("consultar_unidades", { unidade: "u1" }),
    ]);
    await modeloResponde(
      c,
      "Tem acesso para cadeira de rodas?",
      "Na unidade Aldeota o acesso é por rampa e elevador.",
      [ferramenta("consultar_unidades", { unidade: "u1" })],
    );
    await modeloResponde(
      c,
      "O que eu preciso levar?",
      "Para a Consulta, leve um documento com foto e chegue 15 minutos antes.",
      [
        ferramenta("consultar_requisitos", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
      ],
    );
    await modeloResponde(c, "Quero marcar à tarde", OFERTA_DA_TARDE, [
      ferramenta("buscar_horario", busca({ periodo: "tarde" })),
    ]);
    await modeloResponde(
      c,
      "Deixa eu ver minha agenda",
      "Claro, sem pressa. Me diga qual prefere.",
    );
    expect(c.reservasVivas).toEqual([]);

    const alucinou = "Está marcado!";
    const t8 = await c.fala({
      texto: "Pode marcar quarta às 14h",
      roteiro: [final(alucinou)],
    });
    barrado(c, t8, alucinou);
    expect(c.cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    await nadaMaisSai(c, ["Sim", "Obrigada"]);
    expect(c.consultas).toEqual([]);
  });

  it.each([
    ["'Está marcado!'", "Está marcado!"],
    [
      "com o dia e a hora da reserva",
      "Está marcado! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada.",
    ],
  ])(
    "o 'sim' ao 'Confirma' com o modelo que responde %s sem chamar agendar: barrado; a reserva não vira consulta",
    async (_nome, alucinou) => {
      const c = clinicaComDuasUnidades();
      await comAPerguntaConfirmaNoAr(c);
      const t = await c.fala({
        texto: "Sim, confirmo",
        roteiro: [final(alucinou)],
      });
      barrado(c, t, alucinou);
      expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
      expect(c.reservasVivas).toHaveLength(1);
      await nadaMaisSai(c, ["Sim", "Confirmado?"]);
      expect(c.consultas).toEqual([]);
    },
  );

  it.each([
    ["cancelou", "Quero cancelar minha consulta", "Pronto, cancelei sua consulta."],
    [
      "remarcou",
      "Quero remarcar para segunda",
      "Pronto, remarquei sua consulta para segunda, 02/11 às 14:00.",
    ],
    [
      "entrou na lista",
      "Me coloca na lista de espera",
      "Pronto, você entrou na lista de espera.",
    ],
  ])(
    "depois de marcar de verdade, o modelo diz que %s sem a ferramenta: barrado; a consulta fica",
    async (_nome, texto, alucinou) => {
      const c = clinicaComDuasUnidades();
      const consulta = await marcarASexta(c);
      await modeloResponde(c, "Qual é mesmo o horário?", HORARIO_DA_SEXTA);
      await conversaFiada(c, ["Obrigada", "Vou ver uma coisa aqui"]);
      barrado(c, await c.fala({ texto, roteiro: [final(alucinou)] }), alucinou);
      expect(consulta.status).toBe("agendado");
      expect(c.consultasVivas).toEqual([consulta]);
      expect(c.cenario.fila).toEqual([]);
      await nadaMaisSai(c, ["Sim", "Obrigada"]);
    },
  );

  it("a T1 no ar, o 'sim' e o modelo que diz que cancelou sem a ferramenta: barrado", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    const { c1 } = consultasDoContato(c.cenario.banco);
    await sistemaResponde(
      c,
      "Preciso cancelar minha consulta de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
      20_000,
    );
    const alucinou = "Pronto, cancelei sua consulta de quinta, 22/10 às 14:00.";
    barrado(
      c,
      await c.fala({ texto: "Sim", roteiro: [final(alucinou)] }, 20_000),
      alucinou,
    );
    expect(c1.status).toBe("agendado");
    await nadaMaisSai(c, ["Sim"]);
  });

  it("a T3 no ar, o 'sim' e o modelo que diz que remarcou sem a ferramenta: barrado", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);
    await modeloResponde(c, "Oi", CERTO, [], 20_000);
    const alucinou = "Pronto, remarquei sua consulta para terça, 03/11 às 08:00.";
    barrado(
      c,
      await c.fala({ texto: "Sim", roteiro: [final(alucinou)] }, 20_000),
      alucinou,
    );
    expect(c.consultas).toEqual([consulta]);
    await nadaMaisSai(c, ["Sim"]);
  });

  it("a T-E1 no ar, o 'sim' e o modelo que diz que entrou na lista sem a ferramenta: barrado", async () => {
    const c = clinicaDeUmaUnidade();
    for (const texto of [
      "Quanto custa a limpeza de pele?",
      "Quanto custa mesmo?",
      "Desculpa, quanto era?",
      "Certo, e o valor é esse mesmo?",
      "Só para confirmar o preço?",
    ]) {
      await modeloResponde(c, texto, PRECO_DA_LIMPEZA, [precoDaLimpeza()]);
    }
    await ateAPerguntaDaLista(c);
    const alucinou = "Pronto, você entrou na lista de espera.";
    barrado(c, await c.fala({ texto: "Sim", roteiro: [final(alucinou)] }), alucinou);
    expect(c.cenario.fila).toEqual([]);
    await nadaMaisSai(c, ["Sim"]);
  });

  it.each([
    [
      "o preço",
      "A consulta custa R$ 300,00 com a Dra. Ana Lima.",
      "preco_nao_verificado",
    ],
    [
      "o endereço",
      `A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`,
      "endereco_nao_verificado",
    ],
    [
      "o convênio",
      "A Consulta é atendida pela Unimed (Nacional).",
      "cobertura_nao_verificada",
    ],
    ["um horário", "Tenho quarta, 21/10 às 15:00.", "horario_nao_verificado"],
  ])(
    "o modelo que repete de cabeça %s, já dito em turnos anteriores: só sai com a ferramenta do turno",
    async (_nome, deCabeca, regra) => {
      const c = clinicaComDuasUnidades();
      await conversaEmAndamento(c);
      await modeloResponde(
        c,
        "Vocês atendem Unimed?",
        "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional).",
        [
          ferramenta("buscar_procedimento", {
            procedimento: P_CONSULTA,
            convenio: "Unimed Nacional",
          }),
        ],
      );
      barrado(
        c,
        await c.fala({
          texto: "Pode repetir, por favor?",
          roteiro: [final(deCabeca)],
        }),
        deCabeca,
        regra,
      );
      await nadaMaisSai(c, ["Sim"]);
    },
  );

  it("com a reserva vencida, dizer que continua reservado é barrado", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    await conversaFiada(c, ["Vou ver uma coisa aqui"]);
    const alucinou = "Seu horário continua reservado.";
    barrado(
      c,
      await c.fala(
        { texto: "Ainda está reservado?", roteiro: [final(alucinou)] },
        11 * UM_MINUTO_MS,
      ),
      alucinou,
    );
    expect(c.reservasVivas).toEqual([]);
    await nadaMaisSai(c, ["Sim"]);
  });

  // achado: "A equipe já aprovou sua consulta." passa pela regra com a consulta
  // ainda pendente (a mesma frase da remarcacao e barrada). Nenhuma regra
  // confere a aprovacao afirmada na marcacao: o paciente le que esta aprovada,
  // e a equipe ainda pode recusar. Devia barrar (acao_nao_executada). Sobra so
  // o verificador por modelo, que aqui e o falso que aprova.
  it.fails("com a consulta pendente, dizer que a equipe já aprovou não pode sair", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    await modeloResponde(c, "Qual é mesmo o horário?", HORARIO_DA_SEXTA);
    await conversaFiada(c, ["Obrigada", "Vou ver uma coisa aqui"]);
    expect(consulta.approval_status).toBe("pendente");
    const alucinou = "A equipe já aprovou sua consulta.";
    barrado(
      c,
      await c.fala({ texto: "Já aprovaram?", roteiro: [final(alucinou)] }),
      alucinou,
    );
  });

  // achado: depois de marcar UMA consulta de verdade, a resposta sem dia e sem
  // hora que afirma outra marcacao ("Está marcado!", "Marquei sua limpeza de
  // pele.", "Sua limpeza de pele está marcada.") passa pela regra: o fato
  // "marcada nesta conversa" nao diz de QUAL procedimento (fatos-do-turno.ts,
  // sustentada por marcadaNestaConversa) e so a frase com dia ou hora e
  // conferida contra o par. Devia barrar (acao_nao_executada): nenhuma
  // ferramenta rodou no turno e o procedimento pedido nao foi marcado. Sobra
  // so o verificador por modelo, que aqui e o falso que aprova.
  it.fails("depois de marcar uma consulta, 'Está marcado!' para OUTRO procedimento, sem nenhuma ferramenta: não pode sair", async () => {
    const c = clinicaComDuasUnidades();
    await marcarASexta(c);
    await modeloResponde(c, "E a limpeza de pele, quanto custa?", PRECO_DA_LIMPEZA, [
      ferramenta("buscar_procedimento", {
        procedimento: codigoDoProcedimento(CADASTRO, PROC.limpeza),
        convenio: null,
      }),
    ]);
    await conversaFiada(c, ["Vou pensar", "Já volto"]);
    const alucinou = "Está marcado!";
    barrado(
      c,
      await c.fala({
        texto: "Pode marcar a limpeza de pele para segunda de manhã",
        roteiro: [final(alucinou)],
      }),
      alucinou,
    );
  });
});

describe("7. muda de assunto várias vezes e volta para a marcação", () => {
  /** O bloco do estado que o modelo leu na primeira chamada do turno. */
  function blocoDoEstado(t: TurnoDaConversa): string {
    return (
      String(t.corpos[0]?.instructions ?? "")
        .split("\n<atendimento_em_andamento>\n")[1]
        ?.split("\n</atendimento_em_andamento>")[0] ?? ""
    );
  }

  it("a coleta não recomeça: o nome fica de uma fala para a outra, mesmo com a reserva vencendo no meio", async () => {
    const c = clinicaComDuasUnidades();
    await modeloResponde(c, "Quero marcar uma consulta à tarde", OFERTA_DA_TARDE, [
      ferramenta("buscar_horario", busca({ periodo: "tarde" })),
    ]);
    const t2 = await modeloResponde(c, "Quarta às 14h", RESERVOU_QUARTA, [
      ferramenta("reservar_horario", { horario: "h2" }),
    ]);
    const reserva = t2.estado.slot_hold_id;
    expect(reserva).not.toBeNull();
    await modeloResponde(
      c,
      "Meu nome é Maria da Silva Souza",
      "Obrigada! Agora só falta sua data de nascimento.",
      [soONome()],
    );
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: false,
      faltam: ["data_nascimento"],
    });

    /** Nada do que importa para marcar mudou com o assunto de fora. */
    const nadaMudou = (t: TurnoDaConversa) => {
      expect(t.estado).toMatchObject({
        etapa: "oferta",
        intencao: "agendar",
        procedure_id: PROC.consulta,
        slot_hold_id: reserva,
        falhas_seguidas: 0,
      });
      expect(t.estado.horarios_oferecidos.map((h) => h.codigo)).toEqual([
        "h1",
        "h2",
        "h3",
        "h4",
      ]);
      expect(c.dados.faltam).toEqual(["data_nascimento"]);
      // O modelo le o que ja tem e o que falta: nao precisa pedir de novo.
      expect(blocoDoEstado(t)).toContain("Dados já informados: nome completo.");
      expect(blocoDoEstado(t)).toContain(
        "Dados que faltam para marcar: data de nascimento.",
      );
    };

    nadaMudou(
      await modeloResponde(
        c,
        "Só uma dúvida, quanto custa a consulta?",
        PRECO_DA_CONSULTA,
        [precoDaConsulta()],
      ),
    );
    // O preco de outro procedimento nao troca o pedido da marcacao.
    nadaMudou(
      await modeloResponde(c, "E a limpeza de pele?", PRECO_DA_LIMPEZA, [
        ferramenta("buscar_procedimento", {
          procedimento: codigoDoProcedimento(CADASTRO, PROC.limpeza),
          convenio: null,
        }),
      ]),
    );
    nadaMudou(
      await modeloResponde(
        c,
        "Onde fica mesmo?",
        `A unidade Centro fica na ${ENDERECO_DO_CENTRO}.`,
        [ferramenta("consultar_unidades", { unidade: "u2" })],
      ),
    );
    expect(c.reservasVivas).toHaveLength(1);

    // Doze minutos depois da reserva: ela venceu. O fora do assunto responde a
    // frase do dono e o estado fica sem a reserva, com os horarios e o nome.
    const t7 = await c.fala({
      texto: "Quem ganhou o jogo ontem?",
      roteiro: [ferramenta("fora_do_assunto", {})],
    });
    respondeu(t7, FRASE_FORA_DO_ASSUNTO);
    expect(t7.decisao?.tool_used).toBe("fora_do_assunto");
    expect(c.reservasVivas).toEqual([]);
    expect(t7.estado).toMatchObject({
      etapa: "oferta",
      slot_hold_id: null,
      procedure_id: PROC.consulta,
      falhas_seguidas: 0,
    });
    expect(c.dados).toMatchObject({
      nome_completo: true,
      faltam: ["data_nascimento"],
    });

    // Volta: o nascimento e o mesmo horario, reservado de novo. So o que faltava
    // e pedido: o nome nao volta.
    const t8 = await modeloResponde(
      c,
      "Voltando: nasci em 12/03/1985 e pode ser aquela de quarta às 14h",
      CONFIRMA_QUARTA,
      [soONascimento(), ferramenta("reservar_horario", { horario: "h2" })],
    );
    expect(blocoDoEstado(t8)).toContain("Dados já informados: nome completo.");
    expect(saidasDoTurno(t8)).toEqual([
      {
        resultado: "registrado",
        registrados: ["data_nascimento"],
        faltam: [],
      },
      expect.objectContaining({ resultado: "reservado", dados_que_faltam: [] }),
    ]);
    expect(t8.estado.etapa).toBe("aguardando_confirmacao");
    expect(t8.estado.slot_hold_id).not.toBe(reserva);
    expect(c.cenario.banco.chamadasDe("registrar_dados_da_marcacao")).toEqual([
      expect.objectContaining({
        p_nome_completo: "Maria da Silva Souza",
        p_data_nascimento: null,
      }),
      expect.objectContaining({
        p_nome_completo: null,
        p_data_nascimento: "1985-03-12",
      }),
    ]);

    await modeloResponde(c, "Sim", MARCOU_QUARTA, [ferramenta("agendar", {})]);
    expect(c.consultas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-21", "14:00") }),
    ]);
    // Os dados das duas falas ficam juntos, ligados a consulta.
    expect(c.cenario.banco.linhas("dados_informados_na_marcacao")).toEqual([
      expect.objectContaining({
        appointment_id: c.consultas[0]?.id,
        nome_completo: "Maria da Silva Souza",
        data_nascimento: "1985-03-12",
      }),
    ]);
  });

  it("muda de pagamento no meio: o nome fica, a carteirinha passa a faltar e a reserva antiga sai", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    const reservaDoParticular = c.estado.slot_hold_id;

    const t7 = await modeloResponde(
      c,
      "Na verdade vou usar a Unimed Nacional, tem quarta às 15h?",
      "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional). Tenho quarta, 21/10 às 15:00, na unidade Centro. Pode ser?",
      [
        ferramenta(
          "buscar_horario",
          busca({
            convenio: "Unimed Nacional",
            a_partir_de: "2026-10-21",
            hora: "15:00",
          }),
        ),
      ],
    );
    expect(t7.estado).toMatchObject({
      insurance_id: CONV.unimed,
      particular: false,
    });
    // A reserva do particular continua ate a pessoa escolher outra.
    expect(t7.estado.slot_hold_id).toBe(reservaDoParticular);
    expect(c.dados.nome_completo).toBe(true);

    const codigoDaUnimed = (
      saidasDoTurno(t7)[0]?.horarios as { codigo: string }[]
    )[0]?.codigo;
    await modeloResponde(
      c,
      "Pode ser",
      "Reservei quarta, 21/10 às 15:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Agora me envie sua data de nascimento e o número da carteirinha.",
      [ferramenta("reservar_horario", { horario: codigoDaUnimed })],
    );
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({
        service_link_id: VINC.consultaAnaUnimed,
        starts_at: iso("2026-10-21", "15:00"),
      }),
    ]);
    // O nome nao volta a faltar; a carteirinha entra, pelo convenio.
    expect(c.dados).toMatchObject({
      nome_completo: true,
      faltam: ["data_nascimento", "carteirinha"],
    });

    const t9 = await modeloResponde(
      c,
      "Carteirinha 12345678, nasci em 12/03/1985",
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 15:00, na unidade Centro, pela Unimed (Nacional)?",
      [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: null,
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: ["carteirinha"],
        }),
      ],
    );
    expect(t9.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados).toMatchObject({ carteirinha: true, faltam: [] });
    // A carteirinha foi lida pelo servidor: nunca foi ao modelo.
    expect(JSON.stringify(c.cenario.corpos)).not.toContain("12345678");

    await modeloResponde(
      c,
      "Sim",
      "Pronto! Sua Consulta de quarta, 21/10 às 15:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.",
      [ferramenta("agendar", {})],
    );
    expect(c.consultas).toEqual([
      expect.objectContaining({
        service_link_id: VINC.consultaAnaUnimed,
        starts_at: iso("2026-10-21", "15:00"),
      }),
    ]);
  });

  it("o segundo assunto de fora na mesma conversa passa para a equipe, com a marcação contada na nota", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    respondeu(
      await c.fala({
        texto: "Quem ganhou o jogo ontem?",
        roteiro: [ferramenta("fora_do_assunto", {})],
      }),
      FRASE_FORA_DO_ASSUNTO,
    );
    passou(
      await c.fala({
        texto: "E a previsão do tempo?",
        roteiro: [ferramenta("fora_do_assunto", {})],
      }),
      { desfecho: "escalou", motivo: "fora_do_assunto" },
    );
    expect(c.notasInternas.at(-1)).toContain("quarta, 21/10 às 14:00");
    await nadaMaisSai(c, ["Nasci em 12/03/1985", "Sim"]);
    expect(c.consultas).toEqual([]);
  });
});

describe("8. o preparo aprovado depois de marcar", () => {
  const CATALOGO_COM_PREPARO = comPreparoEmVigor(CATALOGO_DA_AG5, [PROC.limpeza]);
  const MENSAGEM_DO_PREPARO = mensagemDoPreparo({
    procedimento: "Limpeza de pele",
    rt: RT_DE_TESTE,
    texto: TEXTO_DO_PREPARO_DE_TESTE,
  });

  /** A marcação da limpeza: a F2 colada pelo sistema, pelo filtro inteiro. */
  async function marcarALimpeza(c: ConversaLonga) {
    await ateOConfirmaDaLimpeza(c);
    const t = await c.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {}), final(MARCOU_LIMPEZA)],
    });
    respondeu(t, `${MARCOU_LIMPEZA}\n\n${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}`);
  }

  /** O pedido: uma chamada ao modelo, sem texto dele, e só o texto aprovado. */
  async function pedirOPreparo(c: ConversaLonga, texto: string) {
    const t = await c.fala({
      texto,
      roteiro: [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
    });
    expect(t.enviadas).toEqual([MENSAGEM_DO_PREPARO]);
    expect(t.chamadasAoModelo).toBe(1);
    expect(t.decisao).toMatchObject({
      desfecho: "enviou_preparo",
      preparo_versao_id: CATALOGO_COM_PREPARO.preparosEmVigor?.get(PROC.limpeza)
        ?.versaoId,
      texto_sha256: sha256DoTexto(MENSAGEM_DO_PREPARO),
      aprovado: false,
      compliance_blocked: false,
      escalation_reason: null,
      tool_used: "enviar_preparo",
    });
    expect(t.statusDaConversa).toBe("ia_atendendo");
    return t;
  }

  it("só o texto aprovado sai, palavra por palavra, numa mensagem só; o modelo nunca lê o texto; copiar um trecho é barrado", async () => {
    const c = clinicaDeUmaUnidade(CATALOGO_COM_PREPARO);
    await marcarALimpeza(c);

    // A F2 so no turno que marcou.
    await modeloResponde(c, "Quanto custa mesmo?", PRECO_DA_LIMPEZA, [
      precoDaLimpeza(),
    ]);

    // Sem nenhum texto do modelo, sem o filtro e sem o verificador.
    const pedidosAoVerificador = c.cenario.verificacao.pedidos.length;
    const t6 = await pedirOPreparo(c, "Me manda a orientação de preparo");
    expect(c.cenario.verificacao.pedidos).toHaveLength(pedidosAoVerificador);
    expect(t6.estado).toMatchObject({
      etapa: "pos_marcacao",
      appointment_id: c.consultas[0]?.id,
    });
    expect(
      c.cenario.banco.linhas("message").find((m) => m.job_id === t6.job),
    ).toMatchObject({ author: "sistema", body: MENSAGEM_DO_PREPARO });

    // O turno seguinte: o modelo le o substituto, nunca o texto (o ajudante
    // confere o texto em todo corpo).
    const t7 = await modeloResponde(
      c,
      "Qual é mesmo o horário?",
      HORARIO_DA_LIMPEZA,
    );
    expect(JSON.stringify(t7.corpos[0]?.input)).toContain(
      substitutoDaMensagemDoPreparo("Limpeza de pele"),
    );

    // O preparo pedido junto de outra ferramenta nao sai: volta ao modelo, e o
    // que sai e so a resposta dele, sem o texto.
    const t8 = await modeloResponde(
      c,
      "Quanto custa e me manda o preparo de novo",
      "A Limpeza de pele custa R$ 120,00. Quer receber a orientação de preparo?",
      [
        precoDaLimpeza(),
        ferramenta("enviar_preparo", { procedimento: P_LIMPEZA }),
      ],
    );
    expect(saidasDoTurno(t8).at(-1)).toEqual({
      ok: false,
      motivo: "vai_sozinha",
    });

    // O modelo que copia um trecho do texto aprovado: barrado.
    const t9 = await c.fala({
      texto: "O que mais eu preciso saber?",
      roteiro: [final(FRASE_DO_PREPARO_SO_DO_TRECHO)],
    });
    passou(t9, {
      desfecho: "bloqueou",
      motivo: "conformidade",
      regra: "orientacao_clinica",
      camada: "regra",
    });

    await nadaMaisSai(c, ["Me manda o preparo de novo", "Sim"]);
    // O preparo saiu uma vez so, e nada do texto saiu em outra mensagem.
    const foraDoPreparo = c.recebidasPeloPaciente.filter(
      (m) => m !== MENSAGEM_DO_PREPARO,
    );
    expect(foraDoPreparo).toHaveLength(c.recebidasPeloPaciente.length - 1);
    for (const frase of TEXTO_DO_PREPARO_DE_TESTE.split("\n")) {
      expect(foraDoPreparo.join("\n")).not.toContain(frase);
    }
  });

  it("o pedido do preparo no meio do 'Confirma' desarma a pergunta: o 'sim' seguinte não marca, e a pergunta de novo vale", async () => {
    const c = clinicaDeUmaUnidade(CATALOGO_COM_PREPARO);
    await ateOConfirmaDaLimpeza(c);

    const t4 = await pedirOPreparo(
      c,
      "Antes de confirmar, me manda a orientação de preparo",
    );
    expect(t4.estado.etapa).not.toBe("aguardando_confirmacao");
    expect(c.reservasVivas).toHaveLength(1);

    // O "sim" agora responde ao preparo, nao ao "Confirma": nao marca.
    const t5 = await modeloResponde(c, "Sim", CONFIRMA_LIMPEZA, [
      ferramenta("agendar", {}),
    ]);
    expect(saidasDoTurno(t5)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(t5.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      falhas_seguidas: 1,
    });

    const t6 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(MARCOU_LIMPEZA)],
    });
    respondeu(t6, `${MARCOU_LIMPEZA}\n\n${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}`);
    expect(c.consultas).toHaveLength(1);
    expect(t6.estado.falhas_seguidas).toBe(0);

    // O preparo de novo, de outro job, sai inteiro; e o pedido com a situacao da
    // pessoa fica com a equipe, sem modelo.
    await pedirOPreparo(c, "Me manda de novo a orientação de preparo");
    passou(
      await c.fala({ texto: "Me manda o preparo, eu tomo remédio pra pressão" }),
      { desfecho: "escalou", motivo: "assunto_clinico" },
      0,
    );
    await nadaMaisSai(c, ["Oi?"]);
  });

  it.each([
    ["Precisa de jejum?", "Não precisa, pode vir normal."],
    ["Me manda o preparo", "O preparo é simples: evite sementes e grãos."],
    ["Tem preparo?", "Sim."],
  ])(
    "a pergunta '%s' respondida pelo modelo, sem a ferramenta: barrada; nada do texto do modelo sai",
    async (texto, doModelo) => {
      const c = clinicaDeUmaUnidade(CATALOGO_COM_PREPARO);
      await marcarALimpeza(c);
      await modeloResponde(c, "Qual é mesmo o horário?", HORARIO_DA_LIMPEZA);
      await conversaFiada(c, ["Obrigada", "Vou ver uma coisa aqui"]);
      passou(await c.fala({ texto, roteiro: [final(doModelo)] }), {
        desfecho: "bloqueou",
        motivo: "conformidade",
        camada: "regra",
      });
      expect(c.recebidasPeloPaciente.join("\n")).not.toContain(doModelo);
      await nadaMaisSai(c, ["Sim"]);
    },
  );

  it("a versão que sai de vigor antes do envio: nada do preparo sai; a frase e a equipe, com a nota", async () => {
    const c = clinicaDeUmaUnidade(CATALOGO_COM_PREPARO);
    await marcarALimpeza(c);
    await modeloResponde(c, "Qual é mesmo o horário?", HORARIO_DA_LIMPEZA);
    await conversaFiada(c, ["Obrigada"]);

    // O RT saiu: o catalogo do turno ainda tem a versao; a leitura do envio, nao.
    c.preparoForaDeVigor = true;
    const t7 = await c.fala({
      texto: "Me manda a orientação de preparo",
      roteiro: [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
    });
    passou(t7, { desfecho: "escalou", motivo: "assunto_clinico" });
    expect(t7.decisao?.preparo_versao_id).toBeUndefined();
    expect(trilhaDoTurno(t7)).toContain(PASSO_DO_PREPARO_FORA_DE_VIGOR);
    expect(c.notasInternas.at(-1)).toContain("Resumo do assistente");
    await nadaMaisSai(c, ["Me manda o preparo", "Oi?"]);
    expect(c.recebidasPeloPaciente.join("\n")).not.toContain(
      TEXTO_DO_PREPARO_DE_TESTE,
    );
  });
});

describe("9. o 'sim' solto não confirma nada", () => {
  const CONFIRMA_DE_NOVO =
    "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";

  it("marcação: o 'sim' depois de outra mensagem da clínica não marca; a pergunta de novo vale", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);

    c.daClinica("A Clínica Bem Estar deseja uma ótima semana!");
    const t8 = await modeloResponde(
      c,
      "Sim",
      CONFIRMA_DE_NOVO,
      [ferramenta("agendar", {})],
      20_000,
    );
    expect(saidasDoTurno(t8)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.consultas).toEqual([]);
    expect(c.reservasVivas).toHaveLength(1);
    expect(t8.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      falhas_seguidas: 1,
    });

    // Agora o "sim" vem logo depois da pergunta: marca.
    const t9 = await modeloResponde(
      c,
      "Sim",
      MARCOU_QUARTA,
      [ferramenta("agendar", {})],
      20_000,
    );
    expect(c.consultas).toHaveLength(1);
    expect(t9.estado).toMatchObject({
      etapa: "pos_marcacao",
      falhas_seguidas: 0,
    });
  });

  it("marcação: o 'sim' depois que a reserva venceu não marca; e o 'sim' seguinte, sem pergunta, também não", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);

    const t8 = await modeloResponde(
      c,
      "Sim",
      "O horário que estava reservado não vale mais. Quer que eu procure de novo?",
      [ferramenta("agendar", {})],
      11 * UM_MINUTO_MS,
    );
    expect(saidasDoTurno(t8)[0]).toEqual({ resultado: "reserva_vencida" });
    expect(c.consultas).toEqual([]);
    expect(c.reservasVivas).toEqual([]);
    expect(t8.estado).toMatchObject({
      etapa: "oferta",
      slot_hold_id: null,
      falhas_seguidas: 0,
    });
    // O nome e o nascimento continuam.
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });

    // "Sim" de novo: a etapa nao esta armada, e a RPC nem e chamada.
    const chamadas = c.cenario.banco.chamadasDe("agendar_pela_ia").length;
    const t9 = await modeloResponde(
      c,
      "Sim",
      "Para qual horário? Posso procurar de novo.",
      [ferramenta("agendar", {})],
    );
    expect(saidasDoTurno(t9)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(chamadas);
    expect(c.consultas).toEqual([]);
    expect(t9.estado.falhas_seguidas).toBe(1);
  });

  it("cancelamento: campanha no meio, a pergunta vencida, outro assunto e a citação de outra mensagem: nada cancela até o 'sim' logo depois da pergunta", async () => {
    const c = clinicaComDuasUnidades();
    const { c1, c2 } = consultasDoContato(c.cenario.banco);
    const intacta = () => {
      expect(c1.status).toBe("agendado");
      expect(c2.status).toBe("agendado");
      expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    };
    const cancelar = () => [ferramenta("cancelar_consulta", {})];

    const t1 = await sistemaResponde(
      c,
      "Preciso cancelar minha consulta de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
    );
    expect(t1.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
    });

    // A campanha sai entre a pergunta e o "sim": a pergunta volta, com falha.
    const campanha = c.daClinica("A Clínica Bem Estar deseja uma ótima semana!");
    const t2 = await sistemaResponde(c, "Sim", T1_QUINTA, cancelar());
    intacta();
    expect(t2.estado).toMatchObject({
      pedido_pendente: "cancelar",
      falhas_seguidas: 1,
    });
    expect(trilhaDoTurno(t2).join(" ")).toContain("outra mensagem da clínica");

    // Mais de uma hora depois: a pergunta venceu; volta sem falha.
    const t3 = await sistemaResponde(
      c,
      "Sim",
      T1_QUINTA,
      cancelar(),
      61 * UM_MINUTO_MS,
    );
    intacta();
    expect(t3.estado.falhas_seguidas).toBe(0);
    expect(trilhaDoTurno(t3).join(" ")).toContain("venceu");

    // Outro assunto: a pergunta desarma.
    const t4 = await modeloResponde(
      c,
      "Quanto custa a consulta?",
      PRECO_DA_CONSULTA,
      [precoDaConsulta()],
    );
    expect(t4.estado.pedido_pendente).toBeNull();
    intacta();

    // "Sim" sem pergunta armada: recusado no servidor.
    const t5 = await modeloResponde(
      c,
      "Sim",
      "Claro. Sobre o que é o seu sim?",
      cancelar(),
    );
    expect(saidasDoTurno(t5)[0]).toEqual({
      resultado: "sem_pergunta_de_cancelamento",
    });
    intacta();
    expect(t5.estado.falhas_seguidas).toBe(1);

    const t6 = await sistemaResponde(
      c,
      "Quero cancelar a de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
    );
    expect(t6.estado.falhas_seguidas).toBe(0);

    // O "sim" que cita outra mensagem (o botao de uma mensagem antiga).
    const t7 = await c.fala({
      texto: "Sim",
      citacao: { mensagem: campanha },
      roteiro: cancelar(),
    });
    respondeu(t7, T1_QUINTA);
    intacta();
    expect(t7.estado.falhas_seguidas).toBe(1);

    // O "sim" logo depois da pergunta: cancela so a consulta do pedido.
    const t8 = await sistemaResponde(c, "Sim", T2_QUINTA, cancelar());
    expect(c1.status).toBe("cancelado_paciente");
    expect(c2.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(t8.estado).toMatchObject({
      desfecho: "cancelou",
      falhas_seguidas: 0,
    });
  });

  it("remarcação: outra pergunta no meio e o 'sim' depois da hora não trocam a consulta", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);

    // Outro assunto depois da T3: a pergunta deixa de valer.
    const t7 = await modeloResponde(c, "Quanto custa mesmo?", PRECO_DA_CONSULTA, [
      precoDaConsulta(),
    ]);
    expect(t7.estado).toMatchObject({
      etapa: "oferta",
      pedido_pendente: "remarcar",
    });

    // O "sim" agora responde ao preco: nao remarca.
    const t8 = await modeloResponde(
      c,
      "Sim",
      "Para remarcar, preciso que confirme o horário de novo.",
      [ferramenta("agendar", {})],
    );
    expect(saidasDoTurno(t8)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.consultas).toEqual([consulta]);
    expect(consulta.remarcacao_pedida_em ?? null).toBeNull();

    // A T3 de novo, e o "sim" so depois de vencer a reserva.
    const t9 = await sistemaResponde(c, "Pode ser terça às 8 mesmo", T3_TERCA, [
      ferramenta("reservar_horario", { horario: "h1" }),
    ]);
    expect(t9.estado.etapa).toBe("aguardando_confirmacao");
    const t10 = await modeloResponde(
      c,
      "Sim",
      "O horário reservado não vale mais. Quer que eu procure de novo?",
      [ferramenta("agendar", {})],
      11 * UM_MINUTO_MS,
    );
    expect(saidasDoTurno(t10)[0]).toEqual({ resultado: "reserva_vencida" });
    expect(c.consultas).toEqual([consulta]);
    expect(consulta.status).toBe("agendado");
  });

  it("o 'sim' sem pergunta nenhuma, duas vezes seguidas: passa para a equipe, sem o texto do modelo", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    const t7 = await modeloResponde(
      c,
      "Sim",
      "Claro. Sobre o que é o seu sim?",
      [ferramenta("agendar", {})],
    );
    expect(t7.estado.falhas_seguidas).toBe(1);

    const doModelo = "Pronto, está tudo certo.";
    const t8 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {}), final(doModelo)],
    });
    passou(t8, { desfecho: "escalou", motivo: "falhas_seguidas" });
    expect(c.recebidasPeloPaciente.join("\n")).not.toContain(doModelo);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    await nadaMaisSai(c, ["Sim", "Sim!"]);
    expect(c.consultas).toEqual([]);
  });

  it("o 'sim' cruzado entre as perguntas: o do 'Confirma' não entra na lista, e o da lista não marca", async () => {
    const c = clinicaDeUmaUnidade();
    await ateAPerguntaDaLista(c);

    // A pessoa nao responde a T-E1: vai para a marcacao.
    await ateOConfirmaDaLimpeza(c);
    expect(c.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.cenario.pedidos).toHaveLength(1);

    // O "sim" responde ao "Confirma", e o modelo chama a lista: nao entra. O
    // sistema pergunta a T-E1 de novo (com falha), e o "Confirma" desarma.
    const t6 = await sistemaResponde(c, "Sim", T_E1_ANA_NOITE_SEG_QUA, [
      ferramenta("entrar_na_lista_de_espera", {}),
    ]);
    expect(c.cenario.fila).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(t6.estado.etapa).not.toBe("aguardando_confirmacao");
    expect(t6.estado.falhas_seguidas).toBe(1);

    // O "sim" agora responde a T-E1, e o modelo chama agendar: nao marca, e a
    // segunda falha seguida passa para a equipe.
    const t7 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(CONFIRMA_LIMPEZA)],
    });
    passou(t7, { desfecho: "escalou", motivo: "falhas_seguidas" });
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);

    await nadaMaisSai(c, ["Sim", "Sim"]);
    expect(c.consultas).toEqual([]);
    expect(c.cenario.fila).toEqual([]);
  });

  it.each([
    ["'Não, melhor não'", ["Não, melhor não"]],
    ["'Sim' e 'Não, espera' na mesma rajada", ["Sim", "Não, espera"]],
  ])(
    "marcação: %s com o modelo que chama agendar não pode marcar",
    async (_nome, textos) => {
      const c = clinicaComDuasUnidades();
      await comAPerguntaConfirmaNoAr(c);
      await c.rajada(
        textos,
        { roteiro: [ferramenta("agendar", {}), final(MARCOU_QUARTA)] },
        20_000,
      );
      expect(c.consultas).toEqual([]);
      expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    },
  );

  it("marcação: 'Pode cancelar' nunca marca, a pergunta volta, e o 'sim' seguinte marca", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);
    const t = await c.fala(
      {
        texto: "Pode cancelar",
        roteiro: [ferramenta("agendar", {}), final(CONFIRMA_QUARTA)],
      },
      20_000,
    );
    respondeu(t, CONFIRMA_QUARTA);
    expect(saidasDoTurno(t)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(t.estado.falhas_seguidas).toBe(1);
    expect(t.estado.etapa).toBe("aguardando_confirmacao");
    await modeloResponde(c, "Sim", MARCOU_QUARTA, [ferramenta("agendar", {})], 20_000);
    expect(c.consultas).toHaveLength(1);
  });

  it("remarcação: 'Não, melhor não' com o modelo que chama agendar não pede a remarcação", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await modeloResponde(
      c,
      "Qual é mesmo o horário?",
      "Sua Consulta está marcada para sexta, 30/10 às 14:00.",
    );
    await pedirARemarcacaoParaTerca(c);
    await c.fala(
      {
        texto: "Não, melhor não",
        roteiro: [ferramenta("agendar", {}), final("Tudo bem, nada mudou.")],
      },
      20_000,
    );
    expect(c.consultas.find((a) => a.remarcacao_de === consulta.id)).toBeUndefined();
    expect(consulta.status).toBe("agendado");
  });

  it("cancelamento: 'Sim' e 'Não, espera' na mesma rajada: a lista fechada não cancela, e a pergunta volta", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    const { c1 } = consultasDoContato(c.cenario.banco);
    await sistemaResponde(
      c,
      "Preciso cancelar minha consulta de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
    );
    const t8 = await c.rajada(["Sim", "Não, espera"], {
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(t8, T1_QUINTA);
    expect(c1.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(t8.estado.falhas_seguidas).toBe(1);

    // "Não": fica como esta, sem cancelar, e o modelo so le o resultado.
    const t9 = await modeloResponde(
      c,
      "Não",
      "Tudo bem, sua consulta continua marcada.",
      [ferramenta("cancelar_consulta", {})],
    );
    expect(saidasDoTurno(t9)[0]).toEqual({ resultado: "paciente_nao_confirmou" });
    expect(c1.status).toBe("agendado");
    expect(t9.estado.pedido_pendente).toBeNull();
  });
});

describe("10. dois assuntos numa fala só e a rajada", () => {
  it("cada job responde uma vez; o segundo job da rajada não repete; o 'sim' com mensagem no meio do turno não marca", async () => {
    const c = clinicaComDuasUnidades();

    const t1 = await modeloResponde(
      c,
      "Quanto custa a consulta e onde fica a clínica?",
      `A consulta custa R$ 300,00 com a Dra. Ana Lima, no particular. A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`,
      [precoDaConsulta(), ferramenta("consultar_unidades", { unidade: "u1" })],
    );
    expect(t1.ferramentas).toEqual(["buscar_procedimento", "consultar_unidades"]);

    // A rajada: um job so le as tres e responde uma vez.
    const t2 = await c.rajada(["Quero marcar", "à tarde", "sem convênio"], {
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(OFERTA_DA_TARDE),
      ],
    });
    respondeu(t2, OFERTA_DA_TARDE);
    const lidasDoTurno = (t: TurnoDaConversa) =>
      c.executor.linhas("ai_turno").find((l) => l.job_id === t.job)
        ?.mensagens_lidas;
    expect(lidasDoTurno(t2)).toHaveLength(3);
    expect(
      (t2.corpos[0]?.input as { content: string }[])
        .slice(-3)
        .map((m) => m.content),
    ).toEqual(["Quero marcar", "à tarde", "sem convênio"]);

    // O segundo job da mesma rajada nao tem o que responder.
    const t3 = await c.continua();
    expect(t3.resultado).toEqual({ ok: true });
    expect(t3.chamadasAoModelo).toBe(0);
    expect(t3.enviadas).toEqual([]);
    expect(t3.decisao).toBeUndefined();

    // Dois assuntos com efeito na mesma fala: a reserva e os dados.
    const t4 = await modeloResponde(
      c,
      "Quarta às 14h. Sou Maria da Silva Souza, nasci em 12/03/1985",
      CONFIRMA_QUARTA,
      [ferramenta("reservar_horario", { horario: "h2" }), dadosCompletos()],
    );
    expect(t4.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados.faltam).toEqual([]);
    const reserva = t4.estado.slot_hold_id;

    // O "sim", com a pessoa escrevendo de novo no meio do turno: o banco diz
    // mensagem_nova, nada sai, nada muda e o job seguinte fica na fila.
    const estadoAntes = structuredClone(c.estado);
    const t5 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {})],
      durante: () => {
        c.escreve("Espera, na verdade prefiro quinta");
      },
    });
    expect(t5.resultado).toEqual({ ok: true });
    expect(t5.enviadas).toEqual([]);
    expect(oQueDecidiu(t5)).toMatchObject({
      desfecho: "falhou",
      falha: "sem_mensagem",
      motivo: null,
    });
    expect(t5.statusDaConversa).toBe("ia_atendendo");
    expect(c.estado).toEqual(estadoAntes);
    expect(c.consultas).toEqual([]);
    expect(c.temJobPendente).toBe(true);

    // O job seguinte le o "sim" e a mensagem nova, e a pessoa quer quinta.
    const trocou =
      "Troquei para quinta. Confirma a Consulta com a Dra. Ana Lima na quinta, 22/10 às 14:00, na unidade Centro, no particular?";
    const t6 = await c.rodarOJobPendente({
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-22", hora: "14:00" }),
        ),
        ferramenta("reservar_horario", { horario: "h6" }),
        final(trocou),
      ],
    });
    respondeu(t6, trocou);
    expect(lidasDoTurno(t6)).toHaveLength(2);
    expect(t6.estado.slot_hold_id).not.toBe(reserva);
    expect(t6.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.temJobPendente).toBe(false);

    const t7 = await modeloResponde(
      c,
      "Sim",
      "Pronto! Sua Consulta de quinta, 22/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.",
      [ferramenta("agendar", {})],
      30_000,
    );
    expect(c.consultas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-22", "14:00") }),
    ]);

    // O mesmo job de novo, como a fila faria: nada sai e nada marca outra vez.
    const t8 = await c.repetirOJob(t7);
    expect(t8.resultado).toEqual({ ok: true });
    expect(t8.chamadasAoModelo).toBe(0);
    expect(t8.enviadas).toEqual([]);
    expect(c.consultas).toHaveLength(1);

    const t9 = await c.rajada(["Obrigada", "Até mais"], {
      roteiro: [final(TCHAU)],
    });
    respondeu(t9, TCHAU);
    expect(c.decisoes.filter((d) => d.desfecho === "respondeu")).toHaveLength(6);
  });

  it("a mensagem no meio do turno do cancelamento e da lista de espera: nada acontece, e o job seguinte lê as duas", async () => {
    const c = clinicaDeUmaUnidade();
    const { c1 } = consultasDoContato(c.cenario.banco);
    await sistemaResponde(
      c,
      "Quero cancelar a de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
    );

    const t2 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
      durante: () => {
        c.escreve("Não, espera, deixa quieto");
      },
    });
    expect(t2.enviadas).toEqual([]);
    expect(oQueDecidiu(t2)).toMatchObject({
      desfecho: "falhou",
      falha: "sem_mensagem",
    });
    expect(c1.status).toBe("agendado");
    expect(c.estado).toMatchObject({
      pedido_pendente: "cancelar",
      falhas_seguidas: 0,
    });
    expect(c.temJobPendente).toBe(true);

    // O job seguinte le o "sim" e o "nao" juntos: nao e um sim claro.
    const t3 = await c.rodarOJobPendente({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(t3, T1_QUINTA);
    expect(c1.status).toBe("agendado");
    expect(t3.estado.falhas_seguidas).toBe(1);

    const t4 = await modeloResponde(
      c,
      "Não",
      "Tudo bem, sua consulta continua marcada.",
      [ferramenta("cancelar_consulta", {})],
    );
    expect(c1.status).toBe("agendado");
    expect(t4.estado.pedido_pendente).toBeNull();

    // A lista de espera, com o mesmo caminho.
    await ateAPerguntaDaLista(c);
    const t7 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
      durante: () => {
        c.escreve("Melhor não, obrigada");
      },
    });
    expect(t7.enviadas).toEqual([]);
    expect(c.cenario.fila).toEqual([]);
    expect(c.temJobPendente).toBe(true);

    const t8 = await c.rodarOJobPendente({
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    respondeu(t8, T_E1_ANA_NOITE_SEG_QUA);
    expect(c.cenario.fila).toEqual([]);

    const t9 = await modeloResponde(
      c,
      "Não",
      "Tudo bem, não coloquei você na lista de espera.",
      [ferramenta("entrar_na_lista_de_espera", {})],
    );
    expect(saidasDoTurno(t9)[0]).toMatchObject({
      resultado: "paciente_nao_quis",
    });
    expect(c.cenario.fila).toEqual([]);
  });

  it("o canal ocupado no turno que marca: a resposta sai depois, uma vez só, sem chamar o modelo de novo", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);
    c.canalOcupado = true;
    const t8 = await c.fala(
      {
        texto: "Sim",
        roteiro: [ferramenta("agendar", {}), final(MARCOU_QUARTA)],
      },
      20_000,
    );
    expect(t8.resultado).toMatchObject({ motivo: "canal_ocupado" });
    expect(t8.enviadas).toEqual([]);
    // Ja marcou, ja decidiu e ja gravou o estado; so o envio ficou para depois.
    expect(c.consultas).toHaveLength(1);
    expect(oQueDecidiu(t8).desfecho).toBe("respondeu");
    expect(t8.estado.etapa).toBe("pos_marcacao");

    const t9 = await c.repetirOJob(t8);
    expect(t9.resultado).toEqual({ ok: true });
    expect(t9.chamadasAoModelo).toBe(0);
    respondeu(t9, MARCOU_QUARTA);
    expect(c.consultas).toHaveLength(1);
    expect(c.decisoes.filter((d) => d.job_id === t8.job)).toHaveLength(1);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(
      c.executor.linhas("ai_turno").find((l) => l.job_id === t8.job),
    ).toMatchObject({ estado: "enviado", texto: null });

    // A fala seguinte segue normal: o "sim" ja foi respondido.
    const t10 = await modeloResponde(c, "Obrigada", TCHAU);
    expect(
      (t10.corpos[0]?.input as { content: string }[]).at(-1)?.content,
    ).toBe("Obrigada");
  });

  it("mais de cinco mensagens sem resposta: nenhum modelo lê, e a conversa passa para a equipe", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    passou(
      await c.rajada(
        ["oi", "tem alguém aí", "?", "alô", "oi?", "preciso de ajuda"],
        {},
      ),
      { desfecho: "escalou", motivo: "agente_pediu", gatilho: "mensagem_longa" },
      0,
    );
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.consultas).toEqual([]);
  });

  it("o teto de respostas por hora da conversa: sem modelo, a frase e a equipe; a conversa não fica sem resposta", async () => {
    const c = clinicaComDuasUnidades();
    c.executor.linhas("ia_liberacao")[0]!.teto_respostas_por_conversa_hora = 6;
    await conversaEmAndamento(c);
    passou(
      await c.fala({ texto: "Nasci em 12/03/1985" }),
      { desfecho: "escalou", motivo: "teto_de_respostas" },
      0,
    );
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.consultas).toEqual([]);
  });
});

describe("11. duas frentes, o efeito já feito e a conversa que sai da IA por fora", () => {
  const P_LIMPEZA_DO_CADASTRO = codigoDoProcedimento(CADASTRO, PROC.limpeza);

  /**
   * A marcação da limpeza até o "Confirma", a T1 de outra consulta e o "sim": a
   * consulta cancela e a reserva fica. Um minuto entre as falas: a reserva dura.
   */
  async function cancelarNoMeioDaMarcacao(c: ConversaLonga) {
    const { c1, c2 } = consultasDoContato(c.cenario.banco);
    await modeloResponde(
      c,
      "Quero marcar limpeza de pele de manhã",
      "Tenho quarta, 21/10 às 08:00 com a Dra. Ana Lima na unidade Aldeota. Pode ser?",
      [
        ferramenta(
          "buscar_horario",
          busca({ procedimento: P_LIMPEZA_DO_CADASTRO, periodo: "manha" }),
        ),
      ],
    );
    await modeloResponde(
      c,
      "Pode",
      "Reservei quarta, 21/10 às 08:00 com a Dra. Ana Lima, na unidade Aldeota, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
      [ferramenta("reservar_horario", { horario: "h1" })],
      UM_MINUTO_MS,
    );
    const confirma =
      "Obrigada! Confirma a Limpeza de pele com a Dra. Ana Lima na quarta, 21/10 às 08:00, na unidade Aldeota, no particular?";
    const t3 = await modeloResponde(
      c,
      "Maria da Silva Souza, nascida em 12/03/1985",
      confirma,
      [dadosCompletos()],
      UM_MINUTO_MS,
    );
    expect(t3.estado.etapa).toBe("aguardando_confirmacao");
    const reserva = t3.estado.slot_hold_id;

    // Antes de confirmar, cancela a outra: a T1.
    const t4 = await sistemaResponde(
      c,
      "Antes, preciso cancelar minha consulta de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
      UM_MINUTO_MS,
    );
    expect(t4.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      slot_hold_id: reserva,
    });

    const t5 = await sistemaResponde(
      c,
      "Sim",
      T2_QUINTA,
      [ferramenta("cancelar_consulta", {})],
      UM_MINUTO_MS,
    );
    expect(c1.status).toBe("cancelado_paciente");
    expect(c2.status).toBe("agendado");
    // So o cancelamento: o "sim" nao marcou a limpeza.
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(t5.estado.slot_hold_id).toBe(reserva);
    expect(c.reservasVivas).toHaveLength(1);
    return { c1, c2, reserva, confirma };
  }

  it("cancela outra consulta no meio de uma marcação: a reserva fica e a marcação termina, com a pergunta de novo", async () => {
    const c = clinicaComDuasUnidades();
    const { c1, c2, reserva, confirma } = await cancelarNoMeioDaMarcacao(c);

    // Volta para a limpeza: a pergunta de novo e o "sim" marcam a reservada.
    const t6 = await modeloResponde(
      c,
      "E a limpeza de pele?",
      confirma,
      [],
      UM_MINUTO_MS,
    );
    expect(t6.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      slot_hold_id: reserva,
    });
    await modeloResponde(
      c,
      "Sim",
      "Pronto! Sua Limpeza de pele de quarta, 21/10 às 08:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.",
      [ferramenta("agendar", {})],
      UM_MINUTO_MS,
    );
    expect(c.consultasVivas.map((a) => a.starts_at)).toEqual([
      iso("2026-10-27", "09:00"),
      iso("2026-10-21", "08:00"),
    ]);
    expect(c1.status).toBe("cancelado_paciente");
    expect(c2.status).toBe("agendado");
    await modeloResponde(c, "Obrigada", TCHAU);
  });

  it("com a marcação em andamento, a resposta verdadeira sobre o cancelamento feito tem de passar", async () => {
    const c = clinicaComDuasUnidades();
    await conversaFiada(c, ["Oi, tudo bem?", "Queria umas informações"]);
    await cancelarNoMeioDaMarcacao(c);
    await modeloResponde(
      c,
      "Foi cancelada mesmo?",
      "Sim, sua consulta de quinta, 22/10 às 14:00 foi cancelada.",
      [],
      UM_MINUTO_MS,
    );
  });

  it("com a marcação em andamento e o cancelamento que NÃO aconteceu: 'foi cancelada' é barrada", async () => {
    const c = clinicaComDuasUnidades();
    await conversaFiada(c, [
      "Oi, tudo bem?",
      "Queria umas informações",
      "Vou ver uma coisa aqui",
      "Já volto",
    ]);
    const { c1 } = consultasDoContato(c.cenario.banco);
    await modeloResponde(
      c,
      "Quero marcar limpeza de pele de manhã",
      "Tenho quarta, 21/10 às 08:00 com a Dra. Ana Lima na unidade Aldeota. Pode ser?",
      [
        ferramenta(
          "buscar_horario",
          busca({ procedimento: P_LIMPEZA_DO_CADASTRO, periodo: "manha" }),
        ),
      ],
    );
    await sistemaResponde(
      c,
      "Antes, preciso cancelar minha consulta de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
      UM_MINUTO_MS,
    );
    await modeloResponde(
      c,
      "Não",
      "Tudo bem, sua consulta continua marcada.",
      [ferramenta("cancelar_consulta", {})],
      UM_MINUTO_MS,
    );
    expect(c1.status).toBe("agendado");
    const alucinou = "Sim, sua consulta de quinta, 22/10 às 14:00 foi cancelada.";
    const t = await c.fala(
      { texto: "Foi cancelada mesmo?", roteiro: [final(alucinou)] },
      UM_MINUTO_MS,
    );
    passou(t, {
      desfecho: "bloqueou",
      regra: "acao_nao_executada",
      camada: "regra",
    });
    expect(c1.status).toBe("agendado");
  });

  it("com a marcação em andamento, o fato do cancelamento é só o da consulta cancelada: a outra consulta 'foi cancelada' é barrada", async () => {
    const c = clinicaComDuasUnidades();
    await conversaFiada(c, ["Oi, tudo bem?", "Queria umas informações"]);
    const { c2 } = await cancelarNoMeioDaMarcacao(c);
    const alucinou = "Sim, sua consulta de terça, 27/10 às 09:00 foi cancelada.";
    const t = await c.fala(
      { texto: "E a de terça, foi cancelada?", roteiro: [final(alucinou)] },
      UM_MINUTO_MS,
    );
    passou(t, {
      desfecho: "bloqueou",
      regra: "acao_nao_executada",
      camada: "regra",
    });
    expect(c2.status).toBe("agendado");
  });

  it("a marcação feita com a resposta barrada: a consulta fica, o paciente recebe só a frase e a nota conta a consulta", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);
    const t = await c.fala(
      {
        texto: "Sim",
        roteiro: [
          ferramenta("agendar", {}),
          final(
            "Pronto! Sua Consulta de quarta, 21/10 às 14:00 ficou marcada. O resultado é garantido.",
          ),
        ],
      },
      20_000,
    );
    passou(t, {
      desfecho: "bloqueou",
      regra: "promessa_resultado",
      camada: "regra",
    });
    expect(c.consultas).toHaveLength(1);
    expect(t.decisao?.tool_used).toBe("agendar");
    expect(t.estado).toMatchObject({
      etapa: "pos_marcacao",
      desfecho: "passou_para_equipe",
      appointment_id: c.consultas[0]?.id,
    });
    expect(c.notasInternas.at(-1)).toContain("Consulta marcada pelo assistente");
    await nadaMaisSai(c, ["Sim", "Está marcado?"]);
    expect(c.consultas).toHaveLength(1);
  });

  /** O cancelamento feito no turno em que a T2 não pode sair. */
  async function cancelarComOVerificadorForaDoAr(c: ConversaLonga) {
    await conversaEmAndamento(c);
    const { c1 } = consultasDoContato(c.cenario.banco);
    await sistemaResponde(
      c,
      "Preciso cancelar minha consulta de quinta",
      T1_QUINTA,
      pedirOCancelamento(),
      20_000,
    );
    const t = await c.fala(
      {
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
        verificador: verificadorForaDoAr,
      },
      20_000,
    );
    return { c1, t };
  }

  it("o cancelamento feito com o verificador fora do ar: a consulta fica cancelada e o paciente recebe só a frase", async () => {
    const c = clinicaComDuasUnidades();
    const { c1, t } = await cancelarComOVerificadorForaDoAr(c);
    passou(t, {
      desfecho: "bloqueou",
      regra: "falha_verificador",
      camada: "falha",
    });
    expect(c1.status).toBe("cancelado_paciente");
    expect(t.decisao?.tool_used).toBe("cancelar_consulta");
    expect(trilhaDoTurno(t).join(" ")).toContain("Cancelou a consulta");
    await nadaMaisSai(c, ["Cancelou?", "Sim"]);
  });

  it("o cancelamento feito com a T2 barrada: a nota da equipe tem de dizer que cancelou", async () => {
    const c = clinicaComDuasUnidades();
    await cancelarComOVerificadorForaDoAr(c);
    expect(c.notasInternas.at(-1)).toContain(
      "Consulta cancelada pelo assistente nesta conversa: quinta, 22/10 às 14:00.",
    );
    expect(c.notasInternas.at(-1)).not.toContain("Pedido: cancelar");
  });

  it("a remarcação pedida com o verificador fora do ar: a nova fica pendente, a antiga de pé, e a nota conta o par", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await modeloResponde(
      c,
      "Qual é mesmo o horário?",
      "Sua Consulta está marcada para sexta, 30/10 às 14:00.",
    );
    await pedirARemarcacaoParaTerca(c);
    const t = await c.fala(
      {
        texto: "Confirmo",
        roteiro: [ferramenta("agendar", {})],
        verificador: verificadorForaDoAr,
      },
      20_000,
    );
    passou(t, { desfecho: "bloqueou", regra: "falha_verificador" });
    expect(c.consultas.find((a) => a.remarcacao_de === consulta.id)).toMatchObject({
      approval_status: "pendente",
    });
    expect(consulta.status).toBe("agendado");
    const nota = c.notasInternas.at(-1) ?? "";
    expect(nota).toContain("sexta, 30/10 às 14:00");
    expect(nota).toContain("terça, 03/11 às 08:00");
    await nadaMaisSai(c, ["Remarcou?"]);
  });

  it("a entrada na lista com o verificador fora do ar: a entrada fica, e a nota conta a lista", async () => {
    const c = clinicaDeUmaUnidade();
    for (const texto of [
      "Quanto custa a limpeza de pele?",
      "Quanto custa mesmo?",
      "Desculpa, quanto era?",
      "Certo, e o valor é esse mesmo?",
    ]) {
      await modeloResponde(c, texto, PRECO_DA_LIMPEZA, [precoDaLimpeza()]);
    }
    await ateAPerguntaDaLista(c);
    passou(
      await c.fala({
        texto: "Sim",
        roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
        verificador: verificadorForaDoAr,
      }),
      { desfecho: "bloqueou", regra: "falha_verificador" },
    );
    expect(c.cenario.fila).toHaveLength(1);
    expect(c.notasInternas.at(-1)).toContain("lista de espera");
    await nadaMaisSai(c, ["Entrei?"]);
  });

  it("a conversa que passa de 20 mensagens: o modelo lê só as últimas, a saudação e o aviso não voltam, e as âncoras continuam", async () => {
    const saudacao = "Olá! Que bom falar com você.";
    const c = clinicaComDuasUnidades({ saudacao });
    const t1 = await c.fala({
      texto: "Quero marcar uma consulta para a sexta da semana que vem, à tarde",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-30", periodo: "tarde" }),
        ),
        final(OFERTA_DA_SEXTA),
      ],
    });
    respondeu(
      t1,
      `${saudacao}\n\n${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${OFERTA_DA_SEXTA}`,
    );
    await modeloResponde(c, "Às 14h", RESERVOU_SEXTA, [
      ferramenta("reservar_horario", { horario: "h1" }),
    ]);
    await modeloResponde(
      c,
      "Maria da Silva Souza, nascida em 12/03/1985",
      CONFIRMA_SEXTA,
      [dadosCompletos()],
    );
    const t4 = await modeloResponde(c, "Confirmo", MARCOU_SEXTA, [
      ferramenta("agendar", {}),
    ]);
    const consulta = c.consultas[0]!;
    for (const texto of [
      "Qual é mesmo o horário?",
      "E é sexta mesmo?",
      "Às 14h, certo?",
      "Com a Dra. Ana?",
      "Pendente da equipe?",
      "Desculpa, sou esquecida",
      "Me diz de novo o horário",
      "Sexta, né?",
    ]) {
      const t = await modeloResponde(c, texto, HORARIO_DA_SEXTA);
      expect(t.estado).toEqual(t4.estado);
    }
    // 12 falas e 12 respostas: o modelo le as 20 ultimas, com a pendente no fim.
    const input = c.turnos.at(-1)?.corpos[0]?.input as { content: string }[];
    expect(input).toHaveLength(20);
    expect(input.at(-1)?.content).toBe("Sexta, né?");
    expect(
      c.recebidasPeloPaciente.filter((m) => m.includes(saudacao)),
    ).toHaveLength(1);

    // Dali em diante, cancelar vale como sempre: as ancoras leem o banco.
    await sistemaResponde(
      c,
      "Quero cancelar minha consulta",
      "Confirma o cancelamento da sua consulta de sexta, 30/10 às 14:00?",
      pedirOCancelamento(),
    );
    await sistemaResponde(
      c,
      "Sim",
      "Tudo bem, sua consulta de 30/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
      [ferramenta("cancelar_consulta", {})],
    );
    expect(consulta.status).toBe("cancelado_paciente");
  });

  it("a autorização revogada no meio: sem modelo e sem frase; quem revogou não recebe mais nada", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    c.consentimento = false;
    const recebidas = c.recebidasPeloPaciente.length;
    const t7 = await c.fala({ texto: "Nasci em 12/03/1985" });
    expect(t7.chamadasAoModelo).toBe(0);
    expect(t7.enviadas).toEqual([]);
    expect(t7.statusDaConversa).toBe("aguardando_humano");
    expect(c.passagens).toHaveLength(1);
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
    expect(c.consultas).toEqual([]);
  });

  it("a IA desligada para este telefone no meio: sem modelo e sem frase; a conversa fica com a equipe", async () => {
    const c = clinicaComDuasUnidades();
    await comAPerguntaConfirmaNoAr(c);
    c.liberada = false;
    const recebidas = c.recebidasPeloPaciente.length;
    const t8 = await c.fala({ texto: "Sim" }, 20_000);
    expect(t8.chamadasAoModelo).toBe(0);
    expect(t8.enviadas).toEqual([]);
    expect(t8.statusDaConversa).toBe("aguardando_humano");
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
    expect(c.consultas).toEqual([]);
  });

  it.each([
    ["com o 'sim' e o agendar", "Sim", () => [ferramenta("agendar", {})]],
    [
      "com a resposta já escrita",
      "Quanto custa mesmo?",
      () => [final("Fico à disposição para o que precisar.")],
    ],
  ])(
    "alguém da equipe assume no meio do turno, %s: nada marca e nada sai, nem a frase",
    async (_nome, texto, roteiro) => {
      const c = clinicaComDuasUnidades();
      await comAPerguntaConfirmaNoAr(c);
      const recebidas = c.recebidasPeloPaciente.length;
      const t8 = await c.fala(
        {
          texto,
          roteiro: roteiro(),
          durante: () => {
            c.equipeAssume();
          },
        },
        20_000,
      );
      expect(oQueDecidiu(t8)).toMatchObject({
        desfecho: "falhou",
        falha: "liberacao_suspensa",
        motivo: null,
      });
      expect(t8.enviadas).toEqual([]);
      expect(t8.statusDaConversa).toBe("em_atendimento");
      expect(c.consultas).toEqual([]);
      await nadaMaisSai(c, ["Sim", "Confirmo", "oi"]);
      expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
      expect(c.consultas).toEqual([]);
    },
  );
});

describe("12. áudio e foto no meio da conversa", () => {
  /** A marcação falada: a escolha, os dados e o "sim". */
  async function marcarFalando(c: ConversaLonga) {
    await modeloResponde(
      c,
      "Quero marcar uma consulta para a sexta da semana que vem, à tarde",
      OFERTA_DA_SEXTA,
      [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-30", periodo: "tarde" }),
        ),
      ],
    );
    const t2 = await c.audio("Pode ser às catorze horas", {
      roteiro: [
        ferramenta("reservar_horario", { horario: "h1" }),
        final(RESERVOU_SEXTA),
      ],
    });
    respondeu(t2, RESERVOU_SEXTA);
    // O modelo le a transcricao marcada como audio.
    expect((t2.corpos[0]?.input as { content: string }[]).at(-1)?.content).toBe(
      `${PREFIXO_DO_AUDIO} Pode ser às catorze horas`,
    );

    const t3 = await c.audio("Maria da Silva Souza, nascida em 12/03/1985", {
      roteiro: [dadosCompletos(), final(CONFIRMA_SEXTA)],
    });
    respondeu(t3, CONFIRMA_SEXTA);
    expect(t3.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });

    respondeu(
      await c.audio("sim", {
        roteiro: [ferramenta("agendar", {}), final(MARCOU_SEXTA)],
      }),
      MARCOU_SEXTA,
    );
    expect(c.consultas).toHaveLength(1);
    return c.consultas[0]!;
  }

  it("a marcação falada, o pedido lido na foto e o sinal de emergência falado: o portão lê a transcrição", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarFalando(c);
    expect(c.executor.linhas("ia_leitura_da_midia")).toHaveLength(3);

    // A foto de um pedido com um procedimento do Cadastro: o modelo le so a
    // descricao do servidor.
    const pedido = "No pedido que você mandou, vi Exame. É isso mesmo?";
    const t5 = await c.foto(
      {
        tipo: "pedido_de_exame_ou_procedimento",
        procedimentos: [PROC.exame],
        codigos: [codigoDoProcedimento(CADASTRO, PROC.exame)],
        foraDoCadastro: 0,
        confianca: "alta",
      },
      { roteiro: [final(pedido)] },
    );
    respondeu(t5, pedido);
    expect(
      (t5.corpos[0]?.input as { content: string }[]).at(-1)?.content,
    ).toContain("Exame");
    await conversaFiada(c, ["Isso, depois eu vejo", "Obrigada"]);

    // O sinal de emergencia falado: passa como urgente, sem o agente.
    passou(
      await c.audio("estou com dor no peito e falta de ar"),
      { desfecho: "escalou", motivo: "urgencia", gatilho: "urgencia" },
      0,
    );
    expect(c.executor.linhas("conversa_urgente")).toHaveLength(1);

    // Depois da passagem, nem o texto nem o audio chamam modelo nenhum.
    await nadaMaisSai(c, ["alô?", "Sim"]);
    const t11 = await c.audio("sim, confirmo");
    expect(t11.chamadasAoModelo).toBe(0);
    expect(t11.enviadas).toEqual([]);
    expect(consulta.status).toBe("agendado");
  });

  it("o 'sim' falado cancela depois da pergunta, o 'não' falado não; a foto clínica passa para a equipe, sem o agente", async () => {
    const c = clinicaComDuasUnidades();
    const consulta = await marcarFalando(c);
    c.equipeAprova(consulta);

    const T1 = "Confirma o cancelamento da sua consulta de sexta, 30/10 às 14:00?";
    await sistemaResponde(c, "Quero cancelar", T1, pedirOCancelamento());
    const continua = "Tudo bem, sua consulta continua marcada.";
    respondeu(
      await c.audio("não, deixa", {
        roteiro: [ferramenta("cancelar_consulta", {}), final(continua)],
      }),
      continua,
    );
    expect(consulta.status).toBe("agendado");

    await sistemaResponde(
      c,
      "Pensando bem, quero cancelar sim",
      T1,
      pedirOCancelamento(),
    );
    respondeu(
      await c.audio("sim", { roteiro: [ferramenta("cancelar_consulta", {})] }),
      "Tudo bem, sua consulta de 30/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
    expect(consulta.status).toBe("cancelado_paciente");

    // A foto de uma receita: o leitor identificou, e a conversa passa.
    passou(
      await c.foto({
        tipo: "receita",
        procedimentos: [],
        codigos: [],
        foraDoCadastro: 0,
        confianca: "alta",
      }),
      { desfecho: "escalou", motivo: "midia_clinica", gatilho: null },
      0,
    );
    await nadaMaisSai(c, ["Sim"]);
  });

  it("o áudio sem fala no meio da marcação: nada é reservado nem marcado, e a conversa passa como mídia", async () => {
    const c = clinicaComDuasUnidades();
    await conversaEmAndamento(c);
    passou(
      await c.audio(null),
      { desfecho: "escalou", motivo: "midia_nao_suportada", gatilho: "midia" },
      0,
    );
    await nadaMaisSai(c, ["Sim", "Nasci em 12/03/1985"]);
    expect(c.consultas).toEqual([]);
  });
});
