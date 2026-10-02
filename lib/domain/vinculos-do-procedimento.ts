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

/**
 * Convenios que a linha de um profissional oferece para marcar: os ativos,
 * os ja marcados na tela e os que estavam gravados para ELE quando o modal
 * abriu. A ordem e a de `convenios`.
 */
export function conveniosParaMarcar<C extends Cadastro>(
  convenios: readonly C[],
  linha: LinhaDoProfissional,
  linhasNaAbertura: readonly LinhaDoProfissional[],
): C[] {
  const marcados = new Set(linha.convenios.map((ajuste) => ajuste.insuranceId));
  const gravados = new Set(
    linhaNaAbertura(linhasNaAbertura, linha.professionalId)?.convenios.map(
      (ajuste) => ajuste.insuranceId,
    ) ?? [],
  );
  return convenios.filter(
    (c) => c.active || marcados.has(c.id) || gravados.has(c.id),
  );
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
 * Linha de quem entra pelo "Adicionar quem faz". Quem estava gravado quando
 * o modal abriu volta com os convenios e os valores gravados; quem e novo
 * entra atendendo Particular pelo padrao (os convenios, quem cadastra marca:
 * nem todo profissional aceita todo convenio).
 */
export function linhaAoAdicionar(
  professionalId: string,
  linhasNaAbertura: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
): LinhaDoProfissional {
  return (
    linhaNaAbertura(linhasNaAbertura, professionalId) ?? {
      professionalId,
      convenios: [ajusteNovo(null, padrao)],
    }
  );
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
};

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
 * secao desativaria esses vinculos em silencio. Entao so regrava quando:
 *   - o procedimento e novo (`abertura` nula);
 *   - a chave "IA pode agendar" mudou (a RPC e quem a copia para os vinculos);
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
 */
export function vinculosDasLinhas(
  linhas: readonly LinhaDoProfissional[],
  padrao: PadraoDoProcedimento,
  nomes: NomesDosCadastros,
): ResultadoDasLinhas {
  const vinculos: VinculoDesejado[] = [];
  const profissionaisVistos = new Set<string>();

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
