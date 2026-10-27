import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { APPOINTMENT_STATUS } from "@/lib/design/status";
import type { AgendaDia, ConsultaDaAgenda } from "@/lib/queries/agenda";
import type { Catalogo } from "@/lib/queries/catalogo";

// Revisao curta das correcoes da AG4 (remarcar e cancelar pela IA), achados
// baixos das telas, com a tela de verdade e as acoes dubladas:
//   1. o sucesso da remarcacao (o da recusa tem uns 200 caracteres, com o
//      "Manter o horário" entre aspas) fica 10 s, no dialogo e no retorno
//      das pendencias; a antiga que nao carregou diz o que fazer;
//   2. o dialogo do arrastar: a recusa por remarcacao da IA pendente deixa o
//      dialogo aberto, refaz a agenda e trava o Remarcar; a acao que lanca
//      nao prende o "Remarcando..." nem rejeita;
//   3. as transicoes do menu (mudar a situacao e o Remarcar) nao rejeitam
//      quando a acao lanca (a transicao rejeitada derrubava a Agenda), e a
//      lista do "Pendente de você" que falha no servidor nao derruba a
//      pagina: so o painel diz que carrega ou que nao carregou.
// O projeto nao tem jsdom: a tela sai de renderToStaticMarkup e o clique e o
// onClick do botao de verdade, guardado na renderizacao (o Button real,
// embrulhado). Depois do render no servidor o setState nao re-renderiza:
// o que o clique faz aparece nas acoes, no toast, na invalidacao e no fechar.

const acoes = vi.hoisted(() => ({
  aprovarEncaixeAction: vi.fn(),
  aprovarRemarcacaoAction: vi.fn(),
  mudarStatusAction: vi.fn(),
  recusarEncaixeAction: vi.fn(),
  recusarRemarcacaoAction: vi.fn(),
  remarcarAgendamentoAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
const leituras = vi.hoisted(() => ({
  fetchAgendaDia: vi.fn(),
  fetchPendencias: vi.fn(),
  fetchCatalogo: vi.fn(),
}));
type PropsDoBotao = {
  children?: ReactNode;
  onClick?: () => unknown;
  disabled?: boolean;
  className?: string;
};
const botoes = vi.hoisted(() => ({ lista: [] as PropsDoBotao[] }));

vi.mock("@/components/ui/button", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...real,
    // O Button de verdade (sem hook), com as props guardadas para o clique.
    Button: (props: ComponentProps<typeof real.Button>) => {
      botoes.lista.push(props as PropsDoBotao);
      return real.Button(props);
    },
  };
});
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-parte="descricao">{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));
vi.mock("@/app/(app)/agenda/actions", () => acoes);
vi.mock("@/app/(app)/cadastros/actions", () => ({
  excluirBloqueioAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/agenda/status-history-sheet", () => ({
  StatusHistorySheet: () => null,
}));
vi.mock("sonner", () => ({ toast }));

// A pagina da Agenda (Server Component), com as leituras dubladas.
const sessao = vi.hoisted(() => ({
  userId: "e1e1e1e1-0000-4000-8000-000000000001",
  active: {
    clinicId: "0a0a0a0a-0000-4000-8000-00000000000a",
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "recepcao",
    status: "ativo",
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: async () => undefined,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/queries/agenda", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/agenda")>()),
  fetchAgendaDia: leituras.fetchAgendaDia,
  fetchPendencias: leituras.fetchPendencias,
}));
vi.mock("@/lib/queries/catalogo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/catalogo")>()),
  fetchCatalogo: leituras.fetchCatalogo,
}));

const { DialogoDaRemarcacao } =
  await import("@/components/agenda/dialogo-da-remarcacao");
const {
  estadoDasPendencias,
  mostrarRetornoDaPendencia,
  PendingPanel,
  retornoDaPendencia,
  TEXTOS_DO_PAINEL,
} = await import("@/components/agenda/pending-panel");
const { DialogoDoArrasto, desfechoDoArrasto } =
  await import("@/components/agenda/day-grid");
const { mudarSituacaoNoMenu, remarcarPeloMenu } =
  await import("@/components/agenda/appointment-menu");
