import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DICA_SEM_AUTORIZACAO_PARA_INICIAR,
  DICA_SEM_PERMISSAO_PARA_INICIAR,
  MENSAGEM_SEM_NUMERO_PARA_INICIAR,
} from "@/lib/domain/iniciar-conversa";

// "Iniciar conversa" na tela (decisao do dono em 20/10/2026): o botao no
// lugar do "Abrir conversa" desabilitado da gaveta de Leads e da ficha do
// paciente, desabilitado com a dica sem permissao ou sem a autorizacao
// registrada, e o dialogo em todos os estados (carregando, erro, sem numero,
// um numero, varios, desconectado, enviando, erro com a conversa para
// abrir). O projeto nao tem jsdom: a tela e lida pelo HTML de
// renderToStaticMarkup.

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
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
vi.mock("@/components/atividades/secao-de-atividades", () => ({
  SecaoDeAtividades: () => null,
}));

const { BotaoIniciarConversa, ConteudoIniciarConversa } =
  await import("@/components/atendimento/iniciar-conversa");
const { AcoesPaciente } = await import("@/components/pacientes/acoes-paciente");
const { DrawerLead } = await import("@/components/leads/drawer-lead");
const { leadsKeys } = await import("@/lib/queries/leads");
type LeadResumo = import("@/lib/queries/leads").LeadResumo;
type LeadDetalhe = import("@/lib/queries/leads").LeadDetalhe;
type NumeroDaClinica = import("@/lib/queries/conversations").NumeroDaClinica;
type EstadoDosNumeros =
  import("@/components/atendimento/iniciar-conversa").EstadoDosNumeros;
type ErroDoInicio =
  import("@/components/atendimento/iniciar-conversa").ErroDoInicio;

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const CONTATO = {
  id: "10000000-0000-4000-8000-000000000001",
  nome: "Maria Lima",
  telefone: "+5585999990001",
};
const PRINCIPAL = "20000000-0000-4000-8000-000000000001";
const SEGUNDO = "20000000-0000-4000-8000-000000000002";
const CONVERSA = "30000000-0000-4000-8000-000000000001";

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function botaoCom(markup: string, rotulo: string): string {
  const botoes =
    markup.match(/(<span data-dica="[^"]*">)?<button[^>]*>.*?<\/button>/g) ??
    [];
  const achado = botoes.find((botao) => texto(botao).includes(rotulo));
  expect(achado, `botão "${rotulo}"`).toBeDefined();
  return achado ?? "";
}

function desabilitado(botao: string): boolean {
  return /<button[^>]*\sdisabled=""/.test(botao);
}

function dicaDe(botao: string): string | null {
  return /data-dica="([^"]*)"/.exec(botao)?.[1] ?? null;
}

function numero(
  id: string,
  campos: Partial<NumeroDaClinica> = {},
): NumeroDaClinica {
  return {
    id,
    nome: id === PRINCIPAL ? "Recepção" : "Unidade Centro",
    display_phone: id === PRINCIPAL ? "5585988887777" : "5585977776666",
    connection_status: "conectado",
    principal: id === PRINCIPAL,
    connected_at: "2026-10-01T12:00:00.000Z",
    cor: "lima" as NumeroDaClinica["cor"],
    ...campos,
  };
}

function conteudo(
  campos: {
    numeros?: EstadoDosNumeros;
    escolhido?: string | null;
    texto?: string;
    enviando?: boolean;
    erro?: ErroDoInicio | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <ConteudoIniciarConversa
      contato={CONTATO}
      numeros={
        campos.numeros ?? { estado: "pronto", numeros: [numero(PRINCIPAL)] }
      }
      escolhido={campos.escolhido ?? null}
      aoEscolher={() => undefined}
      aoTentarDeNovo={() => undefined}
      texto={campos.texto ?? "Olá! Podemos falar sobre o seu retorno?"}
      aoMudarTexto={() => undefined}
      enviando={campos.enviando ?? false}
      erro={campos.erro ?? null}
      aoEnviar={() => undefined}
      aoCancelar={() => undefined}
    />,
  );
}

