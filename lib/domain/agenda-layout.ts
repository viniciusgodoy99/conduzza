// Matematica PURA da grade da agenda (Tela 3). Toda conta de posicionamento
// vive aqui, testada, e os componentes so aplicam pixels: e o que mantem a
// grade sustentavel (modelo do handoff: posicionamento absoluto por minuto).

export type BlocoPosicionado<T> = {
  item: T;
  /** distancia do topo da coluna, em px */
  top: number;
  /** altura do bloco, em px */
  height: number;
  /** pista horizontal (0..lanes-1) para sobreposicoes lado a lado */
  lane: number;
  /** total de pistas no grupo de sobreposicao (para dividir a largura) */
  lanes: number;
};

export type ItemDeGrade = {
  startsAt: Date;
  endsAt: Date;
};

/** Minutos desde o inicio visivel do dia (ex.: 07:00) para um instante. */
export function minutosDesdeInicio(instante: Date, inicioDoDia: Date): number {
  return (instante.getTime() - inicioDoDia.getTime()) / 60_000;
}

export function minutoParaY(minutos: number, alturaHoraPx: number): number {
  return (minutos / 60) * alturaHoraPx;
}

export function duracaoParaAltura(
  startsAt: Date,
  endsAt: Date,
  alturaHoraPx: number,
): number {
  return minutoParaY(
    (endsAt.getTime() - startsAt.getTime()) / 60_000,
    alturaHoraPx,
  );
}

/**
 * Converte um deslocamento vertical em minutos desde o inicio visivel, com
 * SNAP a grade (default 15 min). Usado pelo clique no vao e pelo drop do
 * arrastar e soltar.
 */
export function yParaMinutos(
  y: number,
  alturaHoraPx: number,
  snapMin = 15,
): number {
  const minutos = (y / alturaHoraPx) * 60;
  return Math.round(minutos / snapMin) * snapMin;
}

/**
 * Distribui itens que se sobrepoem em pistas lado a lado (lanes), estilo
 * calendario: itens do mesmo grupo de sobreposicao dividem a largura da
 * coluna. Range semiaberto: fim encostado em inicio NAO sobrepoe.
 */
export function posicionarBlocos<T extends ItemDeGrade>(
  itens: T[],
  inicioDoDia: Date,
  alturaHoraPx: number,
): BlocoPosicionado<T>[] {
  const ordenados = [...itens].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      b.endsAt.getTime() - a.endsAt.getTime(),
  );

  const resultado: BlocoPosicionado<T>[] = [];
  // fim de cada pista dentro do grupo de sobreposicao corrente
  let pistas: number[] = [];
  let grupo: BlocoPosicionado<T>[] = [];

  const fecharGrupo = () => {
    const total = pistas.length;
    for (const bloco of grupo) {
      bloco.lanes = total;
    }
    pistas = [];
    grupo = [];
  };

  for (const item of ordenados) {
    const inicio = item.startsAt.getTime();
    // Grupo fecha quando o item nao sobrepoe NENHUMA pista aberta.
    if (grupo.length > 0 && pistas.every((fim) => fim <= inicio)) {
      fecharGrupo();
    }
    let lane = pistas.findIndex((fim) => fim <= inicio);
    if (lane === -1) {
      lane = pistas.length;
      pistas.push(0);
    }
    pistas[lane] = item.endsAt.getTime();

    const bloco: BlocoPosicionado<T> = {
      item,
      top: minutoParaY(
        minutosDesdeInicio(item.startsAt, inicioDoDia),
        alturaHoraPx,
      ),
      height: duracaoParaAltura(item.startsAt, item.endsAt, alturaHoraPx),
      lane,
      lanes: 1,
    };
    grupo.push(bloco);
    resultado.push(bloco);
  }
  fecharGrupo();
  return resultado;
}
