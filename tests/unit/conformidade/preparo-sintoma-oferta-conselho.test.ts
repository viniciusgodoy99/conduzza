import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PADROES_DE_SAIDA } from "@/lib/domain/conformidade/padroes";
import {
  conferirParaEnvio,
  problemasDoTextoDoPreparo,
  recusaPeloConselho,
} from "@/lib/domain/conformidade/preparo-aprovado";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  conselhoDaLinhaDoRt,
  conteudoRecusadoPeloBanco,
  FONTE_DA_OFERTA_DE_OUTRO_PROCEDIMENTO,
  FONTE_DO_SINTOMA_NORMALIZADO,
  mensagemDoPreparo,
  normalizaSintoma,
  ofereceOutroProcedimento,
} from "@/lib/domain/preparo";
import {
  CONTROLES_DE_SAIDA,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "@/tests/fixtures/ia/conformidade/casos";

// As tres decisoes do dono de 05/11/2026 na AG7: recusar a normalizacao de
// sintoma (ponto 5), o remedio ou a dose so de RT de CRM ou CRO (ponto 6) e
// recusar a oferta de outro procedimento (ponto 8). As recusas valem ao salvar,
// ao aprovar e a cada envio, em TS e no banco; a paridade de comportamento com
// o SQL de verdade roda no harness (paridade-ts), e aqui fica a dos bytes.

const MIGRATION = readFileSync(
  "supabase/migrations/20261103100000_preparo_aprovado_pelo_rt.sql",
  "utf-8",
);

describe("a normalizacao de sintoma e recusada", () => {
  it.each([
    "Cólica leve depois do laxante é normal e passa sozinha.",
    "É normal sentir cólica depois do laxante.",
    "Enjoo é esperado no primeiro dia.",
    "A tontura passa sozinha.",
    "Isso passa sozinho.",
    "Vermelhidão é comum nas primeiras horas.",
    "É uma reação normal.",
    "A dor vai passar em algumas horas.",
    "Inchaço some sozinho.",
    "Sangramento leve faz parte do procedimento.",
    "O desconforto é passageiro.",
    "A cólica é um efeito esperado do laxante.",
  ])("%s", (texto) => {
    const { recusas, trechosDasRecusas } = problemasDoTextoDoPreparo(texto);
    // Revisao final da AG7 (achado 2): o verbo do sintoma, o sintoma que passa
    // e a frase que se refere a anterior.
    "É normal doer.",
    "Não se preocupe se doer.",
    "A dor passa rápido.",
    "Não se preocupe se arder.",
    "Fique tranquila se sangrar um pouco.",
    "Isso é normal.",
    "Tudo isso é esperado.",
    "Isso passa logo.",
    "É comum coçar.",
    "O inchaço diminui em dois dias.",
    expect(recusas).toContain("triagem");
    expect(trechosDasRecusas.find((t) => t.categoria === "triagem")?.trecho).toBe(
      texto,
    );
    expect(conteudoRecusadoPeloBanco(texto).map((a) => a.causa)).toContain(
      "sintoma_normalizado",
    );
  });

  it.each([
    // Decisao desta leva: sem falar de sintoma, a frase e administrativa.
    "É normal levar um acompanhante.",
    "É comum haver fila na recepção.",
    "É esperado que você chegue 15 minutos antes.",
    "Traga o documento. É normal esperar um pouco.",
    "Em caso de dor forte, procure atendimento.",
    "Coma normalmente até as 18h.",
    "Mantenha a alimentação normal.",
    "Pode vir sozinho.",
    "Não venha sozinho.",
  ])("passa: %s", (texto) => {
    expect(normalizaSintoma(texto)).toBe(false);
    // Revisao final da AG7 (achado 2): os falsos positivos, e o alerta.
    "Você não pode passar sozinha pela recepção.",
    "Em caso de febre, é comum remarcar o exame.",
    "É comum remarcar o exame em caso de febre.",
    "Em caso de dor que não passa, procure atendimento.",
    "Se a dor não melhora, procure atendimento.",
    "Pode haver cólica. É normal levar um acompanhante.",
    "Em caso de dor forte, procure atendimento. Não se preocupe com a chegada.",
  });

  it("o sintoma em outra frase nao conta, e os espacos repetidos nao escapam", () => {
    expect(normalizaSintoma("Pode ter cólica.\nÉ normal levar acompanhante.")).toBe(
      false,
    );
    expect(normalizaSintoma("Cólica   é   normal.")).toBe(true);
  });
});


  it.each([
    "Pode haver cólica. Isso é normal.",
    "Pode haver cólica. É normal.",
    "Pode haver cólica.\nÉ normal.",
    "Pode ter enjoo. Não se preocupe.",
    "Pode arder. Não se preocupe com isso.",
    "Pode haver cólica. Faz parte do preparo.",
  ])("a frase que se refere à anterior: %s", (texto) => {
    expect(normalizaSintoma(texto)).toBe(true);
  });
describe("a oferta de outro procedimento e recusada", () => {
  it.each([
    "Aproveite e faça também a limpeza de pele.",
    "Aproveite para fazer a limpeza de pele.",
    "Que tal agendar também a toxina?",
    "Faça também a limpeza de pele.",
    "Agende junto a drenagem.",
    "Conheça também o nosso peeling.",
    "Aproveite a visita e marque a avaliação.",
  ])("%s", (texto) => {
    expect(problemasDoTextoDoPreparo(texto).recusas).toContain("oferta_casada");
    // Revisao final da AG7 (achado 4): a estrutura, nao o nome do procedimento.
    "Aproveite e faça também a limpeza da pele.",
    "Faça também a remoção de tatuagem.",
    "Que tal uma limpeza de pele?",
    "Você também pode fazer a limpeza de pele.",
    "Você pode também fazer um peeling.",
    "Fazer também o botox fica melhor.",
    expect(conteudoRecusadoPeloBanco(texto).map((a) => a.causa)).toContain(
      "oferta_de_outro_procedimento",
    );
  });

  it.each([
    "Faça também o jejum.",
    "Aproveite para trazer os exames.",
    "Aproveite para fazer os exames antes.",
    "Faça também a limpeza da pele com sabonete neutro.",
    "Faça também a lavagem intestinal.",
    "Agende também o retorno.",
    "Traga também os exames.",
  ])("passa: %s", (texto) => {
    expect(ofereceOutroProcedimento(texto)).toBe(false);
    // Revisao final da AG7 (achado 4): o item do preparo continua passando.
    "Faça também a assinatura do termo.",
    "faça também o jejum",
    "aproveite para trazer os exames",
    "Faça também a remoção do esmalte.",
    "Que tal trazer os exames antes?",
    "Você também pode fazer o jejum em casa.",
  });
});

describe("os controles da bateria nao caem nas duas regras", () => {
  it("zero falso positivo", () => {
    const pegos = CONTROLES_DE_SAIDA.map((c) => c.rascunho).filter(
      (t) => normalizaSintoma(t) || ofereceOutroProcedimento(t),
    );
    expect(pegos).toEqual([]);
    expect(CONTROLES_DE_SAIDA.length).toBeGreaterThan(400);
  });

  it("o preparo realista passa", () => {
    expect(problemasDoTextoDoPreparo(TEXTO_DO_PREPARO_DE_TESTE).recusas).toEqual(
      [],
    );
  });
});

describe("remedio ou dose so de RT de CRM ou CRO", () => {
  const COM_REMEDIO = "Tome 2 comprimidos de bisacodil às 18h.";

  it("CRM e CRO aceitam; os outros conselhos, e o conselho desconhecido, nao", () => {
    expect(recusaPeloConselho(COM_REMEDIO, "CRM")).toEqual([]);
    expect(recusaPeloConselho(COM_REMEDIO, "CRO")).toEqual([]);
    for (const conselho of ["CRBM", "CRF", "COREN", "CREFITO", "CRN", "CRP", "CRFa", "CREF", null]) {
      expect(recusaPeloConselho(COM_REMEDIO, conselho)).toEqual([
        "medicamento",
        "dosagem",
      ]);
    }
  });

  it("texto sem remedio nem dose passa em todo conselho", () => {
    expect(recusaPeloConselho("Traga o documento e os exames.", "CRN")).toEqual(
      [],
    );
  });

  it("limite conhecido: 'em jejum' conta como dose (o padrao horario_de_uso)", () => {
    expect(recusaPeloConselho("Venha em jejum.", "CRBM")).toEqual(["dosagem"]);
  });

  it("o envio recusa pelo conselho da linha do RT", () => {
    const lido = (conselho: string) => {
      const mensagem = mensagemDoPreparo({
        procedimento: "Colonoscopia",
        rt: { nome: "Dra. Ana", conselho, uf: "CE", numero: "123" },
        texto: COM_REMEDIO,
      });
      return {
        versao_id: "0b9d6a51-3c1e-4c3f-9d0e-2a7f5b8c1d42",
        procedure_id: "5e2f8c31-7a4b-4e6d-8f1a-9c0b3d2e4f15",
        versao: 1,
        mensagem,
        sha256: sha256DoTexto(mensagem),
      };
    };
    expect(conferirParaEnvio(lido("CRM")).tipo).toBe("pronto");
    expect(conferirParaEnvio(lido("CRN"))).toMatchObject({
      tipo: "recusado",
      recusas: ["medicamento", "dosagem"],
    });
  });

  it("le o conselho da linha do RT", () => {
    expect(
      conselhoDaLinhaDoRt("Responsável técnico da clínica: Ana (CRFa-CE 12/3)"),
    ).toBe("CRFa");
    expect(conselhoDaLinhaDoRt("Responsável técnico da clínica: Ana")).toBeNull();
  });
});

describe("a paridade com o SQL, nos bytes", () => {
  it("as duas regras novas estao na migration, iguais", () => {
    expect(MIGRATION).toContain(`b.frases ~ '${FONTE_DO_SINTOMA_NORMALIZADO}'`);
    expect(MIGRATION).toContain(
      `b.frases ~ '${FONTE_DA_OFERTA_DE_OUTRO_PROCEDIMENTO}'`,
    );
  });

  it("cada padrao de remedio e de dose do filtro esta em preparo_conselho_recusa_texto", () => {
    const padroes = PADROES_DE_SAIDA.filter(
      (p) => p.categoria === "medicamento" || p.categoria === "dosagem",
    );
    expect(padroes.length).toBeGreaterThan(10);
    const corpo = MIGRATION.slice(
      MIGRATION.indexOf(
        "create function public.preparo_conselho_recusa_texto",
      ),
      MIGRATION.indexOf("revoke all on function public.preparo_conselho_recusa_texto"),
    );
    for (const padrao of padroes) {
      expect(corpo).toContain(
        `b.base ~ '${padrao.regex.source.replaceAll("\\b", "\\y")}'`,
      );
    }
    // E nenhum a mais: a mesma contagem.
    expect(corpo.match(/b\.base ~ /g)?.length).toBe(padroes.length);
  });
});
