import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// As telas do Painel geral renderizadas no servidor. Desde 26/10/2026, o
// acompanhamento de cliente: os seis cartoes do topo (Clinicas, Em uso, Sem
// uso, Suspensas, Agente de IA liberado e Gasto de IA no mes); a lista pelo
// ultimo acesso (quando, ha quanto tempo e quem, no fuso da clinica; o "Sem
// uso" em 3 camadas), a equipe, o WhatsApp, o agente com "Liberar agente" e
// "Retirar agente" na propria linha, os ultimos 30 dias e a conta; os
// filtros de uso, conta e agente; os vazios (inicial e por filtro) e o
// erro; e, no detalhe, a equipe com os Implementadores numa lista separada.
// Ficam a conta com suspender e reativar, o agente com a Producao travada e
// a dica, o teto, o gasto e os cartoes de numeros e telefones no modo do
// painel. Sem travessao em estado nenhum, e de paciente so contagens.

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

import type { ContextoDaIa } from "@/components/agente/whatsapp/agente-de-ia";
import {
  AgenteDaClinica,
  textoDoAgenteMudou,
} from "@/components/painel-geral/agente-da-clinica";
import {
  AgenteNaLista,
  textoDaMudancaNaLista,
} from "@/components/painel-geral/agente-na-lista";
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
import { FaixaDeSaude } from "@/components/painel-geral/faixa-de-saude";
import { InterruptorGeral } from "@/components/painel-geral/interruptor-geral";
import { GastoDaIa } from "@/components/painel-geral/gasto-da-ia";
import { ListaDoPainel } from "@/components/painel-geral/lista-do-painel";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { TetoDaIa } from "@/components/painel-geral/teto-da-ia";
import { TotaisDoPainel } from "@/components/painel-geral/totais-do-painel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";
import type {
  ClinicaNoPainel,
  EquipeNoPainel,
  PessoaDaEquipe,
} from "@/lib/queries/painel-geral";

