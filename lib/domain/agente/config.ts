import { z } from "zod";

import {
  CATEGORIAS_CLINICAS,
  CATEGORIAS_DE_CONFORMIDADE,
  type CategoriaClinica,
  type CategoriaDeConformidade,
} from "@/lib/domain/conformidade/categorias";
import {
  avaliarRegras,
  type AchadoDaRegra,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { minimizarParaLlm } from "@/lib/domain/conformidade/minimizar";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import {
  horaParaMinutos,
  minutosLocais,
  weekdayLocal,
} from "@/lib/domain/horarios";

// Configuracao do agente de IA (Tela 6) e as regras puras que a tela, as
// Server Actions e o motor (lib/agente) compartilham. Modulo PURO, zero I/O:
// roda no navegador e no servidor. Tabelas: ai_agent_config (versoes
// rascunho e publicada) e knowledge_item (a base viva), migrations
// 20261006100000 e 20261006150000.
//
// Decisoes do dono de 06/10/2026 (especificacao da Tela 6):
// - a clinica configura CAMPOS (persona, habilidades, horario, base); o texto
//   fixo do agente mora no codigo (lib/agente/prompt.ts) e nunca e campo;
// - "Instrucoes do assistente" e texto livre so da equipe Conduzza (super
//   admin), ate 2.000 caracteres; a sessao de quem nao e super admin nunca
//   le a coluna (ConfigDoAgente.instrucoes chega nulo para ela);
// - todo texto da clinica que o agente pode repetir passa pelas regras
//   deterministicas do filtro do CFM ao salvar e ao publicar
//   (problemaNoTextoDoAgente). Isso so ADIANTA o erro para quem escreve: a
//   garantia continua sendo o filtro de saida (CLAUDE.md 3.2).
//
// Contagem de caracteres: os schemas usam texto.length (unidades UTF-16), a
// regua mais estrita; o CHECK do banco conta pontos de codigo
// (char_length). O que passa aqui sempre passa la.

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

/**
 * Tetos dos campos. O banco espelha nome, saudacao, encerramento,
 * instrucoes, pergunta e resposta em CHECK (migration 20261006150000). A
 * resposta da base fica abaixo dos 700 do filtro (LIMITE_DO_RASCUNHO) porque
 * o agente pode repeti-la quase inteira. itensDaBase e o teto de perguntas
 * ATIVAS (cada uma vai em toda chamada do modelo); publicar_agente recusa
 * acima disso.
 */
export const LIMITES_DO_AGENTE = {
  nome: 40,
  saudacao: 300,
  encerramento: 300,
  instrucoes: 2000,
  pergunta: 200,
  resposta: 600,
  itensDaBase: 60,
} as const;

/**
 * "Se ninguem responder em X minutos": de 1 a 120. O banco so exige maior
 * que zero; o teto de 2 horas e da tela (proposta, ver relatorio da leva).
 */
export const MINUTOS_SEM_RESPOSTA = { minimo: 1, maximo: 120 } as const;

/** Dica das chaves travadas (docs/06, C24). */
export const DICA_DE_OBRIGATORIA = "Obrigatória, não pode ser desligada";

// ---------------------------------------------------------------------------
// Tom de voz e emoji
// ---------------------------------------------------------------------------

/** Espelho do CHECK ai_agent_config_tom_valido. */
export const TONS_DO_AGENTE = ["formal", "cordial", "proximo"] as const;
export type TomDoAgente = (typeof TONS_DO_AGENTE)[number];

export const ROTULO_DO_TOM: Readonly<Record<TomDoAgente, string>> = {
  formal: "Formal",
  cordial: "Cordial",
  proximo: "Próximo",
};

/**
 * A frase de exemplo dentro de cada cartao de tom (brief, Tela 6).
 *
 * PROVISORIO, PENDENCIA DO DONO: as tres frases sao proposta e valem ate a
 * aprovacao. Regras para trocar: curtas, sem promessa, sem orientacao
 * clinica, sem preco, sem emoji (o emoji e outra chave) e sem nada que o
 * filtro barraria (um teste roda o filtro em cada uma). A situacao e a mesma
 * nos tres (o primeiro contato) para o tom ser a unica diferenca.
 */
export const EXEMPLO_DO_TOM: Readonly<Record<TomDoAgente, string>> = {
  formal: "Bom dia. Agradecemos o seu contato. Em que posso ser útil?",
  cordial:
    "Olá, tudo bem? Que bom receber sua mensagem. Como posso ajudar você hoje?",
  proximo: "Oi! Que bom que você chamou. Me conta, como posso te ajudar?",
};

/**
 * A frase fixa que vai ao modelo para cada tom (lib/agente/prompt.ts). Nunca
 * escrita pela clinica: ela so escolhe o tom.
 *
 * PROVISORIO, PENDENCIA DO DONO: proposta junto com EXEMPLO_DO_TOM. Mudar o
 * texto muda VERSAO_DO_PROMPT.
 */
export const INSTRUCAO_DO_TOM: Readonly<Record<TomDoAgente, string>> = {
  formal:
    'Tom formal: linguagem cuidada e respeitosa, com frases completas. Sem gírias, abreviações, diminutivos ou exclamações seguidas. Prefira formas neutras de tratamento, como "Em que posso ser útil?".',
  cordial:
    'Tom cordial: simpático e educado, tratando o paciente por "você". Frases curtas e claras, sem gírias e sem formalidade excessiva.',
  proximo:
    'Tom próximo: leve e acolhedor, como uma recepcionista que já conhece o paciente, tratando por "você". Pode usar expressões do dia a dia, como "pra" e "me conta", sem gírias pesadas, apelidos ou intimidade excessiva.',
};

/**
 * A frase fixa do emoji que vai ao modelo. O filtro de saida barra emoji de
 * remedio, injecao, bebida e afins de qualquer jeito.
 *
 * PROVISORIO, PENDENCIA DO DONO: proposta junto com INSTRUCAO_DO_TOM.
 */
export const INSTRUCAO_DO_EMOJI = {
  ligado:
    "Pode usar no máximo um emoji discreto por mensagem, de cumprimento ou de simpatia. Nunca use emoji de remédio, injeção, termômetro, bebida, cigarro ou ambulância.",
  desligado: "Não use emoji.",
} as const;

// ---------------------------------------------------------------------------
// Habilidades
// ---------------------------------------------------------------------------

/** As ferramentas que o motor sabe dar ao modelo nesta leva (E2). */
export const FERRAMENTAS_DO_AGENTE = [
  "buscar_procedimento",
  "escalar_humano",
] as const;
export type FerramentaDoAgente = (typeof FERRAMENTAS_DO_AGENTE)[number];

export type HabilidadeDoAgente = {
  chave: string;
  titulo: string;
  descricao: string;
  /** Travada = sempre ligada, a tela mostra a chave ligada com cadeado. */
  travada: boolean;
  /** A ferramenta que o modelo recebe quando a habilidade esta ligada. */
  ferramenta: FerramentaDoAgente | null;
  /** O valor quando a clinica ainda nao escolheu (chave ausente em skills). */
  padrao: boolean;
};

/**
 * Lista FECHADA desta leva. As de agenda (agendar, remarcar, cancelar, lista
 * de espera) entram no E4, quando o motor souber fazer: habilidade que o
 * motor nao faz nao aparece na tela.
 *
 * "Informar preco e convenio" nasce ligada: o preco vem do Cadastro, nunca
 * de texto livre, e a spec 2.3 diz que procedimento cadastrado com preco a
 * IA ja sabe responder. "Passar para a equipe" e travada porque e seguranca:
 * o agente sempre pode escalar.
 */
export const HABILIDADES_DO_AGENTE = [
  {
    chave: "responder_duvidas",
    titulo: "Responder dúvidas",
    descricao:
      "Responde dúvidas sobre a clínica com as perguntas e respostas do Conhecimento.",
    travada: true,
    ferramenta: null,
    padrao: true,
  },
  {
    chave: "informar_preco_e_convenio",
    titulo: "Informar preço e convênio",
    descricao:
      "Consulta no Cadastro o preço do procedimento e se o convênio do paciente cobre.",
    travada: false,
    ferramenta: "buscar_procedimento",
    padrao: true,
  },
  {
    chave: "passar_para_equipe",
    titulo: "Passar para a equipe",
    descricao:
      "Passa a conversa para a recepção quando não pode ou não deve responder.",
    travada: true,
    ferramenta: "escalar_humano",
    padrao: true,
  },
] as const satisfies readonly HabilidadeDoAgente[];

export type ChaveDaHabilidade = (typeof HABILIDADES_DO_AGENTE)[number]["chave"];

export type HabilidadesDoAgente = Record<ChaveDaHabilidade, boolean>;

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * O que vale de fato a partir do jsonb `skills` (ou da entrada da tela):
 * chave desconhecida e ignorada, travada vale sempre ligada, ausente ou nao
 * booleana vale o padrao. Nunca lanca.
 */
export function habilidadesEfetivas(valor: unknown): HabilidadesDoAgente {
  const objeto = ehObjeto(valor) ? valor : {};
  const resultado = {} as HabilidadesDoAgente;
  for (const habilidade of HABILIDADES_DO_AGENTE) {
    const escolhido = objeto[habilidade.chave];
    resultado[habilidade.chave] = habilidade.travada
      ? true
      : typeof escolhido === "boolean"
        ? escolhido
        : habilidade.padrao;
  }
  return resultado;
}

/**
 * As ferramentas que o modelo recebe, na ordem da lista (estavel para o
 * cache). escalar_humano sempre vem: a habilidade e travada.
 */
export function ferramentasDoAgente(
  habilidades: Readonly<Record<string, boolean>>,
): FerramentaDoAgente[] {
  const efetivas = habilidadesEfetivas(habilidades);
  const ferramentas: FerramentaDoAgente[] = [];
  for (const habilidade of HABILIDADES_DO_AGENTE) {
    if (habilidade.ferramenta !== null && efetivas[habilidade.chave]) {
      ferramentas.push(habilidade.ferramenta);
    }
  }
  return ferramentas;
}

/**
 * Entrada da aba Habilidades: um objeto { chave: boolean }. Chave
 * desconhecida e descartada; valor nao booleano numa chave conhecida e erro.
 * A saida ja e o objeto efetivo (travadas ligadas), pronto para o banco.
 */
export const habilidadesSchema = z
  .record(z.string(), z.unknown())
  .superRefine((valor, ctx) => {
    for (const habilidade of HABILIDADES_DO_AGENTE) {
      const escolhido = valor[habilidade.chave];
      if (escolhido !== undefined && typeof escolhido !== "boolean") {
        ctx.addIssue({
          code: "custom",
          path: [habilidade.chave],
          message: "Escolha ligada ou desligada.",
        });
      }
    }
  })
  .transform((valor) => habilidadesEfetivas(valor));

// ---------------------------------------------------------------------------
// Horario de operacao
// ---------------------------------------------------------------------------

/** Indice = Date.getDay() (0 = domingo). */
export const DIAS_DA_SEMANA = [
  "dom",
  "seg",
  "ter",
  "qua",
  "qui",
  "sex",
  "sab",
] as const;
export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

export const ROTULO_DO_DIA: Readonly<Record<DiaDaSemana, string>> = {
  dom: "Domingo",
  seg: "Segunda-feira",
  ter: "Terça-feira",
  qua: "Quarta-feira",
  qui: "Quinta-feira",
  sex: "Sexta-feira",
  sab: "Sábado",
};

export const ROTULO_CURTO_DO_DIA: Readonly<Record<DiaDaSemana, string>> = {
  dom: "Dom",
  seg: "Seg",
  ter: "Ter",
  qua: "Qua",
  qui: "Qui",
  sex: "Sex",
  sab: "Sáb",
};

/** Espelho do CHECK ai_agent_config_modo_valido. */
export const MODOS_DE_OPERACAO = [
  "24h",
  "fora_expediente",
  "fallback",
] as const;
export type ModoDeOperacao = (typeof MODOS_DE_OPERACAO)[number];

export const ROTULO_DO_MODO: Readonly<Record<ModoDeOperacao, string>> = {
  "24h": "24 horas",
  fora_expediente: "Só fora do expediente",
  fallback: "Se a equipe não responder",
};

function textoDeMinutos(minutos: number): string {
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`;
}

/** A linha que explica cada modo na aba Regras e limites. */
export function descricaoDoModo(
  modo: ModoDeOperacao,
  minutosSemResposta: number,
): string {
  switch (modo) {
    case "24h":
      return "O assistente responde a qualquer hora, todos os dias.";
    case "fora_expediente":
      return "O assistente responde só fora do expediente abaixo. No expediente, quem responde é a equipe.";
    case "fallback":
      return `O assistente responde quando ninguém da equipe responder em ${textoDeMinutos(minutosSemResposta)}.`;
  }
}

/** "HH:mm", 00:00 a 23:59. */
export const HORA_DO_EXPEDIENTE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type FaixaDoDia = {
  aberto: boolean;
  /** "HH:mm", no fuso da clinica. */
  inicio: string;
  /** "HH:mm", exclusivo; sempre depois do inicio (sem virar a noite). */
  fim: string;
};

export type ExpedienteDaSemana = Record<DiaDaSemana, FaixaDoDia>;

export type HorarioDeOperacao = {
  modo: ModoDeOperacao;
  /** fallback_minutes: so vale no modo "fallback". */
  minutosSemResposta: number;
  /** operating_hours: so vale no modo "fora_expediente". */
  expediente: ExpedienteDaSemana;
};

/**
 * Grade inicial da tela quando a clinica ainda nao salvou nenhuma: segunda a
 * sexta, das 08:00 as 18:00. So o desenho do formulario (o modo padrao e
 * 24h, em que a grade nao vale).
 */
export function expedientePadrao(): ExpedienteDaSemana {
  const util = (): FaixaDoDia => ({
    aberto: true,
    inicio: "08:00",
    fim: "18:00",
  });
  const fechado = (): FaixaDoDia => ({
    aberto: false,
    inicio: "08:00",
    fim: "18:00",
  });
  return {
    dom: fechado(),
    seg: util(),
    ter: util(),
    qua: util(),
    qui: util(),
    sex: util(),
    sab: fechado(),
  };
}

/** Os padroes do banco (operating_mode '24h', fallback_minutes 5). */
export function horarioPadrao(): HorarioDeOperacao {
  return { modo: "24h", minutosSemResposta: 5, expediente: expedientePadrao() };
}

const ERRO_DA_HORA = "Use a hora no formato 08:00.";
const ERRO_DOS_MINUTOS = `Use de ${MINUTOS_SEM_RESPOSTA.minimo} a ${MINUTOS_SEM_RESPOSTA.maximo} minutos.`;

/** As horas que a grade usa quando a do dia nao serve (expedientePadrao). */
const INICIO_PADRAO_DO_DIA = "08:00";
const FIM_PADRAO_DO_DIA = "18:00";

function horaValida(valor: unknown): valor is string {
  return typeof valor === "string" && HORA_DO_EXPEDIENTE.test(valor);
}

/**
 * Um dia da grade. Dia FECHADO nao valida as horas (os campos ficam
 * escondidos na tela e a pessoa nao tem como corrigir) e nao perde as que
 * estao no formato, mesmo com o fim antes do inicio: elas voltam quando o
 * dia reabre. Hora fora do formato num dia fechado vira a padrao, para o
 * banco nunca guardar lixo. Dia ABERTO exige as duas no formato (e o fim
 * depois do inicio, no superRefine do horario).
 */
const faixaDoDiaSchema = z
  .object({
    aberto: z.boolean(),
    inicio: z.string().max(16, { error: ERRO_DA_HORA }),
    fim: z.string().max(16, { error: ERRO_DA_HORA }),
  })
  .superRefine((faixa, ctx) => {
    if (!faixa.aberto) {
      return;
    }
    for (const campo of ["inicio", "fim"] as const) {
      if (!horaValida(faixa[campo])) {
        ctx.addIssue({ code: "custom", path: [campo], message: ERRO_DA_HORA });
      }
    }
  })
  .transform((faixa): FaixaDoDia =>
    faixa.aberto
      ? faixa
      : {
          aberto: false,
          inicio: horaValida(faixa.inicio)
            ? faixa.inicio
            : INICIO_PADRAO_DO_DIA,
          fim: horaValida(faixa.fim) ? faixa.fim : FIM_PADRAO_DO_DIA,
        },
  );

export const horarioSchema = z
  .object({
    modo: z.enum(MODOS_DE_OPERACAO, {
      error: "Escolha quando o assistente responde.",
    }),
    minutosSemResposta: z
      .number({ error: ERRO_DOS_MINUTOS })
      .int({ error: ERRO_DOS_MINUTOS })
      .min(MINUTOS_SEM_RESPOSTA.minimo, { error: ERRO_DOS_MINUTOS })
      .max(MINUTOS_SEM_RESPOSTA.maximo, { error: ERRO_DOS_MINUTOS }),
    expediente: z.object({
      dom: faixaDoDiaSchema,
      seg: faixaDoDiaSchema,
      ter: faixaDoDiaSchema,
      qua: faixaDoDiaSchema,
      qui: faixaDoDiaSchema,
      sex: faixaDoDiaSchema,
      sab: faixaDoDiaSchema,
    }),
  })
  .superRefine((horario, ctx) => {
    for (const dia of DIAS_DA_SEMANA) {
      const faixa = horario.expediente[dia];
      if (
        faixa.aberto &&
        HORA_DO_EXPEDIENTE.test(faixa.inicio) &&
        HORA_DO_EXPEDIENTE.test(faixa.fim) &&
        horaParaMinutos(faixa.fim) <= horaParaMinutos(faixa.inicio)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["expediente", dia, "fim"],
          message: `${ROTULO_DO_DIA[dia]}: o fim do expediente precisa ser depois do início.`,
        });
      }
    }
  });

/** Fuso de quando o da clinica nao e valido (CLAUDE.md 3.6). */
const FUSO_DA_CLINICA_PADRAO = "America/Fortaleza";

/** Verdadeiro quando `agoraMs` cai dentro do expediente do dia, no fuso. */
export function estaNoExpediente(
  expediente: ExpedienteDaSemana,
  agoraMs: number,
  fuso: string,
): boolean {
  const instante = new Date(agoraMs);
  const fusoValido = Number.isNaN(weekdayLocal(fuso, instante))
    ? FUSO_DA_CLINICA_PADRAO
    : fuso;
  const indice = weekdayLocal(fusoValido, instante);
  const dia = DIAS_DA_SEMANA[indice];
  if (dia === undefined) {
    return false;
  }
  const faixa = expediente[dia];
  if (
    !faixa.aberto ||
    !HORA_DO_EXPEDIENTE.test(faixa.inicio) ||
    !HORA_DO_EXPEDIENTE.test(faixa.fim)
  ) {
    return false;
  }
  const minutos = minutosLocais(fusoValido, instante);
  return (
    minutos >= horaParaMinutos(faixa.inicio) &&
    minutos < horaParaMinutos(faixa.fim)
  );
}

export type MotivoDeAtender =
  "sempre" | "fora_do_expediente" | "no_expediente" | "espera_a_equipe";

export type DecisaoDeAtender = { atende: boolean; motivo: MotivoDeAtender };

/**
 * Se o agente responde agora, pelo horario de operacao, no fuso da clinica
 * (regra 3.6; `agoraMs` vem de quem chama, nada aqui le o relogio).
 * - 24h: sempre.
 * - fora_expediente: so fora da grade do dia.
 * - fallback: conta como atende (o simulador responde); esperar os X minutos
 *   sem resposta da equipe e trabalho do E3, no WhatsApp.
 * Instante invalido falha FECHADO no modo fora_expediente (quem responde e a
 * equipe); fuso invalido cai no padrao da clinica.
 */
export function agenteAtendeAgora(
  horario: HorarioDeOperacao,
  agoraMs: number,
  fuso: string,
): DecisaoDeAtender {
  if (horario.modo === "24h") {
    return { atende: true, motivo: "sempre" };
  }
  if (horario.modo === "fallback") {
    return { atende: true, motivo: "espera_a_equipe" };
  }
  if (!Number.isFinite(agoraMs)) {
    return { atende: false, motivo: "no_expediente" };
  }
  return estaNoExpediente(horario.expediente, agoraMs, fuso)
    ? { atende: false, motivo: "no_expediente" }
    : { atende: true, motivo: "fora_do_expediente" };
}

// ---------------------------------------------------------------------------
// Escalonamento (passar para a equipe)
// ---------------------------------------------------------------------------

/**
 * Espelho EXATO do CHECK ai_decision_log_escalation_reason_valida (migration
 * 20261006100000). Um teste cruza esta lista com a da migration.
 */
export const MOTIVOS_DE_ESCALONAMENTO = [
  "sintoma",
  "pedido_humano",
  "insatisfacao",
  "menor_de_idade",
  "valor_fora_da_tabela",
  "falhas_seguidas",
  "assunto_clinico",
  "midia_nao_suportada",
  "tentativa_de_manipulacao",
  "conformidade",
  "agente_pediu",
  "teto_atingido",
  "regra_do_procedimento",
] as const;
export type MotivoDeEscalonamento = (typeof MOTIVOS_DE_ESCALONAMENTO)[number];

/**
 * Como a trilha do simulador e o log da conversa dizem cada motivo ("Passou
 * para a equipe: o paciente descreveu um sintoma"). Nunca cita o texto do
 * paciente.
 */
export const ROTULO_DO_MOTIVO_DE_ESCALONAMENTO: Readonly<
  Record<MotivoDeEscalonamento, string>
> = {
  sintoma: "o paciente descreveu um sintoma",
  pedido_humano: "o paciente pediu para falar com uma pessoa",
  insatisfacao: "o paciente demonstrou insatisfação",
  menor_de_idade: "o paciente é menor de idade",
  valor_fora_da_tabela: "o assunto envolve valor fora da tabela",
  falhas_seguidas: "o assistente não resolveu em duas tentativas",
  assunto_clinico: "o assunto é clínico",
  midia_nao_suportada: "o paciente mandou um conteúdo que o assistente não lê",
  tentativa_de_manipulacao:
    "a mensagem tentou mudar o comportamento do assistente",
  conformidade: "a resposta não passou na conformidade",
  agente_pediu: "o assistente preferiu passar para a equipe",
  teto_atingido: "o limite de gasto de hoje acabou",
  regra_do_procedimento: "o procedimento pede contato da equipe",
};

/**
 * Os 6 gatilhos obrigatorios de passar para a equipe (spec, Modulo 1;
 * docs/03). So exibicao, travados: a clinica nao desliga nenhum. Quem decide
 * e o codigo (portao de entrada e escalar_humano), nao esta lista.
 */
export const GATILHOS_OBRIGATORIOS = [
  { chave: "sintoma", rotulo: "O paciente descreve um sintoma" },
  {
    chave: "pedido_humano",
    rotulo: "O paciente pede para falar com uma pessoa",
  },
  { chave: "insatisfacao", rotulo: "O paciente demonstra insatisfação" },
  {
    chave: "falhas_seguidas",
    rotulo: "O assistente não resolve depois de duas tentativas",
  },
  {
    chave: "valor_fora_da_tabela",
    rotulo: "O assunto envolve valor fora da tabela",
  },
  { chave: "menor_de_idade", rotulo: "O paciente é menor de idade" },
] as const satisfies readonly {
  chave: MotivoDeEscalonamento;
  rotulo: string;
}[];

// ---------------------------------------------------------------------------
// Conformidade (caixa travada da aba Regras e limites)
// ---------------------------------------------------------------------------

/** Uma chave travada por vedacao do CFM que o filtro de saida aplica. */
export const ROTULO_DA_TRAVA: Readonly<Record<CategoriaClinica, string>> = {
  triagem: "Não faz triagem de sintoma",
  diagnostico: "Não dá diagnóstico",
  orientacao_clinica: "Não dá orientação clínica",
  medicamento: "Não indica medicamento",
  dosagem: "Não indica dose",
  promessa_resultado: "Não promete resultado",
  oferta_casada: "Não faz oferta casada",
  antes_depois: "Não usa antes e depois",
};

/**
 * O texto da caixa do brief (docs/02, Tela 6, bloco de Conformidade), igual
 * ao aprovado, e as 8 vedacoes do filtro (categorias.ts) com rotulo.
 */
export const TEXTO_DA_CONFORMIDADE = {
  titulo: "Conformidade",
  texto:
    "Estas travas são obrigatórias e não podem ser desligadas: o agente não faz triagem de sintoma, não indica tratamento ou medicamento, não promete resultado, e não faz oferta casada. Base: Resoluções CFM 2.314/2022 e 2.336/2023.",
  dica: DICA_DE_OBRIGATORIA,
  travas: CATEGORIAS_CLINICAS.map((categoria) => ({
    categoria,
    rotulo: ROTULO_DA_TRAVA[categoria],
  })),
} as const;

// ---------------------------------------------------------------------------
// Persona, base e instrucoes (schemas)
// ---------------------------------------------------------------------------

/**
 * Nome do assistente: letras, com espaco, apostrofo ou hifen entre palavras
 * ("Ana Clara", "Maria-Luísa", "D'Ávila"). Sem numero, ponto ou simbolo.
 */
export const NOME_DO_AGENTE_VALIDO =
  /^\p{L}[\p{L}\p{M}]*(?:(?: +|['’-])\p{L}[\p{L}\p{M}]*)*$/u;

function textoOpcional(limite: number, erro: string) {
  return z
    .string()
    .trim()
    .max(limite, { error: erro })
    .nullable()
    .transform((valor) => (valor === null || valor === "" ? null : valor));
}

export const personaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, { error: "Dê um nome ao assistente." })
    .max(LIMITES_DO_AGENTE.nome, {
      error: `O nome vai até ${LIMITES_DO_AGENTE.nome} caracteres.`,
    })
    .regex(NOME_DO_AGENTE_VALIDO, {
      error: "Use só letras e espaços no nome, sem números ou símbolos.",
    }),
  tom: z.enum(TONS_DO_AGENTE, { error: "Escolha o tom de voz." }),
  usarEmoji: z.boolean(),
  /** Vazio vira nulo (sem saudacao). */
  saudacao: textoOpcional(
    LIMITES_DO_AGENTE.saudacao,
    `A saudação vai até ${LIMITES_DO_AGENTE.saudacao} caracteres.`,
  ),
  /** Vazio vira nulo (sem encerramento). */
  encerramento: textoOpcional(
    LIMITES_DO_AGENTE.encerramento,
    `O encerramento vai até ${LIMITES_DO_AGENTE.encerramento} caracteres.`,
  ),
});

export type PersonaDoAgente = z.output<typeof personaSchema>;

export const itemDaBaseSchema = z.object({
  /** nulo = criar; preenchido = editar o existente */
  id: z.uuid().nullable(),
  pergunta: z
    .string()
    .trim()
    .min(1, { error: "Escreva a pergunta." })
    .max(LIMITES_DO_AGENTE.pergunta, {
      error: `A pergunta vai até ${LIMITES_DO_AGENTE.pergunta} caracteres.`,
    }),
  resposta: z
    .string()
    .trim()
    .min(1, { error: "Escreva a resposta." })
    .max(LIMITES_DO_AGENTE.resposta, {
      error: `A resposta vai até ${LIMITES_DO_AGENTE.resposta} caracteres.`,
    }),
  ativo: z.boolean(),
});

export type ItemDaBaseEntrada = z.output<typeof itemDaBaseSchema>;

/** Instrucoes do assistente (so super admin). Vazio vira nulo. */
export const instrucoesSchema = z.object({
  instrucoes: textoOpcional(
    LIMITES_DO_AGENTE.instrucoes,
    `As instruções vão até ${LIMITES_DO_AGENTE.instrucoes} caracteres.`,
  ),
});

export type InstrucoesEntrada = z.output<typeof instrucoesSchema>;

// ---------------------------------------------------------------------------
// Texto da clinica contra o filtro do CFM
// ---------------------------------------------------------------------------

/** Os campos de texto livre que passam por problemaNoTextoDoAgente. */
export const CAMPOS_DE_TEXTO_DO_AGENTE = [
  "nome",
  "saudacao",
  "encerramento",
  "pergunta",
  "resposta",
  "instrucoes",
] as const;
export type CampoDeTextoDoAgente = (typeof CAMPOS_DE_TEXTO_DO_AGENTE)[number];

export const ROTULO_DO_CAMPO_DE_TEXTO: Readonly<
  Record<CampoDeTextoDoAgente, string>
> = {
  nome: "Nome do assistente",
  saudacao: "Saudação",
  encerramento: "Encerramento",
  pergunta: "Pergunta",
  resposta: "Resposta",
  instrucoes: "Instruções do assistente",
};

/** Campos que podem ficar vazios (vazio = sem texto, nada a conferir). */
const CAMPOS_OPCIONAIS: ReadonlySet<CampoDeTextoDoAgente> = new Set([
  "saudacao",
  "encerramento",
  "instrucoes",
]);

const AVISO_DO_CFM_NAS_INSTRUCOES =
  " As travas do CFM já valem sempre: não precisa escrevê-las aqui.";

const MENSAGEM_DA_CATEGORIA: Readonly<Record<CategoriaDeConformidade, string>> =
  {
    triagem:
      "Tire a parte sobre sintomas: o assistente não faz triagem (Resolução CFM 2.314/2022). Quando o paciente fala de sintoma, a conversa passa para a equipe.",
    diagnostico:
      "Tire a parte que fala de diagnóstico: o assistente não diagnostica (Resolução CFM 2.314/2022).",
    orientacao_clinica:
      "Tire a orientação de cuidado ou de preparo: o assistente não dá orientação clínica (Resolução CFM 2.314/2022). Essa dúvida vai para a equipe.",
    medicamento: "Tire o nome do remédio: o assistente não indica medicamento.",
    dosagem:
      "Tire a dose ou o horário de uso: o assistente não indica dosagem.",
    promessa_resultado:
      "Tire a promessa ou a garantia de resultado: o assistente não pode prometer resultado (Resolução CFM 2.336/2023).",
    oferta_casada:
      "Tire a oferta casada (um procedimento junto de outro, de brinde ou como condição): o assistente não pode oferecer (Resolução CFM 2.336/2023).",
    antes_depois:
      "Tire a menção a antes e depois, casos reais ou depoimentos: a publicidade médica não permite (Resolução CFM 2.336/2023).",
    preco_nao_verificado:
      "Tire o valor: o preço vem do Cadastro, e o assistente consulta na hora.",
    formato_invalido:
      "Reescreva o texto de um jeito simples: do jeito que está, o assistente não pode mandar.",
    falha_verificador: "Não deu para conferir o texto agora. Tente de novo.",
  };

const MENSAGEM_DE_OFUSCACAO =
  "Escreva o texto normalmente: sem símbolos no meio das palavras, letras separadas por espaço ou caracteres especiais.";

const MENSAGEM_DO_LINK =
  "Tire o link ou o endereço do site: o assistente não pode mandar link.";

/** Mensagem por regra (nome da regra do filtro, nunca o trecho do texto). */
const MENSAGEM_DA_REGRA: Readonly<Record<string, string>> = {
  percentual:
    "Tire a porcentagem (%): o assistente não fala de porcentagem nem de desconto.",
  desconto_ou_parcela:
    "Tire a menção a desconto ou negociação: o preço vem do Cadastro e o assistente não negocia valor.",
  moeda_estrangeira:
    "Tire o valor em moeda estrangeira: o preço vem do Cadastro, em reais.",
  url: MENSAGEM_DO_LINK,
  url_espacada: MENSAGEM_DO_LINK,
  arroba:
    "Tire o @ e o perfil de rede social: o assistente não pode mandar perfil nem e-mail.",
  contato_fora_da_conversa:
    "Tire o convite para falar por outro canal: a conversa com o paciente continua no WhatsApp.",
  marcacao:
    "Tire os símbolos de marcação (como < >, { }, [ ], crase ou ##): o assistente responde só com texto simples.",
  identificador_de_codigo:
    "Tire o código ou a palavra com sublinhado (_): o assistente não pode mandar texto com cara de sistema.",
  fala_de_bastidor:
    "Tire as palavras sobre o funcionamento do assistente (como instruções, regras internas ou diretrizes): ele não fala disso com o paciente.",
  emoji_clinico:
    "Tire o emoji de remédio, injeção, termômetro, bebida ou cigarro: o assistente não pode mandar esse emoji.",
  contato_por_extenso:
    "Tire o número escrito por extenso: o assistente não pode mandar telefone nem documento, nem por extenso.",
  vazio: "Escreva o texto.",
  longo: "O texto está longo demais para uma mensagem de WhatsApp.",
  alfabeto_estranho: MENSAGEM_DE_OFUSCACAO,
  caractere_invisivel: MENSAGEM_DE_OFUSCACAO,
  marcas_empilhadas: MENSAGEM_DE_OFUSCACAO,
  letra_fora_do_alfabeto: MENSAGEM_DE_OFUSCACAO,
  simbolo_entre_letras: MENSAGEM_DE_OFUSCACAO,
  letras_soltas: MENSAGEM_DE_OFUSCACAO,
};

/**
 * Dentro do formato, a ordem em que as mensagens aparecem: o que a pessoa
 * reconhece primeiro (telefone, link) antes do sinal estrutural que costuma
 * vir junto ("buscar_procedimento" dispara simbolo_entre_letras E
 * identificador_de_codigo; a mensagem certa e a do codigo).
 */
const ORDEM_DAS_REGRAS_DE_FORMATO: readonly string[] = [
  "vazio",
  "dado_pessoal",
  "contato_por_extenso",
  "url",
  "url_espacada",
  "arroba",
  "contato_fora_da_conversa",
  "fala_de_bastidor",
  "identificador_de_codigo",
  "marcacao",
  "emoji_clinico",
  "alfabeto_estranho",
  "caractere_invisivel",
  "marcas_empilhadas",
  "letra_fora_do_alfabeto",
  "simbolo_entre_letras",
  "letras_soltas",
  "longo",
];

type TipoDeDadoPessoal =
  "telefone" | "cep" | "email" | "cpf" | "numero" | "cnpj";

/** Em ordem: o CNPJ por ultimo (com mascara ele e permitido). */
const TIPOS_DE_DADO_PESSOAL: readonly TipoDeDadoPessoal[] = [
  "telefone",
  "cep",
  "email",
  "cpf",
  "numero",
  "cnpj",
];

const MENSAGEM_DO_DADO_PESSOAL: Readonly<Record<TipoDeDadoPessoal, string>> = {
  telefone:
    "Tire o telefone: o assistente não pode mandar telefone. A conversa com o paciente já acontece pelo WhatsApp.",
  cep: "Tire o CEP: o assistente não pode mandar CEP. Rua, número e bairro podem ficar.",
  email: "Tire o e-mail: o assistente não pode mandar e-mail.",
  cpf: "Tire o CPF: o assistente não pode mandar CPF.",
  numero:
    "Tire o número longo: o assistente não pode mandar número de documento, cartão ou carteirinha.",
  cnpj: "Escreva o CNPJ com pontos, barra e traço (00.000.000/0000-00) ou tire o número.",
};

const MENSAGEM_DO_DADO_PESSOAL_GENERICA =
  "Tire o número de contato ou de documento: o assistente não pode mandar dado pessoal.";

/**
 * Qual dado pessoal o filtro achou, pela mesma minimizacao que ele usa
 * (minimizar.ts): o marcador que aparece diz o tipo. Nulo quando so a visao
 * despacada do filtro achou (numero com letras no meio).
 */
function tipoDoDadoPessoal(texto: string): TipoDeDadoPessoal | null {
  const minimizado = minimizarParaLlm(normalizarBase(texto));
  for (const tipo of TIPOS_DE_DADO_PESSOAL) {
    if (minimizado.includes(`[${tipo}]`)) {
      return tipo;
    }
  }
  return null;
}

// Titulo de profissional de saude no nome do assistente ("Dra. Ana",
// "Enfermeira Bia"): o assistente e da recepcao e nao pode se apresentar como
// quem faz ato de saude. Palavras ja normalizadas (sem acento, minusculas).
const TITULOS_DE_PROFISSIONAL: ReadonlySet<string> = new Set([
  "dr",
  "dra",
  "doutor",
  "doutora",
  "doc",
  "doctor",
  "medico",
  "medica",
  "enfermeiro",
  "enfermeira",
  "enf",
  "enfa",
  "psicologo",
  "psicologa",
  "nutricionista",
  "fisioterapeuta",
  "dentista",
  "biomedico",
  "biomedica",
  "farmaceutico",
  "farmaceutica",
  "terapeuta",
]);

const MENSAGEM_DO_TITULO =
  "Tire o título do nome (como Dra. ou enfermeira): o assistente é da recepção e não pode se apresentar como profissional de saúde.";

function temTituloDeProfissional(nome: string): boolean {
  return normalizarBase(nome)
    .split(/[^a-z]+/)
    .some((palavra) => TITULOS_DE_PROFISSIONAL.has(palavra));
}

export type ProblemaNoTexto = {
  /** Categoria do filtro; "titulo" e a regra do nome, fora do filtro. */
  categoria: CategoriaDeConformidade | "titulo";
  /** Nome da regra (nunca o trecho do texto): pode ir para log e auditoria. */
  regra: string;
  /** O que a pessoa precisa mudar, em texto de recepcionista. */
  mensagem: string;
};

function mensagemDoAchado(
  achado: AchadoDaRegra,
  texto: string,
  campo: CampoDeTextoDoAgente,
): string {
  if (achado.regra === "dado_pessoal") {
    const tipo = tipoDoDadoPessoal(texto);
    return tipo === null
      ? MENSAGEM_DO_DADO_PESSOAL_GENERICA
      : MENSAGEM_DO_DADO_PESSOAL[tipo];
  }
  const daRegra = MENSAGEM_DA_REGRA[achado.regra];
  const mensagem = daRegra ?? MENSAGEM_DA_CATEGORIA[achado.categoria];
  const ehDoCfm = (CATEGORIAS_CLINICAS as readonly string[]).includes(
    achado.categoria,
  );
  return campo === "instrucoes" && ehDoCfm
    ? `${mensagem}${AVISO_DO_CFM_NAS_INSTRUCOES}`
    : mensagem;
}

function posicaoDoAchado(achado: AchadoDaRegra): [number, number] {
  const categoria = CATEGORIAS_DE_CONFORMIDADE.indexOf(achado.categoria);
  const regra = ORDEM_DAS_REGRAS_DE_FORMATO.indexOf(achado.regra);
  return [categoria, regra === -1 ? ORDEM_DAS_REGRAS_DE_FORMATO.length : regra];
}

/**
 * Todos os problemas do texto, sem repetir mensagem, do mais importante para
 * o menos: vedacoes do CFM, preco, formato. Roda as regras deterministicas
 * do filtro de saida (avaliarRegras) com contexto VAZIO: sem preco do turno
 * (todo valor em reais e problema: o preco vem do Cadastro), sem catalogo e
 * sem mensagem de paciente.
 *
 * Por campo:
 * - instrucoes: o tamanho do filtro (700) nao vale (o teto delas e 2.000, e
 *   elas vao ao modelo, nao ao paciente); o resto vale, porque o modelo pode
 *   repetir qualquer trecho;
 * - nome: alem do filtro, nada de titulo de profissional de saude;
 * - campo opcional vazio nao tem problema (vazio = sem texto).
 */
export function problemasNoTextoDoAgente(
  texto: string,
  campo: CampoDeTextoDoAgente,
): ProblemaNoTexto[] {
  if (texto.trim() === "") {
    return CAMPOS_OPCIONAIS.has(campo)
      ? []
      : [
          {
            categoria: "formato_invalido",
            regra: "vazio",
            mensagem: MENSAGEM_DA_REGRA.vazio ?? "Escreva o texto.",
          },
        ];
  }
  const problemas: ProblemaNoTexto[] = [];
  const vistas = new Set<string>();
  const anotar = (problema: ProblemaNoTexto) => {
    if (!vistas.has(problema.mensagem)) {
      vistas.add(problema.mensagem);
      problemas.push(problema);
    }
  };

  const { achados } = avaliarRegras(texto, {
    precosDoTurno: [],
    nomesDoCatalogo: [],
    mensagensDoPaciente: [],
  });
  const ordenados = achados
    .filter((achado) => !(campo === "instrucoes" && achado.regra === "longo"))
    .map((achado, indice) => ({ achado, indice }))
    .sort((a, b) => {
      const [ca, ra] = posicaoDoAchado(a.achado);
      const [cb, rb] = posicaoDoAchado(b.achado);
      return ca - cb || ra - rb || a.indice - b.indice;
    });

  if (campo === "nome" && temTituloDeProfissional(texto)) {
    anotar({
      categoria: "titulo",
      regra: "titulo_de_profissional",
      mensagem: MENSAGEM_DO_TITULO,
    });
  }
  for (const { achado } of ordenados) {
    anotar({
      categoria: achado.categoria,
      regra: achado.regra,
      mensagem: mensagemDoAchado(achado, texto, campo),
    });
  }
  return problemas;
}

/**
 * O primeiro problema do texto em texto de recepcionista ("Tire o telefone:
 * o assistente não pode mandar telefone. ..."), ou nulo quando as regras nao
 * acham nada. Nulo NAO e aprovacao: em producao a resposta ainda passa pelo
 * filtro de saida inteiro, com o verificador por modelo.
 *
 * Usado ao salvar saudacao, encerramento, nome, item da base e instrucoes, e
 * ao publicar (problemasDaPublicacao).
 */
export function problemaNoTextoDoAgente(
  texto: string,
  campo: CampoDeTextoDoAgente,
): string | null {
  return problemasNoTextoDoAgente(texto, campo)[0]?.mensagem ?? null;
}

// ---------------------------------------------------------------------------
// Configuracao (o que a tela e o motor usam)
// ---------------------------------------------------------------------------

export type StatusDaConfig = "rascunho" | "publicada";

export type ItemDaBase = {
  id: string;
  pergunta: string;
  resposta: string;
  ativo: boolean;
};

export type ConfigDoAgente = {
  versao: number;
  status: StatusDaConfig;
  nome: string;
  tom: TomDoAgente;
  usarEmoji: boolean;
  saudacao: string | null;
  encerramento: string | null;
  /** Ja efetivas (habilidadesEfetivas): travadas ligadas, chaves conhecidas. */
  habilidades: Record<string, boolean>;
  horario: HorarioDeOperacao;
  /**
   * So no servidor (motor) e para o super admin. Para os outros papeis chega
   * nulo: a sessao nao tem grant na coluna.
   */
  instrucoes: string | null;
  /**
   * Rascunho: a base viva (knowledge_item, com ativas e inativas).
   * Publicada: o snapshot congelado (`conhecimento`), todas ativas.
   */
  base: ItemDaBase[];
};

/** Os padroes do banco, para o rascunho que nasce sem versao publicada. */
export function configPadraoDoAgente(): ConfigDoAgente {
  return {
    versao: 1,
    status: "rascunho",
    nome: "Assistente",
    tom: "cordial",
    usarEmoji: false,
    saudacao: null,
    encerramento: null,
    habilidades: habilidadesEfetivas({}),
    horario: horarioPadrao(),
    instrucoes: null,
    base: [],
  };
}

/** A linha de ai_agent_config como o banco devolve (colunas explicitas). */
export type LinhaDaConfigDoAgente = {
  version: number;
  status: string;
  agent_name: string;
  tone: string;
  use_emoji: boolean;
  greeting: string | null;
  closing: string | null;
  skills: unknown;
  operating_mode: string;
  fallback_minutes: number | null;
  operating_hours: unknown;
};

function ehTom(valor: unknown): valor is TomDoAgente {
  return (
    typeof valor === "string" &&
    (TONS_DO_AGENTE as readonly string[]).includes(valor)
  );
}

function ehModo(valor: unknown): valor is ModoDeOperacao {
  return (
    typeof valor === "string" &&
    (MODOS_DE_OPERACAO as readonly string[]).includes(valor)
  );
}

/**
 * Um dia do jsonb. A ida e a volta preservam `aberto`: dia fechado continua
 * fechado e guarda as horas que estao no formato (mesmo com o fim antes do
 * inicio, que so vale para dia aberto); dia aberto com hora fora do formato
 * ou com o fim antes do inicio continua aberto, nas horas padrao. So o que
 * nem diz se o dia abre cai no padrao do dia.
 */
function faixaDoBanco(valor: unknown, padrao: FaixaDoDia): FaixaDoDia {
  if (!ehObjeto(valor)) {
    return padrao;
  }
  const { aberto, inicio, fim } = valor;
  if (typeof aberto !== "boolean") {
    return padrao;
  }
  if (!aberto) {
    return {
      aberto: false,
      inicio: horaValida(inicio) ? inicio : padrao.inicio,
      fim: horaValida(fim) ? fim : padrao.fim,
    };
  }
  if (
    horaValida(inicio) &&
    horaValida(fim) &&
    horaParaMinutos(fim) > horaParaMinutos(inicio)
  ) {
    return { aberto: true, inicio, fim };
  }
  return { aberto: true, inicio: padrao.inicio, fim: padrao.fim };
}

/**
 * operating_mode, fallback_minutes e operating_hours (o jsonb guarda o
 * expediente: { dom: {aberto, inicio, fim}, seg: ..., ... }) para o
 * horario. Valor fora do formato cai no padrao daquele pedaco; nunca lanca.
 */
export function horarioDoBanco(linha: {
  operating_mode: string;
  fallback_minutes: number | null;
  operating_hours: unknown;
}): HorarioDeOperacao {
  const padrao = horarioPadrao();
  const minutos = linha.fallback_minutes;
  const horas = ehObjeto(linha.operating_hours) ? linha.operating_hours : {};
  const expediente = {} as ExpedienteDaSemana;
  for (const dia of DIAS_DA_SEMANA) {
    expediente[dia] = faixaDoBanco(horas[dia], padrao.expediente[dia]);
  }
  return {
    modo: ehModo(linha.operating_mode) ? linha.operating_mode : padrao.modo,
    minutosSemResposta:
      typeof minutos === "number" && Number.isInteger(minutos) && minutos > 0
        ? minutos
        : padrao.minutosSemResposta,
    expediente,
  };
}

/** O horario nas colunas do banco (o inverso de horarioDoBanco). */
export function horarioParaOBanco(horario: HorarioDeOperacao): {
  operating_mode: ModoDeOperacao;
  fallback_minutes: number;
  operating_hours: ExpedienteDaSemana;
} {
  const operatingHours = {} as ExpedienteDaSemana;
  for (const dia of DIAS_DA_SEMANA) {
    const { aberto, inicio, fim } = horario.expediente[dia];
    operatingHours[dia] = { aberto, inicio, fim };
  }
  return {
    operating_mode: horario.modo,
    fallback_minutes: horario.minutosSemResposta,
    operating_hours: operatingHours,
  };
}

/** A persona nas colunas do banco. */
export function personaParaOBanco(persona: PersonaDoAgente): {
  agent_name: string;
  tone: TomDoAgente;
  use_emoji: boolean;
  greeting: string | null;
  closing: string | null;
} {
  return {
    agent_name: persona.nome,
    tone: persona.tom,
    use_emoji: persona.usarEmoji,
    greeting: persona.saudacao,
    closing: persona.encerramento,
  };
}

function textoOuNulo(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/**
 * O snapshot `conhecimento` da versao publicada ([{id, pergunta, resposta}],
 * so as ativas, na ordem) para ItemDaBase. Entrada fora do formato e
 * descartada; nunca lanca.
 */
export function baseDoConhecimento(valor: unknown): ItemDaBase[] {
  if (!Array.isArray(valor)) {
    return [];
  }
  const itens: ItemDaBase[] = [];
  for (const entrada of valor) {
    if (!ehObjeto(entrada)) {
      continue;
    }
    const { id, pergunta, resposta } = entrada;
    if (
      typeof id === "string" &&
      typeof pergunta === "string" &&
      typeof resposta === "string" &&
      pergunta.trim() !== "" &&
      resposta.trim() !== ""
    ) {
      itens.push({ id, pergunta, resposta, ativo: true });
    }
  }
  return itens;
}

/**
 * Linha do banco para ConfigDoAgente. A base vem de fora (knowledge_item
 * para o rascunho, baseDoConhecimento para a publicada); as instrucoes so
 * quando quem chama pode le-las (servidor ou super admin).
 */
export function configDaLinha(
  linha: LinhaDaConfigDoAgente,
  extras: { base: ItemDaBase[]; instrucoes?: string | null },
): ConfigDoAgente {
  const padrao = configPadraoDoAgente();
  return {
    versao: linha.version,
    status: linha.status === "publicada" ? "publicada" : "rascunho",
    nome: textoOuNulo(linha.agent_name) ?? padrao.nome,
    tom: ehTom(linha.tone) ? linha.tone : padrao.tom,
    usarEmoji: linha.use_emoji === true,
    saudacao: textoOuNulo(linha.greeting),
    encerramento: textoOuNulo(linha.closing),
    habilidades: habilidadesEfetivas(linha.skills),
    horario: horarioDoBanco(linha),
    instrucoes: textoOuNulo(extras.instrucoes),
    base: extras.base,
  };
}

// ---------------------------------------------------------------------------
// Publicacao: o filtro em tudo
// ---------------------------------------------------------------------------

export type ProblemaDaPublicacao = {
  campo: CampoDeTextoDoAgente;
  /** O item da base, quando o problema e numa pergunta ou resposta. */
  itemId: string | null;
  /** Onde esta o problema ("Saudação", "Conhecimento: Tem estacionamento?"). */
  rotulo: string;
  mensagem: string;
};

const LIMITE_DO_TRECHO = 60;

function trecho(texto: string): string {
  const limpo = texto.trim().replace(/\s+/g, " ");
  const letras = Array.from(limpo);
  return letras.length <= LIMITE_DO_TRECHO
    ? limpo
    : `${letras
        .slice(0, LIMITE_DO_TRECHO - 1)
        .join("")
        .trimEnd()}…`;
}

/**
 * Roda problemaNoTextoDoAgente em tudo que a versao vai levar: nome,
 * saudacao, encerramento, instrucoes e cada pergunta e resposta ATIVA da
 * base. Lista vazia = pode publicar (pelas regras; o filtro de saida
 * continua valendo em cada resposta).
 */
export function problemasDaPublicacao(
  config: Pick<
    ConfigDoAgente,
    "nome" | "saudacao" | "encerramento" | "instrucoes" | "base"
  >,
): ProblemaDaPublicacao[] {
  const problemas: ProblemaDaPublicacao[] = [];
  const conferir = (
    texto: string | null,
    campo: CampoDeTextoDoAgente,
    rotulo: string,
    itemId: string | null,
  ) => {
    if (texto === null) {
      return;
    }
    const mensagem = problemaNoTextoDoAgente(texto, campo);
    if (mensagem !== null) {
      problemas.push({ campo, itemId, rotulo, mensagem });
    }
  };
  conferir(config.nome, "nome", ROTULO_DO_CAMPO_DE_TEXTO.nome, null);
  conferir(
    config.saudacao,
    "saudacao",
    ROTULO_DO_CAMPO_DE_TEXTO.saudacao,
    null,
  );
  conferir(
    config.encerramento,
    "encerramento",
    ROTULO_DO_CAMPO_DE_TEXTO.encerramento,
    null,
  );
  conferir(
    config.instrucoes,
    "instrucoes",
    ROTULO_DO_CAMPO_DE_TEXTO.instrucoes,
    null,
  );
  for (const item of config.base) {
    if (!item.ativo) {
      continue;
    }
    const rotulo = `Conhecimento: ${trecho(item.pergunta)}`;
    conferir(item.pergunta, "pergunta", rotulo, item.id);
    conferir(item.resposta, "resposta", rotulo, item.id);
  }
  return problemas;
}

/**
 * O que administrador e gestor leem quando as instrucoes da equipe Conduzza
 * barram a publicacao. Sem o tipo do problema: dizer "tire o telefone"
 * revelaria o que as instrucoes contem, e so o super admin as le (decisao 1
 * do dono). Eles tambem nao tem como corrigir.
 */
export const TEXTO_DAS_INSTRUCOES_A_AJUSTAR =
  "As instruções da equipe Conduzza precisam de ajuste antes de publicar. Fale com a equipe Conduzza.";

/** O mesmo aviso na lista do publicar ("rotulo: mensagem"). */
export const PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA: ProblemaDaPublicacao = {
  campo: "instrucoes",
  itemId: null,
  rotulo: "Instruções da equipe Conduzza",
  mensagem: "Precisam de ajuste antes de publicar. Fale com a equipe Conduzza.",
};

/**
 * Os problemas da publicacao como quem publica pode ve-los: o super admin ve
 * todos, exatos; os outros papeis veem os da clinica exatos e, no lugar dos
 * das instrucoes, um aviso so (PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA), na
 * mesma posicao.
 */
export function problemasParaQuemPublica(
  problemas: readonly ProblemaDaPublicacao[],
  superAdmin: boolean,
): ProblemaDaPublicacao[] {
  if (superAdmin) {
    return [...problemas];
  }
  const visiveis: ProblemaDaPublicacao[] = [];
  let avisou = false;
  for (const problema of problemas) {
    if (problema.campo !== "instrucoes") {
      visiveis.push(problema);
    } else if (!avisou) {
      avisou = true;
      visiveis.push(PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA);
    }
  }
  return visiveis;
}

/** O texto do erro da publicacao: o primeiro problema, como a pessoa ve. */
export function textoDoProblemaDaPublicacao(
  problema: ProblemaDaPublicacao,
): string {
  const ehOAviso =
    problema.campo === PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA.campo &&
    problema.rotulo === PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA.rotulo &&
    problema.mensagem === PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA.mensagem;
  return ehOAviso
    ? TEXTO_DAS_INSTRUCOES_A_AJUSTAR
    : `${problema.rotulo}. ${problema.mensagem}`;
}

// ---------------------------------------------------------------------------
// Diferencas entre o rascunho e a publicada
// ---------------------------------------------------------------------------

export type CampoDaMudanca =
  | "nome"
  | "tom"
  | "usarEmoji"
  | "saudacao"
  | "encerramento"
  | "habilidades"
  | "horario"
  | "instrucoes"
  | "base"
  | "primeira_publicacao";

export type Mudanca = { campo: CampoDaMudanca; rotulo: string };

/**
 * A mudanca das instrucoes, igual para todos os papeis e sem conteudo: quem
 * nao e super admin nao le o texto, mas precisa saber que ele vai junto na
 * publicacao (ou que voltou, no restaurar).
 */
export const MUDANCA_DAS_INSTRUCOES: Mudanca = {
  campo: "instrucoes",
  rotulo: "Instruções da equipe Conduzza",
};

function mesmoTexto(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return textoOuNulo(a) === textoOuNulo(b);
}

/**
 * Mesmas instrucoes (sem espacos nas pontas; vazio = nulo). So o servidor e
 * o super admin tem os dois lados para comparar.
 */
export function mesmasInstrucoes(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return mesmoTexto(a, b);
}

/**
 * As mudancas com a das instrucoes decidida pelo SERVIDOR (que le os dois
 * lados pela service role): tira qualquer "instrucoes" calculada no
 * navegador (para quem nao e super admin ela nunca aparece; para o super
 * admin, uma leitura que falhou criaria uma alteracao fantasma) e poe
 * MUDANCA_DAS_INSTRUCOES quando `mudaram` e true, antes das perguntas da
 * base. null = o servidor nao conseguiu conferir: nao inventa a linha.
 * "Primeira versão do assistente" so fica quando e a unica mudanca.
 */
export function comMudancaDasInstrucoes(
  mudancas: readonly Mudanca[],
  mudaram: boolean | null,
): Mudanca[] {
  const outras = mudancas.filter((m) => m.campo !== "instrucoes");
  if (mudaram !== true) {
    return outras;
  }
  const semPrimeira = outras.filter((m) => m.campo !== "primeira_publicacao");
  const daBase = semPrimeira.findIndex((m) => m.campo === "base");
  const posicao = daBase === -1 ? semPrimeira.length : daBase;
  return [
    ...semPrimeira.slice(0, posicao),
    MUDANCA_DAS_INSTRUCOES,
    ...semPrimeira.slice(posicao),
  ];
}

function mudancasDaBase(
  rascunho: readonly ItemDaBase[],
  publicada: readonly ItemDaBase[],
): Mudanca[] {
  const mudancas: Mudanca[] = [];
  const publicadas = new Map(publicada.map((item) => [item.id, item]));
  const vivas = new Set(rascunho.map((item) => item.id));
  for (const item of rascunho) {
    const anterior = publicadas.get(item.id);
    if (item.ativo && anterior === undefined) {
      // Criada depois da publicacao, ou reativada: as duas entram na proxima.
      mudancas.push({
        campo: "base",
        rotulo: `Pergunta incluída: ${trecho(item.pergunta)}`,
      });
    } else if (item.ativo && anterior !== undefined) {
      if (
        !mesmoTexto(item.pergunta, anterior.pergunta) ||
        !mesmoTexto(item.resposta, anterior.resposta)
      ) {
        mudancas.push({
          campo: "base",
          rotulo: `Pergunta alterada: ${trecho(item.pergunta)}`,
        });
      }
    } else if (!item.ativo && anterior !== undefined) {
      mudancas.push({
        campo: "base",
        rotulo: `Pergunta desativada: ${trecho(item.pergunta)}`,
      });
    }
  }
  for (const anterior of publicada) {
    if (!vivas.has(anterior.id)) {
      mudancas.push({
        campo: "base",
        rotulo: `Pergunta excluída: ${trecho(anterior.pergunta)}`,
      });
    }
  }
  return mudancas;
}

function mudancasDoHorario(
  rascunho: HorarioDeOperacao,
  publicada: HorarioDeOperacao,
): Mudanca[] {
  const mudancas: Mudanca[] = [];
  if (rascunho.modo !== publicada.modo) {
    mudancas.push({
      campo: "horario",
      rotulo: `Horário de operação: ${ROTULO_DO_MODO[rascunho.modo]}`,
    });
  }
  if (rascunho.minutosSemResposta !== publicada.minutosSemResposta) {
    mudancas.push({
      campo: "horario",
      rotulo: `Tempo de espera pela equipe: ${textoDeMinutos(rascunho.minutosSemResposta)}`,
    });
  }
  for (const dia of DIAS_DA_SEMANA) {
    const novo = rascunho.expediente[dia];
    const antigo = publicada.expediente[dia];
    if (
      novo.aberto !== antigo.aberto ||
      (novo.aberto &&
        (novo.inicio !== antigo.inicio || novo.fim !== antigo.fim))
    ) {
      mudancas.push({
        campo: "horario",
        rotulo: `Expediente: ${ROTULO_DO_DIA[dia]}`,
      });
    }
  }
  return mudancas;
}

/**
 * O que o rascunho muda em relacao a versao publicada, para "N alterações
 * não publicadas" e para o "o que mudou" das Versões. Cada habilidade, cada
 * dia do expediente e cada item da base conta como uma mudanca. A base e
 * comparada pelo snapshot da publicada: item criado, reativado, editado,
 * desativado ou excluido conta uma vez.
 *
 * Sem versao publicada, compara com os padroes; se nada mudou, devolve uma
 * mudanca "Primeira versão do assistente" (sempre ha o que publicar).
 *
 * Instrucoes: so contam quando quem chama leu as dos dois lados (o servidor,
 * pela service role); para os outros papeis as duas chegam nulas e nao
 * contam. Na tela, a linha das instrucoes vem do servidor, para todos os
 * papeis (comMudancaDasInstrucoes).
 */
export function diferencasDoRascunho(
  rascunho: ConfigDoAgente,
  publicada: ConfigDoAgente | null,
): Mudanca[] {
  const referencia = publicada ?? configPadraoDoAgente();
  const mudancas: Mudanca[] = [];
  if (!mesmoTexto(rascunho.nome, referencia.nome)) {
    mudancas.push({ campo: "nome", rotulo: "Nome do assistente" });
  }
  if (rascunho.tom !== referencia.tom) {
    mudancas.push({
      campo: "tom",
      rotulo: `Tom de voz: ${ROTULO_DO_TOM[rascunho.tom]}`,
    });
  }
  if (rascunho.usarEmoji !== referencia.usarEmoji) {
    mudancas.push({
      campo: "usarEmoji",
      rotulo: rascunho.usarEmoji ? "Emoji ligado" : "Emoji desligado",
    });
  }
  if (!mesmoTexto(rascunho.saudacao, referencia.saudacao)) {
    mudancas.push({ campo: "saudacao", rotulo: "Saudação" });
  }
  if (!mesmoTexto(rascunho.encerramento, referencia.encerramento)) {
    mudancas.push({ campo: "encerramento", rotulo: "Encerramento" });
  }
  const habilidadesNovas = habilidadesEfetivas(rascunho.habilidades);
  const habilidadesAntigas = habilidadesEfetivas(referencia.habilidades);
  for (const habilidade of HABILIDADES_DO_AGENTE) {
    const ligada = habilidadesNovas[habilidade.chave];
    if (ligada !== habilidadesAntigas[habilidade.chave]) {
      mudancas.push({
        campo: "habilidades",
        rotulo: `${habilidade.titulo}: ${ligada ? "ligada" : "desligada"}`,
      });
    }
  }
  mudancas.push(...mudancasDoHorario(rascunho.horario, referencia.horario));
  if (!mesmoTexto(rascunho.instrucoes, referencia.instrucoes)) {
    mudancas.push(MUDANCA_DAS_INSTRUCOES);
  }
  mudancas.push(...mudancasDaBase(rascunho.base, referencia.base));
  if (publicada === null && mudancas.length === 0) {
    mudancas.push({
      campo: "primeira_publicacao",
      rotulo: "Primeira versão do assistente",
    });
  }
  return mudancas;
}

// ---------------------------------------------------------------------------
// Chaves do TanStack Query
// ---------------------------------------------------------------------------

export const agenteKeys = {
  config: (clinicId: string) => ["agente", "config", clinicId] as const,
  versoes: (clinicId: string) => ["agente", "versoes", clinicId] as const,
  base: (clinicId: string) => ["agente", "base", clinicId] as const,
};
