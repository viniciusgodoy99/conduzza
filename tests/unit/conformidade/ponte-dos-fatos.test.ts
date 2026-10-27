import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { montarFatosDoTurno, profissionalDaSaida } from "@/lib/agente/fatos";
import { nomesDoCatalogo } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  fatosValidos,
  regrasDosFatos,
} from "@/lib/domain/conformidade/fatos-do-turno";
import {
  AGORA,
  configComAgenda,
  FUSO,
} from "@/tests/unit/agente/agenda-fixtures";
import { catalogoDoCadastro } from "@/tests/unit/agente/cadastro-fixtures";

// Revisao curta das correcoes da AG3 (achado 5): a ponte que monta os fatos
// do turno (lib/agente/fatos.ts) leva o profissional de cada acao e de cada
// consulta lida (o que a ferramenta passou ou o da propria saida que o
// modelo leu) e os nomes dos profissionais e das unidades do Cadastro.

const QUARTA = { dia: "quarta, 21/10", hora: "14:00" };

describe("o profissional da saída da ferramenta", () => {
  it("o do objeto de cima, de horario_reservado e de consulta_marcada, com o mesmo dia e hora", () => {
    expect(
      profissionalDaSaida(
        JSON.stringify({
          resultado: "reservado",
          ...QUARTA,
          profissional: "Dra. Ana Lima",
        }),
        QUARTA,
      ),
    ).toBe("Dra. Ana Lima");
    expect(
      profissionalDaSaida(
        JSON.stringify({
          resultado: "reserva_diferente",
          horario_reservado: { ...QUARTA, profissional: "Dr. Bruno Costa" },
        }),
        QUARTA,
      ),
    ).toBe("Dr. Bruno Costa");
    expect(
      profissionalDaSaida(
        JSON.stringify({
          resultado: "atendimento_em_andamento",
          consulta_marcada: { ...QUARTA, profissional: "Dra. Ana Lima" },
        }),
        QUARTA,
      ),
    ).toBe("Dra. Ana Lima");
  });

  it("sem ele, com outro dia ou hora, só na lista, dois diferentes ou fora do JSON: nulo", () => {
    expect(
      profissionalDaSaida(
        JSON.stringify({ resultado: "marcado", ...QUARTA }),
        QUARTA,
      ),
    ).toBeNull();
    expect(
      profissionalDaSaida(
        JSON.stringify({
          resultado: "reservado",
          dia: "quinta, 22/10",
          hora: "14:00",
          profissional: "Dra. Ana Lima",
        }),
        QUARTA,
      ),
    ).toBeNull();
    // A lista de horarios oferecidos pode ter o mesmo horario com dois
    // profissionais: nao conta.
    expect(
      profissionalDaSaida(
        JSON.stringify({
          resultado: "atendimento_em_andamento",
          horarios_oferecidos: [{ ...QUARTA, profissional: "Dr. Bruno Costa" }],
        }),
        QUARTA,
      ),
    ).toBeNull();
    expect(
      profissionalDaSaida(
        JSON.stringify({
          resultado: "atendimento_em_andamento",
          ...QUARTA,
          profissional: "Dra. Ana Lima",
          horario_reservado: { ...QUARTA, profissional: "Dr. Bruno Costa" },
        }),
        QUARTA,
      ),
    ).toBeNull();
    expect(profissionalDaSaida("não é JSON", QUARTA)).toBeNull();
    expect(profissionalDaSaida("[1, 2]", QUARTA)).toBeNull();
  });
});

describe("os fatos montados levam o profissional e o Cadastro", () => {
  const catalogo = catalogoDoCadastro();
  function montar(
    ferramentas: Parameters<typeof montarFatosDoTurno>[0]["ferramentas"],
  ) {
    return montarFatosDoTurno({
      config: configComAgenda(),
      catalogo,
      agoraTexto: "terça-feira, 20/10/2026, 09:00",
      agoraMs: AGORA,
      fuso: FUSO,
      ferramentas,
    });
  }

  it("a ação e a consulta lida com o profissional da saída; o que a ferramenta passou vence", () => {
    const fatos = montar([
      {
        saida: JSON.stringify({
          resultado: "reservado",
          ...QUARTA,
          profissional: "Dra. Ana Lima",
        }),
        fatos: {
          acao: "reservou",
          horarioDaAcao: { ...QUARTA, unidade: "Centro" },
        },
      },
      {
        saida: JSON.stringify({
          resultado: "marcado",
          ...QUARTA,
          profissional: "Dra. Ana Lima",
        }),
        fatos: {
          acao: "marcou",
          horarioDaAcao: {
            ...QUARTA,
            unidade: "Centro",
            profissional: "Dr. Bruno Costa",
          },
        },
      },
      {
        saida: JSON.stringify({ resultado: "ja_tem_consulta", ...QUARTA }),
        fatos: {
          consultaLida: true,
          consultaComHorario: {
            ...QUARTA,
            unidade: null,
            marcadaNestaConversa: false,
          },
        },
      },
    ]);
    expect(fatosValidos(fatos)).toBe(true);
    expect(fatos.horariosDasAcoes).toEqual([
      {
        ...QUARTA,
        unidade: "Centro",
        profissional: "Dra. Ana Lima",
        acao: "reservou",
      },
      {
        ...QUARTA,
        unidade: "Centro",
        profissional: "Dr. Bruno Costa",
        acao: "marcou",
      },
    ]);
    // Sem o profissional na saida: nao se sabe (o campo nem aparece).
    expect(fatos.consultasLidas).toEqual([
      { ...QUARTA, unidade: null, marcadaNestaConversa: false },
    ]);
    expect(fatos.consultasLidas[0]).not.toHaveProperty("profissional");
  });

  it("os nomes dos profissionais e das unidades do Cadastro", () => {
    const fatos = montar([]);
    expect(fatosValidos(fatos)).toBe(true);
    const profissionais = (catalogo.profissionais ?? []).map((p) => p.nome);
    expect(profissionais.length).toBeGreaterThan(0);
    expect(fatos.profissionais).toEqual(expect.arrayContaining(profissionais));
    expect(new Set(fatos.profissionais).size).toBe(fatos.profissionais?.length);
    expect(fatos.unidades).toEqual(
      (catalogo.unidades ?? []).map((u) => u.nome),
    );
  });

  it("de ponta a ponta: a frase da ação com outro profissional do Cadastro barra", () => {
    const [ana, outro] = (catalogo.profissionais ?? []).map((p) => p.nome);
    expect(ana).toBeDefined();
    expect(outro).toBeDefined();
    const fatos = montar([
      {
        saida: JSON.stringify({
          resultado: "marcado",
          ...QUARTA,
          profissional: ana,
        }),
        fatos: { acao: "marcou", horarioDaAcao: { ...QUARTA, unidade: null } },
      },
    ]);
    const regras = (rascunho: string) =>
      regrasDosFatos(rascunho, {
        fatos,
        nomesDoCatalogo: nomesDoCatalogo(catalogo),
        mensagensDoPaciente: [],
      }).map((a) => a.regra);
    expect(
      regras(
        `Pronto! Sua consulta ficou marcada para quarta, 21/10 às 14:00 com ${outro}.`,
      ),
    ).toContain("profissional_fora_da_acao");
    expect(
      regras(
        `Pronto! Sua consulta ficou marcada para quarta, 21/10 às 14:00 com ${ana}.`,
      ),
    ).not.toContain("profissional_fora_da_acao");
  });
});