describe("botão Iniciar conversa", () => {
  it("com permissão e autorização: habilitado, sem dica", () => {
    const html = renderToStaticMarkup(
      <BotaoIniciarConversa
        clinicId={CLINICA}
        contato={CONTATO}
        podeIniciar
        dicaSemPermissao=""
        autorizado
      />,
    );
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(false);
    expect(dicaDe(botao)).toBeNull();
    expect(html).toContain("lucide-message-square-plus");
  });

  it("sem autorização: visível, desabilitado, com a dica pedida pelo dono", () => {
    const html = renderToStaticMarkup(
      <BotaoIniciarConversa
        clinicId={CLINICA}
        contato={CONTATO}
        podeIniciar
        dicaSemPermissao=""
        autorizado={false}
      />,
    );
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(
      "Registre a autorização para receber mensagens na ficha para iniciar a conversa.",
    );
    expect(DICA_SEM_AUTORIZACAO_PARA_INICIAR).not.toMatch(/[\u2013\u2014]/);
  });

  it("sem permissão: a dica do papel vence a da autorização", () => {
    const html = renderToStaticMarkup(
      <BotaoIniciarConversa
        clinicId={CLINICA}
        contato={CONTATO}
        podeIniciar={false}
        dicaSemPermissao={DICA_SEM_PERMISSAO_PARA_INICIAR}
        autorizado={false}
      />,
    );
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_SEM_PERMISSAO_PARA_INICIAR);
  });
});

describe("diálogo Iniciar conversa", () => {
  it("diz para quem vai, que a conversa fica com quem envia, e não tem travessão", () => {
    const html = conteudo();
    const frase = texto(html);
    expect(frase).toContain("Iniciar conversa");
    expect(frase).toContain(
      "A primeira mensagem sai pelo WhatsApp da clínica, e a conversa fica com você no Atendimento.",
    );
    expect(frase).toContain("Para Maria Lima ((85) 99999-0001)");
    expect(frase).not.toMatch(/[\u2013\u2014]/);
    expect(html).toContain('maxLength="4096"');
  });

  it("um número só e conectado: sem seletor, Enviar habilitado", () => {
    const html = conteudo();
    expect(texto(html)).not.toContain("Sair pelo número");
    expect(html).not.toContain('type="radio"');
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(false);
  });

  it("sem texto, o Enviar fica desabilitado", () => {
    const html = conteudo({ texto: "   " });
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(true);
  });

  it("carregando os números: esqueleto com rótulo e Enviar desabilitado", () => {
    const html = conteudo({ numeros: { estado: "carregando" } });
    expect(html).toContain('role="status"');
    expect(texto(html)).toContain("Carregando os números da clínica");
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(true);
  });

  it("erro ao carregar os números: o motivo e Tentar de novo", () => {
    const html = conteudo({ numeros: { estado: "erro" } });
    expect(texto(html)).toContain(
      "Não foi possível carregar os números da clínica.",
    );
    expect(botaoCom(html, "Tentar de novo")).toBeTruthy();
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(true);
  });

  it("clínica sem número: o caminho para conectar e Enviar desabilitado", () => {
    const html = conteudo({ numeros: { estado: "pronto", numeros: [] } });
    expect(texto(html)).toContain(MENSAGEM_SEM_NUMERO_PARA_INICIAR);
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(true);
  });

  it("um número só e desconectado: avisa e não deixa enviar", () => {
    const html = conteudo({
      numeros: {
        estado: "pronto",
        numeros: [numero(PRINCIPAL, { connection_status: "desconectado" })],
      },
    });
    expect(texto(html)).toContain(
      "O WhatsApp da clínica não está conectado. Reconecte em Configurações para iniciar a conversa.",
    );
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(true);
  });

  it("vários números: o seletor, com o principal já marcado", () => {
    const html = conteudo({
      numeros: {
        estado: "pronto",
        numeros: [numero(PRINCIPAL), numero(SEGUNDO)],
      },
    });
    expect(texto(html)).toContain("Sair pelo número");
    expect(texto(html)).toContain("Recepção (principal)");
    expect(texto(html)).toContain("Unidade Centro");
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.find((radio) => radio.includes(PRINCIPAL))).toContain(
      'checked=""',
    );
    expect(radios.find((radio) => radio.includes(SEGUNDO))).not.toContain(
      'checked=""',
    );
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(false);
  });

  it("vários números: o escolhido na tela vence o padrão", () => {
    const html = conteudo({
      numeros: {
        estado: "pronto",
        numeros: [numero(PRINCIPAL), numero(SEGUNDO)],
      },
      escolhido: SEGUNDO,
    });
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios.find((radio) => radio.includes(SEGUNDO))).toContain(
      'checked=""',
    );
  });

  it("número desconectado: visível, desabilitado, com o caminho para reconectar", () => {
    const html = conteudo({
      numeros: {
        estado: "pronto",
        numeros: [
          numero(PRINCIPAL, { connection_status: "desconectado" }),
          numero(SEGUNDO),
        ],
      },
    });
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    const doPrincipal = radios.find((radio) => radio.includes(PRINCIPAL));
    expect(doPrincipal).toContain('disabled=""');
    // Principal desconectado: o primeiro conectado fica marcado.
    expect(radios.find((radio) => radio.includes(SEGUNDO))).toContain(
      'checked=""',
    );
    expect(texto(html)).toContain(
      "Reconecte em Configurações para enviar por este número.",
    );
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(false);
  });

  it("nenhum número conectado: avisa e não deixa enviar", () => {
    const html = conteudo({
      numeros: {
        estado: "pronto",
        numeros: [
          numero(PRINCIPAL, { connection_status: "desconectado" }),
          numero(SEGUNDO, { connection_status: "desconectado" }),
        ],
      },
    });
    expect(texto(html)).toContain(
      "Nenhum número está conectado agora. Reconecte em Configurações, aba WhatsApp, para iniciar a conversa.",
    );
    expect(desabilitado(botaoCom(html, "Enviar"))).toBe(true);
  });

  it("enviando: Enviando..., o texto e os botões travados", () => {
    const html = conteudo({ enviando: true });
    expect(desabilitado(botaoCom(html, "Enviando..."))).toBe(true);
    expect(desabilitado(botaoCom(html, "Cancelar"))).toBe(true);
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  it("erro do servidor: o motivo em alerta e, com conversa, o caminho até ela", () => {
    const html = conteudo({
      erro: {
        mensagem: 'O número "Recepção" da clínica não está conectado.',
        conversationId: CONVERSA,
      },
    });
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain(
      "O número &quot;Recepção&quot; da clínica não está conectado.",
    );
    expect(html).toContain(`href="/atendimento?conversa=${CONVERSA}"`);
    expect(texto(html)).toContain("Abrir a conversa");
  });

  it("erro sem conversa: só o motivo", () => {
    const html = conteudo({
      erro: {
        mensagem:
          "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de iniciar a conversa.",
      },
    });
    expect(html).not.toContain("/atendimento?conversa=");
  });
});

