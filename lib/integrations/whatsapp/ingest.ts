import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  atribuirOrigem,
  codigosDoCliqueDoSite,
  extrairToken,
  type CampaignRule,
  type SourceChannel,
  eFraseDoBotao,
} from "@/lib/domain/attribution";
import { FRASE_PADRAO } from "@/lib/domain/rastreio-do-site";
import type {
  AnuncioDeOrigem,
  InboundEvent,
  PlataformaDoAnuncio,
} from "@/lib/integrations/whatsapp/inbound";
import { tentarMoverPorTermo } from "@/lib/integrations/whatsapp/termo-chave";
import { log } from "@/lib/log";

// Gancho de ingestao de mensagem recebida. Chama a RPC ingest_inbound_message
// (idempotencia e concorrencia vivem no banco) e, SO quando o contato acabou
// de nascer, roda a atribuicao de origem (tarefa 4.2). A atribuicao inteira e
// melhor esforco: qualquer falha vira log e a ingestao segue, porque a
// mensagem ja esta salva quando ela roda.
//
// A mensagem que a CLINICA enviou pelo celular pareado tambem passa por aqui
// (registrarMensagemDoCelular, no fim do arquivo), sem atribuicao, anuncio
// nem consentimento: ela nao diz nada sobre de onde o paciente veio.
//
// Precedencia da origem (D3, 04/10/2026, e F1 do Google, 05/10/2026):
// anuncio da Meta, depois codigo fixo de campanha, depois clique do site,
// depois mensagem padrao, depois palavra-chave. O anuncio grava primeiro e a
// atribuicao por texto encontra o canal ja preenchido. Codigo de clique que
// nao gravou origem nao atrapalha a mensagem padrao (o sufixo do script do
// site sai da comparacao).
//
// REGRA ABSOLUTA: nenhum conteudo de mensagem de paciente em log. So ids.

export type IngestResultado = {
  inserted: boolean;
  /**
   * Presente quando a RPC NAO gravou nada de proposito, e isso nao e erro:
   * - numero_proprio: quem escreveu e um numero ativo da propria clinica
   *   (o numero A falando com o numero B nao e paciente);
   * - numero_removido: o numero que recebeu foi removido no meio do caminho
   *   (corrida com a remocao; a URL dele ja recebe 401).
   * Os ids vem nulos e inserted false.
   */
  ignorada?: "numero_proprio" | "numero_removido";
  contact_id: string | null;
  contact_created: boolean;
  conversation_id: string | null;
  message_id: string | null;
  /** O numero que recebeu. Nulo so em clinica sem numero ativo. */
  whatsapp_account_id: string | null;
};

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;
type MensagemDoCelular = Extract<InboundEvent, { kind: "clinic_device_reply" }>;

/**
 * Resultado da RPC registrar_mensagem_do_celular (mensagem que a clinica
 * enviou pelo celular pareado, fora do sistema).
 */
export type RegistroDoCelular = {
  /** false na reentrega e quando a linha ja existia (envio nosso gravado). */
  inserted: boolean;
  /**
   * Presente quando a RPC NAO gravou nada de proposito, e isso nao e erro:
   * - numero_removido: o numero foi removido no meio do caminho;
   * - numero_proprio: o destino e outro numero ativo da propria clinica;
   * - numero_da_plataforma: o destino e um numero ativo de OUTRA clinica da
   *   plataforma. O wa_message_id e o mesmo dos dois lados e o unique ainda
   *   e global (docs/07): ele fica com a ingestao de quem RECEBEU, senao a
   *   mensagem que a outra clinica recebeu sumiria sem aviso;
   * - colisao_wa_message_id: o id ja existe em OUTRA clinica (o unique de
   *   wa_message_id ainda e global, docs/07);
   * - contato_desconhecido: a clinica escreveu para alguem que nao esta no
   *   sistema. O contato NAO e criado por mensagem de saida (nasceria lead
   *   sem consentimento e sem origem).
   *
   * Em numero_da_plataforma e colisao_wa_message_id o eco nao vira linha (o
   * id e da outra clinica), mas continua sendo a equipe respondendo pelo
   * celular: a RPC ja derrubou a espera da conversa aberta daquele numero
   * (espera_pelo_celular_sem_linha) e devolve o contact_id quando o contato
   * existe, para a rota rodar o termo-chave. Nas outras, contact_id e nulo.
   */
  ignorada?:
    | "numero_removido"
    | "numero_proprio"
    | "numero_da_plataforma"
    | "colisao_wa_message_id"
    | "contato_desconhecido";
  /**
   * O contato da conversa. Na ignorada, so em numero_da_plataforma e
   * colisao_wa_message_id (quando o contato existe); ver `ignorada`.
   */
  contact_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  whatsapp_account_id: string | null;
  /**
   * A RPC reconheceu a resposta automatica do app WhatsApp Business: gravada
   * como 'sistema'. Com o horario de envio do eco e o da ultima mensagem do
   * paciente, decide por eles (o paciente enviou de 8 s antes a 2 s depois
   * do eco); sem um deles, pela chegada (a ultima mensagem do paciente
   * chegou de 8 s antes a 10 s depois do envio). Nulo quando nada foi
   * decidido agora. Se o eco gravou antes da mensagem do paciente, a
   * correcao vem depois, na ingestao dela (reclassificarRespostaAutomatica).
   */
  automatica: boolean | null;
};

