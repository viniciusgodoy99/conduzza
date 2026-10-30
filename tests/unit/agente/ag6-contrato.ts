import {
  TEXTO_DO_EVENTO_DA_IA,
  textoDaAtribuicaoDaIa,
  type MotivoDoEventoDaIa,
} from "@/lib/domain/agente/config";

import type {
  BancoEmMemoria,
  Linha,
  Resposta,
} from "../ia-whatsapp/banco-em-memoria";

// O CONTRATO da passagem e da atribuicao da AG6a (migration
// 20261029120000_urgencia_e_passagem_da_ia.sql; o contrato da frente de
// banco, ag6/contrato.md, REVISAO R1 de 28/10/2026, que substituiu a secao
// 2) em memoria, para os testes do executor:
//  - passar_conversa_da_ia_para_equipe(p_job_id, p_worker, p_motivo), a
//    assinatura de sempre (R1.1; chamar com p_atribuir da PGRST202): as
//    recusas na ORDEM (22023 motivo_invalido; sem_posse; job_antigo;
//    ja_fora_da_ia), a passagem ("Aguardando você", o evento do motivo) e,
//    na URGENCIA, a marca em conversa_urgente (upsert por conversa, reabre a
//    encerrada). NUNCA atribui. Devolve SEMPRE {passou, codigo, urgente};
//  - atribuir_conversa_passada_pela_ia(p_job_id, p_worker) (R1.2 com a
//    REVISAO R2 de 28/10/2026), que o motor chama DEPOIS da frase: as
//    recusas na ORDEM (sem_posse; job_antigo; sem_passagem, pela ULTIMA
//    decisao do job; motivo_nao_atribui, com os SEIS motivos da R2.1;
//    fora_da_fila; com_responsavel; urgente, pela marca aberta;
//    mensagem_nova, a mensagem do paciente que o job nao leu, R2.2;
//    regra_fila, pela ULTIMA versao publicada; sem_responsavel;
//    responsavel_inapto) e a atribuicao (D-15 e D-55): o update so de
//    "Aguardando você" sem responsavel (nunca rouba; sem achar,
//    fora_da_fila) e o evento "A conversa ficou com {nome}, responsável
//    pelo lead.". Devolve SEMPRE {atribuida, codigo}.
// A RPC de verdade e provada nas suites de integracao, de concorrencia e de
// RLS, pela frente de banco.

/** Os papeis que recebem a conversa (o recorte de Transferir e da agendada). */
export const PAPEIS_QUE_RECEBEM = [
  "admin",
  "gestor",
  "recepcao",
  "profissional",
] as const;

/**
 * Os motivos que nunca atribuem, no banco (o espelho de
 * c_motivos_que_nunca_atribuem, R2.1: a lista inteira, NESTA ORDEM).
 */
export const MOTIVOS_QUE_NUNCA_ATRIBUEM_NO_BANCO = [
  "urgencia",
  "fora_do_horario",
  "sintoma",
  "assunto_clinico",
  "midia_nao_suportada",
  "conformidade",
] as const;

/** O valor de escalation_rules.passagem_para que liga a atribuicao. */
export const REGRA_DO_RESPONSAVEL = "responsavel_do_lead";

/** Os desfechos da decisao que passam a conversa (R1.2, recusa 4). */
export const DESFECHOS_QUE_PASSAM = ["escalou", "bloqueou", "falhou"] as const;

/**
 * Os codigos da atribuicao (R1.2 com a R2.2: mensagem_nova entre urgente e
 * regra_fila), na ordem das recusas do banco.
 */
export const CODIGOS_DA_ATRIBUICAO_NO_BANCO = [
  "atribuida",
  "sem_posse",
  "job_antigo",
  "sem_passagem",
  "motivo_nao_atribui",
  "fora_da_fila",
  "com_responsavel",
  "urgente",
  "mensagem_nova",
  "regra_fila",
  "sem_responsavel",
  "responsavel_inapto",
  "erro",
] as const;

