import { describe, expect, it } from "vitest";

import {
  fetchClinicaDoPainel,
  fetchEquipeDaClinica,
  fetchNumeroDaClinicaNoPainel,
  fetchPainelGeral,
  fetchRequisitosDaProducao,
  fetchTetosDaIa,
  lerEquipeDoBanco,
  lerPainelDoBanco,
  lerRequisitosDoBanco,
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
    },
    teto_diario_centavos_usd: 500,
    ...campos,
  };
}

function painelDoBanco(campos: Record<string, unknown> = {}) {
  return {
    gerado_em: GERADO_EM,
    totais: {
      clinicas: 1,
      em_uso: 1,
      sem_uso: 0,
      suspensas: 0,
      agente_liberado: 1,
      gasto_mes_centavos_usd: 310,
    },
    clinicas: [clinicaDoBanco()],
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
        },
        tetoDiarioCentavos: 500,
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
            teto_diario_centavos_usd: null,
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
    expect(clinica?.tetoDiarioCentavos).toBeNull();
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
      painelDoBanco({ clinicas: [clinicaDoBanco({ nome: " " })] }),
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
