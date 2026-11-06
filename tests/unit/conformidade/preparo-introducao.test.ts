import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  filtrarSaida,
  sha256DoTexto,
  versaoDasRegras,
} from "@/lib/domain/conformidade/filtro";
import {
  avaliarRegras,
  FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ,
  situacaoPessoalNoPedidoDoPreparo,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  aprovarParaEnvio,
  comIntroducao,
  problemaDaIntroducao,
  problemasDoTextoDoPreparo,
  recusaPeloConselho,
  type PreparoAprovado,
} from "@/lib/domain/conformidade/preparo-aprovado";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import {
  comporTextoDoPreparo,
  LIMITE_DA_INTRODUCAO_DO_PREPARO,
  mensagemDoPreparo,
} from "@/lib/domain/preparo";

import { RT_DE_TESTE } from "../../fixtures/ia/conformidade/casos";

// A introducao da IA antes do bloco exato e os remedios do preparo (decisao do
// dono de 06/11/2026, opcao A), na bateria de conformidade (roda no prebuild).
// A regra do CLAUDE.md 3.2 nao muda: a IA nunca escreve, resume nem parafraseia
// remedio, dose ou como tomar. Nenhum teste fala com a OpenAI.

const RAIZ = path.resolve(__dirname, "../../..");
const MIGRATION = readFileSync(
  path.join(RAIZ, "supabase/migrations/20261106120000_remedios_do_preparo.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  path.join(
    RAIZ,
    "supabase/operacao/rollback/20261106120000-corpos-anteriores.sql",
  ),
  "utf8",
);
const ANTERIOR = readFileSync(
  path.join(
    RAIZ,
    "supabase/migrations/20261103100000_preparo_aprovado_pelo_rt.sql",
  ),
  "utf8",
);

const BISACODIL = {
  nome: "Bisacodil 5 mg",
  comoTomar: "tomar 2 comprimidos às 20h da véspera do exame.",
  descricao: "Laxante usado para limpar o intestino.",
};
const TEXTO = comporTextoDoPreparo("Jejum de 8 horas.", [BISACODIL]);
const BLOCO = mensagemDoPreparo({
  procedimento: "Colonoscopia",
  rt: RT_DE_TESTE,
  texto: TEXTO,
});
const DO_DONO =
  "Claro! Como sua colonoscopia é na terça de manhã, segue a orientação da clínica:";

function lida(mensagem = BLOCO) {
  return {
    versao_id: "e7e70000-0000-4000-8000-000000000001",
    procedure_id: "11111111-1111-4111-8111-111111111111",
    versao: 3,
    mensagem,
    sha256: sha256DoTexto(mensagem),
  };
}

function aprovado(mensagem = BLOCO): PreparoAprovado {
  const preparo = aprovarParaEnvio(lida(mensagem));
  if (preparo === null) {
    throw new Error("a leitura de teste nao passou");
  }
  return preparo;
}