export type OpcoesDaPassagemDaAg6 = {
  /** A conversa da clinica que o job passa (o payload do job). */
  conversationId: string;
  clinicId: string;
  /** O job tem a posse (padrao: sim). */
  posse?: () => boolean;
  /** O job e de antes da janela atual (D-A; padrao: nao). */
  jobAntigo?: () => boolean;
  /**
   * job_queue.created_at do job (R2.2: a mensagem do paciente desde a
   * criacao do job e fora das lidas dele e "mensagem_nova"). Sem ele, a
   * linha do job no banco em memoria; sem as duas, toda mensagem do
   * paciente fora das lidas conta (o lado seguro).
   */
  jobCriadoEm?: string;
  /** Um erro forcado do banco (error.code), antes de tudo. */
  erro?: () => string | null;
  /** Um erro HTTP forcado na ATRIBUICAO (error.code, como PGRST202). */
  erroDaAtribuicao?: () => string | null;
  /**
   * Roda na atribuicao, depois das conferencias e antes do update
   * condicional (a corrida: alguem assume no mesmo instante; nunca rouba).
   */
  noMeio?: () => void;
  /** Cada passagem respondida (para conferir o que o banco fez). */
  respostas?: Record<string, unknown>[];
  /** Cada atribuicao respondida. */
  atribuicoes?: Record<string, unknown>[];
  /**
   * A ordem do que aconteceu, para provar a frase ANTES da atribuicao: a
   * passagem grava "passagem", a atribuicao "atribuicao:{codigo}" (quem
   * testa grava a frase no mesmo vetor).
   */
  ordem?: string[];
};

/** A ultima versao publicada da clinica (a maior version). */
export function ultimaPublicada(
  banco: BancoEmMemoria,
  clinicId: string,
): Linha | null {
  const publicadas = banco
    .linhas("ai_agent_config")
    .filter((l) => l.clinic_id === clinicId && l.status === "publicada")
    .sort((a, b) => Number(b.version) - Number(a.version));
  return publicadas[0] ?? null;
}

/** escalation_rules ->> 'passagem_para' da ultima publicada (o texto ou nulo). */
export function regraDaUltimaPublicada(
  banco: BancoEmMemoria,
  clinicId: string,
): string | null {
  const regras = ultimaPublicada(banco, clinicId)?.escalation_rules;
  if (typeof regras !== "object" || regras === null || Array.isArray(regras)) {
    return null;
  }
  const valor = (regras as Record<string, unknown>).passagem_para;
  // O ->> do banco: o texto do valor (so o texto exato liga).
  return typeof valor === "string"
    ? valor
    : valor === undefined
      ? null
      : JSON.stringify(valor);
}

/** O responsavel que recebe: membro ATIVO da clinica com papel que atende. */
export function responsavelElegivel(
  banco: BancoEmMemoria,
  clinicId: string,
  userId: string | null | undefined,
): boolean {
  if (typeof userId !== "string") {
    return false;
  }
  return banco
    .linhas("clinic_member")
    .some(
      (m) =>
        m.clinic_id === clinicId &&
        m.user_id === userId &&
        m.status === "ativo" &&
        (PAPEIS_QUE_RECEBEM as readonly unknown[]).includes(m.role),
    );
}

function resposta(passou: boolean, codigo: string, urgente = false): Resposta {
  return { data: { passou, codigo, urgente }, error: null };
}

function evento(
  banco: BancoEmMemoria,
  opcoes: OpcoesDaPassagemDaAg6,
  body: string,
): void {
  banco.linhas("message").push({
    id: `evento-${banco.linhas("message").length + 1}`,
    clinic_id: opcoes.clinicId,
    conversation_id: opcoes.conversationId,
    direction: "saida",
    author: "sistema",
    content_type: "evento",
    body,
    billable: false,
    cost_cents: 0,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: new Date().toISOString(),
  });
}

/** A conversa do job (a do payload, da clinica do job), ou undefined. */
function conversaDoJob(
  banco: BancoEmMemoria,
  opcoes: OpcoesDaPassagemDaAg6,
): Linha | undefined {
  return banco
    .linhas("conversation")
    .find(
      (c) => c.id === opcoes.conversationId && c.clinic_id === opcoes.clinicId,
    );
}

