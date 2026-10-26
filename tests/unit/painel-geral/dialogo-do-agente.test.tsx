import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O dialogo de confirmacao do agente (acompanhamento de cliente,
// 26/10/2026): o mesmo no detalhe (ligar em teste, ligar a producao, voltar
// para teste) e na linha da lista ("Liberar agente", que vai para Teste, e
// "Retirar agente", que vai para Desligado). O que se prova: o titulo, o
// efeito e o botao de cada um; o motivo obrigatorio so na producao (o botao
// de confirmar nasce desabilitado sem ele, e aponta para a regra escrita);
// o teto de gasto em tudo o que deixa o agente gastando, menos no retirar;
// retirar da producao diz como voltar. O dialogo do Radix so abre com
// interacao: aqui as pecas dele viram blocos simples, para o conteudo sair
// na renderizacao estatica. A acao nao roda (nenhum clique). A entrada da
// acao leva o estado que a tela mostrava (revisao de 26/10/2026), e ela
// passa no mesmo Zod do servidor em cada caminho da lista e do detalhe.

vi.mock("@/components/ui/dialog", () => {
  const Bloco = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: Bloco,
    DialogContent: Bloco,
    DialogDescription: Bloco,
    DialogFooter: Bloco,
    DialogHeader: Bloco,
    DialogTitle: Bloco,
  };
});
vi.mock("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));
vi.mock("@/app/(app)/painel-geral/actions", () => ({
  definirAgenteDaClinicaAction: vi.fn(),
}));

import {
  DialogoDoAgente,
  efeitosDaConfirmacao,
  entradaDaMudanca,
  tetoNoDialogo,
  textosDaConfirmacao,
  type DialogoDoAgenteProps,
} from "@/components/painel-geral/dialogo-do-agente";
import {
  agenteDaClinicaSchema,
  estadoDaConfirmacao,
  TEXTOS_DO_PAINEL,
  type ConfirmacaoDoAgente,
} from "@/components/painel-geral/painel-geral";

function dialogo(campos: Partial<DialogoDoAgenteProps> = {}): string {
  return renderToStaticMarkup(
    <DialogoDoAgente
      nome="Clínica Aurora"
      confirmacao="liberar"
      publico={null}
      emProducao={false}
      tetoDiarioCentavos={500}
      motivo=""
      onMotivo={() => undefined}
      erro={null}
      pendente={false}
      onFechar={() => undefined}
      onConfirmar={() => undefined}
      {...campos}
    />,
  );
}

function escapado(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A tag de abertura do botao de confirmar (o ultimo do dialogo). */
function botaoDeConfirmar(saida: string, rotulo: string): string {
  const fim = saida.lastIndexOf(`${rotulo}</button>`);
  expect(fim, rotulo).toBeGreaterThan(-1);
  const inicio = saida.lastIndexOf("<button", fim);
  return saida.slice(inicio, saida.indexOf(">", inicio) + 1);
}

describe("liberar e retirar, na linha da lista", () => {
  it("liberar: o título, que começa em Teste, o efeito do teste, o detalhe dos números e o teto; motivo opcional", () => {
    const saida = dialogo();
    expect(saida).toContain(
      escapado("Liberar o agente de IA na Clínica Aurora?"),
    );
    expect(saida).toContain("Ele começa em Teste.");
    for (const efeito of TEXTOS_DO_PAINEL.efeitoDoTeste) {
      expect(saida).toContain(escapado(efeito));
    }
    expect(saida).toContain(
      escapado(TEXTOS_DO_PAINEL.efeitoDaLiberacaoNoDetalhe),
    );
    expect(saida).toContain(
      'O teto de gasto desta clínica é de <span class="cz-num">US$ 5,00</span> a cada 24 horas.',
    );
    expect(saida).toContain("Motivo (opcional)");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.motivoRegistrado));
    // Motivo opcional: confirma com o campo vazio.
    expect(botaoDeConfirmar(saida, "Liberar agente")).not.toContain(
      'disabled=""',
    );
    expect(saida).toContain('lucide-power"');
    expect(saida).not.toContain("lucide-power-off");
    expect(saida).toContain("Cancelar</button>");
  });

  it("retirar: o efeito (para de atender e as conversas voltam para a equipe), sem o teto; da produção, como voltar", () => {
    const emTeste = dialogo({ confirmacao: "retirar" });
    expect(emTeste).toContain(
      escapado("Retirar o agente de IA da Clínica Aurora?"),
    );
    for (const efeito of TEXTOS_DO_PAINEL.efeitoDaRetirada) {
      expect(emTeste).toContain(escapado(efeito));
    }
    expect(emTeste).not.toContain("O teto de gasto desta clínica");
    expect(emTeste).not.toContain(
      escapado(TEXTOS_DO_PAINEL.efeitoDaRetiradaDaProducao),
    );
    expect(emTeste).toContain("lucide-power-off");
    expect(botaoDeConfirmar(emTeste, "Retirar agente")).not.toContain(
      'disabled=""',
    );

    const daProducao = dialogo({ confirmacao: "retirar", emProducao: true });
    expect(daProducao).toContain(
      escapado(TEXTOS_DO_PAINEL.efeitoDaRetiradaDaProducao),
    );
  });

  it("salvando: os botões presos e o Salvando, para uma ação por vez", () => {
    const saida = dialogo({ pendente: true });
    expect(botaoDeConfirmar(saida, "Salvando...")).toContain('disabled=""');
    expect(botaoDeConfirmar(saida, "Salvando...")).toContain(
      'aria-busy="true"',
    );
    expect(botaoDeConfirmar(saida, "Cancelar")).toContain('disabled=""');
    expect(saida).toContain("<textarea");
    expect(saida.slice(saida.indexOf("<textarea"))).toContain('disabled=""');
  });

  it("o erro do banco aparece dentro do diálogo", () => {
    const saida = dialogo({ erro: TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente));
  });
});

