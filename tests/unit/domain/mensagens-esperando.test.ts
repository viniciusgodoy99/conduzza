import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  contarMensagensEsperando,
  KINDS_DE_ENVIO_AUTOMATICO,
  MAX_NUMEROS_CONTADOS,
} from "@/lib/queries/mensagens-esperando";

// Faixa de desconectado com varios numeros (docs/07, Fase 4): quantas
// mensagens automaticas esperam a reconexao de cada numero. A contagem roda
// com o service role (a RLS da fila e so do administrador), entao o filtro
// da CLINICA e o que a prende ao tenant: este teste trava os filtros.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const RECEPCAO = "22222222-2222-4222-8222-222222222222";
const CENTRO = "33333333-3333-4333-8333-333333333333";

type Chamada = { metodo: string; args: unknown[] };

function adminGravador(
  resposta: (numeroId: string) => { count: number | null; error: unknown },
) {
  const consultas: Chamada[][] = [];
  const admin = {
    from(tabela: string) {
      const chamadas: Chamada[] = [{ metodo: "from", args: [tabela] }];
      consultas.push(chamadas);
      const consulta: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "or"]) {
        consulta[metodo] = (...args: unknown[]) => {
          chamadas.push({ metodo, args });
          return consulta;
        };
      }
      consulta.then = (
        resolver: (valor: { count: number | null; error: unknown }) => unknown,
      ) => {
        const numero = chamadas.find(
          (c) => c.metodo === "eq" && c.args[0] === "whatsapp_account_id",
        )?.args[1] as string;
        return resolver(resposta(numero));
      };
      return consulta;
    },
  };
  return { admin, consultas };
}

describe("contarMensagensEsperando", () => {
  it("conta por numero, presa a clinica, so envio automatico pendente que ja devia ter saido", async () => {
    const { admin, consultas } = adminGravador((id) => ({
      count: id === RECEPCAO ? 3 : 0,
      error: null,
    }));
    const agora = new Date("2026-09-25T12:00:00.000Z");
    const resultado = await contarMensagensEsperando(
      admin as never,
      CLINICA,
      [RECEPCAO, CENTRO],
      agora,
    );
    expect(resultado).toEqual({ [RECEPCAO]: 3, [CENTRO]: 0 });
    expect(consultas).toHaveLength(2);
    const primeira = consultas[0]!;
    expect(primeira).toContainEqual({ metodo: "from", args: ["job_queue"] });
    expect(primeira).toContainEqual({
      metodo: "select",
      args: ["id", { count: "exact", head: true }],
    });
    expect(primeira).toContainEqual({
      metodo: "eq",
      args: ["clinic_id", CLINICA],
    });
    expect(primeira).toContainEqual({
      metodo: "eq",
      args: ["status", "pendente"],
    });
    expect(primeira).toContainEqual({
      metodo: "in",
      args: ["kind", [...KINDS_DE_ENVIO_AUTOMATICO]],
    });
    expect(primeira).toContainEqual({
      metodo: "or",
      args: [
        'run_at.lte."2026-09-25T12:00:00.000Z",attempts.gt.0,devolucoes.gt.0',
      ],
    });
  });

  it("os kinds sao os de envio do motor", () => {
    expect([...KINDS_DE_ENVIO_AUTOMATICO]).toEqual([
      "enviar_mensagem_ativa",
      "executar_passo_de_regua",
    ]);
  });

  it("numero cuja leitura falhou fica de fora: a faixa nao afirma nada dele", async () => {
    const { admin } = adminGravador((id) =>
      id === CENTRO
        ? { count: null, error: { message: "falhou" } }
        : { count: 2, error: null },
    );
    expect(
      await contarMensagensEsperando(admin as never, CLINICA, [
        RECEPCAO,
        CENTRO,
      ]),
    ).toEqual({ [RECEPCAO]: 2 });
  });

  it("ids repetidos contam uma vez, com teto de numeros", async () => {
    const ids = Array.from(
      { length: MAX_NUMEROS_CONTADOS + 5 },
      (_, i) => `0000${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`,
    );
    const { admin, consultas } = adminGravador(() => ({
      count: 1,
      error: null,
    }));
    await contarMensagensEsperando(admin as never, CLINICA, [
      RECEPCAO,
      RECEPCAO,
    ]);
    expect(consultas).toHaveLength(1);
    const outro = adminGravador(() => ({ count: 1, error: null }));
    await contarMensagensEsperando(outro.admin as never, CLINICA, ids);
    expect(outro.consultas).toHaveLength(MAX_NUMEROS_CONTADOS);
  });
});
