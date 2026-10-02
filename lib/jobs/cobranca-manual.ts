import type { SupabaseClient } from "@supabase/supabase-js";

import { passoDoToqueManual } from "@/lib/domain/cadence";
import {
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";
import {
  contasDeEnvio,
  fraseDeNumerosDesconectados,
  nomesParaATela,
} from "@/lib/jobs/numero-de-envio";
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
  /**
   * Consultas cujo paciente receberia a mensagem por um numero DESCONECTADO
   * (varios numeros por clinica, docs/07). Nada e enfileirado para elas: o
   * envio nunca troca de numero sozinho, e prometer "na fila" seria mentir.
   */
  pulados_desconectado: number;
  /**
   * O nome dos numeros desconectados que seguraram alguma cobranca, para a
   * tela dizer QUAL reconectar. Vazio com um numero so: la "o WhatsApp da
   * clinica" diz mais do que um nome que ninguem escolheu.
   */
  numeros_desconectados: string[];
  /** Consultas que viraram run de verdade. E o que vai para a trilha. */
  cobrados: string[];
};

type PassoDaCobranca = { id: string; offsetMinutes: number };

/**
 * De qual regua sai o texto do toque manual de uma consulta: a vigente
 * (o que regua_da_consulta devolveu) ou, sem nenhuma regua ativa que case,
 * a geral. Null so quando nem a geral existe.
 */
export function reguaDoToqueManual(
  vigente: unknown,
  geralId: string | null,
): string | null {
  return typeof vigente === "string" && vigente !== "" ? vigente : geralId;
}

