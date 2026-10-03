import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRILHA_DO_TERMO,
  tentarMoverPorTermo,
} from "@/lib/integrations/whatsapp/termo-chave";
import { BancoFalso } from "./banco-falso";

// O encanamento do termo-chave (lib/integrations/whatsapp/termo-chave.ts),
// que as tres portas usam: a ingestao (paciente), o envio pelo sistema e o
// eco do celular (clinica). A decisao pura esta provada em
// tests/unit/domain/jornada-termo.test.ts; aqui, com um banco em memoria, o
// que so o encanamento faz: le a etapa de cada contato, respeita quem
// escreveu, grava guardado pela etapa atual, deixa a trilha certa (com a
// origem e sem o texto) e nunca poe texto de conversa em log.
//
// O caminho contra o banco real e tests/integration/termo-chave.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const CONTATO = "d2222222-2222-4222-8222-222222222222";
const ATENDENTE = "a3333333-3333-4333-8333-333333333333";

const banco = new BancoFalso();
const admin = () => banco.cliente() as unknown as SupabaseClient;

function jornada(): void {
  const etapas = [
    ["novo", 10, [], "entrada", "paciente"],
    ["boas_vindas", 20, ["seja bem-vinda"], null, "clinica"],
    ["orcamento", 30, ["quanto custa"], null, "paciente"],
    ["proposta", 40, ["proposta"], null, "qualquer"],
    ["agendou", 50, [], "agendou", "paciente"],
    ["perdido", 60, [], "perdido", "paciente"],
  ] as const;
  for (const [chave, posicao, termos, papel, termosDeQuem] of etapas) {
    banco.linhas("funnel_stage_def").push({
      clinic_id: CLINICA,
      chave,
      posicao,
      termos_chave: [...termos],
      papel,
      termos_de_quem: termosDeQuem,
    });
  }
}

function contato(etapa: string): void {
  banco
    .linhas("contact")
    .push({ id: CONTATO, clinic_id: CLINICA, funnel_stage: etapa });
}

function etapaDoContato(): unknown {
  return banco.linhas("contact")[0]?.funnel_stage;
}

let saida: string[] = [];

