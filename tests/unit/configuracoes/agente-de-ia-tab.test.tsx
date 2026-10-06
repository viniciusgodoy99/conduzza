import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const avisos = vi.hoisted(() => ({
  sucesso: [] as string[],
  erro: [] as string[],
}));
vi.mock("sonner", () => ({
  toast: {
    success: (texto: string) => avisos.sucesso.push(texto),
    error: (texto: string) => avisos.erro.push(texto),
  },
}));

// A aba importa as Server Actions; aqui so a renderizacao importa.
vi.mock("@/app/(app)/configuracoes/ia-liberacao-actions", () => ({
  adicionarTelefoneDaIaAction: vi.fn(),
  alternarTelefoneDaIaAction: vi.fn(),
  definirEscolhaDaIaAction: vi.fn(),
  definirInterruptorGeralAction: vi.fn(),
  escolherNumeroDaIaAction: vi.fn(),
}));

import { TEXTOS_DA_IA } from "@/components/configuracoes/agente-de-ia";
import {
  AgenteDeIaTab,
  anunciar,
  telefonesNaOrdem,
} from "@/components/configuracoes/agente-de-ia-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";

// Aba "Agente de IA" de Configuracoes (Fase 3): o estado em 3 camadas com os
// motivos, o seletor do modo, o numero (so conectado, um por vez), os
// telefones da equipe, o interruptor geral (botao so para o super admin) e o
// teto; sem permissao (gestor), tudo visivel e desabilitado com a dica;
// vazios e erro de leitura; nenhum travessao em estado nenhum; o fim de cada
// acao no toast (sucesso e erro) e, no erro, na regiao sempre montada.

const NUMERO = "11111111-1111-4111-8111-111111111111";
const SEGUNDO = "22222222-2222-4222-8222-222222222222";

function dados(campos: Partial<DadosDaIa> = {}): DadosDaIa {
  return {
    liberacao: {
      liberada: true,
      modo: "contatos",
      pausadaPelaClinica: false,
      tetoDiarioCentavosUsd: 500,
    },
    numeros: [{ whatsappAccountId: NUMERO, ativo: true }],
    telefones: [
      {
        id: "t1",
        telefone: "+5584999990001",
        rotulo: "Vinicius, equipe",
        ativo: true,
      },
      { id: "t2", telefone: "+5584999990002", rotulo: "Ana", ativo: false },
    ],
    interruptorLigado: true,
    ...campos,
  };
}

function numero(campos: Partial<NumeroDoWhatsapp> = {}): NumeroDoWhatsapp {
  return {
    id: NUMERO,
    nome: "Número principal",
    principal: true,
    unitId: null,
    displayPhone: "5584999990000",
    status: "conectado",
    connectedAt: null,
    provider: "uazapi",
    cor: "azul",
    ...campos,
  };
}

function aba(
  props: Partial<React.ComponentProps<typeof AgenteDeIaTab>> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AgenteDeIaTab
        dados={dados()}
        numeros={[numero()]}
        ambienteLigado
        podeEditar
        superAdmin={false}
        {...props}
      />
    </TooltipProvider>,
  );
}

