import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// O Dialog do Radix renderiza num portal, que nao existe no servidor: aqui
// ele vira marcacao simples (como em tests/unit/cadastros/modal-de-cadastro).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ className, children }: ComponentProps<"div">) => (
    <div data-parte="conteudo" className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div data-parte="cabecalho">{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({
    className,
    children,
  }: {
    className?: string;
    children: ReactNode;
  }) => (
    <div data-parte="descricao" className={className}>
      {children}
    </div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div data-parte="rodape">{children}</div>
  ),
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/(app)/atendimento/agendadas-actions", () => ({
  agendarMensagemAction: vi.fn(),
  editarAgendadaAction: vi.fn(),
  cancelarAgendadasDaPessoaAction: vi.fn(),
}));
vi.mock("@/app/(app)/configuracoes/actions", () => ({
  desativarMembroAction: vi.fn(),
  mudarPapelAction: vi.fn(),
  reativarMembroAction: vi.fn(),
  vincularProfissionalAction: vi.fn(),
}));

import {
  ajudaDeCancelarAgendadas,
  filtroDoAssinante,
  rotuloDeCancelarAgendadas,
  textoDasAgendadasDaPessoa,
} from "@/components/atendimento/agendadas/contagens";
import {
  ConfirmacaoDeEnviarAgora,
  ConfirmacaoDeExcluir,
  textoDaConfirmacaoDeEnviarAgora,
  textoDaConfirmacaoDeExcluir,
  tituloDaConfirmacaoDeEnviarAgora,
} from "@/components/atendimento/agendadas/confirmacoes-da-agendada";
import {
  campoDoErroDeQuando,
  DialogoDeAgendada,
  fechamentoPermitido,
  type PedidoDeAgendada,
} from "@/components/atendimento/agendadas/dialogo-de-agendada";
import { AgendadasDaPessoa } from "@/components/configuracoes/lista-equipe";
import { textoDasAgendadasDoNumero } from "@/components/whatsapp/numeros";
import {
  ERROS_DA_AGENDADA,
  type AgendadaDaLista,
} from "@/lib/domain/mensagem-agendada";

// Os dialogos da mensagem agendada (secoes 4.2 a 4.4 e 4.6 do desenho, com
// A1 e A5 do desenho final): agendar, editar, as confirmacoes do item, e os
// textos de Configuracoes (Equipe e remover numero).

const FUSO = "America/Fortaleza";
const EU = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";

// 06/10/2026, 09:00 em Fortaleza: o dialogo le o relogio na abertura.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

function agendada(campos: Partial<AgendadaDaLista> = {}): AgendadaDaLista {
  return {
    id: "77777777-7777-4777-8777-777777777771",
    contactId: "44444444-4444-4444-8444-444444444444",
    whatsappAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    conversationId: "55555555-5555-4555-8555-555555555555",
    texto: "Oi, Maria! Seu retorno é amanhã.",
    enviarEm: "2026-10-07T12:00:00.000Z",
    situacao: "agendada",
    motivo: null,
    criadaPor: EU,
    editadaPor: null,
    enviadaEm: null,
    messageId: null,
    dispensadaEm: null,
    criadaEm: "2026-10-06T11:00:00.000Z",
    editadaEm: null,
    ...campos,
  };
}

const AGENDAR: PedidoDeAgendada = {
  tipo: "agendar",
  conversationId: "55555555-5555-4555-8555-555555555555",
  texto: "Bom dia! 😀",
  substitui: null,
  semCitacao: false,
  comAnexo: false,
};

function dialogo(
  pedido: PedidoDeAgendada | null,
  props: Partial<ComponentProps<typeof DialogoDeAgendada>> = {},
): string {
  return renderToStaticMarkup(
    <DialogoDeAgendada
      pedido={pedido}
      aoFechar={() => undefined}
      aoConcluir={() => undefined}
      aoRecarregarLista={() => undefined}
      timezone={FUSO}
      viewerId={EU}
      numero={null}
      {...props}
    />,
  );
}

