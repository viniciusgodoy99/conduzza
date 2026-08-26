import { afterAll, describe, expect, it } from "vitest";

import {
  NOME_REGUA_CONFIRMACAO,
  NOME_REGUA_POS_FALTA,
  PASSOS_CONFIRMACAO,
  PASSOS_POS_FALTA,
} from "@/lib/domain/textos-padrao";
import { adminClient } from "../rls/stack";

// lib/domain/textos-padrao.ts guarda uma COPIA do que seed_reguas_padrao grava
// em cadence_step.fixed_body, e os dois arquivos afirmam que existe um teste
// provando que eles não divergiram. Este é esse teste: sem ele, mudar a copy no
// TypeScript passava em toda a suíte enquanto o WhatsApp do paciente continuava
// recebendo o texto antigo (o envio lê o BANCO, não a constante).
//
// Quando este teste falhar, a correção não é mexer no expect: é escrever a
// migration que atualiza seed_reguas_padrao e as linhas já gravadas.

const admin = adminClient();
const clinicasCriadas: string[] = [];

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("textos padrão das réguas", () => {
  it("o que o código diz é o que o banco grava numa clínica nova", async () => {
    const sufixo = Date.now().toString(36);
    const { data: clinica } = await admin
      .from("clinic")
      .insert({ name: `Textos ${sufixo}`, slug: `textos-${sufixo}` })
      .select("id")
      .single()
      .throwOnError();
    const clinicId = clinica!.id as string;
    clinicasCriadas.push(clinicId);

    // O gatilho seed_reguas_da_clinica_nova já rodou junto com o insert.
    const { data: reguas } = await admin
      .from("cadence")
      .select(
        "id, kind, name, active, cadence_step (offset_minutes, fixed_body)",
      )
      .eq("clinic_id", clinicId)
      .throwOnError();

    type Passo = { offset_minutes: number; fixed_body: string | null };
    type Regua = {
      kind: string;
      name: string;
      active: boolean;
      cadence_step: Passo[];
    };
    const porTipo = new Map(
      ((reguas ?? []) as unknown as Regua[]).map((r) => [r.kind, r]),
    );

    const esperado = [
      {
        kind: "confirmacao",
        nome: NOME_REGUA_CONFIRMACAO,
        passos: PASSOS_CONFIRMACAO,
      },
      {
        kind: "pos_falta",
        nome: NOME_REGUA_POS_FALTA,
        passos: PASSOS_POS_FALTA,
      },
    ];

    for (const { kind, nome, passos } of esperado) {
      const regua = porTipo.get(kind);
      expect(regua, `a clínica nova não recebeu a régua ${kind}`).toBeDefined();
      expect(regua!.name).toBe(nome);
      // Nasce desligada: ligar é decisão consciente da clínica.
      expect(regua!.active).toBe(false);

      const noBanco = new Map(
        regua!.cadence_step.map((p) => [p.offset_minutes, p.fixed_body]),
      );
      expect(noBanco.size).toBe(passos.length);
      for (const passo of passos) {
        expect(
          noBanco.get(passo.offsetMinutes),
          `passo ${passo.offsetMinutes} da régua ${kind}`,
        ).toBe(passo.body);
      }
    }
  });

  it("nenhum texto que o paciente lê tem travessão", () => {
    // Regra 5 do CLAUDE.md, e ela vale para o que sai no WhatsApp também.
    for (const passo of [...PASSOS_CONFIRMACAO, ...PASSOS_POS_FALTA]) {
      expect(passo.body).not.toMatch(/[—–]/u);
    }
  });
});
