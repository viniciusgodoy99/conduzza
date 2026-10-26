import { describe, expect, it } from "vitest";

import {
  CLINICA_SEM_NOME,
  fetchClinicaDoPainel,
  fetchEquipeDaClinica,
  fetchHistoricoDaConta,
  fetchNotasDaClinica,
  fetchNumeroDaClinicaNoPainel,
  fetchPainelGeral,
  fetchRequisitosDaProducao,
  fetchTetosDaIa,
  lerEquipeDoBanco,
  lerHistoricoDoBanco,
  lerNotasDoBanco,
  lerPainelDoBanco,
  lerRequisitosDoBanco,
  registrarExportacaoDoPainel,
  saudeDosSinais,
} from "@/lib/queries/painel-geral";

// Leitura do Painel geral como acompanhamento de cliente (26/10/2026): o
// jsonb de painel_cs_das_clinicas() e o de equipe_da_clinica_no_painel(),
// nas chaves do contrato da frente de banco (migration
// 20261026100000_painel_cs.sql, "FORMATO EXATO"). Campo essencial fora do
// formato LANCA (a tela mostra o erro, nunca um painel que afirma o que nao
// leu: uma clinica "em uso" sem o acesso que prova, uma pessoa com papel
// inventado); item de lista que so serve a busca, ou um numero sem id, fica
// de fora. As RPCs sao chamadas com a sessao (as clinicas e_de_teste ficam
// fora do painel). painel_geral_das_clinicas (onda 1) nao e mais lida. Onda
// 2 (item 11): o leitor entende 'producao' e 'numero_inteiro', e os
// requisitos da producao tem leitura propria ("indisponivel" sem a
// migration).
//
// Segunda leva (26/10/2026, migration 20261026110000_painel_cs_2.sql): o
// gasto em microdolares e as chamadas, a saude e os sinais, a implantacao,
// a tendencia, a ultima nota e, nos totais, a contagem por saude. O banco
// decide; a leitura confere a coerencia (a saude com os sinais, os sinais
// com a linha, os passos com a contagem, a tendencia com os 30 dias, os
// microdolares com os centavos e a contagem por saude com as linhas) e
// LANCA quando nao bate. As notas e o historico da conta tem leitura
// propria; a trilha da exportacao vai direto para audit_log.

const ID = "acd9c539-585e-4f2a-a195-712c70099564";
const OUTRA = "f0c115dd-e98c-4767-a1bb-93d517844852";
const NUMERO = "a1111111-1111-4111-8111-111111111111";
const PESSOA = "b2222222-2222-4222-8222-222222222222";
const IMPLEMENTADOR = "c3333333-3333-4333-8333-333333333333";
const GERADO_EM = "2026-10-26T12:00:00.123456+00:00";

function clinicaDoBanco(campos: Record<string, unknown> = {}) {
  return {
    id: ID,
    nome: "teste123",
    criada_em: "2026-08-20T12:00:00+00:00",
    fuso: "America/Fortaleza",
    em_uso: true,
    ultimo_acesso: {
      em: "2026-10-25T13:00:00.5+00:00",
      user_id: PESSOA,
      nome: "Ana Souza",
      email: "ana@teste123.com.br",
      papel: "recepcao",
      implementador: false,
      equipe_conduzza: false,
    },
    membros_ativos: 4,
    membros_pendentes: 1,
    membros_equipe_conduzza: 1,
    pessoas: [
      { nome: "Ana Souza", email: "ana@teste123.com.br" },
      { nome: null, email: "sem.nome@teste123.com.br" },
      { nome: null, email: null },
      "texto",
    ],
    numeros_total: 2,
    numeros_conectados: 1,
    numeros: [
      {
        id: NUMERO,
        nome: "Recepção",
        final: "0000",
        conexao: "conectado",
        ia_ligada: true,
      },
      { id: "nao-e-uuid", nome: "Quebrado", final: "1", conexao: "x" },
    ],
    contatos: 250,
    leads_30_dias: 12,
    conversas_30_dias: 33,
    ultima_mensagem_em: "2026-10-20T13:00:00+00:00",
    suspensao: null,
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausada_pela_clinica: false,
      telefones_ligados: 2,
    },
    gasto: {
      ultimas_24h_centavos_usd: 42,
      mes_centavos_usd: 310,
      ultimas_24h_sem_simulador_centavos_usd: 30,
      mes_sem_simulador_centavos_usd: 200,
      ultimas_24h_microdolares: 421_500,
      mes_microdolares: 3_100_400,
      ultimas_24h_sem_simulador_microdolares: 300_000,
      mes_sem_simulador_microdolares: 1_999_999,
      ultimas_24h_chamadas: 12,
      mes_chamadas: 40,
      ultimas_24h_sem_simulador_chamadas: 5,
      mes_sem_simulador_chamadas: 20,
    },
    teto_diario_centavos_usd: 500,
    saude: "saudavel",
    sinais: [],
    implantacao: implantacaoDoBanco(),
    tendencia: {
      leads: {
        atual: 12,
        anterior: 8,
        variacao_percentual: 50,
        direcao: "subindo",
      },
      conversas: {
        atual: 33,
        anterior: 0,
        variacao_percentual: null,
        direcao: "sem_base",
      },
    },
    ultima_nota_em: "2026-10-24T12:00:00+00:00",
    ...campos,
  };
}

/** Os seis passos, como o banco manda (tres feitos). */
function implantacaoDoBanco(campos: Record<string, unknown> = {}) {
  return {
    feitos: 3,
    total: 6,
    passos: [
      { chave: "whatsapp_conectado", feito: true, quantidade: 1 },
      { chave: "equipe_com_duas_pessoas", feito: true, quantidade: 4 },
      { chave: "procedimentos_cadastrados", feito: true, quantidade: 12 },
      { chave: "profissionais_cadastrados", feito: false, quantidade: 0 },
      { chave: "regua_de_confirmacao_ligada", feito: false, quantidade: 0 },
      { chave: "anuncios_conectados", feito: false, quantidade: 0 },
    ],
    anuncios: { meta: false, google: false },
    ...campos,
  };
}

/** Os sinais de uma clinica sem uso e suspensa (o banco manda os dois). */
const SINAIS_SEM_USO_E_SUSPENSA = [
  {
    chave: "conta_suspensa",
    nivel: "em_risco",
    quantidade: null,
    desde: "2026-10-18T10:00:00+00:00",
  },
  { chave: "sem_uso", nivel: "em_risco", quantidade: null, desde: null },
];

/** A contagem por saude das linhas, como os totais do banco trazem. */
function saudeDasLinhas(clinicas: unknown[]) {
  const contagem = { saudavel: 0, atencao: 0, em_risco: 0 };
  for (const clinica of clinicas) {
    const saude = (clinica as { saude?: unknown }).saude;
    if (saude === "saudavel" || saude === "atencao" || saude === "em_risco") {
      contagem[saude] += 1;
    }
  }
  return contagem;
}

function painelDoBanco(campos: Record<string, unknown> = {}) {
  const clinicas = Array.isArray(campos.clinicas)
    ? (campos.clinicas as unknown[])
    : [clinicaDoBanco()];
  return {
    gerado_em: GERADO_EM,
    totais: {
      clinicas: 1,
      em_uso: 1,
      sem_uso: 0,
      suspensas: 0,
      agente_liberado: 1,
      gasto_mes_centavos_usd: 310,
      gasto_mes_microdolares: 3_100_400,
      chamadas_mes: 40,
      saude: saudeDasLinhas(clinicas),
    },
    clinicas,
    ...campos,
  };
}

