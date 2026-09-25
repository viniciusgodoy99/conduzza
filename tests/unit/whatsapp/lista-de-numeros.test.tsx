import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

// Tela de VARIOS numeros de WhatsApp (Configuracoes > WhatsApp; docs/07,
// Telas). Prova as regras puras (components/whatsapp/numeros.ts) e o que o
// cartao e a lista mostram, renderizados sem navegador:
//   - status em 3 camadas (icone, rotulo e cor) e as etiquetas "Principal" e
//     "Mensagens automáticas";
//   - o botao de conexao pela situacao (Conectar, Reconectar, Continuar,
//     Desconectar), com 40px e desabilitado com dica para quem nao gerencia;
//   - remover: so administrador (D8), nunca o principal com outros ativos, e
//     nunca o numero fixo da politica, com o MESMO texto que a acao recusa;
//   - o limite do plano: "N de M números do plano" e adicionar desabilitado
//     no limite, com a dica escrita;
//   - os textos exatos do dialogo de remover e da tela, sem travessao.

// A lista fala com o servidor pelas acoes e recarrega pela rota; nada disso
// roda numa renderizacao estatica.
vi.mock("@/lib/actions/whatsapp-connect", () => ({
  connectWhatsAppAction: vi.fn(),
  disconnectWhatsAppAction: vi.fn(),
  pollWhatsAppStatusAction: vi.fn(),
  adicionarNumeroAction: vi.fn(),
  atualizarNumeroAction: vi.fn(),
  definirNumeroPrincipalAction: vi.fn(),
  removerNumeroAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const {
  acaoDeConexao,
  DICA_NUMERO_DAS_AUTOMATICAS,
  DICA_PRINCIPAL_COM_OUTROS,
  DICA_SO_ADMIN,
  dicaDoLimite,
  limiteAtingido,
  motivoParaNaoRemover,
  nomeDaUnidade,
  situacaoDaConexao,
  telefoneFormatado,
  textoDaRemocao,
  textoDoLimite,
  unidadesParaEscolher,
} = await import("@/components/whatsapp/numeros");
const { CartaoDoNumero } =
  await import("@/components/whatsapp/cartao-do-numero");
const { ListaDeNumeros } =
  await import("@/components/whatsapp/lista-de-numeros");
const { ConnectClient } = await import("@/components/whatsapp/connect-client");

// Pelo codigo, para o caractere nao aparecer escrito no fonte.
const TRAVESSAO = String.fromCharCode(0x2014);

type Numero = import("@/components/whatsapp/numeros").NumeroDoWhatsapp;

const PRINCIPAL = "11111111-1111-4111-8111-111111111111";
const RECEPCAO = "22222222-2222-4222-8222-222222222222";
const UNIDADE = "33333333-3333-4333-8333-333333333333";

function numero(campos: Partial<Numero> = {}): Numero {
  return {
    id: PRINCIPAL,
    nome: "Número principal",
    principal: true,
    unitId: null,
    displayPhone: "5584900000001",
    status: "conectado",
    connectedAt: "2026-09-02T14:01:00.000Z",
    provider: "uazapi",
    ...campos,
  };
}

const semAcao = () => undefined;

function cartao(
  campos: Partial<Numero> = {},
  extra: Partial<Parameters<typeof CartaoDoNumero>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CartaoDoNumero
        numero={numero(campos)}
        unidade={null}
        fixoDasAutomaticas={false}
        timezone="America/Fortaleza"
        podeGerenciar
        dica="Seu perfil não altera as configurações"
        motivoParaNaoRemover={null}
        motivoParaNaoEscolherUnidade={null}
        ocupado={false}
        aoConectar={semAcao}
        aoDesconectar={semAcao}
        aoRenomear={semAcao}
        aoEscolherUnidade={semAcao}
        aoTornarPrincipal={semAcao}
        aoRemover={semAcao}
        {...extra}
      />
    </TooltipProvider>,
  );
}

function lista(
  props: Partial<Parameters<typeof ListaDeNumeros>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ListaDeNumeros
        numeros={[numero()]}
        unidades={[]}
        contaFixaId={null}
        limite={null}
        podeGerenciar
        ehAdmin
        dica="Seu perfil não altera as configurações"
        providerDoAmbiente="uazapi"
        timezone="America/Fortaleza"
        {...props}
      />
    </TooltipProvider>,
  );
}

/** Texto visivel, sem as tags. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function botoes(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(
    ([inteiro, corpo]) =>
      `${inteiro.slice(0, inteiro.indexOf(">") + 1)}${texto(corpo ?? "")}`,
  );
}

describe("regras da tela de números", () => {
  it("situação desconhecida no banco vira desconectado", () => {
    expect(situacaoDaConexao("conectado")).toBe("conectado");
    expect(situacaoDaConexao("aguardando_qr")).toBe("aguardando_qr");
    expect(situacaoDaConexao("qualquer")).toBe("desconectado");
    expect(situacaoDaConexao(null)).toBe("desconectado");
  });

  it("telefone formatado só quando o texto é telefone", () => {
    expect(telefoneFormatado("5584900000001")).toBe("(84) 90000-0001");
    expect(telefoneFormatado("+55 84 90000-0001")).toBe("(84) 90000-0001");
    // Conta antiga que guardou o nome do perfil no lugar do numero.
    expect(telefoneFormatado("Clínica Sorriso Centro")).toBeNull();
    expect(telefoneFormatado(null)).toBeNull();
  });

  it("o botão de conexão segue a situação do número", () => {
    expect(acaoDeConexao({ status: "conectado", connectedAt: "x" })).toBe(
      "desconectar",
    );
    expect(acaoDeConexao({ status: "aguardando_qr", connectedAt: null })).toBe(
      "continuar",
    );
    expect(acaoDeConexao({ status: "conectando", connectedAt: null })).toBe(
      "continuar",
    );
    expect(acaoDeConexao({ status: "desconectado", connectedAt: null })).toBe(
      "conectar",
    );
    expect(acaoDeConexao({ status: "desconectado", connectedAt: "x" })).toBe(
      "reconectar",
    );
  });

  it("remover: só administrador, nunca o principal com outros, nunca o fixo das automáticas", () => {
    const principal = { id: PRINCIPAL, principal: true };
    const recepcao = { id: RECEPCAO, principal: false };

    expect(
      motivoParaNaoRemover(recepcao, {
        ehAdmin: false,
        totalAtivos: 2,
        contaFixaId: null,
      }),
    ).toBe(DICA_SO_ADMIN);
    expect(
      motivoParaNaoRemover(principal, {
        ehAdmin: true,
        totalAtivos: 2,
        contaFixaId: null,
      }),
    ).toBe(DICA_PRINCIPAL_COM_OUTROS);
    // O principal sozinho pode sair (a clinica fica sem numero).
    expect(
      motivoParaNaoRemover(principal, {
        ehAdmin: true,
        totalAtivos: 1,
        contaFixaId: null,
      }),
    ).toBeNull();
    expect(
      motivoParaNaoRemover(recepcao, {
        ehAdmin: true,
        totalAtivos: 2,
        contaFixaId: RECEPCAO,
      }),
    ).toBe(DICA_NUMERO_DAS_AUTOMATICAS);
    expect(
      motivoParaNaoRemover(recepcao, {
        ehAdmin: true,
        totalAtivos: 2,
        contaFixaId: PRINCIPAL,
      }),
    ).toBeNull();
  });

  it("a dica da tela é o mesmo texto com que a ação recusa no servidor", () => {
    const acao = readFileSync(
      join(process.cwd(), "lib/actions/whatsapp-connect.ts"),
      "utf-8",
    );
    for (const dica of [
      DICA_SO_ADMIN,
      DICA_PRINCIPAL_COM_OUTROS,
      DICA_NUMERO_DAS_AUTOMATICAS,
    ]) {
      expect(acao.replace(/\s*\n\s*/g, " ")).toContain(dica);
    }
  });

  it("limite do plano: nulo é sem limite; o texto e a dica", () => {
    expect(limiteAtingido(5, null)).toBe(false);
    expect(limiteAtingido(2, 3)).toBe(false);
    expect(limiteAtingido(3, 3)).toBe(true);
    expect(textoDoLimite(2, 3)).toBe("2 de 3 números do plano");
    expect(textoDoLimite(1, 1)).toBe("1 de 1 número do plano");
    expect(dicaDoLimite(3)).toBe(
      "O plano desta clínica permite até 3 números. Fale com o suporte para ampliar.",
    );
  });

  it("texto do diálogo de remover, com e sem telefone", () => {
    expect(textoDaRemocao({ displayPhone: "5584900000001" })).toBe(
      "O WhatsApp (84) 90000-0001 deixa de receber e enviar mensagens pelo Conduzza. As conversas abertas dele são encerradas e o histórico continua.",
    );
    expect(textoDaRemocao({ displayPhone: null })).toBe(
      "Este número deixa de receber e enviar mensagens pelo Conduzza. As conversas abertas dele são encerradas e o histórico continua.",
    );
  });

  it("unidade: o nome pela lista e o seletor com as ativas mais a atual", () => {
    const unidades = [
      { id: UNIDADE, nome: "Unidade Centro", ativa: false },
      { id: "u2", nome: "Unidade Sul", ativa: true },
    ];
    expect(nomeDaUnidade(UNIDADE, unidades)).toBe("Unidade Centro");
    expect(nomeDaUnidade(null, unidades)).toBeNull();
    expect(nomeDaUnidade(UNIDADE, null)).toBeNull();
    expect(unidadesParaEscolher(unidades, null).map((u) => u.id)).toEqual([
      "u2",
    ]);
    expect(unidadesParaEscolher(unidades, UNIDADE).map((u) => u.id)).toEqual([
      UNIDADE,
      "u2",
    ]);
  });
});

