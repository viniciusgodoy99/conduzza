import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O detalhe de uma clinica no Painel geral (onda 1) inteiro, como a pagina
// desenha depois de ler: as metricas (desde 26/10/2026, o ultimo acesso da
// equipe primeiro, com quem entrou), a equipe com os Implementadores numa
// lista separada, a conta, o agente, os numeros e os telefones (modo do
// painel), o gasto e o teto. Cada leitura de apoio que falhou mostra o erro
// no proprio cartao. A disponibilidade do agente vem do ambiente (T1) e da
// propria linha do painel (agente em teste e conta ativa): o motivo
// "servidor" nunca culpa a chave da OpenAI por uma clinica desligada ou
// suspensa. Onda 2 (item 11): o cartao "Para liberar a produção" e a
// Produção do agente, so com tudo cumprido. Segunda leva (26/10/2026): a
// saude com os sinais (o que o banco contou de cada um), a implantacao com
// os seis passos, a tendencia nas metricas, o gasto com a precisao real e
// as chamadas, as notas internas (o aviso de dado de paciente, o Excluir so
// da propria nota) e o historico da conta.

vi.mock("next/navigation", () => ({
  usePathname: () => "/painel-geral/c3333333-3333-4333-8333-333333333333",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));
vi.mock("@/app/(app)/painel-geral/actions", () => ({
  suspenderClinicaAction: vi.fn(),
  reativarClinicaAction: vi.fn(),
  definirAgenteDaClinicaAction: vi.fn(),
  definirTetoDaIaAction: vi.fn(),
  registrarRequisitoDaProducaoAction: vi.fn(),
  revogarRequisitoDaProducaoAction: vi.fn(),
  definirInterruptorGeralAction: vi.fn(),
  escreverNotaDaClinicaAction: vi.fn(),
  excluirNotaDaClinicaAction: vi.fn(),
}));
vi.mock("@/app/(app)/agente/whatsapp-actions", () => ({
  adicionarTelefoneDaIaAction: vi.fn(),
  alternarNumeroDaIaAction: vi.fn(),
  alternarTelefoneDaIaAction: vi.fn(),
  definirEscolhaDaIaAction: vi.fn(),
  definirPausaDaIaAction: vi.fn(),
  excluirTelefoneDaIaAction: vi.fn(),
}));

import { TEXTOS_DA_IA } from "@/components/agente/whatsapp/agente-de-ia";
import {
  agenteAtendeNoAmbiente,
  bloqueioDoTeto,
  DetalheDaClinica,
  numerosDosCartoes,
  type DetalheDaClinicaProps,
} from "@/components/painel-geral/detalhe-da-clinica";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";
import type {
  ClinicaNoPainel,
  EquipeNoPainel,
  RequisitoConferido,
  RequisitosDaProducao,
} from "@/lib/queries/painel-geral";

const ID = "c3333333-3333-4333-8333-333333333333";
const NUMERO = "d4444444-4444-4444-8444-444444444444";
const PESSOA = "e4444444-4444-4444-8444-444444444444";
const IMPLEMENTADOR = "f4444444-4444-4444-8444-444444444444";
const AGORA = Date.parse("2026-10-20T15:00:00.000Z");

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID,
    nome: "Estética Bela",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: "America/Fortaleza",
    emUso: true,
    ultimoAcesso: {
      em: "2026-10-20T13:05:00.000Z",
      userId: PESSOA,
      nome: "Ana Souza",
      email: "ana@bela.com.br",
      papel: "admin",
      implementador: false,
      equipeConduzza: false,
    },
    membrosAtivos: 3,
    membrosPendentes: 1,
    membrosEquipeConduzza: 0,
    pessoas: [{ nome: "Ana Souza", email: "ana@bela.com.br" }],
    numerosTotal: 1,
    numerosConectados: 1,
    numeros: [
      {
        id: NUMERO,
        nome: "Recepção",
        final: "4321",
        conexao: "conectado",
        iaLigada: true,
      },
    ],
    contatos: 1834,
    leads30Dias: 142,
    conversas30Dias: 1234,
    ultimaMensagemEm: "2026-10-20T13:05:00.000Z",
    suspensao: null,
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausadaPelaClinica: false,
      telefonesLigados: 1,
    },
    gasto: {
      ultimas24hCentavos: 42,
      mesCentavos: 310,
      ultimas24hSemSimuladorCentavos: 30,
      mesSemSimuladorCentavos: 200,
      ultimas24hMicrodolares: 421_500,
      mesMicrodolares: 3_100_400,
      ultimas24hSemSimuladorMicrodolares: 300_000,
      mesSemSimuladorMicrodolares: 2_000_000,
      ultimas24hChamadas: 12,
      mesChamadas: 40,
      ultimas24hSemSimuladorChamadas: 5,
      mesSemSimuladorChamadas: 1,
    },
    tetoDiarioCentavos: 500,
    saude: "saudavel",
    sinais: [],
    implantacao: {
      feitos: 4,
      total: 6,
      passos: [
        { chave: "whatsapp_conectado", feito: true, quantidade: 1 },
        { chave: "equipe_com_duas_pessoas", feito: true, quantidade: 3 },
        { chave: "procedimentos_cadastrados", feito: true, quantidade: 12 },
        { chave: "profissionais_cadastrados", feito: true, quantidade: 4 },
        { chave: "regua_de_confirmacao_ligada", feito: false, quantidade: 0 },
        { chave: "anuncios_conectados", feito: false, quantidade: 0 },
      ],
      anuncios: { meta: false, google: false },
    },
    tendencia: {
      leads: {
        atual: 142,
        anterior: 100,
        variacaoPercentual: 42,
        direcao: "subindo",
      },
      conversas: {
        atual: 1234,
        anterior: 0,
        variacaoPercentual: null,
        direcao: "sem_base",
      },
    },
    ultimaNotaEm: null,
    ...campos,
  };
}

