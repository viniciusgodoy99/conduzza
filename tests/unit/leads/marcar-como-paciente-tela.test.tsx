import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Marcar como paciente" nas tres portas (decisao do dono em 20/10/2026): a
// confirmacao (quantos, que passam a aparecer em Pacientes, que a etapa nao
// muda e que nao volta pela tela), o botao de um contato, a acao em massa da
// lista de Leads, a linha Tipo da gaveta e o painel do Atendimento. Sem
// permissao: visivel, desabilitado e com a dica do projeto. O projeto nao
// tem jsdom: a tela e lida pelo HTML de renderToStaticMarkup.

function acoesFalsas() {
  return new Proxy(
    {},
    {
      get: (_alvo, chave) =>
        chave === "then" || typeof chave === "symbol" ? undefined : vi.fn(),
      has: (_alvo, chave) => chave !== "then",
    },
  );
}
vi.mock("@/app/(app)/leads/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atividades/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/iniciar-conversa-actions", () =>
  acoesFalsas(),
);
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Dialogo e gaveta renderizam no lugar (sem portal), so quando abertos.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialogo">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="gaveta">{children}</div> : null,
  SheetContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  SheetHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetFooter: ({ children }: ComponentProps<"div">) => (
    <div data-parte="rodape">{children}</div>
  ),
}));
// A dica vira atributo, para o teste ler o porque do botao desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
// As secoes vizinhas tem os proprios testes.
vi.mock("@/components/atividades/secao-de-atividades", () => ({
  SecaoDeAtividades: () => null,
}));
vi.mock("@/components/atividades/atividades-da-conversa", () => ({
  AtividadesDaConversa: () => null,
}));
vi.mock("@/components/atendimento/etiquetas-da-conversa", () => ({
  EtiquetasDaConversa: () => null,
}));
vi.mock("@/components/atendimento/etapa-do-contato", () => ({
  EtapaDoContato: () => null,
}));

const { DialogoMarcarComoPaciente, BotaoMarcarComoPaciente } =
  await import("@/components/leads/marcar-como-paciente");
const { BarraAcoesMassa } =
  await import("@/components/leads/barra-acoes-massa");
const { DrawerLead } = await import("@/components/leads/drawer-lead");
const { ContextPanel } = await import("@/components/atendimento/context-panel");
const { leadsKeys } = await import("@/lib/queries/leads");
type LeadResumo = import("@/lib/queries/leads").LeadResumo;
type LeadDetalhe = import("@/lib/queries/leads").LeadDetalhe;
type ContactSummary = import("@/lib/queries/conversations").ContactSummary;

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const DICA_LEADS = "Seu perfil não pode editar leads e pacientes";

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O botao (e o involucro da dica, quando ha) que tem o rotulo pedido. */
function botaoCom(markup: string, rotulo: string): string {
  const botoes =
    markup.match(/(<span data-dica="[^"]*">)?<button[^>]*>.*?<\/button>/g) ??
    [];
  const achado = botoes.find((botao) => texto(botao).includes(rotulo));
  expect(achado, `botão "${rotulo}"`).toBeDefined();
  return achado ?? "";
}

function semBotao(markup: string, rotulo: string): boolean {
  const botoes = markup.match(/<button[^>]*>.*?<\/button>/g) ?? [];
  return !botoes.some((botao) => texto(botao).includes(rotulo));
}

function desabilitado(botao: string): boolean {
  return /<button[^>]*\sdisabled=""/.test(botao);
}

function dicaDe(botao: string): string | null {
  return /data-dica="([^"]*)"/.exec(botao)?.[1] ?? null;
}

function comConsultas(
  no: ReactNode,
  preparar?: (cliente: QueryClient) => void,
): string {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  preparar?.(cliente);
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>{no}</QueryClientProvider>,
  );
}

function lead(campos: Partial<LeadResumo> = {}): LeadResumo {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Maria Lima",
    phone_e164: "+5585999990001",
    kind: "lead",
    funnel_stage: "em_contato",
    lost_reason: null,
    lost_reason_note: null,
    owner_user_id: null,
    tags: [],
    source_channel: null,
    source_campaign: null,
    source_origin: null,
    source_medium: null,
    source_method: null,
    source_ad_id: null,
    source_google_campaign_id: null,
    first_contact_at: "2026-10-01T12:00:00.000Z",
    last_contact_at: null,
    insurance: null,
    consent_ativo: true,
    anuncio_meta: { estado: "lida", anuncio: null },
    ...campos,
  };
}

