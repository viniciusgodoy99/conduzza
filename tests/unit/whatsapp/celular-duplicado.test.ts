import { describe, expect, it } from "vitest";

import {
  acharCelularDuplicado,
  chaveDoCelularPareado,
  mensagemDeCelularDuplicado,
  pareamentoNovo,
  type NumeroConectado,
} from "@/lib/domain/celular-duplicado";

// Trava contra o mesmo celular em duas instancias (achado 10 do docs/07): a
// decisao pura. As Server Actions sao provadas em numeros-conexao.test.ts.

const CLINICA = "clinica-a";
const OUTRA = "clinica-b";

function conectado(
  dados: Partial<NumeroConectado> & { display_phone: string | null },
): NumeroConectado {
  return {
    id: "outro-numero",
    clinic_id: OUTRA,
    nome: "Número principal",
    ...dados,
  };
}

describe("chaveDoCelularPareado", () => {
  it("o que o uazapi grava (só dígitos, sem o nono dígito) e o formatado dão a mesma chave", () => {
    expect(chaveDoCelularPareado("558499990000")).toBe("+5584999990000");
    expect(chaveDoCelularPareado("5584999990000")).toBe("+5584999990000");
    expect(chaveDoCelularPareado("+55 84 99999-0000")).toBe("+5584999990000");
  });

  it("nome de perfil e valor curto não são telefone", () => {
    expect(chaveDoCelularPareado("Clinica 24h")).toBeNull();
    expect(chaveDoCelularPareado("Vinicius")).toBeNull();
    expect(chaveDoCelularPareado("12345")).toBeNull();
    expect(chaveDoCelularPareado("")).toBeNull();
    expect(chaveDoCelularPareado(null)).toBeNull();
  });
});

describe("acharCelularDuplicado", () => {
  const alvo = {
    accountId: "este-numero",
    clinicId: CLINICA,
    displayPhone: "5584999990000",
  };

  it("mesmo celular em outra clínica: não diz nada sobre ela", () => {
    const duplicado = acharCelularDuplicado(alvo, [
      conectado({ display_phone: "558499990000", nome: "Deles" }),
    ]);

    expect(duplicado).toEqual({ mesmaClinica: false });
    expect(mensagemDeCelularDuplicado(duplicado!)).toBe(
      "Este número já está conectado em outra conta do Conduzza. Fale com o suporte.",
    );
  });

  it("mesmo celular em outro número da clínica: diz qual", () => {
    const duplicado = acharCelularDuplicado(alvo, [
      conectado({ display_phone: "558499990000", nome: "Deles" }),
      conectado({
        id: "recepcao",
        clinic_id: CLINICA,
        nome: "Recepção",
        display_phone: "+55 84 99999-0000",
      }),
    ]);

    expect(duplicado).toEqual({ mesmaClinica: true, nome: "Recepção" });
    expect(mensagemDeCelularDuplicado(duplicado!)).toBe(
      "Este número já está conectado como Recepção.",
    );
  });

  it("o próprio número, outro celular e nome de perfil não contam", () => {
    expect(
      acharCelularDuplicado(alvo, [
        conectado({ id: "este-numero", display_phone: "5584999990000" }),
        conectado({ display_phone: "5584988880000" }),
        conectado({ display_phone: "Clinica 24h" }),
        conectado({ display_phone: null }),
      ]),
    ).toBeNull();
  });

  it("sem telefone de verdade no status, não há o que conferir", () => {
    expect(
      acharCelularDuplicado({ ...alvo, displayPhone: "Clinica 24h" }, [
        conectado({ display_phone: "Clinica 24h" }),
      ]),
    ).toBeNull();
  });
});

describe("pareamentoNovo", () => {
  it("vale quando o número não estava conectado", () => {
    expect(
      pareamentoNovo(
        { connection_status: "aguardando_qr", display_phone: null },
        "5584999990000",
      ),
    ).toBe(true);
  });

  it("vale quando estava conectado com OUTRO celular", () => {
    expect(
      pareamentoNovo(
        { connection_status: "conectado", display_phone: "5584988880000" },
        "5584999990000",
      ),
    ).toBe(true);
  });

  it("não vale quando já estava conectado com este celular (em qualquer grafia)", () => {
    expect(
      pareamentoNovo(
        { connection_status: "conectado", display_phone: "558499990000" },
        "5584999990000",
      ),
    ).toBe(false);
  });

  it("não vale sem telefone de verdade", () => {
    expect(
      pareamentoNovo(
        { connection_status: "desconectado", display_phone: null },
        "Clinica 24h",
      ),
    ).toBe(false);
  });
});