describe("lerPainelDoBanco (painel_cs_das_clinicas)", () => {
  it("lê o relógio, os totais e a clínica nas chaves do contrato", () => {
    const painel = lerPainelDoBanco(painelDoBanco());
    expect(painel.geradoEm).toBe(GERADO_EM);
    expect(painel.totais).toEqual({
      clinicas: 1,
      emUso: 1,
      semUso: 0,
      suspensas: 0,
      agenteLiberado: 1,
      gastoMesCentavos: 310,
      gastoMesMicrodolares: 3_100_400,
      chamadasMes: 40,
      saude: { saudavel: 1, atencao: 0, em_risco: 0 },
    });
    expect(painel.clinicas).toEqual([
      {
        id: ID,
        nome: "teste123",
        criadaEm: "2026-08-20T12:00:00+00:00",
        fuso: "America/Fortaleza",
        emUso: true,
        ultimoAcesso: {
          em: "2026-10-25T13:00:00.5+00:00",
          userId: PESSOA,
          nome: "Ana Souza",
          email: "ana@teste123.com.br",
          papel: "recepcao",
          implementador: false,
          equipeConduzza: false,
        },
        membrosAtivos: 4,
        membrosPendentes: 1,
        membrosEquipeConduzza: 1,
        // So serve a busca: sem nome e sem e-mail, ou fora do formato, fica
        // de fora.
        pessoas: [
          { nome: "Ana Souza", email: "ana@teste123.com.br" },
          { nome: null, email: "sem.nome@teste123.com.br" },
        ],
        numerosTotal: 2,
        numerosConectados: 1,
        numeros: [
          {
            id: NUMERO,
            nome: "Recepção",
            final: "0000",
            conexao: "conectado",
            iaLigada: true,
          },
        ],
        contatos: 250,
        leads30Dias: 12,
        conversas30Dias: 33,
        ultimaMensagemEm: "2026-10-20T13:00:00+00:00",
        suspensao: null,
        agente: {
          estado: "teste",
          modo: "contatos",
          liberada: true,
          pausadaPelaClinica: false,
          telefonesLigados: 2,
        },
        gasto: {
          ultimas24hCentavos: 42,
          mesCentavos: 310,
          ultimas24hSemSimuladorCentavos: 30,
          mesSemSimuladorCentavos: 200,
          ultimas24hMicrodolares: 421_500,
          mesMicrodolares: 3_100_400,
          ultimas24hSemSimuladorMicrodolares: 300_000,
          mesSemSimuladorMicrodolares: 1_999_999,
          ultimas24hChamadas: 12,
          mesChamadas: 40,
          ultimas24hSemSimuladorChamadas: 5,
          mesSemSimuladorChamadas: 20,
        },
        tetoDiarioCentavos: 500,
        saude: "saudavel",
        sinais: [],
        implantacao: {
          feitos: 3,
          total: 6,
          passos: [
            { chave: "whatsapp_conectado", feito: true, quantidade: 1 },
            { chave: "equipe_com_duas_pessoas", feito: true, quantidade: 4 },
            {
              chave: "procedimentos_cadastrados",
              feito: true,
              quantidade: 12,
            },
            {
              chave: "profissionais_cadastrados",
              feito: false,
              quantidade: 0,
            },
            {
              chave: "regua_de_confirmacao_ligada",
              feito: false,
              quantidade: 0,
            },
            { chave: "anuncios_conectados", feito: false, quantidade: 0 },
          ],
          anuncios: { meta: false, google: false },
        },
        tendencia: {
          leads: {
            atual: 12,
            anterior: 8,
            variacaoPercentual: 50,
            direcao: "subindo",
          },
          conversas: {
            atual: 33,
            anterior: 0,
            variacaoPercentual: null,
            direcao: "sem_base",
          },
        },
        ultimaNotaEm: "2026-10-24T12:00:00+00:00",
      },
    ]);
  });

  it("clínica sem uso, que ninguém entrou, suspensa, sem agente, sem teto, sem mensagem e sem fuso", () => {
    const painel = lerPainelDoBanco(
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            fuso: null,
            em_uso: false,
            ultimo_acesso: null,
            pessoas: [],
            ultima_mensagem_em: null,
            ultima_nota_em: null,
            teto_diario_centavos_usd: null,
            saude: "em_risco",
            sinais: SINAIS_SEM_USO_E_SUSPENSA,
            suspensao: {
              suspensa_em: "2026-10-18T10:00:00+00:00",
              motivo: "Pagamento atrasado",
            },
            agente: {
              estado: null,
              modo: null,
              liberada: null,
              pausada_pela_clinica: null,
              telefones_ligados: 0,
            },
          }),
        ],
      }),
    );
    const [clinica] = painel.clinicas;
    expect(clinica?.fuso).toBe("America/Fortaleza");
    expect(clinica?.emUso).toBe(false);
    expect(clinica?.ultimoAcesso).toBeNull();
    expect(clinica?.pessoas).toEqual([]);
    expect(clinica?.ultimaMensagemEm).toBeNull();
    expect(clinica?.ultimaNotaEm).toBeNull();
    expect(clinica?.tetoDiarioCentavos).toBeNull();
    expect(clinica?.saude).toBe("em_risco");
    expect(clinica?.sinais).toEqual([
      {
        chave: "conta_suspensa",
        nivel: "em_risco",
        quantidade: null,
        desde: "2026-10-18T10:00:00+00:00",
      },
      { chave: "sem_uso", nivel: "em_risco", quantidade: null, desde: null },
    ]);
    expect(clinica?.suspensao).toEqual({
      suspensaEm: "2026-10-18T10:00:00+00:00",
      motivo: "Pagamento atrasado",
    });
    expect(clinica?.agente).toEqual({
      estado: "desligado",
      modo: null,
      liberada: false,
      pausadaPelaClinica: false,
      telefonesLigados: 0,
    });
  });

  it("o último acesso de um Implementador, sem nome no perfil; papel que a tela não conhece não aparece", () => {
    const painel = lerPainelDoBanco(
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            em_uso: false,
            saude: "em_risco",
            sinais: [
              {
                chave: "sem_uso",
                nivel: "em_risco",
                quantidade: null,
                desde: "2026-08-01T10:00:00+00:00",
              },
            ],
            ultimo_acesso: {
              em: "2026-08-01T10:00:00+00:00",
              user_id: IMPLEMENTADOR,
              nome: " ",
              email: "tecnico@conduzza.com",
              papel: "admin",
              implementador: true,
              equipe_conduzza: false,
            },
          }),
          clinicaDoBanco({
            id: OUTRA,
            ultimo_acesso: {
              ...clinicaDoBanco().ultimo_acesso,
              papel: "dono",
            },
          }),
        ],
      }),
    );
    expect(painel.clinicas[0]?.ultimoAcesso).toEqual({
      em: "2026-08-01T10:00:00+00:00",
      userId: IMPLEMENTADOR,
      nome: null,
      email: "tecnico@conduzza.com",
      papel: "admin",
      implementador: true,
      equipeConduzza: false,
    });
    expect(painel.clinicas[0]?.emUso).toBe(false);
    expect(painel.clinicas[1]?.ultimoAcesso?.papel).toBeNull();
  });

  it("o último acesso da equipe Conduzza conta e vem marcado (o desenho: os membros ativos)", () => {
    const painel = lerPainelDoBanco(
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            ultimo_acesso: {
              ...clinicaDoBanco().ultimo_acesso,
              nome: "Vinicius Rodrigues",
              email: "vinicius@conduzza.com",
              papel: "admin",
              equipe_conduzza: true,
            },
            membros_ativos: 1,
            membros_pendentes: 0,
            membros_equipe_conduzza: 1,
          }),
        ],
      }),
    );
    expect(painel.clinicas[0]).toMatchObject({
      emUso: true,
      ultimoAcesso: { nome: "Vinicius Rodrigues", equipeConduzza: true },
      membrosAtivos: 1,
      membrosEquipeConduzza: 1,
    });
  });

  it("conexão desconhecida vira desconectado; o final fica só com 4 dígitos", () => {
    const painel = lerPainelDoBanco(
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            numeros: [
              {
                id: NUMERO,
                nome: "",
                final: "(84) 9-1234",
                conexao: "banido",
                ia_ligada: "sim",
              },
              { id: OUTRA, nome: "Sem final", final: "12", conexao: null },
            ],
          }),
        ],
      }),
    );
    expect(painel.clinicas[0]?.numeros).toEqual([
      {
        id: NUMERO,
        nome: "Número sem nome",
        final: "1234",
        conexao: "desconectado",
        iaLigada: false,
      },
      {
        id: OUTRA,
        nome: "Sem final",
        final: null,
        conexao: "desconectado",
        iaLigada: false,
      },
    ]);
  });

  it("'producao' e 'numero_inteiro' (onda 2)", () => {
    const painel = lerPainelDoBanco(
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            agente: {
              ...clinicaDoBanco().agente,
              estado: "producao",
              modo: "numero_inteiro",
            },
          }),
        ],
      }),
    );
    expect(painel.clinicas[0]?.agente).toMatchObject({
      estado: "producao",
      modo: "numero_inteiro",
    });
  });

  it("o nome da clínica vazio ou só com espaços vira 'Clínica sem nome' e não derruba o painel de todas (revisão de 26/10/2026)", () => {
    // O administrador de qualquer clinica edita o nome pela API (sem CHECK
    // no banco): uma clinica com o nome '   ' nao pode levar o painel, o
    // detalhe, o "Ligar" e a exportacao de todas junto.
    for (const nome of ["   ", "", "\n\t "]) {
      const painel = lerPainelDoBanco(
        painelDoBanco({
          clinicas: [clinicaDoBanco({ id: OUTRA, nome }), clinicaDoBanco()],
        }),
      );
      expect(painel.clinicas.map((c) => [c.id, c.nome])).toEqual([
        [OUTRA, CLINICA_SEM_NOME],
        [ID, "teste123"],
      ]);
    }
    expect(CLINICA_SEM_NOME).toBe("Clínica sem nome");
  });

  it("formato estranho no essencial: lança", () => {
    const base = painelDoBanco();
    const acesso = clinicaDoBanco().ultimo_acesso;
    const quebrados: unknown[] = [
      null,
      [],
      "painel",
      { clinicas: [] },
      // o relogio da leitura e essencial: os 30 dias do uso contam dele
      painelDoBanco({ gerado_em: undefined }),
      painelDoBanco({ gerado_em: "agora" }),
      // os totais do desenho de 26/10/2026, todos obrigatorios
      painelDoBanco({ totais: { ...base.totais, em_uso: -1 } }),
      painelDoBanco({ totais: { ...base.totais, sem_uso: undefined } }),
      painelDoBanco({ totais: { ...base.totais, agente_liberado: "1" } }),
      painelDoBanco({ totais: { ...base.totais, suspensas: 1.5 } }),
      painelDoBanco({
        totais: { ...base.totais, gasto_mes_centavos_usd: null },
      }),
      painelDoBanco({ clinicas: null }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ id: "x" })] }),
      // o nome: texto (clinic.name e NOT NULL); vazio nao quebra (abaixo)
      painelDoBanco({ clinicas: [clinicaDoBanco({ nome: null })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ nome: 42 })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ criada_em: "ontem" })] }),
      // o uso: booleano, e "em uso" so com o acesso que prova
      painelDoBanco({ clinicas: [clinicaDoBanco({ em_uso: "sim" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ em_uso: undefined })] }),
      painelDoBanco({
        clinicas: [clinicaDoBanco({ em_uso: true, ultimo_acesso: null })],
      }),
      painelDoBanco({
        clinicas: [clinicaDoBanco({ ultimo_acesso: { ...acesso, em: null } })],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({ ultimo_acesso: { ...acesso, em: "ontem" } }),
        ],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({ ultimo_acesso: { ...acesso, user_id: "x" } }),
        ],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            ultimo_acesso: { ...acesso, implementador: "nao" },
          }),
        ],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            ultimo_acesso: { ...acesso, equipe_conduzza: undefined },
          }),
        ],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            ultimo_acesso: { ...acesso, equipe_conduzza: "sim" },
          }),
        ],
      }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ ultimo_acesso: "ontem" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ membros_ativos: -1 })] }),
      // a equipe Conduzza ativa: contagem obrigatoria, nunca mais que as ativas
      painelDoBanco({
        clinicas: [clinicaDoBanco({ membros_equipe_conduzza: undefined })],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({ membros_ativos: 1, membros_equipe_conduzza: 2 }),
        ],
      }),
      painelDoBanco({
        clinicas: [clinicaDoBanco({ membros_pendentes: undefined })],
      }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ pessoas: "Ana" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ contatos: "250" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ leads_30_dias: 1.5 })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ gasto: null })] }),
      painelDoBanco({
        clinicas: [clinicaDoBanco({ suspensao: { suspensa_em: null } })],
      }),
      // Estado e modo que nem a onda 2 conhece: banco e codigo
      // desencontrados.
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            agente: { ...clinicaDoBanco().agente, estado: "rascunho" },
          }),
        ],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            agente: { ...clinicaDoBanco().agente, modo: "todos" },
          }),
        ],
      }),
    ];
    for (const valor of quebrados) {
      expect(() => lerPainelDoBanco(valor), JSON.stringify(valor)).toThrow(
        "painel geral ilegivel",
      );
    }
  });
});