/** O HTML do texto, como o React escapa. */
function escapado(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A tag de abertura do botao com aquele texto (a primeira). */
function aberturaDoBotao(html: string, texto: string): string {
  const indice = html.indexOf(`${texto}</button>`);
  expect(indice, `botão "${texto}"`).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return html.slice(abertura, html.indexOf(">", abertura) + 1);
}

function botaoDesabilitado(html: string, texto: string): boolean {
  return /disabled=""/.test(aberturaDoBotao(html, texto));
}

/** O botao esta dentro do span com tabIndex da dica (DisabledWithHint)? */
function botaoComDica(html: string, texto: string): boolean {
  const indice = html.indexOf(`${texto}</button>`);
  const abertura = html.lastIndexOf("<button", indice);
  const antes = html.slice(Math.max(0, abertura - 200), abertura);
  return /<span[^>]*tabindex="0"[^>]*>$/.test(antes);
}

describe("estado do assistente", () => {
  it("tudo ligado: Conversando com a equipe, sem aviso de parada", () => {
    const html = aba();
    expect(html).toContain("Assistente de IA nesta clínica");
    expect(html).toContain("Conversando com a equipe");
    expect(html).not.toContain("Por que o assistente ainda não responde");
    // o seletor: a escolha gravada pressionada
    expect(aberturaDoBotao(html, "Conversar com a equipe")).toContain(
      'aria-pressed="true"',
    );
    expect(aberturaDoBotao(html, "Desligado")).toContain(
      'aria-pressed="false"',
    );
  });

  it("ligado mas parado: Ligado, mas parado e os motivos em texto", () => {
    const html = aba({
      ambienteLigado: false,
      dados: dados({ interruptorLigado: false }),
    });
    expect(html).toContain("Ligado, mas parado");
    expect(html).toContain("Por que o assistente ainda não responde");
    expect(html).toContain(escapado(TEXTOS_DA_IA.motivos.servidor));
    expect(html).toContain(
      "A equipe Conduzza ainda não ativou o assistente para esta clínica.",
    );
    expect(html).toContain(escapado(TEXTOS_DA_IA.motivos.interruptor));
  });

  it("desligado: chip Desligado; sem número nem telefone, a equipe fica presa e o porquê aparece", () => {
    const html = aba({
      dados: dados({ liberacao: null, numeros: [], telefones: [] }),
    });
    expect(html).toContain("Desligado");
    expect(botaoDesabilitado(html, "Conversar com a equipe")).toBe(true);
    expect(botaoDesabilitado(html, "Só simulador")).toBe(false);
    expect(html).toContain(escapado(TEXTOS_DA_IA.faltaParaAEquipe));
  });

  it("só simulador: chip informativo", () => {
    const html = aba({
      dados: dados({
        liberacao: {
          liberada: true,
          modo: "simulador",
          pausadaPelaClinica: false,
          tetoDiarioCentavosUsd: 500,
        },
      }),
    });
    expect(html).toContain("Só simulador");
    expect(aberturaDoBotao(html, "Só simulador")).toContain(
      'aria-pressed="true"',
    );
  });
});

describe("número do assistente", () => {
  it("o escolhido: Em uso e Parar de usar; o outro conectado: Usar este número", () => {
    const html = aba({
      numeros: [numero(), numero({ id: SEGUNDO, nome: "Unidade Centro" })],
    });
    expect(html).toContain("Em uso pelo assistente");
    expect(botaoDesabilitado(html, "Parar de usar")).toBe(false);
    expect(botaoDesabilitado(html, "Usar este número")).toBe(false);
    expect(html).toContain("(84) 99999-0000");
    expect(html).toContain("Conectado");
  });

  it("desconectado e não escolhido: preso com a dica de conectar antes", () => {
    const html = aba({
      dados: dados({ numeros: [] }),
      numeros: [numero({ status: "desconectado" })],
    });
    expect(botaoDesabilitado(html, "Usar este número")).toBe(true);
    expect(botaoComDica(html, "Usar este número")).toBe(true);
    expect(html).toContain("Desconectado");
  });

  it("escolhido e desconectado: o aviso e o motivo da parada", () => {
    const html = aba({ numeros: [numero({ status: "desconectado" })] });
    expect(html).toContain(escapado(TEXTOS_DA_IA.numeroDesconectado));
    expect(html).toContain(escapado(TEXTOS_DA_IA.motivos.numero_desconectado));
    expect(botaoDesabilitado(html, "Parar de usar")).toBe(false);
  });

  it("sem números: vazio com o caminho; leitura que falhou: erro, nunca vazio", () => {
    const vazio = aba({ numeros: [] });
    expect(vazio).toContain("Nenhum número de WhatsApp na clínica");
    expect(vazio).toContain('href="/configuracoes?aba=whatsapp"');
    const erro = aba({ numeros: null });
    expect(erro).toContain("Não foi possível carregar os números de WhatsApp");
    expect(erro).not.toContain("Nenhum número de WhatsApp na clínica");
  });
});

describe("telefones da equipe", () => {
  it("lista com rótulo, telefone formatado e situação; o aviso de que só eles conversam", () => {
    const html = aba();
    expect(html).toContain(escapado(TEXTOS_DA_IA.soEstesTelefones));
    expect(html).toContain("Vinicius, equipe");
    expect(html).toContain("(84) 99999-0001");
    expect(html).toContain("Conversa com o assistente");
    expect(html).toContain("Ligar de novo");
    expect(html).toContain("Desligar</button>");
    expect(html).toContain("De quem é");
    expect(html).toContain('placeholder="(84) 99999-0000"');
    expect(botaoDesabilitado(html, "Adicionar")).toBe(false);
  });

  it("ligados primeiro, depois pelo nome", () => {
    expect(
      telefonesNaOrdem([
        { id: "a", telefone: "+1", rotulo: "Zé", ativo: false },
        { id: "b", telefone: "+2", rotulo: "Bia", ativo: true },
        { id: "c", telefone: "+3", rotulo: "Ana", ativo: true },
      ]).map((t) => t.id),
    ).toEqual(["c", "b", "a"]);
  });

  it("sem telefone: vazio com a próxima ação", () => {
    const html = aba({ dados: dados({ telefones: [] }) });
    expect(html).toContain("Nenhum telefone da equipe ainda");
  });

  it("a confirmação de contato da clínica só aparece depois do aviso da ação", () => {
    const html = aba();
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.confirmarContato));
    expect(html).not.toContain('role="checkbox"');
  });
});

