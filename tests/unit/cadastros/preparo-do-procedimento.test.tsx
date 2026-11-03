import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A secao "Orientacao de preparo" do modal do Procedimento e o topo da aba
// Procedimentos (AG7, frente T; desenho 5.1 e 5.6; contrato 3.3 e 7.4).
// Renderizacao estatica (o vitest roda em node, sem DOM): o Dialog do Radix
// vira marcacao sempre aberta, a dica de permissao vira um atributo
// conferivel (data-dica) e as actions sao dubladas (a gravacao esta em
// preparo-actions.test.ts; o banco, em tests/rls e tests/integration).

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open === false ? null : <div data-parte="dialog">{children}</div>,
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
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  salvarProcedimentoAction: vi.fn(),
  salvarRequisitosDoProcedimentoAction: vi.fn(),
  sincronizarVinculosDoProcedimentoAction: vi.fn(),
}));
vi.mock("@/app/(app)/cadastros/preparo-actions", () => ({
  salvarPreparoAction: vi.fn(),
  aprovarPreparoAction: vi.fn(),
  aprovarDeNovoAction: vi.fn(),
  devolverPreparoAction: vi.fn(),
  descartarPreparoAction: vi.fn(),
  suspenderPreparoAction: vi.fn(),
  avisosDoPreparoAction: vi.fn(async () => ({ ok: true, avisos: [] })),
}));

const {
  AvisoDoNomeDoProcedimento,
  AvisoSemRt,
  ChipDoPreparo,
  EditorDoPreparo,
  FaixaDoRt,
  ListaDeVersoes,
  SecaoDoPreparo,
  linhaDaAprovacao,
  motivoDaNovaAprovacao,
  resumoDoPreparo,
} = await import("@/components/cadastros/preparo-do-procedimento");
const { ProcedimentosTab } =
  await import("@/components/cadastros/procedimentos-tab");
const {
  FRASES_SEM_PERMISSAO,
  TEXTOS_DO_PREPARO: T,
  contadorDoTexto,
  dataEHoraNoFuso,
  frasesDasRecusas,
  problemaNoTextoDoPreparo,
  traduzirErroDoPreparo,
} = await import("@/components/cadastros/preparo-na-tela");

import type { PreparoDaAba } from "@/components/cadastros/preparo-do-procedimento";
import { PREPARO_DO_PROCEDIMENTO_STATUS } from "@/lib/design/status";
import type { SituacaoDoPreparoNaTela } from "@/lib/domain/preparo";
import { CADASTRO_VAZIO_PARA_O_AGENTE } from "@/lib/queries/cadastro-para-o-agente";
import type { Catalogo, Procedimento } from "@/lib/queries/catalogo";
import {
  PREPAROS_VAZIOS,
  type PreparosDaClinica,
  type ResponsavelTecnico,
  type VersaoDoPreparo,
} from "@/lib/queries/preparo";

const TRAVESSAO = String.fromCharCode(0x2014);
const FUSO = "America/Fortaleza";
const PROC = "3d3d3d3d-0000-4000-8000-000000000001";
const OUTRO = "3d3d3d3d-0000-4000-8000-000000000002";
const SHA_A = `a1b2c3d4${"0".repeat(56)}`;
const SHA_B = `b2c3d4e5${"1".repeat(56)}`;

const RT_ANA: ResponsavelTecnico = {
  id: "rt-ana",
  userId: "user-ana",
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  numero: "12345",
  uf: "CE",
  desde: "2026-10-01T12:00:00Z",
  ate: null,
};
const RT_ANTIGO: ResponsavelTecnico = {
  ...RT_ANA,
  id: "rt-antigo",
  userId: "user-bruno",
  nome: "Dr. Bruno Lima",
  numero: "999",
  ate: "2026-10-01T12:00:00Z",
};

const TEXTO_EM_VIGOR =
  "Jejum de 8 horas.\nTome 2 comprimidos de bisacodil às 18h do dia anterior.";
