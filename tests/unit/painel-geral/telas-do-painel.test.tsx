import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// As telas do Painel geral (onda 1) renderizadas no servidor: a lista com a
// conta e o agente em 3 camadas (icone, rotulo e cor), os numeros, o
// movimento, a ultima mensagem no fuso da clinica e o gasto contra o teto;
// os vazios (inicial e por filtro) e o erro; os totais; e o detalhe (conta
// com suspender e reativar, agente com a Producao travada e a dica, teto,
// gasto, equipe e os cartoes de numeros e telefones no modo do painel). Sem
// travessao em estado nenhum, e nenhum dado de paciente (so contagens).

const navegacao = vi.hoisted(() => ({ busca: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/painel-geral",
  useSearchParams: () => new URLSearchParams(navegacao.busca),
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

import type { ContextoDaIa } from "@/components/agente/whatsapp/agente-de-ia";
import {
  AgenteDaClinica,
  textoDoAgenteMudou,
} from "@/components/painel-geral/agente-da-clinica";
import { CartoesDoAgenteNoPainel } from "@/components/painel-geral/cartoes-do-agente-no-painel";
import {
  ContaDaClinica,
  textoDaReativacao,
} from "@/components/painel-geral/conta-da-clinica";
import {
  EquipeDaClinica,
  textoDaEquipe,
} from "@/components/painel-geral/equipe-da-clinica";
import { ErroDoPainel } from "@/components/painel-geral/erro-do-painel";
import { InterruptorGeral } from "@/components/painel-geral/interruptor-geral";
import { GastoDaIa } from "@/components/painel-geral/gasto-da-ia";
import { ListaDoPainel } from "@/components/painel-geral/lista-do-painel";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { TetoDaIa } from "@/components/painel-geral/teto-da-ia";
import { TotaisDoPainel } from "@/components/painel-geral/totais-do-painel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";
import type { ClinicaNoPainel } from "@/lib/queries/painel-geral";

const ID_A = "a1111111-1111-4111-8111-111111111111";
const ID_B = "b2222222-2222-4222-8222-222222222222";
const ID_C = "c3333333-3333-4333-8333-333333333333";
const NUMERO = "d4444444-4444-4444-8444-444444444444";
const CONVERSA = "e5555555-5555-4555-8555-555555555555";
const AGORA = "2026-10-20T15:00:00.000Z"; // 12:00 em Fortaleza

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID_A,
    nome: "Clínica Aurora",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: "America/Fortaleza",
    membrosAtivos: 3,
    membrosPendentes: 0,
    administradores: [{ nome: "Ana Souza", email: "ana@aurora.com.br" }],
    numerosTotal: 2,
    numerosConectados: 1,
    numeros: [],
    contatos: 120,
    leads30Dias: 14,
    conversas30Dias: 1234,
    ultimaMensagemEm: "2026-10-20T13:05:00.000Z",
    suspensao: null,
    agente: {
      estado: "desligado",
      modo: null,
      liberada: false,
      pausadaPelaClinica: false,
      telefonesLigados: 0,
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

const LISTA: ClinicaNoPainel[] = [
  clinica(),
  clinica({
    id: ID_B,
    nome: "Odonto Árvore",
    suspensao: {
      suspensaEm: "2026-10-18T10:00:00.000Z",
      motivo: "Pagamento atrasado",
    },
    numerosConectados: 0,
    ultimaMensagemEm: null,
    gasto: {
      ultimas24hCentavos: 500,
      mesCentavos: 900,
      ultimas24hSemSimuladorCentavos: 500,
      mesSemSimuladorCentavos: 900,
    },
  }),
  clinica({
    id: ID_C,
    nome: "Estética Bela",
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausadaPelaClinica: false,
      telefonesLigados: 2,
    },
    gasto: {
      ultimas24hCentavos: 410,
      mesCentavos: 1000,
      ultimas24hSemSimuladorCentavos: 100,
      mesSemSimuladorCentavos: 200,
    },
    tetoDiarioCentavos: 500,
  }),
];

function html(no: React.ReactNode): string {
  return renderToStaticMarkup(<TooltipProvider>{no}</TooltipProvider>);
}

/** O HTML do texto, como o React escapa. */
function escapado(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** O pedaco do HTML de um chip pelo rotulo: o span da pilula inteira. */
function chip(saida: string, rotulo: string): string {
  const fim = saida.indexOf(`<span>${rotulo}</span>`);
  expect(fim, rotulo).toBeGreaterThan(-1);
  const inicio = saida.lastIndexOf("<span data-size", fim);
  return saida.slice(inicio, fim + rotulo.length + 13);
}

beforeEach(() => {
  navegacao.busca = "";
});

describe("lista do painel", () => {
  it("uma linha por clínica, pelo nome, com o link para o detalhe", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const ordem = ["Clínica Aurora", "Estética Bela", "Odonto Árvore"].map(
      (nome) => saida.indexOf(escapado(nome)),
    );
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    for (const id of [ID_A, ID_B, ID_C]) {
      expect(saida).toContain(`href="/painel-geral/${id}"`);
    }
    expect(saida).toContain("3 clínicas");
  });

  it("conta e agente em 3 camadas: ícone de forma própria, rótulo e cor", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(chip(saida, "Ativa")).toContain("lucide-circle-check");
    expect(chip(saida, "Ativa")).toContain("var(--success-text)");
    expect(chip(saida, "Suspensa")).toContain("lucide-octagon-pause");
    expect(chip(saida, "Suspensa")).toContain("var(--alert-text)");
    expect(chip(saida, "Desligado")).toContain("lucide-circle-pause");
    expect(chip(saida, "Teste")).toContain("lucide-flask-conical");
    expect(chip(saida, "Teste")).toContain("var(--info-text)");
    expect(saida).toContain("Desde 18/10/2026");
    expect(saida).toContain("Conversa com a equipe");
  });

  it("números, movimento, última mensagem no fuso da clínica e gasto contra o teto", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(saida).toContain("1 de 2");
    expect(chip(saida, "Nenhum conectado")).toContain("lucide-wifi-off");
    expect(saida).toContain("1.234");
    expect(saida).toContain("Hoje, 10:05");
    expect(saida).toContain("Nenhuma");
    expect(saida).toContain("US$ 0,42");
    expect(saida).toContain("em 24 h");
    expect(saida).toContain('Teto de <span class="cz-num">US$ 5,00</span>');
    expect(saida).toContain('<span class="cz-num">US$ 3,10</span> no mês');
    expect(chip(saida, "Teto atingido")).toContain("lucide-hourglass");
    expect(chip(saida, "Perto do teto")).toContain("lucide-circle-alert");
  });

  it("vazio inicial: nenhuma clínica, sem tabela", () => {
    const saida = html(<ListaDoPainel clinicas={[]} agoraIso={AGORA} />);
    expect(saida).toContain(TEXTOS_DO_PAINEL.vazio);
    expect(saida).not.toContain("<table");
  });

  it("filtros da URL: só as suspensas; a busca sem resultado tem o vazio próprio e o limpar", () => {
    navegacao.busca = "situacao=suspensa";
    const suspensas = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(suspensas).toContain(escapado("Odonto Árvore"));
    expect(suspensas).not.toContain(escapado("Clínica Aurora"));
    expect(suspensas).toContain("1 clínica");
    expect(suspensas).toContain('aria-pressed="true"');
    expect(suspensas).toContain("Limpar filtros");

    navegacao.busca = "busca=zzz";
    const nada = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(nada).toContain(TEXTOS_DO_PAINEL.vazioPorFiltro);
    expect(nada).toContain("Limpar filtros");
    expect(nada).not.toContain("<table");
  });

  it("os filtros têm nome acessível e alvo de 40px", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(saida).toContain('aria-label="Buscar clínica"');
    expect(saida).toContain('aria-label="Situação da conta"');
    expect(saida).toContain('aria-label="Agente de IA"');
    expect(saida).toContain("min-h-10");
  });
});

