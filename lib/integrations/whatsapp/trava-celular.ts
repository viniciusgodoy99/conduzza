import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acharCelularDuplicado,
  chaveDoCelularPareado,
  mensagemDeCelularDuplicado,
  pareamentoNovo,
  type NumeroConectado,
} from "@/lib/domain/celular-duplicado";
import {
  getWhatsAppProvider,
  type InstanceRef,
  type InstanceStatus,
  type OpcoesDeConsulta,
  type WhatsAppProvider,
} from "@/lib/integrations/whatsapp/provider";
import { UazapiHttpError } from "@/lib/integrations/whatsapp/uazapi";
import { log } from "@/lib/log";

// Trava contra o MESMO celular pareado em duas instancias (achado 10 do
// docs/07_multiplos_numeros_whatsapp.md). O WhatsApp aceita o mesmo celular
// como aparelho conectado em mais de uma instancia, e cada uma entrega a mesma
// mensagem recebida: a conversa do paciente duplicaria, e entre clinicas a
// clinica errada leria a conversa (risco LGPD).
//
// Mora AQUI, e nao em lib/actions/whatsapp-connect.ts, por dois motivos:
//   - vale para os DOIS lugares que gravam "conectado": as acoes da tela
//     (conectar, consultar o pareamento, verificar a conexao) e o evento de
//     conexao do webhook. Antes o webhook gravava "conectado" direto, sem
//     trava, e o pareamento seguinte nem era conferido (ja estava conectado);
//   - todo export de um arquivo "use server" vira acao chamavel pelo
//     navegador. A trava escreve por service role em numero de QUALQUER
//     clinica: nunca pode ser uma porta aberta.
//
// A decisao pura (chave do telefone, quem e duplicado, a mensagem) fica em
// lib/domain/celular-duplicado.ts. Aqui fica o I/O: a leitura dos conectados,
// a consulta ao provedor e o corte do numero recusado.

/** O numero conferido: sempre clinica E id. */
export type NumeroDaTrava = { clinicId: string; accountId: string };

/** O que a trava precisa para conferir e, se for o caso, desligar. */
export type Pareamento = {
  /** o numero como estava no banco antes desta consulta ao provedor */
  anterior: { connection_status: string; display_phone: string | null };
  provider: WhatsAppProvider;
  ref: InstanceRef;
};

/** A conexao nao foi gravada como veio: o que a tela mostra e por que. */
export type RecusaDaTrava = {
  status: "desconectado" | "conectando";
  mensagem: string;
};

export const TEXTO_SEM_CONFIRMACAO =
  "Não foi possível confirmar esta conexão agora. O sistema confere de novo em instantes.";

/**
 * Nao confirmou: a conexao nao e gravada e a tela continua em "conectando",
 * e a proxima consulta confere de novo. Leitura que falha nao deixa passar
 * nem derruba.
 */
const SEM_CONFIRMACAO: RecusaDaTrava = {
  status: "conectando",
  mensagem: TEXTO_SEM_CONFIRMACAO,
};

/**
 * Mesma clinica, quando o nome do outro numero nao pode ser lido (removido,
 * ou a linha dele na trilha nao gravou).
 */
export const TEXTO_CELULAR_EM_OUTRO_NUMERO =
  "Este celular já está conectado em outro número desta clínica.";

// O MOTIVO da recusa mora na TRILHA (audit_log), com user_id nulo (acao do
// sistema, como o termo-chave e o envio bloqueado). whatsapp_account nao tem
// coluna para ele, e esta correcao nao cria migration (achado M[0] da revisao
// das Fases 3 e 4). A linha do numero recusado diz SO se o outro e da mesma
// clinica; da mesma clinica, uma segunda linha, no MESMO instante, aponta o
// outro numero (para a tela dizer o nome dele). Nada da outra clinica e
// gravado: nem id, nem nome.
const ENTIDADE_DO_NUMERO = "whatsapp_account";
const ACAO_RECUSA_NA_CLINICA = "recusou_celular_de_outro_numero";
const ACAO_RECUSA_DE_OUTRA_CLINICA = "recusou_celular_de_outra_clinica";
const ACAO_CELULAR_DO_OUTRO_NUMERO = "celular_recusado_em_outro_numero";

