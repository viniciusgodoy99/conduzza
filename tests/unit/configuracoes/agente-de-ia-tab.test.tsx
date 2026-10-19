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
  alternarNumeroDaIaAction: vi.fn(),
  alternarTelefoneDaIaAction: vi.fn(),
  definirEscolhaDaIaAction: vi.fn(),
  definirInterruptorGeralAction: vi.fn(),
}));

import { TEXTOS_DA_IA } from "@/components/configuracoes/agente-de-ia";
import {
  AgenteDeIaTab,
  anunciar,
  telefonesNaOrdem,
} from "@/components/configuracoes/agente-de-ia-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import { expedientePadrao } from "@/lib/domain/agente/config";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";

// Aba "Agente de IA" de Configuracoes (Fase 3): o estado em 3 camadas com os
// motivos, o seletor do modo, os numeros (varios ligados ao mesmo tempo
// desde 19/10/2026, cada um com o proprio estado e botao; ligar so numero
// conectado), os telefones da equipe, o interruptor geral (botao so para o
// super admin) e o teto; sem permissao (gestor), tudo visivel e desabilitado com a dica;
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
    numerosLigados: [NUMERO],
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
    situacao: {
      tetoAtingido: false,
      versaoPublicada: 1,
      telefonesInvalidos: [],
      telefonesSemAutorizacao: [],
      telefonesComConversaAberta: [],
      horarioPublicado: {
        modo: "24h",
        minutosSemResposta: 10,
        expediente: expedientePadrao(),
      },
      motorParado: false,
    },
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
        agoraMs={Date.parse("2026-10-13T15:00:00.000Z")}
        fuso="America/Fortaleza"
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

/**
 * So o cartao "Números do assistente" (o titulo ate o cartao dos
 * telefones): "Desligar" existe nos dois cartoes.
 */
function cartaoDosNumeros(html: string): string {
  const inicio = html.indexOf("Números do assistente");
  const fim = html.indexOf("Telefones da equipe", inicio);
  expect(inicio, "cartão dos números").toBeGreaterThan(-1);
  expect(fim, "cartão dos telefones depois").toBeGreaterThan(inicio);
  return html.slice(inicio, fim);
}