beforeEach(() => {
  banco.limpar();
  saida = [];
  const capturar = (pedaco: string | Uint8Array): boolean => {
    saida.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tentarMoverPorTermo", () => {
  it("texto do paciente move pela etapa do paciente, com a trilha de sempre e sem autor", async () => {
    jornada();
    contato("novo");

    const destino = await tentarMoverPorTermo(admin(), {
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "Oi, quanto custa a consulta?",
      quemEscreveu: "paciente",
      userId: null,
    });

    expect(destino).toBe("orcamento");
    expect(etapaDoContato()).toBe("orcamento");
    expect(banco.linhas("audit_log")).toEqual([
      {
        clinic_id: CLINICA,
        user_id: null,
        action: "termo_chave_moveu_etapa",
        entity: "contact",
        entity_id: CONTATO,
      },
    ]);
  });

  it("texto da clínica move pela etapa da clínica, com a trilha da clínica e quem enviou", async () => {
    jornada();
    contato("novo");

    const destino = await tentarMoverPorTermo(admin(), {
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "Olá! Seja bem-vinda à Clínica Salud Care.",
      quemEscreveu: "clinica",
      userId: ATENDENTE,
    });

    expect(destino).toBe("boas_vindas");
    expect(etapaDoContato()).toBe("boas_vindas");
    expect(banco.linhas("audit_log")).toEqual([
      {
        clinic_id: CLINICA,
        user_id: ATENDENTE,
        action: "termo_chave_moveu_etapa_clinica",
        entity: "contact",
        entity_id: CONTATO,
      },
    ]);
  });

  it("as duas trilhas começam igual: quem filtra por prefixo pega as duas", () => {
    expect(TRILHA_DO_TERMO.paciente).toBe("termo_chave_moveu_etapa");
    expect(TRILHA_DO_TERMO.clinica.startsWith(TRILHA_DO_TERMO.paciente)).toBe(
      true,
    );
  });

  it("termo de etapa do paciente escrito pela clínica não move nem audita", async () => {
    jornada();
    contato("novo");

    const destino = await tentarMoverPorTermo(admin(), {
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "Quanto custa? A consulta custa R$ 200.",
      quemEscreveu: "clinica",
      userId: ATENDENTE,
    });

    expect(destino).toBeNull();
    expect(etapaDoContato()).toBe("novo");
    expect(banco.linhas("audit_log")).toEqual([]);
  });

  it("termo de etapa da clínica escrito pelo paciente não move", async () => {
    jornada();
    contato("novo");

    expect(
      await tentarMoverPorTermo(admin(), {
        clinicId: CLINICA,
        contactId: CONTATO,
        corpo: "seja bem-vinda, foi o que vocês disseram",
        quemEscreveu: "paciente",
        userId: null,
      }),
    ).toBeNull();
    expect(etapaDoContato()).toBe("novo");
  });

  it("etapa de qualquer um anda pelos dois lados", async () => {
    jornada();
    contato("novo");

    expect(
      await tentarMoverPorTermo(admin(), {
        clinicId: CLINICA,
        contactId: CONTATO,
        corpo: "Segue a proposta",
        quemEscreveu: "clinica",
        userId: ATENDENTE,
      }),
    ).toBe("proposta");
  });

  it("o update é guardado pela etapa lida: se outro moveu antes, nada muda e nada é auditado", async () => {
    jornada();
    contato("novo");
    // Simula a corrida: entre a leitura e o update, outra mensagem (ou uma
    // pessoa) moveu o contato. O cliente devolve a etapa velha na leitura e
    // a linha ja esta em outra etapa na hora do update.
    const cliente = banco.cliente();
    const espiao = {
      from: (tabela: string) => {
        const consulta = cliente.from(tabela);
        if (tabela === "contact") {
          const update = consulta.update.bind(consulta);
          consulta.update = (valores: Record<string, unknown>) => {
            banco.linhas("contact")[0]!.funnel_stage = "agendou";
            return update(valores);
          };
        }
        return consulta;
      },
    } as unknown as SupabaseClient;

    const destino = await tentarMoverPorTermo(espiao, {
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "quanto custa?",
      quemEscreveu: "paciente",
      userId: null,
    });

    expect(destino).toBeNull();
    expect(etapaDoContato()).toBe("agendou");
    expect(banco.linhas("audit_log")).toEqual([]);
  });

  it("contato que não existe mais não é falha: não move e não loga erro", async () => {
    jornada();

    expect(
      await tentarMoverPorTermo(admin(), {
        clinicId: CLINICA,
        contactId: CONTATO,
        corpo: "quanto custa?",
        quemEscreveu: "paciente",
        userId: null,
      }),
    ).toBeNull();
    expect(saida).toEqual([]);
  });

  it("falha de leitura vira log só com ids e a origem, nunca o texto", async () => {
    const quebrado = {
      from: () => ({
        select: () => ({
          eq: () => {
            const resultado = {
              data: null,
              error: { code: "08006", message: "conexao caiu" },
            };
            const cadeia = {
              eq: () => cadeia,
              maybeSingle: () => Promise.resolve(resultado),
              then: (ok: (valor: typeof resultado) => unknown) =>
                Promise.resolve(resultado).then(ok),
            };
            return cadeia;
          },
        }),
      }),
    } as unknown as SupabaseClient;

    const corpo = "Meu exame deu alterado, quanto custa o retorno?";
    expect(
      await tentarMoverPorTermo(quebrado, {
        clinicId: CLINICA,
        contactId: CONTATO,
        corpo,
        quemEscreveu: "clinica",
        userId: ATENDENTE,
      }),
    ).toBeNull();

    const tudo = saida.join("");
    expect(tudo).toContain("termo_chave_ler_jornada_falhou");
    expect(tudo).toContain('"kind":"clinica"');
    expect(tudo).toContain('"error_code":"08006"');
    expect(tudo).not.toContain("exame");
    expect(tudo).not.toContain("quanto custa");
  });
});
