import { describe, expect, it, vi } from "vitest";

import { acertarGasto } from "@/lib/agente/gasto";
import {
  alertasDoMotor,
  motorDaIaParado,
  type SaudeDoMotor,
} from "@/lib/domain/motor";
import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
import { fetchComplianceDecisions } from "@/lib/queries/conversations";
import {
  fetchLiberacaoDaIa,
  lerSituacaoDoBanco,
  motorParadoDaSituacao,
} from "@/lib/queries/ia-liberacao";

import { BancoEmMemoria } from "./banco-em-memoria";

// Pecas menores do E3 no servidor: o desfecho do interceptador, a chave "ia"
// da saude do motor, as decisoes do fio sem blocked_draft, o gasto com a
// conversa e o job, e a leitura da situacao da IA para a aba (com o motor
// parado vindo da situacao desde a revisao do E3).

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const UM_ID = "e0000000-0000-4000-8000-000000000001";
const OUTRO_ID = "e0000000-0000-4000-8000-000000000002";

describe("interceptador: desfecho", () => {
  const entrada = {
    clinicId: CLINICA,
    contactId: "c1",
    conversationId: CONVERSA,
    contentType: "texto" as const,
    body: "Bom dia, quanto custa?",
    quotedWaMessageId: null,
    whatsappAccountId: null,
  };

  it("mídia e texto vazio: nao_texto; mensagem comum: sem_intencao, sem ir ao banco", async () => {
    const banco = new BancoEmMemoria();
    expect(
      await interceptarRespostaDePaciente(banco.cliente(), {
        ...entrada,
        contentType: "imagem",
      }),
    ).toBe("nao_texto");
    expect(
      await interceptarRespostaDePaciente(banco.cliente(), {
        ...entrada,
        body: null,
      }),
    ).toBe("nao_texto");
    expect(await interceptarRespostaDePaciente(banco.cliente(), entrada)).toBe(
      "sem_intencao",
    );
    expect(banco.operacoes).toEqual([]);
    expect(banco.chamadas).toEqual([]);
  });
});

describe("saúde do motor: chave ia", () => {
  const vivo = new Date().toISOString();
  const base: SaudeDoMotor = {
    fila: { batida_em: vivo },
    planner: { batida_em: vivo },
    atrasados: 0,
  };
  const ia = {
    batida_em: null,
    ultimo_erro: null,
    agendado: true,
    vigiado: true,
    devidos: 0,
    alerta: false,
  };

  it("ia_parada só com o alerta do banco; sem a chave (banco antes da M1), nada", () => {
    expect(alertasDoMotor(base, new Date())).toEqual([]);
    expect(motorDaIaParado(base)).toBe(false);
    expect(alertasDoMotor({ ...base, ia }, new Date())).toEqual([]);
    expect(
      alertasDoMotor(
        { ...base, ia: { ...ia, devidos: 2, alerta: true } },
        new Date(),
      ),
    ).toEqual(["ia_parada"]);
    expect(motorDaIaParado({ ...base, ia: { ...ia, alerta: true } })).toBe(
      true,
    );
    expect(motorDaIaParado(null)).toBe(false);
  });

  it("a batida velha da IA não alarma (a guarda não chama a rota sem trabalho)", () => {
    expect(
      alertasDoMotor(
        { ...base, ia: { ...ia, batida_em: "2026-01-01T00:00:00.000Z" } },
        new Date(),
      ),
    ).toEqual([]);
  });
});

