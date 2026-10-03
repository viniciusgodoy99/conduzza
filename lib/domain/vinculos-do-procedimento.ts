import { centavosParaReais, lerReais } from "@/lib/utils/moeda";

// "Quem faz e convenios" dentro do modal do Procedimento (decisao do dono em
// 29/09/2026: a aba Vinculos saiu de Cadastros). Logica pura, sem React e sem
// banco: dos vinculos gravados (service_link) para as linhas da tela, e das
// linhas de volta para a lista que a RPC sincronizar_vinculos_do_procedimento
// grava.
//
// A tela mostra UMA linha por profissional que faz o procedimento e, dentro
// dela, os convenios que ELE aceita neste procedimento (o caso do Dr. Joao,
// spec 3.5: um aceita Unimed e o outro nao, no mesmo procedimento). Cada
// convenio aceito segue o PADRAO do procedimento ou tem uma EXCECAO:
//   - padrao do Particular: preco base e duracao padrao do procedimento;
//   - padrao de convenio: "Coberto" (preco nulo com cobertura) e a duracao
//     padrao do procedimento;
//   - excecao: valor em reais, Coberto ou sem preco informado, e duracao
//     propria. Os tres estados de preco continuam distintos (docs/04): R$ 0,00
//     nao e Coberto e nao e vazio.
//
// O banco nao guarda "segue o padrao": ele guarda o valor concreto. Ao abrir,
// um vinculo e lido como padrao quando os valores dele sao exatamente os que
// o padrao daria com o procedimento como esta gravado; ao salvar, o padrao
// vira valor concreto com o preco e a duracao que estao no formulario (assim
// mudar o preco base leva junto quem segue o padrao). Consequencia aceita: uma
// excecao que por acaso tem o mesmo valor do padrao passa a seguir o padrao.

export type ModoPreco = "valor" | "coberto" | "sem";

/** O que o procedimento oferece como padrao para os vinculos dele */
export type PadraoDoProcedimento = {
  basePriceCents: number | null;
  durationMin: number;
};

/** Os campos de service_link que esta tela le */
export type VinculoGravado = {
  professional_id: string;
  procedure_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
  active: boolean;
};

/** Um convenio aceito por um profissional, como a tela edita */
export type AjusteDoConvenio = {
  /** null = Particular */
  insuranceId: string | null;
  /** true: preco e duracao do procedimento; false: excecao abaixo */
  padrao: boolean;
  modo: ModoPreco;
  /** Texto digitado (so vale na excecao com modo "valor") */
  precoReais: string;
  /** Minutos digitados (so vale na excecao) */
  duracao: string;
};

export type LinhaDoProfissional = {
  professionalId: string;
  convenios: AjusteDoConvenio[];
};

/** Uma linha do p_linhas da RPC: o vinculo desejado, com valor concreto */
export type VinculoDesejado = {
  professional_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
};

export const DURACAO_MINIMA = 5;
export const DURACAO_MAXIMA = 600;

type ValoresDoVinculo = Pick<
  VinculoDesejado,
  "price_cents" | "covered_by_insurance" | "duration_min"
>;

/** O que o padrao do procedimento da para um convenio (null = Particular). */
export function valoresDoPadrao(
  insuranceId: string | null,
  padrao: PadraoDoProcedimento,
): ValoresDoVinculo {
  if (insuranceId === null) {
    return {
      price_cents: padrao.basePriceCents,
      covered_by_insurance: false,
      duration_min: padrao.durationMin,
    };
  }
  return {
    price_cents: null,
    covered_by_insurance: true,
    duration_min: padrao.durationMin,
  };
}

/** Modo de preco de valores gravados (o mesmo criterio da antiga aba). */
export function modoDoPreco(valores: {
  price_cents: number | null;
  covered_by_insurance: boolean;
}): ModoPreco {
  if (valores.covered_by_insurance && valores.price_cents === null) {
    return "coberto";
  }
  if (valores.price_cents !== null) {
    return "valor";
  }
  return "sem";
}

function segueOPadrao(
  vinculo: VinculoGravado,
  padrao: PadraoDoProcedimento,
): boolean {
  const esperado = valoresDoPadrao(vinculo.insurance_id, padrao);
  return (
    vinculo.price_cents === esperado.price_cents &&
    vinculo.covered_by_insurance === esperado.covered_by_insurance &&
    vinculo.duration_min === esperado.duration_min
  );
}

function ajusteComValores(
  insuranceId: string | null,
  valores: ValoresDoVinculo,
  padrao: boolean,
): AjusteDoConvenio {
  return {
    insuranceId,
    padrao,
    modo: modoDoPreco(valores),
    precoReais: centavosParaReais(valores.price_cents),
    duracao: String(valores.duration_min),
  };
}

/** Convenio recem marcado: segue o padrao do procedimento. */
export function ajusteNovo(
  insuranceId: string | null,
  padrao: PadraoDoProcedimento,
): AjusteDoConvenio {
  return ajusteComValores(
    insuranceId,
    valoresDoPadrao(insuranceId, padrao),
    true,
  );
}

/**
 * Passa o convenio para excecao, ja preenchida com o que o padrao daria
 * AGORA (com o preco e a duracao do formulario): quem personaliza muda so o
 * que e diferente.
 */
export function personalizar(
  ajuste: AjusteDoConvenio,
  padrao: PadraoDoProcedimento,
): AjusteDoConvenio {
  return ajusteComValores(
    ajuste.insuranceId,
    valoresDoPadrao(ajuste.insuranceId, padrao),
    false,
  );
}

/**
 * O que a tela mostra para um convenio aceito: o padrao com o formulario
 * de agora, ou a excecao como esta digitada. Texto que nao da para ler vira
 * "sem valor" (preco nulo) ou duracao nula; quem confere e vinculosDasLinhas.
 */
