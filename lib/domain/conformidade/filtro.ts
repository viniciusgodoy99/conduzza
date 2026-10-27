// O filtro de conformidade na saida da IA (CLAUDE.md 3.2): o UNICO caminho
// para um texto da IA virar TextoAprovado.
//
// Ordem e invariantes (plano de seguranca 2.1 e 2.3):
//  1. As regras deterministicas rodam primeiro. Qualquer regra disparada
//     bloqueia e o modelo nem e chamado. Com os fatos do turno (AG2), data e
//     hora, endereco, convenio e acao de agenda tambem so passam com fato
//     (fatos-do-turno.ts); fatos fora do formato bloqueiam (falha fechada).
//  2. Regras limpas NAO aprovam: o verificador por modelo (injetado) tem de
//     aprovar tambem.
//  3. Falha fechada: excecao, prazo estourado, recusa, max_tokens, saida
//     invalida, aprovacao com violacao (incoerente) e confianca baixa
//     bloqueiam. Mais de cinco mensagens do paciente sem resposta tambem:
//     o verificador so enxerga as cinco ultimas e aprovaria sem ver a
//     pergunta que ficou para tras (contexto_truncado).
//  4. O texto aprovado e o rascunho byte a byte. Saudacao e despedida sao
//     concatenadas ANTES de chamar este filtro, nunca depois. O sha256 e do
//     UTF-8 desse texto, para o gatilho em message conferir.
//
// Nao loga nada: quem chama grava a decisao (categoria e camada, nunca o
// texto) em ai_decision_log.

import { createHash } from "node:crypto";

