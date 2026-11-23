import { readdirSync, readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MOTIVOS_DE_ESCALONAMENTO,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO as ROTULOS,
} from "@/lib/domain/agente/config";
import { MOTIVOS_DA_FALHA } from "@/lib/domain/conformidade/veredicto";
import {
  TEXTO_SEM_COMPARECIMENTO,
  gruposDasPassagens,
  linhasDoCsv,
  montarCampanhas,
  montarExportavelDaAba,
  rotuloDoMotivoDaPassagem,
  textoDeComparecimentosSemPreco,
} from "@/lib/domain/exportacao-de-resultados";
import {
  fetchCampanhasDoPeriodo,
  fetchPassagensDaIaDoPeriodo,
  type PassagensDaIaDoPeriodo,
} from "@/lib/queries/relatorios";

import {
  AGENTE,
  ATENDIMENTO,
  CONVERSOES,
  FUNIL,
  campanhasDoPeriodo,
  campanhasPeriodizadas,
} from "./dados-de-exemplo";

// Metricas certas (decisao do dono de 23/11/2026): as partes puras e as
// telas que mudaram. O SQL (lead de verdade, Agendou da Jornada, remarcacao
// uma vez, a trilha que nao some) e provado pelos testes de banco
// (tests/integration/metricas-certas.test.ts e tests/rls/metricas-certas),
// que so rodam com a migration 20261123100000 aplicada.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { PassagensDaIa } =
  await import("@/components/relatorios/passagens-da-ia");
const { AbaMarketing } = await import("@/components/relatorios/aba-marketing");
const { cartaoDaIaNoInicio, IndicadoresDoDia } =
  await import("@/components/inicio/indicadores-do-dia");

const TZ = "America/Fortaleza";
const nada = () => undefined;