describe("ficha do paciente: Ações", () => {
  function acoes(
    campos: Partial<ComponentProps<typeof AcoesPaciente>> = {},
  ): string {
    return renderToStaticMarkup(
      <AcoesPaciente
        clinicId={CLINICA}
        contactId={CONTATO.id}
        nome={CONTATO.nome}
        telefone={CONTATO.telefone}
        conversationId={null}
        podeAgendar
        dicaAgendar="Seu perfil não pode alterar a agenda"
        podeEsperar
        dicaEsperar="Seu perfil não pode alterar a lista de espera"
        podeIniciarConversa
        dicaIniciarConversa=""
        autorizado
        {...campos}
      />,
    );
  }

  it("com conversa: Abrir conversa leva até ela, sem Iniciar conversa", () => {
    const html = acoes({ conversationId: CONVERSA });
    expect(html).toContain(`href="/atendimento?conversa=${CONVERSA}"`);
    expect(texto(html)).not.toContain("Iniciar conversa");
  });

  it("sem conversa: Iniciar conversa no lugar do Abrir conversa desabilitado", () => {
    const html = acoes();
    expect(texto(html)).not.toContain("Abrir conversa");
    expect(desabilitado(botaoCom(html, "Iniciar conversa"))).toBe(false);
  });

  it("sem autorização: desabilitado com a dica da autorização", () => {
    const html = acoes({ autorizado: false });
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_SEM_AUTORIZACAO_PARA_INICIAR);
  });

  it("profissional: desabilitado, dizendo que nada está atribuído e que o perfil não inicia", () => {
    const html = acoes({
      podeIniciarConversa: false,
      dicaIniciarConversa: DICA_SEM_PERMISSAO_PARA_INICIAR,
      soDaSuaAgenda: true,
    });
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(
      "Nenhuma conversa deste paciente atribuída a você. Seu perfil não pode iniciar conversas.",
    );
  });

  it("leitura: desabilitado com a dica do perfil", () => {
    const html = acoes({
      podeIniciarConversa: false,
      dicaIniciarConversa: DICA_SEM_PERMISSAO_PARA_INICIAR,
    });
    expect(dicaDe(botaoCom(html, "Iniciar conversa"))).toBe(
      DICA_SEM_PERMISSAO_PARA_INICIAR,
    );
  });
});