describe("totais e erro", () => {
  it("os sete totais do topo (a produção chega na onda 2)", () => {
    const saida = html(
      <TotaisDoPainel
        totais={{
          clinicas: 12,
          ativas: 10,
          suspensas: 2,
          agenteEmTeste: 3,
          agenteEmProducao: 1,
          gasto24hCentavos: 1234,
          gastoMesCentavos: 98765,
        }}
      />,
    );
    for (const rotulo of [
      "Clínicas",
      "Ativas",
      "Suspensas",
      "Agente em teste",
      "Agente em produção",
      "Gasto de IA em 24 horas",
      "Gasto de IA no mês",
    ]) {
      expect(saida).toContain(escapado(rotulo));
    }
    expect(saida).toContain("US$ 12,34");
    expect(saida).toContain("US$ 987,65");
    expect(saida).toContain("lucide-octagon-pause");
    expect(saida).toContain("lucide-radio-tower");
  });

  it("erro de leitura: o texto e o Tentar de novo, nunca zero", () => {
    const saida = html(<ErroDoPainel />);
    expect(saida).toContain(TEXTOS_DO_PAINEL.erroAoCarregar);
    expect(saida).toContain("Tentar de novo");
    expect(saida).toContain("lucide-octagon-alert");
  });
});

describe("conta da clínica", () => {
  it("ativa: o chip e o Suspender conta (destrutivo)", () => {
    const saida = html(
      <ContaDaClinica
        clinicId={ID_A}
        nome="Clínica Aurora"
        fuso="America/Fortaleza"
        suspensao={null}
      />,
    );
    expect(chip(saida, "Ativa")).toContain("lucide-circle-check");
    expect(saida).toContain("Suspender conta");
    expect(saida).toContain('data-variant="destructive"');
    expect(saida).not.toContain("Reativar conta");
  });

  it("suspensa: desde quando (no fuso da clínica), o motivo e o Reativar conta", () => {
    const saida = html(
      <ContaDaClinica
        clinicId={ID_B}
        nome="Odonto Árvore"
        fuso="America/Fortaleza"
        suspensao={{
          suspensaEm: "2026-10-18T10:00:00.000Z",
          motivo: "Pagamento atrasado",
        }}
      />,
    );
    expect(chip(saida, "Suspensa")).toContain("lucide-octagon-pause");
    expect(saida).toContain("Suspensa desde 18/10/2026, 07:00");
    expect(saida).toContain("Motivo: Pagamento atrasado");
    expect(saida).toContain("Reativar conta");
    expect(saida).not.toContain("Suspender conta");
  });

  it("o aviso da reativação conta as mensagens vencidas", () => {
    expect(textoDaReativacao("Aurora", undefined)).toBe(
      "Conta da Aurora reativada.",
    );
    expect(textoDaReativacao("Aurora", 0)).toBe("Conta da Aurora reativada.");
    expect(textoDaReativacao("Aurora", 1)).toBe(
      "Conta da Aurora reativada. 1 mensagem automática vencida foi cancelada.",
    );
    expect(textoDaReativacao("Aurora", 1200)).toBe(
      "Conta da Aurora reativada. 1.200 mensagens automáticas vencidas foram canceladas.",
    );
  });
});

