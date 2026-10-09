import { zodResolver } from "@hookform/resolvers/zod";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormControl } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import {
  AbaConhecimento,
  contagemDaBase,
  itemDaTelaSchema,
} from "@/components/agente/aba-conhecimento";
import { instrucoesDaTelaSchema } from "@/components/agente/aba-instrucoes";
import {
  AbaRegras,
  camposDoDia,
  depoisDeMudarAHora,
  depoisDeMudarODia,
  depoisDeMudarOModo,
  errosDoHorario,
} from "@/components/agente/aba-regras";
import {
  AbaPersona,
  personaDaTelaSchema,
  textoDaPrevia,
  valoresDaPersona,
} from "@/components/agente/aba-persona";
import { AbaVersoes } from "@/components/agente/aba-versoes";
import {
  formulariosNaoSalvos,
  GERACAO_INICIAL,
  geracaoDepoisDeDescartar,
  NADA_NAO_SALVO,
  rotuloDoFormulario,
  trocaDeEditorPedeConfirmacao,
} from "@/components/agente/nao-salvo";
import {
  abaDoAgente,
  abasVisiveis,
  dataEHoraNaClinica,
  listaEmTexto,
  textoDasAlteracoes,
  textoDaUltimaPublicada,
  TEXTOS_DO_AGENTE,
} from "@/components/agente/textos";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  EXEMPLO_DO_TOM,
  horarioPadrao,
  horarioSchema,
  type HorarioDeOperacao,
} from "@/lib/domain/agente/config";

import {
  configDeTeste,
  DICA_RECEPCAO,
  FUSO,
  ITEM_ATIVO,
  ITEM_INATIVO,
  VERSAO_1,
  VERSAO_2,
} from "./tela-fixtures";

// As abas da Tela 6 uma a uma (Persona, Conhecimento, Versoes) e os textos
// puros da tela: a regra das abas na URL, o contador do rodape, a data no
// fuso da clinica, os schemas da tela (o da acao mais as regras do filtro do
// CFM, campo a campo) e a varredura da copia (sem travessao, sem jargao).

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

function primeiroErro(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}): { campo: string; mensagem: string } | null {
  const issue = resultado.error?.issues[0];
  return issue
    ? { campo: String(issue.path[0]), mensagem: issue.message }
    : null;
}

