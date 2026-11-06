import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({ config: null as unknown, catalogo: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => estado.catalogo,
}));

import { CODIGOS_DA_ATRIBUICAO } from "@/lib/agente/whatsapp";
import {
  MOTIVOS_QUE_NUNCA_ATRIBUEM,
  motivoPodeAtribuir,
} from "@/lib/domain/agente/config";

import {
  AUDIO,
  CODIGOS_DA_ATRIBUICAO_NA_AG6B,
  FOTO,
  linhaDeMidia,
  MOTIVOS_QUE_NUNCA_ATRIBUEM_NA_AG6B,
} from "./ag6b-contrato";
import { ANA } from "./ag6-contrato";
import {
  AGORA,
  decisaoDo,
  EXECUTOR,
  montarCenario,
  type OpcoesDoCenario,
} from "./ag6b-executor";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// AG6b, a ATRIBUICAO ao responsavel do lead com a midia (D-96): com a regra
// "responsavel_do_lead" ligada, a passagem com midia do paciente que o
// assistente nao leu (sem leitura, sem fala) nunca pede a atribuicao (o
// audio que ninguem ouviu pode ser uma emergencia: a fila de todos);
// midia_clinica e midia_nao_identificada nunca atribuem;
// documento_do_paciente atribui (e administrativo). O espelho: o codigo
// midia_nao_lida na ordem nova e os oito motivos. Nenhum teste chama a
// OpenAI.

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function texto(body: string, criadaEm = "2026-10-13T14:58:20.000Z") {
  return {
    id: `t-${body.length}`,
    clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
    conversation_id: "c0000000-0000-4000-8000-000000000001",
    author: "paciente",
    direction: "entrada",
    content_type: "texto",
    body,
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: criadaEm,
  };
}

async function rodar(o: Omit<OpcoesDoCenario, "passagemPara">) {
  const cenario = montarCenario(estado, { ...o, passagemPara: "responsavel_do_lead" });
  const resultado = await executarRespostaComIa(cenario.job, EXECUTOR, cenario.deps);
  return { cenario, resultado };
}

function conversa(cenario: ReturnType<typeof montarCenario>) {
  return cenario.banco.linhas("conversation")[0];
}

describe("o espelho da atribuicao (contrato da AG6b, secao 7)", () => {
  it("midia_nao_lida entre mensagem_nova e regra_fila; os oito motivos, nesta ordem", () => {
    expect([...CODIGOS_DA_ATRIBUICAO]).toEqual([...CODIGOS_DA_ATRIBUICAO_NA_AG6B]);
    expect([...MOTIVOS_QUE_NUNCA_ATRIBUEM]).toEqual([...MOTIVOS_QUE_NUNCA_ATRIBUEM_NA_AG6B]);
    expect(motivoPodeAtribuir("midia_clinica")).toBe(false);
    expect(motivoPodeAtribuir("midia_nao_identificada")).toBe(false);
    expect(motivoPodeAtribuir("documento_do_paciente")).toBe(true);
  });
});

describe("a midia nao lida nunca vai ao responsavel (D-96)", () => {
  it("o texto que escala antes da transcricao: o audio ninguem ouviu, a atribuicao nem sai", async () => {
    const { cenario } = await rodar({
      mensagens: [texto("quero falar com uma pessoa"), linhaDeMidia({ id: AUDIO, contentType: "audio" })],
    });
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "pedido_humano" });
    expect(cenario.transcrever).not.toHaveBeenCalled();
    expect(cenario.enviarFrase).toHaveBeenCalledTimes(1);
    expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(conversa(cenario)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(escrito.join("")).toContain('"status":"midia_nao_lida"');
  });

  it("o teto de respostas com o audio pendente: a fila, sem atribuir", async () => {
    const montado = montarCenario(estado, {
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      passagemPara: "responsavel_do_lead",
    });
    montado.banco.linhas("ia_liberacao")[0]!.teto_respostas_por_conversa_hora = 0;
    await executarRespostaComIa(montado.job, EXECUTOR, montado.deps);
    expect(decisaoDo(montado.banco)).toMatchObject({ escalation_reason: "teto_de_respostas" });
    expect(montado.transcrever).not.toHaveBeenCalled();
    expect(montado.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
  });

  it("o audio sem fala: midia_nao_suportada (nunca atribui), sem chamar", async () => {
    const { cenario } = await rodar({
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcricao: {
        [AUDIO]: { tipo: "sem_fala", segundos: 5, uso: { modelo: "whisper-1", segundos: 5 } },
      },
    });
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "midia_nao_suportada" });
    expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([
      expect.objectContaining({ tipo: "sem_fala", transcricao: null }),
    ]);
  });

  it("a transcricao que falhou: falha tecnica, a fila, sem atribuir", async () => {
    const { cenario } = await rodar({
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcricao: {
        [AUDIO]: { tipo: "falhou", motivo: "timeout", uso: { modelo: "whisper-1", segundos: 15 } },
      },
    });
    expect(decisaoDo(cenario.banco)).toMatchObject({
      desfecho: "falhou",
      escalation_reason: "falha_tecnica",
      motivo_da_falha: "timeout",
    });
    expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(cenario.banco.linhas("ia_leitura_da_midia")).toEqual([]);
  });
});