const R = await import("@/components/agenda/remarcacao-da-ia");
const { AgendaClient } = await import("@/app/(app)/agenda/agenda-client");
const { default: AgendaPage } = await import("@/app/(app)/agenda/page");

type Contexto = ComponentProps<typeof PendingPanel>["contexto"];

const CLINICA = sessao.active.clinicId;
const FUSO = "America/Fortaleza";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const NOVA = "c0c0c0c0-0000-4000-8000-0000000000a1";
const ANTIGA = "c0c0c0c0-0000-4000-8000-0000000000a0";
// 29/10/2026 14:00 e 03/11/2026 10:00 em Fortaleza (UTC-3).
const INICIO_DA_ANTIGA = "2026-10-29T17:00:00.000Z";
const INICIO_DA_NOVA = "2026-11-03T13:00:00.000Z";
const DICA_DA_ANTIGA =
  "Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.";

const CATALOGO: Catalogo = {
  profissionais: [
    {
      id: JOAO,
      name: "Dra. Ana Lima",
      photo_url: null,
      council_type: null,
      council_number: null,
      specialties: [],
      calendar_color: null,
      active: true,
    },
  ],
  jornadas: [],
  recursos: [],
  procedimentos: [],
  convenios: [],
  vinculos: [],
  pacotes: [],
  unidades: [],
};

function contexto(extra: Partial<Contexto> = {}): Contexto {
  return {
    clinicId: CLINICA,
    timezone: FUSO,
    catalogo: CATALOGO,
    podeEditar: true,
    dica: "Seu perfil não pode alterar a agenda",
    viewerId: "usuario",
    podeEditarCadastros: false,
    dicaCadastros: "",
    podeRegistrarAutorizacao: false,
    dicaAutorizacao: "",
    ...extra,
  };
}

const ANTIGA_CONSULTA: ConsultaDaAgenda = {
  id: ANTIGA,
  unit_id: null,
  contact_id: "3d3d3d3d-0000-4000-8000-000000000001",
  professional_id: JOAO,
  service_link_id: "2c2c2c2c-0000-4000-8000-000000000001",
  resource_id: null,
  starts_at: INICIO_DA_ANTIGA,
  ends_at: "2026-10-29T17:30:00.000Z",
  status: "confirmado_paciente",
  confirmation_channel: "whatsapp",
  is_overbooking: false,
  created_by: "usuario",
  approval_status: null,
  send_confirmation: true,
  notes: null,
  contact: {
    id: "3d3d3d3d-0000-4000-8000-000000000001",
    name: "Paciente de Teste",
    phone_e164: "5584900000000",
  },
  service_link: {
    id: "2c2c2c2c-0000-4000-8000-000000000001",
    duration_min: 30,
    procedure: { id: "p1", name: "Limpeza de pele" },
    insurance: null,
  },
  remarcacao_de: null,
  antiga: null,
};

const REMARCACAO: ConsultaDaAgenda = {
  ...ANTIGA_CONSULTA,
  id: NOVA,
  starts_at: INICIO_DA_NOVA,
  ends_at: "2026-11-03T13:30:00.000Z",
  status: "agendado",
  confirmation_channel: null,
  created_by: "ia",
  approval_status: "pendente",
  send_confirmation: false,
  remarcacao_de: ANTIGA,
  antiga: {
    id: ANTIGA,
    starts_at: INICIO_DA_ANTIGA,
    ends_at: "2026-10-29T17:30:00.000Z",
    status: "confirmado_paciente",
    professional_id: JOAO,
  },
};

const DIA_VAZIO: AgendaDia = { consultas: [], bloqueios: [], holds: [] };

function desenhar(no: ReactNode, cliente = new QueryClient()): string {
  botoes.lista.length = 0;
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>
      <TooltipProvider>{no}</TooltipProvider>
    </QueryClientProvider>,
  );
}

/** As props do ultimo botao desenhado com este rotulo. */
function botao(rotulo: string): PropsDoBotao {
  const achado = botoes.lista.findLast((props) => props.children === rotulo);
  if (!achado) {
    throw new Error(`botao ${rotulo} nao encontrado`);
  }
  return achado;
}