function dadosDaIa(campos: Partial<DadosDaIa> = {}): DadosDaIa {
  return {
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
    ...campos,
  };
}

function numeroDoPainel(
  campos: Partial<NumeroDoWhatsapp> = {},
): NumeroDoWhatsapp {
  return {
    id: NUMERO,
    nome: "Recepção",
    principal: false,
    unitId: null,
    displayPhone: null,
    status: "conectado",
    connectedAt: null,
    provider: null,
    cor: "azul",
    ...campos,
  };
}

function contexto(campos: Partial<ContextoDaIa> = {}): ContextoDaIa {
  return {
    dados: dadosDaIa(),
    numeros: [numeroDoPainel()],
    ambienteLigado: true,
    agoraMs: Date.parse(AGORA),
    fuso: "America/Fortaleza",
    ...campos,
  };
}

describe("agente da clínica", () => {
  it("Desligado, Teste e Produção: a Produção visível, desabilitada e com os pré-requisitos", () => {
    const saida = html(
      <AgenteDaClinica
        clinicId={ID_A}
        nome="Clínica Aurora"
        estado="desligado"
        suspensa={false}
        tetoDiarioCentavos={500}
        contexto={null}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
      />,
    );
    expect(saida).toContain('aria-label="Agente de IA desta clínica"');
    // A descricao do cartao tambem fala da Producao: o botao e o do
    // segmentado.
    const producao = saida.slice(
      saida.lastIndexOf("<button", saida.indexOf(">Produção<")),
      saida.indexOf(">Produção<"),
    );
    expect(producao).toContain('disabled=""');
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.dicaDaProducao));
    expect(chip(saida, "Desligado")).toContain("lucide-circle-pause");
    // Desligado nao mostra a situacao na clinica.
    expect(saida).not.toContain("Na clínica agora");
  });

  it("em teste: a situação na clínica pela mesma regra da aba de Configurações", () => {
    const verde = html(
      <AgenteDaClinica
        clinicId={ID_C}
        nome="Estética Bela"
        estado="teste"
        suspensa={false}
        tetoDiarioCentavos={500}
        contexto={contexto()}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
      />,
    );
    expect(verde).toContain("Na clínica agora");
    expect(chip(verde, "Conversando com a equipe")).toContain(
      "lucide-circle-check",
    );

    const parado = html(
      <AgenteDaClinica
        clinicId={ID_C}
        nome="Estética Bela"
        estado="teste"
        suspensa={false}
        tetoDiarioCentavos={500}
        contexto={contexto({
          dados: dadosDaIa({ interruptorLigado: false }),
        })}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
      />,
    );
    expect(chip(parado, "Ligado, mas parado")).toContain("lucide-hourglass");
    // Para a equipe Conduzza, o motivo diz o que conferir e onde fica o
    // interruptor (onda 2, P8: no topo do Painel geral).
    expect(parado).toContain(
      escapado(
        "O interruptor geral está desligado. Ele fica no topo do Painel geral.",
      ),
    );
    expect(parado).not.toContain("Configurações");
  });

  it("leitura que falhou: não deu para conferir, nunca o verde", () => {
    const saida = html(
      <AgenteDaClinica
        clinicId={ID_C}
        nome="Estética Bela"
        estado="teste"
        suspensa={false}
        tetoDiarioCentavos={500}
        contexto={null}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
      />,
    );
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteSemLeitura));
    expect(saida).not.toContain("Conversando com a equipe");
  });

  it("conta suspensa com o agente desligado: Teste visível e desabilitado, com o porquê", () => {
    const saida = html(
      <AgenteDaClinica
        clinicId={ID_B}
        nome="Odonto Árvore"
        estado="desligado"
        suspensa
        tetoDiarioCentavos={null}
        contexto={null}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
      />,
    );
    const teste = saida.slice(
      saida.lastIndexOf("<button", saida.indexOf(">Teste<")),
      saida.indexOf(">Teste<"),
    );
    expect(teste).toContain('disabled=""');
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente));
  });

  it("conta suspensa: avisa que o agente não atende, mesmo em teste", () => {
    const saida = html(
      <AgenteDaClinica
        clinicId={ID_B}
        nome="Odonto Árvore"
        estado="teste"
        suspensa
        tetoDiarioCentavos={null}
        contexto={contexto()}
        requisitos={{ estado: "indisponivel" }}
        publicoPublicado={null}
      />,
    );
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteComContaSuspensa));
    // A lista de motivos culparia outra trava: com a conta suspensa, so o
    // aviso.
    expect(saida).not.toContain("Na clínica agora");
  });

  it("o aviso do fim da mudança", () => {
    expect(textoDoAgenteMudou("Aurora", "teste")).toBe(
      "Agente da Aurora ligado em teste.",
    );
    expect(textoDoAgenteMudou("Aurora", "desligado")).toBe(
      "Agente da Aurora desligado.",
    );
    expect(textoDoAgenteMudou("Aurora", "producao")).toBe(
      "Agente da Aurora em produção.",
    );
  });
});

