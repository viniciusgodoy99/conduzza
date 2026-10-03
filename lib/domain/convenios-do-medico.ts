// "Convenios que atende" no cadastro do profissional (decisao do dono em
// 02/10/2026). Logica pura, sem React e sem banco.
//
// O cadastro do medico e o padrao: o convenio marcado nele entra sozinho,
// como Coberto, em cada procedimento que ele faz E que o convenio cobre. Quem
// grava e a RPC sincronizar_convenios_do_profissional (a cascata e do
// servidor); este modulo so preve o que ela vai fazer, para a tela mostrar
// antes de salvar, e escreve o resumo em linguagem de recepcionista.
//
// Termos (os mesmos da RPC, critica §3.1):
//   - atende(m, P): existe o par em professional_insurance. O Particular e
//     implicito e nunca e gravado;
//   - cobre(X, P): existe o par em procedure_insurance. Procedimento sem par
//     e so Particular (o Botox);
//   - faz(m, X): existe service_link ATIVO de m em X, de qualquer convenio,
//     Particular incluido. Medido ANTES da gravacao. O `active` do
//     profissional e do procedimento nao entra;
//   - excecao: faz, atende e cobre sem vinculo ativo (m, X, P). E implicita
//     (nunca gravada) e so some quando o convenio sai e volta a ser salvo.
//
// Os tipos sao ESTRUTURAIS (nada de lib/queries): quem chama passa as linhas
// de professional_insurance, procedure_insurance e service_link como vierem.

/** professional_insurance: o profissional atende o convenio */
export type AtendimentoDoConvenio = {
  professional_id: string;
  insurance_id: string;
};

/** procedure_insurance: o convenio cobre o procedimento */
export type CoberturaDoConvenio = {
  procedure_id: string;
  insurance_id: string;
};