/** Deixa correr o que o clique encadeou (a acao dublada responde na hora). */
async function deixarCorrer(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clienteEspiao() {
  const cliente = new QueryClient();
  const invalidar = vi
    .spyOn(cliente, "invalidateQueries")
    .mockResolvedValue(undefined);
  return { cliente, invalidar };
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("1. o sucesso da remarcação fica na tela até ser lido", () => {
  const RECUSADA = R.sucessoDoRecusar(
    { starts_at: INICIO_DA_ANTIGA, situacao: "viva" },
    FUSO,
  );

  it("a recusa com a antiga marcada: o botão entre aspas, e o texto passa dos 200 caracteres", () => {
    expect(RECUSADA).toBe(
      'Remarcação recusada. A consulta de 29/10 às 14:00 continua marcada, com o pedido de remarcação: a confirmação automática fica parada até alguém usar "Manter o horário", em Confirmações. Avise o paciente pelo Atendimento.',
    );
    expect(RECUSADA.length).toBeGreaterThan(200);
  });

  it("Recusar remarcação de verdade: o sucesso do servidor fica 10 s, fecha e refaz a agenda", async () => {
    acoes.recusarRemarcacaoAction.mockResolvedValueOnce({
      ok: true,
      mensagem: RECUSADA,
    });
    const aoFechar = vi.fn();
    const aoTerminar = vi.fn();
    desenhar(
      <DialogoDaRemarcacao
        contexto={contexto()}
        consulta={REMARCACAO}
        acao="recusar"
        aoFechar={aoFechar}
        aoTerminar={aoTerminar}
      />,
    );
    botao("Recusar remarcação").onClick?.();
    await deixarCorrer();
    expect(acoes.recusarRemarcacaoAction).toHaveBeenCalledWith(NOVA);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(RECUSADA, { duration: 10_000 });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(aoTerminar).toHaveBeenCalledTimes(1);
  });

  it("Aprovar remarcação de verdade: o sucesso e a atenção, os dois por 10 s", async () => {
    const aprovada =
      "Remarcação aprovada. A consulta de 29/10 às 14:00 foi cancelada.";
    const naoSaiu =
      "O paciente não autorizou receber mensagens. Avise por telefone.";
    acoes.aprovarRemarcacaoAction.mockResolvedValueOnce({
      ok: true,
      mensagem: aprovada,
      aviso: naoSaiu,
    });
    desenhar(
      <DialogoDaRemarcacao
        contexto={contexto()}
        consulta={REMARCACAO}
        acao="aprovar"
        aoFechar={() => undefined}
      />,
    );
    botao("Aprovar remarcação").onClick?.();
    await deixarCorrer();
    expect(acoes.aprovarRemarcacaoAction).toHaveBeenCalledWith({
      id: NOVA,
      avisar_paciente: true,
    });
    expect(toast.success).toHaveBeenCalledWith(aprovada, { duration: 10_000 });
    expect(toast.warning).toHaveBeenCalledWith(naoSaiu, { duration: 10_000 });
  });

  it("o retorno das pendências: o texto do servidor 10 s; o de sempre continua no padrão", () => {
    const retorno = retornoDaPendencia(
      { ok: true, mensagem: RECUSADA },
      "recusar",
      true,
    );
    expect(retorno).toEqual({
      tipo: "success",
      texto: RECUSADA,
      duracao: 10_000,
    });
    mostrarRetornoDaPendencia(retorno);
    expect(toast.success).toHaveBeenLastCalledWith(RECUSADA, {
      duration: 10_000,
    });
    // Sem texto do servidor (encaixe, consulta da IA), o padrao do sonner:
    // a chamada vai sem opcoes.
    mostrarRetornoDaPendencia(
      retornoDaPendencia({ ok: true }, "aprovar", false),
    );
    expect(toast.success.mock.lastCall).toEqual(["Encaixe aprovado"]);
    // A atencao continua 10 s; o erro e a informacao, no padrao.
    mostrarRetornoDaPendencia({ tipo: "warning", texto: "Ligue." });
    expect(toast.warning).toHaveBeenLastCalledWith("Ligue.", {
      duration: 10_000,
    });
    mostrarRetornoDaPendencia({ tipo: "error", texto: "Erro." });
    expect(toast.error.mock.lastCall).toEqual(["Erro."]);
    mostrarRetornoDaPendencia({ tipo: "info", texto: "Já tratada." });
    expect(toast.info.mock.lastCall).toEqual(["Já tratada."]);
  });

  it("a antiga que não carregou diz o que fazer, no cartão e no diálogo", () => {
    expect(R.TEXTOS_DA_REMARCACAO.antigaNaoCarregada).toBe(
      "Não foi possível carregar a consulta antiga. Atualize a página ou abra a consulta para conferir.",
    );
    expect(R.TEXTOS_DA_REMARCACAO.antigaNaoCarregadaNoDialogo).toBe(
      "Não foi possível carregar a consulta antiga. Ela é conferida de novo quando você aprovar ou recusar.",
    );
    const html = desenhar(
      <PendingPanel
        contexto={contexto()}
        pendencias={[{ ...REMARCACAO, antiga: null, erroNaAntiga: true }]}
      />,
    );
    expect(texto(html)).toContain(R.TEXTOS_DA_REMARCACAO.antigaNaoCarregada);
  });
});

// ---------------------------------------------------------------------------

describe("2. o diálogo do arrastar", () => {
  // Arrastada para 15:00 do mesmo dia, com a mesma profissional.
  const SOLTURA = {
    consulta: ANTIGA_CONSULTA,
    novoInicio: new Date("2026-10-29T18:00:00.000Z"),
    novoProfissionalId: JOAO,
  };
  const PEDIDO = {
    id: ANTIGA,
    starts_at_esperado: INICIO_DA_ANTIGA,
    novo_starts_at: "2026-10-29T18:00:00.000Z",
    novo_professional_id: JOAO,
    avisar_paciente: true,
  };

  function arrasto(extra: Partial<Contexto> = {}, cliente?: QueryClient) {
    const aoFechar = vi.fn();
    const html = desenhar(
      <DialogoDoArrasto
        contexto={contexto(extra)}
        remarcacao={SOLTURA}
        onFechar={aoFechar}
      />,
      cliente,
    );
    return { html, aoFechar };
  }

  it("aberto com o Remarcar livre, sem a remarcação da IA", () => {
    const { html } = arrasto();
    expect(html).toContain("<h2>Remarcar consulta</h2>");
    expect(botao("Remarcar").disabled).toBe(false);
    expect(botao("Remarcar").className).toContain("h-10");
    expect(html).not.toContain(DICA_DA_ANTIGA);
  });

  it("remarcacao_pendente: o diálogo fica aberto, a agenda é refeita e nada de sucesso", async () => {
    acoes.remarcarAgendamentoAction.mockResolvedValueOnce({
      ok: false,
      code: "remarcacao_pendente",
      error: DICA_DA_ANTIGA,
    });
    const { cliente, invalidar } = clienteEspiao();
    const { aoFechar } = arrasto({}, cliente);
    await botao("Remarcar").onClick?.();
    await deixarCorrer();
    expect(acoes.remarcarAgendamentoAction).toHaveBeenCalledWith(PEDIDO);
    expect(invalidar).toHaveBeenCalledTimes(1);
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["agenda", CLINICA] });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("o que o diálogo faz com cada resposta: só a remarcação pendente trava e refaz", () => {
    expect(
      desfechoDoArrasto({
        ok: false,
        code: "remarcacao_pendente",
        error: DICA_DA_ANTIGA,
      }),
    ).toEqual({
      fechar: false,
      erro: DICA_DA_ANTIGA,
      travar: true,
      atualizarAgenda: true,
    });
    expect(
      desfechoDoArrasto({ ok: false, code: "remarcacao_pendente" }),
    ).toEqual({
      fechar: false,
      erro: DICA_DA_ANTIGA,
      travar: true,
      atualizarAgenda: true,
    });
    // O que a recepcao corrige e o erro generico: aberto, livre, sem refazer.
    expect(
      desfechoDoArrasto({ ok: false, code: "conflito", error: "Ocupado." }),
    ).toEqual({
      fechar: false,
      erro: "Ocupado.",
      travar: false,
      atualizarAgenda: false,
    });
    expect(desfechoDoArrasto({ ok: false })).toEqual({
      fechar: false,
      erro: "Não foi possível remarcar.",
      travar: false,
      atualizarAgenda: false,
    });
    // Deu certo: o sucesso e, se o aviso nao saiu, a atencao.
    expect(desfechoDoArrasto({ ok: true, aviso: "Ligue." })).toEqual({
      fechar: true,
      avisos: [
        { tipo: "success", texto: "Consulta remarcada." },
        { tipo: "warning", texto: "Ligue." },
      ],
    });
  });

  it("com a remarcação da IA na lista (a agenda refeita): o Remarcar travado, com a dica", () => {
    const { html } = arrasto({
      remarcacaoPendenteDe: (id) => (id === ANTIGA ? REMARCACAO : null),
    });
    expect(botao("Remarcar").disabled).toBe(true);
    expect(html).toMatch(
      new RegExp(
        `<div role="alert" data-tom="alert"[^>]*>(?:(?!</div></div>).)*lucide-octagon-alert(?:(?!</div></div>).)*${DICA_DA_ANTIGA}`,
      ),
    );
    // O Cancelar continua livre.
    expect(botao("Cancelar").disabled).toBeUndefined();
  });

  it("a ação que lança: o clique não rejeita, o diálogo fica aberto e nada de sucesso", async () => {
    acoes.remarcarAgendamentoAction.mockRejectedValueOnce(new Error("rede"));
    const { cliente, invalidar } = clienteEspiao();
    const { aoFechar } = arrasto({}, cliente);
    await expect(
      Promise.resolve(botao("Remarcar").onClick?.()),
    ).resolves.toBeUndefined();
    await deixarCorrer();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(invalidar).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("deu certo: o sucesso, a agenda e o histórico refeitos, e fecha", async () => {
    acoes.remarcarAgendamentoAction.mockResolvedValueOnce({ ok: true });
    const { cliente, invalidar } = clienteEspiao();
    const { aoFechar } = arrasto({}, cliente);
    await botao("Remarcar").onClick?.();
    expect(toast.success).toHaveBeenCalledWith("Consulta remarcada.");
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["agenda", CLINICA] });
    expect(invalidar).toHaveBeenCalledWith({
      queryKey: ["agenda", "historico", ANTIGA],
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe("3. a Agenda não cai por uma chamada que falha", () => {
  it("mudar a situação pelo menu: a ação que lança vira o erro de sempre, sem rejeitar", async () => {
    acoes.mudarStatusAction.mockRejectedValueOnce(new Error("rede"));
    const pedido = {
      id: ANTIGA,
      status_atual: "confirmado_paciente" as const,
      novo_status: "cancelado_clinica" as const,
      canal: null,
      oferecer_vaga: false,
    };
    await expect(mudarSituacaoNoMenu(pedido)).resolves.toEqual({
      ok: false,
      retorno: { tipo: "error", texto: "Não foi possível mudar a situação." },
    });
    expect(acoes.mudarStatusAction).toHaveBeenCalledWith(pedido);
    // A resposta de sempre continua a de sempre.
    acoes.mudarStatusAction.mockResolvedValueOnce({ ok: true });
    await expect(mudarSituacaoNoMenu(pedido)).resolves.toEqual({
      ok: true,
      retorno: {
        tipo: "success",
        texto: `Situação mudada para ${APPOINTMENT_STATUS.cancelado_clinica.label}.`,
      },
    });
  });

  it("o Remarcar do menu: a ação que lança e o horário que não vira instante viram o erro de sempre", async () => {
    const pedido = {
      consulta: { id: ANTIGA, starts_at: INICIO_DA_ANTIGA },
      timezone: FUSO,
      dia: "2026-10-30",
      hora: "15:00",
      profissionalId: JOAO,
      avisarPaciente: false,
    };
    const ERRO = {
      fechar: true,
      avisos: [{ tipo: "error", texto: "Não foi possível remarcar." }],
      atualizarAgenda: false,
    };
    acoes.remarcarAgendamentoAction.mockRejectedValueOnce(new Error("rede"));
    await expect(remarcarPeloMenu(pedido)).resolves.toEqual(ERRO);
    // 30/10 15:00 em Fortaleza.
    expect(acoes.remarcarAgendamentoAction).toHaveBeenCalledWith({
      id: ANTIGA,
      starts_at_esperado: INICIO_DA_ANTIGA,
      novo_starts_at: "2026-10-30T18:00:00.000Z",
      novo_professional_id: JOAO,
      avisar_paciente: false,
    });
    acoes.remarcarAgendamentoAction.mockClear();
    await expect(remarcarPeloMenu({ ...pedido, hora: "xx" })).resolves.toEqual(
      ERRO,
    );
    expect(acoes.remarcarAgendamentoAction).not.toHaveBeenCalled();
    // A resposta de sempre continua a de sempre (desfechoDoRemarcar).
    acoes.remarcarAgendamentoAction.mockResolvedValueOnce({
      ok: false,
      code: "remarcacao_pendente",
      error: DICA_DA_ANTIGA,
    });
    await expect(remarcarPeloMenu(pedido)).resolves.toEqual({
      fechar: true,
      avisos: [{ tipo: "error", texto: DICA_DA_ANTIGA }],
      atualizarAgenda: true,
    });
  });

  it("o menu só chama as ações pelas funções que não rejeitam", () => {
    // As transicoes do menu nao rodam no render do servidor (o
    // startTransition dele lanca): a guarda e que toda acao do menu passe
    // por tratarPendenciaNoMenu, mudarSituacaoNoMenu ou remarcarPeloMenu,
    // as tres com try/catch e testadas acima (a transicao assincrona que
    // rejeita leva a Agenda para a tela de erro).
    const fonte = readFileSync(
      path.resolve(
        __dirname,
        "../../../components/agenda/appointment-menu.tsx",
      ),
      "utf8",
    );
    const chamadas = (nome: string) =>
      fonte.split(new RegExp(`await ${nome}\\(`)).length - 1;
    for (const acao of [
      "mudarStatusAction",
      "remarcarAgendamentoAction",
      "aprovarEncaixeAction",
      "recusarEncaixeAction",
    ]) {
      expect(chamadas(acao), acao).toBe(1);
    }
    expect(chamadas("mudarSituacaoNoMenu")).toBe(1);
    expect(chamadas("remarcarPeloMenu")).toBe(1);
    expect(chamadas("tratarPendenciaNoMenu")).toBe(1);
  });

  it("o estado do painel pela leitura da lista, como a grade do dia", () => {
    expect(
      estadoDasPendencias({
        data: undefined,
        isError: false,
        isFetching: true,
      }),
    ).toBe("carregando");
    expect(
      estadoDasPendencias({
        data: undefined,
        isError: false,
        isFetching: false,
      }),
    ).toBe("carregando");
    expect(
      estadoDasPendencias({
        data: undefined,
        isError: true,
        isFetching: false,
      }),
    ).toBe("erro");
    // Tentando de novo: carregando, e nao o erro de antes.
    expect(
      estadoDasPendencias({ data: undefined, isError: true, isFetching: true }),
    ).toBe("carregando");
    // Com a lista, ela (mesmo vazia, mesmo com uma releitura que falhou).
    expect(
      estadoDasPendencias({ data: [], isError: true, isFetching: false }),
    ).toBe("pronto");
  });

  it("o painel sem a lista: carregando, sem o vazio; e o erro com Tentar de novo de 40px", () => {
    const carregando = desenhar(
      <PendingPanel
        contexto={contexto()}
        pendencias={[]}
        estado="carregando"
      />,
    );
    expect(carregando).toContain(`aria-label="${TEXTOS_DO_PAINEL.carregando}"`);
    expect(carregando).toContain('data-slot="skeleton"');
    expect(texto(carregando)).not.toContain(TEXTOS_DO_PAINEL.vazioTitulo);
    // A legenda continua.
    expect(texto(carregando)).toContain(TEXTOS_DO_PAINEL.legenda);

    const tentarDeNovo = vi.fn();
    const erro = desenhar(
      <PendingPanel
        contexto={contexto()}
        pendencias={[]}
        estado="erro"
        aoTentarDeNovo={tentarDeNovo}
      />,
    );
    expect(erro).toMatch(
      new RegExp(
        `<div role="alert" data-tom="alert"[^>]*>(?:(?!</div></div>).)*lucide-octagon-alert(?:(?!</div></div>).)*${TEXTOS_DO_PAINEL.erro}`,
      ),
    );
    expect(texto(erro)).not.toContain(TEXTOS_DO_PAINEL.vazioTitulo);
    expect(texto(erro)).toContain(TEXTOS_DO_PAINEL.legenda);
    const botaoDeNovo = botao("Tentar de novo");
    expect(botaoDeNovo.className).toContain("h-10");
    botaoDeNovo.onClick?.();
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
    // Com a lista, o de sempre.
    expect(
      texto(desenhar(<PendingPanel contexto={contexto()} pendencias={[]} />)),
    ).toContain(TEXTOS_DO_PAINEL.vazioTitulo);
  });

  it("a página: a lista que falha no servidor não derruba a Agenda; o cliente lê de novo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z"));
    leituras.fetchCatalogo.mockResolvedValueOnce(CATALOGO);
    leituras.fetchAgendaDia.mockResolvedValueOnce(DIA_VAZIO);
    leituras.fetchPendencias.mockRejectedValueOnce(new Error("leitura"));
    const pagina = (await AgendaPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactNode }>;
    const cliente = pagina.props.children;
    if (!isValidElement<ComponentProps<typeof AgendaClient>>(cliente)) {
      throw new Error("a pagina nao desenhou a Agenda");
    }
    expect(cliente.type).toBe(AgendaClient);
    expect(cliente.props.pendenciasIniciais).toBeNull();
    expect(cliente.props.diaInicialDados).toBe(DIA_VAZIO);
    expect(cliente.props.catalogoInicial).toBe(CATALOGO);
    expect(cliente.props.diaInicial).toBe("2026-10-29");

    // A tela abre: a grade com a coluna da profissional e o painel
    // carregando (o cliente le de novo), nunca "Nada pendente de você".
    const html = desenhar(pagina);
    expect(html).toContain("Dra. Ana Lima");
    expect(html).toContain(`aria-label="${TEXTOS_DO_PAINEL.carregando}"`);
    expect(texto(html)).not.toContain(TEXTOS_DO_PAINEL.vazioTitulo);
  });

  it("a página com a lista lida: o painel como sempre", async () => {
    leituras.fetchCatalogo.mockResolvedValueOnce(CATALOGO);
    leituras.fetchAgendaDia.mockResolvedValueOnce(DIA_VAZIO);
    leituras.fetchPendencias.mockResolvedValueOnce([]);
    const pagina = (await AgendaPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactNode }>;
    const cliente = pagina.props.children as ReactElement<
      ComponentProps<typeof AgendaClient>
    >;
    expect(cliente.props.pendenciasIniciais).toEqual([]);
    const html = desenhar(pagina);
    expect(texto(html)).toContain(TEXTOS_DO_PAINEL.vazioTitulo);
    expect(html).not.toContain(`aria-label="${TEXTOS_DO_PAINEL.carregando}"`);
  });
});

// ---------------------------------------------------------------------------

describe("cópia", () => {
  it("sem travessão e sem jargão", () => {
    const semResposta = desfechoDoArrasto({ ok: false });
    const amostras = [
      R.sucessoDoRecusar(
        { starts_at: INICIO_DA_ANTIGA, situacao: "viva" },
        FUSO,
      ),
      R.TEXTOS_DA_REMARCACAO.antigaNaoCarregada,
      R.TEXTOS_DA_REMARCACAO.antigaNaoCarregadaNoDialogo,
      TEXTOS_DO_PAINEL.carregando,
      TEXTOS_DO_PAINEL.erro,
      TEXTOS_DO_PAINEL.tentarDeNovo,
      semResposta.fechar ? "" : semResposta.erro,
    ];
    for (const amostra of amostras) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(
        /\b(slot|hold|handoff|tenant|opt-in|query|fetch)\b/i,
      );
    }
  });
});
