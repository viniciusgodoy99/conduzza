import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O dialogo de suspender e reativar a conta (onda 1): o botao de confirmar
// fica desabilitado enquanto o motivo nao tem de 3 a 300 caracteres (o check
// do banco), e a REGRA fica escrita no apoio do campo, ligada ao campo e ao
// botao (aria-describedby): ninguem fica diante de um botao desabilitado
// sem saber por que. O dialogo do Radix so abre com interacao; aqui as pecas
// dele viram blocos simples, para o conteudo sair na renderizacao estatica.

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
  suspenderClinicaAction: vi.fn(),
  reativarClinicaAction: vi.fn(),
}));

import { ContaDaClinica } from "@/components/painel-geral/conta-da-clinica";
import {
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { TooltipProvider } from "@/components/ui/tooltip";

const ID = "a1111111-1111-4111-8111-111111111111";

function dialogo(suspensa: boolean): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ContaDaClinica
        clinicId={ID}
        nome="Clínica Aurora"
        fuso="America/Fortaleza"
        suspensao={
          suspensa
            ? { suspensaEm: "2026-10-18T10:00:00.000Z", motivo: "Pagamento" }
            : null
        }
      />
    </TooltipProvider>,
  );
}

/** O id que um atributo aponta (aria-describedby do campo ou do botao). */
function idDoApoio(saida: string, inicioDaTag: string): string {
  const inicio = saida.indexOf(inicioDaTag);
  expect(inicio, inicioDaTag).toBeGreaterThan(-1);
  const tag = saida.slice(inicio, saida.indexOf(">", inicio));
  const achado = /aria-describedby="([^"]+)"/.exec(tag);
  expect(achado, `${inicioDaTag} sem aria-describedby`).not.toBeNull();
  return achado![1]!;
}

describe("diálogo da conta: o motivo obrigatório diz a regra", () => {
  it("a regra tem a faixa do banco (3 a 300) e o registro na trilha", () => {
    expect(TEXTOS_DO_PAINEL.regraDoMotivoDaConta).toContain(
      `De ${MOTIVO_MINIMO} a ${MOTIVO_MAXIMO} caracteres`,
    );
    expect(TEXTOS_DO_PAINEL.regraDoMotivoDaConta).toContain(
      TEXTOS_DO_PAINEL.motivoRegistrado,
    );
    expect(TEXTOS_DO_PAINEL.regraDoMotivoDaConta).not.toMatch(/[—–]/);
  });

  it.each([
    ["suspender", false, "Suspender conta"],
    ["reativar", true, "Reativar conta"],
  ])(
    "%s: o campo e o botão desabilitado apontam para a regra escrita",
    (_acao, suspensa, rotulo) => {
      const saida = dialogo(suspensa);
      const doCampo = idDoApoio(saida, "<textarea");
      // O apoio existe e diz a faixa.
      const apoio = new RegExp(`id="${doCampo}"[^>]*>([^<]*)<`).exec(saida);
      expect(apoio?.[1]).toBe(TEXTOS_DO_PAINEL.regraDoMotivoDaConta);

      // O botao de confirmar (o ultimo com o rotulo da acao) nasce
      // desabilitado, com o motivo vazio, e aponta para a mesma regra.
      const fim = saida.lastIndexOf(rotulo);
      const botao = saida.slice(saida.lastIndexOf("<button", fim), fim);
      expect(botao).toContain('disabled=""');
      expect(idDoApoio(botao, "<button")).toBe(doCampo);
    },
  );
});