/** A recusa como a trilha a guarda. */
type RecusaRegistrada =
  | { mesmaClinica: true; outroNumeroId: string | null }
  | { mesmaClinica: false };

/** Um numero conectado como a busca o devolve, com o que falta para consultar o provedor. */
type LinhaConectada = NumeroConectado & {
  provider: string;
  server_url: string | null;
  instance_id: string | null;
};

const COLUNAS_DOS_CONECTADOS =
  "id, clinic_id, nome, display_phone, provider, server_url, instance_id";

type TelefoneConferido =
  | { estado: "conectado"; numero: NumeroConectado }
  /** nao esta conectado de fato, ou a instancia nao existe mais: nao duplica ninguem */
  | { estado: "fora" }
  | { estado: "desconhecido" };

function falhaDoProvedor(error: unknown): string {
  return error instanceof UazapiHttpError
    ? `uazapi_${error.status}`
    : "provedor_indisponivel";
}

/**
 * Numero conectado SEM chave de telefone (achado N[2] da revisao da Fase 2):
 * instancias pareadas antes da correcao do parse guardavam o NOME do perfil
 * em display_phone, e um nome nunca casa com o celular novo. A trava deixava
 * passar. Agora ele e DESCONHECIDO ate o provedor dizer o telefone.
 *
 * Grava SO o telefone (nunca o status): esta consulta roda no pareamento de
 * OUTRO numero, e derrubar ou conectar este aqui nao e papel dela.
 */
async function telefonePeloProvedor(
  admin: SupabaseClient,
  linha: LinhaConectada,
): Promise<TelefoneConferido> {
  const desconhecido = (errorCode: string): TelefoneConferido => {
    log.warn("whatsapp_trava_numero_sem_telefone", {
      clinic_id: linha.clinic_id,
      whatsapp_account_id: linha.id,
      provider: linha.provider,
      error_code: errorCode,
    });
    return { estado: "desconhecido" };
  };

  const { data: segredo, error } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", linha.clinic_id)
    .eq("account_id", linha.id)
    .maybeSingle();
  if (error) {
    return desconhecido(error.code ?? "leitura_falhou");
  }

  let status: InstanceStatus;
  try {
    const provider = getWhatsAppProvider(linha.provider);
    status = await provider.getStatus({
      clinicId: linha.clinic_id,
      accountId: linha.id,
      serverUrl: linha.server_url,
      instanceToken:
        (segredo as { instance_token: string | null } | null)?.instance_token ??
        null,
      instanceId: linha.instance_id,
    });
  } catch (erro) {
    // O servidor nao reconhece mais a instancia (401/404): ela nao entrega
    // mensagem a ninguem, e a rota recusaria o token dela de todo modo.
    if (
      erro instanceof UazapiHttpError &&
      erro.motivo === "instancia_invalida"
    ) {
      return { estado: "fora" };
    }
    return desconhecido(falhaDoProvedor(erro));
  }
  if (status.status !== "conectado") {
    return { estado: "fora" };
  }
  const telefone = status.displayPhone ?? null;
  if (telefone === null || chaveDoCelularPareado(telefone) === null) {
    return desconhecido("sem_telefone");
  }

  const { error: erroAoGravar } = await admin
    .from("whatsapp_account")
    .update({ display_phone: telefone })
    .eq("clinic_id", linha.clinic_id)
    .eq("id", linha.id)
    .is("removido_em", null);
  // Falha ao gravar nao muda a decisao: o telefone ja veio do provedor.
  log.info("whatsapp_telefone_atualizado_pela_trava", {
    clinic_id: linha.clinic_id,
    whatsapp_account_id: linha.id,
    error_code: erroAoGravar?.code ?? null,
  });
  return {
    estado: "conectado",
    numero: {
      id: linha.id,
      clinic_id: linha.clinic_id,
      nome: linha.nome,
      display_phone: telefone,
    },
  };
}

