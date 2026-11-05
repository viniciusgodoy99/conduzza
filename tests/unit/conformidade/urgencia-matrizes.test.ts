import { describe, expect, it } from "vitest";

import { detectarUrgencia } from "@/lib/domain/conformidade/urgencia";
import {
  MATRIZES_DA_URGENCIA,
  MATRIZES_DO_RR1,
} from "@/tests/fixtures/ia/conformidade/casos-ag6";

// Revisao R2 de d1a15f6 (o defeito de metodo da trava): a nao regressao
// compara a frase exata, e as excecoes criadas para os falsos positivos
// aceitos generalizaram para emergencias reais (a matriz s4 do revisor, 10
// sinais de AVC x 10 finais: a d1a15f6 perdia 63 das 70 que a edd123c
// marcava). As matrizes geradas (casos-ag6.ts, MATRIZES_DA_URGENCIA) cruzam o
// relato de agora de cada sinal com excecao com os finais que as excecoes
// leem. Toda frase gerada TEM de ser urgencia: a que deixar de ser e uma
// excecao que generalizou.

describe("as matrizes geradas da urgência (revisão R2 de d1a15f6)", () => {
  it.each(
    Object.entries(MATRIZES_DA_URGENCIA).map(
      ([nome, frases]) => [nome, frases] as const,
    ),
  )("%s: toda frase gerada é urgência", (_nome, frases) => {
    const fora = frases.filter((textos) => detectarUrgencia(textos) === null);
    expect(fora).toEqual([]);
  });

  it("a matriz do revisor (s4) está inteira: 10 sinais x 10 finais", () => {
    const s4 = MATRIZES_DA_URGENCIA.boca_e_rosto_x_final_generico ?? [];
    expect(s4).toHaveLength(100);
    expect(new Set(s4.map((textos) => textos.join(" "))).size).toBe(100);
    // Os exemplos do revisor (A1).
    for (const texto of [
      "minha boca ficou torta agora, quero tratar",
      "minha mae ta com a boca torta, quero fazer uma consulta",
      "meu rosto ta torto, vou fazer uma avaliacao",
      "minha boca ta torta do lado esquerdo, quero fazer uma consulta",
    ]) {
      expect(
        s4.some((textos) => textos[0] === texto),
        texto,
      ).toBe(true);
    }
  });

  it("cada matriz cobre o que diz: a estética com o objeto, a pergunta, a ameaça, as grafias", () => {
    for (const nome of [
      "boca_e_rosto_x_final_generico",
      "boca_e_rosto_com_a_guarda_x_objeto",
      "rosto_caido_x_final",
      "relato_x_pergunta_do_efeito",
      "pergunta_do_efeito_x_relato",
      "hipotese_x_relato",
      "exagero_x_ameaca",
      "emergencia_x_ajuda",
      "preenchimento_antigo_x_agora",
      "outra_pessoa_x_relato",
      "grafias_de_me_matar",
      "grafias_de_morrer",
      "grafias_da_negacao",
      "visao_x_contexto",
      "figura_x_piora",
      "quase_desmaio_x_mal",
      "regras_que_generalizavam",
    ]) {
      expect(MATRIZES_DA_URGENCIA[nome]?.length ?? 0, nome).toBeGreaterThan(0);
    }
  });
});

// Revisao RR1 (a politica nova das excecoes): as matrizes do revisor da
// 88e9560 cruzam cada excecao com o que esta FORA das listas fechadas de
// antes (o tempo recente em qualquer forma, o relato que retoma o sinal, a
// terceira pessoa, o mal-estar e a ameaca ditos de outro jeito, a dose em
// gotas e mg) e as seis emergencias que nao escalavam por nada. A 88e9560
// marcava 28 das 841 frases das matrizes do revisor; a edd123c, 666. Toda
// frase TEM de ser urgencia (toda que a edd123c marca continua marcada).
describe("as matrizes do revisor da revisão RR1", () => {
  it.each(
    Object.entries(MATRIZES_DO_RR1).map(
      ([nome, frases]) => [nome, frases] as const,
    ),
  )("%s: toda frase gerada é urgência", (_nome, frases) => {
    const fora = frases.filter((textos) => detectarUrgencia(textos) === null);
    expect(fora).toEqual([]);
  });

  it("as matrizes estão inteiras (as 841 das matrizes do revisor, as 74 da história, da hipótese e da dose, e as seis)", () => {
    const tamanhos = Object.fromEntries(
      Object.entries(MATRIZES_DO_RR1).map(([nome, frases]) => [
        nome,
        frases.length,
      ]),
    );
    expect(tamanhos).toEqual({
      a_estetica_x_tempo: 576,
      b_pergunta_x_relato: 80,
      c_agenda_x_mal: 50,
      d_figura_x_ameaca: 32,
      e_oculos_x_perda: 35,
      f_laser_x_tiro: 16,
      g_receita_x_dose: 16,
      h_cirurgia_x_cianose: 20,
      i_nariz_x_parada: 16,
      p_historia_x_recente: 30,
      q_hipotese_x_relato: 16,
      r_historia_x_relato: 24,
      s_dose: 4,
      seis_que_nao_escalavam: 6,
    });
  });
});
