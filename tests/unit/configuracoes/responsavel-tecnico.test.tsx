import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionContext } from "@/lib/auth/active-clinic";
import type { Role } from "@/lib/domain/permissions";

import { BancoFalso } from "../whatsapp/banco-falso";

// Configuracoes, aba Equipe (AG7, desenho 5.3 e 5.6; contrato 3.3 EQ, 4.6 e
// 7.4): o cartao "Responsavel tecnico", as Server Actions dele e o selo na
// lista da equipe. O que se prova aqui:
//   - o cartao vazio, definido (com a data no fuso da clinica), sem acesso
//     ativo (o aviso em atencao) e com a leitura que falhou (sem derrubar a
//     aba); a troca com o aviso, com e sem a pessoa escolhida;
//   - so o administrador pleno e a equipe Conduzza usam as acoes; para o
//     gestor e o Implementador elas ficam visiveis e desabilitadas, com a
//     frase do banco como dica;
//   - as actions: a guarda NA action (sessao, papel, a marca que nao foi
//     lida), o Zod (o "confirmou" literal, os formatos do banco, nome e
//     numero aparados), a clinica sempre a da sessao e a traducao de cada
//     codigo das RPCs;
//   - a pagina: o RT lido junto do lote, o selo so no RT, as pessoas ativas
//     para o formulario e a leitura tolerante;
//   - a equipe Conduzza nunca se define RT (revisao das telas, TELA-9): a
//     conta dela desabilitada no formulario, com a frase, e a action recusa;
//   - a falha do Encerrar diz "encerrar", nao "salvar" (TELA-12);
//   - nenhum travessao (nem meia-risca) nos textos.
// Renderizacao estatica: o Dialog do Radix vira marcacao que so aparece
// aberta, e a dica de permissao vira um atributo conferivel. Banco, sessao e
// cliente do Supabase sao dubles; nada de rede.

const estado = vi.hoisted(() => ({
  sessao: null as unknown,
  cliente: null as unknown,
  admin: null as unknown,
  revalidados: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => {
    estado.revalidados.push(caminho);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["origin", "https://app.exemplo.test"],
      ["host", "app.exemplo.test"],
    ]),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => estado.cliente,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => estado.admin,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => estado.sessao,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-parte="dialogo">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => (
    <div data-parte="conteudo">{children}</div>
  ),
  DialogHeader: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children?: ReactNode }) => (
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

const {
  DialogoDeEncerrar,
  DialogoDoResponsavelTecnico,
  FormularioDoResponsavelTecnico,
  ResponsavelTecnicoCard,
  TEXTOS_DO_RESPONSAVEL_TECNICO: T,
  avisoDaTroca,
  descricaoDoResponsavelTecnico,
  formularioDoResponsavelTecnicoSchema,
  rotuloDoDefinir,
  textoDoEncerrar,
} = await import("@/components/configuracoes/responsavel-tecnico-card");
const { ListaEquipe, SELO_DO_RESPONSAVEL_TECNICO } =
  await import("@/components/configuracoes/lista-equipe");
const { definirResponsavelTecnicoAction, encerrarResponsavelTecnicoAction } =
  await import("@/app/(app)/configuracoes/responsavel-tecnico-actions");
const { default: ConfiguracoesPage } =
  await import("@/app/(app)/configuracoes/page");

type DadosDoResponsavelTecnico =
  import("@/components/configuracoes/responsavel-tecnico-card").DadosDoResponsavelTecnico;
type ResponsavelTecnicoCardProps =
  import("@/components/configuracoes/responsavel-tecnico-card").ResponsavelTecnicoCardProps;
type MembroEquipe =
  import("@/components/configuracoes/lista-equipe").MembroEquipe;
type EntradaDoResponsavelTecnico =
  import("@/app/(app)/configuracoes/responsavel-tecnico-actions").EntradaDoResponsavelTecnico;

// Pelo codigo, para os caracteres nao aparecerem escritos no fonte.
const TRAVESSAO = String.fromCharCode(0x2014);
const MEIA_RISCA = String.fromCharCode(0x2013);

const TZ = "America/Fortaleza";
const CLINICA = "c1111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "c2222222-2222-4222-8222-222222222222";
const EU = "e0000000-0000-4000-8000-000000000001";
const ANA = "a0000000-0000-4000-8000-00000000000a";
const BIA = "b0000000-0000-4000-8000-00000000000b";
const CAIO = "c0000000-0000-4000-8000-00000000000c";

const FRASE_DO_RT =
  "Só o administrador da clínica define o responsável técnico.";
const NAO_SALVOU = "Não foi possível salvar agora. Tente de novo.";
const NAO_ENCERROU = "Não foi possível encerrar agora. Tente de novo.";
const EQUIPE_CONDUZZA_NAO_E_RT =
  "A equipe Conduzza não pode ser o responsável técnico da clínica.";

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** As tags <button ...> do HTML. */
function botoes(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
}

/** O texto de cada botao, na ordem. */
function rotulosDosBotoes(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
    texto(m[1] ?? ""),
  );
}

const PESSOAS = [
  { userId: EU, nome: "Dona", email: "dona@clinica.test" },
  { userId: ANA, nome: "Ana Souza", email: "ana@clinica.test" },
  { userId: BIA, nome: "Bia Lima", email: "bia@clinica.test" },
];

const RT_DA_ANA = {
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  numero: "12345",
  uf: "CE",
  desde: "2026-10-27T13:00:00+00:00",
  email: "ana@clinica.test",
  comAcesso: true,
};

function cartao(props: Partial<ResponsavelTecnicoCardProps> = {}): string {
  const dados: DadosDoResponsavelTecnico | null =
    props.dados === undefined
      ? { rt: RT_DA_ANA, pessoas: PESSOAS }
      : props.dados;
  return renderToStaticMarkup(
    <ResponsavelTecnicoCard
      dados={dados}
      podeDefinir={props.podeDefinir ?? true}
      timezone={props.timezone ?? TZ}
    />,
  );
}

// ---------------------------------------------------------------------------
// O cartao

