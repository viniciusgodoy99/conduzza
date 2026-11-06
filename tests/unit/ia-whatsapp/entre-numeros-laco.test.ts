import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente, ResultadoDoTurno } from "@/lib/agente/laco";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria } from "./banco-em-memoria";
import { aprovarParaTeste } from "./texto-aprovado-de-teste";

// A terceira camada da trava contra o laco do teste entre numeros (migration
// 20261106100000): dois agentes de verdade (o executor do job), cada um com o
// seu banco em memoria, e as duas primeiras camadas FALHANDO de proposito
// (ia_pode_falar_com sempre verdadeiro dos dois lados). O que um envia chega ao
// outro como mensagem nova e vira um turno. O teto de respostas por conversa por
// hora tem de parar os dois. Nenhum teste chama a OpenAI nem o WhatsApp.

const estado = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");
type Dependencias = Parameters<typeof executarRespostaComIa>[2];

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const RESPOSTA = "A consulta custa R$ 150,00.";
const INICIO = Date.UTC(2026, 10, 6, 15, 0);
const USO = { tokensEntrada: 1, tokensSaida: 1, tokensCacheLidos: 0, tokensCacheGravados: 0 };
const APROVADA = await aprovarParaTeste(RESPOSTA, [15_000]);

function respondeu(): ResultadoDoTurno {
  return {
    trilha: [],
    uso: [{ papel: "agente", modelo: "gpt-6-luna", uso: USO }],
    versaoDoPrompt: "agente-teste",
    descartados: { instrucoes: false, itensDaBase: 0 },
    tipo: "resposta",
    resposta: APROVADA,
    desfecho: { tipo: "respondeu" },
    filtro: {
      aprovado: true,
      texto: APROVADA,
      sha256: sha256DoTexto(RESPOSTA),
      versaoDasRegras: "regras-teste",
      verificador: { modelo: "gpt-6-luna", uso: USO },
    },
    rascunhoBloqueado: null,
  };
}

const configPublicada = (): ConfigDoAgente => ({
  ...configPadraoDoAgente(),
  status: "publicada",
  versao: 3,
});

type Lado = {
  nome: string;
  banco: BancoEmMemoria;
  conversa: string;
  numero: string;
  outro: Lado | null;
  respostas: number;
  frases: number;
  turnos: number;
  passagens: string[];
};

let tempo: number;
let fila: { lado: Lado; mensagem: string }[];
let ids: number;

