import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { adminClient } from "../rls/stack";

// Fase 4, divida de LGPD confirmada na revisao adversarial: abrir a ficha de
// um paciente precisa dizer QUEM leu a ficha de QUEM. O throttle da trilha
// ignorava o entity_id, entao trinta fichas abertas em cinco minutos viravam
// UMA linha e a auditoria nao servia para nada.
//
// Testa o miolo (auditarLeituraDePaciente) contra o banco REAL: a
// abrirDetalheDoContatoAction e casca fina em volta dele, resolvendo clinica
// e usuario da sessao. Clinica e usuario descartaveis, service role no setup.

const admin = adminClient();
const sufixo = Date.now().toString(36);

let clinicId = "";
let userId = "";
let contatoA = "";
let contatoB = "";

async function criarContato(telefone: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Trilha",
      kind: "paciente",
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Linhas "leu" da trilha, mais novas primeiro, com o alvo de cada leitura. */
async function leituras(entity: string) {
  const { data } = await admin
    .from("audit_log")
    .select("entity, entity_id, created_at")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("action", "leu")
    .eq("entity", entity)
    .order("created_at", { ascending: false })
    .throwOnError();
  return data ?? [];
}

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({ name: `Trilha ${sufixo}`, slug: `trilha-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;

  const { data: pessoa, error } = await admin.auth.admin.createUser({
    email: `trilha-${sufixo}@exemplo.test`,
    password: `Trilha!${sufixo}`,
    email_confirm: true,
    user_metadata: { name: "Recepção Trilha" },
  });
  if (error || !pessoa.user) {
    throw new Error(`criar usuário: ${error?.message ?? "sem usuário"}`);
  }
  userId = pessoa.user.id;
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: userId,
      role: "recepcao",
      status: "ativo",
    })
    .throwOnError();

  contatoA = await criarContato("+5584979900001");
  contatoB = await criarContato("+5584979900002");
});

afterAll(async () => {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("trilha de leitura da ficha do paciente", () => {
  it("cada ficha aberta deixa a própria linha, com o id do contato", async () => {
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "ficha_paciente",
      entityId: contatoA,
    });
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "ficha_paciente",
      entityId: contatoB,
    });

    const linhas = await leituras("ficha_paciente");
    expect(linhas).toHaveLength(2);
    expect(linhas.map((linha) => linha.entity_id).sort()).toEqual(
      [contatoA, contatoB].sort(),
    );
  });

  it("reabrir a MESMA ficha dentro da janela não empilha linha nova", async () => {
    // Os dois contatos ja foram lidos no teste anterior, dentro da janela de
    // 5 minutos: reabrir os dois nao pode gerar nada.
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "ficha_paciente",
      entityId: contatoA,
    });
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "ficha_paciente",
      entityId: contatoA,
    });
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "ficha_paciente",
      entityId: contatoB,
    });

    const linhas = await leituras("ficha_paciente");
    expect(linhas).toHaveLength(2);
  });

  it("tela de lista (sem id) continua com uma linha só por janela", async () => {
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "leads",
    });
    await auditarLeituraDePaciente(admin, {
      clinicId,
      userId,
      entity: "leads",
    });

    const linhas = await leituras("leads");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.entity_id).toBeNull();
  });
});