describe("o cartão Responsável técnico", () => {
  it("os textos do desenho, exatos", () => {
    expect(T.titulo).toBe("Responsável técnico");
    expect(T.vazio).toBe(
      "Sem responsável técnico definido. Sem ele, nenhuma orientação de preparo é enviada aos pacientes.",
    );
    expect(T.semAcesso).toBe(
      "Sem acesso ativo: as orientações aprovadas não estão sendo enviadas.",
    );
    expect(T.erroDaLeitura).toBe(
      "Não foi possível carregar o responsável técnico.",
    );
    expect(T.dica).toBe(FRASE_DO_RT);
    expect(T.definir).toBe("Definir responsável técnico");
    expect(T.trocar).toBe("Trocar");
    expect(T.encerrar).toBe("Encerrar");
  });

  it("vazio: a frase e só o Definir, liberado para quem define", () => {
    const html = cartao({ dados: { rt: null, pessoas: PESSOAS } });
    expect(texto(html)).toContain(T.vazio);
    expect(rotulosDosBotoes(html)).toEqual([T.definir]);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("data-dica");
  });

  it("definido: nome, registro, e-mail do membro e a data, sem o aviso", () => {
    const html = cartao();
    expect(texto(html)).toContain(
      "Dra. Ana Souza (CRM-CE 12345), ana@clinica.test, desde 27/10/2026.",
    );
    expect(texto(html)).not.toContain(T.semAcesso);
    expect(texto(html)).not.toContain(T.vazio);
    expect(rotulosDosBotoes(html)).toEqual([T.trocar, T.encerrar]);
    expect(html).not.toContain('disabled=""');
  });

  it("a data do desde sai no fuso da clínica, não no do servidor", () => {
    // 28/10 02:30 em UTC e 27/10 23:30 em Fortaleza (UTC-3).
    const rt = { ...RT_DA_ANA, desde: "2026-10-28T02:30:00Z" };
    expect(descricaoDoResponsavelTecnico(rt, TZ)).toBe(
      "Dra. Ana Souza (CRM-CE 12345), ana@clinica.test, desde 27/10/2026.",
    );
    expect(descricaoDoResponsavelTecnico(rt, "UTC")).toContain(
      "desde 28/10/2026.",
    );
  });

  it("sem o e-mail (a pessoa saiu da clínica), a frase fica sem ele", () => {
    expect(
      descricaoDoResponsavelTecnico({ ...RT_DA_ANA, email: null }, TZ),
    ).toBe("Dra. Ana Souza (CRM-CE 12345), desde 27/10/2026.");
    expect(descricaoDoResponsavelTecnico({ ...RT_DA_ANA, email: "" }, TZ)).toBe(
      "Dra. Ana Souza (CRM-CE 12345), desde 27/10/2026.",
    );
  });

  it("sem acesso ativo: o aviso em atenção (ícone e texto, nunca só cor), com Trocar e Encerrar", () => {
    const html = cartao({
      dados: { rt: { ...RT_DA_ANA, comAcesso: false }, pessoas: PESSOAS },
    });
    const aviso =
      /<div[^>]*data-tom="warning"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html);
    expect(aviso?.[0]).toContain(T.semAcesso);
    // O icone de atencao do Aviso (CircleAlert), com o texto ao lado.
    expect(aviso?.[0]).toContain("<svg");
    expect(texto(html)).toContain("Dra. Ana Souza (CRM-CE 12345)");
    expect(rotulosDosBotoes(html)).toEqual([T.trocar, T.encerrar]);
  });

  it("a leitura que falhou: o cartão diz isso, sem ações e sem derrubar a aba", () => {
    const html = cartao({ dados: null });
    expect(html).toContain('data-tom="alert"');
    expect(texto(html)).toContain(T.erroDaLeitura);
    expect(texto(html)).toContain(
      "Recarregue a página. Se continuar, fale com o suporte.",
    );
    expect(botoes(html)).toEqual([]);
    expect(texto(html)).not.toContain(T.vazio);
  });

  it("gestor e Implementador: as ações visíveis e desabilitadas, com a frase do banco como dica", () => {
    for (const dados of [
      { rt: null, pessoas: PESSOAS },
      { rt: RT_DA_ANA, pessoas: PESSOAS },
    ]) {
      const html = cartao({ dados, podeDefinir: false });
      const lista = botoes(html);
      expect(lista.length).toBeGreaterThan(0);
      for (const botao of lista) {
        expect(botao).toContain('disabled=""');
      }
      const dicas = [...html.matchAll(/data-dica="([^"]*)"/g)].map((m) => m[1]);
      expect(dicas).toHaveLength(lista.length);
      expect(new Set(dicas)).toEqual(new Set([FRASE_DO_RT]));
    }
  });

  it("os diálogos começam fechados", () => {
    const html = cartao();
    expect(html).not.toContain('data-parte="dialogo"');
    expect(texto(html)).not.toContain(T.tituloEncerrar);
    expect(texto(html)).not.toContain(T.confirmacao);
  });

  it("alvo de 40px: os botões do cartão no tamanho padrão (h-10)", () => {
    for (const html of [
      cartao(),
      cartao({ dados: { rt: null, pessoas: [] } }),
      cartao({ podeDefinir: false }),
    ]) {
      for (const botao of botoes(html)) {
        expect(botao).toContain('data-size="default"');
        expect(botao).toContain("h-10");
      }
    }
  });

  it("só tokens do tema (claro e escuro): nenhuma cor solta no cartão", () => {
    const fonte = readFileSync(
      path.join(
        process.cwd(),
        "components/configuracoes/responsavel-tecnico-card.tsx",
      ),
      "utf-8",
    );
    expect(fonte).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(fonte).not.toMatch(/\b(rgb|hsl|oklch)\(/);
  });
});

// ---------------------------------------------------------------------------
// O formulario e os dialogos

function formulario(
  props: Partial<Parameters<typeof FormularioDoResponsavelTecnico>[0]> = {},
): string {
  return renderToStaticMarkup(
    <FormularioDoResponsavelTecnico
      atual={props.atual ?? null}
      pessoas={props.pessoas ?? PESSOAS}
      contaDaEquipeConduzza={props.contaDaEquipeConduzza}
      valoresIniciais={props.valoresIniciais}
      aoDefinir={() => undefined}
      aoVoltar={() => undefined}
    />,
  );
}