describe("segunda leva: gasto exato, saúde, sinais, implantação e tendência (migration 20261026110000)", () => {
  /** Uma linha com um campo da segunda leva trocado. */
  function comGasto(campos: Record<string, unknown>) {
    return clinicaDoBanco({
      gasto: { ...clinicaDoBanco().gasto, ...campos },
    });
  }

  function lido(clinica: Record<string, unknown>) {
    return lerPainelDoBanco(painelDoBanco({ clinicas: [clinica] })).clinicas[0];
  }

  it("o gasto abaixo de 1 centavo chega exato (o mês de US$ 0,001 que o cartão mostrava como US$ 0,00)", () => {
    const clinica = lido(
      comGasto({
        mes_centavos_usd: 0,
        mes_microdolares: 1000,
        mes_chamadas: 7,
      }),
    );
    expect(clinica?.gasto.mesCentavos).toBe(0);
    expect(clinica?.gasto.mesMicrodolares).toBe(1000);
    expect(clinica?.gasto.mesChamadas).toBe(7);
    const painel = lerPainelDoBanco(
      painelDoBanco({
        totais: {
          ...painelDoBanco().totais,
          gasto_mes_centavos_usd: 0,
          gasto_mes_microdolares: 1000,
          chamadas_mes: 7,
        },
      }),
    );
    expect(painel.totais).toMatchObject({
      gastoMesCentavos: 0,
      gastoMesMicrodolares: 1000,
      chamadasMes: 7,
    });
  });

  it("os sinais chegam na ordem do banco, com o nível, a quantidade e o desde; a saúde é a deles", () => {
    const clinica = lido(
      clinicaDoBanco({
        numeros_total: 0,
        numeros_conectados: 0,
        numeros: [],
        saude: "atencao",
        sinais: [
          {
            chave: "sem_numero_de_whatsapp",
            nivel: "atencao",
            quantidade: null,
            desde: null,
          },
          {
            chave: "pedido_de_entrada_esperando",
            nivel: "atencao",
            quantidade: 2,
            desde: "2026-10-20T12:00:00+00:00",
          },
          {
            chave: "falhas_de_envio",
            nivel: "atencao",
            quantidade: 3,
            desde: "2026-10-24T09:00:00+00:00",
          },
          {
            chave: "perto_do_teto_da_ia",
            nivel: "atencao",
            quantidade: 85,
            desde: null,
          },
        ],
      }),
    );
    expect(clinica?.saude).toBe("atencao");
    expect(clinica?.sinais.map((sinal) => sinal.chave)).toEqual([
      "sem_numero_de_whatsapp",
      "pedido_de_entrada_esperando",
      "falhas_de_envio",
      "perto_do_teto_da_ia",
    ]);
    expect(clinica?.sinais[1]).toEqual({
      chave: "pedido_de_entrada_esperando",
      nivel: "atencao",
      quantidade: 2,
      desde: "2026-10-20T12:00:00+00:00",
    });

    const desconectada = lido(
      clinicaDoBanco({
        numeros_conectados: 0,
        saude: "em_risco",
        sinais: [
          {
            chave: "whatsapp_desconectado",
            nivel: "em_risco",
            quantidade: 2,
            desde: null,
          },
        ],
      }),
    );
    expect(desconectada?.saude).toBe("em_risco");
  });

  it("saudeDosSinais: Em risco com um sinal de risco, Atenção com outro, Saudável sem nenhum", () => {
    expect(saudeDosSinais([])).toBe("saudavel");
    expect(saudeDosSinais([{ nivel: "atencao" }])).toBe("atencao");
    expect(saudeDosSinais([{ nivel: "atencao" }, { nivel: "em_risco" }])).toBe(
      "em_risco",
    );
  });

  it("a contagem por saúde dos totais é a das linhas (a faixa do topo filtra a lista)", () => {
    const linhas = [
      clinicaDoBanco(),
      clinicaDoBanco({
        id: OUTRA,
        em_uso: false,
        saude: "em_risco",
        sinais: [
          {
            chave: "sem_uso",
            nivel: "em_risco",
            quantidade: null,
            desde: null,
          },
        ],
      }),
    ];
    const painel = lerPainelDoBanco(painelDoBanco({ clinicas: linhas }));
    expect(painel.totais.saude).toEqual({
      saudavel: 1,
      atencao: 0,
      em_risco: 1,
    });
    expect(() =>
      lerPainelDoBanco(
        painelDoBanco({
          clinicas: linhas,
          totais: {
            ...painelDoBanco().totais,
            saude: { saudavel: 2, atencao: 0, em_risco: 0 },
          },
        }),
      ),
    ).toThrow("painel geral ilegivel");
  });

  it("incoerente ou fora do formato: lança, nunca uma saúde, um sinal, um passo ou um gasto inventado", () => {
    const base = clinicaDoBanco();
    const quebradas: Record<string, unknown>[] = [
      // o gasto exato bate com os centavos que o banco arredondou
      comGasto({ mes_microdolares: 4_000_000 }),
      comGasto({ ultimas_24h_microdolares: undefined }),
      comGasto({ mes_sem_simulador_microdolares: -1 }),
      comGasto({ mes_chamadas: undefined }),
      comGasto({ ultimas_24h_sem_simulador_chamadas: 1.5 }),
      // a saude: so as tres, e a dos sinais
      clinicaDoBanco({ saude: "otima" }),
      clinicaDoBanco({ saude: undefined }),
      clinicaDoBanco({ saude: "atencao" }),
      clinicaDoBanco({
        saude: "atencao",
        sinais: [
          {
            chave: "falhas_de_envio",
            nivel: "em_risco",
            quantidade: 1,
            desde: null,
          },
        ],
      }),
      // sinal que a tela nao conhece, repetido ou fora do formato
      clinicaDoBanco({
        saude: "atencao",
        sinais: [
          {
            chave: "plano_vencido",
            nivel: "atencao",
            quantidade: null,
            desde: null,
          },
        ],
      }),
      clinicaDoBanco({
        saude: "atencao",
        sinais: [
          {
            chave: "falhas_de_envio",
            nivel: "atencao",
            quantidade: 1,
            desde: null,
          },
          {
            chave: "falhas_de_envio",
            nivel: "atencao",
            quantidade: 1,
            desde: null,
          },
        ],
      }),
      clinicaDoBanco({
        saude: "atencao",
        sinais: [
          {
            chave: "falhas_de_envio",
            nivel: "atencao",
            quantidade: -1,
            desde: null,
          },
        ],
      }),
      clinicaDoBanco({
        saude: "atencao",
        sinais: [
          {
            chave: "falhas_de_envio",
            nivel: "atencao",
            quantidade: 1,
            desde: "ontem",
          },
        ],
      }),
      clinicaDoBanco({ sinais: null }),
      // os sinais da linha batem com ela: suspensa, uso e numeros
      clinicaDoBanco({
        saude: "em_risco",
        sinais: [SINAIS_SEM_USO_E_SUSPENSA[0]],
      }),
      clinicaDoBanco({ em_uso: false, ultimo_acesso: null }),
      clinicaDoBanco({ numeros_conectados: 0 }),
      clinicaDoBanco({ numeros_total: 0, numeros_conectados: 0 }),
      // a implantacao: os seis passos, na ordem, e a contagem dos feitos
      clinicaDoBanco({ implantacao: implantacaoDoBanco({ feitos: 4 }) }),
      clinicaDoBanco({ implantacao: implantacaoDoBanco({ total: 7 }) }),
      clinicaDoBanco({
        implantacao: implantacaoDoBanco({
          passos: [...implantacaoDoBanco().passos].reverse(),
        }),
      }),
      clinicaDoBanco({
        implantacao: implantacaoDoBanco({
          feitos: 2,
          passos: implantacaoDoBanco().passos.slice(1),
          total: 5,
        }),
      }),
      clinicaDoBanco({
        implantacao: implantacaoDoBanco({
          passos: [
            ...implantacaoDoBanco().passos.slice(0, 5),
            { chave: "plano_pago", feito: false, quantidade: 0 },
          ],
        }),
      }),
      clinicaDoBanco({ implantacao: implantacaoDoBanco({ anuncios: null }) }),
      clinicaDoBanco({ implantacao: null }),
      // a tendencia: o atual e o dos 30 dias; sem base so com o anterior zero
      clinicaDoBanco({
        tendencia: {
          ...base.tendencia,
          leads: { ...base.tendencia.leads, atual: 13 },
        },
      }),
      clinicaDoBanco({
        tendencia: {
          ...base.tendencia,
          leads: { ...base.tendencia.leads, direcao: "sem_base" },
        },
      }),
      clinicaDoBanco({
        tendencia: {
          ...base.tendencia,
          leads: { ...base.tendencia.leads, variacao_percentual: null },
        },
      }),
      clinicaDoBanco({
        tendencia: {
          ...base.tendencia,
          leads: { ...base.tendencia.leads, variacao_percentual: 49.5 },
        },
      }),
      clinicaDoBanco({
        tendencia: {
          ...base.tendencia,
          conversas: { ...base.tendencia.conversas, direcao: "estavel" },
        },
      }),
      clinicaDoBanco({
        tendencia: {
          ...base.tendencia,
          leads: { ...base.tendencia.leads, direcao: "explodindo" },
        },
      }),
      clinicaDoBanco({ tendencia: null }),
      clinicaDoBanco({ ultima_nota_em: "ontem" }),
    ];
    for (const clinica of quebradas) {
      expect(
        () => lerPainelDoBanco(painelDoBanco({ clinicas: [clinica] })),
        JSON.stringify(clinica),
      ).toThrow("painel geral ilegivel");
    }
    for (const totais of [
      { ...painelDoBanco().totais, gasto_mes_microdolares: 9_000_000 },
      { ...painelDoBanco().totais, chamadas_mes: undefined },
      { ...painelDoBanco().totais, saude: null },
    ]) {
      expect(
        () => lerPainelDoBanco(painelDoBanco({ totais })),
        JSON.stringify(totais),
      ).toThrow("painel geral ilegivel");
    }
  });
});

