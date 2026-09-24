import { describe, expect, it } from "vitest";

import { rotuloDoPasso } from "@/lib/domain/textos-padrao";

describe("rotuloDoPasso", () => {
  it("usa os rotulos padrao so da regua certa", () => {
    expect(rotuloDoPasso(-4320, "confirmacao")).toBe("72 horas antes");
    expect(rotuloDoPasso(-1440, "confirmacao")).toBe("24 horas antes");
    expect(rotuloDoPasso(-180, "confirmacao")).toBe("3 horas antes");
    expect(rotuloDoPasso(0, "pos_falta")).toBe("No dia da falta");
    expect(rotuloDoPasso(2880, "pos_falta")).toBe("Dois dias depois");
  });

  it("follow-up com 0 horas e 'Na hora', nunca 'No dia da falta'", () => {
    expect(rotuloDoPasso(0, "followup")).toBe("Na hora");
  });

  it("follow-up conta horas e dias pela conta generica", () => {
    expect(rotuloDoPasso(60, "followup")).toBe("1 hora depois");
    expect(rotuloDoPasso(180, "followup")).toBe("3 horas depois");
    expect(rotuloDoPasso(2880, "followup")).toBe("2 dias depois");
    expect(rotuloDoPasso(1440, "followup")).toBe("1 dia depois");
  });

  it("offset que nao e padrao da regua cai na conta generica", () => {
    expect(rotuloDoPasso(2880, "confirmacao")).toBe("2 dias depois");
    expect(rotuloDoPasso(-180, "pos_falta")).toBe("3 horas antes");
  });
});