// O mesmo corpus do ensaio da migration (banco/m/asserts.sql, passo 2): o banco
// e o TS leem igual.
const PASSA = [
  DO_DONO,
  "Claro! Segue a orientação da clínica:",
  "Perfeito, aqui está o que a clínica orienta:",
  "Oi!",
  "a".repeat(160),
];
const BARRA: readonly (readonly [string, string])[] = [
  ["vazia", ""],
  ["branco na frente", " Claro!"],
  ["branco no fim", "Claro! "],
  ["duas linhas", "Claro!\nSegue:"],
  ["paragrafo", "Claro!\n\nSegue:"],
  ["longa", "a".repeat(161)],
  ["numero", "Tomar 2 de manhã"],
  ["numero solto", "São 5 dias"],
  ["numero em indice", "Segue ² aqui"],
  ["numero por extenso e unidade", "Vinte gotas"],
  ["numero por extenso", "Dois de manhã"],
  ["meia dose", "meia dose"],
  ["comprimido", "Um comprimido só"],
  ["mg", "Segue em mg"],
  ["ml", "Segue o ml"],
  ["capsula com acento", "duas cápsulas"],
  ["sache com acento", "um sachê"],
  ["colher", "uma colher"],
  ["litro", "um litro de água"],
  ["hora", "uma hora antes"],
  ["minuto", "cinco minutos"],
  ["tome", "Tome com água:"],
  ["tomar", "Pode tomar assim:"],
  ["beba", "Beba bastante:"],
  ["coma", "Coma pouco:"],
  ["jejum", "Fique em jejum:"],
  ["dieta", "Faça a dieta:"],
  ["evite", "Evite leite:"],
  ["a palavra remedio", "O remédio é este:"],
  ["a palavra medicamento", "O medicamento é este:"],
  ["laxante", "O laxante é este:"],
  ["bisacodil", "Segue o Bisacodil:"],
  ["em caixa alta", "BISACODIL hoje"],
  ["marca", "Dulcolax hoje"],
  ["manitol", "O manitol hoje"],
  ["picoprep", "O picoprep hoje"],
  ["lactulose", "A lactulose hoje"],
  ["sene", "O sene hoje"],
  ["oleo com acento", "Óleo mineral hoje"],
  ["com os espacos repetidos", "Lacto  Purga hoje"],
  ["colica", "Se tiver cólica, segue:"],
  ["dor", "Se sentir dor:"],
  ["febre", "Com febre:"],
  ["enjoo", "Com enjoo:"],
  ["doer", "Se doer:"],
  ["sangramento", "Sangramento:"],
  ["efeito colateral", "Efeito colateral:"],
  ["link", "Veja em https://exemplo.com:"],
  ["valor", "Custa R$ 50:"],
  ["arroba", "Siga @clinica:"],
  ["passa sozinho", "Sozinha, passa naturalmente"],
  ["invisivel", "Claro​!"],
  ["isolamento de direcao", "Claro⁦!"],
  ["chaves", "Olá {{nome}}"],
];

describe("a regra propria da introducao (so bloqueia)", () => {
  it.each(PASSA)("passa: %s", (texto) => {
    expect(problemaDaIntroducao(texto, [TEXTO])).toBeNull();
  });

  it.each(BARRA)("barra (%s)", (_n, texto) => {
    expect(problemaDaIntroducao(texto, [TEXTO])).not.toBeNull();
  });

  it("so pontuacao nao e introducao (a marca do nome tirada)", () => {
    expect(problemaDaIntroducao("!", [TEXTO])).toBe("formato");
  });

  it("o limite e o do banco", () => {
    expect(LIMITE_DA_INTRODUCAO_DO_PREPARO).toBe(160);
    expect(MIGRATION).toContain("char_length(p_texto) <= 160");
  });

  it("o nome de remedio do texto aprovado, mesmo fora da lista: do bloco e colado numa dose", () => {
    const comNome = comporTextoDoPreparo("", [
      { ...BISACODIL, nome: "Xyzina 5 mg" },
    ]);
    expect(problemaDaIntroducao("Segue a xyzina:", [comNome])).toBe(
      "remedio_do_texto",
    );
    expect(problemaDaIntroducao("Segue a Xyzína:", [comNome])).toBe(
      "remedio_do_texto",
    );
    expect(problemaDaIntroducao("Segue a xyzina:", [])).toBeNull();
    expect(
      problemaDaIntroducao("Segue a fortex:", ["Tome Fortex 10 mg de manhã."]),
    ).toBe("remedio_do_texto");
  });

  it("a fonte do banco e a do TS sao a mesma, byte a byte, com os remedios do preparo", () => {
    expect(MIGRATION).toContain(`!~ '${FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ}'`);
    expect(FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ).toContain("bisacodil");
    expect(FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ).not.toContain("\\b");
    expect(FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ).not.toContain("'");
  });

  it("a regra entra na versao das regras", () => {
    expect(versaoDasRegras()).toMatch(/^regras-[0-9a-f]{12}$/);
  });
});