describe("dialogo Agendar mensagem (4.2)", () => {
  it("fechado nao desenha nada", () => {
    expect(dialogo(null)).toBe("");
  });

  it("titulo, descricao com o WhatsApp da clinica, casca de 520px", () => {
    const html = dialogo(AGENDAR);
    expect(html).toContain("<h2>Agendar mensagem</h2>");
    expect(html).toContain(
      "Sai sozinha na data e hora escolhidas, em seu nome, pelo WhatsApp da clínica.",
    );
    expect(html).toContain("sm:max-w-[520px]");
  });

  it("com mais de um numero: pelo numero, com o marcador da cor", () => {
    const html = dialogo(AGENDAR, {
      numero: { nome: "Recepção", cor: "rosa" },
    });
    expect(html).toContain(
      "Sai sozinha na data e hora escolhidas, em seu nome, pelo número Recepção.",
    );
    expect(html).toContain('data-cor="rosa"');
  });

  it("a mensagem vem do campo, com o contador na regua do envio 1:1", () => {
    const html = dialogo(AGENDAR);
    expect(html).toContain(">Mensagem</label>");
    expect(html).toContain("Bom dia! 😀</textarea>");
    // "Bom dia! 😀" tem 11 unidades UTF-16 (o emoji conta 2), a mesma regua
    // do compositor e do envio 1:1 (F16): o que o dialogo aceita, o Enviar
    // agora tambem aceita.
    expect(html).toMatch(
      /<p data-slot="form-description" id="([^"]+)"[^>]*>11 de 4096<\/p>/,
    );
    // O campo aponta para o contador (e para o erro, quando houver).
    const descricao = /data-slot="form-description" id="([^"]+)"/.exec(html);
    expect(html).toContain(`aria-describedby="${descricao?.[1]}"`);
  });

  it("grupo Quando com os 5 atalhos, data com min e max, hora vazia", () => {
    const html = dialogo(AGENDAR);
    expect(html).toContain("Quando</legend>");
    expect(html).toContain('role="group" aria-label="Atalhos de data"');
    for (const rotulo of [
      "Amanhã",
      "Em 7 dias",
      "Em 30 dias",
      "Em 3 meses",
      "Em 6 meses",
    ]) {
      expect(html).toContain(`aria-pressed="false">${rotulo}</button>`);
    }
    expect(html).toMatch(
      /type="date"[^>]*min="2026-10-06"[^>]*max="2027-10-06"/,
    );
    expect(html).toMatch(/type="time"[^>]*required=""[^>]*value=""/);
  });

  it("sem data e hora, a previa fica vazia, mas a regiao viva existe", () => {
    const html = dialogo(AGENDAR);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("horário da clínica");
  });

  it("os avisos do que fica para tras: citacao e arquivo", () => {
    const html = dialogo({ ...AGENDAR, semCitacao: true, comAnexo: true });
    expect(html).toContain("A mensagem agendada sai sem a citação.");
    expect(html).toContain(
      "Só o texto é agendado. O arquivo anexado continua aqui para enviar agora.",
    );
  });

  it("sem citacao nem arquivo, nenhum aviso", () => {
    const html = dialogo(AGENDAR);
    expect(html).not.toContain("sem a citação");
    expect(html).not.toContain("arquivo anexado");
  });

  it("botoes Voltar e Agendar", () => {
    const html = dialogo(AGENDAR);
    expect(html).toContain(">Voltar</button>");
    expect(html).toMatch(/type="submit"[^>]*>.*Agendar<\/button>/);
    // O ClockPlus e so do botao do compositor (tabela de reservados).
    expect(html).not.toContain("lucide-clock-plus");
  });
});