type LinhaCampanha = {
  id: string;
  token: string | null;
  channel: SourceChannel;
  origin: string | null;
  medium: string | null;
  campaign: string | null;
  default_message: string | null;
  keywords: string[] | null;
};

export type ResultadoDoCliqueDoSite =
  "origem_gravada" | "vinculado" | "nao_achado" | "expirado";

const RESULTADOS_DO_CLIQUE: readonly ResultadoDoCliqueDoSite[] = [
  "origem_gravada",
  "vinculado",
  "nao_achado",
  "expirado",
];

function lerResultadoDoClique(dado: unknown): ResultadoDoCliqueDoSite | null {
  return RESULTADOS_DO_CLIQUE.find((resultado) => resultado === dado) ?? null;
}

/**
 * Le as frases do botao do site da clinica (rastreio_do_site.frases) e diz se
 * o texto, sem os codigos do clique, e uma delas, a padrao ou o "Ola!" da v1.
 * Falha na leitura: considera que e frase (na duvida, nada de origem por
 * texto gravada para sempre). Sem linha de rastreio: so as frases de fabrica.
 */
async function textoEFraseDoBotao(
  admin: SupabaseClient,
  clinicId: string,
  corpo: string | null,
  codigos: readonly string[],
): Promise<boolean> {
  const { data, error } = await admin
    .from("rastreio_do_site")
    .select("frases")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    log.error("atribuicao_buscar_frases_falhou", {
      clinic_id: clinicId,
      error_code: error.code ?? null,
    });
    return true;
  }
  const daClinica = ((data as { frases?: string[] | null } | null)?.frases ??
    []) as string[];
  return eFraseDoBotao(corpo, codigos, [...daClinica, FRASE_PADRAO, "Olá!"]);
}

/**
 * Casa os codigos da mensagem (na ordem dada) com um clique do site da
 * clinica pela RPC casar_clique_do_site. O banco faz tudo numa transacao:
 * so casa clique da mesma clinica, nao casado e no prazo, e so grava a
 * origem (Trafego pago, Google, clique_site, ids da campanha e do grupo) em
 * contato sem origem e sem sinal de anuncio da Meta.
 *
 * Para no primeiro origem_gravada ou vinculado; senao devolve expirado (se
 * algum codigo era clique vencido) ou nao_achado. Devolve null quando a RPC
 * falha ou responde fora do contrato.
 *
 * Log so com ids, status e contagem: NUNCA o codigo (ele liga a mensagem do
 * paciente ao clique).
 */
