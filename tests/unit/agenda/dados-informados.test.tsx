import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

// "Ver dados informados" (AG3; decisao D-7 do dono, padrao recomendado): onde
// a equipe aprova a consulta que a IA marcou (o painel "Pendente de você" e
// o menu da consulta), o que o paciente informou ao assistente para marcar.
// A leitura grava trilha no banco, entao so acontece no clique: nada aqui
// renderiza chamando a acao. O miolo do dialogo em cada estado (carregando,
// erro, vazio e os dados, com o CPF mascarado ate pedir), a frase do que a
// aprovacao faz, o botao de 40px, desabilitado com a dica para quem nao le,
// e a copia sem travessao. O menu do Radix e o dialogo viram marcacao
// simples (como em menu-da-consulta-pendencia.test.tsx). Revisao final da
// AG3 (achados 8, 12 e 13): a regra real do cadastro (o nome do WhatsApp),
// o CPF e a carteirinha so mascarados (o inteiro pela acao de revelar), a
// consulta ja tratada (recusada, cancelada, dados apagados) e o "Tentar de
// novo" so no erro que passa.

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
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

const acoes = vi.hoisted(() => ({
  lerDadosInformadosAction: vi.fn(),
  revelarDadoInformadoAction: vi.fn(),
}));
vi.mock("@/app/(app)/agenda/actions", () => ({
  aprovarEncaixeAction: vi.fn(),
  mudarStatusAction: vi.fn(),
  recusarEncaixeAction: vi.fn(),
  remarcarAgendamentoAction: vi.fn(),
  lerDadosInformadosAction: acoes.lerDadosInformadosAction,
  revelarDadoInformadoAction: acoes.revelarDadoInformadoAction,
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
  alternarOCampo,
  BotaoDosDadosInformados,
  CampoProtegido,
  contatoDaConsulta,
  CorpoDosDadosInformados,
  dataCivilEmTexto,
  DialogoDosDadosInformados,
  estadoDoResultado,
  formatarCpf,
  instanteNaClinica,
  lerOsDadosInformados,
  mascararCarteirinha,
  mascararCpf,
  revelarODado,
  TEXTOS_DOS_DADOS_INFORMADOS,
  textoDoCadastro,
  textoSemDados,
} = await import("@/components/agenda/dados-informados");
const { situacaoDaConsulta } = await import("@/lib/domain/dados-informados");
const { PendingPanel } = await import("@/components/agenda/pending-panel");
const { AppointmentMenu } =
  await import("@/components/agenda/appointment-menu");

type Contexto = ComponentProps<typeof PendingPanel>["contexto"];
type Consulta = ComponentProps<typeof AppointmentMenu>["consulta"];
type Estado = ComponentProps<typeof CorpoDosDadosInformados>["estado"];
type Dados = Extract<Estado, { tipo: "pronto" }>["dados"];

const FUSO = "America/Fortaleza";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const DICA = "Seu perfil não pode alterar a agenda";
const T = TEXTOS_DOS_DADOS_INFORMADOS;

function contexto(podeEditar: boolean): Contexto {
  return {
    clinicId: "0a0a0a0a-0000-4000-8000-00000000000a",
    timezone: FUSO,
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
    podeEditarCadastros: false,
    dicaCadastros: "",
    podeRegistrarAutorizacao: false,
    dicaAutorizacao: "",
  };
}

// A consulta que a IA marcou, pendente da equipe (D12). Dados de exemplo.
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
  contact: {
    id: "3d3d3d3d-0000-4000-8000-000000000001",
    name: "Paciente de Teste",
    phone_e164: "+5585999990000",
  },
  service_link: {
    id: "2c2c2c2c-0000-4000-8000-000000000001",
    duration_min: 30,
    procedure: { id: "p1", name: "Consulta" },
    insurance: null,
  },
};

const ENCAIXE: Consulta = {
  ...DA_IA,
  id: "c0c0c0c0-0000-4000-8000-000000000002",
  is_overbooking: true,
  contact: {
    id: "3d3d3d3d-0000-4000-8000-000000000002",
    name: "Outra Pessoa",
    phone_e164: "+5585999990001",
  },
};

// 17:05 UTC = 14:05 em Fortaleza (UTC-3).
const DADOS: NonNullable<Dados> = {
  nomeCompleto: "Paciente de Teste da Silva",
  dataNascimento: "1990-05-09",
  // Revisao final da AG3: o servidor manda so mascarados.
  cpfMascarado: "•••.456.789-••",
  carteirinhaMascarada: "••••••••6789",
  paraOTitular: true,
  informadoEm: "2026-10-21T17:05:00.000Z",
  atualizadoEm: "2026-10-21T17:06:00.000Z",
  aplicadoEm: null,
  aplicadoPor: null,
};

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const NAO_REVELA = async () =>
  ({ ok: false, error: "não", transitorio: false }) as const;

function corpo(
  estado: Estado,
  situacao: "pendente" | "aprovada" | "recusada" | "cancelada" = "pendente",
): string {
  return renderToStaticMarkup(
    <CorpoDosDadosInformados
      estado={estado}
      fuso={FUSO}
      situacao={situacao}
      aoTentarDeNovo={() => undefined}
      aoRevelar={NAO_REVELA}
    />,
  );
}

function painel(pendencias: Consulta[], podeEditar = true): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <PendingPanel contexto={contexto(podeEditar)} pendencias={pendencias} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function menu(consulta: Consulta, podeEditar = true): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <AppointmentMenu
          contexto={contexto(podeEditar)}
          consulta={consulta}
          bloqueios={[]}
        >
          <button type="button">Paciente de Teste</button>
        </AppointmentMenu>
      </TooltipProvider>
    </QueryClientProvider>,
  );
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("regras puras", () => {
  it("o CPF formatado e o mascarado (só os dígitos do meio)", () => {
    expect(formatarCpf("12345678909")).toBe("123.456.789-09");
    expect(mascararCpf("12345678909")).toBe("•••.456.789-••");
    // Fora de 11 digitos: formatado como veio, mascarado inteiro.
    expect(formatarCpf("123")).toBe("123");
    expect(mascararCpf("123")).toBe("•••.•••.•••-••");
    expect(mascararCpf("12345678909")).not.toContain("123.");
    expect(mascararCpf("12345678909")).not.toContain("-09");
  });

  it("o nascimento é dia civil (sem fuso) e o instante, no fuso da clínica", () => {
    expect(dataCivilEmTexto("1990-05-09")).toBe("09/05/1990");
    expect(dataCivilEmTexto("09/05/1990")).toBe("09/05/1990");
    expect(instanteNaClinica("2026-10-21T17:05:00.000Z", FUSO)).toBe(
      "21/10/2026 às 14:05",
    );
    // 02:30 UTC do dia 22 ainda e dia 21 em Fortaleza.
    expect(instanteNaClinica("2026-10-22T02:30:00.000Z", FUSO)).toBe(
      "21/10/2026 às 23:30",
    );
  });

  it("a linha do cadastro: ainda não, quando e por quem (ou alguém da equipe)", () => {
    expect(textoDoCadastro(DADOS, FUSO, "pendente")).toBe("Ainda não aplicado.");
    const aplicado = {
      aplicadoEm: "2026-10-22T12:00:00.000Z",
      aplicadoPor: { nome: "Vinicius" },
      paraOTitular: true,
    };
    expect(textoDoCadastro(aplicado, FUSO, "aprovada")).toBe(
      "Aplicado em 22/10/2026 às 09:00, na aprovação por Vinicius.",
    );
    expect(
      textoDoCadastro({ ...aplicado, aplicadoPor: { nome: null } }, FUSO, "aprovada"),
    ).toBe("Aplicado em 22/10/2026 às 09:00, na aprovação por alguém da equipe.");
    expect(textoDoCadastro({ ...aplicado, aplicadoPor: null }, FUSO, "aprovada")).toBe(
      "Aplicado em 22/10/2026 às 09:00, na aprovação da consulta.",
    );
  });

  it("revisão final da AG3: a consulta tratada diz por que os dados não entram", () => {
    expect(textoDoCadastro(DADOS, FUSO, "recusada")).toBe(
      "Não entra no cadastro: a consulta foi recusada.",
    );
    expect(textoDoCadastro(DADOS, FUSO, "cancelada")).toBe(
      "Não entra no cadastro: a consulta foi cancelada.",
    );
    expect(textoDoCadastro(DADOS, FUSO, "aprovada")).toBe(
      "Não entrou no cadastro.",
    );
    expect(
      textoDoCadastro({ ...DADOS, paraOTitular: false }, FUSO, "pendente"),
    ).toBe("Não entra no cadastro: a consulta é para outra pessoa.");
    // Nunca "Ainda não aplicado." fora da pendente.
    for (const situacao of ["aprovada", "recusada", "cancelada"] as const) {
      expect(textoDoCadastro(DADOS, FUSO, situacao)).not.toBe(T.aindaNaoAplicado);
    }
    // Sem dados: na pendente, nao informou; na tratada, nao estao mais
    // guardados (a manutencao apaga depois de 30 dias).
    expect(textoSemDados("pendente")).toBe(
      "O paciente não informou dados nesta conversa.",
    );
    for (const situacao of ["aprovada", "recusada", "cancelada"] as const) {
      expect(textoSemDados(situacao)).toBe(
        "Os dados informados não estão mais guardados para esta consulta.",
      );
    }
  });

  it("a situação da consulta: cancelada, recusada, pendente ou aprovada", () => {
    expect(situacaoDaConsulta(DA_IA)).toBe("pendente");
    expect(situacaoDaConsulta({ ...DA_IA, approval_status: "aprovado" })).toBe(
      "aprovada",
    );
    expect(situacaoDaConsulta({ ...DA_IA, approval_status: "recusado" })).toBe(
      "recusada",
    );
    expect(situacaoDaConsulta({ ...DA_IA, status: "cancelado_paciente" })).toBe(
      "cancelada",
    );
    expect(
      situacaoDaConsulta({
        ...DA_IA,
        status: "cancelado_clinica",
        approval_status: "aprovado",
      }),
    ).toBe("cancelada");
  });

  it("revisão final da AG3: a carteirinha mascarada, como o CPF", () => {
    expect(mascararCarteirinha("0001 2345 6789")).toBe("••••••••6789");
    // Letras contam; os separadores saem (12 caracteres: 8 pontos e o fim).
    expect(mascararCarteirinha("ABC-123.456.789")).toBe("••••••••6789");
    expect(mascararCarteirinha("ABC-123.456.789")).not.toContain("ABC");
    // Curta: oculta inteira (os ultimos dariam quase tudo).
    expect(mascararCarteirinha("12345")).toBe("••••••");
    expect(mascararCarteirinha("0001 2345 6789")).not.toContain("0001");
  });

  it("o resultado da ação vira o estado do diálogo", () => {
    expect(estadoDoResultado({ ok: true, dados: null })).toEqual({
      tipo: "pronto",
      dados: null,
    });
    expect(estadoDoResultado({ ok: true, dados: DADOS })).toEqual({
      tipo: "pronto",
      dados: DADOS,
    });
    expect(
      estadoDoResultado({
        ok: false,
        error: "Consulta inválida.",
        transitorio: false,
      }),
    ).toEqual({ tipo: "erro", texto: "Consulta inválida.", transitorio: false });
  });

  it("o contato do diálogo: o nome, o telefone formatado ou nada", () => {
    expect(contatoDaConsulta(DA_IA)).toBe("Paciente de Teste");
    expect(
      contatoDaConsulta({
        contact: { name: " ", phone_e164: "+5585999990000" },
      }),
    ).not.toBe(" ");
    expect(contatoDaConsulta({ contact: null })).toBeNull();
  });
});