describe("definir e trocar", () => {
  it("o formulário tem os campos do desenho, a caixa obrigatória e o Definir", () => {
    const html = formulario();
    const visivel = texto(html);
    for (const rotulo of [
      "Pessoa da equipe",
      "Nome como está no conselho",
      "Conselho",
      "Número do registro",
      "UF do registro",
      "Confirmo que esta pessoa é a responsável técnica da clínica no conselho de classe.",
    ]) {
      expect(visivel).toContain(rotulo);
    }
    expect(T.confirmacao).toBe(
      "Confirmo que esta pessoa é a responsável técnica da clínica no conselho de classe.",
    );
    // A caixa nasce desmarcada.
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="false"/);
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('maxLength="20"');
    expect(rotulosDosBotoes(html).slice(-2)).toEqual(["Voltar", "Definir"]);
    // Sem RT, nada de aviso da troca.
    expect(html).not.toContain('data-tom="warning"');
  });

  it("os campos e os botões com 40px", () => {
    const html = formulario();
    const combos = [...html.matchAll(/<button\b[^>]*role="combobox"[^>]*>/g)];
    expect(combos).toHaveLength(3);
    for (const combo of combos) {
      expect(combo[0]).toContain("h-10");
    }
    for (const campo of html.match(/<input\b[^>]*>/g) ?? []) {
      if (
        !campo.includes('type="checkbox"') &&
        !campo.includes("aria-hidden")
      ) {
        expect(campo).toContain("h-10");
      }
    }
  });

  it("trocando, sem pessoa escolhida: o aviso na forma sem o nome", () => {
    const html = formulario({ atual: "Dra. Ana Souza" });
    expect(texto(html)).toContain(
      "As orientações aprovadas por Dra. Ana Souza deixam de ser enviadas até o novo responsável técnico aprovar de novo.",
    );
    expect(html).toContain('data-tom="warning"');
  });

  it("trocando, com a pessoa escolhida: o aviso com o nome dela", () => {
    const html = formulario({
      atual: "Dra. Ana Souza",
      valoresIniciais: { userId: BIA },
    });
    expect(texto(html)).toContain(
      "As orientações aprovadas por Dra. Ana Souza deixam de ser enviadas até Bia Lima aprovar de novo.",
    );
    expect(avisoDaTroca("Dra. Ana Souza", "Bia Lima")).toBe(
      "As orientações aprovadas por Dra. Ana Souza deixam de ser enviadas até Bia Lima aprovar de novo.",
    );
  });

  it("a conta da equipe Conduzza na lista: a frase logo abaixo do campo (TELA-9)", () => {
    expect(T.equipeConduzzaNaoERt).toBe(EQUIPE_CONDUZZA_NAO_E_RT);
    const html = formulario({ contaDaEquipeConduzza: EU });
    expect(html).toContain('data-parte="equipe-conduzza-nao-e-rt"');
    expect(texto(html)).toContain(EQUIPE_CONDUZZA_NAO_E_RT);
    // Sem a conta da equipe na lista (ou sem ser da equipe), nada.
    expect(formulario({ contaDaEquipeConduzza: CAIO })).not.toContain(
      EQUIPE_CONDUZZA_NAO_E_RT,
    );
    expect(formulario()).not.toContain(EQUIPE_CONDUZZA_NAO_E_RT);
  });

  it("o botão diz Definindo... enquanto grava", () => {
    expect(rotuloDoDefinir(false)).toBe("Definir");
    expect(rotuloDoDefinir(true)).toBe("Definindo...");
  });

  it("o diálogo: Definir sem RT, Trocar com RT, e o texto sobre o paciente", () => {
    const definir = renderToStaticMarkup(
      <DialogoDoResponsavelTecnico
        aberto
        atual={null}
        pessoas={PESSOAS}
        aoFechar={() => undefined}
      />,
    );
    expect(definir).toContain("<h2>Definir responsável técnico</h2>");
    expect(texto(definir)).toContain(T.descricaoDoFormulario);
    const trocar = renderToStaticMarkup(
      <DialogoDoResponsavelTecnico
        aberto
        atual="Dra. Ana Souza"
        pessoas={PESSOAS}
        aoFechar={() => undefined}
      />,
    );
    expect(trocar).toContain("<h2>Trocar responsável técnico</h2>");
    const fechado = renderToStaticMarkup(
      <DialogoDoResponsavelTecnico
        aberto={false}
        atual={null}
        pessoas={PESSOAS}
        aoFechar={() => undefined}
      />,
    );
    expect(fechado).toBe("");
  });

  it("encerrar pede confirmação, com Voltar e Encerrar", () => {
    const html = renderToStaticMarkup(
      <DialogoDeEncerrar
        aberto
        nome="Dra. Ana Souza"
        pendente={false}
        erro={null}
        aoFechar={() => undefined}
        aoEncerrar={() => undefined}
      />,
    );
    expect(html).toContain("<h2>Encerrar o responsável técnico?</h2>");
    expect(texto(html)).toContain(
      "As orientações de preparo aprovadas por Dra. Ana Souza deixam de ser enviadas aos pacientes até a clínica definir um responsável técnico e ele aprovar de novo.",
    );
    expect(textoDoEncerrar("Dra. Ana Souza")).toBe(
      "As orientações de preparo aprovadas por Dra. Ana Souza deixam de ser enviadas aos pacientes até a clínica definir um responsável técnico e ele aprovar de novo.",
    );
    expect(rotulosDosBotoes(html)).toEqual(["Voltar", "Encerrar"]);
    expect(html).not.toContain('disabled=""');
  });

  it("encerrando: Encerrando... e os dois botões travados; o erro traduzido dentro do diálogo", () => {
    const html = renderToStaticMarkup(
      <DialogoDeEncerrar
        aberto
        nome="Dra. Ana Souza"
        pendente
        erro="A clínica não tem responsável técnico definido."
        aoFechar={() => undefined}
        aoEncerrar={() => undefined}
      />,
    );
    expect(rotulosDosBotoes(html)).toEqual(["Voltar", "Encerrando..."]);
    for (const botao of botoes(html)) {
      expect(botao).toContain('disabled=""');
    }
    expect(html).toMatch(
      /data-tom="alert"[\s\S]*A clínica não tem responsável técnico definido\./,
    );
  });
});

