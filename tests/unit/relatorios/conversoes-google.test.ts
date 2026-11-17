import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CABECALHO_DO_GOOGLE,
  gerarCsvDoGoogle,
  horarioParaOGoogle,
  lerConversoesParaOGoogle,
  linhasDoArquivoDoGoogle,
  nomeDaConversaoNoGoogle,
  nomeDoArquivoDoGoogle,
  resumoDaExportacaoParaOGoogle,
  type ConversaoParaOGoogle,
} from "@/lib/domain/conversoes-google";

// Arquivo de conversoes para o Google Ads (etapa 6A do plano de 16/11/2026).
// O formato e o das paginas oficiais do Google (importacao de conversoes por
// clique): cabecalho em ingles, hora com o fuso em cada linha, valor com
// ponto, separado por virgula e sem BOM. E a action: so administrador e
// gestor, trilha antes de o arquivo sair, nada sai sem conversao.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";

const CONVERSAO: ConversaoParaOGoogle = {
  gclid: "Cj0KCQjw-teste_1",
  etapa: "compareceu",
  convertido_em: "2026-11-16T17:30:05.000Z",
  valor_cents: 25000,
  moeda: "BRL",
  evento_id: "11111111-2222-4333-8444-555555555555",
};

describe("o horário no formato do Google", () => {
  it("vai no fuso da clínica, com o deslocamento de 4 dígitos", () => {
    expect(horarioParaOGoogle("2026-11-16T17:30:05.000Z", "America/Fortaleza")).toBe(
      "2026-11-16 14:30:05-0300",
    );
    // Vira o dia no fuso da clinica.
    expect(horarioParaOGoogle("2026-11-17T01:00:00.000Z", "America/Fortaleza")).toBe(
      "2026-11-16 22:00:00-0300",
    );
    expect(horarioParaOGoogle("2026-11-16T17:30:05.000Z", "America/Manaus")).toBe(
      "2026-11-16 13:30:05-0400",
    );
    // Meia hora e a leste de Greenwich.
    expect(horarioParaOGoogle("2026-11-16T17:30:05.000Z", "Asia/Kolkata")).toBe(
      "2026-11-16 23:00:05+0530",
    );
    expect(horarioParaOGoogle("2026-11-16T17:30:05.000Z", "UTC")).toBe(
      "2026-11-16 17:30:05+0000",
    );
    // Horario de verao de outro pais muda o deslocamento com a data.
    expect(horarioParaOGoogle("2026-07-01T12:00:00.000Z", "Europe/Lisbon")).toBe(
      "2026-07-01 13:00:00+0100",
    );
    expect(horarioParaOGoogle("2026-01-01T12:00:00.000Z", "Europe/Lisbon")).toBe(
      "2026-01-01 12:00:00+0000",
    );
    expect(horarioParaOGoogle("nao e data", "America/Fortaleza")).toBeNull();
  });
});

