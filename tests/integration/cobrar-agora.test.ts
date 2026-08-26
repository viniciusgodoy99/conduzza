import { afterAll, describe, expect, it } from "vitest";

import { minutosLocais, minutosParaHora } from "@/lib/domain/horarios";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  planejarCobrancaManual,
  type CobrancaManual,
} from "@/lib/jobs/cobranca-manual";
import { processarLote } from "@/lib/jobs/worker";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import { adminClient } from "../rls/stack";

// "Cobrar agora" da Tela 2 (tarefa 4.7): o toque pedido POR UMA PESSOA usa a
// mesma máquina da régua automática, com a marca 'manual' no payload do job.
//
// O que este teste prova é justamente o que a marca muda: a régua DESLIGADA e
// a janela de envio FECHADA não seguram a recepção, que está trabalhando e
// pediu o toque. O que ela não muda (consentimento e condição de parada)
// também é conferido aqui.
//
// Toda clínica daqui nasce com whatsapp_account provider 'fake': o canal desta
// máquina é real (uazapi) e nenhum teste pode encostar nele.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const TIMEZONE = "America/Fortaleza";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

type Cenario = {
  clinicId: string;
  contactId: string;
  appointmentId: string;
  stepId: string;
  professionalId: string;
  serviceLinkId: string;
  telefone: string;
};

/** Janela estreita que NÃO contém o instante de agora, no fuso da clínica. */
function janelaFechadaAgora(timezone: string) {
  const agora = minutosLocais(timezone, new Date());
  let inicio = agora + 120;
  let fim = inicio + 60;
  if (fim > 23 * 60 + 59) {
    fim = agora - 60;
    inicio = fim - 60;
  }
  return {
    send_window_start: minutosParaHora(inicio),
    send_window_end: minutosParaHora(fim),
    send_weekdays: [0, 1, 2, 3, 4, 5, 6],
  };
}