describe("o Zod do formulário", () => {
  const VALIDO = {
    userId: ANA,
    nome: "Ana Maria Souza",
    conselho: "CRM",
    numero: "12345",
    uf: "CE",
    confirmou: true,
  };

  function erroDe(parcial: Record<string, unknown>): string | undefined {
    const lido = formularioDoResponsavelTecnicoSchema.safeParse({
      ...VALIDO,
      ...parcial,
    });
    return lido.success ? undefined : lido.error.issues[0]?.message;
  }

  it("o válido passa, com o nome e o número aparados", () => {
    const lido = formularioDoResponsavelTecnicoSchema.safeParse({
      ...VALIDO,
      nome: "  Ana Maria Souza ",
      numero: " 12345 ",
    });
    expect(lido.success).toBe(true);
    expect(lido.data?.nome).toBe("Ana Maria Souza");
    expect(lido.data?.numero).toBe("12345");
  });

  it("cada campo com a frase dele", () => {
    expect(erroDe({ userId: "" })).toBe("Escolha a pessoa da equipe.");
    expect(erroDe({ nome: "   " })).toBe(
      "Escreva o nome como está no conselho.",
    );
    expect(erroDe({ nome: "a".repeat(121) })).toBe(
      "Use até 120 caracteres no nome.",
    );
    expect(erroDe({ nome: "Ana\tSouza" })).toBe(
      "Tire as quebras de linha do nome.",
    );
    expect(erroDe({ conselho: "" })).toBe("Escolha o conselho.");
    expect(erroDe({ conselho: "crm" })).toBe("Escolha o conselho.");
    expect(erroDe({ numero: " " })).toBe("Escreva o número do registro.");
    expect(erroDe({ numero: "12 345" })).toBe(
      "Use até 20 letras, números, ponto, barra ou hífen no número.",
    );
    expect(erroDe({ numero: "1".repeat(21) })).toBe(
      "Use até 20 letras, números, ponto, barra ou hífen no número.",
    );
    expect(erroDe({ uf: "" })).toBe("Escolha a UF do registro.");
    expect(erroDe({ uf: "XX" })).toBe("Escolha a UF do registro.");
    expect(erroDe({ confirmou: false })).toBe(
      "Marque a confirmação para definir.",
    );
  });

  it("o nome conta pontos de código, como o banco (um emoji vale 1)", () => {
    const dente = String.fromCodePoint(0x1f9b7);
    const nome = `${"a".repeat(119)}${dente}`;
    expect(nome.length).toBe(121);
    expect(erroDe({ nome })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// O selo na lista da equipe

function membro(parcial: Partial<MembroEquipe> & { userId: string }) {
  return {
    nome: "Pessoa",
    email: "pessoa@clinica.test",
    papel: "recepcao" as Role,
    implementador: false,
    ativo: true,
    professionalId: null,
    ...parcial,
  };
}

function linhasDaLista(membros: MembroEquipe[]): string[] {
  const html = renderToStaticMarkup(
    <ListaEquipe
      membros={membros}
      meuUserId={EU}
      podeGerenciar
      ehAdminPleno
      dica="Somente administradores e gestores alteram as configurações"
      profissionais={[]}
    />,
  );
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(
    (m) => m[1] ?? "",
  );
}

describe("o selo na lista da equipe", () => {
  it("só na linha do RT, sem ícone e no fundo neutro", () => {
    const linhas = linhasDaLista([
      membro({ userId: EU, nome: "Dona", papel: "admin" }),
      membro({
        userId: ANA,
        nome: "Ana Souza",
        papel: "leitura",
        responsavelTecnico: true,
      }),
      membro({ userId: BIA, nome: "Bia Lima" }),
    ]);
    expect(SELO_DO_RESPONSAVEL_TECNICO).toBe("Responsável técnico");
    const comSelo = linhas.filter((linha) =>
      texto(linha).includes(SELO_DO_RESPONSAVEL_TECNICO),
    );
    expect(comSelo).toHaveLength(1);
    expect(texto(comSelo[0] ?? "")).toContain("Ana Souza");
    const selo = /<span[^>]*>Responsável técnico<\/span>/.exec(
      comSelo[0] ?? "",
    )?.[0];
    expect(selo).toBeDefined();
    expect(selo).toContain("bg-neutral-bg");
    expect(selo).toContain("text-neutral-text");
    expect(selo).not.toContain("<svg");
  });

  it("o RT sem acesso continua com o selo, junto do Sem acesso", () => {
    const [linha] = linhasDaLista([
      membro({
        userId: ANA,
        nome: "Ana Souza",
        ativo: false,
        responsavelTecnico: true,
      }),
    ]);
    expect(texto(linha ?? "")).toContain(SELO_DO_RESPONSAVEL_TECNICO);
    expect(texto(linha ?? "")).toContain("Sem acesso");
  });

  it("sem a marca (ausente ou falsa), nenhum selo", () => {
    const linhas = linhasDaLista([
      membro({ userId: EU, nome: "Dona", papel: "admin" }),
      membro({ userId: BIA, nome: "Bia Lima", responsavelTecnico: false }),
    ]);
    for (const linha of linhas) {
      expect(texto(linha)).not.toContain(SELO_DO_RESPONSAVEL_TECNICO);
    }
  });
});

// ---------------------------------------------------------------------------
// As actions

type ErroDoBanco = { code: string; message: string } | null;

const rpc = {
  chamadas: [] as { nome: string; args: Record<string, unknown> }[],
  resposta: { data: null, error: null } as {
    data: unknown;
    error: ErroDoBanco;
  },
};

function clienteDasRpcs() {
  return {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpc.chamadas.push({ nome, args });
      return rpc.resposta;
    },
    from: () => {
      throw new Error("as actions do RT so falam com o banco pelas RPCs");
    },
  };
}

function sessao(
  parcial: {
    papel?: Role;
    implementador?: boolean;
    superAdmin?: boolean;
    marcaIndisponivel?: boolean;
    semClinica?: boolean;
  } = {},
): SessionContext {
  return {
    userId: EU,
    userName: "Pessoa da sessão",
    userEmail: "eu@clinica.test",
    memberships: [],
    active: parcial.semClinica
      ? null
      : {
          clinicId: CLINICA,
          clinicName: "Clínica A",
          slug: "clinica-a",
          timezone: TZ,
          role: parcial.papel ?? "admin",
          implementador: parcial.implementador ?? false,
          status: "ativo",
          productName: "Conduzza Clínicas",
          primaryColor: "",
          labels: null,
        },
    clinicaSuspensa: null,
    isProductAdmin: parcial.superAdmin ?? false,
    vinculoIndisponivel: false,
    marcaDeImplementadorIndisponivel: parcial.marcaIndisponivel ?? false,
  };
}

const ENTRADA: EntradaDoResponsavelTecnico = {
  userId: ANA,
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  numero: "12345",
  uf: "CE",
  confirmou: true,
};

/** A entrada com campos trocados (inclusive invalidos, que o TS recusaria). */
function entrada(
  parcial: Record<string, unknown>,
): EntradaDoResponsavelTecnico {
  return { ...ENTRADA, ...parcial } as unknown as EntradaDoResponsavelTecnico;
}

describe("as actions: a guarda na action", () => {
  beforeEach(() => {
    estado.cliente = clienteDasRpcs();
    estado.admin = null;
    estado.revalidados = [];
    rpc.chamadas = [];
    rpc.resposta = { data: "rt-novo", error: null };
  });

  it("o administrador pleno define, com a clínica da sessão", async () => {
    estado.sessao = sessao();
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: true,
    });
    expect(rpc.chamadas).toEqual([
      {
        nome: "definir_responsavel_tecnico",
        args: {
          p_clinic_id: CLINICA,
          p_user_id: ANA,
          p_nome: "Dra. Ana Souza",
          p_conselho: "CRM",
          p_numero: "12345",
          p_uf: "CE",
        },
      },
    ]);
  });

  it.each([
    [
      "a equipe Conduzza com papel de gestor",
      sessao({ papel: "gestor", superAdmin: true }),
    ],
    [
      "a equipe Conduzza sem a marca lida",
      sessao({ superAdmin: true, marcaIndisponivel: true }),
    ],
    [
      "a equipe Conduzza com a marca de Implementador",
      sessao({ implementador: true, superAdmin: true }),
    ],
  ])("%s define", async (_quem, contexto) => {
    estado.sessao = contexto;
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: true,
    });
    await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual({
      ok: true,
    });
    expect(rpc.chamadas.map((c) => c.nome)).toEqual([
      "definir_responsavel_tecnico",
      "encerrar_responsavel_tecnico",
    ]);
  });

  it.each([
    ["o gestor", sessao({ papel: "gestor" })],
    ["o Implementador", sessao({ implementador: true })],
    [
      "o administrador com a marca que não foi lida",
      sessao({ marcaIndisponivel: true }),
    ],
    ["a recepção", sessao({ papel: "recepcao" })],
    ["o profissional", sessao({ papel: "profissional" })],
    ["o somente leitura", sessao({ papel: "leitura" })],
  ])(
    "%s é recusado antes do banco, com a frase do banco",
    async (_quem, contexto) => {
      estado.sessao = contexto;
      await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
        ok: false,
        error: FRASE_DO_RT,
      });
      await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual({
        ok: false,
        error: FRASE_DO_RT,
      });
      expect(rpc.chamadas).toEqual([]);
      expect(estado.revalidados).toEqual([]);
    },
  );

  it.each([
    ["sem sessão", null],
    ["sem clínica ativa", sessao({ semClinica: true })],
  ])("%s: sessão expirada, nada no banco", async (_quem, contexto) => {
    estado.sessao = contexto;
    const esperado = { ok: false, error: "Sessão expirada. Entre de novo." };
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual(
      esperado,
    );
    await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual(esperado);
    expect(rpc.chamadas).toEqual([]);
  });

  it("a frase da recusa é a dica do cartão", async () => {
    estado.sessao = sessao({ papel: "gestor" });
    const resultado = await definirResponsavelTecnicoAction(ENTRADA);
    expect(resultado).toEqual({ ok: false, error: T.dica });
  });

  it("a equipe Conduzza não se define RT: a recusa antes do banco (TELA-9)", async () => {
    estado.sessao = sessao({ superAdmin: true });
    await expect(
      definirResponsavelTecnicoAction(entrada({ userId: EU })),
    ).resolves.toEqual({ ok: false, error: EQUIPE_CONDUZZA_NAO_E_RT });
    expect(rpc.chamadas).toEqual([]);
    // Ela continua definindo outra pessoa.
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: true,
    });
    expect(rpc.chamadas.map((c) => c.nome)).toEqual([
      "definir_responsavel_tecnico",
    ]);
  });

  it("o administrador pleno que não é da equipe Conduzza se define RT", async () => {
    estado.sessao = sessao();
    await expect(
      definirResponsavelTecnicoAction(entrada({ userId: EU })),
    ).resolves.toEqual({ ok: true });
  });
});