describe("cartão do número", () => {
  it("conectado: nome, telefone em cz-num, desde no fuso da clínica, status em 3 camadas e Principal", () => {
    const html = cartao({}, { unidade: "Unidade Centro" });
    const visivel = texto(html);

    expect(html).toContain('aria-labelledby="numero-' + PRINCIPAL + '-nome"');
    expect(visivel).toContain("Número principal");
    expect(visivel).toContain("Unidade Centro");
    expect(html).toMatch(/class="cz-num">\(84\) 90000-0001</);
    expect(visivel).toContain("desde 02/09/2026");
    // Status: rotulo em texto, icone (svg) e cor (estilo do tom).
    expect(html).toMatch(
      /<span[^>]*style="color:var\(--success-text\)[^"]*"[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<span>Conectado<\/span>/,
    );
    expect(visivel).toContain("Principal");
    expect(visivel).not.toContain("Mensagens automáticas");
    expect(botoes(html)).toContainEqual(
      expect.stringMatching(/Desconectar Número principal$/),
    );
  });

  it("número fixo das automáticas ganha a etiqueta; o que não é principal não tem Principal", () => {
    const html = cartao(
      { id: RECEPCAO, nome: "Recepção", principal: false },
      { fixoDasAutomaticas: true },
    );
    const visivel = texto(html);
    expect(visivel).toContain("Mensagens automáticas");
    expect(visivel).not.toMatch(/\bPrincipal\b/);
  });

  it("nunca pareado: Conectar e o aviso de que não há celular", () => {
    const html = cartao({
      displayPhone: null,
      status: "desconectado",
      connectedAt: null,
    });
    expect(texto(html)).toContain("Nenhum celular pareado");
    expect(texto(html)).toContain("Desconectado");
    expect(botoes(html)).toContainEqual(
      expect.stringMatching(/Conectar Número principal$/),
    );
  });

  it("já conectou antes: Reconectar; pareamento em andamento: Continuar conexão", () => {
    expect(
      botoes(cartao({ status: "desconectado" })).some((b) =>
        b.endsWith("Reconectar Número principal"),
      ),
    ).toBe(true);
    expect(
      botoes(cartao({ status: "aguardando_qr" })).some((b) =>
        b.endsWith("Continuar conexão Número principal"),
      ),
    ).toBe(true);
  });

  it("nome de perfil no lugar do telefone não aparece como telefone", () => {
    const html = cartao({ displayPhone: "Clínica Sorriso" });
    expect(texto(html)).toContain("Telefone ainda não identificado");
    expect(texto(html)).not.toContain("Clínica Sorriso");
  });

  it("quem não gerencia vê o botão desabilitado, com dica, e o menu continua acessível", () => {
    const html = cartao({}, { podeGerenciar: false });
    const conexao = botoes(html).find((b) => b.includes("Desconectar"));
    expect(conexao).toBeDefined();
    expect(conexao).toContain('disabled=""');
    // A dica do Tooltip mora no span focavel em volta do botao.
    expect(html).toMatch(/<span[^>]*tabindex="0"[^>]*cursor-not-allowed/);
    expect(html).toContain(
      'aria-label="Mais ações do número Número principal"',
    );
  });

  it("toda ação do cartão tem 40px (h-10 ou size-10)", () => {
    for (const botao of botoes(cartao())) {
      expect(botao).toMatch(/\b(h-10|size-10)\b/);
    }
  });
});