describe("permissão", () => {
  it("gestor: tudo visível e preso, com a dica do administrador", () => {
    const html = aba({ podeEditar: false });
    for (const texto of [
      "Desligado",
      "Só simulador",
      "Conversar com a equipe",
      "Parar de usar",
      "Adicionar",
      "Desligar",
      "Ligar de novo",
    ]) {
      expect(botaoDesabilitado(html, texto), texto).toBe(true);
    }
    expect(botaoComDica(html, "Adicionar")).toBe(true);
    expect(botaoComDica(html, "Parar de usar")).toBe(true);
    // os campos do telefone tambem presos
    const campos = html.match(/<input[^>]*>/g) ?? [];
    expect(campos).toHaveLength(2);
    for (const campo of campos) {
      expect(campo).toContain('disabled=""');
    }
  });

  it("interruptor geral: botão só para o super admin; os demais leem quem liga", () => {
    const admin = aba();
    expect(admin).toContain(escapado(TEXTOS_DA_IA.soEquipeConduzza));
    expect(admin).not.toContain("o interruptor geral</button>");
    const superAdmin = aba({ superAdmin: true });
    expect(superAdmin).toContain("Desligar o interruptor geral</button>");
    const desligado = aba({
      superAdmin: true,
      dados: dados({ interruptorLigado: false }),
    });
    expect(desligado).toContain("Ligar o interruptor geral</button>");
  });
});

describe("fim da ação", () => {
  beforeEach(() => {
    avisos.sucesso = [];
    avisos.erro = [];
  });

  it("sucesso: toast de sucesso, nada na região", () => {
    expect(anunciar({ ok: true }, "Telefone ligado.")).toBeNull();
    expect(avisos).toEqual({ sucesso: ["Telefone ligado."], erro: [] });
  });

  it("erro: toast de erro E o mesmo texto na região (simétrico ao sucesso)", () => {
    const texto = TEXTOS_DA_IA.semPermissao;
    expect(anunciar({ ok: false, error: texto }, "Telefone ligado.")).toEqual({
      tom: "alert",
      texto,
    });
    expect(avisos).toEqual({ sucesso: [], erro: [texto] });
  });

  it("pedido de confirmação também é anunciado como erro", () => {
    const texto =
      "Este telefone já é de um contato da clínica (Maria). Só confirme se for de alguém da equipe.";
    expect(
      anunciar(
        { ok: false, error: texto, pedeConfirmacao: true },
        "Telefone da equipe adicionado.",
      ),
    ).toEqual({ tom: "alert", texto });
    expect(avisos.erro).toEqual([texto]);
  });

  it("servidor que não responde: toast de erro e a região", () => {
    expect(anunciar(null, "Telefone ligado.")).toEqual({
      tom: "alert",
      texto: TEXTOS_DA_IA.semResposta,
    });
    expect(avisos).toEqual({ sucesso: [], erro: [TEXTOS_DA_IA.semResposta] });
  });
});

describe("teto e textos", () => {
  it("teto das últimas 24 horas; sem linha, quando nasce", () => {
    expect(aba()).toContain("US$ 5,00 a cada 24 horas");
    expect(aba()).toContain("até o gasto mais antigo completar 24 horas");
    expect(aba({ dados: dados({ liberacao: null }) })).toContain(
      escapado(TEXTOS_DA_IA.tetoSemLinha),
    );
  });

  it("nenhum travessão na aba, em nenhum estado", () => {
    const estados = [
      aba(),
      aba({ podeEditar: false }),
      aba({ superAdmin: true }),
      aba({
        ambienteLigado: false,
        dados: dados({ interruptorLigado: false }),
      }),
      aba({ dados: dados({ liberacao: null, numeros: [], telefones: [] }) }),
      aba({ numeros: [] }),
      aba({ numeros: null }),
      aba({ numeros: [numero({ status: "desconectado" })] }),
    ];
    for (const html of estados) {
      expect(html).not.toMatch(/[—–]/);
      expect(html).not.toMatch(/janela de 24 horas/i);
      expect(html).not.toMatch(/\bno servidor\b/i);
    }
  });
});
