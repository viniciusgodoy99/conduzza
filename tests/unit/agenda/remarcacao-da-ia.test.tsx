import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CalendarCog,
  CalendarFold,
  CalendarSync,
  Sparkles,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ACCESS_LEVEL_STATUS,
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
  ATIVIDADE_STATUS,
  CONSENT_STATUS,
  CONTACT_RECENCY,
  CONVERSAO_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  IA_AGENDA_STATUS,
  MENSAGEM_AGENDADA_STATUS,
  PATIENT_TAG,
  RECORD_STATUS,
  REGUA_STATUS,
  TOKEN_META_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// Remarcacao pedida pela IA na Agenda (AG4; desenho da secao 5, com as
// recomendacoes das decisoes pendentes D-28 e D-32): o cartao "Remarcação
// pela IA" do "Pendente de você" (3 camadas: CalendarFold, o rotulo e o tom
// da IA; "De ..." e "Para ...", com "(já cancelada)"; sem "Ver dados
// informados"), os dialogos "Aprovar a remarcação?" (com a caixa do aviso
// marcada) e "Recusar a remarcação?", o menu da consulta (a nova com o grupo
// proprio; a antiga com a linha e o "Remarcar" travado com a dica), o
// arrastar da antiga travado, os papeis (leitura ve tudo desabilitado com a
// dica), os retornos e a copia sem travessao. Tudo renderizado no servidor;
// nada aqui chama acao nem rede.

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
    "aria-describedby": descrito,
  }: {
    children: ReactNode;
    disabled?: boolean;
    className?: string;
    "aria-describedby"?: string;
  }) => (
    <div
      role="menuitem"
      aria-disabled={disabled ? "true" : undefined}
      aria-describedby={descrito}
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
    <p data-parte="descricao">{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

vi.mock("@/app/(app)/agenda/actions", () => ({
  aprovarEncaixeAction: vi.fn(),
  aprovarRemarcacaoAction: vi.fn(),
  mudarStatusAction: vi.fn(),
  recusarEncaixeAction: vi.fn(),
  recusarRemarcacaoAction: vi.fn(),
  remarcarAgendamentoAction: vi.fn(),
}));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  excluirBloqueioAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/agenda/status-history-sheet", () => ({
  StatusHistorySheet: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const {
  CHIP_ENCAIXE_IA,
  CHIP_MARCADA_PELA_IA,
  CHIP_REMARCACAO_PELA_IA,
  chipDaPendencia,
  PendingPanel,
  retornoDaPendencia,
} = await import("@/components/agenda/pending-panel");
const {
  AppointmentMenu,
  consultaDaRemarcacaoNoMenu,
  desfechoDoRemarcar,
  retornoDaMudancaDeSituacao,
  rotulosDaPendenciaNoMenu,
} = await import("@/components/agenda/appointment-menu");
const { blocoArrastavel } =
  await import("@/components/agenda/appointment-block");
const { DialogoDaRemarcacao } =
  await import("@/components/agenda/dialogo-da-remarcacao");
const R = await import("@/components/agenda/remarcacao-da-ia");
const {
  ehRemarcacaoDaIa,
  remarcacoesPendentesPorAntiga,
  remarcacoesPendentesPorNova,
} = await import("@/lib/queries/agenda");

afterEach(() => {
  vi.useRealTimers();
});

type Contexto = ComponentProps<typeof PendingPanel>["contexto"];

const FUSO = "America/Fortaleza";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const DICA = "Seu perfil não pode alterar a agenda";
const NOVA = "c0c0c0c0-0000-4000-8000-0000000000a1";
const ANTIGA = "c0c0c0c0-0000-4000-8000-0000000000a0";

// 29/10/2026 14:00 e 03/11/2026 10:00 em Fortaleza (UTC-3).
const INICIO_DA_ANTIGA = "2026-10-29T17:00:00.000Z";
const INICIO_DA_NOVA = "2026-11-03T13:00:00.000Z";
// "Agora" dos textos: 27/10/2026, antes da antiga.
const AGORA = new Date("2026-10-27T15:00:00.000Z").getTime();

function contexto(
  podeEditar: boolean,
  extra: Partial<Contexto> = {},
): Contexto {
  return {
    clinicId: "0a0a0a0a-0000-4000-8000-00000000000a",
    timezone: FUSO,
    catalogo: {
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
    },
    podeEditar,
    dica: DICA,
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

function remarcacao(
  antiga: Partial<NonNullable<ConsultaDaAgenda["antiga"]>> | null = {},
): ConsultaDaAgenda {
  return {
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
    antiga:
      antiga === null
        ? null
        : {
            id: ANTIGA,
            starts_at: INICIO_DA_ANTIGA,
            ends_at: "2026-10-29T17:30:00.000Z",
            status: "confirmado_paciente",
            professional_id: JOAO,
            ...antiga,
          },
  };
}

const MARCADA_PELA_IA: ConsultaDaAgenda = {
  ...remarcacao(),
  id: "c0c0c0c0-0000-4000-8000-0000000000b1",
  remarcacao_de: null,
  antiga: null,
  contact: {
    id: "3d3d3d3d-0000-4000-8000-000000000002",
    name: "Outra Pessoa",
    phone_e164: "5584900000001",
  },
};

function comProvedores(no: ReactNode): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{no}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** O cartao (li) de uma pendencia, pelo nome do paciente. */
function cartao(html: string, nome: string): string {
  const itens = html.match(
    /<li class="flex flex-col gap-2\.5[^"]*">.*?<\/li>/g,
  );
  const achado = (itens ?? []).find((item) => item.includes(nome));
  if (!achado) {
    throw new Error(`cartao de ${nome} nao encontrado`);
  }
  return achado;
}

function painel(pendencias: ConsultaDaAgenda[], podeEditar = true): string {
  return comProvedores(
    <PendingPanel contexto={contexto(podeEditar)} pendencias={pendencias} />,
  );
}

function menu(
  consulta: ConsultaDaAgenda,
  podeEditar = true,
  extra: Partial<Contexto> = {},
): string {
  return comProvedores(
    <AppointmentMenu
      contexto={contexto(podeEditar, extra)}
      consulta={consulta}
      bloqueios={[]}
    >
      <button type="button">Paciente de Teste</button>
    </AppointmentMenu>,
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

// ---------------------------------------------------------------------------

describe("qual é qual", () => {
  it("a remarcação é a consulta da IA ligada à antiga", () => {
    expect(ehRemarcacaoDaIa(remarcacao())).toBe(true);
    expect(ehRemarcacaoDaIa(MARCADA_PELA_IA)).toBe(false);
    expect(ehRemarcacaoDaIa(ANTIGA_CONSULTA)).toBe(false);
    // Encaixe nunca e remarcacao, mesmo com a coluna (a IA nao remarca encaixe).
    expect(ehRemarcacaoDaIa({ ...remarcacao(), is_overbooking: true })).toBe(
      false,
    );
    expect(chipDaPendencia(remarcacao())).toBe(CHIP_REMARCACAO_PELA_IA);
    expect(chipDaPendencia(MARCADA_PELA_IA)).toBe(CHIP_MARCADA_PELA_IA);
    expect(chipDaPendencia({ created_by: "ia", is_overbooking: true })).toBe(
      CHIP_ENCAIXE_IA,
    );
  });

  it("a remarcação pendente trava a antiga dela; a tratada ou cancelada, não", () => {
    const mapa = remarcacoesPendentesPorAntiga([
      remarcacao(),
      MARCADA_PELA_IA,
      {
        ...remarcacao(),
        id: "x",
        remarcacao_de: "outra",
        status: "cancelado_paciente",
      },
      {
        ...remarcacao(),
        id: "y",
        remarcacao_de: "mais",
        approval_status: "aprovado",
      },
    ]);
    expect([...mapa.keys()]).toEqual([ANTIGA]);
    expect(mapa.get(ANTIGA)?.id).toBe(NOVA);
  });

  it("a mesma remarcação pela consulta nova, com a antiga da lista (revisão, achados 1 e 3)", () => {
    const daLista = remarcacao();
    const mapa = remarcacoesPendentesPorNova([
      daLista,
      MARCADA_PELA_IA,
      {
        ...remarcacao(),
        id: "x",
        remarcacao_de: "outra",
        status: "cancelado_paciente",
      },
      { ...remarcacao(), id: "y", approval_status: "aprovado" },
    ]);
    expect([...mapa.keys()]).toEqual([NOVA]);
    // E a mesma linha da lista, com a antiga lida a parte.
    expect(mapa.get(NOVA)).toBe(daLista);
    expect(mapa.get(NOVA)?.antiga?.starts_at).toBe(INICIO_DA_ANTIGA);
  });
});

describe("o cartão do Pendente de você", () => {
  it("Remarcação pela IA em 3 camadas: CalendarFold, o rótulo e o tom da IA", () => {
    expect(CHIP_REMARCACAO_PELA_IA).toEqual({
      label: "Remarcação pela IA",
      tone: "ai",
      icon: CalendarFold,
    });
    const html = cartao(painel([remarcacao()]), "Paciente de Teste");
    expect(html).toContain("lucide-calendar-fold");
    expect(html).toContain("color:var(--ai-text)");
    expect(html).toContain("background-color:var(--ai-bg)");
    expect(texto(html)).toContain("Remarcação pela IA");
    expect(texto(html)).not.toContain("Marcada pela IA");
  });

  it("paciente, procedimento com o convênio, profissional, De e Para no fuso da clínica", () => {
    const visivel = texto(cartao(painel([remarcacao()]), "Paciente de Teste"));
    expect(visivel).toContain("Limpeza de pele · Particular");
    expect(visivel).toContain("Dra. Ana Lima");
    expect(visivel).toContain("De 29/10 · 14:00");
    expect(visivel).toContain("Para 03/11 · 10:00");
    expect(visivel).not.toContain("já cancelada");
    // A De vem antes da Para.
    expect(visivel.indexOf("De 29/10")).toBeLessThan(
      visivel.indexOf("Para 03/11"),
    );
  });

  it("a antiga cancelada nesse meio: (já cancelada) na linha De", () => {
    const visivel = texto(
      cartao(
        painel([remarcacao({ status: "cancelado_paciente" })]),
        "Paciente de Teste",
      ),
    );
    expect(visivel).toContain("De 29/10 · 14:00 (já cancelada)");
  });

  it("sem a antiga (a RLS não deixou ler): só o Para", () => {
    const visivel = texto(
      cartao(painel([remarcacao(null)]), "Paciente de Teste"),
    );
    expect(visivel).toContain("Para 03/11 · 10:00");
    expect(visivel).not.toContain("De ");
    expect(visivel).not.toContain("Não foi possível carregar");
  });

  it("a leitura da antiga falhou: só o cartão da remarcação avisa, o resto do painel abre", () => {
    const html = painel([
      { ...remarcacao(null), erroNaAntiga: true },
      MARCADA_PELA_IA,
    ]);
    const daRemarcacao = cartao(html, "Paciente de Teste");
    expect(texto(daRemarcacao)).toContain("Para 03/11 · 10:00");
    expect(texto(daRemarcacao)).not.toContain("De ");
    // Atencao em 3 camadas (CircleAlert, o texto e o tom), sem interromper.
    expect(daRemarcacao).toMatch(
      /<div role="status" data-tom="warning"[^>]*>(?:(?!<\/div><\/div>).)*lucide-circle-alert(?:(?!<\/div><\/div>).)*Não foi possível carregar a consulta antiga\./,
    );
    // Aprovar e Recusar continuam (o servidor le a antiga de novo).
    const botoes = daRemarcacao.match(/<button[^>]*>/g) ?? [];
    expect(botoes).toHaveLength(2);
    for (const botao of botoes) {
      expect(botao).not.toMatch(/ disabled=""/);
    }
    // A outra pendencia nao sabe de nada.
    expect(texto(cartao(html, "Outra Pessoa"))).not.toContain(
      "Não foi possível carregar",
    );
  });

  it("sem Ver dados informados; Aprovar e Recusar com 40px, habilitados para quem edita", () => {
    const html = cartao(painel([remarcacao()]), "Paciente de Teste");
    expect(texto(html)).not.toContain("Ver dados informados");
    const botoes = html.match(/<button[^>]*>/g) ?? [];
    expect(botoes).toHaveLength(2);
    for (const botao of botoes) {
      expect(botao).toContain("h-10");
      expect(botao).not.toMatch(/ disabled=""/);
    }
    expect(texto(html)).toMatch(/Aprovar .*Recusar/);
    // A consulta que a IA marcou continua com o Ver dados informados.
    expect(
      texto(cartao(painel([remarcacao(), MARCADA_PELA_IA]), "Outra Pessoa")),
    ).toContain("Ver dados informados");
  });

  it("papel leitura: os dois visíveis e desabilitados, com a dica", () => {
    const html = cartao(painel([remarcacao()], false), "Paciente de Teste");
    const gatilhos =
      html.match(
        /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*disabled=""[^>]*>/g,
      ) ?? [];
    expect(gatilhos).toHaveLength(2);
    expect(texto(html)).toMatch(/Aprovar .*Recusar/);
  });

  it("vazio: o texto novo, com a remarcação", () => {
    expect(texto(painel([]))).toContain(
      "Quando a IA marcar ou remarcar uma consulta, ou sugerir um encaixe, aparece aqui para a equipe aprovar.",
    );
  });
});

describe("ícone de dono único (docs/06 4.6, C18)", () => {
  const RAIZ = path.resolve(__dirname, "../../..");

  function arquivos(pasta: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(pasta)) {
      const caminho = path.join(pasta, nome);
      if (statSync(caminho).isDirectory()) {
        saida.push(...arquivos(caminho));
      } else if (/\.(ts|tsx)$/.test(nome)) {
        saida.push(caminho);
      }
    }
    return saida;
  }

  function quemImporta(icone: string): string[] {
    const doLucide = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
    return ["app", "components", "lib"]
      .flatMap((pasta) => arquivos(path.join(RAIZ, pasta)))
      .filter((arquivo) =>
        [...readFileSync(arquivo, "utf8").matchAll(doLucide)].some((m) =>
          (m[1] ?? "")
            .split(",")
            .map((parte) => parte.trim())
            .includes(icone),
        ),
      )
      .map((arquivo) => path.relative(RAIZ, arquivo));
  }

  const GLOBAIS: StatusDefinition[] = [
    APPOINTMENT_STATUS,
    CONVERSATION_STATUS,
    FUNNEL_STAGE,
    CONTACT_RECENCY,
    PATIENT_TAG,
    APPOINTMENT_FLAG,
    RECORD_STATUS,
    REGUA_STATUS,
    WHATSAPP_CONNECTION_STATUS,
    ACCESS_LEVEL_STATUS,
    IA_AGENDA_STATUS,
    CONVERSAO_STATUS,
    TOKEN_META_STATUS,
    CONSENT_STATUS,
    ATIVIDADE_STATUS,
    MENSAGEM_AGENDADA_STATUS,
  ].flatMap((mapa) => Object.values(mapa) as StatusDefinition[]);

  it("CalendarFold só existe no painel, em nenhuma outra tela", () => {
    expect(quemImporta("CalendarFold")).toEqual([
      "components/agenda/pending-panel.tsx",
    ]);
  });

  it("nenhum mapa global usa o CalendarFold; os três chips da IA têm formas distintas", () => {
    expect(GLOBAIS.some((d) => d.icon === CalendarFold)).toBe(false);
    const icones = [
      CHIP_REMARCACAO_PELA_IA.icon,
      CHIP_MARCADA_PELA_IA.icon,
      CHIP_ENCAIXE_IA.icon,
    ];
    expect(new Set(icones).size).toBe(3);
    // Nunca o CalendarSync (o "Remarcada" da agenda) nem o CalendarCog.
    expect(CHIP_REMARCACAO_PELA_IA.icon).not.toBe(CalendarSync);
    expect(CHIP_REMARCACAO_PELA_IA.icon).not.toBe(CalendarCog);
    expect(CHIP_ENCAIXE_IA.icon).toBe(Sparkles);
  });
});

// ---------------------------------------------------------------------------

describe("os diálogos da remarcação", () => {
  function dialogo(
    acao: "aprovar" | "recusar",
    consulta = remarcacao(),
  ): string {
    return comProvedores(
      <DialogoDaRemarcacao
        contexto={contexto(true)}
        consulta={consulta}
        acao={acao}
        aoFechar={() => undefined}
      />,
    );
  }

  it("Aprovar a remarcação?: o texto do desenho, o paciente e a caixa do aviso marcada (D-28)", () => {
    const html = dialogo("aprovar");
    const visivel = texto(html);
    expect(html).toContain("<h2>Aprovar a remarcação?</h2>");
    // O texto do desenho vem do relogio de verdade: aqui so a forma fixa.
    expect(visivel).toContain(
      "A consulta passa de 29/10 às 14:00 para 03/11 às 10:00. A de 29/10 é cancelada",
    );
    expect(visivel).toContain("Paciente de Teste");
    expect(visivel).toContain("Limpeza de pele · Particular");
    expect(visivel).toContain("Avisar o paciente pelo WhatsApp");
    // Caixa (C31: so vale ao confirmar), marcada ao abrir, com o rotulo
    // ligado, a explicacao ligada e o alvo de 40px.
    expect(html).not.toContain('role="switch"');
    const caixa = html.match(/<button[^>]*role="checkbox"[^>]*>/)?.[0];
    expect(caixa).toContain('aria-checked="true"');
    expect(caixa).toContain("after:-inset-3");
    const id = caixa?.match(/ id="([^"]+)"/)?.[1];
    expect(html).toContain(`for="${id}"`);
    expect(caixa).toContain(`aria-describedby="${id}-descricao"`);
    expect(html).toContain(
      `<p id="${id}-descricao" class="text-xs text-text-secondary">Sai uma mensagem automática com o novo dia e horário, só se o paciente autorizou receber mensagens.</p>`,
    );
    expect(html).toMatch(/flex min-h-10 items-center gap-3/);
    const voltar = html.match(/<button[^>]*>Voltar<\/button>/)?.[0];
    const aprovar = html.match(
      /<button[^>]*>Aprovar remarcação<\/button>/,
    )?.[0];
    expect(voltar).toContain("h-10");
    expect(aprovar).toContain("h-10");
    expect(aprovar).toContain('data-variant="default"');
    expect(aprovar).not.toMatch(/ disabled=""/);
    expect(html).not.toContain('role="alert"');
  });

  it("Recusar a remarcação?: o texto do desenho, sem a caixa, e o Recusar no tom de perigo", () => {
    const html = dialogo("recusar");
    const visivel = texto(html);
    expect(html).toContain("<h2>Recusar a remarcação?</h2>");
    expect(visivel).toContain(
      "A consulta de 03/11 às 10:00 é cancelada. A de 29/10 às 14:00 continua marcada, e a conversa volta para a equipe avisar o paciente.",
    );
    expect(html).not.toContain('role="checkbox"');
    const recusar = html.match(
      /<button[^>]*>Recusar remarcação<\/button>/,
    )?.[0];
    expect(recusar).toContain('data-variant="destructive"');
    expect(recusar).toContain("h-10");
  });

  it("a antiga já atendida: o diálogo de aprovar abre com o erro do gatilho e o Aprovar travado", () => {
    for (const status of [
      "na_recepcao",
      "em_atendimento",
      "compareceu",
      "faltou",
    ] as const) {
      const html = dialogo("aprovar", remarcacao({ status }));
      expect(html, status).toMatch(
        /role="alert"[^>]*>(?:(?!<\/div>).)*A consulta de 29\/10 às 14:00 já foi atendida ou teve a falta marcada\. Recuse esta remarcação e fale com o paciente\./,
      );
      expect(
        html.match(/<button[^>]*>Aprovar remarcação<\/button>/)?.[0],
        status,
      ).toMatch(/ disabled=""/);
    }
    // Recusar continua livre.
    expect(
      dialogo("recusar", remarcacao({ status: "compareceu" })).match(
        /<button[^>]*>Recusar remarcação<\/button>/,
      )?.[0],
    ).not.toMatch(/ disabled=""/);
  });

  const JA_PASSOU =
    "A consulta de 29/10 às 14:00 já passou. Confira se o paciente compareceu antes de aprovar.";

  it("a antiga já passou sem presença nem falta (revisão, achado 8): o aviso, com o Aprovar livre", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));
    for (const status of [
      "agendado",
      "aguardando_confirmacao",
      "confirmado_paciente",
      "confirmado_recepcao",
    ] as const) {
      const html = dialogo("aprovar", remarcacao({ status }));
      expect(html, status).toMatch(
        new RegExp(
          `<div role="status" data-tom="warning"[^>]*>(?:(?!</div></div>).)*lucide-circle-alert(?:(?!</div></div>).)*${JA_PASSOU}`,
        ),
      );
      expect(
        html.match(/<button[^>]*>Aprovar remarcação<\/button>/)?.[0],
        status,
      ).not.toMatch(/ disabled=""/);
      expect(html, status).not.toContain('role="alert"');
    }
  });

  it("sem o aviso da antiga que já passou: futura, encerrada, cancelada, sem a antiga, e no Recusar", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Antes da antiga: nada a conferir.
    vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
    expect(texto(dialogo("aprovar"))).not.toContain("já passou");
    // Depois dela: a encerrada tem o erro do gatilho, a cancelada nao muda,
    // sem a antiga nao ha horario, e o Recusar nao mexe na antiga.
    vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));
    for (const consulta of [
      remarcacao({ status: "compareceu" }),
      remarcacao({ status: "faltou" }),
      remarcacao({ status: "cancelado_paciente" }),
      remarcacao(null),
    ]) {
      expect(texto(dialogo("aprovar", consulta))).not.toContain("já passou");
    }
    expect(texto(dialogo("recusar"))).not.toContain("já passou");
  });

  it("a antiga que não carregou (a da Agenda do dia, ou a leitura falhou): o diálogo avisa e o servidor confere", () => {
    const AVISO_NAO_CARREGADA =
      "Não foi possível carregar a consulta antiga. Ela é conferida de novo quando você confirmar.";
    // A consulta do dia nao traz a antiga (ausente).
    const doDia: ConsultaDaAgenda = { ...remarcacao() };
    delete doDia.antiga;
    for (const consulta of [
      doDia,
      { ...remarcacao(null), erroNaAntiga: true },
    ]) {
      for (const acao of ["aprovar", "recusar"] as const) {
        const html = dialogo(acao, consulta);
        expect(html, acao).toMatch(
          new RegExp(
            `<div role="status" data-tom="warning"[^>]*>(?:(?!</div></div>).)*${AVISO_NAO_CARREGADA}`,
          ),
        );
        // O texto sem a antiga, e os botoes livres (o servidor le de novo).
        expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Aprovar/);
      }
    }
    expect(texto(dialogo("aprovar", doDia))).toContain(
      "A consulta passa para 03/11 às 10:00, e a consulta antiga é cancelada.",
    );
    // Com a antiga lida (a da lista), sem o aviso; a nula de verdade (RLS)
    // tambem sem.
    expect(texto(dialogo("aprovar"))).not.toContain(
      "Não foi possível carregar",
    );
    expect(texto(dialogo("aprovar", remarcacao(null)))).not.toContain(
      "Não foi possível carregar",
    );
  });

  it("o diálogo do menu usa a nova da lista (com a antiga renovada), a guardada só fora dela (revisão, achado 3)", () => {
    const doDia: ConsultaDaAgenda = { ...remarcacao() };
    delete doDia.antiga;
    const daLista = remarcacao({ status: "cancelado_paciente" });
    expect(consultaDaRemarcacaoNoMenu(daLista, doDia)).toBe(daLista);
    expect(consultaDaRemarcacaoNoMenu(null, doDia)).toBe(doDia);
    // A antiga cancelada nesse meio chega ao texto pelo da lista.
    expect(
      texto(dialogo("aprovar", consultaDaRemarcacaoNoMenu(daLista, doDia))),
    ).toContain(
      "A consulta de 29/10 às 14:00 já foi cancelada. Ao aprovar, fica marcada a de 03/11 às 10:00.",
    );
    // E a antiga atendida nesse meio trava o Aprovar na hora.
    const atendida = remarcacao({ status: "compareceu" });
    expect(
      dialogo("aprovar", consultaDaRemarcacaoNoMenu(atendida, doDia)).match(
        /<button[^>]*>Aprovar remarcação<\/button>/,
      )?.[0],
    ).toMatch(/ disabled=""/);
  });
});

