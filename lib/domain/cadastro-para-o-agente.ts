import { z } from "zod";

import { problemaNoTextoDoAgente } from "@/lib/domain/agente/config";

// Cadastro para o agente (AG1, pedido do dono de 26/10/2026; migration
// 20261027100000_cadastro_para_o_agente.sql). Logica pura, sem React e sem
// banco, usada pela tela de Cadastros, pelas Server Actions e pelo cartao
// da prontidao na Tela 6:
//   - a unidade: o endereco estruturado (o `address` de texto passa a ser
//     composto dos campos quando eles existem), o horario de funcionamento e
//     os textos que vao ao paciente;
//   - o que o procedimento exige do paciente (procedure_requirement);
//   - a idade atendida e a grade do profissional;
//   - a leitura e as frases da prontidao_do_cadastro_da_ia.
// A IA ainda nao le nada disto (a proxima etapa cria as ferramentas).
//
// Cada regra aqui espelha um CHECK do banco: o banco recusa o que passar
// errado por outro caminho, e o que passa aqui sempre passa la (o Zod conta
// caracteres por .length, regua igual ou mais estrita que o char_length).

// ---------------------------------------------------------------------------
// Limites (os mesmos dos CHECKs)
// ---------------------------------------------------------------------------

export const LIMITES_DO_CADASTRO = {
  logradouro: 200,
  numero: 20,
  complemento: 100,
  bairro: 100,
  cidade: 100,
  referencia: 200,
  estacionamento: 200,
  acessibilidade: 200,
  linkDoMapa: 500,
  observacaoAoPaciente: 300,
  textoDoRequisito: 300,
  faixasPorDia: 4,
  minutosAntes: 480,
  idadeDoRequisito: 120,
  idade: 120,
  requisitosPorProcedimento: 30,
} as const;

