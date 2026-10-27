import { beforeEach, describe, expect, it, vi } from "vitest";

// "Ver dados informados" (AG3; decisao D-7 do dono): lerDadosInformadosAction
// (app/(app)/agenda/actions.ts) e lerDadosInformadosNaMarcacao
// (lib/queries/dados-da-marcacao.ts), contra um cliente do Supabase dublado:
//   - a guarda de sempre da Agenda (sessao e papel com escrita): o papel
//     leitura nem chega ao banco, e o id passa pelo Zod antes;
//   - a leitura e pela SESSAO, pela RPC ler_dados_informados_na_marcacao
//     (que confere o papel de novo e grava a trilha leu_dados_da_marcacao):
//     uma chamada, com a clinica da sessao, nunca a da tela;
//   - o retorno do banco passa por um Zod (campo que falta ou fora da forma e
//     erro, nunca dado pela metade; chave nova do banco e descartada) e chega
//     a tela com o NOME de quem aprovou, sem o id;
//   - os erros do banco viram texto de recepcionista, e o log leva so ids e o
//     codigo, nunca o que o paciente informou.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const CONSULTA = "c0c0c0c0-0000-4000-8000-000000000001";
const USUARIO = "e1e1e1e1-0000-4000-8000-000000000001";
const QUEM_APROVOU = "e1e1e1e1-0000-4000-8000-000000000002";

type RespostaDoRpc = { data: unknown; error: { code?: string } | null };

const estado = {
  rpc: { data: { dados: null }, error: null } as RespostaDoRpc | "lanca",
  perfis: [] as { user_id: string; name: string }[],
  erroDoPerfil: null as { message: string } | null,
  rpcs: [] as { nome: string; args: unknown }[],
  leiturasDePerfil: [] as { colunas: string; ids: unknown }[],
};

const cliente = {
  rpc: async (nome: string, args: unknown) => {
    estado.rpcs.push({ nome, args });
    if (estado.rpc === "lanca") {
      throw new Error("rede");
    }
    return estado.rpc;
  },
  from: (tabela: string) => {
    if (tabela !== "profile") {
      throw new Error(`tabela ${tabela} sem dublê`);
    }
    const leitura = { colunas: "", ids: null as unknown };
    const api = {
      select: (colunas: string) => {
        leitura.colunas = colunas;
        return api;
      },
      in: (_coluna: string, ids: unknown) => {
        leitura.ids = ids;
        return api;
      },
      then: <T>(
        ok: (valor: { data: unknown; error: unknown }) => T,
        falha?: (erro: unknown) => T,
      ) => {
        estado.leiturasDePerfil.push(leitura);
        return Promise.resolve({
          data: estado.erroDoPerfil ? null : estado.perfis,
          error: estado.erroDoPerfil,
        }).then(ok, falha);
      },
    };
    return api;
  },
};

const sessao = {
  userId: USUARIO,
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "recepcao" as string,
    status: "ativo",
  },
};
let semSessao = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => (semSessao ? null : sessao),
}));

const { lerDadosInformadosAction } = await import("@/app/(app)/agenda/actions");
const { lerDadosInformadosNaMarcacao } =
  await import("@/lib/queries/dados-da-marcacao");

// Dados de exemplo (nada de paciente real).
function linhaDoBanco(extra: Record<string, unknown> = {}) {
  return {
    nome_completo: "Paciente de Teste da Silva",
    data_nascimento: "1990-05-09",
    cpf: "12345678909",
    carteirinha: "0001 2345 6789",
    para_o_titular: true,
    informado_em: "2026-10-21T17:05:00.123456+00:00",
    atualizado_em: "2026-10-21T17:06:00+00:00",
    aplicado_em: null,
    aplicado_por: null,
    ...extra,
  };
}

let logs: string[] = [];

beforeEach(() => {
  estado.rpc = { data: { dados: null }, error: null };
  estado.perfis = [];
  estado.erroDoPerfil = null;
  estado.rpcs = [];
  estado.leiturasDePerfil = [];
  sessao.active.role = "recepcao";
  semSessao = false;
  logs = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    logs.push(String(linha));
    return true;
  });
});