const DADOS: DadosDaIa = {
  liberacao: {
    liberada: true,
    modo: "contatos",
    pausadaPelaClinica: false,
    tetoDiarioCentavosUsd: 500,
  },
  numerosLigados: [NUMERO],
  telefones: [
    { id: "t1", telefone: "+5584999990001", rotulo: "Ana", ativo: true },
  ],
  interruptorLigado: true,
  situacao: {
    tetoAtingido: false,
    versaoPublicada: 1,
    telefonesInvalidos: [],
    telefonesSemAutorizacao: [],
    conversasAbertas: [],
    horarioPublicado: null,
    motorParado: false,
  },
};

const EQUIPE: EquipeNoPainel = {
  equipe: [
    {
      userId: PESSOA,
      nome: "Ana Souza",
      email: "ana@bela.com.br",
      papel: "admin",
      situacao: "ativo",
      ultimoAcessoEm: "2026-10-20T13:05:00.000Z",
      equipeConduzza: false,
    },
  ],
  implementadores: [
    {
      userId: IMPLEMENTADOR,
      nome: "Técnico",
      email: "tecnico@implanta.com.br",
      papel: "admin",
      situacao: "ativo",
      ultimoAcessoEm: null,
      equipeConduzza: false,
    },
  ],
};

function detalhe(campos: Partial<DetalheDaClinicaProps> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <DetalheDaClinica
        clinica={clinica()}
        equipe={EQUIPE}
        dados={DADOS}
        tetos={{ tetoDiarioCentavos: 500, tetoRespostasPorConversaHora: 20 }}
        ambienteDaIa
        agoraMs={AGORA}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
        telefonesForcados={[]}
        versoes={null}
        notas={{ notas: [], temMais: false }}
        historico={{ eventos: [], temMais: false }}
        {...campos}
      />
    </TooltipProvider>,
  );
}

