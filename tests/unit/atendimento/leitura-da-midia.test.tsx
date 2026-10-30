import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
  devolverParaIaAction: vi.fn(),
  elegibilidadeDoDevolverAction: vi.fn(),
  lerRascunhoBloqueadoAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import {
  comPontoFinal,
  LeituraDoAssistente,
  linhaDaLeitura,
  TEXTOS_DA_LEITURA,
} from "@/components/atendimento/media/leitura-do-assistente";
import { MessageBubble } from "@/components/atendimento/message-bubble";
import { Thread } from "@/components/atendimento/thread";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MIDIAS_LIDAS, TIPOS_DE_MIDIA_LIDA } from "@/lib/domain/agente/config";
import {
  conversationKeys,
  fetchLeiturasDaMidia,
  idsDasMidiasDoPaciente,
  leituraDaMensagem,
  leiturasDoFio,
  MIDIAS_LIDAS_NA_TELA,
  podeTerLeituraDaMidia,
  SEM_LEITURAS_DO_FIO,
  TIPOS_LIDOS_NA_TELA,
  type ConversationListItem,
  type LeituraDaMidiaNaTela,
  type LeiturasDoFio,
  type MessageItem,
} from "@/lib/queries/conversations";
import { chavesDoFioNoEvento } from "@/lib/realtime/use-inbox-channel";

// AG6b na bolha do Atendimento (desenho da AG6b, secao 6; D-99 pela
// recomendacao, pendente do dono): "Transcrição do assistente:" embaixo do
// audio do paciente (com "ver mais" e "ver menos"; o sem fala com o texto
// fixo), "Lido pelo assistente:" embaixo da foto e do documento (ScanText no
// tom ia; a figurinha sem linha), a linha "indisponível agora" quando a
// consulta falha, e nada carregando nem vazio. A consulta e propria e
// tolerante (sem a tabela, a conversa abre sem as leituras) e e relida pelo
// mesmo evento de message que rele o fio. Nada aqui chama rede.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const AUDIO = "a1111111-1111-4111-8111-111111111111";
const FOTO = "f1111111-1111-4111-8111-111111111111";
const DOCUMENTO = "d1111111-1111-4111-8111-111111111111";
const EU = "11111111-1111-4111-8111-111111111111";

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: AUDIO,
    conversation_id: CONVERSA,
    direction: "entrada",
    author: "paciente",
    author_user_id: null,
    content_type: "audio",
    body: null,
    media_url: `storage://midia-conversas/${CLINICA}/${AUDIO}`,
    media_mimetype: "audio/mpeg",
    transcript: null,
    is_internal_note: false,
    delivery_status: null,
    error_code: null,
    created_at: "2026-10-30T13:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    ...campos,
  };
}

function foto(campos: Partial<MessageItem> = {}): MessageItem {
  return mensagem({
    id: FOTO,
    content_type: "imagem",
    media_url: `storage://midia-conversas/${CLINICA}/${FOTO}`,
    media_mimetype: "image/jpeg",
    body: "quanto fica?",
    ...campos,
  });
}

function documento(campos: Partial<MessageItem> = {}): MessageItem {
  return mensagem({
    id: DOCUMENTO,
    content_type: "documento",
    media_url: `storage://midia-conversas/${CLINICA}/${DOCUMENTO}`,
    media_mimetype: "application/pdf",
    media_filename: "pedido.pdf",
    ...campos,
  });
}

function leitura(
  campos: Partial<LeituraDaMidiaNaTela> = {},
): LeituraDaMidiaNaTela {
  return {
    messageId: AUDIO,
    midia: "audio",
    tipo: "transcricao",
    transcricao:
      "Oi, queria saber quanto custa a limpeza de pele e se tem horário sábado de manhã",
    resumo: null,
    ...campos,
  };
}

