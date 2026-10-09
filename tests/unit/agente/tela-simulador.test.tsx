import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  Fala,
  fraseFixaPorBloqueio,
  mensagensParaOServidor,
  Simulador,
  Trilha,
} from "@/components/agente/simulador";
import {
  CENARIOS_DO_SIMULADOR,
  ehCenario,
  FALAS_ENVIADAS_PELO_SIMULADOR,
} from "@/components/agente/textos";
import type { FalaDoSimulador } from "@/components/agente/tipos";
import { TooltipProvider } from "@/components/ui/tooltip";
import { problemaNoTextoDoAgente } from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

import { DICA_RECEPCAO } from "./tela-fixtures";

// Simulador da Tela 6: o aviso de dado de teste, os cenarios do brief, o
// motivo quando o assistente nao pode responder, a recepcao desabilitada com
// dica, as bolhas (paciente e IA com o selo), a frase fixa (bloqueio com
// ShieldBan alert, como o Atendimento; passar para a equipe com UsersRound
// neutro), a assinatura devolvida ao servidor, o cartao que rola por dentro
// e a trilha do "Por que a IA respondeu isso". Nada aqui chama a acao: o
// simulador so roda no clique.

function render(props: Partial<Parameters<typeof Simulador>[0]> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Simulador
        nomeDoAssistente="Ana"
        podeUsar
        dica={null}
        motivo={null}
        aoSimular={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("simulador", () => {
  it("avisa para usar dados de teste e começa vazio", () => {
    const visivel = texto(render());
    expect(visivel).toContain(
      "Use dados de teste. Não escreva dados de pacientes reais.",
    );
    expect(visivel).toContain("Escolha um cenário ou escreva uma mensagem");
    expect(visivel).toContain("Simulador");
    expect(visivel).toContain("Reiniciar");
  });

  it("Enviar começa desabilitado (campo vazio) e o campo, liberado", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).not.toMatch(
      /<textarea[^>]*id="agente-simulador-mensagem"[^>]*disabled=""/,
    );
  });

  it("quando o assistente não pode responder, diz o motivo e trava o envio", () => {
    const motivo = "O interruptor geral da IA está desligado.";
    const html = render({ motivo });
    expect(texto(html)).toContain(motivo);
    expect(texto(html)).toContain("O assistente ainda não responde aqui");
    expect(html).toMatch(
      /<textarea[^>]*id="agente-simulador-mensagem"[^>]*disabled=""/,
    );
  });

  it("a recepção vê tudo desabilitado, sem o motivo do ambiente", () => {
    const html = render({
      podeUsar: false,
      dica: DICA_RECEPCAO,
      motivo: "O interruptor geral da IA está desligado.",
    });
    expect(texto(html)).not.toContain("O interruptor geral");
    expect(html).toMatch(
      /<textarea[^>]*id="agente-simulador-mensagem"[^>]*disabled=""/,
    );
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

describe("cenários", () => {
  it("são os 4 do brief, nesta ordem", () => {
    expect(CENARIOS_DO_SIMULADOR.map((c) => c.rotulo)).toEqual([
      "Paciente perguntando preço",
      "Paciente querendo agendar",
      "Paciente descrevendo sintoma",
      "Paciente irritado",
    ]);
    expect(ehCenario("preco")).toBe(true);
    expect(ehCenario("outro")).toBe(false);
  });

  it("as mensagens de exemplo não têm dado pessoal (telefone, CEP, e-mail)", () => {
    for (const cenario of CENARIOS_DO_SIMULADOR) {
      const problema = problemaNoTextoDoAgente(cenario.mensagem, "pergunta");
      expect(problema ?? "", cenario.chave).not.toMatch(
        /telefone|CEP|e-mail|CPF|número longo/,
      );
    }
  });
});

describe("falas", () => {
  it("paciente à esquerda com a pele do Atendimento", () => {
    const html = renderToStaticMarkup(
      <Fala
        fala={{ id: "f1", autor: "paciente", texto: "Quanto custa?" }}
        nomeDoAssistente="Ana"
      />,
    );
    expect(html).toContain("justify-start");
    expect(html).toContain("rounded-bl-[6px]");
    expect(texto(html)).toContain("Paciente");
    expect(texto(html)).toContain("Quanto custa?");
  });

  it("resposta do assistente à direita, com o nome e o selo IA", () => {
    const html = renderToStaticMarkup(
      <Fala
        fala={{
          id: "f2",
          autor: "assistente",
          texto: "A consulta custa R$ 200,00.",
          tipo: "resposta",
          trilha: [],
        }}
        nomeDoAssistente="Ana"
      />,
    );
    expect(html).toContain("justify-items-end");
    expect(html).toContain("bg-bubble-ai");
    const visivel = texto(html);
    expect(visivel).toContain("Ana");
    expect(visivel).toContain(" IA ");
    expect(visivel).toContain("Por que a IA respondeu isso");
  });

  it("passar para a equipe sem bloqueio: Aviso neutro com UsersRound, nunca ShieldBan", () => {
    const html = renderToStaticMarkup(
      <Fala
        fala={{
          id: "f3",
          autor: "assistente",
          texto: FRASE_DE_ESCALONAMENTO,
          tipo: "frase_fixa",
          trilha: [{ tipo: "equipe", texto: "Passou para a equipe: sintoma" }],
        }}
        nomeDoAssistente="Ana"
      />,
    );
    expect(html).toContain('data-tom="neutral"');
    expect(html).toContain("lucide-users-round");
    expect(html).not.toContain("lucide-shield-ban");
    expect(html).not.toContain("bg-bubble-ai");
    const visivel = texto(html);
    expect(visivel).toContain("A conversa passou para a equipe");
    expect(visivel).toContain(FRASE_DE_ESCALONAMENTO);
    expect(visivel).toContain("a conversa passa para a equipe");
  });

  it("bloqueio da conformidade: o mesmo ShieldBan em alert do Atendimento (C18)", () => {
    const trilha = [
      {
        tipo: "bloqueio" as const,
        texto:
          "A resposta foi bloqueada pela conformidade: promessa de resultado.",
      },
      { tipo: "equipe" as const, texto: "Passou para a equipe: conformidade" },
    ];
    expect(fraseFixaPorBloqueio(trilha)).toBe(true);
    const html = renderToStaticMarkup(
      <Fala
        fala={{
          id: "f4",
          autor: "assistente",
          texto: FRASE_DE_ESCALONAMENTO,
          tipo: "frase_fixa",
          trilha,
          rascunhoBloqueado: null,
        }}
        nomeDoAssistente="Ana"
      />,
    );
    expect(html).toContain('data-tom="alert"');
    expect(html).toContain("lucide-shield-ban");
    expect(html).not.toContain('data-tom="warning"');
    expect(texto(html)).toContain("Resposta da IA bloqueada pela conformidade");
    // Sem o texto do servidor (quem nao e super admin), nada de "Ver o que
    // o assistente ia responder".
    expect(texto(html)).not.toContain("Ver o que o assistente ia responder");
  });

  it("'Ver o que o assistente ia responder' só quando o servidor manda o texto (super admin)", () => {
    const html = renderToStaticMarkup(
      <Fala
        fala={{
          id: "f5",
          autor: "assistente",
          texto: FRASE_DE_ESCALONAMENTO,
          tipo: "frase_fixa",
          trilha: [{ tipo: "bloqueio", texto: "Bloqueada." }],
          rascunhoBloqueado: "Texto barrado de teste.",
        }}
        nomeDoAssistente="Ana"
      />,
    );
    expect(texto(html)).toContain("Ver o que o assistente ia responder");
  });
});

describe("assinatura do servidor (S2)", () => {
  const falas: FalaDoSimulador[] = [
    { id: "1", autor: "paciente", texto: "Oi" },
    {
      id: "2",
      autor: "assistente",
      texto: "Olá! Como posso ajudar?",
      tipo: "resposta",
      trilha: [],
      rascunhoBloqueado: null,
      assinatura: "v1.2.abc",
    },
    { id: "3", autor: "paciente", texto: "Quanto custa?" },
  ];

  it("a fala do assistente volta com a assinatura exatamente como veio; a do paciente, sem", () => {
    expect(mensagensParaOServidor(falas)).toEqual([
      { autor: "paciente", texto: "Oi" },
      {
        autor: "assistente",
        texto: "Olá! Como posso ajudar?",
        assinatura: "v1.2.abc",
      },
      { autor: "paciente", texto: "Quanto custa?" },
    ]);
  });

  it("nada da trilha nem do texto barrado vai de volta ao servidor", () => {
    const enviada = mensagensParaOServidor(falas)[1];
    expect(Object.keys(enviada ?? {}).sort()).toEqual([
      "assinatura",
      "autor",
      "texto",
    ]);
  });

  it("manda só as últimas falas da janela (20 ou mais, para caber o trecho assinado)", () => {
    const muitas: FalaDoSimulador[] = Array.from({ length: 31 }, (_, i) => ({
      id: String(i),
      autor: i % 2 === 0 ? "paciente" : "assistente",
      texto: `fala ${i}`,
      assinatura: i % 2 === 0 ? undefined : `v1.1.${i}`,
    }));
    const enviadas = mensagensParaOServidor(muitas);
    expect(FALAS_ENVIADAS_PELO_SIMULADOR).toBeGreaterThanOrEqual(20);
    expect(enviadas).toHaveLength(FALAS_ENVIADAS_PELO_SIMULADOR);
    expect(enviadas[enviadas.length - 1]?.texto).toBe("fala 30");
  });
});

describe("cartão do simulador em tela baixa (achado 4)", () => {
  const html = render();
  const cartao = html.match(/<div[^>]*role="region"[^>]*>/)?.[0] ?? "";

  it("o cartão rola por dentro: quem rola é o corpo, e o cartão recorta", () => {
    // O Card com o overflow-hidden dele (nada vaza do raio); o cabecalho
    // fica parado e o corpo rola.
    expect(cartao).toContain("overflow-hidden");
    expect(cartao).not.toMatch(/\boverflow-(auto|y-auto)\b/);
    const corpo =
      html.match(/<div[^>]*data-slot="card-content"[^>]*>/)?.[0] ?? "";
    expect(corpo).toContain("min-h-0");
    expect(corpo).toContain("flex-1");
    expect(corpo).toContain("overflow-y-auto");
  });

  it("o espaço de baixo e o anel de foco ficam dentro da área que rola", () => {
    const corpo =
      html.match(/<div[^>]*data-slot="card-content"[^>]*>/)?.[0] ?? "";
    // O padding de baixo do proprio corpo pode ficar fora da rolagem: o
    // espaco de baixo e o padding do formulario, que rola junto.
    expect(corpo).toContain("pb-0");
    const formulario =
      html.match(
        /<form[^>]*aria-label="Mensagem para o simulador"[^>]*>/,
      )?.[0] ?? "";
    expect(formulario).toMatch(/\bpb-4\b/);
    // O teclado leva o Enviar para a vista com folga para o anel de foco.
    expect(corpo).toContain("scroll-p-4");
    // O formulario (com o Enviar) e o ultimo item do corpo, e o corpo, o
    // ultimo do cartao: o espaco de baixo dele e o fim da rolagem.
    const fimDoFormulario = html.lastIndexOf("</form>");
    expect(html.indexOf('type="submit"')).toBeLessThan(fimDoFormulario);
    expect(html.slice(fimDoFormulario)).toBe("</form></div></div>");
  });

  it("a conversa tem piso de altura também no desktop", () => {
    const log = html.match(/<div[^>]*role="log"[^>]*>/)?.[0] ?? "";
    expect(log).toContain("lg:min-h-48");
    expect(log).not.toContain("lg:min-h-0");
  });

  it("a caixa de texto cresce até um teto e rola", () => {
    const caixa =
      html.match(/<textarea[^>]*id="agente-simulador-mensagem"[^>]*>/)?.[0] ??
      "";
    expect(caixa).toContain("max-h-32");
    expect(caixa).toContain("overflow-y-auto");
  });
});

describe("Por que a IA respondeu isso", () => {
  it("lista o que o assistente consultou, cada passo com ícone", () => {
    const html = renderToStaticMarkup(
      <Trilha
        trilha={[
          { tipo: "preco", texto: "Consultou o preço de Limpeza de pele" },
          {
            tipo: "base",
            texto: "Usou a pergunta da base: Tem estacionamento?",
          },
        ]}
      />,
    );
    const visivel = texto(html);
    expect(visivel).toContain("Consultou o preço de Limpeza de pele");
    expect(visivel).toContain("Usou a pergunta da base: Tem estacionamento?");
    expect(html.match(/<svg/g)).toHaveLength(2);
  });

  it("o passo do bloqueio usa o ShieldBan em alert; os outros, neutros", () => {
    const html = renderToStaticMarkup(
      <Trilha
        trilha={[
          { tipo: "bloqueio", texto: "A resposta foi bloqueada." },
          { tipo: "equipe", texto: "Passou para a equipe: conformidade" },
        ]}
      />,
    );
    expect(html).toMatch(/lucide-shield-ban[^"]*text-alert-text/);
    expect(html).toMatch(/lucide-users-round[^"]*text-text-secondary/);
  });

  it("o passo 'sem consulta' do servidor aparece como veio", () => {
    expect(
      texto(
        renderToStaticMarkup(
          <Trilha
            trilha={[
              {
                tipo: "outro",
                texto: "Respondeu só com a configuração, sem consultar nada.",
              },
            ]}
          />,
        ),
      ),
    ).toContain("Respondeu só com a configuração, sem consultar nada.");
  });

  it("sem passo, diz que respondeu só com a configuração", () => {
    expect(texto(renderToStaticMarkup(<Trilha trilha={[]} />))).toContain(
      "Respondeu só com a configuração, sem consultar nada.",
    );
  });
});