describe("textos da tela", () => {
  it("abas: a das instruções só para o super admin; desconhecida cai na Persona", () => {
    expect(abasVisiveis(false).map((aba) => aba.chave)).toEqual([
      "persona",
      "habilidades",
      "conhecimento",
      "regras",
      "versoes",
    ]);
    expect(abasVisiveis(true).map((aba) => aba.chave)).toContain("instrucoes");
    expect(abaDoAgente("versoes", false)).toBe("versoes");
    expect(abaDoAgente("instrucoes", false)).toBe("persona");
    expect(abaDoAgente("instrucoes", true)).toBe("instrucoes");
    expect(abaDoAgente(undefined, true)).toBe("persona");
    expect(abaDoAgente("ia", false)).toBe("persona");
  });

  it("contador do rodapé no singular e no plural", () => {
    expect(textoDasAlteracoes(0)).toBe("Nenhuma alteração para publicar");
    expect(textoDasAlteracoes(1)).toBe("1 alteração não publicada");
    expect(textoDasAlteracoes(3)).toBe("3 alterações não publicadas");
  });

  it("data e hora no fuso da clínica, não em UTC", () => {
    expect(dataEHoraNaClinica("2026-10-06T17:05:00.000Z", FUSO)).toBe(
      "06/10/2026 às 14:05",
    );
    // 02:30 UTC do dia 05 ainda e dia 04 em Fortaleza
    expect(dataEHoraNaClinica("2026-10-05T02:30:00.000Z", FUSO)).toBe(
      "04/10/2026 às 23:30",
    );
  });

  it("rodapé: a última publicada, sem prometer que já está em uso (achado 30)", () => {
    expect(
      textoDaUltimaPublicada(
        { versao: 2, publicadaEm: "2026-10-06T17:05:00.000Z" },
        2,
        FUSO,
      ),
    ).toBe("Última publicada: versão 2, em 06/10/2026 às 14:05.");
    expect(textoDaUltimaPublicada(null, null, FUSO)).toBe(
      "O assistente ainda não foi publicado.",
    );
  });

  it("rodapé: versões que não carregaram nunca viram 'não foi publicado' (achado 29)", () => {
    // O historico falhou (ultima = null), mas a configuracao leu a v3.
    expect(textoDaUltimaPublicada(null, 3, FUSO)).toBe(
      "Última publicada: versão 3.",
    );
  });

  it("lista de abas em texto, com ponto e vírgula (o rótulo já tem 'e')", () => {
    expect(listaEmTexto([])).toBe("");
    expect(listaEmTexto(["Persona"])).toBe("Persona");
    expect(listaEmTexto(["Persona", "Regras e limites"])).toBe(
      "Persona; Regras e limites",
    );
    expect(listaEmTexto(["Persona", "Conhecimento", "Regras e limites"])).toBe(
      "Persona; Conhecimento; Regras e limites",
    );
    // "Persona e Regras e limites" parecia uma aba so
    expect(listaEmTexto(["Persona", "Regras e limites"])).not.toContain(
      "Persona e ",
    );
  });

  it("publicar e restaurar dizem o que acontece de verdade (achados 3, 25 e 30)", () => {
    const T = TEXTOS_DO_AGENTE;
    expect(T.publicado).toBe("Alterações publicadas.");
    expect(T.publicarDescricao).toBe(
      "A nova versão fica guardada em Versões e passa a valer nas conversas quando o assistente for ligado no WhatsApp. O simulador sempre usa o rascunho.",
    );
    // o simulador sempre usa o rascunho: a publicada nunca vale nele
    expect(T.publicarDescricao).not.toMatch(/valer no simulador/);
    expect(T.publicarDescricao).not.toMatch(/já usa|todas as conversas/);
    expect(T.restaurarDescricao).toContain("instruções da equipe Conduzza");
    expect(T.restaurarDescricao).toContain(
      "As perguntas que não estão nesta versão ficam desativadas, não são apagadas",
    );
    expect(T.restaurada(3)).not.toMatch(/assistente usar/);
  });

  it("copia sem travessão e sem jargão (a prévia do prompt é a exceção do dono)", () => {
    const amostras: [string, string][] = [
      ...Object.entries(TEXTOS_DO_AGENTE).flatMap(([chave, valor]) =>
        typeof valor === "string" ? [[chave, valor] as [string, string]] : [],
      ),
      ["habilidadeLigada", TEXTOS_DO_AGENTE.habilidadeLigada("Teste")],
      ["habilidadeDesligada", TEXTOS_DO_AGENTE.habilidadeDesligada("Teste")],
      ["restaurada", TEXTOS_DO_AGENTE.restaurada(2)],
      [
        "naoSalvasTexto",
        TEXTOS_DO_AGENTE.naoSalvasTexto("Persona; Regras e limites"),
      ],
    ];
    for (const [chave, amostra] of amostras) {
      expect(amostra, chave).not.toMatch(/[\u2014\u2013]/);
      if (chave !== "previaTitulo") {
        expect(amostra, chave).not.toMatch(
          /\b(prompt|token|LLM|skill|tenant|handoff|opt-in)\b/i,
        );
      }
    }
  });
});

