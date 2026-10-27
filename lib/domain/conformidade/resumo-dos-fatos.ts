// O resumo dos fatos do turno para o verificador por modelo (revisao 2 da
// AG2, 27/10/2026). PURO, zero I/O.
//
// Duas revisoes independentes mostraram que barrar afirmacao de fato so por
// lista de frases vira tapa-buraco: cada rodada acha uma forma nova que
// passa. Desde esta revisao o verificador por modelo (a segunda camada do
// filtro, CLAUDE.md 3.2) tambem julga fato: recebe, alem do rascunho, este
// resumo do que as ferramentas e os textos publicados disseram no turno e
// reprova o rascunho que AFIRMA acao feita, horario livre, cobertura,
// endereco ou requisito que o resumo nao sustenta (acao_nao_executada,
// horario_nao_verificado, cobertura_nao_verificada e
// endereco_nao_verificado, na camada "modelo"). As regras deterministicas
// continuam rodando antes e continuam so bloqueando: aprovar exige as duas.
//
// SEM DADO DE PACIENTE (LGPD, minimizacao). O resumo e montado SO com:
//  - hoje no fuso da clinica (numeros);
//  - as acoes e a consulta lida (listas fechadas, viram rotulos fixos).
//    Revisao final da AG3: com o dia, a hora e a unidade de cada acao
//    (reservou, marcou, remarcou) e de cada consulta lida, no mesmo formato
//    conferido dos horarios livres ("reservou quarta, 21/10 as 14:00,
//    unidade Centro, ainda nao marcada"; "consulta que a pessoa ja tem:
//    terca, 27/10 as 10:00"). Da consulta, so o dia, a hora e a unidade:
//    nunca o profissional nem o procedimento;
//  - os horarios livres da agenda, conferidos no formato exato que
//    buscar_horario e reservar_horario escrevem ("terca, 21/10" e "14:00").
//    Outro formato: o resumo nao monta. AG3 (27/10/2026): com a unidade do
//    horario (nome do Cadastro), quando ele tem uma;
//  - as coberturas, com o convenio, o plano e o procedimento conferidos no
//    Cadastro do turno (fora dele: o resumo nao monta);
//  - se o Cadastro nao tem convenio ativo;
//  - das saidas das ferramentas, SO o Cadastro: as unidades de
//    consultar_unidades (nome, endereco, bairro, cidade e horario de
//    funcionamento) e os requisitos de consultar_requisitos e de
//    buscar_procedimento (o item e o texto ao paciente). Nada da agenda:
//    buscar_horario, reservar_horario, agendar e confirmar_presenca so
//    entram pelos horarios livres conferidos e pelas marcas de acao (com o
//    dia, a hora e a unidade); o profissional e o procedimento da consulta
//    da pessoa nunca entram;
//  - os textos publicados pela clinica: as frases com endereco, as
//    respostas da base que o modelo disse ter usado e os textos fixos
//    colados na resposta (saudacao, aviso, encerramento).
// As mensagens do paciente nunca entram (o verificador ja as recebe,
// minimizadas, em bloco proprio) e o rascunho so escolhe quais textos fixos
// estao colados nele. Quem chama (filtro.ts) bloqueia quando o resumo nao
// monta (falha fechada); o verificador ainda minimiza cada linha no
// envelope (lib/integrations/llm/verificador.ts).