describe("as actions: o Zod e a clínica da sessão", () => {
  beforeEach(() => {
    estado.sessao = sessao();
    estado.cliente = clienteDasRpcs();
    estado.revalidados = [];
    rpc.chamadas = [];
    rpc.resposta = { data: "rt-novo", error: null };
  });

  it("nome e número vão aparados para a RPC", async () => {
    const resultado = await definirResponsavelTecnicoAction(
      entrada({ nome: "  Dra. Ana Souza ", numero: " CRM/12.345-6 " }),
    );
    expect(resultado).toEqual({ ok: true });
    expect(rpc.chamadas[0]?.args).toMatchObject({
      p_nome: "Dra. Ana Souza",
      p_numero: "CRM/12.345-6",
    });
  });

  it("a clínica vinda do cliente é recusada: só a da sessão vai ao banco", async () => {
    const resultado = await definirResponsavelTecnicoAction(
      entrada({ clinicId: OUTRA_CLINICA }),
    );
    expect(resultado).toEqual({ ok: false, error: NAO_SALVOU });
    expect(rpc.chamadas).toEqual([]);
  });

  it.each([
    [{ confirmou: false }],
    [{ confirmou: "true" }],
    [{ confirmou: undefined }],
  ])("sem confirmar literalmente (%o), nada no banco", async (parcial) => {
    const resultado = await definirResponsavelTecnicoAction(entrada(parcial));
    expect(resultado).toEqual({
      ok: false,
      error: "Marque a confirmação para definir.",
    });
    expect(rpc.chamadas).toEqual([]);
  });

  it.each([
    [{ userId: "nao-e-uuid" }, "Escolha a pessoa da equipe."],
    [
      { nome: "" },
      "Confira o nome: até 120 caracteres, como está no conselho.",
    ],
    [
      { nome: "   " },
      "Confira o nome: até 120 caracteres, como está no conselho.",
    ],
    [
      { nome: "a".repeat(121) },
      "Confira o nome: até 120 caracteres, como está no conselho.",
    ],
    [
      { nome: "Ana\nSouza" },
      "Confira o nome: até 120 caracteres, como está no conselho.",
    ],
    [
      { nome: `Ana${String.fromCharCode(0x85)}Souza` },
      "Confira o nome: até 120 caracteres, como está no conselho.",
    ],
    [{ conselho: "XYZ" }, "Escolha o conselho."],
    [{ conselho: "crm" }, "Escolha o conselho."],
    [
      { numero: "" },
      "Confira o número do registro: até 20 letras, números, ponto, barra ou hífen.",
    ],
    [
      { numero: "12 345" },
      "Confira o número do registro: até 20 letras, números, ponto, barra ou hífen.",
    ],
    [
      { numero: "1".repeat(21) },
      "Confira o número do registro: até 20 letras, números, ponto, barra ou hífen.",
    ],
    [
      { numero: "12345#" },
      "Confira o número do registro: até 20 letras, números, ponto, barra ou hífen.",
    ],
    [{ uf: "XX" }, "Escolha a UF do registro."],
    [{ uf: "ce" }, "Escolha a UF do registro."],
  ])("%o recusado: %s", async (parcial, frase) => {
    const resultado = await definirResponsavelTecnicoAction(entrada(parcial));
    expect(resultado).toEqual({ ok: false, error: frase });
    expect(rpc.chamadas).toEqual([]);
  });

  it("os formatos que o banco aceita passam (CRFa, 120 pontos de código, 20 no número)", async () => {
    const dente = String.fromCodePoint(0x1f9b7);
    const resultado = await definirResponsavelTecnicoAction(
      entrada({
        conselho: "CRFa",
        nome: `${"a".repeat(119)}${dente}`,
        numero: "A".repeat(20),
        uf: "TO",
      }),
    );
    expect(resultado).toEqual({ ok: true });
    expect(rpc.chamadas).toHaveLength(1);
  });

  it("as frases dos campos são as do formulário", async () => {
    const frases = await Promise.all(
      [
        { userId: "x" },
        { conselho: "x" },
        { uf: "x" },
        { confirmou: false },
      ].map(async (parcial) => {
        const resultado = await definirResponsavelTecnicoAction(
          entrada(parcial),
        );
        return resultado.ok ? "" : resultado.error;
      }),
    );
    expect(frases).toEqual([
      T.erroDaPessoa,
      T.erroDoConselho,
      T.erroDaUf,
      T.erroDaConfirmacao,
    ]);
  });
});