describe("teto, gasto e equipe", () => {
  it("teto: os valores atuais nos campos, com rótulo", () => {
    const saida = html(
      <TetoDaIa
        clinicId={ID_A}
        tetos={{ tetoDiarioCentavos: 750, tetoRespostasPorConversaHora: 30 }}
      />,
    );
    expect(saida).toContain('value="7,50"');
    expect(saida).toContain('value="30"');
    expect(saida).toContain("Teto a cada 24 horas (US$)");
    expect(saida).toContain("Respostas por conversa em 1 hora");
    expect(saida).toContain("Salvar teto");
  });

  it("sem a linha de liberação: campos e botão visíveis, desabilitados, com a dica", () => {
    const saida = html(<TetoDaIa clinicId={ID_A} tetos={null} />);
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.tetoSemLinha));
    expect(saida.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    expect(saida).toContain("cursor-not-allowed");
  });

  it("teto travado pela conta suspensa: o porquê escrito e na dica, campos desabilitados", () => {
    const saida = html(
      <TetoDaIa
        clinicId={ID_B}
        tetos={{ tetoDiarioCentavos: 500, tetoRespostasPorConversaHora: 20 }}
        bloqueio={TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto}
      />,
    );
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto));
    expect(saida).toContain('value="5,00"');
    expect(saida.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    expect(saida).toContain("cursor-not-allowed");
  });

  it("gasto: a legenda contra o teto, o mês, sem o simulador e o chip só quando pede atenção", () => {
    const dentro = html(
      <GastoDaIa gasto={LISTA[0]!.gasto} tetoDiarioCentavos={500} />,
    );
    expect(dentro).toContain("US$ 0,42 de US$ 5,00");
    expect(dentro).toContain("US$ 3,10");
    expect(dentro).toContain("US$ 2,00");
    expect(dentro).toContain('role="img"');
    expect(dentro).not.toContain("Perto do teto");
    expect(dentro).not.toContain("Teto atingido");

    const atingido = html(
      <GastoDaIa gasto={LISTA[1]!.gasto} tetoDiarioCentavos={500} />,
    );
    expect(chip(atingido, "Teto atingido")).toContain("lucide-hourglass");

    const semTeto = html(
      <GastoDaIa gasto={LISTA[0]!.gasto} tetoDiarioCentavos={null} />,
    );
    expect(semTeto).toContain("US$ 0,42, sem teto");
  });

  it("equipe: os administradores ativos e os pedidos de entrada", () => {
    const saida = html(
      <EquipeDaClinica
        membrosAtivos={4}
        membrosPendentes={2}
        administradores={[
          { nome: "Ana Souza", email: "ana@aurora.com.br" },
          { nome: null, email: "sem.nome@aurora.com.br" },
        ]}
      />,
    );
    expect(saida).toContain("Ana Souza");
    expect(saida).toContain('href="mailto:ana@aurora.com.br"');
    expect(saida).toContain("Sem nome no perfil");
    expect(saida).toContain(
      escapado("4 membros ativos e 2 pedidos de entrada esperando liberação."),
    );
    const vazia = html(
      <EquipeDaClinica
        membrosAtivos={0}
        membrosPendentes={0}
        administradores={[]}
      />,
    );
    expect(vazia).toContain("Nenhum administrador ativo.");
    expect(textoDaEquipe(1, 0)).toBe("1 membro ativo.");
    expect(textoDaEquipe(1, 1)).toBe(
      "1 membro ativo e 1 pedido de entrada esperando liberação.",
    );
  });
});

