import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AtividadeResumo } from "@/lib/queries/atividades";

// A linha de atividade e a secao do contato (drawer, conversa e ficha),
// renderizadas no servidor: concluir com alvo de 40px e nome acessivel, chip
// de situacao nas 3 camadas, contato abrindo a ficha, responsavel "Você";
// sem permissao, concluir e "Nova atividade" visiveis, desabilitados e com a
// dica; e os estados carregando, erro com "Tentar de novo", vazio e o "Ver
// todas" com o recorte do contato.

vi.mock("@/app/(app)/atividades/actions", () => ({
  adiarAtividadeAction: vi.fn(),
  cancelarAtividadeAction: vi.fn(),
  concluirAtividadeAction: vi.fn(),
  reabrirAtividadeAction: vi.fn(),
  criarAtividadeAction: vi.fn(),
  editarAtividadeAction: vi.fn(),
  equipeDaAtividadeAction: vi.fn(),
  conversaDoContatoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { LinhaDeAtividade } =
  await import("@/components/atividades/linha-de-atividade");
const { SecaoDeAtividades } =
  await import("@/components/atividades/secao-de-atividades");

const FORTALEZA = "America/Fortaleza";
const AGORA = new Date("2026-10-02T18:00:00.000Z"); // 15:00 em Fortaleza
const EU = "00000000-0000-4000-8000-000000000001";
const CONTATO = "00000000-0000-4000-8000-0000000000aa";
const DICA = "Seu perfil não pode editar leads e pacientes";

function atividade(parcial: Partial<AtividadeResumo> = {}): AtividadeResumo {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    contact_id: CONTATO,
    conversation_id: null,
    titulo: "Ligar para lembrar do retorno",
    detalhes: null,
    due_on: "2026-09-30",
    due_at: null,
    assignee_user_id: EU,
    status: "pendente",
    origem: "manual",
    created_by: EU,
    completed_at: null,
    completed_by: null,
    canceled_at: null,
    created_at: "2026-09-01T12:00:00.000Z",
    contato: { id: CONTATO, nome: "Maria Clara", telefone: "+5585999990000" },
    ...parcial,
  };
}

const ACOES = {
  concluir: vi.fn(),
  reabrir: vi.fn(),
  cancelar: vi.fn(),
  adiar: vi.fn(),
  editar: vi.fn(),
};

function contexto(podeEditar: boolean) {
  return {
    agora: AGORA,
    hoje: "2026-10-02",
    timezone: FORTALEZA,
    nomes: { [EU]: "Ana Recepção" },
    ativos: [EU],
    eu: EU,
    podeEditar,
    dica: DICA,
  };
}

function texto(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("LinhaDeAtividade", () => {
  it("lista: concluir de 40px, chip nas 3 camadas, contato e responsável", () => {
    const markup = renderToStaticMarkup(
      <ul>
        <LinhaDeAtividade
          atividade={atividade()}
          forma="lista"
          ocupada={false}
          acoes={ACOES}
          contexto={contexto(true)}
        />
      </ul>,
    );
    expect(markup).toContain(
      'aria-label="Concluir: Ligar para lembrar do retorno"',
    );
    // size-10 = 40px (alvo de toque)
    expect(markup).toMatch(/data-size="icon"[^>]*class="[^"]*size-10/);
    const visivel = texto(markup);
    expect(visivel).toContain("Atrasada");
    expect(markup).toContain("<svg"); // a forma do icone vai junto do rotulo
    expect(visivel).toContain("30/09");
    expect(markup).toContain(`href="/pacientes/${CONTATO}"`);
    expect(visivel).toContain("Maria Clara");
    expect(visivel).toContain("Você");
    expect(visivel).not.toMatch(/[–—]/);
  });

  it("sem permissão: concluir visível, desabilitado e com a dica", () => {
    const markup = renderToStaticMarkup(
      <ul>
        <LinhaDeAtividade
          atividade={atividade({ due_on: "2026-10-02" })}
          forma="lista"
          ocupada={false}
          acoes={ACOES}
          contexto={contexto(false)}
        />
      </ul>,
    );
    expect(markup).toContain(`data-dica="${DICA}"`);
    expect(markup).toMatch(/aria-label="Concluir: [^"]+"[^>]*disabled/);
    expect(texto(markup)).toContain("Para hoje");
  });

  it("responsável que saiu da equipe aparece sem acesso", () => {
    const markup = renderToStaticMarkup(
      <ul>
        <LinhaDeAtividade
          atividade={atividade({
            assignee_user_id: "00000000-0000-4000-8000-000000000009",
          })}
          forma="compacta"
          ocupada={false}
          acoes={ACOES}
          contexto={{
            ...contexto(true),
            nomes: {
              ...contexto(true).nomes,
              "00000000-0000-4000-8000-000000000009": "Bia Antiga",
            },
          }}
        />
      </ul>,
    );
    expect(texto(markup)).toContain("Bia (sem acesso)");
  });
});

/** A secao le a equipe pelo TanStack (desligado sem clinica): precisa do provider. */
function comConsulta(elemento: ReactElement): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      {elemento}
    </QueryClientProvider>,
  );
}