/** A linha (li) de um numero, pelo nome dele, no cartao dos numeros. */
function linhaDoNumero(html: string, nome: string): string {
  const cartao = cartaoDosNumeros(html);
  const indice = cartao.indexOf(`>${nome}<`);
  expect(indice, `linha do número ${nome}`).toBeGreaterThan(-1);
  const inicio = cartao.lastIndexOf("<li", indice);
  return cartao.slice(inicio, cartao.indexOf("</li>", indice) + 5);
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
      superAdmin: true,
      dados: dados({ liberacao: null, numerosLigados: [], telefones: [] }),
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

describe("números do assistente", () => {
  it("o ligado: Em uso e Desligar; o outro conectado: Desligado do assistente e Ligar", () => {
    const html = aba({
      superAdmin: true,
      numeros: [numero(), numero({ id: SEGUNDO, nome: "Unidade Centro" })],
    });
    const cartao = cartaoDosNumeros(html);
    expect(cartao).toContain("Números do assistente");
    expect(cartao).toContain(escapado(TEXTOS_DA_IA.descricaoDosNumeros));
    expect(cartao).not.toMatch(/um número por vez/i);
    const ligado = linhaDoNumero(html, "Número principal");
    expect(ligado).toContain("Em uso pelo assistente");
    expect(botaoDesabilitado(ligado, "Desligar")).toBe(false);
    const outro = linhaDoNumero(html, "Unidade Centro");
    expect(outro).toContain("Desligado do assistente");
    expect(outro).not.toContain("Em uso pelo assistente");
    expect(botaoDesabilitado(outro, "Ligar")).toBe(false);
    expect(cartao).toContain("(84) 99999-0000");
    expect(cartao).toContain("Conectado");
  });

  it("desconectado e não ligado: Ligar preso com a dica de conectar antes", () => {
    const html = aba({
      superAdmin: true,
      dados: dados({ numerosLigados: [] }),
      numeros: [numero({ status: "desconectado" })],
    });
    const cartao = cartaoDosNumeros(html);
    expect(botaoDesabilitado(cartao, "Ligar")).toBe(true);
    expect(botaoComDica(cartao, "Ligar")).toBe(true);
    expect(cartao).toContain("Desconectado");
    expect(cartao).toContain("Desligado do assistente");
  });

  it("o único ligado e desconectado: o aviso na linha e o motivo da parada com o nome", () => {
    const html = aba({ numeros: [numero({ status: "desconectado" })] });
    expect(html).toContain(escapado(TEXTOS_DA_IA.numeroDesconectado));
    expect(html).toContain(
      escapado(
        "O número Número principal está desconectado. Conecte o número na aba WhatsApp.",
      ),
    );
    expect(html).toContain("Ligado, mas parado");
    const linha = linhaDoNumero(html, "Número principal");
    expect(linha).toContain("Ligado ao assistente");
    expect(botaoDesabilitado(linha, "Desligar")).toBe(false);
  });

  it("sem números: vazio com o caminho; leitura que falhou: erro, nunca vazio", () => {
    const vazio = aba({ numeros: [] });
    expect(vazio).toContain("Nenhum número de WhatsApp na clínica");
    expect(vazio).toContain("Depois, ligue o número aqui.");
    expect(vazio).toContain('href="/configuracoes?aba=whatsapp"');
    const erro = aba({ numeros: null });
    expect(erro).toContain("Não foi possível carregar os números de WhatsApp");
    expect(erro).not.toContain("Nenhum número de WhatsApp na clínica");
  });

  it("leitura dos números que falhou: o cabeçalho não fica verde (T3)", () => {
    const html = aba({ numeros: null });
    expect(html).not.toContain("Conversando com a equipe");
    expect(html).toContain("Não deu para conferir agora");
    expect(html).toContain(escapado(TEXTOS_DA_IA.naoConferido.numero));
    // nao afirma que parou: sem a lista dos motivos
    expect(html).not.toContain("Ligado, mas parado");
    expect(html).not.toContain("Por que o assistente ainda não responde");
    // nem a linha do telefone diz que conversa (T4)
    expect(html).not.toContain("Conversa com o assistente");
  });

  it("leitura dos números que falhou com um motivo conhecido: Ligado, mas parado", () => {
    const html = aba({ numeros: null, ambienteLigado: false });
    expect(html).toContain("Ligado, mas parado");
    expect(html).toContain(escapado(TEXTOS_DA_IA.motivos.servidor));
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.naoConferido.numero));
  });
});

describe("telefones da equipe", () => {
  it("lista com rótulo, telefone formatado e situação; o aviso de que só eles conversam", () => {
    const html = aba({ superAdmin: true });
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
    const html = aba({ superAdmin: true });
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.confirmarContato));
    // a única caixa de marcar é a do aviso da OpenAI (LGPD, sempre)
    expect(html.match(/role="checkbox"/g) ?? []).toHaveLength(1);
  });
});

