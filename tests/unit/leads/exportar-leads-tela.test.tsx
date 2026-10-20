import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CABECALHO_DA_CLINICA_DA_TELA,
  DICA_EXPORTAR_LEADS,
  MENSAGEM_EXPORTACAO_FALHOU,
  MENSAGEM_EXPORTACAO_SEM_CONEXAO,
  MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
  MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR,
  mensagemAcimaDoTeto,
} from "@/lib/domain/exportacao-de-leads";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { ValoresDosFiltrosDeLeads } from "@/lib/domain/leads-ui";
import type { LeadResumo } from "@/lib/queries/leads";

// A tela do Exportar (Tela 4): o botao habilitado para administrador e
// gestor e desabilitado com a dica do dono para os outros papeis, o
// "Exportando..." enquanto gera, o aviso de erro (com "Tentar de novo" so
// quando adianta) e o de zero lead; o pedido do navegador (so os filtros
// preenchidos, o arquivo pelo Blob para o BOM chegar inteiro) e o botao na
// barra da tela, nas visoes Kanban e Lista.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

let parametrosDaUrl = "visao=lista";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(parametrosDaUrl),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/realtime/use-leads-channel", () => ({
  useLeadsChannel: () => undefined,
}));
vi.mock("@/app/(app)/leads/actions", () => ({
  mudarEtapaAction: vi.fn(),
  etiquetarAction: vi.fn(),
  reatribuirAction: vi.fn(),
  criarLeadAction: vi.fn(),
  abrirDetalheDoContatoAction: vi.fn(),
  importarContatosAction: vi.fn(),
}));
// A gaveta oferece "Iniciar conversa" (20/10/2026): a Server Action dele
// fica de fora, como as outras.
vi.mock("@/app/(app)/atendimento/iniciar-conversa-actions", () => ({
  iniciarConversaAction: vi.fn(),
}));
vi.mock("@/app/(app)/atividades/actions", () => ({
  equipeDaAtividadeAction: vi.fn(),
  conversaDoContatoAction: vi.fn(),
  atividadesDoContatoAction: vi.fn(),
  criarAtividadeAction: vi.fn(),
  editarAtividadeAction: vi.fn(),
  adiarAtividadeAction: vi.fn(),
  cancelarAtividadeAction: vi.fn(),
  concluirAtividadeAction: vi.fn(),
  reabrirAtividadeAction: vi.fn(),
}));

