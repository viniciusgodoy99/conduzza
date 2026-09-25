import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { chaveDeTelefone } from "@/lib/domain/telefone";
import {
  limiteParaRespostaDePessoa,
  parseInboundEvent,
} from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
import {
  acharNumeroPeloSegredo,
  lerIdentificacaoDoWebhook,
  segredosIguais,
  type IdentificacaoDoWebhook,
} from "@/lib/integrations/whatsapp/segredo-do-webhook";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Webhook de entrada do WhatsApp (tarefa 1.3). O uazapi nao assina as
// chamadas, entao a validacao e pelo webhook_secret NOSSO, por NUMERO, na
// URL configurada na conexao. Idempotencia e concorrencia vivem no banco
// (RPC ingest_inbound_message + unique de wa_message_id).
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

type NumeroDoWebhook = {
  accountId: string;
  clinicId: string;
  instanceToken: string | null;
};

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
        .select("id, clinic_id, removido_em")
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
    const conta = contaResult.data as {
      id: string;
      clinic_id: string;
      removido_em: string | null;
    } | null;
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
      },
    };
  }

  // URL LEGADA (so ?clinic=): as instancias em producao usam esta hoje e ela
  // continua valendo. Le a LISTA de numeros ativos da clinica e os segredos
  // dela, e acha o numero cujo segredo bate.
  const [contasResult, segredosResult] = await Promise.all([
    admin
      .from("whatsapp_account")
      .select("id")
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
  const ativos = new Set(
    ((contasResult.data ?? []) as { id: string }[]).map((conta) => conta.id),
  );
  const candidatos = ((segredosResult.data ?? []) as LinhaDeSegredo[]).filter(
    (linha) => ativos.has(linha.account_id),
  );
  const achado = acharNumeroPeloSegredo(candidatos, ident.segredo);
  if (!achado) {
    return { estado: "recusado" };
  }
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
    },
  };
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

    // Midia NUNCA e baixada aqui: a URL do provedor e criptografada e o
    // download demora segundos, o que estouraria o timeout do webhook e
    // provocaria reenvio. Vira job; o worker baixa e guarda no Storage.
    //
    // O job nasce para TODA imagem, documento e audio, com ou sem URL: o
    // worker baixa pelo wa_message_id (POST /message/download), nao pela URL.
    // Antes a trava era a URL, e foto que chegava sem ela nunca entrava na
    // fila: a bolha dizia "Baixando o arquivo" para sempre. Com URL vale
    // tambem para o que o parser chama de texto (video).
    //
    // O job leva o NUMERO que recebeu (na coluna e no payload): o arquivo so
    // baixa pela instancia que recebeu a mensagem.
    const ehMidia =
      event.contentType === "imagem" ||
      event.contentType === "documento" ||
      event.contentType === "audio";
    if ((ehMidia || event.mediaUrl) && data?.inserted && data.message_id) {
      const { error: erroJob } = await admin.from("job_queue").insert({
        clinic_id: clinicId,
        kind: "baixar_midia",
        whatsapp_account_id: accountId,
        payload: {
          message_id: data.message_id,
          wa_message_id: event.waMessageId,
          whatsapp_account_id: accountId,
        },
      });
      if (erroJob) {
        // A mensagem ja esta salva; so o arquivo fica pendente. Log e segue.
        log.error("webhook_enfileirar_midia_falhou", {
          clinic_id: clinicId,
          whatsapp_account_id: accountId,
          message_id: data.message_id,
          error_code: erroJob.code ?? null,
        });
      }
    }
    // Resposta ao toque de confirmacao (tarefa 4.7): "1", "Confirmar" ou um
    // joinha mudam o status da agenda sozinhos. Guardado por data.inserted
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

  // A clinica respondeu pelo celular pareado, por fora do sistema. Nao vira
  // mensagem na conversa (nao temos o corpo de forma confiavel e ele nao passou
  // por aqui), mas a conversa PRECISA sair do contador de espera: senao outra
  // atendente ve a pergunta como "sem resposta" e responde de novo, e o
  // paciente recebe duas respostas para a mesma coisa.
  //
  // RESPOSTA AUTOMATICA do app WhatsApp Business (saudacao, ausencia) tambem
  // sai do celular pareado e chega aqui igual. Ela NAO e ninguem atendendo:
  // derrubar a espera por ela fazia toda conversa da noite sumir de
  // "Aguardando voce" na manha seguinte. Reconhecida pelo tempo: sai poucos
  // segundos depois da mensagem do paciente (limiteParaRespostaDePessoa).
  if (event.kind === "clinic_device_reply") {
    // Depuracao: se o payload trouxer alguma chave que pareca marcar envio
    // automatico, registra SO o caminho da chave (nunca texto), para decidir
    // depois se da para filtrar por ela em vez de pelo tempo.
    if (event.marcadoresDeEnvioAutomatico.length > 0) {
      log.info("whatsapp_eco_do_celular_com_marcador", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        wa_message_id: event.waMessageId,
        path: event.marcadoresDeEnvioAutomatico.join(","),
        count: event.marcadoresDeEnvioAutomatico.length,
      });
    }
    // Pela CHAVE do telefone: o chatid vem na forma do WhatsApp, que pode
    // nao ter o nono digito que o cadastro tem.
    const { data: contato } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone_key", chaveDeTelefone(event.phone))
      .maybeSingle();
    if (contato) {
      const limite = limiteParaRespostaDePessoa(event.enviadaEm, Date.now());
      // So as conversas DESTE numero: a resposta dada pelo celular do numero
      // A nao responde a pergunta que o paciente fez no numero B (uma
      // conversa por numero, decisao 1 do dono).
      await admin
        .from("conversation")
        .update({ awaiting_reply: false })
        .eq("clinic_id", clinicId)
        .eq("whatsapp_account_id", accountId)
        .eq("contact_id", contato.id)
        .neq("status", "resolvida")
        // So derruba se a ultima mensagem do paciente chegou ANTES da
        // janela: eco colado nela e a resposta automatica do app Business.
        .or(`last_inbound_at.is.null,last_inbound_at.lt."${limite}"`);
    }
    return NextResponse.json({ ok: true });
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

  // So escreve quando o status MUDOU: o provedor reenvia o mesmo evento de
  // conexao varias vezes, e cada escrita gera evento de Realtime e linha
  // morta a toa. O filtro .neq faz o update afetar zero linhas no repeteco.
  //
  // Pelo id DO NUMERO: com varios numeros, a conexao de um nao mexe no status
  // dos outros. Numero removido fica como a remocao o deixou.
  const { data: mudou } = await admin
    .from("whatsapp_account")
    .update({
      connection_status: event.status,
      ...(event.status === "conectado"
        ? { connected_at: new Date().toISOString() }
        : {}),
      ...(event.status === "desconectado"
        ? { disconnected_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", accountId)
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .neq("connection_status", event.status)
    .select("id");

  if (mudou && mudou.length > 0) {
    // Desconexao e o proxy de qualidade neste canal (CLAUDE.md 3.3): o alerta
    // operacional nasce desta linha estruturada. Nenhum dado de paciente.
    if (event.status === "desconectado") {
      log.warn("whatsapp_desconectou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        connection_status: event.status,
      });
    } else {
      log.info("whatsapp_conexao_mudou", {
        clinic_id: clinicId,
        whatsapp_account_id: accountId,
        connection_status: event.status,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