describe("permissão", () => {
  it("gestor: tudo visível e preso, com a dica do administrador", () => {
    const html = aba({
      podeEditar: false,
      numeros: [numero(), numero({ id: SEGUNDO, nome: "Unidade Centro" })],
    });
    for (const texto of [
      "Desligado",
      "Só simulador",
      "Conversar com a equipe",
      "Adicionar",
      "Desligar",
      "Ligar de novo",
    ]) {
      expect(botaoDesabilitado(html, texto), texto).toBe(true);
    }
    expect(botaoComDica(html, "Adicionar")).toBe(true);
    // os dois botoes de numero: desligar e ligar, presos com a dica
    const cartao = cartaoDosNumeros(html);
    for (const texto of ["Desligar", "Ligar"]) {
      expect(botaoDesabilitado(cartao, texto), texto).toBe(true);
      expect(botaoComDica(cartao, texto), texto).toBe(true);
    }
    // os campos do telefone tambem presos (fora a caixa escondida do
    // Checkbox, que so espelha o botao)
    const campos = (html.match(/<input[^>]*>/g) ?? []).filter(
      (campo) => !campo.includes('aria-hidden="true"'),
    );
    expect(campos).toHaveLength(2);
    for (const campo of campos) {
      expect(campo).toContain('disabled=""');
    }
    const caixas = html.match(/<button[^>]*role="checkbox"[^>]*>/g) ?? [];
    expect(caixas).toHaveLength(1);
    for (const caixa of caixas) {
      expect(caixa).toContain('disabled=""');
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
      aba({
        dados: dados({ liberacao: null, numerosLigados: [], telefones: [] }),
      }),
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

// E3 (13/10/2026): nesta fase, ligar o atendimento pelo WhatsApp (modo
// equipe e usar numero) e so da equipe Conduzza. O administrador ve esses
// controles desabilitados, com a dica; desligar continua com ele. Telefone
// da equipe (decisao do dono de 19/10/2026): adicionar e "Ligar de novo"
// habilitados para o administrador; "Usar mesmo assim" so para o super
// admin. A aba diz a verdade (motivos novos), a linha do telefone que nao
// aciona o assistente tem estado proprio, e o formulario pede sempre a
// confirmacao do aviso da OpenAI.
describe("ligar só pela equipe Conduzza (E3)", () => {
  const DOIS_NUMEROS = [
    numero(),
    numero({ id: SEGUNDO, nome: "Unidade Centro" }),
  ];

  it("administrador: modo equipe e número visíveis e presos, com a dica; desligar livre", () => {
    const html = aba({ numeros: DOIS_NUMEROS });
    // o modo equipe ja gravado continua pressionado; a troca para equipe so
    // e possivel saindo dele, e ai fica presa (ver o teste seguinte)
    expect(botaoDesabilitado(html, "Desligado")).toBe(false);
    expect(botaoDesabilitado(html, "Só simulador")).toBe(false);
    // numero: desligar livre; ligar outro, preso com a dica
    const ligado = linhaDoNumero(html, "Número principal");
    expect(botaoDesabilitado(ligado, "Desligar")).toBe(false);
    expect(botaoComDica(ligado, "Desligar")).toBe(false);
    const outro = linhaDoNumero(html, "Unidade Centro");
    expect(botaoDesabilitado(outro, "Ligar")).toBe(true);
    expect(botaoComDica(outro, "Ligar")).toBe(true);
    // telefone: desligar livre
    const telefones = html.slice(html.indexOf("Telefones da equipe"));
    expect(botaoDesabilitado(telefones, "Desligar")).toBe(false);
  });

  it("administrador: adicionar telefone e Ligar de novo habilitados (19/10/2026), com os campos e a confirmação da OpenAI livres", () => {
    const html = aba({ numeros: DOIS_NUMEROS });
    expect(botaoDesabilitado(html, "Adicionar")).toBe(false);
    expect(botaoComDica(html, "Adicionar")).toBe(false);
    expect(botaoDesabilitado(html, "Ligar de novo")).toBe(false);
    expect(botaoComDica(html, "Ligar de novo")).toBe(false);
    const campos = (html.match(/<input[^>]*>/g) ?? []).filter(
      (campo) => !campo.includes('aria-hidden="true"'),
    );
    expect(campos).toHaveLength(2);
    for (const campo of campos) {
      expect(campo).not.toContain('disabled=""');
    }
    const caixas = html.match(/<button[^>]*role="checkbox"[^>]*>/g) ?? [];
    expect(caixas).toHaveLength(1);
    expect(caixas[0]).not.toContain('disabled=""');
    expect(html).toContain(escapado(TEXTOS_DA_IA.confirmarAvisoDaOpenai));
    // o forcar nunca aparece de saida (e, para o administrador, nem depois
    // da recusa: a action so devolve pedeForcar ao super admin)
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.forcarContatoDePaciente));
  });

  it("administrador: telefone que não aciona o assistente continua com Ligar de novo preso, com a frase da linha", () => {
    const html = aba({
      dados: dados({
        situacao: { ...dados().situacao, telefonesInvalidos: ["t2"] },
      }),
    });
    expect(botaoDesabilitado(html, "Ligar de novo")).toBe(true);
    expect(botaoComDica(html, "Ligar de novo")).toBe(true);
    expect(html).toContain(escapado(TEXTOS_DA_IA.telefoneInvalidoNaLinha));
  });

  it("administrador com o assistente desligado: Conversar com a equipe preso, e a frase visível", () => {
    const html = aba({
      dados: dados({ liberacao: null }),
    });
    expect(botaoDesabilitado(html, "Conversar com a equipe")).toBe(true);
    expect(botaoDesabilitado(html, "Só simulador")).toBe(false);
    expect(html).toContain(escapado(TEXTOS_DA_IA.soEquipeConduzzaLiga));
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.faltaParaAEquipe));
  });

  it("super admin: liga tudo", () => {
    const html = aba({
      superAdmin: true,
      numeros: DOIS_NUMEROS,
      dados: dados({ liberacao: null }),
    });
    expect(botaoDesabilitado(html, "Conversar com a equipe")).toBe(false);
    expect(botaoDesabilitado(cartaoDosNumeros(html), "Ligar")).toBe(false);
    expect(botaoDesabilitado(html, "Adicionar")).toBe(false);
    expect(botaoDesabilitado(html, "Ligar de novo")).toBe(false);
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.soEquipeConduzzaLiga));
  });
});

