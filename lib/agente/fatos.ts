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
//    rascunho, e se ele nao tem nenhum convenio ativo (a negativa "nao
//    atendemos convenio" e verdade);
//  - os nomes dos procedimentos ativos do Cadastro (o procedimento citado
//    ao lado do convenio precisa do fato dele);
//  - os horarios livres que as ferramentas de agenda trouxeram (a unica
//    prova da frase que afirma horario livre);
//  - o ano e o dia de hoje no fuso da clinica;
//  - revisao 2 da AG2: as respostas da base publicada que o modelo disse ter
//    usado (perguntas_da_base), que o resumo dos fatos leva ao verificador
//    como fonte de endereco e de requisito;
//  - AG3: o estado do atendimento entra como mais uma "saida" (o laco junta
//    agendaDoTurno.fatosDoEstado()): os horarios ja oferecidos e a reserva
//    sao fonte de dia e hora (citar, negar), mas so o RECONFERIDO no turno
//    e horario livre; a reserva viva, lida no turno, e "reservou"; a
//    consulta marcada nesta conversa, lida no turno, e consulta lida;
//  - revisao final da AG3: cada acao (reservou, marcou, remarcou) e cada
//    consulta lida com o dia, a hora e a unidade dela (a frase da acao com
//    dia ou hora so passa com o par daquela acao), e o eco do pedido (a
//    hora e o dia que a pessoa pediu, o horario que a reserva recusou) fora
//    das saidas, em ecosDoPedido: so vale na frase que nega ou pergunta;
//  - revisao curta das correcoes da AG3 (achado 5): o profissional de cada
//    acao e de cada consulta lida (o que a ferramenta passou ou, sem ele, o
//    da propria saida que o modelo leu, no objeto com o mesmo dia e a mesma
//    hora) e os nomes dos profissionais e das unidades do Cadastro, para a
//    regra que barra a frase da acao com outro profissional ou outra
//    unidade. O profissional nunca vai ao resumo do verificador;
//  - AG4 (27/10/2026): as consultas lidas de uma vez (consultar_minhas_
//    consultas, a consulta em foco do pedido de cancelar ou remarcar, a
//    antiga da remarcacao), cada uma com o profissional relido (o limite da
//    21.15), e, na remarcacao, o horario da consulta antiga junto da acao
//    (o resumo do verificador diz que ela continua marcada).
// As mensagens novas do paciente (fonte de data e hora) o filtro ja recebe
// em mensagensDoPaciente. Quem chama (lib/agente/laco.ts) falha fechado se
// montar os fatos lancar.

import { TZDate } from "@date-fns/tz";

