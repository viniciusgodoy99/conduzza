import { describe, expect, it } from "vitest";

import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import { detectarUrgencia } from "@/lib/domain/conformidade/urgencia";
import {
  ALARMES_FALSOS_DO_REV4,
  COMUNS_DO_REV4,
  URGENCIAS_DO_REV4,
} from "@/tests/fixtures/ia/conformidade/casos-ag6";

// Revisao RR2 (rev4, regra 4): os conjuntos do revisor da 1cf092d viram teste
// permanente. Toda urgencia deles marca (as emergencias novas, as regressoes
// da RR1 contra a 88e9560, as que ja se perdiam antes e as excecoes com a
// marca que as desfaz) e e o primeiro gatilho do portao. Das 156 comuns, so
// as do alarme falso aceito pela regra 1 (o risco de vida sem excecao)
// marcam.

describe("os conjuntos do revisor da revisão RR2 (rev4)", () => {
  it("os conjuntos estão inteiros (165 urgências e 156 comuns)", () => {
    expect(URGENCIAS_DO_REV4).toHaveLength(165);
    expect(COMUNS_DO_REV4).toHaveLength(156);
    expect(new Set(URGENCIAS_DO_REV4.map((t) => t.join(" || "))).size).toBe(
      165,
    );
  });

  it.each(
    URGENCIAS_DO_REV4.map((textos) => [textos.join(" || "), textos] as const),
  )("%s: urgência e o primeiro gatilho do portão", (_texto, textos) => {
    expect(detectarUrgencia(textos)).not.toBeNull();
    expect(
      detectarGatilhosDeEntrada({
        mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
      })[0],
    ).toBe("urgencia");
  });

  it("das comuns, só o alarme falso aceito marca (5 de 156), cada um com o motivo", () => {
    const alarmes = new Set(ALARMES_FALSOS_DO_REV4.map((a) => a.texto));
    expect(alarmes.size).toBe(5);
    for (const textos of COMUNS_DO_REV4) {
      const texto = textos.join(" || ");
      if (alarmes.has(texto)) {
        expect(detectarUrgencia(textos)?.tipo, texto).toBe("risco_de_vida");
      } else {
        expect(detectarUrgencia(textos), texto).toBeNull();
      }
    }
    for (const alarme of ALARMES_FALSOS_DO_REV4) {
      expect(alarme.motivo.trim().length).toBeGreaterThan(10);
      expect(alarme.motivo).not.toMatch(/[–—]/);
    }
  });
});
