import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O detalhe de uma clinica no Painel geral (onda 1) inteiro, como a pagina
// desenha depois de ler: as metricas, a conta, o agente, os numeros e os
// telefones (modo do painel), o gasto, o teto e a equipe. Cada leitura de
// apoio que falhou mostra o erro no proprio cartao. A disponibilidade do
// agente vem do ambiente (T1) e da propria linha do painel (agente em
// teste e conta ativa): o motivo "servidor" nunca culpa a chave da OpenAI
// por uma clinica desligada ou suspensa.

vi.mock("next/navigation", () => ({
  usePathname: () => "/painel-geral/c3333333-3333-4333-8333-333333333333",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));
vi.mock("@/app/(app)/painel-geral/actions", () => ({
  suspenderClinicaAction: vi.fn(),
  reativarClinicaAction: vi.fn(),
  definirAgenteDaClinicaAction: vi.fn(),
  definirTetoDaIaAction: vi.fn(),
}));
vi.mock("@/app/(app)/configuracoes/ia-liberacao-actions", () => ({
  adicionarTelefoneDaIaAction: vi.fn(),
  alternarNumeroDaIaAction: vi.fn(),
  alternarTelefoneDaIaAction: vi.fn(),
  definirEscolhaDaIaAction: vi.fn(),
  definirInterruptorGeralAction: vi.fn(),
}));

import { TEXTOS_DA_IA } from "@/components/configuracoes/agente-de-ia";
import {
  agenteAtendeNoAmbiente,
  bloqueioDoTeto,
  DetalheDaClinica,
  numerosDosCartoes,
  type DetalheDaClinicaProps,
} from "@/components/painel-geral/detalhe-da-clinica";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";
import type { ClinicaNoPainel } from "@/lib/queries/painel-geral";

const ID = "c3333333-3333-4333-8333-333333333333";
const NUMERO = "d4444444-4444-4444-8444-444444444444";
const AGORA = Date.parse("2026-10-20T15:00:00.000Z");

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID,
    nome: "Estética Bela",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: "America/Fortaleza",
    membrosAtivos: 3,
    membrosPendentes: 1,
    administradores: [{ nome: "Ana Souza", email: "ana@bela.com.br" }],
    numerosTotal: 1,
    numerosConectados: 1,
    numeros: [
      {
        id: NUMERO,
        nome: "Recepção",
        final: "4321",
        conexao: "conectado",
        iaLigada: true,
      },
    ],
    contatos: 1834,
    leads30Dias: 142,
    conversas30Dias: 1234,
    ultimaMensagemEm: "2026-10-20T13:05:00.000Z",
    suspensao: null,
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausadaPelaClinica: false,
      telefonesLigados: 1,
    },
    gasto: {
      ultimas24hCentavos: 42,
      mesCentavos: 310,
      ultimas24hSemSimuladorCentavos: 30,
      mesSemSimuladorCentavos: 200,
    },
    tetoDiarioCentavos: 500,
    ...campos,
  };
}

const DADOS: DadosDaIa = {
  liberacao: {
    liberada: true,
    modo: "contatos",
    pausadaPelaClinica: false,
    tetoDiarioCentavosUsd: 500,
  },
  numerosLigados: [NUMERO],
  telefones: [
    { id: "t1", telefone: "+5584999990001", rotulo: "Ana", ativo: true },
  ],
  interruptorLigado: true,
  situacao: {
    tetoAtingido: false,
    versaoPublicada: 1,
    telefonesInvalidos: [],
    telefonesSemAutorizacao: [],
    conversasAbertas: [],
    horarioPublicado: null,
    motorParado: false,
  },
};

function detalhe(campos: Partial<DetalheDaClinicaProps> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <DetalheDaClinica
        clinica={clinica()}
        dados={DADOS}
        tetos={{ tetoDiarioCentavos: 500, tetoRespostasPorConversaHora: 20 }}
        ambienteDaIa
        agoraMs={AGORA}
        {...campos}
      />
    </TooltipProvider>,
  );
}

