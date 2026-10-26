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
// Produção do agente, so com tudo cumprido.

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
    },
    tetoDiarioCentavos: 500,
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
