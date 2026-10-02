import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Bloquear horário" da Agenda (decisão do dono de 29/09/2026). Pela barra,
// o diálogo nasce com o dia da grade e as horas em branco. Pelo "Bloquear
// este horário" do modal do clique no vão, nasce também com o profissional
// da coluna e a hora clicada no início; o fim fica para a pessoa. O Dialog
// do Radix renderiza num portal, que não existe no servidor: aqui ele vira
// marcação simples.

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <div data-parte="dialog">{children}</div>
  ),
  DialogContent: ({ children }: ComponentProps<"div">) => (
    <div data-parte="conteudo">{children}</div>
  ),
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => (
    <div data-parte="rodape">{children}</div>
  ),
}));

vi.mock("@/app/(app)/cadastros/actions", () => ({
  criarBloqueiosEmLoteAction: vi.fn(),
}));

const { BloquearHorarioDialog } =
  await import("@/components/agenda/bloquear-horario-dialog");

const ANA = "0a0a0a0a-0000-4000-8000-00000000000a";
const JOAO = "0b0b0b0b-0000-4000-8000-00000000000b";
const PROFISSIONAIS = [
  { id: ANA, name: "Dra. Ana Costa" },
  { id: JOAO, name: "Dr. João Pereira" },
];

function render(
  props: Partial<ComponentProps<typeof BloquearHorarioDialog>> = {},
): string {
  return renderToStaticMarkup(
    <BloquearHorarioDialog
      onFechar={() => undefined}
      profissionais={PROFISSIONAIS}
      timezone="America/Fortaleza"
      diaSugerido="2026-10-01"
      atualizarAgenda={() => undefined}
      {...props}
    />,
  );
}

/** O <input> cujo aria-label é o dado, como string de marcação. */
function campo(html: string, rotulo: string): string {
  const achado = new RegExp(`<input[^>]*aria-label="${rotulo}"[^>]*>`).exec(
    html,
  );
  if (!achado) {
    throw new Error(`campo ${rotulo} não encontrado`);
  }
  return achado[0];
}

/** O checkbox (botão do Radix) logo antes do nome do profissional. */
function marcado(html: string, nome: string): boolean {
  const achado = new RegExp(
    `<button[^>]*role="checkbox"[^>]*aria-checked="(true|false)"[^>]*>(?:(?!</label>).)*${nome}`,
  ).exec(html);
  if (!achado) {
    throw new Error(`checkbox de ${nome} não encontrado`);
  }
  return achado[1] === "true";
}

describe("BloquearHorarioDialog", () => {
  it("pela barra: dia da grade, horas em branco", () => {
    const html = render({ profissionaisSugeridos: [ANA] });
    expect(campo(html, "Data de início")).toContain('value="2026-10-01"');
    expect(campo(html, "Data de fim")).toContain('value="2026-10-01"');
    expect(campo(html, "Hora de início")).toContain('value=""');
    expect(campo(html, "Hora de fim")).toContain('value=""');
  });

  it("pelo clique no vão: profissional da coluna e hora clicada no início", () => {
    const html = render({
      profissionaisSugeridos: [JOAO],
      diaSugerido: "2026-10-02",
      horaSugerida: "14:30",
    });
    expect(marcado(html, "Dr. João Pereira")).toBe(true);
    expect(marcado(html, "Dra. Ana Costa")).toBe(false);
    expect(campo(html, "Data de início")).toContain('value="2026-10-02"');
    expect(campo(html, "Hora de início")).toContain('value="14:30"');
    // O fim é decisão de quem bloqueia: nada de duração inventada.
    expect(campo(html, "Hora de fim")).toContain('value=""');
  });

  it("profissional sugerido que não está na lista (inativo) não vem marcado", () => {
    const html = render({
      profissionaisSugeridos: ["ffffffff-0000-4000-8000-00000000000f"],
      horaSugerida: "09:00",
    });
    expect(marcado(html, "Dr. João Pereira")).toBe(false);
    expect(marcado(html, "Dra. Ana Costa")).toBe(false);
  });
});
