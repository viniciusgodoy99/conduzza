// Ferramenta enviar_preparo do agente de IA (AG7, 03/11/2026; D-75, D-78,
// D-79 e D-80, esta autorizada pelo dono em 03/11/2026): a orientacao de
// preparo do procedimento, o texto aprovado pelo responsavel tecnico (RT) da
// clinica, enviada palavra por palavra. PURO: le o catalogo carregado no
// servidor (lib/agente/contexto.ts); nada daqui le o banco nem a rede.
//
// O modelo NUNCA escreve, le nem resume o preparo: ele escolhe o procedimento
// (o codigo do bloco <procedimentos>) e pode mandar uma introducao curta, que so
// sai se passar pelo filtro inteiro e pela regra propria dela (decisao do dono
// de 06/11/2026; lib/agente/laco.ts). O servidor confere no catalogo do turno
// que o procedimento tem versao em vigor e encerra o turno (lib/agente/laco.ts);
// o executor le a mensagem pronta do banco (ler_preparo_para_envio), confere o
// hash (aprovarParaEnvio) e a envia como mensagem do SISTEMA
// (enviarPreparoAprovadoDaIa), com a introducao antes do bloco. O texto vai do
// banco para a mensagem sem passar pelo modelo, pelo verificador nem pelo
// historico que vai a OpenAI. Nenhuma saida daqui leva o texto: so ok, motivo,
// ids e o que a trilha diz.
//
// Regras:
//  - So vale SOZINHA no turno (contrato da AG7, secao 0, item 8): cada job
//    manda uma mensagem so (message_job_id_key), entao com outra ferramenta
//    na mesma rodada, ou ja usada numa rodada anterior, a chamada volta ao
//    modelo como "vai_sozinha" (ele responde o resto e oferece o envio).
//  - Procedimento que a IA nao marca e que nao deixa informar ("A IA pode
//    informar ..." desligada): so a equipe informa (regra_do_procedimento,
//    como consultar_requisitos; D-79).
//  - Sem versao em vigor (nunca aprovada, aprovacao que parou de valer:
//    RT trocado ou sem acesso, nome do procedimento mudado, envio suspenso):
//    passa para a equipe com assunto_clinico (D-78). Nunca "a equipe manda
//    junto com a confirmacao": sem aprovacao a regua nao manda.
//  - Procedimento fora do catalogo: volta ao modelo (procedimento_nao_
//    encontrado), que pergunta ou passa para a equipe.

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  codigoDoTexto,
  LIMITE_DA_INTRODUCAO_DO_PREPARO,
  normalizarTextoDoPreparo,
} from "@/lib/domain/preparo";

import {
  procedimentoDoCodigo,
  type CatalogoDoAgente,
  type PreparoEmVigor,
} from "./buscar-procedimento";

export const NOME_DO_ENVIO_DO_PREPARO = "enviar_preparo";

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDoEnvioDoPreparoSchema = z
  .object({
    procedimento: z.string().trim().min(1).max(64),
    // Fora do formato vira "sem introducao" (introducaoDaEntrada): o pedido do
    // preparo nao volta ao modelo por causa dela.
    introducao: z.unknown().optional(),
  })
  .strict();

/** A introducao como veio do modelo, normalizada, ou null. */
function introducaoDaEntrada(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const texto = normalizarTextoDoPreparo(valor);
  return texto === "" ? null : texto;
}

/** Definicao para a Responses API (strict, escrita a mao). */
export const FERRAMENTA_ENVIAR_PREPARO: FunctionTool = {
  type: "function",
  name: NOME_DO_ENVIO_DO_PREPARO,
  strict: true,
  description:
    "Manda ao paciente a orientação de preparo do procedimento, o texto aprovado pelo responsável técnico da clínica, exatamente como está. Você não escreve esse texto: só pode mandar uma introdução curta, que vai antes dele. Use quando a pessoa pedir o preparo ou as orientações antes do procedimento, ou perguntar de forma geral se precisa de jejum. Chame sozinha, sem outra ferramenta; depois de chamar, não escreva mais nada.",
  parameters: {
    type: "object",
    properties: {
      procedimento: {
        type: "string",
        description:
          "Código do procedimento no bloco <procedimentos>, por exemplo p3.",
      },
      introducao: {
        type: ["string", "null"],
        description: `Uma frase curta de conversa, de até ${LIMITE_DA_INTRODUCAO_DO_PREPARO} caracteres, que vai antes do texto aprovado, por exemplo "Claro! Segue a orientação da clínica:". Nunca cite remédio, dose, número, unidade, como tomar, jejum, comida, bebida ou sintoma. Sem o que dizer, null. Se ela não passar na conformidade, o sistema manda só o texto aprovado.`,
      },
    },
    required: ["procedimento", "introducao"],
    additionalProperties: false,
  },
};