describe("dialogo Editar mensagem agendada (4.3, A1)", () => {
  it("preenchido com texto, dia e hora da clinica; botao Salvar", () => {
    const html = dialogo({ tipo: "editar", agendada: agendada() });
    expect(html).toContain("<h2>Editar mensagem agendada</h2>");
    expect(html).toContain(
      "Mude o texto, a data ou a hora. A mensagem continua marcada.",
    );
    expect(html).toContain("Oi, Maria! Seu retorno é amanhã.</textarea>");
    expect(html).toMatch(/type="date"[^>]*value="2026-10-07"/);
    expect(html).toMatch(/type="time"[^>]*value="09:00"/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/type="submit"[^>]*>.*Salvar<\/button>/);
    // Com data e hora validas, a previa aparece.
    expect(html).toContain(
      "Sai quarta, 07/10/2026, às 09:00, horário da clínica (pode levar alguns minutos).",
    );
  });

  it("quem edita a de outra pessoa passa a assinar", () => {
    const html = dialogo({
      tipo: "editar",
      agendada: agendada({ criadaPor: ANA }),
    });
    expect(html).toContain(
      "Mude o texto, a data ou a hora. A mensagem continua marcada e passa a sair em seu nome.",
    );
  });

  it("faltando menos de 2 minutos: avisa que pode nao valer", () => {
    const html = dialogo({
      tipo: "editar",
      agendada: agendada({ enviarEm: "2026-10-06T12:01:00.000Z" }),
    });
    expect(html).toContain(
      "Esta mensagem sai em instantes. Se ela começar a sair antes de você salvar, a mudança não vale.",
    );
  });

  it("com folga, sem o aviso", () => {
    expect(dialogo({ tipo: "editar", agendada: agendada() })).not.toContain(
      "sai em instantes",
    );
  });
});

describe("F20: o dialogo nao fecha enquanto agenda ou salva", () => {
  it("Esc, clique fora e X so fecham sem envio em curso", () => {
    expect(fechamentoPermitido(false)).toBe(true);
    expect(fechamentoPermitido(true)).toBe(false);
  });
});

describe("em qual campo o erro de quando aparece", () => {
  it("hora, data, e hora passada num dia que ja passou", () => {
    const hoje = "2026-10-06";
    expect(campoDoErroDeQuando(ERROS_DA_AGENDADA.semHora, "", hoje)).toBe(
      "hora",
    );
    expect(campoDoErroDeQuando(ERROS_DA_AGENDADA.semData, "", hoje)).toBe(
      "data",
    );
    expect(
      campoDoErroDeQuando(ERROS_DA_AGENDADA.horaPassada, "2026-10-06", hoje),
    ).toBe("hora");
    expect(
      campoDoErroDeQuando(ERROS_DA_AGENDADA.horaPassada, "2026-10-05", hoje),
    ).toBe("data");
    expect(
      campoDoErroDeQuando(
        ERROS_DA_AGENDADA.depoisDoTeto("06/10/2027"),
        "2027-12-01",
        hoje,
      ),
    ).toBe("data");
  });
});

describe("confirmacoes do item (4.4)", () => {
  it("excluir: titulo, texto com o contato e os botoes", () => {
    const html = renderToStaticMarkup(
      <ConfirmacaoDeExcluir
        aberto
        aoFechar={() => undefined}
        pendente={false}
        erro={null}
        aoConfirmar={() => undefined}
        contato="Maria Teste"
      />,
    );
    expect(html).toContain("<h2>Excluir esta mensagem agendada?</h2>");
    expect(html).toContain(
      "Ela não vai ser enviada para Maria Teste. Não dá para desfazer.",
    );
    expect(html).toContain(">Manter</button>");
    expect(html).toContain("Excluir mensagem</button>");
  });

  it("excluir com erro: o motivo dentro do dialogo", () => {
    const html = renderToStaticMarkup(
      <ConfirmacaoDeExcluir
        aberto
        aoFechar={() => undefined}
        pendente={false}
        erro={ERROS_DA_AGENDADA.exclusaoPerdeuACorrida}
        aoConfirmar={() => undefined}
        contato="Maria Teste"
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "Esta mensagem já começou a sair e não dá mais para excluir. Confira a conversa.",
    );
  });

  it("enviar agora: titulo, quando, numero e os botoes", () => {
    const html = renderToStaticMarkup(
      <ConfirmacaoDeEnviarAgora
        aberto
        aoFechar={() => undefined}
        pendente
        erro={null}
        aoConfirmar={() => undefined}
        contato="Maria Teste"
        quando="amanhã às 09:00"
        numero="Recepção"
      />,
    );
    expect(html).toContain("<h2>Enviar agora para Maria Teste?</h2>");
    expect(html).toContain(
      "A mensagem marcada para amanhã às 09:00 sai agora, em seu nome, pelo número Recepção.",
    );
    expect(html).toContain(">Manter agendada</button>");
    expect(html).toContain("Enviando...</button>");
  });

  it("os textos sem contato e sem numero", () => {
    expect(textoDaConfirmacaoDeExcluir(null)).toBe(
      "Ela não vai ser enviada para o contato. Não dá para desfazer.",
    );
    expect(tituloDaConfirmacaoDeEnviarAgora(" ")).toBe(
      "Enviar agora para o contato?",
    );
    expect(textoDaConfirmacaoDeEnviarAgora("08/10 às 11:00", null)).toBe(
      "A mensagem marcada para 08/10 às 11:00 sai agora, em seu nome.",
    );
  });
});

