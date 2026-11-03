import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O fio importa as acoes do cabecalho (Server Actions); aqui so o rotulo, a
// bolha e a citacao importam.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
}));

import { AUTOR_DO_AVISO_AUTOMATICO } from "@/components/atendimento/aviso-automatico";
import { autorDaCitacao } from "@/components/atendimento/citacao";
import {
  LINHA_DO_PREPARO_APROVADO,
  MessageBubble,
} from "@/components/atendimento/message-bubble";
import { AUTOR_PELO_CELULAR } from "@/components/atendimento/pelo-celular";
import {
  AUTOR_DA_AUTOMACAO,
  autorDaBolha,
} from "@/components/atendimento/thread";
import { CABECALHO_DA_NOTA_DA_PASSAGEM } from "@/lib/agente/nota-da-passagem";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  CABECALHO_DO_PREPARO,
  ehMensagemDoPreparo,
  LINHA_DO_RT,
  mensagemDoPreparo,
  RODAPE_DO_PREPARO,
} from "@/lib/domain/preparo";
import type { MessageItem, QuotedMessage } from "@/lib/queries/conversations";

// AG7 (03/11/2026, contrato 3.3 e 7.4; desenho 5.5): a orientacao de preparo
// aprovada pelo responsavel tecnico (RT) sai como mensagem do SISTEMA
// (author 'sistema', pelo job da IA), montada pelo banco: o cabecalho fixo,
// o texto aprovado e o rodape fixo. No Atendimento ela assina "Assistente",
// na pele e com a linha de autor da IA (o brilho e o selo "IA"), e ganha
// DENTRO da bolha a linha "Texto aprovado pelo responsável técnico", na cor
// de apoio da pele e sem icone (o ScanText e so da leitura da midia). A
// citacao dela tambem diz "Assistente". A frase fixa, a nota da passagem e o
// texto da equipe continuam como hoje: so o corpo no formato inteiro, do
// sistema, vira preparo. O fio traz o job_id (revisao das telas, TELA-13): o
// corpo no formato do preparo sem job nao e o preparo. Nada aqui chama rede.

// A meia-risca (U+2013) e o travessao (U+2014), montados pelo codigo para
// que nenhum dos dois apareca neste arquivo.
const TRAVESSAO = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const ANA = "22222222-2222-4222-8222-222222222222";
const NOMES: Record<string, string> = { [ANA]: "Ana Recepção" };

/** O RT de teste (ficticio). */
const RT = {
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  uf: "CE",
  numero: "12345",
};

/** Um texto aprovado de teste (ficticio), com quebra de linha. */
const TEXTO =
  "Jejum de 8 horas antes do exame.\nTraga o pedido médico e um documento com foto.";

/** A mensagem que o sistema envia (a mesma montagem do banco). */
const PREPARO = mensagemDoPreparo({
  procedimento: "Colonoscopia",
  rt: RT,
  texto: TEXTO,
});

/** A mensagem sem o rodape: nao e o preparo. */
const SEM_RODAPE = `${CABECALHO_DO_PREPARO}Colonoscopia\n${LINHA_DO_RT}Dra. Ana Souza (CRM-CE 12345)\n\n${TEXTO}`;

const RAIZ = path.resolve(__dirname, "../../..");

/** O job da IA que enviou o preparo (ficticio). */
const JOB_DA_IA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Os arquivos do Atendimento com bloco da AG7. */
const ARQUIVOS_DA_AG7 = [
  "components/atendimento/thread.tsx",
  "components/atendimento/message-bubble.tsx",
  "components/atendimento/citacao.tsx",
];

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    conversation_id: "33333333-3333-4333-8333-333333333333",
    direction: "saida",
    author: "sistema",
    author_user_id: null,
    content_type: "texto",
    body: PREPARO,
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: "entregue",
    error_code: null,
    created_at: "2026-11-03T13:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    pelo_celular: false,
    job_id: JOB_DA_IA,
    ...campos,
  };
}

function citada(campos: Partial<QuotedMessage> = {}): QuotedMessage {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    author: "sistema",
    author_user_id: null,
    content_type: "texto",
    body: PREPARO,
    is_internal_note: false,
    deleted_at: null,
    pelo_celular: false,
    job_id: JOB_DA_IA,
    ...campos,
  };
}