describe("SecaoDeAtividades", () => {
  const props = {
    contato: { id: CONTATO, nome: "Maria Clara", telefone: "+5585999990000" },
    timezone: FORTALEZA,
    aoTentarDeNovo: vi.fn(),
    aoMudar: vi.fn(),
    nomes: { [EU]: "Ana Recepção" },
    podeEditar: true,
    dica: DICA,
    agoraInicial: AGORA.toISOString(),
  };

  it("carregando: esqueleto com aviso para leitor de tela", () => {
    const markup = comConsulta(
      <SecaoDeAtividades {...props} estado="carregando" atividades={null} />,
    );
    expect(texto(markup)).toContain("Carregando as atividades");
  });

  it("erro: diz que não carregou e oferece Tentar de novo", () => {
    const markup = comConsulta(
      <SecaoDeAtividades {...props} estado="erro" atividades={null} />,
    );
    const visivel = texto(markup);
    expect(visivel).toContain("Não foi possível carregar as atividades.");
    expect(visivel).toContain("Tentar de novo");
    expect(visivel).not.toContain("Nenhuma atividade");
  });

  it("vazio: diz que não há pendente, com Nova atividade e Ver todas", () => {
    const markup = comConsulta(
      <SecaoDeAtividades
        {...props}
        estado="pronto"
        atividades={{ pendentes: [], concluidas: [] }}
      />,
    );
    const visivel = texto(markup);
    expect(visivel).toContain("Nenhuma atividade pendente para este contato.");
    expect(visivel).toContain("Nova atividade");
    expect(markup).toContain(
      `href="/atividades?quem=todas&amp;contato=${CONTATO}"`,
    );
  });

  it("até 3 pendentes e o aviso das que ficaram em Ver todas", () => {
    const pendentes = [1, 2, 3, 4].map((n) =>
      atividade({
        id: `00000000-0000-4000-8000-00000000a00${n}`,
        titulo: `Tarefa ${n}`,
        due_on: `2026-10-0${n + 2}`,
      }),
    );
    const markup = comConsulta(
      <SecaoDeAtividades
        {...props}
        estado="pronto"
        atividades={{ pendentes, concluidas: [] }}
      />,
    );
    const visivel = texto(markup);
    expect(visivel).toContain("Tarefa 1");
    expect(visivel).toContain("Tarefa 3");
    expect(visivel).not.toContain("Tarefa 4");
    expect(visivel).toContain("E mais 1 pendente em Ver todas.");
  });

  it("sem permissão: Nova atividade visível, desabilitado e com a dica", () => {
    const markup = comConsulta(
      <SecaoDeAtividades
        {...props}
        podeEditar={false}
        estado="pronto"
        atividades={{ pendentes: [], concluidas: [] }}
      />,
    );
    expect(markup).toContain(`data-dica="${DICA}"`);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>.*Nova atividade/);
  });
});