describe("números e telefones do agente no modo do painel", () => {
  function cartoes(
    campos: Partial<React.ComponentProps<typeof CartoesDoAgenteNoPainel>> = {},
  ) {
    return html(
      <CartoesDoAgenteNoPainel
        clinicId={ID_C}
        dados={dadosDaIa()}
        numeros={[numeroDoPainel()]}
        finais={{ [NUMERO]: "0000" }}
        agenteHabilitado
        suspensa={false}
        ambienteLigado
        agoraMs={Date.parse(AGORA)}
        fuso="America/Fortaleza"
        telefonesForcados={[]}
        {...campos}
      />,
    );
  }

  it("o número com os 4 últimos dígitos, nunca o telefone inteiro", () => {
    const saida = cartoes();
    expect(saida).toContain("Recepção");
    expect(saida).toContain("final 0000");
    expect(chip(saida, "Em uso pelo assistente")).toContain(
      "lucide-circle-check",
    );
  });

  it("sem número: o vazio diz quem conecta, sem levar à aba WhatsApp de quem vê", () => {
    const saida = cartoes({ numeros: [], finais: {} });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.semNumerosNoPainel));
    expect(saida).not.toContain("/configuracoes?aba=whatsapp");
  });

  it("telefone novo: a confirmação de que é da equipe já aparece, junto do aviso da OpenAI", () => {
    const saida = cartoes();
    expect(saida).toContain(
      escapado("Confirmo que este telefone é de alguém da equipe"),
    );
    expect(saida).toContain("OpenAI");
    // A equipe Conduzza adiciona: o botao fica habilitado.
    const adicionar = saida.slice(
      saida.lastIndexOf("<button", saida.indexOf(">Adicionar<")),
      saida.indexOf(">Adicionar<"),
    );
    expect(adicionar).not.toContain('disabled=""');
  });

  it("conversa aberta: o texto do painel, sem link para o Atendimento de quem vê", () => {
    const saida = cartoes({
      dados: dadosDaIa({
        situacao: {
          ...dadosDaIa().situacao,
          conversasAbertas: [
            { telefoneId: "t1", numeroId: NUMERO, conversaId: CONVERSA },
          ],
        },
      }),
    });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.conversaAbertaNoPainel));
    expect(saida).not.toContain("/atendimento?conversa=");
  });

  it("conta suspensa com o agente em teste: tudo desabilitado, com o porquê escrito", () => {
    const saida = cartoes({ suspensa: true });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.suspensaNaoMudaNumeros));
    const adicionar = saida.slice(
      saida.lastIndexOf("<button", saida.indexOf(">Adicionar<")),
      saida.indexOf(">Adicionar<"),
    );
    expect(adicionar).toContain('disabled=""');
  });

  it("agente desligado na clínica: tudo visível e desabilitado, com a dica", () => {
    const saida = cartoes({ agenteHabilitado: false });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.ligueOAgenteAntes));
    const adicionar = saida.slice(
      saida.lastIndexOf("<button", saida.indexOf(">Adicionar<")),
      saida.indexOf(">Adicionar<"),
    );
    expect(adicionar).toContain('disabled=""');
    const desligar = saida.slice(
      saida.lastIndexOf("<button", saida.indexOf(">Desligar<")),
      saida.indexOf(">Desligar<"),
    );
    expect(desligar).toContain('disabled=""');
    expect(saida).toContain("cursor-not-allowed");
  });
});