/** Os parametros da passagem de sempre (R1.1). */
const PARAMETROS_DA_PASSAGEM: ReadonlySet<string> = new Set([
  "p_job_id",
  "p_worker",
  "p_motivo",
]);

/** Registra a passagem da AG6a (R1.1, a assinatura de sempre) em memoria. */
export function rpcDaPassagemDaAg6(
  banco: BancoEmMemoria,
  opcoes: OpcoesDaPassagemDaAg6,
): void {
  banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
    // R1.1: nao existe p_atribuir (a funcao com ele nao existe: PGRST202).
    if (Object.keys(args).some((chave) => !PARAMETROS_DA_PASSAGEM.has(chave))) {
      return {
        data: null,
        error: { code: "PGRST202", message: "funcao nao encontrada" },
      };
    }
    const forcado = opcoes.erro?.() ?? null;
    if (forcado !== null) {
      return { data: null, error: { code: forcado } };
    }
    const motivo = String(args.p_motivo) as MotivoDoEventoDaIa;
    if (!(motivo in TEXTO_DO_EVENTO_DA_IA)) {
      return {
        data: null,
        error: { code: "22023", message: "motivo_invalido" },
      };
    }
    if (opcoes.posse !== undefined && !opcoes.posse()) {
      return resposta(false, "sem_posse");
    }
    if (opcoes.jobAntigo?.() === true) {
      return resposta(false, "job_antigo");
    }
    const conversa = conversaDoJob(banco, opcoes);
    if (conversa === undefined || conversa.status !== "ia_atendendo") {
      return resposta(false, "ja_fora_da_ia");
    }
    conversa.status = "aguardando_humano";
    conversa.awaiting_reply = true;
    evento(banco, opcoes, TEXTO_DO_EVENTO_DA_IA[motivo]);

    let urgente = false;
    if (motivo === "urgencia") {
      const marcas = banco.linhas("conversa_urgente");
      const marca = marcas.find(
        (m) => m.conversation_id === opcoes.conversationId,
      );
      const nova = {
        conversation_id: opcoes.conversationId,
        clinic_id: opcoes.clinicId,
        desde: new Date().toISOString(),
        job_id: args.p_job_id,
        encerrada_em: null,
        encerrada_por: null,
        encerrada_como: null,
      };
      if (marca === undefined) {
        marcas.push(nova);
      } else {
        Object.assign(marca, nova);
      }
      urgente = true;
    }
    const feita = { passou: true, codigo: "passou", urgente };
    opcoes.respostas?.push(feita);
    opcoes.ordem?.push("passagem");
    return { data: feita, error: null };
  });
}

/** A marca de urgencia ABERTA da conversa (encerrada_em nulo). */
function temMarcaAberta(
  banco: BancoEmMemoria,
  conversationId: string,
): boolean {
  return banco
    .linhas("conversa_urgente")
    .some(
      (m) =>
        m.conversation_id === conversationId &&
        (m.encerrada_em ?? null) === null,
    );
}

/**
 * A ULTIMA decisao do job (R1.2, recusa 4): a mais recente de
 * ai_decision_log com o job, a conversa e a clinica (a ordem de insercao, no
 * banco em memoria).
 */
export function ultimaDecisaoDoJob(
  banco: BancoEmMemoria,
  opcoes: OpcoesDaPassagemDaAg6,
  jobId: unknown,
): Linha | null {
  const doJob = banco
    .linhas("ai_decision_log")
    .filter(
      (d) =>
        d.job_id === jobId &&
        d.clinic_id === opcoes.clinicId &&
        d.conversation_id === opcoes.conversationId,
    );
  return doJob[doJob.length - 1] ?? null;
}

/**
 * R2.2: alguma mensagem do paciente (entrada, autor paciente, nao apagada)
 * desta conversa e desta clinica, desde a criacao do job, fora de
 * ai_turno.mensagens_lidas do turno DESTE job (sem a linha do turno, nada
 * lido). As de saida (a frase, os eventos, a resposta da equipe), as de
 * outra conversa e as de antes da criacao do job nao contam.
 */