const ID_A = "a1111111-1111-4111-8111-111111111111";
const ID_B = "b2222222-2222-4222-8222-222222222222";
const ID_C = "c3333333-3333-4333-8333-333333333333";
const NUMERO = "d4444444-4444-4444-8444-444444444444";
const CONVERSA = "e5555555-5555-4555-8555-555555555555";
const PESSOA = "f6666666-6666-4666-8666-666666666666";
const AGORA = "2026-10-20T15:00:00.000Z"; // 12:00 em Fortaleza

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID_A,
    nome: "Clínica Aurora",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: "America/Fortaleza",
    emUso: true,
    ultimoAcesso: {
      em: "2026-10-20T13:05:00.000Z",
      userId: PESSOA,
      nome: "Ana Souza",
      email: "ana@aurora.com.br",
      papel: "admin",
      implementador: false,
      equipeConduzza: false,
    },
    membrosAtivos: 3,
    membrosPendentes: 0,
    membrosEquipeConduzza: 0,
    pessoas: [{ nome: "Ana Souza", email: "ana@aurora.com.br" }],
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
    gasto: gasto(42, 310, 30, 200),
    tetoDiarioCentavos: 500,
    saude: "saudavel",
    sinais: [],
    implantacao: implantacao([true, true, true, false, false, false]),
    tendencia: {
      leads: {
        atual: 14,
        anterior: 10,
        variacaoPercentual: 40,
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

/**
 * O gasto em centavos e os mesmos valores exatos em microdolares (10.000
 * por centavo), com chamadas.
 */
function gasto(
  ultimas24h: number,
  mes: number,
  ultimas24hSemSimulador: number,
  mesSemSimulador: number,
): ClinicaNoPainel["gasto"] {
  return {
    ultimas24hCentavos: ultimas24h,
    mesCentavos: mes,
    ultimas24hSemSimuladorCentavos: ultimas24hSemSimulador,
    mesSemSimuladorCentavos: mesSemSimulador,
    ultimas24hMicrodolares: ultimas24h * 10_000,
    mesMicrodolares: mes * 10_000,
    ultimas24hSemSimuladorMicrodolares: ultimas24hSemSimulador * 10_000,
    mesSemSimuladorMicrodolares: mesSemSimulador * 10_000,
    ultimas24hChamadas: ultimas24h > 0 ? 3 : 0,
    mesChamadas: mes > 0 ? 25 : 0,
    ultimas24hSemSimuladorChamadas: ultimas24hSemSimulador > 0 ? 2 : 0,
    mesSemSimuladorChamadas: mesSemSimulador > 0 ? 15 : 0,
  };
}

const CHAVES_DOS_PASSOS = [
  "whatsapp_conectado",
  "equipe_com_duas_pessoas",
  "procedimentos_cadastrados",
  "profissionais_cadastrados",
  "regua_de_confirmacao_ligada",
  "anuncios_conectados",
] as const;

/** Os seis passos do banco: os feitos nas posicoes pedidas. */
function implantacao(
  feitos: readonly boolean[],
): ClinicaNoPainel["implantacao"] {
  const passos = CHAVES_DOS_PASSOS.map((chave, indice) => ({
    chave,
    feito: feitos[indice] ?? false,
    quantidade: feitos[indice] ? 1 : 0,
  }));
  return {
    feitos: passos.filter((passo) => passo.feito).length,
    total: passos.length,
    passos,
    anuncios: { meta: false, google: false },
  };
}

/** O gasto das ultimas 24 horas no proprio teto (US$ 5,00 de US$ 5,00). */
const GASTO_NO_TETO: ClinicaNoPainel["gasto"] = gasto(500, 900, 500, 900);

// A ordem do banco (e da tela): o ultimo acesso mais recente primeiro,
// quem nunca entrou no fim. Aqui fora de ordem, de proposito.
const LISTA: ClinicaNoPainel[] = [
  clinica({
    id: ID_B,
    nome: "Odonto Árvore",
    emUso: false,
    ultimoAcesso: null,
    membrosAtivos: 1,
    membrosPendentes: 2,
    pessoas: [{ nome: "João Prado", email: "joao@arvore.com" }],
    suspensao: {
      suspensaEm: "2026-10-18T10:00:00.000Z",
      motivo: "Pagamento atrasado",
    },
    numerosConectados: 0,
    ultimaMensagemEm: null,
    gasto: GASTO_NO_TETO,
    saude: "em_risco",
    sinais: [
      {
        chave: "conta_suspensa",
        nivel: "em_risco",
        quantidade: null,
        desde: "2026-10-18T10:00:00.000Z",
      },
      { chave: "sem_uso", nivel: "em_risco", quantidade: null, desde: null },
      {
        chave: "whatsapp_desconectado",
        nivel: "em_risco",
        quantidade: 2,
        desde: null,
      },
      {
        chave: "perto_do_teto_da_ia",
        nivel: "atencao",
        quantidade: 100,
        desde: null,
      },
    ],
    implantacao: implantacao([false, false, false, false, false, false]),
    ultimaNotaEm: "2026-10-22T12:00:00.000Z",
  }),
  clinica(),
  clinica({
    id: ID_C,
    nome: "Estética Bela",
    emUso: false,
    ultimoAcesso: {
      em: "2026-09-01T12:00:00.000Z",
      userId: PESSOA,
      nome: null,
      email: "recepcao@bela.com.br",
      papel: "recepcao",
      implementador: false,
      equipeConduzza: false,
    },
    membrosAtivos: 1,
    numerosTotal: 0,
    numerosConectados: 0,
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausadaPelaClinica: false,
      telefonesLigados: 2,
    },
    gasto: gasto(410, 1000, 100, 200),
    tetoDiarioCentavos: 500,
    saude: "em_risco",
    sinais: [
      {
        chave: "sem_uso",
        nivel: "em_risco",
        quantidade: null,
        desde: "2026-09-01T12:00:00.000Z",
      },
      {
        chave: "sem_numero_de_whatsapp",
        nivel: "atencao",
        quantidade: null,
        desde: null,
      },
      {
        chave: "perto_do_teto_da_ia",
        nivel: "atencao",
        quantidade: 82,
        desde: null,
      },
    ],
    tendencia: {
      leads: {
        atual: 14,
        anterior: 20,
        variacaoPercentual: -30,
        direcao: "caindo",
      },
      conversas: {
        atual: 1234,
        anterior: 1200,
        variacaoPercentual: 3,
        direcao: "estavel",
      },
    },
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

/** A tag de abertura do botao com aquele nome acessivel (aria-label). */
function botaoPeloNome(saida: string, nome: string): string {
  const indice = saida.indexOf(`aria-label="${escapado(nome)}"`);
  expect(indice, `botão "${nome}"`).toBeGreaterThan(-1);
  const abertura = saida.lastIndexOf("<button", indice);
  return saida.slice(abertura, saida.indexOf(">", abertura) + 1);
}

/** A linha da tabela da clinica, pelo link do detalhe. */
function linhaDa(saida: string, id: string): string {
  const link = saida.indexOf(`href="/painel-geral/${id}"`);
  expect(link, id).toBeGreaterThan(-1);
  const inicio = saida.lastIndexOf("<tr", link);
  return saida.slice(inicio, saida.indexOf("</tr>", link) + 5);
}

beforeEach(() => {
  navegacao.busca = "";
});

describe("lista do painel", () => {
  it("uma linha por clínica, pelo último acesso mais recente (quem nunca entrou no fim), com o link para o detalhe", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const ordem = ["Clínica Aurora", "Estética Bela", "Odonto Árvore"].map(
      (nome) => saida.indexOf(escapado(nome)),
    );
    expect(ordem.every((indice) => indice > -1)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    for (const id of [ID_A, ID_B, ID_C]) {
      expect(saida).toContain(`href="/painel-geral/${id}"`);
    }
    expect(saida).toContain("3 clínicas");
    expect(saida).toContain("Criada em 01/09/2026");
  });

  it("as colunas do desenho, nesta ordem; as que ordenam com o botão no cabeçalho e o aria-sort", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const cabecalho = saida.slice(
      saida.indexOf("<thead"),
      saida.indexOf("</thead>"),
    );
    const colunas = [
      "Clínica",
      "Saúde",
      "Último acesso",
      "Equipe",
      "WhatsApp",
      "Agente de IA",
      "IA no mês",
      "Leads em 30 dias",
      "Conversas em 30 dias",
      "Implantação",
      "Conta",
    ].map((coluna) => cabecalho.indexOf(`>${escapado(coluna)}<`));
    expect(colunas.every((indice) => indice > -1)).toBe(true);
    expect([...colunas].sort((a, b) => a - b)).toEqual(colunas);
    // Seis ordenam (botao de 40px); sem clique, o ultimo acesso mais recente
    // primeiro.
    expect(cabecalho.match(/aria-sort=/g)).toHaveLength(6);
    expect(cabecalho.match(/<button/g)).toHaveLength(6);
    expect(cabecalho).toContain('aria-sort="descending"');
    expect(cabecalho.match(/aria-sort="none"/g)).toHaveLength(5);
    const ultimoAcesso = cabecalho.slice(
      cabecalho.lastIndexOf("<th", cabecalho.indexOf(">Último acesso<")),
      cabecalho.indexOf(">Último acesso<"),
    );
    expect(ultimoAcesso).toContain('aria-sort="descending"');
    expect(cabecalho).toContain("min-h-10");
  });

  it("último acesso: há quanto tempo, o dia e a hora no fuso da clínica e quem; Sem uso em 3 camadas; quem nunca entrou", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const aurora = linhaDa(saida, ID_A);
    expect(aurora).toContain(">Hoje<");
    // 13:05 UTC = 10:05 em Fortaleza
    expect(aurora).toContain("20/10/2026, 10:05");
    expect(aurora).toContain("por Ana Souza");
    expect(aurora).not.toContain("Sem uso");

    const bela = linhaDa(saida, ID_C);
    expect(bela).toContain(">Há 1 mês<");
    expect(bela).toContain("01/09/2026, 09:00");
    // sem nome no perfil: o e-mail
    expect(bela).toContain("por recepcao@bela.com.br");
    expect(chip(bela, "Sem uso")).toContain("lucide-watch");
    expect(chip(bela, "Sem uso")).toContain("var(--warning-text)");

    const arvore = linhaDa(saida, ID_B);
    expect(arvore).toContain(escapado(TEXTOS_DO_PAINEL.ninguemEntrou));
    expect(chip(arvore, "Sem uso")).toContain("lucide-watch");
  });

  it("o último acesso da equipe Conduzza conta e vem marcado na linha, e a coluna Equipe diz quantas das ativas são dela", () => {
    const saida = html(
      <ListaDoPainel
        clinicas={[
          clinica({
            ultimoAcesso: {
              em: "2026-10-20T13:05:00.000Z",
              userId: PESSOA,
              nome: "Vinicius Rodrigues",
              email: "vinicius@conduzza.com",
              papel: "admin",
              implementador: false,
              equipeConduzza: true,
            },
            membrosAtivos: 1,
            membrosEquipeConduzza: 1,
          }),
        ]}
        agoraIso={AGORA}
      />,
    );
    const linha = linhaDa(saida, ID_A);
    expect(linha).toContain("por Vinicius Rodrigues (equipe Conduzza)");
    expect(linha).toContain(">Inclui 1 da equipe Conduzza<");
    expect(linha).not.toContain("Sem uso");
    // Sem ninguem da equipe Conduzza, nenhuma das duas marcas.
    const aurora = linhaDa(
      html(<ListaDoPainel clinicas={[clinica()]} agoraIso={AGORA} />),
      ID_A,
    );
    expect(aurora).not.toContain("equipe Conduzza");
  });

  it("a borda dos 30 dias: a clínica em uso com o login de 30 dias de calendário mostra \"Há 30 dias\", nunca \"Há 1 mês\" (revisão de 26/10/2026)", () => {
    // Login em 25/09 as 23:30 em Fortaleza, leitura em 25/10 as 08:00:
    // 704,5 horas, em uso para o banco.
    const saida = html(
      <ListaDoPainel
        clinicas={[
          clinica({
            emUso: true,
            ultimoAcesso: {
              ...clinica().ultimoAcesso!,
              em: "2026-09-26T02:30:00.000Z",
            },
          }),
        ]}
        agoraIso="2026-10-25T11:00:00.000Z"
      />,
    );
    const linha = linhaDa(saida, ID_A);
    expect(linha).toContain(">Há 30 dias<");
    expect(linha).not.toContain("Há 1 mês");
    expect(linha).not.toContain("Sem uso");
    expect(linha).toContain("25/09/2026, 23:30");
  });

  it("equipe, WhatsApp, últimos 30 dias e conta em 3 camadas", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const aurora = linhaDa(saida, ID_A);
    // O numero em mono e a palavra no texto, como os leads e as conversas.
    expect(aurora).toContain(
      '<span class="cz-num">3</span> <span class="text-text-secondary">ativas</span>',
    );
    expect(aurora).toContain(">Nenhuma pendente<");
    expect(aurora).toContain(">1 de 2</span>");
    expect(aurora).toContain("conectados");
    expect(aurora).toContain("1.234");
    expect(chip(aurora, "Ativa")).toContain("lucide-circle-check");
    expect(chip(aurora, "Ativa")).toContain("var(--success-text)");

    const arvore = linhaDa(saida, ID_B);
    expect(arvore).toContain(
      '<span class="cz-num">1</span> <span class="text-text-secondary">ativa</span>',
    );
    expect(arvore).toContain(
      '<span class="cz-num">2</span> <span class="text-text-secondary">pendentes</span>',
    );
    expect(chip(arvore, "Nenhum conectado")).toContain("lucide-wifi-off");
    expect(chip(arvore, "Suspensa")).toContain("lucide-octagon-pause");
    expect(chip(arvore, "Suspensa")).toContain("var(--alert-text)");
    expect(arvore).toContain("Desde 18/10/2026");

    expect(linhaDa(saida, ID_C)).toContain("Nenhum número");
  });

  it("agente em 3 camadas com a ação na linha: Liberar (Teste) e Retirar; com a conta suspensa, Liberar visível, desabilitado e com a dica", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const aurora = linhaDa(saida, ID_A);
    expect(chip(aurora, "Não liberado")).toContain("lucide-circle-pause");
    expect(chip(aurora, "Não liberado")).toContain("var(--neutral-text)");
    const liberar = botaoPeloNome(aurora, "Liberar agente na Clínica Aurora");
    expect(liberar).not.toContain('disabled=""');
    expect(aurora).toContain(">Liberar agente</button>");
    expect(aurora).not.toContain("Retirar agente");

    const bela = linhaDa(saida, ID_C);
    expect(chip(bela, "Liberado (Teste)")).toContain("lucide-flask-conical");
    expect(chip(bela, "Liberado (Teste)")).toContain("var(--info-text)");
    expect(
      botaoPeloNome(bela, "Retirar agente da Estética Bela"),
    ).not.toContain('disabled=""');
    expect(bela).not.toContain(">Liberar agente</button>");

    // O banco recusa ligar em Teste a clinica suspensa: o botao fica, e a
    // dica diz o porque.
    const arvore = linhaDa(saida, ID_B);
    expect(botaoPeloNome(arvore, "Liberar agente na Odonto Árvore")).toContain(
      'disabled=""',
    );
    expect(arvore).toContain("cursor-not-allowed");
    // Nenhum dialogo aberto sem clique.
    expect(saida).not.toContain("Liberar o agente de IA na");
  });

  it("vazio inicial: nenhuma clínica, sem tabela", () => {
    const saida = html(<ListaDoPainel clinicas={[]} agoraIso={AGORA} />);
    expect(saida).toContain(TEXTOS_DO_PAINEL.vazio);
    expect(saida).not.toContain("<table");
  });

  it("filtros da URL: uso, conta e agente; a busca olha a equipe; sem resultado, o vazio próprio e o limpar", () => {
    const comFiltro = (busca: string) => {
      navegacao.busca = busca;
      return html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    };

    const semUso = comFiltro("uso=sem_uso");
    expect(semUso).toContain(escapado("Odonto Árvore"));
    expect(semUso).toContain(escapado("Estética Bela"));
    expect(semUso).not.toContain(escapado("Clínica Aurora"));
    expect(semUso).toContain("2 clínicas");
    expect(semUso).toContain("Limpar filtros");

    const suspensas = comFiltro("conta=suspensa");
    expect(suspensas).toContain(escapado("Odonto Árvore"));
    expect(suspensas).not.toContain(escapado("Clínica Aurora"));
    expect(suspensas).toContain("1 clínica");
    expect(suspensas).toContain('aria-pressed="true"');

    const liberadas = comFiltro("agente=liberado");
    expect(liberadas).toContain(escapado("Estética Bela"));
    expect(liberadas).not.toContain(escapado("Odonto Árvore"));

    const pelaEquipe = comFiltro("busca=joao%40arvore");
    expect(pelaEquipe).toContain(escapado("Odonto Árvore"));
    expect(pelaEquipe).toContain("1 clínica");

    const nada = comFiltro("busca=zzz");
    expect(nada).toContain(TEXTOS_DO_PAINEL.vazioPorFiltro);
    expect(nada).toContain("Limpar filtros");
    expect(nada).not.toContain("<table");
  });

  it("os filtros têm nome acessível, o nome visível e alvo de 40px", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(saida).toContain('aria-label="Buscar clínica"');
    expect(saida).toContain(
      `placeholder="${escapado(TEXTOS_DO_PAINEL.buscaPlaceholder)}"`,
    );
    expect(saida).toContain('aria-label="Uso"');
    expect(saida).toContain('aria-label="Conta"');
    expect(saida).toContain('aria-label="Agente de IA"');
    for (const opcao of ["Em uso", "Sem uso", "Ativas", "Suspensas"]) {
      expect(saida).toContain(`>${opcao}</button>`);
    }
    expect(saida).toContain(`>${escapado("Não liberado")}</button>`);
    expect(saida).toContain("min-h-10");
    expect(saida).toContain("hit-40");
  });
});