describe("as actions: a tradução dos códigos", () => {
  beforeEach(() => {
    estado.sessao = sessao();
    estado.cliente = clienteDasRpcs();
    estado.revalidados = [];
    rpc.chamadas = [];
  });

  it("sucesso: revalida Configurações, Cadastros e a Tela 6", async () => {
    rpc.resposta = { data: "rt-novo", error: null };
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: true,
    });
    expect(estado.revalidados).toEqual([
      "/configuracoes",
      "/cadastros",
      "/agente",
    ]);
    estado.revalidados = [];
    rpc.resposta = { data: null, error: null };
    await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual({
      ok: true,
    });
    expect(rpc.chamadas.at(-1)).toEqual({
      nome: "encerrar_responsavel_tecnico",
      args: { p_clinic_id: CLINICA },
    });
    expect(estado.revalidados).toEqual([
      "/configuracoes",
      "/cadastros",
      "/agente",
    ]);
  });

  it.each([
    [
      "P0001",
      "responsavel_nao_e_membro_ativo",
      "Escolha uma pessoa com acesso ativo à clínica.",
    ],
    [
      "P0001",
      "outra_definicao",
      "Outra pessoa definiu o responsável técnico agora. Feche e abra de novo.",
    ],
  ])(
    "definir: %s %s vira a frase, e a tela recarrega para mostrar o que vale",
    async (code, message, frase) => {
      rpc.resposta = { data: null, error: { code, message } };
      await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
        ok: false,
        error: frase,
      });
      expect(estado.revalidados).toEqual(["/configuracoes"]);
    },
  );

  it("encerrar: P0001 sem_responsavel_tecnico vira a frase, e a tela recarrega", async () => {
    rpc.resposta = {
      data: null,
      error: { code: "P0001", message: "sem_responsavel_tecnico" },
    };
    await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual({
      ok: false,
      error: "A clínica não tem responsável técnico definido.",
    });
    expect(estado.revalidados).toEqual(["/configuracoes"]);
  });

  it("42501: a frase da RPC como veio; outro texto técnico nunca chega à tela", async () => {
    rpc.resposta = {
      data: null,
      error: { code: "42501", message: FRASE_DO_RT },
    };
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: false,
      error: FRASE_DO_RT,
    });
    await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual({
      ok: false,
      error: FRASE_DO_RT,
    });
    rpc.resposta = {
      data: null,
      error: {
        code: "42501",
        message: "permission denied for function definir_responsavel_tecnico",
      },
    };
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: false,
      error: FRASE_DO_RT,
    });
    expect(estado.revalidados).toEqual([]);
  });

  it.each([
    [
      "nome_invalido",
      "Confira o nome: até 120 caracteres, como está no conselho.",
    ],
    ["conselho_invalido", "Escolha o conselho."],
    [
      "numero_invalido",
      "Confira o número do registro: até 20 letras, números, ponto, barra ou hífen.",
    ],
    ["uf_invalida", "Escolha a UF do registro."],
  ])("22023 %s vira frase de recepção", async (message, frase) => {
    rpc.resposta = { data: null, error: { code: "22023", message } };
    await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
      ok: false,
      error: frase,
    });
    expect(estado.revalidados).toEqual([]);
  });

  it.each([
    ["22004", "parametro_nulo"],
    ["PGRST202", "Could not find the function"],
    ["57014", "canceling statement due to statement timeout"],
    ["P0001", "codigo_desconhecido"],
    ["P0001", "toString"],
    ["22023", "constructor"],
    ["23505", "duplicate key value"],
  ])(
    "o resto (%s %s) vira o erro geral, sem revalidar",
    async (code, message) => {
      rpc.resposta = { data: null, error: { code, message } };
      await expect(definirResponsavelTecnicoAction(ENTRADA)).resolves.toEqual({
        ok: false,
        error: NAO_SALVOU,
      });
      // A falha do Encerrar diz encerrar (TELA-12).
      await expect(encerrarResponsavelTecnicoAction()).resolves.toEqual({
        ok: false,
        error: NAO_ENCERROU,
      });
      expect(estado.revalidados).toEqual([]);
    },
  );

  it("o cartão diz encerrar quando a action nem responde (TELA-12)", () => {
    expect(T.naoEncerrou).toBe(NAO_ENCERROU);
  });
});

