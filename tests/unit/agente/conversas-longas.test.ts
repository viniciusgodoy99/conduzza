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

import { FRASE_DO_ASSISTENTE_VIRTUAL } from "@/lib/domain/conformidade/frase-fixa";

import { ferramenta, final } from "./ag4-conversa";
import { codigoDoProcedimento, iso, PROC } from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  ENDERECO_DA_ALDEOTA,
  ENDERECO_DO_CENTRO,
  UNID,
} from "./cadastro-fixtures";
import {
  ConversaLonga,
  prepararOTeste,
  saidasDoTurno,
  trilhaDoTurno,
  type TurnoDaConversa,
} from "./conversa-longa";

const CADASTRO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CADASTRO, PROC.consulta);

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

let escrito: string[] = [];
let conversaDoTeste: ConversaLonga | null = null;

beforeEach(() => {
  prepararOTeste();
  escrito = [];
  conversaDoTeste = null;
  const capturar = (linha: string | Uint8Array): boolean => {
    escrito.push(String(linha));
    return true;
  };
  if (!process.env.DEPURAR) {
    vi.spyOn(process.stdout, "write").mockImplementation(capturar);
    vi.spyOn(process.stderr, "write").mockImplementation(capturar);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  conversaDoTeste?.conferirOsLogs(escrito);
});

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

describe("1. preço, convênio, endereço, agenda, troca de horário e confirmação", () => {
  it("cada assunto responde com o fato do turno; a troca solta a reserva antiga; só a última vira consulta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;

    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    const t1 = await c.fala({
      texto: "Oi, quanto custa a consulta?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    respondeu(t1, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${preco}`);
    expect(t1.ferramentas).toEqual(["buscar_procedimento"]);
    expect(t1.decisao?.tool_used).toBe("buscar_procedimento");
    expect(t1.estado).toMatchObject({ etapa: "informacao", intencao: null });

    const convenio =
      "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional).";
    const t2 = await c.fala({
      texto: "Vocês atendem Unimed?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: "Unimed Nacional",
        }),
        final(convenio),
      ],
    });
    respondeu(t2, convenio);
    expect(t2.estado).toMatchObject({ etapa: "informacao", intencao: null });

    const endereco = `Temos duas unidades: Aldeota, na ${ENDERECO_DA_ALDEOTA}, e Centro, na ${ENDERECO_DO_CENTRO}.`;
    const t3 = await c.fala({
      texto: "Onde fica a clínica?",
      roteiro: [
        ferramenta("consultar_unidades", { unidade: null }),
        final(endereco),
      ],
    });
    respondeu(t3, endereco);
    expect(t3.decisao?.tool_used).toBe("consultar_unidades");

    const estacionamento =
      "Na unidade Aldeota tem estacionamento no subsolo do prédio.";
    const t4 = await c.fala({
      texto: "Tem estacionamento?",
      roteiro: [
        ferramenta("consultar_unidades", { unidade: "u1" }),
        final(estacionamento),
      ],
    });
    respondeu(t4, estacionamento);
    // Quatro respostas sem nenhum passo de agenda: nada reservado.
    expect(c.reservasVivas).toEqual([]);
    expect(c.cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);

    const oferta =
      "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?";
    const t5 = await c.fala({
      texto: "Quero marcar uma consulta à tarde, no particular",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(oferta),
      ],
    });
    respondeu(t5, oferta);
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

    const reservou =
      "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    const t6 = await c.fala({
      texto: "Pode ser quarta às 14h",
      roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(reservou)],
    });
    respondeu(t6, reservou);
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
    const t7 = await c.fala({
      texto: "Mudei de ideia, prefiro quinta às 14h",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-22", hora: "14:00" }),
        ),
        // h5 e o Dr. Bruno no mesmo horario; h6, a Dra. Ana.
        ferramenta("reservar_horario", { horario: "h6" }),
        final(trocou),
      ],
    });
    respondeu(t7, trocou);
    expect(t7.ferramentas).toEqual(["buscar_horario", "reservar_horario"]);
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-22", "14:00") }),
    ]);
    expect(t7.estado.slot_hold_id).not.toBe(reservaDeQuarta);
    expect(t7.estado.slot_hold_id).toBe(c.reservasVivas[0]?.id);

    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quinta, 22/10 às 14:00, na unidade Centro, no particular?";
    const t8 = await c.fala({
      texto: "Maria da Silva Souza, nascida em 12/03/1985",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(confirma),
      ],
    });
    respondeu(t8, confirma);
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
    const t9 = await c.fala({
      texto: "Sim, confirmo",
      roteiro: [ferramenta("agendar", {}), final(marcou)],
    });
    respondeu(t9, marcou);
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
    const t10 = await c.fala({
      texto: "O que eu preciso levar?",
      roteiro: [
        ferramenta("consultar_requisitos", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(levar),
      ],
    });
    respondeu(t10, levar);
    expect(t10.estado).toMatchObject({
      etapa: "pos_marcacao",
      appointment_id: c.consultas[0]?.id,
    });

    const tchau = "Por nada! Qualquer coisa, é só chamar por aqui.";
    const t11 = await c.fala({
      texto: "Obrigada!",
      roteiro: [final(tchau)],
    });
    respondeu(t11, tchau);

    // A conversa inteira: uma mensagem por fala, na ordem; o aviso uma vez so;
    // uma decisao aprovada por resposta; uma consulta.
    expect(c.recebidasPeloPaciente).toEqual([
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${preco}`,
      convenio,
      endereco,
      estacionamento,
      oferta,
      reservou,
      trocou,
      confirma,
      marcou,
      levar,
      tchau,
    ]);
    expect(c.decisoes.map((d) => d.desfecho)).toEqual(
      Array.from({ length: 11 }, () => "respondeu"),
    );
    expect(c.consultas).toHaveLength(1);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(c.conversa.status).toBe("ia_atendendo");
  });
});
