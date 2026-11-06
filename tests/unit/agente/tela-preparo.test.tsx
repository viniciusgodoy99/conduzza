import { readFileSync } from "node:fs";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FalaDoSimulador } from "@/components/agente/tipos";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionContext } from "@/lib/auth/active-clinic";
import {
  configPadraoDoAgente,
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  prazosPadrao,
  problemaNoTextoDoAgente,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";
import { gatilhosDosTextos } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import type { Role } from "@/lib/domain/permissions";
import {
  CABECALHO_DO_PREPARO,
  mensagemDoPreparo,
  RODAPE_DO_PREPARO,
} from "@/lib/domain/preparo";

import {
  CLINICA,
  configDeTeste,
  dadosDeTeste,
  DICA_RECEPCAO,
  ITEM_ATIVO,
  VERSAO_2,
} from "./tela-fixtures";

// AG7 na Tela 6 (desenho da AG7, secoes 5.4 e 5.6; contrato da AG7, 3.3 e
// 7.4): a habilidade "Enviar orientação de preparo" na aba Habilidades (o
// cartao vem de HABILIDADES_DO_AGENTE, da frente M) com a nota da fase de
// teste e, quando a pagina conferiu que nenhum procedimento ativo tem
// orientacao aprovada em vigor, a dica de que o pedido passa para a equipe,
// tambem para a recepcao (a chave visivel e desabilitada, com a dica de
// sempre); a revisao curta (a sobra da CURTA-5): o texto aprovado que as
// regras de hoje recusam nao conta, e a dica diz que ele nao sai e aparece
// como "Aprovada, sem envio" em Cadastros; a pagina lendo o preparo pela
// sessao para todo papel, com as regras conferidas no servidor; o cenario
// "Paciente pedindo o preparo" antes da lista de espera; e a fala do
// simulador com a mensagem montada pelo sistema e a marca, que nao encerra a
// conversa. Tudo renderizado no servidor; banco, sessao e motor sao falsos:
// nada aqui chama acao, rede ou a OpenAI.

vi.mock("server-only", () => ({}));

const sessao = vi.hoisted(() => ({
  atual: null as SessionContext | null,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: () => Promise.resolve(sessao.atual),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

const banco = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  fetchConfigDoAgente: vi.fn(),
  fetchVersoesDoAgente: vi.fn(),
  motivoParaNaoSimular: vi.fn(),
  carregarConfigDoRascunho: vi.fn(),
  carregarCatalogoDoAgente: vi.fn(),
  carregarExtrasDoPainel: vi.fn(),
  fetchPreparoDaHabilidade: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: banco.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: banco.createAdminClient,
}));
vi.mock("@/lib/queries/agente", () => ({
  fetchConfigDoAgente: banco.fetchConfigDoAgente,
  fetchVersoesDoAgente: banco.fetchVersoesDoAgente,
}));
vi.mock("@/lib/agente/simulador", () => ({
  motivoParaNaoSimular: banco.motivoParaNaoSimular,
  TEXTOS_DO_SIMULADOR: {
    naoConferiu:
      "Não foi possível conferir se a IA pode responder. Tente de novo.",
  },
}));
vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigDoRascunho: banco.carregarConfigDoRascunho,
  carregarCatalogoDoAgente: banco.carregarCatalogoDoAgente,
}));
vi.mock("@/lib/agente/painel", () => ({
  carregarExtrasDoPainel: banco.carregarExtrasDoPainel,
}));
vi.mock("@/lib/queries/preparo", () => ({
  fetchPreparoDaHabilidade: banco.fetchPreparoDaHabilidade,
}));
vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarPublico: vi.fn(),
    salvarDadosExigidos: vi.fn(),
    salvarPrazos: vi.fn(),
    salvarPassagem: vi.fn(),
    salvarItemDaBase: vi.fn(),
    ativarItemDaBase: vi.fn(),
    excluirItemDaBase: vi.fn(),
    salvarInstrucoes: vi.fn(),
    publicar: vi.fn(),
    restaurarVersao: vi.fn(),
    simular: vi.fn(),
  },
}));

const { AbaHabilidades, notaDaFaseDeTeste } =
  await import("@/components/agente/aba-habilidades");
const { PainelDoAgente } = await import("@/components/agente/painel-do-agente");
const { conversaEncerrada, Fala, mensagensParaOServidor, Trilha } =
  await import("@/components/agente/simulador");