import type {
  AcaoDoTurno,
  EstadoDaCobertura,
  FatosDoTurno,
  HorarioDoFato,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { frasesComEndereco } from "@/lib/domain/conformidade/fatos-do-turno";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";

/**
 * Teto do resumo, em caracteres. Acima disso o resumo nao monta (e o filtro
 * bloqueia): o verificador nunca julga fato com um resumo cortado. Entra na
 * estimativa do gasto do verificador (lib/agente/gasto.ts).
 */
export const LIMITE_DO_RESUMO_DOS_FATOS = 8_000;

/** Por que o resumo nao montou (so para log; o texto nunca vai). */
export const MOTIVOS_DO_RESUMO = [
  "horario_fora_do_formato",
  "convenio_fora_do_cadastro",
  "procedimento_fora_do_cadastro",
  "longo",
] as const;
export type MotivoDoResumo = (typeof MOTIVOS_DO_RESUMO)[number];

export type ResultadoDoResumo =
  { ok: true; texto: string } | { ok: false; motivo: MotivoDoResumo };

const ROTULO_DA_ACAO: Readonly<Record<AcaoDoTurno, string>> = {
  reservou: "reservou um horário por 10 minutos",
  marcou: "marcou a consulta, pendente da aprovação da equipe",
  confirmou_presenca:
    "confirmou a presença numa consulta que a pessoa já tinha",
  cancelou: "cancelou a consulta",
  // AG4: a remarcacao fica pendente da aprovacao da equipe (D-10).
  remarcou:
    "pediu a remarcação da consulta, pendente da aprovação da equipe; a consulta de antes continua marcada até lá",
  lista_de_espera: "colocou a pessoa na lista de espera",
};

/**
 * Revisao final da AG3: a acao com o horario dela ("{}" e o dia, a hora e
 * a unidade). A reserva diz que a consulta ainda nao esta marcada.
 */
const ROTULO_DA_ACAO_COM_HORARIO: Readonly<Record<AcaoDoTurno, string>> = {
  reservou: "reservou {} (por 10 minutos, ainda não marcada)",
  marcou: "marcou a consulta de {}, pendente da aprovação da equipe",
  confirmou_presenca: "confirmou a presença na consulta de {}",
  cancelou: "cancelou a consulta de {}",
  // AG4 (D-10): a nova pendente; a antiga continua marcada ate a aprovacao.
  remarcou:
    "pediu a remarcação para {}, pendente da aprovação da equipe; a consulta de antes continua marcada até lá",
  lista_de_espera: "colocou a pessoa na lista de espera para {}",
};

/**
 * AG4: a remarcacao com o horario da consulta antiga ("{}" e o horario
 * novo; "[]" e o da antiga).
 */
const ROTULO_DA_REMARCACAO_COM_A_ANTIGA =
  "pediu a remarcação para {}, pendente da aprovação da equipe; a consulta de [] continua marcada até lá";

/** O que segue a acao que nao tem o horario dela no turno. */
const SEM_HORARIO_DA_ACAO = "(sem dia e hora informados)";

const ROTULO_DO_ESTADO: Readonly<Record<EstadoDaCobertura, string>> = {
  coberto: "cobre",
  atende: "atende (aceito)",
  nao_atende: "não atende",
};

const NOME_DO_DIA_DA_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/** O dia e a hora como buscar_horario os escreve (diaEHora). */
const DIA_DO_HORARIO =
  /^(?:domingo|segunda|terça|quarta|quinta|sexta|sábado), \d{2}\/\d{2}(?:\/\d{4})?$/;
const HORA_DO_HORARIO = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Uma linha so, sem espaco sobrando. */
function numaLinha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function dois(numero: number): string {
  return String(numero).padStart(2, "0");
}

/** "rotulo: nenhum." ou "rotulo:" com um item por linha. */
function secao(rotulo: string, itens: readonly string[], vazio: string) {
  const unicos = [...new Set(itens.map(numaLinha).filter((i) => i !== ""))];
  return unicos.length === 0
    ? `${rotulo}: ${vazio}.`
    : [`${rotulo}:`, ...unicos.map((item) => `- ${item}`)].join("\n");
}

function lerJson(saida: string): unknown {
  try {
    return JSON.parse(saida) as unknown;
  } catch {
    return null;
  }
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** As unidades que consultar_unidades trouxe, so o Cadastro delas. */
function unidadesDasSaidas(saidas: readonly string[]): string[] {
  const linhas: string[] = [];
  for (const saida of saidas) {
    const lida = objeto(lerJson(saida));
    if (lida?.resultado !== "unidades" || !Array.isArray(lida.unidades)) {
      continue;
    }
    for (const item of lida.unidades) {
      const unidade = objeto(item);
      const nome = texto(unidade?.nome);
      if (unidade === null || nome === null) {
        continue;
      }
      const partes = [
        texto(unidade.endereco) === null
          ? "endereço não cadastrado"
          : `endereço ${texto(unidade.endereco)}`,
        ...(texto(unidade.bairro) === null
          ? []
          : [`bairro ${texto(unidade.bairro)}`]),
        ...(texto(unidade.cidade) === null
          ? []
          : [`cidade ${texto(unidade.cidade)}`]),
      ];
      const horario = Array.isArray(unidade.horario_de_funcionamento)
        ? unidade.horario_de_funcionamento.flatMap((h) => {
            const linha = texto(h);
            return linha === null ? [] : [linha];
          })
        : [];
      partes.push(
        horario.length === 0
          ? "funcionamento não cadastrado"
          : `funcionamento ${horario.join("; ")}`,
      );
      linhas.push(`${nome}: ${partes.join("; ")}`);
    }
  }
  return linhas;
}

/** Um item de requisito: o texto do item e o texto ao paciente. */
function itemDoRequisito(valor: unknown): string | null {
  const solto = texto(valor);
  if (solto !== null) {
    return solto;
  }
  const lido = objeto(valor);
  const item = texto(lido?.item);
  if (lido === null || item === null) {
    return null;
  }
  const aoPaciente = texto(lido.texto_ao_paciente);
  return aoPaciente === null ? item : `${item} (${aoPaciente})`;
}

/**
 * Os requisitos que consultar_requisitos e buscar_procedimento trouxeram,
 * por procedimento (o item e o texto ao paciente, do Cadastro).
 */
function requisitosDasSaidas(saidas: readonly string[]): string[] {
  const linhas: string[] = [];
  for (const saida of saidas) {
    const lida = objeto(lerJson(saida));
    if (lida === null) {
      continue;
    }
    const itens = [lida.requisitos, lida.requisitos_do_convenio].flatMap(
      (lista) =>
        Array.isArray(lista)
          ? lista.flatMap((valor) => {
              const item = itemDoRequisito(valor);
              return item === null ? [] : [item];
            })
          : [],
    );
    if (itens.length === 0) {
      continue;
    }
    const procedimento = texto(lida.procedimento) ?? "procedimento";
    linhas.push(`${procedimento}: ${itens.join("; ")}`);
  }
  return linhas;
}

/**
 * Monta o resumo dos fatos do turno para o verificador. O rascunho so
 * escolhe os textos fixos colados nele; nada dele entra no resumo.
 */
export function resumirFatosDoTurno(
  fatos: FatosDoTurno,
  rascunho: string,
): ResultadoDoResumo {
  // Os horarios (livres, das acoes e das consultas lidas), no formato
  // exato da agenda. Outro formato: o resumo nao monta.
  const horarioEmTexto = (
    h: Pick<HorarioDoFato, "dia" | "hora"> & { unidade?: string | null },
  ): string | null => {
    if (!DIA_DO_HORARIO.test(h.dia) || !HORA_DO_HORARIO.test(h.hora)) {
      return null;
    }
    // AG3: a unidade do horario (nome do Cadastro), quando ele tem uma.
    const unidade =
      typeof h.unidade === "string" && numaLinha(h.unidade) !== ""
        ? `, unidade ${numaLinha(h.unidade)}`
        : "";
    return `${h.dia} às ${h.hora}${unidade}`;
  };
  const horarios: string[] = [];
  for (const livre of fatos.horariosLivres) {
    const lido = horarioEmTexto(livre);
    if (lido === null) {
      return { ok: false, motivo: "horario_fora_do_formato" };
    }
    horarios.push(lido);
  }

  // Revisao final da AG3: cada acao com o horario dela; a acao sem horario,
  // com o rotulo de antes e o aviso de que o dia e a hora nao vieram. A
  // confirmacao de presenca diz o horario pela consulta lida (abaixo).
  const acoes: string[] = [];
  for (const acao of new Set(fatos.acoes)) {
    const comHorario = fatos.horariosDasAcoes.filter((h) => h.acao === acao);
    if (comHorario.length === 0) {
      acoes.push(
        acao === "confirmou_presenca"
          ? ROTULO_DA_ACAO[acao]
          : `${ROTULO_DA_ACAO[acao]} ${SEM_HORARIO_DA_ACAO}`,
      );
      continue;
    }
    for (const h of comHorario) {
      const lido = horarioEmTexto(h);
      if (lido === null) {
        return { ok: false, motivo: "horario_fora_do_formato" };
      }
      // AG4: a remarcacao com a consulta antiga, que continua marcada.
      const anterior =
        acao === "remarcou" && h.anterior !== undefined && h.anterior !== null
          ? horarioEmTexto(h.anterior)
          : null;
      if (
        acao === "remarcou" &&
        h.anterior !== undefined &&
        h.anterior !== null &&
        anterior === null
      ) {
        return { ok: false, motivo: "horario_fora_do_formato" };
      }
      acoes.push(
        anterior === null
          ? ROTULO_DA_ACAO_COM_HORARIO[acao].replace("{}", () => lido)
          : ROTULO_DA_REMARCACAO_COM_A_ANTIGA.replace("{}", () => lido).replace(
              "[]",
              () => anterior,
            ),
      );
    }
  }
  const consultas: string[] = [];
  for (const c of fatos.consultasLidas) {
    const lido = horarioEmTexto(c);
    if (lido === null) {
      return { ok: false, motivo: "horario_fora_do_formato" };
    }
    consultas.push(
      c.marcadaNestaConversa
        ? `${lido} (marcada pela assistente nesta conversa, pendente da aprovação da equipe)`
        : c.remarcadaNestaConversa === true
          ? `${lido} (remarcação pedida pela assistente nesta conversa, pendente da aprovação da equipe)`
          : lido,
    );
  }
  const consultaLida =
    consultas.length > 0
      ? secao(
          "Consultas que a pessoa já tem, lidas pelo sistema nesta resposta (dia e hora juntos)",
          consultas,
          "nenhuma",
        )
      : `Consulta que a pessoa já tem, lida pelo sistema nesta resposta: ${fatos.consultaLida ? `sim ${SEM_HORARIO_DA_ACAO}` : "não"}.`;

  // As coberturas, com o convenio e o procedimento do Cadastro.
  const chaveDoConvenio = (nome: string, plano: string | null) =>
    `${normalizarBase(nome)}|${plano === null ? "" : normalizarBase(plano)}`;
  const doCadastro = new Set(
    fatos.convenios.map((c) => chaveDoConvenio(c.nome, c.plano)),
  );
  const procedimentos = new Set(
    fatos.procedimentos.map((p) => normalizarBase(p)),
  );
  const coberturas: string[] = [];
  for (const c of fatos.coberturas) {
    if (!doCadastro.has(chaveDoConvenio(c.nome, c.plano))) {
      return { ok: false, motivo: "convenio_fora_do_cadastro" };
    }
    if (
      c.procedimento !== null &&
      !procedimentos.has(normalizarBase(c.procedimento))
    ) {
      return { ok: false, motivo: "procedimento_fora_do_cadastro" };
    }
    const convenio = c.plano === null ? c.nome : `${c.nome} (${c.plano})`;
    const procedimento =
      c.procedimento === null
        ? "sem procedimento informado (vale só para o convênio, nunca para um procedimento)"
        : `procedimento ${c.procedimento}`;
    coberturas.push(
      `${convenio}: ${ROTULO_DO_ESTADO[c.estado]}, ${procedimento}`,
    );
  }

  const hoje =
    fatos.hoje === null
      ? "não informado"
      : `${
          NOME_DO_DIA_DA_SEMANA[
            new Date(
              Date.UTC(fatos.hoje.ano, fatos.hoje.mes - 1, fatos.hoje.dia),
            ).getUTCDay()
          ] ?? ""
        }, ${dois(fatos.hoje.dia)}/${dois(fatos.hoje.mes)}/${fatos.hoje.ano}`;

  const colados = fatos.textosColados.filter(
    (colado) => colado.trim() !== "" && rascunho.includes(colado.trim()),
  );

  const resumo = [
    `Hoje na clínica: ${hoje}.`,
    secao(
      "Ações que as ferramentas fizeram com sucesso nesta resposta",
      acoes,
      "nenhuma",
    ),
    consultaLida,
    secao(
      "Horários livres que a agenda trouxe nesta resposta (dia e hora juntos)",
      horarios,
      "nenhum",
    ),
    secao(
      "Convênios confirmados por ferramenta nesta resposta",
      coberturas,
      "nenhum",
    ),
    `O Cadastro da clínica não tem nenhum convênio ativo: ${fatos.semConvenioAtivo ? "sim" : "não"}.`,
    secao(
      "Unidades consultadas no Cadastro nesta resposta",
      unidadesDasSaidas(fatos.saidasDasFerramentas),
      "nenhuma",
    ),
    secao(
      "Requisitos (o que levar ou fazer) consultados no Cadastro nesta resposta",
      requisitosDasSaidas(fatos.saidasDasFerramentas),
      "nenhum",
    ),
    secao(
      "Endereços nos textos publicados pela clínica",
      frasesComEndereco(fatos.textosPublicados),
      "nenhum",
    ),
    secao(
      "Respostas da base publicada pela clínica usadas nesta resposta",
      fatos.respostasDaBase,
      "nenhuma",
    ),
    secao(
      "Textos fixos da clínica colados pelo sistema nesta resposta (não são afirmação da recepcionista)",
      colados,
      "nenhum",
    ),
  ].join("\n");

  if (Array.from(resumo).length > LIMITE_DO_RESUMO_DOS_FATOS) {
    return { ok: false, motivo: "longo" };
  }
  return { ok: true, texto: resumo };
}

/** As regras do resumo, para a versao das regras mudar quando ele mudar. */
export const FONTES_DO_RESUMO: readonly string[] = [
  `limite ${LIMITE_DO_RESUMO_DOS_FATOS}`,
  DIA_DO_HORARIO.source,
  HORA_DO_HORARIO.source,
  JSON.stringify(ROTULO_DA_ACAO),
  JSON.stringify(ROTULO_DO_ESTADO),
  "resumo: unidades e requisitos so do Cadastro; agenda so pelos horarios livres e acoes",
  // AG3: a unidade de cada horario livre.
  "resumo: horario livre com a unidade quando tem",
  // Revisao final da AG3: a acao e a consulta lida com o dia, a hora e a
  // unidade.
  JSON.stringify(ROTULO_DA_ACAO_COM_HORARIO),
  SEM_HORARIO_DA_ACAO,
  "resumo: consultas lidas com o dia, a hora e a unidade; a marcada nesta conversa avisada",
  // AG4: a remarcacao pendente com a consulta antiga, e a remarcada nesta
  // conversa avisada.
  ROTULO_DA_REMARCACAO_COM_A_ANTIGA,
  "resumo: a remarcacao pedida nesta conversa avisada como pendente",
];