export function mensagemQueOJobNaoLeu(
  banco: BancoEmMemoria,
  opcoes: OpcoesDaPassagemDaAg6,
  jobId: unknown,
): boolean {
  const turno = banco
    .linhas("ai_turno")
    .find(
      (t) =>
        t.job_id === jobId &&
        t.clinic_id === opcoes.clinicId &&
        t.conversation_id === opcoes.conversationId,
    );
  const lidas = new Set<unknown>(
    Array.isArray(turno?.mensagens_lidas) ? turno.mensagens_lidas : [],
  );
  const criado =
    opcoes.jobCriadoEm ??
    banco.linhas("job_queue").find((j) => j.id === jobId)?.created_at ??
    null;
  const desde = criado === null ? null : Date.parse(String(criado));
  return banco.linhas("message").some((m) => {
    if (
      m.conversation_id !== opcoes.conversationId ||
      m.clinic_id !== opcoes.clinicId ||
      m.direction !== "entrada" ||
      m.author !== "paciente" ||
      (m.deleted_at ?? null) !== null ||
      lidas.has(m.id)
    ) {
      return false;
    }
    // Sem o instante (ou sem o do job): conta (o lado seguro, a fila).
    const quando = Date.parse(String(m.created_at));
    return desde === null || Number.isNaN(quando) || quando >= desde;
  });
}

/** Registra a atribuicao da AG6a (R1.2 com a R2) em memoria. */
export function rpcDaAtribuicaoDaAg6(
  banco: BancoEmMemoria,
  opcoes: OpcoesDaPassagemDaAg6,
): void {
  banco.rpc("atribuir_conversa_passada_pela_ia", (args) => {
    const forcado = opcoes.erroDaAtribuicao?.() ?? null;
    if (forcado !== null) {
      return { data: null, error: { code: forcado } };
    }
    const devolver = (
      codigo: (typeof CODIGOS_DA_ATRIBUICAO_NO_BANCO)[number],
    ) => {
      const feita = { atribuida: codigo === "atribuida", codigo };
      opcoes.atribuicoes?.push(feita);
      opcoes.ordem?.push(`atribuicao:${codigo}`);
      return { data: feita, error: null };
    };
    // 1. A posse e a conversa do job.
    const conversa = conversaDoJob(banco, opcoes);
    if (
      (opcoes.posse !== undefined && !opcoes.posse()) ||
      conversa === undefined
    ) {
      return devolver("sem_posse");
    }
    // 3. D-A.
    if (opcoes.jobAntigo?.() === true) {
      return devolver("job_antigo");
    }
    // 4 e 5. A ultima decisao do job passou a conversa, e por motivo que
    // atribui.
    const decisao = ultimaDecisaoDoJob(banco, opcoes, args.p_job_id);
    if (
      decisao === null ||
      !(DESFECHOS_QUE_PASSAM as readonly unknown[]).includes(
        decisao.desfecho,
      ) ||
      typeof decisao.escalation_reason !== "string"
    ) {
      return devolver("sem_passagem");
    }
    if (
      (MOTIVOS_QUE_NUNCA_ATRIBUEM_NO_BANCO as readonly string[]).includes(
        decisao.escalation_reason,
      )
    ) {
      return devolver("motivo_nao_atribui");
    }
    // 6 a 8. A conversa na fila, sem responsavel e sem a marca aberta.
    if (conversa.status !== "aguardando_humano") {
      return devolver("fora_da_fila");
    }
    if ((conversa.assignee_user_id ?? null) !== null) {
      return devolver("com_responsavel");
    }
    if (temMarcaAberta(banco, opcoes.conversationId)) {
      return devolver("urgente");
    }
    // 8b (R2.2). A mensagem do paciente que o job nao leu: a fila.
    if (mensagemQueOJobNaoLeu(banco, opcoes, args.p_job_id)) {
      return devolver("mensagem_nova");
    }
    // 9. A regra da ULTIMA versao publicada.
    if (
      regraDaUltimaPublicada(banco, opcoes.clinicId) !== REGRA_DO_RESPONSAVEL
    ) {
      return devolver("regra_fila");
    }
    // 10 e 11. O responsavel do lead, apto.
    const contato = banco
      .linhas("contact")
      .find(
        (k) => k.id === conversa.contact_id && k.clinic_id === opcoes.clinicId,
      );
    const responsavel = contato?.owner_user_id as string | null | undefined;
    if (typeof responsavel !== "string") {
      return devolver("sem_responsavel");
    }
    if (!responsavelElegivel(banco, opcoes.clinicId, responsavel)) {
      return devolver("responsavel_inapto");
    }
    opcoes.noMeio?.();
    // O update condicional: nunca rouba (sem achar a linha, fora_da_fila).
    if (
      conversa.status !== "aguardando_humano" ||
      (conversa.assignee_user_id ?? null) !== null
    ) {
      return devolver("fora_da_fila");
    }
    conversa.status = "em_atendimento";
    conversa.assignee_user_id = responsavel;
    const perfil = banco
      .linhas("profile")
      .find((p) => p.user_id === responsavel);
    evento(
      banco,
      opcoes,
      textoDaAtribuicaoDaIa(
        typeof perfil?.name === "string" ? perfil.name : null,
      ),
    );
    return devolver("atribuida");
  });
}

