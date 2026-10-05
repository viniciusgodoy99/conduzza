import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  ecoContaParaTermo,
  ecoEsperaPeloContatoNovo,
  parseInboundEvent,
  type InboundEvent,
  type TipoDeConteudo,
} from "@/lib/integrations/whatsapp/inbound";
import {
  ingerirMensagemRecebida,
  registrarMensagemDoCelular,
  type RegistroDoCelular,
} from "@/lib/integrations/whatsapp/ingest";
import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
import type {
  ConnectionStatus,
  OpcoesDeConsulta,
} from "@/lib/integrations/whatsapp/provider";
import {
  acharNumeroPeloSegredo,
  lerIdentificacaoDoWebhook,
  segredosIguais,
  type IdentificacaoDoWebhook,
} from "@/lib/integrations/whatsapp/segredo-do-webhook";
import { tentarMoverPorTermo } from "@/lib/integrations/whatsapp/termo-chave";
import { conferirConexaoDoWebhook } from "@/lib/integrations/whatsapp/trava-celular";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { esperar } from "@/lib/utils/esperar";

// Webhook de entrada do WhatsApp (tarefa 1.3). O uazapi nao assina as
// chamadas, entao a validacao e pelo webhook_secret NOSSO, por NUMERO, na
// URL configurada na conexao. Idempotencia e concorrencia vivem no banco
// (RPCs ingest_inbound_message e registrar_mensagem_do_celular + unique de
// wa_message_id).
//
// VARIOS NUMEROS POR CLINICA (docs/07, Fase 2): todo evento pertence a UM
// numero (whatsapp_account.id), e tudo o que ele toca e filtrado por esse
// numero: a conversa, o eco do celular, o recibo, o apagamento e o status.
// A URL nova diz o numero (?account=); a legada (so ?clinic=) acha o numero
// pelo segredo.
//
// REGRA ABSOLUTA: nenhum conteudo de mensagem de paciente em log. So ids.
//
// Quando houver SUPABASE_ACCESS_TOKEN e conta uazapi, este handler vira uma
// Edge Function fina reutilizando a MESMA RPC (ver supabase/functions/README).

export const runtime = "nodejs";
// Teto explicito, como no motor e na saude (achado T[1] da revisao da trava).
// O dia a dia leva milissegundos: so a trava consulta o provedor. O caminho
// mais longo e o pareamento com o servidor lento, em que cada consulta tem
// ate tres tentativas de 10 s. Se o teto cortar ali, o corte do nosso lado
// (segredo, trilha e status) ja aconteceu antes do desligamento, e a mensagem
// ainda nao gravada fica com erro, que o provedor tenta de novo (tentativas
// finitas, cerca de 3 pela especificacao).
export const maxDuration = 60;

/**
 * Consulta ao provedor na porta da ingestao FORA do pareamento (numero
 * "desconectado"). La a mensagem entra com ou sem decisao, entao esperar o
 * padrao (ate tres tentativas de 10 s, uns 32 s num servidor travado) so
 * atrasaria a mensagem e a resposta da IA. No pareamento e no evento de
 * conexao fica o padrao, que tolera um servidor lento: la a falta de decisao
 * vira 503, e desistir cedo seguraria a mensagem mais vezes.
 */
const CONSULTA_CURTA: OpcoesDeConsulta = { timeoutMs: 5_000, semRetry: true };

type NumeroDoWebhook = {
  accountId: string;
  clinicId: string;
  instanceToken: string | null;
  /**
   * Provedor e situacao gravados, lidos na mesma consulta da resolucao: a
   * porta da ingestao decide por eles sem ida a mais ao banco.
   */
  provider: string | null;
  connectionStatus: string | null;
};

type LinhaDaConta = {
  id: string;
  provider: string | null;
  connection_status: string | null;
};

const COLUNAS_DA_CONTA =
  "id, clinic_id, removido_em, provider, connection_status";

type Resolucao =
  | { estado: "ok"; numero: NumeroDoWebhook }
  | { estado: "recusado" }
  | { estado: "falha"; errorCode: string | null };

type LinhaDeSegredo = {
  account_id: string;
  clinic_id: string;
  webhook_secret: string;
  instance_token: string | null;
};

/**
 * Qual NUMERO da clinica esta chamando, conferido pelo segredo dele.
 *
 * Numero removido e recusado nos dois caminhos: a remocao gira o segredo, e
 * mesmo assim a linha removida nao entra na conta (defesa em profundidade).
 * Falha de leitura NAO vira 401: vira 500, para o provedor reenviar em vez de
 * a mensagem se perder por um soluco do banco.
 */