describe("a leitura só no clique (grava trilha)", () => {
  it("uma leitura chama a ação uma vez, com o id da consulta", async () => {
    const ler = vi.fn().mockResolvedValue({ ok: true, dados: DADOS });
    expect(await lerOsDadosInformados(DA_IA.id, ler)).toEqual({
      tipo: "pronto",
      dados: DADOS,
    });
    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler).toHaveBeenCalledWith(DA_IA.id);
  });

  it("sem ler passado, usa a ação do servidor; a que lança vira o erro de sempre", async () => {
    acoes.lerDadosInformadosAction.mockResolvedValue({ ok: true, dados: null });
    expect(await lerOsDadosInformados(DA_IA.id)).toEqual({
      tipo: "pronto",
      dados: null,
    });
    expect(acoes.lerDadosInformadosAction).toHaveBeenCalledWith(DA_IA.id);
    acoes.lerDadosInformadosAction.mockRejectedValue(new Error("rede"));
    expect(await lerOsDadosInformados(DA_IA.id)).toEqual({
      tipo: "erro",
      texto: "Não foi possível carregar os dados. Tente de novo.",
      transitorio: true,
    });
  });

  it("renderizar o painel e o menu nunca chama a ação", () => {
    painel([DA_IA, ENCAIXE]);
    painel([DA_IA], false);
    menu(DA_IA);
    menu({ ...DA_IA, approval_status: "aprovado" });
    expect(acoes.lerDadosInformadosAction).not.toHaveBeenCalled();
    expect(acoes.revelarDadoInformadoAction).not.toHaveBeenCalled();
  });
});

