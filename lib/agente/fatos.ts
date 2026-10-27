// Os fatos de um turno do agente (AG2, 27/10/2026): o que o filtro de saida
// aceita como verdade na resposta (lib/domain/conformidade/fatos-do-turno.ts).
// PURO, zero I/O.
//
// Montados SO com o que o turno ja tem, nunca com texto do modelo:
//  - as saidas das ferramentas do turno (o JSON que o modelo leu) e o que
//    cada uma afirmou de convenio e de acao (FatosDaFerramenta);
//  - a configuracao publicada que vai ao modelo, exatamente como vai: a
//    base (perguntasParaOModelo), as instrucoes (instrucoesParaOModelo), o
//    nome da clinica do catalogo e a linha da hora na clinica;
//  - a saudacao e o encerramento, que o motor cola na resposta (fonte de
//    data, hora e endereco, e textos colados que as regras dos fatos nao
//    leem como afirmacao do modelo), com o aviso de assistente virtual e a
//    frase de fora do assunto;
//  - os convenios do Cadastro (so nome e plano), para reconhecer o nome no
//    rascunho;
//  - o ano de hoje no fuso da clinica.
// As mensagens novas do paciente (fonte de data e hora) o filtro ja recebe
// em mensagensDoPaciente. Quem chama (lib/agente/laco.ts) falha fechado se
// montar os fatos lancar.

import { TZDate } from "@date-fns/tz";

import type { ConfigDoAgente } from "@/lib/domain/agente/config";
import type {
  AcaoDoTurno,
  CoberturaDoTurno,
  FatosDaFerramenta,
  FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import {
  FRASE_DO_ASSISTENTE_VIRTUAL,
  FRASE_FORA_DO_ASSUNTO,
} from "@/lib/domain/conformidade/frase-fixa";

import { fusoDaAgenda } from "./ferramentas/buscar-horario";
import {
  conveniosConhecidos,
  type CatalogoDoAgente,
} from "./ferramentas/buscar-procedimento";
import { instrucoesParaOModelo, perguntasParaOModelo } from "./prompt";

/** O que uma ferramenta do turno devolveu: a saida e o que ela afirmou. */
export type SaidaParaOsFatos = {
  saida: string;
  fatos?: FatosDaFerramenta;
};

/** O ano de hoje no fuso da clinica (fuso invalido: o padrao da agenda). */
export function anoNaClinica(agoraMs: number, fuso: string): number {
  return new TZDate(agoraMs, fusoDaAgenda(fuso)).getFullYear();
}

/**
 * Os textos publicados que valem como fonte de data, hora e endereco, como
 * vao ao modelo (ou colados na resposta).
 */
export function textosPublicadosDoTurno(entrada: {
  config: Pick<
    ConfigDoAgente,
    "base" | "instrucoes" | "saudacao" | "encerramento"
  >;
  catalogo: Pick<CatalogoDoAgente, "nomeDaClinica">;
  agoraTexto: string;
}): string[] {
  const { config, catalogo } = entrada;
  const textos: string[] = [];
  for (const { item } of perguntasParaOModelo(config.base)) {
    textos.push(item.pergunta, item.resposta);
  }
  const instrucoes = instrucoesParaOModelo(config.instrucoes);
  if (instrucoes !== null) {
    textos.push(instrucoes);
  }
  for (const texto of [
    catalogo.nomeDaClinica,
    config.saudacao,
    config.encerramento,
  ]) {
    if (texto?.trim()) {
      textos.push(texto);
    }
  }
  textos.push(`Agora na clínica: ${entrada.agoraTexto}.`);
  return textos;
}

/**
 * Monta os fatos do turno. Pode lancar (configuracao fora do formato): quem
 * chama trata como falha fechada.
 */
export function montarFatosDoTurno(entrada: {
  config: ConfigDoAgente;
  catalogo: CatalogoDoAgente;
  /** agoraNaClinica(...), a mesma linha que vai nas instrucoes. */
  agoraTexto: string;
  agoraMs: number;
  fuso: string;
  /** As ferramentas que rodaram no turno, na ordem. */
  ferramentas: readonly SaidaParaOsFatos[];
}): FatosDoTurno {
  const { config, catalogo } = entrada;
  const coberturas: CoberturaDoTurno[] = [];
  const acoes = new Set<AcaoDoTurno>();
  let consultaLida = false;
  for (const { fatos } of entrada.ferramentas) {
    coberturas.push(...(fatos?.coberturas ?? []));
    if (fatos?.acao !== undefined) {
      acoes.add(fatos.acao);
    }
    if (fatos?.consultaLida === true) {
      consultaLida = true;
    }
  }
  const colados = [
    config.saudacao,
    config.encerramento,
    FRASE_DO_ASSISTENTE_VIRTUAL,
    FRASE_FORA_DO_ASSUNTO,
  ].filter((texto): texto is string => (texto?.trim() ?? "") !== "");
  return {
    saidasDasFerramentas: entrada.ferramentas.map(({ saida }) => saida),
    textosPublicados: textosPublicadosDoTurno(entrada),
    textosColados: colados,
    convenios: conveniosConhecidos(catalogo).map((c) => ({
      nome: c.nome,
      plano: c.plano,
    })),
    coberturas,
    acoes: [...acoes],
    consultaLida,
    anoCorrente: anoNaClinica(entrada.agoraMs, entrada.fuso),
  };
}