async function resolverNumero(
  admin: SupabaseClient,
  ident: IdentificacaoDoWebhook,
): Promise<Resolucao> {
  if (ident.tipo === "numero") {
    // Leitura por id do numero (a PK dos dois lados), nunca por clinica.
    const [segredoResult, contaResult] = await Promise.all([
      admin
        .from("whatsapp_account_secret")
        .select("account_id, clinic_id, webhook_secret, instance_token")
        .eq("account_id", ident.accountId)
        .maybeSingle(),
      admin
        .from("whatsapp_account")
        .select(COLUNAS_DA_CONTA)
        .eq("id", ident.accountId)
        .maybeSingle(),
    ]);
    if (segredoResult.error || contaResult.error) {
      return {
        estado: "falha",
        errorCode: segredoResult.error?.code ?? contaResult.error?.code ?? null,
      };
    }
    const segredo = segredoResult.data as LinhaDeSegredo | null;
    const conta = contaResult.data as
      (LinhaDaConta & { clinic_id: string; removido_em: string | null }) | null;
    if (!segredo || !conta) {
      return { estado: "recusado" };
    }
    // A comparacao roda antes de qualquer outra recusa: o tempo da resposta
    // nao separa "segredo errado" de "clinica errada" ou "removido".
    const confere = segredosIguais(segredo.webhook_secret, ident.segredo);
    if (
      !confere ||
      conta.clinic_id !== segredo.clinic_id ||
      (ident.clinicId !== null && ident.clinicId !== segredo.clinic_id) ||
      conta.removido_em !== null
    ) {
      return { estado: "recusado" };
    }
    return {
      estado: "ok",
      numero: {
        accountId: segredo.account_id,
        clinicId: segredo.clinic_id,
        instanceToken: segredo.instance_token,
        provider: conta.provider ?? null,
        connectionStatus: conta.connection_status ?? null,
      },
    };
  }

  // URL LEGADA (so ?clinic=): as instancias em producao usam esta hoje e ela
  // continua valendo. Le a LISTA de numeros ativos da clinica e os segredos
  // dela, e acha o numero cujo segredo bate.
  const [contasResult, segredosResult] = await Promise.all([
    admin
      .from("whatsapp_account")
      .select("id, provider, connection_status")
      .eq("clinic_id", ident.clinicId)
      .is("removido_em", null),
    admin
      .from("whatsapp_account_secret")
      .select("account_id, clinic_id, webhook_secret, instance_token")
      .eq("clinic_id", ident.clinicId),
  ]);
  if (contasResult.error || segredosResult.error) {
    return {
      estado: "falha",
      errorCode: contasResult.error?.code ?? segredosResult.error?.code ?? null,
    };
  }
  const ativos = new Map(
    ((contasResult.data ?? []) as LinhaDaConta[]).map(
      (conta) => [conta.id, conta] as const,
    ),
  );
  const candidatos = ((segredosResult.data ?? []) as LinhaDeSegredo[]).filter(
    (linha) => ativos.has(linha.account_id),
  );
  const achado = acharNumeroPeloSegredo(candidatos, ident.segredo);
  if (!achado) {
    return { estado: "recusado" };
  }
  const conta = ativos.get(achado.account_id);
  // Rastro para saber quando a ultima instancia migrou para a URL nova.
  log.info("webhook_url_legada", {
    clinic_id: achado.clinic_id,
    whatsapp_account_id: achado.account_id,
  });
  return {
    estado: "ok",
    numero: {
      accountId: achado.account_id,
      clinicId: achado.clinic_id,
      instanceToken: achado.instance_token,
      provider: conta?.provider ?? null,
      connectionStatus: conta?.connection_status ?? null,
    },
  };
}

/**
 * Grava a situacao de conexao do numero (evento de conexao, ou a conexao
 * confirmada pela porta da ingestao).
 *
 * So escreve quando o status MUDOU: o provedor reenvia o mesmo evento de
 * conexao varias vezes, e cada escrita gera evento de Realtime e linha morta
 * a toa. O filtro .neq faz o update afetar zero linhas no repeteco.
 *
 * Pelo id DO NUMERO: com varios numeros, a conexao de um nao mexe no status
 * dos outros. Numero removido fica como a remocao o deixou.
 *
 * "conectando" so substitui "aguardando_qr" (achado T[0] da revisao da
 * trava): e o QR lido, dentro de um pareamento aberto pelo Conectar. A porta
 * da ingestao segura a mensagem de numero "conectando" ate a trava decidir, e
 * a sessao JA pareada que reconecta sozinha nao pode cair nessa espera. O
 * filtro vive no update, e nao so na rota: um "connecting" atrasado, que
 * chega depois do "connected", tambem nao rebaixa o numero.
 */