describe("o filtro inteiro na introducao", () => {
  const CONTEXTO = {
    precosDoTurno: [],
    nomesDoCatalogo: ["Colonoscopia"],
    mensagensDoPaciente: ["Me manda o preparo da colonoscopia"],
    textosDePreparo: [TEXTO],
    comPreparo: true,
  };
  const veredicto = (aprovadoPeloModelo: boolean): ResultadoDoVerificador => ({
    tipo: "veredicto",
    veredicto: aprovadoPeloModelo
      ? { aprovado: true, violacoes: [], confianca: "alta" }
      : {
          aprovado: false,
          violacoes: [{ categoria: "medicamento", gravidade: "alta" }],
          confianca: "alta",
        },
    modelo: "gpt-6-luna",
    uso: {
      tokensEntrada: 1,
      tokensSaida: 1,
      tokensCacheLidos: 0,
      tokensCacheGravados: 0,
    },
  });
  const regras = (rascunho: string, introducaoDoPreparo: boolean) =>
    avaliarRegras(rascunho, { ...CONTEXTO, introducaoDoPreparo }).achados.map(
      (a) => a.regra,
    );

  it("o exemplo do dono passa nas regras, e so como introducao: a resposta comum continua barrada", () => {
    expect(regras(DO_DONO, true)).toEqual([]);
    expect(regras("Claro! Segue a orientação da clínica:", true)).toEqual([]);
    expect(regras(DO_DONO, false)).toContain("resposta_ao_preparo");
    expect(regras("Claro! Segue a orientação da clínica:", false)).toContain(
      "resposta_ao_preparo",
    );
  }, 60_000);

  it.each([
    ["responde sim", "Precisa sim, segue a orientação da clínica:"],
    ["responde nao", "Não precisa, segue a orientação da clínica:"],
    ["qualifica", "É bem simples, segue a orientação da clínica:"],
    ["fala do assunto", "É só jejum, segue a orientação da clínica:"],
    ["copia o aprovado", "Jejum de 8 horas."],
    ["anuncia o preparo", "Segue a orientação de preparo da colonoscopia:"],
    ["cita o remedio", "Segue o bisacodil:"],
    ["promete", "Fique tranquila, o exame é seguro e garantido:"],
  ])("a regra barra mesmo como introducao (%s)", (_n, rascunho) => {
    expect(regras(rascunho, true)).not.toEqual([]);
  });

  it("aprovar exige as duas camadas; verificador que reprova, cai ou nao responde bloqueia", async () => {
    const com = (verificador: Verificador) =>
      filtrarSaida({
        rascunho: DO_DONO,
        contexto: { ...CONTEXTO, introducaoDoPreparo: true },
        verificador,
      });
    const passou = await com(async () => veredicto(true));
    expect(passou.aprovado).toBe(true);
    if (passou.aprovado) {
      expect(passou.texto).toBe(DO_DONO);
    }
    expect(await com(async () => veredicto(false))).toMatchObject({
      aprovado: false,
      categoria: "medicamento",
      camada: "modelo",
    });
    expect(
      (
        await com(async () => {
          throw new Error("fora do ar");
        })
      ).aprovado,
    ).toBe(false);
    expect(
      (
        await filtrarSaida({
          rascunho: DO_DONO,
          contexto: { ...CONTEXTO, introducaoDoPreparo: true },
          verificador: () => new Promise(() => undefined),
          prazoDoVerificadorMs: 5,
        })
      ).aprovado,
    ).toBe(false);
  });

  it("o contexto fora do formato falha fechado", async () => {
    const verificador = vi.fn<Verificador>(async () => veredicto(true));
    const decisao = await filtrarSaida({
      rascunho: DO_DONO,
      contexto: {
        ...CONTEXTO,
        introducaoDoPreparo: "sim",
      } as unknown as typeof CONTEXTO,
      verificador,
    });
    expect(decisao.aprovado).toBe(false);
    expect(verificador).not.toHaveBeenCalled();
  });
});

