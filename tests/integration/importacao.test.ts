import { afterAll, describe, expect, it } from "vitest";

import type { LinhaImportada } from "@/lib/domain/importacao";
import {
  evidenciaDaDeclaracao,
  importarContatos,
  type DeclaracaoDeConsentimento,
} from "@/lib/integrations/importar-contatos";
import { adminClient } from "../rls/stack";

// Fase 4, tarefa 4.4, contra o banco REAL: o miolo da importacao
// (lib/integrations/importar-contatos.ts, o mesmo que a
// importarContatosAction chama por baixo do guard de sessao). Cobre as regras
// criticas: reconsentimento apos revogacao passa porque a evidencia da
// declaracao vai junto (e sem evidencia o gatilho do banco barra), nome
// preenchido nunca e sobrescrito pela planilha, consentimento vigente nao
// empilha linha nova e a campanha da planilha entra sem canal inventado.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const DECLARACAO: DeclaracaoDeConsentimento = {
  opcao: "recepcao",
  observacao: "Fichas assinadas em maio",
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Importa ${nome} ${sufixo}`, slug: `imp-${nome}-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return clinicId;
}

function linha(
  telefone: string,
  extras: Partial<LinhaImportada> = {},
): LinhaImportada {
  return {
    name: null,
    phone_e164: telefone,
    email: null,
    insurance_name: null,
    source_campaign: null,
    ...extras,
  };
}

async function contatoPorTelefone(clinicId: string, telefone: string) {
  const { data } = await admin
    .from("contact")
    .select(
      "id, name, email, insurance_id, kind, source_channel, source_campaign, source_method",
    )
    .eq("clinic_id", clinicId)
    .eq("phone_e164", telefone)
    .single()
    .throwOnError();
  return data!;
}

async function consentimentosDe(clinicId: string, contactId: string) {
  const { data } = await admin
    .from("contact_consent")
    .select("source, evidence, revoked_at, granted_at")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("granted_at", { ascending: true })
    .throwOnError();
  return data ?? [];
}

async function vigente(clinicId: string, contactId: string): Promise<boolean> {
  const { data } = await admin.rpc("consentimento_vigente", {
    p_clinic_id: clinicId,
    p_contact_id: contactId,
    p_channel: "whatsapp",
  });
  return data === true;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("importação de planilha: contatos novos", () => {
  it("cria o lead com consentimento de importação e a evidência da declaração", async () => {
    const clinicId = await criarClinica("novos");

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: DECLARACAO,
      lote: [
        linha("+5584981100001", { name: "Ana Prado" }),
        linha("+5584981100002"),
      ],
    });
    expect(resultado).toEqual({
      ok: true,
      importados: 2,
      atualizados: 0,
      reautorizados: 0,
      pulados: 0,
    });

    const contato = await contatoPorTelefone(clinicId, "+5584981100001");
    expect(contato.name).toBe("Ana Prado");
    expect(contato.kind).toBe("lead");

    const consentimentos = await consentimentosDe(
      clinicId,
      contato.id as string,
    );
    expect(consentimentos).toHaveLength(1);
    expect(consentimentos[0]).toMatchObject({
      source: "importacao_planilha",
      evidence: "Cadastro presencial na recepção: Fichas assinadas em maio",
      revoked_at: null,
    });
    expect(consentimentos[0]!.evidence).toBe(evidenciaDaDeclaracao(DECLARACAO));
    expect(await vigente(clinicId, contato.id as string)).toBe(true);
  });

  it("grava a campanha da planilha com method importacao e SEM inventar canal", async () => {
    const clinicId = await criarClinica("campanha");

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: { opcao: "formulario_site" },
      lote: [
        linha("+5584981200001", { source_campaign: "Feira de Saúde 2026" }),
      ],
    });
    expect(resultado).toMatchObject({ ok: true, importados: 1 });

    const contato = await contatoPorTelefone(clinicId, "+5584981200001");
    expect(contato.source_campaign).toBe("Feira de Saúde 2026");
    expect(contato.source_method).toBe("importacao");
    expect(contato.source_channel).toBeNull();
  });
});