async function gravarStatusDoNumero(
  admin: SupabaseClient,
  numero: { clinicId: string; accountId: string },
  status: ConnectionStatus,
  telefoneConferido: string | null,
): Promise<void> {
  const { clinicId, accountId } = numero;
  const atualizacao = admin
    .from("whatsapp_account")
    .update({
      connection_status: status,
      // O telefone que a trava conferiu: sem ele, este numero ficaria
      // invisivel para a trava dos pareamentos seguintes.
      ...(telefoneConferido ? { display_phone: telefoneConferido } : {}),
      ...(status === "conectado"
        ? { connected_at: new Date().toISOString() }
        : {}),
      ...(status === "desconectado"
        ? { disconnected_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", accountId)
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .neq("connection_status", status);
  const { data: mudou } = await (
    status === "conectando"
      ? atualizacao.eq("connection_status", "aguardando_qr")
      : atualizacao
  ).select("id");

  if (mudou && mudou.length > 0) {
    // Desconexao e o proxy de qualidade neste canal (CLAUDE.md 3.3): o alerta
    // operacional nasce desta linha estruturada. Nenhum dado de paciente.
    if (status === "desconectado") {
      log.warn("whatsapp_desconectou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        connection_status: status,
      });
    } else {
      log.info("whatsapp_conexao_mudou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        connection_status: status,
      });
    }
  }
}

/**
 * A PORTA DA INGESTAO respeita a trava do mesmo celular (achado M[5] da
 * revisao das Fases 3 e 4). Antes a mensagem entrava sem olhar a conexao:
 * enquanto a trava nao decidia (a janela entre ler o QR e o corte, e sem
 * prazo quando ela nao conseguia confirmar), a instancia pareada com o
 * celular de OUTRA clinica gravava aqui as mensagens dos pacientes de la.
 *
 * Numero conectado no banco (o caso de todo dia) e o simulador passam direto,
 * sem consulta nenhuma. Nos outros, a mensagem so entra depois da MESMA
 * conferencia do evento de conexao, que roda de novo a cada mensagem:
 *   - confirmada: grava "conectado" (a reconexao que o evento nao conseguiu
 *     confirmar se resolve na primeira mensagem) e a mensagem entra;
 *   - recusada: a trava ja cortou o numero; a mensagem nao e gravada (e de
 *     um celular que nao e desta clinica) e o 200 evita reenvio;
 *   - sem decisao, com o numero em PAREAMENTO (aguardando_qr ou conectando):
 *     503, e o provedor reenvia depois, quando a trava ja decidiu;
 *   - sem decisao, com o numero "desconectado": entra, como antes. So a
 *     sessao ja pareada volta sozinha (celular novo passa pelo QR, e o QR
 *     grava aguardando_qr), e barrar aqui perderia mensagem de paciente numa
 *     queda do provedor.
 *
 * "conectando" e SEMPRE pareamento de verdade (achado T[0] da revisao da
 * trava): so o Conectar o grava direto, e o evento de conexao e as consultas
 * da tela so o gravam em cima de "aguardando_qr". A sessao ja pareada que
 * reconecta sozinha continua "conectado" (passa direto) ou "desconectado"
 * (entra sem decisao), nunca cai no 503.
 *
 * Fora do pareamento a consulta ao provedor e curta (CONSULTA_CURTA): a
 * mensagem entra de qualquer jeito, e o padrao so a atrasaria (achado T[1]).
 *
 * Devolve a resposta quando a mensagem NAO deve ser ingerida agora.
 */
async function barrarAntesDaTrava(
  admin: SupabaseClient,
  numero: NumeroDoWebhook,
  waMessageId: string,
): Promise<NextResponse | null> {
  if (numero.connectionStatus === "conectado" || numero.provider === "fake") {
    return null;
  }
  const campos = {
    clinic_id: numero.clinicId,
    whatsapp_account_id: numero.accountId,
    wa_message_id: waMessageId,
  };
  const emPareamento =
    numero.connectionStatus === "aguardando_qr" ||
    numero.connectionStatus === "conectando";
  const conferida = await conferirConexaoDoWebhook(
    admin,
    { clinicId: numero.clinicId, accountId: numero.accountId },
    numero.instanceToken,
    emPareamento ? undefined : CONSULTA_CURTA,
  );
  if (conferida.resultado === "confirmada") {
    await gravarStatusDoNumero(
      admin,
      numero,
      "conectado",
      conferida.displayPhone,
    );
    return null;
  }
  if (conferida.resultado === "recusada") {
    log.info("webhook_mensagem_ignorada", {
      ...campos,
      status: "celular_recusado",
    });
    return NextResponse.json({ ignorada: "celular_recusado" });
  }
  if (!emPareamento) {
    return null;
  }
  log.warn("webhook_mensagem_adiada", {
    ...campos,
    connection_status: numero.connectionStatus,
    status: conferida.resultado,
  });
  return NextResponse.json(
    { error: "conexao_sem_confirmacao" },
    { status: 503 },
  );
}

/**
 * A mensagem gravada tem arquivo a baixar? Toda imagem, documento e audio,
 * com ou sem URL: o worker baixa pelo wa_message_id (POST /message/download),
 * nao pela URL. Antes a trava era a URL, e foto que chegava sem ela nunca
 * entrava na fila: a bolha dizia "Baixando o arquivo" para sempre. Com URL
 * vale tambem para o que o parser chama de texto (video).
 */
function temArquivoParaBaixar(
  contentType: TipoDeConteudo,
  mediaUrl: string | null,
): boolean {
  return (
    contentType === "imagem" ||
    contentType === "documento" ||
    contentType === "audio" ||
    Boolean(mediaUrl)
  );
}

/**
 * Enfileira o download do arquivo de uma mensagem recem-gravada (recebida do
 * paciente ou enviada pelo celular da clinica: o mesmo job serve as duas).
 *
 * Midia NUNCA e baixada aqui: a URL do provedor e criptografada e o
 * download demora segundos, o que estouraria o timeout do webhook e
 * provocaria reenvio. Vira job; o worker baixa e guarda no Storage.
 *
 * O job leva o NUMERO da mensagem (na coluna e no payload): o arquivo so
 * baixa pela instancia daquele numero. Falha ao enfileirar nao derruba o
 * 200: a mensagem ja esta salva, so o arquivo fica pendente.
 */
async function enfileirarDownloadDaMidia(
  admin: SupabaseClient,
  alvo: {
    clinicId: string;
    accountId: string;
    messageId: string;
    waMessageId: string;
  },
): Promise<void> {
  const { error } = await admin.from("job_queue").insert({
    clinic_id: alvo.clinicId,
    kind: "baixar_midia",
    whatsapp_account_id: alvo.accountId,
    payload: {
      message_id: alvo.messageId,
      wa_message_id: alvo.waMessageId,
      whatsapp_account_id: alvo.accountId,
    },
  });
  if (error) {
    log.error("webhook_enfileirar_midia_falhou", {
      clinic_id: alvo.clinicId,
      whatsapp_account_id: alvo.accountId,
      message_id: alvo.messageId,
      error_code: error.code ?? null,
    });
  }
}

type MensagemDoCelular = Extract<InboundEvent, { kind: "clinic_device_reply" }>;

/**
 * SAUDACAO PARA PACIENTE NOVO. O app WhatsApp Business manda a saudacao
 * justamente quando o contato e novo: o paciente escreve pela primeira vez e
 * o celular responde sozinho 1 ou 2 s depois. Os dois webhooks correm em
 * paralelo, e o eco da saudacao pode chegar antes de a ingestao da mensagem
 * do paciente criar o contato. A RPC nunca cria contato por mensagem de
 * saida (nasceria lead sem consentimento e sem origem), entao devolve
 * contato_desconhecido, e a saudacao, que o paciente leu, sumiria da
 * conversa. Por isso o eco RECENTE de contato desconhecido espera um pouco
 * pela ingestao e tenta de novo: ate 2 vezes, 1,5 s cada (3 s no pior caso,
 * folgado no teto de 60 s da rota).
 *
 * Sem horario no payload ou com eco velho (ecoEsperaPeloContatoNovo) nao ha
 * nova tentativa: a mensagem para quem nao e paciente (fornecedor, colega)
 * tambem cai em contato_desconhecido e nao deve atrasar, e o eco velho
 * (reentrega, sincronia de historico) nao vai ganhar contato em 3 s.
 */
const ESPERA_PELO_CONTATO_NOVO_MS = 1_500;
const NOVAS_TENTATIVAS_PELO_CONTATO_NOVO = 2;

/**
 * Grava o eco do celular (registrarMensagemDoCelular) e, na saudacao para
 * paciente novo, faz as novas tentativas descritas acima. Erro em qualquer
 * chamada volta como erro (a rota responde 500 e o provedor reenvia; a RPC e
 * idempotente).
 */
async function registrarEsperandoContatoNovo(
  admin: SupabaseClient,
  clinicId: string,
  accountId: string,
  event: MensagemDoCelular,
): ReturnType<typeof registrarMensagemDoCelular> {
  let registro = await registrarMensagemDoCelular(
    admin,
    clinicId,
    accountId,
    event,
  );
  if (
    registro.error ||
    registro.data?.ignorada !== "contato_desconhecido" ||
    !ecoEsperaPeloContatoNovo(event.enviadaEm, Date.now())
  ) {
    return registro;
  }
  let tentativas = 0;
  while (
    tentativas < NOVAS_TENTATIVAS_PELO_CONTATO_NOVO &&
    !registro.error &&
    registro.data?.ignorada === "contato_desconhecido"
  ) {
    await esperar(ESPERA_PELO_CONTATO_NOVO_MS);
    tentativas += 1;
    registro = await registrarMensagemDoCelular(
      admin,
      clinicId,
      accountId,
      event,
    );
  }
  // Diagnostico da corrida, so ids: quantas vezes a saudacao chega antes do
  // contato e se a espera basta. O erro tem o log proprio na rota.
  if (!registro.error) {
    log.info("webhook_eco_esperou_contato_novo", {
      clinic_id: clinicId,
      whatsapp_account_id: accountId,
      wa_message_id: event.waMessageId,
      attempt: tentativas,
      status: registro.data?.ignorada ?? "contato_achado",
    });
  }
  return registro;
}

/**
 * Ignoradas em que o eco NAO vira linha porque o wa_message_id e de outra
 * clinica (destino que e numero de outra clinica da plataforma, ou colisao
 * do id), mas que continuam sendo a equipe respondendo pelo celular. A RPC
 * ja derrubou a espera da conversa aberta daquele numero e devolve o
 * contact_id quando o contato existe: o termo-chave roda como rodava antes
 * de a mensagem do celular virar linha. Nas outras ignoradas nao ha contato
 * (contato_desconhecido) ou nao e conversa com paciente (numero proprio,
 * numero removido).
 */
const IGNORADAS_QUE_SEGUEM_PARA_O_TERMO: ReadonlySet<
  NonNullable<RegistroDoCelular["ignorada"]>
> = new Set(["numero_da_plataforma", "colisao_wa_message_id"]);

/**
 * TERMO-CHAVE escrito pela CLINICA no celular conectado (pedido do dono em
 * 02/10/2026): anda o lead quando a etapa aceita termo da clinica. A
 * resposta automatica do app Business tambem sai do celular e conta como
 * texto da clinica. O contato e o que a RPC achou (pela chave do telefone, a
 * mesma da ingestao). Melhor esforco: o 200 nunca depende disto.
 *
 * NUNCA REENTREGA (regra 3.3): a garantia continua sendo a marca por
 * wa_message_id no banco (marcar_eco_para_termo, tabela termo_eco_visto),
 * como antes de a mensagem virar linha: so move quando a marca nasceu agora;
 * a reentrega do mesmo evento volta false, mesmo que alguem tenha voltado o
 * lead a mao no meio tempo. A janela (ecoContaParaTermo) fica como defesa
 * extra e poupa a ida ao banco no eco velho ou da sincronia de historico.
 * Falha ao marcar nao move (sem a marca nao da para provar que e o
 * primeiro).
 */
async function moverPorTermoDoCelular(
  admin: SupabaseClient,
  alvo: { clinicId: string; accountId: string; contactId: string },
  event: MensagemDoCelular,
): Promise<void> {
  const { clinicId, accountId, contactId } = alvo;
  if (!event.body || !ecoContaParaTermo(event.enviadaEm, Date.now())) {
    return;
  }
  try {
    const { data: ecoNovo, error: erroMarca } = await admin.rpc(
      "marcar_eco_para_termo",
      {
        p_clinic_id: clinicId,
        p_wa_message_id: event.waMessageId,
      },
    );
    if (erroMarca) {
      log.error("termo_chave_marcar_eco_falhou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        contact_id: contactId,
        kind: "clinica",
        error_code: erroMarca.code ?? null,
      });
    } else if (ecoNovo === true) {
      await tentarMoverPorTermo(admin, {
        clinicId,
        contactId,
        corpo: event.body,
        quemEscreveu: "clinica",
        userId: null,
      });
    }
  } catch {
    log.error("termo_chave_falhou", {
      clinic_id: clinicId,
      whatsapp_account_id: accountId,
      contact_id: contactId,
      kind: "clinica",
    });
  }
}

export async function POST(request: NextRequest) {
  const ident = lerIdentificacaoDoWebhook(request.nextUrl.searchParams);
  if (!ident) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const resolucao = await resolverNumero(admin, ident);
  if (resolucao.estado === "falha") {
    log.error("webhook_resolver_numero_falhou", {
      error_code: resolucao.errorCode,
    });
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
  if (resolucao.estado === "recusado") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { accountId, clinicId, instanceToken } = resolucao.numero;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = parseInboundEvent(payload);
  if (!event) {
    // Evento que nao interessa (ou formato desconhecido): 200 para o
    // provedor nao reenviar em loop.
    return NextResponse.json({ ignored: true });
  }

  // Segunda camada de autenticacao: o uazapi nao assina a chamada, mas todo
  // evento carrega o token da instancia.
  //
  // A conferencia NAO pode ser opcional: antes ela so rodava se o evento
  // trouxesse o campo, entao bastava omitir `token` do corpo para pular a
  // camada inteira. Agora, se a clinica tem token guardado, o evento e
  // obrigado a trazer o token certo.
  //
  // O token conferido e o DAQUELE numero: o evento da instancia do numero A
  // nao passa pela URL do numero B.
  if (instanceToken) {
    if (
      !event.instanceToken ||
      !segredosIguais(instanceToken, event.instanceToken)
    ) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (event.kind === "message_received") {
    const barrada = await barrarAntesDaTrava(
      admin,
      resolucao.numero,
      event.waMessageId,
    );
    if (barrada) {
      return barrada;
    }
    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      accountId,
      event,
    );
    if (error) {
      // So ids e codigo de erro: nenhum conteudo de mensagem sai daqui.
      log.error("webhook_ingestao_falhou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        wa_message_id: event.waMessageId,
        error_code: error.code ?? null,
      });
      return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
    }

    // Numero proprio (outro numero ativo da clinica escrevendo para este) ou
    // numero removido no meio do caminho: nada foi gravado, e isso nao e
    // erro. 200 para o provedor nao reenviar; sem midia e sem interceptar.
    if (data?.ignorada) {
      log.info("webhook_mensagem_ignorada", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        wa_message_id: event.waMessageId,
        status: data.ignorada,
      });
      return NextResponse.json(data);
    }

    // Arquivo vira job (enfileirarDownloadDaMidia), so na primeira entrega:
    // a reentrega (inserted=false) ja tem o job dela.
    if (
      temArquivoParaBaixar(event.contentType, event.mediaUrl) &&
      data?.inserted &&
      data.message_id
    ) {
      await enfileirarDownloadDaMidia(admin, {
        clinicId,
        accountId,
        messageId: data.message_id,
        waMessageId: event.waMessageId,
      });
    }
    // Resposta ao toque de confirmacao (tarefa 4.7): "1", "Confirmar" ou um
    // joinha mudam o status da agenda sozinhos. A resposta automatica do app
    // Business que gravou antes desta mensagem ja foi corrigida dentro de
    // ingerirMensagemRecebida, entao nao conta como fala da clinica aqui.
    // Guardado por data.inserted
    // porque o provedor reentrega o mesmo evento, e reentrega nao pode
    // confirmar duas vezes. Nunca derruba o 200: a mensagem ja esta salva e
    // um erro aqui viraria reenvio em loop.
    if (data?.inserted && data.contact_id && data.conversation_id) {
      try {
        await interceptarRespostaDePaciente(admin, {
          clinicId,
          contactId: data.contact_id,
          conversationId: data.conversation_id,
          body: event.body,
          contentType: event.contentType,
          // A citacao decide a que pergunta a resposta se refere (o botao
          // tocado cita o menu do toque daquela consulta).
          quotedWaMessageId: event.quotedWaMessageId,
          // O numero que recebeu delimita o contexto (D2) e e por ele que o
          // eco sai (D4). Sem ele o interceptador usaria o da conversa.
          whatsappAccountId: accountId,
        });
      } catch {
        log.error("webhook_interceptar_resposta_falhou", {
          clinic_id: clinicId,
          whatsapp_account_id: accountId,
          wa_message_id: event.waMessageId,
        });
      }
    }
    return NextResponse.json(data);
  }

  // A clinica enviou pelo celular pareado (ou outro aparelho vinculado), por
  // fora do sistema. A mensagem VIRA LINHA na conversa daquele numero
  // (pelo_celular): a clinica ve no Inbox o que o paciente leu, e a conversa
  // sai do contador de espera (senao outra atendente ve a pergunta como "sem
  // resposta" e responde de novo, e o paciente recebe duas respostas).
  //
  // Tudo o que decide vive na RPC registrar_mensagem_do_celular, numa
  // transacao: a idempotencia, o contato (so o que ja existe), a conversa do
  // numero e a RESPOSTA AUTOMATICA do app WhatsApp Business (saudacao,
  // ausencia), que sai do celular poucos segundos depois da mensagem do
  // paciente e nao e ninguem atendendo: ela grava como 'sistema' e nao
  // derruba a espera (derrubar fazia toda conversa da noite sumir de
  // "Aguardando voce" na manha seguinte).
  if (event.kind === "clinic_device_reply") {
    // A mesma porta da mensagem recebida: agora o conteudo e gravado, e a
    // instancia pareada com o celular de outra clinica gravaria aqui as
    // conversas de la.
    const barrada = await barrarAntesDaTrava(
      admin,
      resolucao.numero,
      event.waMessageId,
    );
    if (barrada) {
      return barrada;
    }
    // A saudacao para paciente novo pode chegar antes de o contato existir:
    // registrarEsperandoContatoNovo tenta de novo (ver la).
    const { data, error } = await registrarEsperandoContatoNovo(
      admin,
      clinicId,
      accountId,
      event,
    );
    if (error) {
      // So ids e codigo de erro: nenhum conteudo de mensagem sai daqui. O 500
      // faz o provedor reenviar; a RPC e idempotente.
      log.error("webhook_mensagem_do_celular_falhou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        wa_message_id: event.waMessageId,
        error_code: error.code ?? null,
      });
      return NextResponse.json({ error: "registro_falhou" }, { status: 500 });
    }

    const contactId = data?.contact_id ?? null;

    // Contato que nao esta no sistema, numero proprio, numero de outra
    // clinica da plataforma, numero removido ou id de outra clinica: nada foi
    // gravado, e isso nao e erro. 200 para o provedor nao reenviar. Sem midia
    // (nao ha linha) e sem marcador. Numero da plataforma e colisao com o
    // contato achado ainda passam pelo termo-chave
    // (IGNORADAS_QUE_SEGUEM_PARA_O_TERMO).
    if (data?.ignorada) {
      log.info("webhook_mensagem_ignorada", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        wa_message_id: event.waMessageId,
        status: data.ignorada,
        kind: "celular",
      });
      if (contactId && IGNORADAS_QUE_SEGUEM_PARA_O_TERMO.has(data.ignorada)) {
        await moverPorTermoDoCelular(
          admin,
          { clinicId, accountId, contactId },
          event,
        );
      }
      return NextResponse.json(data);
    }

    if (
      temArquivoParaBaixar(event.contentType, event.mediaUrl) &&
      data?.inserted &&
      data.message_id
    ) {
      await enfileirarDownloadDaMidia(admin, {
        clinicId,
        accountId,
        messageId: data.message_id,
        waMessageId: event.waMessageId,
      });
    }

    // Depuracao: se o payload trouxer alguma chave que pareca marcar envio
    // automatico, registra SO o caminho da chave (nunca texto), ao lado do
    // que a regra do tempo decidiu, para saber depois se da para filtrar
    // pela chave em vez de pelo tempo.
    if (event.marcadoresDeEnvioAutomatico.length > 0) {
      log.info("whatsapp_eco_do_celular_com_marcador", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        wa_message_id: event.waMessageId,
        message_id: data?.message_id ?? null,
        path: event.marcadoresDeEnvioAutomatico.join(","),
        count: event.marcadoresDeEnvioAutomatico.length,
        kind:
          data?.automatica === true
            ? "automatica"
            : data?.automatica === false
              ? "pessoa"
              : null,
      });
    }

    // Termo-chave da clinica, com o contato que a RPC achou
    // (moverPorTermoDoCelular). Melhor esforco: o 200 nunca depende disto.
    if (contactId) {
      await moverPorTermoDoCelular(
        admin,
        { clinicId, accountId, contactId },
        event,
      );
    }
    return NextResponse.json(data ?? { ok: true });
  }

  // Uma mensagem foi apagada para todos no WhatsApp. A conversa da clinica
  // precisa acompanhar: continuar exibindo o texto faria a recepcao responder a
  // algo que, para quem escreveu, ja nao existe.
  //
  // Este evento chega para TODO MUNDO, inclusive quando fomos nos que apagamos.
  // Quem apagou e deduzido no banco a partir da direcao da mensagem, porque o
  // provedor nao diz: ninguem revoga para todos a mensagem de outra pessoa.
  //
  // Filtrado pelo NUMERO: o mesmo wa_message_id pode existir no numero que
  // enviou e no que recebeu (numero A escrevendo para o numero B).
  if (event.kind === "message_deleted") {
    let houveFalha = false;
    for (const waMessageId of event.waMessageIds) {
      const { data: apagada, error } = await admin.rpc(
        "registrar_apagamento_do_whatsapp",
        {
          p_clinic_id: clinicId,
          p_wa_message_id: waMessageId,
          p_whatsapp_account_id: accountId,
        },
      );
      if (error) {
        log.error("webhook_apagamento_falhou", {
          clinic_id: clinicId,
          whatsapp_account_id: accountId,
          wa_message_id: waMessageId,
          error_code: error.code ?? null,
        });
        houveFalha = true;
        continue;
      }
      // O arquivo sai do acervo junto. A policy de leitura ja o bloqueia
      // (ela exige deleted_at nulo), entao guardar os bytes seria manter foto
      // de paciente que ninguem mais consegue abrir nem auditar.
      const caminho = (apagada as { media_url?: string | null } | null)
        ?.media_url;
      const prefixo = "storage://midia-conversas/";
      if (caminho?.startsWith(prefixo)) {
        await admin.storage
          .from("midia-conversas")
          .remove([caminho.slice(prefixo.length)]);
      }
    }
    // 500 PROPOSITAL quando a RPC falhou. Este e o unico momento em que
    // ficamos sabendo que a mensagem sumiu do celular do paciente: nada mais no
    // sistema volta a conferir. Responder 200 aqui deixaria o texto revogado
    // visivel na conversa da clinica para sempre. O reenvio do provedor e
    // seguro porque a funcao pula linha ja apagada.
    if (houveFalha) {
      return NextResponse.json({ error: "apagamento_falhou" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (event.kind === "message_status") {
    // O recibo do uazapi traz uma LISTA de ids por evento. So as mensagens
    // DESTE numero: o recibo da instancia A nunca marca a linha do numero B
    // que tem o mesmo wa_message_id (numero A escrevendo para o numero B).
    await admin
      .from("message")
      .update({
        delivery_status: event.status,
        ...(event.errorCode ? { error_code: event.errorCode } : {}),
      })
      .eq("clinic_id", clinicId)
      .eq("whatsapp_account_id", accountId)
      .in("wa_message_id", event.waMessageIds);
    return NextResponse.json({ ok: true });
  }

  // "Conectado" passa pela trava do MESMO celular em duas instancias, a
  // mesma das acoes da tela (lib/integrations/whatsapp/trava-celular.ts).
  // Antes este evento gravava "conectado" direto: pulava a trava e ainda a
  // desarmava na consulta seguinte da tela, que ja achava o numero conectado.
  //
  // Recusado ou encerrado (nada a confirmar), nada e gravado e o 200 evita
  // reenvio em laco. SEM CONFIRMACAO (provedor ou banco falhou, telefone
  // desconhecido, instancia ainda conectando) responde 503, como o
  // apagamento: antes era 200 e ninguem conferia de novo, e uma reconexao
  // sozinha de madrugada ficava "desconectado" com a instancia viva ate
  // alguem clicar em "Verificar conexao" (achado M[5] da revisao das Fases 3
  // e 4). O reenvio confere de novo; a primeira mensagem recebida tambem
  // (barrarAntesDaTrava).
  //
  // "Conectando" FORA de um pareamento aberto pelo QR (numero "conectado" ou
  // "desconectado") nao muda nada (achado T[0] da revisao da trava): e a
  // sessao ja pareada reconectando. Gravar "conectando" ali fazia a porta da
  // ingestao tratar o numero como pareamento, e com o provedor sem responder
  // a mensagem do paciente levava 503 ate o provedor desistir de reenviar.
  // "Conectado" fica "conectado": a mensagem continua entrando direto, a faixa
  // e o compositor nao acusam queda por uma reconexao de segundos, e se ela
  // falhar o evento "disconnected" grava a queda. O registro existe para
  // saber se o uazapi manda mesmo este evento fora do QR.
  const situacaoGravada = resolucao.numero.connectionStatus;
  if (
    event.status === "conectando" &&
    situacaoGravada !== "aguardando_qr" &&
    situacaoGravada !== "conectando"
  ) {
    log.info("whatsapp_conectando_fora_do_pareamento", {
      clinic_id: clinicId,
      whatsapp_account_id: accountId,
      connection_status: situacaoGravada,
    });
    return NextResponse.json({ ok: true, gravado: false });
  }

  let telefoneConferido: string | null = null;
  if (event.status === "conectado") {
    const conferida = await conferirConexaoDoWebhook(
      admin,
      { clinicId, accountId },
      instanceToken,
    );
    if (conferida.resultado === "sem_confirmacao") {
      return NextResponse.json(
        { error: "conexao_sem_confirmacao" },
        { status: 503 },
      );
    }
    if (conferida.resultado !== "confirmada") {
      return NextResponse.json({ ok: true, gravado: false });
    }
    telefoneConferido = conferida.displayPhone;
  }

  await gravarStatusDoNumero(
    admin,
    { clinicId, accountId },
    event.status,
    telefoneConferido,
  );
  return NextResponse.json({ ok: true });
}