const {
  AvisoDaExportacaoDeLeads,
  BotaoExportarLeads,
  pedirExportacaoDeLeads,
  ROTA_DA_EXPORTACAO_DE_LEADS,
} = await import("@/components/leads/exportar-leads");
const { LeadsClient } = await import("@/app/(app)/leads/leads-client");

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O atributo disabled do botao (a classe "disabled:..." nao conta). */
function desabilitado(botao: string): boolean {
  return /<button[^>]*\sdisabled=""/.test(botao);
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

describe("botão Exportar", () => {
  it("administrador e gestor: habilitado, 40px, ícone de download", () => {
    const html = renderToStaticMarkup(
      <BotaoExportarLeads
        podeExportar
        exportando={false}
        aoExportar={() => undefined}
      />,
    );
    expect(texto(html)).toBe("Exportar");
    expect(desabilitado(html)).toBe(false);
    expect(html).not.toContain("data-dica");
    expect(html).toContain("h-10");
    expect(html).toContain("lucide-download");
  });

  it("recepção, profissional e leitura: visível, desabilitado e com a dica do dono", () => {
    const html = renderToStaticMarkup(
      <BotaoExportarLeads
        podeExportar={false}
        exportando={false}
        aoExportar={() => undefined}
      />,
    );
    expect(texto(html)).toBe("Exportar");
    expect(html).toContain(`data-dica="${DICA_EXPORTAR_LEADS}"`);
    expect(desabilitado(html)).toBe(true);
  });

  it("carregando: Exportando..., desabilitado e ocupado", () => {
    const html = renderToStaticMarkup(
      <BotaoExportarLeads
        podeExportar
        exportando
        aoExportar={() => undefined}
      />,
    );
    expect(texto(html)).toBe("Exportando...");
    expect(desabilitado(html)).toBe(true);
    expect(html).toContain('aria-busy="true"');
    // No celular so o icone fica a vista: ele gira enquanto gera (parado
    // com prefers-reduced-motion).
    expect(html).toContain("animate-spin");
    expect(html).toContain("motion-reduce:animate-none");
  });

  it("parado: o ícone de baixar, sem girar", () => {
    const html = renderToStaticMarkup(
      <BotaoExportarLeads
        podeExportar
        exportando={false}
        aoExportar={() => undefined}
      />,
    );
    expect(html).not.toContain("animate-spin");
  });

  it("no celular o rótulo vira só leitor de tela (a barra não estoura)", () => {
    const html = renderToStaticMarkup(
      <BotaoExportarLeads
        podeExportar
        exportando={false}
        aoExportar={() => undefined}
      />,
    );
    expect(html).toContain('<span class="max-sm:sr-only">Exportar</span>');
  });
});

describe("avisos da exportação", () => {
  it("zero lead: a frase do dono, como status, sem arquivo", () => {
    const html = renderToStaticMarkup(
      <AvisoDaExportacaoDeLeads
        aviso={{ tipo: "vazio" }}
        aoDispensar={() => undefined}
        aoTentarDeNovo={() => undefined}
      />,
    );
    expect(texto(html)).toContain(MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR);
    expect(html).toContain('role="status"');
    expect(texto(html)).not.toContain("Tentar de novo");
  });

  it("erro que tentar de novo resolve: a mensagem e o Tentar de novo", () => {
    const html = renderToStaticMarkup(
      <AvisoDaExportacaoDeLeads
        aviso={{
          tipo: "erro",
          mensagem: MENSAGEM_EXPORTACAO_SEM_CONEXAO,
          podeTentarDeNovo: true,
        }}
        aoDispensar={() => undefined}
        aoTentarDeNovo={() => undefined}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain(MENSAGEM_EXPORTACAO_SEM_CONEXAO);
    expect(texto(html)).toContain("Tentar de novo");
  });

  it("erro que não muda tentando (teto, papel): sem Tentar de novo", () => {
    const mensagem = mensagemAcimaDoTeto(23456);
    const html = renderToStaticMarkup(
      <AvisoDaExportacaoDeLeads
        aviso={{ tipo: "erro", mensagem, podeTentarDeNovo: false }}
        aoDispensar={() => undefined}
        aoTentarDeNovo={() => undefined}
      />,
    );
    expect(texto(html)).toContain("23.456");
    expect(texto(html)).not.toContain("Tentar de novo");
  });

  it("sem aviso: nada na tela", () => {
    expect(
      renderToStaticMarkup(
        <AvisoDaExportacaoDeLeads
          aviso={null}
          aoDispensar={() => undefined}
          aoTentarDeNovo={() => undefined}
        />,
      ),
    ).toBe("");
  });
});

const CLINICA_DA_TELA = "c1111111-1111-4111-8111-111111111111";

const SEM_FILTROS: ValoresDosFiltrosDeLeads = {
  etapa: "",
  origem: "",
  campanha: "",
  anuncio: "",
  resp: "",
  de: "",
  ate: "",
};

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("o pedido do navegador", () => {
  it("POST com JSON, só os filtros preenchidos e a clínica que a tela mostra", async () => {
    const buscar = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      { ...SEM_FILTROS, etapa: "novo", de: "2026-10-01" },
      buscar,
    );
    const [url, init] = buscar.mock.calls[0] ?? [];
    expect(url).toBe(ROTA_DA_EXPORTACAO_DE_LEADS);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      [CABECALHO_DA_CLINICA_DA_TELA]: CLINICA_DA_TELA,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      etapa: "novo",
      de: "2026-10-01",
    });
  });

  it("204: zero lead, sem arquivo", async () => {
    const resposta = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () => new Response(null, { status: 204 })) as typeof fetch,
    );
    expect(resposta).toEqual({ tipo: "vazio" });
  });

  it("200: o arquivo pelo Blob, com o BOM e o nome do servidor", async () => {
    const conteudo = "﻿Nome;Telefone\r\nJoão;(85) 99999-0001";
    const resposta = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () =>
        new Response(conteudo, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition":
              'attachment; filename="leads-2026-10-20.csv"',
          },
        })) as typeof fetch,
    );
    expect(resposta.tipo).toBe("arquivo");
    if (resposta.tipo !== "arquivo") {
      return;
    }
    expect(resposta.nome).toBe("leads-2026-10-20.csv");
    const bytes = new Uint8Array(await resposta.arquivo.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("403: a dica do servidor, sem Tentar de novo", async () => {
    const resposta = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () =>
        respostaJson(403, { mensagem: DICA_EXPORTAR_LEADS })) as typeof fetch,
    );
    expect(resposta).toEqual({
      tipo: "erro",
      mensagem: DICA_EXPORTAR_LEADS,
      podeTentarDeNovo: false,
    });
  });

  it("422 (acima do teto): a mensagem do servidor, sem Tentar de novo", async () => {
    const mensagem = mensagemAcimaDoTeto(20001);
    const resposta = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () => respostaJson(422, { mensagem })) as typeof fetch,
    );
    expect(resposta).toEqual({
      tipo: "erro",
      mensagem,
      podeTentarDeNovo: false,
    });
  });

  it("503 e 500: Tentar de novo; sem JSON, a mensagem padrão", async () => {
    const trilha = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () =>
        respostaJson(503, {
          mensagem: "Não foi possível registrar a exportação. Tente de novo.",
        })) as typeof fetch,
    );
    expect(trilha).toMatchObject({ tipo: "erro", podeTentarDeNovo: true });
    const semJson = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () => new Response("<html>", { status: 500 })) as typeof fetch,
    );
    expect(semJson).toEqual({
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_FALHOU,
      podeTentarDeNovo: true,
    });
  });

  it("rede caída e sessão vencida (o login redireciona)", async () => {
    const semRede = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    );
    expect(semRede).toEqual({
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_SEM_CONEXAO,
      podeTentarDeNovo: true,
    });
    const redirecionada = new Response("<html>login</html>", { status: 200 });
    Object.defineProperty(redirecionada, "redirected", { value: true });
    const vencida = await pedirExportacaoDeLeads(
      CLINICA_DA_TELA,
      SEM_FILTROS,
      (async () => redirecionada) as typeof fetch,
    );
    expect(vencida).toEqual({
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
      podeTentarDeNovo: false,
    });
  });
});