const PEDIDO: LeituraDaMidiaNaTela = {
  messageId: FOTO,
  midia: "imagem",
  tipo: "pedido_de_exame_ou_procedimento",
  transcricao: null,
  resumo: "pedido com Hemograma e Glicemia de jejum",
};

function bolha(
  message: MessageItem,
  props: Partial<React.ComponentProps<typeof MessageBubble>> = {},
): string {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      authorName={null}
      timezone="America/Fortaleza"
      {...props}
    />,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// A linha (puro)
// ---------------------------------------------------------------------------

describe("a linha da leitura (puro)", () => {
  it("áudio transcrito, sem fala, foto lida; a figurinha e o resto sem linha", () => {
    expect(linhaDaLeitura(leitura())).toEqual({
      tipo: "transcricao",
      texto:
        "Oi, queria saber quanto custa a limpeza de pele e se tem horário sábado de manhã",
    });
    expect(
      linhaDaLeitura(leitura({ tipo: "sem_fala", transcricao: null })),
    ).toEqual({ tipo: "sem_fala" });
    expect(linhaDaLeitura(PEDIDO)).toEqual({
      tipo: "lido",
      resumo: "pedido com Hemograma e Glicemia de jejum",
    });
    // A figurinha: sem linha, com ou sem resumo.
    for (const resumo of [null, "figurinha"]) {
      expect(
        linhaDaLeitura({ ...PEDIDO, tipo: "figurinha", resumo }),
      ).toBeNull();
    }
    // Resumo vazio, transcricao vazia, nada: sem linha (nunca uma linha oca).
    expect(linhaDaLeitura({ ...PEDIDO, resumo: "  " })).toBeNull();
    expect(linhaDaLeitura(leitura({ transcricao: " " }))).toBeNull();
    expect(linhaDaLeitura(null)).toBeNull();
    expect(linhaDaLeitura(undefined)).toBeNull();
  });

  it("o resumo ganha o ponto final, sem dobrar", () => {
    expect(comPontoFinal("pedido com Hemograma")).toBe("pedido com Hemograma.");
    expect(comPontoFinal("receita, passada para a equipe.")).toBe(
      "receita, passada para a equipe.",
    );
  });

  it("os textos do desenho, sem travessão e sem jargão", () => {
    expect(TEXTOS_DA_LEITURA).toEqual({
      transcricao: "Transcrição do assistente:",
      semFala: "não deu para entender fala neste áudio.",
      lido: "Lido pelo assistente:",
      indisponivel: "Leitura do assistente indisponível agora.",
      verMais: "ver mais",
      verMenos: "ver menos",
    });
    for (const frase of Object.values(TEXTOS_DA_LEITURA)) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).not.toMatch(/\b(IA|LLM|OpenAI|whisper|modelo)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// A bolha
// ---------------------------------------------------------------------------

describe("áudio do paciente: Transcrição do assistente", () => {
  it("embaixo do player, com o rótulo na cor de apoio, line-clamp e o ver mais de 40px", () => {
    const html = bolha(mensagem(), { leituraDaMidia: leitura() });
    expect(texto(html)).toContain(
      "Transcrição do assistente: Oi, queria saber quanto custa a limpeza de pele e se tem horário sábado de manhã",
    );
    expect(html).toContain('data-leitura="transcricao"');
    expect(html).toContain("line-clamp-2");
    expect(html).toMatch(
      /<span class="text-\(--bolha-meta\)">Transcrição do assistente: <\/span>/,
    );
    // O botao: alvo de 40px, o estado para o leitor de tela, o texto.
    const botao =
      /<button[^>]*aria-expanded="false"[^>]*>ver mais<\/button>/.exec(
        html,
      )?.[0] ?? "";
    expect(botao).toContain("hit-40");
    expect(botao).toMatch(/aria-controls="[^"]+"/);
    // O player continua (o arquivo pronto).
    expect(html).toContain("Velocidade do áudio");
    // Nenhum ScanText no audio (o icone e so do "Lido pelo assistente").
    expect(html).not.toContain("lucide-scan-text");
  });

  it("sem fala: o texto fixo, sem ver mais", () => {
    const html = bolha(mensagem(), {
      leituraDaMidia: leitura({ tipo: "sem_fala", transcricao: null }),
    });
    expect(texto(html)).toContain(
      "Transcrição do assistente: não deu para entender fala neste áudio.",
    );
    expect(html).toContain('data-leitura="sem_fala"');
    expect(html).not.toContain(">ver mais<");
  });

  it("a transcrição antiga da uazapi continua como Transcrição:, junto da do assistente", () => {
    const html = bolha(mensagem({ transcript: "texto antigo da uazapi" }), {
      leituraDaMidia: leitura(),
    });
    const visivel = texto(html);
    expect(visivel).toContain("Transcrição: texto antigo da uazapi");
    expect(visivel).toContain("Transcrição do assistente:");
  });

  it("áudio ainda baixando ou que não veio: sem linha (sem arquivo, sem leitura)", () => {
    for (const media_url of [
      "https://exemplo.invalid/arquivo",
      "indisponivel://falhou",
    ]) {
      const html = bolha(mensagem({ media_url }), {
        leituraDaMidia: leitura(),
        leituraIndisponivel: true,
      });
      expect(html).not.toContain("data-leitura");
    }
  });
});

describe("foto e documento: Lido pelo assistente", () => {
  it("foto: embaixo da foto e da legenda, com o ScanText no tom ia e o ponto final", () => {
    const html = bolha(foto(), { leituraDaMidia: PEDIDO });
    const visivel = texto(html);
    expect(visivel).toContain(
      "Lido pelo assistente: pedido com Hemograma e Glicemia de jejum.",
    );
    // A legenda do paciente vem antes da linha do assistente.
    expect(visivel.indexOf("quanto fica?")).toBeLessThan(
      visivel.indexOf("Lido pelo assistente"),
    );
    const linha = /<p data-leitura="lido"[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    const icone = /<svg[^>]*>/.exec(linha)?.[0] ?? "";
    expect(icone).toContain("lucide-scan-text");
    expect(icone).toContain("text-ai-text");
    expect(icone).toContain('aria-hidden="true"');
  });

  it("documento: a linha embaixo do cartão, com o resumo gravado pelo servidor", () => {
    const html = bolha(documento(), {
      leituraDaMidia: {
        messageId: DOCUMENTO,
        midia: "documento",
        tipo: "resultado_ou_laudo",
        transcricao: null,
        resumo: "resultado de exame ou laudo, passado para a equipe",
      },
    });
    expect(texto(html)).toContain(
      "Lido pelo assistente: resultado de exame ou laudo, passado para a equipe.",
    );
    expect(html).toContain("Baixar");
  });

  it("figurinha: sem linha", () => {
    const html = bolha(foto({ media_mimetype: "image/webp", body: null }), {
      leituraDaMidia: {
        ...PEDIDO,
        tipo: "figurinha",
        resumo: null,
      },
    });
    expect(html).not.toContain("data-leitura");
    expect(html).not.toContain("Lido pelo assistente");
  });
});

describe("estados: carregando, vazio e erro", () => {
  it("carregando e vazio: nada na bolha", () => {
    for (const html of [bolha(mensagem()), bolha(foto()), bolha(documento())]) {
      expect(html).not.toContain("data-leitura");
      expect(html).not.toContain("assistente");
    }
  });

  it("erro da consulta: Leitura do assistente indisponível agora., na linha da mídia", () => {
    for (const message of [mensagem(), foto(), documento()]) {
      const html = bolha(message, { leituraIndisponivel: true });
      expect(texto(html)).toContain(
        "Leitura do assistente indisponível agora.",
      );
      expect(html).toContain('data-leitura="indisponivel"');
    }
  });

  it("a mensagem apagada não mostra leitura (a lápide no lugar)", () => {
    const html = bolha(
      foto({
        deleted_at: "2026-10-30T13:05:00.000Z",
        deleted_source: "paciente",
        body: null,
        media_url: null,
      }),
      { leituraDaMidia: PEDIDO, leituraIndisponivel: true },
    );
    expect(html).toContain("O paciente apagou");
    expect(html).not.toContain("data-leitura");
  });
});

// ---------------------------------------------------------------------------
// O fio
// ---------------------------------------------------------------------------

function conversa(): ConversationListItem {
  return {
    id: CONVERSA,
    status: "aguardando_humano",
    assignee_user_id: null,
    unread_count: 0,
    awaiting_reply: true,
    last_message_at: "2026-10-30T13:10:00.000Z",
    last_inbound_at: "2026-10-30T13:10:00.000Z",
    last_preview: null,
    last_preview_kind: null,
    last_preview_author: null,
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: null,
    contact: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Telefone da equipe",
      phone_e164: "+5584999990001",
      kind: "lead",
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
  };
}

function fio(messages: MessageItem[], leiturasDaMidia?: LeiturasDoFio): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Thread
          conversation={conversa()}
          messages={messages}
          decisions={[]}
          isLoading={false}
          authorNames={{}}
          onBack={() => undefined}
          onToggleContext={() => undefined}
          footer={null}
          clinicId={CLINICA}
          viewerId={EU}
          viewerRole="recepcao"
          podeEditar
          ehChefia={false}
          onResponder={() => undefined}
          onApagar={() => undefined}
          emVoo={[]}
          aoTentarDeNovo={() => undefined}
          aoDescartarEnvio={() => undefined}
          aoIrParaConversa={() => undefined}
          leiturasDaMidia={leiturasDaMidia}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("o fio entrega a leitura de cada mídia", () => {
  const mensagens = [
    mensagem(),
    foto({ created_at: "2026-10-30T13:01:00.000Z" }),
    // A resposta da clinica com audio: nunca transcrita, nunca "indisponível".
    mensagem({
      id: "b1111111-1111-4111-8111-111111111111",
      direction: "saida",
      author: "usuario",
      author_user_id: EU,
      created_at: "2026-10-30T13:02:00.000Z",
    }),
  ];

  it("pronta: cada mídia com a sua linha", () => {
    const html = fio(mensagens, {
      estado: "pronta",
      porMensagem: { [AUDIO]: leitura(), [FOTO]: PEDIDO },
    });
    const visivel = texto(html);
    expect(visivel).toContain("Transcrição do assistente:");
    expect(visivel).toContain(
      "Lido pelo assistente: pedido com Hemograma e Glicemia de jejum.",
    );
    expect(html.match(/data-leitura=/g) ?? []).toHaveLength(2);
  });

  it("erro: a linha indisponível só nas mídias do paciente", () => {
    const html = fio(mensagens, { estado: "erro", porMensagem: {} });
    expect(html.match(/data-leitura="indisponivel"/g) ?? []).toHaveLength(2);
  });

  it("sem a prop, carregando ou desligada: nenhuma linha", () => {
    for (const estado of [
      undefined,
      SEM_LEITURAS_DO_FIO,
      { estado: "carregando", porMensagem: {} } satisfies LeiturasDoFio,
    ]) {
      expect(fio(mensagens, estado)).not.toContain("data-leitura");
    }
  });
});

// ---------------------------------------------------------------------------
// A consulta
// ---------------------------------------------------------------------------

type RespostaFalsa = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

type ChamadaFalsa = {
  tabela: string;
  colunas: string | null;
  filtros: [string, unknown][];
};

/** Um cliente do Supabase de mentira: grava as chamadas e devolve na ordem. */
function supabaseFalso(respostas: RespostaFalsa[]) {
  const chamadas: ChamadaFalsa[] = [];
  let indice = 0;
  const cliente = {
    from(tabela: string) {
      const chamada: ChamadaFalsa = { tabela, colunas: null, filtros: [] };
      chamadas.push(chamada);
      const resposta =
        respostas[Math.min(indice, respostas.length - 1)] ??
        ({ data: [], error: null } satisfies RespostaFalsa);
      indice += 1;
      const consulta = {
        select(colunas: string) {
          chamada.colunas = colunas;
          return consulta;
        },
        eq(coluna: string, valor: unknown) {
          chamada.filtros.push([`eq.${coluna}`, valor]);
          return consulta;
        },
        in(coluna: string, valores: unknown) {
          chamada.filtros.push([`in.${coluna}`, valores]);
          return consulta;
        },
        then<T>(aoResolver: (valor: RespostaFalsa) => T) {
          return Promise.resolve(resposta).then(aoResolver);
        },
      };
      return consulta;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, chamadas };
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

describe("fetchLeiturasDaMidia", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("só as colunas da tela, da clínica, pelos ids válidos e sem repetir", async () => {
    const { cliente, chamadas } = supabaseFalso([
      {
        data: [
          {
            message_id: AUDIO,
            midia: "audio",
            tipo: "transcricao",
            transcricao: "oi",
            resumo: null,
          },
          {
            message_id: FOTO,
            midia: "imagem",
            tipo: "pedido_de_exame_ou_procedimento",
            transcricao: null,
            resumo: "pedido com Hemograma",
          },
        ],
        error: null,
      },
    ]);
    const lido = await fetchLeiturasDaMidia(cliente, CLINICA, [
      AUDIO,
      FOTO,
      AUDIO,
      "otimista-1",
    ]);
    expect(lido).toEqual({
      [AUDIO]: {
        messageId: AUDIO,
        midia: "audio",
        tipo: "transcricao",
        transcricao: "oi",
        resumo: null,
      },
      [FOTO]: {
        messageId: FOTO,
        midia: "imagem",
        tipo: "pedido_de_exame_ou_procedimento",
        transcricao: null,
        resumo: "pedido com Hemograma",
      },
    });
    expect(chamadas).toEqual([
      {
        tabela: "ia_leitura_da_midia",
        colunas: "message_id, midia, tipo, transcricao, resumo",
        filtros: [
          ["eq.clinic_id", CLINICA],
          ["in.message_id", [AUDIO, FOTO]],
        ],
      },
    ]);
  });

  it("nenhum id válido: nem consulta", async () => {
    const { cliente, chamadas } = supabaseFalso([]);
    expect(await fetchLeiturasDaMidia(cliente, CLINICA, [])).toEqual({});
    expect(
      await fetchLeiturasDaMidia(cliente, CLINICA, ["otimista-1"]),
    ).toEqual({});
    expect(chamadas).toEqual([]);
  });

  it("de 100 em 100 ids (o filtro vai na URL)", async () => {
    const { cliente, chamadas } = supabaseFalso([{ data: [], error: null }]);
    const ids = Array.from({ length: 230 }, (_, n) => uuid(n));
    await fetchLeiturasDaMidia(cliente, CLINICA, ids);
    expect(
      chamadas.map(
        (chamada) => (chamada.filtros[1]?.[1] as string[] | undefined)?.length,
      ),
    ).toEqual([100, 100, 30]);
  });

  it("sem a tabela (antes da migration ou no rollback): a conversa abre sem as leituras", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      const { cliente } = supabaseFalso([
        { data: null, error: { code, message: "relation does not exist" } },
      ]);
      expect(await fetchLeiturasDaMidia(cliente, CLINICA, [AUDIO])).toEqual({});
    }
  });

  it("outro erro lança, sem nada do banco no texto (a tela mostra indisponível)", async () => {
    const { cliente } = supabaseFalso([
      {
        data: null,
        error: { code: "57014", message: `timeout em ${AUDIO} da ${CLINICA}` },
      },
    ]);
    const erro = await fetchLeiturasDaMidia(cliente, CLINICA, [AUDIO]).then(
      () => null,
      (motivo: unknown) => motivo,
    );
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).not.toContain(AUDIO);
    expect((erro as Error).message).not.toContain(CLINICA);
  });

  it("linha fora do formato (mídia ou tipo que o banco não deixaria) fica de fora", async () => {
    const { cliente } = supabaseFalso([
      {
        data: [
          { message_id: AUDIO, midia: "video", tipo: "transcricao" },
          { message_id: FOTO, midia: "imagem", tipo: "nao_existe" },
          {
            message_id: DOCUMENTO,
            midia: "documento",
            tipo: "receita",
            resumo: 3,
          },
        ],
        error: null,
      },
    ]);
    expect(
      await fetchLeiturasDaMidia(cliente, CLINICA, [AUDIO, FOTO, DOCUMENTO]),
    ).toEqual({
      [DOCUMENTO]: {
        messageId: DOCUMENTO,
        midia: "documento",
        tipo: "receita",
        transcricao: null,
        resumo: null,
      },
    });
  });

  it("nada no console: é dado de saúde", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map(
      (metodo) => vi.spyOn(console, metodo).mockImplementation(() => undefined),
    );
    const { cliente } = supabaseFalso([
      { data: null, error: { code: "57014", message: "x" } },
    ]);
    await fetchLeiturasDaMidia(cliente, CLINICA, [AUDIO]).catch(() => null);
    for (const espiao of espioes) {
      expect(espiao).not.toHaveBeenCalled();
    }
  });
});

describe("quais mensagens vão à consulta", () => {
  it("só as mídias do paciente, não apagadas, com id válido", () => {
    const lista = [
      mensagem(),
      foto(),
      documento(),
      // a clinica mandou: nunca lida
      mensagem({ id: uuid(1), direction: "saida", author: "usuario" }),
      // apagada
      foto({ id: uuid(2), deleted_at: "2026-10-30T13:05:00.000Z" }),
      // texto (inclusive o video, que chega como texto com midia)
      mensagem({ id: uuid(3), content_type: "texto", body: "oi" }),
      mensagem({
        id: uuid(4),
        content_type: "texto",
        media_mimetype: "video/mp4",
      }),
      // nota interna
      mensagem({ id: uuid(5), is_internal_note: true }),
      // a bolha otimista
      mensagem({ id: "otimista-1" }),
    ];
    expect(idsDasMidiasDoPaciente(lista)).toEqual([AUDIO, FOTO, DOCUMENTO]);
    expect(podeTerLeituraDaMidia(mensagem({ id: "otimista-1" }))).toBe(true);
  });
});

describe("o estado das leituras para o fio", () => {
  const mapa = { [AUDIO]: leitura() };

  it("desligada sem mídia; carregando; pronta; erro só na fase do agente", () => {
    expect(
      leiturasDoFio({
        ligada: false,
        mostrarErro: true,
        data: undefined,
        isError: true,
      }),
    ).toBe(SEM_LEITURAS_DO_FIO);
    expect(
      leiturasDoFio({
        ligada: true,
        mostrarErro: true,
        data: undefined,
        isError: false,
      }),
    ).toEqual({ estado: "carregando", porMensagem: {} });
    expect(
      leiturasDoFio({
        ligada: true,
        mostrarErro: true,
        data: mapa,
        isError: false,
      }),
    ).toEqual({ estado: "pronta", porMensagem: mapa });
    expect(
      leiturasDoFio({
        ligada: true,
        mostrarErro: true,
        data: undefined,
        isError: true,
      }),
    ).toEqual({ estado: "erro", porMensagem: {} });
    // Fora da fase do agente, nada muda na bolha, nem no erro.
    expect(
      leiturasDoFio({
        ligada: true,
        mostrarErro: false,
        data: undefined,
        isError: true,
      }),
    ).toBe(SEM_LEITURAS_DO_FIO);
  });

  it("a releitura que falhou não apaga as linhas que já apareceram", () => {
    expect(
      leiturasDoFio({
        ligada: true,
        mostrarErro: true,
        data: mapa,
        isError: true,
      }),
    ).toEqual({ estado: "pronta", porMensagem: mapa });
  });

  it("a leitura de uma mensagem, sem achar nada no protótipo", () => {
    const leituras: LeiturasDoFio = { estado: "pronta", porMensagem: mapa };
    expect(leituraDaMensagem(leituras, AUDIO)).toEqual(leitura());
    expect(leituraDaMensagem(leituras, FOTO)).toBeNull();
    expect(leituraDaMensagem(leituras, "constructor")).toBeNull();
  });
});

describe("relida no mesmo evento de message que relê o fio", () => {
  it("a chave das leituras mora debaixo da chave das mensagens da conversa", () => {
    const chave = conversationKeys.leiturasDaMidia(CONVERSA);
    expect(chave.slice(0, 2)).toEqual([...conversationKeys.messages(CONVERSA)]);
    expect(chavesDoFioNoEvento(CONVERSA, "message")).toContainEqual(
      conversationKeys.messages(CONVERSA),
    );
  });

  it("invalidar as mensagens (o evento) invalida as leituras; outra conversa não", async () => {
    const cliente = new QueryClient();
    const desta = [...conversationKeys.leiturasDaMidia(CONVERSA), "1:a:a"];
    const outra = [
      ...conversationKeys.leiturasDaMidia("outra-conversa"),
      "1:b:b",
    ];
    cliente.setQueryData(desta, {});
    cliente.setQueryData(outra, {});
    await cliente.invalidateQueries({
      queryKey: conversationKeys.messages(CONVERSA),
    });
    expect(cliente.getQueryState(desta)?.isInvalidated).toBe(true);
    expect(cliente.getQueryState(outra)?.isInvalidated).toBe(false);
    // O catch-up da reconexao (["messages"]) tambem pega.
    await cliente.invalidateQueries({ queryKey: ["messages"] });
    expect(cliente.getQueryState(outra)?.isInvalidated).toBe(true);
  });
});

describe("espelho dos tipos da leitura", () => {
  it("as listas da tela batem com as da configuração (os CHECKs do banco)", () => {
    expect([...MIDIAS_LIDAS_NA_TELA].sort()).toEqual([...MIDIAS_LIDAS].sort());
    expect([...TIPOS_LIDOS_NA_TELA].sort()).toEqual(
      [...TIPOS_DE_MIDIA_LIDA].sort(),
    );
  });

  it("o Atendimento não leva a configuração do agente ao navegador (só os tipos)", () => {
    const consulta = readFileSync("lib/queries/conversations.ts", "utf8");
    expect(consulta).toMatch(
      /import type \{[^}]*\} from "@\/lib\/domain\/agente\/config";/,
    );
    expect(consulta).not.toMatch(
      /import \{[^}]*\} from "@\/lib\/domain\/agente\/config";/,
    );
  });
});

describe("tema e tokens", () => {
  it("a linha usa só tokens (a cor de apoio da pele e o tom ia), nunca cor solta", () => {
    const codigo = readFileSync(
      "components/atendimento/media/leitura-do-assistente.tsx",
      "utf8",
    );
    expect(codigo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(codigo).not.toMatch(/rgba?\(/);
    expect(codigo).toContain("text-(--bolha-meta)");
    expect(codigo).toContain("text-ai-text");
  });

  it("o componente sozinho, sem leitura e sem erro, não desenha nada", () => {
    expect(renderToStaticMarkup(<LeituraDoAssistente leitura={null} />)).toBe(
      "",
    );
  });
});