function pessoaDoBanco(campos: Record<string, unknown> = {}) {
  return {
    user_id: PESSOA,
    nome: "Ana Souza",
    email: "ana@teste123.com.br",
    papel: "recepcao",
    situacao: "ativo",
    ultimo_acesso_em: "2026-10-25T13:00:00+00:00",
    na_equipe_desde: "2026-08-20T12:00:00+00:00",
    equipe_conduzza: false,
    conta_no_uso: true,
    marcado_em: null,
    ...campos,
  };
}

function equipeDoBanco(campos: Record<string, unknown> = {}) {
  return {
    clinic_id: ID,
    gerado_em: GERADO_EM,
    equipe: [
      pessoaDoBanco(),
      pessoaDoBanco({
        user_id: OUTRA,
        nome: null,
        email: "vinicius@conduzza.com",
        papel: "admin",
        situacao: "pendente",
        ultimo_acesso_em: null,
        equipe_conduzza: true,
        conta_no_uso: false,
      }),
    ],
    implementadores: [
      pessoaDoBanco({
        user_id: IMPLEMENTADOR,
        nome: "Técnico",
        email: "tecnico@conduzza.com",
        papel: "admin",
        situacao: "inativo",
        marcado_em: "2026-10-22T12:00:00+00:00",
      }),
    ],
    ...campos,
  };
}

