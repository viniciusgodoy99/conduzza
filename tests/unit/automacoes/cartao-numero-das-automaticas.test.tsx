import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  NumerosDasAutomaticas,
  PoliticaDeEnvio,
} from "@/components/automacoes/numeros-de-envio";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// Cartao "Numero das mensagens automaticas" da Tela 7 (docs/07, Fase 4; POR
// TIPO desde 29/09/2026): so aparece com mais de um numero ativo, tem uma
// linha por tipo com o seletor ("Ultimo numero usado pelo paciente
// (recomendado)" ou o numero), avisa que desconectado espera (nunca troca
// sozinho), diz que a resposta sai pelo numero em que o paciente respondeu e,
// para quem nao edita, fica visivel e desabilitado.

vi.mock("@/app/(app)/automacoes/actions", () => ({
  definirNumeroDasAutomaticasAction: vi.fn(),
}));

const { NumeroDasAutomaticas } =
  await import("@/components/automacoes/numero-das-automaticas");

const PRINCIPAL = "0a0a0a0a-0000-4000-8000-00000000000a";
const RECEPCAO = "0b0b0b0b-0000-4000-8000-00000000000b";

function numero(campos: Partial<NumeroDaClinica> = {}): NumeroDaClinica {
  return {
    id: PRINCIPAL,
    nome: "Número principal",
    display_phone: "5584911110000",
    connection_status: "conectado",
    principal: true,
    connected_at: "2026-09-01T12:00:00Z",
    cor: "azul",
    ...campos,
  };
}

const DOIS: NumeroDaClinica[] = [
  numero(),
  numero({
    id: RECEPCAO,
    nome: "Recepção",
    principal: false,
    connection_status: "desconectado",
  }),
];

function render(
  dados: NumerosDasAutomaticas | null,
  podeEditar = true,
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <NumeroDasAutomaticas
        dados={dados}
        podeEditar={podeEditar}
        dicaSemPermissao="Somente administradores e gestores alteram as automações"
        aoTentarDeNovo={() => undefined}
      />
    </TooltipProvider>,
  );
}

const ULTIMO: PoliticaDeEnvio = {
  confirmacao: null,
  pos_falta: null,
  followup: null,
  lista_espera: null,
  aviso_remarcacao: null,
};

const ROTULOS = [
  "Confirmação de consulta e Cobrar agora",
  "Recuperação depois da falta",
  "Follow-up de leads",
  "Oferta da lista de espera",
  "Aviso de remarcação",
];

/** O trecho da linha de um tipo: do rotulo ate o fim do seletor dela. */
function linhaDoTipo(html: string, tipo: string): string {
  const inicio = html.indexOf(`for="numero-do-tipo-${tipo}"`);
  expect(inicio).toBeGreaterThan(-1);
  const fim = html.indexOf("</li>", inicio);
  return html.slice(inicio, fim);
}

describe("NumeroDasAutomaticas", () => {
  it("com um número só, não aparece", () => {
    expect(render({ numeros: [numero()], politica: ULTIMO })).toBe("");
  });

  it("com dois números, uma linha por tipo, na linguagem da recepção, e as duas notas", () => {
    const html = render({ numeros: DOIS, politica: ULTIMO });
    expect(html).toContain("Número das mensagens automáticas");
    let posicao = -1;
    for (const rotulo of ROTULOS) {
      const aqui = html.indexOf(rotulo);
      expect(aqui).toBeGreaterThan(posicao);
      posicao = aqui;
    }
    for (const tipo of [
      "confirmacao",
      "pos_falta",
      "followup",
      "lista_espera",
      "aviso_remarcacao",
    ]) {
      expect(html).toContain(`id="numero-do-tipo-${tipo}"`);
      // Sem escolha gravada, o seletor mostra o ultimo usado.
      expect(linhaDoTipo(html, tipo)).toContain(
        "Último número usado pelo paciente (recomendado)",
      );
    }
    expect(html).toContain(
      "Se o número escolhido estiver desconectado, as mensagens esperam a reconexão. Elas nunca saem por outro número sozinhas.",
    );
    expect(html).toContain(
      "A resposta a quem respondeu uma mensagem sai pelo número em que o paciente respondeu.",
    );
    expect(html).not.toContain("—");
    expect(html).not.toContain("não está conectado");
  });

  it("confirmação fixa no número e follow-up no último usado, cada linha com a sua escolha", () => {
    const html = render({
      numeros: DOIS,
      politica: { ...ULTIMO, confirmacao: PRINCIPAL },
    });
    expect(linhaDoTipo(html, "confirmacao")).toContain("Número principal");
    expect(linhaDoTipo(html, "confirmacao")).not.toContain(
      "Último número usado pelo paciente",
    );
    expect(linhaDoTipo(html, "followup")).toContain(
      "Último número usado pelo paciente (recomendado)",
    );
  });

  it("número fixo desconectado avisa uma vez que as mensagens dele esperam", () => {
    const html = render({
      numeros: DOIS,
      politica: {
        ...ULTIMO,
        confirmacao: RECEPCAO,
        aviso_remarcacao: RECEPCAO,
      },
    });
    const aviso = "O número &quot;Recepção&quot; não está conectado";
    expect(html).toContain(aviso);
    expect(html.split(aviso)).toHaveLength(2);
    expect(html).toContain("ficam esperando");
    // Status em 3 camadas no seletor: o rotulo em texto, alem de icone e cor.
    expect(linhaDoTipo(html, "confirmacao")).toContain("Desconectado");
  });

  it("quem não edita vê tudo desabilitado, com o botão visível", () => {
    const html = render({ numeros: DOIS, politica: ULTIMO }, false);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Salvar escolhas");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Salvar escolhas/);
  });

  it("quem edita vê o salvar desabilitado enquanto nada mudou", () => {
    const html = render({ numeros: DOIS, politica: ULTIMO });
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Salvar escolhas/);
    expect(html).not.toContain("Há escolhas ainda não salvas.");
  });

  it("leitura que falhou mostra o erro com o caminho de tentar de novo", () => {
    const html = render(null);
    expect(html).toContain(
      "Não foi possível carregar os números de WhatsApp da clínica.",
    );
    expect(html).toContain("Tentar de novo");
  });
});