// ---------------------------------------------------------------------------
// A pagina: o RT lido junto do lote

const banco = new BancoFalso();

function propsCom<P>(no: unknown, chave: string): P | null {
  if (!no || typeof no !== "object") {
    return null;
  }
  const props = (no as { props?: Record<string, unknown> }).props;
  if (!props) {
    return null;
  }
  if (chave in props) {
    return props as P;
  }
  const filhos = props.children;
  for (const filho of Array.isArray(filhos) ? filhos : [filhos]) {
    const achado = propsCom<P>(filho, chave);
    if (achado) {
      return achado;
    }
  }
  return null;
}

type PropsDaTela = {
  responsavelTecnico: ResponsavelTecnicoCardProps;
  equipe: { membros: MembroEquipe[] } | null;
};

function vinculo(userId: string, role: Role, status: string, ordem: number) {
  banco.linhas("clinic_member").push({
    clinic_id: CLINICA,
    user_id: userId,
    role,
    status,
    professional_id: null,
    created_at: new Date(Date.UTC(2026, 9, 1) + ordem).toISOString(),
  });
}

function designacao(
  dados: { clinic_id?: string; user_id: string; ate?: string | null } & Record<
    string,
    unknown
  >,
) {
  banco.linhas("responsavel_tecnico").push({
    id: `rt-${banco.linhas("responsavel_tecnico").length + 1}`,
    clinic_id: CLINICA,
    nome: "Dra. Ana Souza",
    conselho: "CRM",
    numero: "12345",
    uf: "CE",
    desde: "2026-10-27T13:00:00+00:00",
    ate: null,
    ...dados,
  });
}

/** O cliente da sessao com a leitura do RT fora do ar (57014). */
function sessaoComORtFora() {
  const base = banco.cliente();
  const falha = {
    data: null,
    error: { code: "57014", message: "canceling statement" },
  };
  const cadeia = {
    select: () => cadeia,
    eq: () => cadeia,
    is: () => cadeia,
    maybeSingle: async () => falha,
  };
  return {
    ...base,
    from: (tabela: string) =>
      tabela === "responsavel_tecnico" ? cadeia : base.from(tabela),
  };
}

async function tela(): Promise<PropsDaTela> {
  const pagina = await ConfiguracoesPage({ searchParams: Promise.resolve({}) });
  const props = propsCom<PropsDaTela>(pagina, "responsavelTecnico");
  if (!props) {
    throw new Error("o cartao do RT nao chegou ao cliente");
  }
  return props;
}