describe("os textos e os retornos da remarcação", () => {
  it("o horário sempre no fuso da clínica", () => {
    expect(R.quandoNaClinica(INICIO_DA_ANTIGA, FUSO)).toBe("29/10 às 14:00");
    expect(R.quandoNoCartao(INICIO_DA_NOVA, FUSO)).toBe("03/11 · 10:00");
    expect(R.quandoNaClinica(INICIO_DA_ANTIGA, "America/Sao_Paulo")).toBe(
      "29/10 às 14:00",
    );
    expect(R.quandoNaClinica(INICIO_DA_ANTIGA, "America/Manaus")).toBe(
      "29/10 às 13:00",
    );
  });

  it("onde a antiga está: viva, cancelada ou encerrada", () => {
    for (const status of [
      "agendado",
      "aguardando_confirmacao",
      "confirmado_paciente",
      "confirmado_recepcao",
    ] as const) {
      expect(R.situacaoDaAntiga(status), status).toBe("viva");
    }
    expect(R.situacaoDaAntiga("cancelado_paciente")).toBe("cancelada");
    expect(R.situacaoDaAntiga("cancelado_clinica")).toBe("cancelada");
    for (const status of [
      "na_recepcao",
      "em_atendimento",
      "compareceu",
      "faltou",
    ] as const) {
      expect(R.situacaoDaAntiga(status), status).toBe("encerrada");
    }
  });

  it("Aprovar: a lista de espera só com a antiga ainda futura; já cancelada, nada muda nela", () => {
    expect(R.textoDoAprovar(remarcacao(), FUSO, AGORA)).toBe(
      "A consulta passa de 29/10 às 14:00 para 03/11 às 10:00. A de 29/10 é cancelada e o horário volta a ser oferecido à lista de espera, se houver.",
    );
    const depoisDaAntiga = new Date("2026-10-30T12:00:00.000Z").getTime();
    expect(R.textoDoAprovar(remarcacao(), FUSO, depoisDaAntiga)).toBe(
      "A consulta passa de 29/10 às 14:00 para 03/11 às 10:00. A de 29/10 é cancelada.",
    );
    expect(
      R.textoDoAprovar(
        remarcacao({ status: "cancelado_clinica" }),
        FUSO,
        AGORA,
      ),
    ).toBe(
      "A consulta de 29/10 às 14:00 já foi cancelada. Ao aprovar, fica marcada a de 03/11 às 10:00.",
    );
    expect(
      R.textoDoAprovar(remarcacao({ status: "compareceu" }), FUSO, AGORA),
    ).toBe(
      "A IA pediu a remarcação da consulta de 29/10 às 14:00 para 03/11 às 10:00.",
    );
    expect(R.textoDoAprovar(remarcacao(null), FUSO, AGORA)).toBe(
      "A consulta passa para 03/11 às 10:00, e a consulta antiga é cancelada.",
    );
  });

  it("Recusar: continua marcada só quando continua", () => {
    expect(R.textoDoRecusar(remarcacao(), FUSO)).toBe(
      "A consulta de 03/11 às 10:00 é cancelada. A de 29/10 às 14:00 continua marcada, e a conversa volta para a equipe avisar o paciente.",
    );
    expect(
      R.textoDoRecusar(remarcacao({ status: "cancelado_paciente" }), FUSO),
    ).toBe(
      "A consulta de 03/11 às 10:00 é cancelada. A de 29/10 às 14:00 já foi cancelada, e a conversa volta para a equipe avisar o paciente.",
    );
    expect(R.textoDoRecusar(remarcacao({ status: "faltou" }), FUSO)).toBe(
      "A consulta de 03/11 às 10:00 é cancelada, e a conversa volta para a equipe avisar o paciente.",
    );
  });

  it("os sucessos com a antiga lida do banco e o erro do gatilho", () => {
    const viva = { starts_at: INICIO_DA_ANTIGA, situacao: "viva" as const };
    // Com o aviso pelo WhatsApp pedido: ou saiu, ou a atencao diz o que fazer.
    expect(R.sucessoDoAprovar(viva, FUSO, true)).toBe(
      "Remarcação aprovada. A consulta de 29/10 às 14:00 foi cancelada.",
    );
    expect(R.sucessoDoRecusar(viva, FUSO)).toBe(
      "Remarcação recusada. A consulta de 29/10 às 14:00 continua marcada, com o pedido de remarcação: a confirmação automática fica parada até Manter o horário, em Confirmações. Avise o paciente pelo Atendimento.",
    );
    expect(R.sucessoDoAprovar(null, FUSO, true)).toBe("Remarcação aprovada.");
    expect(R.sucessoDoRecusar(null, FUSO)).toBe(
      "Remarcação recusada. Avise o paciente pelo Atendimento.",
    );
    expect(R.erroDaAntigaEncerrada(INICIO_DA_ANTIGA, FUSO)).toBe(
      "A consulta de 29/10 às 14:00 já foi atendida ou teve a falta marcada. Recuse esta remarcação e fale com o paciente.",
    );
    expect(R.linhaDaAntigaNoMenu(INICIO_DA_NOVA, FUSO)).toBe(
      "Remarcação pedida pela IA para 03/11 às 10:00",
    );
  });

  it("aprovar sem o aviso pelo WhatsApp pede para avisar pelo Atendimento (revisão, achado 4)", () => {
    const viva = { starts_at: INICIO_DA_ANTIGA, situacao: "viva" as const };
    const cancelada = {
      starts_at: INICIO_DA_ANTIGA,
      situacao: "cancelada" as const,
    };
    const encerrada = {
      starts_at: INICIO_DA_ANTIGA,
      situacao: "encerrada" as const,
    };
    expect(R.sucessoDoAprovar(viva, FUSO, false)).toBe(
      "Remarcação aprovada. A consulta de 29/10 às 14:00 foi cancelada. Avise o paciente pelo Atendimento.",
    );
    expect(R.sucessoDoAprovar(cancelada, FUSO, false)).toBe(
      "Remarcação aprovada. A consulta de 29/10 às 14:00 já estava cancelada. Avise o paciente pelo Atendimento.",
    );
    expect(R.sucessoDoAprovar(encerrada, FUSO, false)).toBe(
      "Remarcação aprovada. Avise o paciente pelo Atendimento.",
    );
    expect(R.sucessoDoAprovar(null, FUSO, false)).toBe(
      "Remarcação aprovada. Avise o paciente pelo Atendimento.",
    );
    // Com o aviso pedido, nunca (sem duas ordens diferentes na mesma tela).
    for (const antiga of [viva, cancelada, encerrada, null]) {
      expect(R.sucessoDoAprovar(antiga, FUSO, true)).not.toContain(
        "Atendimento",
      );
    }
  });

  it("recusar diz que a antiga fica com o pedido e sem a confirmação automática, só quando ela continua (revisão, achado 9)", () => {
    const PARADA =
      "com o pedido de remarcação: a confirmação automática fica parada até Manter o horário, em Confirmações.";
    expect(
      R.sucessoDoRecusar(
        { starts_at: INICIO_DA_ANTIGA, situacao: "viva" },
        FUSO,
      ),
    ).toContain(PARADA);
    for (const antiga of [
      { starts_at: INICIO_DA_ANTIGA, situacao: "cancelada" as const },
      { starts_at: INICIO_DA_ANTIGA, situacao: "encerrada" as const },
      null,
    ]) {
      expect(R.sucessoDoRecusar(antiga, FUSO)).not.toContain(
        "confirmação automática",
      );
    }
  });

  it("a conversa que não voltou se explica sozinha, nos caminhos de defesa (revisão, achado 5)", () => {
    expect(R.TEXTOS_DA_REMARCACAO.conversaNaoDevolvida).toBe(
      "A remarcação foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.",
    );
    expect(R.TEXTOS_DA_REMARCACAO.conversaNaoEncontrada).toBe(
      "A remarcação foi recusada, mas a conversa do paciente não foi encontrada. Avise o paciente pelo Atendimento.",
    );
    const mensagem = R.sucessoDoRecusar(
      { starts_at: INICIO_DA_ANTIGA, situacao: "viva" },
      FUSO,
    );
    // O Recusar de antes (painel e menu) e o Cancelar da pendente mostram
    // um toast so: com o aviso, ele diz que a remarcacao foi recusada.
    for (const aviso of [
      R.TEXTOS_DA_REMARCACAO.conversaNaoDevolvida,
      R.TEXTOS_DA_REMARCACAO.conversaNaoEncontrada,
    ]) {
      expect(
        retornoDaPendencia({ ok: true, mensagem, aviso }, "recusar", true),
      ).toEqual({ tipo: "warning", texto: aviso });
      expect(
        retornoDaMudancaDeSituacao(
          { ok: true, recusada: "remarcacao", mensagem, aviso },
          "cancelado_paciente",
        ),
      ).toEqual({ tipo: "warning", texto: aviso });
      expect(aviso).toMatch(/^A remarcação foi recusada, mas /);
    }
    // Sem aviso, o sucesso do servidor, com a antiga.
    expect(retornoDaPendencia({ ok: true, mensagem }, "recusar", true)).toEqual(
      { tipo: "success", texto: mensagem },
    );
    // No dialogo, os dois juntos: o sucesso e a atencao.
    expect(
      R.desfechoDaRemarcacao(
        {
          ok: true,
          mensagem,
          aviso: R.TEXTOS_DA_REMARCACAO.conversaNaoDevolvida,
        },
        "recusar",
      ),
    ).toEqual({
      fechar: true,
      avisos: [
        { tipo: "success", texto: mensagem },
        {
          tipo: "warning",
          texto: R.TEXTOS_DA_REMARCACAO.conversaNaoDevolvida,
        },
      ],
    });
  });

  it("o Remarcar do menu: remarcacao_pendente fecha e refaz a agenda (revisão, achado 6)", () => {
    expect(
      desfechoDoRemarcar({
        ok: false,
        code: "remarcacao_pendente",
        error: R.TEXTOS_DA_REMARCACAO.dicaDaAntiga,
      }),
    ).toEqual({
      fechar: true,
      avisos: [{ tipo: "error", texto: R.TEXTOS_DA_REMARCACAO.dicaDaAntiga }],
      atualizarAgenda: true,
    });
    // O de sempre: sucesso (com a atencao do aviso que nao saiu) refaz; o
    // que a recepcao corrige fica aberto; outro erro fecha sem refazer.
    expect(desfechoDoRemarcar({ ok: true, aviso: "Ligue." })).toEqual({
      fechar: true,
      avisos: [
        { tipo: "success", texto: "Consulta remarcada." },
        { tipo: "warning", texto: "Ligue." },
      ],
      atualizarAgenda: true,
    });
    expect(
      desfechoDoRemarcar({ ok: false, code: "conflito", error: "Ocupado." }),
    ).toEqual({ fechar: false, erro: "Ocupado." });
    expect(desfechoDoRemarcar({ ok: false, code: "situacao_final" })).toEqual({
      fechar: true,
      avisos: [{ tipo: "error", texto: "Não foi possível remarcar." }],
      atualizarAgenda: false,
    });
  });

  it("o desfecho de cada resposta: sucesso e atenção juntos, já tratada informa, o gatilho trava", () => {
    expect(
      R.desfechoDaRemarcacao(
        { ok: true, mensagem: "M.", aviso: "Avise por telefone." },
        "aprovar",
      ),
    ).toEqual({
      fechar: true,
      avisos: [
        { tipo: "success", texto: "M." },
        { tipo: "warning", texto: "Avise por telefone." },
      ],
    });
    expect(R.desfechoDaRemarcacao({ ok: true }, "recusar")).toEqual({
      fechar: true,
      avisos: [
        {
          tipo: "success",
          texto: "Remarcação recusada. Avise o paciente pelo Atendimento.",
        },
      ],
    });
    expect(
      R.desfechoDaRemarcacao(
        {
          ok: false,
          code: "ja_tratado",
          error: "Esta remarcação já foi tratada.",
        },
        "aprovar",
      ),
    ).toEqual({
      fechar: true,
      avisos: [{ tipo: "info", texto: "Esta remarcação já foi tratada." }],
    });
    expect(
      R.desfechoDaRemarcacao(
        { ok: false, code: "remarcacao_antiga_encerrada", error: "E." },
        "aprovar",
      ),
    ).toEqual({ fechar: false, erro: "E.", travar: true });
    expect(R.desfechoDaRemarcacao({ ok: false }, "aprovar")).toEqual({
      fechar: false,
      erro: "Não foi possível aprovar. Tente de novo.",
      travar: false,
    });
    expect(
      R.desfechoDaRemarcacao({ ok: false, error: "X." }, "recusar"),
    ).toEqual({ fechar: false, erro: "X.", travar: false });
  });
});