describe("a aba diz a verdade (E3)", () => {
  it("o verde só sem nenhum motivo: sem versão publicada fica parado, com o texto", () => {
    const html = aba({
      dados: dados({
        situacao: {
          ...dados().situacao,
          versaoPublicada: null,
          horarioPublicado: null,
        },
      }),
    });
    expect(html).toContain("Ligado, mas parado");
    expect(html).not.toContain("Conversando com a equipe");
    expect(html).toContain(escapado(TEXTOS_DA_IA.motivos.sem_versao_publicada));
  });

  it("teto, motor e horário viram motivos em texto", () => {
    const html = aba({
      dados: dados({
        situacao: {
          ...dados().situacao,
          tetoAtingido: true,
          motorParado: true,
          horarioPublicado: {
            modo: "fallback",
            minutosSemResposta: 10,
            expediente: expedientePadrao(),
          },
        },
      }),
    });
    for (const motivo of [
      "teto_atingido",
      "motor_parado",
      "horario_nao_suportado",
    ] as const) {
      expect(html).toContain(escapado(TEXTOS_DA_IA.motivos[motivo]));
    }
  });

  it("telefone que não aciona o assistente: 3 camadas na linha e Ligar de novo preso", () => {
    const html = aba({
      superAdmin: true,
      dados: dados({
        situacao: { ...dados().situacao, telefonesInvalidos: ["t2"] },
      }),
    });
    expect(html).toContain("Não aciona o assistente");
    expect(html).toContain(escapado(TEXTOS_DA_IA.telefoneInvalidoNaLinha));
    // o chip da linha: icone (svg), rotulo e tom de aviso
    const indice = html.indexOf("Não aciona o assistente");
    const antes = html.slice(Math.max(0, indice - 1500), indice);
    expect(antes).toContain("<svg");
    expect(antes).toMatch(/warning/);
    // o telefone que nao aciona nunca e ligado de novo (o banco recusa)
    expect(botaoDesabilitado(html, "Ligar de novo")).toBe(true);
    expect(botaoComDica(html, "Ligar de novo")).toBe(true);
  });

  it("telefone cujo contato revogou a autorização: Não aciona o assistente, com a frase própria (conferência telas N1)", () => {
    const html = aba({
      dados: dados({
        situacao: { ...dados().situacao, telefonesSemAutorizacao: ["t1"] },
      }),
    });
    expect(html).toContain("Não aciona o assistente");
    expect(html).toContain(
      escapado(TEXTOS_DA_IA.telefoneSemAutorizacaoNaLinha),
    );
    expect(html).not.toContain(escapado(TEXTOS_DA_IA.telefoneInvalidoNaLinha));
    // a linha nunca diz que conversa com o assistente
    expect(html).not.toContain("Conversa com o assistente");
    expect(html).not.toContain("Conversando com a equipe");
  });

  it("telefone com conversa aberta com a equipe no número: o aviso na linha", () => {
    const html = aba({
      dados: dados({
        situacao: {
          ...dados().situacao,
          telefonesComConversaAberta: ["t1"],
        },
      }),
    });
    expect(html).toContain(escapado(TEXTOS_DA_IA.conversaAbertaNoNumero));
    // nao e motivo de parada
    expect(html).toContain("Conversando com a equipe");
    expect(aba()).not.toContain(escapado(TEXTOS_DA_IA.conversaAbertaNoNumero));
  });

  it("confirmação do aviso da OpenAI sempre presente; Usar mesmo assim só depois da recusa", () => {
    for (const html of [aba(), aba({ superAdmin: true })]) {
      expect(html).toContain(escapado(TEXTOS_DA_IA.confirmarAvisoDaOpenai));
      expect(html).not.toContain(
        escapado(TEXTOS_DA_IA.forcarContatoDePaciente),
      );
    }
  });

  it("nenhum travessão nos estados novos", () => {
    const estados = [
      aba({
        dados: dados({
          situacao: {
            ...dados().situacao,
            tetoAtingido: true,
            versaoPublicada: null,
            telefonesInvalidos: ["t1", "t2"],
            telefonesComConversaAberta: ["t1"],
            motorParado: true,
          },
        }),
      }),
      aba({ superAdmin: true, dados: dados({ liberacao: null }) }),
    ];
    for (const html of estados) {
      expect(html).not.toMatch(/[—–]/);
    }
  });
});