async function casarCliqueDoSite(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
  codigos: readonly string[],
): Promise<ResultadoDoCliqueDoSite | null> {
  let resultadoFinal: ResultadoDoCliqueDoSite = "nao_achado";
  let tentativas = 0;
  for (const codigo of codigos) {
    tentativas += 1;
    const { data, error } = await admin.rpc("casar_clique_do_site", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_codigo: codigo,
    });
    if (error) {
      log.error("clique_do_site_casar_falhou", {
        clinic_id: clinicId,
        contact_id: contactId,
        error_code: error.code ?? null,
        count: tentativas,
      });
      return null;
    }
    const resultado = lerResultadoDoClique(data);
    if (resultado === null) {
      log.error("clique_do_site_resposta_inesperada", {
        clinic_id: clinicId,
        contact_id: contactId,
        count: tentativas,
      });
      return null;
    }
    if (resultado === "origem_gravada" || resultado === "vinculado") {
      resultadoFinal = resultado;
      break;
    }
    if (resultado === "expirado") {
      resultadoFinal = "expirado";
    }
  }
  log.info("clique_do_site_na_ingestao", {
    clinic_id: clinicId,
    contact_id: contactId,
    status: resultadoFinal,
    count: tentativas,
  });
  return resultadoFinal;
}

async function tentarAtribuirOrigem(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
  corpo: string,
  contatoRecemCriado: boolean,
): Promise<void> {
  const { data, error } = await admin
    .from("campaign_link")
    .select(
      "id, token, channel, origin, medium, campaign, default_message, keywords",
    )
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) {
    log.error("atribuicao_buscar_campanhas_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      error_code: error.code ?? null,
    });
    return;
  }

  const regras: CampaignRule[] = ((data ?? []) as LinhaCampanha[]).map(
    (linha) => ({
      id: linha.id,
      token: linha.token,
      channel: linha.channel,
      origin: linha.origin,
      medium: linha.medium,
      campaign: linha.campaign,
      defaultMessage: linha.default_message,
      keywords: linha.keywords ?? [],
    }),
  );

  // CLIQUE DO SITE (F1 do Google): codigo que NAO casa com campaign_link.
  // Depois do codigo fixo (codigosDoCliqueDoSite devolve vazio quando algum
  // token e de campaign_link) e antes de mensagem padrao e palavra-chave.
  // Nao depende de atribuirOrigem, que devolve null sem regras. Vale tambem
  // para contato pre-existente: o codigo e por clique, sinal explicito como
  // o token, e quem ja tem origem so ganha o vinculo com o clique.
  const codigos = codigosDoCliqueDoSite(corpo, regras);
  if (codigos.length > 0) {
    const clique = await casarCliqueDoSite(admin, clinicId, contactId, codigos);
    // origem_gravada: a origem e esta. null (falha): na duvida a origem fica
    // vazia, nunca uma de precedencia menor gravada para sempre.
    // vinculado (a origem nao foi gravada de proposito), nao_achado e
    // expirado seguem para mensagem padrao e palavra-chave, como sem o
    // script do site: a mensagem padrao compara o texto sem o sufixo
    // " [#XXXXXX]" desses codigos (atribuirOrigem recebe a lista), senao o
    // clique perdido (rastreio desligado, aviso que falhou, limite, despejo,
    // prazo vencido) tiraria a mensagem padrao e deixaria a palavra-chave,
    // de precedencia menor, gravar para sempre.
    if (clique === "origem_gravada" || clique === null) {
      return;
    }
    // Botao do site sem mensagem pronta: o texto que sobra e a frase que o
    // script escreveu (frases da clinica em rastreio_do_site, a padrao ou o
    // "Ola!" da v1). Com o clique perdido, esse texto nao atribui nada.
    if (await textoEFraseDoBotao(admin, clinicId, corpo, codigos)) {
      return;
    }
  }

  // Contato pre-existente sem origem: SO o token atribui (sinal explicito e
  // valido a qualquer momento). Mensagem padrao e palavra-chave valem apenas
  // na primeira mensagem da vida do contato, senao conversa comum viraria
  // atribuicao errada. `codigos` vazio (sem codigo de clique) nao muda nada.
  const atribuicao = atribuirOrigem(corpo, regras, codigos);
  if (!atribuicao) {
    return;
  }
  if (!contatoRecemCriado && atribuicao.method !== "link_token") {
    return;
  }

  // Primeira captura vence: o predicado source_channel is null mais o trigger
  // impedir_reatribuicao_de_origem garantem que origem preenchida nunca muda.
  const { error: erroGravacao } = await admin
    .from("contact")
    .update({
      source_channel: atribuicao.channel,
      source_origin: atribuicao.origin,
      source_medium: atribuicao.medium,
      source_campaign: atribuicao.campaign,
      source_method: atribuicao.method,
      source_captured_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .is("source_channel", null);
  if (erroGravacao) {
    log.error("atribuicao_gravar_origem_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      error_code: erroGravacao.code ?? null,
    });
  }
}

