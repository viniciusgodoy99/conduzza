import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarAberturaDeMidia } from "@/lib/auth/read-audit";
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
// A resposta e um 302 para a URL assinada, e nao o arquivo em si: o byte nao
// passa pela funcao (nao ha teto de corpo de resposta a estourar) e o
// cabecalho Range chega intacto ao storage, que e o que faz o audio ter
// busca por arrastar.

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
};

/**
 * Nome com que o arquivo chega ao computador de quem baixa.
 *
 * `download: true` faria o Storage usar o NOME DO OBJETO, que e um uuid sem
 * extensao: o PDF do paciente chegaria como um arquivo sem tipo que o sistema
 * operacional nao sabe abrir. Passar o nome resolve.
 */
function nomeParaBaixar(mensagem: LinhaDaMensagem): string {
  const limpo = (mensagem.body ?? "").trim().replace(/[\\/:*?"<>|]/g, "");
  if (limpo && /\.\w{2,5}$/.test(limpo)) {
    return limpo;
  }
  const extensao =
    mensagem.content_type === "documento"
      ? "pdf"
      : mensagem.content_type === "imagem"
        ? "jpg"
        : "bin";
  return `conduzza-${mensagem.content_type}.${extensao}`;
}

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
    .select("clinic_id, content_type, media_url, deleted_at, body")
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
    // e a URL criptografada do provedor) e o dado de demonstracao (seed://).
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

  const resposta = NextResponse.redirect(assinada.signedUrl, 302);
  // Foto e audio de paciente nao ficam no cache de disco do computador
  // compartilhado da recepcao depois que alguem sai do sistema.
  resposta.headers.set("Cache-Control", "private, no-store, max-age=0");
  return resposta;
}
