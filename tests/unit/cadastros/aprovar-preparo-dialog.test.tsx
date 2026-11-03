import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O dialogo "Aprovar orientacao de preparo de {procedimento}" (AG7, frente
// T; desenho 5.2; contrato 4.6 e 7.4). Renderizacao estatica (node, sem
// DOM): o corpo sem estado (ConteudoDoAprovarPreparo) recebe cada etapa por
// prop; o dialogo inteiro e conferido na abertura. A gravacao esta em
// preparo-actions.test.ts; o banco, em tests/rls e tests/integration.

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
vi.mock("@/app/(app)/cadastros/preparo-actions", () => ({
  aprovarPreparoAction: vi.fn(),
  aprovarDeNovoAction: vi.fn(),
  devolverPreparoAction: vi.fn(),
  avisosDoPreparoAction: vi.fn(async () => ({ ok: true, avisos: [] })),
}));

const {
  AprovarPreparoDialog,
  ConteudoDoAprovarPreparo,
  erroDoDialogo,
  linhasQueMudaram,
  mostraAvisoDeRemedio,
} = await import("@/components/cadastros/aprovar-preparo-dialog");
const {
  TEXTOS_DO_PREPARO: T,
  aprovarTitulo,
  diferencaDasLinhas,
  FRASES_SEM_PERMISSAO,
} = await import("@/components/cadastros/preparo-na-tela");

import { mensagemDoPreparo } from "@/lib/domain/preparo";
import type {
  ResponsavelTecnico,
  VersaoDoPreparo,
} from "@/lib/queries/preparo";

const TRAVESSAO = String.fromCharCode(0x2014);
const PROC = "3d3d3d3d-0000-4000-8000-000000000001";

const RT: ResponsavelTecnico = {
  id: "rt-ana",
  userId: "user-ana",
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  numero: "12345",
  uf: "CE",
  desde: "2026-10-01T12:00:00Z",
  ate: null,
};

const EM_VIGOR =
  "Jejum de 8 horas.\nTome 2 comprimidos às 18h.\nVenha acompanhado.";
const NOVO =
  "Jejum de 8 horas.\nTome 2 comprimidos às 20h.\nVenha acompanhado.";

const AGUARDANDO: VersaoDoPreparo = {
  id: "5f5f5f5f-0000-4000-8000-000000000002",
  procedureId: PROC,
  versao: 2,
  situacao: "aguardando_rt",
  texto: NOVO,
  textoSha256: "b".repeat(64),
  nomeDoProcedimento: "Colonoscopia",
  origem: "cadastro",
  escritoPor: "user-gestor",
  escritoEm: "2026-10-28T13:00:00Z",
  aprovadoPor: null,
  aprovadoEm: null,
  rtId: null,
  encerradoPor: null,
  encerradoEm: null,
  comentario: null,
};

function semEntidades(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

type PropsDoConteudo = ComponentProps<typeof ConteudoDoAprovarPreparo>;

function conteudo(parcial: Partial<PropsDoConteudo> = {}): string {
  const props: PropsDoConteudo = {
    modo: "aprovar",
    mensagem: mensagemDoPreparo({
      procedimento: "Colonoscopia",
      rt: RT,
      texto: NOVO,
    }),
    mudancas: linhasQueMudaram(EM_VIGOR, NOVO),
    avisos: [],
    marcado: false,
    aoMarcar: () => undefined,
    etapa: "lendo",
    comentario: "",
    aoMudarComentario: () => undefined,
    enviando: null,
    erro: null,
    aoAprovar: () => undefined,
    aoDevolver: () => undefined,
    aoCancelar: () => undefined,
    ...parcial,
  };
  return semEntidades(
    renderToStaticMarkup(<ConteudoDoAprovarPreparo {...props} />),
  );
}

describe("como o paciente recebe", () => {
  it("a mensagem inteira: cabeçalho com o procedimento e o RT, o texto e o rodapé, com as quebras", () => {
    const html = conteudo();
    expect(html).toContain(T.comoRecebe);
    expect(html).toContain(
      "Orientação de preparo para Colonoscopia\nResponsável técnico da clínica: Dra. Ana Souza (CRM-CE 12345)\n\nJejum de 8 horas.",
    );
    expect(html).toContain(
      "Se tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.",
    );
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("o diálogo inteiro monta a mensagem do RT vigente, como o banco monta", () => {
    const html = semEntidades(
      renderToStaticMarkup(
        <AprovarPreparoDialog
          pedido={{ modo: "aprovar", versao: AGUARDANDO }}
          aoFechar={() => undefined}
          procedureId={PROC}
          procedimento="Colonoscopia"
          rt={RT}
          textoEmVigor={EM_VIGOR}
          versaoLida={2}
          aoConcluir={() => undefined}
        />,
      ),
    );
    expect(html).toContain(aprovarTitulo("Colonoscopia"));
    expect(html).toContain("Aprovar orientação de preparo de Colonoscopia");
    expect(html).toContain(
      mensagemDoPreparo({ procedimento: "Colonoscopia", rt: RT, texto: NOVO }),
    );
    // Na abertura, o texto ainda e conferido no servidor.
    expect(html).toContain(T.conferindo);
    expect(html).toContain(T.devolver);
  });

  it("fechado, não desenha nada", () => {
    expect(
      renderToStaticMarkup(
        <AprovarPreparoDialog
          pedido={null}
          aoFechar={() => undefined}
          procedureId={PROC}
          procedimento="Colonoscopia"
          rt={RT}
          textoEmVigor={null}
          versaoLida={0}
          aoConcluir={() => undefined}
        />,
      ),
    ).toBe("");
  });
});

describe("o que mudou desde o texto em vigor", () => {
  it("as linhas Entrou e Saiu, com rótulo em texto e fundo neutro, sem ícone colorido", () => {
    const html = conteudo();
    expect(html).toContain(T.oQueMudou);
    expect(html).toContain('data-tipo="saiu"');
    expect(html).toContain('data-tipo="entrou"');
    expect(html).toContain(">Saiu<");
    expect(html).toContain(">Entrou<");
    expect(html).toContain("Tome 2 comprimidos às 18h.");
    expect(html).toContain("Tome 2 comprimidos às 20h.");
    expect(html).toContain("bg-neutral-bg");
    expect(html).toContain("line-through");
    const diferenca = /data-parte="diferenca"[\s\S]*?<\/ul>/.exec(html)?.[0];
    expect(diferenca).toBeDefined();
    expect(diferenca).not.toContain("<svg");
    expect(diferenca).not.toMatch(/(success|alert|warning|info)-(text|bg)/);
  });

  it("só as linhas que mudaram (a mensagem inteira já está acima)", () => {
    expect(linhasQueMudaram(EM_VIGOR, NOVO)).toEqual([
      { tipo: "saiu", texto: "Tome 2 comprimidos às 18h." },
      { tipo: "entrou", texto: "Tome 2 comprimidos às 20h." },
    ]);
    expect(linhasQueMudaram(null, NOVO)).toBeNull();
    expect(linhasQueMudaram(NOVO, NOVO)).toEqual([]);
  });

  it("sem texto em vigor: o texto inteiro é novo", () => {
    expect(conteudo({ mudancas: null })).toContain(T.semTextoEmVigor);
  });

  it("o mesmo texto (aprovar de novo): diz que é o mesmo", () => {
    expect(conteudo({ mudancas: [] })).toContain(T.mesmoTexto);
    expect(conteudo({ modo: "aprovar_de_novo" })).toContain(T.mesmoTexto);
  });

  it("a diferença linha a linha preserva a ordem do texto", () => {
    expect(diferencaDasLinhas("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { tipo: "igual", texto: "a" },
      { tipo: "saiu", texto: "b" },
      { tipo: "entrou", texto: "x" },
      { tipo: "igual", texto: "c" },
      { tipo: "entrou", texto: "d" },
    ]);
    expect(diferencaDasLinhas("", "nova")).toEqual([
      { tipo: "saiu", texto: "" },
      { tipo: "entrou", texto: "nova" },
    ]);
  });
});

describe("o aviso de remédio, dose ou jejum (D-80)", () => {
  it("aparece quando o servidor aponta algum aviso", () => {
    const html = conteudo({ avisos: ["medicamento", "dosagem"] });
    expect(html).toContain(
      "Este texto cita remédio, dose ou jejum. Ao aprovar, você confirma que esta orientação vale para todo paciente deste procedimento, sem avaliação individual.",
    );
    expect(html).toContain('data-tom="info"');
  });

  it("sem aviso do servidor, não aparece", () => {
    expect(conteudo({ avisos: [] })).not.toContain(T.avisoRemedio);
  });

  it("sem conseguir conferir o texto, aparece (o lado seguro)", () => {
    expect(mostraAvisoDeRemedio("falhou")).toBe(true);
    expect(conteudo({ avisos: "falhou" })).toContain(T.avisoRemedio);
  });

  it("conferindo: o aviso de espera e o Aprovar desabilitado", () => {
    const html = conteudo({ avisos: "carregando" });
    expect(html).toContain(T.conferindo);
    expect(html).not.toContain(T.avisoRemedio);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aprovar<\/button>/);
    expect(mostraAvisoDeRemedio("carregando")).toBe(false);
  });
});

describe("a caixa obrigatória e os botões", () => {
  it("a caixa com a frase do desenho, desmarcada na abertura", () => {
    const html = conteudo();
    expect(html).toContain(
      "Li o texto inteiro e aprovo esta orientação de preparo como responsável técnico da clínica.",
    );
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
    expect(conteudo({ marcado: true })).toContain('aria-checked="true"');
  });

  it("sem a caixa, o erro pede para marcar", () => {
    const html = conteudo({ erro: T.marqueACaixa });
    expect(html).toContain(T.marqueACaixa);
    expect(html).toContain('role="alert"');
  });

  it("Aprovando... e tudo travado enquanto grava", () => {
    const html = conteudo({ marcado: true, enviando: "aprovar" });
    expect(html).toContain(T.aprovando);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Aprovando\.\.\.<\/button>/,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Devolver<\/button>/);
  });

  it("Devolver abre o comentário (até 300, sem dados de paciente) e vira Devolver texto", () => {
    const html = conteudo({
      etapa: "devolvendo",
      comentario: "Troque a hora.",
    });
    expect(html).toContain(
      "O que precisa mudar? Até 300 caracteres, sem dados de paciente.",
    );
    expect(html).toContain('maxLength="300"');
    expect(html).toContain("14/300");
    expect(html).toContain(T.devolverTexto);
    expect(html).toContain(T.voltar);
    // Na etapa do comentario, o Aprovar sai (uma decisao de cada vez).
    expect(html).not.toMatch(/>Aprovar<\/button>/);
    expect(conteudo({ etapa: "devolvendo", enviando: "devolver" })).toContain(
      T.devolvendo,
    );
  });

  it("aprovar de novo: sem Devolver (não há texto novo para devolver)", () => {
    const html = conteudo({ modo: "aprovar_de_novo" });
    expect(html).not.toContain(">Devolver<");
    expect(html).toContain(">Aprovar<");
  });

  it("alvo de 40px em todos os botões", () => {
    const botoes = conteudo({ etapa: "devolvendo" }).match(/<button[^>]*>/g);
    expect(botoes?.length).toBeGreaterThan(1);
    for (const b of botoes ?? []) {
      if (b.includes('role="checkbox"')) {
        continue;
      }
      expect(b).toContain("h-10");
    }
  });
});

describe("os erros do diálogo", () => {
  it("o 42501 de quem era o RT ao abrir: Você não é mais o responsável técnico", () => {
    expect(
      erroDoDialogo({
        ok: false,
        error: FRASES_SEM_PERMISSAO.aprovar,
        code: "sem_permissao",
      }),
    ).toBe("Você não é mais o responsável técnico desta clínica.");
  });

  it("os outros erros como a action traduziu", () => {
    expect(
      erroDoDialogo({
        ok: false,
        error: "O texto mudou enquanto você lia. Feche e abra de novo.",
        code: "texto_mudou",
      }),
    ).toBe("O texto mudou enquanto você lia. Feche e abra de novo.");
    expect(erroDoDialogo({ ok: true })).toBeNull();
  });
});

describe("texto de interface", () => {
  it("nenhum travessão no diálogo", () => {
    const tudo = [
      conteudo({ avisos: ["medicamento"] }),
      conteudo({ etapa: "devolvendo" }),
      conteudo({ modo: "aprovar_de_novo", mudancas: null }),
      ...Object.values(T),
    ].join("\n");
    expect(tudo).not.toContain(TRAVESSAO);
  });
});