/**
 * Colunas de id do anuncio que vao para o contato (so as que vieram). null
 * quando nao veio nenhuma ou quando e post: post nao grava id (ver
 * capturarAnuncio).
 */
export function idsDoAnuncio(
  anuncio: AnuncioDeOrigem,
): Record<string, string> | null {
  if (anuncio.tipo === "post") {
    return null;
  }
  const ids: Record<string, string> = {};
  if (anuncio.ctwaClid) ids.ctwa_clid = anuncio.ctwaClid;
  if (anuncio.adId) ids.source_ad_id = anuncio.adId;
  if (anuncio.adsetId) ids.source_adset_id = anuncio.adsetId;
  if (anuncio.campaignId) ids.source_campaign_id = anuncio.campaignId;
  return Object.keys(ids).length > 0 ? ids : null;
}

/**
 * Origem de anuncio a gravar no contato (D3, 04/10/2026), ou null quando o
 * anuncio nao prova clique em anuncio PAGO. A origem e imutavel (gatilho
 * impedir_reatribuicao_de_origem), entao so grava com prova:
 * - tipo 'post' (publicacao, nao anuncio pago): nunca;
 * - tipo 'ad': sim;
 * - sem tipo: so com o id do clique (ctwa_clid), que a Meta gera para
 *   anuncio. Id de anuncio sem clique e sem tipo pode ser post: fica sem
 *   origem (os ids continuam gravados, como antes), a mesma regra da
 *   correcao dos contatos antigos na migration 20261004100000.
 *
 * Coerente com o CHECK contact_origem_de_anuncio_coerente: canal
 * trafego_pago, origem Meta, meio = plataforma (Facebook, Instagram ou nulo)
 * e NUNCA source_campaign. Campanha e conjunto vem de meta_anuncio pelo
 * source_ad_id.
 */
export function origemDoAnuncio(
  anuncio: AnuncioDeOrigem,
  capturadaEm: string,
): {
  source_channel: "trafego_pago";
  source_origin: "Meta";
  source_medium: PlataformaDoAnuncio | null;
  source_method: "anuncio_ctwa";
  source_captured_at: string;
} | null {
  if (anuncio.tipo === "post") {
    return null;
  }
  if (anuncio.tipo !== "ad" && anuncio.ctwaClid === null) {
    return null;
  }
  return {
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_medium: anuncio.plataforma,
    source_method: "anuncio_ctwa",
    source_captured_at: capturadaEm,
  };
}

/**
 * Nomes de chave do anuncio para o log de diagnostico, no formato
 * "anuncio=a,b;contexto=c,d". So nomes (ja saneados no parser), nunca valor.
 */
export function chavesDoAnuncioParaLog(anuncio: AnuncioDeOrigem): {
  path: string;
  count: number;
} {
  const { anuncio: doAnuncio, contexto } = anuncio.chavesVistas;
  return {
    path: `anuncio=${doAnuncio.join(",")};contexto=${contexto.join(",")}`,
    count: doAnuncio.length + contexto.length,
  };
}

type CapturaDeAnuncio = {
  clinicId: string;
  contactId: string;
  whatsappAccountId: string | null;
  /** A mensagem acabou de ser gravada (false na reentrega do webhook). */
  mensagemNova: boolean;
  anuncio: AnuncioDeOrigem;
};

/**
 * Diagnostico do anuncio recebido: quais campos o canal entrega de fato
 * (e o que vai mostrar se o uazapi manda a plataforma). So nomes de chave,
 * tipo e se a plataforma foi reconhecida; nenhum valor de campo do anuncio.
 */
function registrarAnuncioRecebido(captura: CapturaDeAnuncio): void {
  const { anuncio } = captura;
  log.info("anuncio_recebido", {
    clinic_id: captura.clinicId,
    whatsapp_account_id: captura.whatsappAccountId,
    contact_id: captura.contactId,
    kind: anuncio.tipo ?? "sem_tipo",
    status: anuncio.plataforma ? "com_plataforma" : "sem_plataforma",
    ...chavesDoAnuncioParaLog(anuncio),
  });
}

