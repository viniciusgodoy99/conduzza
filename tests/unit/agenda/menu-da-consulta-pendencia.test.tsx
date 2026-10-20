import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Revisao da E4 (20/10/2026): o menu da consulta, unico caminho em tela
// menor que 1280 px (o painel "Pendente de voce" so aparece de xl para cima),
// tratava toda pendencia como encaixe ("Encaixe pendente", "Aprovar
// encaixe", "Encaixe recusado.") e ignorava o aviso da recusa: a conversa
// que nao voltava para a equipe virava sucesso calado. Agora a consulta que
// a IA marcou tem os proprios rotulos, e o retorno e o mesmo do painel
// (retornoDaPendencia e mostrarRetornoDaPendencia): o aviso e warning por
// 10 s. O menu do Radix renderiza num portal so quando abre; aqui ele vira
// marcacao simples.

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => (
    <div role="group">{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div data-parte="rotulo">{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    disabled,
    className,
  }: {
    children: ReactNode;
    disabled?: boolean;
    className?: string;
  }) => (
    <div
      role="menuitem"
      aria-disabled={disabled ? "true" : undefined}
      className={className}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

const acoes = vi.hoisted(() => ({
  aprovarEncaixeAction: vi.fn(),
  recusarEncaixeAction: vi.fn(),
}));
vi.mock("@/app/(app)/agenda/actions", () => ({
  aprovarEncaixeAction: acoes.aprovarEncaixeAction,
  mudarStatusAction: vi.fn(),
  recusarEncaixeAction: acoes.recusarEncaixeAction,
  remarcarAgendamentoAction: vi.fn(),
}));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  excluirBloqueioAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/agenda/status-history-sheet", () => ({
  StatusHistorySheet: () => null,
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const {
  AppointmentMenu,
  retornoDaMudancaDeSituacao,
  rotulosDaPendenciaNoMenu,
  tratarPendenciaNoMenu,
} = await import("@/components/agenda/appointment-menu");
const { mostrarRetornoDaPendencia } =
  await import("@/components/agenda/pending-panel");
const { cancelarContaComoRecusa } = await import("@/lib/queries/agenda");

type Contexto = ComponentProps<typeof AppointmentMenu>["contexto"];
type Consulta = ComponentProps<typeof AppointmentMenu>["consulta"];

const TZ = "America/Fortaleza";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const DICA = "Seu perfil não pode alterar a agenda";
const AVISO =
  "A consulta foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.";

function contexto(podeEditar: boolean): Contexto {
  return {
    clinicId: "0a0a0a0a-0000-4000-8000-00000000000a",
    timezone: TZ,
    catalogo: {
      profissionais: [
        {
          id: JOAO,
          name: "Dr. João Pereira",
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
    },
    podeEditar,
    dica: DICA,
    viewerId: "usuario",
    podeEditarCadastros: true,
    dicaCadastros: "Somente administradores e gestores alteram cadastros",
    podeRegistrarAutorizacao: true,
    dicaAutorizacao: "",
  };
}

// A consulta que a IA marcou, pendente da equipe (D12).
const DA_IA: Consulta = {
  id: "c0c0c0c0-0000-4000-8000-000000000001",
  unit_id: null,
  contact_id: "3d3d3d3d-0000-4000-8000-000000000001",
  professional_id: JOAO,
  service_link_id: "2c2c2c2c-0000-4000-8000-000000000001",
  resource_id: null,
  starts_at: "2026-10-23T18:00:00.000Z",
  ends_at: "2026-10-23T18:30:00.000Z",
  status: "agendado",
  confirmation_channel: null,
  is_overbooking: false,
  created_by: "ia",
  approval_status: "pendente",
  send_confirmation: false,
  notes: null,
  contact: { id: "c1", name: "Maria Souza", phone_e164: "+5585999990000" },
  service_link: {
    id: "2c2c2c2c-0000-4000-8000-000000000001",
    duration_min: 30,
    procedure: { id: "p1", name: "Consulta" },
    insurance: null,
  },
} as Consulta;

const ENCAIXE: Consulta = { ...DA_IA, is_overbooking: true } as Consulta;

function render(consulta: Consulta, podeEditar = true): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AppointmentMenu
        contexto={contexto(podeEditar)}
        consulta={consulta}
        bloqueios={[]}
      >
        <button type="button">Maria Souza</button>
      </AppointmentMenu>
    </QueryClientProvider>,
  );
}

function item(html: string, rotulo: string): string {
  const achado = new RegExp(
    `<div role="menuitem"[^>]*>(?:(?!</div>).)*${rotulo}</span></div>`,
  ).exec(html);
  if (!achado) {
    throw new Error(`item ${rotulo} não encontrado`);
  }
  return achado[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("menu da consulta: qual pendência é qual", () => {
  it("a consulta que a IA marcou não é encaixe", () => {
    const html = render(DA_IA);
    expect(html).toContain("Consulta marcada pela IA");
    expect(item(html, "Aprovar consulta")).toContain("h-10");
    expect(item(html, "Recusar consulta")).toContain("h-10");
    expect(html).not.toMatch(/encaixe/i);
  });

  it("o encaixe da IA continua encaixe", () => {
    const html = render(ENCAIXE);
    expect(html).toContain("Encaixe pendente");
    expect(html).toContain("Aprovar encaixe");
    expect(html).toContain("Recusar encaixe");
    expect(html).not.toContain("Consulta marcada pela IA");
  });

  it("sem permissão: visíveis e desabilitados, com a dica", () => {
    const html = render(DA_IA, false);
    expect(item(html, "Aprovar consulta")).toContain('aria-disabled="true"');
    expect(item(html, "Recusar consulta")).toContain('aria-disabled="true"');
    expect(html).toContain(DICA);
  });

  it("rótulos sem travessão e sem jargão", () => {
    for (const daIa of [true, false]) {
      for (const texto of Object.values(rotulosDaPendenciaNoMenu(daIa))) {
        expect(texto).not.toMatch(/[—–]/);
        expect(texto).not.toMatch(/\b(slot|hold|handoff|tenant|opt-in)\b/i);
      }
    }
  });
});

describe("menu da consulta: o retorno é o do painel", () => {
  it("recusa com aviso (a conversa não voltou): warning por 10 s, nunca sucesso calado", async () => {
    acoes.recusarEncaixeAction.mockResolvedValue({ ok: true, aviso: AVISO });
    const retorno = await tratarPendenciaNoMenu(DA_IA, "recusar");
    expect(acoes.recusarEncaixeAction).toHaveBeenCalledWith(DA_IA.id);
    expect(retorno).toEqual({ tipo: "warning", texto: AVISO });
    mostrarRetornoDaPendencia(retorno);
    expect(toast.warning).toHaveBeenCalledWith(AVISO, { duration: 10_000 });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("consulta da IA aprovada ou recusada pede para avisar o paciente", async () => {
    acoes.aprovarEncaixeAction.mockResolvedValue({ ok: true });
    acoes.recusarEncaixeAction.mockResolvedValue({ ok: true });
    expect(await tratarPendenciaNoMenu(DA_IA, "aprovar")).toEqual({
      tipo: "success",
      texto: "Consulta aprovada. Avise o paciente pelo Atendimento.",
    });
    expect(await tratarPendenciaNoMenu(DA_IA, "recusar")).toEqual({
      tipo: "success",
      texto: "Consulta recusada. Avise o paciente pelo Atendimento.",
    });
    expect(await tratarPendenciaNoMenu(ENCAIXE, "aprovar")).toEqual({
      tipo: "success",
      texto: "Encaixe aprovado",
    });
  });

  it("já tratada é informação; ação que lança é o erro de sempre", async () => {
    acoes.aprovarEncaixeAction.mockResolvedValue({
      ok: false,
      code: "ja_tratado",
      error: "Esta consulta já foi tratada.",
    });
    expect(await tratarPendenciaNoMenu(DA_IA, "aprovar")).toEqual({
      tipo: "info",
      texto: "Esta consulta já foi tratada.",
    });
    acoes.recusarEncaixeAction.mockRejectedValue(new Error("rede"));
    expect(await tratarPendenciaNoMenu(DA_IA, "recusar")).toEqual({
      tipo: "error",
      texto: "Não foi possível tratar a consulta. Tente de novo.",
    });
  });
});

// Decisao do dono de 20/10/2026: cancelar pela mudanca de situacao a
// pendencia da IA conta como recusar. A acao devolve `recusada`, e a tela
// diz o mesmo que o Recusar (com o aviso da conversa que nao voltou como
// atencao por 10 s); o dialogo de cancelar nao pergunta da lista de
// espera, que a recusa nunca aciona.
describe("menu da consulta: cancelar a pendência da IA conta como recusar", () => {
  it("a ação diz que recusou: o retorno é o do Recusar, nunca a situação escolhida", () => {
    expect(
      retornoDaMudancaDeSituacao(
        { ok: true, recusada: "consulta_da_ia" },
        "cancelado_paciente",
      ),
    ).toEqual({
      tipo: "success",
      texto: "Consulta recusada. Avise o paciente pelo Atendimento.",
    });
    expect(
      retornoDaMudancaDeSituacao(
        { ok: true, recusada: "encaixe" },
        "cancelado_clinica",
      ),
    ).toEqual({ tipo: "success", texto: "Encaixe recusado" });
  });

  it("a conversa que não voltou é atenção por 10 s, nunca sucesso calado", () => {
    const retorno = retornoDaMudancaDeSituacao(
      { ok: true, recusada: "consulta_da_ia", aviso: AVISO },
      "cancelado_clinica",
    );
    expect(retorno).toEqual({ tipo: "warning", texto: AVISO });
    mostrarRetornoDaPendencia(retorno);
    expect(toast.warning).toHaveBeenCalledWith(AVISO, { duration: 10_000 });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sem recusa, a mudança de situação diz o de sempre", () => {
    expect(
      retornoDaMudancaDeSituacao({ ok: true }, "cancelado_paciente"),
    ).toEqual({
      tipo: "success",
      texto: "Situação mudada para Cancelado pelo paciente.",
    });
    expect(
      retornoDaMudancaDeSituacao(
        {
          ok: false,
          code: "ja_tratado",
          error: "Esta consulta já foi tratada.",
        },
        "cancelado_clinica",
      ),
    ).toEqual({ tipo: "error", texto: "Esta consulta já foi tratada." });
    expect(retornoDaMudancaDeSituacao({ ok: false }, "faltou")).toEqual({
      tipo: "error",
      texto: "Não foi possível mudar a situação.",
    });
  });

  it("só a pendência da IA conta como recusa (e o diálogo não oferece a vaga)", () => {
    expect(cancelarContaComoRecusa(DA_IA)).toBe(true);
    expect(cancelarContaComoRecusa(ENCAIXE)).toBe(true);
    expect(
      cancelarContaComoRecusa({ ...DA_IA, approval_status: "aprovado" }),
    ).toBe(false);
    expect(
      cancelarContaComoRecusa({
        ...DA_IA,
        created_by: "usuario",
        approval_status: null,
      }),
    ).toBe(false);
  });
});