describe("Configuracoes (4.6 e A5)", () => {
  it("remover numero: a frase so com agendadas, no singular e no plural", () => {
    expect(textoDasAgendadasDoNumero(0)).toBeNull();
    expect(textoDasAgendadasDoNumero(1)).toBe(
      "1 mensagem agendada deste número não vai sair.",
    );
    expect(textoDasAgendadasDoNumero(3)).toBe(
      "3 mensagens agendadas deste número não vão sair.",
    );
  });

  it("equipe: os textos de A5", () => {
    expect(textoDasAgendadasDaPessoa(4)).toBe(
      "Esta pessoa assina 4 mensagens agendadas.",
    );
    expect(rotuloDeCancelarAgendadas(4)).toBe(
      "Cancelar essas 4 mensagens agendadas",
    );
    expect(ajudaDeCancelarAgendadas(4)).toBe(
      "Sem cancelar, elas saem em nome dela e a conversa fica Sem atendente.",
    );
    expect(textoDasAgendadasDaPessoa(1)).toBe(
      "Esta pessoa assina 1 mensagem agendada.",
    );
  });

  it("equipe: a caixa vem desmarcada, com a ajuda ligada a ela", () => {
    const html = renderToStaticMarkup(
      <AgendadasDaPessoa
        contagem={{ estado: "pronto", n: 2 }}
        cancelar={false}
        aoMarcar={() => undefined}
      />,
    );
    expect(html).toContain("Esta pessoa assina 2 mensagens agendadas.");
    expect(html).toContain('role="checkbox" aria-checked="false"');
    expect(html).toContain("Cancelar essas 2 mensagens agendadas");
    expect(html).toMatch(/aria-describedby="([^"]+)-ajuda"/);
  });

  it("equipe: sem agendadas, nada; lendo, aviso; erro, atencao", () => {
    expect(
      renderToStaticMarkup(
        <AgendadasDaPessoa
          contagem={{ estado: "pronto", n: 0 }}
          cancelar={false}
          aoMarcar={() => undefined}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <AgendadasDaPessoa
          contagem={{ estado: "carregando" }}
          cancelar={false}
          aoMarcar={() => undefined}
        />,
      ),
    ).toContain("Conferindo as mensagens agendadas desta pessoa.");
    expect(
      renderToStaticMarkup(
        <AgendadasDaPessoa
          contagem={{ estado: "erro" }}
          cancelar={false}
          aoMarcar={() => undefined}
        />,
      ),
    ).toContain('data-tom="warning"');
  });

  it("o filtro do assinante so aceita uuid", () => {
    expect(filtroDoAssinante(ANA)).toBe(
      `editada_por.eq.${ANA},and(editada_por.is.null,criada_por.eq.${ANA})`,
    );
    expect(filtroDoAssinante("x),or(id.neq.0")).toBeNull();
  });
});
