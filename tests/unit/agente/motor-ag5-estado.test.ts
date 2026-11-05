import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FRASES_DO_ATENDIMENTO } from "@/lib/agente/prompt";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

import {
  busca,
  CenarioDaAg5,
  configDaAg5,
  JANELA_DESDE,
  R_ANA,
  T_E1_ANA_NOITE_SEG_QUA,
  T_E2_ANA_NOITE_SEG_QUA,
} from "./ag5-conversa";
import { ferramenta, final, saidas } from "./ag4-conversa";
import { CLINICA, CONTATO, CONVERSA, PROC, PROF } from "./agenda-fixtures";

// AG5: o estado da lista de espera entre os turnos. Nada muda em
// ia_atendimento (nenhuma chave nova, nenhuma etapa nova): o pedido e a
// entrada desta conversa vem de ia_pedido_de_espera, relidos no preparo (so
// com a habilidade ligada), na janela atual da IA. O bloco do modelo diz a
// pergunta em andamento (ou que nao vale mais) e a entrada feita; os fatos
// deixam "voce esta na lista" valer com a entrada relida; a nota da
// passagem conta o pedido e a situacao. Nenhum teste fala com a OpenAI.

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const LINHA_DA_ENTRADA =
  "A pessoa entrou na lista de espera nesta conversa: Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas. Nenhum horário foi marcado.";

async function comAPergunta(cenario: CenarioDaAg5) {
  await cenario.fala({
    texto: "Queria limpeza de pele com a Dra. Ana, só à noite.",
    roteiro: [
      ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
      final(
        "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?",
      ),
    ],
  });
  const r = await cenario.fala({
    texto: "Lista de espera. Segunda ou quarta.",
    roteiro: [
      ferramenta("pedir_lista_de_espera", {
        periodos: ["noite"],
        dias: ["segunda", "quarta"],
      }),
    ],
  });
  expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
}

async function naLista(cenario: CenarioDaAg5) {
  await comAPergunta(cenario);
  const r = await cenario.fala({
    texto: "Sim",
    roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
  });
  expect(r.resposta).toBe(T_E2_ANA_NOITE_SEG_QUA);
}

describe("o pedido relido no turno seguinte", () => {
  it("o bloco do modelo diz que a pergunta foi feita; o estado do atendimento não muda de forma", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    // As 14 chaves de sempre, sem etapa nova.
    expect(Object.keys(cenario.estado).sort()).toEqual(
      [
        "etapa",
        "intencao",
        "procedure_id",
        "professional_id",
        "insurance_id",
        "particular",
        "unit_id",
        "horarios_oferecidos",
        "slot_hold_id",
        "appointment_id",
        "pedido_pendente",
        "pedido_pendente_em",
        "falhas_seguidas",
        "desfecho",
      ].sort(),
    );
    expect(cenario.estado.etapa).toBe("escolha");
    await cenario.fala({
      texto: "Sim, mas demora?",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    const instrucoes = cenario.instrucoesDaChamada(cenario.corpos.length - 1);
    expect(instrucoes).toContain(
      "Lista de espera: a pergunta da lista de espera já foi feita, esperando a resposta da pessoa.",
    );
    expect(instrucoes).toContain(FRASES_DO_ATENDIMENTO.listaDeEsperaLigada);
  });

  it("a pergunta que venceu: o bloco diz que não vale mais", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.agora += 61 * 60_000;
    await cenario.fala({
      texto: "Oi, voltei. Quanto custa a limpeza?",
      roteiro: [final("Oi! Quer que eu confira o valor da limpeza de pele?")],
    });
    expect(cenario.instrucoesDaChamada(cenario.corpos.length - 1)).toContain(
      "Lista de espera: a pergunta da lista de espera não vale mais (venceu, ou outra mensagem saiu depois dela).",
    );
  });

  it("o pedido de outra janela (antes do Devolver) não vale: entrar não acha pergunta", async () => {
    const cenario = new CenarioDaAg5();
    cenario.banco.inserir("ia_pedido_de_espera", {
      id: "0f0f0f0f-0000-4000-8000-000000000001",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      contact_id: CONTATO,
      janela_desde: new Date(Date.parse(JANELA_DESDE) - 86_400_000).toISOString(),
      job_id: "0f0f0f0f-0000-4000-8000-000000000002",
      procedure_id: PROC.limpeza,
      professional_id: PROF.ana,
      insurance_id: null,
      particular: true,
      preferred_shifts: ["noite"],
      preferred_weekdays: [1],
      created_at: new Date(Date.parse(JANELA_DESDE) - 80_000_000).toISOString(),
      consumido_em: null,
      waitlist_id: null,
      job_id_da_entrada: null,
    });
    await cenario.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("entrar_na_lista_de_espera", {}),
        final("Para qual procedimento você quer entrar na lista de espera?"),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "sem_pergunta_de_espera",
    });
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
  });

  it("a leitura do pedido que falha: entrar é falha fechada (nunca entra sem conferir)", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.banco.comErro.add("ia_pedido_de_espera");
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
  });

  it("com a habilidade desligada: nada é lido e as ferramentas não vão ao modelo", async () => {
    const base = configDaAg5();
    const cenario = new CenarioDaAg5({
      config: { ...base, habilidades: { ...base.habilidades, lista_de_espera: false } },
    });
    await cenario.fala({
      texto: "Quero entrar na lista de espera.",
      roteiro: [final("Vou ver com a equipe.")],
    });
    expect(
      cenario.banco.leituras.filter((l) => l.tabela === "ia_pedido_de_espera"),
    ).toEqual([]);
    const ferramentas = (
      (cenario.corpos[0]?.tools as { name: string }[] | undefined) ?? []
    ).map((t) => t.name);
    expect(ferramentas).not.toContain("pedir_lista_de_espera");
    expect(cenario.instrucoesDaChamada(0)).toContain(
      FRASES_DO_ATENDIMENTO.listaDeEsperaDesligada,
    );
  });
});