const DETALHE_SEM_CONVERSA: LeadDetalhe = {
  conversation_id: null,
  mensagens: [],
  campanha_nome: null,
  anuncio_meta: { estado: "lida", anuncio: null },
  anuncio_whatsapp: { estado: "lida", detalhes: null },
  atividades: null,
};

describe("diálogo de confirmação", () => {
  it("um contato: diz quem, que passa a aparecer em Pacientes, que a etapa não muda e que não volta", () => {
    const html = renderToStaticMarkup(
      <DialogoMarcarComoPaciente
        aberto
        leads={1}
        nome="Maria Lima"
        onConfirmar={() => undefined}
        onFechar={() => undefined}
      />,
    );
    const frase = texto(html);
    expect(frase).toContain("Marcar como paciente?");
    expect(frase).toContain(
      "Maria Lima passa a aparecer em Pacientes, mesmo sem consulta marcada.",
    );
    expect(frase).toContain("A etapa no funil não muda.");
    expect(frase).toContain(
      "Depois de marcado, o contato não volta a ser lead pela tela.",
    );
    expect(desabilitado(botaoCom(html, "Marcar como paciente"))).toBe(false);
    expect(botaoCom(html, "Cancelar")).toBeTruthy();
    expect(frase).not.toMatch(/[\u2013\u2014]/);
  });

  it("em massa: quantos leads mudam e quantos já são pacientes", () => {
    const html = renderToStaticMarkup(
      <DialogoMarcarComoPaciente
        aberto
        leads={3}
        jaPacientes={2}
        onConfirmar={() => undefined}
        onFechar={() => undefined}
      />,
    );
    const frase = texto(html);
    expect(frase).toContain("Marcar 3 leads como pacientes?");
    expect(frase).toContain(
      "Os 3 leads passam a aparecer em Pacientes, mesmo sem consulta marcada.",
    );
    expect(frase).toContain(
      "2 dos selecionados já são pacientes e ficam como estão.",
    );
    expect(frase).toContain(
      "Depois de marcados, eles não voltam a ser leads pela tela.",
    );
    expect(botaoCom(html, "Marcar 3 como pacientes")).toBeTruthy();
    expect(frase).not.toMatch(/[\u2013\u2014]/);
  });

  it("um só já paciente na seleção fala no singular", () => {
    const html = renderToStaticMarkup(
      <DialogoMarcarComoPaciente
        aberto
        leads={2}
        jaPacientes={1}
        onConfirmar={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(texto(html)).toContain(
      "1 dos selecionados já é paciente e fica como está.",
    );
  });

  it("gravando e com erro: Marcando..., botões travados e o motivo em alerta", () => {
    const html = renderToStaticMarkup(
      <DialogoMarcarComoPaciente
        aberto
        leads={1}
        nome="Maria Lima"
        salvando
        erro="Não foi possível marcar como paciente."
        onConfirmar={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(desabilitado(botaoCom(html, "Marcando..."))).toBe(true);
    expect(desabilitado(botaoCom(html, "Cancelar"))).toBe(true);
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain("Não foi possível marcar como paciente.");
  });

  it("fechado não desenha nada", () => {
    const html = renderToStaticMarkup(
      <DialogoMarcarComoPaciente
        aberto={false}
        leads={1}
        onConfirmar={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(html).toBe("");
  });
});

describe("botão de um contato", () => {
  it("com permissão: habilitado, sem dica", () => {
    const html = renderToStaticMarkup(
      <BotaoMarcarComoPaciente
        contactId="10000000-0000-4000-8000-000000000001"
        nome="Maria Lima"
        podeEditar
        dica={DICA_LEADS}
      />,
    );
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(false);
    expect(dicaDe(botao)).toBeNull();
    expect(html).toContain("lucide-id-card");
  });

  it("sem permissão: visível, desabilitado e com a dica do projeto", () => {
    const html = renderToStaticMarkup(
      <BotaoMarcarComoPaciente
        contactId="10000000-0000-4000-8000-000000000001"
        nome="Maria Lima"
        podeEditar={false}
        dica={DICA_LEADS}
      />,
    );
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_LEADS);
  });
});

describe("ação em massa da lista de Leads", () => {
  function barra(selecionados: LeadResumo[], podeEditar = true): string {
    return comConsultas(
      <BarraAcoesMassa
        jornada={[]}
        clinicId={CLINICA}
        selecionados={selecionados}
        responsaveis={[]}
        reguas={[]}
        podeEditar={podeEditar}
        dica={DICA_LEADS}
        onLimpar={() => undefined}
        aoConcluir={() => undefined}
      />,
    );
  }

  it("com leads na seleção: habilitado", () => {
    const html = barra([
      lead({ id: "10000000-0000-4000-8000-000000000001" }),
      lead({ id: "10000000-0000-4000-8000-000000000002", kind: "paciente" }),
    ]);
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(false);
    expect(dicaDe(botao)).toBeNull();
  });

  it("só pacientes na seleção: desabilitado, dizendo por quê", () => {
    const html = barra([
      lead({ id: "10000000-0000-4000-8000-000000000001", kind: "paciente" }),
    ]);
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe("Os contatos selecionados já são pacientes.");
  });

  it("sem permissão: visível, desabilitado e com a dica do projeto", () => {
    const html = barra([lead()], false);
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_LEADS);
  });
});

describe("gaveta de Leads: a linha Tipo", () => {
  function gaveta(oLead: LeadResumo, podeEditar = true): string {
    return comConsultas(
      <DrawerLead
        clinicId={CLINICA}
        lead={oLead}
        jornada={[]}
        timezone="America/Fortaleza"
        membros={{}}
        podeEditar={podeEditar}
        dica={DICA_LEADS}
        podeAgendar
        dicaAgendar="Seu perfil não pode alterar a agenda"
        podeIniciarConversa
        dicaIniciarConversa=""
        soAtribuidas={false}
        onFechar={() => undefined}
      />,
      (cliente) =>
        cliente.setQueryData(leadsKeys.detalhe(oLead.id), DETALHE_SEM_CONVERSA),
    );
  }

  it("lead: diz Lead e oferece Marcar como paciente", () => {
    const html = gaveta(lead());
    expect(texto(html)).toContain("Tipo Lead");
    expect(desabilitado(botaoCom(html, "Marcar como paciente"))).toBe(false);
  });

  it("paciente: diz Paciente e não oferece o botão", () => {
    const html = gaveta(lead({ kind: "paciente" }));
    expect(texto(html)).toContain("Tipo Paciente");
    expect(semBotao(html, "Marcar como paciente")).toBe(true);
  });

  it("sem permissão: o botão fica visível e desabilitado, com a dica", () => {
    const html = gaveta(lead(), false);
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_LEADS);
  });
});

describe("painel do contato no Atendimento", () => {
  function contato(campos: Partial<ContactSummary> = {}): ContactSummary {
    return {
      id: "10000000-0000-4000-8000-000000000001",
      clinic_id: CLINICA,
      name: "Maria Lima",
      phone_e164: "+5585999990001",
      kind: "lead",
      funnel_stage: "em_contato",
      source_channel: null,
      source_campaign: null,
      first_contact_at: "2026-10-01T12:00:00.000Z",
      ...campos,
    };
  }

  function painel(oContato: ContactSummary, podeEditarLeads = true): string {
    return comConsultas(
      <ContextPanel
        contact={oContato}
        consent={null}
        jornada={[]}
        podeEditarLeads={podeEditarLeads}
        dicaLeads={DICA_LEADS}
        podeAgendar
        dicaAgenda="Seu perfil não pode alterar a agenda"
        aoMudarEtapa={() => undefined}
        conversationId="30000000-0000-4000-8000-000000000001"
        etiquetasDaConversa={[]}
        catalogoDeEtiquetas={[]}
        podeEtiquetar
        dicaEtiquetar=""
        ehChefia={false}
        aoEtiquetar={() => undefined}
      />,
    );
  }

  it("lead: o botão fica junto do Marcar consulta, habilitado", () => {
    const html = painel(contato());
    const acoes = texto(html);
    expect(acoes.indexOf("Marcar consulta")).toBeLessThan(
      acoes.indexOf("Marcar como paciente"),
    );
    expect(desabilitado(botaoCom(html, "Marcar como paciente"))).toBe(false);
  });

  it("paciente: o chip diz Paciente e o botão não aparece", () => {
    const html = painel(contato({ kind: "paciente" }));
    expect(texto(html)).toContain("Paciente");
    expect(semBotao(html, "Marcar como paciente")).toBe(true);
  });

  it("profissional e leitura: visível, desabilitado e com a dica", () => {
    const html = painel(contato(), false);
    const botao = botaoCom(html, "Marcar como paciente");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_LEADS);
  });
});
