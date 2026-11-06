import { vi } from "vitest";

import type { ClienteDoAgente, MensagemDaConversa } from "@/lib/agente/laco";
import type {
  LeituraGravada,
  MidiaDaConversa,
  MidiaPronta,
  PortaDaMidia,
  ResultadoDaLeitura,
  ResultadoDaTranscricao,
} from "@/lib/agente/midia";
import {
  CABECALHO_DA_NOTA_DA_PASSAGEM,
  NOTAS_DA_LEITURA,
} from "@/lib/agente/nota-da-passagem";
import type { UsoDoModelo } from "@/lib/agente/uso";
import { numeroDaCarteirinhaLido } from "@/lib/domain/carteirinha-lida";
import type { TipoDeUrgencia } from "@/lib/domain/conformidade/urgencia";
import {
  CONFIANCAS_DA_LEITURA,
  MIDIAS_LIDAS,
  TIPOS_DA_TRANSCRICAO,
  TIPOS_DO_LEITOR,
} from "@/lib/domain/agente/config";

import type { BancoEmMemoria, Linha, Resposta } from "../ia-whatsapp/banco-em-memoria";
import {
  bancoDaAg6,
  CLINICA,
  CONTATO,
  CONVERSA,
  JOB,
  TELEFONE,
} from "./ag6-contrato";

// O CONTRATO da AG6b (a midia na conversa com a IA; o contrato da frente de
// banco, ag6/contrato-ag6b.md, e a migration 20261030100000_midia_pela_ia.sql)
// em memoria, para os testes do motor:
//  - o ESPELHO: os codigos de gravar_leitura_da_midia (os erros e as
//    recusas, NA ORDEM), os da atribuicao com midia_nao_lida depois de
//    mensagem_nova, os oito motivos que nunca atribuem, os papeis de ia_uso,
//    as chaves das habilidades, os tipos e as regras de coerencia da leitura;
//  - gravar_leitura_da_midia e midia_da_ia_liberada em memoria (a ordem das
//    recusas do contrato, a idempotencia pela mensagem e a tabela
//    ia_leitura_da_midia);
//  - o cenario do executor com a midia do paciente, a porta falsa do laco e
//    o MP3 sintetico.
// A RPC de verdade e provada nas suites de integracao e de RLS, pela frente
// de banco.

// ---------------------------------------------------------------------------
// O espelho do contrato do banco
// ---------------------------------------------------------------------------

/** Os erros (22004 e 22023) de gravar_leitura_da_midia, na ordem. */
export const ERROS_DA_GRAVACAO = [
  "parametro_nulo",
  "midia_invalida",
  "tipo_invalido",
  "transcricao_invalida",
  "segundos_invalidos",
  "itens_invalidos",
  "fora_do_cadastro_invalido",
  "confianca_invalida",
  "resumo_invalido",
  "modelo_invalido",
  "versao_invalida",
  "convenio_invalido",
  "carteirinha_invalida",
] as const;

/** As recusas ({ok:false, motivo}) de gravar_leitura_da_midia, NA ORDEM. */
export const RECUSAS_DA_GRAVACAO = [
  "sem_posse",
  "job_antigo",
  "fora_da_ia",
  "mensagem_invalida",
  "mensagem_nao_lida",
  "leitura_desligada",
  "midia_bloqueada",
  "procedimento_invalido",
  "convenio_invalido",
] as const;

/** Os codigos da atribuicao (R1.2 com a R2 e a AG6b), na ordem do banco. */
export const CODIGOS_DA_ATRIBUICAO_NA_AG6B = [
  "atribuida",
  "sem_posse",
  "job_antigo",
  "sem_passagem",
  "motivo_nao_atribui",
  "fora_da_fila",
  "com_responsavel",
  "urgente",
  "mensagem_nova",
  "midia_nao_lida",
  "regra_fila",
  "sem_responsavel",
  "responsavel_inapto",
  "erro",
] as const;