function escapado(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

describe("detalhe da clínica", () => {
  it("o cabeçalho, a volta para o painel e as métricas (de paciente, só contagens)", () => {
    const saida = detalhe();
    expect(saida).toContain("<h1");
    expect(saida).toContain(escapado("Estética Bela"));
    expect(saida).toContain('href="/painel-geral"');
    expect(saida).toContain("Criada em 01/09/2026");
    expect(saida).toContain("1 de 1");
    expect(saida).toContain("1.834");
    expect(saida).toContain("1.234");
    expect(saida).toContain("Hoje, 10:05");
    expect(saida).toContain("1 esperando liberação");
  });

  it("o último acesso da equipe nas métricas, primeiro: há quanto tempo, o dia e a hora no fuso da clínica e quem", () => {
    const saida = detalhe();
    const metricas = saida.slice(
      saida.indexOf('aria-label="Movimento da clínica"'),
    );
    expect(metricas.indexOf(escapado("Último acesso da equipe"))).toBeLessThan(
      metricas.indexOf(">Equipe<"),
    );
    expect(metricas).toContain(">Hoje<");
    expect(metricas).toContain(
      escapado("20/10/2026, 10:05, por Ana Souza (Administrador)"),
    );
    expect(metricas).toContain("lucide-log-in");
    // Em uso: sem o chip.
    expect(saida).not.toContain(">Sem uso<");
  });

  it("quando o último acesso foi da equipe Conduzza, o detalhe diz (ela conta no uso), e a equipe diz quantas das ativas são dela", () => {
    const saida = detalhe({
      clinica: clinica({
        ultimoAcesso: {
          ...clinica().ultimoAcesso!,
          nome: "Vinicius Rodrigues",
          equipeConduzza: true,
        },
        membrosAtivos: 1,
        membrosPendentes: 0,
        membrosEquipeConduzza: 1,
      }),
    });
    expect(saida).toContain(
      escapado("por Vinicius Rodrigues (Administrador, equipe Conduzza)"),
    );
    expect(saida).not.toContain(">Sem uso<");
    expect(saida).toContain(escapado("1 membro ativo (1 da equipe Conduzza)."));
  });

  it("sem uso, e quem nunca entrou: o chip Sem uso em 3 camadas", () => {
    const antigo = detalhe({
      clinica: clinica({
        emUso: false,
        ultimoAcesso: {
          ...clinica().ultimoAcesso!,
          em: "2026-08-01T12:00:00.000Z",
          implementador: true,
        },
      }),
    });
    expect(antigo).toContain(">Há 2 meses<");
    expect(antigo).toContain("por Ana Souza (Implementador)");
    expect(antigo).toContain(">Sem uso<");
    expect(antigo).toContain("lucide-watch");

    const nunca = detalhe({
      clinica: clinica({ emUso: false, ultimoAcesso: null }),
    });
    expect(nunca).toContain(escapado(TEXTOS_DO_PAINEL.ninguemEntrou));
    expect(nunca).toContain(">Sem uso<");
  });

  it("a equipe com os Implementadores numa lista separada; a leitura que falhou mostra o erro no lugar dela", () => {
    const saida = detalhe();
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.equipeTitulo));
    expect(saida).toContain(">Implementadores</p>");
    expect(saida).toContain("tecnico@implanta.com.br");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.nuncaEntrou));

    const semEquipe = detalhe({ equipe: "erro" });
    expect(semEquipe).toContain(escapado(TEXTOS_DO_PAINEL.equipeSemLeitura));
    expect(semEquipe).not.toContain(">Implementadores</p>");
    // O resto do detalhe continua de pe.
    expect(semEquipe).toContain("Conta da clínica");
  });

  it("todos os cartões: conta, agente, números, telefones, gasto, teto e equipe", () => {
    const saida = detalhe();
    for (const titulo of [
      "Conta da clínica",
      "Agente de IA",
      "Números do assistente",
      "Telefones da equipe",
      "Gasto de IA",
      "Teto de gasto",
      "Equipe da clínica",
    ]) {
      expect(saida, titulo).toContain(escapado(titulo));
    }
    expect(saida).toContain("final 4321");
    // Tudo de pe e conferido: o verde.
    expect(saida).toContain("Na clínica agora");
    expect(saida).toContain("Conversando com a equipe");
  });

  it("sem número e sem mensagem: o vazio escrito, nunca um zero grande", () => {
    const saida = detalhe({
      clinica: clinica({
        numerosTotal: 0,
        numerosConectados: 0,
        numeros: [],
        ultimaMensagemEm: null,
      }),
    });
    expect(saida).toContain("Nenhum número");
    expect(saida).toContain("Nenhuma ainda");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.semNumerosNoPainel));
  });

  it("leitura do agente que falhou: o erro no lugar dos cartões e o não conferido no agente", () => {
    const saida = detalhe({ dados: "erro" });
    expect(saida).toContain(
      "Não foi possível carregar os números e os telefones do agente",
    );
    expect(saida).not.toContain("Números do assistente");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteSemLeitura));
  });

  it("leitura do teto que falhou: o erro no lugar do formulário", () => {
    const saida = detalhe({ tetos: "erro" });
    expect(saida).toContain("Não foi possível carregar o teto de gasto");
    expect(saida).not.toContain("Salvar teto");
  });

  it("agente desligado: os cartões visíveis e desabilitados, com o porquê escrito", () => {
    const saida = detalhe({
      clinica: clinica({
        agente: {
          estado: "desligado",
          modo: null,
          liberada: false,
          pausadaPelaClinica: false,
          telefonesLigados: 0,
        },
      }),
    });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.ligueOAgenteAntes));
    expect(saida).not.toContain("Na clínica agora");
    // Sem o agente, a linha do numero nao diz "Em uso pelo assistente".
    expect(saida).not.toContain(TEXTOS_DA_IA.numeroEmUso);
  });

  it("fora da produção (sem T1): o motivo é o ambiente, para a equipe Conduzza", () => {
    const saida = detalhe({ ambienteDaIa: false });
    expect(saida).toContain("Ligado, mas parado");
    expect(saida).toContain(
      escapado(TEXTOS_DA_IA.motivosParaAEquipeConduzza.servidor),
    );
  });

  it("conta suspensa em teste: o aviso, sem a lista de motivos e sem o verde", () => {
    const saida = detalhe({
      clinica: clinica({
        suspensao: {
          suspensaEm: "2026-10-18T10:00:00.000Z",
          motivo: "Pagamento atrasado",
        },
      }),
    });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteComContaSuspensa));
    expect(saida).not.toContain("Na clínica agora");
    expect(saida).not.toContain(
      escapado(TEXTOS_DA_IA.motivosParaAEquipeConduzza.servidor),
    );
    expect(saida).not.toContain(TEXTOS_DA_IA.numeroEmUso);
    expect(saida).toContain("Reativar conta");
  });

  it("sem travessão", () => {
    expect(detalhe()).not.toMatch(/[—–]/);
    expect(detalhe({ dados: "erro", tetos: null, equipe: "erro" })).not.toMatch(
      /[—–]/,
    );
    expect(
      detalhe({ clinica: clinica({ emUso: false, ultimoAcesso: null }) }),
    ).not.toMatch(/[—–]/);
  });
});