describe("decisões no fio", () => {
  it("não pede blocked_draft (o grant novo daria 42501) e erro lança", async () => {
    const selecionado: string[] = [];
    const cliente = {
      from: () => {
        const cadeia = {
          select: (colunas: string) => {
            selecionado.push(colunas);
            return cadeia;
          },
          eq: () => cadeia,
          then: (ok: (r: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(ok),
        };
        return cadeia;
      },
    };
    await fetchComplianceDecisions(
      cliente as unknown as Parameters<typeof fetchComplianceDecisions>[0],
      CONVERSA,
    );
    expect(selecionado).toEqual([
      "id, message_id, compliance_rule, escalation_reason, created_at",
    ]);
    const banco = new BancoEmMemoria();
    banco.erros.set("ai_decision_log:select", { code: "42501", message: "x" });
    await expect(
      fetchComplianceDecisions(banco.cliente(), CONVERSA),
    ).rejects.toThrow();
  });
});

describe("gasto do turno do WhatsApp", () => {
  it("acertarGasto grava a conversa e o job em cada linha", async () => {
    const banco = new BancoEmMemoria();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const ok = await acertarGasto(banco.cliente(), {
      reservaId: UM_ID,
      clinicId: CLINICA,
      origem: "whatsapp",
      usos: [
        {
          papel: "agente",
          modelo: "gpt-6-luna",
          uso: {
            tokensEntrada: 10,
            tokensSaida: 1,
            tokensCacheLidos: 0,
            tokensCacheGravados: 0,
          },
        },
      ],
      precos: [
        {
          modelo: "gpt-6-luna",
          entrada: 1,
          saida: 1,
          cacheLeitura: 1,
          cacheEscrita: 1,
        },
      ],
      conversationId: CONVERSA,
      jobId: JOB,
    });
    expect(ok).toBe(true);
    const [args] = banco.chamadasDe("acertar_gasto_da_ia");
    expect(args?.p_linhas).toEqual([
      expect.objectContaining({
        conversation_id: CONVERSA,
        job_id: JOB,
        origem: "whatsapp",
      }),
    ]);
    vi.restoreAllMocks();
  });
});

describe("situação da IA para a aba", () => {
  it("lerSituacaoDoBanco: o jsonb em tipos; formato estranho lança", () => {
    expect(
      lerSituacaoDoBanco({
        teto_atingido: false,
        versao_publicada: 3,
        telefones_invalidos: [UM_ID],
        telefones_sem_autorizacao: [UM_ID],
        telefones_com_conversa_aberta: [],
        conversas_abertas: [],
        motor_parado: false,
      }),
    ).toEqual({
      tetoAtingido: false,
      versaoPublicada: 3,
      telefonesInvalidos: [UM_ID],
      telefonesSemAutorizacao: [UM_ID],
      conversasAbertas: [],
      motorParado: false,
    });
    expect(
      lerSituacaoDoBanco({
        teto_atingido: true,
        versao_publicada: null,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [UM_ID],
        conversas_abertas: [
          {
            telefone_id: UM_ID,
            whatsapp_account_id: OUTRO_ID,
            conversation_id: CONVERSA,
          },
        ],
        motor_parado: true,
      }),
    ).toMatchObject({
      versaoPublicada: null,
      motorParado: true,
      conversasAbertas: [
        { telefoneId: UM_ID, numeroId: OUTRO_ID, conversaId: CONVERSA },
      ],
    });
    for (const ruim of [
      null,
      {},
      {
        teto_atingido: "nao",
        versao_publicada: null,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        motor_parado: false,
      },
      {
        teto_atingido: false,
        versao_publicada: "3",
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        motor_parado: false,
      },
      {
        teto_atingido: false,
        versao_publicada: null,
        telefones_invalidos: null,
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        motor_parado: false,
      },
      // Conferencia da revisao (telas N1): sem a lista dos telefones cujo
      // contato revogou a autorizacao, a aba nao afirma que eles conversam.
      {
        teto_atingido: false,
        versao_publicada: 3,
        telefones_invalidos: [],
        telefones_com_conversa_aberta: [],
        motor_parado: false,
      },
      // Revisao do E3 (T3): sem o motor, a aba nao afirma nada (lanca e a
      // pagina mostra o erro, nunca o verde).
      {
        teto_atingido: false,
        versao_publicada: 3,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
      },
      {
        teto_atingido: false,
        versao_publicada: 3,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        conversas_abertas: [],
        motor_parado: null,
      },
      // Revisao de producao de 19/10/2026: sem conversas_abertas (o banco
      // de antes da migration 20261019120000), a aba nao afirma nada sobre
      // a conversa aberta: lanca e a pagina mostra o erro, nunca o verde.
      {
        teto_atingido: false,
        versao_publicada: 3,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        motor_parado: false,
      },
      {
        teto_atingido: false,
        versao_publicada: 3,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        conversas_abertas: null,
        motor_parado: false,
      },
    ]) {
      expect(() => lerSituacaoDoBanco(ruim)).toThrow();
    }
  });

  it("lerSituacaoDoBanco: item de conversas_abertas fora do formato fica de fora", () => {
    const valido = {
      telefone_id: UM_ID,
      whatsapp_account_id: OUTRO_ID,
      conversation_id: CONVERSA,
    };
    expect(
      lerSituacaoDoBanco({
        teto_atingido: false,
        versao_publicada: 1,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        conversas_abertas: [
          valido,
          null,
          "texto",
          { ...valido, conversation_id: "nao-e-uuid" },
          { ...valido, telefone_id: null },
          { whatsapp_account_id: OUTRO_ID, conversation_id: CONVERSA },
        ],
        motor_parado: false,
      }).conversasAbertas,
    ).toEqual([
      { telefoneId: UM_ID, numeroId: OUTRO_ID, conversaId: CONVERSA },
    ]);
  });

  it("motorParadoDaSituacao: o booleano, ou null quando não dá para afirmar (o Devolver trata como não conferido)", () => {
    expect(motorParadoDaSituacao({ motor_parado: true })).toBe(true);
    expect(motorParadoDaSituacao({ motor_parado: false })).toBe(false);
    expect(motorParadoDaSituacao({ teto_atingido: false })).toBeNull();
    expect(motorParadoDaSituacao({ motor_parado: "nao" })).toBeNull();
    expect(motorParadoDaSituacao(null)).toBeNull();
  });

  function bancoDaAba() {
    const banco = new BancoEmMemoria();
    banco.rpc("ia_interruptor_ligado", () => ({ data: true, error: null }));
    banco.rpc("situacao_da_ia_na_clinica", () => ({
      data: {
        teto_atingido: true,
        versao_publicada: 2,
        telefones_invalidos: [],
        telefones_sem_autorizacao: [],
        telefones_com_conversa_aberta: [],
        conversas_abertas: [],
        motor_parado: true,
      },
      error: null,
    }));
    banco.linhas("ai_agent_config").push({
      clinic_id: CLINICA,
      status: "publicada",
      version: 2,
      operating_mode: "fallback",
      fallback_minutes: 7,
      operating_hours: {},
    });
    return banco;
  }

  it("fetchLiberacaoDaIa traz a situação, o horário publicado e o motor (da situação, não da saúde)", async () => {
    const banco = bancoDaAba();
    const dados = await fetchLiberacaoDaIa(banco.cliente(), CLINICA);
    expect(dados.situacao).toMatchObject({
      tetoAtingido: true,
      versaoPublicada: 2,
      horarioPublicado: { modo: "fallback", minutosSemResposta: 7 },
      motorParado: true,
    });
    // B8: a sessao comum recebe ia = null em saude_do_motor; a aba nao a le.
    expect(banco.chamadasDe("saude_do_motor")).toEqual([]);
  });

  it("a situação (com o motor) que falha derruba a aba: nunca um verde sem conferir", async () => {
    const semSituacao = bancoDaAba();
    semSituacao.rpc("situacao_da_ia_na_clinica", () => ({
      data: null,
      error: { code: "42501" },
    }));
    await expect(
      fetchLiberacaoDaIa(semSituacao.cliente(), CLINICA),
    ).rejects.toThrow();
  });

  it("sem versão publicada: horário nulo", async () => {
    const banco = bancoDaAba();
    banco.tabelas.set("ai_agent_config", []);
    expect(
      (await fetchLiberacaoDaIa(banco.cliente(), CLINICA)).situacao
        .horarioPublicado,
    ).toBeNull();
  });
});