describe("gaveta de Leads: o rodapé", () => {
  const LEAD: LeadResumo = {
    id: CONTATO.id,
    name: CONTATO.nome,
    phone_e164: CONTATO.telefone,
    kind: "lead",
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
    first_contact_at: "2026-10-01T12:00:00.000Z",
    last_contact_at: null,
    insurance: null,
    consent_ativo: true,
    anuncio_meta: { estado: "lida", anuncio: null },
  };

  function detalhe(conversationId: string | null): LeadDetalhe {
    return {
      conversation_id: conversationId,
      mensagens: [],
      campanha_nome: null,
      anuncio_meta: { estado: "lida", anuncio: null },
      anuncio_whatsapp: { estado: "lida", detalhes: null },
      atividades: null,
    };
  }

  function gaveta(
    campos: {
      lead?: LeadResumo;
      conversa?: string | null | "carregando";
      podeIniciar?: boolean;
      soAtribuidas?: boolean;
    } = {},
  ): string {
    const oLead = campos.lead ?? LEAD;
    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    if (campos.conversa !== "carregando") {
      cliente.setQueryData(
        leadsKeys.detalhe(oLead.id),
        detalhe(campos.conversa ?? null),
      );
    }
    const podeIniciar = campos.podeIniciar ?? true;
    return renderToStaticMarkup(
      <QueryClientProvider client={cliente}>
        <DrawerLead
          clinicId={CLINICA}
          lead={oLead}
          jornada={[]}
          timezone="America/Fortaleza"
          membros={{}}
          podeEditar={podeIniciar}
          dica="Seu perfil não pode editar leads e pacientes"
          podeAgendar
          dicaAgendar="Seu perfil não pode alterar a agenda"
          podeIniciarConversa={podeIniciar}
          dicaIniciarConversa={
            podeIniciar ? "" : DICA_SEM_PERMISSAO_PARA_INICIAR
          }
          soAtribuidas={campos.soAtribuidas ?? false}
          onFechar={() => undefined}
        />
      </QueryClientProvider>,
    );
  }

  function rodape(html: string): string {
    return /<div data-parte="rodape">(.*)<\/div>/.exec(html)?.[1] ?? "";
  }

  it("com conversa aberta: Abrir conversa, sem Iniciar conversa", () => {
    const html = rodape(gaveta({ conversa: CONVERSA }));
    expect(html).toContain(`href="/atendimento?conversa=${CONVERSA}"`);
    expect(texto(html)).not.toContain("Iniciar conversa");
  });

  it("sem conversa aberta: Iniciar conversa habilitado", () => {
    const html = rodape(gaveta());
    expect(texto(html)).not.toContain("Abrir conversa");
    expect(desabilitado(botaoCom(html, "Iniciar conversa"))).toBe(false);
  });

  it("sem autorização: Iniciar conversa desabilitado com a dica", () => {
    const html = rodape(gaveta({ lead: { ...LEAD, consent_ativo: false } }));
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(DICA_SEM_AUTORIZACAO_PARA_INICIAR);
  });

  it("enquanto confere a conversa: o Abrir conversa desabilitado de sempre", () => {
    const html = rodape(gaveta({ conversa: "carregando" }));
    expect(texto(html)).not.toContain("Iniciar conversa");
    const botao = botaoCom(html, "Abrir conversa");
    expect(desabilitado(botao)).toBe(true);
  });

  it("profissional: Iniciar conversa desabilitado, dizendo as duas coisas", () => {
    const html = rodape(gaveta({ podeIniciar: false, soAtribuidas: true }));
    const botao = botaoCom(html, "Iniciar conversa");
    expect(desabilitado(botao)).toBe(true);
    expect(dicaDe(botao)).toBe(
      "Nenhuma conversa aberta deste contato atribuída a você. Seu perfil não pode iniciar conversas.",
    );
  });
});