const TEXTO_NOVO =
  "Jejum de 8 horas.\nTome 2 comprimidos de bisacodil às 20h do dia anterior.";

function versao(parcial: Partial<VersaoDoPreparo> = {}): VersaoDoPreparo {
  return {
    id: "v1",
    procedureId: PROC,
    versao: 1,
    situacao: "aprovado",
    texto: TEXTO_EM_VIGOR,
    textoSha256: SHA_A,
    nomeDoProcedimento: "Colonoscopia",
    origem: "cadastro",
    escritoPor: "user-gestor",
    escritoEm: "2026-10-26T13:00:00Z",
    aprovadoPor: "user-ana",
    aprovadoEm: "2026-10-27T17:32:00Z",
    rtId: "rt-ana",
    encerradoPor: null,
    encerradoEm: null,
    comentario: null,
    ...parcial,
  };
}

const AGUARDANDO = versao({
  id: "v2",
  versao: 2,
  situacao: "aguardando_rt",
  texto: TEXTO_NOVO,
  textoSha256: SHA_B,
  escritoEm: "2026-10-28T13:00:00Z",
  aprovadoPor: null,
  aprovadoEm: null,
  rtId: null,
});

function dados(parcial: Partial<PreparosDaClinica> = {}): PreparosDaClinica {
  return {
    ...PREPAROS_VAZIOS,
    versoes: [versao()],
    responsaveis: [RT_ANA],
    rtAberto: RT_ANA,
    rtComAcesso: true,
    souRt: false,
    nomes: { "user-gestor": "Carla Gestora", "user-ana": "Ana Souza" },
    ...parcial,
  };
}

function preparo(
  estado: PreparoDaAba["estado"],
  parcial: Partial<PreparoDaAba> = {},
): PreparoDaAba {
  return {
    estado,
    superAdmin: false,
    podeDefinirRt: false,
    recarregar: () => undefined,
    ...parcial,
  };
}

const COLONOSCOPIA = { id: PROC, nome: "Colonoscopia" };

function secao(
  props: Partial<ComponentProps<typeof SecaoDoPreparo>> & {
    dados?: PreparosDaClinica;
  } = {},
) {
  const { dados: lidos, ...resto } = props;
  return renderToStaticMarkup(
    <SecaoDoPreparo
      procedimento={COLONOSCOPIA}
      preparo={preparo({ tipo: "pronto", dados: lidos ?? dados() })}
      podeEditarCadastros={false}
      timezone={FUSO}
      {...resto}
    />,
  );
}

/** O botao com o rotulo, e se ele esta dentro da dica de permissao. */
function botao(html: string, rotulo: string): { dica: string | null } | null {
  const posicao = html.indexOf(`>${rotulo}<`);
  if (posicao < 0) {
    return null;
  }
  const antes = html.slice(0, posicao);
  const abriuDica = antes.lastIndexOf("<span data-dica=");
  const fechouDica = antes.lastIndexOf("</span>");
  if (abriuDica >= 0 && abriuDica > fechouDica) {
    const dica = /data-dica="([^"]*)"/.exec(antes.slice(abriuDica))?.[1];
    return { dica: dica ?? null };
  }
  return { dica: null };
}