describe("o miolo do diálogo", () => {
  it("carregando: o esqueleto e o texto para o leitor de tela, sem dado", () => {
    const html = corpo({ tipo: "carregando" });
    expect(html).toContain('role="status"');
    expect(texto(html)).toContain("Carregando os dados informados...");
    expect(html).toContain('data-slot="skeleton"');
  });

  it("erro: a mensagem, anunciada, e o Tentar de novo com 40px", () => {
    const html = corpo({
      tipo: "erro",
      texto: "Não foi possível carregar os dados. Tente de novo.",
      transitorio: true,
    });
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain(
      "Não foi possível carregar os dados. Tente de novo.",
    );
    const botao = html.match(/<button[^>]*>Tentar de novo<\/button>/)?.[0];
    expect(botao).toBeDefined();
    expect(botao).toContain("h-10");
    // O icone do erro e o da tabela (OctagonAlert).
    expect(html).toContain("lucide-octagon-alert");
  });

  it("revisão final da AG3: o erro que não passa tentando não oferece Tentar de novo", () => {
    for (const erro of [
      "Seu perfil não vê os dados que o paciente informou.",
      "Esta consulta não está mais na agenda. Atualize a página.",
      "Sessão expirada. Entre de novo.",
    ]) {
      const html = corpo({ tipo: "erro", texto: erro, transitorio: false });
      expect(texto(html), erro).toContain(erro);
      expect(html, erro).not.toContain("Tentar de novo");
    }
  });

  it("vazio: o paciente não informou dados nesta conversa", () => {
    const html = corpo({ tipo: "pronto", dados: null });
    expect(texto(html)).toContain(
      "O paciente não informou dados nesta conversa.",
    );
    expect(texto(html)).not.toContain(T.aoAprovar);
  });

  it("revisão final da AG3: vazio na consulta já tratada diz que os dados não estão mais guardados", () => {
    for (const situacao of ["aprovada", "recusada", "cancelada"] as const) {
      const visivel = texto(corpo({ tipo: "pronto", dados: null }, situacao));
      expect(visivel, situacao).toContain(
        "Os dados informados não estão mais guardados para esta consulta.",
      );
      expect(visivel, situacao).not.toContain("O paciente não informou dados");
    }
  });

  it("os dados: nome, nascimento, CPF e carteirinha mascarados, para quem e quando", () => {
    const html = corpo({ tipo: "pronto", dados: DADOS });
    const visivel = texto(html);
    expect(visivel).toContain("Nome completo Paciente de Teste da Silva");
    expect(visivel).toContain("Data de nascimento 09/05/1990");
    expect(visivel).toContain("Para quem é a consulta Para o próprio paciente");
    expect(visivel).toContain("Informado em 21/10/2026 às 14:05");
    expect(visivel).toContain("No cadastro Ainda não aplicado.");
    // O CPF e a carteirinha chegam mascarados, cada um com o olho.
    expect(html).toContain("•••.456.789-••");
    expect(html).toContain("••••••••6789");
    expect(html).not.toContain("123.456.789-09");
    expect(html).not.toContain("0001 2345 6789");
    expect(html).toContain('aria-label="Mostrar CPF"');
    expect(html).toContain('aria-label="Mostrar carteirinha"');
    expect(html).toContain('<dl class="divide-y divide-border">');
  });

  it("revisão final da AG3: recusada e cancelada não dizem 'Ainda não aplicado.'", () => {
    expect(texto(corpo({ tipo: "pronto", dados: DADOS }, "recusada"))).toContain(
      "No cadastro Não entra no cadastro: a consulta foi recusada.",
    );
    expect(texto(corpo({ tipo: "pronto", dados: DADOS }, "cancelada"))).toContain(
      "No cadastro Não entra no cadastro: a consulta foi cancelada.",
    );
    for (const situacao of ["recusada", "cancelada"] as const) {
      expect(
        texto(corpo({ tipo: "pronto", dados: DADOS }, situacao)),
        situacao,
      ).not.toContain("Ainda não aplicado.");
    }
  });

  it("pendente: a frase do que a aprovação faz com os dados, pela regra real", () => {
    expect(texto(corpo({ tipo: "pronto", dados: DADOS }))).toContain(
      "Ao aprovar a consulta, estes dados entram no cadastro do paciente. O nome entra se o cadastro estiver sem nome ou com o nome que veio do WhatsApp; nascimento, CPF e carteirinha, só se estiverem vazios.",
    );
    // Ja tratada, ja aplicada ou para outra pessoa: a frase nao vale.
    expect(
      texto(corpo({ tipo: "pronto", dados: DADOS }, "aprovada")),
    ).not.toContain(T.aoAprovar);
    expect(
      texto(
        corpo({
          tipo: "pronto",
          dados: {
            ...DADOS,
            aplicadoEm: "2026-10-22T12:00:00.000Z",
            aplicadoPor: { nome: "Vinicius" },
          },
        }),
      ),
    ).not.toContain(T.aoAprovar);
    expect(
      texto(
        corpo({
          tipo: "pronto",
          dados: {
            ...DADOS,
            paraOTitular: false,
            nomeCompleto: null,
            dataNascimento: null,
            cpfMascarado: null,
            carteirinhaMascarada: null,
          },
        }),
      ),
    ).not.toContain(T.aoAprovar);
  });

  it("o que não foi informado diz que não foi, e para outra pessoa diz", () => {
    const visivel = texto(
      corpo({
        tipo: "pronto",
        dados: {
          ...DADOS,
          paraOTitular: false,
          nomeCompleto: null,
          dataNascimento: null,
          cpfMascarado: null,
          carteirinhaMascarada: null,
        },
      }),
    );
    expect(visivel).toContain("Nome completo Não informado");
    expect(visivel).toContain("Data de nascimento Não informada");
    expect(visivel).toContain("CPF Não informado");
    expect(visivel).toContain("Carteirinha Não informada");
    expect(visivel).toContain("Para quem é a consulta Para outra pessoa");
  });

  it("aplicado: quando, por quem e a regra real do cadastro", () => {
    const visivel = texto(
      corpo(
        {
          tipo: "pronto",
          dados: {
            ...DADOS,
            aplicadoEm: "2026-10-22T12:00:00.000Z",
            aplicadoPor: { nome: "Vinicius" },
          },
        },
        "aprovada",
      ),
    );
    expect(visivel).toContain(
      "No cadastro Aplicado em 22/10/2026 às 09:00, na aprovação por Vinicius.",
    );
    expect(visivel).toContain(
      "O nome entra se o cadastro estiver sem nome ou com o nome que veio do WhatsApp; nascimento, CPF e carteirinha, só se estiverem vazios.",
    );
    expect(visivel).not.toContain("só onde ele está vazio");
    expect(visivel).not.toContain("Só entrou o que estava vazio");
  });

  it("o CPF e a carteirinha: mascarados, com o olho de 40px que diz o que faz", () => {
    for (const [campo, mascarado, rotulo] of [
      ["cpf", "•••.456.789-••", "Mostrar CPF"],
      ["carteirinha", "••••••••6789", "Mostrar carteirinha"],
    ] as const) {
      const html = renderToStaticMarkup(
        <CampoProtegido campo={campo} mascarado={mascarado} aoRevelar={NAO_REVELA} />,
      );
      expect(html).toContain(mascarado);
      expect(texto(html)).toContain("oculto");
      const olho = html.match(/<button[^>]*>/)?.[0];
      expect(olho).toContain(`aria-label="${rotulo}"`);
      expect(olho).toContain('type="button"');
      // size="icon": 40px; sem aria-pressed (o rotulo muda com o estado).
      expect(olho).toContain("size-10");
      expect(olho).not.toContain("aria-pressed");
      expect(html).toContain("lucide-eye");
    }
  });

  it("revisão final da AG3: mostrar pede o dado à ação (uma vez, só o campo), e ocultar descarta", async () => {
    const revelar = vi
      .fn()
      .mockResolvedValue({ ok: true, valor: "12345678909" });
    const visivel = await alternarOCampo({ tipo: "oculto" }, "cpf", revelar);
    expect(visivel).toEqual({ tipo: "visivel", valor: "123.456.789-09" });
    expect(revelar).toHaveBeenCalledTimes(1);
    expect(revelar).toHaveBeenCalledWith("cpf");
    // Ocultar nao chama a acao e descarta o valor.
    expect(await alternarOCampo(visivel, "cpf", revelar)).toEqual({
      tipo: "oculto",
    });
    expect(revelar).toHaveBeenCalledTimes(1);
    // A carteirinha vem como esta; o erro da acao vira o texto do campo.
    expect(
      await alternarOCampo({ tipo: "oculto" }, "carteirinha", async () => ({
        ok: true,
        valor: "0001 2345 6789",
      })),
    ).toEqual({ tipo: "visivel", valor: "0001 2345 6789" });
    expect(
      await alternarOCampo({ tipo: "oculto" }, "cpf", async () => ({
        ok: false,
        error: "Não foi possível mostrar o dado. Tente de novo.",
        transitorio: true,
      })),
    ).toEqual({
      tipo: "erro",
      texto: "Não foi possível mostrar o dado. Tente de novo.",
    });
    expect(
      await alternarOCampo({ tipo: "oculto" }, "cpf", async () => ({
        ok: true,
        valor: null,
      })),
    ).toEqual({ tipo: "erro", texto: T.naoMostrou });
    // Visivel e com erro, renderizados.
    const aberto = renderToStaticMarkup(
      <CampoProtegido
        campo="cpf"
        mascarado="•••.456.789-••"
        aoRevelar={revelar}
        estadoInicial={{ tipo: "visivel", valor: "123.456.789-09" }}
      />,
    );
    expect(aberto).toContain("123.456.789-09");
    expect(aberto).toContain('aria-label="Ocultar CPF"');
    expect(aberto).toContain("lucide-eye-off");
    const comErro = renderToStaticMarkup(
      <CampoProtegido
        campo="cpf"
        mascarado="•••.456.789-••"
        aoRevelar={revelar}
        estadoInicial={{ tipo: "erro", texto: T.naoMostrou }}
      />,
    );
    expect(comErro).toContain('role="alert"');
    expect(texto(comErro)).toContain(T.naoMostrou);
  });

  it("revisão final da AG3: revelar pela ação do servidor; a que lança vira o erro que passa", async () => {
    acoes.revelarDadoInformadoAction.mockResolvedValue({ ok: true, valor: "x" });
    expect(await revelarODado(DA_IA.id, "cpf")).toEqual({ ok: true, valor: "x" });
    expect(acoes.revelarDadoInformadoAction).toHaveBeenCalledWith(DA_IA.id, "cpf");
    acoes.revelarDadoInformadoAction.mockRejectedValue(new Error("rede"));
    expect(await revelarODado(DA_IA.id, "carteirinha")).toEqual({
      ok: false,
      error: "Não foi possível mostrar o dado. Tente de novo.",
      transitorio: true,
    });
  });

  it("o diálogo: título, de quem é a consulta e o Fechar", () => {
    const html = renderToStaticMarkup(
      <DialogoDosDadosInformados
        aberto
        nome="Paciente de Teste"
        fuso={FUSO}
        situacao="pendente"
        estado={{ tipo: "pronto", dados: DADOS }}
        aoFechar={() => undefined}
        aoTentarDeNovo={() => undefined}
        aoRevelar={NAO_REVELA}
      />,
    );
    const visivel = texto(html);
    expect(visivel).toContain("Dados informados pelo paciente");
    expect(visivel).toContain(
      "O que o paciente informou ao assistente para marcar a consulta de Paciente de Teste.",
    );
    expect(html).toMatch(/<button[^>]*>Fechar<\/button>/);
    expect(
      renderToStaticMarkup(
        <DialogoDosDadosInformados
          aberto={false}
          nome={null}
          fuso={FUSO}
          situacao="pendente"
          estado={{ tipo: "carregando" }}
          aoFechar={() => undefined}
          aoTentarDeNovo={() => undefined}
          aoRevelar={NAO_REVELA}
        />,
      ),
    ).toBe("");
    expect(T.descricao(null)).toBe(
      "O que o paciente informou ao assistente para marcar esta consulta.",
    );
  });
});

