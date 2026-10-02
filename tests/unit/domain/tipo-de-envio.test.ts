import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ehTipoDeEnvio,
  ROTULO_DO_TIPO_DE_ENVIO,
  TIPOS_DE_ENVIO,
  tipoDeEnvioDaRegua,
} from "@/lib/domain/tipo-de-envio";
import { contasDeEnvio } from "@/lib/jobs/numero-de-envio";

import { bancoFalso } from "../jobs/banco-falso";

// Numero das mensagens automaticas POR TIPO (decisao do dono de 29/09/2026,
// docs/07). O banco decide o numero (resolver_conta_de_envio com o tipo, e
// tipo_de_envio_do_job deriva o tipo de cada job, ensaiado em SQL); aqui:
//   - os nomes dos tipos do codigo sao os do check da tabela e das portas;
//   - a derivacao do tipo pela regua (o mesmo que o banco faz pela run);
//   - contasDeEnvio leva o tipo ate a RPC;
//   - o aviso de remarcacao grava o marcador que o banco le no payload.

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260929130000_numero_por_tipo.sql"),
  "utf-8",
);

// Pelo codigo, para o caractere nao aparecer escrito no fonte.
const TRAVESSAO = String.fromCharCode(0x2014);

/** As listas `tipo in (...)` / `p_tipo not in (...)` da migration. */
function listasDaMigration(): string[][] {
  const listas: string[][] = [];
  for (const casamento of MIGRATION.matchAll(
    /tipo (?:not )?in \(\s*([^)]*)\)/g,
  )) {
    const itens = [...(casamento[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (item) => item[1],
    );
    if (itens.length > 0) {
      listas.push(itens as string[]);
    }
  }
  return listas;
}

describe("tipos de envio", () => {
  it("são os cinco do pedido do dono, na ordem da tela", () => {
    expect(TIPOS_DE_ENVIO).toEqual([
      "confirmacao",
      "pos_falta",
      "followup",
      "lista_espera",
      "aviso_remarcacao",
    ]);
  });

  it("o código e o banco usam os mesmos nomes (check da tabela e as duas portas)", () => {
    const listas = listasDaMigration();
    // check da tabela + conta_de_envio + contas_de_envio
    const completas = listas.filter((lista) => lista.length === 5);
    expect(completas.length).toBeGreaterThanOrEqual(3);
    for (const lista of completas) {
      expect([...lista].sort()).toEqual([...TIPOS_DE_ENVIO].sort());
    }
  });

  it("rótulos de recepcionista, sem travessão", () => {
    expect(ROTULO_DO_TIPO_DE_ENVIO).toEqual({
      confirmacao: "Confirmação de consulta e Cobrar agora",
      pos_falta: "Recuperação depois da falta",
      followup: "Follow-up de leads",
      lista_espera: "Oferta da lista de espera",
      aviso_remarcacao: "Aviso de remarcação",
    });
    for (const rotulo of Object.values(ROTULO_DO_TIPO_DE_ENVIO)) {
      expect(rotulo).not.toContain(TRAVESSAO);
    }
  });

  it("ehTipoDeEnvio só aceita os cinco", () => {
    for (const tipo of TIPOS_DE_ENVIO) {
      expect(ehTipoDeEnvio(tipo)).toBe(true);
    }
    for (const valor of ["reativacao", "eco", "", null, undefined, 1, {}]) {
      expect(ehTipoDeEnvio(valor)).toBe(false);
    }
  });
});

describe("derivação do tipo pela régua", () => {
  it("confirmação (inclui o Cobrar agora), pós falta e follow-up são o próprio kind", () => {
    expect(tipoDeEnvioDaRegua("confirmacao")).toBe("confirmacao");
    expect(tipoDeEnvioDaRegua("pos_falta")).toBe("pos_falta");
    expect(tipoDeEnvioDaRegua("followup")).toBe("followup");
    expect(tipoDeEnvioDaRegua("lista_espera")).toBe("lista_espera");
  });

  it("régua sem escolha própria (reativação) ou valor estranho: sem tipo, o último usado", () => {
    expect(tipoDeEnvioDaRegua("reativacao")).toBeNull();
    expect(tipoDeEnvioDaRegua(undefined)).toBeNull();
    expect(tipoDeEnvioDaRegua("aviso_remarcacao")).toBeNull();
  });

  it("o banco deriva igual: cadence.kind da run, e o marcador só no envio ativo", () => {
    // Os kinds de regua que o banco aceita como tipo sao os mesmos daqui.
    expect(MIGRATION).toMatch(
      /when c\.kind in \(\s*'confirmacao', 'pos_falta', 'followup', 'lista_espera'\s*\) then c\.kind/,
    );
    expect(MIGRATION).toMatch(
      /p_payload->>'tipo_de_envio' in \('aviso_remarcacao', 'lista_espera'\)/,
    );
    // O eco (D4) nunca tem tipo.
    expect(MIGRATION).toMatch(
      /resposta_ao_paciente', 'false'\) = 'true'\s*then null/,
    );
  });
});

describe("contasDeEnvio leva o tipo", () => {
  it("a RPC recebe p_tipo junto com os contatos, sem repetição", async () => {
    const b = bancoFalso({
      rpcs: {
        contas_de_envio: () => ({
          data: [
            {
              contact_id: "p1",
              whatsapp_account_id: "n1",
              nome: "Recepção",
              connection_status: "conectado",
            },
          ],
          error: null,
        }),
      },
    });

    const contas = await contasDeEnvio(
      b.admin,
      "clinica",
      ["p1", "p1"],
      "aviso_remarcacao",
    );

    expect(b.chamadasDe("contas_de_envio")).toEqual([
      {
        p_clinic_id: "clinica",
        p_contact_ids: ["p1"],
        p_tipo: "aviso_remarcacao",
      },
    ]);
    expect(contas?.get("p1")).toEqual({
      whatsappAccountId: "n1",
      nome: "Recepção",
      conectado: true,
    });
  });
});

describe("marcador do tipo no payload", () => {
  it("o aviso de remarcação grava tipo_de_envio, a chave que o banco lê", () => {
    const acao = readFileSync(
      join(process.cwd(), "app/(app)/agenda/actions.ts"),
      "utf-8",
    );
    expect(acao).toMatch(/tipo_de_envio: "aviso_remarcacao"/);
    expect(acao).toMatch(/"aviso_remarcacao",\s*\)/);
  });

  it("a oferta da lista de espera grava o marcador no SQL que cria o job", () => {
    expect(MIGRATION).toMatch(/'tipo_de_envio', 'lista_espera'/);
  });
});