export function valoresDoAjuste(
  ajuste: AjusteDoConvenio,
  padrao: PadraoDoProcedimento,
): {
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number | null;
} {
  if (ajuste.padrao) {
    return valoresDoPadrao(ajuste.insuranceId, padrao);
  }
  const duracao = Number(ajuste.duracao.trim());
  const precoLido =
    ajuste.modo === "valor" ? lerReais(ajuste.precoReais) : null;
  return {
    price_cents: typeof precoLido === "number" ? precoLido : null,
    covered_by_insurance:
      ajuste.modo === "coberto" && ajuste.insuranceId !== null,
    duration_min:
      ajuste.duracao.trim() !== "" && Number.isInteger(duracao)
        ? duracao
        : null,
  };
}

/** Volta o convenio ao padrao do procedimento. */
export function voltarAoPadrao(
  ajuste: AjusteDoConvenio,
  padrao: PadraoDoProcedimento,
): AjusteDoConvenio {
  return ajusteNovo(ajuste.insuranceId, padrao);
}

function posicao(ordem: readonly string[], id: string): number {
  const indice = ordem.indexOf(id);
  return indice === -1 ? Number.MAX_SAFE_INTEGER : indice;
}

/**
 * Vinculos ATIVOS do procedimento para as linhas da tela. Os desativados nao
 * aparecem: para a tela, o profissional nao faz mais aquilo por aquele
 * convenio (se voltar, a RPC reativa o mesmo vinculo). Profissionais na ordem
 * de `ordemDosProfissionais`; em cada um, Particular primeiro e depois os
 * convenios na ordem de `ordemDosConvenios`. Ids fora das listas vao para o
 * fim, sem sumir: sumir da tela faria o proximo Salvar desativar.
 */
export function linhasDosVinculos(
  vinculos: readonly VinculoGravado[],
  procedureId: string,
  padrao: PadraoDoProcedimento,
  ordemDosProfissionais: readonly string[] = [],
  ordemDosConvenios: readonly string[] = [],
): LinhaDoProfissional[] {
  const porProfissional = new Map<string, VinculoGravado[]>();
  for (const vinculo of vinculos) {
    if (vinculo.procedure_id !== procedureId || !vinculo.active) {
      continue;
    }
    const lista = porProfissional.get(vinculo.professional_id) ?? [];
    lista.push(vinculo);
    porProfissional.set(vinculo.professional_id, lista);
  }

  const ordemDoConvenio = (insuranceId: string | null): number =>
    insuranceId === null ? -1 : posicao(ordemDosConvenios, insuranceId);

  return Array.from(porProfissional.entries())
    .sort(
      ([a], [b]) =>
        posicao(ordemDosProfissionais, a) - posicao(ordemDosProfissionais, b),
    )
    .map(([professionalId, lista]) => ({
      professionalId,
      convenios: [...lista]
        .sort(
          (a, b) =>
            ordemDoConvenio(a.insurance_id) - ordemDoConvenio(b.insurance_id),
        )
        .map((vinculo) =>
          ajusteComValores(
            vinculo.insurance_id,
            vinculo,
            segueOPadrao(vinculo, padrao),
          ),
        ),
    }));
}

// ---------------------------------------------------------------------------
// Convenio pelo profissional (decisao do dono em 02/10/2026)
// ---------------------------------------------------------------------------
// O cadastro do profissional diz quais convenios ele ATENDE
// (professional_insurance) e o procedimento diz quais convenios o COBREM
// (procedure_insurance, a secao "Convenios que cobrem este procedimento",
// editada neste mesmo modal). Em "Quem faz e convenios" cada profissional
// mostra so a intersecao: cobre AGORA (o que esta marcado na tela) e ele
// atende. Quem entra ja vem com ela marcada, pelo padrao. Desmarcar ali e a
// EXCECAO daquele procedimento: e implicita (faz, atende e cobre, mas sem
// vinculo ativo) e nunca e gravada como excecao. O Particular continua
// implicito no profissional e desmarcavel por procedimento (D7).
//
// service_link continua sendo a fonte da agenda, da IA, do preco e das
// conversoes: estas funcoes so decidem o que a TELA oferece e pre-marca.
//
// Dado gravado fora da intersecao (legado, escrita direta) nao some da tela:
// sumir faria o proximo Salvar desativar o vinculo sem ninguem pedir. O
// convenio em uso num vinculo ativo aparece marcado em "cobrem" (a cura, com
// NOTA_PLANO_EM_USO) e o convenio que o profissional nao atende aparece
// marcado com FORA_DO_CADASTRO.
//
// Todo parametro novo e opcional: sem ele, o comportamento e o de antes de
// 02/10 (a tela atual continua funcionando ate ganhar a secao nova).

/** Nome da secao no modal do Procedimento (decisao D1 do dono, 02/10/2026) */
export const ROTULO_DOS_PLANOS = "Convênios que cobrem este procedimento";

/** Nota do convenio marcado em "cobrem" so porque um vinculo ativo o usa */
export const NOTA_PLANO_EM_USO =
  "Marcado porque já está em uso em Quem faz e convênios.";

/** Convenio marcado para um profissional que nao o atende no cadastro dele */
export const FORA_DO_CADASTRO = "Fora do cadastro do profissional";

/** Par de professional_insurance: o profissional atende o convenio */
export type AtendimentoDoProfissional = {
  professional_id: string;
  insurance_id: string;
};

/** Par de procedure_insurance: o convenio cobre o procedimento */
export type CoberturaDoProcedimento = {
  procedure_id: string;
  insurance_id: string;
};

