import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarAberturaDeMidia } from "@/lib/auth/read-audit";
import { intervaloPedido } from "@/lib/domain/intervalo-de-bytes";
import {
  exibicaoDaMidiaDeTexto,
  nomeParaBaixar,
} from "@/lib/domain/midia-recebida";
import { buscarPedacoDeMidia } from "@/lib/integrations/storage/pedaco-de-midia";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// Entrega o arquivo de uma mensagem (foto, audio, documento) ao navegador.
//
// ESTE E O PRIMEIRO CAMINHO de leitura de arquivo de PACIENTE pelo navegador.
// Ate agora o acervo so era alcancavel pelo service role, no worker. Por isso
// o desenho tem duas travas independentes, e nenhuma delas e um `if` de
// TypeScript:
//
//   1. A rota e enderecada por message_id, NUNCA por caminho de arquivo. O
//      cliente nao informa balde nem nome de objeto, entao nao ha o que
//      forjar.
//   2. A URL e assinada com o CLIENTE DE SESSAO, nao com service role. Assim
//      quem decide e a policy "membro le midia da propria mensagem" no
//      Postgres (migration 20260903100000), e o recorte do papel profissional
//      (que so ve conversa atribuida a ele) vale de graca. Assinar com service
//      role seria filtrar a clinica no codigo, que a regra 3.1 do CLAUDE.md
//      proibe: "Se a RLS falhar, o dado nao pode vazar".
//
// Foto e documento: a resposta e um 302 para a URL assinada, e nao o arquivo
// em si (o byte nao passa pela funcao). Eles carregam de uma vez.
//
// AUDIO (02/10/2026): a rota entrega os bytes ela mesma, pedaco por pedaco.
// Com o 302, o navegador guardava a URL assinada (5 minutos) e pedia o resto
// do audio direto a ela: quem abria a conversa e tocava depois de 5 minutos,
// ou pausava e voltava, ouvia so o que ja tinha carregado (uns 2 segundos) e
// o audio parava. Agora cada pedaco (cabecalho Range) passa por aqui com a
// sessao, a RLS e a trilha, e nada expira enquanto a pessoa estiver logada.
// O arquivo continua privado: link publico ou assinado de longa duracao seria
// dado de saude acessivel sem login (regra 3.1). Cada resposta leva no maximo
// 1 MiB (lib/domain/intervalo-de-bytes.ts); o navegador pede o resto.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "midia-conversas";
const VALIDADE_SEGUNDOS = 300;

type LinhaDaMensagem = {
  clinic_id: string;
  content_type: string;
  media_url: string | null;
  deleted_at: string | null;
  body: string | null;
  media_filename: string | null;
  media_mimetype: string | null;
  direction: string;
};

// O nome do download sai de nomeParaBaixar (lib/domain/midia-recebida.ts):
// `download: true` faria o Storage usar o NOME DO OBJETO, que e um uuid sem
// extensao, e o antigo ".pdf" fixo fazia uma planilha abrir num leitor de PDF.
// O nome original (sanitizado) vem primeiro; sem ele, "conduzza-documento"
// com a extensao do tipo REAL, que o worker guarda em media_mimetype. A
// direcao entra porque o documento que a clinica enviou nasce sem tipo e e
// sempre PDF.

