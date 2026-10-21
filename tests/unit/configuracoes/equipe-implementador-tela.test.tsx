import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SessionContext } from "@/lib/auth/active-clinic";

// O Implementador nas telas da equipe (onda 5, item 18; contrato B.3): a
// coluna e a frase na tabela dos papeis, a linha da equipe travada para quem
// nao e administrador pleno (visivel e desabilitada, com a dica alcançavel),
// o aviso de LGPD do convite e o rotulo na troca de clinica. As opcoes dos
// seletores moram no conteudo do Radix, que nao renderiza fechado; as regras
// delas (opcao travada e o porque) estao em
// tests/unit/domain/papel-implementador.test.ts.

vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/configuracoes/actions", () => ({
  desativarMembroAction: vi.fn(),
  mudarPapelAction: vi.fn(),
  reativarMembroAction: vi.fn(),
  vincularProfissionalAction: vi.fn(),
  aprovarMembroAction: vi.fn(),
  recusarMembroAction: vi.fn(),
  gerarNovoCodigoAction: vi.fn(),
  alternarCodigoAction: vi.fn(),
}));
vi.mock("@/app/(app)/atendimento/agendadas-actions", () => ({
  cancelarAgendadasDaPessoaAction: vi.fn(),
}));
vi.mock("@/app/(auth)/actions", () => ({
  inviteMemberAction: vi.fn(),
  pickClinicAction: vi.fn(),
  signOutAction: vi.fn(),
}));
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao.atual,
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const { PainelPapeis } = await import("@/components/configuracoes/painel-papeis");
const { ListaEquipe } = await import("@/components/configuracoes/lista-equipe");
const { PendentesList } = await import("@/app/(app)/configuracoes/equipe-client");
const { InviteForm } = await import("@/app/(app)/configuracoes/invite-form");
const { default: SelecionarClinicaPage } = await import(
  "@/app/(auth)/selecionar-clinica/page"
);
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { AVISO_DO_IMPLEMENTADOR } = await import(
  "@/components/configuracoes/papel-na-equipe"
);

const DICA = "Somente administradores e gestores alteram as configurações";

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("tabela dos papéis", () => {
  const html = renderToStaticMarkup(<PainelPapeis />);

  it("a coluna Implementador logo depois de Administrador, com a frase", () => {
    const cabecalhos = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(
      (casamento) => texto(casamento[1] ?? "").trim(),
    );
    expect(cabecalhos).toEqual([
      "Tela",
      "Administrador",
      "Implementador",
      "Gestor",
      "Recepção",
      "Profissional",
      "Somente leitura",
    ]);
    expect(texto(html)).toContain(
      "Vê e faz tudo o que o administrador faz, menos mexer em administradores e exportar os leads.",
    );
  });

  it("as células do Implementador são as do administrador", () => {
    const linhas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1);
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) {
      const celulas = [...(linha[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
        (casamento) => texto(casamento[1] ?? "").trim(),
      );
      expect(celulas[2]).toBe(celulas[1]);
    }
  });
});

const MEMBROS = [
  {
    userId: "u-dona",
    nome: "Dona",
    email: "dona@clinica.test",
    papel: "admin" as const,
    implementador: false,
    ativo: true,
    professionalId: null,
  },
  {
    userId: "u-tecnico",
    nome: "Técnico",
    email: "tecnico@agencia.test",
    papel: "admin" as const,
    implementador: true,
    ativo: true,
    professionalId: null,
  },
  {
    userId: "u-ana",
    nome: "Ana",
    email: "ana@clinica.test",
    papel: "recepcao" as const,
    implementador: false,
    ativo: true,
    professionalId: null,
  },
];

function lista(meuUserId: string, ehAdminPleno: boolean): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ListaEquipe
        membros={MEMBROS}
        meuUserId={meuUserId}
        podeGerenciar
        ehAdminPleno={ehAdminPleno}
        dica={DICA}
        profissionais={[]}
      />
    </TooltipProvider>,
  );
}

describe("lista da equipe", () => {
  it("o Implementador não mexe no administrador nem em si, mas na recepção sim", () => {
    const html = lista("u-tecnico", false);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Papel de Dona")(?=[^>]*disabled="")/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Papel de Técnico")(?=[^>]*disabled="")/);
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="Papel de Ana")(?=[^>]*disabled="")/);
    // A acao travada fica alcancavel pela dica (o span com tabindex).
    expect(html).toContain('tabindex="0"');
  });

  it("o gestor não mexe no Implementador", () => {
    const html = lista("u-gestor", false);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Papel de Técnico")(?=[^>]*disabled="")/);
  });

  it("o administrador pleno mexe no Implementador", () => {
    const html = lista("u-dona", true);
    expect(html).not.toMatch(
      /<button(?=[^>]*aria-label="Papel de Técnico")(?=[^>]*disabled="")/,
    );
    expect(html).toMatch(/<button(?=[^>]*aria-label="Papel de Dona")(?=[^>]*disabled="")/);
  });
});

describe("pedidos de entrada e convite", () => {
  it("a lista de pedidos abre com Recepção, sem o aviso de LGPD", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PendentesList
          pendentes={[{ userId: "u-novo", nome: "Novo", email: "novo@x.test" }]}
          podeGerenciar
          ehAdminPleno={false}
          dica={DICA}
          profissionais={[]}
        />
      </TooltipProvider>,
    );
    expect(texto(html)).toContain("Liberar");
    expect(html).not.toContain(AVISO_DO_IMPLEMENTADOR);
  });

  it("o convite abre com Recepção, sem o aviso; o aviso fixo fala de LGPD sem travessão", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <InviteForm canInvite hint={DICA} ehAdminPleno />
      </TooltipProvider>,
    );
    expect(html).toContain("Convidar por e-mail");
    expect(html).not.toContain(AVISO_DO_IMPLEMENTADOR);
    expect(AVISO_DO_IMPLEMENTADOR).toBe(
      "O implementador vê tudo o que o administrador vê, inclusive as conversas e os dados dos pacientes. Convide só quem a clínica autorizou.",
    );
  });
});

describe("troca de clínica", () => {
  it("mostra Implementador na clínica da marca e Administrador na outra", async () => {
    const vinculo = (clinicId: string, nome: string, implementador: boolean) => ({
      clinicId,
      clinicName: nome,
      slug: "",
      timezone: "America/Fortaleza",
      role: "admin" as const,
      implementador,
      status: "ativo" as const,
      productName: "Conduzza Clínicas",
      primaryColor: "#B2E54F",
      labels: null,
    });
    const contexto: SessionContext = {
      userId: "u-tecnico",
      userName: "Técnico",
      userEmail: "tecnico@agencia.test",
      memberships: [
        vinculo("c1", "Clínica Bem Estar", true),
        vinculo("c2", "Salud", false),
      ],
      active: null,
      clinicaSuspensa: null,
      isProductAdmin: false,
      vinculoIndisponivel: false,
      marcaDeImplementadorIndisponivel: false,
    };
    sessao.atual = contexto;
    const html = renderToStaticMarkup(await SelecionarClinicaPage());
    const visivel = texto(html);
    expect(visivel).toContain("Clínica Bem Estar Implementador");
    expect(visivel).toContain("Salud Administrador");
  });
});