/** c_motivos_que_nunca_atribuem da AG6b: os oito, nesta ordem. */
export const MOTIVOS_QUE_NUNCA_ATRIBUEM_NA_AG6B = [
  "urgencia",
  "fora_do_horario",
  "sintoma",
  "assunto_clinico",
  "midia_nao_suportada",
  "conformidade",
  "midia_clinica",
  "midia_nao_identificada",
] as const;

/** ia_uso_papel_valido da AG6b. */
export const PAPEIS_DO_USO_NA_AG6B = [
  "agente",
  "verificador",
  "classificador",
  "transcricao",
  "leitor_de_midia",
] as const;

/** As chaves das habilidades de midia (skills ->> ... = 'true'). */
export const CHAVES_DAS_HABILIDADES_DE_MIDIA = [
  "ler_audio",
  "ler_imagem_e_documento",
] as const;

/** Os motivos novos do CHECK de escalation_reason (e o rotulo). */
export const MOTIVOS_NOVOS_DA_AG6B = [
  "midia_clinica",
  "documento_do_paciente",
  "midia_nao_identificada",
] as const;

/** O preco por minuto do whisper-1 (contrato, secao 2): US$ 0,006. */
export const PRECO_DO_WHISPER_POR_MINUTO = 6_000;

const MODELO = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * As regras de coerencia da leitura (os CHECKs da tabela, contrato 4): o
 * codigo de erro 22023 da primeira que falha, ou null.
 */
export function erroDaLeitura(a: Record<string, unknown>): string | null {
  const midia = a.p_midia;
  const tipo = a.p_tipo;
  const procedimentos = (a.p_procedimentos ?? []) as unknown[];
  const fora = (a.p_fora_do_cadastro ?? 0) as number;
  if (
    [a.p_job_id, a.p_worker, a.p_message_id, midia, tipo, a.p_modelo, a.p_versao].some(
      (v) => v === null || v === undefined,
    )
  ) {
    return "parametro_nulo";
  }
  if (!(MIDIAS_LIDAS as readonly unknown[]).includes(midia)) {
    return "midia_invalida";
  }
  const doAudio = midia === "audio";
  if (
    !(doAudio ? (TIPOS_DA_TRANSCRICAO as readonly unknown[]) : (TIPOS_DO_LEITOR as readonly unknown[])).includes(tipo)
  ) {
    return "tipo_invalido";
  }
  const transcricao = a.p_transcricao;
  if (
    (tipo === "transcricao") !== (typeof transcricao === "string") ||
    (typeof transcricao === "string" &&
      (transcricao.trim() === "" || Array.from(transcricao).length > 4000))
  ) {
    return "transcricao_invalida";
  }
  const segundos = a.p_segundos;
  if (
    doAudio !== (typeof segundos === "number") ||
    (typeof segundos === "number" && (segundos < 1 || segundos > 150 || !Number.isInteger(segundos)))
  ) {
    return "segundos_invalidos";
  }
  const pedido = tipo === "pedido_de_exame_ou_procedimento";
  if (
    procedimentos.length > 10 ||
    procedimentos.some((p) => typeof p !== "string" || !UUID.test(p)) ||
    new Set(procedimentos).size !== procedimentos.length ||
    (!pedido && procedimentos.length > 0) ||
    (pedido && procedimentos.length === 0 && fora < 1)
  ) {
    return "itens_invalidos";
  }
  if (!Number.isInteger(fora) || fora < 0 || fora > 20 || (!pedido && fora > 0)) {
    return "fora_do_cadastro_invalido";
  }
  const confianca = a.p_confianca;
  if (
    doAudio
      ? confianca !== null && confianca !== undefined
      : !(CONFIANCAS_DA_LEITURA as readonly unknown[]).includes(confianca)
  ) {
    return "confianca_invalida";
  }
  const resumo = a.p_resumo;
  const semResumo = doAudio || tipo === "figurinha";
  if (
    semResumo
      ? resumo !== null && resumo !== undefined
      : typeof resumo !== "string" ||
        resumo.trim() === "" ||
        Array.from(resumo).length > 300
  ) {
    return "resumo_invalido";
  }
  const modelo = String(a.p_modelo);
  if (
    !MODELO.test(modelo) ||
    (modelo === "local" && !(midia !== "audio" && tipo === "figurinha"))
  ) {
    return "modelo_invalido";
  }
  // Matriz do dono de 06/11/2026 (migration 20261106130000).
  const convenioLido = a.p_convenio_lido ?? null;
  const numeroLido = a.p_numero_da_carteirinha ?? null;
  const versao = String(a.p_versao);
  const padrao = doAudio
    ? /^transcricao-[0-9a-f]{12}$/
    : modelo === "local"
      ? /^figurinha-[0-9a-f]{12}$/
      : /^leitor-[0-9a-f]{12}$/;
  if (!padrao.test(versao)) {
    return "versao_invalida";
  }
  if (convenioLido !== null && tipo !== "carteirinha") {
    return "convenio_invalido";
  }
  if (
    numeroLido !== null &&
    !(
      tipo === "carteirinha" &&
      confianca === "alta" &&
      numeroDaCarteirinhaLido(numeroLido) === numeroLido
    )
  ) {
    return "carteirinha_invalida";
  }
  return null;
}