describe("a guarda, antes do banco", () => {
  it("sem sessão: pede para entrar de novo, sem tocar o banco", async () => {
    semSessao = true;
    expect(await lerDadosInformadosAction(CONSULTA)).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    expect(estado.rpcs).toEqual([]);
  });

  it("papel que só vê a agenda (leitura): a dica, sem tocar o banco", async () => {
    sessao.active.role = "leitura";
    expect(await lerDadosInformadosAction(CONSULTA)).toEqual({
      ok: false,
      error: "Seu perfil não vê os dados que o paciente informou.",
    });
    expect(estado.rpcs).toEqual([]);
  });

  it("id que não é de consulta: recusa antes do banco", async () => {
    for (const id of ["qualquer", "", null, 42, { id: CONSULTA }]) {
      expect(await lerDadosInformadosAction(id), String(id)).toEqual({
        ok: false,
        error: "Consulta inválida.",
      });
    }
    expect(estado.rpcs).toEqual([]);
  });
});

describe("a leitura pela RPC (sob demanda)", () => {
  it("quem aprova (administrador, gestor, recepção e profissional) lê pela sessão, uma chamada, com a clínica da sessão", async () => {
    for (const papel of ["admin", "gestor", "recepcao", "profissional"]) {
      estado.rpcs = [];
      sessao.active.role = papel;
      expect(await lerDadosInformadosAction(CONSULTA), papel).toEqual({
        ok: true,
        dados: null,
      });
      expect(estado.rpcs).toEqual([
        {
          nome: "ler_dados_informados_na_marcacao",
          args: { p_clinic_id: CLINICA, p_appointment_id: CONSULTA },
        },
      ]);
    }
  });

  it("sem dado: vazio, sem ler o nome de ninguém", async () => {
    expect(await lerDadosInformadosAction(CONSULTA)).toEqual({
      ok: true,
      dados: null,
    });
    expect(estado.leiturasDePerfil).toEqual([]);
  });

  it("com dado ainda não aplicado: a linha para a tela, sem id de ninguém", async () => {
    estado.rpc = { data: { dados: linhaDoBanco() }, error: null };
    expect(await lerDadosInformadosAction(CONSULTA)).toEqual({
      ok: true,
      dados: {
        nomeCompleto: "Paciente de Teste da Silva",
        dataNascimento: "1990-05-09",
        cpf: "12345678909",
        carteirinha: "0001 2345 6789",
        paraOTitular: true,
        informadoEm: "2026-10-21T17:05:00.123456+00:00",
        atualizadoEm: "2026-10-21T17:06:00+00:00",
        aplicadoEm: null,
        aplicadoPor: null,
      },
    });
    expect(estado.leiturasDePerfil).toEqual([]);
  });

  it("já aplicado: quando e o nome de quem aprovou (o id nunca vai para a tela)", async () => {
    estado.rpc = {
      data: {
        dados: linhaDoBanco({
          aplicado_em: "2026-10-22T12:00:00+00:00",
          aplicado_por: QUEM_APROVOU,
        }),
      },
      error: null,
    };
    estado.perfis = [{ user_id: QUEM_APROVOU, name: "Vinicius" }];
    const lido = await lerDadosInformadosAction(CONSULTA);
    expect(lido).toMatchObject({
      ok: true,
      dados: {
        aplicadoEm: "2026-10-22T12:00:00+00:00",
        aplicadoPor: { nome: "Vinicius" },
      },
    });
    expect(JSON.stringify(lido)).not.toContain(QUEM_APROVOU);
    expect(estado.leiturasDePerfil).toEqual([
      { colunas: "user_id, name", ids: [QUEM_APROVOU] },
    ]);
  });

  it("o nome que não se lê (a pessoa saiu, ou a leitura falhou) fica nulo, e os dados continuam", async () => {
    estado.rpc = {
      data: {
        dados: linhaDoBanco({
          aplicado_em: "2026-10-22T12:00:00+00:00",
          aplicado_por: QUEM_APROVOU,
        }),
      },
      error: null,
    };
    estado.perfis = [];
    expect(await lerDadosInformadosAction(CONSULTA)).toMatchObject({
      ok: true,
      dados: { aplicadoPor: { nome: null }, cpf: "12345678909" },
    });
    estado.erroDoPerfil = { message: "falhou" };
    expect(await lerDadosInformadosAction(CONSULTA)).toMatchObject({
      ok: true,
      dados: { aplicadoPor: { nome: null } },
    });
  });
});