describe("a página: o RT junto do lote, o selo e quem define", () => {
  beforeEach(() => {
    banco.limpar();
    banco.rpc.mockImplementation(async (nome: string) => {
      if (nome === "emails_da_equipe") {
        return {
          data: [
            { user_id: EU, email: "eu@clinica.test" },
            { user_id: ANA, email: "ana@clinica.test" },
            { user_id: BIA, email: "bia@clinica.test" },
            { user_id: CAIO, email: "caio@clinica.test" },
          ],
          error: null,
        };
      }
      if (nome === "ia_clinicas_da_fase_controlada") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });
    estado.cliente = banco.cliente();
    estado.admin = banco.cliente();
    estado.sessao = sessao();
    vinculo(EU, "admin", "ativo", 1);
    vinculo(ANA, "leitura", "ativo", 2);
    vinculo(BIA, "recepcao", "ativo", 3);
    vinculo(CAIO, "profissional", "inativo", 4);
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("WHATSAPP_PROVIDER", "");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("o RT aberto com o e-mail e o acesso; as pessoas ativas de qualquer papel; o selo só nele", async () => {
    // A designacao encerrada (Caio) e a de outra clinica (Bia) nao contam.
    designacao({ user_id: CAIO, ate: "2026-10-20T12:00:00+00:00" });
    designacao({ user_id: BIA, clinic_id: OUTRA_CLINICA });
    designacao({ user_id: ANA });
    const props = await tela();
    expect(props.responsavelTecnico.timezone).toBe(TZ);
    expect(props.responsavelTecnico.podeDefinir).toBe(true);
    expect(props.responsavelTecnico.dados?.rt).toEqual({
      nome: "Dra. Ana Souza",
      conselho: "CRM",
      numero: "12345",
      uf: "CE",
      desde: "2026-10-27T13:00:00+00:00",
      email: "ana@clinica.test",
      comAcesso: true,
    });
    // Ativos de qualquer papel (a Somente leitura inclusive); o inativo fora.
    expect(
      props.responsavelTecnico.dados?.pessoas.map((pessoa) => pessoa.userId),
    ).toEqual([EU, ANA, BIA]);
    const comSelo = (props.equipe?.membros ?? []).filter(
      (m) => m.responsavelTecnico === true,
    );
    expect(comSelo.map((m) => m.userId)).toEqual([ANA]);
  });

  it("o RT sem acesso ativo: comAcesso falso, o selo na linha dele e fora das pessoas", async () => {
    banco.linhas("clinic_member").forEach((linha) => {
      if (linha.user_id === ANA) {
        linha.status = "inativo";
      }
    });
    designacao({ user_id: ANA });
    const props = await tela();
    expect(props.responsavelTecnico.dados?.rt?.comAcesso).toBe(false);
    expect(
      props.responsavelTecnico.dados?.pessoas.map((pessoa) => pessoa.userId),
    ).toEqual([EU, BIA]);
    const ana = props.equipe?.membros.find((m) => m.userId === ANA);
    expect(ana?.ativo).toBe(false);
    expect(ana?.responsavelTecnico).toBe(true);
  });

  it("sem RT: o cartão vazio e nenhum selo", async () => {
    designacao({ user_id: ANA, clinic_id: OUTRA_CLINICA });
    const props = await tela();
    expect(props.responsavelTecnico.dados).toEqual({
      rt: null,
      pessoas: expect.any(Array),
    });
    expect(
      (props.equipe?.membros ?? []).some((m) => m.responsavelTecnico === true),
    ).toBe(false);
  });

  it("a leitura do RT que falhou: o cartão com o erro, a lista sem selo, a aba de pé", async () => {
    designacao({ user_id: ANA });
    estado.cliente = sessaoComORtFora();
    const props = await tela();
    expect(props.responsavelTecnico.dados).toBeNull();
    expect(props.equipe).not.toBeNull();
    expect(
      (props.equipe?.membros ?? []).some((m) => m.responsavelTecnico === true),
    ).toBe(false);
  });

  it.each([
    ["o administrador pleno", sessao(), true],
    [
      "a equipe Conduzza (gestor)",
      sessao({ papel: "gestor", superAdmin: true }),
      true,
    ],
    ["o gestor", sessao({ papel: "gestor" }), false],
    ["o Implementador", sessao({ implementador: true }), false],
    [
      "o administrador sem a marca lida",
      sessao({ marcaIndisponivel: true }),
      false,
    ],
  ])("quem define: %s", async (_quem, contexto, pode) => {
    estado.sessao = contexto;
    designacao({ user_id: ANA });
    const props = await tela();
    expect(props.responsavelTecnico.podeDefinir).toBe(pode);
  });

  it("a conta da equipe Conduzza vai ao cartão só quando a sessão é da equipe (TELA-9)", async () => {
    designacao({ user_id: ANA });
    estado.sessao = sessao({ superAdmin: true });
    expect((await tela()).responsavelTecnico.contaDaEquipeConduzza).toBe(EU);
    estado.sessao = sessao();
    expect((await tela()).responsavelTecnico.contaDaEquipeConduzza).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Nenhum travessao

describe("nenhum travessão nem meia-risca", () => {
  it("nos textos do cartão, das frases montadas e de todos os estados", () => {
    const frases = [
      ...Object.values(T),
      avisoDaTroca("Dra. Ana Souza", null),
      avisoDaTroca("Dra. Ana Souza", "Bia Lima"),
      textoDoEncerrar("Dra. Ana Souza"),
      descricaoDoResponsavelTecnico(RT_DA_ANA, TZ),
      SELO_DO_RESPONSAVEL_TECNICO,
      cartao(),
      cartao({ dados: null }),
      cartao({ dados: { rt: null, pessoas: PESSOAS } }),
      cartao({
        dados: { rt: { ...RT_DA_ANA, comAcesso: false }, pessoas: [] },
      }),
      cartao({ podeDefinir: false }),
      formulario({ atual: "Dra. Ana Souza", valoresIniciais: { userId: BIA } }),
    ];
    for (const frase of frases) {
      expect(frase).not.toContain(TRAVESSAO);
      expect(frase).not.toContain(MEIA_RISCA);
    }
  });

  it("nas respostas das actions", async () => {
    estado.cliente = clienteDasRpcs();
    const respostas: string[] = [];
    for (const contexto of [null, sessao({ papel: "gestor" })]) {
      estado.sessao = contexto;
      const resultado = await definirResponsavelTecnicoAction(ENTRADA);
      respostas.push(resultado.ok ? "" : resultado.error);
    }
    estado.sessao = sessao();
    for (const error of [
      { code: "P0001", message: "responsavel_nao_e_membro_ativo" },
      { code: "P0001", message: "outra_definicao" },
      { code: "P0001", message: "sem_responsavel_tecnico" },
      { code: "22023", message: "nome_invalido" },
      { code: "22023", message: "conselho_invalido" },
      { code: "22023", message: "numero_invalido" },
      { code: "22023", message: "uf_invalida" },
      { code: "XX000", message: "qualquer" },
    ]) {
      rpc.resposta = { data: null, error };
      const resultado = await definirResponsavelTecnicoAction(ENTRADA);
      respostas.push(resultado.ok ? "" : resultado.error);
    }
    for (const parcial of [
      { userId: "x" },
      { nome: "" },
      { numero: "" },
      { confirmou: false },
    ]) {
      const resultado = await definirResponsavelTecnicoAction(entrada(parcial));
      respostas.push(resultado.ok ? "" : resultado.error);
    }
    expect(respostas.every((resposta) => resposta.length > 0)).toBe(true);
    for (const resposta of respostas) {
      expect(resposta).not.toContain(TRAVESSAO);
      expect(resposta).not.toContain(MEIA_RISCA);
    }
  });
});