/** O que volta ao modelo quando a chamada nao encerra o turno. */
export const MOTIVOS_DO_ENVIO_DO_PREPARO = [
  "entrada_invalida",
  "procedimento_nao_encontrado",
  "vai_sozinha",
  // Revisao da AG7 (CFM-7): a pessoa nao disse qual e o procedimento.
  "procedimento_nao_confirmado",
] as const;
export type MotivoDoEnvioDoPreparo =
  (typeof MOTIVOS_DO_ENVIO_DO_PREPARO)[number];

export type DecisaoDoEnvioDoPreparo =
  | {
      tipo: "enviar";
      procedimentoId: string;
      versaoId: string;
      versao: number;
      /** Como o modelo mandou: o laco a passa pelo filtro antes de valer. */
      introducao: string | null;
      passo: string;
    }
  | {
      tipo: "passar";
      motivo: "assunto_clinico" | "regra_do_procedimento";
      passo: string;
    }
  | { tipo: "resultado"; saida: string; passo: string };

/**
 * O passo da trilha quando a orientacao de preparo escolhida deixou de valer
 * entre o catalogo do turno e o envio (a aprovacao mudou: suspensa,
 * substituida, RT trocado ou sem acesso, nome do procedimento mudado; ou a
 * habilidade saiu da versao publicada). O executor e o simulador passam a
 * conversa para a equipe com assunto_clinico.
 */
export const PASSO_DO_PREPARO_FORA_DE_VIGOR =
  "A orientação de preparo deixou de valer antes do envio: nada foi enviado.";

/** Fuso de quando o da clinica nao e valido (CLAUDE.md 3.6). */
const FUSO_PADRAO = "America/Fortaleza";

/** dd/mm/aaaa no fuso da clinica, ou null (instante ou fuso invalido). */
function dataNaClinica(instante: string, fuso: string): string | null {
  const ms = Date.parse(instante);
  if (!Number.isFinite(ms)) {
    return null;
  }
  for (const zona of [fuso, FUSO_PADRAO]) {
    try {
      const data = new TZDate(ms, zona);
      if (Number.isFinite(data.getTime())) {
        return format(data, "dd/MM/yyyy", { locale: ptBR });
      }
    } catch {
      // Tenta o padrao.
    }
  }
  return null;
}

/**
 * Revisao da AG7 (CFM-7): o passo da trilha quando o procedimento que o
 * modelo escolheu nao e o que a pessoa pediu (nem o da consulta dela): nada
 * sai, e o modelo pergunta qual e.
 */
export const PASSO_DO_PROCEDIMENTO_NAO_CONFIRMADO =
  "Pediu a orientação de preparo sem dizer de qual procedimento: perguntar antes de enviar.";

/** A saida da ferramenta quando o procedimento nao foi confirmado. */
export const SAIDA_DO_PROCEDIMENTO_NAO_CONFIRMADO = JSON.stringify({
  ok: false,
  motivo: "procedimento_nao_confirmado",
});

function resultado(
  motivo: MotivoDoEnvioDoPreparo,
  passo: string,
): DecisaoDoEnvioDoPreparo {
  return {
    tipo: "resultado",
    saida: JSON.stringify({ ok: false, motivo }),
    passo,
  };
}

/**
 * O passo do envio (sem dado de paciente; o nome e o codigo do Cadastro).
 * Revisao da AG7 (MOTOR-7): diz a versao ESCOLHIDA, nao a enviada: o envio
 * acontece depois (o executor le a mensagem do banco, confere e manda), e
 * quando ele nao acontece o passo seguinte da trilha diz por que.
 */
function passoDoEnvio(
  procedimento: string,
  preparo: PreparoEmVigor,
  fuso: string,
): string {
  const codigo = codigoDoTexto(preparo.textoSha256);
  const data = dataNaClinica(preparo.aprovadoEm, fuso);
  return `Pediu a orientação de preparo de ${procedimento}: escolhida a versão ${preparo.versao}${codigo === "" ? "" : ` (código ${codigo})`}, aprovada por ${preparo.rtNome}${data === null ? "" : ` em ${data}`}.`;
}

/**
 * Decide o que fazer com uma chamada de enviar_preparo. PURA e nunca lanca:
 * entrada invalida, procedimento desconhecido e a chamada que nao veio
 * sozinha voltam ao modelo; o resto encerra o turno (enviar) ou passa para a
 * equipe (passar).
 */