/** Os eventos do fio da conversa (o texto de cada um, na ordem). */
export function eventosDoFio(banco: BancoEmMemoria): string[] {
  return banco
    .linhas("message")
    .filter((m) => m.content_type === "evento" && typeof m.body === "string")
    .map((m) => String(m.body));
}

// ---------------------------------------------------------------------------
// O cenario do executor (lib/jobs/responder-com-ia.ts) para os testes da AG6a
// ---------------------------------------------------------------------------
//
// O banco em memoria do E3 com a clinica, a conversa na IA, o contato (com o
// responsavel do lead), a janela, a liberacao, os precos e as RPCs que o
// executor chama; a passagem e a da AG6a (rpcDaPassagemDaAg6). O turno, o
// envio da resposta e o da frase sao falsos (vi.fn): quem testa a urgencia
// confere que o turno nunca e chamado. Quem usa declara o vi.mock de
// "@/lib/agente/contexto" (carregarConfigPublicada le `config` daqui).

export const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
export const OUTRA_CLINICA = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
export const CONVERSA = "c0000000-0000-4000-8000-000000000001";
export const CONTATO = "c1000000-0000-4000-8000-000000000001";
export const NUMERO = "a0000000-0000-4000-8000-000000000001";
export const JOB = "10000000-0000-4000-8000-000000000001";
export const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
export const RESERVA = "30000000-0000-4000-8000-000000000001";
export const TELEFONE = "+5584999990001";
/** A responsavel do lead (recepcao, ativa). */
export const ANA = "a1a1a1a1-0000-4000-8000-000000000001";
/** Outra pessoa da equipe (quem assume no meio). */
export const BIA = "b2b2b2b2-0000-4000-8000-000000000002";
/** Terca, 13/10/2026, 12:00 em Fortaleza (15:00 UTC). */
export const AGORA = Date.UTC(2026, 9, 13, 15, 0);
export const DESDE = "2026-10-13T14:58:00.000Z";
export const CRIADO = "2026-10-13T14:59:00.000Z";
export const NOME_DO_CONTATO = "Maria Souza";

/** As regras ligadas: a conversa para o responsavel do lead. */
export const PARA_O_RESPONSAVEL = {
  passagemPara: "responsavel_do_lead",
  avisoDeUrgencia: false,
} as const;

/**
 * O banco do cenario: a conversa na IA com UMA mensagem pendente do
 * paciente (`texto`), o contato com o responsavel Ana (membro ativo,
 * recepcao, com perfil) e a ultima versao publicada com a regra
 * (`passagemPara`). As RPCs de trava, consentimento, gasto e evento, a
 * passagem (R1.1) e a atribuicao (R1.2).
 */