describe("o botão no painel Pendente de você", () => {
  it("só na consulta da IA, com 40px, antes de Aprovar e Recusar", () => {
    const html = painel([DA_IA, ENCAIXE]);
    const daIa = cartao(html, "Paciente de Teste");
    const botao = daIa.match(
      /<button[^>]*>(?:(?!<\/button>).)*Ver dados informados<\/button>/,
    )?.[0];
    expect(botao).toBeDefined();
    expect(botao).toContain("h-10");
    expect(botao).toContain("lucide-file-user");
    expect(botao).not.toMatch(/ disabled=""/);
    expect(texto(daIa)).toMatch(/Ver dados informados .*Aprovar .*Recusar/);
    expect(texto(cartao(html, "Outra Pessoa"))).not.toContain(
      "Ver dados informados",
    );
  });

  it("quem não pode ler: visível, desabilitado, com a dica", () => {
    const daIa = cartao(painel([DA_IA], false), "Paciente de Teste");
    expect(daIa).toMatch(
      /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Ver dados informados/,
    );
  });

  it("o botão sozinho: habilitado chama ao abrir; sem permissão, a dica", () => {
    const livre = renderToStaticMarkup(
      <TooltipProvider>
        <BotaoDosDadosInformados podeLer aoAbrir={() => undefined} />
      </TooltipProvider>,
    );
    expect(livre).not.toContain("cursor-not-allowed");
    const preso = renderToStaticMarkup(
      <TooltipProvider>
        <BotaoDosDadosInformados podeLer={false} aoAbrir={() => undefined} />
      </TooltipProvider>,
    );
    expect(preso).toContain("cursor-not-allowed");
    expect(preso).toContain('disabled=""');
  });
});