/** `storage://midia-conversas/<clinic>/<message>` vira `<clinic>/<message>`. */
function caminhoDoObjeto(mediaUrl: string | null): string | null {
  const prefixo = `storage://${BUCKET}/`;
  if (!mediaUrl?.startsWith(prefixo)) {
    return null;
  }
  const caminho = mediaUrl.slice(prefixo.length);
  return caminho.length > 0 ? caminho : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;

  const context = await getSessionContext();
  if (!context) {
    // JSON e nao redirecionamento: esta rota e consumida por <img> e <audio>,
    // e devolver o HTML do login faria a imagem quebrar sem nenhum erro
    // diagnosticavel.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message")
    .select(
      "clinic_id, content_type, media_url, deleted_at, body, media_filename, media_mimetype, direction",
    )
    .eq("id", messageId)
    .maybeSingle();

  // Mensagem que a RLS nao libera devolve linha nula, nao erro: 404 para nao
  // revelar se o id existe em outra clinica.
  const mensagem = (data as LinhaDaMensagem | null) ?? null;
  if (error || !mensagem || mensagem.deleted_at) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const caminho = caminhoDoObjeto(mensagem.media_url);
  if (!caminho) {
    // Inclui o caso em que o job de download ainda nao rodou (media_url ainda
    // e a URL criptografada do provedor), o dado de demonstracao (seed://) e
    // o download que desistiu de vez (indisponivel://).
    return NextResponse.json({ error: "arquivo_indisponivel" }, { status: 409 });
  }

  // TRILHA BLOQUEANTE. Arquivo de paciente sem registro de quem abriu e pior
  // que arquivo indisponivel. O clinic_id vem da MENSAGEM, nunca do cookie de
  // clinica ativa: a RLS autoriza qualquer clinica ativa do usuario, e usar o
  // cookie gravaria a leitura na clinica errada.
  const registrou = await auditarAberturaDeMidia(supabase, {
    clinicId: mensagem.clinic_id,
    userId: context.userId,
    messageId,
  });
  if (!registrou) {
    log.error("midia_trilha_falhou", {
      message_id: messageId,
      clinic_id: mensagem.clinic_id,
    });
    return NextResponse.json({ error: "trilha_indisponivel" }, { status: 503 });
  }

  // Documento sempre baixa, nunca abre no navegador. Isso nao e preferencia:
  // um SVG servido do dominio do Supabase e aberto em navegacao de topo
  // executa script. Em <img> nao executa, por isso imagem pode ser embutida.
  const baixar =
    mensagem.content_type === "documento" ||
    request.nextUrl.searchParams.get("download") === "1";

  const { data: assinada, error: erroAssinatura } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      caminho,
      VALIDADE_SEGUNDOS,
      baixar ? { download: nomeParaBaixar(mensagem) } : undefined,
    );

  if (erroAssinatura || !assinada?.signedUrl) {
    // A policy do Postgres recusou, ou o objeto sumiu do balde.
    return NextResponse.json({ error: "sem_acesso" }, { status: 403 });
  }

  // Audio e video tocam aos pedacos (Range): os dois vem pela propria
  // origem. O criterio e o mesmo da bolha (tipoDaMidia em message-bubble):
  // content_type 'audio', ou a midia de texto que o mimetype diz ser audio
  // ou video.
  const continua =
    mensagem.content_type === "audio" ||
    (mensagem.content_type !== "imagem" &&
      mensagem.content_type !== "documento" &&
      ["audio", "video"].includes(
        exibicaoDaMidiaDeTexto(mensagem.media_mimetype),
      ));
  if (continua && !baixar) {
    return entregarPedacoDoAudio(request, assinada.signedUrl, mensagem);
  }

  const resposta = NextResponse.redirect(assinada.signedUrl, 302);
  // Foto e audio de paciente nao ficam no cache de disco do computador
  // compartilhado da recepcao depois que alguem sai do sistema.
  resposta.headers.set("Cache-Control", "private, no-store, max-age=0");
  return resposta;
}

// O pedaco do audio pela propria origem: 206 com Content-Range (ou 200 com o
// arquivo inteiro quando o navegador nao pediu intervalo), Accept-Ranges para
// o navegador poder arrastar, e o mesmo Cache-Control das outras midias.
async function entregarPedacoDoAudio(
  request: NextRequest,
  urlAssinada: string,
  mensagem: LinhaDaMensagem,
): Promise<Response> {
  const intervalo = intervaloPedido(request.headers.get("range"));
  const pedaco = await buscarPedacoDeMidia(
    urlAssinada,
    intervalo,
    request.signal,
  );
  if (!pedaco.ok) {
    return NextResponse.json(
      { error: "audio_indisponivel" },
      { status: pedaco.status === 404 ? 404 : 502 },
    );
  }
  const origem = pedaco.resposta;
  const cabecalhos = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type":
      origem.headers.get("content-type") ??
      mensagem.media_mimetype ??
      "audio/mpeg",
    "X-Content-Type-Options": "nosniff",
  });
  for (const nome of ["content-length", "content-range"]) {
    const valor = origem.headers.get(nome);
    if (valor) {
      cabecalhos.set(nome, valor);
    }
  }
  if (origem.status === 416) {
    // Fim do arquivo: sem corpo, entao sem o Content-Length do corpo de erro
    // do Storage (o navegador esperaria bytes que nunca chegam).
    cabecalhos.set("content-length", "0");
    await origem.body?.cancel();
    return new Response(null, { status: 416, headers: cabecalhos });
  }
  return new Response(origem.body, {
    status: origem.status,
    headers: cabecalhos,
  });
}
