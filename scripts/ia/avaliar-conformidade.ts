// Rodada PAGA da bateria de conformidade contra o Claude Haiku 4.5 real
// (plano da Fase 3, E1: "rodada paga, 3 repeticoes, zero vazamento,
// resultado assinado pelo dono em docs/avaliacoes/ia/").
//
// So roda com o ok do dono. Gasta dinheiro de verdade, com teto duro:
//
//   ANTHROPIC_API_KEY_AVALIACAO=sk-ant-... npx tsx scripts/ia/avaliar-conformidade.ts \
//     --orcamento-usd 2 --preco-entrada-usd-mtok 1 --preco-saida-usd-mtok 5
//
// - A chave vem SO do ambiente da linha de comando, de um workspace de
//   avaliacao com limite de gasto (nunca a de producao, nunca no .env.local).
// - Os precos vem por parametro, conferidos na tabela oficial da Anthropic no
//   dia (preco nao mora no codigo). Com eles, o script estima o pior caso de
//   cada chamada ANTES de fazer, e para quando a proxima estouraria o
//   orcamento.
// - Dados 100% sinteticos (tests/fixtures/ia/conformidade/casos.ts).
// - O relatorio tem so ids, hash do texto, categorias e veredictos. Nenhum
//   texto de caso, nenhuma resposta do modelo.
//
// O que mede, em cada repeticao:
//  - saida: o verificador sozinho (o modelo pega o caso?) e o pipeline
//    inteiro (regras + modelo). Vazamento = caso que tinha de bloquear e foi
//    aprovado pelo pipeline. Aceite: zero.
//  - controles de saida: falso positivo do pipeline.
//  - entrada: portao deterministico + classificador real; o caso tem de
//    escalar. Controles de entrada: falso positivo.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { avaliarRegras } from "../../lib/domain/conformidade/filtro-deterministico";
import {
  filtrarSaida,
  versaoDasRegras,
} from "../../lib/domain/conformidade/filtro";
import { detectarGatilhosDeEntrada } from "../../lib/domain/conformidade/gatilhos-de-entrada";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "../../lib/domain/conformidade/veredicto";
import { criarClienteAnthropic } from "../../lib/integrations/llm/anthropic";
import {
  criarClassificadorDeEntrada,
  decidirPeloClassificador,
  MAX_TOKENS_DO_CLASSIFICADOR,
  POLITICA_DO_CLASSIFICADOR,
} from "../../lib/integrations/llm/classificador-de-entrada";
import {
  criarVerificador,
  MAX_TOKENS_DO_VERIFICADOR,
  modeloDoVerificador,
  POLITICA_DO_VERIFICADOR,
  VERSAO_DA_POLITICA,
  type ClienteDoVerificador,
} from "../../lib/integrations/llm/verificador";
import {
  CASOS_DE_ENTRADA,
  CASOS_DE_SAIDA,
  CONTROLES_DE_ENTRADA,
  CONTROLES_DE_SAIDA,
  contextoDo,
} from "../../tests/fixtures/ia/conformidade/casos";

const TETO_DO_ORCAMENTO_USD = 20;
/** Caracteres do envelope com nonce e marcadores, por chamada. */
const ENVELOPE_EM_CARACTERES = 400;

// ---------------------------------------------------------------------------
// Parametros e travas
// ---------------------------------------------------------------------------

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function numeroPositivo(
  nome: string,
  obrigatorio: boolean,
): number | undefined {
  const bruto = argumento(nome);
  if (bruto === undefined) {
    if (obrigatorio) {
      throw new Error(`Faltou ${nome}.`);
    }
    return undefined;
  }
  const valor = Number(bruto.replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`${nome} precisa ser um numero maior que zero.`);
  }
  return valor;
}

function lerParametros() {
  const orcamentoUsd = numeroPositivo("--orcamento-usd", true) ?? 0;
  if (orcamentoUsd > TETO_DO_ORCAMENTO_USD) {
    throw new Error(
      `--orcamento-usd acima de US$ ${TETO_DO_ORCAMENTO_USD}: confira o valor (a estimativa da bateria e de uns US$ 2).`,
    );
  }
  const precoEntrada = numeroPositivo("--preco-entrada-usd-mtok", true) ?? 0;
  const precoSaida = numeroPositivo("--preco-saida-usd-mtok", true) ?? 0;
  const repeticoes = Math.round(numeroPositivo("--repeticoes", false) ?? 3);
  if (repeticoes < 1 || repeticoes > 5) {
    throw new Error("--repeticoes vai de 1 a 5.");
  }
  const pasta = argumento("--saida") ?? join("docs", "avaliacoes", "ia");

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Rodada de avaliacao nao roda em producao.");
  }
  const chave = process.env.ANTHROPIC_API_KEY_AVALIACAO?.trim();
  if (!chave) {
    throw new Error(
      "Defina ANTHROPIC_API_KEY_AVALIACAO na linha de comando (chave do workspace de avaliacao).",
    );
  }
  if (chave === process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error(
      "A chave de avaliacao e igual a ANTHROPIC_API_KEY: use a chave do workspace de avaliacao.",
    );
  }
  const modelo = modeloDoVerificador(process.env);
  if (modelo === null) {
    throw new Error("IA_MODELO_VERIFICADOR fora da lista fechada.");
  }
  return {
    orcamentoUsd,
    precoEntrada,
    precoSaida,
    repeticoes,
    pasta,
    chave,
    modelo,
  };
}

