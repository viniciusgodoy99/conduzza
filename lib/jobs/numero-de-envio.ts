import type { SupabaseClient } from "@supabase/supabase-js";

// Por qual numero de WhatsApp um envio sai (varios numeros por clinica,
// docs/07, Fase 2). Tres portas, todas decididas pelo banco:
//
// - na EXECUCAO de um job de envio: numero_do_job(p_job_id, p_worker). So
//   responde a quem tem a posse do job, confere se o numero carimbado
//   continua ativo e recarimba pela regra de conta_de_envio quando ele foi
//   removido antes de o job gravar mensagem;
// - no ENFILEIRAMENTO em lote (lista de espera, Cobrar agora, aviso de
//   remarcacao): contas_de_envio(p_clinic_id, p_contact_ids), o numero de
//   cada contato com nome e status, para separar quem esta num numero
//   desconectado sem uma consulta por contato;
// - no MOTOR: a raia de um job e o numero dele, ou a clinica quando o job nao
//   tem numero (integracoes, oferta da lista de espera, clinica sem numero).
//
// Numero desconectado NUNCA troca sozinho: o envio espera a reconexao. So o
// numero REMOVIDO sai da escolha (decisoes do dono de 25/09/2026).
//
// Regra 3.1 do CLAUDE.md: nada aqui loga. Nome de numero e dado da clinica,
// nao do paciente, mas mesmo assim so vai para a tela.

/** O que numero_do_job respondeu, ja lido. */
export type NumeroDoJob =
  | { estado: "ok"; whatsappAccountId: string }
  /** O numero foi removido e o job ja gravou mensagem: nao troca. */
  | { estado: "numero_removido" }
  /** A clinica nao tem numero ativo (o "sem conta" de antes). */
  | { estado: "sem_numero" }
  /** Kind que nao usa numero. */
  | { estado: "nao_se_aplica" }
  /** O job nao e mais deste executor: nada pode sair daqui. */
  | { estado: "sem_posse" }
  /** Erro de banco ou resposta fora do contrato: retry, nunca palpite. */
  | { estado: "leitura_falhou" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Le o jsonb de numero_do_job. Qualquer coisa fora do contrato vira
 * 'leitura_falhou': enviar por um numero adivinhado e pior que esperar.
 */
export function lerNumeroDoJob(bruto: unknown): NumeroDoJob {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { estado: "leitura_falhou" };
  }
  const resposta = bruto as Record<string, unknown>;
  const conta = resposta.whatsapp_account_id;
  switch (resposta.estado) {
    case "ok":
      return typeof conta === "string" && UUID.test(conta)
        ? { estado: "ok", whatsappAccountId: conta }
        : { estado: "leitura_falhou" };
    case "numero_removido":
      return { estado: "numero_removido" };
    case "sem_numero":
      return { estado: "sem_numero" };
    case "nao_se_aplica":
      return { estado: "nao_se_aplica" };
    case "sem_posse":
      return { estado: "sem_posse" };
    default:
      return { estado: "leitura_falhou" };
  }
}

/**
 * O numero pelo qual ESTE job envia, resolvido e carimbado pelo banco na
 * hora da execucao. Exige a posse do job (o mesmo workerId do claim).
 */
export async function numeroDoJob(
  admin: SupabaseClient,
  jobId: string,
  workerId: string,
): Promise<NumeroDoJob> {
  const { data, error } = await admin.rpc("numero_do_job", {
    p_job_id: jobId,
    p_worker: workerId,
  });
  if (error) {
    return { estado: "leitura_falhou" };
  }
  return lerNumeroDoJob(data);
}

/** O numero de envio de um contato, como contas_de_envio devolve. */
export type ContaDoContato = {
  /** Nulo so quando a clinica nao tem numero ativo. */
  whatsappAccountId: string | null;
  nome: string | null;
  conectado: boolean;
};