/**
 * Pede a consulta da campanha e do conjunto do anuncio na Meta (job
 * resolver_anuncio_meta). Melhor esforco: sem conta da Meta configurada a
 * RPC so responde sem_configuracao, e qualquer falha vira log com codigo.
 */
async function pedirResolucaoDaCampanha(
  admin: SupabaseClient,
  clinicId: string,
): Promise<void> {
  try {
    const { data, error } = await admin.rpc(
      "enfileirar_resolucao_de_anuncios_meta",
      { p_clinic_id: clinicId, p_origem: "ingestao" },
    );
    if (error) {
      log.error("resolucao_de_anuncio_nao_pedida", {
        clinic_id: clinicId,
        error_code: error.code ?? null,
      });
      return;
    }
    const codigo =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).codigo
        : null;
    log.info("resolucao_de_anuncio_pedida", {
      clinic_id: clinicId,
      status: typeof codigo === "string" ? codigo : null,
    });
  } catch {
    log.error("resolucao_de_anuncio_nao_pedida", { clinic_id: clinicId });
  }
}

/**
 * Grava no contato o anuncio de onde a mensagem veio, em tres passos:
 *
 * 1. Ids do clique. PRIMEIRO CLIQUE VENCE: o update so acontece enquanto
 *    ctwa_clid E source_ad_id estao nulos. O .select("id") diz se este foi
 *    o primeiro clique (linha devolvida) ou nao (lista vazia).
 * 2. Origem real (D3), num update SEPARADO: juntar os dois impediria gravar
 *    os ids de quem ja tem origem (manual, por exemplo), o que sempre
 *    funcionou. So preenche origem vazia: canal, metodo e campanha nulos. O
 *    filtro de campanha e metodo deixa de fora o contato importado com
 *    campanha em texto (source_method importacao), que o CHECK de coerencia
 *    recusaria com 23514. Roda a cada anuncio, nao so no primeiro clique:
 *    se a gravacao falhar uma vez, o proximo anuncio do mesmo contato
 *    completa (sem origem, o anuncio e a melhor prova que existe).
 *    Por isso a origem NAO exige que os ids do contato sejam deste clique:
 *    canal, origem, meio, metodo e hora (as colunas imutaveis) saem todos do
 *    clique que provou o anuncio e sao verdade juntos. Os ids podem ser de
 *    outro clique quando o primeiro clique venceu antes (regra L8 da Fase 4),
 *    inclusive um id sem clique e sem tipo, que grava o id mas nao a origem
 *    e, por L8, segura os ids de um anuncio real que chegue depois: a origem
 *    vem do anuncio real e a campanha mostrada sai do primeiro id. Tratar
 *    esse id como post (nao gravar) muda a Fase 4 e espera decisao do dono.
 *    Os ids, ao contrario da origem, o sistema ainda pode regravar.
 * 3. No primeiro clique: log de diagnostico e, se veio id de anuncio, o
 *    pedido de resolucao da campanha na Meta.
 *
 * POST nao grava nada (nem ids, nem origem). Nao e anuncio pago, e o
 * ctwa_clid de um post gravado no contato faria o primeiro clique num
 * anuncio de verdade, depois, perder o "primeiro clique vence".
 */
async function capturarAnuncio(
  admin: SupabaseClient,
  captura: CapturaDeAnuncio,
): Promise<void> {
  const { anuncio, clinicId, contactId } = captura;
  const camposDoErro = {
    clinic_id: clinicId,
    whatsapp_account_id: captura.whatsappAccountId,
    contact_id: contactId,
  };

  if (anuncio.tipo === "post") {
    if (captura.mensagemNova) {
      registrarAnuncioRecebido(captura);
    }
    return;
  }

  const ids = idsDoAnuncio(anuncio);
  let primeiroClique = false;
  if (ids) {
    const { data, error } = await admin
      .from("contact")
      .update(ids)
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .is("ctwa_clid", null)
      // L8 (Fase 4): o referral sem clid nao pode deixar o anuncio de um
      // segundo clique trocar o primeiro. O casamento com o investimento e
      // pelo source_ad_id, e o primeiro anuncio vence.
      .is("source_ad_id", null)
      .select("id");
    if (error) {
      log.error("captura_ctwa_falhou", {
        ...camposDoErro,
        error_code: error.code ?? null,
      });
    } else {
      primeiroClique = Array.isArray(data) && data.length > 0;
    }
  }

  const origem = origemDoAnuncio(anuncio, new Date().toISOString());
  if (origem) {
    const { error } = await admin
      .from("contact")
      .update(origem)
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .is("source_channel", null)
      .is("source_method", null)
      .is("source_campaign", null);
    if (error) {
      log.error("origem_do_anuncio_falhou", {
        ...camposDoErro,
        error_code: error.code ?? null,
      });
    }
  }

  if (!primeiroClique) {
    return;
  }
  registrarAnuncioRecebido(captura);
  if (ids?.source_ad_id) {
    await pedirResolucaoDaCampanha(admin, clinicId);
  }
}

