import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A dica do chip "Urgente" no cabecalho do fio, certa por papel (revisao da
// AG6a, achado 4c): so quem pode assumir ouve "Assuma para atender."; o
// Somente leitura, que acompanha sem assumir, ouve so o que aconteceu. O
// conteudo do tooltip do Radix so existe aberto, entao aqui o tooltip e
// trocado por um que desenha a dica junto do gatilho.

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-dica="">{children}</span>
  ),
}));
vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
  devolverParaIaAction: vi.fn(),
  elegibilidadeDoDevolverAction: vi.fn(),
  lerRascunhoBloqueadoAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { ChipDaUrgencia, Thread } =
  await import("@/components/atendimento/thread");
const { DICA_DA_URGENCIA } = await import("@/lib/design/status");
type ConversationListItem =
  import("@/lib/queries/conversations").ConversationListItem;
type Role = import("@/lib/domain/permissions").Role;

const EU = "11111111-1111-4111-8111-111111111111";
const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";

const URGENTE: ConversationListItem = {
  id: "1",
  status: "aguardando_humano",
  assignee_user_id: null,
  unread_count: 0,
  awaiting_reply: true,
  last_message_at: "2026-10-27T14:30:00.000Z",
  last_inbound_at: "2026-10-27T14:30:00.000Z",
  last_preview: "Oi",
  last_preview_kind: "texto",
  last_preview_author: "paciente",
  last_preview_author_user_id: null,
  tags: [],
  whatsapp_account_id: null,
  contact: {
    id: "contato-1",
    name: "Maria Silva",
    phone_e164: "+5585999990000",
    kind: "lead",
    funnel_stage: "novo",
    source_channel: null,
    source_campaign: null,
    first_contact_at: null,
  },
  urgente: { desde: "2026-10-27T10:00:00.000Z" },
};

/** As dicas desenhadas (o conteudo dos tooltips). */
function dicas(html: string): string[] {
  return [...html.matchAll(/<span data-dica="">([^<]*)<\/span>/g)].map(
    ([, texto = ""]) => texto,
  );
}

function cabecalho(viewerRole: Role, podeEditar: boolean): string {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Thread
        conversation={URGENTE}
        messages={[]}
        decisions={[]}
        isLoading={false}
        authorNames={{}}
        onBack={() => undefined}
        onToggleContext={() => undefined}
        footer={null}
        clinicId={CLINICA}
        viewerId={EU}
        viewerRole={viewerRole}
        podeEditar={podeEditar}
        ehChefia={false}
        onResponder={() => undefined}
        onApagar={() => undefined}
        emVoo={[]}
        aoTentarDeNovo={() => undefined}
        aoDescartarEnvio={() => undefined}
        aoIrParaConversa={() => undefined}
      />
    </QueryClientProvider>,
  );
  return html.slice(0, html.indexOf("</header>"));
}

describe("a dica do chip Urgente no cabeçalho do fio", () => {
  it("quem pode assumir é mandado assumir", () => {
    expect(dicas(renderToStaticMarkup(<ChipDaUrgencia />))).toEqual([
      DICA_DA_URGENCIA.podeAssumir,
    ]);
    expect(dicas(cabecalho("recepcao", true))).toContain(
      DICA_DA_URGENCIA.podeAssumir,
    );
  });

  it("o Somente leitura ouve só o que aconteceu, nunca Assuma", () => {
    expect(
      dicas(renderToStaticMarkup(<ChipDaUrgencia podeAssumir={false} />)),
    ).toEqual([DICA_DA_URGENCIA.soAcompanha]);
    const doFio = cabecalho("leitura", false);
    expect(dicas(doFio)).toContain(DICA_DA_URGENCIA.soAcompanha);
    expect(doFio).not.toContain("Assuma para atender");
  });
});
