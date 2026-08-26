import type { SupabaseClient } from "@supabase/supabase-js";

import { passoDoToqueManual } from "@/lib/domain/cadence";
import {
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";

// Miolo do "Cobrar agora" da Tela 2: escolhe o passo, respeita a autorizacao e
// enfileira o toque manual. Fica FORA da Server Action de proposito, porque a
// action so pode rodar dentro de uma requisicao do Next (sessao, cookies,
// revalidatePath) e o teste de integracao precisa exercitar esta logica de
// verdade. Enquanto isto morava dentro da action, o teste reimplementava as
// mesmas escritas em SQL e passava mesmo quando a producao divergia.
//
// Dois clientes, de proposito:
// - `leitura` e o cliente da SESSAO em producao (a RLS confere clinica e
//   papel), e o service role no teste, que nao tem sessao;
// - `admin` e o service role, unico que escreve em cadence_run e job_queue
//   (essas tabelas nao tem policy de escrita: quem grava e o worker).

type ConsultaCobravel = {
  id: string;
  contact_id: string;
  starts_at: string;
};

export type CobrancaManual = {
  ok: boolean;
  error?: string;
  enfileirados: number;
  pulados_sem_autorizacao: number;
  /** Consultas que viraram run de verdade. E o que vai para a trilha. */
  cobrados: string[];
};

export async function planejarCobrancaManual(
  leitura: SupabaseClient,
  admin: SupabaseClient,
  params: {
    clinicId: string;
    /** Fuso da clinica: decide se o texto do toque diz "hoje" ou "amanha". */
    timezone: string;
    appointmentIds: string[];
    agora?: Date;
  },
): Promise<CobrancaManual> {
  const { clinicId, timezone, appointmentIds } = params;
  const agora = params.agora ?? new Date();
  const vazio = { enfileirados: 0, pulados_sem_autorizacao: 0, cobrados: [] };

  const { data: consultas } = await leitura
    .from("appointment")
    .select("id, contact_id, starts_at")
    .eq("clinic_id", clinicId)
    .in("id", appointmentIds)
    .in("status", STATUS_PENDENTES)
    .eq("send_confirmation", true)
    .gt("starts_at", agora.toISOString());
  const cobraveis = (consultas ?? []) as ConsultaCobravel[];
  if (cobraveis.length === 0) {
    return {
      ok: false,
      error: "Nenhuma dessas consultas está esperando confirmação.",
      ...vazio,
    };
  }

  // A regua PADRAO da clinica: e dela que sai o texto do toque. Excecao por
  // procedimento e regua reforcada sao a Tela 7 (tarefa 4.8).
  const { data: regua } = await leitura
    .from("cadence")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao")
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  if (!regua) {
    return {
      ok: false,
      error: "A régua de confirmação não está configurada.",
      ...vazio,
    };
  }
  const { data: passos } = await leitura
    .from("cadence_step")
    .select("id, offset_minutes")
    .eq("clinic_id", clinicId)
    .eq("cadence_id", regua.id as string);
  const passosDaRegua = (
    (passos ?? []) as { id: string; offset_minutes: number }[]
  ).map((passo) => ({ id: passo.id, offsetMinutes: passo.offset_minutes }));
  if (passosDaRegua.length === 0) {
    return {
      ok: false,
      error: "A régua de confirmação não tem mensagens.",
      ...vazio,
    };
  }

  // Autorizacao vigente numa consulta so (mesma regra da RPC
  // consentimento_vigente). Quem revogou nao entra na fila: regra 3.3.
  const contactIds = [...new Set(cobraveis.map((c) => c.contact_id))];
  const { data: consentimentos } = await leitura
    .from("contact_consent")
    .select("contact_id, channel, granted_at, revoked_at")
    .eq("clinic_id", clinicId)
    .in("contact_id", contactIds);
  const porContato = new Map<string, LinhaConsent[]>();
  for (const linha of (consentimentos ?? []) as (LinhaConsent & {
    contact_id: string;
  })[]) {
    const lista = porContato.get(linha.contact_id) ?? [];
    lista.push(linha);
    porContato.set(linha.contact_id, lista);
  }

  // Truncado ao minuto de proposito: dois cliques seguidos na MESMA consulta
  // caem na mesma chave (cadence_step_id, contact_id, appointment_id,
  // scheduled_for) e o segundo nao cria run nenhuma. E a trava do banco
  // fazendo o trabalho, nao um controle de tela. Consultas DIFERENTES do mesmo
  // paciente tem chaves diferentes porque appointment_id entra na chave, entao
  // nenhuma precisa de desempate por posicao (e desempatar por posicao era
  // errado: a mesma consulta muda de posicao entre uma selecao e outra).
  const minutoAtual = new Date(
    Math.floor(agora.getTime() / 60_000) * 60_000,
  ).toISOString();

  const linhas: Record<string, unknown>[] = [];
  let puladosSemAutorizacao = 0;
  for (const consulta of cobraveis) {
    if (
      !consentimentoVigenteDeLinhas(porContato.get(consulta.contact_id) ?? [])
    ) {
      puladosSemAutorizacao += 1;
      continue;
    }
    const passo = passoDoToqueManual(passosDaRegua, {
      agora,
      startsAt: new Date(consulta.starts_at),
      timezone,
    });
    if (!passo) {
      continue;
    }
    linhas.push({
      clinic_id: clinicId,
      cadence_step_id: passo.id,
      contact_id: consulta.contact_id,
      appointment_id: consulta.id,
      scheduled_for: minutoAtual,
    });
  }

  if (linhas.length === 0) {
    return {
      ok: true,
      enfileirados: 0,
      pulados_sem_autorizacao: puladosSemAutorizacao,
      cobrados: [],
    };
  }

  const { data: criadas, error: erroRun } = await admin
    .from("cadence_run")
    .upsert(linhas, {
      onConflict: "cadence_step_id,contact_id,appointment_id,scheduled_for",
      ignoreDuplicates: true,
    })
    .select("id, appointment_id, cadence_step_id");
  if (erroRun) {
    return {
      ok: false,
      error: "Não foi possível enfileirar as cobranças.",
      ...vazio,
    };
  }
  const novas = (criadas ?? []) as {
    id: string;
    appointment_id: string | null;
    cadence_step_id: string;
  }[];
  if (novas.length === 0) {
    return {
      ok: true,
      enfileirados: 0,
      pulados_sem_autorizacao: puladosSemAutorizacao,
      cobrados: [],
    };
  }

  const { error: erroJob } = await admin.from("job_queue").insert(
    novas.map((run) => ({
      clinic_id: clinicId,
      kind: "executar_passo_de_regua",
      payload: { cadence_run_id: run.id, manual: true },
    })),
  );
  if (erroJob) {
    return {
      ok: false,
      error: "Não foi possível enfileirar as cobranças.",
      ...vazio,
    };
  }

  // Cobrar na mao SUBSTITUI o toque ainda pendente DAQUELA consulta NAQUELE
  // passo: sem isto o paciente receberia o mesmo texto duas vezes, agora pela
  // recepcao e daqui a pouco pela regua.
  //
  // Par a par, nunca dois `in` cruzados. Dois `in` independentes viram AND na
  // mesma linha, ou seja produto cartesiano: numa selecao que usou os passos de
  // 24h e de 72h, o par (consulta que ganhou 24h, passo de 72h) tambem casaria,
  // e um toque automatico de OUTRA consulta morreria calado. Cada linha de
  // `novas` carrega o seu proprio par, e e por ele que se cancela.
  //
  // O recorte sai de `novas`, NAO da selecao pedida: consulta que colidiu na
  // chave unica ja tem uma cobranca a caminho, criada por um clique anterior, e
  // cancela-la aqui apagaria em silencio um envio que a recepcao ja viu dar
  // certo.
  const idsNovos = new Set(novas.map((run) => run.id));
  const substituidos: string[] = [];
  for (const run of novas) {
    if (!run.appointment_id) {
      continue;
    }
    const { data: pendentes } = await admin
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", run.appointment_id)
      .eq("cadence_step_id", run.cadence_step_id)
      .is("sent_at", null)
      .is("skipped_reason", null);
    for (const linha of (pendentes ?? []) as { id: string }[]) {
      if (!idsNovos.has(linha.id)) {
        substituidos.push(linha.id);
      }
    }
  }
  if (substituidos.length > 0) {
    await admin
      .from("cadence_run")
      .update({ skipped_reason: "condicao_parada" })
      .in("id", substituidos);
  }

  // A trilha registra o que REALMENTE foi cobrado: consulta que colidiu na
  // chave unica nao vira linha de auditoria de uma cobranca que nao saiu.
  return {
    ok: true,
    enfileirados: novas.length,
    pulados_sem_autorizacao: puladosSemAutorizacao,
    cobrados: novas
      .map((run) => run.appointment_id)
      .filter((id): id is string => id !== null),
  };
}