// Achado T4 da revisao do E3: com o assistente fora de uso (Desligado, So
// simulador ou Ligado, mas parado), a linha do telefone ligado diz so
// "Ligado" e a do numero ligado, "Ligado ao assistente". So no estado
// "Conversando com a equipe" eles dizem que o assistente conversa (e o
// numero, so se ELE esta conectado: com varios numeros, o verde pode vir de
// outro).
describe("telefone e número fora de uso (T4)", () => {
  const SIMULADOR = {
    liberada: true,
    modo: "simulador" as const,
    pausadaPelaClinica: false,
    tetoDiarioCentavosUsd: 500,
  };

  it("em uso: Conversa com o assistente e Em uso pelo assistente", () => {
    const html = aba();
    expect(html).toContain("Conversando com a equipe");
    expect(html).toContain("Conversa com o assistente");
    expect(html).toContain("Em uso pelo assistente");
    expect(html).not.toContain("Ligado ao assistente");
  });

  it("desligado, só simulador ou parado: Ligado e Ligado ao assistente", () => {
    const casos = {
      desligado: aba({
        dados: dados({
          liberacao: { ...SIMULADOR, liberada: false },
        }),
      }),
      simulador: aba({ dados: dados({ liberacao: SIMULADOR }) }),
      parado: aba({ ambienteLigado: false }),
    };
    for (const [caso, html] of Object.entries(casos)) {
      expect(html, caso).not.toContain("Conversando com a equipe");
      expect(html, caso).not.toContain("Conversa com o assistente");
      expect(html, caso).not.toContain("Em uso pelo assistente");
      expect(html, caso).toContain("Ligado ao assistente");
      // o telefone t1 (ligado) com o rotulo do contrato, perto do numero dele
      const linha = html.slice(
        html.indexOf("(84) 99999-0001"),
        html.indexOf("(84) 99999-0002"),
      );
      expect(linha, caso).toContain(">Ligado<");
    }
  });
});