const {
  CENARIOS_DO_SIMULADOR,
  ehCenario,
  HABILIDADE_ENVIAR_PREPARO,
  notaDoPreparoSemTextoAprovado,
  TEXTOS_DO_AGENTE,
  TEXTOS_DO_PREPARO,
} = await import("@/components/agente/textos");
const { default: AgentePage } = await import("@/app/(app)/agente/page");
// A conferencia das regras de hoje que a pagina passa a leitura (servidor).
const { recusadoPelasRegrasDeHoje } =
  await import("@/app/(app)/cadastros/recusas-do-preparo");
const { PREPARO_DO_PROCEDIMENTO_STATUS } = await import("@/lib/design/status");

/** A chave como string: o tipo ChaveDaHabilidade so a conhece depois da M. */
const PREPARO: string = "enviar_preparo";

const SEM_AGENDA: AgendaDoAgente = {
  antecedenciaHoras: null,
  horizonteDias: null,
};

/** O que o desenho (5.4) e o pedido da frente T dizem, letra por letra. */
const DO_DESENHO = {
  titulo: "Enviar orientação de preparo",
  descricao:
    "Quando o paciente pede, manda a orientação de preparo do procedimento exatamente como o responsável técnico aprovou no Cadastro. Dúvida sobre o preparo passa para a equipe.",
  semTextoAprovado:
    "Nenhum procedimento tem orientação aprovada pelo responsável técnico. Com a chave ligada, o pedido de preparo passa para a equipe.",
  marca: "Enviado pelo sistema: texto aprovado pelo responsável técnico",
} as const;

/**
 * Revisao curta da AG7 (a sobra da CURTA-5 na Tela 6): o texto aprovado em
 * vigor que as regras de hoje recusam nao sai, e Cadastros o mostra como
 * "Aprovada, sem envio".
 */
const APROVADA_SEM_ENVIO =
  "Nenhuma orientação aprovada pelo responsável técnico pode ser enviada: as regras de hoje não deixam o texto sair (em Cadastros, aparece como “Aprovada, sem envio”). Com a chave ligada, o pedido de preparo passa para a equipe.";

/** Os dois estados que levam a dica, com o texto de cada um. */
const ESTADOS_COM_A_DICA = [
  ["sem_texto_aprovado", DO_DESENHO.semTextoAprovado],
  ["aprovada_sem_envio", APROVADA_SEM_ENVIO],
] as const;

/** A nota da fase de teste que a frente T propos (pendente do dono). */
const NOTA_DA_FASE_DE_TESTE =
  "Nesta fase de teste, quem já é paciente só recebe a orientação pelo telefone da equipe cadastrado pela equipe Conduzza. A mensagem sai com o nome e o registro do responsável técnico.";

/** Mensagem de exemplo, montada como o banco monta (lib/domain/preparo). */
const MENSAGEM = mensagemDoPreparo({
  procedimento: "Limpeza de pele",
  rt: { nome: "Dra. Ana Souza", conselho: "CRM", uf: "CE", numero: "12345" },
  texto: "Venha com roupa confortável.\nChegue 15 minutos antes.",
});

const PASSO_DO_PREPARO = {
  tipo: "cadastro" as const,
  texto:
    "Pediu a orientação de preparo de Limpeza de pele: enviada a versão 3 (código A1B2 C3D4), aprovada por Dra. Ana Souza em 27/10/2026.",
};

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function chaveDa(html: string, habilidade: string): string {
  const chaves = html.match(/<button[^>]*role="switch"[^>]*>/g) ?? [];
  const achada = chaves.find((tag) =>
    tag.includes(`aria-labelledby="agente-habilidade-${habilidade}"`),
  );
  if (!achada) {
    throw new Error(`chave de ${habilidade} nao encontrada`);
  }
  return achada;
}

/** A chave presa pela permissao: a dica do cursor em volta do botao. */
function presaPelaDica(habilidade: string): RegExp {
  return new RegExp(
    `<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-${habilidade}"`,
  );
}

