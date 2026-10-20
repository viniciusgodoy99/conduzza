import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Importar como" na tela (decisao do dono em 20/10/2026): a escolha Leads
// (padrao) ou Pacientes no ultimo passo da importacao, o botao que diz o que
// vai acontecer e o resumo do fim, que diz quantos viraram pacientes. O
// projeto nao tem jsdom: a tela e lida pelo HTML de renderToStaticMarkup.

vi.mock("@/app/(app)/leads/actions", () => ({
  importarContatosAction: vi.fn(),
}));

const { EscolhaImportarComo } =
  await import("@/components/leads/importacao/escolha-importar-como");
const { PassoPrevia, ResumoDaImportacao } =
  await import("@/components/leads/importacao/passo-previa");
type TotaisDaImportacao =
  import("@/components/leads/importacao/passo-previa").TotaisDaImportacao;

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function radio(markup: string, valor: string): string {
  return (
    (markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).find((input) =>
      input.includes(`value="${valor}"`),
    ) ?? ""
  );
}

const TOTAIS: TotaisDaImportacao = {
  importados: 3,
  atualizados: 4,
  viraram_pacientes: 2,
  ja_eram_pacientes: 1,
  mantidos_sem_autorizacao: 0,
  pulados: 0,
};

describe("escolha Importar como", () => {
  it("Leads vem marcado e as duas opções explicam o que acontece, sem travessão", () => {
    const html = renderToStaticMarkup(
      <EscolhaImportarComo valor="leads" aoEscolher={() => undefined} />,
    );
    const frase = texto(html);
    expect(frase).toContain("Importar como");
    expect(frase).toContain(
      "Entram no funil como leads. Quem já está na clínica continua como está.",
    );
    expect(frase).toContain(
      "Entram direto em Pacientes, sem consulta marcada. Quem já é lead passa a paciente, sem mudar de etapa.",
    );
    expect(radio(html, "leads")).toContain('checked=""');
    expect(radio(html, "pacientes")).not.toContain('checked=""');
    expect(html).toContain('role="radiogroup"');
    expect(frase).not.toMatch(/[\u2013\u2014]/);
  });

  it("Pacientes marcado", () => {
    const html = renderToStaticMarkup(
      <EscolhaImportarComo valor="pacientes" aoEscolher={() => undefined} />,
    );
    expect(radio(html, "pacientes")).toContain('checked=""');
  });

  it("travada depois que um lote saiu: as duas opções desabilitadas", () => {
    const html = renderToStaticMarkup(
      <EscolhaImportarComo
        valor="pacientes"
        aoEscolher={() => undefined}
        travado
      />,
    );
    expect(radio(html, "leads")).toContain('disabled=""');
    expect(radio(html, "pacientes")).toContain('disabled=""');
  });
});

describe("último passo da importação", () => {
  function passo(importarComo: "leads" | "pacientes", comEscolha = true) {
    return renderToStaticMarkup(
      <PassoPrevia
        cabecalho={["Nome", "Telefone"]}
        linhas={[
          ["Ana Prado", "(85) 99999-0001"],
          ["Bruno Lima", "(85) 99999-0002"],
        ]}
        mapeamento={{
          name: 0,
          phone_e164: 1,
          email: null,
          insurance_name: null,
          source_campaign: null,
        }}
        declaracao={{ opcao: "recepcao" }}
        importarComo={importarComo}
        aoMudarImportarComo={comEscolha ? () => undefined : undefined}
        aoOcupado={() => undefined}
        aoGravarLote={() => undefined}
        aoTerminar={() => undefined}
      />,
    );
  }

  it("a escolha aparece junto do botão, que diz que vão como pacientes", () => {
    const html = passo("pacientes");
    const frase = texto(html);
    expect(frase).toContain("Importar como");
    expect(frase).toContain("Importar 2 contatos como pacientes");
    expect(frase.indexOf("Importar como")).toBeLessThan(
      frase.indexOf("Importar 2 contatos como pacientes"),
    );
  });

  it("como Leads, o botão continua o de sempre", () => {
    const frase = texto(passo("leads"));
    expect(frase).toContain("Importar 2 contatos");
    expect(frase).not.toContain("como pacientes");
  });

  it("sem quem mude a escolha, ela não aparece", () => {
    expect(texto(passo("leads", false))).not.toContain("Importar como");
  });
});

describe("resumo do fim da importação", () => {
  function resumo(
    importarComo: "leads" | "pacientes",
    totais: TotaisDaImportacao = TOTAIS,
  ) {
    return texto(
      renderToStaticMarkup(
        <ResumoDaImportacao
          totais={totais}
          importarComo={importarComo}
          invalidas={0}
          aoBaixarRejeitadas={() => undefined}
        />,
      ),
    );
  }

  it("como Pacientes: quantos viraram (os novos e os leads que já existiam) e quantos já eram", () => {
    const frase = resumo("pacientes");
    expect(frase).toContain("Contatos novos 3");
    expect(frase).toContain("Contatos atualizados 4");
    expect(frase).toContain("Viraram pacientes 5");
    expect(frase).toContain(
      "Os contatos já aparecem em Pacientes, sem mudar de etapa no funil.",
    );
    expect(frase).toContain(
      "1 contato já era paciente e continuou como estava.",
    );
    expect(frase).not.toMatch(/[\u2013\u2014]/);
  });

  it("um só virou: singular", () => {
    const frase = resumo("pacientes", {
      ...TOTAIS,
      importados: 1,
      viraram_pacientes: 0,
      ja_eram_pacientes: 3,
    });
    expect(frase).toContain("Viraram pacientes 1");
    expect(frase).toContain(
      "O contato já aparece em Pacientes, sem mudar de etapa no funil.",
    );
    expect(frase).toContain(
      "3 contatos já eram pacientes e continuaram como estavam.",
    );
  });

  it("nenhum mudou: diz isso", () => {
    const frase = resumo("pacientes", {
      ...TOTAIS,
      importados: 0,
      viraram_pacientes: 0,
      ja_eram_pacientes: 2,
    });
    expect(frase).toContain("Viraram pacientes 0");
    expect(frase).toContain(
      "Nenhum contato mudou para paciente nesta importação.",
    );
  });

  it("como Leads: o resumo de sempre, sem falar de pacientes", () => {
    const frase = resumo("leads");
    expect(frase).toContain("Contatos novos 3");
    expect(frase).not.toContain("Viraram pacientes");
    expect(frase).not.toContain("Pacientes");
  });
});