/** As 27 siglas (CHECK unit_uf_valida), com o nome para o seletor. */
export const UFS = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AM", "Amazonas"],
  ["AP", "Amapá"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MG", "Minas Gerais"],
  ["MS", "Mato Grosso do Sul"],
  ["MT", "Mato Grosso"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["PR", "Paraná"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["RS", "Rio Grande do Sul"],
  ["SC", "Santa Catarina"],
  ["SE", "Sergipe"],
  ["SP", "São Paulo"],
  ["TO", "Tocantins"],
] as const;

export type Uf = (typeof UFS)[number][0];

const SIGLAS: readonly string[] = UFS.map(([sigla]) => sigla);

export function ehUf(valor: unknown): valor is Uf {
  return typeof valor === "string" && SIGLAS.includes(valor);
}

/** A grade de horarios (CHECK professional_grade_minutos_valida). */
export const GRADES_DE_HORARIO = [5, 10, 15, 20, 30, 45, 60] as const;
export type GradeDeHorario = (typeof GRADES_DE_HORARIO)[number];

export function ehGrade(valor: unknown): valor is GradeDeHorario {
  return (
    typeof valor === "number" &&
    (GRADES_DE_HORARIO as readonly number[]).includes(valor)
  );
}

export function rotuloDaGrade(grade: number | null): string {
  return grade === null ? "Sem grade definida" : `A cada ${grade} minutos`;
}

// ---------------------------------------------------------------------------
// Horario de funcionamento (espelho de horario_de_funcionamento_valido)
// ---------------------------------------------------------------------------

/** Dia da semana como chave do jsonb: "0" e domingo (Date.getDay()). */
export const DIAS_DO_HORARIO = ["0", "1", "2", "3", "4", "5", "6"] as const;
export type DiaDoHorario = (typeof DIAS_DO_HORARIO)[number];

export const ROTULO_DO_DIA_DO_HORARIO: Readonly<Record<DiaDoHorario, string>> =
  {
    "0": "Domingo",
    "1": "Segunda-feira",
    "2": "Terça-feira",
    "3": "Quarta-feira",
    "4": "Quinta-feira",
    "5": "Sexta-feira",
    "6": "Sábado",
  };

export type FaixaDeFuncionamento = { inicio: string; fim: string };

/** Dia fechado = chave ausente. Nulo (a coluna) = nao informado. */
export type HorarioDeFuncionamento = Partial<
  Record<DiaDoHorario, FaixaDeFuncionamento[]>
>;

/** "HH:MM" de 00:00 a 23:59 (so digitos ASCII, como o [0-9] do banco). */
const HORA = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export function ehHora(valor: unknown): valor is string {
  return typeof valor === "string" && HORA.test(valor);
}

/** Minutos desde a meia-noite de uma hora ja conferida ("08:30" = 510). */
export function minutosDaHora(hora: string): number {
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
}

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * O mesmo que o banco aceita em unit.horario_de_funcionamento: nulo passa;
 * senao um objeto com as chaves "0" a "6", cada dia presente com 1 a 4
 * faixas {inicio, fim} (so essas duas chaves, HH:MM), o fim depois do
 * inicio e sem sobreposicao no dia (encostar pode). Objeto vazio e dia sem
 * faixa nao passam. A tabela verdade e a mesma do ensaio
 * (tests/fixtures/cadastro/horarios-de-funcionamento.json).
 */
export function horarioDeFuncionamentoValido(valor: unknown): boolean {
  if (valor === null || valor === undefined) {
    return true;
  }
  if (!ehObjetoSimples(valor)) {
    return false;
  }
  const dias = Object.keys(valor);
  if (dias.length === 0) {
    return false;
  }
  for (const dia of dias) {
    if (!(DIAS_DO_HORARIO as readonly string[]).includes(dia)) {
      return false;
    }
    const faixas = valor[dia];
    if (
      !Array.isArray(faixas) ||
      faixas.length < 1 ||
      faixas.length > LIMITES_DO_CADASTRO.faixasPorDia
    ) {
      return false;
    }
    const emMinutos: [number, number][] = [];
    for (const faixa of faixas as unknown[]) {
      if (
        !ehObjetoSimples(faixa) ||
        Object.keys(faixa).length !== 2 ||
        !ehHora(faixa.inicio) ||
        !ehHora(faixa.fim)
      ) {
        return false;
      }
      const inicio = minutosDaHora(faixa.inicio);
      const fim = minutosDaHora(faixa.fim);
      if (fim <= inicio) {
        return false;
      }
      emMinutos.push([inicio, fim]);
    }
    emMinutos.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < emMinutos.length; i += 1) {
      const anterior = emMinutos[i - 1];
      const atual = emMinutos[i];
      if (anterior && atual && atual[0] < anterior[1]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * O horario lido do banco: o valido vira o tipo, com as faixas de cada dia
 * em ordem de inicio; o resto (nulo ou fora da regra) e nulo.
 */
export function lerHorarioDeFuncionamento(
  valor: unknown,
): HorarioDeFuncionamento | null {
  if (valor === null || !horarioDeFuncionamentoValido(valor)) {
    return null;
  }
  const lido = valor as Record<string, FaixaDeFuncionamento[]>;
  const horario: HorarioDeFuncionamento = {};
  for (const dia of DIAS_DO_HORARIO) {
    const faixas = lido[dia];
    if (faixas) {
      horario[dia] = faixas
        .map((faixa) => ({ inicio: faixa.inicio, fim: faixa.fim }))
        .sort(
          (a, b) =>
            minutosDaHora(a.inicio) - minutosDaHora(b.inicio) ||
            minutosDaHora(a.fim) - minutosDaHora(b.fim),
        );
    }
  }
  return horario;
}

/** Quantos dias da semana abrem. */
export function diasAbertos(horario: HorarioDeFuncionamento | null): number {
  if (!horario) {
    return 0;
  }
  return DIAS_DO_HORARIO.filter((dia) => (horario[dia]?.length ?? 0) > 0)
    .length;
}

/** "08:00 às 12:00 e 13:00 às 18:00" */
export function faixasEmTexto(faixas: readonly FaixaDeFuncionamento[]): string {
  const partes = faixas.map((faixa) => `${faixa.inicio} às ${faixa.fim}`);
  if (partes.length <= 1) {
    return partes.join("");
  }
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** Uma linha por dia, de domingo a sabado, com "Fechado" no dia sem faixa. */
export function linhasDoHorario(
  horario: HorarioDeFuncionamento,
): { dia: DiaDoHorario; rotulo: string; texto: string }[] {
  return DIAS_DO_HORARIO.map((dia) => {
    const faixas = horario[dia] ?? [];
    return {
      dia,
      rotulo: ROTULO_DO_DIA_DO_HORARIO[dia],
      texto: faixas.length === 0 ? "Fechado" : faixasEmTexto(faixas),
    };
  });
}

// O horario como a tela edita: os 7 dias, aberto ou fechado, com as faixas
// (cada uma com uma chave para o React). O dia fechado guarda as faixas que
// tinha, para voltarem se ele reabrir antes de salvar.

export type FaixaEmEdicao = { chave: string; inicio: string; fim: string };
export type DiaEmEdicao = { aberto: boolean; faixas: FaixaEmEdicao[] };
export type HorarioEmEdicao = Record<DiaDoHorario, DiaEmEdicao>;

/** A faixa que o dia ganha ao abrir ou ao "Adicionar faixa". */
export const FAIXA_NOVA: FaixaDeFuncionamento = {
  inicio: "08:00",
  fim: "12:00",
};

export function horarioParaEdicao(
  horario: HorarioDeFuncionamento | null,
  novaChave: () => string,
): HorarioEmEdicao {
  const edicao = {} as HorarioEmEdicao;
  for (const dia of DIAS_DO_HORARIO) {
    const faixas = horario?.[dia] ?? [];
    edicao[dia] = {
      aberto: faixas.length > 0,
      faixas: faixas.map((faixa) => ({ chave: novaChave(), ...faixa })),
    };
  }
  return edicao;
}

/**
 * O que impede salvar o horario, uma frase por problema, com o dia: hora
 * fora do formato, fim que nao vem depois do inicio, faixas sobrepostas,
 * faixas demais. Dia fechado nao e conferido (nao vai para o banco).
 */
export function problemasDoHorarioEmEdicao(edicao: HorarioEmEdicao): string[] {
  const problemas: string[] = [];
  for (const dia of DIAS_DO_HORARIO) {
    const { aberto, faixas } = edicao[dia];
    if (!aberto) {
      continue;
    }
    const rotulo = ROTULO_DO_DIA_DO_HORARIO[dia];
    if (faixas.length === 0) {
      problemas.push(
        `${rotulo}: inclua uma faixa ou marque o dia como fechado.`,
      );
      continue;
    }
    if (faixas.length > LIMITES_DO_CADASTRO.faixasPorDia) {
      problemas.push(
        `${rotulo}: no máximo ${LIMITES_DO_CADASTRO.faixasPorDia} faixas por dia.`,
      );
    }
    let formatoRuim = false;
    for (const faixa of faixas) {
      if (!ehHora(faixa.inicio) || !ehHora(faixa.fim)) {
        formatoRuim = true;
      }
    }
    if (formatoRuim) {
      problemas.push(`${rotulo}: use a hora no formato 08:00.`);
      continue;
    }
    if (
      faixas.some(
        (faixa) => minutosDaHora(faixa.fim) <= minutosDaHora(faixa.inicio),
      )
    ) {
      problemas.push(
        `${rotulo}: o fim de cada faixa precisa ser depois do início.`,
      );
      continue;
    }
    const ordenadas = [...faixas].sort(
      (a, b) => minutosDaHora(a.inicio) - minutosDaHora(b.inicio),
    );
    for (let i = 1; i < ordenadas.length; i += 1) {
      const anterior = ordenadas[i - 1];
      const atual = ordenadas[i];
      if (
        anterior &&
        atual &&
        minutosDaHora(atual.inicio) < minutosDaHora(anterior.fim)
      ) {
        problemas.push(`${rotulo}: as faixas não podem se sobrepor.`);
        break;
      }
    }
  }
  return problemas;
}

/**
 * O horario que vai para o banco: so os dias abertos, as faixas em ordem de
 * inicio; nenhum dia aberto e nulo (nao informado). Quem chama confere antes
 * (problemasDoHorarioEmEdicao).
 */
export function horarioDaEdicao(
  edicao: HorarioEmEdicao,
): HorarioDeFuncionamento | null {
  const horario: HorarioDeFuncionamento = {};
  let algum = false;
  for (const dia of DIAS_DO_HORARIO) {
    const { aberto, faixas } = edicao[dia];
    if (!aberto || faixas.length === 0) {
      continue;
    }
    horario[dia] = faixas
      .map((faixa) => ({ inicio: faixa.inicio, fim: faixa.fim }))
      .sort((a, b) => minutosDaHora(a.inicio) - minutosDaHora(b.inicio));
    algum = true;
  }
  return algum ? horario : null;
}

// ---------------------------------------------------------------------------
// Endereco
// ---------------------------------------------------------------------------

export type EnderecoEstruturado = {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

const CAMPOS_DO_ENDERECO: readonly (keyof EnderecoEstruturado)[] = [
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
];

/** Algum campo do endereco estruturado preenchido. */
export function temEnderecoEstruturado(endereco: EnderecoEstruturado): boolean {
  return CAMPOS_DO_ENDERECO.some(
    (campo) => (endereco[campo] ?? "").trim() !== "",
  );
}

/**
 * O endereco completo para o agente: logradouro, numero, bairro, cidade e
 * UF (a regra de "unidades sem endereco" da prontidao; o complemento e
 * opcional e o CEP nao vai a IA).
 */
export function enderecoCompleto(endereco: EnderecoEstruturado): boolean {
  return (["logradouro", "numero", "bairro", "cidade", "uf"] as const).every(
    (campo) => (endereco[campo] ?? "").trim() !== "",
  );
}

/**
 * O texto que vai para unit.address: "Rua das Flores, 123, Sala 4, Centro,
 * Fortaleza/CE". So com o que foi preenchido; sem nenhum campo, nulo. O CEP
 * fica de fora de proposito (ele nao vai a IA).
 */
export function comporEndereco(endereco: EnderecoEstruturado): string | null {
  const limpo = (valor: string | null) => (valor ?? "").trim();
  const cidadeEUf = [limpo(endereco.cidade), limpo(endereco.uf)]
    .filter((parte) => parte !== "")
    .join("/");
  const partes = [
    limpo(endereco.logradouro),
    limpo(endereco.numero),
    limpo(endereco.complemento),
    limpo(endereco.bairro),
    cidadeEUf,
  ].filter((parte) => parte !== "");
  return partes.length === 0 ? null : partes.join(", ");
}

/**
 * O CEP digitado: vazio e nulo; 8 digitos (com ou sem o hifen do 00000-000)
 * sao os 8 digitos; o resto e undefined (nao entendido).
 */
export function lerCep(texto: string): string | null | undefined {
  const limpo = texto.trim();
  if (limpo === "") {
    return null;
  }
  const casou = /^([0-9]{5})-?([0-9]{3})$/.exec(limpo);
  return casou ? `${casou[1]}${casou[2]}` : undefined;
}

/** "60000000" vira "60000-000" (a mascara so na tela). */
export function formatarCep(cep: string): string {
  return /^[0-9]{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/**
 * O link do mapa que o banco aceita: comeca com https://, tem o endereco do
 * site e nao tem branco (CHECK unit_link_do_mapa_valido), ate 500.
 */
export function linkDoMapaValido(link: string): boolean {
  return (
    link.length <= LIMITES_DO_CADASTRO.linkDoMapa &&
    /^https:\/\/[^\s/?#]+(?:[/?#]\S*)?$/.test(link)
  );
}

// ---------------------------------------------------------------------------
// Texto que vai ao paciente
// ---------------------------------------------------------------------------

/**
 * A mesma conferencia do editor da base de conhecimento (Tela 6): as regras
 * deterministicas do filtro de saida, com contexto vazio, recusam telefone,
 * CEP, e-mail, CPF, link, valor, as vedacoes do CFM e palavras de
 * bastidor, com a frase de recepcionista. Vazio nao tem problema (o campo e
 * opcional). Nulo NAO e aprovacao: a resposta da IA passa pelo filtro
 * inteiro antes do envio.
 */
export function problemaNoTextoAoPaciente(texto: string | null): string | null {
  const limpo = (texto ?? "").trim();
  if (limpo === "") {
    return null;
  }
  return problemaNoTextoDoAgente(limpo, "resposta");
}

// ---------------------------------------------------------------------------
// O que o procedimento exige do paciente (procedure_requirement)
// ---------------------------------------------------------------------------

export const TIPOS_DE_REQUISITO = [
  "pedido_medico",
  "autorizacao_previa",
  "carteirinha",
  "documento_com_foto",
  "exames_anteriores",
  "acompanhante",
  "chegar_antes_minutos",
  "idade_minima",
  "avaliacao_previa",
  "outro",
] as const;
export type TipoDeRequisito = (typeof TIPOS_DE_REQUISITO)[number];

export function ehTipoDeRequisito(valor: unknown): valor is TipoDeRequisito {
  return (
    typeof valor === "string" &&
    (TIPOS_DE_REQUISITO as readonly string[]).includes(valor)
  );
}

export const ROTULO_DO_TIPO_DE_REQUISITO: Readonly<
  Record<TipoDeRequisito, string>
> = {
  pedido_medico: "Pedido médico",
  autorizacao_previa: "Autorização prévia do convênio",
  carteirinha: "Carteirinha do convênio",
  documento_com_foto: "Documento com foto",
  exames_anteriores: "Exames anteriores",
  acompanhante: "Acompanhante",
  chegar_antes_minutos: "Chegar antes do horário",
  idade_minima: "Idade mínima",
  avaliacao_previa: "Avaliação antes do procedimento",
  outro: "Outro",
};

/** O tipo que pede um numero, com a unidade e a faixa (CHECK valor_coerente). */
export const VALOR_DO_TIPO: Readonly<
  Partial<
    Record<
      TipoDeRequisito,
      { rotulo: string; unidade: string; minimo: number; maximo: number }
    >
  >
> = {
  chegar_antes_minutos: {
    rotulo: "Quantos minutos antes",
    unidade: "minutos",
    minimo: 1,
    maximo: LIMITES_DO_CADASTRO.minutosAntes,
  },
  idade_minima: {
    rotulo: "Idade mínima (anos)",
    unidade: "anos",
    minimo: 1,
    maximo: LIMITES_DO_CADASTRO.idadeDoRequisito,
  },
};

export type RequisitoDoProcedimento = {
  id: string;
  procedure_id: string;
  /** Nulo: vale para todos (particular e qualquer convenio). */
  insurance_id: string | null;
  tipo: TipoDeRequisito;
  valor_inteiro: number | null;
  texto_ao_paciente: string | null;
  ativo: boolean;
};

/** "Chegar 15 minutos antes", "Idade mínima: 18 anos", "Pedido médico". */
export function descricaoDoRequisito(requisito: {
  tipo: TipoDeRequisito;
  valor_inteiro: number | null;
}): string {
  if (requisito.tipo === "chegar_antes_minutos" && requisito.valor_inteiro) {
    return requisito.valor_inteiro === 1
      ? "Chegar 1 minuto antes"
      : `Chegar ${requisito.valor_inteiro} minutos antes`;
  }
  if (requisito.tipo === "idade_minima" && requisito.valor_inteiro) {
    return requisito.valor_inteiro === 1
      ? "Idade mínima: 1 ano"
      : `Idade mínima: ${requisito.valor_inteiro} anos`;
  }
  return ROTULO_DO_TIPO_DE_REQUISITO[requisito.tipo];
}

/** O que a tela manda por requisito (sem o id, criacao; com, edicao). */
export type RequisitoParaSalvar = {
  id?: string;
  tipo: TipoDeRequisito;
  insurance_id: string | null;
  valor_inteiro: number | null;
  texto_ao_paciente: string | null;
  ativo: boolean;
};

/**
 * O primeiro problema da lista de requisitos, em texto de recepcionista,
 * ou nulo: o numero que o tipo pede (e so ele), o texto obrigatorio em
 * "Outro" e o tamanho, as regras do texto ao paciente, e um so ATIVO do
 * mesmo tipo para o mesmo convenio (menos "Outro"), como o indice unico do
 * banco. `nomeDoConvenio` nomeia o convenio na frase.
 */
export function problemaNosRequisitos(
  requisitos: readonly RequisitoParaSalvar[],
  nomeDoConvenio: (insuranceId: string | null) => string,
): string | null {
  if (requisitos.length > LIMITES_DO_CADASTRO.requisitosPorProcedimento) {
    return `Um procedimento tem no máximo ${LIMITES_DO_CADASTRO.requisitosPorProcedimento} itens em O que o paciente precisa.`;
  }
  const vistos = new Set<string>();
  for (const requisito of requisitos) {
    const rotulo = ROTULO_DO_TIPO_DE_REQUISITO[requisito.tipo];
    const valor = VALOR_DO_TIPO[requisito.tipo];
    if (valor) {
      const numero = requisito.valor_inteiro;
      if (
        numero === null ||
        !Number.isInteger(numero) ||
        numero < valor.minimo ||
        numero > valor.maximo
      ) {
        return `${rotulo}: use um número inteiro de ${valor.minimo} a ${valor.maximo} ${valor.unidade}.`;
      }
    } else if (requisito.valor_inteiro !== null) {
      return `${rotulo}: este item não leva número.`;
    }
    const texto = (requisito.texto_ao_paciente ?? "").trim();
    if (requisito.tipo === "outro" && texto === "") {
      return "Outro: escreva o que o paciente precisa.";
    }
    if (texto.length > LIMITES_DO_CADASTRO.textoDoRequisito) {
      return `${rotulo}: o texto ao paciente vai até ${LIMITES_DO_CADASTRO.textoDoRequisito} caracteres.`;
    }
    const problema = problemaNoTextoAoPaciente(texto);
    if (problema) {
      return `${rotulo}: ${problema}`;
    }
    if (requisito.ativo && requisito.tipo !== "outro") {
      const chave = `${requisito.tipo}|${requisito.insurance_id ?? ""}`;
      if (vistos.has(chave)) {
        return `${rotulo} para ${nomeDoConvenio(requisito.insurance_id)} aparece duas vezes. Deixe um só ativo.`;
      }
      vistos.add(chave);
    }
  }
  return null;
}

/** A lista desejada mudou em relacao ao que estava gravado na abertura? */
export function requisitosMudaram(
  agora: readonly RequisitoParaSalvar[],
  naAbertura: readonly RequisitoDoProcedimento[],
): boolean {
  if (agora.length !== naAbertura.length) {
    return true;
  }
  const porId = new Map(naAbertura.map((r) => [r.id, r]));
  return agora.some((requisito) => {
    const antes = requisito.id ? porId.get(requisito.id) : undefined;
    return (
      !antes ||
      antes.tipo !== requisito.tipo ||
      antes.insurance_id !== requisito.insurance_id ||
      antes.valor_inteiro !== requisito.valor_inteiro ||
      (antes.texto_ao_paciente ?? null) !==
        ((requisito.texto_ao_paciente ?? "").trim() || null) ||
      antes.ativo !== requisito.ativo
    );
  });
}

// ---------------------------------------------------------------------------
// Idade atendida pelo profissional
// ---------------------------------------------------------------------------

/**
 * A idade digitada: vazio e nulo; inteiro de 0 a 120 e o numero; o resto e
 * undefined (nao entendido).
 */
export function lerIdade(texto: string): number | null | undefined {
  const limpo = texto.trim();
  if (limpo === "") {
    return null;
  }
  if (!/^[0-9]{1,3}$/.test(limpo)) {
    return undefined;
  }
  const numero = Number(limpo);
  return numero <= LIMITES_DO_CADASTRO.idade ? numero : undefined;
}

/** "De 18 a 65 anos", "A partir de 12 anos", "Até 17 anos", "Todas as idades". */
export function textoDaIdadeAtendida(
  minima: number | null,
  maxima: number | null,
): string {
  const anos = (n: number) => (n === 1 ? "1 ano" : `${n} anos`);
  if (minima !== null && maxima !== null) {
    return `De ${minima} a ${anos(maxima)}`;
  }
  if (minima !== null) {
    return `A partir de ${anos(minima)}`;
  }
  if (maxima !== null) {
    return `Até ${anos(maxima)}`;
  }
  return "Todas as idades";
}

// ---------------------------------------------------------------------------
// Zod: a entrada das Server Actions (o servidor confere de novo)
// ---------------------------------------------------------------------------

/** Texto opcional aparado: vazio vira nulo; acima do teto, a frase do campo. */
function textoOpcional(maximo: number, rotulo: string) {
  return z
    .string()
    .trim()
    .max(maximo, { error: `${rotulo}: até ${maximo} caracteres.` })
    .transform((texto) => (texto === "" ? null : texto))
    .nullable();
}

/**
 * As colunas novas da unidade, todas opcionais: AUSENTE = nao mexe (o
 * cliente antigo, aberto durante a publicacao, nao apaga nada); presente =
 * o valor (nulo apaga).
 */
export const camposDaUnidadeParaOAgenteSchema = z.object({
  logradouro: textoOpcional(
    LIMITES_DO_CADASTRO.logradouro,
    "Logradouro",
  ).optional(),
  numero: textoOpcional(LIMITES_DO_CADASTRO.numero, "Número").optional(),
  complemento: textoOpcional(
    LIMITES_DO_CADASTRO.complemento,
    "Complemento",
  ).optional(),
  bairro: textoOpcional(LIMITES_DO_CADASTRO.bairro, "Bairro").optional(),
  cidade: textoOpcional(LIMITES_DO_CADASTRO.cidade, "Cidade").optional(),
  uf: z
    .string()
    .refine(ehUf, { error: "Escolha a UF da lista." })
    .nullable()
    .optional(),
  cep: z
    .string()
    .regex(/^[0-9]{8}$/, { error: "Use o CEP com 8 números, como 60000-000." })
    .nullable()
    .optional(),
  referencia: textoOpcional(
    LIMITES_DO_CADASTRO.referencia,
    "Ponto de referência",
  ).optional(),
  estacionamento: textoOpcional(
    LIMITES_DO_CADASTRO.estacionamento,
    "Estacionamento",
  ).optional(),
  acessibilidade: textoOpcional(
    LIMITES_DO_CADASTRO.acessibilidade,
    "Acessibilidade",
  ).optional(),
  link_do_mapa: z
    .string()
    .trim()
    .transform((texto) => (texto === "" ? null : texto))
    .nullable()
    .refine((link) => link === null || linkDoMapaValido(link), {
      error: "Link do mapa: cole o endereço completo, começando com https://.",
    })
    .optional(),
  horario_de_funcionamento: z
    .unknown()
    .refine((valor) => valor === null || horarioDeFuncionamentoValido(valor), {
      error: "Confira o horário de funcionamento.",
    })
    .optional(),
  observacao_ao_paciente: textoOpcional(
    LIMITES_DO_CADASTRO.observacaoAoPaciente,
    "Observação ao paciente",
  ).optional(),
});

export type CamposDaUnidadeParaOAgente = z.output<
  typeof camposDaUnidadeParaOAgenteSchema
>;

/** Os textos da unidade que vao ao paciente, com o rotulo da tela. */
export const TEXTOS_DA_UNIDADE_AO_PACIENTE = [
  ["referencia", "Ponto de referência"],
  ["estacionamento", "Estacionamento"],
  ["acessibilidade", "Acessibilidade"],
  ["observacao_ao_paciente", "Observação ao paciente"],
] as const;

/** O primeiro texto da unidade que nao passa nas regras, com o campo. */
export function problemaNosTextosDaUnidade(
  campos: Partial<
    Record<(typeof TEXTOS_DA_UNIDADE_AO_PACIENTE)[number][0], string | null>
  >,
): string | null {
  for (const [campo, rotulo] of TEXTOS_DA_UNIDADE_AO_PACIENTE) {
    const problema = problemaNoTextoAoPaciente(campos[campo] ?? null);
    if (problema) {
      return `${rotulo}: ${problema}`;
    }
  }
  return null;
}

const idadeSchema = z
  .number()
  .int()
  .min(0)
  .max(LIMITES_DO_CADASTRO.idade)
  .nullable();

/** As colunas novas do profissional, opcionais como as da unidade. */
export const idadeEGradeSchema = z.object({
  idade_minima: idadeSchema.optional(),
  idade_maxima: idadeSchema.optional(),
  grade_minutos: z.number().refine(ehGrade).nullable().optional(),
});

export const requisitoParaSalvarSchema = z.object({
  id: z.uuid().optional(),
  tipo: z.enum(TIPOS_DE_REQUISITO),
  insurance_id: z.uuid().nullable(),
  valor_inteiro: z.number().int().nullable(),
  texto_ao_paciente: z
    .string()
    .trim()
    .transform((texto) => (texto === "" ? null : texto))
    .nullable(),
  ativo: z.boolean(),
});

export const requisitosDoProcedimentoSchema = z.object({
  procedure_id: z.uuid(),
  requisitos: z
    .array(requisitoParaSalvarSchema)
    .max(LIMITES_DO_CADASTRO.requisitosPorProcedimento),
  /** Os ids gravados quando o modal abriu: so estes podem ser apagados. */
  ids_na_abertura: z
    .array(z.uuid())
    .max(LIMITES_DO_CADASTRO.requisitosPorProcedimento * 4),
});

/** Um requisito como a RPC salvar_requisitos_do_procedimento devolve. */
const requisitoGravadoSchema = z.object({
  id: z.string(),
  procedure_id: z.string(),
  insurance_id: z.string().nullable(),
  tipo: z.enum(TIPOS_DE_REQUISITO),
  valor_inteiro: z.number().int().nullable(),
  texto_ao_paciente: z.string().nullable(),
  ativo: z.boolean(),
});

/**
 * A resposta da RPC salvar_requisitos_do_procedimento (migration
 * 20261027100000, item 7): quantos apagou, mudou e criou, e a lista inteira
 * do procedimento depois do Salvar (com o que outra pessoa criou com o modal
 * aberto), em ordem de criacao.
 */
export const respostaDosRequisitosSchema = z.object({
  apagados: z.number().int().min(0),
  alterados: z.number().int().min(0),
  criados: z.number().int().min(0),
  requisitos: z.array(requisitoGravadoSchema),
});

// ---------------------------------------------------------------------------
// Prontidao do cadastro (prontidao_do_cadastro_da_ia)
// ---------------------------------------------------------------------------

const listaDaProntidaoSchema = z.object({
  total: z.number().int().min(0),
  nomes: z.array(z.string()),
});

export const prontidaoDoCadastroSchema = z.object({
  profissionais_sem_jornada: listaDaProntidaoSchema,
  procedimentos_sem_vinculo: listaDaProntidaoSchema,
  procedimentos_sem_preco: listaDaProntidaoSchema,
  unidades_ativas: z.number().int().min(0),
  nenhuma_unidade_ativa: z.boolean(),
  unidades_sem_endereco: listaDaProntidaoSchema,
  unidades_sem_horario: listaDaProntidaoSchema,
  convenios_sem_cobertura: listaDaProntidaoSchema,
  procedimentos_sem_requisitos: listaDaProntidaoSchema,
});

export type ProntidaoDoCadastro = z.output<typeof prontidaoDoCadastroSchema>;

export type AbaDoCadastro =
  "profissionais" | "procedimentos" | "convenios" | "unidades";

export type PendenciaDoCadastro = {
  chave: string;
  /** Bloqueia o "pronto" (atencao) ou so informa. */
  tipo: "pendencia" | "informativo";
  texto: string;
  aba: AbaDoCadastro;
  rotuloDoLink: string;
};

const ROTULO_DA_ABA: Readonly<Record<AbaDoCadastro, string>> = {
  profissionais: "Abrir Profissionais",
  procedimentos: "Abrir Procedimentos",
  convenios: "Abrir Convênios",
  unidades: "Abrir Unidades",
};

/** O link da aba de Cadastros (a aba vive na URL). */
export function linkDaAbaDoCadastro(aba: AbaDoCadastro): string {
  return aba === "profissionais" ? "/cadastros" : `/cadastros?aba=${aba}`;
}

/** "Ana, Bruno e Carla", "Ana, Bruno e mais 3" (a lista vem cortada em 10). */
export function nomesEmTexto(lista: {
  total: number;
  nomes: readonly string[];
}): string {
  const nomes = lista.nomes.slice(0, 3);
  const resto = lista.total - nomes.length;
  if (nomes.length === 0) {
    return "";
  }
  if (resto > 0) {
    return `${nomes.join(", ")} e mais ${resto}`;
  }
  if (nomes.length === 1) {
    return nomes[0] ?? "";
  }
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function pendencia(
  chave: string,
  tipo: PendenciaDoCadastro["tipo"],
  texto: string,
  aba: AbaDoCadastro,
): PendenciaDoCadastro {
  return { chave, tipo, texto, aba, rotuloDoLink: ROTULO_DA_ABA[aba] };
}

/**
 * As frases do cartao "Prontidao do cadastro", na ordem em que a recepcao
 * resolve: unidade, profissionais, procedimentos, convenios; o informativo
 * (procedimentos sem o que o paciente precisa) por ultimo.
 */
export function pendenciasDaProntidao(
  prontidao: ProntidaoDoCadastro,
): PendenciaDoCadastro[] {
  const saida: PendenciaDoCadastro[] = [];
  const contagem = (n: number, singular: string, plural: string): string =>
    n === 1 ? `1 ${singular}` : `${n} ${plural}`;

  if (prontidao.nenhuma_unidade_ativa) {
    saida.push(
      pendencia(
        "sem_unidade",
        "pendencia",
        "Nenhuma unidade ativa: o assistente não tem o endereço nem o horário da clínica.",
        "unidades",
      ),
    );
  }
  const {
    unidades_sem_endereco: semEndereco,
    unidades_sem_horario: semHorario,
  } = prontidao;
  if (semEndereco.total > 0) {
    saida.push(
      pendencia(
        "unidades_sem_endereco",
        "pendencia",
        `${contagem(semEndereco.total, "unidade sem endereço completo", "unidades sem endereço completo")} (rua, número, bairro, cidade e UF): ${nomesEmTexto(semEndereco)}.`,
        "unidades",
      ),
    );
  }
  if (semHorario.total > 0) {
    saida.push(
      pendencia(
        "unidades_sem_horario",
        "pendencia",
        `${contagem(semHorario.total, "unidade sem horário de funcionamento", "unidades sem horário de funcionamento")}: ${nomesEmTexto(semHorario)}.`,
        "unidades",
      ),
    );
  }
  const semJornada = prontidao.profissionais_sem_jornada;
  if (semJornada.total > 0) {
    saida.push(
      pendencia(
        "profissionais_sem_jornada",
        "pendencia",
        `${contagem(semJornada.total, "profissional ativo sem jornada", "profissionais ativos sem jornada")}, então a agenda não abre horário: ${nomesEmTexto(semJornada)}.`,
        "profissionais",
      ),
    );
  }
  const semVinculo = prontidao.procedimentos_sem_vinculo;
  if (semVinculo.total > 0) {
    saida.push(
      pendencia(
        "procedimentos_sem_vinculo",
        "pendencia",
        `${contagem(semVinculo.total, "procedimento que a IA pode agendar está", "procedimentos que a IA pode agendar estão")} sem ninguém em Quem faz e convênios: ${nomesEmTexto(semVinculo)}.`,
        "procedimentos",
      ),
    );
  }
  const semPreco = prontidao.procedimentos_sem_preco;
  if (semPreco.total > 0) {
    saida.push(
      pendencia(
        "procedimentos_sem_preco",
        "pendencia",
        `${contagem(semPreco.total, "procedimento que a IA pode agendar está", "procedimentos que a IA pode agendar estão")} sem preço e sem Coberto em Quem faz e convênios: ${nomesEmTexto(semPreco)}.`,
        "procedimentos",
      ),
    );
  }
  const convenios = prontidao.convenios_sem_cobertura;
  if (convenios.total > 0) {
    saida.push(
      pendencia(
        "convenios_sem_cobertura",
        "pendencia",
        `${contagem(convenios.total, "convênio ativo não cobre", "convênios ativos não cobrem")} nenhum procedimento ativo: ${nomesEmTexto(convenios)}. Marque em Convênios que cobrem, no cadastro de cada procedimento.`,
        "procedimentos",
      ),
    );
  }
  const semRequisitos = prontidao.procedimentos_sem_requisitos;
  if (semRequisitos.total > 0) {
    saida.push(
      pendencia(
        "procedimentos_sem_requisitos",
        "informativo",
        `${contagem(semRequisitos.total, "procedimento está", "procedimentos estão")} sem nada em O que o paciente precisa: ${nomesEmTexto(semRequisitos)}. Nem todo procedimento exige algo: confira se falta.`,
        "procedimentos",
      ),
    );
  }
  return saida;
}