// ---------------------------------------------------------------------------

describe("o menu da consulta", () => {
  it("na nova: o grupo Remarcação pela IA, com Aprovar e Recusar de 40px e sem Ver dados informados", () => {
    const html = menu(remarcacao());
    expect(html).toContain("Remarcação pela IA");
    expect(item(html, "Aprovar remarcação")).toContain("h-10");
    expect(item(html, "Recusar remarcação")).toContain("h-10");
    expect(html).not.toContain("Ver dados informados");
    expect(html).not.toContain("Consulta marcada pela IA");
    expect(rotulosDaPendenciaNoMenu(true, true)).toEqual({
      grupo: "Remarcação pela IA",
      aprovar: "Aprovar remarcação",
      recusar: "Recusar remarcação",
    });
    // A consulta da IA sem remarcacao continua como antes.
    expect(rotulosDaPendenciaNoMenu(true).grupo).toBe(
      "Consulta marcada pela IA",
    );
  });

  it("papel leitura: Aprovar e Recusar visíveis e desabilitados, com a dica", () => {
    const html = menu(remarcacao(), false);
    expect(item(html, "Aprovar remarcação")).toContain('aria-disabled="true"');
    expect(item(html, "Recusar remarcação")).toContain('aria-disabled="true"');
    expect(html).toContain(DICA);
  });

  it("na antiga com a remarcação pendente: a linha e o Remarcar travado com a dica do gatilho", () => {
    const pendente = remarcacao();
    const html = menu(ANTIGA_CONSULTA, true, {
      remarcacaoPendenteDe: (id) => (id === ANTIGA ? pendente : null),
    });
    expect(texto(html)).toContain(
      "Remarcação pedida pela IA para 03/11 às 10:00",
    );
    const remarcar = item(html, "Remarcar");
    expect(remarcar).toContain('aria-disabled="true"');
    const idDaDica = remarcar.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(idDaDica).toBeDefined();
    expect(html).toContain(
      `<p id="${idDaDica}" class="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary">Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.</p>`,
    );
    // Mudar a situacao continua (cancelar a antiga nao e mover).
    expect(item(html, "Cancelado pelo paciente")).not.toContain(
      "aria-disabled",
    );
  });

  it("sem remarcação pendente, a antiga se remarca como sempre", () => {
    const html = menu(ANTIGA_CONSULTA, true, {
      remarcacaoPendenteDe: () => null,
    });
    expect(item(html, "Remarcar")).not.toContain("aria-disabled");
    expect(html).not.toContain("Remarcação pedida pela IA");
    expect(html).not.toContain(
      "Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.",
    );
  });
});