describe("nenhum travessão nas telas", () => {
  it("lista, totais, erro e detalhe", () => {
    const telas = [
      html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />),
      html(<ListaDoPainel clinicas={[]} agoraIso={AGORA} />),
      html(<ErroDoPainel />),
      html(
        <ContaDaClinica
          clinicId={ID_B}
          nome="Odonto Árvore"
          fuso="America/Fortaleza"
          suspensao={{
            suspensaEm: "2026-10-18T10:00:00.000Z",
            motivo: "Pagamento atrasado",
          }}
        />,
      ),
      html(
        <AgenteDaClinica
          clinicId={ID_C}
          nome="Estética Bela"
          estado="teste"
          suspensa
          tetoDiarioCentavos={500}
          contexto={contexto()}
          requisitos={{ estado: "indisponivel" }}
          publicoPublicado={null}
        />,
      ),
      html(<TetoDaIa clinicId={ID_A} tetos={null} />),
      html(<GastoDaIa gasto={LISTA[1]!.gasto} tetoDiarioCentavos={500} />),
    ];
    for (const tela of telas) {
      expect(tela).not.toMatch(/[—–]/);
    }
  });
});

describe("interruptor geral no topo do painel (onda 2, P8)", () => {
  it("ligado: o chip e o Desligar; desligado: o Ligar (com confirmação)", () => {
    const ligado = html(<InterruptorGeral ligado />);
    expect(ligado).toContain("Interruptor geral");
    expect(chip(ligado, "Ligado")).toContain("lucide-circle-check");
    expect(ligado).toContain("Desligar o interruptor geral</button>");
    const desligado = html(<InterruptorGeral ligado={false} />);
    expect(chip(desligado, "Desligado")).toContain("lucide-circle-pause");
    expect(desligado).toContain("Ligar o interruptor geral</button>");
    // o dialogo so abre no clique
    expect(desligado).not.toContain(TEXTOS_DO_PAINEL.interruptorLigarTitulo);
    expect(desligado).toContain(escapado(TEXTOS_DO_PAINEL.interruptorEfeito));
  });

  it("leitura que falhou: o aviso, sem estado inventado nem botão", () => {
    const saida = html(<InterruptorGeral ligado={null} />);
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.interruptorSemLeitura));
    expect(saida).not.toContain("o interruptor geral</button>");
    expect(saida).not.toMatch(/[—–]/);
  });
});

describe("agente em produção no painel (onda 2, item 11)", () => {
  it("a lista mostra Produção em 3 camadas, com o apoio Atendendo os contatos", () => {
    const saida = html(
      <ListaDoPainel
        clinicas={[
          clinica({
            agente: {
              estado: "producao",
              modo: "numero_inteiro",
              liberada: true,
              pausadaPelaClinica: false,
              telefonesLigados: 1,
            },
          }),
        ]}
        agoraIso={AGORA}
      />,
    );
    expect(chip(saida, "Produção")).toContain("lucide-radio-tower");
    expect(saida).toContain("Atendendo os contatos");
    expect(saida).toContain(">Agente em produção<");
  });

  it("o diálogo da produção pede o motivo e diz a quem o assistente passa a responder", () => {
    // O dialogo so abre no clique; aqui, os textos que ele usa.
    expect(
      TEXTOS_DO_PAINEL.efeitoDaProducao("aos leads e aos pacientes"),
    ).toContain("aos leads e aos pacientes que escreverem");
    expect(TEXTOS_DO_PAINEL.regraDoMotivoDaProducao).toContain(
      "Obrigatório, de 3 a 300 caracteres",
    );
  });
});