/**
 * O que a tela sabe sobre convenios enquanto o modal esta aberto. Monte com
 * `contextoDosPlanos` a cada mudanca em "cobrem".
 */
export type ContextoDosPlanos = {
  /** Convenios marcados AGORA em "Convenios que cobrem este procedimento" */
  cobre: ReadonlySet<string>;
  /**
   * Os que estavam marcados em "cobrem" quando o modal abriu (com a cura:
   * `planosQueCobremNaAbertura(...).marcados`). Vazio no procedimento novo.
   * Decide o desfazer: convenio que estava aqui volta como estava.
   */
  cobriaNaAbertura: ReadonlySet<string>;
  /**
   * Convenios que o profissional atende (professional_insurance como esta
   * gravado, sem cura). O Particular e implicito e nao entra.
   */
  atende: (professionalId: string) => ReadonlySet<string>;
  /** Convenios ativos da clinica: inativo nunca ENTRA sozinho */
  ativos: ReadonlySet<string>;
  /** Ordem dos convenios (a do catalogo): Particular antes, desconhecido no fim */
  ordem: readonly string[];
};

const NENHUM: ReadonlySet<string> = new Set<string>();

/** Monta o contexto a partir da matriz de convenios e do estado da tela. */
export function contextoDosPlanos(dados: {
  /** Marcados agora em "cobrem" */
  planos: readonly string[];
  /** Marcados em "cobrem" na abertura (com a cura); omitido = nenhum */
  marcadosNaAbertura?: readonly string[];
  /**
   * professional_insurance da clinica, COMPLETO: a leitura pagina com
   * .range() (o PostgREST corta em max_rows = 1000 sem erro). Um par
   * faltando faz o `atende` errar: aparece FORA_DO_CADASTRO sem motivo e
   * quem entra pelo "Adicionar quem faz" vem sem um convenio que atende.
   */
  atendimentos: readonly AtendimentoDoProfissional[];
  /** Convenios da clinica, na ordem em que a tela os mostra */
  convenios: readonly { id: string; active: boolean }[];
}): ContextoDosPlanos {
  const porProfissional = new Map<string, Set<string>>();
  for (const par of dados.atendimentos) {
    const lista = porProfissional.get(par.professional_id) ?? new Set();
    lista.add(par.insurance_id);
    porProfissional.set(par.professional_id, lista);
  }
  return {
    cobre: new Set(dados.planos),
    cobriaNaAbertura: new Set(dados.marcadosNaAbertura ?? []),
    atende: (professionalId) => porProfissional.get(professionalId) ?? NENHUM,
    ativos: new Set(dados.convenios.filter((c) => c.active).map((c) => c.id)),
    ordem: dados.convenios.map((c) => c.id),
  };
}

/** Sem repeticao, na ordem dos convenios (desconhecido no fim, estavel). */
function ordenarPlanos(
  planos: Iterable<string>,
  ordem: readonly string[],
): string[] {
  return Array.from(new Set(planos)).sort(
    (a, b) => posicao(ordem, a) - posicao(ordem, b),
  );
}

/** Particular primeiro, depois a ordem dos convenios (estavel). */
function ordenarAjustes(
  ajustes: readonly AjusteDoConvenio[],
  ordem: readonly string[],
): AjusteDoConvenio[] {
  const chave = (insuranceId: string | null): number =>
    insuranceId === null ? -1 : posicao(ordem, insuranceId);
  return [...ajustes].sort(
    (a, b) => chave(a.insuranceId) - chave(b.insuranceId),
  );
}

/** "Convenios que cobrem" quando o modal abre */
export type PlanosNaAbertura = {
  /**
   * O que a secao mostra marcado: os gravados mais os em uso num vinculo
   * ativo do procedimento (a cura). Vai para `contextoDosPlanos` como
   * `marcadosNaAbertura` e para `EstadoDosVinculos.planos` da abertura.
   */
  marcados: string[];
  /**
   * procedure_insurance como esta gravado, sem a cura. Vai para
   * `EstadoDosVinculos.planosGravados` e dali para a trava otimista da RPC
   * (`planosNaAbertura` de `extrasDaSincronizacao`). So e o gravado se
   * `coberturas` chegou completa (ver `planosQueCobremNaAbertura`).
   */
  gravados: string[];
  /** Marcados so porque um vinculo ativo usa: a tela mostra NOTA_PLANO_EM_USO */
  soDoVinculo: string[];
};

/**
 * "Convenios que cobrem" ao abrir o modal: procedure_insurance mais os
 * convenios dos vinculos ATIVOS do procedimento. Sem a cura, um vinculo
 * ativo cujo convenio nao aparece marcado faria o Salvar ser recusado
 * (a RPC exige o convenio de toda linha em `planos`). Convenio inativo
 * gravado continua marcado: quem decide tirar e a pessoa.
 *
 * A cura NAO olha se o convenio esta ativo, e nao deve olhar: tirar o
 * inativo em uso faria a RPC recusar a linha dele com 23514, e desmarcar
 * desativaria o vinculo. Por isso a RPC do procedimento conta o convenio em
 * uso num vinculo ativo do proprio procedimento como JA presente (igual ao
 * v_atuais da RPC do medico) e so recusa com 22023 o inativo que entra de
 * verdade; o curado so ganha o par em procedure_insurance.
 *
 * `coberturas` tem de chegar COMPLETA: a leitura (fetchMatrizDeConvenios)
 * pagina procedure_insurance com .range(), porque o PostgREST corta em
 * max_rows = 1000 sem erro. Com uma cobertura faltando, `gravados` nunca
 * bate com o banco e a trava otimista recusa todo Salvar com CZ409, mesmo
 * depois de fechar e abrir (o corte se repete).
 */