describe("terceira leva: a clínica nova sem acesso (decisão do dono de 26/10/2026, migration 20261026120000)", () => {
  const AINDA_SEM_ACESSO = {
    chave: "ainda_sem_acesso",
    nivel: "atencao",
    quantidade: null,
    desde: "2026-10-20T13:05:00+00:00",
  };
  const SEM_USO = {
    chave: "sem_uso",
    nivel: "em_risco",
    quantidade: null,
    desde: null,
  };

  /** A clinica sem uso em que ninguem entrou, com os sinais e a saude. */
  function semAcesso(campos: Record<string, unknown>) {
    return clinicaDoBanco({ em_uso: false, ultimo_acesso: null, ...campos });
  }

  function lido(clinica: Record<string, unknown>) {
    return lerPainelDoBanco(painelDoBanco({ clinicas: [clinica] })).clinicas[0];
  }

  it("a clínica nova sem acesso chega em Atenção, com Ainda sem acesso desde a criação", () => {
    const clinica = lido(
      semAcesso({ saude: "atencao", sinais: [AINDA_SEM_ACESSO] }),
    );
    expect(clinica?.emUso).toBe(false);
    expect(clinica?.saude).toBe("atencao");
    expect(clinica?.sinais).toEqual([
      {
        chave: "ainda_sem_acesso",
        nivel: "atencao",
        quantidade: null,
        desde: "2026-10-20T13:05:00+00:00",
      },
    ]);
  });

  it("antes da migration, a mesma clínica chega com Sem uso há 30 dias, em risco: a leitura aceita os dois jeitos", () => {
    const clinica = lido(semAcesso({ saude: "em_risco", sinais: [SEM_USO] }));
    expect(clinica?.saude).toBe("em_risco");
    expect(clinica?.sinais.map((sinal) => sinal.chave)).toEqual(["sem_uso"]);
  });

  it("incoerente: lança, nunca uma saúde ou um sinal que não conferiu", () => {
    const quebradas: Record<string, unknown>[] = [
      // os dois juntos
      semAcesso({ saude: "em_risco", sinais: [SEM_USO, AINDA_SEM_ACESSO] }),
      // em uso com Ainda sem acesso
      clinicaDoBanco({ saude: "atencao", sinais: [AINDA_SEM_ACESSO] }),
      // Ainda sem acesso com o nivel de risco
      semAcesso({
        saude: "em_risco",
        sinais: [{ ...AINDA_SEM_ACESSO, nivel: "em_risco" }],
      }),
      // a saude de risco so com Ainda sem acesso
      semAcesso({ saude: "em_risco", sinais: [AINDA_SEM_ACESSO] }),
      // sem uso sem nenhum dos dois
      semAcesso({ saude: "saudavel", sinais: [] }),
    ];
    for (const clinica of quebradas) {
      expect(() =>
        lerPainelDoBanco(painelDoBanco({ clinicas: [clinica] })),
      ).toThrow();
    }
  });
});

describe("lerEquipeDoBanco (equipe_da_clinica_no_painel)", () => {
  it("a equipe e os Implementadores, numa lista separada (P18-5)", () => {
    expect(lerEquipeDoBanco(equipeDoBanco())).toEqual({
      equipe: [
        {
          userId: PESSOA,
          nome: "Ana Souza",
          email: "ana@teste123.com.br",
          papel: "recepcao",
          situacao: "ativo",
          ultimoAcessoEm: "2026-10-25T13:00:00+00:00",
          equipeConduzza: false,
        },
        {
          userId: OUTRA,
          nome: null,
          email: "vinicius@conduzza.com",
          papel: "admin",
          situacao: "pendente",
          ultimoAcessoEm: null,
          equipeConduzza: true,
        },
      ],
      implementadores: [
        {
          userId: IMPLEMENTADOR,
          nome: "Técnico",
          email: "tecnico@conduzza.com",
          papel: "admin",
          situacao: "inativo",
          ultimoAcessoEm: "2026-10-25T13:00:00+00:00",
          equipeConduzza: false,
        },
      ],
    });
  });

  it("a clínica que não existe (o banco devolve null) vira nula; listas vazias ficam vazias", () => {
    expect(lerEquipeDoBanco(null)).toBeNull();
    expect(
      lerEquipeDoBanco(equipeDoBanco({ equipe: [], implementadores: [] })),
    ).toEqual({ equipe: [], implementadores: [] });
  });

  it("papel, situação ou pessoa fora do formato: lança (nunca um rótulo inventado nem uma pessoa a menos)", () => {
    const quebrados: unknown[] = [
      [],
      "equipe",
      equipeDoBanco({ equipe: null }),
      equipeDoBanco({ implementadores: undefined }),
      equipeDoBanco({ equipe: [pessoaDoBanco({ papel: "implementador" })] }),
      equipeDoBanco({ equipe: [pessoaDoBanco({ papel: null })] }),
      equipeDoBanco({ equipe: [pessoaDoBanco({ situacao: "bloqueado" })] }),
      equipeDoBanco({ equipe: [pessoaDoBanco({ user_id: "x" })] }),
      equipeDoBanco({
        equipe: [pessoaDoBanco({ ultimo_acesso_em: "ontem" })],
      }),
      equipeDoBanco({
        implementadores: [pessoaDoBanco({ equipe_conduzza: null })],
      }),
      equipeDoBanco({ equipe: [pessoaDoBanco({ nome: 42 })] }),
      equipeDoBanco({ equipe: ["Ana"] }),
    ];
    for (const valor of quebrados) {
      expect(() => lerEquipeDoBanco(valor), JSON.stringify(valor)).toThrow(
        "painel geral ilegivel",
      );
    }
  });
});

type Chamada = { nome: string; args?: unknown };

function clienteFalso(resposta: { data: unknown; error: unknown }) {
  const chamadas: Chamada[] = [];
  const consultas: { tabela: string; colunas: string; filtros: unknown[] }[] =
    [];
  const cliente = {
    rpc: async (nome: string, args?: unknown) => {
      chamadas.push({ nome, args });
      return resposta;
    },
    from: (tabela: string) => {
      const consulta = { tabela, colunas: "", filtros: [] as unknown[] };
      consultas.push(consulta);
      const cadeia = {
        select: (colunas: string) => {
          consulta.colunas = colunas;
          return cadeia;
        },
        eq: (coluna: string, valor: unknown) => {
          consulta.filtros.push([coluna, valor]);
          return cadeia;
        },
        maybeSingle: async () => resposta,
      };
      return cadeia;
    },
  };
  return { cliente: cliente as never, chamadas, consultas };
}