describe("a midia lida", () => {
  it("o pedido de pessoa falado (o audio transcrito): atribui como o escrito", async () => {
    const { cenario } = await rodar({
      mensagens: [linhaDeMidia({ id: AUDIO, contentType: "audio" })],
      transcricao: {
        [AUDIO]: {
          tipo: "transcrita",
          texto: "quero falar com uma pessoa",
          segundos: 4,
          uso: { modelo: "whisper-1", segundos: 4 },
        },
      },
    });
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: "pedido_humano" });
    expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toHaveLength(1);
    expect(conversa(cenario)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: ANA,
    });
    // A frase antes da atribuicao (R1.3).
    expect(cenario.marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
  });

  it("a guia (documento_do_paciente) atribui: e administrativo", async () => {
    const { cenario } = await rodar({
      mensagens: [linhaDeMidia({ id: FOTO, contentType: "imagem" })],
      leitura: {
        [FOTO]: {
          tipo: "lido",
          leitura: {
            tipo: "guia_ou_autorizacao",
            procedimentos: [],
            codigos: [],
            foraDoCadastro: 0,
            confianca: "alta",
            convenioId: null,
            numeroDaCarteirinha: null,
          },
          modelo: "gpt-6-luna",
          uso: null,
        },
      },
    });
    expect(decisaoDo(cenario.banco)).toMatchObject({
      escalation_reason: "documento_do_paciente",
      gatilho_entrada: null,
    });
    expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toHaveLength(1);
    expect(conversa(cenario)).toMatchObject({ assignee_user_id: ANA });
  });

  it.each([
    ["receita", "midia_clinica", "alta"],
    ["foto_do_corpo", "midia_clinica", "alta"],
    ["outro", "midia_nao_identificada", "baixa"],
    ["carteirinha", "midia_nao_identificada", "baixa"],
    ["documento_de_identidade", "midia_nao_identificada", "baixa"],
  ] as const)("%s (%s, confianca %s): nunca atribui, a chamada nem sai", async (tipo, motivo, confianca) => {
    const { cenario } = await rodar({
      mensagens: [linhaDeMidia({ id: FOTO, contentType: "imagem" })],
      leitura: {
        [FOTO]: {
          tipo: "lido",
          leitura: {
            tipo,
            procedimentos: [],
            codigos: [],
            foraDoCadastro: 0,
            confianca,
            convenioId: null,
            numeroDaCarteirinha: null,
          },
          modelo: "gpt-6-luna",
          uso: null,
        },
      },
    });
    expect(decisaoDo(cenario.banco)).toMatchObject({ escalation_reason: motivo });
    expect(cenario.banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(conversa(cenario)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
  });

  it("o evento da passagem do motivo novo no fio (o rotulo do banco)", async () => {
    const { cenario } = await rodar({
      mensagens: [linhaDeMidia({ id: FOTO, contentType: "imagem" })],
      leitura: {
        [FOTO]: {
          tipo: "lido",
          leitura: {
            tipo: "resultado_ou_laudo",
            procedimentos: [],
            codigos: [],
            foraDoCadastro: 0,
            confianca: "alta",
            convenioId: null,
            numeroDaCarteirinha: null,
          },
          modelo: "gpt-6-luna",
          uso: null,
        },
      },
    });
    expect(
      cenario.banco.linhas("message").filter((m) => m.content_type === "evento").map((m) => m.body),
    ).toContain(
      "A IA passou a conversa para a equipe: o paciente mandou um arquivo que só a equipe pode avaliar.",
    );
    void AGORA;
  });
});