/**
 * Corrige a RESPOSTA AUTOMATICA do app WhatsApp Business (saudacao,
 * ausencia) que correu NA FRENTE desta ingestao.
 *
 * Ela sai do celular 1 ou 2 s depois da mensagem do paciente, e os dois
 * webhooks correm em paralelo. Quando o eco grava primeiro (a ingestao e
 * mais longa, ou pegou partida a frio a noite, justo quando a ausencia esta
 * ligada), registrar_mensagem_do_celular ainda nao ve a mensagem do paciente
 * e grava a ausencia como fala de PESSOA ('usuario'). Sem esta correcao, o
 * interceptador, que a rota chama logo depois da ingestao, leria a ausencia
 * como "a clinica falou depois do toque" e calaria a confirmacao: o
 * "Confirmar" tocado pelo paciente deixaria de confirmar a consulta sozinho.
 * A ausencia tambem contaria como primeira resposta da equipe.
 *
 * A RPC reclassificar_resposta_automatica troca para 'sistema' o eco de
 * pessoa da mesma conversa que chegou de 8 s antes a 2 s depois desta
 * mensagem e, quando os dois horarios de envio existem, saiu de 2 s antes a
 * 8 s depois dela (a fala da equipe enviada meia hora antes, que chega
 * colada na rajada de reconexao, continua de pessoa). A regra e o relogio
 * vivem no banco. Por isso roda logo depois da insercao, ANTES de a ingestao
 * devolver.
 *
 * Ela tambem grava o horario de envio desta mensagem (enviadaEm, do payload)
 * na linha (message.enviada_no_aparelho_em): e por ele que
 * registrar_mensagem_do_celular decide os ecos que chegarem DEPOIS. Sem
 * horario no payload vai null, e o banco fica com a regra da chegada.
 *
 * Melhor esforco: a mensagem ja esta salva. Erro ou excecao vira log so com
 * ids e codigo, nunca erro da ingestao (o 500 faria o provedor reenviar uma
 * mensagem ja gravada).
 */
async function reclassificarRespostaAutomatica(
  admin: SupabaseClient,
  alvo: {
    clinicId: string;
    whatsappAccountId: string | null;
    conversationId: string | null;
    messageId: string;
    /** Horario de envio do payload (ISO), ou null quando nao veio. */
    enviadaEm: string | null;
  },
): Promise<void> {
  const campos = {
    clinic_id: alvo.clinicId,
    whatsapp_account_id: alvo.whatsappAccountId,
    conversation_id: alvo.conversationId,
    message_id: alvo.messageId,
  };
  try {
    const { data, error } = await admin.rpc(
      "reclassificar_resposta_automatica",
      {
        p_clinic_id: alvo.clinicId,
        p_message_id: alvo.messageId,
        p_enviada_em: alvo.enviadaEm,
      },
    );
    if (error) {
      log.error("reclassificar_automatica_falhou", {
        ...campos,
        error_code: error.code ?? null,
      });
      return;
    }
    // Diagnostico da corrida: quantas vezes o eco corre na frente.
    if (typeof data === "number" && data > 0) {
      log.info("resposta_automatica_reclassificada", {
        ...campos,
        count: data,
      });
    }
  } catch {
    log.error("reclassificar_automatica_falhou", campos);
  }
}

