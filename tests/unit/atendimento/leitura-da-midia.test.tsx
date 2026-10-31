import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

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
  CARACTERES_DE_DUAS_LINHAS_NA_BOLHA,
  comPontoFinal,
  LeituraDoAssistente,
  linhaDaLeitura,
  TEXTOS_DA_LEITURA,
  transcricaoPareceLonga,
} from "@/components/atendimento/media/leitura-do-assistente";
import { MessageBubble } from "@/components/atendimento/message-bubble";
import { Thread } from "@/components/atendimento/thread";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MIDIAS_LIDAS, TIPOS_DE_MIDIA_LIDA } from "@/lib/domain/agente/config";
import {
  consultaDasLeiturasLigada,
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

  it("transcrição curta, que cabe nas duas linhas: sem ver mais (revisão das telas, item 7)", () => {
    const curta = "Quero marcar uma consulta.";
    expect(transcricaoPareceLonga(curta)).toBe(false);
    const html = bolha(mensagem(), {
      leituraDaMidia: leitura({ transcricao: curta }),
    });
    expect(texto(html)).toContain(`Transcrição do assistente: ${curta}`);
    expect(html).not.toContain(">ver mais<");
    expect(html).not.toContain("aria-expanded");
    // O texto continua no paragrafo de sempre (o corte e so visual).
    expect(html).toContain("line-clamp-2");
  });

  it("antes de medir, a estimativa pelas duas linhas da bolha mais estreita; a quebra de linha conta", () => {
    const rotulo = `${TEXTOS_DA_LEITURA.transcricao} `;
    const cabe = "a".repeat(CARACTERES_DE_DUAS_LINHAS_NA_BOLHA - rotulo.length);
    expect(transcricaoPareceLonga(cabe)).toBe(false);
    expect(transcricaoPareceLonga(`${cabe}a`)).toBe(true);
    expect(transcricaoPareceLonga("sim\nnão")).toBe(true);
    // A transcricao do teste de cima passa: o ver mais aparece.
    expect(transcricaoPareceLonga(leitura().transcricao ?? "")).toBe(true);
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

  it("a consulta só sai na clínica da fase do agente, com a conversa aberta e mídia do paciente (revisão das telas, item 6)", () => {
    const ids = [AUDIO];
    expect(
      consultaDasLeiturasLigada({ iaNaFase: true, conversaAberta: true, ids }),
    ).toBe(true);
    // Fora da fase: nenhuma requisicao, nem a cada evento de message.
    expect(
      consultaDasLeiturasLigada({ iaNaFase: false, conversaAberta: true, ids }),
    ).toBe(false);
    expect(
      consultaDasLeiturasLigada({ iaNaFase: true, conversaAberta: false, ids }),
    ).toBe(false);
    expect(
      consultaDasLeiturasLigada({
        iaNaFase: true,
        conversaAberta: true,
        ids: [],
      }),
    ).toBe(false);
  });

  it("o Atendimento liga a consulta e o estado do fio pelo mesmo sinal", () => {
    const codigo = readFileSync("app/(app)/atendimento/inbox-client.tsx", "utf8");
    expect(codigo).toMatch(
      /const leiturasLigadas = consultaDasLeiturasLigada\(\{\s*iaNaFase,\s*conversaAberta: selected !== null,\s*ids: idsDasLeituras,\s*\}\);/,
    );
    expect(codigo).toContain("enabled: leiturasLigadas,");
    expect(codigo).toContain("ligada: leiturasLigadas,");
    // Nenhuma outra consulta das leituras no Atendimento.
    expect(codigo.match(/fetchLeiturasDaMidia\(/g)).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// O "ver mais" medido, num DOM de verdade (revisao R3 de d1a15f6, 4)
// ---------------------------------------------------------------------------
//
// O teste de antes so lia o codigo-fonte. Aqui o componente monta de
// verdade (react-dom/client, com o act do React): o useLayoutEffect mede, o
// ResizeObserver avisa a troca de tamanho e o clique abre e fecha. O
// projeto nao tem jsdom (e nao ganha dependencia por isto): um DOM minimo,
// so o que o react-dom/client usa com estes elementos (div, p, span, button
// e texto), e um layout falso que o teste controla: a largura da bolha em
// caracteres por linha, a altura de cada linha e o line-clamp-2 (a caixa do
// paragrafo fecha em duas linhas; o conteudo, nao). RR2 de 88e9560 (baixo
// 5): a altura da linha e a sobra de arredondamento do conteudo tambem, para
// fixar o limite da medida (uma linha a mais conta; 1 px, nao).

const NO_ELEMENTO = 1;
const NO_TEXTO = 3;
const NO_DOCUMENTO = 9;
const ALTURA_DA_LINHA = 20;
/**
 * O layout falso (o teste muda): a largura da bolha em caracteres por linha,
 * a altura de cada linha em px e a sobra, em px, que o arredondamento do
 * navegador deixa na altura do conteudo (subpixel).
 */
const layout = { largura: 40, alturaDaLinha: ALTURA_DA_LINHA, sobra: 0 };

type EventoFalso = {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  target: NoFalso | null;
  currentTarget: NoFalso | null;
  defaultPrevented: boolean;
  parado: boolean;
  timeStamp: number;
  button: number;
  preventDefault(): void;
  stopPropagation(): void;
};

type Ouvinte = {
  tipo: string;
  fn: (evento: EventoFalso) => void;
  captura: boolean;
};

class NoFalso {
  parentNode: NoFalso | null = null;
  childNodes: NoFalso[] = [];
  ouvintes: Ouvinte[] = [];
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    public ownerDocument: DocumentoFalso | null,
  ) {}
  get firstChild(): NoFalso | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): NoFalso | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): NoFalso | null {
    const irmaos = this.parentNode?.childNodes ?? [];
    return irmaos[irmaos.indexOf(this) + 1] ?? null;
  }
  appendChild<T extends NoFalso>(filho: T): T {
    filho.parentNode?.removeChild(filho);
    this.childNodes.push(filho);
    filho.parentNode = this;
    return filho;
  }
  insertBefore<T extends NoFalso>(filho: T, antes: NoFalso | null): T {
    if (antes === null) {
      return this.appendChild(filho);
    }
    filho.parentNode?.removeChild(filho);
    this.childNodes.splice(this.childNodes.indexOf(antes), 0, filho);
    filho.parentNode = this;
    return filho;
  }
  removeChild<T extends NoFalso>(filho: T): T {
    const i = this.childNodes.indexOf(filho);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
    }
    filho.parentNode = null;
    return filho;
  }
  get textContent(): string {
    return this.childNodes.map((filho) => filho.textContent).join("");
  }
  set textContent(valor: string) {
    for (const filho of this.childNodes) {
      filho.parentNode = null;
    }
    this.childNodes = [];
    if (valor !== "" && this.ownerDocument !== null) {
      this.appendChild(this.ownerDocument.createTextNode(valor));
    }
  }
  addEventListener(
    tipo: string,
    fn: (evento: EventoFalso) => void,
    opcoes?: boolean | { capture?: boolean },
  ): void {
    const captura =
      typeof opcoes === "boolean" ? opcoes : Boolean(opcoes?.capture);
    this.ouvintes.push({ tipo, fn, captura });
  }
  removeEventListener(
    tipo: string,
    fn: (evento: EventoFalso) => void,
    opcoes?: boolean | { capture?: boolean },
  ): void {
    const captura =
      typeof opcoes === "boolean" ? opcoes : Boolean(opcoes?.capture);
    this.ouvintes = this.ouvintes.filter(
      (o) => !(o.tipo === tipo && o.fn === fn && o.captura === captura),
    );
  }
  /** A captura do topo ao alvo e a bolha do alvo ao topo, como no navegador. */
  dispatchEvent(evento: EventoFalso): boolean {
    evento.target = this;
    const caminho: NoFalso[] = [this];
    for (let pai = this.parentNode; pai !== null; pai = pai.parentNode) {
      caminho.push(pai);
    }
    const chamar = (no: NoFalso, captura: boolean) => {
      evento.currentTarget = no;
      for (const o of no.ouvintes.filter(
        (o) => o.tipo === evento.type && o.captura === captura,
      )) {
        o.fn(evento);
      }
    };
    for (const no of [...caminho].reverse()) {
      if (!evento.parado) {
        chamar(no, true);
      }
    }
    for (const no of caminho) {
      if (!evento.parado && (evento.bubbles || no === this)) {
        chamar(no, false);
      }
    }
    return !evento.defaultPrevented;
  }
}

class TextoFalso extends NoFalso {
  constructor(
    public nodeValue: string,
    dono: DocumentoFalso,
  ) {
    super(NO_TEXTO, "#text", dono);
  }
  override get textContent(): string {
    return this.nodeValue;
  }
  override set textContent(valor: string) {
    this.nodeValue = valor;
  }
}

class ElementoFalso extends NoFalso {
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly atributos = new Map<string, string>();
  readonly style: Record<string, string> = {};
  constructor(
    readonly tagName: string,
    dono: DocumentoFalso,
  ) {
    super(NO_ELEMENTO, tagName, dono);
  }
  setAttribute(nome: string, valor: unknown): void {
    this.atributos.set(nome, String(valor));
  }
  getAttribute(nome: string): string | null {
    return this.atributos.get(nome) ?? null;
  }
  removeAttribute(nome: string): void {
    this.atributos.delete(nome);
  }
  hasAttribute(nome: string): boolean {
    return this.atributos.has(nome);
  }
  get classes(): string[] {
    return (this.getAttribute("class") ?? "").split(/\s+/);
  }
  /** As linhas do conteudo na largura de agora (o layout falso). */
  private get linhas(): number {
    return Math.max(1, Math.ceil(this.textContent.length / layout.largura));
  }
  /** A altura do conteudo inteiro (com a sobra do arredondamento). */
  get scrollHeight(): number {
    return this.linhas * layout.alturaDaLinha + layout.sobra;
  }
  /** A altura da caixa: o line-clamp-2 fecha em duas linhas. */
  get clientHeight(): number {
    const linhas = this.classes.includes("line-clamp-2")
      ? Math.min(2, this.linhas)
      : this.linhas;
    return linhas * layout.alturaDaLinha;
  }
}

class DocumentoFalso extends NoFalso {
  readonly documentElement: ElementoFalso;
  readonly body: ElementoFalso;
  activeElement: ElementoFalso | null = null;
  defaultView: Record<string, unknown> | null = null;
  constructor() {
    super(NO_DOCUMENTO, "#document", null);
    this.ownerDocument = null;
    this.documentElement = new ElementoFalso("HTML", this);
    this.body = new ElementoFalso("BODY", this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): ElementoFalso {
    return new ElementoFalso(tag.toUpperCase(), this);
  }
  createTextNode(texto: string): TextoFalso {
    return new TextoFalso(texto, this);
  }
}

/** O ResizeObserver falso: so avisa os elementos observados, quando o teste manda. */
class ObservadorFalso {
  static ativos = new Set<ObservadorFalso>();
  readonly elementos = new Set<unknown>();
  constructor(private readonly avisar: () => void) {
    ObservadorFalso.ativos.add(this);
  }
  observe(elemento: unknown): void {
    this.elementos.add(elemento);
  }
  unobserve(elemento: unknown): void {
    this.elementos.delete(elemento);
  }
  disconnect(): void {
    this.elementos.clear();
    ObservadorFalso.ativos.delete(this);
  }
  /** A caixa dos elementos observados mudou de tamanho. */
  static mudouDeTamanho(): void {
    for (const observador of [...ObservadorFalso.ativos]) {
      if (observador.elementos.size > 0) {
        observador.avisar();
      }
    }
  }
  static observados(): unknown[] {
    return [...ObservadorFalso.ativos].flatMap((o) => [...o.elementos]);
  }
}

function todosOsElementos(no: NoFalso): ElementoFalso[] {
  return no.childNodes.flatMap((filho) =>
    filho instanceof ElementoFalso ? [filho, ...todosOsElementos(filho)] : [],
  );
}

describe("o ver mais medido, num DOM de verdade (R3 de d1a15f6, 4)", () => {
  type Raiz = { render(no: React.ReactNode): void; unmount(): void };
  const globais = globalThis as unknown as Record<string, unknown>;
  const NOMES = [
    "window",
    "document",
    "ResizeObserver",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;
  const antes = new Map<string, unknown>();
  let documento: DocumentoFalso;
  let criarRaiz: (container: unknown) => Raiz;
  let act: (feito: () => Promise<void>) => Promise<void>;
  let raiz: Raiz | null = null;
  let container: ElementoFalso;
  let erros: MockInstance<typeof console.error>;

  beforeAll(async () => {
    for (const nome of NOMES) {
      antes.set(nome, globais[nome]);
    }
    documento = new DocumentoFalso();
    const janela: Record<string, unknown> = {
      document: documento,
      HTMLIFrameElement: class {},
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      event: undefined,
    };
    documento.defaultView = janela;
    globais.window = janela;
    globais.document = documento;
    globais.ResizeObserver = ObservadorFalso;
    globais.IS_REACT_ACT_ENVIRONMENT = true;
    // Depois dos globais: o react-dom/client confere o DOM ao carregar.
    const cliente = await import("react-dom/client");
    criarRaiz = cliente.createRoot as unknown as (container: unknown) => Raiz;
    const react = await import("react");
    act = react.act as unknown as (feito: () => Promise<void>) => Promise<void>;
  });

  afterAll(() => {
    for (const nome of NOMES) {
      if (antes.get(nome) === undefined) {
        delete globais[nome];
      } else {
        globais[nome] = antes.get(nome);
      }
    }
  });

  beforeEach(() => {
    erros = vi.spyOn(console, "error");
    layout.largura = 40;
    layout.alturaDaLinha = ALTURA_DA_LINHA;
    layout.sobra = 0;
    container = documento.createElement("div");
    documento.body.appendChild(container);
    raiz = criarRaiz(container);
  });

  afterEach(async () => {
    const montada = raiz;
    raiz = null;
    if (montada !== null) {
      await act(async () => montada.unmount());
    }
    documento.body.removeChild(container);
    // Desmontada, nada fica observado (o efeito desliga o observador).
    expect(ObservadorFalso.observados()).toEqual([]);
    ObservadorFalso.ativos.clear();
    // O React nao reclamou de nada no DOM minimo (nem do act).
    expect(erros).not.toHaveBeenCalled();
    erros.mockRestore();
  });

  async function montar(transcricao: string) {
    await act(async () => {
      raiz?.render(<LeituraDoAssistente leitura={leitura({ transcricao })} />);
    });
  }

  const paragrafo = () =>
    todosOsElementos(container).find((e) => e.tagName === "P") ?? null;
  const botao = () =>
    todosOsElementos(container).find((e) => e.tagName === "BUTTON") ?? null;

  async function clicar(alvo: ElementoFalso | null) {
    expect(alvo).not.toBeNull();
    await act(async () => {
      const evento: EventoFalso = {
        type: "click",
        bubbles: true,
        cancelable: true,
        target: null,
        currentTarget: null,
        defaultPrevented: false,
        parado: false,
        timeStamp: 0,
        button: 0,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.parado = true;
        },
      };
      alvo?.dispatchEvent(evento);
    });
  }

  async function redimensionar(largura: number) {
    await act(async () => {
      layout.largura = largura;
      ObservadorFalso.mudouDeTamanho();
    });
  }

  // O rotulo ("Transcrição do assistente: ", 27 caracteres) vem junto.
  const CURTA = "Quero marcar uma consulta."; // 53 com o rotulo: 2 linhas de 40
  const LONGA = "Oi, ".repeat(75); // 327 com o rotulo: 9 linhas de 40

  it("texto curto, que cabe nas duas linhas: sem ver mais; o paragrafo fechado em duas linhas e observado", async () => {
    await montar(CURTA);
    expect(paragrafo()?.textContent).toBe(`${TEXTOS_DA_LEITURA.transcricao} ${CURTA}`);
    expect(paragrafo()?.classes).toContain("line-clamp-2");
    expect(botao()).toBeNull();
    expect(ObservadorFalso.observados()).toEqual([paragrafo()]);
  });

  // RR2 de 88e9560 (baixo 5): o limite da medida. O mutante que troca o
  // "clientHeight + 1" por "+ 25" sobrevivia: nenhum texto ficava so uma
  // linha alem das duas. A linha a mais (de 20 px e da menor, de 16 px)
  // sempre mostra o ver mais; o 1 px do arredondamento, nunca.
  it.each([20, 16])(
    "o texto exatamente uma linha alem das duas (linha de %i px): ver mais, pela medida (a estimativa nao pega)",
    async (alturaDaLinha) => {
      layout.alturaDaLinha = alturaDaLinha;
      // 81 caracteres com o rotulo: duas linhas cheias de 40 e 1 na terceira.
      const tresLinhas = "a".repeat(2 * 40 + 1 - TEXTOS_DA_LEITURA.transcricao.length - 1);
      expect(transcricaoPareceLonga(tresLinhas)).toBe(false);
      await montar(tresLinhas);
      expect(paragrafo()?.textContent).toHaveLength(81);
      expect(paragrafo()?.scrollHeight).toBe(3 * alturaDaLinha);
      expect(paragrafo()?.clientHeight).toBe(2 * alturaDaLinha);
      expect(botao()?.textContent).toBe(TEXTOS_DA_LEITURA.verMais);
    },
  );

  it("o arredondamento de 1 px na altura do conteudo nao e uma linha: sem ver mais", async () => {
    layout.sobra = 1;
    // 80 caracteres com o rotulo: duas linhas cheias de 40.
    const duasLinhas = "a".repeat(2 * 40 - TEXTOS_DA_LEITURA.transcricao.length - 1);
    await montar(duasLinhas);
    const caixa = paragrafo()?.clientHeight ?? Number.NaN;
    expect(paragrafo()?.scrollHeight).toBe(caixa + 1);
    expect(botao()).toBeNull();
  });

  it("texto longo: ver mais, com o estado para o leitor de tela", async () => {
    await montar(LONGA);
    expect(botao()?.textContent).toBe(TEXTOS_DA_LEITURA.verMais);
    expect(botao()?.getAttribute("aria-expanded")).toBe("false");
    expect(botao()?.getAttribute("aria-controls")).toBe(
      paragrafo()?.getAttribute("id"),
    );
  });

  it("a medida vence a estimativa: o texto que parece longo mas cabe na bolha larga fica sem ver mais", async () => {
    const media = "a".repeat(70); // 97 com o rotulo: passa dos 90 da estimativa
    expect(transcricaoPareceLonga(media)).toBe(true);
    layout.largura = 60; // 2 linhas
    await montar(media);
    expect(botao()).toBeNull();
  });

  it("a troca de tamanho muda o estado: a bolha estreita mostra o ver mais, a larga tira", async () => {
    layout.largura = 60;
    await montar("a".repeat(70)); // 97 caracteres: 2 linhas de 60
    expect(botao()).toBeNull();
    await redimensionar(30); // 4 linhas de 30: passa das duas
    expect(botao()?.textContent).toBe(TEXTOS_DA_LEITURA.verMais);
    await redimensionar(60);
    expect(botao()).toBeNull();
  });

  it("o texto novo no mesmo paragrafo mede de novo, mesmo sem a caixa mudar de tamanho (o line-clamp segura a altura)", async () => {
    // Duas linhas cheias: a caixa ja tem a altura do line-clamp-2.
    const duasLinhas = "a".repeat(80 - 27);
    await montar(duasLinhas);
    expect(botao()).toBeNull();
    const caixa = paragrafo()?.clientHeight;
    const elemento = paragrafo();
    await act(async () => {
      raiz?.render(<LeituraDoAssistente leitura={leitura({ transcricao: LONGA })} />);
    });
    // O mesmo paragrafo, com a caixa do mesmo tamanho: o ResizeObserver de
    // verdade nao avisaria. Quem mede e o efeito, pelo texto novo.
    expect(paragrafo()).toBe(elemento);
    expect(paragrafo()?.clientHeight).toBe(caixa);
    expect(botao()?.textContent).toBe(TEXTOS_DA_LEITURA.verMais);
  });

  it("aberta: ver menos, sem o line-clamp e sem observar; fechada, mede de novo na largura de agora", async () => {
    await montar(LONGA);
    await clicar(botao());
    expect(botao()?.textContent).toBe(TEXTOS_DA_LEITURA.verMenos);
    expect(botao()?.getAttribute("aria-expanded")).toBe("true");
    expect(paragrafo()?.classes).not.toContain("line-clamp-2");
    // Aberta, nada e medido (o texto inteiro esta a vista).
    expect(ObservadorFalso.observados()).toEqual([]);
    // A bolha fica larga com ela aberta: o texto passa a caber em uma linha.
    await redimensionar(400);
    await clicar(botao());
    // Fechada, o efeito mede de novo: cabe, e o botao some.
    expect(paragrafo()?.classes).toContain("line-clamp-2");
    expect(botao()).toBeNull();
    expect(ObservadorFalso.observados()).toEqual([paragrafo()]);
  });

  it("a medida que chega junto com o clique (a bolha alargou no mesmo quadro): aberta, o ver menos fica", async () => {
    // A medida do ResizeObserver ("agora cabe") fica na fila do React e o
    // clique (mais urgente) abre antes dela: aberta, com a medida de que
    // cabe. Sem o "|| aberta", o botao sumia com a transcricao aberta, e
    // nada mais a fechava (aberta, o efeito nao mede).
    await montar(LONGA);
    const verMais = botao();
    expect(verMais?.textContent).toBe(TEXTOS_DA_LEITURA.verMais);
    await act(async () => {
      layout.largura = 400;
      ObservadorFalso.mudouDeTamanho();
      verMais?.dispatchEvent({
        type: "click",
        bubbles: true,
        cancelable: true,
        target: null,
        currentTarget: null,
        defaultPrevented: false,
        parado: false,
        timeStamp: 0,
        button: 0,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.parado = true;
        },
      });
    });
    expect(paragrafo()?.classes).not.toContain("line-clamp-2");
    expect(botao()?.textContent).toBe(TEXTOS_DA_LEITURA.verMenos);
    expect(botao()?.getAttribute("aria-expanded")).toBe("true");
    // E fecha: o efeito mede de novo, cabe, e o botao some.
    await clicar(botao());
    expect(botao()).toBeNull();
  });
});