describe("o preparo com a introducao", () => {
  it("a introducao, uma linha em branco e o bloco, palavra por palavra; o hash e o do corpo", () => {
    const preparo = aprovado();
    const com = comIntroducao(preparo, DO_DONO);
    expect(com?.mensagem).toBe(`${DO_DONO}\n\n${BLOCO}`);
    expect(com?.sha256).toBe(sha256DoTexto(`${DO_DONO}\n\n${BLOCO}`));
    expect(com?.versaoId).toBe(preparo.versaoId);
    expect(com?.procedureId).toBe(preparo.procedureId);
    expect(com?.versao).toBe(preparo.versao);
    expect(Object.isFrozen(com)).toBe(true);
    // O original nao muda.
    expect(preparo.mensagem).toBe(BLOCO);
  });

  it.each([
    ["com o remedio do texto", "Segue o bisacodil:"],
    ["com a dose", "Segue a dose de 5 mg:"],
    ["com o sintoma", "Se tiver cólica, segue:"],
    ["em duas linhas", "Claro!\nSegue:"],
  ])("barrada %s: nao monta (sai so o bloco)", (_n, introducao) => {
    expect(comIntroducao(aprovado(), introducao)).toBeNull();
  });

  it("uma letra trocada no bloco nao passa: nem o preparo com o hash certo do bloco trocado", () => {
    const trocado = BLOCO.replace("Bisacodil 5 mg", "Bisacodil 6 mg");
    expect(aprovarParaEnvio({ ...lida(), mensagem: trocado })).toBeNull();
    expect(
      comIntroducao(
        { ...aprovado(), mensagem: trocado } as PreparoAprovado,
        DO_DONO,
      ),
    ).toBeNull();
  });

  it("nao empilha: o bloco que ja tem introducao nao recebe outra", () => {
    const com = comIntroducao(aprovado(), DO_DONO);
    expect(com).not.toBeNull();
    expect(comIntroducao(com as PreparoAprovado, "Oi!")).toBeNull();
  });

  it("o maior bloco do banco ainda cabe com a maior introducao; a mensagem que passaria de 4.096 fica sem ela", () => {
    // 3.500 no texto, 120 em cada nome, 20 no numero, o conselho mais longo.
    const bloco = (tamanho: number) =>
      mensagemDoPreparo({
        procedimento: "P".repeat(120),
        rt: {
          nome: "N".repeat(120),
          conselho: "CREFITO",
          uf: "CE",
          numero: "1".repeat(20),
        },
        texto: "a".repeat(tamanho),
      });
    const introducao = "a".repeat(160);
    expect(comIntroducao(aprovado(bloco(3500)), introducao)).not.toBeNull();
    // Fora do que o banco deixa, mas dentro do teto do envio: sem a introducao.
    const grande = bloco(3500 + 4090 - Array.from(bloco(3500)).length);
    expect(Array.from(grande)).toHaveLength(4090);
    expect(aprovado(grande).mensagem).toBe(grande);
    expect(comIntroducao(aprovado(grande), introducao)).toBeNull();
  }, 60_000);
});

describe("os remedios passam pelas mesmas barreiras do texto", () => {
  it("o exemplo do dono: nao recusa, avisa remedio e dose ao RT", () => {
    const { recusas, avisos } = problemasDoTextoDoPreparo(TEXTO);
    expect(recusas).toEqual([]);
    expect(avisos).toEqual(expect.arrayContaining(["medicamento", "dosagem"]));
  });

  it("remedio so de CRM ou CRO, inclusive o nome que a lista nao conhece: o cabecalho do bloco acusa", () => {
    const desconhecido = comporTextoDoPreparo("", [
      { nome: "Xyzina", comoTomar: "conforme a clínica.", descricao: "" },
    ]);
    for (const texto of [TEXTO, desconhecido]) {
      expect(recusaPeloConselho(texto, "CRM")).toEqual([]);
      expect(recusaPeloConselho(texto, "CRO")).toEqual([]);
      expect(recusaPeloConselho(texto, "CRN")).toContain("medicamento");
      expect(recusaPeloConselho(texto, null)).toContain("medicamento");
    }
  });

  it.each([
    [
      "a promessa na descricao",
      { ...BISACODIL, descricao: "Resultado garantido." },
      "promessa_resultado",
    ],
    [
      "o sintoma normalizado na descricao",
      { ...BISACODIL, descricao: "Cólica leve é normal e passa sozinha." },
      "triagem",
    ],
    [
      "o link em como tomar",
      { ...BISACODIL, comoTomar: "veja em https://exemplo.com" },
      "formato_invalido",
    ],
    [
      "a oferta no nome",
      { ...BISACODIL, descricao: "Aproveite e faça também a limpeza de pele." },
      "oferta_casada",
    ],
  ])("recusa %s", (_n, remedio, categoria) => {
    expect(
      problemasDoTextoDoPreparo(comporTextoDoPreparo("", [remedio])).recusas,
    ).toContain(categoria);
  });
});