/** Os campos de service_link que este modulo le */
export type VinculoDoMedico = {
  professional_id: string;
  procedure_id: string;
  /** null = Particular */
  insurance_id: string | null;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Rotulos e textos fixos (os e2e procuram por eles)
// ---------------------------------------------------------------------------

export const ROTULO_CONVENIOS_QUE_ATENDE = "Convênios que atende";
export const ROTULO_CONVENIOS_QUE_COBREM =
  "Convênios que cobrem este procedimento";
export const ROTULO_FORA_DO_CADASTRO = "Fora do cadastro do profissional";
export const ROTULO_TIRAR_CONVENIO = "Tirar o convênio mesmo assim";
export const ROTULO_SALVAR_MESMO_ASSIM = "Salvar mesmo assim";

/** Ajuda acima da lista do profissional (D7: Particular implicito) */
export const AJUDA_CONVENIOS_QUE_ATENDE =
  "O Particular vale sempre e não precisa ser marcado. O convênio marcado aqui entra sozinho nos procedimentos que este profissional faz e que o convênio cobre.";

/**
 * D6: sem convenio ativo para oferecer (nenhum cadastrado ou todos
 * desativados), so texto (trocar de aba fecharia o modal). "Ativo" vale nos
 * dois casos: a aba Convenios lista os desativados, e la o caminho e reativar.
 */
export const VAZIO_CONVENIOS_QUE_ATENDE =
  "Nenhum convênio ativo. Cadastre ou reative um na aba Convênios para marcar quais este profissional atende.";

/** Nota do convenio marcado pela auto cura (veio so do vinculo) */
export const NOTA_CONVENIO_EM_USO =
  "Marcado porque já está em uso em um procedimento deste profissional.";

/**
 * D5: SQLSTATE proprio da aba parada nas duas RPCs (migration
 * 20261002150000). Nunca CZ409: o PostgREST repete sozinho, sem limite, a
 * transacao que falha com serialization_failure, e a recusa da aba parada
 * e deterministica (virava laco de milhares de chamadas).
 */
export const CODIGO_CADASTRO_MUDOU = "CZ409";

/** D5: aba parada (CZ409 das duas RPCs) */
export const MENSAGEM_CADASTRO_MUDOU =
  "O cadastro mudou enquanto você editava. Feche, abra de novo e salve.";

/** 22023: convenio inativo nao entra (medico, cobertura ou linha nova) */
export const MENSAGEM_CONVENIO_INATIVO =
  "Um convênio desativado não pode ser marcado.";

// ---------------------------------------------------------------------------
// Abertura do modal (auto cura)
// ---------------------------------------------------------------------------

export type ConveniosNaAbertura = {
  /**
   * O que a secao abre marcado: os pares gravados mais os convenios dos
   * vinculos ativos dele. Sem a cura, um vinculo ativo cujo convenio nao
   * esta no cadastro sumiria da lista e o proximo Salvar o desativaria.
   */
  marcados: string[];
  /**
   * Os pares crus de professional_insurance. Sao eles que vao como
   * `insurance_ids_na_abertura` (a RPC compara com os pares crus e recusa a
   * aba parada com CZ409), nunca os `marcados`.
   */
  gravados: string[];
  /** Os que vieram so do vinculo (sem par gravado): a tela mostra a nota */
  emUsoForaDoCadastro: string[];
};

/**
 * Convenios que a secao "Convenios que atende" abre marcados. Ordem: os
 * pares na ordem recebida e depois os que vieram so do vinculo. Vinculo
 * inativo e Particular nao entram.
 */
export function conveniosQueAtendeNaAbertura(
  professionalId: string,
  atendimentos: readonly AtendimentoDoConvenio[],
  vinculos: readonly VinculoDoMedico[],
): ConveniosNaAbertura {
  const gravados = new Set<string>();
  for (const par of atendimentos) {
    if (par.professional_id === professionalId) {
      gravados.add(par.insurance_id);
    }
  }
  const soDoVinculo = new Set<string>();
  for (const vinculo of vinculos) {
    if (
      vinculo.professional_id === professionalId &&
      vinculo.active &&
      vinculo.insurance_id !== null &&
      !gravados.has(vinculo.insurance_id)
    ) {
      soDoVinculo.add(vinculo.insurance_id);
    }
  }
  return {
    marcados: [...gravados, ...soDoVinculo],
    gravados: [...gravados],
    emUsoForaDoCadastro: [...soDoVinculo],
  };
}

/**
 * O Salvar precisa mandar a lista para a RPC? Recebe a abertura INTEIRA (nao
 * so os pares) e compara por conjunto (reordenar nao conta). Manda quando a
 * lista difere dos pares CRUS (`gravados`) OU da abertura curada
 * (`marcados`):
 *   - cura sem ninguem mexer (agora == marcados != gravados): a RPC trata o
 *     convenio curado como ja marcado, so grava o par (sem cascata) e a nota
 *     some;
 *   - desmarcar so o convenio curado (agora == gravados != marcados): a lista
 *     volta a ser igual aos pares crus, mas a RPC conta o curado em `saem` e
 *     desativa os vinculos dele, que e o que a previa ja anuncia, com o aviso
 *     de consulta futura (D4) e o deixa_de_fazer (D3) pelo p_confirmar.
 * So nao manda quando agora == gravados == marcados (sem cura e sem mudanca).
 * O `insurance_ids_na_abertura` continua sendo `abertura.gravados`.
 */
export function precisaSalvarConvenios(
  abertura: Pick<ConveniosNaAbertura, "gravados" | "marcados">,
  agora: readonly string[],
): boolean {
  return (
    !mesmoConjunto(abertura.gravados, agora) ||
    !mesmoConjunto(abertura.marcados, agora)
  );
}

function mesmoConjunto(a: readonly string[], b: readonly string[]): boolean {
  const antes = new Set(a);
  const depois = new Set(b);
  return antes.size === depois.size && [...depois].every((id) => antes.has(id));
}

// ---------------------------------------------------------------------------
// Opcoes da lista
// ---------------------------------------------------------------------------

/** Os campos de insurance que a lista usa */
export type ConvenioDoCadastro = {
  id: string;
  name: string;
  plan_name?: string | null;
  active: boolean;
};

/** Mesmo formato das opcoes de ListaDeConvenios */
export type OpcaoDeConvenioDoMedico = {
  id: string;
  nome: string;
  plano: string | null;
  inativo: boolean;
  nota?: string;
};

function compararNomes(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

/**
 * Opcoes de "Convenios que atende": os ativos, mais o inativo que esta
 * marcado na tela ou estava marcado na abertura (desmarcar por engano nao
 * tira o caminho de volta ate o modal fechar). Convenio inativo nunca entra
 * de novo (22023), entao ele so aparece para poder sair. Ordem: ativos por
 * nome e plano (pt-BR), inativos no fim. O que veio so do vinculo ganha a
 * nota da auto cura.
 */
export function opcoesDosConveniosQueAtende(entrada: {
  convenios: readonly ConvenioDoCadastro[];
  marcados: Iterable<string>;
  naAbertura: readonly string[];
  emUsoForaDoCadastro: readonly string[];
}): OpcaoDeConvenioDoMedico[] {
  const marcados = new Set(entrada.marcados);
  const naAbertura = new Set(entrada.naAbertura);
  const emUso = new Set(entrada.emUsoForaDoCadastro);
  return entrada.convenios
    .filter((c) => c.active || marcados.has(c.id) || naAbertura.has(c.id))
    .sort(
      (a, b) =>
        Number(!a.active) - Number(!b.active) ||
        compararNomes(a.name, b.name) ||
        compararNomes(a.plan_name ?? "", b.plan_name ?? ""),
    )
    .map((c) => ({
      id: c.id,
      nome: c.name,
      plano: c.plan_name ?? null,
      inativo: !c.active,
      ...(emUso.has(c.id) ? { nota: NOTA_CONVENIO_EM_USO } : {}),
    }));
}

// ---------------------------------------------------------------------------
// Previa do Salvar (a mesma regra da RPC)
// ---------------------------------------------------------------------------

/** Um convenio que entra ou sai, e em quais procedimentos isso acontece */
export type MudancaDoConvenio = {
  insuranceId: string;
  procedureIds: string[];
};

export type PreviaDosConvenios = {
  /**
   * Convenios novos e os procedimentos em que eles entram (vinculo criado
   * como Coberto ou reativado com os valores gravados, D2). Lista vazia: o
   * convenio fica so no cadastro.
   */
  entram: MudancaDoConvenio[];
  /**
   * Convenios que saem e os procedimentos em que o vinculo dele e
   * desativado. Lista vazia: sai so do cadastro.
   */
  saem: MudancaDoConvenio[];
  /**
   * Procedimentos que ele deixa de fazer (D3): todo vinculo ativo dele ali e
   * de convenio que sai, e nenhum convenio que entra cobre o procedimento.
   * Pede confirmacao, e marcar de novo nao o traz de volta.
   */
  deixaDeFazer: string[];
};

/**
 * O que o Salvar de "Convenios que atende" vai mudar, pela regra da RPC
 * sincronizar_convenios_do_profissional (critica §3.2):
 *   - atuais = pares dele mais os convenios dos vinculos ativos dele (a cura:
 *     o convenio que so estava no vinculo conta como ja marcado e NAO
 *     cascateia);
 *   - entram = agora menos atuais; saem = atuais menos agora;
 *   - P que entra vai para cada X que ele faz e que P cobre. Como os
 *     convenios dos vinculos ativos ja estao em atuais, nenhum vinculo ativo
 *     conta como entrada;
 *   - P que sai desativa os vinculos ativos (m, *, P);
 *   - convenio que nao mudou nao e tocado: a excecao fica.
 * Particular nunca entra nem sai por aqui. A ordem dos ids nao importa (o
 * texto do resumo ordena pelo nome).
 */
export function previaDosConveniosDoProfissional(entrada: {
  professionalId: string;
  /** O que esta marcado na tela agora */
  agora: readonly string[];
  atendimentos: readonly AtendimentoDoConvenio[];
  coberturas: readonly CoberturaDoConvenio[];
  vinculos: readonly VinculoDoMedico[];
}): PreviaDosConvenios {
  const { professionalId } = entrada;
  const atuais = conveniosQueAtendeNaAbertura(
    professionalId,
    entrada.atendimentos,
    entrada.vinculos,
  ).marcados;
  const atuaisSet = new Set(atuais);
  const agora = [...new Set(entrada.agora)];
  const agoraSet = new Set(agora);
  const entram = agora.filter((id) => !atuaisSet.has(id));
  const saem = atuais.filter((id) => !agoraSet.has(id));
  const saemSet = new Set(saem);

  // faz(m): procedimento -> convenios dos vinculos ativos dele ali
  const conveniosPorProcedimento = new Map<string, (string | null)[]>();
  for (const vinculo of entrada.vinculos) {
    if (vinculo.professional_id !== professionalId || !vinculo.active) {
      continue;
    }
    const lista = conveniosPorProcedimento.get(vinculo.procedure_id) ?? [];
    lista.push(vinculo.insurance_id);
    conveniosPorProcedimento.set(vinculo.procedure_id, lista);
  }

  // cobre: convenio -> procedimentos
  const cobertos = new Map<string, Set<string>>();
  for (const cobertura of entrada.coberturas) {
    const lista = cobertos.get(cobertura.insurance_id) ?? new Set<string>();
    lista.add(cobertura.procedure_id);
    cobertos.set(cobertura.insurance_id, lista);
  }

  const procedimentosQueFaz = [...conveniosPorProcedimento.keys()];

  return {
    entram: entram.map((insuranceId) => {
      const cobre = cobertos.get(insuranceId);
      return {
        insuranceId,
        procedureIds: cobre
          ? procedimentosQueFaz.filter((procedureId) => cobre.has(procedureId))
          : [],
      };
    }),
    saem: saem.map((insuranceId) => ({
      insuranceId,
      procedureIds: procedimentosQueFaz.filter((procedureId) =>
        (conveniosPorProcedimento.get(procedureId) ?? []).includes(insuranceId),
      ),
    })),
    deixaDeFazer: procedimentosQueFaz.filter((procedureId) => {
      const convenios = conveniosPorProcedimento.get(procedureId) ?? [];
      const todosSaem = convenios.every(
        (insuranceId) => insuranceId !== null && saemSet.has(insuranceId),
      );
      if (!todosSaem) {
        return false;
      }
      return !entram.some(
        (insuranceId) => cobertos.get(insuranceId)?.has(procedureId) === true,
      );
    }),
  };
}

// ---------------------------------------------------------------------------
// Textos do resumo e do aviso
// ---------------------------------------------------------------------------

/** Como o texto chama o convenio e o procedimento */
export type NomesDoResumo = {
  convenio: (insuranceId: string) => string;
  procedimento: (procedureId: string) => string;
};

/** O que o texto le: a previa acima ou o retorno da RPC, ja em camelCase */
export type ResumoParaTexto = {
  entram: readonly { insuranceId: string; procedureIds: readonly string[] }[];
  saem: readonly { insuranceId: string; procedureIds: readonly string[] }[];
  deixaDeFazer?: readonly string[];
};

/**
 * Junta os nomes na forma falada: "A", "A e B", "A, B e C". Acima de
 * `limite + 1` nomes, mostra `limite` e conta o resto ("A, B, C e mais 2");
 * nunca "e mais 1", que esconderia um nome so para dizer que ele existe.
 */
export function listaFalada(nomes: readonly string[], limite = 3): string {
  if (nomes.length <= 1) {
    return nomes[0] ?? "";
  }
  if (nomes.length > limite + 1) {
    return `${nomes.slice(0, limite).join(", ")} e mais ${nomes.length - limite}`;
  }
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function procedimentos(quantidade: number): string {
  return quantidade === 1 ? "procedimento" : "procedimentos";
}

function nomesOrdenados(
  ids: readonly string[],
  nome: (id: string) => string,
): string[] {
  return [...new Set(ids)].map(nome).sort(compararNomes);
}

/**
 * A frase de quem deixa de fazer procedimentos (D3), ou null quando ninguem
 * sai de nada. `conveniosQueSaem` so escolhe entre singular e plural.
 */
export function fraseDeQuemDeixaDeFazer(
  deixaDeFazer: readonly string[],
  conveniosQueSaem: number,
  nomes: Pick<NomesDoResumo, "procedimento">,
): string | null {
  const lista = nomesOrdenados(deixaDeFazer, nomes.procedimento);
  if (lista.length === 0) {
    return null;
  }
  const quantos = lista.length;
  const porQual =
    conveniosQueSaem === 1
      ? "pelo convênio desmarcado"
      : "pelos convênios desmarcados";
  return `Este profissional deixa de fazer ${quantos} ${procedimentos(quantos)}, porque só ${quantos === 1 ? "atendia nele" : "atendia neles"} ${porQual}: ${listaFalada(lista)}. Para voltar, inclua o profissional em Quem faz, no cadastro do procedimento.`;
}

/**
 * O resumo em frases curtas, uma por convenio que entra ou sai e, no fim, a
 * de quem deixa de fazer. Serve para a previa ao vivo (aria-live) e para o
 * aviso depois de salvar (com o retorno da RPC, nao com a previa). Lista
 * vazia: nada muda. Convenios e procedimentos em ordem de nome.
 *   "Unimed entra em 3 procedimentos: Consulta, Retorno e Ultrassom."
 *   "Unimed fica no cadastro e ainda não entra em nenhum procedimento deste profissional."
 *   "Bradesco Saúde sai de 1 procedimento: Consulta."
 *   "Bradesco Saúde sai do cadastro, sem mudar nenhum procedimento."
 */
export function frasesDoResumoDosConvenios(
  resumo: ResumoParaTexto,
  nomes: NomesDoResumo,
): string[] {
  const porNome = <T extends { insuranceId: string }>(lista: readonly T[]) =>
    [...lista].sort((a, b) =>
      compararNomes(
        nomes.convenio(a.insuranceId),
        nomes.convenio(b.insuranceId),
      ),
    );

  const frases: string[] = [];
  for (const mudanca of porNome(resumo.entram)) {
    const convenio = nomes.convenio(mudanca.insuranceId);
    const lista = nomesOrdenados(mudanca.procedureIds, nomes.procedimento);
    frases.push(
      lista.length === 0
        ? `${convenio} fica no cadastro e ainda não entra em nenhum procedimento deste profissional.`
        : `${convenio} entra em ${lista.length} ${procedimentos(lista.length)}: ${listaFalada(lista)}.`,
    );
  }
  for (const mudanca of porNome(resumo.saem)) {
    const convenio = nomes.convenio(mudanca.insuranceId);
    const lista = nomesOrdenados(mudanca.procedureIds, nomes.procedimento);
    frases.push(
      lista.length === 0
        ? `${convenio} sai do cadastro, sem mudar nenhum procedimento.`
        : `${convenio} sai de ${lista.length} ${procedimentos(lista.length)}: ${listaFalada(lista)}.`,
    );
  }
  const deixa = fraseDeQuemDeixaDeFazer(
    resumo.deixaDeFazer ?? [],
    resumo.saem.length,
    nomes,
  );
  if (deixa) {
    frases.push(deixa);
  }
  return frases;
}

/**
 * Titulo do AvisoDeConsultas quando tirar convenio pega consulta futura
 * (D4, aviso ANTES de gravar), ou null sem consulta. O corpo do aviso (a
 * primeira consulta e "Esta ação não desmarca nada...") continua o padrao.
 */
export function tituloDoAvisoDosConvenios(
  consultasFuturas: number,
  conveniosQueSaem: number,
): string | null {
  if (!Number.isInteger(consultasFuturas) || consultasFuturas <= 0) {
    return null;
  }
  const marcadas =
    consultasFuturas === 1
      ? "1 consulta marcada"
      : `${consultasFuturas} consultas marcadas`;
  const porQual =
    conveniosQueSaem === 1
      ? "pelo convênio desmarcado"
      : "pelos convênios desmarcados";
  return `Há ${marcadas} com este profissional ${porQual}. Remarque ou cancele, se for o caso.`;
}