describe("a entrada relida no turno seguinte", () => {
  it("o bloco diz a entrada; 'você está na lista' passa só com a preferência dela", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    const r = await cenario.fala({
      texto: "Obrigada! E se abrir à tarde?",
      roteiro: [
        final(
          "Você está na lista de espera à noite, às segundas e às quartas. Para mudar o horário da lista, eu passo para a equipe.",
        ),
      ],
    });
    expect(cenario.instrucoesDaChamada(cenario.corpos.length - 1)).toContain(
      LINHA_DA_ENTRADA,
    );
    expect(r.tipo).toBe("resposta");
    // O resumo do verificador diz so que a pessoa esta na lista.
    const resumo = cenario.verificacao.pedidos.at(-1)?.resumoDosFatos ?? "";
    expect(resumo).toContain(
      "A pessoa está na lista de espera (entrada feita pela assistente nesta conversa",
    );
    expect(resumo).not.toMatch(/Limpeza de pele|Ana Lima|noite/);
  });

  it("a entrada relida com outro profissional ou outra preferência dita pelo modelo é barrada", async () => {
    for (const texto of [
      "Você está na lista de espera com o Dr. Bruno Costa.",
      "Você está na lista de espera à tarde.",
    ]) {
      const cenario = new CenarioDaAg5();
      await naLista(cenario);
      const r = await cenario.fala({
        texto: "Em que lista eu estou?",
        roteiro: [final(texto)],
      });
      expect(r.tipo, texto).toBe("frase_fixa");
      expect(r.desfecho, texto).toMatchObject({
        tipo: "bloqueou",
        categoria: "acao_nao_executada",
      });
    }
  });

  it("a entrada que a recepção removeu deixa de ser fato", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    for (const entrada of cenario.fila) {
      entrada.active = false;
    }
    const r = await cenario.fala({
      texto: "Ainda estou na lista?",
      roteiro: [final("Você está na lista de espera à noite.")],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(cenario.instrucoesDaChamada(cenario.corpos.length - 1)).not.toContain(
      LINHA_DA_ENTRADA,
    );
  });

  it("a nota da passagem conta a entrada feita nesta conversa", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    const r = await cenario.fala({
      texto: "Quero falar com uma pessoa",
      roteiro: [ferramenta("escalar_humano", { motivo: "pedido_humano" })],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo: "pedido_humano" });
    expect(r.notaParaAEquipe).toContain(
      "Pedido: entrar na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas.",
    );
    expect(r.notaParaAEquipe).toContain(
      "Entrou na lista de espera pelo assistente nesta conversa.",
    );
  });

  it("repetir o mesmo job da entrada devolve a mesma entrada (idempotência): uma linha só", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    const rpc = cenario.banco.manipuladores.get("entrar_na_lista_de_espera_pela_ia")!;
    const repetido = await rpc({
      p_clinic_id: CLINICA,
      p_conversation_id: CONVERSA,
      p_job_id: cenario.jobs[2],
    });
    expect(repetido.data).toMatchObject({ ok: true, reutilizado: true });
    expect(cenario.fila).toHaveLength(1);
  });
});

