import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// As Server Actions das abas: aqui so a renderizacao importa.
vi.mock("@/app/(app)/automacoes/actions", () => ({
  salvarTextoDoPassoAction: vi.fn(),
  salvarAnexoDoPassoAction: vi.fn(),
  removerAnexoDoPassoAction: vi.fn(),
  criarReguaDeExcecaoAction: vi.fn(),
  salvarLimiarDaReforcadaAction: vi.fn(),
  excluirReguaAction: vi.fn(),
  criarPassoAction: vi.fn(),
  salvarEsperaDoPassoAction: vi.fn(),
  excluirPassoAction: vi.fn(),
  criarReguaDeFollowupAction: vi.fn(),
  editarParaQuemDaReguaAction: vi.fn(),
  ordenarReguasDeFollowupAction: vi.fn(),
  testarEnvioAction: vi.fn(),
  definirNumeroDasAutomaticasAction: vi.fn(),
}));
vi.mock("@/app/(app)/confirmacoes/actions", () => ({
  salvarJanelaDaReguaAction: vi.fn(),
  alternarReguaAction: vi.fn(),
  cobrarAgoraAction: vi.fn(),
  manterHorarioAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
// A dica vira atributo, para o teste ler o porque do controle desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

import { AbaFollowup } from "@/components/automacoes/aba-followup";
import { CartaoDaRegua } from "@/components/automacoes/followup/cartao-da-regua";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import { tonsDasEtiquetas } from "@/lib/domain/etiquetas-do-lead";
import type {
  DadosDosFollowups,
  ReguaDeFollowup,
} from "@/lib/queries/automacoes";

// A aba Follow-up de leads com as reguas por etiqueta (onda 4, item 16):
// agrupada por etapa, na ordem da jornada; dentro da etapa, as com etiqueta
// na ordem de precedencia (com Subir e Descer de 40px) e a geral por
// ultimo; o texto fixo da precedencia; o aviso da etapa sem geral com a
// contagem; os chips das etiquetas com o nome escrito e "qualquer uma" ou
// "todas"; a situacao em 3 camadas; "Nova régua" que nao esconde mais a
// etapa que ja tem regua; e, aberto, o "Para quem" com as contagens de hoje.
// Quem nao edita ve tudo desabilitado com a dica.

const CATALOGO: EtiquetaDeConversa[] = [
  { id: "t1", chave: "psiquiatria", nome: "Psiquiatria", tom: "info" },
];

function regua(campos: Partial<ReguaDeFollowup>): ReguaDeFollowup {
  return {
    id: "r",
    name: "Régua",
    active: false,
    send_window_start: null,
    send_window_end: null,
    send_weekdays: null,
    passos: [],
    primeira_ativacao: false,
    pede_linha_de_base: false,
    enviados_24h: 0,
    pulados_24h: 0,
    trigger_stage: "em_contato",
    etapa_nome: "Em contato",
    etiquetas: [],
    etiquetas_modo: "qualquer",
    prioridade: 0,
    created_at: "2026-10-24T12:00:00Z",
    eventos30d: 0,
    alcance: { casam: 0, recebem: 0, sem_autorizacao: 0, entradas_30d: 0 },
    ...campos,
  };
}

const GERAL = regua({
  id: "g",
  name: "Follow-up de Em contato",
  active: true,
  alcance: { casam: 12, recebem: 9, sem_autorizacao: 2, entradas_30d: 30 },
});
const PSIQUIATRIA = regua({
  id: "p",
  name: "Psiquiatria",
  active: true,
  etiquetas: ["Psiquiatria"],
  prioridade: 1,
  alcance: { casam: 3, recebem: 3, sem_autorizacao: 1, entradas_30d: 5 },
});
const ODONTO = regua({
  id: "o",
  name: "Odonto e implante",
  etiquetas: ["Odontologia", "Implante"],
  etiquetas_modo: "todas",
  prioridade: 2,
});
const SO_COM_ETIQUETA = regua({
  id: "n",
  name: "Novo: VIP",
  trigger_stage: "novo",
  etapa_nome: "Novo",
  etiquetas: ["VIP"],
});

const ETAPAS = [
  { chave: "novo", nome: "Novo" },
  { chave: "em_contato", nome: "Em contato" },
  { chave: "agendou", nome: "Agendou" },
];

function aba(
  followups: DadosDosFollowups,
  campos: Partial<React.ComponentProps<typeof AbaFollowup>> = {},
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <AbaFollowup
          clinicId="c1111111-1111-4111-8111-111111111111"
          followups={followups}
          etapas={ETAPAS}
          nomeDaClinica="Clínica"
          precoCents={null}
          podeEditar
          dicaSemPermissao="Somente administradores e gestores alteram as automações"
          ehAdministrador={false}
          etiquetas={CATALOGO}
          aoMudar={() => undefined}
          {...campos}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** O botao com aquele nome acessivel. */
function botao(html: string, nome: string): string | null {
  return (
    new RegExp(`<button(?=[^>]*aria-label="${nome}")[^>]*>`).exec(html)?.[0] ??
    null
  );
}

const DADOS: DadosDosFollowups = {
  reguas: [GERAL, ODONTO, PSIQUIATRIA, SO_COM_ETIQUETA],
  semReguaPorEtapa: { novo: 4, em_contato: 0 },
};

describe("Follow-up de leads: as réguas agrupadas por etapa", () => {
  it("na ordem da jornada, com etiqueta na ordem e a geral por último", () => {
    const lido = texto(aba(DADOS));
    const posicao = (nome: string) => lido.indexOf(nome);
    // Novo antes de Em contato (a jornada), cada um com o titulo da etapa.
    expect(posicao("Novo: VIP")).toBeGreaterThan(-1);
    expect(posicao("Novo: VIP")).toBeLessThan(
      posicao("Psiquiatria Para leads com Psiquiatria"),
    );
    // Psiquiatria (prioridade 1), Odonto (2), a geral no fim.
    expect(posicao("Psiquiatria Para leads com Psiquiatria")).toBeLessThan(
      posicao("Odonto e implante"),
    );
    expect(posicao("Odonto e implante")).toBeLessThan(
      posicao("Follow-up de Em contato Régua geral"),
    );
  });

  it("o texto fixo da precedência; a etapa sem geral avisa quantos ficam sem", () => {
    const lido = texto(aba(DADOS));
    expect(lido).toContain(
      "Se o lead tiver as etiquetas de mais de uma régua, vale a de cima. Quem não tiver nenhuma recebe a régua geral da etapa.",
    );
    expect(lido).toContain(
      "4 leads de Novo não recebem nenhuma régua. Novo não tem régua geral: quem não tiver as etiquetas das réguas acima não recebe nenhuma.",
    );
    // Sem a contagem: a mesma regra, sem numero.
    const semContagem = texto(aba({ ...DADOS, semReguaPorEtapa: null }));
    expect(semContagem).toContain(
      "Novo não tem régua geral: quem não tiver as etiquetas das réguas acima não recebe nenhuma.",
    );
  });

  it("a geral desligada: o mesmo aviso, dizendo que ela está desligada", () => {
    const lido = texto(
      aba({
        reguas: [{ ...GERAL, active: false }, PSIQUIATRIA],
        semReguaPorEtapa: { em_contato: 7 },
      }),
    );
    expect(lido).toContain(
      "7 leads de Em contato não recebem nenhuma régua. A régua geral de Em contato está desligada: quem não tiver as etiquetas das réguas acima não recebe nenhuma.",
    );
    // Com a geral ligada, nenhum aviso de etapa sem regua.
    expect(texto(aba(DADOS))).not.toContain("A régua geral de Em contato");
  });

  it("cada cartão: nome, chips com o nome escrito, todas ou qualquer uma, situação em 3 camadas", () => {
    const html = aba(DADOS);
    const lido = texto(html);
    expect(lido).toContain(
      "Odonto e implante Para leads com Odontologia Implante todas Desligada",
    );
    expect(lido).toContain("Follow-up de Em contato Régua geral Ligada");
    // O tom do catalogo no chip da Psiquiatria (info), neutro sem catalogo.
    expect(html).toContain("background:var(--info)");
    expect(html).toContain("background:var(--neutral)");
    expect(html).toContain("Desligada");
  });

  it("Subir e Descer só nas com etiqueta, de 40px, desabilitados nas pontas", () => {
    const html = aba(DADOS);
    const subirPsi = botao(html, "Subir a régua Psiquiatria");
    const descerPsi = botao(html, "Descer a régua Psiquiatria");
    const subirOdonto = botao(html, "Subir a régua Odonto e implante");
    const descerOdonto = botao(html, "Descer a régua Odonto e implante");
    expect(subirPsi).toContain('disabled=""');
    expect(descerPsi).not.toContain('disabled=""');
    expect(subirOdonto).not.toContain('disabled=""');
    expect(descerOdonto).toContain('disabled=""');
    expect(subirPsi).toContain('data-size="icon"');
    // A geral nao se reordena: vem sempre por ultimo.
    expect(botao(html, "Subir a régua Follow-up de Em contato")).toBeNull();
  });

  it("Nova régua não esconde mais a etapa que já tem régua", () => {
    const html = aba(DADOS);
    expect(
      /<button[^>]*>(?:(?!<\/button>).)*Nova régua<\/button>/.exec(html)?.[0],
    ).not.toContain('disabled=""');
  });

  it("quem não edita vê tudo desabilitado, com a dica", () => {
    const html = aba(DADOS, { podeEditar: false });
    const dica = "Somente administradores e gestores alteram as automações";
    expect(html).toMatch(
      new RegExp(
        `data-dica="${dica}"><button[^>]*disabled=""[^>]*>(?:(?!</button>).)*Nova régua`,
      ),
    );
    expect(botao(html, "Subir a régua Odonto e implante")).toContain(
      'disabled=""',
    );
    expect(botao(html, "Excluir a régua Psiquiatria")).toContain('disabled=""');
  });

  it("vazio: o convite de sempre", () => {
    expect(texto(aba({ reguas: [], semReguaPorEtapa: {} }))).toContain(
      "Nenhuma régua de follow-up ainda",
    );
  });

  it("sem travessão", () => {
    expect(aba(DADOS)).not.toMatch(/[–—]/);
  });
});

describe("o cartão aberto: para quem e quantos", () => {
  function cartao(
    alvo: ReguaDeFollowup,
    campos: Partial<React.ComponentProps<typeof CartaoDaRegua>> = {},
  ): string {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <CartaoDaRegua
            regua={alvo}
            aberta
            aoAlternar={() => undefined}
            ordem={null}
            tons={tonsDasEtiquetas(CATALOGO)}
            clinicId="c1111111-1111-4111-8111-111111111111"
            nomeDaClinica="Clínica"
            precoCents={null}
            podeEditar
            dicaSemPermissao="Somente administradores e gestores alteram as automações"
            ehAdministrador={false}
            numeros={null}
            pendente={false}
            aoEditarParaQuem={() => undefined}
            aoExcluir={() => undefined}
            aoMudar={() => undefined}
            {...campos}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  it("com etiqueta: para quem, as contagens de hoje e o aviso de desligar", () => {
    const lido = texto(cartao(PSIQUIATRIA));
    expect(lido).toContain("Para quem Leads com Psiquiatria.");
    expect(lido).toContain("Recebem hoje 3");
    expect(lido).toContain("Com as etiquetas hoje 3");
    expect(lido).toContain("Sem autorização 1");
    expect(lido).toContain(
      "Ao desligar: Os leads com Psiquiatria passam a receber a régua geral da etapa, se ela estiver ligada.",
    );
    expect(lido).toContain(
      "1 de 3 leads desta régua não tem autorização para receber mensagens e será pulado.",
    );
    expect(lido).toContain("Editar para quem");
  });

  it("a geral: régua geral da etapa e quem está na etapa", () => {
    const lido = texto(cartao(GERAL));
    expect(lido).toContain(
      "Régua geral da etapa: vale para quem não tem as etiquetas das outras réguas.",
    );
    expect(lido).toContain("Na etapa hoje 12");
    expect(lido).not.toContain("Ao desligar");
  });

  it("sem as contagens: diz que não deu, sem número inventado", () => {
    const lido = texto(cartao({ ...PSIQUIATRIA, alcance: null }));
    expect(lido).toContain(
      "Não foi possível contar os leads desta régua agora.",
    );
    expect(lido).not.toContain("Recebem hoje");
  });

  it("quem não edita: Editar para quem desabilitado, com a dica", () => {
    const html = cartao(PSIQUIATRIA, { podeEditar: false });
    expect(html).toMatch(
      /data-dica="Somente administradores e gestores alteram as automações"><button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Editar para quem/,
    );
  });
});
