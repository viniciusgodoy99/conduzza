import { anonClient } from "../../tests/rls/stack";
import { seedClient } from "../seed/lib";

// Prova de fluxo ponta a ponta contra o banco real, com dados descartaveis.
// Exercita cadastro criando clinica, cadastro por codigo, o bloqueio do
// membro pendente e a liberacao pelo administrador. Limpa tudo no fim.
//
//   npx tsx scripts/dev/prova-de-fluxo.ts

const SENHA = "Prova!Fluxo2026";

function ok(condicao: boolean, texto: string): boolean {
  console.log(`   ${condicao ? "✔" : "✘"} ${texto}`);
  return condicao;
}

async function main() {
  const admin = seedClient();
  const s = Math.floor(Date.now() / 1000).toString(36);
  let falhas = 0;
  let clinicId = "";

  try {
    console.log("1. Cadastro criando clínica");
    const { data: dona, error: e1 } = await admin.auth.admin.createUser({
      email: `dona-${s}@teste.dev`,
      password: SENHA,
      email_confirm: true,
      user_metadata: {
        tipo: "clinica",
        nome: "Dra Ana",
        nome_clinica: `Clínica Prova ${s}`,
        name: "Dra Ana",
      },
    });
    if (e1 || !dona.user) {
      throw new Error(`cadastro de clínica falhou: ${e1?.message}`);
    }
    const { data: membro } = await admin
      .from("clinic_member")
      .select("clinic_id, role, status")
      .eq("user_id", dona.user.id)
      .single();
    clinicId = membro!.clinic_id as string;
    // Entrada por codigo nasce DESLIGADA (padrao seguro apos a auditoria):
    // a clinica liga de propria vontade na tela.
    const { data: antesDeLigar } = await admin
      .from("clinic")
      .select("allow_code_signup")
      .eq("id", clinicId)
      .single();
    if (
      !ok(
        antesDeLigar!.allow_code_signup === false,
        "entrada por código nasce desligada",
      )
    )
      falhas++;
    await admin
      .from("clinic")
      .update({ allow_code_signup: true })
      .eq("id", clinicId);
    const { data: clinica } = await admin
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", clinicId)
      .single();
    const { data: branding } = await admin
      .from("clinic_branding")
      .select("clinic_id")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!ok(membro!.role === "admin", "quem criou é administrador")) falhas++;
    if (!ok(membro!.status === "ativo", "vínculo já nasce ativo")) falhas++;
    if (!ok(branding !== null, "marca criada na mesma transação")) falhas++;
    if (!ok((clinica!.code as string).length >= 8, "código de acesso gerado"))
      falhas++;

    console.log("2. Cadastro por código");
    const { data: recep, error: e2 } = await admin.auth.admin.createUser({
      email: `recep-${s}@teste.dev`,
      password: SENHA,
      email_confirm: true,
      user_metadata: {
        tipo: "codigo",
        nome: "Marina",
        codigo: clinica!.code,
        name: "Marina",
      },
    });
    if (e2 || !recep.user) {
      throw new Error(`cadastro por código falhou: ${e2?.message}`);
    }
    const { data: vinculo } = await admin
      .from("clinic_member")
      .select("status")
      .eq("user_id", recep.user.id)
      .single();
    if (!ok(vinculo!.status === "pendente", "entra como pendente, não ativo"))
      falhas++;

    console.log("3. Código inválido é recusado");
    const { error: e3 } = await admin.auth.admin.createUser({
      email: `invalido-${s}@teste.dev`,
      password: SENHA,
      email_confirm: true,
      user_metadata: { tipo: "codigo", nome: "X", codigo: "NAOEXISTE" },
    });
    if (!ok(e3 !== null, "cadastro recusado com código inexistente")) falhas++;

    console.log("4. Pendente não enxerga dado de paciente");
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: `+55849${s.slice(-7).padStart(7, "0")}`,
        name: "Paciente Reservado",
      })
      .select("id")
      .single();
    await admin.from("conversation").insert({
      clinic_id: clinicId,
      contact_id: contato!.id,
      status: "aguardando_humano",
    });

    const clientePendente = anonClient();
    await clientePendente.auth.signInWithPassword({
      email: `recep-${s}@teste.dev`,
      password: SENHA,
    });
    const { data: conversasPendente } = await clientePendente
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId);
    const { data: contatosPendente } = await clientePendente
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId);
    const { data: clinicaPendente } = await clientePendente
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", clinicId);
    if (!ok((conversasPendente ?? []).length === 0, "não lê conversa"))
      falhas++;
    if (!ok((contatosPendente ?? []).length === 0, "não lê contato")) falhas++;
    if (
      !ok(
        (clinicaPendente ?? []).length === 0,
        "não lê o código de acesso da clínica",
      )
    )
      falhas++;

    console.log("5. Pendente não se autoaprova");
    await clientePendente
      .from("clinic_member")
      .update({ status: "ativo", role: "admin" })
      .eq("user_id", recep.user.id)
      .eq("clinic_id", clinicId);
    const { data: apos } = await admin
      .from("clinic_member")
      .select("status, role")
      .eq("user_id", recep.user.id)
      .single();
    if (!ok(apos!.status === "pendente", "continua pendente")) falhas++;
    if (!ok(apos!.role === "leitura", "não virou administrador")) falhas++;

    console.log("6. Administrador libera e o acesso abre");
    const clienteDona = anonClient();
    await clienteDona.auth.signInWithPassword({
      email: `dona-${s}@teste.dev`,
      password: SENHA,
    });
    const { error: eLib } = await clienteDona
      .from("clinic_member")
      .update({ status: "ativo", role: "recepcao" })
      .eq("clinic_id", clinicId)
      .eq("user_id", recep.user.id)
      .eq("status", "pendente");
    if (!ok(eLib === null, "liberação aceita")) falhas++;

    const clienteLiberado = anonClient();
    await clienteLiberado.auth.signInWithPassword({
      email: `recep-${s}@teste.dev`,
      password: SENHA,
    });
    const { data: conversasDepois } = await clienteLiberado
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId);
    if (!ok((conversasDepois ?? []).length === 1, "agora enxerga a conversa"))
      falhas++;

    console.log("7. Papel 'leitura' não escreve dado de paciente");
    const { data: leitor } = await admin.auth.admin.createUser({
      email: `leitor-${s}@teste.dev`,
      password: SENHA,
      email_confirm: true,
      user_metadata: { name: "Leitor" },
    });
    await admin.from("clinic_member").insert({
      clinic_id: clinicId,
      user_id: leitor!.user!.id,
      role: "leitura",
      status: "ativo",
    });
    const clienteLeitor = anonClient();
    await clienteLeitor.auth.signInWithPassword({
      email: `leitor-${s}@teste.dev`,
      password: SENHA,
    });
    const { error: eEscrita } = await clienteLeitor.from("contact").insert({
      clinic_id: clinicId,
      phone_e164: "+5584900000000",
      name: "Não deveria entrar",
    });
    if (!ok(eEscrita !== null, "escrita recusada pelo banco")) falhas++;
    const { data: leituraOk } = await clienteLeitor
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId);
    if (
      !ok((leituraOk ?? []).length === 1, "mas continua enxergando (leitura)")
    )
      falhas++;

    console.log("8. Consentimento revogado não pode ser reativado");
    const { data: consent } = await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contato!.id,
        source: "recepcao",
        revoked_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { error: eReativar } = await clienteDona
      .from("contact_consent")
      .update({ revoked_at: null })
      .eq("id", consent!.id);
    const { data: consentApos } = await admin
      .from("contact_consent")
      .select("active")
      .eq("id", consent!.id)
      .single();
    if (
      !ok(
        consentApos!.active === false,
        "descadastro do paciente continua valendo",
      )
    )
      falhas++;
    void eReativar;

    console.log("9. Descadastro não é contornado inserindo consentimento novo");
    // Vetor encontrado na auditoria: o gatilho impedia REATIVAR a linha
    // revogada, mas nada impedia inserir uma linha nova, e a checagem de
    // envio perguntava "existe alguma ativa".
    const { error: eInsercao } = await clienteDona
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contato!.id,
        source: "recepcao",
        channel: "whatsapp",
      });
    if (
      !ok(
        eInsercao !== null,
        "inserir consentimento sem evidência é recusado após descadastro",
      )
    )
      falhas++;

    const { data: vigente } = await admin.rpc("consentimento_vigente", {
      p_clinic_id: clinicId,
      p_contact_id: contato!.id,
      p_channel: "whatsapp",
    });
    if (!ok(vigente === false, "consentimento vigente continua negativo")) {
      falhas++;
    }

    // Com evidencia declarada, o reconsentimento e aceito e passa a valer.
    const { error: eComEvidencia } = await clienteDona
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contato!.id,
        source: "recepcao",
        channel: "whatsapp",
        evidence: "Paciente autorizou de novo por telefone em 20/08",
      });
    if (!ok(eComEvidencia === null, "com evidência declarada, é aceito")) {
      falhas++;
    }
    const { data: vigenteDepois } = await admin.rpc("consentimento_vigente", {
      p_clinic_id: clinicId,
      p_contact_id: contato!.id,
      p_channel: "whatsapp",
    });
    if (!ok(vigenteDepois === true, "e volta a valer")) falhas++;
  } finally {
    if (clinicId) {
      await admin.from("clinic").delete().eq("id", clinicId);
    }
    const { data: usuarios } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    for (const usuario of usuarios?.users ?? []) {
      const email = usuario.email ?? "";
      if (/^(dona|recep|invalido|leitor)-.*@teste\.dev$/.test(email)) {
        await admin.auth.admin.deleteUser(usuario.id);
      }
    }
    console.log("\nDados de prova removidos.");
  }

  if (falhas > 0) {
    console.error(`\n${falhas} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log("Todas as verificações passaram.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