import {
  CATEGORIAS_DE_CONFORMIDADE,
  ordenarPorPrioridade,
  type CamadaDoFiltro,
  type CategoriaDeConformidade,
} from "@/lib/domain/conformidade/categorias";
import { fatosValidos } from "@/lib/domain/conformidade/fatos-do-turno";
import {
  avaliarRegras,
  FONTES_DAS_REGRAS_EM_CODIGO,
  type ContextoDasRegras,
} from "@/lib/domain/conformidade/filtro-deterministico";
import {
  FONTES_DO_PORTAO_EM_CODIGO,
  MAXIMO_DE_MENSAGENS_NO_CONTEXTO,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import { FONTES_DA_NORMALIZACAO } from "@/lib/domain/conformidade/normalizar";
import {
  IDADES_POR_EXTENSO,
  LEXICO_APROXIMADO,
  LEXICO_COMPACTO,
  LEXICO_COMPACTO_DE_ENTRADA,
  NEUTRALIZACOES_DE_ENTRADA,
  PADROES_DE_ENTRADA,
  PADROES_DE_SAIDA,
} from "@/lib/domain/conformidade/padroes";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import {
  EsquemaDoVeredicto,
  ehMotivoDaFalha,
  type MotivoDaFalha,
  type UsoDoLlm,
  type Verificador,
} from "@/lib/domain/conformidade/veredicto";

/**
 * Teto do verificador dentro do filtro. O SDK ja tem o proprio timeout;
 * este e o corte duro, que vale ate para um verificador que nunca responde.
 */
export const PRAZO_DO_VERIFICADOR_MS = 10_000;

export type ContextoDoFiltro = ContextoDasRegras;

export type ChamadaDoVerificador = {
  modelo: string | null;
  uso: UsoDoLlm | null;
};

export type DecisaoDoFiltro =
  | {
      aprovado: true;
      texto: TextoAprovado;
      sha256: string;
      versaoDasRegras: string;
      verificador: ChamadaDoVerificador;
    }
  | {
      aprovado: false;
      categoria: CategoriaDeConformidade;
      camada: CamadaDoFiltro;
      /** So quando camada = "falha". */
      motivoDaFalha: MotivoDaFalha | null;
      versaoDasRegras: string;
      verificador: ChamadaDoVerificador | null;
    };

export type EntradaDoFiltro = {
  rascunho: string;
  contexto: ContextoDoFiltro;
  verificador: Verificador;
  /** Fim do prazo do job (epoch ms). Estourado antes de aprovar = bloqueio. */
  prazoEm?: number;
  /** Relogio injetavel para teste. */
  agora?: () => number;
  /** Teto do verificador (ms); padrao PRAZO_DO_VERIFICADOR_MS. */
  prazoDoVerificadorMs?: number;
};

/** sha256 hexadecimal do UTF-8 do texto (o mesmo que o banco calcula). */
export function sha256DoTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

let versaoCalculada: string | null = null;

/**
 * Versao das regras: hash dos padroes, dos lexicos e das regras que vivem em
 * codigo (preco e formato). Muda sozinha quando uma regra muda, e vai para
 * ai_decision_log junto da decisao.
 */
export function versaoDasRegras(): string {
  if (versaoCalculada === null) {
    const fonte = JSON.stringify({
      padroes: PADROES_DE_SAIDA.map((p) => [
        p.categoria,
        p.nome,
        p.regex.source,
      ]),
      compacto: LEXICO_COMPACTO,
      aproximado: LEXICO_APROXIMADO,
      codigo: FONTES_DAS_REGRAS_EM_CODIGO,
    });
    versaoCalculada = `regras-${sha256DoTexto(fonte).slice(0, 12)}`;
  }
  return versaoCalculada;
}

/**
 * O que define o portao de entrada: os padroes de entrada, as expressoes
 * permitidas, o lexico compacto, as idades por extenso, as regras em codigo
 * (idade, caixa alta, limites) e a normalizacao.
 */
export function fontesDoPortao() {
  return {
    padroes: PADROES_DE_ENTRADA.map((p) => [p.gatilho, p.nome, p.regex.source]),
    neutralizacoes: NEUTRALIZACOES_DE_ENTRADA.map(({ nome, fonte, troca }) => [
      nome,
      fonte,
      troca,
    ]),
    compacto: LEXICO_COMPACTO_DE_ENTRADA,
    idades: [...IDADES_POR_EXTENSO],
    codigo: FONTES_DO_PORTAO_EM_CODIGO,
    normalizacao: FONTES_DA_NORMALIZACAO,
  };
}

/** O hash de 12 caracteres das fontes do portao ("portao-..."). */
export function calcularVersaoDoPortao(fontes: unknown): string {
  return `portao-${sha256DoTexto(JSON.stringify(fontes)).slice(0, 12)}`;
}

let versaoDoPortaoCalculada: string | null = null;

/**
 * Versao do portao de entrada (revisao de producao de 19/10/2026, Q12). Muda
 * sozinha quando o portao muda (por exemplo, quando um falso positivo e
 * afrouxado), para separar as decisoes de antes e de depois. A regra de
 * contexto do filtro de saida usa o mesmo portao.
 */
export function versaoDoPortao(): string {
  if (versaoDoPortaoCalculada === null) {
    versaoDoPortaoCalculada = calcularVersaoDoPortao(fontesDoPortao());
  }
  return versaoDoPortaoCalculada;
}

// A UNICA conversao para TextoAprovado no codigo inteiro. Nao exportada.
function aprovar(texto: string): TextoAprovado {
  return texto as TextoAprovado;
}

function contextoValido(contexto: unknown): contexto is ContextoDoFiltro {
  if (typeof contexto !== "object" || contexto === null) {
    return false;
  }
  const c = contexto as Record<string, unknown>;
  return (
    Array.isArray(c.precosDoTurno) &&
    c.precosDoTurno.every((v) => Number.isInteger(v) && v >= 0) &&
    Array.isArray(c.nomesDoCatalogo) &&
    c.nomesDoCatalogo.every((v) => typeof v === "string") &&
    Array.isArray(c.mensagensDoPaciente) &&
    c.mensagensDoPaciente.every((v) => typeof v === "string") &&
    // Os fatos sao opcionais; quando vem, tem de estar no formato (um nulo
    // ou um objeto pela metade nunca vira "sem regra dos fatos").
    (!("fatos" in c) || c.fatos === undefined || fatosValidos(c.fatos))
  );
}

function lerUso(valor: unknown): UsoDoLlm | null {
  if (typeof valor !== "object" || valor === null) {
    return null;
  }
  const u = valor as Record<string, unknown>;
  const campos = [
    u.tokensEntrada,
    u.tokensSaida,
    u.tokensCacheLidos,
    u.tokensCacheGravados,
  ];
  if (!campos.every((c) => typeof c === "number" && Number.isFinite(c))) {
    return null;
  }
  return {
    tokensEntrada: u.tokensEntrada as number,
    tokensSaida: u.tokensSaida as number,
    tokensCacheLidos: u.tokensCacheLidos as number,
    tokensCacheGravados: u.tokensCacheGravados as number,
  };
}

/**
 * Filtra o rascunho da IA. Aprovado so com regras limpas E o verificador
 * aprovando com confianca alta ou media, dentro do prazo.
 */
export async function filtrarSaida(
  entrada: EntradaDoFiltro,
): Promise<DecisaoDoFiltro> {
  const versao = versaoDasRegras();
  const agora = entrada.agora ?? Date.now;

  const bloquear = (
    categoria: CategoriaDeConformidade,
    camada: CamadaDoFiltro,
    motivoDaFalha: MotivoDaFalha | null,
    verificador: ChamadaDoVerificador | null,
  ): DecisaoDoFiltro => ({
    aprovado: false,
    categoria,
    camada,
    motivoDaFalha,
    versaoDasRegras: versao,
    verificador,
  });

  // Entrada malformada (nao deveria acontecer com o TS, mas o filtro nao
  // confia em quem chama).
  if (typeof entrada.rascunho !== "string") {
    return bloquear("formato_invalido", "regra", null, null);
  }
  if (!contextoValido(entrada.contexto)) {
    return bloquear("falha_verificador", "falha", "desconhecida", null);
  }

  // 1. Regras.
  const regras = avaliarRegras(entrada.rascunho, entrada.contexto);
  const primeira = regras.categorias[0];
  if (primeira !== undefined) {
    return bloquear(primeira, "regra", null, null);
  }

  // O verificador so ve as ultimas mensagens: com mais do que isso sem
  // resposta, ele julgaria sem a pergunta que ficou para tras. O portao de
  // entrada ja escala esse caso; aqui e a segunda trava.
  if (
    entrada.contexto.mensagensDoPaciente.length >
    MAXIMO_DE_MENSAGENS_NO_CONTEXTO
  ) {
    return bloquear("falha_verificador", "falha", "contexto_truncado", null);
  }

  // 2. Verificador, com prazo duro.
  const restante =
    entrada.prazoEm === undefined
      ? Number.POSITIVE_INFINITY
      : entrada.prazoEm - agora();
  const prazoMs = Math.min(
    entrada.prazoDoVerificadorMs ?? PRAZO_DO_VERIFICADOR_MS,
    restante,
  );
  if (!(prazoMs > 0)) {
    return bloquear("falha_verificador", "falha", "prazo", null);
  }
  if (typeof entrada.verificador !== "function") {
    return bloquear("falha_verificador", "falha", "sem_cliente", null);
  }

  const verificador = entrada.verificador;
  const { rascunho } = entrada;
  const { mensagensDoPaciente } = entrada.contexto;
  const corrida = await correrComPrazo<unknown>(
    (sinal) => verificador({ rascunho, mensagensDoPaciente, sinal }),
    prazoMs,
  );
  if (corrida.tipo === "prazo") {
    return bloquear("falha_verificador", "falha", "timeout", null);
  }
  if (corrida.tipo === "erro") {
    return bloquear("falha_verificador", "falha", "desconhecida", null);
  }

  const resultado = corrida.valor;
  if (typeof resultado !== "object" || resultado === null) {
    return bloquear("falha_verificador", "falha", "saida_invalida", null);
  }
  const r = resultado as Record<string, unknown>;
  const chamada: ChamadaDoVerificador = {
    modelo: typeof r.modelo === "string" ? r.modelo : null,
    uso: lerUso(r.uso),
  };

  if (r.tipo === "falha") {
    const motivo = ehMotivoDaFalha(r.motivo) ? r.motivo : "desconhecida";
    return bloquear("falha_verificador", "falha", motivo, chamada);
  }
  if (r.tipo !== "veredicto") {
    return bloquear("falha_verificador", "falha", "saida_invalida", chamada);
  }

  // O verificador real ja valida; aqui valida de novo, porque um falso, um
  // bug ou uma troca de verificador nao podem virar aprovacao.
  const lido = EsquemaDoVeredicto.safeParse(r.veredicto);
  if (!lido.success) {
    return bloquear("falha_verificador", "falha", "saida_invalida", chamada);
  }
  const veredicto = lido.data;

  if (!veredicto.aprovado) {
    const categorias = ordenarPorPrioridade(
      CATEGORIAS_DE_CONFORMIDADE,
      veredicto.violacoes.map((v) => v.categoria),
    );
    const categoria = categorias[0];
    if (categoria === undefined) {
      // Reprovou sem dizer o que: incoerente, mas bloqueia do mesmo jeito.
      return bloquear("falha_verificador", "falha", "incoerente", chamada);
    }
    return bloquear(categoria, "modelo", null, chamada);
  }
  if (veredicto.violacoes.length > 0) {
    // Aprovou apontando violacao: contradicao.
    return bloquear("falha_verificador", "falha", "incoerente", chamada);
  }
  if (veredicto.confianca === "baixa") {
    return bloquear("falha_verificador", "falha", "confianca_baixa", chamada);
  }

  // 3. Prazo do job: aprovacao que chega tarde nao vale.
  if (entrada.prazoEm !== undefined && agora() > entrada.prazoEm) {
    return bloquear("falha_verificador", "falha", "prazo", chamada);
  }

  return {
    aprovado: true,
    texto: aprovar(entrada.rascunho),
    sha256: sha256DoTexto(entrada.rascunho),
    versaoDasRegras: versao,
    verificador: chamada,
  };
}

/** A regra do preco que depende do turno (precos que a busca devolveu). */
const REGRA_DO_PRECO_DO_TURNO = "valor_fora_do_turno";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * A linha de ai_decision_log que o EXECUTOR le do banco (por id, clinica e
 * job) para retomar o envio. Os campos chegam crus (unknown): a funcao
 * confere cada um, nunca confia em quem chama.
 */
export type DecisaoParaRetomar = {
  job_id: unknown;
  desfecho: unknown;
  aprovado: unknown;
  compliance_blocked: unknown;
  texto_sha256: unknown;
};

export type EntradaDaRetomada = {
  /** O job que esta retomando (a decisao tem de ser dele). */
  jobId: string;
  /** ai_turno.texto */
  texto: string;
  /** ai_turno.texto_sha256 */
  sha256DoTurno: string;
  /**
   * A decisao APROVADA do mesmo job, lida pelo executor em ai_decision_log
   * (nunca de ai_turno). null: nao achou, e nao retoma.
   */
  decisao: DecisaoParaRetomar | null;
  /** Nomes do Cadastro, mascarados como na aprovacao. */
  nomesDoCatalogo?: readonly string[];
};

/**
 * Retomada do envio (E3): o texto que este filtro ja aprovou num turno
 * anterior do mesmo job, guardado em ai_turno, volta a ser TextoAprovado SEM
 * chamar o verificador de novo, so se:
 *  - a decisao e a APROVADA do mesmo job (desfecho 'respondeu', aprovado,
 *    sem bloqueio de conformidade, com hash valido), lida de ai_decision_log
 *    pelo executor. O hash de ai_turno sozinho nao vale: um texto trocado em
 *    ai_turno com o hash recalculado na mesma linha passaria (revisao do E3,
 *    achado 3 do executor);
 *  - o sha256 do texto, o de ai_turno e o da decisao sao o MESMO (o gatilho
 *    de message confere de novo);
 *  - as regras deterministicas continuam limpas. Ficam de fora as que
 *    dependem do turno: a do preco (valor_fora_do_turno: os precos que a
 *    busca devolveu naquele turno ja foram conferidos na aprovacao e o hash
 *    prende o texto a ela) e as dos fatos do turno (AG2: a retomada nao
 *    passa fatos, entao elas nem rodam; o texto foi aprovado com os fatos
 *    daquele turno). Moeda estrangeira e valor ilegivel continuam valendo.
 * Quem chama: SO lib/jobs/responder-com-ia.ts (o teste de varredura de
 * tests/unit/ia-whatsapp/retomar-texto-aprovado.test.ts confere; os testes
 * geram TextoAprovado pelo proprio filtrarSaida). null: nao retoma (quem
 * chama passa a conversa para a equipe).
 */
export function retomarTextoAprovado(
  entrada: EntradaDaRetomada,
): TextoAprovado | null {
  if (typeof entrada !== "object" || entrada === null) {
    return null;
  }
  const { jobId, texto, sha256DoTurno, decisao } = entrada;
  if (
    typeof jobId !== "string" ||
    typeof texto !== "string" ||
    typeof sha256DoTurno !== "string"
  ) {
    return null;
  }
  if (typeof decisao !== "object" || decisao === null) {
    return null;
  }
  if (
    decisao.job_id !== jobId ||
    decisao.desfecho !== "respondeu" ||
    decisao.aprovado !== true ||
    decisao.compliance_blocked !== false ||
    typeof decisao.texto_sha256 !== "string" ||
    !SHA256_HEX.test(decisao.texto_sha256)
  ) {
    return null;
  }
  const sha256Aprovado = decisao.texto_sha256;
  if (sha256DoTurno !== sha256Aprovado) {
    return null;
  }
  if (sha256DoTexto(texto) !== sha256Aprovado) {
    return null;
  }
  const regras = avaliarRegras(texto, {
    precosDoTurno: [],
    nomesDoCatalogo: (entrada.nomesDoCatalogo ?? []).filter(
      (nome): nome is string => typeof nome === "string",
    ),
    mensagensDoPaciente: [],
  });
  if (
    regras.achados.some((achado) => achado.regra !== REGRA_DO_PRECO_DO_TURNO)
  ) {
    return null;
  }
  return aprovar(texto);
}