export function planosQueCobremNaAbertura(
  procedureId: string,
  coberturas: readonly CoberturaDoProcedimento[],
  vinculos: readonly Pick<
    VinculoGravado,
    "procedure_id" | "insurance_id" | "active"
  >[],
  ordemDosConvenios: readonly string[] = [],
): PlanosNaAbertura {
  const gravados = new Set<string>();
  for (const cobertura of coberturas) {
    if (cobertura.procedure_id === procedureId) {
      gravados.add(cobertura.insurance_id);
    }
  }
  const emUso = new Set<string>();
  for (const vinculo of vinculos) {
    if (
      vinculo.procedure_id === procedureId &&
      vinculo.active &&
      vinculo.insurance_id !== null &&
      !gravados.has(vinculo.insurance_id)
    ) {
      emUso.add(vinculo.insurance_id);
    }
  }
  return {
    marcados: ordenarPlanos([...gravados, ...emUso], ordemDosConvenios),
    gravados: ordenarPlanos(gravados, ordemDosConvenios),
    soDoVinculo: ordenarPlanos(emUso, ordemDosConvenios),
  };
}

/**
 * Convenios que a secao "cobrem" oferece: os ativos, os marcados agora e os
 * que estavam marcados na abertura (o inativo desmarcado por engano volta).
 * A ordem e a de `convenios`.
 */
export function planosParaMarcar<C extends { id: string; active: boolean }>(
  convenios: readonly C[],
  planos: readonly string[],
  marcadosNaAbertura: readonly string[],
): C[] {
  const marcados = new Set(planos);
  const naAbertura = new Set(marcadosNaAbertura);
  return convenios.filter(
    (c) => c.active || marcados.has(c.id) || naAbertura.has(c.id),
  );
}

// ---------------------------------------------------------------------------
// Opcoes da secao enquanto o modal esta aberto
// ---------------------------------------------------------------------------
// O que estava gravado quando o modal abriu continua podendo voltar ate o
// modal fechar: desmarcar um convenio inativo ou remover um profissional
// inativo por engano nao pode tirar o caminho de volta (so restaria cancelar
// e perder as outras edicoes). Inativo que NAO estava gravado continua fora:
// a secao nao oferece quem saiu da clinica nem convenio desativado.

type Cadastro = { id: string; active: boolean };

function linhaNaAbertura(
  linhasNaAbertura: readonly LinhaDoProfissional[],
  professionalId: string,
): LinhaDoProfissional | undefined {
  return linhasNaAbertura.find(
    (linha) => linha.professionalId === professionalId,
  );
}

/** Uma opcao de "Atende por" quando a tela usa o cadastro do profissional */
export type OpcaoDeConvenio<C> = {
  convenio: C;
  /**
   * O profissional nao atende este convenio no cadastro dele (so aparece
   * porque esta marcado ou estava gravado): a tela mostra FORA_DO_CADASTRO.
   */
  foraDoCadastro: boolean;
};

/**
 * Convenios que a linha de um profissional oferece para marcar. A ordem e a
 * de `convenios`; o Particular fica de fora (a tela o poe sempre).
 *
 * Sem `contexto` (como era ate 02/10): os ativos, os ja marcados na tela e os
 * que estavam gravados para ELE quando o modal abriu.
 *
 * Com `contexto`: so o que cobre AGORA e que ele atende, ou que ja esta
 * marcado, ou que estava gravado para ele (cobre ∩ (atende ∪ marcados ∪
 * gravados)); inativo so se marcado ou gravado. Cada opcao diz se esta fora
 * do cadastro dele.
 */
export function conveniosParaMarcar<C extends Cadastro>(
  convenios: readonly C[],
  linha: LinhaDoProfissional,
  linhasNaAbertura: readonly LinhaDoProfissional[],
): C[];
export function conveniosParaMarcar<C extends Cadastro>(
  convenios: readonly C[],
  linha: LinhaDoProfissional,
  linhasNaAbertura: readonly LinhaDoProfissional[],
  contexto: ContextoDosPlanos,
): OpcaoDeConvenio<C>[];
export function conveniosParaMarcar<C extends Cadastro>(
  convenios: readonly C[],
  linha: LinhaDoProfissional,
  linhasNaAbertura: readonly LinhaDoProfissional[],
  contexto?: ContextoDosPlanos,
): C[] | OpcaoDeConvenio<C>[] {
  const marcados = new Set(linha.convenios.map((ajuste) => ajuste.insuranceId));
  const gravados = new Set(
    linhaNaAbertura(linhasNaAbertura, linha.professionalId)?.convenios.map(
      (ajuste) => ajuste.insuranceId,
    ) ?? [],
  );
  const naTela = (id: string) => marcados.has(id) || gravados.has(id);
  if (!contexto) {
    return convenios.filter((c) => c.active || naTela(c.id));
  }
  const atende = contexto.atende(linha.professionalId);
  return convenios
    .filter(
      (c) =>
        contexto.cobre.has(c.id) &&
        (atende.has(c.id) || naTela(c.id)) &&
        (c.active || naTela(c.id)),
    )
    .map((c) => ({ convenio: c, foraDoCadastro: !atende.has(c.id) }));
}

/**
 * Profissionais que "Adicionar quem faz" oferece: quem nao esta na lista e
 * esta ativo ou estava na lista quando o modal abriu (o inativo removido por
 * engano volta). A ordem e a de `profissionais`.
 */