function escapado(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

describe("detalhe da clínica", () => {
  it("o cabeçalho, a volta para o painel e as métricas (só contagens)", () => {
    const saida = detalhe();
    expect(saida).toContain("<h1");
    expect(saida).toContain(escapado("Estética Bela"));
    expect(saida).toContain('href="/painel-geral"');
    expect(saida).toContain("Criada em 01/09/2026");
    expect(saida).toContain("1 de 1");
    expect(saida).toContain("1.834");
    expect(saida).toContain("1.234");
    expect(saida).toContain("Hoje, 10:05");
    expect(saida).toContain("1 esperando liberação");
  });

  it("todos os cartões: conta, agente, números, telefones, gasto, teto e equipe", () => {
    const saida = detalhe();
    for (const titulo of [
      "Conta da clínica",
      "Agente de IA",
      "Números do assistente",
      "Telefones da equipe",
      "Gasto de IA",
      "Teto de gasto",
      "Equipe da clínica",
    ]) {
      expect(saida, titulo).toContain(escapado(titulo));
    }
    expect(saida).toContain("final 4321");
    // Tudo de pe e conferido: o verde.
    expect(saida).toContain("Na clínica agora");
    expect(saida).toContain("Conversando com a equipe");
  });

  it("sem número e sem mensagem: o vazio escrito, nunca um zero grande", () => {
    const saida = detalhe({
      clinica: clinica({
        numerosTotal: 0,
        numerosConectados: 0,
        numeros: [],
        ultimaMensagemEm: null,
      }),
    });
    expect(saida).toContain("Nenhum número");
    expect(saida).toContain("Nenhuma ainda");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.semNumerosNoPainel));
  });

  it("leitura do agente que falhou: o erro no lugar dos cartões e o não conferido no agente", () => {
    const saida = detalhe({ dados: "erro" });
    expect(saida).toContain(
      "Não foi possível carregar os números e os telefones do agente",
    );
    expect(saida).not.toContain("Números do assistente");
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteSemLeitura));
  });

  it("leitura do teto que falhou: o erro no lugar do formulário", () => {
    const saida = detalhe({ tetos: "erro" });
    expect(saida).toContain("Não foi possível carregar o teto de gasto");
    expect(saida).not.toContain("Salvar teto");
  });

  it("agente desligado: os cartões visíveis e desabilitados, com o porquê escrito", () => {
    const saida = detalhe({
      clinica: clinica({
        agente: {
          estado: "desligado",
          modo: null,
          liberada: false,
          pausadaPelaClinica: false,
          telefonesLigados: 0,
        },
      }),
    });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.ligueOAgenteAntes));
    expect(saida).not.toContain("Na clínica agora");
    // Sem o agente, a linha do numero nao diz "Em uso pelo assistente".
    expect(saida).not.toContain(TEXTOS_DA_IA.numeroEmUso);
  });

  it("fora da produção (sem T1): o motivo é o ambiente, para a equipe Conduzza", () => {
    const saida = detalhe({ ambienteDaIa: false });
    expect(saida).toContain("Ligado, mas parado");
    expect(saida).toContain(
      escapado(TEXTOS_DA_IA.motivosParaAEquipeConduzza.servidor),
    );
  });

  it("conta suspensa em teste: o aviso, sem a lista de motivos e sem o verde", () => {
    const saida = detalhe({
      clinica: clinica({
        suspensao: {
          suspensaEm: "2026-10-18T10:00:00.000Z",
          motivo: "Pagamento atrasado",
        },
      }),
    });
    expect(saida).toContain(escapado(TEXTOS_DO_PAINEL.agenteComContaSuspensa));
    expect(saida).not.toContain("Na clínica agora");
    expect(saida).not.toContain(
      escapado(TEXTOS_DA_IA.motivosParaAEquipeConduzza.servidor),
    );
    expect(saida).not.toContain(TEXTOS_DA_IA.numeroEmUso);
    expect(saida).toContain("Reativar conta");
  });

  it("sem travessão", () => {
    expect(detalhe()).not.toMatch(/[—–]/);
    expect(detalhe({ dados: "erro", tetos: null })).not.toMatch(/[—–]/);
  });
});

describe("regras do detalhe", () => {
  it("o agente atende no ambiente só com T1, em teste e com a conta ativa", () => {
    const base = clinica();
    expect(agenteAtendeNoAmbiente(base, true)).toBe(true);
    expect(agenteAtendeNoAmbiente(base, false)).toBe(false);
    expect(
      agenteAtendeNoAmbiente(
        { ...base, agente: { ...base.agente, estado: "desligado" } },
        true,
      ),
    ).toBe(false);
    expect(
      agenteAtendeNoAmbiente(
        {
          ...base,
          suspensao: { suspensaEm: "2026-10-18T10:00:00.000Z", motivo: "x" },
        },
        true,
      ),
    ).toBe(false);
  });

  it("o teto trava só com a conta suspensa e a liberação ligada", () => {
    const base = clinica();
    const suspensa = {
      suspensaEm: "2026-10-18T10:00:00.000Z",
      motivo: "Pagamento atrasado",
    };
    expect(bloqueioDoTeto(base)).toBeNull();
    expect(bloqueioDoTeto({ ...base, suspensao: suspensa })).toBe(
      TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto,
    );
    expect(
      bloqueioDoTeto({
        ...base,
        suspensao: suspensa,
        agente: { ...base.agente, liberada: false },
      }),
    ).toBeNull();
  });

  it("os números do painel no formato dos cartões, com os finais à parte", () => {
    const { numeros, finais } = numerosDosCartoes(clinica());
    expect(numeros).toEqual([
      expect.objectContaining({
        id: NUMERO,
        nome: "Recepção",
        status: "conectado",
        displayPhone: null,
      }),
    ]);
    expect(finais).toEqual({ [NUMERO]: "4321" });
  });
});