function habilidades(
  props: Partial<Parameters<typeof AbaHabilidades>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AbaHabilidades
        habilidades={habilidadesEfetivas({})}
        agenda={SEM_AGENDA}
        prazos={prazosPadrao()}
        podeEditar
        dica={null}
        pendente={false}
        ocupado={() => false}
        aoAlternar={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function painel(
  dados = dadosDeTeste(),
  abaInicial: string | undefined = "habilidades",
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PainelDoAgente dados={dados} abaInicial={abaInicial} />
    </TooltipProvider>,
  );
}

function fala(campos: Partial<FalaDoSimulador> = {}): string {
  return renderToStaticMarkup(
    <Fala
      fala={{
        id: "f1",
        autor: "assistente",
        texto: MENSAGEM,
        tipo: "preparo",
        trilha: [PASSO_DO_PREPARO],
        rascunhoBloqueado: null,
        assinatura: "v1.2.abc",
        ...campos,
      }}
      nomeDoAssistente="Ana"
    />,
  );
}

// ---------------------------------------------------------------------------
// A pagina (o molde de tests/unit/agente/tela-guarda.test.tsx)
// ---------------------------------------------------------------------------

/** O cliente da sessao falso: so a identidade importa aqui. */
const CLIENTE_DA_SESSAO = { cliente: "sessao" };

function contexto(
  role: Role,
  campos: { clinicId?: string; isProductAdmin?: boolean } = {},
): SessionContext {
  return {
    userId: "33333333-3333-4333-8333-333333333333",
    userName: "Teste",
    userEmail: "teste@exemplo.com",
    memberships: [],
    active: {
      clinicId: campos.clinicId ?? CLINICA,
      clinicName: "Clínica Teste",
      slug: "teste",
      timezone: "America/Fortaleza",
      role,
      implementador: false,
      status: "ativo",
      productName: "Conduzza Clínicas",
      primaryColor: "#B2E54F",
      labels: null,
    },
    clinicaSuspensa: null,
    isProductAdmin: campos.isProductAdmin ?? false,
    vinculoIndisponivel: false,
    marcaDeImplementadorIndisponivel: false,
  };
}

/** O cliente de servico falso: so a lista das clinicas com o agente. */
function adminComALista(lista: readonly string[] = [CLINICA]) {
  return {
    rpc: async (nome: string) =>
      nome === "ia_clinicas_da_fase_controlada"
        ? { data: lista, error: null }
        : { data: null, error: null },
  };
}

async function pagina(): Promise<string> {
  const elemento = (await AgentePage({
    searchParams: Promise.resolve({ aba: "habilidades" }),
  })) as ReactElement;
  return renderToStaticMarkup(<TooltipProvider>{elemento}</TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.createClient.mockResolvedValue(CLIENTE_DA_SESSAO);
  banco.createAdminClient.mockReturnValue(adminComALista());
  banco.motivoParaNaoSimular.mockResolvedValue(null);
  banco.carregarExtrasDoPainel.mockResolvedValue({
    instrucoesMudaram: false,
    versoesComInstrucoesMudadas: [],
    previa: null,
  });
  banco.fetchVersoesDoAgente.mockResolvedValue([]);
  banco.fetchConfigDoAgente.mockResolvedValue({
    config: { ...configPadraoDoAgente(), base: [ITEM_ATIVO] },
    temRascunho: true,
    publicada: null,
    mudancas: [],
  });
  banco.fetchPreparoDaHabilidade.mockResolvedValue("sai");
});

// ---------------------------------------------------------------------------

describe("a nota da fase de teste de Enviar orientação de preparo", () => {
  it("o texto proposto, no molde das outras, sai por notaDaFaseDeTeste (como a da lista de espera)", () => {
    expect(HABILIDADE_ENVIAR_PREPARO).toBe(PREPARO);
    expect(TEXTOS_DO_AGENTE.preparoNaFaseDeTeste).toBe(NOTA_DA_FASE_DE_TESTE);
    expect(NOTA_DA_FASE_DE_TESTE).toMatch(/^Nesta fase de teste, /);
    expect(notaDaFaseDeTeste(PREPARO)).toBe(NOTA_DA_FASE_DE_TESTE);
  });

  it("as outras notas continuam como estavam", () => {
    expect(notaDaFaseDeTeste("lista_de_espera")).toBe(
      TEXTOS_DO_AGENTE.listaDeEsperaNaFaseDeTeste,
    );
    for (const chave of ["cancelar", "remarcar", "confirmar_presenca"]) {
      expect(notaDaFaseDeTeste(chave), chave).toBe(
        TEXTOS_DO_AGENTE.habilidadeNaFaseDeTeste,
      );
    }
    for (const chave of [
      "responder_duvidas",
      "informar_preco_e_convenio",
      "agendar",
      "passar_para_equipe",
      "nao_existe",
    ]) {
      expect(notaDaFaseDeTeste(chave), chave).toBeNull();
    }
    // Nao repete a nota do telefone (tela-agenda-do-agente conta quantas
    // vezes ela aparece na aba).
    expect(NOTA_DA_FASE_DE_TESTE).not.toContain(
      TEXTOS_DO_AGENTE.habilidadeNaFaseDeTeste,
    );
  });
});

describe("a dica de quando nenhum procedimento tem orientação aprovada", () => {
  it("o texto do desenho", () => {
    expect(TEXTOS_DO_PREPARO.semTextoAprovado).toBe(
      DO_DESENHO.semTextoAprovado,
    );
  });

  it("só em Enviar orientação de preparo, e só quando a página conferiu que não há nenhuma que saia", () => {
    expect(notaDoPreparoSemTextoAprovado(PREPARO, "sem_texto_aprovado")).toBe(
      DO_DESENHO.semTextoAprovado,
    );
    expect(notaDoPreparoSemTextoAprovado(PREPARO, "aprovada_sem_envio")).toBe(
      APROVADA_SEM_ENVIO,
    );
    // Com texto em vigor que sai, ou sem a leitura (nulo ou ausente): sem a
    // dica.
    expect(notaDoPreparoSemTextoAprovado(PREPARO, "sai")).toBeNull();
    expect(notaDoPreparoSemTextoAprovado(PREPARO, null)).toBeNull();
    expect(notaDoPreparoSemTextoAprovado(PREPARO, undefined)).toBeNull();
    for (const habilidade of HABILIDADES_DO_AGENTE) {
      if (habilidade.chave !== PREPARO) {
        for (const [estado] of ESTADOS_COM_A_DICA) {
          expect(
            notaDoPreparoSemTextoAprovado(habilidade.chave, estado),
            `${habilidade.chave} ${estado}`,
          ).toBeNull();
        }
      }
    }
  });

  it("revisão curta: o texto aprovado que as regras de hoje recusam não sai, e a dica diz como ele aparece em Cadastros", () => {
    expect(TEXTOS_DO_PREPARO.aprovadaSemEnvio).toBe(APROVADA_SEM_ENVIO);
    // O nome do chip de Cadastros, letra por letra (lib/design/status.ts).
    expect(TEXTOS_DO_PREPARO.aprovadaSemEnvio).toContain(
      `“${PREPARO_DO_PROCEDIMENTO_STATUS.aprovada_sem_envio.label}”`,
    );
    // E a mesma consequencia da dica de sempre.
    expect(TEXTOS_DO_PREPARO.aprovadaSemEnvio).toContain(
      "Com a chave ligada, o pedido de preparo passa para a equipe.",
    );
  });

  it("nenhuma outra habilidade da aba ganha a dica", () => {
    for (const [estado] of ESTADOS_COM_A_DICA) {
      const html = habilidades({ preparoDaHabilidade: estado });
      const ids = html.match(/id="agente-habilidade-[^"]+-sem-preparo"/g) ?? [];
      for (const id of ids) {
        expect(id).toBe(`id="agente-habilidade-${PREPARO}-sem-preparo"`);
      }
      expect(ids.length, estado).toBeLessThanOrEqual(1);
    }
  });
});

describe("o cenário do simulador", () => {
  const cenario = CENARIOS_DO_SIMULADOR.find((c) => c.chave === "preparo");

  it("Paciente pedindo o preparo: depois do sinal de emergência e antes da lista de espera, que continua a última", () => {
    expect(cenario).toEqual({
      chave: "preparo",
      rotulo: "Paciente pedindo o preparo",
      mensagem: "Oi! Qual é o preparo do meu procedimento?",
    });
    expect(ehCenario("preparo")).toBe(true);
    const chaves = CENARIOS_DO_SIMULADOR.map((c) => c.chave);
    expect(chaves.at(-1)).toBe("lista_de_espera");
    expect(chaves.at(-2)).toBe("preparo");
    expect(chaves.indexOf("preparo")).toBe(chaves.indexOf("urgencia") + 1);
  });

  // O portao compila os padroes na primeira chamada: com a maquina
  // ocupada, passa dos 5 s padrao.
  it(
    "sem dado pessoal, e sem palavra que o portão de entrada passa direto para a equipe",
    { timeout: 30_000 },
    () => {
      const mensagem = cenario?.mensagem ?? "";
      expect(problemaNoTextoDoAgente(mensagem, "pergunta") ?? "").not.toMatch(
        /telefone|CEP|e-mail|CPF|número longo/,
      );
      expect(mensagem).not.toMatch(/\d{4,}|@/);
      // O portao deterministico deixa passar (o classificador decide, com a
      // variante da habilidade).
      expect(gatilhosDosTextos([mensagem])).toEqual([]);
      // Anti falso positivo: com "exame", o portao passa para a equipe antes
      // do classificador (contrato da AG7, secao 0, item 10).
      expect(
        gatilhosDosTextos(["Oi! Qual é o preparo do meu exame?"]),
      ).toContain("assunto_clinico");
    },
  );

  it("a ação aceita o mesmo cenário (o enum CENARIOS de actions.ts)", () => {
    expect(readFileSync("app/(app)/agente/actions.ts", "utf8")).toMatch(
      /\n\s*"preparo",\n/,
    );
  });
});

describe("a fala do preparo no simulador", () => {
  it("a mensagem montada pelo sistema na bolha da IA, inteira e com as quebras de linha", () => {
    expect(MENSAGEM.startsWith(CABECALHO_DO_PREPARO)).toBe(true);
    expect(MENSAGEM.endsWith(RODAPE_DO_PREPARO)).toBe(true);
    const html = fala();
    expect(html).toContain("justify-items-end");
    expect(html).toContain("bg-bubble-ai");
    // Palavra por palavra, com as quebras (a bolha preserva o branco).
    expect(html).toContain(
      `<p class="break-words whitespace-pre-wrap">${MENSAGEM}</p>`,
    );
    const visivel = texto(html);
    expect(visivel).toContain("Ana");
    expect(visivel).toContain(" IA ");
    // Nao e a frase fixa: sem o aviso da passagem nem o do bloqueio.
    expect(html).not.toContain("lucide-shield-ban");
    expect(html).not.toContain("data-tom=");
    expect(visivel).not.toContain(TEXTOS_DO_AGENTE.fraseFixaTexto);
  });

  it("a marca, em texto e sem ícone, entre a bolha e o Por que a IA respondeu isso", () => {
    expect(TEXTOS_DO_PREPARO.marcaDoSimulador).toBe(DO_DESENHO.marca);
    const html = fala();
    // O paragrafo inteiro, so com o texto: nem icone, nem chip, nem cor
    // propria (e marca, nao status).
    const marca = `<p data-marca-do-preparo="true" class="px-1 text-right text-xs text-text-secondary">${DO_DESENHO.marca}</p>`;
    expect(html).toContain(marca);
    const bolha = html.indexOf(MENSAGEM);
    const ondeEstaAMarca = html.indexOf(marca);
    const porQue = html.indexOf(TEXTOS_DO_AGENTE.porQue);
    expect(bolha).toBeGreaterThan(-1);
    expect(ondeEstaAMarca).toBeGreaterThan(bolha);
    expect(porQue).toBeGreaterThan(ondeEstaAMarca);
  });

  it("só a fala do preparo leva a marca", () => {
    expect(fala({ tipo: "resposta", texto: "Temos sim." })).not.toContain(
      DO_DESENHO.marca,
    );
    expect(
      fala({
        tipo: "frase_fixa",
        texto: "Vou passar para a equipe.",
        trilha: [{ tipo: "equipe", texto: "Passou para a equipe" }],
      }),
    ).not.toContain(DO_DESENHO.marca);
    expect(
      renderToStaticMarkup(
        <Fala
          fala={{ id: "p1", autor: "paciente", texto: "Qual o preparo?" }}
          nomeDoAssistente="Ana"
        />,
      ),
    ).not.toContain(DO_DESENHO.marca);
  });

  it("não encerra a conversa: só a frase fixa encerra", () => {
    const doPaciente: FalaDoSimulador = {
      id: "1",
      autor: "paciente",
      texto: "Qual é o preparo?",
    };
    const doPreparo: FalaDoSimulador = {
      id: "2",
      autor: "assistente",
      texto: MENSAGEM,
      tipo: "preparo",
      trilha: [PASSO_DO_PREPARO],
    };
    expect(conversaEncerrada([])).toBe(false);
    expect(conversaEncerrada([doPaciente, doPreparo])).toBe(false);
    expect(
      conversaEncerrada([
        doPaciente,
        { ...doPreparo, id: "3", tipo: "resposta", texto: "Temos sim." },
      ]),
    ).toBe(false);
    expect(
      conversaEncerrada([
        doPaciente,
        doPreparo,
        { ...doPreparo, id: "4", tipo: "frase_fixa", texto: "Vou passar." },
      ]),
    ).toBe(true);
  });

  it("volta ao servidor como as outras falas do assistente: o texto e a assinatura, nada mais", () => {
    const falas: FalaDoSimulador[] = [
      { id: "1", autor: "paciente", texto: "Qual é o preparo?" },
      {
        id: "2",
        autor: "assistente",
        texto: MENSAGEM,
        tipo: "preparo",
        trilha: [PASSO_DO_PREPARO],
        rascunhoBloqueado: null,
        assinatura: "v1.2.abc",
      },
      { id: "3", autor: "paciente", texto: "Obrigada!" },
    ];
    expect(mensagensParaOServidor(falas)[1]).toEqual({
      autor: "assistente",
      texto: MENSAGEM,
      assinatura: "v1.2.abc",
    });
  });

  it("o passo da trilha é o de cadastro, neutro (nenhum tipo de passo novo)", () => {
    const html = renderToStaticMarkup(<Trilha trilha={[PASSO_DO_PREPARO]} />);
    expect(html).toMatch(/lucide-folder-cog[^"]*text-text-secondary/);
    expect(texto(html)).toContain(PASSO_DO_PREPARO.texto);
  });
});

// A pagina inteira (o painel e as abas): com a maquina ocupada, passa dos
// 5 s padrao.
describe(
  "a página lê o preparo pela sessão, para todo papel que abre a Tela 6",
  { timeout: 30_000 },
  () => {
    it.each<[string, SessionContext]>([
      ["administrador", contexto("admin")],
      ["gestor", contexto("gestor")],
      ["recepção", contexto("recepcao")],
      ["super admin", contexto("leitura", { isProductAdmin: true })],
    ])("%s", async (_papel, quem) => {
      sessao.atual = quem;
      const html = await pagina();
      expect(texto(html)).toContain("Publicar alterações");
      expect(banco.fetchPreparoDaHabilidade).toHaveBeenCalledTimes(1);
      // As regras de hoje conferidas no servidor, com o mesmo criterio do
      // "Aprovada, sem envio" de Cadastros (revisao curta).
      expect(banco.fetchPreparoDaHabilidade).toHaveBeenCalledWith(
        CLIENTE_DA_SESSAO,
        CLINICA,
        recusadoPelasRegrasDeHoje,
      );
    });

    it("a leitura que falha não derruba a tela: o painel continua, sem a dica", async () => {
      sessao.atual = contexto("recepcao");
      banco.fetchPreparoDaHabilidade.mockRejectedValue(new Error("rede"));
      const html = await pagina();
      expect(texto(html)).toContain("Publicar alterações");
      expect(html).not.toContain(DO_DESENHO.semTextoAprovado);
      expect(html).not.toContain(
        PREPARO_DO_PROCEDIMENTO_STATUS.aprovada_sem_envio.label,
      );
      expect(texto(html)).not.toContain("Não foi possível carregar");
    });

    it("fora da fase controlada: nem lê", async () => {
      sessao.atual = contexto("admin", {
        clinicId: "99999999-9999-4999-8999-999999999999",
      });
      const html = await pagina();
      expect(texto(html)).toContain(
        "A recepcionista de IA ainda não está ligada nesta clínica",
      );
      expect(banco.fetchPreparoDaHabilidade).not.toHaveBeenCalled();
    });
  },
);

describe("cópia da AG7 na Tela 6", () => {
  it("sem travessão e com linguagem de recepcionista", () => {
    const amostras: [string, string][] = [
      ["preparoNaFaseDeTeste", TEXTOS_DO_AGENTE.preparoNaFaseDeTeste],
      ["semTextoAprovado", TEXTOS_DO_PREPARO.semTextoAprovado],
      ["aprovadaSemEnvio", TEXTOS_DO_PREPARO.aprovadaSemEnvio],
      ["marcaDoSimulador", TEXTOS_DO_PREPARO.marcaDoSimulador],
      ["fala", texto(fala())],
      ...ESTADOS_COM_A_DICA.map(([estado]): [string, string] => [
        `habilidades ${estado}`,
        texto(habilidades({ preparoDaHabilidade: estado })),
      ]),
      ...CENARIOS_DO_SIMULADOR.filter((c) => c.chave === "preparo").flatMap(
        (c): [string, string][] => [
          [`${c.chave}.rotulo`, c.rotulo],
          [`${c.chave}.mensagem`, c.mensagem],
        ],
      ),
    ];
    for (const [chave, amostra] of amostras) {
      expect(amostra, chave).not.toMatch(/[—–]/);
      expect(amostra, chave).not.toMatch(
        /\b(prompt|token|LLM|skill|tool|tenant|handoff|opt-in|hash|sha256)\b/i,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// DEPENDE DO MERGE DA FRENTE M. O cartao "Enviar orientação de preparo" sai
// de HABILIDADES_DO_AGENTE (lib/domain/agente/config.ts), que e da frente M
// (contrato da AG7, 3.1, CFG). Ate o merge da M na agente-ag7, a habilidade
// nao existe na lista e estes casos falham (a chave nao e encontrada); com
// o merge, passam sem mudar nada aqui.
// ---------------------------------------------------------------------------

describe("[depende do merge da frente M] o cartão Enviar orientação de preparo", () => {
  const definicao = HABILIDADES_DO_AGENTE.find((h) => h.chave === PREPARO);

  it("vem da configuração, como o contrato: desligada por padrão, sem dependência", () => {
    expect(definicao).toMatchObject({
      chave: PREPARO,
      titulo: DO_DESENHO.titulo,
      descricao: DO_DESENHO.descricao,
      travada: false,
      ferramentas: ["enviar_preparo"],
      padrao: false,
      precisaDaAgenda: false,
      precisaDaHabilidade: null,
      precisaDoPrazo: null,
      dicaDaDependencia: null,
    });
    expect((habilidadesEfetivas({}) as Record<string, boolean>)[PREPARO]).toBe(
      false,
    );
  });

  it("na aba: o título, a descrição e a nota da fase de teste, entre Informar preço e convênio e Agendar consulta", () => {
    const html = habilidades();
    const visivel = texto(html);
    expect(visivel).toContain(DO_DESENHO.titulo);
    expect(visivel).toContain(DO_DESENHO.descricao);
    // Nota, nao status: so texto, sem chip nem cor propria.
    expect(html).toContain(
      `<span id="agente-habilidade-${PREPARO}-fase-de-teste" class="text-xs text-text-secondary">${NOTA_DA_FASE_DE_TESTE}</span>`,
    );
    expect(html.indexOf(DO_DESENHO.descricao)).toBeLessThan(
      html.indexOf(NOTA_DA_FASE_DE_TESTE),
    );
    const preco = html.indexOf(
      'id="agente-habilidade-informar_preco_e_convenio"',
    );
    const preparo = html.indexOf(`id="agente-habilidade-${PREPARO}"`);
    const agendar = html.indexOf('id="agente-habilidade-agendar"');
    expect(preco).toBeGreaterThan(-1);
    expect(preparo).toBeGreaterThan(preco);
    expect(agendar).toBeGreaterThan(preparo);
    // Desligada por padrao, livre para quem edita, com o estado escrito.
    const tag = chaveDa(html, PREPARO);
    expect(tag).toContain('aria-checked="false"');
    expect(tag).not.toMatch(/ disabled=""/);
    expect(tag).toContain(
      `aria-describedby="agente-habilidade-${PREPARO}-fase-de-teste"`,
    );
    expect(html).not.toMatch(presaPelaDica(PREPARO));
  });

  it.each(ESTADOS_COM_A_DICA)(
    "nenhuma orientação aprovada que saia (%s): a dica embaixo da nota, ligada ou desligada, com a chave livre",
    (estado, dica) => {
      for (const ligada of [false, true]) {
        const html = habilidades({
          habilidades: habilidadesEfetivas({ [PREPARO]: ligada }),
          preparoDaHabilidade: estado,
        });
        // Dica escrita, como a da midia que ainda nao vale (so texto).
        expect(html).toContain(
          `<span id="agente-habilidade-${PREPARO}-sem-preparo" class="text-xs font-semibold text-text-secondary">${dica}</span>`,
        );
        expect(html.indexOf(NOTA_DA_FASE_DE_TESTE)).toBeLessThan(
          html.indexOf(dica),
        );
        // Uma dica so: a do estado lido.
        for (const [outro, outraDica] of ESTADOS_COM_A_DICA) {
          if (outro !== estado) {
            expect(html).not.toContain(outraDica);
          }
        }
        const tag = chaveDa(html, PREPARO);
        expect(tag).toContain(`aria-checked="${ligada}"`);
        expect(tag).not.toMatch(/ disabled=""/);
        // A nota e a dica descrevem a chave, na ordem da tela.
        expect(tag).toContain(
          `aria-describedby="agente-habilidade-${PREPARO}-fase-de-teste agente-habilidade-${PREPARO}-sem-preparo"`,
        );
      }
    },
  );

  it("com orientação em vigor que sai, ou sem a leitura da página: sem a dica", () => {
    for (const preparoDaHabilidade of ["sai", null, undefined] as const) {
      const html = habilidades({ preparoDaHabilidade });
      for (const [, dica] of ESTADOS_COM_A_DICA) {
        expect(html, String(preparoDaHabilidade)).not.toContain(dica);
      }
      expect(html).not.toContain(`agente-habilidade-${PREPARO}-sem-preparo`);
      // A nota da fase de teste continua.
      expect(html).toContain(NOTA_DA_FASE_DE_TESTE);
    }
  });

  it("recepção: a chave visível e desabilitada, com a dica de sempre no cursor; a nota e a dica continuam", () => {
    for (const [estado, dica] of ESTADOS_COM_A_DICA) {
      const html = habilidades({
        podeEditar: false,
        dica: DICA_RECEPCAO,
        preparoDaHabilidade: estado,
      });
      expect(chaveDa(html, PREPARO)).toMatch(/ disabled=""/);
      // A dica de permissao mora no tooltip (DisabledWithHint), que o HTML
      // estatico nao abre: o que se ve e o span focavel em volta da chave.
      expect(html).toMatch(presaPelaDica(PREPARO));
      expect(html).toContain(NOTA_DA_FASE_DE_TESTE);
      expect(html, estado).toContain(dica);
    }
  });

  it(
    "o painel leva o que a página leu até a aba, também para a recepção",
    { timeout: 30_000 },
    () => {
      for (const [estado, dica] of ESTADOS_COM_A_DICA) {
        expect(
          painel(dadosDeTeste({ preparoDaHabilidade: estado })),
          estado,
        ).toContain(dica);
      }
      const comTextoQueSai = painel(
        dadosDeTeste({ preparoDaHabilidade: "sai" }),
      );
      for (const [, dica] of ESTADOS_COM_A_DICA) {
        expect(comTextoQueSai).not.toContain(dica);
      }
      const recepcao = painel(
        dadosDeTeste({
          podeEditar: false,
          dicaSemPermissao: DICA_RECEPCAO,
          preparoDaHabilidade: "sem_texto_aprovado",
        }),
      );
      expect(recepcao).toContain(DO_DESENHO.semTextoAprovado);
      expect(chaveDa(recepcao, PREPARO)).toMatch(/ disabled=""/);
      expect(recepcao).toMatch(presaPelaDica(PREPARO));
    },
  );

  it.each(ESTADOS_COM_A_DICA)(
    "a página da recepção (%s): a dica na aba",
    { timeout: 30_000 },
    async (estado, dica) => {
      sessao.atual = contexto("recepcao");
      banco.fetchPreparoDaHabilidade.mockResolvedValue(estado);
      const html = await pagina();
      expect(html).toContain(dica);
      expect(chaveDa(html, PREPARO)).toMatch(/ disabled=""/);
    },
  );

  it(
    "o que mudou: ligada no rascunho, aparece pelo título",
    { timeout: 30_000 },
    () => {
      const publicada = {
        ...configDeTeste({ base: [ITEM_ATIVO] }),
        status: "publicada" as const,
      };
      const html = painel(
        dadosDeTeste({
          config: configDeTeste({
            base: [ITEM_ATIVO],
            habilidades: habilidadesEfetivas({ [PREPARO]: true }),
          }),
          publicada,
          base: [ITEM_ATIVO],
          versoes: [VERSAO_2],
        }),
        "versoes",
      );
      expect(texto(html)).toContain("Enviar orientação de preparo: ligada");
      expect(texto(html)).toContain("1 alteração não publicada");
    },
  );

  it("sem travessão no cartão", () => {
    for (const [estado] of ESTADOS_COM_A_DICA) {
      const html = habilidades({
        podeEditar: false,
        dica: DICA_RECEPCAO,
        preparoDaHabilidade: estado,
      });
      expect(html).toContain(DO_DESENHO.titulo);
      expect(html, estado).not.toMatch(/[—–]/);
    }
  });
});