// Decisao do dono de 19/10/2026 (migration 20261019110000): varios numeros
// ligados ao mesmo tempo. Cada linha do cartao "Números do assistente" tem o
// proprio estado em 3 camadas (icone, rotulo e cor) e o proprio botao;
// ligar e so da equipe Conduzza (o administrador ve preso, com a dica de
// hoje) e desligar e tambem do administrador, sem mexer nos outros. O verde
// exige pelo menos um ligado e conectado.
describe("vários números ligados (19/10/2026)", () => {
  const DOIS_NUMEROS = [
    numero(),
    numero({ id: SEGUNDO, nome: "Numero 2 teste pessoal", principal: false }),
  ];
  const DOIS_LIGADOS = dados({ numerosLigados: [NUMERO, SEGUNDO] });

  it("os dois ligados e conectados: os dois Em uso, cada um com Desligar livre", () => {
    const html = aba({ dados: DOIS_LIGADOS, numeros: DOIS_NUMEROS });
    expect(html).toContain("Conversando com a equipe");
    for (const nome of ["Número principal", "Numero 2 teste pessoal"]) {
      const linha = linhaDoNumero(html, nome);
      expect(linha, nome).toContain("Em uso pelo assistente");
      // 3 camadas: o chip (do inicio dele ao rotulo) com icone (svg),
      // rotulo e tom de sucesso
      const rotulo = linha.indexOf("Em uso pelo assistente");
      const chip = linha.slice(
        linha.lastIndexOf("<span data-size", rotulo),
        rotulo,
      );
      expect(chip, nome).toContain("<svg");
      expect(chip, nome).toMatch(/success/);
      expect(botaoDesabilitado(linha, "Desligar"), nome).toBe(false);
      expect(botaoComDica(linha, "Desligar"), nome).toBe(false);
    }
    expect(cartaoDosNumeros(html)).not.toContain("Ligar</button>");
  });

  it("um ligado conectado e o outro caído: o verde fica; só a linha do caído avisa e não diz Em uso", () => {
    const html = aba({
      dados: DOIS_LIGADOS,
      numeros: [
        DOIS_NUMEROS[0]!,
        { ...DOIS_NUMEROS[1]!, status: "desconectado" },
      ],
    });
    expect(html).toContain("Conversando com a equipe");
    expect(html).not.toContain("Por que o assistente ainda não responde");
    const conectado = linhaDoNumero(html, "Número principal");
    expect(conectado).toContain("Em uso pelo assistente");
    expect(conectado).not.toContain(escapado(TEXTOS_DA_IA.numeroDesconectado));
    const caido = linhaDoNumero(html, "Numero 2 teste pessoal");
    expect(caido).toContain("Ligado ao assistente");
    expect(caido).not.toContain("Em uso pelo assistente");
    expect(caido).toContain(escapado(TEXTOS_DA_IA.numeroDesconectado));
    expect(caido).toContain("Desconectado");
  });

  it("ligados, mas nenhum conectado: Ligado, mas parado, dizendo quais", () => {
    const html = aba({
      dados: DOIS_LIGADOS,
      numeros: DOIS_NUMEROS.map((n) => ({
        ...n,
        status: "desconectado" as const,
      })),
    });
    expect(html).toContain("Ligado, mas parado");
    expect(html).toContain(
      escapado(
        "O número Número principal está desconectado. Conecte o número na aba WhatsApp.",
      ),
    );
    expect(html).toContain(
      escapado(
        "O número Numero 2 teste pessoal está desconectado. Conecte o número na aba WhatsApp.",
      ),
    );
    expect(html).not.toContain("Em uso pelo assistente");
  });

  it("nenhum ligado: Ligado, mas parado, com Nenhum número ligado ao assistente; as duas linhas Desligado do assistente", () => {
    const html = aba({
      superAdmin: true,
      dados: dados({ numerosLigados: [] }),
      numeros: DOIS_NUMEROS,
    });
    expect(html).toContain("Ligado, mas parado");
    expect(html).toContain(escapado(TEXTOS_DA_IA.motivos.sem_numero));
    for (const nome of ["Número principal", "Numero 2 teste pessoal"]) {
      const linha = linhaDoNumero(html, nome);
      expect(linha, nome).toContain("Desligado do assistente");
      expect(botaoDesabilitado(linha, "Ligar"), nome).toBe(false);
    }
  });

  it("administrador: desliga qualquer um; ligar o outro fica preso com a dica de hoje", () => {
    const html = aba({
      dados: dados({ numerosLigados: [NUMERO] }),
      numeros: DOIS_NUMEROS,
    });
    const ligado = linhaDoNumero(html, "Número principal");
    expect(botaoDesabilitado(ligado, "Desligar")).toBe(false);
    const desligado = linhaDoNumero(html, "Numero 2 teste pessoal");
    expect(botaoDesabilitado(desligado, "Ligar")).toBe(true);
    expect(botaoComDica(desligado, "Ligar")).toBe(true);
    expect(TEXTOS_DA_IA.soEquipeConduzzaLiga).toBe(
      "Nesta fase, só a equipe Conduzza liga o atendimento pelo WhatsApp.",
    );
  });

  it("nenhum travessão com vários números", () => {
    const estados = [
      aba({ dados: DOIS_LIGADOS, numeros: DOIS_NUMEROS }),
      aba({
        dados: DOIS_LIGADOS,
        numeros: DOIS_NUMEROS.map((n) => ({
          ...n,
          status: "desconectado" as const,
        })),
      }),
      aba({
        superAdmin: true,
        dados: dados({ numerosLigados: [] }),
        numeros: DOIS_NUMEROS,
      }),
    ];
    for (const html of estados) {
      expect(html).not.toMatch(/[—–]/);
      expect(html).not.toMatch(/um número por vez/i);
    }
  });
});
