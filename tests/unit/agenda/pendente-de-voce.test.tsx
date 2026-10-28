import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarCog, Sparkles } from "lucide-react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
import { ehConsultaDaIa, type ConsultaDaAgenda } from "@/lib/queries/agenda";

// Painel "Pendente de você" da Agenda no E4 (contrato da E4, secao 3;
// decisao D12 do dono de 20/10/2026): a consulta que a IA marcou aparece
// com o chip "Marcada pela IA" (3 camadas: CalendarCog, o rotulo e o tom da
// IA), o encaixe continua "Encaixe da IA" (Sparkles); o cartao traz
// paciente, procedimento com o convenio, profissional e o dia com a hora no
// fuso da clinica; Aprovar e Recusar com 40px, visiveis e desabilitados com
// a dica para quem nao edita; os textos do resultado (o aviso da conversa
// que nao voltou e warning, nunca sucesso calado). Nada aqui chama a acao.

vi.mock("@/app/(app)/agenda/actions", () => ({
  aprovarEncaixeAction: vi.fn(),
  recusarEncaixeAction: vi.fn(),
}));

const {
  CHIP_ENCAIXE_IA,
  CHIP_MARCADA_PELA_IA,
  chipDaPendencia,
  PendingPanel,
  retornoDaPendencia,
  TEXTOS_DO_PAINEL,
} = await import("@/components/agenda/pending-panel");

type Contexto = ComponentProps<typeof PendingPanel>["contexto"];

const FUSO = "America/Fortaleza";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const DICA = "Seu perfil não pode alterar a agenda";

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

// 21/10/2026 em Fortaleza (UTC-3): 17:00 UTC = 14:00 local.
const DA_IA: ConsultaDaAgenda = {
  id: "c0c0c0c0-0000-4000-8000-000000000001",
  unit_id: null,
  contact_id: "3d3d3d3d-0000-4000-8000-000000000001",
  professional_id: JOAO,
  service_link_id: "2c2c2c2c-0000-4000-8000-000000000001",
  resource_id: null,
  starts_at: "2026-10-21T17:00:00.000Z",
  ends_at: "2026-10-21T17:30:00.000Z",
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
    phone_e164: "5584900000000",
  },
  service_link: {
    id: "2c2c2c2c-0000-4000-8000-000000000001",
    duration_min: 30,
    procedure: { id: "p1", name: "Limpeza de pele" },
    insurance: null,
  },
};

const ENCAIXE: ConsultaDaAgenda = {
  ...DA_IA,
  id: "c0c0c0c0-0000-4000-8000-000000000002",
  is_overbooking: true,
  send_confirmation: true,
  starts_at: "2026-10-22T13:00:00.000Z",
  ends_at: "2026-10-22T13:30:00.000Z",
  contact: {
    id: "3d3d3d3d-0000-4000-8000-000000000002",
    name: "Outra Pessoa",
    phone_e164: "5584900000001",
  },
  service_link: {
    id: "2c2c2c2c-0000-4000-8000-000000000002",
    duration_min: 30,
    procedure: { id: "p2", name: "Consulta" },
    insurance: { id: "i1", name: "Plano Teste" },
  },
};

function render(pendencias: ConsultaDaAgenda[], podeEditar = true): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <PendingPanel contexto={contexto(podeEditar)} pendencias={pendencias} />
      </TooltipProvider>
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

// ---------------------------------------------------------------------------

describe("qual é qual", () => {
  it("consulta da IA é created_by 'ia' sem encaixe; o resto é encaixe", () => {
    expect(ehConsultaDaIa(DA_IA)).toBe(true);
    expect(ehConsultaDaIa(ENCAIXE)).toBe(false);
    expect(
      ehConsultaDaIa({ created_by: "usuario", is_overbooking: false }),
    ).toBe(false);
    expect(chipDaPendencia(DA_IA)).toBe(CHIP_MARCADA_PELA_IA);
    expect(chipDaPendencia(ENCAIXE)).toBe(CHIP_ENCAIXE_IA);
    // Pendencia que nao e da IA continua no desenho de antes.
    expect(
      chipDaPendencia({ created_by: "usuario", is_overbooking: false }),
    ).toBe(CHIP_ENCAIXE_IA);
  });
});

