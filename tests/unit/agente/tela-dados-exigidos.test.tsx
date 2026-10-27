import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  dadosExigidosPadrao,
  type DadosExigidos,
} from "@/lib/domain/agente/config";

import { DICA_RECEPCAO } from "./tela-fixtures";

// "Dados para marcar consulta" (AG3; decisoes D-6 e D-7 do dono, padrao
// recomendado), na aba Regras e limites da Tela 6: as tres caixas (Nome
// completo, Data de nascimento e CPF) com o proprio Salvar, o texto de que a
// IA pede antes de marcar e de que a aprovacao aplica ao cadastro (o nome so
// vazio ou o do WhatsApp; o resto so vazio), o aviso de quando nenhuma esta marcada, a recepcao travada com
// a dica, o lugar do cartao na aba (depois dos limites) e o "nao salvo"
// contando como o dos limites. Tudo renderizado no servidor; nada aqui chama
// acao nem rede.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarPublico: vi.fn(),
    salvarDadosExigidos: vi.fn(),
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

const { CartaoDosDadosExigidos, nenhumDadoExigido } =
  await import("@/components/agente/cartao-dos-dados-exigidos");
const { chavesDosFormularios, PainelDoAgente } =
  await import("@/components/agente/painel-do-agente");
const {
  abasNaoSalvas,
  comOsDadosParaMarcar,
  formulariosNaoSalvos,
  geracaoDepoisDeDescartar,
  GERACAO_INICIAL,
  NADA_NAO_SALVO,
} = await import("@/components/agente/nao-salvo");
const { TEXTOS_DO_AGENTE } = await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

const NENHUM: DadosExigidos = {
  nomeCompleto: false,
  nascimento: false,
  cpf: false,
};

type Props = Parameters<typeof CartaoDosDadosExigidos>[0];