export function bancoDaAg6(
  banco: BancoEmMemoria,
  e: {
    texto: string;
    passagemPara?: "fila" | "responsavel_do_lead";
    estado: {
      podeFalar: boolean[];
      consentimento: boolean;
      reservas: (string | null)[];
      eventos: string[];
      respostas: Record<string, unknown>[];
      /** As atribuicoes respondidas (R1.2). */
      atribuicoes?: Record<string, unknown>[];
      /** A ordem: "passagem", "frase" (quem testa) e "atribuicao:{codigo}". */
      ordem?: string[];
    };
  },
): void {
  banco.linhas("clinic").push({
    id: CLINICA,
    timezone: "America/Fortaleza",
    e_de_teste: false,
  });
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: CLINICA,
    status: "ia_atendendo",
    assignee_user_id: null,
    contact_id: CONTATO,
    whatsapp_account_id: NUMERO,
    awaiting_reply: true,
  });
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    phone_key: TELEFONE,
    name: NOME_DO_CONTATO,
    birth_date: null,
    kind: "lead",
    owner_user_id: ANA,
  });
  banco
    .linhas("clinic_member")
    .push(
      { clinic_id: CLINICA, user_id: ANA, status: "ativo", role: "recepcao" },
      { clinic_id: CLINICA, user_id: BIA, status: "ativo", role: "recepcao" },
    );
  banco.linhas("profile").push({ user_id: ANA, name: "Ana Lima" });
  banco.linhas("ai_agent_config").push({
    clinic_id: CLINICA,
    status: "publicada",
    version: 3,
    escalation_rules: { passagem_para: e.passagemPara ?? "fila" },
  });
  banco.linhas("ia_janela_da_conversa").push({
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    phone_key: TELEFONE,
    desde: DESDE,
    aberta_por: "ingestao",
  });
  banco.linhas("message").push({
    id: "m1",
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    author: "paciente",
    direction: "entrada",
    content_type: "texto",
    body: e.texto,
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: "2026-10-13T14:58:30.000Z",
  });
  banco.linhas("ia_liberacao").push({
    clinic_id: CLINICA,
    teto_respostas_por_conversa_hora: 20,
  });
  banco.linhas("llm_preco").push({
    modelo: "gpt-6-luna",
    entrada_microdolar_por_milhao: 1_000_000,
    saida_microdolar_por_milhao: 4_000_000,
    cache_leitura_microdolar_por_milhao: 100_000,
    cache_escrita_microdolar_por_milhao: 0,
  });
  banco.rpc("ia_pode_falar_com", () => ({
    data: e.estado.podeFalar.length > 0 ? e.estado.podeFalar.shift() : true,
    error: null,
  }));
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("consentimento_vigente", () => ({
    data: e.estado.consentimento,
    error: null,
  }));
  banco.rpc("reservar_gasto_da_ia", () => {
    const proxima =
      e.estado.reservas.length > 0 ? e.estado.reservas.shift() : RESERVA;
    return { data: proxima ?? null, error: null };
  });
  banco.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.rpc("gravar_evento_da_ia", (args) => {
    e.estado.eventos.push(String(args.p_motivo));
    return { data: true, error: null };
  });
  const opcoes: OpcoesDaPassagemDaAg6 = {
    conversationId: CONVERSA,
    clinicId: CLINICA,
    // O job do cenario (job() dos testes) nasceu em CRIADO, depois de m1.
    jobCriadoEm: CRIADO,
    respostas: e.estado.respostas,
    atribuicoes: e.estado.atribuicoes,
    ordem: e.estado.ordem,
  };
  rpcDaPassagemDaAg6(banco, opcoes);
  rpcDaAtribuicaoDaAg6(banco, opcoes);
}

/** A conversa do cenario. */
export function conversaDoCenario(banco: BancoEmMemoria): Linha {
  const conversa = banco.linhas("conversation")[0];
  if (conversa === undefined) {
    throw new Error("cenario sem conversa");
  }
  return conversa;
}