describe("totais e erro", () => {
  it("os seis cartões do topo do desenho de 26/10/2026", () => {
    const saida = html(
      <TotaisDoPainel
        totais={{
          clinicas: 12,
          emUso: 8,
          semUso: 4,
          suspensas: 2,
          agenteLiberado: 3,
          gastoMesCentavos: 98765,
          gastoMesMicrodolares: 987_654_321,
          chamadasMes: 4321,
          saude: { saudavel: 8, atencao: 2, em_risco: 2 },
        }}
      />,
    );
    const rotulos = [
      "Clínicas",
      "Em uso",
      "Sem uso",
      "Suspensas",
      "Agente de IA liberado",
      "Gasto de IA no mês",
    ];
    const posicoes = rotulos.map((rotulo) => saida.indexOf(escapado(rotulo)));
    expect(posicoes.every((indice) => indice > -1)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(saida.match(/role="group"/g)).toHaveLength(6);
    for (const valor of [">12<", ">8<", ">4<", ">2<", ">3<"]) {
      expect(saida).toContain(valor);
    }
    expect(saida).toContain("US$ 987,65");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.rodapeDoEmUso));
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.rodapeDoSemUso));
    // Os cartoes que sao status levam o icone do chip.
    expect(saida).toContain("lucide-circle-check");
    expect(saida).toContain("lucide-watch");
    expect(saida).toContain("lucide-octagon-pause");
    // Os que sairam do topo.
    for (const saiu of [
      ">Ativas<",
      "Agente em teste",
      "Agente em produção",
      "Gasto de IA em 24 horas",
    ]) {
      expect(saida).not.toContain(saiu);
    }
  });

  it("erro de leitura: o texto e o Tentar de novo, nunca zero", () => {
    const saida = html(<ErroDoPainel />);
    expect(saida).toContain(TEXTOS_DO_PAINEL.erroAoCarregar);
    expect(saida).toContain("Tentar de novo");
    expect(saida).toContain("lucide-octagon-alert");
  });
});