describe("lista de números", () => {
  it("um cartão por número, dentro da lista nomeada, e o cartão de adicionar no fim", () => {
    const html = lista({
      numeros: [
        numero(),
        numero({
          id: RECEPCAO,
          nome: "Recepção",
          principal: false,
          status: "desconectado",
          connectedAt: null,
          displayPhone: null,
        }),
      ],
    });
    expect(html).toContain('aria-label="Números de WhatsApp da clínica"');
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(texto(html)).toContain("Adicionar número");
    // Sem limite do plano, nada de "de M números".
    expect(texto(html)).not.toContain("do plano");
  });

  it("com limite: mostra N de M e, no limite, desabilita adicionar com a dica escrita", () => {
    const abaixo = lista({ limite: 3 });
    expect(texto(abaixo)).toContain("1 de 3 números do plano");
    const adicionarAbaixo = botoes(abaixo).find((b) =>
      b.endsWith("Adicionar número"),
    );
    expect(adicionarAbaixo).not.toContain('disabled=""');

    const noLimite = lista({ limite: 1 });
    expect(texto(noLimite)).toContain("1 de 1 número do plano");
    expect(texto(noLimite)).toContain(
      "O plano desta clínica permite até 1 número. Fale com o suporte para ampliar.",
    );
    const adicionarNoLimite = botoes(noLimite).find((b) =>
      b.endsWith("Adicionar número"),
    );
    expect(adicionarNoLimite).toContain('disabled=""');
  });

  it("sem número nenhum: vazio com Adicionar número como ação principal", () => {
    const html = lista({ numeros: [] });
    expect(texto(html)).toContain("Nenhum número de WhatsApp ainda");
    expect(html).not.toContain("<article");
    const adicionar = botoes(html).find((b) => b.endsWith("Adicionar número"));
    expect(adicionar).toContain("bg-primary");
  });

  it("gestor adiciona; quem não gerencia vê adicionar desabilitado", () => {
    const semPermissao = lista({ podeGerenciar: false, ehAdmin: false });
    const adicionar = botoes(semPermissao).find((b) =>
      b.endsWith("Adicionar número"),
    );
    expect(adicionar).toContain('disabled=""');
  });

  it("número fake avisa que é demonstração; canal sem provedor avisa o suporte", () => {
    expect(texto(lista({ numeros: [numero({ provider: "fake" })] }))).toContain(
      "Ambiente de demonstração",
    );
    expect(texto(lista({ providerDoAmbiente: null }))).toContain(
      "O canal de WhatsApp não está configurado no servidor",
    );
  });

  it("nenhum travessão no que a tela escreve", () => {
    const html = lista({
      limite: 1,
      numeros: [numero({ displayPhone: null, status: "desconectado" })],
    });
    expect(html).not.toContain(TRAVESSAO);
    expect(textoDaRemocao({ displayPhone: null })).not.toContain(TRAVESSAO);
    expect(dicaDoLimite(2)).not.toContain(TRAVESSAO);
  });
});