describe("Persona", () => {
  it("o schema da tela recusa título de profissional no nome", () => {
    const r = personaDaTelaSchema.safeParse({
      nome: "Enfermeira Bia",
      tom: "cordial",
      usarEmoji: false,
      saudacao: "",
      encerramento: "",
    });
    expect(r.success).toBe(false);
    expect(primeiroErro(r)?.campo).toBe("nome");
  });

  it("o schema da tela recusa telefone na saudação, no campo certo", () => {
    const r = personaDaTelaSchema.safeParse({
      nome: "Ana",
      tom: "cordial",
      usarEmoji: false,
      saudacao: "Olá! Ligue para (84) 99999-0000.",
      encerramento: "",
    });
    expect(r.success).toBe(false);
    expect(primeiroErro(r)).toEqual({
      campo: "saudacao",
      mensagem: expect.stringContaining("Tire o telefone"),
    });
  });

  it("vazio vira nulo e texto de recepção passa", () => {
    const r = personaDaTelaSchema.safeParse({
      nome: " Ana ",
      tom: "formal",
      usarEmoji: true,
      saudacao: "Olá! Aqui é a recepção.",
      encerramento: "  ",
    });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      nome: "Ana",
      tom: "formal",
      usarEmoji: true,
      saudacao: "Olá! Aqui é a recepção.",
      encerramento: null,
    });
  });

  it("a prévia junta saudação, o exemplo do tom e o encerramento", () => {
    const valores = valoresDaPersona(
      configDeTeste({ encerramento: "Até breve!" }),
    );
    expect(textoDaPrevia(valores)).toBe(
      `Olá! Aqui é a recepção.\n\n${EXEMPLO_DO_TOM.cordial}\n\nAté breve!`,
    );
    expect(textoDaPrevia({ ...valores, saudacao: "", encerramento: "" })).toBe(
      EXEMPLO_DO_TOM.cordial,
    );
  });

  it("os 3 tons em cartões de rádio com a frase de exemplo, o escolhido marcado", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AbaPersona
          config={configDeTeste()}
          podeEditar
          dica={null}
          pendente={false}
          salvando={false}
          aoSalvar={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    const cordial = html.match(/<input[^>]*value="cordial"[^>]*>/)?.[0];
    expect(cordial).toContain('checked=""');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    for (const exemplo of Object.values(EXEMPLO_DO_TOM)) {
      expect(texto(html)).toContain(exemplo);
    }
    // contador do nome e a previa do paciente
    expect(texto(html)).toContain("3/40");
    expect(texto(html)).toContain("Como o paciente vê");
    expect(html).toContain("Pré-visualização da mensagem");
    // emoji em Checkbox (so vale ao salvar e publicar, C31)
    expect(html).toMatch(/role="checkbox"/);
  });

  it("sem permissão, o formulário trava e o Salvar mostra a dica", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AbaPersona
          config={configDeTeste()}
          podeEditar={false}
          dica={DICA_RECEPCAO}
          pendente={false}
          salvando={false}
          aoSalvar={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toMatch(
      /aria-disabled="true"[^>]*role="radiogroup"|role="radiogroup"[^>]*aria-disabled="true"/,
    );
  });
});

describe("Conhecimento", () => {
  it("o schema da tela recusa CEP, link e preço, com a mensagem de recepcionista", () => {
    const casos = [
      ["Fica na Rua A, 10, CEP 59000-000.", "Tire o CEP"],
      ["Veja em www.clinica.com.br", "Tire o link"],
      ["A consulta custa R$ 200,00.", "Tire o valor"],
    ] as const;
    for (const [resposta, esperado] of casos) {
      const r = itemDaTelaSchema.safeParse({
        id: null,
        pergunta: "Onde fica?",
        resposta,
        ativo: true,
      });
      expect(r.success, resposta).toBe(false);
      expect(primeiroErro(r)?.campo).toBe("resposta");
      expect(primeiroErro(r)?.mensagem).toContain(esperado);
    }
  });

  it("endereço sem CEP passa", () => {
    const r = itemDaTelaSchema.safeParse({
      id: null,
      pergunta: "Onde fica a clínica?",
      resposta: "Na Avenida Brasil, 1200, no bairro Centro, perto da praça.",
      ativo: true,
    });
    expect(r.success).toBe(true);
  });

  it("conta as ativas e avisa do teto da publicação", () => {
    expect(contagemDaBase([ITEM_ATIVO, ITEM_INATIVO])).toEqual({
      ativas: 1,
      passouDoTeto: false,
    });
    const muitas = Array.from({ length: 61 }, (_, i) => ({
      ...ITEM_ATIVO,
      id: `item-${i}`,
    }));
    expect(contagemDaBase(muitas).passouDoTeto).toBe(true);
  });

  function renderBase(base: Parameters<typeof AbaConhecimento>[0]["base"]) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <AbaConhecimento
          base={base}
          podeEditar
          dica={null}
          pendente={false}
          ocupado={() => false}
          acoes={{ aoSalvar: vi.fn(), aoAtivar: vi.fn(), aoExcluir: vi.fn() }}
        />
      </TooltipProvider>,
    );
  }

  it("a caixa informativa do brief vem no topo, com o texto exato", () => {
    expect(texto(renderBase([]))).toContain(
      "Preços, profissionais, procedimentos e convênios vêm automaticamente do Cadastro. Não repita aqui.",
    );
  });

  it("lista com o estado em 3 camadas (Ativa e Desativada)", () => {
    const html = renderBase([ITEM_ATIVO, ITEM_INATIVO]);
    const visivel = texto(html);
    expect(visivel).toContain("Tem estacionamento?");
    expect(visivel).toContain(" Ativa ");
    expect(visivel).toContain("Desativada");
    expect(visivel).toContain("1 de 60 perguntas ativas");
    expect(html).toContain("lucide-circle-check");
    expect(html).toContain("lucide-circle-pause");
  });

  it("vazio com o convite e erro de leitura com o que fazer", () => {
    expect(texto(renderBase([]))).toContain("Nenhuma pergunta ainda");
    expect(texto(renderBase(null))).toContain(
      "Não foi possível carregar as perguntas",
    );
  });
});