import type { ConfigDoAgente } from "@/lib/domain/agente/config";
import type {
  AcaoComHorario,
  AcaoDoTurno,
  CoberturaDoTurno,
  ConsultaDoFato,
  DiaDaClinica,
  FatosDaFerramenta,
  FatosDoTurno,
  HorarioDoFato,
  HorarioLivreDoTurno,
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

/** Hoje no fuso da clinica (fuso invalido: o padrao da agenda). */
export function hojeNaClinica(agoraMs: number, fuso: string): DiaDaClinica {
  const local = new TZDate(agoraMs, fusoDaAgenda(fuso));
  return {
    dia: local.getDate(),
    mes: local.getMonth() + 1,
    ano: local.getFullYear(),
  };
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

/** As chaves da saida que trazem o horario da acao ou da consulta. */
const CHAVES_DO_HORARIO_NA_SAIDA = [
  "horario_reservado",
  "consulta_marcada",
  "consulta",
] as const;

/**
 * Revisao curta das correcoes da AG3 (achado 5): o profissional que a saida
 * da ferramenta (o JSON que o modelo leu) traz com este dia e esta hora: o
 * do objeto de cima ("reservado", "marcado") ou o de horario_reservado,
 * consulta_marcada e consulta. Nenhum, ou dois diferentes: nulo (nao se
 * sabe). As listas (horarios_oferecidos) nao contam: o mesmo horario pode
 * ter dois profissionais.
 */
export function profissionalDaSaida(
  saida: string,
  horario: { dia: string; hora: string },
): string | null {
  let lido: unknown;
  try {
    lido = JSON.parse(saida);
  } catch {
    return null;
  }
  if (typeof lido !== "object" || lido === null || Array.isArray(lido)) {
    return null;
  }
  const raiz = lido as Record<string, unknown>;
  const candidatos = [
    raiz,
    ...CHAVES_DO_HORARIO_NA_SAIDA.map((chave) => raiz[chave]),
  ];
  const achados = new Set<string>();
  for (const candidato of candidatos) {
    if (
      typeof candidato !== "object" ||
      candidato === null ||
      Array.isArray(candidato)
    ) {
      continue;
    }
    const objeto = candidato as Record<string, unknown>;
    if (
      objeto.dia === horario.dia &&
      objeto.hora === horario.hora &&
      typeof objeto.profissional === "string" &&
      objeto.profissional.trim() !== ""
    ) {
      achados.add(objeto.profissional.trim());
    }
  }
  const [unico] = [...achados];
  return achados.size === 1 && unico !== undefined ? unico : null;
}

/** O profissional do horario: o que a ferramenta passou ou o da saida. */
function comOProfissional<T extends HorarioDoFato>(
  horario: T,
  saida: string,
): T {
  if (typeof horario.profissional === "string") {
    return horario;
  }
  const daSaida = profissionalDaSaida(saida, horario);
  return daSaida === null ? horario : { ...horario, profissional: daSaida };
}

/** Os nomes dos profissionais do Cadastro (os dos vinculos e os ativos). */
function nomesDosProfissionais(catalogo: CatalogoDoAgente): string[] {
  return [
    ...new Set(
      [
        ...catalogo.vinculos.map((v) => v.profissional),
        ...(catalogo.vinculosDaEquipe ?? []).map((v) => v.profissional),
        ...(catalogo.profissionais ?? []).map((p) => p.nome),
      ]
        .map((nome) => nome.replace(/\s+/g, " ").trim())
        .filter((nome) => nome !== ""),
    ),
  ];
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
  /**
   * As respostas da base que o modelo disse ter usado (perguntas_da_base,
   * so os codigos conhecidos). Ausente: nenhuma.
   */
  respostasDaBase?: readonly string[];
}): FatosDoTurno {
  const { config, catalogo } = entrada;
  const coberturas: CoberturaDoTurno[] = [];
  const horariosLivres: HorarioLivreDoTurno[] = [];
  const acoes = new Set<AcaoDoTurno>();
  const horariosDasAcoes: AcaoComHorario[] = [];
  const consultasLidas: ConsultaDoFato[] = [];
  const ecosDoPedido: string[] = [];
  let consultaLida = false;
  for (const { saida, fatos } of entrada.ferramentas) {
    coberturas.push(...(fatos?.coberturas ?? []));
    horariosLivres.push(...(fatos?.horarios ?? []));
    ecosDoPedido.push(...(fatos?.ecos ?? []));
    if (fatos?.acao !== undefined) {
      acoes.add(fatos.acao);
      // Revisao final da AG3: o horario da acao vai junto dela (revisao curta
      // das correcoes: com o profissional). AG4: na remarcacao, com o
      // horario da consulta antiga.
      if (fatos.horarioDaAcao !== undefined) {
        horariosDasAcoes.push({
          ...comOProfissional(fatos.horarioDaAcao, saida),
          acao: fatos.acao,
          ...(fatos.acao === "remarcou" && fatos.horarioAnterior !== undefined
            ? { anterior: fatos.horarioAnterior }
            : {}),
        });
      }
    }
    if (fatos?.consultaLida === true) {
      consultaLida = true;
      if (fatos.consultaComHorario !== undefined) {
        consultasLidas.push({
          ...comOProfissional(fatos.consultaComHorario, saida),
        });
      }
      // AG4: as consultas lidas de uma vez (o profissional ja vem da
      // ferramenta; sem ele, nao se sabe).
      for (const consulta of fatos.consultasComHorario ?? []) {
        consultasLidas.push({ ...consulta });
      }
    }
  }
  const convenios = conveniosConhecidos(catalogo).map((c) => ({
    nome: c.nome,
    plano: c.plano,
  }));
  const colados = [
    config.saudacao,
    config.encerramento,
    FRASE_DO_ASSISTENTE_VIRTUAL,
    FRASE_FORA_DO_ASSUNTO,
  ].filter((texto): texto is string => (texto?.trim() ?? "") !== "");
  return {
    // Revisao final da AG3: sem o eco do pedido (que so vale na frase que
    // nega ou pergunta, em ecosDoPedido).
    saidasDasFerramentas: entrada.ferramentas.map(
      ({ saida, fatos }) => fatos?.saidaSemEco ?? saida,
    ),
    textosPublicados: textosPublicadosDoTurno(entrada),
    textosColados: colados,
    convenios,
    coberturas,
    acoes: [...acoes],
    horariosDasAcoes,
    consultaLida,
    consultasLidas,
    ecosDoPedido,
    anoCorrente: anoNaClinica(entrada.agoraMs, entrada.fuso),
    horariosLivres,
    procedimentos: [
      ...catalogo.procedimentos,
      ...(catalogo.procedimentosSoComAEquipe ?? []),
    ].map((p) => p.nome),
    semConvenioAtivo: convenios.length === 0,
    hoje: hojeNaClinica(entrada.agoraMs, entrada.fuso),
    respostasDaBase: [...(entrada.respostasDaBase ?? [])],
    // Revisao curta das correcoes da AG3 (achado 5): os nomes do Cadastro.
    profissionais: nomesDosProfissionais(catalogo),
    unidades: (catalogo.unidades ?? [])
      .map((u) => u.nome.trim())
      .filter((nome) => nome !== ""),
  };
}