export function decidirEnvioDoPreparo(
  catalogo: CatalogoDoAgente,
  args: unknown,
  contexto: { sozinhaNoTurno: boolean; fuso?: string },
): DecisaoDoEnvioDoPreparo {
  if (!contexto.sozinhaNoTurno) {
    return resultado(
      "vai_sozinha",
      "Pediu a orientação de preparo junto de outra consulta: o envio fica para uma resposta só dele.",
    );
  }
  const lido = entradaDoEnvioDoPreparoSchema.safeParse(args);
  if (!lido.success) {
    return resultado(
      "entrada_invalida",
      "Tentou mandar a orientação de preparo com um pedido incompleto.",
    );
  }
  const achado = procedimentoDoCodigo(catalogo, lido.data.procedimento);
  if (achado === null) {
    return resultado(
      "procedimento_nao_encontrado",
      "Procurou a orientação de preparo de um procedimento que não está no Cadastro.",
    );
  }
  const { procedimento } = achado;
  const pediu = `Pediu a orientação de preparo de ${procedimento.nome}`;
  // D-79: o que a IA nao marca e nao deixa informar, so a equipe informa
  // (a mesma regra de consultar_requisitos).
  if (!achado.noIndice && !achado.procedimento.informaValor) {
    return {
      tipo: "passar",
      motivo: "regra_do_procedimento",
      passo: `${pediu}: só a equipe informa este procedimento.`,
    };
  }
  const preparo = catalogo.preparosEmVigor?.get(procedimento.id);
  if (preparo === undefined) {
    return {
      tipo: "passar",
      motivo: "assunto_clinico",
      passo: `${pediu}: o procedimento não tem orientação aprovada pelo responsável técnico.`,
    };
  }
  return {
    tipo: "enviar",
    procedimentoId: procedimento.id,
    versaoId: preparo.versaoId,
    versao: preparo.versao,
    introducao: introducaoDaEntrada(lido.data.introducao),
    passo: passoDoEnvio(
      procedimento.nome,
      preparo,
      contexto.fuso ?? FUSO_PADRAO,
    ),
  };
}

// ---------------------------------------------------------------------------
// Revisao da AG7 (CFM-7): o procedimento que a pessoa pediu
// ---------------------------------------------------------------------------

// As palavras que nao identificam um procedimento.
const PALAVRAS_VAZIAS: ReadonlySet<string> = new Set([
  "com",
  "sem",
  "para",
  "pra",
  "pro",
  "por",
  "das",
  "dos",
  "nos",
  "nas",
  "uma",
  "uns",
  "umas",
  "the",
]);

/** Minusculas, sem acento, so letras e numeros, as palavras do texto. */
function palavrasDe(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((palavra) => palavra !== "");
}

/** As palavras do nome que identificam o procedimento (3 letras ou mais). */
function palavrasDoNome(nome: string): string[] {
  return [
    ...new Set(
      palavrasDe(nome).filter(
        (palavra) => palavra.length >= 3 && !PALAVRAS_VAZIAS.has(palavra),
      ),
    ),
  ];
}

/**
 * A palavra do nome aparece no texto da pessoa? Igual, ou o comeco de uma
 * com o outro, com 5 letras ou mais ("colono" e "colonoscopias" valem
 * "colonoscopia").
 */