/**
 * Grava a mensagem recebida pelo NUMERO `accountId` da clinica.
 *
 * O webhook sempre sabe o numero (resolvido pela URL). `accountId` nulo so
 * existe para teste e ferramenta de desenvolvimento sem numero: a RPC usa o
 * principal ativo da clinica (ou nenhum, em clinica sem numero), como antes
 * de existir mais de um numero.
 */
export async function ingerirMensagemRecebida(
  admin: SupabaseClient,
  clinicId: string,
  accountId: string | null,
  event: MensagemRecebida,
): Promise<{ data: IngestResultado | null; error: PostgrestError | null }> {
  const { data, error } = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_whatsapp_account_id: accountId,
    p_phone_e164: event.phone,
    p_name: event.name,
    p_wa_message_id: event.waMessageId,
    p_content_type: event.contentType,
    p_body: event.body,
    p_media_url: event.mediaUrl,
    p_transcript: null,
    // Nome e tipo do arquivo (migration 20260924100000). So vao quando
    // existem: assim o texto comum, que e quase tudo, continua casando com a
    // assinatura antiga da RPC se o codigo subir antes da migration.
    ...(event.mediaFilename ? { p_media_filename: event.mediaFilename } : {}),
    ...(event.mediaMimetype ? { p_media_mimetype: event.mediaMimetype } : {}),
  });
  if (error) {
    return { data: null, error };
  }

  const resultado = (data ?? null) as IngestResultado | null;

  // Numero proprio ou numero removido: nada foi gravado, entao nao ha
  // citacao, anuncio, jornada nem origem a mexer. Sai sem erro.
  if (resultado?.ignorada) {
    return { data: resultado, error: null };
  }

  // RESPOSTA AUTOMATICA que correu na frente: logo depois da insercao, para
  // terminar antes do interceptador que a rota chama em seguida. So na
  // primeira entrega: a reentrega (inserted=false) ja passou por aqui.
  if (resultado?.inserted && resultado.message_id) {
    await reclassificarRespostaAutomatica(admin, {
      clinicId,
      whatsappAccountId: resultado.whatsapp_account_id ?? accountId,
      conversationId: resultado.conversation_id,
      messageId: resultado.message_id,
      enviadaEm: event.enviadaEm ?? null,
    });
  }

  // CITACAO, num passo separado da ingestao de proposito.
  //
  // Resolver a citada dentro de ingest_inbound_message obrigaria a reescrever
  // aquela funcao, que e a mais delicada do sistema (cria contato, consentimento
  // e conversa numa transacao so). Aqui e um update depois, com a mensagem ja
  // salva: se falhar, a conversa perde a marca de "respondendo a", nao a
  // mensagem.
  if (event.quotedWaMessageId && resultado?.inserted && resultado.message_id) {
    const { error: erroCitacao } = await admin.rpc(
      "vincular_citacao_recebida",
      {
        p_clinic_id: clinicId,
        p_message_id: resultado.message_id,
        p_quoted_wa_id: event.quotedWaMessageId,
      },
    );
    if (erroCitacao) {
      log.error("citacao_recebida_falhou", {
        clinic_id: clinicId,
        whatsapp_account_id: resultado.whatsapp_account_id ?? accountId,
        message_id: resultado.message_id,
        error_code: erroCitacao.code ?? null,
      });
    }
  }

  // CAPTURA DO ANUNCIO: ids do clique e, desde 04/10/2026 (D3), a origem
  // real. Roda ANTES da atribuicao por texto, entao o anuncio vence o codigo
  // de campanha. Melhor esforco: a mensagem ja esta salva.
  if (event.anuncio && resultado?.contact_id) {
    try {
      await capturarAnuncio(admin, {
        clinicId,
        contactId: resultado.contact_id,
        whatsappAccountId: resultado.whatsapp_account_id ?? accountId,
        mensagemNova: resultado.inserted,
        anuncio: event.anuncio,
      });
    } catch {
      log.error("captura_ctwa_falhou", {
        clinic_id: clinicId,
        whatsapp_account_id: resultado.whatsapp_account_id ?? accountId,
        contact_id: resultado.contact_id,
      });
    }
  }

  // Termo-chave roda em TODA mensagem recebida com texto (diferente da
  // atribuicao, que e do nascimento): a jornada avanca ao longo da conversa.
  // So em mensagem que acabou de ser inserida: reentrega de webhook
  // (inserted=false) nao pode mover ninguem duas vezes. Quem escreveu e o
  // PACIENTE: so contam as etapas cujo termo e do paciente ou de qualquer um
  // (lib/integrations/whatsapp/termo-chave.ts).
  if (event.body && resultado?.inserted && resultado.contact_id) {
    try {
      await tentarMoverPorTermo(admin, {
        clinicId,
        contactId: resultado.contact_id,
        corpo: event.body,
        quemEscreveu: "paciente",
        userId: null,
      });
    } catch {
      log.error("termo_chave_falhou", {
        clinic_id: clinicId,
        contact_id: resultado.contact_id,
        kind: "paciente",
      });
    }
  }

  // Atribuicao roda no nascimento do contato (os 3 mecanismos e o clique do
  // site) OU quando uma mensagem posterior traz token (codigo fixo de
  // campanha ou codigo de clique do site, para contato pre-existente; o
  // update e guardado por source_channel is null e o casamento do clique e
  // idempotente, entao a reentrega e barata).
  const deveAtribuir =
    resultado?.contact_id &&
    event.body &&
    (resultado.contact_created || extrairToken(event.body) !== null);
  if (deveAtribuir && resultado?.contact_id && event.body) {
    try {
      await tentarAtribuirOrigem(
        admin,
        clinicId,
        resultado.contact_id,
        event.body,
        resultado.contact_created,
      );
    } catch {
      // Falha inesperada nao derruba a ingestao; a mensagem ja esta salva.
      log.error("atribuicao_origem_falhou", {
        clinic_id: clinicId,
        contact_id: resultado.contact_id,
      });
    }
  }

  return { data: resultado, error: null };
}