describe("o item no menu da consulta", () => {
  it("pendente: o primeiro do grupo da consulta da IA, antes de Aprovar", () => {
    const html = menu(DA_IA);
    const grupo = html.indexOf("Consulta marcada pela IA");
    const item = html.indexOf("Ver dados informados");
    const aprovar = html.indexOf("Aprovar consulta");
    expect(grupo).toBeGreaterThan(-1);
    expect(item).toBeGreaterThan(grupo);
    expect(aprovar).toBeGreaterThan(item);
    expect(html.split("Ver dados informados")).toHaveLength(2);
    const tag = html.match(
      /<div role="menuitem"[^>]*>(?:(?!<\/div>).)*Ver dados informados<\/span><\/div>/,
    )?.[0];
    expect(tag).toContain("h-10");
    expect(tag).not.toContain("aria-disabled");
  });

  it("já tratada: junto de Ver histórico (mostra se entrou no cadastro)", () => {
    const html = menu({ ...DA_IA, approval_status: "aprovado" });
    const item = html.indexOf("Ver dados informados");
    const historico = html.indexOf("Ver histórico");
    expect(item).toBeGreaterThan(-1);
    expect(historico).toBeGreaterThan(item);
    expect(html).not.toContain("Aprovar consulta");
    expect(html.split("Ver dados informados")).toHaveLength(2);
  });

  it("encaixe e consulta da recepção: sem o item", () => {
    expect(menu(ENCAIXE)).not.toContain("Ver dados informados");
    expect(
      menu({ ...DA_IA, created_by: "usuario", approval_status: null }),
    ).not.toContain("Ver dados informados");
  });

  it("sem permissão: visível e desabilitado, com o porquê logo abaixo", () => {
    const html = menu(DA_IA, false);
    const tag = html.match(
      /<div role="menuitem"[^>]*>(?:(?!<\/div>).)*Ver dados informados<\/span><\/div>/,
    )?.[0];
    expect(tag).toContain('aria-disabled="true"');
    const descrito = tag?.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(descrito).toBeDefined();
    expect(html).toContain(
      `id="${descrito}" class="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary">Seu perfil não vê os dados que o paciente informou.`,
    );
  });

  it("o diálogo fechado não aparece", () => {
    expect(menu(DA_IA)).not.toContain("Dados informados pelo paciente");
  });
});

describe("cópia", () => {
  it("sem travessão e sem jargão", () => {
    const fixos: string[] = Object.values(T).flatMap((valor: unknown) =>
      typeof valor === "string" ? [valor] : [],
    );
    const amostras: string[] = [
      ...fixos,
      T.descricao("Paciente de Teste"),
      T.descricao(null),
      T.aplicado("22/10/2026 às 09:00", "Vinicius"),
      T.aplicado("22/10/2026 às 09:00", null),
      T.mostrar("CPF"),
      T.ocultar("carteirinha"),
      texto(corpo({ tipo: "pronto", dados: DADOS })),
      texto(corpo({ tipo: "pronto", dados: null })),
      texto(corpo({ tipo: "pronto", dados: null }, "cancelada")),
      texto(corpo({ tipo: "pronto", dados: DADOS }, "recusada")),
    ];
    for (const amostra of amostras) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(
        /\b(slot|hold|handoff|tenant|opt-in|appointment|para_o_titular)\b/i,
      );
      expect(amostra).not.toMatch(/encaixe/i);
    }
  });
});