/** Le as linhas de contas_de_envio, por contato. */
export function lerContasDeEnvio(linhas: unknown): Map<string, ContaDoContato> {
  const contas = new Map<string, ContaDoContato>();
  if (!Array.isArray(linhas)) {
    return contas;
  }
  for (const linha of linhas) {
    if (!linha || typeof linha !== "object") {
      continue;
    }
    const campos = linha as Record<string, unknown>;
    if (typeof campos.contact_id !== "string") {
      continue;
    }
    const conta =
      typeof campos.whatsapp_account_id === "string"
        ? campos.whatsapp_account_id
        : null;
    contas.set(campos.contact_id, {
      whatsappAccountId: conta,
      nome:
        conta !== null && typeof campos.nome === "string" ? campos.nome : null,
      conectado: conta !== null && campos.connection_status === "conectado",
    });
  }
  return contas;
}

/**
 * Por qual numero cada contato receberia uma mensagem automatica agora (a
 * mesma regra do gatilho da fila: fixo, ultimo usado pelo paciente,
 * principal). Com a sessao do usuario, a RPC so aceita a clinica dele. Null
 * quando a leitura falhou.
 */
export async function contasDeEnvio(
  cliente: SupabaseClient,
  clinicId: string,
  contactIds: string[],
): Promise<Map<string, ContaDoContato> | null> {
  const unicos = [...new Set(contactIds)];
  if (unicos.length === 0) {
    return new Map();
  }
  const { data, error } = await cliente.rpc("contas_de_envio", {
    p_clinic_id: clinicId,
    p_contact_ids: unicos,
  });
  if (error) {
    return null;
  }
  return lerContasDeEnvio(data);
}

/**
 * Os nomes, sem repeticao e sem vazio, na ordem em que apareceram. So quando
 * a clinica tem MAIS DE UM numero ativo: com um so, "o WhatsApp da clinica"
 * diz mais do que um nome que ninguem escolheu ("Número principal"), e a
 * tela continua dizendo exatamente o que dizia (a mesma regra de send.ts).
 */
export function nomesParaATela(
  nomes: (string | null)[],
  numerosAtivos: number,
): string[] {
  if (numerosAtivos <= 1) {
    return [];
  }
  return [
    ...new Set(
      nomes
        .map((nome) => (nome ?? "").trim())
        .filter((nome) => nome.length > 0),
    ),
  ];
}

/**
 * O comeco da frase que diz a recepcao QUAL numero esta fora do ar, para ela
 * saber o que reconectar. Null quando nao ha nome para dizer (um numero so,
 * ou nome ausente): quem chama usa a frase de sempre, da clinica.
 */
export function fraseDeNumerosDesconectados(nomes: string[]): string | null {
  const citados = [
    ...new Set(nomes.map((nome) => nome.trim()).filter((n) => n.length > 0)),
  ].map((nome) => `"${nome}"`);
  if (citados.length === 0) {
    return null;
  }
  if (citados.length === 1) {
    return `O número ${citados[0]} está desconectado`;
  }
  const ultimo = citados[citados.length - 1];
  return `Os números ${citados.slice(0, -1).join(", ")} e ${ultimo} estão desconectados`;
}

type JobComRaia = { clinic_id: string; whatsapp_account_id?: string | null };

/**
 * A raia do motor: o numero do job (o slot anti-ban e por numero) ou a
 * clinica, para o job sem numero.
 */
export function raiaDoJob(job: JobComRaia): string {
  return job.whatsapp_account_id ?? job.clinic_id;
}

/** Agrupa por raia, mantendo a ordem de chegada dentro de cada uma. */
export function agruparPorRaia<T extends JobComRaia>(
  jobs: T[],
): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const job of jobs) {
    const raia = raiaDoJob(job);
    const atual = grupos.get(raia);
    if (atual) {
      atual.push(job);
    } else {
      grupos.set(raia, [job]);
    }
  }
  return grupos;
}