/** Texto sem tags, com espacos (inclusive o NBSP do Intl) normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sem = (valor: string | undefined) => valor?.replace(/ /g, " ");

const PASSAGENS: PassagensDaIaDoPeriodo = {
  total: 9,
  porMotivo: [
    { camada: "agente", motivo: "pedido_humano", passagens: 4 },
    { camada: "falha", motivo: "falha_tecnica", passagens: 2 },
    { camada: "portao", motivo: "sintoma", passagens: 1 },
    { camada: "agente", motivo: "agente_pediu", passagens: 1 },
    { camada: "filtro", motivo: "conformidade", passagens: 1 },
  ],
};

describe("Campanhas: Compareceram e Custo por consulta realizada", () => {
  it("gestão: quem compareceu e o investimento por consulta com comparecimento", () => {
    const [implante, semNome, botox, checkup] = montarCampanhas(
      campanhasDoPeriodo(),
      true,
    );
    expect(implante?.compareceram).toBe(60);
    // 342.000 / 76 consultas = 4.500 centavos
    expect(sem(implante?.custoPorConsulta?.texto)).toBe("R$ 45,00");
    expect(implante?.custoPorConsulta?.estado).toBe(false);
    expect(sem(semNome?.custoPorConsulta?.texto)).toBe("R$ 60,00");
    expect(botox?.custoPorConsulta).toEqual({
      texto: TEXTO_SEM_COMPARECIMENTO,
      estado: true,
    });
    expect(checkup?.custoPorConsulta).toEqual({
      texto: "Fora da Meta",
      estado: true,
    });
  });

  it("recepção: Compareceram sim, nenhuma coluna em reais", () => {
    for (const linha of montarCampanhas(campanhasDoPeriodo(), false)) {
      expect(typeof linha.compareceram).toBe("number");
      expect(linha.custoPorConsulta).toBeNull();
    }
  });

  it("sem a medida do investimento ou sem o campo do banco: Não medido", () => {
    const [semLeitura] = montarCampanhas(
      campanhasDoPeriodo({ lidoDesde: "2026-09-10" }),
      true,
    );
    expect(semLeitura?.custoPorConsulta?.texto).toBe("Não medido");
    const antigo = campanhasDoPeriodo();
    antigo.linhas = antigo.linhas.map((linha) => ({
      ...linha,
      comparecimentos: null,
      comparecimentosSemPreco: null,
    }));
    const [implante] = montarCampanhas(antigo, true);
    expect(implante?.custoPorConsulta?.texto).toBe("Não medido");
    // Sem o campo, a celula do faturamento fica sem nota.
    expect(implante?.faturamento?.nota).toBeUndefined();
  });

  it("parte sem preço: o faturamento com a nota de quantos ficaram fora; na tela e no CSV", () => {
    const campanhas = campanhasDoPeriodo();
    campanhas.linhas[0] = {
      ...campanhas.linhas[0]!,
      comparecimentosSemPreco: 3,
    };
    campanhas.linhas[1] = {
      ...campanhas.linhas[1]!,
      comparecimentosSemPreco: 1,
    };
    const [implante, semNome, botox] = montarCampanhas(campanhas, true);
    expect(sem(implante?.faturamento?.texto)).toBe("R$ 11.970,00");
    expect(implante?.faturamento?.nota).toBe("3 comparecimentos sem preço");
    expect(semNome?.faturamento?.nota).toBe("1 comparecimento sem preço");
    // Sem comparecimento o estado continua sozinho.
    expect(botox?.faturamento?.nota).toBeUndefined();

    const csv = linhasDoCsv(
      montarExportavelDaAba({
        aba: "marketing",
        podeVerValores: true,
        canalOficial: false,
        funil: { atual: FUNIL, anterior: null },
        campanhas: { atual: campanhas, anterior: null },
        timezone: TZ,
        dimensaoOrigem: "canal",
        dimensaoAgenda: "profissional",
      }),
    );
    expect(csv.flat().map(sem)).toContain(
      "R$ 11.970,00 (3 comparecimentos sem preço)",
    );
  });

  it("todo sem preço continua Sem preço para somar, sem nota", () => {
    const campanhas = campanhasDoPeriodo();
    campanhas.linhas[0] = {
      ...campanhas.linhas[0]!,
      faturamentoCents: 0,
      comparecimentosSemPreco: 76,
    };
    const [implante] = montarCampanhas(campanhas, true);
    expect(implante?.faturamento).toEqual({
      texto: "Sem preço para somar",
      estado: true,
    });
  });

  it("singular e plural", () => {
    expect(textoDeComparecimentosSemPreco(1)).toBe(
      "1 comparecimento sem preço",
    );
    expect(textoDeComparecimentosSemPreco(1200)).toBe(
      `${(1200).toLocaleString("pt-BR")} comparecimentos sem preço`,
    );
  });

  it("o banco manda os dois campos novos; sem eles, null (nunca zero)", async () => {
    const linha = {
      chave: "meta:1",
      tipo: "meta",
      meta_campaign_id: "1",
      rotulo: "A",
      leads: 2,
      agendaram: 1,
      compareceram: 1,
      investimento_cents: 100,
      faturamento_cents: 50,
    };
    const corpo = (extra: Record<string, unknown>) => ({
      atual: {
        leads: 2,
        leads_de_anuncio: 2,
        leads_casados: 2,
        leads_de_anuncio_sem_campanha: 0,
        leads_sem_campanha: 0,
        linhas: [{ ...linha, ...extra }],
        investimento: null,
      },
    });
    const cliente = (data: unknown) =>
      ({
        rpc: vi.fn(async () => ({ data, error: null })),
      }) as unknown as SupabaseClient;
    const novo = await fetchCampanhasDoPeriodo(
      cliente(corpo({ comparecimentos: 3, comparecimentos_sem_preco: 1 })),
      "c",
      TZ,
      "2026-10-01",
      "2026-10-31",
    );
    expect(novo.atual.linhas[0]).toMatchObject({
      comparecimentos: 3,
      comparecimentosSemPreco: 1,
    });
    const antigo = await fetchCampanhasDoPeriodo(
      cliente(corpo({})),
      "c",
      TZ,
      "2026-10-01",
      "2026-10-31",
    );
    expect(antigo.atual.linhas[0]).toMatchObject({
      comparecimentos: null,
      comparecimentosSemPreco: null,
    });
  });
});

describe("Por que foi para a equipe", () => {
  it("o rótulo é o do evento da IA, com maiúscula; motivo desconhecido não mostra o código", () => {
    expect(rotuloDoMotivoDaPassagem("sintoma", ROTULOS)).toBe(
      "O paciente descreveu um sintoma",
    );
    expect(rotuloDoMotivoDaPassagem("falha_tecnica", ROTULOS)).toBe(
      "O assistente teve uma falha técnica",
    );
    expect(rotuloDoMotivoDaPassagem("motivo_novo", ROTULOS)).toBe(
      "Outro motivo",
    );
    expect(rotuloDoMotivoDaPassagem("constructor", ROTULOS)).toBe(
      "Outro motivo",
    );
  });

  it("todo motivo do CHECK tem rótulo sem travessão", () => {
    for (const motivo of MOTIVOS_DE_ESCALONAMENTO) {
      const rotulo = rotuloDoMotivoDaPassagem(motivo, ROTULOS);
      expect(rotulo).not.toBe("Outro motivo");
      expect(rotulo).not.toMatch(/[–—]/);
    }
  });

  it("grupos na ordem do turno, mais passagens primeiro, sem grupo vazio", () => {
    const grupos = gruposDasPassagens(PASSAGENS, ROTULOS);
    expect(grupos.map((grupo) => grupo.rotulo)).toEqual([
      "Na chegada da mensagem",
      "Durante a conversa",
      "Na conferência antes de enviar",
      "Por falha técnica",
    ]);
    expect(grupos[1]?.linhas.map((linha) => linha.passagens)).toEqual([4, 1]);
    expect(
      gruposDasPassagens(
        {
          total: 1,
          porMotivo: [{ camada: "agente", motivo: "sintoma", passagens: 1 }],
        },
        ROTULOS,
      ).map((grupo) => grupo.camada),
    ).toEqual(["agente"]);
  });

  it("tela: barras horizontais com o rótulo, o valor e a participação", () => {
    const html = renderToStaticMarkup(
      <PassagensDaIa passagens={PASSAGENS} rotulos={ROTULOS} />,
    );
    const lido = texto(html);
    expect(lido).toContain("Por que foi para a equipe");
    expect(lido).toContain("9 passagens no período");
    expect(lido).toContain("O paciente pediu para falar com uma pessoa");
    expect(lido).toContain("44,4%");
    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-label="O paciente pediu para falar com uma pessoa: 4, 44,4%"',
    );
    expect(lido).not.toMatch(/[–—]/);
    // Nada de grafico proibido: so as barras do design system.
    expect(html).not.toMatch(/<svg[^>]*class="[^"]*(pie|donut)/);
  });

  it("tela: carregando, erro com Tentar de novo e vazio", () => {
    const carregando = renderToStaticMarkup(
      <PassagensDaIa passagens={undefined} rotulos={ROTULOS} />,
    );
    expect(carregando).toContain("aria-busy");
    const erro = texto(
      renderToStaticMarkup(
        <PassagensDaIa
          passagens={undefined}
          rotulos={ROTULOS}
          erro
          tentarDeNovo={<button type="button">Tentar de novo</button>}
        />,
      ),
    );
    expect(erro).toContain("Não foi possível carregar os motivos");
    expect(erro).toContain("Tentar de novo");
    const vazio = texto(
      renderToStaticMarkup(
        <PassagensDaIa
          passagens={{ total: 0, porMotivo: [] }}
          rotulos={ROTULOS}
        />,
      ),
    );
    expect(vazio).toContain("Nenhuma conversa foi para a equipe no período");
  });

  it("a exportação da aba Agente de IA leva a mesma tabela", () => {
    const exportavel = montarExportavelDaAba({
      aba: "ia",
      podeVerValores: false,
      canalOficial: false,
      atendimento: {
        atual: { ...ATENDIMENTO, agente: AGENTE },
        anterior: null,
      },
      passagens: PASSAGENS,
      rotulosDosMotivos: ROTULOS,
      dimensaoOrigem: "canal",
      dimensaoAgenda: "profissional",
    });
    const secao = exportavel.secoes.find(
      (item) => item.titulo === "Por que foi para a equipe",
    );
    expect(secao?.linhas[0]).toEqual([
      "Onde",
      "Motivo",
      "Passagens",
      "Participação",
    ]);
    expect(secao?.linhas[1]).toEqual([
      "Na chegada da mensagem",
      "O paciente descreveu um sintoma",
      "1",
      "11,1%",
    ]);
  });

  it("o fetcher lê o corpo do banco e trata o null do profissional como erro", async () => {
    const cliente = (data: unknown) =>
      ({
        rpc: vi.fn(async () => ({ data, error: null })),
      }) as unknown as SupabaseClient;
    const lido = await fetchPassagensDaIaDoPeriodo(
      cliente({
        total: 3,
        por_motivo: [
          { camada: "portao", motivo: "sintoma", passagens: 2 },
          { camada: "outra", motivo: "x", passagens: 1 },
        ],
      }),
      "c",
      TZ,
      "2026-10-01",
      "2026-10-31",
    );
    expect(lido).toEqual({
      total: 3,
      porMotivo: [
        { camada: "portao", motivo: "sintoma", passagens: 2 },
        { camada: "agente", motivo: "x", passagens: 1 },
      ],
    });
    await expect(
      fetchPassagensDaIaDoPeriodo(
        cliente(null),
        "c",
        TZ,
        "2026-10-01",
        "2026-10-31",
      ),
    ).rejects.toThrow("Recorte indisponível");
  });
});

describe("Taxa de falta (Marketing)", () => {
  function marketing(funil = FUNIL): string {
    return renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: funil, anterior: null }}
        periodo={{ diaDe: "2026-10-01", diaAte: "2026-10-20" }}
        campanhas={campanhasPeriodizadas()}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores={false}
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
  }

  it("faltas sobre as consultas com desfecho do período", () => {
    const lido = texto(marketing());
    // 28 faltas em 28 + 284 = 312
    expect(lido).toContain("Taxa de falta");
    expect(lido).toContain("9,0 %");
    expect(lido).toContain("28 faltas em 312 consultas com desfecho");
  });

  it("sem desfecho no período: vazio, nunca 0%", () => {
    const lido = texto(marketing({ ...FUNIL, faltas: 0, comparecimentos: 0 }));
    expect(lido).toContain("Nenhuma consulta com desfecho no período");
  });

  it("a exportação de Marketing leva a mesma taxa", () => {
    const exportavel = montarExportavelDaAba({
      aba: "marketing",
      podeVerValores: false,
      canalOficial: false,
      funil: { atual: FUNIL, anterior: null },
      dimensaoOrigem: "canal",
      dimensaoAgenda: "profissional",
    });
    expect(exportavel.secoes[0]?.linhas).toContainEqual([
      "Taxa de falta",
      "9,0%",
    ]);
  });
});

describe("Início: Resolvidas pela IA", () => {
  const hoje = (agente: typeof AGENTE | null) => ({
    ok: true as const,
    dados: { atual: { ...ATENDIMENTO, agente }, anterior: null },
  });

  it("com atividade: a medida de Resultados, sem variação", () => {
    expect(cartaoDaIaNoInicio(hoje(AGENTE), true)).toEqual({
      estado: "valor",
      valor: "12",
      rodape: "de 21 conversas atendidas pela IA",
    });
  });

  it("sem atividade hoje: vazio na clínica com o agente, Ainda não medido nas outras", () => {
    const parada = {
      ...AGENTE,
      atendidas: 0,
      transferidas: 0,
      agendamentos: 0,
    };
    expect(cartaoDaIaNoInicio(hoje(parada), true)).toMatchObject({
      estado: "vazio",
      rodape: "nenhuma conversa atendida pela IA hoje",
    });
    expect(cartaoDaIaNoInicio(hoje(parada), false)).toMatchObject({
      estado: "nao-medido",
    });
  });

  it("erro vira erro; sem leitura, a dica de antes", () => {
    expect(cartaoDaIaNoInicio({ ok: false }, true)).toEqual({ estado: "erro" });
    expect(cartaoDaIaNoInicio(undefined, false)).toMatchObject({
      estado: "nao-medido",
    });
  });

  it("o cartão do Início mostra o número", () => {
    const html = renderToStaticMarkup(
      <IndicadoresDoDia
        resumo={{ ok: false }}
        timezone={TZ}
        iaNaFase
        atendimento={hoje(AGENTE)}
      />,
    );
    const lido = texto(html);
    expect(lido).toContain("Resolvidas pela IA");
    expect(lido).toContain("de 21 conversas atendidas pela IA");
    expect(lido).not.toContain("Medição da IA ainda não disponível");
  });
});

describe("os espelhos que a migration 20261123100000 usa", () => {
  const MIGRATIONS = readdirSync("supabase/migrations")
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort();
  const migration = readFileSync(
    "supabase/migrations/20261123100000_metricas_certas.sql",
    "utf-8",
  );

  /** O corpo da migration MAIS NOVA que (re)cria a funcao. */
  function corpoMaisNovo(nome: string): { arquivo: string; corpo: string } {
    const definicao = new RegExp(
      `create (?:or replace )?function public\\.${nome}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
      "gi",
    );
    for (const arquivo of [...MIGRATIONS].reverse()) {
      const sql = readFileSync(`supabase/migrations/${arquivo}`, "utf-8");
      const corpo = [...sql.matchAll(definicao)].at(-1)?.[1];
      if (corpo !== undefined) {
        return { arquivo, corpo };
      }
    }
    throw new Error(`${nome} nao encontrada`);
  }

  it("o lead de verdade: a ingestão cria o contato e a autorização 'conversa' na mesma função", () => {
    // contato_e_lead confia nisso: as duas linhas na mesma transacao, com o
    // mesmo now(). Se a ingestao deixar de gravar a autorizacao, Resultados
    // zera os leads: este teste quebra antes.
    const { corpo } = corpoMaisNovo("ingest_inbound_message");
    expect(corpo).toMatch(/insert into contact \(/);
    expect(corpo).toMatch(
      /insert into contact_consent[\s\S]*?'whatsapp',\s*'conversa'/,
    );
    expect(migration).toMatch(
      /k\.source = 'conversa'\s+and k\.created_at = p_contato\.created_at/,
    );
  });

  it("a varredura de 3 minutos grava só valores que os CHECKs de hoje aceitam", () => {
    const insert = migration.match(
      /if p_motivo = 'sem_resposta' then\s+insert into public\.ai_decision_log \(([^)]*)\) values \(([^)]*)\)/,
    );
    expect(insert).not.toBeNull();
    const valores = [...(insert?.[2] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(valores).toEqual(["falha_tecnica", "falhou", "prazo"]);
    expect(MOTIVOS_DE_ESCALONAMENTO as readonly string[]).toContain(
      "falha_tecnica",
    );
    expect(MOTIVOS_DA_FALHA as readonly string[]).toContain("prazo");
    // Nenhum CHECK de ai_decision_log muda: os espelhos do agente ficam.
    expect(migration).not.toMatch(/add constraint ai_decision_log_\w+_valid/);
  });

  it("a trilha fica com a conversa apagada, e o rascunho sai", () => {
    expect(migration).toMatch(
      /ai_decision_log_conversation_id_fkey\s+foreign key \(conversation_id\) references public\.conversation \(id\) on delete set null/,
    );
    expect(migration).toMatch(
      /ai_decision_log_message_id_fkey\s+foreign key \(message_id\) references public\.message \(id\) on delete set null/,
    );
    expect(migration).toMatch(/alter column conversation_id drop not null/);
    expect(migration).toMatch(
      /delete from public\.ai_rascunho_bloqueado r where r\.decision_id = old\.id/,
    );
  });
});

describe("Follow-up: a dica do modo da IA", () => {
  it("diz o que é verdade hoje: o agente já atende, a régua escrita pela IA não existe", () => {
    const fonte = readFileSync(
      "components/automacoes/aba-followup.tsx",
      "utf-8",
    );
    expect(fonte).toContain(
      "O agente de IA ainda não escreve as mensagens da régua. Por enquanto, cada passo envia o texto que você escreveu.",
    );
    expect(fonte).not.toContain("Chega com o agente de IA");
  });
});
