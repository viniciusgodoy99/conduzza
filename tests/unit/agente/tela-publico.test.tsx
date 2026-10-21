import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DICA_RECEPCAO } from "./tela-fixtures";

// "Quem o assistente atende" (onda 2, item 4; decisao P4a do dono: mora na
// configuracao do agente e vale ao publicar), na aba Regras e limites da
// Tela 6: as tres opcoes do contrato em cartoes de radio, "Ainda não
// escolhido" enquanto a coluna e nula (com o texto do contrato), o Salvar
// que so habilita com outra escolha, travado com a dica para a recepcao, e
// nenhum travessao. O cartao entra no topo da aba, montado pelo painel.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarPublico: vi.fn(),
    salvarItemDaBase: vi.fn(),
    ativarItemDaBase: vi.fn(),
    excluirItemDaBase: vi.fn(),
    salvarInstrucoes: vi.fn(),
    publicar: vi.fn(),
    restaurarVersao: vi.fn(),
    simular: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { CartaoDoPublico, DESCRICAO_DO_PUBLICO } =
  await import("@/components/agente/cartao-do-publico");
const { PainelDoAgente } = await import("@/components/agente/painel-do-agente");
const { TEXTOS_DO_AGENTE } = await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

type Props = Parameters<typeof CartaoDoPublico>[0];

function cartao(campos: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CartaoDoPublico
        publico={null}
        podeEditar
        dica={null}
        pendente={false}
        salvando={false}
        aoSalvar={() => undefined}
        {...campos}
      />
    </TooltipProvider>,
  );
}

/** Os radios do grupo (o nativo, sr-only), na ordem. */
function radios(html: string): string[] {
  return html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
}

/** A tag de abertura do botao com aquele texto. */
function aberturaDoBotao(html: string, texto: string): string {
  const indice = html.indexOf(`${texto}</button>`);
  expect(indice, `botão "${texto}"`).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return html.slice(abertura, html.indexOf(">", abertura) + 1);
}

describe("Quem o assistente atende", () => {
  it("as três opções do contrato, com o que cada uma quer dizer", () => {
    const html = cartao();
    expect(html).toContain("Quem o assistente atende");
    for (const rotulo of ["Só leads", "Só pacientes", "Leads e pacientes"]) {
      expect(html).toContain(rotulo);
    }
    for (const descricao of Object.values(DESCRICAO_DO_PUBLICO)) {
      expect(html).toContain(descricao);
    }
    expect(radios(html)).toHaveLength(3);
  });

  it("ainda não escolhido: o aviso com o texto do contrato, nada marcado e o Salvar preso", () => {
    const html = cartao({ publico: null });
    expect(html).toContain("Ainda não escolhido");
    expect(html).toContain(
      "No teste, o assistente atende os telefones da equipe, sejam leads ou pacientes. Antes da produção, escolha.",
    );
    for (const radio of radios(html)) {
      expect(radio).not.toContain("checked");
    }
    expect(aberturaDoBotao(html, "Salvar público")).toContain('disabled=""');
  });

  it("já escolhido: a opção marcada, sem o aviso, e o Salvar preso até mudar", () => {
    const html = cartao({ publico: "pacientes" });
    expect(html).not.toContain("Ainda não escolhido");
    const marcados = radios(html).filter((radio) => radio.includes("checked"));
    expect(marcados).toHaveLength(1);
    expect(marcados[0]).toContain('value="pacientes"');
    expect(aberturaDoBotao(html, "Salvar público")).toContain('disabled=""');
  });

  it("recepção: os cartões e o Salvar visíveis e presos, com a dica", () => {
    const html = cartao({
      publico: "leads",
      podeEditar: false,
      dica: DICA_RECEPCAO,
    });
    for (const radio of radios(html)) {
      expect(radio).toContain('disabled=""');
    }
    expect(aberturaDoBotao(html, "Salvar público")).toContain('disabled=""');
    expect(html).toContain("cursor-not-allowed");
  });

  it("no painel: o cartão no topo de Regras e limites, com o público do rascunho", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PainelDoAgente
          dados={dadosDeTeste({
            config: configDeTeste({ publico: "todos" }),
          })}
          abaInicial="regras"
        />
      </TooltipProvider>,
    );
    const publico = html.indexOf("Quem o assistente atende");
    const horario = html.indexOf(TEXTOS_DO_AGENTE.horarioTitulo);
    expect(publico).toBeGreaterThan(-1);
    expect(horario).toBeGreaterThan(publico);
    const doPublico = radios(html).filter((radio) =>
      radio.includes('name="agente-publico"'),
    );
    expect(doPublico, doPublico.join("\n")).toHaveLength(3);
    expect(
      doPublico.filter((radio) => radio.includes("checked")),
      doPublico.join("\n"),
    ).toEqual([expect.stringContaining('value="todos"')]);
  });

  it("nenhum travessão nem jargão nos textos do cartão", () => {
    for (const texto of [
      cartao(),
      cartao({ publico: "leads", podeEditar: false, dica: DICA_RECEPCAO }),
      TEXTOS_DO_AGENTE.publicoDescricao,
      TEXTOS_DO_AGENTE.publicoNaoEscolhido,
      TEXTOS_DO_AGENTE.publicoEscolhaAntes,
      TEXTOS_DO_AGENTE.publicoSemMudanca,
      TEXTOS_DO_AGENTE.publicoSalvo,
    ]) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(publico_atendido|tenant|opt-in|skill)\b/i);
    }
  });
});