describe("as linhas e o arquivo", () => {
  it("cabeçalho do modelo do Google e uma linha por conversão, com o valor com ponto e o id da conversão", () => {
    expect([...CABECALHO_DO_GOOGLE]).toEqual([
      "Google Click ID",
      "Conversion Name",
      "Conversion Time",
      "Conversion Value",
      "Conversion Currency",
      "Order ID",
    ]);
    expect(linhasDoArquivoDoGoogle([CONVERSAO], "America/Fortaleza")).toEqual([
      [...CABECALHO_DO_GOOGLE],
      [
        "Cj0KCQjw-teste_1",
        "compareceu",
        "2026-11-16 14:30:05-0300",
        "250.00",
        "BRL",
        "11111111-2222-4333-8444-555555555555",
      ],
    ]);
  });

  it("sem valor, o valor e a moeda ficam vazios (o Google usa o padrão da ação); valor zero é valor", () => {
    const linhas = linhasDoArquivoDoGoogle(
      [
        { ...CONVERSAO, valor_cents: null, moeda: "BRL" },
        { ...CONVERSAO, valor_cents: 0 },
        { ...CONVERSAO, valor_cents: 1990, moeda: null },
      ],
      "America/Fortaleza",
    );
    expect(linhas.slice(1).map((linha) => [linha[3], linha[4]])).toEqual([
      ["", ""],
      ["0.00", "BRL"],
      ["19.90", "BRL"],
    ]);
  });

  it("o nome da conversão é a chave da etapa, só com letra, número e sublinhado; hora ilegível fica de fora", () => {
    expect(nomeDaConversaoNoGoogle("follow_8_mensagem")).toBe("follow_8_mensagem");
    expect(nomeDaConversaoNoGoogle("=cmd|' /C calc'!A0")).toBe("_cmd____C_calc__A0");
    expect(
      linhasDoArquivoDoGoogle(
        [{ ...CONVERSAO, convertido_em: "lixo" }, CONVERSAO],
        "America/Fortaleza",
      ),
    ).toHaveLength(2);
  });

  it("CSV de máquina: vírgula, CRLF, aspas só quando preciso e sem BOM", () => {
    const csv = gerarCsvDoGoogle([
      ["a", "b,c", 'd"e'],
      ["1", "", "linha\nquebrada"],
    ]);
    expect(csv).toBe('a,"b,c","d""e"\r\n1,,"linha\nquebrada"');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    // O arquivo de verdade: cabecalho na primeira linha, sem ponto e virgula.
    const arquivo = gerarCsvDoGoogle(
      linhasDoArquivoDoGoogle([CONVERSAO], "America/Fortaleza"),
    );
    expect(arquivo.split("\r\n")).toEqual([
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID",
      "Cj0KCQjw-teste_1,compareceu,2026-11-16 14:30:05-0300,250.00,BRL,11111111-2222-4333-8444-555555555555",
    ]);
    expect(arquivo).not.toContain(";");
  });

  it("nome do arquivo e o resumo do que foi e do que ficou de fora", () => {
    expect(nomeDoArquivoDoGoogle("2026-11-01", "2026-11-16")).toBe(
      "conversoes-google-2026-11-01-a-2026-11-16.csv",
    );
    expect(resumoDaExportacaoParaOGoogle(1, 0)).toBe("1 conversão exportada.");
    expect(resumoDaExportacaoParaOGoogle(12, 0)).toBe(
      "12 conversões exportadas.",
    );
    expect(resumoDaExportacaoParaOGoogle(12, 1)).toBe(
      "12 conversões exportadas. 1 ficou de fora: clique de iPhone, sem o identificador que o arquivo do Google aceita.",
    );
    expect(resumoDaExportacaoParaOGoogle(12, 3)).toBe(
      "12 conversões exportadas. 3 ficaram de fora: cliques de iPhone, sem o identificador que o arquivo do Google aceita.",
    );
  });

  it("retorno do banco fora do contrato vira null (nunca arquivo pela metade)", () => {
    expect(
      lerConversoesParaOGoogle({ linhas: [CONVERSAO], sem_gclid: 2 }),
    ).toEqual({ linhas: [CONVERSAO], semGclid: 2 });
    for (const ruim of [
      null,
      { linhas: [], sem_gclid: -1 },
      { linhas: [{ ...CONVERSAO, gclid: "tem espaco" }], sem_gclid: 0 },
      { linhas: [{ ...CONVERSAO, gclid: null }], sem_gclid: 0 },
      { linhas: "x", sem_gclid: 0 },
    ]) {
      expect(lerConversoesParaOGoogle(ruim)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// A action
// ---------------------------------------------------------------------------

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  comSessao: true,
  rpc: [] as { nome: string; args: Record<string, unknown> }[],
  respostaDoBanco: { data: null as unknown, error: null as unknown },
  trilha: [] as Record<string, unknown>[],
  erroDaTrilha: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpc.push({ nome, args });
      return registro.respostaDoBanco;
    },
    from: () => ({
      insert: async (linha: Record<string, unknown>) => {
        registro.trilha.push(linha);
        return { error: registro.erroDaTrilha };
      },
    }),
  }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          active: {
            clinicId: CLINICA,
            role: registro.papel,
            status: "ativo",
            timezone: "America/Fortaleza",
          },
        }
      : null,
}));

const { exportarConversoesParaOGoogleAction } = await import(
  "@/app/(app)/relatorios/actions"
);