function bolha(
  message: MessageItem,
  extra: Partial<Parameters<typeof MessageBubble>[0]> = {},
): string {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      authorName={autorDaBolha(message, NOMES)}
      authorNames={NOMES}
      timezone="America/Fortaleza"
      {...extra}
    />,
  );
}

/** O que vem antes da bolha: a linha de autor. */
function linhaDeAutor(html: string): string {
  return html.slice(0, html.indexOf("data-bolha"));
}

/** A bolha em si (da div com data-bolha ao fim). */
function dentroDaBolha(html: string): string {
  return html.slice(html.indexOf("data-bolha"));
}

/** As classes da bolha (a div com data-bolha). */
function classesDaBolha(html: string): string {
  const inicio = html.lastIndexOf("<div", html.indexOf("data-bolha"));
  return html.slice(inicio, html.indexOf(">", inicio));
}

/** A linha do texto aprovado (o paragrafo inteiro), ou "" sem ela. */
function linhaDoTextoAprovado(html: string): string {
  return /<p data-preparo-aprovado[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
}

/** O texto visivel, sem as tags e com um espaco so. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("AG7: a mensagem do preparo no Atendimento", () => {
  it("o corpo que o sistema envia: cabeçalho, linha do RT, texto aprovado e rodapé", () => {
    expect(PREPARO).toBe(
      `Orientação de preparo para Colonoscopia\nResponsável técnico da clínica: Dra. Ana Souza (CRM-CE 12345)\n\n${TEXTO}\n\n${RODAPE_DO_PREPARO}`,
    );
    expect(ehMensagemDoPreparo(mensagem())).toBe(true);
  });

  it("assina Assistente, como a IA, com ou sem o mapa de nomes", () => {
    expect(autorDaBolha(mensagem(), NOMES)).toBe("Assistente");
    expect(autorDaBolha(mensagem(), {})).toBe("Assistente");
  });
});

describe("AG7: a bolha do preparo", () => {
  const html = bolha(mensagem());
  const linha = linhaDeAutor(html);

  it("a linha de autor da IA: o brilho, Assistente e o selo IA, uma vez só", () => {
    expect(linha).toContain("data-preparo");
    expect(linha).toMatch(/lucide-sparkles/);
    expect(linha).toMatch(/bg-ai-bg[^>]*>\s*IA\s*</);
    expect(linha.match(/Assistente/g)).toHaveLength(1);
    expect(linha.match(/>IA</g)).toHaveLength(1);
    for (const outra of [
      AUTOR_DO_AVISO_AUTOMATICO,
      AUTOR_DA_AUTOMACAO,
      AUTOR_PELO_CELULAR,
      "Nota interna",
      "Mensagem agendada",
    ]) {
      expect(linha).not.toContain(outra);
    }
  });

  it("na pele da IA (a cor de apoio dela vale nos dois temas), do lado da clínica, com o tique", () => {
    const classes = classesDaBolha(html);
    expect(classes).toContain("bg-bubble-ai");
    expect(classes).toContain("text-bubble-ai-foreground");
    expect(classes).toContain("[--bolha-meta:var(--bubble-ai-meta)]");
    expect(classes).not.toContain("bg-bubble-out");
    expect(classes).not.toContain("bg-surface-4");
    expect(html).toContain("justify-end");
    expect(html).toContain('data-tique="entregue"');
  });

  it("dentro da bolha, a linha Texto aprovado pelo responsável técnico, na cor de apoio e sem ícone", () => {
    expect(LINHA_DO_PREPARO_APROVADO).toBe(
      "Texto aprovado pelo responsável técnico",
    );
    const paragrafo = linhaDoTextoAprovado(html);
    expect(paragrafo).toContain(`>${LINHA_DO_PREPARO_APROVADO}</p>`);
    // A cor de apoio da pele (token, nunca hex solto), no molde da leitura
    // da midia; so texto: nem o ScanText, nem outro icone.
    expect(paragrafo).toContain("text-(--bolha-meta)");
    expect(paragrafo).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(paragrafo).not.toContain("<svg");
    expect(html).not.toContain("lucide-scan-text");
    // Dentro da bolha, nunca na linha de autor, e uma vez so.
    expect(linha).not.toContain(LINHA_DO_PREPARO_APROVADO);
    const dentro = dentroDaBolha(html);
    expect(
      dentro.match(/Texto aprovado pelo responsável técnico/g),
    ).toHaveLength(1);
    // Depois do texto da mensagem (o rodape) e antes da hora com o tique.
    expect(dentro.indexOf(paragrafo)).toBeGreaterThan(
      dentro.indexOf(RODAPE_DO_PREPARO),
    );
    expect(dentro.indexOf(paragrafo)).toBeLessThan(
      dentro.indexOf("data-tique"),
    );
  });

  it("o texto da mensagem inteiro, com as quebras de linha preservadas", () => {
    const corpo =
      /<p class="break-words whitespace-pre-wrap">([\s\S]*?)<\/p>/.exec(
        html,
      )?.[1];
    expect(corpo).toBe(PREPARO);
  });

  it("apagada: a lápide, sem a linha de autor e sem a linha do texto aprovado", () => {
    const apagada = bolha(
      mensagem({
        body: null,
        deleted_at: "2026-11-03T13:05:00.000Z",
        deleted_by: ANA,
        deleted_source: "clinica",
        deleted_escopo: "todos",
      }),
    );
    expect(apagada).toContain("Ana Recepção apagou esta mensagem.");
    expect(apagada).not.toContain("data-preparo");
    expect(apagada).not.toContain(LINHA_DO_PREPARO_APROVADO);
    expect(apagada).not.toContain(">IA<");
  });

  it("nunca a linha da mensagem agendada", () => {
    const agendada = { criadaPor: ANA, editadaPor: null };
    const comAgendada = bolha(mensagem(), { agendada });
    expect(comAgendada).not.toContain("Mensagem agendada");
    expect(linhaDeAutor(comAgendada)).toContain("data-preparo");
    // Controle: a mesma agendada numa mensagem da regua mostra a linha.
    const regua = bolha(
      mensagem({ body: "Lembrete: sua consulta é amanhã às 9h." }),
      { agendada },
    );
    expect(regua).toContain("Mensagem agendada");
  });
});

describe("AG7: o que não é o preparo continua como hoje", () => {
  it("a frase fixa de escalonamento: Aviso automático, na pele neutra, sem a linha do texto aprovado", () => {
    const frase = mensagem({ body: FRASE_DE_ESCALONAMENTO });
    expect(ehMensagemDoPreparo(frase)).toBe(false);
    expect(autorDaBolha(frase, NOMES)).toBe(AUTOR_DO_AVISO_AUTOMATICO);
    const html = bolha(frase);
    expect(linhaDeAutor(html)).toContain("data-aviso-automatico");
    expect(linhaDeAutor(html)).not.toContain(">IA<");
    expect(classesDaBolha(html)).toContain("bg-surface-4");
    expect(html).not.toContain("data-preparo");
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
  });

  it("a nota da passagem: Assistente na pele da nota, sem a linha do texto aprovado", () => {
    const nota = mensagem({
      is_internal_note: true,
      delivery_status: null,
      body: `${CABECALHO_DA_NOTA_DA_PASSAGEM}\nParou em: o paciente descreveu um sintoma.`,
    });
    expect(ehMensagemDoPreparo(nota)).toBe(false);
    expect(autorDaBolha(nota, NOMES)).toBe("Assistente");
    const html = bolha(nota);
    expect(linhaDeAutor(html)).toContain("data-nota-da-ia");
    expect(linhaDeAutor(html)).toContain("Nota interna, o paciente não vê");
    expect(classesDaBolha(html)).toContain("bg-warning-bg");
    expect(html).not.toContain("data-preparo");
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
  });

  it("a nota interna com o mesmo texto do preparo continua Automação", () => {
    const nota = mensagem({ is_internal_note: true, delivery_status: null });
    expect(ehMensagemDoPreparo(nota)).toBe(false);
    expect(autorDaBolha(nota, NOMES)).toBe(AUTOR_DA_AUTOMACAO);
    const html = bolha(nota);
    expect(classesDaBolha(html)).toContain("bg-warning-bg");
    expect(linhaDeAutor(html)).not.toMatch(/lucide-sparkles/);
    expect(html).not.toContain("data-preparo");
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
  });

  const DA_EQUIPE: readonly {
    caso: string;
    campos: Partial<MessageItem>;
    autor: string | null;
  }[] = [
    {
      caso: "a pessoa da equipe (usuario, com author_user_id)",
      campos: { author: "usuario", author_user_id: ANA },
      autor: "Ana Recepção",
    },
    {
      caso: "o usuario sem pessoa no sistema",
      campos: { author: "usuario" },
      autor: null,
    },
    {
      caso: "o sistema com uma pessoa (author_user_id)",
      campos: { author_user_id: ANA },
      autor: "Ana Recepção",
    },
    {
      caso: "a resposta automática do app pelo celular (sistema)",
      campos: { pelo_celular: true },
      autor: AUTOR_PELO_CELULAR,
    },
    {
      caso: "a pessoa da clínica pelo celular (usuario)",
      campos: { author: "usuario", pelo_celular: true },
      autor: AUTOR_PELO_CELULAR,
    },
  ];

  it.each(DA_EQUIPE)(
    "$caso, com o mesmo texto: pele da atendente, sem a linha do texto aprovado",
    ({ campos, autor }) => {
      const daEquipe = mensagem(campos);
      expect(ehMensagemDoPreparo(daEquipe)).toBe(false);
      expect(autorDaBolha(daEquipe, NOMES)).toBe(autor);
      const html = bolha(daEquipe);
      const classes = classesDaBolha(html);
      expect(classes).toContain("bg-bubble-out");
      expect(classes).not.toContain("bg-bubble-ai");
      expect(linhaDeAutor(html)).not.toContain(">IA<");
      if (autor !== null) {
        expect(linhaDeAutor(html)).toContain(autor);
      }
      expect(html).not.toContain("data-preparo");
      expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
    },
  );

  it.each([
    ["só o cabeçalho", `${CABECALHO_DO_PREPARO}Colonoscopia`],
    ["o cabeçalho, o RT e o texto, sem o rodapé", SEM_RODAPE],
    [
      "sem a linha do RT",
      `${CABECALHO_DO_PREPARO}Colonoscopia\n\n${TEXTO}\n\n${RODAPE_DO_PREPARO}`,
    ],
    ["com mais texto depois do rodapé", `${PREPARO}\nQualquer coisa, chame.`],
    ["com mais texto antes do cabeçalho", `Oi, Maria!\n${PREPARO}`],
    ["a mensagem da régua", "Lembrete: sua consulta é amanhã às 9h."],
  ])(
    "%s: não vira preparo (sem linha de autor, na pele da atendente)",
    (_caso, body) => {
      const quase = mensagem({ body });
      expect(ehMensagemDoPreparo(quase)).toBe(false);
      expect(autorDaBolha(quase, NOMES)).toBeNull();
      const html = bolha(quase);
      expect(classesDaBolha(html)).toContain("bg-bubble-out");
      expect(linhaDeAutor(html)).not.toContain("Assistente");
      expect(html).not.toContain("data-preparo");
      expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
      expect(autorDaCitacao(citada({ body }), "Maria", NOMES)).toBe("Sistema");
    },
  );

  it("a resposta da IA continua da IA, sem a linha do texto aprovado", () => {
    const daIa = mensagem({ author: "ia" });
    expect(ehMensagemDoPreparo(daIa)).toBe(false);
    expect(autorDaBolha(daIa, NOMES)).toBe("Assistente");
    const html = bolha(daIa);
    expect(classesDaBolha(html)).toContain("bg-bubble-ai");
    expect(linhaDeAutor(html).match(/>IA</g)).toHaveLength(1);
    expect(html).not.toContain("data-preparo");
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
  });

  it("o paciente que manda o mesmo texto continua paciente", () => {
    const doPaciente = mensagem({
      direction: "entrada",
      author: "paciente",
      delivery_status: null,
    });
    expect(ehMensagemDoPreparo(doPaciente)).toBe(false);
    expect(autorDaBolha(doPaciente, NOMES)).toBeNull();
    const html = bolha(doPaciente);
    expect(html).toContain("justify-start");
    expect(classesDaBolha(html)).toContain("bg-card");
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
  });

  it("com arquivo, não é o preparo (a mensagem do sistema é só texto)", () => {
    for (const campos of [
      { content_type: "imagem", media_url: "storage://midia-conversas/c/f" },
      { content_type: "documento", media_url: "storage://midia-conversas/c/d" },
      {
        media_url: "storage://midia-conversas/c/v",
        media_mimetype: "video/mp4",
      },
    ] as const satisfies readonly Partial<MessageItem>[]) {
      expect(
        ehMensagemDoPreparo(mensagem(campos)),
        JSON.stringify(campos),
      ).toBe(false);
      expect(autorDaBolha(mensagem(campos), NOMES)).toBeNull();
    }
  });
});

describe("AG7: o corpo no formato do preparo sem job não é o preparo (TELA-13)", () => {
  it("sem job: nem Assistente, nem a linha do texto aprovado, nem na citação", () => {
    const semJob = mensagem({ job_id: null });
    expect(ehMensagemDoPreparo(semJob)).toBe(false);
    expect(autorDaBolha(semJob, NOMES)).toBeNull();
    const html = bolha(semJob);
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
    expect(html).not.toContain("data-preparo");
    expect(autorDaCitacao(citada({ job_id: null }), "Maria", NOMES)).toBe(
      "Sistema",
    );
  });

  it("o fio e a citada trazem o job_id do banco", () => {
    const fonte = readFileSync(
      path.join(RAIZ, "lib/queries/conversations.ts"),
      "utf8",
    );
    const select = /const MESSAGE_SELECT =([\s\S]*?);\n/.exec(fonte)?.[1] ?? "";
    expect(select).toMatch(/pelo_celular, job_id, /);
    expect(select).toMatch(/reply_to:reply_to_message_id\([^)]*\bjob_id\)/);
  });
});

describe("AG7: a citação do preparo", () => {
  it("diz Assistente; a frase fixa, a nota, a régua, a equipe e o celular continuam como antes", () => {
    expect(autorDaCitacao(citada(), "Maria", NOMES)).toBe("Assistente");
    expect(
      autorDaCitacao(citada({ body: FRASE_DE_ESCALONAMENTO }), "Maria", NOMES),
    ).toBe(AUTOR_DO_AVISO_AUTOMATICO);
    expect(
      autorDaCitacao(
        citada({
          is_internal_note: true,
          body: `${CABECALHO_DA_NOTA_DA_PASSAGEM}\nParou em: o paciente descreveu um sintoma.`,
        }),
        "Maria",
        NOMES,
      ),
    ).toBe("Assistente");
    // A nota interna com o mesmo texto: a citacao da nota de automacao.
    expect(
      autorDaCitacao(citada({ is_internal_note: true }), "Maria", NOMES),
    ).toBe("Sistema");
    expect(
      autorDaCitacao(
        citada({ author: "usuario", author_user_id: ANA }),
        "Maria",
        NOMES,
      ),
    ).toBe("Ana Recepção");
    expect(autorDaCitacao(citada({ pelo_celular: true }), "Maria", NOMES)).toBe(
      AUTOR_PELO_CELULAR,
    );
    expect(autorDaCitacao(citada({ author: "ia" }), "Maria", NOMES)).toBe(
      "Assistente",
    );
    expect(
      autorDaCitacao(citada({ content_type: "imagem" }), "Maria", NOMES),
    ).toBe("Sistema");
  });

  it("a bolha que responde ao preparo mostra a citação assinada Assistente", () => {
    const resposta = mensagem({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      direction: "entrada",
      author: "paciente",
      body: "Recebi, obrigada.",
      delivery_status: null,
      reply_to_message_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reply_to: citada(),
    });
    const html = bolha(resposta, { contato: "Maria" });
    expect(texto(html)).toContain(
      "Assistente Orientação de preparo para Colonoscopia",
    );
    // A linha do texto aprovado e da bolha do preparo, nao de quem o cita.
    expect(html).not.toContain(LINHA_DO_PREPARO_APROVADO);
    expect(html).not.toContain("data-preparo");
  });
});

describe("AG7: nenhum travessão", () => {
  it("nem no texto novo, nem na bolha, nem nos arquivos do Atendimento com bloco da AG7", () => {
    // Controle: a regra pega os dois.
    expect(`a${String.fromCharCode(0x2014)}b`).toMatch(TRAVESSAO);
    expect(`a${String.fromCharCode(0x2013)}b`).toMatch(TRAVESSAO);
    expect(LINHA_DO_PREPARO_APROVADO).not.toMatch(TRAVESSAO);
    expect(bolha(mensagem())).not.toMatch(TRAVESSAO);
    for (const arquivo of ARQUIVOS_DA_AG7) {
      const codigo = readFileSync(path.join(RAIZ, arquivo), "utf8");
      expect(codigo, arquivo).not.toMatch(TRAVESSAO);
      expect(codigo, arquivo).toContain("[AG7 preparo] início");
    }
  });
});