// ---------------------------------------------------------------------------
// Orcamento: estima o pior caso antes de cada chamada
// ---------------------------------------------------------------------------

class OrcamentoEsgotado extends Error {}

type Uso = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

function criarControleDeGasto(opcoes: {
  orcamentoUsd: number;
  precoEntrada: number;
  precoSaida: number;
}) {
  let gastoUsd = 0;
  let maiorEntrada = 0;
  let chamadas = 0;
  let esgotado = false;

  const custo = (entrada: number, saida: number) =>
    (entrada * opcoes.precoEntrada + saida * opcoes.precoSaida) / 1_000_000;

  return {
    /** Lanca OrcamentoEsgotado se a proxima chamada pode estourar. */
    reservar(caracteresDeEntrada: number, maxTokens: number) {
      // Sem medida ainda: um token a cada 2 caracteres (bem pessimista).
      const entradaEstimada = Math.max(
        Math.ceil(caracteresDeEntrada / 2),
        Math.ceil(maiorEntrada * 1.3),
      );
      if (gastoUsd + custo(entradaEstimada, maxTokens) > opcoes.orcamentoUsd) {
        esgotado = true;
        throw new OrcamentoEsgotado();
      }
    },
    registrar(uso: Uso) {
      chamadas += 1;
      // Cache lido ou gravado cobrado como entrada cheia (pessimista).
      const entrada =
        uso.input_tokens +
        (uso.cache_read_input_tokens ?? 0) +
        (uso.cache_creation_input_tokens ?? 0) * 1.25;
      maiorEntrada = Math.max(maiorEntrada, entrada);
      gastoUsd += custo(entrada, uso.output_tokens);
    },
    get gastoUsd() {
      return gastoUsd;
    },
    get chamadas() {
      return chamadas;
    },
    get esgotado() {
      return esgotado;
    },
  };
}

type ControleDeGasto = ReturnType<typeof criarControleDeGasto>;

/** O cliente real embrulhado: confere o orcamento antes e soma o uso depois. */
function clienteComOrcamento(
  real: ClienteDoVerificador,
  gasto: ControleDeGasto,
  maxTokens: number,
  sistema: string,
): ClienteDoVerificador {
  const parse = async (
    params: { messages: Array<{ content: unknown }> },
    opcoes: unknown,
  ) => {
    const conteudo = JSON.stringify(params.messages);
    gasto.reservar(sistema.length + conteudo.length, maxTokens);
    const resposta = await (
      real.messages.parse as unknown as (
        p: unknown,
        o: unknown,
      ) => Promise<{ usage: Uso }>
    )(params, opcoes);
    gasto.registrar(resposta.usage);
    return resposta;
  };
  return { messages: { parse } } as unknown as ClienteDoVerificador;
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

type VeredictoDoModelo = "reprovou" | "aprovou" | `falha:${string}`;

function resumoDoModelo(resultado: ResultadoDoVerificador): VeredictoDoModelo {
  if (resultado.tipo === "falha") {
    return `falha:${resultado.motivo}`;
  }
  return resultado.veredicto.aprovado &&
    resultado.veredicto.violacoes.length === 0
    ? "aprovou"
    : "reprovou";
}

function hashDoCaso(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 12);
}

type LinhaDeSaida = {
  id: string;
  hash: string;
  tipo: "bloquear" | "controle";
  esperado: string;
  regra: string;
  modelo: VeredictoDoModelo[];
  pipelineAprovou: boolean[];
};

type LinhaDeEntrada = {
  id: string;
  hash: string;
  tipo: "escalar" | "controle";
  esperado: string;
  portao: string;
  classificador: string[];
  escalou: boolean[];
};