function citada(palavra: string, doTexto: ReadonlySet<string>): boolean {
  for (const dita of doTexto) {
    if (
      dita === palavra ||
      (dita.length >= 5 && palavra.startsWith(dita)) ||
      (palavra.length >= 5 && dita.startsWith(palavra))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Revisao da AG7 (CFM-7): o que os textos da pessoa dizem do procedimento
 * escolhido pelo modelo. Cada procedimento do catalogo (do indice e so com a
 * equipe) tem a nota: quantas palavras do nome a pessoa disse e a fracao do
 * nome.
 *  - "nenhum": a pessoa nao citou procedimento nenhum ("me manda o
 *    preparo");
 *  - "confirmado": o escolhido tem a maior nota, SOZINHO;
 *  - "outro": a pessoa citou, mas o escolhido nao e o unico melhor (outro
 *    procedimento, ou o empate de "ultrassom de abdome" entre "Ultrassom de
 *    abdome total" e "Ultrassom de abdome superior").
 * PURA.
 */
export function citacaoDoProcedimento(
  catalogo: Pick<
    CatalogoDoAgente,
    "procedimentos" | "procedimentosSoComAEquipe"
  >,
  procedimentoId: string,
  textos: readonly string[],
): "nenhum" | "confirmado" | "outro" {
  const doTexto = new Set(textos.flatMap(palavrasDe));
  const nota = (nome: string): [number, number] => {
    const palavras = palavrasDoNome(nome);
    const ditas = palavras.filter((p) => citada(p, doTexto)).length;
    return [ditas, palavras.length === 0 ? 0 : ditas / palavras.length];
  };
  const notas = [
    ...catalogo.procedimentos,
    ...(catalogo.procedimentosSoComAEquipe ?? []),
  ].map((p) => ({ id: p.id, nota: nota(p.nome) }));
  if (notas.every(({ nota: [ditas] }) => ditas === 0)) {
    return "nenhum";
  }
  const escolhido = notas.find((n) => n.id === procedimentoId);
  if (escolhido === undefined || escolhido.nota[0] === 0) {
    return "outro";
  }
  const [ditas, fracao] = escolhido.nota;
  const unico = notas.every(
    ({ id, nota: [ditasDoOutro, fracaoDoOutro] }) =>
      id === procedimentoId ||
      ditasDoOutro < ditas ||
      (ditasDoOutro === ditas && fracaoDoOutro < fracao),
  );
  return unico ? "confirmado" : "outro";
}

// ---------------------------------------------------------------------------
// A leitura do catalogo (preparos_em_vigor_da_clinica e
// textos_de_preparo_da_clinica), defensiva: nada daqui confia no formato
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Uma linha de preparos_em_vigor_da_clinica conferida, ou null. */
function preparoDaLinha(
  linha: unknown,
): { procedureId: string; preparo: PreparoEmVigor } | null {
  if (!ehObjeto(linha)) {
    return null;
  }
  const {
    procedure_id: procedureId,
    versao_id: versaoId,
    versao,
    texto_sha256: textoSha256,
    rt_nome: rtNome,
    aprovado_em: aprovadoEm,
  } = linha;
  if (
    typeof procedureId !== "string" ||
    !UUID.test(procedureId) ||
    typeof versaoId !== "string" ||
    !UUID.test(versaoId) ||
    typeof versao !== "number" ||
    !Number.isSafeInteger(versao) ||
    versao < 1 ||
    typeof textoSha256 !== "string" ||
    !SHA256_HEX.test(textoSha256) ||
    typeof rtNome !== "string" ||
    rtNome.trim() === "" ||
    typeof aprovadoEm !== "string" ||
    !Number.isFinite(Date.parse(aprovadoEm))
  ) {
    return null;
  }
  return {
    procedureId,
    preparo: {
      versaoId,
      versao,
      textoSha256,
      rtNome: rtNome.replace(/\s+/g, " ").trim(),
      aprovadoEm,
    },
  };
}

/**
 * O retorno de preparos_em_vigor_da_clinica como o mapa do catalogo, SO dos
 * procedimentos ativos do catalogo (`ativos`). null quando o retorno nao e
 * uma lista (quem carrega lanca: o catalogo nunca sai pela metade). A linha
 * fora do formato fica de fora (falha fechada: o procedimento fica sem
 * preparo e o pedido passa para a equipe) e conta em `descartadas`; dois
 * preparos do mesmo procedimento (o indice unico do banco nao deixa) tiram
 * os dois.
 */
export function preparosEmVigorDaLeitura(
  dados: unknown,
  ativos: ReadonlySet<string>,
): { preparos: Map<string, PreparoEmVigor>; descartadas: number } | null {
  if (!Array.isArray(dados)) {
    return null;
  }
  const preparos = new Map<string, PreparoEmVigor>();
  const repetidos = new Set<string>();
  let descartadas = 0;
  for (const linha of dados) {
    const lida = preparoDaLinha(linha);
    if (lida === null) {
      descartadas += 1;
      continue;
    }
    if (!ativos.has(lida.procedureId)) {
      continue;
    }
    if (preparos.has(lida.procedureId) || repetidos.has(lida.procedureId)) {
      repetidos.add(lida.procedureId);
      preparos.delete(lida.procedureId);
      descartadas += 1;
      continue;
    }
    preparos.set(lida.procedureId, lida.preparo);
  }
  return { preparos, descartadas };
}

/**
 * O retorno de textos_de_preparo_da_clinica: uma lista de textos, sem os
 * vazios (o banco nunca os devolve; o filtro recusaria a lista inteira).
 * null quando nao e uma lista so de textos (quem carrega lanca).
 */
export function textosDePreparoDaLeitura(dados: unknown): string[] | null {
  if (!Array.isArray(dados) || !dados.every((t) => typeof t === "string")) {
    return null;
  }
  return [...new Set((dados as string[]).filter((t) => t.trim() !== ""))];
}