describe("regras do detalhe", () => {
  it("o agente atende no ambiente só com T1, em teste (ou em produção) e com a conta ativa", () => {
    const base = clinica();
    expect(agenteAtendeNoAmbiente(base, true)).toBe(true);
    expect(
      agenteAtendeNoAmbiente(
        { ...base, agente: { ...base.agente, estado: "producao" } },
        true,
      ),
    ).toBe(true);
    expect(agenteAtendeNoAmbiente(base, false)).toBe(false);
    expect(
      agenteAtendeNoAmbiente(
        { ...base, agente: { ...base.agente, estado: "desligado" } },
        true,
      ),
    ).toBe(false);
    expect(
      agenteAtendeNoAmbiente(
        {
          ...base,
          suspensao: { suspensaEm: "2026-10-18T10:00:00.000Z", motivo: "x" },
        },
        true,
      ),
    ).toBe(false);
  });

  it("o teto trava só com a conta suspensa e a liberação ligada", () => {
    const base = clinica();
    const suspensa = {
      suspensaEm: "2026-10-18T10:00:00.000Z",
      motivo: "Pagamento atrasado",
    };
    expect(bloqueioDoTeto(base)).toBeNull();
    expect(bloqueioDoTeto({ ...base, suspensao: suspensa })).toBe(
      TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto,
    );
    expect(
      bloqueioDoTeto({
        ...base,
        suspensao: suspensa,
        agente: { ...base.agente, liberada: false },
      }),
    ).toBeNull();
  });

  it("os números do painel no formato dos cartões, com os finais à parte", () => {
    const { numeros, finais } = numerosDosCartoes(clinica());
    expect(numeros).toEqual([
      expect.objectContaining({
        id: NUMERO,
        nome: "Recepção",
        status: "conectado",
        displayPhone: null,
      }),
    ]);
    expect(finais).toEqual({ [NUMERO]: "4321" });
  });
});

