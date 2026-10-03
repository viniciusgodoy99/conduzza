import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  CadastroActionResult,
  ResumoDosConvenios,
} from "@/app/(app)/cadastros/actions";
import {
  MENSAGEM_CADASTRO_MUDOU,
  MENSAGEM_CONVENIO_INATIVO,
  ROTULO_TIRAR_CONVENIO,
} from "@/lib/domain/convenios-do-medico";

// "Convenios que atende" no modal do Profissional (decisao do dono em
// 02/10/2026; critica §3.4 e §3.5): o que o Salvar manda, como a tela le o
// retorno de salvarProfissionalAction (parcial antes do erro, confirmacao
// antes de gravar, aba parada), a abertura depois que a RPC gravou (para o
// proximo Salvar nao dar CZ409) e os textos do aviso de tirar convenio.

// A action e de servidor (next/cache, sessao): aqui so os helpers puros da
// tela importam, entao o modulo vira um stub.
vi.mock("@/app/(app)/cadastros/actions", () => ({
  salvarJornadaAction: vi.fn(),
  salvarProfissionalAction: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const {
  ABERTURA_SEM_CONVENIO,
  aberturaDepoisDeSalvar,
  AvisoDePlantao,
  conveniosDoSalvar,
  mensagemDoParcial,
  nomesDoResumo,
  passoDepoisDeSalvar,
  salvarMandaConvenios,
  textosDoAvisoDosConvenios,
} = await import("@/components/cadastros/profissionais-tab");
const { AvisoDeConsultas } = await import("@/components/cadastros/comum");

const UNIMED = "conv-unimed";
const BRADESCO = "conv-bradesco";
const AMIL = "conv-amil";
const ENDO = "proc-endo";
const NUTRO = "proc-nutro";

const NOMES = nomesDoResumo({
  convenios: [
    {
      id: UNIMED,
      name: "Unimed",
      plan_name: null,
      requires_card: false,
      notes: null,
      active: true,
    },
    {
      id: BRADESCO,
      name: "Bradesco Saúde",
      plan_name: "Top",
      requires_card: false,
      notes: null,
      active: true,
    },
  ],
  procedimentos: [
    {
      id: ENDO,
      name: "Endocrinologia",
      description: null,
      default_duration_min: 40,
      base_price_cents: 40000,
      requires_evaluation: false,
      prep_instructions: null,
      resource_id: null,
      bookable_by_ai: true,
      active: true,
    },
    {
      id: NUTRO,
      name: "Nutrologia",
      description: null,
      default_duration_min: 60,
      base_price_cents: 50000,
      requires_evaluation: false,
      prep_instructions: null,
      resource_id: null,
      bookable_by_ai: true,
      active: true,
    },
  ],
});

function resumo(parcial: Partial<ResumoDosConvenios> = {}): ResumoDosConvenios {
  return {
    entram: [],
    saem: [],
    deixaDeFazer: [],
    consultasFuturas: 0,
    primeiraConsulta: null,
    ...parcial,
  };
}

describe("conveniosDoSalvar: o que vai para a action", () => {
  const abertura = {
    marcados: [UNIMED, BRADESCO],
    gravados: [UNIMED, BRADESCO],
    emUsoForaDoCadastro: [],
  };

  it("sem mudança e sem cura, não manda nada (ausente = não mexe)", () => {
    expect(conveniosDoSalvar(abertura, new Set([UNIMED, BRADESCO]))).toBeNull();
    // Reordenar não é mudança.
    expect(conveniosDoSalvar(abertura, [BRADESCO, UNIMED])).toBeNull();
  });

  it("com mudança, manda a lista inteira e os pares crus da abertura", () => {
    expect(
      conveniosDoSalvar(abertura, new Set([UNIMED, BRADESCO, AMIL])),
    ).toEqual({
      insurance_ids: [UNIMED, BRADESCO, AMIL],
      insurance_ids_na_abertura: [UNIMED, BRADESCO],
    });
  });

  it("desmarcar tudo manda a lista vazia (tira todos), não 'não mexe'", () => {
    expect(conveniosDoSalvar(abertura, new Set())).toEqual({
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED, BRADESCO],
    });
  });

  it("a cura sem ninguém mexer também vai, com a abertura dos pares crus (nunca os marcados)", () => {
    const curada = {
      marcados: [UNIMED, BRADESCO],
      gravados: [UNIMED],
      emUsoForaDoCadastro: [BRADESCO],
    };
    expect(conveniosDoSalvar(curada, curada.marcados)).toEqual({
      insurance_ids: [UNIMED, BRADESCO],
      insurance_ids_na_abertura: [UNIMED],
    });
    // Desmarcar só o curado volta a ser igual aos pares crus, e ainda assim
    // vai: a RPC conta o curado em `saem` e desativa os vínculos dele.
    expect(conveniosDoSalvar(curada, [UNIMED])).toEqual({
      insurance_ids: [UNIMED],
      insurance_ids_na_abertura: [UNIMED],
    });
  });

  it("profissional novo: só manda quando há convênio marcado, com abertura vazia", () => {
    expect(conveniosDoSalvar(ABERTURA_SEM_CONVENIO, new Set())).toBeNull();
    expect(conveniosDoSalvar(ABERTURA_SEM_CONVENIO, new Set([UNIMED]))).toEqual(
      {
        insurance_ids: [UNIMED],
        insurance_ids_na_abertura: [],
      },
    );
  });

  it("repetido no que está marcado vai uma vez só", () => {
    expect(conveniosDoSalvar(ABERTURA_SEM_CONVENIO, [AMIL, AMIL])).toEqual({
      insurance_ids: [AMIL],
      insurance_ids_na_abertura: [],
    });
  });
});

describe("passoDepoisDeSalvar: como a tela lê o retorno", () => {
  it("parcial com id vem antes do erro: o id fica no formulário", () => {
    const convenios = resumo({
      entram: [{ insuranceId: AMIL, procedureIds: [ENDO] }],
    });
    const resultado: CadastroActionResult = {
      ok: false,
      parcial: true,
      id: "prof-1",
      error:
        "Os convênios foram salvos, mas os dados do profissional não. Clique em Salvar de novo.",
      convenios,
    };
    expect(passoDepoisDeSalvar(resultado)).toEqual({
      tipo: "parcial",
      id: "prof-1",
      erro: resultado.error,
      convenios,
    });
  });

  it("parcial da criação, sem resumo (os convênios não foram gravados)", () => {
    expect(
      passoDepoisDeSalvar({
        ok: false,
        parcial: true,
        id: "prof-novo",
        error:
          "O profissional foi criado, mas os convênios que ele atende não.",
      }),
    ).toMatchObject({ tipo: "parcial", id: "prof-novo", convenios: null });
  });

  it("salvo, com e sem o resumo dos convênios", () => {
    const convenios = resumo();
    expect(passoDepoisDeSalvar({ ok: true, id: "prof-1", convenios })).toEqual({
      tipo: "salvo",
      id: "prof-1",
      convenios,
    });
    expect(passoDepoisDeSalvar({ ok: true, id: "prof-1" })).toEqual({
      tipo: "salvo",
      id: "prof-1",
      convenios: null,
    });
  });

  it("tirar convênio com consulta futura pede confirmação (motivo convenios), com a primeira podendo vir null", () => {
    const convenios = resumo({
      saem: [{ insuranceId: UNIMED, procedureIds: [ENDO] }],
      consultasFuturas: 2,
    });
    expect(
      passoDepoisDeSalvar({
        ok: false,
        code: "consultas_no_periodo",
        motivo: "convenios",
        consultas: 2,
        primeiraConsulta: null,
        convenios,
      }),
    ).toEqual({
      tipo: "confirmar",
      motivo: "convenios",
      consultas: 2,
      primeira: null,
      convenios,
    });
  });

  it("desativar com consulta futura continua o aviso de sempre", () => {
    expect(
      passoDepoisDeSalvar({
        ok: false,
        code: "consultas_no_periodo",
        motivo: "desativar",
        consultas: 1,
        primeiraConsulta: "2026-11-02T13:00:00Z",
      }),
    ).toEqual({
      tipo: "confirmar",
      motivo: "desativar",
      consultas: 1,
      primeira: "2026-11-02T13:00:00Z",
      convenios: null,
    });
  });

  it("aba parada (CZ409) pede para fechar e abrir de novo", () => {
    expect(
      passoDepoisDeSalvar({
        ok: false,
        code: "cadastro_mudou",
        error: MENSAGEM_CADASTRO_MUDOU,
      }),
    ).toEqual({ tipo: "cadastro_mudou", erro: MENSAGEM_CADASTRO_MUDOU });
    expect(passoDepoisDeSalvar({ ok: false, code: "cadastro_mudou" })).toEqual({
      tipo: "cadastro_mudou",
      erro: MENSAGEM_CADASTRO_MUDOU,
    });
  });

  it("os outros erros vão como texto, com a frase de reserva quando falta", () => {
    expect(
      passoDepoisDeSalvar({
        ok: false,
        error: "Um convênio desativado não pode ser marcado.",
      }),
    ).toEqual({
      tipo: "erro",
      erro: "Um convênio desativado não pode ser marcado.",
    });
    expect(passoDepoisDeSalvar({ ok: false })).toEqual({
      tipo: "erro",
      erro: "Não foi possível salvar o profissional.",
    });
    // ok sem id nunca conta como salvo.
    expect(passoDepoisDeSalvar({ ok: true })).toMatchObject({ tipo: "erro" });
  });
});

describe("aberturaDepoisDeSalvar: o próximo Salvar não reenvia a lista velha", () => {
  const abertura = {
    marcados: [UNIMED, BRADESCO],
    gravados: [UNIMED],
    emUsoForaDoCadastro: [BRADESCO],
  };
  const enviados = {
    insurance_ids: [UNIMED, AMIL],
    insurance_ids_na_abertura: [UNIMED],
  };
  const gravada = {
    marcados: [UNIMED, AMIL],
    gravados: [UNIMED, AMIL],
    emUsoForaDoCadastro: [],
  };

  it("salvo: a lista enviada vira os pares crus e os marcados, sem nota de cura", () => {
    const passo = passoDepoisDeSalvar({
      ok: true,
      id: "prof-1",
      convenios: resumo(),
    });
    expect(aberturaDepoisDeSalvar(passo, abertura, enviados)).toEqual(gravada);
  });

  it("parcial da edição (os convênios foram gravados) também atualiza", () => {
    const passo = passoDepoisDeSalvar({
      ok: false,
      parcial: true,
      id: "prof-1",
      error: "Os convênios foram salvos, mas os dados do profissional não.",
      convenios: resumo(),
    });
    expect(aberturaDepoisDeSalvar(passo, abertura, enviados)).toEqual(gravada);
  });

  it("parcial da criação: nada foi gravado nos convênios, a abertura fica vazia", () => {
    const passo = passoDepoisDeSalvar({
      ok: false,
      parcial: true,
      id: "prof-novo",
      error: "O profissional foi criado, mas os convênios que ele atende não.",
    });
    expect(
      aberturaDepoisDeSalvar(passo, ABERTURA_SEM_CONVENIO, {
        insurance_ids: [UNIMED],
        insurance_ids_na_abertura: [],
      }),
    ).toBe(ABERTURA_SEM_CONVENIO);
  });

  it("confirmação, aba parada e erro não mudam a abertura", () => {
    for (const resultado of [
      {
        ok: false,
        code: "consultas_no_periodo",
        motivo: "convenios",
        consultas: 1,
        convenios: resumo({ consultasFuturas: 1 }),
      },
      { ok: false, code: "cadastro_mudou" },
      { ok: false, error: "Profissional não encontrado." },
    ] satisfies CadastroActionResult[]) {
      expect(
        aberturaDepoisDeSalvar(
          passoDepoisDeSalvar(resultado),
          abertura,
          enviados,
        ),
      ).toBe(abertura);
    }
  });

  it("sem convênio no envio, a abertura fica como estava", () => {
    const passo = passoDepoisDeSalvar({ ok: true, id: "prof-1" });
    expect(aberturaDepoisDeSalvar(passo, abertura, null)).toBe(abertura);
  });
});

describe("salvarMandaConvenios: a prévia 'Ao salvar' só aparece quando o Salvar manda a lista", () => {
  const abertura = {
    marcados: [UNIMED, BRADESCO],
    gravados: [UNIMED, BRADESCO],
    emUsoForaDoCadastro: [],
  };

  it("ninguém mexeu: sem prévia, mesmo que o catálogo recarregue com um convênio marcado em outra aba", () => {
    // A matriz ao vivo pode já ter o Amil (outra aba), mas a abertura e os
    // marcados são a foto de quando o modal abriu: o Salvar não manda nada,
    // então "Amil sai de..." seria uma frase que o Salvar não cumpre.
    expect(salvarMandaConvenios(abertura, new Set([UNIMED, BRADESCO]))).toBe(
      false,
    );
  });

  it("marcou ou desmarcou: a lista vai e a prévia aparece", () => {
    expect(salvarMandaConvenios(abertura, [UNIMED, BRADESCO, AMIL])).toBe(true);
    expect(salvarMandaConvenios(abertura, [UNIMED])).toBe(true);
  });

  it("a cura sem mudança também manda (a prévia fica sem frase porque o curado já conta como atual)", () => {
    const curada = {
      marcados: [UNIMED, BRADESCO],
      gravados: [UNIMED],
      emUsoForaDoCadastro: [BRADESCO],
    };
    expect(salvarMandaConvenios(curada, curada.marcados)).toBe(true);
  });

  it("depois do salvo com a jornada que falhou, a prévia some na hora (não repete o que já foi gravado)", () => {
    const enviados = conveniosDoSalvar(abertura, [UNIMED, AMIL]);
    const depois = aberturaDepoisDeSalvar(
      passoDepoisDeSalvar({ ok: true, id: "prof-1", convenios: resumo() }),
      abertura,
      enviados,
    );
    expect(salvarMandaConvenios(depois, [UNIMED, AMIL])).toBe(false);
  });

  it("profissional novo sem convênio marcado: nada vai", () => {
    expect(salvarMandaConvenios(ABERTURA_SEM_CONVENIO, new Set())).toBe(false);
  });
});

describe("mensagemDoParcial: o parcial também salva a jornada e diz o que aconteceu com ela", () => {
  const criadoSemConvenioInativo = `O profissional foi criado, mas os convênios que ele atende não. ${MENSAGEM_CONVENIO_INATIVO}`;
  const editadoSemALinha =
    "Os convênios foram salvos, mas os dados do profissional não. Clique em Salvar de novo.";

  it("criação com o convênio desativado em outra aba e a jornada salva: pede para conferir os convênios", () => {
    expect(mensagemDoParcial(criadoSemConvenioInativo, { ok: true })).toBe(
      "O profissional foi criado, mas os convênios que ele atende não. Um convênio desativado não pode ser marcado. A jornada foi salva. Confira os convênios e clique em Salvar de novo.",
    );
  });

  it("criação com a jornada que também falhou: diz o motivo dela", () => {
    expect(
      mensagemDoParcial(criadoSemConvenioInativo, {
        ok: false,
        error: "Não foi possível salvar a jornada.",
      }),
    ).toBe(
      "O profissional foi criado, mas os convênios que ele atende não. Um convênio desativado não pode ser marcado. A jornada também não foi salva. Não foi possível salvar a jornada. Confira os convênios e clique em Salvar de novo.",
    );
  });

  it("parcial da edição: a jornada entra antes da chamada que a action já trazia", () => {
    expect(mensagemDoParcial(editadoSemALinha, { ok: true })).toBe(
      "Os convênios foram salvos, mas os dados do profissional não. A jornada foi salva. Clique em Salvar de novo.",
    );
    expect(
      mensagemDoParcial(editadoSemALinha, {
        ok: false,
        error: "Confira os horários informados.",
      }),
    ).toBe(
      "Os convênios foram salvos, mas os dados do profissional não. A jornada também não foi salva. Confira os horários informados. Clique em Salvar de novo.",
    );
  });

  it("jornada que falhou sem motivo não deixa espaço sobrando", () => {
    expect(
      mensagemDoParcial(
        "O profissional foi criado, mas os convênios que ele atende não. Clique em Salvar de novo.",
        { ok: false },
      ),
    ).toBe(
      "O profissional foi criado, mas os convênios que ele atende não. A jornada também não foi salva. Clique em Salvar de novo.",
    );
  });

  it("nenhuma composição tem travessão", () => {
    for (const erro of [criadoSemConvenioInativo, editadoSemALinha]) {
      for (const jornada of [
        { ok: true },
        { ok: false, error: "Não foi possível salvar a jornada." },
      ]) {
        expect(mensagemDoParcial(erro, jornada)).not.toMatch(/[–—]/u);
      }
    }
  });
});

describe("AvisoDeConsultas ao tirar convênio sem consulta futura (D3)", () => {
  const titulo = "Este profissional deixa de fazer 1 procedimento: Nutrologia.";
  const semConsulta = (confirmando: boolean) =>
    renderToStaticMarkup(
      <AvisoDeConsultas
        consultas={0}
        primeira={null}
        timezone="America/Fortaleza"
        titulo={titulo}
        rotuloConfirmar={ROTULO_TIRAR_CONVENIO}
        confirmando={confirmando}
        aoConfirmar={() => undefined}
      />,
    );

  it("fica só o título e a confirmação, sem falar de consulta nem levar para a Agenda", () => {
    const html = semConsulta(false);
    expect(html).toContain(titulo);
    expect(html).toContain("Tirar o convênio mesmo assim");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("não desmarca nada");
    expect(html).not.toContain("lembretes");
    expect(html).not.toContain("A primeira é em");
    expect(html).not.toContain('href="/agenda"');
    expect(html).not.toContain("Abrir a Agenda");
    // Sozinha, a confirmação vai em outline (o ghost é o que acompanha o
    // atalho da Agenda).
    expect(html.match(/<button/gu)).toHaveLength(1);
    expect(html).toContain('data-variant="outline"');
    expect(html).not.toContain('data-variant="ghost"');
  });

  it("enquanto salva, o botão fica desabilitado e diz que está salvando", () => {
    const html = semConsulta(true);
    expect(html).toContain("Salvando...");
    expect(html).toMatch(/<button[^>]* disabled=""/u);
  });

  it("com consulta futura volta a frase das consultas e o atalho da Agenda", () => {
    const html = renderToStaticMarkup(
      <AvisoDeConsultas
        consultas={2}
        primeira={null}
        timezone="America/Fortaleza"
        titulo="Há 2 consultas marcadas com este profissional pelo convênio desmarcado. Remarque ou cancele, se for o caso."
        rotuloConfirmar={ROTULO_TIRAR_CONVENIO}
        confirmando={false}
        aoConfirmar={() => undefined}
      />,
    );
    expect(html).toContain("não desmarca nada");
    expect(html).toContain('href="/agenda"');
    expect(html).toContain('data-variant="ghost"');
  });
});

describe("AvisoDePlantao: a faixa que vira o dia pede confirmação", () => {
  it("é alvo de foco fora da ordem do Tab, com as duas saídas", () => {
    const html = renderToStaticMarkup(
      <AvisoDePlantao
        salvando={false}
        aoConfirmar={() => undefined}
        aoCorrigir={() => undefined}
      />,
    );
    expect(html).toMatch(/^<div tabindex="-1" class="rounded-xl">/u);
    expect(html).toContain('role="alert"');
    expect(html).toContain("termina no dia seguinte (plantão noturno)");
    expect(html).toContain("É plantão, salvar assim");
    expect(html).toContain("Corrigir a faixa");
    expect(html).not.toMatch(/[–—]/u);
  });

  it("enquanto salva, só o salvar assim fica desabilitado", () => {
    const html = renderToStaticMarkup(
      <AvisoDePlantao
        salvando
        aoConfirmar={() => undefined}
        aoCorrigir={() => undefined}
      />,
    );
    expect(html.match(/<button[^>]* disabled=""/gu)).toHaveLength(1);
  });
});

describe("textos do aviso de tirar convênio (D3 e D4)", () => {
  it("consulta futura: o título conta as consultas", () => {
    expect(
      textosDoAvisoDosConvenios(
        resumo({
          saem: [{ insuranceId: UNIMED, procedureIds: [ENDO] }],
          consultasFuturas: 1,
        }),
        NOMES,
      ),
    ).toEqual({
      titulo:
        "Há 1 consulta marcada com este profissional pelo convênio desmarcado. Remarque ou cancele, se for o caso.",
      complemento: null,
    });
  });

  it("só deixa de fazer, sem consulta: o título é quem deixa de fazer", () => {
    const textos = textosDoAvisoDosConvenios(
      resumo({
        saem: [{ insuranceId: BRADESCO, procedureIds: [NUTRO] }],
        deixaDeFazer: [NUTRO],
      }),
      NOMES,
    );
    expect(textos.complemento).toBeNull();
    expect(textos.titulo).toContain(
      "Este profissional deixa de fazer 1 procedimento",
    );
    expect(textos.titulo).toContain("Nutrologia");
  });

  it("com os dois, quem deixa de fazer vai como complemento", () => {
    const textos = textosDoAvisoDosConvenios(
      resumo({
        saem: [
          { insuranceId: UNIMED, procedureIds: [ENDO] },
          { insuranceId: BRADESCO, procedureIds: [NUTRO] },
        ],
        deixaDeFazer: [NUTRO],
        consultasFuturas: 3,
      }),
      NOMES,
    );
    expect(textos.titulo).toBe(
      "Há 3 consultas marcadas com este profissional pelos convênios desmarcados. Remarque ou cancele, se for o caso.",
    );
    expect(textos.complemento).toContain("deixa de fazer 1 procedimento");
  });

  it("sem o resumo, um texto que ainda pede para conferir", () => {
    expect(textosDoAvisoDosConvenios(null, NOMES).titulo).toContain(
      "Confira antes de salvar.",
    );
  });

  it("nenhum texto da tela tem travessão", () => {
    const textos = [
      textosDoAvisoDosConvenios(null, NOMES).titulo,
      textosDoAvisoDosConvenios(
        resumo({
          saem: [{ insuranceId: UNIMED, procedureIds: [ENDO] }],
          deixaDeFazer: [ENDO],
          consultasFuturas: 2,
        }),
        NOMES,
      ).complemento ?? "",
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[–—]/u);
    }
  });

  it("o AvisoDeConsultas usa o título e o rótulo de tirar convênio, com a primeira consulta no fuso da clínica", () => {
    const html = renderToStaticMarkup(
      <AvisoDeConsultas
        consultas={1}
        primeira="2026-11-02T13:00:00Z"
        timezone="America/Fortaleza"
        titulo="Há 1 consulta marcada com este profissional pelo convênio desmarcado. Remarque ou cancele, se for o caso."
        rotuloConfirmar={ROTULO_TIRAR_CONVENIO}
        confirmando={false}
        aoConfirmar={() => undefined}
      />,
    );
    expect(html).toContain("pelo convênio desmarcado");
    expect(html).not.toContain("neste");
    expect(html).toContain("Tirar o convênio mesmo assim");
    // 13:00 UTC = 10:00 em Fortaleza.
    expect(html).toMatch(
      /A primeira é em <span class="cz-num">02\/11 às 10:00<\/span>/u,
    );
  });
});

describe("nomesDoResumo", () => {
  it("convênio com plano entre parênteses; o que não está no catálogo tem nome de reserva", () => {
    expect(NOMES.convenio(UNIMED)).toBe("Unimed");
    expect(NOMES.convenio(BRADESCO)).toBe("Bradesco Saúde (Top)");
    expect(NOMES.convenio("conv-desconhecido")).toBe("Outro convênio");
    expect(NOMES.procedimento(ENDO)).toBe("Endocrinologia");
    expect(NOMES.procedimento("proc-desconhecido")).toBe("outro procedimento");
  });
});