const JORNADA: EtapaDaJornada[] = [
  {
    id: "e1",
    chave: "novo",
    nome: "Novo",
    posicao: 1,
    tom: "info",
    icone: "badge-plus",
    papel: "entrada",
    descricao: null,
    termos_chave: [],
    termos_de_quem: "paciente",
    meta_event_name: null,
    conversao_ativa: false,
    is_sale: false,
    is_first_contact: true,
    value_source: null,
    value_cents: null,
  },
];

const LEAD: LeadResumo = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Maria Silva",
  phone_e164: "+5585999990001",
  funnel_stage: "novo",
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
  first_contact_at: "2026-10-05T12:00:00.000Z",
  last_contact_at: null,
  insurance: null,
  consent_ativo: false,
  anuncio_meta: { estado: "lida", anuncio: null },
};

function telaDeLeads(podeExportar: boolean, visao: "lista" | "kanban"): string {
  parametrosDaUrl = `visao=${visao}`;
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <LeadsClient
        clinicId="c1111111-1111-4111-8111-111111111111"
        timezone="America/Fortaleza"
        leadsIniciais={[LEAD]}
        totalInicial={1}
        reguasIniciais={[]}
        mapaInicial={{ anuncios: [], titulos: [] }}
        jornada={JORNADA}
        membros={{}}
        responsaveisAtivos={[]}
        podeEditar={podeExportar}
        dica="Seu perfil não pode editar leads e pacientes"
        podeExportar={podeExportar}
        podeAgendar={podeExportar}
        dicaAgendar="Seu perfil não pode alterar a agenda"
        soAtribuidas={false}
      />
    </QueryClientProvider>,
  );
}

describe("o Exportar na barra da tela de Leads", () => {
  for (const visao of ["lista", "kanban"] as const) {
    it(`visão ${visao}: ao lado de Importar planilha, habilitado para quem exporta`, () => {
      const html = telaDeLeads(true, visao);
      const exportar = botaoCom(html, "Exportar");
      expect(desabilitado(exportar)).toBe(false);
      // Na ordem da barra: Importar planilha, Exportar, Novo lead.
      const ordem = ["Importar planilha", "Exportar", "Novo lead"].map(
        (rotulo) => texto(html).indexOf(rotulo),
      );
      expect(ordem.every((posicao) => posicao >= 0)).toBe(true);
      expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    });

    it(`visão ${visao}: desabilitado com a dica para quem não exporta`, () => {
      const html = telaDeLeads(false, visao);
      const exportar = botaoCom(html, "Exportar");
      expect(exportar).toContain(`data-dica="${DICA_EXPORTAR_LEADS}"`);
      expect(desabilitado(exportar)).toBe(true);
    });
  }
});