describe("onda 2: a produção no detalhe (item 11)", () => {
  const NADA_CONFERIDO: RequisitoConferido["conferido"] = {
    estado: null,
    versao: null,
    publico: null,
    modo: null,
    conectados: null,
  };

  /** Um requisito como o leitor devolve (lib/queries/painel-geral). */
  function conferido(
    chave: string,
    ok: boolean,
    campos: Partial<Omit<RequisitoConferido, "chave" | "ok">> = {},
  ): RequisitoConferido {
    return {
      chave,
      ok,
      origem: "banco",
      registro: null,
      conferido: NADA_CONFERIDO,
      ...campos,
    };
  }

  const RODADA_VIVA: RequisitoConferido = conferido("rodada_cfm", true, {
    origem: "equipe",
    registro: {
      id: "e1111111-1111-4111-8111-111111111111",
      revogado: false,
      evidencia: "Rodada de 21/10. Filtro regras-1, modelo gpt-6-luna",
      registradoEm: "2026-10-21T12:00:00.000Z",
      geral: true,
      revogadoEm: null,
      motivoDaRevogacao: null,
    },
  });

  const TODOS_OK: RequisitosDaProducao = {
    estado: "lido",
    conferidos: [
      conferido("agente_em_teste", true, {
        conferido: { ...NADA_CONFERIDO, estado: "teste" },
      }),
      conferido("versao_publicada", true, {
        conferido: { ...NADA_CONFERIDO, versao: 2 },
      }),
      conferido("publico_escolhido", true, {
        conferido: { ...NADA_CONFERIDO, publico: "leads" },
      }),
      RODADA_VIVA,
    ],
  };

  /** A tag de abertura do botao com aquele texto (a primeira). */
  function aberturaDoBotao(html: string, texto: string): string {
    const indice = html.indexOf(`${texto}</button>`);
    expect(indice, `botão "${texto}"`).toBeGreaterThan(-1);
    const abertura = html.lastIndexOf("<button", indice);
    return html.slice(abertura, html.indexOf(">", abertura) + 1);
  }

  it("banco sem a migration: o cartão diz que a produção não chegou, e a Produção presa com a dica de antes", () => {
    const saida = detalhe();
    expect(saida).toContain("Para liberar a produção");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.requisitosIndisponiveis));
    expect(aberturaDoBotao(saida, "Produção")).toContain('disabled=""');
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.dicaDaProducao));
  });

  it("leitura que falhou: o erro no cartão, e a Produção presa", () => {
    const saida = detalhe({ requisitos: "erro" });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.requisitosSemLeitura));
    expect(aberturaDoBotao(saida, "Produção")).toContain('disabled=""');
  });

  it("com requisito faltando: a lista em 3 camadas, Registrar nos da equipe e a Produção presa", () => {
    const saida = detalhe({
      requisitos: {
        estado: "lido",
        conferidos: [
          conferido("versao_publicada", true, {
            conferido: { ...NADA_CONFERIDO, versao: 2 },
          }),
          conferido("contrato_openai", false, { origem: "equipe" }),
        ],
      },
    });
    expect(saida).toContain("Versão do assistente publicada");
    expect(saida).toContain("Versão 2 publicada.");
    expect(saida).toContain(">Cumprido<");
    expect(saida).toContain(">Falta<");
    expect(saida).toContain("Registrar</button>");
    expect(saida).not.toContain("Revogar</button>");
    expect(aberturaDoBotao(saida, "Produção")).toContain('disabled=""');
    expect(saida).toContain(
      escapado(TEXTOS_DO_PAINEL.dicaDaProducaoComRequisitos),
    );
  });

  it("tudo cumprido e o agente em teste: a Produção liberada; o registro vivo pode ser revogado", () => {
    const saida = detalhe({ requisitos: TODOS_OK });
    expect(aberturaDoBotao(saida, "Produção")).not.toContain('disabled=""');
    expect(saida).not.toContain(
      escapado(TEXTOS_DO_PAINEL.dicaDaProducaoComRequisitos),
    );
    expect(saida).toContain("Revogar</button>");
    expect(saida).toContain("Registrar de novo</button>");
    expect(saida).toContain(", vale para todas as clínicas");
    expect(saida).toContain(
      "Evidência: Rodada de 21/10. Filtro regras-1, modelo gpt-6-luna",
    );
  });

  it("registro revogado e sem outro vivo: Revogado em 3 camadas, a data, o motivo e Registrar de novo não aparece", () => {
    const saida = detalhe({
      requisitos: {
        estado: "lido",
        conferidos: [
          conferido("contrato_openai", false, {
            origem: "equipe",
            registro: {
              id: "e2222222-2222-4222-8222-222222222222",
              revogado: true,
              evidencia: null,
              registradoEm: null,
              geral: null,
              revogadoEm: "2026-10-21T15:00:00.000Z",
              motivoDaRevogacao: "Contrato vencido",
            },
          }),
        ],
      },
    });
    expect(saida).toContain(">Revogado<");
    expect(saida).toContain("Revogado em");
    expect(saida).toContain("Motivo: Contrato vencido");
    expect(saida).toContain("Registrar</button>");
    expect(saida).not.toContain("Registrar de novo</button>");
    expect(saida).not.toContain("Revogar</button>");
    expect(aberturaDoBotao(saida, "Produção")).toContain('disabled=""');
  });

  it("tudo cumprido, mas o agente desligado: a Produção presa (só a partir de Teste)", () => {
    const saida = detalhe({
      requisitos: TODOS_OK,
      clinica: clinica({
        agente: {
          estado: "desligado",
          modo: null,
          liberada: false,
          pausadaPelaClinica: false,
          telefonesLigados: 0,
        },
      }),
    });
    expect(aberturaDoBotao(saida, "Produção")).toContain('disabled=""');
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.dicaDaProducaoSoDeTeste));
  });

  it("em produção: o chip Produção e o agente na clínica pela mesma regra da Tela 6", () => {
    const saida = detalhe({
      requisitos: TODOS_OK,
      clinica: clinica({
        agente: {
          estado: "producao",
          modo: "numero_inteiro",
          liberada: true,
          pausadaPelaClinica: false,
          telefonesLigados: 1,
        },
      }),
      dados: {
        ...DADOS,
        liberacao: {
          ...DADOS.liberacao!,
          modo: "numero_inteiro" as string as NonNullable<
            DadosDaIa["liberacao"]
          >["modo"],
        },
      },
    });
    expect(aberturaDoBotao(saida, "Produção")).toContain('aria-pressed="true"');
    expect(saida).toContain("Na clínica agora");
    expect(saida).toContain("Atendendo os contatos");
  });

  it("P11e: a versão de agora não está na evidência da rodada: o aviso, sem travar", () => {
    const mudou = detalhe({
      requisitos: TODOS_OK,
      versoes: { filtro: "regras-9", modelo: "gpt-6-luna" },
    });
    expect(mudou).toContain(escapado(TEXTOS_DO_PAINEL.versaoMudou));
    expect(aberturaDoBotao(mudou, "Produção")).not.toContain('disabled=""');
    const igual = detalhe({
      requisitos: TODOS_OK,
      versoes: { filtro: "regras-1", modelo: "gpt-6-luna" },
    });
    expect(igual).not.toContain(escapado(TEXTOS_DO_PAINEL.versaoMudou));
  });

  it("sem travessão nos estados novos", () => {
    for (const requisitos of [
      TODOS_OK,
      { estado: "indisponivel" as const },
      "erro" as const,
    ]) {
      expect(detalhe({ requisitos })).not.toMatch(/[—–]/);
    }
  });
});