describe("importação de planilha: contatos que já existem", () => {
  it("nunca sobrescreve nome preenchido; completa nome vazio, e-mail e convênio", async () => {
    const clinicId = await criarClinica("merge");
    await admin
      .from("contact")
      .insert([
        {
          clinic_id: clinicId,
          phone_e164: "+5584981300001",
          name: "Maria Original",
        },
        { clinic_id: clinicId, phone_e164: "+5584981300002", name: null },
      ])
      .throwOnError();
    const { data: convenio } = await admin
      .from("insurance")
      .insert({ clinic_id: clinicId, name: "Unimed" })
      .select("id")
      .single()
      .throwOnError();

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: { opcao: "recepcao" },
      lote: [
        linha("+5584981300001", {
          name: "Maria Da Planilha",
          email: "maria@exemplo.com",
          insurance_name: "unimed",
        }),
        linha("+5584981300002", { name: "Nome Novo" }),
      ],
    });
    expect(resultado).toMatchObject({
      ok: true,
      importados: 0,
      atualizados: 2,
    });

    const comNome = await contatoPorTelefone(clinicId, "+5584981300001");
    expect(comNome.name).toBe("Maria Original");
    expect(comNome.email).toBe("maria@exemplo.com");
    expect(comNome.insurance_id).toBe(convenio!.id);

    const semNome = await contatoPorTelefone(clinicId, "+5584981300002");
    expect(semNome.name).toBe("Nome Novo");
  });

  it("consentimento vigente é pulado: nenhuma linha nova empilhada", async () => {
    const clinicId = await criarClinica("vigente");
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: "+5584981400001" })
      .select("id")
      .single()
      .throwOnError();
    const contatoId = contato!.id as string;
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contatoId,
        channel: "whatsapp",
        source: "conversa",
        evidence: "Primeira mensagem recebida do contato",
      })
      .throwOnError();

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: { opcao: "recepcao" },
      lote: [linha("+5584981400001")],
    });
    expect(resultado).toMatchObject({
      ok: true,
      atualizados: 1,
      reautorizados: 0,
      pulados: 1,
    });
    expect(await consentimentosDe(clinicId, contatoId)).toHaveLength(1);
  });
});

describe("importação de planilha: reconsentimento após revogação", () => {
  it("sem evidência o banco barra; com a evidência da declaração o reconsentimento passa", async () => {
    const clinicId = await criarClinica("revog");
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: "+5584981500001" })
      .select("id")
      .single()
      .throwOnError();
    const contatoId = contato!.id as string;

    // Consentiu e depois se descadastrou (revogacao definitiva, regra 3.4).
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contatoId,
        channel: "whatsapp",
        source: "conversa",
        evidence: "Primeira mensagem recebida do contato",
      })
      .throwOnError();
    await admin
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
      .eq("contact_id", contatoId)
      .is("revoked_at", null)
      .throwOnError();
    expect(await vigente(clinicId, contatoId)).toBe(false);

    // A REGRA: linha nova sem evidencia nao nasce (gatilho
    // exigir_evidencia_de_reconsentimento).
    const { error: semEvidencia } = await admin.from("contact_consent").insert({
      clinic_id: clinicId,
      contact_id: contatoId,
      channel: "whatsapp",
      source: "importacao_planilha",
      evidence: null,
    });
    expect(semEvidencia).not.toBeNull();
    expect(semEvidencia?.message).toContain("evidência");

    // A importacao passa porque a evidencia da declaracao vai junto.
    const resultado = await importarContatos(admin, clinicId, {
      declaracao: DECLARACAO,
      lote: [linha("+5584981500001")],
    });
    expect(resultado).toMatchObject({
      ok: true,
      atualizados: 1,
      reautorizados: 1,
      pulados: 0,
    });
    expect(await vigente(clinicId, contatoId)).toBe(true);

    const consentimentos = await consentimentosDe(clinicId, contatoId);
    expect(consentimentos).toHaveLength(2);
    expect(consentimentos[1]).toMatchObject({
      source: "importacao_planilha",
      evidence: evidenciaDaDeclaracao(DECLARACAO),
      revoked_at: null,
    });
  });

  it("telefone repetido no lote não duplica contato nem consentimento", async () => {
    const clinicId = await criarClinica("dup");

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: { opcao: "recepcao" },
      lote: [
        linha("+5584981600001", { name: "Primeira Linha" }),
        linha("+5584981600001", { name: "Linha Repetida" }),
      ],
    });
    expect(resultado).toMatchObject({ ok: true, importados: 1 });

    const contato = await contatoPorTelefone(clinicId, "+5584981600001");
    expect(contato.name).toBe("Primeira Linha");
    expect(await consentimentosDe(clinicId, contato.id as string)).toHaveLength(
      1,
    );
  });
});