export function profissionaisParaAdicionar<P extends Cadastro>(
  profissionais: readonly P[],
  linhas: readonly LinhaDoProfissional[],
  linhasNaAbertura: readonly LinhaDoProfissional[],
): P[] {
  const naLista = new Set(linhas.map((linha) => linha.professionalId));
  const naAbertura = new Set(
    linhasNaAbertura.map((linha) => linha.professionalId),
  );
  return profissionais.filter(
    (p) => (p.active || naAbertura.has(p.id)) && !naLista.has(p.id),
  );
}

/**
 * O convenio `insuranceId` (que cobre agora) para um profissional, pela
 * regra do desfazer seguro:
 *   - estava gravado para ele na abertura: volta como estava (valores
 *     gravados);
 *   - ele estava na abertura e o convenio ja cobria na abertura, mas ele nao
 *     o tinha: continua fora (e a excecao dele, ou ele nao atendia);
 *   - nos outros casos (profissional novo, ou convenio que passou a cobrir
 *     agora): entra pelo padrao se ele atende e o convenio esta ativo.
 */
function ajusteDoPlano(
  professionalId: string,
  insuranceId: string,
  naAbertura: LinhaDoProfissional | undefined,
  contexto: Omit<ContextoDosPlanos, "cobre">,
  padrao: PadraoDoProcedimento,
): AjusteDoConvenio | null {
  const gravado = naAbertura?.convenios.find(
    (ajuste) => ajuste.insuranceId === insuranceId,
  );
  if (gravado) {
    return gravado;
  }
  if (naAbertura && contexto.cobriaNaAbertura.has(insuranceId)) {
    return null;
  }
  return contexto.atende(professionalId).has(insuranceId) &&
    contexto.ativos.has(insuranceId)
    ? ajusteNovo(insuranceId, padrao)
    : null;
}

/**
 * Linha de quem entra pelo "Adicionar quem faz".
 *
 * Sem `contexto` (como era ate 02/10): quem estava gravado quando o modal
 * abriu volta com os convenios e os valores gravados; quem e novo entra
 * atendendo Particular pelo padrao.
 *
 * Com `contexto`: quem estava na abertura volta como estava (Particular
 * incluido), so com os convenios que cobrem agora; quem e novo entra com
 * Particular mais os convenios que ele atende, que cobrem agora e estao
 * ativos, tudo pelo padrao. Convenio que passou a cobrir depois da abertura
 * entra pelo padrao para quem o atende, estivesse ele na abertura ou nao
 * (o mesmo que `marcarPlano` daria: a ordem entre marcar e adicionar nao
 * muda o resultado).
 */
export function linhaAoAdicionar(
  professionalId: string,
  linhasNaAbertura: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
  contexto?: ContextoDosPlanos,
): LinhaDoProfissional {
  const naAbertura = linhaNaAbertura(linhasNaAbertura, professionalId);
  if (!contexto) {
    return (
      naAbertura ?? {
        professionalId,
        convenios: [ajusteNovo(null, padrao)],
      }
    );
  }
  const particular = naAbertura
    ? naAbertura.convenios.find((ajuste) => ajuste.insuranceId === null)
    : ajusteNovo(null, padrao);
  const convenios: AjusteDoConvenio[] = particular ? [particular] : [];
  for (const insuranceId of ordenarPlanos(contexto.cobre, contexto.ordem)) {
    const ajuste = ajusteDoPlano(
      professionalId,
      insuranceId,
      naAbertura,
      contexto,
      padrao,
    );
    if (ajuste) {
      convenios.push(ajuste);
    }
  }
  return { professionalId, convenios };
}

/** "Convenios que cobrem" e "Quem faz e convenios" mudam juntos */
export type SelecaoDosPlanos = {
  planos: string[];
  linhas: LinhaDoProfissional[];
};

/**
 * Marca um convenio em "Convenios que cobrem este procedimento", com o
 * desfazer seguro: se ele estava marcado na abertura, cada profissional que
 * estava na abertura volta como estava para ELE (quem o tinha volta com os
 * valores gravados; a excecao continua excecao). Convenio novo, e
 * profissional que entrou depois da abertura, recebem o convenio pelo padrao
 * se o profissional o atende e o convenio esta ativo. Ja marcado: nada muda
 * (marcar de novo nao pode desfazer uma excecao feita nesta sessao).
 *
 * `contexto.cobre` nao e lido: o que esta marcado e `atual.planos`.
 */
export function marcarPlano(
  atual: { planos: readonly string[]; linhas: readonly LinhaDoProfissional[] },
  insuranceId: string,
  contexto: Omit<ContextoDosPlanos, "cobre">,
  linhasNaAbertura: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
): SelecaoDosPlanos {
  if (atual.planos.includes(insuranceId)) {
    return { planos: [...atual.planos], linhas: [...atual.linhas] };
  }
  return {
    planos: ordenarPlanos([...atual.planos, insuranceId], contexto.ordem),
    linhas: atual.linhas.map((linha) => {
      if (linha.convenios.some((a) => a.insuranceId === insuranceId)) {
        return linha;
      }
      const ajuste = ajusteDoPlano(
        linha.professionalId,
        insuranceId,
        linhaNaAbertura(linhasNaAbertura, linha.professionalId),
        contexto,
        padrao,
      );
      return ajuste
        ? {
            ...linha,
            convenios: ordenarAjustes(
              [...linha.convenios, ajuste],
              contexto.ordem,
            ),
          }
        : linha;
    }),
  };
}

/**
 * Desmarca um convenio em "Convenios que cobrem este procedimento": ele sai
 * de todas as linhas. Quem fica sem nenhum convenio e barrado no Salvar por
 * vinculosDasLinhas (a tela ja avisa na linha). Marcar de novo antes de
 * salvar desfaz pelo `marcarPlano`.
 */