describe("o agente na linha (liberar e retirar)", () => {
  it("em produção: Liberado (Produção) em 3 camadas e o Retirar", () => {
    const saida = html(
      <AgenteNaLista
        clinicId={ID_A}
        nome="Clínica Aurora"
        estado="producao"
        suspensa={false}
        tetoDiarioCentavos={500}
      />,
    );
    expect(chip(saida, "Liberado (Produção)")).toContain("lucide-radio-tower");
    expect(chip(saida, "Liberado (Produção)")).toContain("var(--success-text)");
    expect(botaoPeloNome(saida, "Retirar agente da Clínica Aurora")).toContain(
      'data-size="sm"',
    );
    expect(saida).toContain("lucide-power-off");
  });

  it("retirar continua livre com a conta suspensa (o lado seguro)", () => {
    const saida = html(
      <AgenteNaLista
        clinicId={ID_C}
        nome="Estética Bela"
        estado="teste"
        suspensa
        tetoDiarioCentavos={500}
      />,
    );
    expect(
      botaoPeloNome(saida, "Retirar agente da Estética Bela"),
    ).not.toContain('disabled=""');
    expect(saida).not.toContain("cursor-not-allowed");
  });

  it("o aviso do fim: liberado em Teste ou retirado", () => {
    expect(textoDaMudancaNaLista("Aurora", "teste")).toBe(
      "Agente de IA liberado na Aurora, em Teste.",
    );
    expect(textoDaMudancaNaLista("Aurora", "desligado")).toBe(
      "Agente de IA retirado da Aurora.",
    );
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
      <GastoDaIa gasto={clinica().gasto} tetoDiarioCentavos={500} />,
    );
    expect(dentro).toContain("US$ 0,42 de US$ 5,00");
    expect(dentro).toContain("US$ 3,10");
    expect(dentro).toContain("US$ 2,00");
    expect(dentro).toContain('role="img"');
    expect(dentro).not.toContain("Perto do teto");
    expect(dentro).not.toContain("Teto atingido");

    const atingido = html(
      <GastoDaIa gasto={GASTO_NO_TETO} tetoDiarioCentavos={500} />,
    );
    expect(chip(atingido, "Teto atingido")).toContain("lucide-hourglass");

    const semTeto = html(
      <GastoDaIa gasto={clinica().gasto} tetoDiarioCentavos={null} />,
    );
    expect(semTeto).toContain("US$ 0,42, sem teto");
  });

  it("o aviso de fim da equipe: membros ativos e pedidos de entrada", () => {
    expect(textoDaEquipe(1, 0)).toBe("1 membro ativo.");
    expect(textoDaEquipe(3, 0, 1)).toBe(
      "3 membros ativos (1 da equipe Conduzza).",
    );
    expect(textoDaEquipe(1, 2, 1)).toBe(
      "1 membro ativo (1 da equipe Conduzza) e 2 pedidos de entrada esperando liberação.",
    );
    expect(textoDaEquipe(4, 2)).toBe(
      "4 membros ativos e 2 pedidos de entrada esperando liberação.",
    );
    expect(textoDaEquipe(1, 1)).toBe(
      "1 membro ativo e 1 pedido de entrada esperando liberação.",
    );
  });
});