describe("o arrastar", () => {
  it("a antiga com a remarcação pendente não se arrasta; as outras, como sempre", () => {
    const pendente = remarcacao();
    const comPendencia = {
      podeEditar: true,
      remarcacaoPendenteDe: (id: string) => (id === ANTIGA ? pendente : null),
    };
    expect(blocoArrastavel(comPendencia, ANTIGA_CONSULTA)).toBe(false);
    expect(blocoArrastavel(comPendencia, pendente)).toBe(true);
    expect(blocoArrastavel({ podeEditar: true }, ANTIGA_CONSULTA)).toBe(true);
    expect(blocoArrastavel({ podeEditar: false }, ANTIGA_CONSULTA)).toBe(false);
    expect(
      blocoArrastavel(
        { podeEditar: true },
        { id: ANTIGA, status: "compareceu" },
      ),
    ).toBe(false);
  });
});

describe("cópia", () => {
  it("sem travessão e sem jargão", () => {
    const viva = { starts_at: INICIO_DA_ANTIGA, situacao: "viva" as const };
    const amostras = [
      ...Object.values(R.TEXTOS_DA_REMARCACAO),
      CHIP_REMARCACAO_PELA_IA.label,
      R.textoDoAprovar(remarcacao(), FUSO, AGORA),
      R.textoDoAprovar(
        remarcacao({ status: "cancelado_clinica" }),
        FUSO,
        AGORA,
      ),
      R.textoDoAprovar(remarcacao({ status: "faltou" }), FUSO, AGORA),
      R.textoDoAprovar(remarcacao(null), FUSO, AGORA),
      R.textoDoRecusar(remarcacao(), FUSO),
      R.textoDoRecusar(remarcacao({ status: "cancelado_paciente" }), FUSO),
      R.textoDoRecusar(remarcacao({ status: "faltou" }), FUSO),
      R.sucessoDoAprovar(viva, FUSO, true),
      R.sucessoDoAprovar(viva, FUSO, false),
      R.sucessoDoAprovar(null, FUSO, false),
      R.sucessoDoRecusar(viva, FUSO),
      R.erroDaAntigaEncerrada(null, FUSO),
      R.linhaDaAntigaNoMenu(INICIO_DA_NOVA, FUSO),
      R.avisoDaAntigaQueJaPassou(
        remarcacao(),
        FUSO,
        new Date("2026-10-30T12:00:00.000Z").getTime(),
      ) ?? "",
      ...Object.values(rotulosDaPendenciaNoMenu(true, true)),
      texto(painel([remarcacao()])),
      texto(painel([{ ...remarcacao(null), erroNaAntiga: true }])),
    ];
    for (const amostra of amostras) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(
        /\b(slot|hold|handoff|tenant|opt-in|remarcacao_de|appointment)\b/i,
      );
    }
  });
});