describe("a pergunta que o texto nao responde vai para a equipe", () => {
  const gatilhos = (texto: string) =>
    detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });

  it.each([
    "posso tomar com leite?",
    "e se eu vomitar depois de tomar?",
    "esqueci de tomar o remédio do exame",
    "tomei o remedio e to com colica, é normal?",
    "posso tomar dois de uma vez?",
  ])("%s: o portao escala e a conferencia do envio tambem", (texto) => {
    expect(gatilhos(texto)).not.toEqual([]);
    expect(situacaoPessoalNoPedidoDoPreparo([texto], [])).toBe(true);
  });

  it("HOJE o pedido do exemplo do dono tambem para no portao (frente agente-portao-exame): a equipe responde, nada de remedio sai pela IA", () => {
    expect(gatilhos("e o remédio do exame, como eu tomo?")).toContain(
      "assunto_clinico",
    );
    // O pedido de sempre chega ao modelo.
    expect(gatilhos("Me manda o preparo da colonoscopia")).toEqual([]);
  });
});

describe("a migration e o rollback", () => {
  const corpoDe = (fonte: string) => {
    const ini = fonte.indexOf(
      "create or replace function public.mensagem_ia_exige_aprovacao()",
    );
    return fonte.slice(ini, fonte.indexOf("$function$;", ini));
  };

  it("o rollback devolve o corpo de antes, byte a byte", () => {
    expect(corpoDe(ROLLBACK)).toBe(corpoDe(ANTERIOR));
    expect(corpoDe(ANTERIOR)).not.toBe("");
  });

  it("a migration so acrescenta ao corpo de antes: fora do passo 8, nada muda", () => {
    const novo = corpoDe(MIGRATION)
      .replace("  -- [remedios do preparo]\n  v_bloco text;\n", "")
      .replace(
        /  -- \[remedios do preparo\] inicio[\s\S]*?  -- \[remedios do preparo\] fim\n/,
        "  if not public.preparo_em_vigor(new.clinic_id, v_versao)\n     or new.body is distinct from public.mensagem_do_preparo(v_versao)\n  then\n    raise exception using errcode = 'CZIA3', message = 'frase_divergente';\n  end if;\n",
      );
    expect(novo).toBe(corpoDe(ANTERIOR));
  });

  it("o gatilho confere o bloco inteiro e a introducao; a funcao nova nao abre para a API", () => {
    expect(corpoDe(MIGRATION)).toContain(
      "right(new.body, char_length(v_bloco) + 2) <> E'\\n\\n' || v_bloco",
    );
    expect(corpoDe(MIGRATION)).toContain("public.preparo_introducao_valida(");
    expect(MIGRATION).toContain(
      "revoke all on function public.preparo_introducao_valida(text)\n  from public, anon, authenticated, service_role;",
    );
    expect(MIGRATION).not.toMatch(
      /grant execute[^;]*preparo_introducao_valida/,
    );
  });

  it("nao mexe no que outras frentes estao mudando", () => {
    expect(MIGRATION).not.toMatch(
      /create (or replace )?function public\.(preparo_em_vigor|ia_pode_falar_com)/,
    );
  });
});