function pessoa(campos: Partial<PessoaDaEquipe> = {}): PessoaDaEquipe {
  return {
    userId: PESSOA,
    nome: "Ana Souza",
    email: "ana@aurora.com.br",
    papel: "admin",
    situacao: "ativo",
    ultimoAcessoEm: "2026-10-20T13:05:00.000Z",
    equipeConduzza: false,
    ...campos,
  };
}

const EQUIPE: EquipeNoPainel = {
  equipe: [
    pessoa(),
    pessoa({
      userId: ID_B,
      nome: null,
      email: "recepcao@aurora.com.br",
      papel: "recepcao",
      situacao: "pendente",
      ultimoAcessoEm: "2026-09-01T12:00:00.000Z",
    }),
    pessoa({
      userId: ID_C,
      nome: "Bruno Lima",
      email: "bruno@aurora.com.br",
      papel: "leitura",
      situacao: "inativo",
      ultimoAcessoEm: null,
    }),
    pessoa({
      userId: NUMERO,
      nome: "Vinicius",
      email: "vinicius@conduzza.com",
      papel: "admin",
      equipeConduzza: true,
    }),
  ],
  implementadores: [
    pessoa({
      userId: CONVERSA,
      nome: "Técnico da Implantação",
      email: "tecnico@implanta.com.br",
      papel: "admin",
      ultimoAcessoEm: "2026-10-19T23:30:00.000Z",
    }),
  ],
};