describe("painel de conexão dentro do diálogo", () => {
  function painel(
    moldura: "cartao" | "dialogo",
    status: "conectado" | "desconectado",
  ): string {
    return renderToStaticMarkup(
      <ConnectClient
        accountId={PRINCIPAL}
        nome="Recepção"
        initial={{
          status,
          qrCode: null,
          displayPhone: "5584900000001",
        }}
        connectedAt="2026-09-02T14:01:00.000Z"
        canManage
        providerName="uazapi"
        timezone="America/Fortaleza"
        moldura={moldura}
      />,
    );
  }

  it("sem moldura: sem o título do cartão, com a situação atual e o botão de conectar", () => {
    const html = painel("dialogo", "desconectado");
    expect(texto(html)).not.toContain("Conectar o número da clínica");
    expect(texto(html)).toContain("Situação atual: Desconectado");
    expect(botoes(html)).toContainEqual(
      expect.stringMatching(/Conectar WhatsApp$/),
    );
  });

  it("conectado no diálogo: diz o número e não repete o Desconectar do cartão", () => {
    const html = painel("dialogo", "conectado");
    expect(texto(html)).toContain("Situação atual: Conectado");
    expect(texto(html)).toContain("Número (84) 90000-0001 · desde 02/09/2026");
    expect(texto(html)).not.toContain("WhatsApp conectado");
    expect(botoes(html).some((b) => b.endsWith("Desconectar"))).toBe(false);
  });

  it("o onboarding continua com o cartão do principal", () => {
    const conectado = painel("cartao", "conectado");
    expect(texto(conectado)).toContain("WhatsApp conectado");
    expect(botoes(conectado).some((b) => b.endsWith("Desconectar"))).toBe(true);
    expect(texto(painel("cartao", "desconectado"))).toContain(
      "Conectar o número da clínica",
    );
  });
});