describe("leituras com a sessão", () => {
  it("o painel é uma RPC só, a nova, sem parâmetro (sem as clínicas de teste automático)", async () => {
    const { cliente, chamadas, consultas } = clienteFalso({
      data: painelDoBanco(),
      error: null,
    });
    const painel = await fetchPainelGeral(cliente);
    expect(painel.clinicas).toHaveLength(1);
    expect(chamadas).toEqual([
      { nome: "painel_cs_das_clinicas", args: undefined },
    ]);
    // painel_geral_das_clinicas sai numa limpeza depois: ninguem a le.
    expect(JSON.stringify(chamadas)).not.toContain("painel_geral_das_clinicas");
    expect(consultas).toEqual([]);
  });

  it("erro do banco (42501 para quem não é super admin): lança", async () => {
    const { cliente } = clienteFalso({
      data: null,
      error: { code: "42501" },
    });
    await expect(fetchPainelGeral(cliente)).rejects.toThrow(
      "leitura do painel geral falhou",
    );
  });

  it("uma clínica e um número pelo painel, sem diferenciar maiúscula, com o relógio da leitura", async () => {
    const { cliente } = clienteFalso({ data: painelDoBanco(), error: null });
    const lida = await fetchClinicaDoPainel(cliente, ID.toUpperCase());
    expect(lida?.clinica.id).toBe(ID);
    expect(lida?.geradoEm).toBe(GERADO_EM);
    expect(await fetchClinicaDoPainel(cliente, OUTRA)).toBeNull();
    expect(
      await fetchNumeroDaClinicaNoPainel(cliente, ID, NUMERO.toUpperCase()),
    ).toMatchObject({ id: NUMERO, conexao: "conectado" });
    expect(await fetchNumeroDaClinicaNoPainel(cliente, ID, OUTRA)).toBeNull();
    expect(
      await fetchNumeroDaClinicaNoPainel(cliente, OUTRA, NUMERO),
    ).toBeNull();
  });

  it("uma clínica sem nome não derruba a leitura das outras pela sessão (o detalhe e o 'Ligar' do número)", async () => {
    const { cliente } = clienteFalso({
      data: painelDoBanco({
        clinicas: [
          clinicaDoBanco({ id: OUTRA, nome: "   " }),
          clinicaDoBanco(),
        ],
      }),
      error: null,
    });
    expect((await fetchPainelGeral(cliente)).clinicas).toHaveLength(2);
    expect((await fetchClinicaDoPainel(cliente, OUTRA))?.clinica.nome).toBe(
      CLINICA_SEM_NOME,
    );
    expect(
      await fetchNumeroDaClinicaNoPainel(cliente, ID, NUMERO),
    ).toMatchObject({ id: NUMERO });
  });

  it("a equipe: a RPC com a clínica; nula quando a clínica não existe; erro do banco lança", async () => {
    const lida = clienteFalso({ data: equipeDoBanco(), error: null });
    const equipe = await fetchEquipeDaClinica(lida.cliente, ID);
    expect(equipe?.equipe).toHaveLength(2);
    expect(equipe?.implementadores).toHaveLength(1);
    expect(lida.chamadas).toEqual([
      { nome: "equipe_da_clinica_no_painel", args: { p_clinic_id: ID } },
    ]);
    expect(lida.consultas).toEqual([]);

    const semClinica = clienteFalso({ data: null, error: null });
    expect(await fetchEquipeDaClinica(semClinica.cliente, OUTRA)).toBeNull();

    for (const erro of [{ code: "42501" }, { code: "22004" }]) {
      const falhou = clienteFalso({ data: null, error: erro });
      await expect(fetchEquipeDaClinica(falhou.cliente, ID)).rejects.toThrow(
        "leitura da equipe da clinica falhou",
      );
    }
    const torta = clienteFalso({ data: { equipe: "x" }, error: null });
    await expect(fetchEquipeDaClinica(torta.cliente, ID)).rejects.toThrow(
      "painel geral ilegivel",
    );
  });

  it("os tetos vêm de ia_liberacao da clínica; sem linha, nulo; erro, lança", async () => {
    const lida = clienteFalso({
      data: {
        teto_diario_centavos_usd: 750,
        teto_respostas_por_conversa_hora: 30,
      },
      error: null,
    });
    expect(await fetchTetosDaIa(lida.cliente, ID)).toEqual({
      tetoDiarioCentavos: 750,
      tetoRespostasPorConversaHora: 30,
    });
    expect(lida.consultas).toEqual([
      {
        tabela: "ia_liberacao",
        colunas: "teto_diario_centavos_usd, teto_respostas_por_conversa_hora",
        filtros: [["clinic_id", ID]],
      },
    ]);
    const semLinha = clienteFalso({ data: null, error: null });
    expect(await fetchTetosDaIa(semLinha.cliente, ID)).toBeNull();
    const falhou = clienteFalso({ data: null, error: { code: "XX000" } });
    await expect(fetchTetosDaIa(falhou.cliente, ID)).rejects.toThrow(
      "leitura dos tetos da IA falhou",
    );
  });
});