describe("equipe da clínica no detalhe (26/10/2026; P18-5)", () => {
  function equipe(
    campos: Partial<React.ComponentProps<typeof EquipeDaClinica>> = {},
  ) {
    return html(
      <EquipeDaClinica
        equipe={EQUIPE}
        membrosAtivos={2}
        membrosPendentes={1}
        fuso="America/Fortaleza"
        agoraMs={Date.parse(AGORA)}
        {...campos}
      />,
    );
  }

  /** O pedaco do HTML entre o rotulo de uma lista e o fim da tabela dela. */
  function lista(saida: string, rotulo: string): string {
    const inicio = saida.indexOf(`>${rotulo}</p>`);
    expect(inicio, rotulo).toBeGreaterThan(-1);
    const fim = saida.indexOf("</table>", inicio);
    return saida.slice(inicio, fim === -1 ? undefined : fim);
  }

  it("cada pessoa: nome, e-mail (40px), papel, situação em 3 camadas e o último acesso no fuso da clínica", () => {
    const saida = equipe();
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.equipeTitulo));
    expect(saida).toContain(
      escapado("2 membros ativos e 1 pedido de entrada esperando liberação."),
    );
    const daEquipe = lista(saida, "Equipe");
    for (const coluna of ["Pessoa", "Papel", "Situação", "Último acesso"]) {
      expect(daEquipe).toContain(`>${escapado(coluna)}</th>`);
    }
    expect(daEquipe).toContain("Ana Souza");
    expect(daEquipe).toContain('href="mailto:ana@aurora.com.br"');
    expect(daEquipe).toContain("min-h-10");
    expect(daEquipe).toContain(">Administrador<");
    expect(daEquipe).toContain(">Recepção<");
    expect(daEquipe).toContain(">Somente leitura<");
    expect(chip(daEquipe, "Ativa")).toContain("lucide-circle-check");
    expect(chip(daEquipe, "Pendente")).toContain("lucide-hourglass");
    expect(chip(daEquipe, "Pendente")).toContain("var(--warning-text)");
    expect(chip(daEquipe, "Inativa")).toContain("lucide-circle-slash");
    expect(chip(daEquipe, "Inativa")).toContain("var(--neutral-text)");
    expect(daEquipe).toContain(">Hoje<");
    expect(daEquipe).toContain("20/10/2026, 10:05");
    expect(daEquipe).toContain(">Há 1 mês<");
    expect(daEquipe).toContain(escapado(TEXTOS_DO_PAINEL.nuncaEntrou));
    expect(daEquipe).toContain(escapado(TEXTOS_DO_PAINEL.semNomeNoPerfil));
  });

  it("a equipe Conduzza aparece marcada e conta no uso como qualquer pessoa ativa; o último acesso é a última atividade", () => {
    const saida = equipe({ membrosEquipeConduzza: 1 });
    expect(lista(saida, "Equipe")).toContain(
      escapado(TEXTOS_DO_PAINEL.equipeConduzzaMarca),
    );
    expect(saida).toContain(
      escapado(TEXTOS_DO_PAINEL.equipeConduzzaExplicacao),
    );
    expect(TEXTOS_DO_PAINEL.equipeConduzzaExplicacao).toContain(
      "conta no uso",
    );
    expect(saida).toContain(
      escapado("2 membros ativos (1 da equipe Conduzza) e 1 pedido"),
    );
    expect(saida).toContain(
      escapado(TEXTOS_DO_PAINEL.ultimoAcessoEAtividade),
    );
    const semConduzza = equipe({
      equipe: { ...EQUIPE, equipe: [pessoa()] },
    });
    expect(semConduzza).not.toContain(
      escapado(TEXTOS_DO_PAINEL.equipeConduzzaExplicacao),
    );
  });

  it("os Implementadores numa lista separada, sem a coluna Papel, e fora da lista da equipe", () => {
    const saida = equipe();
    const implementadores = lista(saida, "Implementadores");
    expect(implementadores).toContain(escapado("Técnico da Implantação"));
    expect(implementadores).not.toContain(">Papel</th>");
    // 23:30 UTC do dia 19 = 20:30 em Fortaleza
    expect(implementadores).toContain("19/10/2026, 20:30");
    expect(implementadores).toContain(">Ontem<");
    expect(lista(saida, "Equipe")).not.toContain(
      escapado("Técnico da Implantação"),
    );
    expect(saida).toContain(
      escapado(TEXTOS_DO_PAINEL.implementadoresDescricao),
    );
  });

  it("vazios: ninguém na equipe e nenhum implementador", () => {
    const saida = equipe({
      equipe: { equipe: [], implementadores: [] },
      membrosAtivos: 0,
      membrosPendentes: 0,
    });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.equipeVazia));
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.nenhumImplementador));
    expect(saida).not.toContain("<table");
    expect(saida).toContain("0 membros ativos.");
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
      html(
        <TotaisDoPainel
          totais={{
            clinicas: 3,
            emUso: 1,
            semUso: 2,
            suspensas: 1,
            agenteLiberado: 1,
            gastoMesCentavos: 2210,
            gastoMesMicrodolares: 22_100_000,
            chamadasMes: 12,
            saude: { saudavel: 1, atencao: 0, em_risco: 2 },
          }}
        />,
      ),
      html(
        <EquipeDaClinica
          equipe={EQUIPE}
          membrosAtivos={2}
          membrosPendentes={1}
          fuso="America/Fortaleza"
          agoraMs={Date.parse(AGORA)}
        />,
      ),
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
      html(<GastoDaIa gasto={GASTO_NO_TETO} tetoDiarioCentavos={500} />),
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
  it("a lista mostra Liberado (Produção) em 3 camadas, com o Retirar, e o filtro Liberado a acha", () => {
    navegacao.busca = "agente=liberado";
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
    expect(chip(saida, "Liberado (Produção)")).toContain("lucide-radio-tower");
    expect(saida).toContain("Retirar agente da Clínica Aurora");
    expect(saida).toContain("1 clínica");
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

describe("segunda leva da lista (pedido do dono de 26/10/2026)", () => {
  /** A celula da coluna (contando do 1) dentro da linha. */
  function celula(linha: string, coluna: number): string {
    let inicio = -1;
    for (let i = 0; i < coluna; i += 1) {
      inicio = linha.indexOf("<td", inicio + 1);
    }
    expect(inicio, `coluna ${coluna}`).toBeGreaterThan(-1);
    return linha.slice(inicio, linha.indexOf("</td>", inicio) + 5);
  }

  it("o cartão do gasto do mês: a precisão real e as chamadas (o mês de US$ 0,001 nunca vira US$ 0,00)", () => {
    const saida = html(
      <TotaisDoPainel
        totais={{
          clinicas: 6,
          emUso: 3,
          semUso: 3,
          suspensas: 0,
          agenteLiberado: 2,
          gastoMesCentavos: 0,
          gastoMesMicrodolares: 1000,
          chamadasMes: 7,
          saude: { saudavel: 2, atencao: 1, em_risco: 3 },
        }}
      />,
    );
    expect(saida).toContain("US$ 0,001");
    expect(saida).not.toContain("US$ 0,00<");
    expect(saida).toContain(
      escapado(`7 chamadas. ${TEXTOS_DO_PAINEL.rodapeDoGastoDoMes}`),
    );
  });

  it("a faixa da saúde: as três contagens em 3 camadas, botões de 40px que filtram (aria-pressed)", () => {
    const contagem = { saudavel: 4, atencao: 1, em_risco: 2 };
    const saida = html(<FaixaDeSaude contagem={contagem} />);
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.faixaDeSaude));
    expect(saida.match(/<button/g)).toHaveLength(3);
    expect(saida.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(saida).toContain("min-h-10");
    const botao = (rotulo: string) => {
      const indice = saida.indexOf(`<span>${escapado(rotulo)}</span>`);
      expect(indice, rotulo).toBeGreaterThan(-1);
      const abertura = saida.lastIndexOf("<button", indice);
      return saida.slice(abertura, saida.indexOf("</button>", indice));
    };
    expect(botao("Saudável")).toContain("lucide-circle-check");
    expect(botao("Saudável")).toContain("var(--success-text)");
    expect(botao("Saudável")).toContain(">4<");
    expect(botao("Atenção")).toContain("lucide-circle-alert");
    expect(botao("Atenção")).toContain("var(--warning-text)");
    expect(botao("Em risco")).toContain("lucide-siren");
    expect(botao("Em risco")).toContain("var(--alert-text)");
    expect(botao("Em risco")).toContain(">2<");

    navegacao.busca = "saude=em_risco";
    const filtrada = html(<FaixaDeSaude contagem={contagem} />);
    expect(filtrada.match(/aria-pressed="true"/g)).toHaveLength(1);
    const ligada = filtrada.slice(
      filtrada.lastIndexOf("<button", filtrada.indexOf("<span>Em risco</span>")),
      filtrada.indexOf("<span>Em risco</span>"),
    );
    expect(ligada).toContain('aria-pressed="true"');
    expect(ligada).toContain("ring-2");
  });

  it("a coluna Saúde: a saúde e cada sinal aceso em 3 camadas; a clínica saudável sem sinal", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const arvore = celula(linhaDa(saida, ID_B), 2);
    expect(chip(arvore, "Em risco")).toContain("lucide-siren");
    expect(chip(arvore, "Em risco")).toContain("var(--alert-text)");
    expect(chip(arvore, "Conta suspensa")).toContain("lucide-octagon-pause");
    expect(chip(arvore, "Sem uso há 30 dias")).toContain("lucide-watch");
    expect(chip(arvore, "WhatsApp desconectado")).toContain("lucide-wifi-off");
    expect(chip(arvore, "Perto do teto de IA")).toContain(
      "lucide-circle-alert",
    );
    expect(arvore).toContain(
      `aria-label="${escapado("Sinais de alerta da Odonto Árvore")}"`,
    );

    const bela = celula(linhaDa(saida, ID_C), 2);
    expect(chip(bela, "Sem número de WhatsApp")).toContain("lucide-phone-off");
    expect(chip(bela, "Sem número de WhatsApp")).toContain(
      "var(--warning-text)",
    );

    const aurora = celula(linhaDa(saida, ID_A), 2);
    expect(chip(aurora, "Saudável")).toContain("lucide-circle-check");
    expect(aurora).not.toContain("<ul");
  });

  it("a coluna IA no mês: o gasto exato, as chamadas e o teto por dia; sem agente e sem gasto, Sem uso de IA", () => {
    const saida = html(
      <ListaDoPainel
        clinicas={[
          clinica(),
          clinica({
            id: ID_B,
            nome: "Conduzza Teste",
            agente: { ...clinica().agente, estado: "teste" },
            gasto: {
              ...gasto(0, 0, 0, 0),
              mesMicrodolares: 1000,
              mesChamadas: 7,
            },
          }),
          clinica({
            id: ID_C,
            nome: "Sem IA",
            gasto: gasto(0, 0, 0, 0),
            tetoDiarioCentavos: null,
          }),
        ]}
        agoraIso={AGORA}
      />,
    );
    const aurora = celula(linhaDa(saida, ID_A), 7);
    expect(aurora).toContain("US$ 3,10");
    expect(aurora).toContain("25 chamadas");
    expect(aurora).toContain("Teto de US$ 5,00 por dia");

    const teste = celula(linhaDa(saida, ID_B), 7);
    expect(teste).toContain("US$ 0,001");
    expect(teste).toContain("7 chamadas");
    expect(teste).not.toContain("US$ 0,00<");

    const semIa = celula(linhaDa(saida, ID_C), 7);
    expect(semIa).toContain(TEXTOS_DO_PAINEL.semUsoDeIa);
    expect(semIa).not.toContain("US$");
  });

  it("leads e conversas com a tendência do banco: a seta e o texto, a frase para o leitor de tela; sem base", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const aurora = linhaDa(saida, ID_A);
    const leads = celula(aurora, 8);
    expect(leads).toContain('<span class="cz-num">14</span>');
    expect(leads).toContain("lucide-trending-up");
    expect(leads).toContain("+40%");
    expect(leads).toContain("text-success-text");
    expect(leads).toContain("subindo 40% vs. 30 dias anteriores");
    const conversas = celula(aurora, 9);
    expect(conversas).toContain("1.234");
    expect(conversas).toContain(">Sem base<");
    expect(conversas).not.toContain("lucide-trending");

    const bela = linhaDa(saida, ID_C);
    expect(celula(bela, 8)).toContain("lucide-trending-down");
    expect(celula(bela, 8)).toContain("text-alert-text");
    expect(celula(bela, 9)).toContain("lucide-minus");
    expect(celula(bela, 9)).toContain(">Estável<");
  });

  it("a implantação: N de 6 passos, que leva ao cartão do detalhe; a data da última nota embaixo do nome", () => {
    const saida = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const aurora = celula(linhaDa(saida, ID_A), 10);
    expect(aurora).toContain(`href="/painel-geral/${ID_A}#implantacao"`);
    expect(aurora).toContain(">3 de 6 passos<");
    expect(aurora).toContain(
      `aria-label="${escapado("3 de 6 passos da implantação da Clínica Aurora")}"`,
    );
    expect(aurora).toContain("min-h-10");
    expect(celula(linhaDa(saida, ID_B), 10)).toContain(">0 de 6 passos<");

    expect(celula(linhaDa(saida, ID_B), 1)).toContain(
      "Última nota em 22/10/2026",
    );
    expect(celula(linhaDa(saida, ID_A), 1)).not.toContain("Última nota");
  });

  it("o filtro Saúde na barra e na URL; a ordem da URL com o aria-sort da coluna", () => {
    navegacao.busca = "saude=em_risco";
    const emRisco = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    expect(emRisco).toContain('aria-label="Saúde"');
    expect(emRisco).toContain("2 clínicas");
    expect(emRisco).not.toContain(escapado("Clínica Aurora"));
    expect(emRisco).toContain("Limpar filtros");

    navegacao.busca = "ordem=ia&sentido=desc";
    const porIa = html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />);
    const ordem = ["Estética Bela", "Odonto Árvore", "Clínica Aurora"].map(
      (nome) => porIa.indexOf(escapado(nome)),
    );
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    const cabecalho = porIa.slice(
      porIa.indexOf("<thead"),
      porIa.indexOf("</thead>"),
    );
    const ia = cabecalho.slice(
      cabecalho.lastIndexOf("<th", cabecalho.indexOf(">IA no mês<")),
      cabecalho.indexOf(">IA no mês<"),
    );
    expect(ia).toContain('aria-sort="descending"');
    expect(cabecalho.match(/aria-sort="none"/g)).toHaveLength(5);
    expect(cabecalho).toContain("lucide-arrow-down");

    navegacao.busca = "ordem=implantacao";
    const porImplantacao = html(
      <ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />,
    );
    // Sem sentido na URL: o do primeiro clique (quem fez menos primeiro).
    expect(porImplantacao).toContain('aria-sort="ascending"');
    expect(porImplantacao.indexOf(escapado("Odonto Árvore"))).toBeLessThan(
      porImplantacao.indexOf(escapado("Clínica Aurora")),
    );
  });

  it("o Exportar: habilitado com clínica na lista; sem nenhuma com os filtros, visível, desabilitado e com a dica", () => {
    const comClinicas = html(
      <ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />,
    );
    const exportar = comClinicas.slice(
      comClinicas.lastIndexOf("<button", comClinicas.indexOf(">Exportar<")),
      comClinicas.indexOf(">Exportar<"),
    );
    expect(exportar).not.toContain('disabled=""');
    expect(comClinicas).toContain("lucide-download");

    navegacao.busca = "busca=zzz";
    const semClinicas = html(
      <ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />,
    );
    const desabilitado = semClinicas.slice(
      semClinicas.lastIndexOf("<button", semClinicas.indexOf(">Exportar<")),
      semClinicas.indexOf(">Exportar<"),
    );
    expect(desabilitado).toContain('disabled=""');
    expect(semClinicas).toContain("cursor-not-allowed");
  });

  it("nenhum travessão na faixa e na lista nova", () => {
    expect(
      html(<FaixaDeSaude contagem={{ saudavel: 1, atencao: 1, em_risco: 1 }} />),
    ).not.toMatch(/[—–]/);
    expect(html(<ListaDoPainel clinicas={LISTA} agoraIso={AGORA} />)).not.toMatch(
      /[—–]/,
    );
  });
});
