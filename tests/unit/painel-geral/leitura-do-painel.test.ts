import { describe, expect, it } from "vitest";

import {
  fetchClinicaDoPainel,
  fetchNumeroDaClinicaNoPainel,
  fetchPainelGeral,
  fetchTetosDaIa,
  lerPainelDoBanco,
} from "@/lib/queries/painel-geral";

// Leitura do Painel geral (onda 1): o jsonb de painel_geral_das_clinicas()
// com as chaves combinadas com a frente de banco. Campo essencial fora do
// formato LANCA (a tela mostra o erro, nunca um painel que afirma o que nao
// leu); item de lista fora do formato fica de fora. A RPC e chamada com a
// sessao, sem parametro (as clinicas e_de_teste ficam fora do painel).

const ID = "acd9c539-585e-4f2a-a195-712c70099564";
const OUTRA = "f0c115dd-e98c-4767-a1bb-93d517844852";
const NUMERO = "a1111111-1111-4111-8111-111111111111";

function clinicaDoBanco(campos: Record<string, unknown> = {}) {
  return {
    id: ID,
    nome: "teste123",
    criada_em: "2026-08-20T12:00:00+00:00",
    fuso: "America/Fortaleza",
    membros_ativos: 4,
    membros_pendentes: 1,
    administradores: [
      { nome: "Vinicius", email: "vinicius@conduzza.com" },
      { nome: null, email: "sem.nome@conduzza.com" },
      { nome: null, email: null },
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
    totais: {
      clinicas: 1,
      ativas: 1,
      suspensas: 0,
      agente_em_teste: 1,
      gasto_24h_centavos_usd: 42,
      gasto_mes_centavos_usd: 310,
    },
    clinicas: [clinicaDoBanco()],
    ...campos,
  };
}

describe("lerPainelDoBanco", () => {
  it("lê os totais e a clínica nas chaves combinadas", () => {
    const painel = lerPainelDoBanco(painelDoBanco());
    expect(painel.totais).toEqual({
      clinicas: 1,
      ativas: 1,
      suspensas: 0,
      agenteEmTeste: 1,
      gasto24hCentavos: 42,
      gastoMesCentavos: 310,
    });
    expect(painel.clinicas).toEqual([
      {
        id: ID,
        nome: "teste123",
        criadaEm: "2026-08-20T12:00:00+00:00",
        fuso: "America/Fortaleza",
        membrosAtivos: 4,
        membrosPendentes: 1,
        administradores: [
          { nome: "Vinicius", email: "vinicius@conduzza.com" },
          { nome: null, email: "sem.nome@conduzza.com" },
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

  it("clínica suspensa, sem agente, sem teto, sem mensagem e sem fuso", () => {
    const painel = lerPainelDoBanco(
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            fuso: null,
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

  it("formato estranho no essencial: lança", () => {
    const quebrados: unknown[] = [
      null,
      [],
      "painel",
      { clinicas: [] },
      painelDoBanco({ totais: { ...painelDoBanco().totais, ativas: -1 } }),
      painelDoBanco({ clinicas: null }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ id: "x" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ nome: " " })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ criada_em: "ontem" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ contatos: "250" })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ leads_30_dias: 1.5 })] }),
      painelDoBanco({ clinicas: [clinicaDoBanco({ gasto: null })] }),
      painelDoBanco({
        clinicas: [clinicaDoBanco({ suspensao: { suspensa_em: null } })],
      }),
      // 'producao' so existe na onda 2: banco e codigo desencontrados.
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            agente: { ...clinicaDoBanco().agente, estado: "producao" },
          }),
        ],
      }),
      painelDoBanco({
        clinicas: [
          clinicaDoBanco({
            agente: { ...clinicaDoBanco().agente, modo: "numero_inteiro" },
          }),
        ],
      }),
    ];
    for (const valor of quebrados) {
      expect(() => lerPainelDoBanco(valor)).toThrow("painel geral ilegivel");
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
  it("o painel é uma RPC só, sem parâmetro (sem as clínicas de teste automático)", async () => {
    const { cliente, chamadas } = clienteFalso({
      data: painelDoBanco(),
      error: null,
    });
    const painel = await fetchPainelGeral(cliente);
    expect(painel.clinicas).toHaveLength(1);
    expect(chamadas).toEqual([
      { nome: "painel_geral_das_clinicas", args: undefined },
    ]);
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

  it("uma clínica e um número pelo painel, sem diferenciar maiúscula", async () => {
    const { cliente } = clienteFalso({ data: painelDoBanco(), error: null });
    expect((await fetchClinicaDoPainel(cliente, ID.toUpperCase()))?.id).toBe(
      ID,
    );
    expect(await fetchClinicaDoPainel(cliente, OUTRA)).toBeNull();
    expect(
      await fetchNumeroDaClinicaNoPainel(cliente, ID, NUMERO.toUpperCase()),
    ).toMatchObject({ id: NUMERO, conexao: "conectado" });
    expect(await fetchNumeroDaClinicaNoPainel(cliente, ID, OUTRA)).toBeNull();
    expect(
      await fetchNumeroDaClinicaNoPainel(cliente, OUTRA, NUMERO),
    ).toBeNull();
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