describe("onda 2: requisitos da produção", () => {
  const REGISTRO = "e1111111-1111-4111-8111-111111111111";
  const REVOGADO = "e2222222-2222-4222-8222-222222222222";

  /** O que a tela le quando o banco nao conferiu nada daquele tipo. */
  const NADA_CONFERIDO = {
    estado: null,
    versao: null,
    publico: null,
    modo: null,
    conectados: null,
  };

  it("lerRequisitosDoBanco: o detalhe do banco vira o conferido e o registro da equipe", () => {
    expect(
      lerRequisitosDoBanco([
        {
          chave: "agente_em_teste",
          ok: true,
          detalhe: { origem: "banco", estado: "teste" },
        },
        {
          chave: "versao_publicada",
          ok: true,
          detalhe: { origem: "banco", versao: 3 },
        },
        {
          chave: "publico_escolhido",
          ok: false,
          detalhe: { origem: "banco", publico: null },
        },
        {
          chave: "horario_suportado",
          ok: true,
          detalhe: { origem: "banco", modo: "24h" },
        },
        {
          chave: "numero_conectado",
          ok: true,
          detalhe: { origem: "banco", conectados: 2 },
        },
        {
          chave: "rodada_cfm",
          ok: true,
          detalhe: {
            origem: "equipe",
            id: REGISTRO,
            evidencia: "Rodada de 21/10, filtro regras-x, modelo gpt-6-luna",
            registrado_em: "2026-10-21T12:00:00.123456+00:00",
            geral: true,
          },
        },
        {
          chave: "termo_da_clinica",
          ok: false,
          detalhe: {
            origem: "equipe",
            revogado: true,
            id: REVOGADO,
            revogado_em: "2026-10-21T15:00:00+00:00",
            motivo_da_revogacao: "Termo trocado pela clínica",
          },
        },
        {
          chave: "contrato_openai",
          ok: false,
          detalhe: { origem: "equipe" },
        },
      ]),
    ).toEqual([
      {
        chave: "agente_em_teste",
        ok: true,
        origem: "banco",
        registro: null,
        conferido: { ...NADA_CONFERIDO, estado: "teste" },
      },
      {
        chave: "versao_publicada",
        ok: true,
        origem: "banco",
        registro: null,
        conferido: { ...NADA_CONFERIDO, versao: 3 },
      },
      {
        chave: "publico_escolhido",
        ok: false,
        origem: "banco",
        registro: null,
        conferido: NADA_CONFERIDO,
      },
      {
        chave: "horario_suportado",
        ok: true,
        origem: "banco",
        registro: null,
        conferido: { ...NADA_CONFERIDO, modo: "24h" },
      },
      {
        chave: "numero_conectado",
        ok: true,
        origem: "banco",
        registro: null,
        conferido: { ...NADA_CONFERIDO, conectados: 2 },
      },
      {
        chave: "rodada_cfm",
        ok: true,
        origem: "equipe",
        registro: {
          id: REGISTRO,
          revogado: false,
          evidencia: "Rodada de 21/10, filtro regras-x, modelo gpt-6-luna",
          registradoEm: "2026-10-21T12:00:00.123456+00:00",
          geral: true,
          revogadoEm: null,
          motivoDaRevogacao: null,
        },
        conferido: NADA_CONFERIDO,
      },
      {
        chave: "termo_da_clinica",
        ok: false,
        origem: "equipe",
        registro: {
          id: REVOGADO,
          revogado: true,
          evidencia: null,
          registradoEm: null,
          geral: null,
          revogadoEm: "2026-10-21T15:00:00+00:00",
          motivoDaRevogacao: "Termo trocado pela clínica",
        },
        conferido: NADA_CONFERIDO,
      },
      {
        chave: "contrato_openai",
        ok: false,
        origem: "equipe",
        registro: null,
        conferido: NADA_CONFERIDO,
      },
    ]);
  });

  it("lerRequisitosDoBanco: só o verdadeiro cumpre; fora do formato fica de fora ou vira nulo; não lista lança", () => {
    expect(
      lerRequisitosDoBanco([
        { chave: "versao_publicada", ok: "sim", detalhe: "Versão 3" },
        {
          chave: "rodada_cfm",
          ok: true,
          detalhe: { origem: "outra", id: "nao-e-uuid", evidencia: " " },
        },
        {
          chave: "numero_conectado",
          ok: 1,
          detalhe: { origem: "banco", conectados: 1.5, versao: "3" },
        },
        { chave: "", ok: true },
        null,
        "texto",
      ]),
    ).toEqual([
      {
        chave: "versao_publicada",
        ok: false,
        origem: "banco",
        registro: null,
        conferido: NADA_CONFERIDO,
      },
      {
        chave: "rodada_cfm",
        ok: true,
        origem: "banco",
        registro: null,
        conferido: NADA_CONFERIDO,
      },
      {
        chave: "numero_conectado",
        ok: false,
        origem: "banco",
        registro: null,
        conferido: NADA_CONFERIDO,
      },
    ]);
    expect(() => lerRequisitosDoBanco({ chave: "x" })).toThrow(
      "painel geral ilegivel",
    );
  });

  /** O duble da sessao: so a RPC (a tela nao le a tabela dos registros). */
  function clienteDosRequisitos(resposta: { data: unknown; error: unknown }) {
    const chamadas: unknown[] = [];
    const cliente = {
      rpc: async (nome: string, args?: unknown) => {
        chamadas.push(["rpc", nome, args]);
        return resposta;
      },
      from: (tabela: string) => {
        chamadas.push(["from", tabela]);
        throw new Error("a leitura dos requisitos nao le tabela");
      },
    };
    return { cliente: cliente as never, chamadas };
  }

  it("lidos: uma chamada só, a RPC com a clínica, e nenhuma tabela", async () => {
    const { cliente, chamadas } = clienteDosRequisitos({
      data: [
        {
          chave: "rodada_cfm",
          ok: true,
          detalhe: {
            origem: "equipe",
            id: REGISTRO,
            evidencia: "Rodada de 21/10",
            registrado_em: "2026-10-21T12:00:00+00:00",
            geral: true,
          },
        },
      ],
      error: null,
    });
    expect(await fetchRequisitosDaProducao(cliente, ID)).toEqual({
      estado: "lido",
      conferidos: [
        {
          chave: "rodada_cfm",
          ok: true,
          origem: "equipe",
          registro: {
            id: REGISTRO,
            revogado: false,
            evidencia: "Rodada de 21/10",
            registradoEm: "2026-10-21T12:00:00+00:00",
            geral: true,
            revogadoEm: null,
            motivoDaRevogacao: null,
          },
          conferido: NADA_CONFERIDO,
        },
      ],
    });
    expect(chamadas).toEqual([
      ["rpc", "requisitos_da_producao", { p_clinic_id: ID }],
    ]);
  });

  it("banco sem a migration da produção (a função não existe): indisponível, nunca o erro", async () => {
    for (const codigo of ["PGRST202", "42883"]) {
      const { cliente } = clienteDosRequisitos({
        data: null,
        error: { code: codigo },
      });
      expect(await fetchRequisitosDaProducao(cliente, ID)).toEqual({
        estado: "indisponivel",
      });
    }
  });

  it("outro erro (42501, P0002, tempo) ou resposta fora do formato: lança", async () => {
    for (const erro of [
      { code: "42501" },
      { code: "P0002" },
      { message: "tempo" },
    ]) {
      const { cliente } = clienteDosRequisitos({ data: null, error: erro });
      await expect(fetchRequisitosDaProducao(cliente, ID)).rejects.toThrow(
        "leitura dos requisitos da producao falhou",
      );
    }
    const { cliente } = clienteDosRequisitos({
      data: { chave: "x" },
      error: null,
    });
    await expect(fetchRequisitosDaProducao(cliente, ID)).rejects.toThrow(
      "painel geral ilegivel",
    );
  });
});