// O fim da frase de canal fora do ar; o comeco diz qual numero (ou "o
// WhatsApp", com um numero so).
const FIM_DO_ERRO_DESCONECTADO =
  ", então a mensagem não sairia. Reconecte em Configurações e cobre de novo.";

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
  const vazio = {
    enfileirados: 0,
    pulados_sem_autorizacao: 0,
    pulados_desconectado: 0,
    numeros_desconectados: [],
    cobrados: [],
  };

  // Canal fora do ar: recusar ANTES de enfileirar. Enfileirar aqui devolveria
  // "cobranca na fila de envio" para a recepcao e o toque morreria depois, sem
  // rastro nenhum na tela: ela cobraria de novo as cegas ou concluiria que o
  // paciente ignorou. Melhor dizer a verdade na hora do clique.
  //
  // Aqui a conferencia e da CLINICA (nenhum numero ativo, ou nenhum
  // conectado). O numero de CADA paciente e conferido abaixo.
  const { data: numeros, error: erroNumeros } = await leitura
    .from("whatsapp_account")
    .select("connection_status")
    .eq("clinic_id", clinicId)
    .is("removido_em", null);
  if (erroNumeros) {
    return {
      ok: false,
      error: "Não foi possível enfileirar as cobranças.",
      ...vazio,
    };
  }
  const numerosAtivos = (numeros ?? []) as { connection_status: string }[];
  if (numerosAtivos.length === 0) {
    return {
      ok: false,
      error: "Esta clínica ainda não tem WhatsApp conectado.",
      ...vazio,
    };
  }
  if (!numerosAtivos.some((n) => n.connection_status === "conectado")) {
    return {
      ok: false,
      error: `O WhatsApp está desconectado${FIM_DO_ERRO_DESCONECTADO}`,
      ...vazio,
    };
  }

  const { data: consultas } = await leitura
    .from("appointment")
    .select("id, contact_id, starts_at")
    .eq("clinic_id", clinicId)
    .in("id", appointmentIds)
    .in("status", STATUS_PENDENTES)
    .eq("send_confirmation", true)
    // Quem pediu para remarcar ja respondeu: cobrar de novo e a pergunta
    // errada (a Tela 2 desabilita; o servidor nao confia no botao).
    .is("remarcacao_pedida_em", null)
    .gt("starts_at", agora.toISOString());
  const cobraveis = (consultas ?? []) as ConsultaCobravel[];
  if (cobraveis.length === 0) {
    return {
      ok: false,
      error: "Nenhuma dessas consultas está esperando confirmação.",
      ...vazio,
    };
  }

  // A regua do toque, POR CONSULTA: a VIGENTE (regua_da_consulta, a mesma
  // escolha do planner e do executor: procedimento > medico > especialidade
  // > geral, e a reforcada no nivel), para a recepcao cobrar com o texto que
  // a regua automatica daquela consulta mandaria. Sem regua vigente (tudo
  // desligado), a GERAL, como sempre foi: a recepcao cobra mesmo com a regua
  // desligada (o toque manual nao olha o interruptor).
  const { data: geral } = await leitura
    .from("cadence")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao")
    // A GERAL: sem vinculo nenhum (procedimento, medico, especialidade) e
    // nao reforcada; com uma vinculada por medico, o filtro antigo casaria
    // duas linhas e o maybeSingle falharia.
    .is("procedure_id", null)
    .is("professional_id", null)
    .is("specialty", null)
    .eq("for_no_show_history", false)
    .maybeSingle();
  const geralId = (geral?.id as string | undefined) ?? null;

  // Uma leitura por consulta, em paralelo (a selecao da Tela 2 e de poucas
  // dezenas). Erro em qualquer uma recusa tudo: cobrar com o texto de outra
  // regua seria pior do que pedir para tentar de novo.
  const vigentes = await Promise.all(
    cobraveis.map((consulta) =>
      leitura.rpc("regua_da_consulta", {
        p_appointment_id: consulta.id,
        p_kind: "confirmacao",
      }),
    ),
  );
  if (vigentes.some((resposta) => resposta.error)) {
    return {
      ok: false,
      error: "Não foi possível enfileirar as cobranças.",
      ...vazio,
    };
  }
  const reguaPorConsulta = new Map<string, string>();
  cobraveis.forEach((consulta, indice) => {
    const regua = reguaDoToqueManual(vigentes[indice]?.data, geralId);
    if (regua) {
      reguaPorConsulta.set(consulta.id, regua);
    }
  });
  if (reguaPorConsulta.size === 0) {
    return {
      ok: false,
      error: "A régua de confirmação não está configurada.",
      ...vazio,
    };
  }

  const { data: passos } = await leitura
    .from("cadence_step")
    .select("id, offset_minutes, cadence_id")
    .eq("clinic_id", clinicId)
    .in("cadence_id", [...new Set(reguaPorConsulta.values())]);
  const passosPorRegua = new Map<string, PassoDaCobranca[]>();
  for (const passo of (passos ?? []) as {
    id: string;
    offset_minutes: number;
    cadence_id: string;
  }[]) {
    const lista = passosPorRegua.get(passo.cadence_id) ?? [];
    lista.push({ id: passo.id, offsetMinutes: passo.offset_minutes });
    passosPorRegua.set(passo.cadence_id, lista);
  }
  if (passosPorRegua.size === 0) {
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

  // O NUMERO de cada paciente, pela mesma regra do envio (fixo, ultimo usado
  // pelo paciente, principal), numa leitura so. O "Cobrar agora" e toque da
  // regua de confirmacao: vale a escolha do tipo 'confirmacao' (a mesma que o
  // banco deriva da run no gatilho da fila). Com a sessao, a RPC so aceita a
  // clinica de quem clicou.
  const contas = await contasDeEnvio(
    leitura,
    clinicId,
    contactIds,
    "confirmacao",
  );
  if (!contas) {
    return {
      ok: false,
      error: "Não foi possível enfileirar as cobranças.",
      ...vazio,
    };
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
  let puladosDesconectado = 0;
  const nomesDesconectados: (string | null)[] = [];
  const numeroPorContato = new Map<string, string>();
  for (const consulta of cobraveis) {
    if (
      !consentimentoVigenteDeLinhas(porContato.get(consulta.contact_id) ?? [])
    ) {
      puladosSemAutorizacao += 1;
      continue;
    }
    // Regua sem passo (a vinculada teve todos apagados): nada a cobrar para
    // esta consulta, como quando nenhum passo casa com o dia.
    const reguaDaConsulta = reguaPorConsulta.get(consulta.id);
    const passo = passoDoToqueManual(
      (reguaDaConsulta && passosPorRegua.get(reguaDaConsulta)) || [],
      {
        agora,
        startsAt: new Date(consulta.starts_at),
        timezone,
      },
    );
    if (!passo) {
      continue;
    }
    // Numero do paciente fora do ar: nada entra na fila (o envio nunca troca
    // de numero sozinho) e a tela fica sabendo quantos e por qual numero.
    const conta = contas.get(consulta.contact_id);
    if (!conta?.whatsappAccountId || !conta.conectado) {
      puladosDesconectado += 1;
      nomesDesconectados.push(conta?.nome ?? null);
      continue;
    }
    numeroPorContato.set(consulta.contact_id, conta.whatsappAccountId);
    linhas.push({
      clinic_id: clinicId,
      cadence_step_id: passo.id,
      contact_id: consulta.contact_id,
      appointment_id: consulta.id,
      scheduled_for: minutoAtual,
    });
  }
  const numerosDesconectados = nomesParaATela(
    nomesDesconectados,
    numerosAtivos.length,
  );
  const pulados = {
    pulados_sem_autorizacao: puladosSemAutorizacao,
    pulados_desconectado: puladosDesconectado,
    numeros_desconectados: numerosDesconectados,
  };

  if (linhas.length === 0) {
    if (puladosDesconectado > 0) {
      // Nada saiu, e ao menos uma cobranca parou num numero desconectado: a
      // verdade na hora do clique, como no canal inteiro fora do ar.
      return {
        ok: false,
        error: `${
          fraseDeNumerosDesconectados(numerosDesconectados) ??
          "O WhatsApp está desconectado"
        }${FIM_DO_ERRO_DESCONECTADO}`,
        enfileirados: 0,
        ...pulados,
        cobrados: [],
      };
    }
    return {
      ok: true,
      enfileirados: 0,
      ...pulados,
      cobrados: [],
    };
  }

  const { data: criadas, error: erroRun } = await admin
    .from("cadence_run")
    .upsert(linhas, {
      onConflict: "cadence_step_id,contact_id,appointment_id,scheduled_for",
      ignoreDuplicates: true,
    })
    .select("id, appointment_id, cadence_step_id, contact_id");
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
    contact_id: string;
  }[];
  if (novas.length === 0) {
    return {
      ok: true,
      enfileirados: 0,
      ...pulados,
      cobrados: [],
    };
  }

  // O job nasce com o numero conferido conectado acima (numero_do_job o
  // confirma na execucao). Sem ele, o gatilho da fila resolveria de novo
  // pela mesma regra, mas o numero que a recepcao viu e o que vale.
  const { error: erroJob } = await admin.from("job_queue").insert(
    novas.map((run) => ({
      clinic_id: clinicId,
      kind: "executar_passo_de_regua",
      payload: { cadence_run_id: run.id, manual: true },
      whatsapp_account_id: numeroPorContato.get(run.contact_id) ?? null,
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
    // Os mesmos filtros da selecao: run que o motor fechou nesse meio tempo
    // (enviada, ou falha_envio com motivo_da_falha, que o CHECK so aceita
    // com falha_envio) sai do conjunto. Sem eles, uma linha so derrubava o
    // update do lote inteiro e o toque automatico saia depois da cobranca.
    await admin
      .from("cadence_run")
      .update({ skipped_reason: "condicao_parada" })
      .in("id", substituidos)
      .is("sent_at", null)
      .is("skipped_reason", null);
  }

  // A trilha registra o que REALMENTE foi cobrado: consulta que colidiu na
  // chave unica nao vira linha de auditoria de uma cobranca que nao saiu.
  return {
    ok: true,
    enfileirados: novas.length,
    ...pulados,
    cobrados: novas
      .map((run) => run.appointment_id)
      .filter((id): id is string => id !== null),
  };
}
