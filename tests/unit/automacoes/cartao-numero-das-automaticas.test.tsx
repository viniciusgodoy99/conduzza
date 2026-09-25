import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { NumerosDasAutomaticas } from "@/components/automacoes/numeros-de-envio";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// Cartao "Numero das mensagens automaticas" da Tela 7 (docs/07, Fase 4):
// so aparece com mais de um numero ativo, diz as duas opcoes com a
// explicacao do dono, avisa que desconectado espera (nunca troca sozinho) e,
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

const ULTIMO = { modo: "ultimo_usado" as const, contaFixaId: null };

describe("NumeroDasAutomaticas", () => {
  it("com um número só, não aparece", () => {
    expect(render({ numeros: [numero()], politica: ULTIMO })).toBe("");
  });

  it("com dois números, mostra as duas opções, a explicação e a nota", () => {
    const html = render({ numeros: DOIS, politica: ULTIMO });
    expect(html).toContain("Número das mensagens automáticas");
    expect(html).toContain("Último número usado pelo paciente (recomendado)");
    expect(html).toContain(
      "Confirmações, lembretes e avisos saem pelo número com que o paciente conversou por último. Quem nunca conversou recebe pelo número principal.",
    );
    expect(html).toContain("Sempre pelo mesmo número");
    expect(html).toContain(
      "Se o número escolhido estiver desconectado, as mensagens esperam a reconexão. Elas nunca saem por outro número sozinhas.",
    );
    // Sem o fixo marcado, o seletor de numero ainda nao aparece.
    expect(html).not.toContain("numero-fixo-das-automaticas");
    expect(html).not.toContain("—");
  });

  it("no modo fixo, o seletor aparece com o número escolhido", () => {
    const html = render({
      numeros: DOIS,
      politica: { modo: "fixo", contaFixaId: PRINCIPAL },
    });
    expect(html).toContain('id="numero-fixo-das-automaticas"');
    expect(html).toContain("Número principal");
  });

  it("número fixo desconectado avisa que as mensagens esperam", () => {
    const html = render({
      numeros: DOIS,
      politica: { modo: "fixo", contaFixaId: RECEPCAO },
    });
    expect(html).toContain("O número &quot;Recepção&quot; não está conectado");
    expect(html).toContain("ficam esperando");
  });

  it("quem não edita vê tudo desabilitado", () => {
    const html = render({ numeros: DOIS, politica: ULTIMO }, false);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Salvar escolha");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Salvar escolha/);
  });

  it("leitura que falhou mostra o erro com o caminho de tentar de novo", () => {
    const html = render(null);
    expect(html).toContain(
      "Não foi possível carregar os números de WhatsApp da clínica.",
    );
    expect(html).toContain("Tentar de novo");
  });
});