describe("Instruções", () => {
  it("o schema da tela deixa instrução longa e recusa telefone", () => {
    // Mais de 700 caracteres (o teto do filtro para o paciente) passa: as
    // instrucoes vao ao modelo, nao ao paciente.
    const longa =
      "Quando perguntarem sobre o sábado, explique que a clínica abre só pela manhã e que a agenda costuma lotar cedo. ".repeat(
        8,
      );
    expect(longa.length).toBeGreaterThan(700);
    expect(
      instrucoesDaTelaSchema.safeParse({ instrucoes: longa }).success,
    ).toBe(true);
    const r = instrucoesDaTelaSchema.safeParse({
      instrucoes: "Passe o telefone (84) 99999-0000 quando pedirem.",
    });
    expect(r.success).toBe(false);
    expect(primeiroErro(r)?.mensagem).toContain("Tire o telefone");
  });
});

describe("Versões", () => {
  function renderVersoes(
    props: Partial<Parameters<typeof AbaVersoes>[0]> = {},
  ): string {
    return renderToStaticMarkup(
      <TooltipProvider>
        <AbaVersoes
          versoes={[VERSAO_2, VERSAO_1]}
          mudancasDoRascunho={[]}
          timezone={FUSO}
          podeEditar
          dica={null}
          pendente={false}
          ocupado={() => false}
          aoRestaurar={vi.fn()}
          {...props}
        />
      </TooltipProvider>,
    );
  }

  it("histórico com data no fuso, autor, o que mudou, a última publicada e Restaurar", () => {
    const html = renderVersoes();
    const visivel = texto(html);
    expect(visivel).toContain("Publicada em 06/10/2026 às 14:05 por Vinicius");
    expect(visivel).toContain(
      "Publicada em 04/10/2026 às 23:30 por Pessoa fora da equipe",
    );
    expect(visivel).toContain("Tom de voz: Formal");
    // "Última publicada", nao "Em uso": nenhuma conversa usa a versao ainda
    expect(visivel).toContain("Última publicada");
    expect(visivel).not.toContain("Em uso");
    expect(html.match(/aria-label="Restaurar a versão \d"/g)).toHaveLength(2);
  });

  it("a versão que só mudou as instruções mostra a linha, sem o texto", () => {
    const visivel = texto(
      renderVersoes({
        versoes: [
          {
            ...VERSAO_2,
            mudancas: [
              { campo: "instrucoes", rotulo: "Instruções da equipe Conduzza" },
            ],
          },
        ],
      }),
    );
    expect(visivel).toContain("Instruções da equipe Conduzza");
    expect(visivel).not.toContain("Sem mudança em relação à versão anterior.");
  });

  it("o rascunho aparece em cima, com o que muda", () => {
    const visivel = texto(
      renderVersoes({
        mudancasDoRascunho: [{ campo: "nome", rotulo: "Nome do assistente" }],
      }),
    );
    expect(visivel).toContain("Próxima versão");
    expect(visivel).toContain("Rascunho");
    expect(visivel).toContain("1 alteração não publicada");
  });

  it("vazio e erro de leitura", () => {
    expect(texto(renderVersoes({ versoes: [] }))).toContain(
      "Nenhuma versão publicada ainda",
    );
    expect(texto(renderVersoes({ versoes: null }))).toContain(
      "Não foi possível carregar as versões",
    );
  });

  it("sem permissão, Restaurar fica visível e desabilitado", () => {
    const html = renderVersoes({ podeEditar: false, dica: DICA_RECEPCAO });
    const botoes = html.match(/<button[^>]*aria-label="Restaurar[^>]*>/g) ?? [];
    expect(botoes).toHaveLength(2);
    for (const botao of botoes) {
      expect(botao).toContain('disabled=""');
    }
  });
});

describe("Regras: Salvar horário nunca falha calado (achados 11 e 37)", () => {
  /** Os erros como o formulario recebe (o mesmo resolver do useForm). */
  async function errosDoResolver(valores: z.input<typeof horarioSchema>) {
    const { errors } = await zodResolver(horarioSchema)(valores, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    return errosDoHorario(errors);
  }

  it("o erro dos minutos aparece mesmo com o campo escondido", async () => {
    // Modo "24 horas" (os minutos nao estao na tela) com NaN nos minutos:
    // antes, o Salvar nao fazia nada e nada aparecia.
    expect(
      await errosDoResolver({
        ...horarioPadrao(),
        modo: "24h",
        minutosSemResposta: Number.NaN,
      }),
    ).toEqual(["Minutos sem resposta da equipe: Use de 1 a 120 minutos."]);
  });

  it("cada hora com o dia e o campo; o fim antes do início não repete o dia", async () => {
    const horario = horarioPadrao();
    expect(
      await errosDoResolver({
        ...horario,
        expediente: {
          ...horario.expediente,
          seg: { aberto: true, inicio: "", fim: "18:00" },
          ter: { aberto: true, inicio: "18:00", fim: "08:00" },
        },
      }),
    ).toEqual([
      "Segunda-feira, Início: Use a hora no formato 08:00.",
      "Terça-feira: o fim do expediente precisa ser depois do início.",
    ]);
  });

  it("dia fechado com hora estragada não trava o Salvar (S8)", async () => {
    const horario = horarioPadrao();
    expect(
      await errosDoResolver({
        ...horario,
        expediente: {
          ...horario.expediente,
          seg: { aberto: false, inicio: "", fim: "08:00" },
        },
      }),
    ).toEqual([]);
  });

  it("o Início de cada dia tem a mensagem dele (FormMessage), como o Fim", () => {
    const fonte = readFileSync("components/agente/aba-regras.tsx", "utf-8");
    for (const campo of ["inicio", "fim"]) {
      const inicio = fonte.indexOf(`name={\`expediente.\${dia}.${campo}\`}`);
      expect(inicio, campo).toBeGreaterThan(-1);
      const bloco = fonte.slice(
        inicio,
        fonte.indexOf("/>\n", fonte.indexOf("</FormItem>", inicio)),
      );
      expect(bloco, campo).toContain("<FormMessage />");
    }
  });

  it("a aba monta sem aviso de correção antes de tentar salvar", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AbaRegras
          horario={horarioPadrao()}
          podeEditar
          dica={null}
          pendente={false}
          salvando={false}
          aoSalvar={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(texto(html)).not.toContain(TEXTOS_DO_AGENTE.horarioComErro);
    expect(errosDoHorario({})).toEqual([]);
  });
});

describe("Regras: a lista de correções nunca fica com erro velho", () => {
  // O formulario de verdade do react-hook-form (o mesmo resolver do
  // useForm), sem a tela: o que a lista "Corrija antes de salvar" le.
  function formulario(valores: z.input<typeof horarioSchema>) {
    return createFormControl<
      z.input<typeof horarioSchema>,
      unknown,
      HorarioDeOperacao
    >({ resolver: zodResolver(horarioSchema), defaultValues: valores });
  }
  type Formulario = ReturnType<typeof formulario>;
  const lista = (form: Formulario) =>
    errosDoHorario(form.control._formState.errors);
  async function tentarSalvar(form: Formulario) {
    const aoSalvar = vi.fn();
    await form.handleSubmit(aoSalvar)();
    return aoSalvar;
  }
  const FIM_ANTES =
    "Segunda-feira: o fim do expediente precisa ser depois do início.";
  function comSegunda(faixa: { aberto: boolean; inicio: string; fim: string }) {
    const horario = horarioPadrao();
    return {
      ...horario,
      expediente: { ...horario.expediente, seg: faixa },
    };
  }

  it("os campos do dia são o Início e o Fim", () => {
    expect(camposDoDia("seg")).toEqual([
      "expediente.seg.inicio",
      "expediente.seg.fim",
    ]);
  });

  it("desmarcar o dia tira da lista o erro das horas que somem", async () => {
    const form = formulario(
      comSegunda({ aberto: true, inicio: "18:00", fim: "08:00" }),
    );
    expect(await tentarSalvar(form)).not.toHaveBeenCalled();
    expect(lista(form)).toEqual([FIM_ANTES]);

    // So marcar (o que o react-hook-form faz sozinho): o erro ficava.
    form.setValue("expediente.seg.aberto", false);
    expect(lista(form)).toEqual([FIM_ANTES]);

    depoisDeMudarODia(form, "seg", false, true);
    expect(lista(form)).toEqual([]);
    // e o Salvar passa: dia fechado nao valida as horas
    expect(await tentarSalvar(form)).toHaveBeenCalledOnce();
  });

  it("reabrir o dia depois de tentar salvar confere as horas de novo", async () => {
    // Segunda fechada com horas estragadas; a terca trava o Salvar.
    const horario = comSegunda({
      aberto: false,
      inicio: "18:00",
      fim: "08:00",
    });
    const form = formulario({
      ...horario,
      expediente: {
        ...horario.expediente,
        ter: { aberto: true, inicio: "18:00", fim: "08:00" },
      },
    });
    expect(await tentarSalvar(form)).not.toHaveBeenCalled();
    const TERCA =
      "Terça-feira: o fim do expediente precisa ser depois do início.";
    expect(lista(form)).toEqual([TERCA]);
    // o que a tela passa como jaTentouSalvar
    expect(form.control._formState.isSubmitted).toBe(true);

    form.setValue("expediente.seg.aberto", true);
    depoisDeMudarODia(form, "seg", true, true);
    await vi.waitFor(() => expect(lista(form)).toEqual([FIM_ANTES, TERCA]));
  });

  it("antes de tentar salvar, marcar ou mexer na hora não mostra erro", async () => {
    const form = formulario(
      comSegunda({ aberto: false, inicio: "18:00", fim: "08:00" }),
    );
    form.setValue("expediente.seg.aberto", true);
    depoisDeMudarODia(form, "seg", true, false);
    depoisDeMudarAHora(form, "seg", false);
    await new Promise((fim) => setTimeout(fim, 0));
    expect(lista(form)).toEqual([]);
  });

  it("mexer no Início confere o Fim também (o erro do fim depende do início)", async () => {
    const form = formulario(
      comSegunda({ aberto: true, inicio: "18:00", fim: "08:00" }),
    );
    await tentarSalvar(form);
    expect(lista(form)).toEqual([FIM_ANTES]);

    // O react-hook-form so confere o campo mexido: o erro do Fim ficava.
    form.setValue("expediente.seg.inicio", "07:00");
    await form.trigger("expediente.seg.inicio");
    expect(lista(form)).toEqual([FIM_ANTES]);

    depoisDeMudarAHora(form, "seg", true);
    await vi.waitFor(() => expect(lista(form)).toEqual([]));
  });

  it("mexer no Fim confere o Início também, sem apagar o erro que ainda vale", async () => {
    const form = formulario(
      comSegunda({ aberto: true, inicio: "", fim: "18:00" }),
    );
    await tentarSalvar(form);
    expect(lista(form)).toEqual([
      "Segunda-feira, Início: Use a hora no formato 08:00.",
    ]);
    form.setValue("expediente.seg.fim", "17:00");
    depoisDeMudarAHora(form, "seg", true);
    await new Promise((fim) => setTimeout(fim, 0));
    expect(lista(form)).toEqual([
      "Segunda-feira, Início: Use a hora no formato 08:00.",
    ]);
  });

  it("sair do modo dos minutos tira da lista o erro dos minutos", async () => {
    const form = formulario({
      ...horarioPadrao(),
      modo: "fallback",
      minutosSemResposta: 0,
    });
    await tentarSalvar(form);
    const ERRO_DOS_MINUTOS =
      "Minutos sem resposta da equipe: Use de 1 a 120 minutos.";
    expect(lista(form)).toEqual([ERRO_DOS_MINUTOS]);

    // no mesmo modo, o campo continua na tela e o erro fica
    depoisDeMudarOModo(form, "fallback");
    expect(lista(form)).toEqual([ERRO_DOS_MINUTOS]);

    // o normalizarMinutos ja voltou o valor ao ultimo salvo
    form.setValue("modo", "24h");
    form.setValue("minutosSemResposta", 5);
    depoisDeMudarOModo(form, "24h");
    expect(lista(form)).toEqual([]);
    expect(await tentarSalvar(form)).toHaveBeenCalledOnce();
  });

  it("a tela chama as três depois de mexer (no dia, na hora e no modo)", () => {
    const fonte = readFileSync("components/agente/aba-regras.tsx", "utf-8");
    expect(fonte).toContain(
      "depoisDeMudarODia(form, dia, marcado, jaTentouSalvar);",
    );
    // no Inicio e no Fim
    expect(
      fonte.split("depoisDeMudarAHora(form, dia, jaTentouSalvar);"),
    ).toHaveLength(3);
    expect(fonte).toContain("depoisDeMudarOModo(form, valor);");
  });
});

describe("edição não salva (achados 10 e 27)", () => {
  it("Conhecimento: abrir outro editor com texto não salvo pede confirmação", () => {
    expect(trocaDeEditorPedeConfirmacao("a", "b", true)).toBe(true);
    expect(trocaDeEditorPedeConfirmacao("a", ":nova", true)).toBe(true);
    // sem nada digitado, troca direto
    expect(trocaDeEditorPedeConfirmacao("a", "b", false)).toBe(false);
    // nenhum aberto, ou o mesmo
    expect(trocaDeEditorPedeConfirmacao(null, "b", true)).toBe(false);
    expect(trocaDeEditorPedeConfirmacao("a", "a", true)).toBe(false);
  });

  it("o publicar lista as abas com edição pendente, na ordem das abas", () => {
    const estado = {
      ...NADA_NAO_SALVO,
      regras: true,
      persona: true,
      instrucoes: true,
    };
    expect(formulariosNaoSalvos(estado, false)).toEqual(["persona", "regras"]);
    expect(formulariosNaoSalvos(estado, true)).toEqual([
      "persona",
      "regras",
      "instrucoes",
    ]);
    expect(formulariosNaoSalvos(NADA_NAO_SALVO, true)).toEqual([]);
    expect(formulariosNaoSalvos(estado, false).map(rotuloDoFormulario)).toEqual(
      ["Persona", "Regras e limites"],
    );
  });

  it("descartar remonta só os formulários pendentes", () => {
    expect(
      geracaoDepoisDeDescartar(GERACAO_INICIAL, ["persona", "conhecimento"]),
    ).toEqual({ persona: 1, conhecimento: 1, regras: 0, instrucoes: 0 });
  });
});