/**
 * Os conectados com o telefone conhecido. Nulo quando algum continua
 * desconhecido: sem saber o telefone dele, nao da para dizer que o celular
 * novo nao e o mesmo.
 */
async function conectadosComTelefone(
  admin: SupabaseClient,
  linhas: readonly LinhaConectada[],
): Promise<NumeroConectado[] | null> {
  const conferidos = await Promise.all(
    linhas.map((linha): Promise<TelefoneConferido> =>
      chaveDoCelularPareado(linha.display_phone) !== null
        ? Promise.resolve({ estado: "conectado", numero: linha })
        : telefonePeloProvedor(admin, linha),
    ),
  );
  if (conferidos.some((conferido) => conferido.estado === "desconhecido")) {
    return null;
  }
  return conferidos.flatMap((conferido) =>
    conferido.estado === "conectado" ? [conferido.numero] : [],
  );
}

/** Mesmo formato do default da coluna: 64 caracteres hexadecimais. */
function segredoNovo(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Grava o motivo na trilha, com o instante que o "desconectado" vai levar.
 * Falha aqui nao impede o corte: a tela so perde o motivo (fica o evento).
 */
async function registrarRecusa(
  admin: SupabaseClient,
  numero: NumeroDaTrava,
  recusa: RecusaRegistrada,
  instante: string,
): Promise<void> {
  const linha = {
    clinic_id: numero.clinicId,
    user_id: null,
    entity: ENTIDADE_DO_NUMERO,
    created_at: instante,
  };
  const { error } = await admin.from("audit_log").insert({
    ...linha,
    action: recusa.mesmaClinica
      ? ACAO_RECUSA_NA_CLINICA
      : ACAO_RECUSA_DE_OUTRA_CLINICA,
    entity_id: numero.accountId,
  });
  const erroDoOutro =
    !error && recusa.mesmaClinica && recusa.outroNumeroId
      ? (
          await admin.from("audit_log").insert({
            ...linha,
            action: ACAO_CELULAR_DO_OUTRO_NUMERO,
            entity_id: recusa.outroNumeroId,
          })
        ).error
      : null;
  const falha = error ?? erroDoOutro;
  if (falha) {
    log.warn("whatsapp_trava_motivo_nao_registrado", {
      clinic_id: numero.clinicId,
      whatsapp_account_id: numero.accountId,
      error_code: falha.code ?? null,
    });
  }
}

/**
 * Corta o numero recusado (achado N[1] da revisao da Fase 2).
 *
 * PELO NOSSO LADO PRIMEIRO, sem depender do provedor: o webhook_secret gira, e
 * a URL gravada na instancia passa a receber 401 (como na remocao). Antes, um
 * desligamento que falhava deixava a instancia pareada com a URL valida, e a
 * rota continuava gravando nesta clinica as mensagens dos pacientes da outra,
 * com o banco dizendo "desconectado". O instance_token NAO e limpo: a rota so
 * confere o token quando ele esta guardado, e limpar enfraqueceria a segunda
 * camada. O proximo Conectar regrava o webhook com o segredo novo.
 *
 * O MOTIVO vai para a trilha e o "desconectado" e gravado com o MESMO
 * instante, os dois ANTES do desligamento (achado M[0] da revisao das Fases 3
 * e 4). Quando o webhook recusa primeiro, a consulta do dialogo so ve a
 * instancia ja desligada e mostrava "Desconectado" sem dizer por que. Nesta
 * ordem, quem ve o provedor desligado acha no banco o "desconectado" com o
 * carimbo da recusa, e motivoDaRecusaVigente remonta a mensagem. O carimbo e
 * gravado mesmo com o numero ja "desconectado" no banco: a trava so roda com
 * o provedor dizendo "conectado", entao o corte e uma desconexao de verdade.
 *
 * Depois, o desligamento no provedor, que so conta com resposta 2xx. Nao
 * confirmado, vira um evento proprio para o suporte agir.
 */
async function cortarNumeroRecusado(
  admin: SupabaseClient,
  numero: NumeroDaTrava,
  pareamento: Pareamento,
  recusa: RecusaRegistrada,
): Promise<void> {
  const campos = {
    clinic_id: numero.clinicId,
    whatsapp_account_id: numero.accountId,
    provider: pareamento.provider.name,
  };
  const instante = new Date().toISOString();

  const { error: erroDoSegredo } = await admin
    .from("whatsapp_account_secret")
    .update({ webhook_secret: segredoNovo(), qr_code: null })
    .eq("clinic_id", numero.clinicId)
    .eq("account_id", numero.accountId);
  if (erroDoSegredo) {
    log.error("whatsapp_trava_segredo_nao_girou", {
      ...campos,
      error_code: erroDoSegredo.code ?? null,
    });
  }

  await registrarRecusa(admin, numero, recusa, instante);

  // SEM o guard .neq das acoes, de proposito: o carimbo precisa ser o da
  // recusa mesmo quando o banco ja dizia "desconectado" (a reconexao sozinha,
  // ou o evento de desconexao que passou antes). E ANTES do desligamento: a
  // consulta do dialogo so ve a instancia desligada depois daqui, e a
  // gravacao dela (com o guard) nao troca mais este carimbo.
  const { error: erroDoStatus } = await admin
    .from("whatsapp_account")
    .update({ connection_status: "desconectado", disconnected_at: instante })
    .eq("clinic_id", numero.clinicId)
    .eq("id", numero.accountId);
  if (erroDoStatus) {
    log.error("whatsapp_trava_status_nao_gravado", {
      ...campos,
      error_code: erroDoStatus.code ?? null,
    });
  }

  let desligado = false;
  let httpStatus: number | null = null;
  let codigo: string | null = null;
  try {
    await pareamento.provider.disconnect(pareamento.ref);
    desligado = true;
  } catch (erro) {
    httpStatus = erro instanceof UazapiHttpError ? erro.status : null;
    codigo = falhaDoProvedor(erro);
  }

  if (!desligado) {
    log.error("whatsapp_trava_sem_desligar", {
      ...campos,
      http_status: httpStatus,
      error_code: codigo,
    });
  }
}

/**
 * A trava. Roda quando o provedor diz "conectado" e devolve a recusa quando a
 * conexao nao pode valer (e ai o "conectado" nao e gravado por quem chama).
 *
 * So confere PAREAMENTO NOVO (pareamentoNovo): o numero que ja estava
 * conectado com este mesmo celular nao e derrubado quando o duplicado
 * aparece em outro lugar, porque quem chega depois e que e recusado.
 *
 * Procura o mesmo celular entre os numeros ativos e conectados de QUALQUER
 * clinica, por service role. Achou: corta o numero novo (cortarNumeroRecusado)
 * e grava "desconectado", antes de ele receber a conversa de alguem.
 */
export async function recusarCelularDuplicado(
  admin: SupabaseClient,
  numero: NumeroDaTrava,
  status: InstanceStatus,
  pareamento: Pareamento,
): Promise<RecusaDaTrava | null> {
  // O simulador devolve o MESMO numero ficticio para toda clinica: nao ha
  // celular de verdade para proteger, e a trava so atrapalharia a
  // demonstracao e o desenvolvimento.
  if (pareamento.provider.name === "fake") {
    return null;
  }

  // Conectado sem telefone: o numero que ja estava conectado com um celular
  // conhecido segue como estava (o provedor so deixou de dizer o numero).
  // Pareamento novo sem telefone nao se confere, entao nao se grava: a
  // proxima consulta costuma trazer o numero.
  if (chaveDoCelularPareado(status.displayPhone) === null) {
    const jaConhecido =
      pareamento.anterior.connection_status === "conectado" &&
      chaveDoCelularPareado(pareamento.anterior.display_phone) !== null;
    if (jaConhecido) {
      return null;
    }
    log.warn("whatsapp_trava_de_celular_sem_leitura", {
      clinic_id: numero.clinicId,
      whatsapp_account_id: numero.accountId,
      error_code: "conexao_sem_telefone",
    });
    return SEM_CONFIRMACAO;
  }
  if (!pareamentoNovo(pareamento.anterior, status.displayPhone)) {
    return null;
  }

  // Numero do simulador fica de fora pelo mesmo motivo: o celular dele e
  // ficticio (as clinicas descartaveis da suite e2e vivem no mesmo banco).
  // display_phone nulo ENTRA: conectado sem telefone e desconhecido, nao
  // "diferente".
  const { data, error } = await admin
    .from("whatsapp_account")
    .select(COLUNAS_DOS_CONECTADOS)
    .is("removido_em", null)
    .eq("connection_status", "conectado")
    .neq("provider", "fake")
    .neq("id", numero.accountId);
  if (error) {
    log.warn("whatsapp_trava_de_celular_sem_leitura", {
      clinic_id: numero.clinicId,
      whatsapp_account_id: numero.accountId,
      error_code: error.code ?? null,
    });
    return SEM_CONFIRMACAO;
  }
  const conectados = await conectadosComTelefone(
    admin,
    (data ?? []) as LinhaConectada[],
  );
  if (conectados === null) {
    log.warn("whatsapp_trava_de_celular_sem_leitura", {
      clinic_id: numero.clinicId,
      whatsapp_account_id: numero.accountId,
      error_code: "numero_sem_telefone",
    });
    return SEM_CONFIRMACAO;
  }

  const duplicado = acharCelularDuplicado(
    {
      accountId: numero.accountId,
      clinicId: numero.clinicId,
      displayPhone: status.displayPhone,
    },
    conectados,
  );
  if (!duplicado) {
    return null;
  }

  // Da mesma clinica, QUAL numero (o primeiro da mesma busca de
  // acharCelularDuplicado): a trilha guarda o id, e a tela le o nome depois.
  const chave = chaveDoCelularPareado(status.displayPhone);
  const outroDaClinica = duplicado.mesmaClinica
    ? (conectados.find(
        (outro) =>
          outro.id !== numero.accountId &&
          outro.clinic_id === numero.clinicId &&
          chaveDoCelularPareado(outro.display_phone) === chave,
      ) ?? null)
    : null;
  await cortarNumeroRecusado(
    admin,
    numero,
    pareamento,
    duplicado.mesmaClinica
      ? { mesmaClinica: true, outroNumeroId: outroDaClinica?.id ?? null }
      : { mesmaClinica: false },
  );
  log.warn("whatsapp_celular_em_outro_numero", {
    clinic_id: numero.clinicId,
    whatsapp_account_id: numero.accountId,
    provider: pareamento.provider.name,
    // So ONDE esta o outro: nada sobre a outra clinica vai para o log.
    status: duplicado.mesmaClinica ? "mesma_clinica" : "outra_clinica",
  });
  return {
    status: "desconectado",
    mensagem: mensagemDeCelularDuplicado(duplicado),
  };
}

/**
 * O que a rota do webhook faz com a conexao conferida (achado M[5] da revisao
 * das Fases 3 e 4). Antes "recusado" e "nao deu para confirmar" eram o mesmo
 * {gravar: false}, a rota respondia 200 aos dois e o segundo nunca era
 * conferido de novo por ninguem.
 */
export type ConexaoDoWebhook =
  /** grava "conectado" e, quando veio, o telefone conferido */
  | { resultado: "confirmada"; displayPhone: string | null }
  /** a trava recusou o celular e ja cortou o numero: nada a gravar */
  | { resultado: "recusada" }
  /**
   * nada a confirmar, e repetir nao muda isso: numero removido, instancia
   * desligada ou que o servidor nao reconhece, provedor fora do ambiente
   */
  | { resultado: "encerrada" }
  /**
   * nao deu para decidir AGORA (leitura do banco ou provedor falhou,
   * telefone desconhecido, instancia ainda conectando): conferir de novo
   */
  | { resultado: "sem_confirmacao" };

type ContaDoWebhook = {
  provider: string;
  server_url: string | null;
  instance_id: string | null;
  display_phone: string | null;
  connection_status: string;
  removido_em: string | null;
};

/**
 * O evento "conectado" do webhook passa pela MESMA trava das acoes.
 *
 * Antes a rota gravava "conectado" direto. Alem de pular a trava, isso
 * desarmava a conferencia da tela: a consulta seguinte ja achava o numero
 * conectado com o mesmo celular e nao o tratava como pareamento novo.
 *
 * O evento nao traz o telefone, entao o provedor e consultado. Quando nao da
 * para decidir agora, o resultado diz isso ("sem_confirmacao") e quem chama
 * faz o provedor reenviar: o evento de conexao e a mensagem recebida
 * respondem 503, e o reenvio confere de novo. A tela (que consulta o
 * pareamento a cada 2,5 s) e o "Verificar conexao" continuam conferindo pelo
 * lado delas.
 *
 * Tambem e a porta da ingestao: a mensagem que chega por numero ainda nao
 * conectado no banco passa por aqui antes de ser gravada (route.ts).
 *
 * `consulta` vale SO para a consulta do status DESTE numero, e so a porta da
 * ingestao com o numero "desconectado" a encurta (achado T[1] da revisao da
 * trava): la a mensagem entra com ou sem decisao. A leitura do telefone de
 * outro numero (telefonePeloProvedor) e o desligamento do corte seguem com o
 * padrao: o primeiro so roda para conectado sem telefone, e o segundo precisa
 * ser confiavel.
 */
export async function conferirConexaoDoWebhook(
  admin: SupabaseClient,
  numero: NumeroDaTrava,
  instanceToken: string | null,
  consulta?: OpcoesDeConsulta,
): Promise<ConexaoDoWebhook> {
  const campos = {
    clinic_id: numero.clinicId,
    whatsapp_account_id: numero.accountId,
  };
  const { data, error } = await admin
    .from("whatsapp_account")
    .select(
      "provider, server_url, instance_id, display_phone, connection_status, removido_em",
    )
    .eq("clinic_id", numero.clinicId)
    .eq("id", numero.accountId)
    .maybeSingle();
  if (error) {
    log.warn("whatsapp_trava_de_celular_sem_leitura", {
      ...campos,
      error_code: error.code ?? null,
    });
    return { resultado: "sem_confirmacao" };
  }
  const conta = data as ContaDoWebhook | null;
  // Numero removido fica como a remocao o deixou.
  if (!conta || conta.removido_em) {
    return { resultado: "encerrada" };
  }
  // Evento repetido: ja conectado, a rota nao muda nada (.neq no update).
  if (conta.connection_status === "conectado") {
    return { resultado: "confirmada", displayPhone: null };
  }

  let provider: WhatsAppProvider;
  try {
    provider = getWhatsAppProvider(conta.provider);
  } catch {
    // Configuracao do ambiente: repetir o evento nao a conserta.
    log.warn("whatsapp_conexao_sem_confirmacao", {
      ...campos,
      error_code: "provedor_indisponivel",
    });
    return { resultado: "encerrada" };
  }
  if (provider.name === "fake") {
    return { resultado: "confirmada", displayPhone: null };
  }

  const ref: InstanceRef = {
    clinicId: numero.clinicId,
    accountId: numero.accountId,
    serverUrl: conta.server_url,
    instanceToken,
    instanceId: conta.instance_id,
  };
  let status: InstanceStatus;
  try {
    status = await provider.getStatus(ref, consulta);
  } catch (erro) {
    const invalida =
      erro instanceof UazapiHttpError && erro.motivo === "instancia_invalida";
    log.warn("whatsapp_conexao_sem_confirmacao", {
      ...campos,
      provider: provider.name,
      http_status: erro instanceof UazapiHttpError ? erro.status : null,
      error_code: falhaDoProvedor(erro),
    });
    // 401/404: o servidor nao reconhece a instancia, e repetir da o mesmo.
    // Qualquer outra falha (tempo esgotado, 5xx, 429) e passageira.
    return { resultado: invalida ? "encerrada" : "sem_confirmacao" };
  }
  if (status.status !== "conectado") {
    log.info("whatsapp_conexao_sem_confirmacao", {
      ...campos,
      provider: provider.name,
      connection_status: status.status,
    });
    // Desligada: o evento ficou velho. Ainda conectando: logo confirma.
    return {
      resultado:
        status.status === "desconectado" ? "encerrada" : "sem_confirmacao",
    };
  }

  const recusa = await recusarCelularDuplicado(admin, numero, status, {
    anterior: conta,
    provider,
    ref,
  });
  if (recusa) {
    // "desconectado" e o corte feito; "conectando" e a trava sem leitura
    // (SEM_CONFIRMACAO), que o reenvio confere de novo.
    return {
      resultado:
        recusa.status === "desconectado" ? "recusada" : "sem_confirmacao",
    };
  }
  const telefone = status.displayPhone ?? null;
  return {
    resultado: "confirmada",
    displayPhone:
      telefone !== null && chaveDoCelularPareado(telefone) !== null
        ? telefone
        : null,
  };
}

/**
 * O motivo da recusa que ainda explica a desconexao do numero, ou nulo
 * (achado M[0] da revisao das Fases 3 e 4).
 *
 * Vale enquanto o numero continua na desconexao que a recusa causou: o banco
 * diz "desconectado" com o carimbo IGUAL ao instante gravado na trilha
 * (cortarNumeroRecusado grava os dois juntos). Qualquer pareamento depois
 * disso tira o motivo sozinho, sem nada a limpar: conectou, o numero sai do
 * "desconectado"; o QR novo expirou, o "desconectado" ganha outro carimbo.
 *
 * Da outra clinica, a mensagem nao diz nada sobre ela (a trilha nem guarda
 * qual e). Da mesma clinica, o nome do outro numero e lido agora (um
 * renomear feito depois aparece), e sem ele a mensagem diz so que e desta
 * clinica.
 *
 * Leitura por service role, por clinica E id: quem chama ja conferiu o papel
 * e passa o numero da sessao.
 */
export async function motivoDaRecusaVigente(
  admin: SupabaseClient,
  numero: NumeroDaTrava,
): Promise<string | null> {
  const { data: conta, error } = await admin
    .from("whatsapp_account")
    .select("connection_status, disconnected_at")
    .eq("clinic_id", numero.clinicId)
    .eq("id", numero.accountId)
    .is("removido_em", null)
    .maybeSingle();
  const situacao = conta as {
    connection_status: string;
    disconnected_at: string | null;
  } | null;
  if (
    error ||
    !situacao ||
    situacao.connection_status !== "desconectado" ||
    !situacao.disconnected_at
  ) {
    return null;
  }

  // O carimbo como o banco o devolve: a igualdade e a do proprio Postgres.
  //
  // SO as linhas do sistema (user_id nulo), que registrarRecusa grava por
  // service role (achado T[2] da revisao da trava). A policy de INSERT da
  // trilha deixa qualquer membro ativo gravar QUALQUER action com o proprio
  // user_id e o created_at que quiser, e disconnected_at e legivel por ele:
  // sem este filtro, uma recepcionista forjava o motivo (ou o nome do outro
  // numero). Nenhum membro grava user_id nulo: a policy exige auth.uid().
  const { data: trilha, error: erroDaTrilha } = await admin
    .from("audit_log")
    .select("action, entity_id")
    .eq("clinic_id", numero.clinicId)
    .eq("entity", ENTIDADE_DO_NUMERO)
    .eq("created_at", situacao.disconnected_at)
    .is("user_id", null)
    .in("action", [
      ACAO_RECUSA_NA_CLINICA,
      ACAO_RECUSA_DE_OUTRA_CLINICA,
      ACAO_CELULAR_DO_OUTRO_NUMERO,
    ]);
  if (erroDaTrilha) {
    return null;
  }
  const linhas = (trilha ?? []) as {
    action: string;
    entity_id: string | null;
  }[];
  const recusa = linhas.find(
    (linha) =>
      linha.entity_id === numero.accountId &&
      (linha.action === ACAO_RECUSA_NA_CLINICA ||
        linha.action === ACAO_RECUSA_DE_OUTRA_CLINICA),
  );
  if (!recusa) {
    return null;
  }
  if (recusa.action === ACAO_RECUSA_DE_OUTRA_CLINICA) {
    return mensagemDeCelularDuplicado({ mesmaClinica: false });
  }

  const outroId =
    linhas.find(
      (linha) =>
        linha.action === ACAO_CELULAR_DO_OUTRO_NUMERO &&
        linha.entity_id !== numero.accountId,
    )?.entity_id ?? null;
  if (outroId) {
    const { data: outro } = await admin
      .from("whatsapp_account")
      .select("nome")
      .eq("clinic_id", numero.clinicId)
      .eq("id", outroId)
      .is("removido_em", null)
      .maybeSingle();
    const nome = (outro as { nome: string } | null)?.nome;
    if (nome) {
      return mensagemDeCelularDuplicado({ mesmaClinica: true, nome });
    }
  }
  return TEXTO_CELULAR_EM_OUTRO_NUMERO;
}

/**
 * Os motivos vigentes de VARIOS numeros da mesma clinica, pelo id (so quem
 * tem motivo entra). Serve as telas que mostram o numero fora do dialogo de
 * conexao: o cartao de Configuracoes > WhatsApp e o do onboarding na
 * primeira pintura, e a resposta do "Verificar conexao" da faixa. Antes, quem
 * recarregava a pagina depois da recusa via so "Desconectado".
 *
 * A clinica e SEMPRE a da sessao de quem chama, que tambem ja conferiu o
 * papel (administrador e gestor, o publico do dialogo). Mora aqui, fora de
 * arquivo "use server", porque recebe a clinica por parametro: exportada de
 * la, viraria acao chamavel pelo navegador com a clinica que ele quisesse.
 *
 * Uma leitura que lanca tira so o motivo daquele numero: a tela continua com
 * o "Desconectado" de antes, nunca quebra por causa do motivo.
 */
export async function motivosDaRecusaVigentes(
  admin: SupabaseClient,
  clinicId: string,
  accountIds: readonly string[],
): Promise<Record<string, string>> {
  const motivos = await Promise.all(
    accountIds.map(async (accountId) => {
      try {
        return {
          accountId,
          motivo: await motivoDaRecusaVigente(admin, { clinicId, accountId }),
        };
      } catch {
        return { accountId, motivo: null };
      }
    }),
  );
  const porNumero: Record<string, string> = {};
  for (const { accountId, motivo } of motivos) {
    if (motivo) {
      porNumero[accountId] = motivo;
    }
  }
  return porNumero;
}
