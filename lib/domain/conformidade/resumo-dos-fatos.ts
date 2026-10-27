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
//  - as acoes e a consulta lida (listas fechadas, viram rotulos fixos);
//  - os horarios livres da agenda, conferidos no formato exato que
//    buscar_horario e reservar_horario escrevem ("terca, 21/10" e "14:00").
//    Outro formato: o resumo nao monta;
//  - as coberturas, com o convenio, o plano e o procedimento conferidos no
//    Cadastro do turno (fora dele: o resumo nao monta);
//  - se o Cadastro nao tem convenio ativo;
//  - das saidas das ferramentas, SO o Cadastro: as unidades de
//    consultar_unidades (nome, endereco, bairro, cidade e horario de
//    funcionamento) e os requisitos de consultar_requisitos e de
//    buscar_procedimento (o item e o texto ao paciente). Nada da agenda:
//    buscar_horario, reservar_horario, agendar e confirmar_presenca so
//    entram pelos horarios livres conferidos e pelas marcas de acao; a
//    consulta da pessoa (dia, hora, profissional) nunca entra;
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
  remarcou: "remarcou a consulta",
  lista_de_espera: "colocou a pessoa na lista de espera",
};

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
  // Os horarios livres, no formato exato da agenda.
  const horarios: string[] = [];
  for (const livre of fatos.horariosLivres) {
    if (!DIA_DO_HORARIO.test(livre.dia) || !HORA_DO_HORARIO.test(livre.hora)) {
      return { ok: false, motivo: "horario_fora_do_formato" };
    }
    horarios.push(`${livre.dia} às ${livre.hora}`);
  }

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
      [...new Set(fatos.acoes)].map((acao) => ROTULO_DA_ACAO[acao]),
      "nenhuma",
    ),
    `Consulta que a pessoa já tem, lida pelo sistema nesta resposta: ${fatos.consultaLida ? "sim" : "não"}.`,
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
];