describe("segunda leva: notas internas e histórico da conta", () => {
  const NOTA = "d5555555-5555-4555-8555-555555555555";
  const AUTOR = "e6666666-6666-4666-8666-666666666666";

  function notaDoBanco(campos: Record<string, unknown> = {}) {
    return {
      id: NOTA,
      texto: "Combinado: treinar a recepção na sexta.",
      criada_em: "2026-10-26T13:00:00+00:00",
      autor: {
        user_id: AUTOR,
        nome: "Vinicius Rodrigues",
        email: "vinicius@conduzza.com",
        equipe_conduzza: true,
      },
      minha: true,
      ...campos,
    };
  }

  function notasDoBanco(campos: Record<string, unknown> = {}) {
    return {
      clinic_id: ID,
      gerado_em: GERADO_EM,
      tem_mais: false,
      notas: [notaDoBanco()],
      ...campos,
    };
  }

  function eventoDoBanco(campos: Record<string, unknown> = {}) {
    return {
      id: 4512,
      em: "2026-10-26T13:05:00+00:00",
      acao: "suspendeu_clinica",
      quem: {
        user_id: AUTOR,
        nome: "Vinicius Rodrigues",
        email: "vinicius@conduzza.com",
        equipe_conduzza: true,
      },
      detalhes: {
        estado: null,
        motivo: "Pagamento atrasado",
        chave: null,
        substituiu: null,
        teto_diario_centavos_usd: null,
        teto_respostas_por_conversa_hora: null,
        teto_diario_antes_centavos_usd: null,
        teto_respostas_antes_por_conversa_hora: null,
        jobs_vencidos: null,
        clinicas_de_volta_ao_teste: null,
        nota_escrita_em: null,
      },
      ...campos,
    };
  }

  it("as notas: texto, autor (com a marca da equipe Conduzza), data e o 'minha' do banco", () => {
    expect(
      lerNotasDoBanco(
        notasDoBanco({
          tem_mais: true,
          notas: [
            notaDoBanco(),
            notaDoBanco({
              id: OUTRA,
              autor: null,
              minha: false,
            }),
          ],
        }),
      ),
    ).toEqual({
      temMais: true,
      notas: [
        {
          id: NOTA,
          texto: "Combinado: treinar a recepção na sexta.",
          criadaEm: "2026-10-26T13:00:00+00:00",
          autor: {
            userId: AUTOR,
            nome: "Vinicius Rodrigues",
            email: "vinicius@conduzza.com",
            equipeConduzza: true,
          },
          minha: true,
        },
        {
          id: OUTRA,
          texto: "Combinado: treinar a recepção na sexta.",
          criadaEm: "2026-10-26T13:00:00+00:00",
          autor: null,
          minha: false,
        },
      ],
    });
    expect(lerNotasDoBanco(null)).toBeNull();
    expect(lerNotasDoBanco(notasDoBanco({ notas: [] }))).toEqual({
      temMais: false,
      notas: [],
    });
  });

  it("nota fora do formato: lança (nunca uma lista com nota a menos nem um Excluir que o banco recusa)", () => {
    for (const valor of [
      [],
      notasDoBanco({ notas: null }),
      notasDoBanco({ tem_mais: undefined }),
      notasDoBanco({ notas: [notaDoBanco({ id: "x" })] }),
      notasDoBanco({ notas: [notaDoBanco({ texto: " " })] }),
      notasDoBanco({ notas: [notaDoBanco({ criada_em: "ontem" })] }),
      notasDoBanco({ notas: [notaDoBanco({ minha: "sim" })] }),
      notasDoBanco({ notas: [notaDoBanco({ autor: null, minha: true })] }),
      notasDoBanco({
        notas: [notaDoBanco({ autor: { user_id: AUTOR, nome: "Ana" } })],
      }),
    ]) {
      expect(() => lerNotasDoBanco(valor), JSON.stringify(valor)).toThrow(
        "painel geral ilegivel",
      );
    }
  });

  it("o histórico: cada evento com a ação, quem, quando e só os detalhes conhecidos", () => {
    expect(
      lerHistoricoDoBanco({
        clinic_id: ID,
        gerado_em: GERADO_EM,
        tem_mais: false,
        eventos: [
          eventoDoBanco(),
          eventoDoBanco({
            id: "4511",
            acao: "excluiu_nota_interna",
            quem: null,
            detalhes: {
              ...eventoDoBanco().detalhes,
              motivo: null,
              nota_escrita_em: "2026-10-20T10:00:00+00:00",
            },
          }),
        ],
      }),
    ).toEqual({
      temMais: false,
      eventos: [
        {
          id: "4512",
          em: "2026-10-26T13:05:00+00:00",
          acao: "suspendeu_clinica",
          autor: {
            userId: AUTOR,
            nome: "Vinicius Rodrigues",
            email: "vinicius@conduzza.com",
            equipeConduzza: true,
          },
          detalhes: {
            estado: null,
            motivo: "Pagamento atrasado",
            chave: null,
            substituiu: null,
            tetoDiarioCentavos: null,
            tetoRespostasPorConversaHora: null,
            tetoDiarioAntesCentavos: null,
            tetoRespostasAntesPorConversaHora: null,
            jobsVencidos: null,
            clinicasDeVoltaAoTeste: null,
            notaEscritaEm: null,
          },
        },
        {
          id: "4511",
          em: "2026-10-26T13:05:00+00:00",
          acao: "excluiu_nota_interna",
          autor: null,
          detalhes: {
            estado: null,
            motivo: null,
            chave: null,
            substituiu: null,
            tetoDiarioCentavos: null,
            tetoRespostasPorConversaHora: null,
            tetoDiarioAntesCentavos: null,
            tetoRespostasAntesPorConversaHora: null,
            jobsVencidos: null,
            clinicasDeVoltaAoTeste: null,
            notaEscritaEm: "2026-10-20T10:00:00+00:00",
          },
        },
      ],
    });
    expect(lerHistoricoDoBanco(null)).toBeNull();
  });

  it("evento fora do formato ou com ação que a tela não descreve: lança", () => {
    const historico = (evento: unknown) => ({
      clinic_id: ID,
      gerado_em: GERADO_EM,
      tem_mais: false,
      eventos: [evento],
    });
    for (const valor of [
      "historico",
      { eventos: [], tem_mais: "nao" },
      historico(eventoDoBanco({ acao: "leu" })),
      historico(eventoDoBanco({ id: -1 })),
      historico(eventoDoBanco({ id: "abc" })),
      historico(eventoDoBanco({ em: "ontem" })),
      historico(eventoDoBanco({ detalhes: null })),
      historico(
        eventoDoBanco({
          detalhes: { ...eventoDoBanco().detalhes, jobs_vencidos: "3" },
        }),
      ),
      historico(
        eventoDoBanco({
          detalhes: { ...eventoDoBanco().detalhes, substituiu: "sim" },
        }),
      ),
      historico(eventoDoBanco({ quem: { user_id: "x" } })),
    ]) {
      expect(() => lerHistoricoDoBanco(valor), JSON.stringify(valor)).toThrow(
        "painel geral ilegivel",
      );
    }
  });

  it("as leituras com a sessão: a função com a clínica; nula sem a clínica; erro lança", async () => {
    const notas = clienteFalso({ data: notasDoBanco(), error: null });
    expect((await fetchNotasDaClinica(notas.cliente, ID))?.notas).toHaveLength(
      1,
    );
    expect(notas.chamadas).toEqual([
      { nome: "notas_da_clinica_no_painel", args: { p_clinic_id: ID } },
    ]);
    expect(notas.consultas).toEqual([]);

    const historico = clienteFalso({
      data: { tem_mais: false, eventos: [eventoDoBanco()] },
      error: null,
    });
    expect(
      (await fetchHistoricoDaConta(historico.cliente, ID))?.eventos,
    ).toHaveLength(1);
    expect(historico.chamadas).toEqual([
      { nome: "historico_da_clinica_no_painel", args: { p_clinic_id: ID } },
    ]);

    const semClinica = clienteFalso({ data: null, error: null });
    expect(await fetchNotasDaClinica(semClinica.cliente, OUTRA)).toBeNull();
    expect(await fetchHistoricoDaConta(semClinica.cliente, OUTRA)).toBeNull();

    const falhou = clienteFalso({ data: null, error: { code: "42501" } });
    await expect(fetchNotasDaClinica(falhou.cliente, ID)).rejects.toThrow(
      "leitura das notas da clinica falhou",
    );
    await expect(fetchHistoricoDaConta(falhou.cliente, ID)).rejects.toThrow(
      "leitura do historico da conta falhou",
    );
  });
});

describe("segunda leva: a trilha da exportação da lista", () => {
  function clienteDaTrilha(erro: unknown) {
    const inseridos: { tabela: string; linha: unknown }[] = [];
    const cliente = {
      from: (tabela: string) => ({
        insert: async (linha: unknown) => {
          inseridos.push({ tabela, linha });
          return { data: null, error: erro };
        },
      }),
    };
    return { cliente: cliente as never, inseridos };
  }

  it("uma linha em audit_log, sem clínica, de quem exportou, com os detalhes recebidos", async () => {
    const { cliente, inseridos } = clienteDaTrilha(null);
    const detalhes = {
      quantidade: 3,
      filtros: { saude: "em_risco", com_busca: true },
      ordem: { coluna: "saude", sentido: "desc" },
    };
    expect(
      await registrarExportacaoDoPainel(cliente, {
        userId: PESSOA,
        detalhes,
      }),
    ).toBe("gravada");
    expect(inseridos).toEqual([
      {
        tabela: "audit_log",
        linha: {
          clinic_id: null,
          user_id: PESSOA,
          action: "exportou",
          entity: "painel_geral",
          entity_id: null,
          detalhes,
        },
      },
    ]);
  });

  it("o banco recusou (a policy, por exemplo): falhou", async () => {
    const { cliente } = clienteDaTrilha({ code: "42501" });
    expect(
      await registrarExportacaoDoPainel(cliente, {
        userId: PESSOA,
        detalhes: { quantidade: 1 },
      }),
    ).toBe("falhou");
  });
});