async function main(): Promise<number> {
  const p = lerParametros();
  const gasto = criarControleDeGasto(p);
  const cliente = criarClienteAnthropic({ apiKey: p.chave });

  const verificador = criarVerificador({
    cliente: clienteComOrcamento(
      cliente,
      gasto,
      MAX_TOKENS_DO_VERIFICADOR,
      POLITICA_DO_VERIFICADOR,
    ),
    modelo: p.modelo,
  });
  const classificar = criarClassificadorDeEntrada({
    cliente: clienteComOrcamento(
      cliente,
      gasto,
      MAX_TOKENS_DO_CLASSIFICADOR,
      POLITICA_DO_CLASSIFICADOR,
    ),
    modelo: p.modelo,
  });

  const saidas: LinhaDeSaida[] = [
    ...CASOS_DE_SAIDA.map((caso) => ({
      caso,
      tipo: "bloquear" as const,
      esperado: caso.categoria + (caso.soModelo ? " (so modelo)" : ""),
    })),
    ...CONTROLES_DE_SAIDA.map((caso) => ({
      caso,
      tipo: "controle" as const,
      esperado: "aprovar",
    })),
  ].map(({ caso, tipo, esperado }) => ({
    id: caso.id,
    hash: hashDoCaso(caso.rascunho),
    tipo,
    esperado,
    regra:
      avaliarRegras(caso.rascunho, contextoDo(caso)).categorias.join("+") ||
      "limpo",
    modelo: [],
    pipelineAprovou: [],
  }));

  const entradas: LinhaDeEntrada[] = [
    ...CASOS_DE_ENTRADA.map((caso) => ({
      caso,
      tipo: "escalar" as const,
      esperado: caso.gatilho,
    })),
    ...CONTROLES_DE_ENTRADA.map((caso) => ({
      caso,
      tipo: "controle" as const,
      esperado: "seguir",
    })),
  ].map(({ caso, tipo, esperado }) => ({
    id: caso.id,
    hash: hashDoCaso(JSON.stringify(caso.mensagens)),
    tipo,
    esperado,
    portao:
      detectarGatilhosDeEntrada({
        mensagens: caso.mensagens,
        dataDeNascimento:
          "dataDeNascimento" in caso ? caso.dataDeNascimento : undefined,
        hojeNaClinica: "hojeNaClinica" in caso ? caso.hojeNaClinica : undefined,
      }).join("+") || "limpo",
    classificador: [],
    escalou: [],
  }));

  const todosOsCasosDeSaida = [...CASOS_DE_SAIDA, ...CONTROLES_DE_SAIDA];
  const todosOsCasosDeEntrada = [...CASOS_DE_ENTRADA, ...CONTROLES_DE_ENTRADA];
  let interrompido = false;

  try {
    for (let r = 0; r < p.repeticoes; r += 1) {
      for (const [i, caso] of todosOsCasosDeSaida.entries()) {
        const linha = saidas[i];
        if (!linha) {
          continue;
        }
        const contexto = contextoDo(caso);
        // Confere o orcamento AQUI, fora do verificador: dentro dele a parada
        // viraria uma "falha" comum e a rodada seguiria anotando lixo.
        gasto.reservar(
          POLITICA_DO_VERIFICADOR.length +
            caso.rascunho.length +
            contexto.mensagensDoPaciente.join(" ").length +
            ENVELOPE_EM_CARACTERES,
          MAX_TOKENS_DO_VERIFICADOR,
        );
        const resultado = await verificador({
          rascunho: caso.rascunho,
          mensagensDoPaciente: contexto.mensagensDoPaciente,
          sinal: new AbortController().signal,
        });
        linha.modelo.push(resumoDoModelo(resultado));
        // O pipeline reusa o MESMO veredicto (sem segunda chamada paga).
        const repetir: Verificador = async () => resultado;
        const decisao = await filtrarSaida({
          rascunho: caso.rascunho,
          contexto,
          verificador: repetir,
        });
        linha.pipelineAprovou.push(decisao.aprovado);
      }
      for (const [i, caso] of todosOsCasosDeEntrada.entries()) {
        const linha = entradas[i];
        if (!linha) {
          continue;
        }
        const textos = caso.mensagens
          .filter((m) => m.tipo === "texto")
          .map((m) => m.texto ?? "");
        gasto.reservar(
          POLITICA_DO_CLASSIFICADOR.length +
            textos.join(" ").length +
            ENVELOPE_EM_CARACTERES,
          MAX_TOKENS_DO_CLASSIFICADOR,
        );
        const resultado = await classificar({ mensagens: textos });
        const decisao = decidirPeloClassificador(resultado);
        linha.classificador.push(
          decisao.escalar
            ? `escalar:${decisao.gatilho ?? decisao.motivo}`
            : "seguir",
        );
        linha.escalou.push(linha.portao !== "limpo" || decisao.escalar);
      }
      console.log(`Repeticao ${r + 1} de ${p.repeticoes} concluida.`);
    }
  } catch (erro) {
    if (!(erro instanceof OrcamentoEsgotado)) {
      throw erro;
    }
    interrompido = true;
    console.log("Parou no orcamento: a proxima chamada podia estourar o teto.");
  }
  // A trava do cliente embrulhado tambem pode ter parado uma chamada (e o
  // verificador anotou como falha): o controle de gasto e quem sabe.
  interrompido = interrompido || gasto.esgotado;

  // ---- totais -------------------------------------------------------------
  const vazamentos = saidas.filter(
    (l) => l.tipo === "bloquear" && l.pipelineAprovou.some(Boolean),
  );
  const modeloPegou = saidas.filter(
    (l) =>
      l.tipo === "bloquear" &&
      l.modelo.length > 0 &&
      l.modelo.every((m) => m === "reprovou"),
  );
  const falsoPositivoSaida = saidas.filter(
    (l) => l.tipo === "controle" && l.pipelineAprovou.some((a) => !a),
  );
  const entradaQueNaoEscalou = entradas.filter(
    (l) => l.tipo === "escalar" && l.escalou.some((e) => !e),
  );
  const falsoPositivoEntrada = entradas.filter(
    (l) => l.tipo === "controle" && l.escalou.some(Boolean),
  );

  const hoje = new Date().toISOString().slice(0, 10);
  const linhas: string[] = [
    `# Rodada paga da bateria de conformidade (${hoje})`,
    "",
    `- Modelo: ${p.modelo}`,
    `- Politica do verificador: ${VERSAO_DA_POLITICA}`,
    `- Regras: ${versaoDasRegras()}`,
    `- Repeticoes: ${p.repeticoes}`,
    `- Chamadas: ${gasto.chamadas}; gasto estimado: US$ ${gasto.gastoUsd.toFixed(4)} (orcamento US$ ${p.orcamentoUsd})`,
    `- Interrompida antes do fim: ${interrompido ? "sim" : "nao"}`,
    "",
    "## Resultado",
    "",
    `- Vazamentos (tinha de bloquear e o pipeline aprovou): **${vazamentos.length}** ${vazamentos.map((l) => l.id).join(", ")}`,
    `- O modelo sozinho reprovou em todas as repeticoes: ${modeloPegou.length} de ${saidas.filter((l) => l.tipo === "bloquear").length}`,
    `- Falso positivo nos controles de saida: ${falsoPositivoSaida.length} de ${saidas.filter((l) => l.tipo === "controle").length} ${falsoPositivoSaida.map((l) => l.id).join(", ")}`,
    `- Entrada que deixou de escalar: **${entradaQueNaoEscalou.length}** ${entradaQueNaoEscalou.map((l) => l.id).join(", ")}`,
    `- Falso positivo nos controles de entrada: ${falsoPositivoEntrada.length} de ${entradas.filter((l) => l.tipo === "controle").length} ${falsoPositivoEntrada.map((l) => l.id).join(", ")}`,
    "",
    "## Saida (rascunhos da IA)",
    "",
    "| id | hash | esperado | regra | modelo por repeticao | pipeline aprovou |",
    "|---|---|---|---|---|---|",
    ...saidas.map(
      (l) =>
        `| ${l.id} | ${l.hash} | ${l.esperado} | ${l.regra} | ${l.modelo.join(", ")} | ${l.pipelineAprovou.map((a) => (a ? "sim" : "nao")).join(", ")} |`,
    ),
    "",
    "## Entrada (mensagens do paciente)",
    "",
    "| id | hash | esperado | portao | classificador por repeticao | escalou |",
    "|---|---|---|---|---|---|",
    ...entradas.map(
      (l) =>
        `| ${l.id} | ${l.hash} | ${l.esperado} | ${l.portao} | ${l.classificador.join(", ")} | ${l.escalou.map((e) => (e ? "sim" : "nao")).join(", ")} |`,
    ),
    "",
    "## Revisao do dono",
    "",
    "- Revisado por:",
    "- Data:",
    "- Decisao (aceita ou nao a fase E1):",
    "",
  ];

  mkdirSync(p.pasta, { recursive: true });
  const arquivo = join(
    p.pasta,
    `conformidade-${hoje}-${VERSAO_DA_POLITICA}.md`,
  );
  writeFileSync(arquivo, linhas.join("\n"), "utf-8");

  console.log(`Relatorio: ${arquivo}`);
  console.log(
    `Vazamentos: ${vazamentos.length}. Entrada sem escalar: ${entradaQueNaoEscalou.length}. Gasto estimado: US$ ${gasto.gastoUsd.toFixed(4)}.`,
  );
  return vazamentos.length === 0 &&
    entradaQueNaoEscalou.length === 0 &&
    !interrompido
    ? 0
    : 1;
}

main().then(
  (codigo) => process.exit(codigo),
  (erro: unknown) => {
    // Nunca imprimir error.message do SDK (pode ecoar conteudo).
    const nome = erro instanceof Error ? erro.constructor.name : "erro";
    const motivo =
      erro instanceof Error && erro.constructor === Error ? erro.message : nome;
    console.error(`Rodada interrompida: ${motivo}`);
    process.exit(2);
  },
);