export function desmarcarPlano(
  atual: { planos: readonly string[]; linhas: readonly LinhaDoProfissional[] },
  insuranceId: string,
): SelecaoDosPlanos {
  return {
    planos: atual.planos.filter((id) => id !== insuranceId),
    linhas: atual.linhas.map((linha) =>
      linha.convenios.some((a) => a.insuranceId === insuranceId)
        ? {
            ...linha,
            convenios: linha.convenios.filter(
              (a) => a.insuranceId !== insuranceId,
            ),
          }
        : linha,
    ),
  };
}

/**
 * Convenio marcado de novo na linha de um profissional: se estava gravado
 * para ele quando o modal abriu, volta como estava (preco e duracao
 * gravados); se e novo, segue o padrao do procedimento.
 */
export function ajusteAoMarcar(
  professionalId: string,
  insuranceId: string | null,
  linhasNaAbertura: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
): AjusteDoConvenio {
  return (
    linhaNaAbertura(linhasNaAbertura, professionalId)?.convenios.find(
      (ajuste) => ajuste.insuranceId === insuranceId,
    ) ?? ajusteNovo(insuranceId, padrao)
  );
}

// ---------------------------------------------------------------------------
// Precisa regravar os vinculos?
// ---------------------------------------------------------------------------

/** O que decide o que a RPC grava nos vinculos de um procedimento */
export type EstadoDosVinculos = {
  linhas: readonly LinhaDoProfissional[];
  /** Preco base e duracao padrao: quem segue o padrao grava COPIA deles */
  padrao: PadraoDoProcedimento;
  /** Chave "IA pode agendar": a RPC copia a do procedimento em todo vinculo */
  iaPodeAgendar: boolean;
  /**
   * "Convenios que cobrem este procedimento" como a tela mostra (na
   * abertura, com a cura: `planosQueCobremNaAbertura(...).marcados`).
   * Ausente = tela sem a secao (como ate 02/10): nao entra na comparacao.
   */
  planos?: readonly string[];
  /**
   * So na abertura: procedure_insurance como estava gravado, sem a cura
   * (`planosQueCobremNaAbertura(...).gravados`). Vai para a trava otimista.
   */
  planosGravados?: readonly string[];
};

/** A abertura de um procedimento ja gravado, com a secao "cobrem" */
export type AberturaComPlanos = EstadoDosVinculos & {
  planos: readonly string[];
  planosGravados: readonly string[];
};

function mesmoConjunto(a: readonly string[], b: readonly string[]): boolean {
  const deA = new Set(a);
  const deB = new Set(b);
  return deA.size === deB.size && [...deA].every((id) => deB.has(id));
}

function chaveDoVinculo(
  professionalId: string,
  insuranceId: string | null,
): string {
  return `${professionalId}:${insuranceId ?? ""}`;
}

/**
 * O que a RPC gravaria para cada profissional e convenio das linhas (valor
 * concreto, nao o texto digitado), ou null se a mesma chave aparece duas
 * vezes (quem decide o erro e vinculosDasLinhas; aqui, na duvida, regrava).
 */
function valoresPorVinculo(
  linhas: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
): Map<string, ReturnType<typeof valoresDoAjuste>> | null {
  const mapa = new Map<string, ReturnType<typeof valoresDoAjuste>>();
  for (const linha of linhas) {
    for (const ajuste of linha.convenios) {
      const chave = chaveDoVinculo(linha.professionalId, ajuste.insuranceId);
      if (mapa.has(chave)) {
        return null;
      }
      mapa.set(chave, valoresDoAjuste(ajuste, padrao));
    }
  }
  return mapa;
}

/**
 * O Salvar do procedimento precisa chamar sincronizar_vinculos_do_procedimento?
 *
 * A RPC reescreve os vinculos do procedimento a partir da lista da tela e
 * desativa o que nao veio nela. A lista da tela nasce do catalogo em cache,
 * que pode estar parado (outro gestor acabou de incluir alguem) ou cortado
 * pelo limite de linhas do PostgREST; regravar sem ninguem ter mexido na
 * secao desativaria esses vinculos em silencio. (Com a secao "cobrem", a
 * trava otimista da RPC pega a aba parada com CZ409; para isso os vinculos,
 * as coberturas e os atendimentos tem de chegar completos, paginados com
 * .range(): um corte vira CZ409 permanente, nao aba parada.) Entao so
 * regrava quando:
 *   - o procedimento e novo (`abertura` nula);
 *   - a chave "IA pode agendar" mudou (a RPC e quem a copia para os vinculos);
 *   - mudou o conjunto de "Convenios que cobrem" (a RPC grava
 *     procedure_insurance); a ordem nao conta, e o estado sem `planos` (tela
 *     sem a secao) nao compara. Se so um dos dois lados tem `planos`, grava;
 *   - o preco base ou a duracao padrao mudaram (quem segue o padrao grava
 *     copia dos dois, entao o vinculo muda junto);
 *   - o que seria gravado mudou: entrou ou saiu profissional ou convenio, ou
 *     mudou o preco, a cobertura ou a duracao de algum. A comparacao e pelo
 *     valor concreto, entao abrir uma excecao e voltar sem mudar nada, ou
 *     reordenar a lista, nao conta como mudanca.
 */
