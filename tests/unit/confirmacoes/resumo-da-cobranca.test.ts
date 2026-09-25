import { describe, expect, it } from "vitest";

import { motivoDoPulo } from "@/components/confirmacoes/chip-do-toque";
import { resumoDaCobranca } from "@/components/confirmacoes/resumo-da-cobranca";

// O aviso do "Cobrar agora" da Tela 2 com varios numeros (docs/07): quantas
// ficaram de fora por numero desconectado e QUAL numero, sem prometer que
// elas saem depois (nada entrou na fila para elas).

describe("resumoDaCobranca", () => {
  it("tudo na fila: sucesso, sem detalhe", () => {
    expect(resumoDaCobranca({ enfileirados: 3 })).toEqual({
      tom: "success",
      titulo: "3 cobranças na fila de envio",
      detalhe: null,
    });
  });

  it("pulada por autorização continua sucesso quando algo saiu", () => {
    expect(
      resumoDaCobranca({ enfileirados: 1, pulados_sem_autorizacao: 2 }),
    ).toEqual({
      tom: "success",
      titulo: "1 cobrança na fila de envio, 2 puladas por falta de autorização",
      detalhe: null,
    });
  });

  it("parte presa em número desconectado: quantas e qual número", () => {
    const resumo = resumoDaCobranca({
      enfileirados: 2,
      pulados_sem_autorizacao: 0,
      pulados_desconectado: 1,
      numeros_desconectados: ["Recepção"],
    });
    expect(resumo.tom).toBe("warning");
    expect(resumo.titulo).toBe(
      "2 cobranças na fila de envio, 1 não cobrada por número desconectado",
    );
    expect(resumo.detalhe).toBe(
      'O número "Recepção" está desconectado. Reconecte em Configurações e cobre de novo.',
    );
    // Nada entrou na fila para elas: o aviso nao promete envio depois.
    expect(resumo.detalhe).not.toMatch(/fila|esperando|depois/);
  });

  it("dois números desconectados aparecem pelo nome", () => {
    const resumo = resumoDaCobranca({
      enfileirados: 1,
      pulados_desconectado: 3,
      numeros_desconectados: ["Recepção", "Unidade Sul"],
    });
    expect(resumo.titulo).toContain("3 não cobradas por número desconectado");
    expect(resumo.detalhe).toBe(
      'Os números "Recepção" e "Unidade Sul" estão desconectados. Reconecte em Configurações e cobre de novo.',
    );
  });

  it("sem nome para dizer, fala do WhatsApp da clínica", () => {
    const resumo = resumoDaCobranca({
      enfileirados: 1,
      pulados_desconectado: 1,
      numeros_desconectados: [],
    });
    expect(resumo.detalhe).toBe(
      "O WhatsApp está desconectado. Reconecte em Configurações e cobre de novo.",
    );
  });

  it("nada na fila é aviso", () => {
    expect(resumoDaCobranca({ enfileirados: 0 }).tom).toBe("warning");
  });
});

describe("motivoDoPulo", () => {
  it("número removido em português de recepção", () => {
    expect(motivoDoPulo("numero_removido")).toBe(
      "o número de WhatsApp foi removido da clínica",
    );
  });
});