describe("o mesmo diálogo no detalhe", () => {
  it("produção: o público, o motivo obrigatório e o botão desabilitado até o motivo ter 3 letras", () => {
    const sem = dialogo({ confirmacao: "producao", publico: "aos leads" });
    expect(sem).toContain(
      escapado("Ligar a produção do agente na Clínica Aurora?"),
    );
    expect(sem).toContain(
      escapado(TEXTOS_DO_PAINEL.efeitoDaProducao("aos leads")),
    );
    expect(sem).toContain("Motivo (obrigatório)");
    expect(sem).toContain(escapado(TEXTOS_DO_PAINEL.regraDoMotivoDaProducao));
    const botao = botaoDeConfirmar(sem, "Ligar a produção");
    expect(botao).toContain('disabled=""');
    // O botao desabilitado aponta para a regra escrita.
    const apoio = /aria-describedby="([^"]+)"/.exec(botao)?.[1];
    expect(apoio).toBeTruthy();
    expect(sem).toContain(`id="${apoio}"`);
    expect(sem).toContain("lucide-radio-tower");

    const com = dialogo({ confirmacao: "producao", motivo: "Tudo conferido" });
    expect(botaoDeConfirmar(com, "Ligar a produção")).not.toContain(
      'disabled=""',
    );
  });

  it("ligar em teste e voltar para Teste, com os textos de antes", () => {
    const teste = dialogo({ confirmacao: "teste" });
    expect(teste).toContain(
      escapado("Ligar o agente em teste na Clínica Aurora?"),
    );
    expect(botaoDeConfirmar(teste, "Ligar em teste")).not.toContain(
      'disabled=""',
    );
    const volta = dialogo({ confirmacao: "volta" });
    expect(volta).toContain(
      escapado("Voltar o agente da Clínica Aurora para Teste?"),
    );
    for (const efeito of TEXTOS_DO_PAINEL.efeitoDaVoltaParaTeste) {
      expect(volta).toContain(escapado(efeito));
    }
  });
});

describe("a entrada da ação: o estado que a tela mostrava vai junto", () => {
  const CLINICA = "a1111111-1111-4111-8111-111111111111";

  it("cada caminho da lista e do detalhe manda o estado visto e o pedido, e passa no Zod do servidor", () => {
    const caminhos: [ConfirmacaoDoAgente, "desligado" | "teste" | "producao"][] =
      [
        ["liberar", "desligado"],
        ["retirar", "teste"],
        ["retirar", "producao"],
        ["teste", "desligado"],
        ["volta", "producao"],
        ["producao", "teste"],
      ];
    for (const [confirmacao, visto] of caminhos) {
      const entrada = entradaDaMudanca({
        clinicId: CLINICA,
        novo: estadoDaConfirmacao(confirmacao),
        visto,
        motivo: "  Conferido com o dono  ",
      });
      expect(entrada).toEqual({
        clinicId: CLINICA,
        estadoVisto: visto,
        estado: estadoDaConfirmacao(confirmacao),
        motivo: "Conferido com o dono",
      });
      expect(
        agenteDaClinicaSchema.safeParse(entrada).success,
        `${confirmacao} a partir de ${visto}`,
      ).toBe(true);
    }
  });

  it("o motivo vazio fica de fora (o servidor usa o padrão do painel)", () => {
    expect(
      entradaDaMudanca({
        clinicId: CLINICA,
        novo: "desligado",
        visto: "teste",
        motivo: "   ",
      }),
    ).toEqual({ clinicId: CLINICA, estadoVisto: "teste", estado: "desligado" });
  });

  it("a tela velha recebe o texto de recarregar, sem travessão", () => {
    expect(TEXTOS_DO_PAINEL.agenteMudou).toContain("Recarregue a página");
    expect(TEXTOS_DO_PAINEL.agenteMudou).not.toMatch(/[—–]/);
    const saida = dialogo({ erro: TEXTOS_DO_PAINEL.agenteMudou });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteMudou));
  });
});

describe("regras do diálogo", () => {
  const TODAS: ConfirmacaoDoAgente[] = [
    "teste",
    "producao",
    "volta",
    "liberar",
    "retirar",
  ];

  it("o teto só onde o agente segue gastando, e só quando a clínica tem teto", () => {
    expect(tetoNoDialogo("liberar", 500)).toBe(500);
    expect(tetoNoDialogo("producao", 500)).toBe(500);
    expect(tetoNoDialogo("retirar", 500)).toBeNull();
    expect(tetoNoDialogo("teste", null)).toBeNull();
  });

  it("a produção sem o público publicado não inventa a quem responde", () => {
    const efeitos = efeitosDaConfirmacao({
      confirmacao: "producao",
      publico: null,
      emProducao: false,
    });
    expect(efeitos).toEqual([...TEXTOS_DO_PAINEL.efeitosDaProducao]);
  });

  it("nenhum travessão e nenhum jargão em título, apoio, botão ou efeito", () => {
    for (const confirmacao of TODAS) {
      const textos = textosDaConfirmacao(confirmacao, "Clínica Aurora");
      const efeitos = efeitosDaConfirmacao({
        confirmacao,
        publico: "aos leads e aos pacientes",
        emProducao: true,
      });
      for (const texto of [...Object.values(textos), ...efeitos]) {
        expect(texto, texto).not.toMatch(/[—–]/);
        expect(texto, texto).not.toMatch(
          /\b(tenant|opt-in|handoff|kill switch|RPC|super admin)\b/i,
        );
      }
      expect(dialogo({ confirmacao })).not.toMatch(/[—–]/);
    }
  });
});