function novoId(): string {
  ids += 1;
  return `10000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
}

/** O que sai por um lado chega ao outro: linha nova e um turno na fila. */
function entregar(de: Lado, corpo: string) {
  const para = de.outro!;
  const id = novoId();
  para.banco.linhas("message").push({
    id,
    clinic_id: CLINICA,
    conversation_id: para.conversa,
    author: "paciente",
    direction: "entrada",
    content_type: "texto",
    body: corpo,
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: new Date(tempo).toISOString(),
  });
  // Como o webhook: conversa fora da IA nao enfileira turno.
  if (para.banco.linhas("conversation")[0]!.status === "ia_atendendo") {
    fila.push({ lado: para, mensagem: id });
  }
}

function montarLado(nome: string, teto: number): Lado {
  const banco = new BancoEmMemoria();
  const conversa = novoId();
  const numero = novoId();
  const contato = novoId();
  const telefone = nome === "A" ? "+5584970001101" : "+5584970001102";
  const lado: Lado = { nome, banco, conversa, numero, outro: null, respostas: 0, frases: 0, turnos: 0, passagens: [] };
  banco.linhas("clinic").push({ id: CLINICA, timezone: "America/Fortaleza", e_de_teste: false });
  banco.linhas("conversation").push({
    id: conversa,
    clinic_id: CLINICA,
    status: "ia_atendendo",
    assignee_user_id: null,
    contact_id: contato,
    whatsapp_account_id: numero,
    awaiting_reply: true,
  });
  banco.linhas("contact").push({ id: contato, clinic_id: CLINICA, phone_key: telefone, name: null, birth_date: null });
  banco.linhas("ia_janela_da_conversa").push({
    conversation_id: conversa,
    clinic_id: CLINICA,
    contact_id: contato,
    phone_key: telefone,
    desde: new Date(INICIO - 60_000).toISOString(),
    aberta_por: "ingestao",
  });
  banco.linhas("ia_liberacao").push({ clinic_id: CLINICA, teto_respostas_por_conversa_hora: teto });
  banco.linhas("llm_preco").push({
    modelo: "gpt-6-luna",
    entrada_microdolar_por_milhao: 1_000_000,
    saida_microdolar_por_milhao: 4_000_000,
    cache_leitura_microdolar_por_milhao: 100_000,
    cache_escrita_microdolar_por_milhao: 0,
  });
  // As duas primeiras camadas falhando: sempre pode falar.
  banco.rpc("ia_pode_falar_com", () => ({ data: true, error: null }));
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("consentimento_vigente", () => ({ data: true, error: null }));
  banco.rpc("reservar_gasto_da_ia", () => ({ data: novoId(), error: null }));
  banco.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.rpc("gravar_evento_da_ia", () => ({ data: true, error: null }));
  banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
    lado.passagens.push(String(args.p_motivo));
    banco.linhas("conversation")[0]!.status = "aguardando_humano";
    return { data: { passou: true, codigo: "passou" }, error: null };
  });
  return lado;
}

function deps(lado: Lado): Dependencias {
  return {
    admin: lado.banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: tempo + 55_000,
    agora: () => tempo,
    clienteDoAgente: () =>
      ({ responses: { create: vi.fn() } }) as unknown as ClienteDoAgente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: () => async () => ({
      tipo: "falha", motivo: "sem_cliente", modelo: null, uso: null, httpStatus: null,
    }),
    criarClassificador: () => async () => ({
      tipo: "falha", motivo: "sem_cliente", modelo: null, uso: null, httpStatus: null,
    }),
    executarTurno: async () => {
      lado.turnos += 1;
      return respondeu();
    },
    enviarResposta: async () => {
      lado.respostas += 1;
      lado.banco.linhas("message").push({
        id: novoId(),
        clinic_id: CLINICA,
        conversation_id: lado.conversa,
        author: "ia",
        direction: "saida",
        content_type: "texto",
        body: RESPOSTA,
        created_at: new Date(tempo).toISOString(),
      });
      entregar(lado, RESPOSTA);
      return { ok: true, messageId: novoId() };
    },
    enviarFrase: async () => {
      lado.frases += 1;
      entregar(lado, FRASE_DE_ESCALONAMENTO);
      return { ok: true, messageId: novoId() };
    },
  };
}

function job(lado: Lado, mensagem: string): Job {
  return {
    id: novoId(),
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: lado.conversa, ultima_mensagem_id: mensagem },
    attempts: 1,
    max_attempts: 3,
    whatsapp_account_id: lado.numero,
    created_at: new Date(tempo).toISOString(),
  };
}

/** Roda o mundo ate a fila secar ou o limite de passagens. */
async function simular(teto: number, limite: number) {
  const a = montarLado("A", teto);
  const b = montarLado("B", teto);
  a.outro = b;
  b.outro = a;
  entregar(a, "Oi, quanto custa a consulta?");
  let passos = 0;
  while (fila.length > 0 && passos < limite) {
    const proximo = fila.shift()!;
    tempo += 5_000;
    const r = await executarRespostaComIa(
      job(proximo.lado, proximo.mensagem),
      EXECUTOR,
      deps(proximo.lado),
    );
    expect(r).toEqual({ ok: true });
    passos += 1;
  }
  return { a, b, passos, secou: fila.length === 0 };
}

beforeEach(() => {
  estado.config = configPublicada();
  tempo = INICIO;
  fila = [];
  ids = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o laco entre dois agentes, com as duas primeiras camadas falhando", () => {
  it("sem teto que segure, o mundo nao para: a simulacao e um laco de verdade", async () => {
    const { a, b, secou } = await simular(1_000, 40);
    expect(secou).toBe(false);
    expect(a.respostas + b.respostas).toBe(40);
    expect(a.passagens).toEqual([]);
    expect(b.passagens).toEqual([]);
  });

  it("o teto de 20 respostas por hora para os dois lados, sem nenhum turno a mais", async () => {
    const { a, b, secou, passos } = await simular(20, 500);
    expect(secou).toBe(true);
    expect(passos).toBeLessThan(500);
    expect(a.respostas).toBe(20);
    expect(b.respostas).toBe(20);
    expect(a.turnos).toBe(a.respostas);
    expect(b.turnos).toBe(b.respostas);
    // Quem chegou no teto passou para a equipe, com o motivo, e a frase fixa;
    // o outro lado para porque a conversa dele tambem chega no teto ou porque
    // nao vem mais nada.
    const pararam = [...a.passagens, ...b.passagens];
    expect(pararam).toContain("teto_de_respostas");
    expect(pararam.every((m) => m === "teto_de_respostas")).toBe(true);
    expect(a.frases + b.frases).toBe(pararam.length);
  });

  it("depois do teto, nem um novo turno: a conversa fora da IA nao responde", async () => {
    const { a, b } = await simular(3, 500);
    const antes = a.respostas + b.respostas;
    // Chega mais uma mensagem nos dois lados: conversa fora da IA, sem fila; e o
    // executor, se rodar mesmo assim, conclui sem turno.
    const parado = a.passagens.length > 0 ? a : b;
    tempo += 5_000;
    const r = await executarRespostaComIa(job(parado, "qualquer"), EXECUTOR, deps(parado));
    expect(r).toEqual({ ok: true });
    expect(a.respostas + b.respostas).toBe(antes);
  });
});