export function precisaSincronizarVinculos(
  abertura: EstadoDosVinculos | null,
  agora: EstadoDosVinculos,
): boolean {
  if (abertura === null) {
    return true;
  }
  if (abertura.iaPodeAgendar !== agora.iaPodeAgendar) {
    return true;
  }
  if (abertura.planos !== undefined || agora.planos !== undefined) {
    if (
      abertura.planos === undefined ||
      agora.planos === undefined ||
      !mesmoConjunto(abertura.planos, agora.planos)
    ) {
      return true;
    }
  }
  if (
    abertura.padrao.basePriceCents !== agora.padrao.basePriceCents ||
    abertura.padrao.durationMin !== agora.padrao.durationMin
  ) {
    return true;
  }
  const gravados = valoresPorVinculo(abertura.linhas, abertura.padrao);
  const desejados = valoresPorVinculo(agora.linhas, agora.padrao);
  if (
    gravados === null ||
    desejados === null ||
    gravados.size !== desejados.size
  ) {
    return true;
  }
  for (const [chave, desejado] of desejados) {
    const gravado = gravados.get(chave);
    if (
      !gravado ||
      gravado.price_cents !== desejado.price_cents ||
      gravado.covered_by_insurance !== desejado.covered_by_insurance ||
      gravado.duration_min !== desejado.duration_min
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Aviso para a recepcao quando o Salvar tirou combinacoes da agenda
 * (vinculos desativados pela RPC); null quando nada saiu.
 */
export function avisoDosVinculosDesativados(quantidade: number): string | null {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return null;
  }
  return quantidade === 1
    ? "1 combinação de quem faz e convênio saiu da agenda."
    : `${quantidade} combinações de quem faz e convênio saíram da agenda.`;
}

export type ResultadoDasLinhas =
  { ok: true; vinculos: VinculoDesejado[] } | { ok: false; erro: string };

/** Como a mensagem de erro chama o profissional e o convenio */
export type NomesDosCadastros = {
  profissional: (professionalId: string) => string;
  convenio: (insuranceId: string | null) => string;
};

function lerDuracao(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d+$/.test(limpo)) {
    return null;
  }
  const minutos = Number(limpo);
  if (minutos < DURACAO_MINIMA || minutos > DURACAO_MAXIMA) {
    return null;
  }
  return minutos;
}

/**
 * Das linhas da tela para a lista da RPC, conferindo o que a tela pode
 * conferir antes de ir ao banco. A mensagem de erro diz QUAL profissional e
 * QUAL convenio, para quem tem dez linhas abertas achar o campo.
 *
 * Com `planos` ("Convenios que cobrem" marcados), recusa a linha com
 * convenio que nao esta entre eles (a RPC recusaria com 23514). Sem
 * `planos`, como era ate 02/10.
 */
export function vinculosDasLinhas(
  linhas: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
  nomes: NomesDosCadastros,
  planos?: readonly string[],
): ResultadoDasLinhas {
  const vinculos: VinculoDesejado[] = [];
  const profissionaisVistos = new Set<string>();
  const cobrem = planos === undefined ? null : new Set(planos);

  for (const linha of linhas) {
    const nome = nomes.profissional(linha.professionalId);
    if (profissionaisVistos.has(linha.professionalId)) {
      return { ok: false, erro: `${nome} aparece duas vezes na lista.` };
    }
    profissionaisVistos.add(linha.professionalId);

    if (linha.convenios.length === 0) {
      return {
        ok: false,
        erro: `${nome}: marque ao menos o Particular ou um convênio, ou remova o profissional deste procedimento.`,
      };
    }

    const conveniosVistos = new Set<string>();
    for (const ajuste of linha.convenios) {
      const chave = ajuste.insuranceId ?? "particular";
      const convenio = nomes.convenio(ajuste.insuranceId);
      if (conveniosVistos.has(chave)) {
        return {
          ok: false,
          erro: `${nome}: ${convenio} aparece duas vezes.`,
        };
      }
      conveniosVistos.add(chave);

      if (
        cobrem !== null &&
        ajuste.insuranceId !== null &&
        !cobrem.has(ajuste.insuranceId)
      ) {
        return {
          ok: false,
          erro: `${nome}, ${convenio}: este convênio não está marcado em ${ROTULO_DOS_PLANOS}.`,
        };
      }

      if (ajuste.padrao) {
        vinculos.push({
          professional_id: linha.professionalId,
          insurance_id: ajuste.insuranceId,
          ...valoresDoPadrao(ajuste.insuranceId, padrao),
        });
        continue;
      }

      const duracao = lerDuracao(ajuste.duracao);
      if (duracao === null) {
        return {
          ok: false,
          erro: `${nome}, ${convenio}: informe a duração em minutos (entre ${DURACAO_MINIMA} e ${DURACAO_MAXIMA}).`,
        };
      }

      if (ajuste.modo === "coberto") {
        if (ajuste.insuranceId === null) {
          return {
            ok: false,
            erro: `${nome}, Particular: Coberto pelo convênio só vale para convênio.`,
          };
        }
        vinculos.push({
          professional_id: linha.professionalId,
          insurance_id: ajuste.insuranceId,
          price_cents: null,
          covered_by_insurance: true,
          duration_min: duracao,
        });
        continue;
      }

      if (ajuste.modo === "sem") {
        vinculos.push({
          professional_id: linha.professionalId,
          insurance_id: ajuste.insuranceId,
          price_cents: null,
          covered_by_insurance: false,
          duration_min: duracao,
        });
        continue;
      }

      const centavos = lerReais(ajuste.precoReais);
      if (centavos === null) {
        return {
          ok: false,
          erro: `${nome}, ${convenio}: informe o valor em reais, por exemplo 250,00.`,
        };
      }
      if (centavos === undefined) {
        return {
          ok: false,
          erro: `${nome}, ${convenio}: não entendemos o valor. Use o formato 250,00.`,
        };
      }
      vinculos.push({
        professional_id: linha.professionalId,
        insurance_id: ajuste.insuranceId,
        price_cents: centavos,
        covered_by_insurance: false,
        duration_min: duracao,
      });
    }
  }

  return { ok: true, vinculos };
}

/**
 * O terceiro argumento de sincronizarVinculosDoProcedimentoAction (sem ele,
 * a RPC fica no modo de antes de 02/10). A action o leva para a RPC como
 * p_planos, p_vinculos_na_abertura, p_planos_na_abertura e p_confirmar.
 */
export type ExtrasDaSincronizacao = {
  /** "Convenios que cobrem" marcados agora: a RPC grava procedure_insurance assim */
  planos: string[];
  /**
   * Vinculos ATIVOS do procedimento quando o modal abriu (null = Particular).
   * A RPC compara com o banco sob a trava e recusa com CZ409 se mudou.
   */
  vinculosNaAbertura: {
    professional_id: string;
    insurance_id: string | null;
  }[];
  /** procedure_insurance como estava gravado na abertura (sem a cura) */
  planosNaAbertura: string[];
  /** false: com consulta futura em vinculo que sai, a RPC nao grava e avisa */
  confirmar: boolean;
};

/**
 * Monta o `extras` do Salvar. Os dois "na abertura" saem do retrato tirado
 * quando o modal abriu (`abertura`), nunca do catalogo de agora: o catalogo
 * em cache pode ter sido recarregado com o modal aberto e a trava otimista
 * deixaria passar a aba parada. Procedimento novo (`abertura` nula): nada
 * na abertura (a RPC roda depois do insert do procedimento).
 */
export function extrasDaSincronizacao(
  abertura: AberturaComPlanos | null,
  planos: readonly string[],
  confirmar: boolean,
): ExtrasDaSincronizacao {
  return {
    planos: Array.from(new Set(planos)),
    vinculosNaAbertura: (abertura?.linhas ?? []).flatMap((linha) =>
      linha.convenios.map((ajuste) => ({
        professional_id: linha.professionalId,
        insurance_id: ajuste.insuranceId,
      })),
    ),
    planosNaAbertura: Array.from(new Set(abertura?.planosGravados ?? [])),
    confirmar,
  };
}

/** Resumo para as colunas "Quem faz" e "Convênios" da tabela */
export type ResumoDoProcedimento = {
  /** ids dos profissionais que fazem (vinculo ativo), na ordem pedida */
  profissionais: string[];
  /** convenios aceitos por alguem; null = Particular, sempre primeiro */
  convenios: (string | null)[];
};

/**
 * Quem faz e quais convenios o procedimento aceita HOJE, para a tabela:
 * so vinculos ativos de profissionais e convenios ativos (o que a Agenda
 * oferece). Um convenio entra se ao menos um profissional o aceita.
 */
export function resumoDoProcedimento(
  vinculos: readonly VinculoGravado[],
  procedureId: string,
  profissionaisAtivos: readonly string[],
  conveniosAtivos: readonly string[],
): ResumoDoProcedimento {
  const profissionais = new Set<string>();
  const convenios = new Set<string | null>();
  const profissionalAtivo = new Set(profissionaisAtivos);
  const convenioAtivo = new Set(conveniosAtivos);
  for (const vinculo of vinculos) {
    if (
      vinculo.procedure_id !== procedureId ||
      !vinculo.active ||
      !profissionalAtivo.has(vinculo.professional_id)
    ) {
      continue;
    }
    if (
      vinculo.insurance_id !== null &&
      !convenioAtivo.has(vinculo.insurance_id)
    ) {
      continue;
    }
    profissionais.add(vinculo.professional_id);
    convenios.add(vinculo.insurance_id);
  }
  return {
    profissionais: profissionaisAtivos.filter((id) => profissionais.has(id)),
    convenios: [
      ...(convenios.has(null) ? [null] : []),
      ...conveniosAtivos.filter((id) => convenios.has(id)),
    ],
  };
}

/**
 * "Ver detalhes" (modo leitura): das linhas da tela, so o que a Agenda
 * oferece hoje, pelo mesmo criterio de resumoDoProcedimento: profissional
 * ativo e, em cada um, Particular ou convenio ativo. E o que a recepcao
 * responde ao paciente, entao nao pode mostrar quem saiu da clinica nem
 * convenio desativado como se valessem (desativar um profissional ou um
 * convenio nao desativa os vinculos dele). O profissional que fica sem
 * nenhum convenio oferecido sai inteiro. `ocultos` diz se algo ficou de fora,
 * para a tela explicar numa nota.
 */
export function linhasQueAAgendaOferece(
  linhas: readonly LinhaDoProfissional[],
  profissionaisAtivos: readonly string[],
  conveniosAtivos: readonly string[],
): { linhas: LinhaDoProfissional[]; ocultos: boolean } {
  const profissionalAtivo = new Set(profissionaisAtivos);
  const convenioAtivo = new Set(conveniosAtivos);
  const visiveis: LinhaDoProfissional[] = [];
  let ocultos = false;
  for (const linha of linhas) {
    if (!profissionalAtivo.has(linha.professionalId)) {
      ocultos = true;
      continue;
    }
    const convenios = linha.convenios.filter(
      (ajuste) =>
        ajuste.insuranceId === null || convenioAtivo.has(ajuste.insuranceId),
    );
    if (convenios.length !== linha.convenios.length) {
      ocultos = true;
    }
    if (convenios.length > 0) {
      visiveis.push({ ...linha, convenios });
    }
  }
  return { linhas: visiveis, ocultos };
}

/**
 * Lista curta para uma celula de tabela: ate `limite` nomes e "+N" para o
 * resto ("Dr. João, Dra. Ana +2").
 */
export function listaCurta(nomes: readonly string[], limite: number): string {
  if (nomes.length <= limite) {
    return nomes.join(", ");
  }
  return `${nomes.slice(0, limite).join(", ")} +${nomes.length - limite}`;
}