async function montarCenario(
  nome: string,
  telefone: string,
  opcoes: { consentimento?: "ativo" | "nenhum" } = {},
): Promise<Cenario> {
  const { consentimento = "ativo" } = opcoes;
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Cobrança ${nome} ${sufixo}`,
      slug: `cobranca-${nome}-${sufixo}`,
    })
    .select("id, timezone")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  clinicasCriadas.push(clinicId);

  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();

  // A régua fica DESLIGADA de propósito, com a janela fechada agora: é o
  // estado real de uma clínica que ainda não automatizou nada.
  await admin
    .from("cadence")
    .update(janelaFechadaAgora(clinica!.timezone as string))
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao")
    .throwOnError();

  const { data: profissional } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dr. Cobrança" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procedimento } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Retorno", default_duration_min: 30 })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: profissional!.id,
      procedure_id: procedimento!.id,
      insurance_id: null,
      price_cents: 10000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Cobrança",
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = contato!.id as string;
  if (consentimento === "ativo") {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
  }

  // Consulta amanhã: o passo escolhido pela ação seria o de 24 horas antes.
  const inicio = new Date(Date.now() + 20 * HORA);
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      professional_id: profissional!.id,
      service_link_id: vinculo!.id,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: passo } = await admin
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("offset_minutes", -1440)
    .single()
    .throwOnError();

  return {
    clinicId,
    contactId,
    appointmentId: consulta!.id as string,
    stepId: passo!.id as string,
    professionalId: profissional!.id as string,
    serviceLinkId: vinculo!.id as string,
    telefone,
  };
}

/**
 * O MESMO codigo que a Server Action roda depois dos guards. Chamar a action
 * daqui nao da (ela depende de sessao, cookies e revalidatePath), mas o miolo
 * dela vive fora e e este: enquanto o teste reimplementava as escritas em SQL,
 * ele passava mesmo quando a producao divergia, e passou.
 */
async function cobrarAgora(
  clinicId: string,
  appointmentIds: string[],
): Promise<CobrancaManual> {
  return planejarCobrancaManual(admin, admin, {
    clinicId,
    timezone: TIMEZONE,
    appointmentIds,
  });
}

/** Mais uma consulta do MESMO contato, para provar que nenhuma se perde. */
async function outraConsulta(
  cenario: Cenario,
  horasAFrente: number,
): Promise<string> {
  const inicio = new Date(Date.now() + horasAFrente * HORA);
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: cenario.contactId,
      professional_id: cenario.professionalId,
      service_link_id: cenario.serviceLinkId,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function processar(clinicId: string, worker: string): Promise<void> {
  // Um minuto atrás, não "agora": claim_jobs compara run_at com o now() do
  // banco, e o relógio desta máquina não precisa estar alinhado com ele.
  await admin
    .from("job_queue")
    .update({ run_at: new Date(Date.now() - MINUTO).toISOString() })
    .eq("clinic_id", clinicId)
    .eq("status", "pendente");
  await processarLote(admin, worker, { limite: 10 });
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("toque manual da Tela 2", () => {
  it("com a régua desligada e fora da janela, a cobrança sai mesmo assim", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("manual", "+5584963000001");

    const resultado = await cobrarAgora(cenario.clinicId, [
      cenario.appointmentId,
    ]);
    expect(resultado.enfileirados).toBe(1);
    await processar(cenario.clinicId, "worker-cobranca");

    const enviadas = fakeSentMessages().filter(
      (m) => m.to === cenario.telefone,
    );
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]?.body).toContain("Paciente Cobrança");
    expect(enviadas[0]?.body).not.toContain("{{");
    // Amarrado a FONTE UNICA, nao a um numero: era exatamente a divergencia
    // entre o menu enviado e o menu que interpretarResposta esperava que este
    // teste deixou passar (o paciente que respondia "2" para cancelar era lido
    // como "remarcar" e a consulta nunca era cancelada).
    expect((enviadas[0]?.menuOptions ?? []).map((o) => o.id)).toEqual(
      MENU_CONFIRMACAO.map((o) => o.id),
    );

    // A consulta entra em aguardando_confirmação, como no toque automático.
    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", cenario.appointmentId)
      .single();
    expect(consulta?.status).toBe("aguardando_confirmacao");
  });

  it("dois cliques no mesmo minuto viram UMA cobrança", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("duplo", "+5584963000002");

    expect(
      (await cobrarAgora(cenario.clinicId, [cenario.appointmentId]))
        .enfileirados,
    ).toBe(1);
    expect(
      (await cobrarAgora(cenario.clinicId, [cenario.appointmentId]))
        .enfileirados,
    ).toBe(0);

    const { data: runs } = await admin
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", cenario.clinicId);
    expect(runs).toHaveLength(1);
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("kind", "executar_passo_de_regua");
    expect(jobs).toHaveLength(1);

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("duas consultas do mesmo paciente: nenhuma se perde", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("duasconsultas", "+5584963000005");
    // As duas caem no MESMO passo (24 horas antes) do MESMO contato. A chave
    // única de cadence_run passou a incluir appointment_id justamente por isto:
    // antes a segunda colidia e sumia em silêncio, com a recepção vendo
    // "cobrado".
    const segunda = await outraConsulta(cenario, 22);

    const resultado = await cobrarAgora(cenario.clinicId, [
      cenario.appointmentId,
      segunda,
    ]);
    expect(resultado.enfileirados).toBe(2);
    expect(new Set(resultado.cobrados)).toEqual(
      new Set([cenario.appointmentId, segunda]),
    );

    const { data: runs } = await admin
      .from("cadence_run")
      .select("appointment_id")
      .eq("clinic_id", cenario.clinicId);
    expect(new Set((runs ?? []).map((r) => r.appointment_id))).toEqual(
      new Set([cenario.appointmentId, segunda]),
    );

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("as mesmas duas consultas em CLIQUES separados, no mesmo minuto", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("cliquesseparados", "+5584963000007");
    const segunda = await outraConsulta(cenario, 22);

    // Este é o caso que o desempate por posição na lista não cobria: em cada
    // clique a consulta é a primeira do laço, então as duas recebiam a mesma
    // chave e a segunda sumia. Com appointment_id na chave, cada uma tem a
    // sua.
    expect(
      (await cobrarAgora(cenario.clinicId, [cenario.appointmentId]))
        .enfileirados,
    ).toBe(1);
    expect((await cobrarAgora(cenario.clinicId, [segunda])).enfileirados).toBe(
      1,
    );

    const { data: runs } = await admin
      .from("cadence_run")
      .select("appointment_id, skipped_reason")
      .eq("clinic_id", cenario.clinicId);
    expect(runs).toHaveLength(2);
    // E nenhuma das duas foi cancelada pela outra.
    expect((runs ?? []).every((r) => r.skipped_reason === null)).toBe(true);

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("cobrar de novo incluindo a mesma consulta não mata a cobrança anterior", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("naomata", "+5584963000008");
    const segunda = await outraConsulta(cenario, 22);

    // Clique 1: só a primeira consulta.
    expect(
      (await cobrarAgora(cenario.clinicId, [cenario.appointmentId]))
        .enfileirados,
    ).toBe(1);
    const { data: primeira } = await admin
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("appointment_id", cenario.appointmentId)
      .single();

    // Clique 2, no mesmo minuto, com as duas selecionadas. A primeira colide
    // na chave (nada a fazer, já está a caminho) e a segunda é nova. O
    // cancelamento do toque substituído não pode alcançar a run do clique 1:
    // a recepção já viu aquela cobrança dar certo.
    const segundoClique = await cobrarAgora(cenario.clinicId, [
      cenario.appointmentId,
      segunda,
    ]);
    expect(segundoClique.enfileirados).toBe(1);
    expect(segundoClique.cobrados).toEqual([segunda]);

    const { data: depois } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("id", primeira!.id)
      .single();
    expect(depois?.skipped_reason).toBeNull();

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("cobrar na mão cancela o toque automático pendente do mesmo passo", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("substitui", "+5584963000006");

    // Toque automático já planejado para daqui a pouco, como o planner faria.
    const { data: automatica } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: cenario.clinicId,
        cadence_step_id: cenario.stepId,
        contact_id: cenario.contactId,
        appointment_id: cenario.appointmentId,
        scheduled_for: new Date(Date.now() + 30 * MINUTO).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();

    expect(
      (await cobrarAgora(cenario.clinicId, [cenario.appointmentId]))
        .enfileirados,
    ).toBe(1);

    // Sem isto o paciente receberia o MESMO texto duas vezes: agora pela
    // recepção e daqui a pouco pela régua.
    const { data: depois } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("id", automatica!.id)
      .single();
    expect(depois?.skipped_reason).toBe("condicao_parada");

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("cobrar duas consultas em passos DIFERENTES não mata o toque de terceiro", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("cruzado", "+5584963000009");
    // Três dias à frente: cai num passo diferente do da consulta de amanhã,
    // que é o que faz a seleção usar dois passos ao mesmo tempo.
    const distante = await outraConsulta(cenario, 3 * 24);

    const { data: passos } = await admin
      .from("cadence_step")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .lt("offset_minutes", 0)
      .throwOnError();

    // Um toque automático pendente da consulta DISTANTE em CADA passo. Só o do
    // passo que a cobrança manual usar para ela deve ser substituído; os
    // outros não têm nada a ver com este clique.
    const automaticas = (
      await admin
        .from("cadence_run")
        .insert(
          (passos ?? []).map((passo, i) => ({
            clinic_id: cenario.clinicId,
            cadence_step_id: passo.id,
            contact_id: cenario.contactId,
            appointment_id: distante,
            scheduled_for: new Date(
              Date.now() + (2 * 24 + i) * HORA,
            ).toISOString(),
          })),
        )
        .select("id, cadence_step_id")
        .throwOnError()
    ).data as { id: string; cadence_step_id: string }[];

    const resultado = await cobrarAgora(cenario.clinicId, [
      cenario.appointmentId,
      distante,
    ]);
    expect(resultado.enfileirados).toBe(2);

    // Qual passo a cobrança usou para a consulta distante.
    const { data: manual } = await admin
      .from("cadence_run")
      .select("cadence_step_id")
      .eq("clinic_id", cenario.clinicId)
      .eq("appointment_id", distante)
      .not("id", "in", `(${automaticas.map((a) => a.id).join(",")})`)
      .single()
      .throwOnError();

    const { data: depois } = await admin
      .from("cadence_run")
      .select("id, cadence_step_id, skipped_reason")
      .in(
        "id",
        automaticas.map((a) => a.id),
      )
      .throwOnError();

    for (const linha of depois ?? []) {
      const mesmoPasso = linha.cadence_step_id === manual!.cadence_step_id;
      // Com dois filtros `in` cruzados, o par (consulta distante, passo da
      // OUTRA consulta) também casava e este toque morria calado.
      expect(
        linha.skipped_reason,
        mesmoPasso
          ? "o toque do mesmo passo é substituído pela cobrança manual"
          : "toque de outro passo não pode ser cancelado por esta cobrança",
      ).toBe(mesmoPasso ? "condicao_parada" : null);
    }

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("sem autorização a cobrança nem chega a ser enfileirada", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("semauth", "+5584963000003", {
      consentimento: "nenhum",
    });

    // A recusa acontece no PLANEJAMENTO, não no worker: quem revogou não entra
    // na fila (regra 3.3). A recepção recebe a contagem para saber o porquê.
    const resultado = await cobrarAgora(cenario.clinicId, [
      cenario.appointmentId,
    ]);
    expect(resultado.ok).toBe(true);
    expect(resultado.enfileirados).toBe(0);
    expect(resultado.pulados_sem_autorizacao).toBe(1);

    const { data: runs } = await admin
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", cenario.clinicId);
    expect(runs).toHaveLength(0);

    await processar(cenario.clinicId, "worker-cobranca-semauth");
    expect(
      fakeSentMessages().filter((m) => m.to === cenario.telefone),
    ).toHaveLength(0);
  });

  it("consulta já cancelada não é cobrável", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("parada", "+5584963000004");
    await admin
      .from("appointment")
      .update({ status: "cancelado_paciente" })
      .eq("id", cenario.appointmentId)
      .throwOnError();

    const resultado = await cobrarAgora(cenario.clinicId, [
      cenario.appointmentId,
    ]);
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain("esperando confirmação");

    const { data: runs } = await admin
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", cenario.clinicId);
    expect(runs).toHaveLength(0);

    await processar(cenario.clinicId, "worker-cobranca-parada");
    expect(
      fakeSentMessages().filter((m) => m.to === cenario.telefone),
    ).toHaveLength(0);
  });
});