function semEntidades(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("os cinco chips nas 3 camadas", () => {
  it.each([
    ["aprovada", "Aprovada pelo RT", "success"],
    ["aguardando", "Aguardando o RT", "warning"],
    ["precisa_de_nova_aprovacao", "Precisa de nova aprovação", "warning"],
    ["suspenso", "Envio suspenso", "neutral"],
    ["sem_orientacao", "Sem orientação", "neutral"],
  ] as const)("%s: ícone, rótulo e cor", (situacao, rotulo, tom) => {
    const html = renderToStaticMarkup(<ChipDoPreparo situacao={situacao} />);
    expect(html).toContain("<svg");
    expect(html).toContain(rotulo);
    expect(html).toContain(`var(--${tom}-text)`);
    expect(html).toContain(`var(--${tom}-bg)`);
    expect(PREPARO_DO_PROCEDIMENTO_STATUS[situacao].label).toBe(rotulo);
  });

  it("cada chip tem uma forma própria (nunca o mesmo ícone em duas situações)", () => {
    const icones = Object.values(PREPARO_DO_PROCEDIMENTO_STATUS).map(
      (d) => d.icon,
    );
    expect(new Set(icones).size).toBe(icones.length);
  });
});

describe("a seção do procedimento", () => {
  it("em vigor: o texto, quem aprovou com o registro, quando e o código", () => {
    const html = semEntidades(secao());
    expect(html).toContain(T.titulo);
    expect(html).toContain(T.ajuda);
    expect(html).toContain(T.emVigor);
    expect(html).toContain("Tome 2 comprimidos de bisacodil às 18h");
    expect(html).toContain(
      "Aprovada por Dra. Ana Souza (CRM-CE 12345) em 27/10/2026 às 14:32. Código do texto: A1B2 C3D4.",
    );
    expect(html).toContain("Aprovada pelo RT");
    expect(html).not.toContain(T.semRt);
  });

  it("texto novo aguardando o RT: quem escreveu, quando e o que continua saindo", () => {
    const html = semEntidades(
      secao({ dados: dados({ versoes: [versao(), AGUARDANDO] }) }),
    );
    expect(html).toContain(T.emVigor);
    expect(html).toContain(T.aguardando);
    expect(html).toContain("às 20h do dia anterior");
    expect(html).toContain("Escrito por Carla Gestora em 28/10/2026.");
    expect(html).toContain(T.enquantoComVigor);
    // O chip continua "Aprovada pelo RT": o texto em vigor ainda sai.
    expect(html).toContain("Aprovada pelo RT");
  });

  it("sem texto em vigor, o aguardando diz que nada é enviado", () => {
    const html = semEntidades(
      secao({ dados: dados({ versoes: [{ ...AGUARDANDO, versao: 1 }] }) }),
    );
    expect(html).toContain("Aguardando o RT");
    expect(html).toContain(T.enquantoSemVigor);
    expect(html).not.toContain(T.emVigor);
  });

  it("o texto antigo copiado do cadastro aparece sem autor", () => {
    const html = semEntidades(
      secao({
        dados: dados({
          versoes: [
            {
              ...AGUARDANDO,
              versao: 1,
              origem: "texto_antigo",
              escritoPor: null,
            },
          ],
        }),
      }),
    );
    expect(html).toContain(
      "Texto que já estava no cadastro do procedimento, copiado em 28/10/2026 para o responsável técnico revisar.",
    );
  });

  it("vazio: sem orientação, com o chip e o botão de escrever", () => {
    const html = semEntidades(
      secao({ dados: dados({ versoes: [] }), podeEditarCadastros: true }),
    );
    expect(html).toContain(T.semOrientacao);
    expect(html).toContain("Sem orientação");
    expect(botao(html, T.escrever)).toEqual({ dica: null });
    expect(html).not.toContain(T.verVersoes);
  });

  it("procedimento novo: pede para salvar antes", () => {
    const html = secao({ procedimento: null });
    expect(semEntidades(html)).toContain(T.procedimentoNovo);
  });

  it("carregando e erro, com o Tentar de novo", () => {
    const carregando = renderToStaticMarkup(
      <SecaoDoPreparo
        procedimento={COLONOSCOPIA}
        preparo={preparo({ tipo: "carregando" })}
        podeEditarCadastros
        timezone={FUSO}
      />,
    );
    expect(carregando).toContain(T.carregando);
    expect(carregando).toContain('role="status"');
    const erro = renderToStaticMarkup(
      <SecaoDoPreparo
        procedimento={COLONOSCOPIA}
        preparo={preparo({ tipo: "erro" })}
        podeEditarCadastros
        timezone={FUSO}
      />,
    );
    expect(semEntidades(erro)).toContain(T.erroAoCarregar);
    expect(erro).toContain(T.tentarDeNovo);
    expect(erro).toContain('role="alert"');
  });

  it("devolvido: a linha com a data e o comentário do RT", () => {
    const html = semEntidades(
      secao({
        dados: dados({
          versoes: [
            versao(),
            {
              ...AGUARDANDO,
              situacao: "devolvido",
              encerradoPor: "user-ana",
              encerradoEm: "2026-10-28T15:00:00Z",
              comentario: "Troque o horário do laxante.",
            },
          ],
        }),
      }),
    );
    expect(html).toContain(
      "O responsável técnico devolveu o texto de 28/10/2026: Troque o horário do laxante.",
    );
  });

  it("suspenso: o bloco com desde quando e o Aprovar de novo para o RT", () => {
    const suspensa = versao({
      situacao: "suspenso",
      encerradoPor: "user-gestor",
      encerradoEm: "2026-10-29T12:00:00Z",
    });
    const html = semEntidades(
      secao({ dados: dados({ versoes: [suspensa], souRt: true }) }),
    );
    expect(html).toContain("Envio suspenso");
    expect(html).toContain(
      "O envio está suspenso desde 29/10/2026. Para voltar a enviar, o responsável técnico aprova de novo.",
    );
    expect(botao(html, T.aprovarDeNovo)).toEqual({ dica: null });
  });
});

describe("precisa de nova aprovação", () => {
  it("RT trocado: o motivo, e o Aprovar de novo só para o RT de agora", () => {
    const lidos = dados({
      versoes: [versao({ rtId: "rt-antigo" })],
      responsaveis: [RT_ANTIGO, RT_ANA],
    });
    const html = semEntidades(secao({ dados: lidos }));
    expect(html).toContain("Precisa de nova aprovação");
    expect(html).toContain(T.rtMudou);
    expect(html).toContain(T.aprovadaParada);
    expect(html).toContain("Aprovada por Dr. Bruno Lima (CRM-CE 999)");
    expect(botao(html, T.aprovarDeNovo)).toEqual({
      dica: FRASES_SEM_PERMISSAO.aprovar,
    });
    const doRt = semEntidades(secao({ dados: { ...lidos, souRt: true } }));
    expect(botao(doRt, T.aprovarDeNovo)).toEqual({ dica: null });
    // Fora de vigor nao ha o que suspender.
    expect(doRt).not.toContain(T.suspender);
  });

  it("nome mudado depois da aprovação", () => {
    const html = semEntidades(
      secao({ procedimento: { id: PROC, nome: "Colonoscopia total" } }),
    );
    expect(html).toContain(T.nomeMudou);
    expect(motivoDaNovaAprovacao(dados(), versao(), "Colonoscopia")).toBe(null);
  });

  it("sem Aprovar de novo enquanto um texto novo espera (salvar de novo o descartaria)", () => {
    const html = semEntidades(
      secao({
        dados: dados({
          versoes: [versao({ rtId: "rt-antigo" }), AGUARDANDO],
          responsaveis: [RT_ANTIGO, RT_ANA],
          souRt: true,
        }),
      }),
    );
    expect(html).not.toContain(T.aprovarDeNovo);
    expect(botao(html, T.revisar)).toEqual({ dica: null });
  });
});

describe("sem responsável técnico ativo", () => {
  it("na seção: o aviso, e ninguém aprova", () => {
    const html = semEntidades(
      secao({
        dados: dados({
          versoes: [AGUARDANDO],
          rtAberto: null,
          responsaveis: [],
        }),
        podeEditarCadastros: true,
      }),
    );
    expect(html).toContain(T.semRt);
    expect(botao(html, T.revisar)).toEqual({
      dica: FRASES_SEM_PERMISSAO.aprovar,
    });
  });

  it("o RT sem acesso ativo também conta como sem RT", () => {
    const html = semEntidades(secao({ dados: dados({ rtComAcesso: false }) }));
    expect(html).toContain(T.semRt);
    expect(html).toContain("Precisa de nova aprovação");
    expect(html).toContain(T.rtSemAcesso);
  });

  it("o link para Configurações só para quem define o RT; os outros leem quem define", () => {
    const comLink = semEntidades(
      renderToStaticMarkup(<AvisoSemRt podeDefinirRt />),
    );
    expect(comLink).toContain('href="/configuracoes?aba=equipe"');
    expect(comLink).toContain(T.semRtLink);
    const semLink = semEntidades(
      renderToStaticMarkup(<AvisoSemRt podeDefinirRt={false} />),
    );
    expect(semLink).not.toContain("href=");
    expect(semLink).toContain(T.semRtSemLink);
  });
});

describe("matriz de papéis (desenho 5.6; D-71)", () => {
  const comAguardando = dados({ versoes: [versao(), AGUARDANDO] });

  it("o RT de papel profissional ou leitura (sem editar Cadastros) escreve, aprova, descarta e suspende", () => {
    const html = semEntidades(
      secao({
        dados: { ...comAguardando, souRt: true },
        podeEditarCadastros: false,
      }),
    );
    expect(botao(html, T.revisar)).toEqual({ dica: null });
    expect(botao(html, T.descartar)).toEqual({ dica: null });
    expect(botao(html, T.suspender)).toEqual({ dica: null });
    expect(botao(html, T.escreverNovo)).toEqual({ dica: null });
  });

  it("recepção, profissional e leitura que não são o RT: tudo visível e desabilitado, com a frase do banco", () => {
    const html = semEntidades(
      secao({ dados: comAguardando, podeEditarCadastros: false }),
    );
    expect(botao(html, T.revisar)).toEqual({
      dica: FRASES_SEM_PERMISSAO.aprovar,
    });
    expect(botao(html, T.descartar)).toEqual({
      dica: FRASES_SEM_PERMISSAO.descartar,
    });
    expect(botao(html, T.suspender)).toEqual({
      dica: FRASES_SEM_PERMISSAO.suspender,
    });
    expect(botao(html, T.escreverNovo)).toEqual({
      dica: FRASES_SEM_PERMISSAO.escrever,
    });
  });

  it("administrador e gestor escrevem, descartam e suspendem, mas não aprovam", () => {
    const html = semEntidades(
      secao({ dados: comAguardando, podeEditarCadastros: true }),
    );
    expect(botao(html, T.escreverNovo)).toEqual({ dica: null });
    expect(botao(html, T.descartar)).toEqual({ dica: null });
    expect(botao(html, T.suspender)).toEqual({ dica: null });
    expect(botao(html, T.revisar)).toEqual({
      dica: FRASES_SEM_PERMISSAO.aprovar,
    });
  });

  it("a equipe Conduzza (super admin) escreve, mas nunca aprova", () => {
    const html = semEntidades(
      renderToStaticMarkup(
        <SecaoDoPreparo
          procedimento={COLONOSCOPIA}
          preparo={preparo(
            { tipo: "pronto", dados: comAguardando },
            { superAdmin: true },
          )}
          podeEditarCadastros={false}
          timezone={FUSO}
        />,
      ),
    );
    expect(botao(html, T.escreverNovo)).toEqual({ dica: null });
    expect(botao(html, T.revisar)).toEqual({
      dica: FRASES_SEM_PERMISSAO.aprovar,
    });
  });
});

describe("o editor do texto", () => {
  it("o campo, o contador de 3.500 e o Enviar para o RT aprovar", () => {
    const html = semEntidades(
      renderToStaticMarkup(
        <EditorDoPreparo
          id="ed"
          texto={TEXTO_NOVO}
          aoMudar={() => undefined}
          enviando={false}
          erro={null}
          aoEnviar={() => undefined}
          aoCancelar={() => undefined}
        />,
      ),
    );
    expect(html).toContain(T.campo);
    expect(html).toContain(`${Array.from(TEXTO_NOVO).length} de 3.500`);
    expect(html).toContain(T.enviarParaORt);
    expect(html).toContain('aria-describedby="ed-contador"');
  });

  it("Enviando... enquanto grava, e o erro da action em português", () => {
    const html = semEntidades(
      renderToStaticMarkup(
        <EditorDoPreparo
          id="ed"
          texto={TEXTO_NOVO}
          aoMudar={() => undefined}
          enviando
          erro="Tire o link, o arroba e os caracteres fora do comum: o paciente recebe só o texto (escreva mcg no lugar de µg)."
          aoEnviar={() => undefined}
          aoCancelar={() => undefined}
        />,
      ),
    );
    expect(html).toContain(T.enviando);
    expect(html).toContain("Tire o link");
    expect(html).toContain('role="alert"');
  });

  it("o contador passa do limite em alerta", () => {
    const longo = "a".repeat(3_501);
    expect(contadorDoTexto(longo)).toBe("3.501 de 3.500");
    const html = renderToStaticMarkup(
      <EditorDoPreparo
        id="ed"
        texto={longo}
        aoMudar={() => undefined}
        enviando={false}
        erro={null}
        aoEnviar={() => undefined}
        aoCancelar={() => undefined}
      />,
    );
    expect(html).toContain("text-alert-text");
  });

  it("a conferência do texto antes da action (o espelho do CHECK em frase de recepção)", () => {
    expect(problemaNoTextoDoPreparo("   ")).toBe(
      "Escreva a orientação de preparo.",
    );
    expect(problemaNoTextoDoPreparo("a".repeat(3_501))).toBe(
      "A orientação de preparo pode ter até 3.500 caracteres.",
    );
    expect(problemaNoTextoDoPreparo("Olá {{nome}}")).toContain("chaves");
    expect(problemaNoTextoDoPreparo("Jejum\u200b de 8 horas")).toContain(
      "invisíveis",
    );
    expect(problemaNoTextoDoPreparo("  Jejum de 8 horas.\r\n")).toBeNull();
    expect(problemaNoTextoDoPreparo(TEXTO_NOVO)).toBeNull();
  });

  it("as frases das recusas por categoria (promessa, oferta, antes e depois, preço e formato)", () => {
    expect(frasesDasRecusas([])).toBeNull();
    expect(frasesDasRecusas(["promessa_resultado"])).toBe(
      "Tire a promessa de resultado: a orientação de preparo não pode prometer resultado (Resolução CFM 2.336/2023).",
    );
    const varias = frasesDasRecusas([
      "oferta_casada",
      "preco_nao_verificado",
      "formato_invalido",
      "antes_depois",
    ]);
    expect(varias).toContain("Tire a oferta de brinde");
    expect(varias).toContain("Tire o valor");
    expect(varias).toContain("Tire o link");
    expect(varias).toContain("antes e depois");
  });
});

describe("os erros do banco em frase de recepção (contrato 4.6)", () => {
  it.each([
    [
      "salvar",
      "P0001",
      "texto_mudou",
      "Outra pessoa salvou um texto novo agora. Feche e abra de novo.",
    ],
    [
      "aprovar",
      "P0001",
      "texto_mudou",
      "O texto mudou enquanto você lia. Feche e abra de novo.",
    ],
    [
      "salvar",
      "P0001",
      "texto_igual_ao_em_vigor",
      "Este texto já é o que está valendo.",
    ],
    [
      "aprovar",
      "P0001",
      "nao_aguarda_aprovacao",
      "Este texto não está mais esperando aprovação. Feche e abra de novo.",
    ],
    [
      "aprovar",
      "P0001",
      "nome_mudou",
      "O nome do procedimento mudou. Salve o texto de novo para o responsável técnico aprovar.",
    ],
    [
      "aprovar",
      "P0001",
      "outra_aprovacao",
      "Outro texto foi aprovado agora. Feche e abra de novo.",
    ],
    [
      "suspender",
      "P0001",
      "sem_preparo_aprovado",
      "Não há orientação aprovada para suspender.",
    ],
    [
      "devolver",
      "22023",
      "comentario_invalido",
      "Escreva o que precisa mudar, em até 300 caracteres.",
    ],
    [
      "salvar",
      "XX000",
      "qualquer coisa",
      "Não foi possível salvar agora. Tente de novo.",
    ],
    [
      "aprovar",
      "22004",
      "parametro_nulo",
      "Não foi possível aprovar agora. Tente de novo.",
    ],
  ] as const)("%s %s %s", (acao, code, message, frase) => {
    expect(traduzirErroDoPreparo(acao, { code, message }).error).toBe(frase);
  });

  it("um código que é nome do protótipo (constructor) cai na frase de sempre", () => {
    expect(
      traduzirErroDoPreparo("salvar", {
        code: "P0001",
        message: "constructor",
      }),
    ).toEqual({
      ok: false,
      error: "Não foi possível salvar agora. Tente de novo.",
    });
    expect(frasesDasRecusas(["toString"])).toBe(
      "Confira o texto da orientação de preparo.",
    );
  });

  it("o 42501 mostra a frase da RPC como veio", () => {
    expect(
      traduzirErroDoPreparo("salvar", {
        code: "42501",
        message: FRASES_SEM_PERMISSAO.escrever,
      }),
    ).toEqual({
      ok: false,
      error: FRASES_SEM_PERMISSAO.escrever,
      code: "sem_permissao",
    });
  });
});

describe("a lista de versões (só leitura)", () => {
  it("da mais nova para a mais antiga, com a situação em texto e o código", () => {
    const lidos = dados({ versoes: [versao(), AGUARDANDO] });
    const html = semEntidades(
      renderToStaticMarkup(
        <ListaDeVersoes
          dados={lidos}
          versoes={lidos.versoes}
          timezone={FUSO}
        />,
      ),
    );
    expect(html.indexOf("Aguardando o RT")).toBeLessThan(
      html.indexOf("Aprovada"),
    );
    expect(html).toContain("Escrito por Carla Gestora em 28/10/2026.");
    expect(html).toContain("Código do texto: <span");
    expect(html).toContain("B2C3 D4E5");
    expect(linhaDaAprovacao(lidos, AGUARDANDO, FUSO)).toBeNull();
  });

  it("quem saiu da clínica aparece como uma pessoa da equipe", () => {
    const lidos = dados({ nomes: {} });
    expect(
      semEntidades(
        renderToStaticMarkup(
          <ListaDeVersoes
            dados={lidos}
            versoes={lidos.versoes}
            timezone={FUSO}
          />,
        ),
      ),
    ).toContain("Escrito por uma pessoa da equipe em 26/10/2026.");
  });

  it("as datas no fuso da clínica (regra 3.6)", () => {
    expect(dataEHoraNoFuso("2026-10-27T17:32:00Z", FUSO)).toBe(
      "27/10/2026 às 14:32",
    );
    expect(dataEHoraNoFuso("2026-10-27T17:32:00Z", "America/Sao_Paulo")).toBe(
      "27/10/2026 às 14:32",
    );
  });
});

describe("o resumo do procedimento", () => {
  it("a maior versão lida (o p_versao_lida) e as versões de outro procedimento fora", () => {
    const lidos = dados({
      versoes: [
        versao(),
        AGUARDANDO,
        versao({ id: "v9", procedureId: OUTRO, versao: 9 }),
      ],
    });
    const resumo = resumoDoPreparo(lidos, COLONOSCOPIA);
    expect(resumo.versaoLida).toBe(2);
    expect(resumo.versoes.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(resumo.aguardando?.id).toBe("v2");
    expect(resumo.situacao).toBe<SituacaoDoPreparoNaTela>("aprovada");
  });
});

describe("o topo da aba Procedimentos", () => {
  function procedimento(parcial: Partial<Procedimento> = {}): Procedimento {
    return {
      id: PROC,
      name: "Colonoscopia",
      description: null,
      default_duration_min: 40,
      base_price_cents: null,
      requires_evaluation: false,
      resource_id: null,
      bookable_by_ai: true,
      active: true,
      ...parcial,
    };
  }
  function catalogo(parcial: Partial<Catalogo> = {}): Catalogo {
    return {
      profissionais: [],
      jornadas: [],
      recursos: [],
      procedimentos: [procedimento()],
      convenios: [],
      vinculos: [],
      pacotes: [],
      unidades: [],
      ...parcial,
    };
  }
  function aba(preparoDaAba: PreparoDaAba) {
    return semEntidades(
      renderToStaticMarkup(
        <ProcedimentosTab
          catalogo={catalogo()}
          matriz={{ atendimentos: [], coberturas: [] }}
          cadastroDoAgente={CADASTRO_VAZIO_PARA_O_AGENTE}
          podeEditar
          dica="Somente administradores e gestores alteram os cadastros"
          aoMudar={() => undefined}
          timezone={FUSO}
          preparo={preparoDaAba}
        />,
      ),
    );
  }

  it("a faixa do RT com o filtro Aguardando o RT, só para o RT", () => {
    const lidos = dados({ versoes: [versao(), AGUARDANDO], souRt: true });
    const html = aba(preparo({ tipo: "pronto", dados: lidos }));
    expect(html).toContain(
      "Há 1 orientação de preparo esperando sua aprovação.",
    );
    expect(html).toContain(T.filtrarAguardando);
    const deOutro = aba(
      preparo({ tipo: "pronto", dados: { ...lidos, souRt: false } }),
    );
    expect(deOutro).not.toContain("esperando sua aprovação");
  });

  it("o plural da faixa", () => {
    const html = renderToStaticMarkup(
      <FaixaDoRt quantos={3} filtrando aoAlternar={() => undefined} />,
    );
    expect(semEntidades(html)).toContain(
      "Há 3 orientações de preparo esperando sua aprovação.",
    );
    expect(html).toContain('aria-pressed="true"');
    expect(semEntidades(html)).toContain(T.mostrarTodos);
  });

  it("sem RT vigente: o aviso no topo da aba", () => {
    const html = aba(
      preparo(
        { tipo: "pronto", dados: dados({ rtAberto: null }) },
        { podeDefinirRt: true },
      ),
    );
    expect(html).toContain(T.semRt);
    expect(html).toContain(T.semRtLink);
  });

  it("enquanto carrega ou com erro, o topo da aba não afirma nada", () => {
    expect(aba(preparo({ tipo: "carregando" }))).not.toContain(T.semRt);
    expect(aba(preparo({ tipo: "erro" }))).not.toContain(T.semRt);
  });
});

describe("o aviso do nome do procedimento", () => {
  it("diz que renomear tira a aprovação, com ícone de atenção e texto", () => {
    const html = semEntidades(
      renderToStaticMarkup(<AvisoDoNomeDoProcedimento id="aviso" />),
    );
    expect(html).toContain(
      "Mudar o nome tira a aprovação da orientação de preparo: o responsável técnico precisa aprovar de novo.",
    );
    expect(html).toContain('id="aviso"');
    expect(html).toContain("<svg");
    expect(html).toContain("text-warning-text");
  });
});

describe("texto de interface", () => {
  it("nenhum travessão em nenhum texto da seção", () => {
    const tudo = [
      ...Object.values(T),
      ...Object.values(FRASES_SEM_PERMISSAO),
      secao({ dados: dados({ versoes: [versao(), AGUARDANDO] }) }),
      secao({ dados: dados({ rtAberto: null }) }),
    ].join("\n");
    expect(tudo).not.toContain(TRAVESSAO);
  });

  it("alvo de 40px nos botões da seção", () => {
    const html = secao({
      dados: dados({ versoes: [versao(), AGUARDANDO], souRt: true }),
    });
    const botoes = html.match(/<button[^>]*>/g) ?? [];
    expect(botoes.length).toBeGreaterThan(3);
    for (const b of botoes) {
      expect(b).toMatch(/h-10|hit-40|size-10/);
    }
  });
});