describe("os erros do banco, em texto de recepcionista", () => {
  it("42501 (o profissional na agenda de outro): a dica de permissão", async () => {
    sessao.active.role = "profissional";
    estado.rpc = { data: null, error: { code: "42501" } };
    expect(await lerDadosInformadosAction(CONSULTA)).toEqual({
      ok: false,
      error: "Seu perfil não vê os dados que o paciente informou.",
    });
  });

  it("P0002 (a consulta não é da clínica, ou sumiu): pede para atualizar", async () => {
    estado.rpc = { data: null, error: { code: "P0002" } };
    expect(await lerDadosInformadosAction(CONSULTA)).toEqual({
      ok: false,
      error: "Esta consulta não está mais na agenda. Atualize a página.",
    });
  });

  it("o resto (função que não existe, rede que cai): tente de novo", async () => {
    for (const rpc of [
      { data: null, error: { code: "PGRST202" } },
      { data: null, error: {} },
      "lanca" as const,
    ]) {
      estado.rpc = rpc;
      expect(
        await lerDadosInformadosAction(CONSULTA),
        JSON.stringify(rpc),
      ).toEqual({
        ok: false,
        error: "Não foi possível carregar os dados. Tente de novo.",
      });
    }
  });

  it("retorno fora da forma é erro, nunca dado pela metade", async () => {
    const semOCpf: Record<string, unknown> = { ...linhaDoBanco() };
    delete semOCpf.cpf;
    for (const data of [
      null,
      "texto",
      {},
      { dados: semOCpf },
      { dados: linhaDoBanco({ cpf: "123.456.789-09" }) },
      { dados: linhaDoBanco({ data_nascimento: "09/05/1990" }) },
      { dados: linhaDoBanco({ para_o_titular: "sim" }) },
      { dados: linhaDoBanco({ aplicado_por: "alguem" }) },
      { dados: linhaDoBanco({ informado_em: null }) },
    ]) {
      estado.rpc = { data, error: null };
      expect(
        await lerDadosInformadosAction(CONSULTA),
        JSON.stringify(data),
      ).toEqual({
        ok: false,
        error: "Não foi possível carregar os dados. Tente de novo.",
      });
    }
  });

  it("chave que o banco acrescentar depois é descartada, nunca chega à tela", async () => {
    estado.rpc = {
      data: { dados: linhaDoBanco({ coluna_nova: "x" }), extra: true },
      error: null,
    };
    const lido = await lerDadosInformadosAction(CONSULTA);
    expect(lido.ok).toBe(true);
    expect(JSON.stringify(lido)).not.toContain("coluna_nova");
    expect(JSON.stringify(lido)).not.toContain("extra");
  });

  it("o log leva só ids e o código, nunca o que o paciente informou", async () => {
    estado.rpc = { data: { dados: linhaDoBanco({ cpf: "123" }) }, error: null };
    await lerDadosInformadosAction(CONSULTA);
    estado.rpc = { data: null, error: { code: "42501" } };
    await lerDadosInformadosAction(CONSULTA);
    const escrito = logs.join("");
    expect(escrito).toContain('"evento":"agenda_dados_informados_nao_lidos"');
    expect(escrito).toContain('"error_code":"forma"');
    expect(escrito).toContain('"error_code":"42501"');
    expect(escrito).toContain(`"clinic_id":"${CLINICA}"`);
    for (const proibido of [
      "Paciente de Teste",
      "12345678909",
      "1990-05-09",
      "0001 2345 6789",
      CONSULTA,
    ]) {
      expect(escrito).not.toContain(proibido);
    }
  });
});

describe("a leitura direta (lib/queries)", () => {
  it("nunca lança: erro do banco e forma errada voltam como código", async () => {
    estado.rpc = "lanca";
    expect(
      await lerDadosInformadosNaMarcacao(cliente as never, CLINICA, CONSULTA),
    ).toEqual({ ok: false, codigo: null });
    estado.rpc = { data: null, error: { code: "P0002" } };
    expect(
      await lerDadosInformadosNaMarcacao(cliente as never, CLINICA, CONSULTA),
    ).toEqual({ ok: false, codigo: "P0002" });
    estado.rpc = { data: { dados: { nome_completo: "x" } }, error: null };
    expect(
      await lerDadosInformadosNaMarcacao(cliente as never, CLINICA, CONSULTA),
    ).toEqual({ ok: false, codigo: "forma" });
  });

  it("os campos que o paciente não informou chegam nulos", async () => {
    estado.rpc = {
      data: {
        dados: linhaDoBanco({
          nome_completo: null,
          data_nascimento: null,
          cpf: null,
          carteirinha: null,
          para_o_titular: false,
        }),
      },
      error: null,
    };
    expect(
      await lerDadosInformadosNaMarcacao(cliente as never, CLINICA, CONSULTA),
    ).toMatchObject({
      ok: true,
      dados: {
        nomeCompleto: null,
        dataNascimento: null,
        cpf: null,
        carteirinha: null,
        paraOTitular: false,
        aplicadoPorId: null,
      },
    });
  });
});