// ---------------------------------------------------------------------------
// As RPCs da AG6b em memoria
// ---------------------------------------------------------------------------

export type OpcoesDaAg6b = {
  clinicId?: string;
  conversationId?: string;
  /** midia_da_ia_liberada (o telefone com o aviso versao 2). */
  liberado: () => boolean;
  /** A posse do job (padrao: sim). */
  posse?: () => boolean;
  /** D-A (padrao: nao). */
  jobAntigo?: () => boolean;
  /** Um erro HTTP forcado na gravacao (PGRST202, 22023...). */
  erroDaGravacao?: () => string | null;
  /** Um erro HTTP forcado em midia_da_ia_liberada. */
  erroDoPortao?: () => string | null;
  /** Roda antes da gravacao (alguem assume, a mensagem e apagada). */
  antesDeGravar?: () => void;
};

/** A ultima versao publicada da clinica. */
function ultimaPublicada(banco: BancoEmMemoria, clinicId: string): Linha | null {
  return (
    banco
      .linhas("ai_agent_config")
      .filter((l) => l.clinic_id === clinicId && l.status === "publicada")
      .sort((a, b) => Number(b.version) - Number(a.version))[0] ?? null
  );
}

/** Registra midia_da_ia_liberada e gravar_leitura_da_midia em memoria. */
export function rpcsDaAg6b(banco: BancoEmMemoria, opcoes: OpcoesDaAg6b): void {
  const clinicId = opcoes.clinicId ?? CLINICA;
  const conversationId = opcoes.conversationId ?? CONVERSA;
  banco.rpc("midia_da_ia_liberada", (args): Resposta => {
    const erro = opcoes.erroDoPortao?.() ?? null;
    if (erro !== null) {
      return { data: null, error: { code: erro } };
    }
    return {
      data: args.p_clinic_id === clinicId && opcoes.liberado(),
      error: null,
    };
  });
  banco.rpc("gravar_leitura_da_midia", (args): Resposta => {
    const forcado = opcoes.erroDaGravacao?.() ?? null;
    if (forcado !== null) {
      return { data: null, error: { code: forcado } };
    }
    opcoes.antesDeGravar?.();
    const erro = erroDaLeitura(args);
    if (erro !== null) {
      return {
        data: null,
        error: { code: erro === "parametro_nulo" ? "22004" : "22023", message: erro },
      };
    }
    const recusa = (motivo: (typeof RECUSAS_DA_GRAVACAO)[number]): Resposta => ({
      data: { ok: false, motivo },
      error: null,
    });
    if (opcoes.posse !== undefined && !opcoes.posse()) {
      return recusa("sem_posse");
    }
    if (opcoes.jobAntigo?.() === true) {
      return recusa("job_antigo");
    }
    const conversa = banco
      .linhas("conversation")
      .find((c) => c.id === conversationId && c.clinic_id === clinicId);
    if (
      conversa === undefined ||
      conversa.status !== "ia_atendendo" ||
      (conversa.assignee_user_id ?? null) !== null
    ) {
      return recusa("fora_da_ia");
    }
    const mensagem = banco
      .linhas("message")
      .find((m) => m.id === args.p_message_id);
    if (
      mensagem === undefined ||
      mensagem.conversation_id !== conversationId ||
      mensagem.clinic_id !== clinicId ||
      mensagem.direction !== "entrada" ||
      mensagem.author !== "paciente" ||
      (mensagem.deleted_at ?? null) !== null ||
      !String(mensagem.media_url ?? "").startsWith("storage://") ||
      mensagem.content_type !== args.p_midia
    ) {
      return recusa("mensagem_invalida");
    }
    const turno = banco.linhas("ai_turno").find((t) => t.job_id === args.p_job_id);
    if (
      !Array.isArray(turno?.mensagens_lidas) ||
      !(turno.mensagens_lidas as unknown[]).includes(args.p_message_id)
    ) {
      return recusa("mensagem_nao_lida");
    }
    const skills = (ultimaPublicada(banco, clinicId)?.skills ?? {}) as Record<
      string,
      unknown
    >;
    const chave = args.p_midia === "audio" ? "ler_audio" : "ler_imagem_e_documento";
    if (skills[chave] !== true) {
      return recusa("leitura_desligada");
    }
    if (!opcoes.liberado()) {
      return recusa("midia_bloqueada");
    }
    const ativos = new Set(
      banco
        .linhas("procedure")
        .filter((p) => p.clinic_id === clinicId && p.active === true)
        .map((p) => p.id),
    );
    if (((args.p_procedimentos ?? []) as unknown[]).some((p) => !ativos.has(p))) {
      return recusa("procedimento_invalido");
    }
    const convenioLido = args.p_convenio_lido ?? null;
    if (
      convenioLido !== null &&
      !banco
        .linhas("insurance")
        .some((i) => i.id === convenioLido && i.clinic_id === clinicId && i.active === true)
    ) {
      return recusa("convenio_invalido");
    }
    const leituras = banco.linhas("ia_leitura_da_midia");
    const existente = leituras.find((l) => l.message_id === args.p_message_id);
    if (existente !== undefined) {
      return {
        data: {
          ok: true,
          reutilizado: true,
          id: existente.id,
          leitura: {
            midia: existente.midia,
            tipo: existente.tipo,
            transcricao: existente.transcricao,
            segundos_de_audio: existente.segundos_de_audio,
            procedimentos: existente.procedimentos,
            fora_do_cadastro: existente.fora_do_cadastro,
            confianca: existente.confianca,
            resumo: existente.resumo,
            convenio_lido_id: existente.convenio_lido_id ?? null,
          },
          ...carteirinhaDoContato(existente.tipo),
        },
        error: null,
      };
    }
    const id = `leitura-${leituras.length + 1}`;
    leituras.push({
      id,
      clinic_id: clinicId,
      conversation_id: conversationId,
      message_id: args.p_message_id,
      job_id: args.p_job_id,
      midia: args.p_midia,
      tipo: args.p_tipo,
      transcricao: args.p_transcricao ?? null,
      segundos_de_audio: args.p_segundos ?? null,
      procedimentos: args.p_procedimentos ?? [],
      fora_do_cadastro: args.p_fora_do_cadastro ?? 0,
      confianca: args.p_confianca ?? null,
      resumo: args.p_resumo ?? null,
      modelo: args.p_modelo,
      versao: args.p_versao,
      convenio_lido_id: args.p_convenio_lido ?? null,
      created_at: new Date().toISOString(),
    });
    gravarACarteirinhaEAsNotas(args);
    return {
      data: {
        ok: true,
        reutilizado: false,
        id,
        ...carteirinhaDoContato(args.p_tipo),
      },
      error: null,
    };
  });
  /** A resposta da RPC na carteirinha: SE o cadastro tem, nunca o valor. */
  const contatoDaConversa = () => {
    const conversa = banco.linhas("conversation").find((c) => c.id === conversationId);
    return banco.linhas("contact").find((k) => k.id === conversa?.contact_id);
  };
  function carteirinhaDoContato(tipo: unknown): Record<string, unknown> {
    if (tipo !== "carteirinha") {
      return {};
    }
    const contato = contatoDaConversa();
    return {
      carteirinha_no_cadastro: String(contato?.insurance_card ?? "").trim() !== "",
      convenio_do_cadastro: contato?.insurance_id ?? null,
    };
  }
  /** O espelho do que a RPC faz na primeira leitura (migration 20261106130000). */
  function gravarACarteirinhaEAsNotas(args: Linha): void {
    const anotar = (texto: string) =>
      banco.linhas("message").push({
        id: `nota-${banco.linhas("message").length + 1}`,
        clinic_id: clinicId,
        conversation_id: conversationId,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: `${CABECALHO_DA_NOTA_DA_PASSAGEM}\n${texto}`,
        is_internal_note: true,
        billable: false,
        cost_cents: 0,
        created_at: new Date().toISOString(),
      });
    const itens = (args.p_procedimentos ?? []) as unknown[];
    const fora = Number(args.p_fora_do_cadastro ?? 0);
    if (
      args.p_tipo === "pedido_de_exame_ou_procedimento" &&
      itens.length > 0 &&
      fora > 0 &&
      (args.p_confianca === "alta" || args.p_confianca === "media")
    ) {
      anotar(NOTAS_DA_LEITURA.pedidoParcial.replace("{}", String(fora)));
    }
    const numero = (args.p_numero_da_carteirinha ?? null) as string | null;
    const plano = (args.p_convenio_lido ?? null) as string | null;
    const contato = contatoDaConversa();
    if (
      args.p_tipo !== "carteirinha" ||
      args.p_confianca !== "alta" ||
      contato === undefined ||
      (numero === null && plano === null)
    ) {
      return;
    }
    const cartao = String(contato.insurance_card ?? "")
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "");
    const planoDiferente =
      plano !== null && (contato.insurance_id ?? null) !== null && contato.insurance_id !== plano;
    const numeroDiferente = numero !== null && cartao !== "" && cartao !== numero;
    const campos: string[] = [];
    if (numero !== null && cartao === "" && !planoDiferente) {
      contato.insurance_card = numero;
      campos.push("insurance_card");
    }
    if (plano !== null && (contato.insurance_id ?? null) === null) {
      contato.insurance_id = plano;
      campos.push("insurance_id");
    }
    if (campos.length > 0) {
      banco.linhas("audit_log").push({
        clinic_id: clinicId,
        action: "gravou_carteirinha_lida",
        entity: "contact",
        entity_id: contato.id,
        detalhes: { campos, message_id: args.p_message_id },
      });
    }
    if (numeroDiferente || planoDiferente) {
      anotar(
        NOTAS_DA_LEITURA.carteirinhaDiferente.replace(
          "{}",
          numeroDiferente && planoDiferente
            ? "número e convênio"
            : numeroDiferente
              ? "número"
              : "convênio",
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// O MP3 sintetico (quadros MPEG-1 Layer III com a carga zerada)
// ---------------------------------------------------------------------------

const TAMANHO_DO_QUADRO = Math.floor((144 * 128_000) / 44_100);
const SEGUNDOS_DO_QUADRO = 1152 / 44_100;

/** Um MP3 sintetico de `segundos` (a duracao que o preparo mede). */
export function mp3Sintetico(segundos: number): Uint8Array {
  const quadros = Math.ceil(segundos / SEGUNDOS_DO_QUADRO);
  const saida = new Uint8Array(quadros * TAMANHO_DO_QUADRO);
  for (let i = 0; i < quadros; i += 1) {
    saida.set([0xff, 0xfb, 0x90, 0x44], i * TAMANHO_DO_QUADRO);
  }
  return saida;
}

/** Um JPEG sintetico (so a estrutura; nenhum pixel de verdade). */
export function jpegSintetico(): Uint8Array {
  const segmento = (marcador: number, corpo: number[]) => [
    0xff,
    marcador,
    ((corpo.length + 2) >> 8) & 0xff,
    (corpo.length + 2) & 0xff,
    ...corpo,
  ];
  return Uint8Array.from([
    0xff, 0xd8,
    ...segmento(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segmento(0xdb, new Array(65).fill(0)),
    ...segmento(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    ...segmento(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0x34, 0xff, 0xd9,
  ]);
}

// ---------------------------------------------------------------------------
// As mensagens com midia (o laco e o banco)
// ---------------------------------------------------------------------------

export const AUDIO = "a0d10000-0000-4000-8000-000000000001";
export const AUDIO_2 = "a0d10000-0000-4000-8000-000000000002";
export const FOTO = "f0700000-0000-4000-8000-000000000001";
export const FOTO_2 = "f0700000-0000-4000-8000-000000000002";

/** A midia do paciente como o historico monta (o laco). */
export function midiaDoPaciente(
  e: Partial<MidiaDaConversa> & Pick<MidiaDaConversa, "messageId" | "midia">,
): MidiaDaConversa {
  return {
    arquivo: "pronto",
    mediaUrl: `storage://midia-conversas/${CLINICA}/${e.messageId}`,
    mimetype: e.midia === "audio" ? "audio/mpeg" : "image/jpeg",
    criadaEm: "2026-10-13T14:58:30.000Z",
    legenda: null,
    ...e,
  };
}

/** O audio pendente do paciente na situacao do plano (o laco). */
export function audioNoLaco(
  messageId = AUDIO,
  situacao: MidiaDaConversa["situacao"] = "a_transcrever",
  extra: Partial<MidiaDaConversa> = {},
): MensagemDaConversa {
  return {
    autor: "paciente",
    texto: null,
    tipo: "audio",
    midia: midiaDoPaciente({ messageId, midia: "audio", situacao, ...extra }),
  };
}

/** A foto pendente do paciente (a legenda original e a mascarada). */
export function fotoNoLaco(
  messageId = FOTO,
  legenda: string | null = null,
  situacao: MidiaDaConversa["situacao"] = "a_ler",
  extra: Partial<MidiaDaConversa> = {},
): MensagemDaConversa {
  return {
    autor: "paciente",
    texto: null,
    tipo: "imagem",
    ...(legenda === null ? {} : { legendaOriginal: legenda }),
    midia: midiaDoPaciente({
      messageId,
      midia: "imagem",
      situacao,
      legenda,
      ...extra,
    }),
  };
}

/** Uma linha de message com midia do paciente (o banco do executor). */
export function linhaDeMidia(e: {
  id: string;
  contentType: "audio" | "imagem" | "documento";
  mediaUrl?: string | null;
  mimetype?: string | null;
  body?: string | null;
  criadaEm?: string;
}): Linha {
  return {
    id: e.id,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    author: "paciente",
    direction: "entrada",
    content_type: e.contentType,
    body: e.body ?? null,
    media_url:
      e.mediaUrl === undefined
        ? `storage://midia-conversas/${CLINICA}/${e.id}`
        : e.mediaUrl,
    media_mimetype:
      e.mimetype === undefined
        ? e.contentType === "audio"
          ? "audio/mpeg"
          : "image/jpeg"
        : e.mimetype,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: e.criadaEm ?? "2026-10-13T14:58:30.000Z",
  };
}

// ---------------------------------------------------------------------------
// A porta falsa (o laco)
// ---------------------------------------------------------------------------

/** A leitura gravada de uma transcricao. */
export function leituraDaTranscricao(texto: string | null, segundos = 15): LeituraGravada {
  return {
    midia: "audio",
    tipo: texto === null ? "sem_fala" : "transcricao",
    transcricao: texto,
    segundos,
    procedimentos: [],
    foraDoCadastro: 0,
    confianca: null,
    resumo: null,
  };
}

/** O uso da transcricao (o papel novo, tokens 0, os segundos). */
export function usoDaTranscricao(segundos = 15): UsoDoModelo {
  return {
    papel: "transcricao",
    modelo: "whisper-1",
    uso: { tokensEntrada: 0, tokensSaida: 0, tokensCacheLidos: 0, tokensCacheGravados: 0 },
    segundosDeAudio: segundos,
  };
}

export type RoteiroDaPorta = {
  /** O preparo por message_id (padrao: o audio de 15 s, a foto JPEG). */
  preparo?: Record<string, MidiaPronta["tipo"] | MidiaPronta>;
  /** A transcricao por message_id (padrao: "Quanto custa a limpeza de pele?"). */
  transcricao?: Record<string, ResultadoDaTranscricao>;
  /** A leitura por message_id. */
  leitura?: Record<string, ResultadoDaLeitura>;
  /** O nome do contato que a porta mascara. */
  mascarar?: (texto: string) => string;
};

/**
 * A porta da midia FALSA do laco: o preparo, a transcricao e a leitura por
 * roteiro (nada de Storage, de modelo nem de banco), com os vi.fn para
 * conferir o que foi chamado.
 */
export function portaFalsa(roteiro: RoteiroDaPorta = {}) {
  const mascarar = roteiro.mascarar ?? ((t: string) => t);
  const preparar = vi.fn<PortaDaMidia["preparar"]>(async (midias) =>
    midias.map((m): MidiaPronta => {
      const pedido = roteiro.preparo?.[m.messageId];
      if (typeof pedido === "object") {
        return pedido;
      }
      const tipo = pedido ?? (m.midia === "audio" ? "audio" : "arquivo");
      switch (tipo) {
        case "audio":
          return { tipo: "audio", messageId: m.messageId, bytes: mp3Sintetico(15), segundos: 15 };
        case "arquivo":
          return {
            tipo: "arquivo",
            messageId: m.messageId,
            midia: m.midia,
            arquivo: { tipo: "imagem", formato: "jpeg", bytes: jpegSintetico() },
            paginas: 1,
          };
        case "figurinha":
          return { tipo: "figurinha", messageId: m.messageId, midia: m.midia };
        case "fora":
          return { tipo: "fora", messageId: m.messageId, motivo: "longo_demais" };
        case "falhou":
          return { tipo: "falhou", messageId: m.messageId, codigo: "rede" };
      }
    }),
  );
  const transcrever = vi.fn<PortaDaMidia["transcrever"]>(async (audio) => {
    const feito = roteiro.transcricao?.[audio.messageId];
    if (feito !== undefined) {
      return feito;
    }
    const texto = "Quanto custa a limpeza de pele?";
    return {
      tipo: "transcrita",
      texto,
      textoParaOsModelos: mascarar(texto),
      leitura: leituraDaTranscricao(texto),
      uso: usoDaTranscricao(),
      urgencia: null,
    };
  });
  const ler = vi.fn<PortaDaMidia["ler"]>(async (arquivo) => {
    const feito = roteiro.leitura?.[arquivo.messageId];
    if (feito !== undefined) {
      return feito;
    }
    if (arquivo.tipo === "figurinha") {
      return {
        tipo: "lido",
        leitura: {
          midia: arquivo.midia,
          tipo: "figurinha",
          transcricao: null,
          segundos: null,
          procedimentos: [],
          foraDoCadastro: 0,
          confianca: "alta",
          resumo: null,
        },
        uso: null,
      };
    }
    throw new Error("leitura sem roteiro");
  });
  const porta: PortaDaMidia = { preparar, transcrever, ler };
  return { porta, preparar, transcrever, ler };
}

/** A transcricao transcrita com o texto (para o roteiro da porta). */
export function transcrita(
  texto: string,
  mascarar: (t: string) => string = (t) => t,
  urgencia: TipoDeUrgencia | null = null,
): ResultadoDaTranscricao {
  return {
    tipo: "transcrita",
    texto,
    textoParaOsModelos: mascarar(texto),
    leitura: leituraDaTranscricao(texto),
    uso: usoDaTranscricao(),
    urgencia,
  };
}

/**
 * Revisao R2 de d1a15f6 (M3): o "sem fala" da porta, com o tipo da urgencia
 * que a transcricao leu no texto descartado (null: nenhuma).
 */
export function semFala(
  urgencia: TipoDeUrgencia | null = null,
  segundos = 15,
): ResultadoDaTranscricao {
  return {
    tipo: "sem_fala",
    leitura: leituraDaTranscricao(null, segundos),
    uso: usoDaTranscricao(segundos),
    urgencia,
  };
}

/** A leitura lida (para o roteiro da porta). */
export function lida(
  e: Partial<LeituraGravada> & Pick<LeituraGravada, "tipo">,
  uso: UsoDoModelo | null = {
    papel: "leitor_de_midia",
    modelo: "gpt-6-luna",
    uso: { tokensEntrada: 1_900, tokensSaida: 20, tokensCacheLidos: 0, tokensCacheGravados: 0 },
  },
): ResultadoDaLeitura {
  return {
    tipo: "lido",
    leitura: {
      midia: "imagem",
      transcricao: null,
      segundos: null,
      procedimentos: [],
      foraDoCadastro: 0,
      confianca: "alta",
      resumo: null,
      ...e,
    },
    uso,
  };
}

// ---------------------------------------------------------------------------
// O cenario do executor com a midia
// ---------------------------------------------------------------------------

/**
 * O banco do cenario da AG6a (bancoDaAg6) com as MENSAGENS dadas no lugar da
 * m1, as habilidades na ultima versao publicada, o preco por minuto do
 * whisper-1, os procedimentos ativos e as RPCs da AG6b.
 */
export function bancoDaAg6b(
  banco: BancoEmMemoria,
  e: {
    mensagens: Linha[];
    estado: Parameters<typeof bancoDaAg6>[1]["estado"];
    passagemPara?: "fila" | "responsavel_do_lead";
    skills?: Record<string, boolean>;
    liberado?: () => boolean;
    precoDoAudio?: number | null;
    procedimentos?: { id: string; name: string }[];
    opcoes?: Partial<OpcoesDaAg6b>;
  },
): void {
  bancoDaAg6(banco, {
    texto: "(substituida)",
    passagemPara: e.passagemPara,
    estado: e.estado,
  });
  banco.tabelas.set("message", e.mensagens.map((m) => ({ ...m })));
  const publicada = banco.linhas("ai_agent_config")[0];
  if (publicada !== undefined) {
    publicada.skills = { ...(e.skills ?? {}) };
  }
  if (e.precoDoAudio !== null) {
    banco.linhas("llm_preco").push({
      modelo: "whisper-1",
      entrada_microdolar_por_milhao: 0,
      saida_microdolar_por_milhao: 0,
      cache_leitura_microdolar_por_milhao: 0,
      cache_escrita_microdolar_por_milhao: 0,
      audio_microdolar_por_minuto: e.precoDoAudio ?? PRECO_DO_WHISPER_POR_MINUTO,
    });
  }
  for (const p of e.procedimentos ?? []) {
    banco.linhas("procedure").push({
      id: p.id,
      clinic_id: CLINICA,
      name: p.name,
      active: true,
    });
  }
  rpcsDaAg6b(banco, { liberado: e.liberado ?? (() => true), ...e.opcoes });
}

export { CLINICA, CONTATO, CONVERSA, JOB, TELEFONE };

/** Um cliente do agente que responde sempre a mesma mensagem final. */
export function agenteQueResponde(mensagem: string) {
  const corpos: Record<string, unknown>[] = [];
  const create = vi.fn(async (corpo: unknown) => {
    corpos.push(structuredClone(corpo) as Record<string, unknown>);
    return {
      model: "gpt-6-luna",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                mensagem,
                encerra_a_conversa: false,
                perguntas_da_base: [],
              }),
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 1_200,
        output_tokens: 60,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    };
  });
  return {
    cliente: { responses: { create } } as unknown as ClienteDoAgente,
    create,
    corpos,
  };
}
