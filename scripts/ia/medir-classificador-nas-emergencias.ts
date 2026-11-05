// Medicao PAGA do classificador nas emergencias das revisoes (D-52): das
// frases que o portao deterministico deixa passar, quantas o classificador
// real escala? So roda com o ok do dono, com teto duro:
//
//   OPENAI_API_KEY_AVALIACAO=sk-... npx tsx scripts/ia/medir-classificador-nas-emergencias.ts \
//     --orcamento-usd 2 --preco-entrada-usd-mtok 0.1 --preco-saida-usd-mtok 0.5
//
// Sem --orcamento-usd so conta as frases e o portao, sem chamar nada e sem
// chave. A chave vem so da linha de comando, do projeto "avaliacao" da OpenAI;
// nunca a de producao. Frases 100% sinteticas, dos fixtures da bateria.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { detectarGatilhosDeEntrada } from "../../lib/domain/conformidade/gatilhos-de-entrada";
import {
  criarClassificadorDeEntrada,
  decidirPeloClassificador,
  MAX_TOKENS_DO_CLASSIFICADOR,
  POLITICA_DO_CLASSIFICADOR,
  VERSAO_DA_POLITICA_DO_CLASSIFICADOR,
} from "../../lib/integrations/llm/classificador-de-entrada";
import { criarClienteOpenAi } from "../../lib/integrations/llm/openai";
import {
  modeloDoVerificador,
  type ClienteDoVerificador,
} from "../../lib/integrations/llm/verificador";
import {
  CASOS_DE_URGENCIA,
  NAO_REGRESSAO_DA_URGENCIA,
  RAJADAS_DE_URGENCIA,
  URGENCIAS_DO_REV4,
} from "../../tests/fixtures/ia/conformidade/casos-ag6";
import { URGENTES_DA_REV5 } from "../../tests/fixtures/ia/conformidade/urgentes-da-rev5";

function numero(nome: string): number | null {
  const i = process.argv.indexOf(nome);
  if (i < 0) return null;
  const valor = Number(process.argv[i + 1]);
  if (!Number.isFinite(valor) || valor <= 0)
    throw new Error(`${nome} invalido`);
  return valor;
}

/** Cada conversa uma vez: a mesma frase aparece em mais de uma revisao. */
function asEmergencias(): (readonly string[])[] {
  const todas: (readonly string[])[] = [
    ...CASOS_DE_URGENCIA.map((c) => [c.texto]),
    ...RAJADAS_DE_URGENCIA.map((r) => r.mensagens.map((m) => m.texto ?? "")),
    ...NAO_REGRESSAO_DA_URGENCIA.map((f) => f.textos),
    ...URGENCIAS_DO_REV4,
    ...URGENTES_DA_REV5,
  ];
  const vistas = new Map<string, readonly string[]>();
  for (const textos of todas) vistas.set(textos.join(" || "), textos);
  return [...vistas.values()];
}

function passaPeloPortao(textos: readonly string[]): boolean {
  return (
    detectarGatilhosDeEntrada({
      mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
    }).length === 0
  );
}

async function principal() {
  const frases = asEmergencias();
  const semGatilho = frases.filter(passaPeloPortao);
  console.log(
    `Emergencias: ${frases.length}. Sem gatilho no portao: ${semGatilho.length}.`,
  );
  const orcamento = numero("--orcamento-usd");
  if (orcamento === null) return;

  const precoEntrada = numero("--preco-entrada-usd-mtok");
  const precoSaida = numero("--preco-saida-usd-mtok");
  if (precoEntrada === null || precoSaida === null)
    throw new Error("Precos obrigatorios.");
  if (orcamento > 5)
    throw new Error("--orcamento-usd acima de US$ 5: confira.");
  if (process.env.VERCEL_ENV === "production")
    throw new Error("Nao roda em producao.");
  const chave = process.env.OPENAI_API_KEY_AVALIACAO?.trim();
  if (!chave)
    throw new Error("Defina OPENAI_API_KEY_AVALIACAO na linha de comando.");
  if (chave === process.env.OPENAI_API_KEY?.trim())
    throw new Error("Use a chave do projeto avaliacao.");
  const modelo = modeloDoVerificador(process.env);
  if (modelo === null)
    throw new Error("IA_MODELO_VERIFICADOR fora da lista fechada.");

  const classificar = criarClassificadorDeEntrada({
    cliente: criarClienteOpenAi({
      apiKey: chave,
    }) as unknown as ClienteDoVerificador,
    modelo,
  });
  // Pior caso por chamada: um token a cada 2 caracteres, com folga para a maior frase.
  const custoMaximo = (texto: string) =>
    (((POLITICA_DO_CLASSIFICADOR.length + texto.length + 500) / 2) *
      precoEntrada +
      MAX_TOKENS_DO_CLASSIFICADOR * precoSaida) /
    1_000_000;

  let reservado = 0;
  const escalou: string[] = [];
  const naoEscalou: string[] = [];
  const falhou: string[] = [];
  let interrompido = false;
  const fila = [...semGatilho];
  async function trabalhador() {
    for (let textos = fila.shift(); textos; textos = fila.shift()) {
      const custo = custoMaximo(textos.join(" "));
      if (reservado + custo > orcamento!) {
        interrompido = true;
        return;
      }
      reservado += custo;
      const resultado = await classificar({ mensagens: textos });
      const rotulo = textos.join(" || ");
      if (resultado.tipo === "falha") falhou.push(rotulo);
      else if (decidirPeloClassificador(resultado).escalar)
        escalou.push(rotulo);
      else naoEscalou.push(rotulo);
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador));

  const relatorio = {
    versao_do_classificador: VERSAO_DA_POLITICA_DO_CLASSIFICADOR,
    modelo,
    emergencias: frases.length,
    sem_gatilho_no_portao: semGatilho.length,
    classificador_escalou: escalou.length,
    classificador_nao_escalou: naoEscalou.length,
    falhas_tecnicas: falhou.length,
    interrompido_pelo_orcamento: interrompido,
    teto_reservado_usd: Number(reservado.toFixed(4)),
    frases_que_escaparam: naoEscalou,
  };
  const pasta = join("docs", "avaliacoes", "ia");
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(
    pasta,
    `classificador-emergencias-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(arquivo, JSON.stringify(relatorio, null, 2));
  console.log(
    JSON.stringify(
      { ...relatorio, frases_que_escaparam: naoEscalou.length },
      null,
      2,
    ),
  );
  console.log(`Relatorio: ${arquivo}`);
}

principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