/**
 * Grava na conversa do NUMERO `accountId` a mensagem que a clinica enviou
 * pelo celular pareado (ou outro aparelho vinculado), fora do sistema.
 *
 * Tudo o que decide vive na RPC registrar_mensagem_do_celular, numa
 * transacao: idempotencia por wa_message_id, numero proprio, contato (nunca
 * criado nem atualizado), conversa aberta daquele numero, resposta
 * automatica do app Business (janela de 8 s) e a descida da espera. Custo
 * zero e nao cobravel (regra 3.3): a mensagem nao saiu pelo sistema.
 *
 * A citacao e resolvida DEPOIS, como na entrada (vincular_citacao_recebida):
 * se falhar, a bolha perde o "respondendo a", nao a mensagem.
 *
 * REGRA ABSOLUTA: o texto vai so para a RPC; log leva so ids e codigos.
 */
export async function registrarMensagemDoCelular(
  admin: SupabaseClient,
  clinicId: string,
  accountId: string,
  event: MensagemDoCelular,
): Promise<{ data: RegistroDoCelular | null; error: PostgrestError | null }> {
  const { data, error } = await admin.rpc("registrar_mensagem_do_celular", {
    p_clinic_id: clinicId,
    p_whatsapp_account_id: accountId,
    p_phone_e164: event.phone,
    p_wa_message_id: event.waMessageId,
    p_content_type: event.contentType,
    p_body: event.body,
    p_media_url: event.mediaUrl,
    p_media_filename: event.mediaFilename,
    p_media_mimetype: event.mediaMimetype,
    p_quoted_wa_message_id: event.quotedWaMessageId,
    p_enviada_em: event.enviadaEm,
  });
  if (error) {
    return { data: null, error };
  }

  const resultado = (data ?? null) as RegistroDoCelular | null;
  if (resultado?.ignorada) {
    return { data: resultado, error: null };
  }

  if (event.quotedWaMessageId && resultado?.inserted && resultado.message_id) {
    const { error: erroCitacao } = await admin.rpc(
      "vincular_citacao_recebida",
      {
        p_clinic_id: clinicId,
        p_message_id: resultado.message_id,
        p_quoted_wa_id: event.quotedWaMessageId,
      },
    );
    if (erroCitacao) {
      log.error("citacao_do_celular_falhou", {
        clinic_id: clinicId,
        whatsapp_account_id: resultado.whatsapp_account_id ?? accountId,
        message_id: resultado.message_id,
        error_code: erroCitacao.code ?? null,
      });
    }
  }

  return { data: resultado, error: null };
}