describe("segunda leva do detalhe (pedido do dono de 26/10/2026)", () => {
  const AUTORA = "a7777777-7777-4777-8777-777777777777";
  const NOTA = "b8888888-8888-4888-8888-888888888888";
  const OUTRA_NOTA = "c9999999-9999-4999-8999-999999999999";

  /** O pedaco do HTML de uma regiao (cartao) pelo titulo. */
  function regiao(saida: string, titulo: string): string {
    const indice = saida.indexOf(`>${escapado(titulo)}<`);
    expect(indice, titulo).toBeGreaterThan(-1);
    const inicio = saida.lastIndexOf('role="region"', indice);
    const fim = saida.indexOf('role="region"', indice);
    return saida.slice(inicio, fim === -1 ? undefined : fim);
  }

  it("a saúde com a regra escrita; cada sinal em 3 camadas com o que o banco contou, no fuso da clínica", () => {
    const saudavel = regiao(detalhe(), TEXTOS_DO_PAINEL.saudeTitulo);
    expect(saudavel).toContain(escapado(TEXTOS_DO_PAINEL.saudeRegra));
    expect(saudavel).toContain("lucide-circle-check");
    expect(saudavel).toContain(">Saudável<");
    expect(saudavel).toContain(escapado(TEXTOS_DO_PAINEL.nenhumSinal));

    const emRisco = regiao(
      detalhe({
        clinica: clinica({
          suspensao: {
            suspensaEm: "2026-10-18T10:00:00.000Z",
            motivo: "Pagamento atrasado",
          },
          saude: "em_risco",
          sinais: [
            {
              chave: "conta_suspensa",
              nivel: "em_risco",
              quantidade: null,
              desde: "2026-10-18T10:00:00.000Z",
            },
            {
              chave: "falhas_de_envio",
              nivel: "atencao",
              quantidade: 3,
              // 12:00 UTC = 09:00 em Fortaleza
              desde: "2026-10-19T12:00:00.000Z",
            },
          ],
        }),
      }),
      TEXTOS_DO_PAINEL.saudeTitulo,
    );
    expect(emRisco).toContain("lucide-siren");
    expect(emRisco).toContain(">Em risco<");
    expect(emRisco).toContain("lucide-octagon-pause");
    expect(emRisco).toContain("Suspensa desde 18/10/2026, 07:00.");
    expect(emRisco).toContain(">3 falhas de envio<");
    expect(emRisco).toContain("lucide-octagon-alert");
    expect(emRisco).toContain(
      escapado(
        "3 mensagens não saíram nos últimos 7 dias. A primeira falha foi em 19/10/2026, 09:00.",
      ),
    );
  });

  it("a implantação: N de 6 passos, cada passo Feito ou Falta em 3 camadas, com o que o banco contou, e a âncora da lista", () => {
    const saida = detalhe();
    expect(saida).toContain('id="implantacao"');
    const implantacao = regiao(saida, TEXTOS_DO_PAINEL.implantacaoTitulo);
    expect(implantacao).toContain(">4 de 6 passos<");
    expect(implantacao.match(/<span>Feito<\/span>/g)).toHaveLength(4);
    expect(implantacao.match(/<span>Falta<\/span>/g)).toHaveLength(2);
    expect(implantacao).toContain("lucide-circle-dashed");
    expect(implantacao).toContain("12 procedimentos ativos.");
    expect(implantacao).toContain(
      escapado("Nenhuma régua de confirmação ligada."),
    );
    expect(implantacao).toContain(
      escapado("Meta desligada. Rastreio do Google desligado."),
    );
  });

  it("as métricas de leads e conversas com a tendência do banco e a base dos 30 dias anteriores", () => {
    const metricas = detalhe().slice(
      detalhe().indexOf('aria-label="Movimento da clínica"'),
    );
    expect(metricas).toContain("+42%");
    expect(metricas).toContain("lucide-trending-up");
    expect(metricas).toContain("subindo 42% vs. 30 dias anteriores");
    expect(metricas).toContain("100 nos 30 dias anteriores");
    expect(metricas).toContain(">Sem base<");
    expect(metricas).toContain("0 nos 30 dias anteriores");
  });

  it("o gasto de IA com a precisão real em todos os recortes e as chamadas", () => {
    const gastoMinimo = regiao(
      detalhe({
        clinica: clinica({
          gasto: {
            ...clinica().gasto,
            ultimas24hCentavos: 0,
            ultimas24hMicrodolares: 1000,
            ultimas24hChamadas: 7,
            mesCentavos: 0,
            mesMicrodolares: 1000,
            mesChamadas: 7,
          },
        }),
      }),
      "Gasto de IA",
    );
    expect(gastoMinimo).toContain("US$ 0,001 de US$ 5,00");
    expect(gastoMinimo).toContain("7 chamadas nas últimas 24 horas");
    expect(gastoMinimo).toContain("US$ 0,001");
    expect(gastoMinimo).toContain("US$ 2,00");
    expect(gastoMinimo).toContain("1 chamada");
  });

  it("as notas: o aviso de dado de paciente, o campo de até 2.000, o Excluir só da própria nota e a dica nas outras", () => {
    const saida = detalhe({
      notas: {
        temMais: true,
        notas: [
          {
            id: NOTA,
            texto: "Combinado: treinar a recepção na sexta.",
            // 13:05 UTC = 10:05 em Fortaleza
            criadaEm: "2026-10-20T13:05:00.000Z",
            autor: {
              userId: AUTORA,
              nome: "Vinicius Rodrigues",
              email: "v@conduzza.com",
              equipeConduzza: true,
            },
            minha: true,
          },
          {
            id: OUTRA_NOTA,
            texto: "Ligar para o gestor na segunda.",
            criadaEm: "2026-10-19T13:05:00.000Z",
            autor: {
              userId: PESSOA,
              nome: "Ana Lima",
              email: "ana@conduzza.com",
              equipeConduzza: true,
            },
            minha: false,
          },
        ],
      },
    });
    const notas = regiao(saida, TEXTOS_DO_PAINEL.notasTitulo);
    expect(notas).toContain(escapado(TEXTOS_DO_PAINEL.notasDescricao));
    expect(notas).toContain(
      escapado(TEXTOS_DO_PAINEL.naoEscrevaDadoDePaciente),
    );
    expect(notas).toContain('maxLength="2000"');
    expect(notas).toContain(escapado(TEXTOS_DO_PAINEL.regraDaNota));
    expect(notas).toContain("0 de 2.000");
    // Campo vazio: o Salvar visivel e desabilitado, com a regra ligada.
    const salvar = notas.slice(
      notas.lastIndexOf("<button", notas.indexOf(">Salvar nota<")),
      notas.indexOf(">Salvar nota<"),
    );
    expect(salvar).toContain('disabled=""');
    expect(salvar).toContain("aria-describedby=");
    expect(notas).toContain(
      escapado("Combinado: treinar a recepção na sexta."),
    );
    expect(notas).toContain(
      escapado("Escrita por Vinicius Rodrigues (equipe Conduzza) em"),
    );
    expect(notas).toContain("20/10/2026, 10:05");
    // A propria nota: Excluir habilitado; a de outra pessoa: desabilitado,
    // com a dica.
    const botoes = [
      ...notas.matchAll(/<button[^>]*>(?:(?!<\/button>).)*Excluir nota/g),
    ].map((m) => m[0]);
    expect(botoes).toHaveLength(2);
    expect(botoes[0]).not.toContain('disabled=""');
    expect(botoes[1]).toContain('disabled=""');
    expect(notas).toContain("cursor-not-allowed");
    expect(notas).toContain(escapado(TEXTOS_DO_PAINEL.notasTemMais));
    // Nenhum dialogo aberto sem clique.
    expect(saida).not.toContain(escapado(TEXTOS_DO_PAINEL.excluirNotaTitulo));
  });

  it("as notas: vazio e leitura que falhou (só a seção mostra o erro)", () => {
    const vazio = regiao(detalhe(), TEXTOS_DO_PAINEL.notasTitulo);
    expect(vazio).toContain(escapado(TEXTOS_DO_PAINEL.nenhumaNota));
    const falhou = detalhe({ notas: "erro" });
    expect(falhou).toContain(escapado(TEXTOS_DO_PAINEL.notasSemLeitura));
    // O campo continua: escrever nao depende da leitura.
    expect(regiao(falhou, TEXTOS_DO_PAINEL.notasTitulo)).toContain(
      ">Salvar nota<",
    );
    expect(falhou).toContain("Conta da clínica");
  });

  it("o histórico da conta: o mais novo primeiro, quem e quando no fuso da clínica; vazio e erro", () => {
    const saida = detalhe({
      historico: {
        temMais: false,
        eventos: [
          {
            id: "12",
            em: "2026-10-20T13:05:00.000Z",
            acao: "mudou_agente_da_clinica",
            autor: {
              userId: AUTORA,
              nome: "Vinicius Rodrigues",
              email: "v@conduzza.com",
              equipeConduzza: true,
            },
            detalhes: {
              estado: "teste",
              motivo: "Piloto combinado",
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
            id: "11",
            em: "2026-10-18T10:00:00.000Z",
            acao: "suspendeu_clinica",
            autor: null,
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
          // A mudanca de agente anterior: o Teste de cima vem do Desligado
          // (a tela tira a direcao da lista inteira; a trilha so guarda o
          // destino).
          {
            id: "10",
            em: "2026-10-17T10:00:00.000Z",
            acao: "mudou_agente_da_clinica",
            autor: null,
            detalhes: {
              estado: "desligado",
              motivo: null,
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
        ],
      },
    });
    const historico = regiao(saida, TEXTOS_DO_PAINEL.historicoTitulo);
    expect(historico.indexOf("Agente liberado em Teste")).toBeGreaterThan(-1);
    expect(historico.indexOf("Agente liberado em Teste")).toBeLessThan(
      historico.indexOf("Conta suspensa"),
    );
    expect(historico.indexOf("Conta suspensa")).toBeLessThan(
      historico.indexOf("Agente retirado"),
    );
    expect(historico).toContain("Motivo: Piloto combinado");
    expect(historico).toContain(
      escapado("Feito por Vinicius Rodrigues (equipe Conduzza) em"),
    );
    expect(historico).toContain("20/10/2026, 10:05");
    expect(historico).toContain("Feito pelo sistema em");
    // A lista rola dentro do cartao e recebe o foco do teclado.
    expect(historico).toContain('tabindex="0"');

    expect(regiao(detalhe(), TEXTOS_DO_PAINEL.historicoTitulo)).toContain(
      escapado(TEXTOS_DO_PAINEL.historicoVazio),
    );
    expect(detalhe({ historico: "erro" })).toContain(
      escapado(TEXTOS_DO_PAINEL.historicoSemLeitura),
    );
  });

  it("sem travessão nos cartões novos", () => {
    expect(
      detalhe({
        notas: "erro",
        historico: "erro",
        clinica: clinica({
          saude: "atencao",
          sinais: [
            {
              chave: "perto_do_teto_da_ia",
              nivel: "atencao",
              quantidade: 120,
              desde: null,
            },
          ],
        }),
      }),
    ).not.toMatch(/[—–]/);
  });
});
