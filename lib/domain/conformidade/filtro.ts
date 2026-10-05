// O filtro de conformidade na saida da IA (CLAUDE.md 3.2): o UNICO caminho
// para um texto da IA virar TextoAprovado.
//
// Ordem e invariantes (plano de seguranca 2.1 e 2.3):
//  1. As regras deterministicas rodam primeiro. Qualquer regra disparada
//     bloqueia e o modelo nem e chamado.
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
import {
  avaliarRegras,
  FONTES_DAS_REGRAS_EM_CODIGO,
  type ContextoDasRegras,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { MAXIMO_DE_MENSAGENS_NO_CONTEXTO } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  PADROES_DE_SAIDA,
  LEXICO_APROXIMADO,
  LEXICO_COMPACTO,
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
    c.mensagensDoPaciente.every((v) => typeof v === "string")
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