describe("as peças do motor da lista de espera", () => {
  it("o prompt: a seção nova, o encaixe e a vaga, o escalonamento e o Nunca; sem travessão", async () => {
    const { TEXTO_FIXO_DO_AGENTE, FRASES_DO_ATENDIMENTO_EM_ANDAMENTO, ferramentasDaChamada } =
      await import("@/lib/agente/prompt");
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Lista de espera (só com as ferramentas da lista de espera; o bloco <atendimento> diz se estão ligadas):",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain('Use "horário", nunca "vaga".');
    // Revisao da AG5 (achado 2): tambem a prioridade e a acao futura, as
    // formas novas da vaga_prometida; (achado 5) "pelo WhatsApp".
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Nunca prometa que um horário vai abrir, quando abre, quanto tempo a lista demora, a posição ou a prioridade da pessoa na lista, que o horário vai ser dela nem que você vai reservar ou marcar quando abrir: diga só que, se abrir um horário assim, ela recebe uma mensagem pelo WhatsApp.",
    );
    expect(TEXTO_FIXO_DO_AGENTE).not.toContain("mensagem por aqui");
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "nem que colocou a pessoa na lista de espera ou que ela está na lista sem a ferramenta ou o bloco <atendimento_em_andamento> dizer",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'o paciente pedir um encaixe, quiser sair da lista de espera ou mudar uma entrada que já existe',
    );
    expect(TEXTO_FIXO_DO_AGENTE).not.toMatch(/[—–]/);
    for (const frase of [
      FRASES_DO_ATENDIMENTO.listaDeEsperaLigada,
      FRASES_DO_ATENDIMENTO.listaDeEsperaDesligada,
      FRASES_DO_ATENDIMENTO_EM_ANDAMENTO.esperaPerguntada,
      FRASES_DO_ATENDIMENTO_EM_ANDAMENTO.esperaDesfeita,
      FRASES_DO_ATENDIMENTO_EM_ANDAMENTO.esperaEntrou,
    ]) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).not.toMatch(/\bvagas?\b/);
    }
    const nomes = ferramentasDaChamada(configDaAg5()).map((f) => f.name);
    expect(nomes).toHaveLength(19);
    expect(nomes).toContain("pedir_lista_de_espera");
    expect(nomes).toContain("entrar_na_lista_de_espera");
  });

  it("revisão da AG5 (achado 4): a mensagem automática da oferta vale em toda conversa, fora da seção da habilidade", async () => {
    const { TEXTO_FIXO_DO_AGENTE, montarInstrucoes } = await import(
      "@/lib/agente/prompt"
    );
    const { CATALOGO_DA_AG5 } = await import("./ag5-conversa");
    const regra =
      'Mensagem automática da lista de espera (vale em toda conversa, com ou sem as ferramentas da lista de espera): a mensagem automática da clínica com um horário da lista de espera (para ficar com ele, responder SIM) é do sistema. Não aceite, não recuse e não fale desse horário; se a pessoa falar dele, passe para a equipe com o motivo "pedido_de_agenda".';
    // Um paragrafo proprio, uma vez so.
    expect(TEXTO_FIXO_DO_AGENTE.split(regra)).toHaveLength(2);
    expect(TEXTO_FIXO_DO_AGENTE).toContain(`\n\n${regra}\n\n`);
    // A secao da habilidade (do titulo ate a linha em branco) nao a tem mais.
    const inicio = TEXTO_FIXO_DO_AGENTE.indexOf(
      "Lista de espera (só com as ferramentas da lista de espera;",
    );
    expect(inicio).toBeGreaterThan(-1);
    const fim = TEXTO_FIXO_DO_AGENTE.indexOf("\n\n", inicio);
    const secao = TEXTO_FIXO_DO_AGENTE.slice(inicio, fim);
    expect(secao).not.toMatch(/mensagem automática|não fale desse horário/i);
    expect(secao).toContain("Encaixe nunca");
    // E vai ao modelo com a lista de espera desligada (e com a agenda
    // desligada): a oferta da reoferta chega a qualquer conversa.
    const desligada = configDaAg5({
      habilidades: { ...configDaAg5().habilidades, lista_de_espera: false },
    });
    const instrucoes = montarInstrucoes({
      config: desligada,
      catalogo: CATALOGO_DA_AG5,
      agoraTexto: "terça-feira, 20/10/2026, 09:00",
    });
    expect(instrucoes).toContain(regra);
    expect(instrucoes).toContain(FRASES_DO_ATENDIMENTO.listaDeEsperaDesligada);
  });

  it("as definições das ferramentas: strict, os enums e sem argumento na entrada", async () => {
    const { FERRAMENTA_PEDIR_LISTA_DE_ESPERA, FERRAMENTA_ENTRAR_NA_LISTA_DE_ESPERA } =
      await import("@/lib/agente/ferramentas/lista-de-espera");
    expect(FERRAMENTA_PEDIR_LISTA_DE_ESPERA).toMatchObject({
      strict: true,
      parameters: {
        required: ["periodos", "dias"],
        additionalProperties: false,
        properties: {
          periodos: { items: { enum: ["manha", "tarde", "noite"] } },
          dias: {
            items: {
              enum: ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"],
            },
          },
        },
      },
    });
    expect(FERRAMENTA_ENTRAR_NA_LISTA_DE_ESPERA).toMatchObject({
      strict: true,
      parameters: { properties: {}, required: [], additionalProperties: false },
    });
    for (const f of [FERRAMENTA_PEDIR_LISTA_DE_ESPERA, FERRAMENTA_ENTRAR_NA_LISTA_DE_ESPERA]) {
      expect(f.description).not.toMatch(/[—–]/);
    }
  });

  it("o peso na decisão: entrar depois de cancelar; pedir junto do pedido de cancelar", async () => {
    const { ferramentaDoTurno } = await import("@/lib/agente/whatsapp");
    expect(
      ferramentaDoTurno({
        desfecho: { tipo: "respondeu" },
        trilha: [],
        ferramentasUsadas: ["buscar_horario", "pedir_lista_de_espera"],
      }),
    ).toBe("pedir_lista_de_espera");
    expect(
      ferramentaDoTurno({
        desfecho: { tipo: "respondeu" },
        trilha: [],
        ferramentasUsadas: ["entrar_na_lista_de_espera", "reservar_horario"],
      }),
    ).toBe("entrar_na_lista_de_espera");
  });

  it("a maior saída da lista cabe no teto da busca de horário (a reserva do gasto já cobre)", async () => {
    const { limiteDaSaidaDaListaDeEspera } = await import(
      "@/lib/agente/ferramentas/lista-de-espera"
    );
    const { limiteDaSaidaDaBuscaDeHorario } = await import(
      "@/lib/agente/ferramentas/buscar-horario"
    );
    const { CATALOGO_DA_AG5 } = await import("./ag5-conversa");
    const maior = JSON.stringify({
      resultado: "um_pedido_de_espera_por_resposta",
      preferencia:
        "de manhã ou à tarde, às segundas, às terças, às quartas, às quintas e aos sábados",
    });
    expect(Buffer.byteLength(maior, "utf8")).toBeLessThan(limiteDaSaidaDaListaDeEspera());
    expect(limiteDaSaidaDaListaDeEspera()).toBeLessThan(
      limiteDaSaidaDaBuscaDeHorario(CATALOGO_DA_AG5),
    );
  });

  it("a leitura defensiva das respostas: motivo desconhecido, pagamento incoerente e preferência fora da lista são null", async () => {
    const { lerRespostaDoPedidoDeEspera, lerRespostaDaEntradaNaEspera } = await import(
      "@/lib/agente/ferramentas/lista-de-espera"
    );
    expect(lerRespostaDoPedidoDeEspera({ ok: false, motivo: "inventado" })).toBeNull();
    expect(
      lerRespostaDoPedidoDeEspera({ ok: false, motivo: "pedido_vencido" }),
    ).toBeNull();
    expect(
      lerRespostaDaEntradaNaEspera({ ok: false, motivo: "pedido_vencido" }),
    ).toEqual({ ok: false, motivo: "pedido_vencido" });
    expect(
      lerRespostaDoPedidoDeEspera({
        ok: true,
        particular: true,
        convenio: "Unimed",
        turnos: [],
        dias: [],
      }),
    ).toBeNull();
    expect(
      lerRespostaDoPedidoDeEspera({
        ok: true,
        particular: true,
        convenio: null,
        turnos: ["madrugada"],
        dias: [],
      }),
    ).toBeNull();
    expect(
      lerRespostaDoPedidoDeEspera({
        ok: false,
        motivo: "ja_na_lista",
        entrada: { profissional: null, turnos: ["manha"], dias: [9] },
      }),
    ).toEqual({ ok: false, motivo: "ja_na_lista", entrada: null });
    expect(lerRespostaDoPedidoDeEspera("ok")).toBeNull();
  });
});