describe("chip em 3 camadas", () => {
  it("Marcada pela IA: CalendarCog, o rótulo e o tom da IA", () => {
    expect(CHIP_MARCADA_PELA_IA).toEqual({
      label: "Marcada pela IA",
      tone: "ai",
      icon: CalendarCog,
    });
    const html = cartao(render([DA_IA]), "Paciente de Teste");
    expect(html).toContain("lucide-calendar-cog");
    expect(html).toContain("color:var(--ai-text)");
    expect(html).toContain("background-color:var(--ai-bg)");
    expect(texto(html)).toContain("Marcada pela IA");
    expect(texto(html)).not.toContain("Encaixe da IA");
  });

  it("Encaixe da IA continua com o Sparkles; os dois com forma distinta", () => {
    expect(CHIP_ENCAIXE_IA).toEqual({
      label: "Encaixe da IA",
      tone: "ai",
      icon: Sparkles,
    });
    expect(CHIP_MARCADA_PELA_IA.icon).not.toBe(CHIP_ENCAIXE_IA.icon);
    const html = cartao(render([ENCAIXE]), "Outra Pessoa");
    expect(html).toContain("lucide-sparkles");
    expect(texto(html)).toContain("Encaixe da IA");
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

  it("CalendarCog só existe no painel, em nenhuma outra tela", () => {
    expect(quemImporta("CalendarCog")).toEqual([
      "components/agenda/pending-panel.tsx",
    ]);
  });

  it("nenhum mapa global usa o CalendarCog, e o Sparkles só sai no tom da IA", () => {
    expect(GLOBAIS.some((d) => d.icon === CalendarCog)).toBe(false);
    for (const definicao of GLOBAIS.filter((d) => d.icon === Sparkles)) {
      expect(definicao.tone).toBe("ai");
    }
  });
});

describe("cartão", () => {
  it("paciente, procedimento com o convênio, profissional e o dia no fuso da clínica", () => {
    const html = render([DA_IA, ENCAIXE]);
    const daIa = texto(cartao(html, "Paciente de Teste"));
    expect(daIa).toContain("Limpeza de pele · Particular");
    expect(daIa).toContain("Dr. João Pereira");
    // 17:00 UTC = 14:00 em Fortaleza
    expect(daIa).toContain("21/10 · 14:00");
    const encaixe = texto(cartao(html, "Outra Pessoa"));
    expect(encaixe).toContain("Consulta · Plano Teste");
    expect(encaixe).toContain("22/10 · 10:00");
  });

  it("quem edita: Aprovar e Recusar habilitados, com 40px", () => {
    // AG3: a consulta da IA tem tambem "Ver dados informados", antes deles.
    const html = cartao(render([DA_IA]), "Paciente de Teste");
    const botoes = html.match(/<button[^>]*>/g) ?? [];
    expect(botoes).toHaveLength(3);
    for (const botao of botoes) {
      expect(botao).toContain("h-10");
      expect(botao).not.toMatch(/ disabled=""/);
    }
    expect(texto(html)).toMatch(/Ver dados informados .*Aprovar .*Recusar/);
    // O encaixe continua so com os dois.
    const encaixe = cartao(render([ENCAIXE]), "Outra Pessoa");
    expect(encaixe.match(/<button[^>]*>/g) ?? []).toHaveLength(2);
    expect(texto(encaixe)).not.toContain("Ver dados informados");
  });

  it("sem permissão: os três visíveis e desabilitados, com a dica", () => {
    const html = cartao(render([DA_IA], false), "Paciente de Teste");
    const gatilhos =
      html.match(
        /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*disabled=""[^>]*>/g,
      ) ?? [];
    expect(gatilhos).toHaveLength(3);
    expect(texto(html)).toMatch(/Ver dados informados .*Aprovar .*Recusar/);
  });

  it("vazio: diz que a IA deixa aqui a consulta marcada, a remarcação e o encaixe", () => {
    const visivel = texto(render([]));
    expect(visivel).toContain("Nada pendente de você");
    // AG4: a remarcacao pedida pela IA tambem espera aqui.
    expect(visivel).toContain(
      "Quando a IA marcar ou remarcar uma consulta, ou sugerir um encaixe, aparece aqui para a equipe aprovar.",
    );
    // A legenda dos 10 status continua embaixo.
    expect(visivel).toContain("Legenda de situações");
  });
});

describe("o que a tela diz depois", () => {
  it("consulta da IA aprovada ou recusada pede para avisar o paciente", () => {
    expect(retornoDaPendencia({ ok: true }, "aprovar", true)).toEqual({
      tipo: "success",
      texto: "Consulta aprovada. Avise o paciente pelo Atendimento.",
    });
    expect(retornoDaPendencia({ ok: true }, "recusar", true)).toEqual({
      tipo: "success",
      texto: "Consulta recusada. Avise o paciente pelo Atendimento.",
    });
  });

  it("a conversa que não voltou é warning, nunca sucesso calado", () => {
    const aviso =
      "A consulta foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.";
    expect(retornoDaPendencia({ ok: true, aviso }, "recusar", true)).toEqual({
      tipo: "warning",
      texto: aviso,
    });
  });

  it("encaixe como antes; já tratada é informação; erro é erro", () => {
    expect(retornoDaPendencia({ ok: true }, "aprovar", false)).toEqual({
      tipo: "success",
      texto: "Encaixe aprovado",
    });
    expect(retornoDaPendencia({ ok: true }, "recusar", false)).toEqual({
      tipo: "success",
      texto: "Encaixe recusado",
    });
    expect(
      retornoDaPendencia(
        {
          ok: false,
          code: "ja_tratado",
          error: "Esta consulta já foi tratada.",
        },
        "aprovar",
        true,
      ),
    ).toEqual({ tipo: "info", texto: "Esta consulta já foi tratada." });
    expect(retornoDaPendencia({ ok: false }, "recusar", true)).toEqual({
      tipo: "error",
      texto: "Não foi possível tratar a consulta. Tente de novo.",
    });
    expect(
      retornoDaPendencia({ ok: false, error: "X." }, "aprovar", false),
    ).toEqual({ tipo: "error", texto: "X." });
  });

  it("cópia sem travessão e sem jargão", () => {
    const amostras = [
      ...Object.values(TEXTOS_DO_PAINEL),
      CHIP_MARCADA_PELA_IA.label,
      CHIP_ENCAIXE_IA.label,
      ...(["aprovar", "recusar"] as const).flatMap((acao) => [
        retornoDaPendencia({ ok: true }, acao, true).texto,
        retornoDaPendencia({ ok: true }, acao, false).texto,
        retornoDaPendencia({ ok: false }, acao, true).texto,
        retornoDaPendencia({ ok: false }, acao, false).texto,
      ]),
    ];
    for (const amostra of amostras) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(/\b(slot|hold|handoff|tenant|opt-in)\b/i);
    }
  });
});