const PERIODO = { diaDe: "2026-11-01", diaAte: "2026-11-16" };

beforeEach(() => {
  registro.papel = "admin";
  registro.comSessao = true;
  registro.rpc = [];
  registro.respostaDoBanco = {
    data: { linhas: [CONVERSAO], sem_gclid: 2 },
    error: null,
  };
  registro.trilha = [];
  registro.erroDaTrilha = null;
});

describe("exportarConversoesParaOGoogleAction", () => {
  it("só administrador e gestor: os outros papéis e quem está sem sessão nem chegam ao banco", async () => {
    registro.comSessao = false;
    expect((await exportarConversoesParaOGoogleAction(PERIODO)).ok).toBe(false);
    registro.comSessao = true;
    for (const papel of ["recepcao", "leitura", "profissional"]) {
      registro.papel = papel;
      expect(await exportarConversoesParaOGoogleAction(PERIODO)).toEqual({
        ok: false,
        error: "Só administrador e gestor exportam as conversões para o Google.",
      });
    }
    expect(registro.rpc).toEqual([]);
    expect(registro.trilha).toEqual([]);
  });

  it("período inválido: recusa sem tocar no banco", async () => {
    for (const entrada of [
      null,
      { diaDe: "2026-11-16", diaAte: "2026-11-01" },
      { diaDe: "16/11/2026", diaAte: "2026-11-16" },
      { diaDe: "2026-11-01" },
    ]) {
      expect((await exportarConversoesParaOGoogleAction(entrada)).ok).toBe(false);
    }
    expect(registro.rpc).toEqual([]);
  });

  it("gestor: pede o período em dias da clínica, grava a trilha e devolve o arquivo no formato do Google", async () => {
    registro.papel = "gestor";
    const resultado = await exportarConversoesParaOGoogleAction(PERIODO);
    expect(resultado).toEqual({
      ok: true,
      arquivo: {
        nome: "conversoes-google-2026-11-01-a-2026-11-16.csv",
        csv: "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID\r\nCj0KCQjw-teste_1,compareceu,2026-11-16 14:30:05-0300,250.00,BRL,11111111-2222-4333-8444-555555555555",
      },
      exportadas: 1,
      semGclid: 2,
    });
    // Do primeiro instante do dia 01 ao fim do dia 16, no fuso da clinica.
    expect(registro.rpc).toEqual([
      {
        nome: "conversoes_para_o_google",
        args: {
          p_clinic_id: CLINICA,
          p_de: "2026-11-01T03:00:00.000Z",
          p_ate: "2026-11-17T03:00:00.000Z",
        },
      },
    ]);
    // A trilha: quem, o que e de qual clinica; nunca o identificador do clique.
    expect(registro.trilha).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "exportou",
        entity: "conversoes_google",
        entity_id: null,
      },
    ]);
  });

  it("sem conversão no período: nada sai e nada vai para a trilha, mas a tela sabe quantas ficaram de fora", async () => {
    registro.respostaDoBanco = { data: { linhas: [], sem_gclid: 3 }, error: null };
    expect(await exportarConversoesParaOGoogleAction(PERIODO)).toEqual({
      ok: true,
      arquivo: null,
      exportadas: 0,
      semGclid: 3,
    });
    expect(registro.trilha).toEqual([]);
  });

  it("banco recusou, respondeu fora do contrato, ou a trilha não gravou: nenhum arquivo", async () => {
    registro.respostaDoBanco = { data: null, error: { code: "42501" } };
    expect((await exportarConversoesParaOGoogleAction(PERIODO)).ok).toBe(false);

    registro.respostaDoBanco = { data: { linhas: "x" }, error: null };
    expect((await exportarConversoesParaOGoogleAction(PERIODO)).ok).toBe(false);

    registro.respostaDoBanco = {
      data: { linhas: [CONVERSAO], sem_gclid: 0 },
      error: null,
    };
    registro.erroDaTrilha = { code: "57014" };
    expect(await exportarConversoesParaOGoogleAction(PERIODO)).toEqual({
      ok: false,
      error: "Não foi possível montar o arquivo. Tente de novo.",
    });
  });
});