function cartao(campos: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CartaoDosDadosExigidos
        dados={dadosExigidosPadrao()}
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

/** O texto visivel (sem as tags), para procurar copia. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** As caixas (o botao do Radix com role="checkbox"), na ordem. */
function caixas(html: string): string[] {
  return html.match(/<button[^>]*role="checkbox"[^>]*>/g) ?? [];
}

/** A tag de abertura do botao com aquele texto. */
function aberturaDoBotao(html: string, rotulo: string): string {
  const indice = html.indexOf(`${rotulo}</button>`);
  expect(indice, `botão "${rotulo}"`).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return html.slice(abertura, html.indexOf(">", abertura) + 1);
}

describe("Dados para marcar consulta: o cartão", () => {
  it("o título, as três caixas com rótulo e o que a IA faz com elas", () => {
    const html = cartao();
    const visivel = texto(html);
    expect(visivel).toContain("Dados para marcar consulta");
    expect(visivel).toContain(TEXTOS_DO_AGENTE.dadosDescricao);
    for (const rotulo of ["Nome completo", "Data de nascimento", "CPF"]) {
      expect(visivel).toContain(rotulo);
    }
    expect(caixas(html)).toHaveLength(3);
    // A frase do cadastro (D-7) e a da carteirinha ficam sempre visiveis.
    // Revisao final da AG3 (achado 8): a regra real, o nome do WhatsApp
    // tambem troca; nada de "so onde ele esta vazio".
    expect(visivel).toContain(
      "Quando a equipe aprova a consulta na Agenda, os dados informados entram no cadastro do paciente. O nome entra se o cadastro estiver sem nome ou com o nome que veio do WhatsApp; nascimento, CPF e carteirinha, só se estiverem vazios.",
    );
    expect(visivel).not.toContain("só onde ele está vazio");
    expect(visivel).toContain(
      "Antes de marcar a consulta, o assistente pede ao paciente os dados escolhidos aqui.",
    );
    expect(visivel).toContain(TEXTOS_DO_AGENTE.dadosCarteirinha);
  });

  it("as caixas mostram o que está salvo (o padrão: nome completo e nascimento, sem CPF)", () => {
    const [nome, nascimento, cpf] = caixas(cartao());
    expect(nome).toContain('aria-checked="true"');
    expect(nascimento).toContain('aria-checked="true"');
    expect(cpf).toContain('aria-checked="false"');
    const tudo = caixas(
      cartao({ dados: { nomeCompleto: false, nascimento: false, cpf: true } }),
    );
    expect(tudo.map((tag) => tag.includes('aria-checked="true"'))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("cada caixa tem rótulo ligado e área de toque de 40px", () => {
    const html = cartao();
    for (const caixa of caixas(html)) {
      const id = caixa.match(/ id="([^"]+)"/)?.[1];
      expect(id, caixa).toBeDefined();
      expect(html).toContain(`for="${id}"`);
      // 17px visuais com o pseudo-elemento de 41px (components/ui/checkbox).
      expect(caixa).toContain("after:-inset-3");
    }
    // A linha da caixa tem 40px de altura minima.
    expect(html.match(/min-h-10 items-center gap-3/g) ?? []).toHaveLength(3);
  });

  it("nenhuma marcada: o aviso de que o assistente marca sem pedir esses dados", () => {
    expect(nenhumDadoExigido(NENHUM)).toBe(true);
    expect(nenhumDadoExigido(dadosExigidosPadrao())).toBe(false);
    expect(
      nenhumDadoExigido({ nomeCompleto: false, nascimento: false, cpf: true }),
    ).toBe(false);
    // "esses dados": a carteirinha continua pela regra do Cadastro.
    expect(texto(cartao({ dados: NENHUM }))).toContain(
      "Com nenhuma caixa marcada, o assistente marca a consulta sem pedir esses dados.",
    );
    expect(texto(cartao())).not.toContain("Com nenhuma caixa marcada");
  });

  it("quem configura salva: o Salvar habilitado, as caixas soltas", () => {
    const html = cartao();
    const salvar = aberturaDoBotao(html, "Salvar dados");
    expect(salvar).toContain('type="submit"');
    expect(salvar).not.toContain('disabled=""');
    expect(html).not.toMatch(/<fieldset disabled=""/);
  });

  it("recepção: as caixas e o Salvar visíveis e presos, com a dica", () => {
    const html = cartao({ podeEditar: false, dica: DICA_RECEPCAO });
    expect(caixas(html)).toHaveLength(3);
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(
      /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*type="submit"[^>]*disabled=""[^>]*>Salvar dados/,
    );
  });

  it("salvando: o botão diz que está salvando e fica ocupado", () => {
    const html = cartao({ salvando: true, pendente: true });
    const salvando = aberturaDoBotao(html, "Salvando...");
    expect(salvando).toContain('aria-busy="true"');
    expect(salvando).toContain('disabled=""');
  });
});

describe("Dados para marcar consulta: no painel", () => {
  function painel(dados = dadosDeTeste()): string {
    return renderToStaticMarkup(
      <TooltipProvider>
        <PainelDoAgente dados={dados} abaInicial="regras" />
      </TooltipProvider>,
    );
  }

  it("o cartão fica depois dos limites e antes dos gatilhos, com os dados do rascunho", () => {
    const html = painel(
      dadosDeTeste({
        config: configDeTeste({
          dadosExigidos: { nomeCompleto: false, nascimento: true, cpf: true },
        }),
      }),
    );
    const limites = html.indexOf('id="agente-agenda-titulo"');
    const dados = html.indexOf('id="agente-dados-titulo"');
    const gatilhos = html.indexOf('id="agente-gatilhos-titulo"');
    expect(limites).toBeGreaterThan(-1);
    expect(dados).toBeGreaterThan(limites);
    expect(gatilhos).toBeGreaterThan(dados);
    const doCartao = html.slice(dados, gatilhos);
    expect(
      caixas(doCartao).map((tag) => tag.includes('aria-checked="true"')),
    ).toEqual([false, true, true]);
    expect(texto(html)).toContain("Salvar dados");
  });

  it("recepção: o cartão trava como os outros da aba", () => {
    const html = painel(
      dadosDeTeste({ podeEditar: false, dicaSemPermissao: DICA_RECEPCAO }),
    );
    const dados = html.indexOf('id="agente-dados-titulo"');
    const gatilhos = html.indexOf('id="agente-gatilhos-titulo"');
    expect(html.slice(dados, gatilhos)).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Salvar dados/,
    );
  });

  it("salvar os dados não remonta os limites nem o horário (cada um com a sua chave)", () => {
    const antes = chavesDosFormularios(configDeTeste());
    const depois = chavesDosFormularios(
      configDeTeste({ dadosExigidos: { ...dadosExigidosPadrao(), cpf: true } }),
    );
    expect(depois.dados).not.toBe(antes.dados);
    expect(depois.agenda).toBe(antes.agenda);
    expect(depois.horario).toBe(antes.horario);
    expect(depois.persona).toBe(antes.persona);
  });

  it("o que foi marcado e não salvo conta como o dos limites: a aba aparece uma vez", () => {
    expect(comOsDadosParaMarcar(NADA_NAO_SALVO, false)).toBe(NADA_NAO_SALVO);
    const comDados = comOsDadosParaMarcar(NADA_NAO_SALVO, true);
    expect(comDados).toEqual({ ...NADA_NAO_SALVO, agenda: true });
    expect(formulariosNaoSalvos(comDados, false)).toEqual(["agenda"]);
    expect(abasNaoSalvas(formulariosNaoSalvos(comDados, false))).toEqual([
      "Regras e limites",
    ]);
    // Com os limites ja pendentes, nada muda.
    const comLimites = { ...NADA_NAO_SALVO, agenda: true, regras: true };
    expect(comOsDadosParaMarcar(comLimites, true)).toBe(comLimites);
    // Descartar remonta os dois pela geracao dos limites.
    expect(
      geracaoDepoisDeDescartar(
        GERACAO_INICIAL,
        formulariosNaoSalvos(comDados, false),
      ).agenda,
    ).toBe(1);
  });
});

describe("Dados para marcar consulta: cópia", () => {
  it("sem travessão e sem jargão", () => {
    const T = TEXTOS_DO_AGENTE;
    const amostras: [string, string][] = [
      ["dadosDescricao", T.dadosDescricao],
      ["dadosLegenda", T.dadosLegenda],
      ["dadosNoCadastro", T.dadosNoCadastro],
      ["dadosCarteirinha", T.dadosCarteirinha],
      ["dadosNenhum", T.dadosNenhum],
      ["salvarDados", T.salvarDados],
      ["dadosSalvos", T.dadosSalvos],
      ["restaurarDescricao", T.restaurarDescricao],
      ["cartao", texto(cartao())],
      ["recepcao", texto(cartao({ podeEditar: false, dica: DICA_RECEPCAO }))],
    ];
    for (const [chave, amostra] of amostras) {
      expect(amostra, chave).not.toMatch(/[—–]/);
      expect(amostra, chave).not.toMatch(
        /\b(prompt|token|LLM|skill|tenant|handoff|opt-in|exige_\w+)\b/i,
      );
    }
  });

  it("restaurar diz que os dados para marcar consulta voltam junto", () => {
    expect(TEXTOS_DO_AGENTE.restaurarDescricao).toContain(
      "os limites e os dados para marcar consulta",
    );
  });
});
