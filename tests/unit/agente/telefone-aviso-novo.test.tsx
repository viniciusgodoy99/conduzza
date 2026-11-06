import type { SupabaseClient } from "@supabase/supabase-js";
import { Hourglass } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AG6b nos telefones da equipe (desenho da AG6b, secao 6; D-60 e D-95 pela
// recomendacao, pendentes do dono): o aviso da OpenAI cobre texto, audio,
// foto e documento (a versao 2); a tela grava no telefone a versao que
// mostrou, ao adicionar e ao ligar de novo (o "Ligar de novo" passa a pedir
// o aviso num dialogo, e a acao recusa sem ele); o telefone ligado com o
// aviso antigo, com alguma habilidade de midia ligada, ganha o chip "Sem
// áudio, foto e documento" (Hourglass warning, 3 camadas) e o que fazer,
// escrito. Tudo com dubles: nenhuma rede, nenhum banco.

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  superAdmin: false,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  erroDoRpc: null as null | { code?: string; message?: string },
  consultas: [] as { tabela: string; filtros: [string, unknown][] }[],
  linhaDoTelefone: { id: "t-lista" } as null | { id: string },
  logs: [] as [string, unknown][],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const consulta = { tabela, filtros: [] as [string, unknown][] };
      registro.consultas.push(consulta);
      const cadeia = {
        select: () => cadeia,
        eq: (coluna: string, valor: unknown) => {
          consulta.filtros.push([coluna, valor]);
          return cadeia;
        },
        maybeSingle: async () =>
          tabela === "ia_contato_liberado"
            ? { data: registro.linhaDoTelefone, error: null }
            : { data: null, error: null },
      };
      return cadeia;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return registro.erroDoRpc
        ? { data: null, error: registro.erroDoRpc }
        : { data: true, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a aba do agente nunca usa o cliente de servico");
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: "97777777-7777-4777-8777-777777777777",
    isProductAdmin: registro.superAdmin,
    active: {
      clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
      role: registro.papel,
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  }),
}));
vi.mock("@/lib/queries/ia-liberacao", async (original) => {
  const real = await original<typeof import("@/lib/queries/ia-liberacao")>();
  return {
    ...real,
    abaDaIaVisivel: () => Promise.resolve(true),
    fetchLiberacaoDaIa: async () => ({
      liberacao: {
        liberada: true,
        modo: "contatos",
        pausadaPelaClinica: false,
        tetoDiarioCentavosUsd: 500,
      },
      numerosLigados: [],
      telefones: [],
      interruptorLigado: true,
      situacao: {},
    }),
  };
});
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: vi.fn(),
}));
vi.mock("@/lib/log", () => ({
  log: {
    info: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    warn: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    error: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
  },
}));
// O Dialog do Radix renderiza num portal, que nao existe no servidor: aqui
// vira marcacao simples (o molde de tests/unit/agendada/tela-dialogos).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => (
    <div data-parte="conteudo">{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-parte="descricao">{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div data-parte="rodape">{children}</div>
  ),
}));

import {
  adicionarTelefoneDaIaAction,
  alternarTelefoneDaIaAction,
} from "@/app/(app)/agente/whatsapp-actions";
import {
  // [AG6b mídia] revisao das telas (item 5)
  podeConfirmarOAvisoNovo,
  TELEFONE_DA_EQUIPE_STATUS,
  TELEFONE_SEM_MIDIA_STATUS,
  telefoneSemMidia,
  TEXTOS_DA_IA,
  TEXTOS_DO_TESTE_COM_PACIENTE,
  textoDoTelefoneSemMidia,
  VERSAO_DO_AVISO_DA_OPENAI,
  versaoDoAvisoDoTelefone,
} from "@/components/agente/whatsapp/agente-de-ia";
import {
  AbaWhatsapp,
  DialogoDoReligar,
} from "@/components/agente/whatsapp/agente-de-ia-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import { expedientePadrao } from "@/lib/domain/agente/config";
import {
  // [AG6b mídia] revisao das telas (itens 2 e 5)
  COLUNAS_DOS_TELEFONES,
  COLUNAS_DOS_TELEFONES_SEM_O_AVISO,
  EVENTO_DOS_TELEFONES_SEM_O_AVISO,
  versaoDoAvisoDaLinha,
  type DadosDaIa,
  type TelefoneDaIa,
} from "@/lib/queries/ia-liberacao";

// A leitura de verdade (o mock acima troca fetchLiberacaoDaIa para as
// actions); o log continua o duble deste arquivo.
const { fetchLiberacaoDaIa: lerLiberacaoDeVerdade } = await vi.importActual<
  typeof import("@/lib/queries/ia-liberacao")
>("@/lib/queries/ia-liberacao");

const NUMERO = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  registro.papel = "admin";
  registro.superAdmin = false;
  registro.rpcs = [];
  registro.erroDoRpc = null;
  registro.consultas = [];
  registro.linhaDoTelefone = { id: "t-lista" };
  registro.logs = [];
});

function telefone(campos: Partial<TelefoneDaIa> = {}): TelefoneDaIa {
  return {
    id: "t1",
    telefone: "+5584999990001",
    rotulo: "Vinicius, equipe",
    ativo: true,
    avisoDaOpenaiVersao: 1,
    ...campos,
  };
}

function dados(campos: Partial<DadosDaIa> = {}): DadosDaIa {
  return {
    liberacao: {
      liberada: true,
      modo: "contatos",
      pausadaPelaClinica: false,
      tetoDiarioCentavosUsd: 500,
    },
    numerosLigados: [NUMERO],
    telefones: [
      telefone(),
      telefone({
        id: "t2",
        telefone: "+5584999990002",
        rotulo: "Ana",
        ativo: false,
      }),
    ],
    interruptorLigado: true,
    situacao: {
      tetoAtingido: false,
      versaoPublicada: 1,
      telefonesInvalidos: [],
      telefonesSemAutorizacao: [],
      conversasAbertas: [],
      horarioPublicado: {
        modo: "24h",
        minutosSemResposta: 10,
        expediente: expedientePadrao(),
      },
      motorParado: false,
    },
    ...campos,
  };
}

function numero(): NumeroDoWhatsapp {
  return {
    id: NUMERO,
    nome: "Número principal",
    principal: true,
    unitId: null,
    displayPhone: "5584999990000",
    status: "conectado",
    connectedAt: null,
    provider: "uazapi",
    cor: "azul",
  };
}

function aba(
  props: Partial<React.ComponentProps<typeof AbaWhatsapp>> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AbaWhatsapp
        dados={dados()}
        numeros={[numero()]}
        ambienteLigado
        podeEditar
        superAdmin={false}
        agoraMs={Date.parse("2026-10-30T15:00:00.000Z")}
        fuso="America/Fortaleza"
        telefonesForcados={[]}
        midiaLigada
        {...props}
      />
    </TooltipProvider>,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** A linha (li) de um telefone, pelo rotulo. */
function linhaDoTelefone(html: string, rotulo: string): string {
  const indice = html.indexOf(`>${rotulo}<`);
  expect(indice, `linha do telefone ${rotulo}`).toBeGreaterThan(-1);
  const inicio = html.lastIndexOf("<li", indice);
  return html.slice(inicio, html.indexOf("</li>", indice) + 5);
}

// ---------------------------------------------------------------------------
// Os textos
// ---------------------------------------------------------------------------

describe("os avisos novos (D-60)", () => {
  it("o aviso do formulário cobre texto, áudio, foto e documento: a versão 2", () => {
    expect(TEXTOS_DA_IA.confirmarAvisoDaOpenai).toBe(
      "Quem usa este celular sabe que o que escrever ou mandar (texto, áudio, foto e documento) vai para a OpenAI, nos EUA, e vai usar só dados de teste.",
    );
    expect(VERSAO_DO_AVISO_DA_OPENAI).toBe(2);
  });

  it("o do teste com paciente também (PROPOSTA, espera o dono)", () => {
    expect(TEXTOS_DO_TESTE_COM_PACIENTE.confirmacao).toBe(
      "A pessoa deste telefone sabe que vai conversar com um assistente virtual de teste e que o que escrever ou mandar (texto, áudio, foto e documento) vai para a OpenAI, nos EUA.",
    );
  });

  it("o Ligar de novo e o chip: os textos, sem travessão e sem jargão", () => {
    expect(TEXTOS_DA_IA.religarTitulo).toBe("Ligar este telefone de novo?");
    expect(TEXTOS_DA_IA.religarTexto).toBe(
      "Antes de ligar, confirme o aviso sobre a OpenAI. Ele vale para tudo o que a pessoa escrever ou mandar ao assistente.",
    );
    expect(TEXTOS_DA_IA.avisoDaOpenaiObrigatorioAoLigar).toBe(
      "Confirme o aviso sobre a OpenAI antes de ligar o telefone de novo.",
    );
    expect(TEXTOS_DA_IA.semMidiaNaLinha).toBe(
      "Desligue e ligue de novo para confirmar o aviso novo.",
    );
    expect(TEXTOS_DA_IA.semMidiaNaLinhaForcado).toBe(
      "Para confirmar o aviso novo, adicione este telefone de novo pelo formulário acima.",
    );
    expect(TELEFONE_SEM_MIDIA_STATUS.label).toBe("Sem áudio, foto e documento");
    for (const frase of [
      TEXTOS_DA_IA.confirmarAvisoDaOpenai,
      TEXTOS_DA_IA.religarTitulo,
      TEXTOS_DA_IA.religarTexto,
      TEXTOS_DA_IA.religar,
      TEXTOS_DA_IA.religando,
      TEXTOS_DA_IA.avisoDaOpenaiObrigatorioAoLigar,
      TEXTOS_DA_IA.semMidiaNaLinha,
      TEXTOS_DA_IA.semMidiaNaLinhaForcado,
      TEXTOS_DO_TESTE_COM_PACIENTE.confirmacao,
      TELEFONE_SEM_MIDIA_STATUS.label,
    ]) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).not.toMatch(/\b(opt-in|handoff|tenant|whisper|upload)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// A action grava a versao
// ---------------------------------------------------------------------------

describe("a action manda a versão do aviso", () => {
  it("adicionar: a confirmação e a versão 2", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.at(-1)).toMatchObject({
      nome: "definir_contato_liberado_da_ia",
      args: {
        p_ativo: true,
        p_confirmou_aviso_da_openai: true,
        p_versao_do_aviso: 2,
      },
    });
  });

  it("o Usar mesmo assim (telefone de paciente que aceitou testar) também grava a versão 2", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Maria, aceitou testar",
        telefone: "84999990002",
        confirmarContato: true,
        confirmarAvisoDaOpenai: true,
        forcarContatoDePaciente: true,
        confirmouTesteComPaciente: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.at(-1)?.args).toMatchObject({
      p_forcar_contato_existente: true,
      p_confirmou_teste_com_paciente: true,
      p_confirmou_aviso_da_openai: true,
      p_versao_do_aviso: 2,
    });
  });

  it("ligar de novo com o aviso do diálogo: a confirmação e a versão 2 no telefone", async () => {
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
          p_telefone_e164: "+5584999990001",
          p_rotulo: "",
          p_ativo: true,
          p_confirmou_aviso_da_openai: true,
          p_versao_do_aviso: 2,
        },
      },
    ]);
  });

  it("ligar de novo sem o aviso: recusado antes de qualquer leitura, com o texto", async () => {
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.avisoDaOpenaiObrigatorioAoLigar,
    });
    // So o true passa: o falso e entrada que a tela nunca manda.
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
        confirmarAvisoDaOpenai: false,
      }),
    ).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
    expect(registro.consultas).toEqual([]);
  });

  it("desligar: nunca recusado, sem a confirmação nem a versão (o banco volta a versão para 1)", async () => {
    for (const confirmarAvisoDaOpenai of [undefined, true] as const) {
      registro.rpcs = [];
      expect(
        await alternarTelefoneDaIaAction({
          telefone: "+5584999990001",
          ligado: false,
          ...(confirmarAvisoDaOpenai ? { confirmarAvisoDaOpenai } : {}),
        }),
      ).toEqual({ ok: true });
      const args = registro.rpcs.at(-1)?.args ?? {};
      expect(args.p_ativo).toBe(false);
      expect(args).not.toHaveProperty("p_versao_do_aviso");
      expect(args).not.toHaveProperty("p_confirmou_aviso_da_openai");
    }
  });

  it("a versão fora de 1 e 2 (22023 do banco) é erro do código, nunca 'telefone inválido'", async () => {
    registro.erroDoRpc = { code: "22023", message: "versao_do_aviso_invalida" };
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      ok: false,
      error: "Não foi possível alterar o assistente de IA. Tente de novo.",
    });
    // E o 22023 do telefone continua com o texto do telefone.
    registro.erroDoRpc = {
      code: "22023",
      message:
        "Telefone inválido: use o formato internacional, por exemplo +5585999990000.",
    };
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.telefoneInvalido });
  });

  it("antes da migration (PGRST202): nada muda, com o texto de sempre; nunca o telefone no log", async () => {
    registro.erroDoRpc = { code: "PGRST202", message: "function not found" };
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      ok: false,
      error:
        "Esta opção ainda não está disponível. Nada foi alterado; tente de novo mais tarde.",
    });
    const tudo = JSON.stringify(registro.logs);
    expect(tudo).not.toContain("99999");
    expect(tudo).not.toContain("Vinicius");
  });
});

// ---------------------------------------------------------------------------
// O chip "Sem áudio, foto e documento"
// ---------------------------------------------------------------------------

describe("o chip do telefone com o aviso antigo", () => {
  it("3 camadas: Hourglass, o rótulo e o tom de aviso, o mesmo par do Não aciona o assistente", () => {
    expect(TELEFONE_SEM_MIDIA_STATUS).toEqual({
      label: "Sem áudio, foto e documento",
      tone: "warning",
      icon: Hourglass,
    });
    expect(TELEFONE_SEM_MIDIA_STATUS.icon).toBe(
      TELEFONE_DA_EQUIPE_STATUS.invalido.icon,
    );
    expect(TELEFONE_SEM_MIDIA_STATUS.tone).toBe(
      TELEFONE_DA_EQUIPE_STATUS.invalido.tone,
    );
  });

  it("só no telefone ligado, com o aviso antigo e alguma habilidade de mídia ligada", () => {
    const d = dados();
    expect(telefoneSemMidia(d, telefone(), true)).toBe(true);
    // A versao ausente (leitura de antes) vale 1: o lado seguro.
    expect(
      telefoneSemMidia(d, telefone({ avisoDaOpenaiVersao: undefined }), true),
    ).toBe(true);
    expect(
      telefoneSemMidia(d, telefone({ avisoDaOpenaiVersao: 2 }), true),
    ).toBe(false);
    expect(telefoneSemMidia(d, telefone(), false)).toBe(false);
    // Desligado, ou o que nao aciona o assistente (o chip dele e outro).
    expect(
      telefoneSemMidia(d, telefone({ id: "t2", ativo: false }), true),
    ).toBe(false);
    expect(
      telefoneSemMidia(
        dados({
          situacao: { ...d.situacao, telefonesInvalidos: ["t1"] },
        }),
        telefone(),
        true,
      ),
    ).toBe(false);
  });

  it("a versão: ausente vale 1; da linha do banco, só o 2 vale como o aviso novo", () => {
    expect(versaoDoAvisoDoTelefone({})).toBe(1);
    expect(versaoDoAvisoDoTelefone({ avisoDaOpenaiVersao: 2 })).toBe(2);
    expect(versaoDoAvisoDaLinha(2)).toBe(2);
    for (const valor of [1, null, undefined, "2", 3, 0]) {
      expect(versaoDoAvisoDaLinha(valor)).toBe(1);
    }
  });

  it("a lista de telefones lê a versão do aviso", async () => {
    expect(COLUNAS_DOS_TELEFONES).toBe(
      "id, phone_key, rotulo, ativo, aviso_da_openai_versao, entre_numeros",
    );
    const banco = sessaoDaAba();
    const lidos = await lerLiberacaoDeVerdade(banco.cliente, CLINICA_LIDA);
    expect(banco.colunasDosTelefones()).toEqual([COLUNAS_DOS_TELEFONES]);
    expect(lidos.telefones.map((t) => t.avisoDaOpenaiVersao)).toEqual([2, 1]);
  });

  it("na linha: o chip junto do Ligado e o que fazer, escrito", () => {
    const html = aba();
    const linha = linhaDoTelefone(html, "Vinicius, equipe");
    expect(linha).toContain("Sem áudio, foto e documento");
    expect(linha).toContain("lucide-hourglass");
    expect(linha).toContain("var(--warning-text)");
    expect(texto(linha)).toContain(TEXTOS_DA_IA.semMidiaNaLinha);
    // O Ligado continua (o texto vai): o chip e outro fato.
    expect(texto(linha)).toMatch(/Conversa com o assistente|Ligado/);
    // O telefone desligado nao leva chip (ao ligar de novo, confirma o aviso).
    expect(linhaDoTelefone(html, "Ana")).not.toContain(
      "Sem áudio, foto e documento",
    );
  });

  it("o telefone usado mesmo sendo de paciente: o caminho é o formulário", () => {
    const linha = linhaDoTelefone(
      aba({ telefonesForcados: ["t1"] }),
      "Vinicius, equipe",
    );
    expect(texto(linha)).toContain(TEXTOS_DA_IA.semMidiaNaLinhaForcado);
    expect(texto(linha)).not.toContain(TEXTOS_DA_IA.semMidiaNaLinha);
    expect(textoDoTelefoneSemMidia(true)).toBe(
      TEXTOS_DA_IA.semMidiaNaLinhaForcado,
    );
    expect(textoDoTelefoneSemMidia(false)).toBe(TEXTOS_DA_IA.semMidiaNaLinha);
  });

  it("sem chip: com o aviso novo, sem mídia ligada, ou sem a prop (o Painel geral)", () => {
    const comAvisoNovo = aba({
      dados: dados({ telefones: [telefone({ avisoDaOpenaiVersao: 2 })] }),
    });
    expect(comAvisoNovo).not.toContain("Sem áudio, foto e documento");
    expect(aba({ midiaLigada: false })).not.toContain(
      "Sem áudio, foto e documento",
    );
    expect(aba({ midiaLigada: undefined })).not.toContain(
      "Sem áudio, foto e documento",
    );
  });

  it("o gestor vê o chip e a quem pedir, com os botões presos e a dica (revisão das telas, item 5)", () => {
    const html = aba({ podeEditar: false });
    const linha = linhaDoTelefone(html, "Vinicius, equipe");
    expect(linha).toContain("Sem áudio, foto e documento");
    expect(linha).toMatch(/<button[^>]*disabled=""[^>]*>Desligar<\/button>/);
    // Nunca a instrucao de um botao preso para ele: a quem pedir.
    expect(texto(linha)).toContain(TEXTOS_DA_IA.semMidiaNaLinhaSemPermissao);
    expect(texto(linha)).not.toContain(TEXTOS_DA_IA.semMidiaNaLinha);
    // O usado mesmo sendo de paciente: pedir para adicionar de novo.
    const forcado = linhaDoTelefone(
      aba({ podeEditar: false, telefonesForcados: ["t1"] }),
      "Vinicius, equipe",
    );
    expect(texto(forcado)).toContain(
      TEXTOS_DA_IA.semMidiaNaLinhaForcadoSemPermissao,
    );
    expect(texto(forcado)).not.toContain(TEXTOS_DA_IA.semMidiaNaLinhaForcado);
  });

  it("o administrador e o super admin leem o que fazer, nunca a quem pedir", () => {
    for (const props of [{}, { superAdmin: true }]) {
      const linha = linhaDoTelefone(aba(props), "Vinicius, equipe");
      expect(texto(linha)).toContain(TEXTOS_DA_IA.semMidiaNaLinha);
      expect(texto(linha)).not.toContain("peça ao administrador");
    }
  });

  it("quem pode confirmar o aviso novo: pela permissão de desligar e ligar (o forçado, de adicionar e usar mesmo assim); no Painel geral, sempre", () => {
    const livres = { escolha: null, telefone: null, forcar: null };
    const doGestor = {
      escolha: TEXTOS_DA_IA.semPermissao,
      telefone: TEXTOS_DA_IA.semPermissao,
      forcar: TEXTOS_DA_IA.semPermissao,
    };
    for (const forcado of [false, true]) {
      expect(
        podeConfirmarOAvisoNovo({ dicas: livres, forcado, noPainel: false }),
      ).toBe(true);
      expect(
        podeConfirmarOAvisoNovo({ dicas: doGestor, forcado, noPainel: false }),
      ).toBe(false);
      // A equipe Conduzza no painel: com os cartoes travados (conta
      // suspensa, agente desligado), o porque esta no topo.
      expect(
        podeConfirmarOAvisoNovo({ dicas: doGestor, forcado, noPainel: true }),
      ).toBe(true);
    }
    // Cada caminho pela dica dele.
    expect(
      podeConfirmarOAvisoNovo({
        dicas: { ...livres, escolha: "x" },
        forcado: false,
        noPainel: false,
      }),
    ).toBe(false);
    expect(
      podeConfirmarOAvisoNovo({
        dicas: { ...livres, escolha: "x" },
        forcado: true,
        noPainel: false,
      }),
    ).toBe(true);
    expect(
      podeConfirmarOAvisoNovo({
        dicas: { ...livres, forcar: "x" },
        forcado: true,
        noPainel: false,
      }),
    ).toBe(false);
    expect(textoDoTelefoneSemMidia(false, false)).toBe(
      TEXTOS_DA_IA.semMidiaNaLinhaSemPermissao,
    );
    expect(textoDoTelefoneSemMidia(true, false)).toBe(
      TEXTOS_DA_IA.semMidiaNaLinhaForcadoSemPermissao,
    );
    for (const frase of [
      TEXTOS_DA_IA.semMidiaNaLinhaSemPermissao,
      TEXTOS_DA_IA.semMidiaNaLinhaForcadoSemPermissao,
    ]) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).toContain("peça ao administrador da clínica");
    }
  });

  it("nenhum travessão na aba com o chip", () => {
    expect(aba()).not.toMatch(/[—–]/);
    expect(aba({ telefonesForcados: ["t1"] })).not.toMatch(/[—–]/);
  });
});

// ---------------------------------------------------------------------------
// [AG6b mídia] A leitura da liberacao (revisao das telas, itens 2 e 5)
// ---------------------------------------------------------------------------

const CLINICA_LIDA = "acd9c539-585e-4f2a-a195-712c70099564";

type ConsultaFalsa = {
  tabela: string;
  colunas: string;
  filtros: Record<string, unknown>;
};
type RespostaFalsa = { data: unknown; error: { code: string } | null };

/**
 * A sessao do Supabase so com o que fetchLiberacaoDaIa le. Os telefones:
 * sem a coluna (antes da migration), 42703 quando ela e pedida; com
 * `erroDosTelefones`, esse erro sempre. A configuracao: o skills do
 * rascunho e o da publicada.
 */
function sessaoDaAba(
  opcoes: {
    semAColuna?: boolean;
    erroDosTelefones?: string;
    rascunho?: { skills: unknown } | null;
    publicada?: { skills: unknown };
  } = {},
) {
  const consultas: ConsultaFalsa[] = [];
  const responder = ({ tabela, colunas, filtros }: ConsultaFalsa): RespostaFalsa => {
    if (tabela === "ia_liberacao") {
      return { data: null, error: null };
    }
    if (tabela === "ia_numero_liberado") {
      return { data: [], error: null };
    }
    if (tabela === "ia_contato_liberado") {
      if (opcoes.erroDosTelefones) {
        return { data: null, error: { code: opcoes.erroDosTelefones } };
      }
      const pediuAVersao = colunas.includes("aviso_da_openai_versao");
      if (opcoes.semAColuna && pediuAVersao) {
        return { data: null, error: { code: "42703" } };
      }
      const linhas = [
        { id: "t1", phone_key: "+5584999990001", rotulo: "Vinicius", ativo: true, versao: 2 },
        { id: "t2", phone_key: "+5584999990002", rotulo: "Ana", ativo: true, versao: 1 },
      ];
      return {
        data: linhas.map(({ versao, ...linha }) =>
          pediuAVersao ? { ...linha, aviso_da_openai_versao: versao } : linha,
        ),
        error: null,
      };
    }
    if (tabela === "ai_agent_config") {
      if (filtros.status === "publicada") {
        return {
          data: {
            operating_mode: "24h",
            fallback_minutes: null,
            operating_hours: {},
            ...(opcoes.publicada ?? { skills: {} }),
          },
          error: null,
        };
      }
      return { data: opcoes.rascunho ?? null, error: null };
    }
    return { data: null, error: { code: "tabela_inesperada" } };
  };
  const cliente = {
    from(tabela: string) {
      const consulta: ConsultaFalsa = { tabela, colunas: "", filtros: {} };
      consultas.push(consulta);
      const agora = () => Promise.resolve(responder(consulta));
      const cadeia = {
        select(colunas: string) {
          consulta.colunas = colunas;
          return cadeia;
        },
        eq(coluna: string, valor: unknown) {
          consulta.filtros[coluna] = valor;
          return cadeia;
        },
        order: () => cadeia,
        limit: () => cadeia,
        maybeSingle: agora,
        then<A, B>(
          ok?: (resposta: RespostaFalsa) => A | PromiseLike<A>,
          falha?: (erro: unknown) => B | PromiseLike<B>,
        ) {
          return agora().then(ok, falha);
        },
      };
      return cadeia;
    },
    rpc: async (nome: string) =>
      nome === "ia_interruptor_ligado"
        ? { data: true, error: null }
        : {
            data: {
              teto_atingido: false,
              versao_publicada: 1,
              telefones_invalidos: [],
              telefones_sem_autorizacao: [],
              conversas_abertas: [],
              motor_parado: false,
            },
            error: null,
          },
  };
  return {
    cliente: cliente as unknown as SupabaseClient,
    consultas,
    colunasDosTelefones: () =>
      consultas
        .filter((consulta) => consulta.tabela === "ia_contato_liberado")
        .map((consulta) => consulta.colunas),
  };
}

describe("a lista de telefones antes da migration (item 2)", () => {
  it("sem a coluna (42703): lê de novo sem ela, todo telefone na versão 1, e a aba não cai", async () => {
    const banco = sessaoDaAba({ semAColuna: true });
    const lidos = await lerLiberacaoDeVerdade(banco.cliente, CLINICA_LIDA);
    expect(banco.colunasDosTelefones()).toEqual([
      COLUNAS_DOS_TELEFONES,
      COLUNAS_DOS_TELEFONES_SEM_O_AVISO,
    ]);
    expect(COLUNAS_DOS_TELEFONES_SEM_O_AVISO).toBe(
      "id, phone_key, rotulo, ativo",
    );
    // O lado seguro: sem a versao, ninguem tem o aviso novo.
    expect(lidos.telefones).toEqual([
      { id: "t1", telefone: "+5584999990001", rotulo: "Vinicius", ativo: true, avisoDaOpenaiVersao: 1 },
      { id: "t2", telefone: "+5584999990002", rotulo: "Ana", ativo: true, avisoDaOpenaiVersao: 1 },
    ]);
    // A volta deixa rastro no servidor: so o evento, a clinica e o codigo.
    expect(registro.logs).toEqual([
      [
        EVENTO_DOS_TELEFONES_SEM_O_AVISO,
        { clinic_id: CLINICA_LIDA, error_code: "42703" },
      ],
    ]);
    const tudo = JSON.stringify(registro.logs);
    expect(tudo).not.toContain("99999");
    expect(tudo).not.toContain("Vinicius");
  });

  it("com a mídia ligada, o telefone lido sem a coluna ganha o chip (o aviso novo ainda não existe)", async () => {
    const lidos = await lerLiberacaoDeVerdade(
      sessaoDaAba({
        semAColuna: true,
        rascunho: { skills: { ler_audio: true } },
      }).cliente,
      CLINICA_LIDA,
    );
    const html = aba({ dados: { ...dados(), telefones: lidos.telefones } });
    expect(linhaDoTelefone(html, "Vinicius")).toContain(
      "Sem áudio, foto e documento",
    );
  });

  it("outro erro continua derrubando a aba (nunca uma lista que não foi lida), sem ler de novo", async () => {
    for (const codigo of ["42501", "PGRST205", "42P01"]) {
      const banco = sessaoDaAba({ erroDosTelefones: codigo });
      await expect(
        lerLiberacaoDeVerdade(banco.cliente, CLINICA_LIDA),
      ).rejects.toThrow();
      expect(banco.colunasDosTelefones()).toEqual([COLUNAS_DOS_TELEFONES]);
    }
    expect(registro.logs).toEqual([]);
  });
});

describe("a mídia ligada na leitura da liberação, para o Painel geral (item 5)", () => {
  it("o rascunho ou a publicada, como a Tela 6; só o verdadeiro liga", async () => {
    const casos: [Parameters<typeof sessaoDaAba>[0], boolean][] = [
      [{}, false],
      [{ rascunho: { skills: { ler_audio: true } } }, true],
      [{ publicada: { skills: { ler_imagem_e_documento: true } } }, true],
      [
        {
          rascunho: { skills: { ler_audio: false } },
          publicada: { skills: { ler_audio: true } },
        },
        true,
      ],
      [{ rascunho: { skills: { agendar: true } } }, false],
      [{ rascunho: { skills: { ler_audio: "true" } } }, false],
      [{ rascunho: { skills: [true] } }, false],
      [{ rascunho: { skills: null }, publicada: { skills: 7 } }, false],
    ];
    for (const [opcoes, esperado] of casos) {
      const lidos = await lerLiberacaoDeVerdade(
        sessaoDaAba(opcoes).cliente,
        CLINICA_LIDA,
      );
      expect(lidos.midiaLigada, JSON.stringify(opcoes)).toBe(esperado);
    }
  });

  it("lê o skills do rascunho e da publicada da clínica, pela sessão", async () => {
    const banco = sessaoDaAba();
    await lerLiberacaoDeVerdade(banco.cliente, CLINICA_LIDA);
    const config = banco.consultas.filter(
      (consulta) => consulta.tabela === "ai_agent_config",
    );
    expect(config.map((consulta) => consulta.filtros)).toEqual([
      { clinic_id: CLINICA_LIDA, status: "publicada" },
      { clinic_id: CLINICA_LIDA, status: "rascunho" },
    ]);
    for (const consulta of config) {
      expect(consulta.colunas).toContain("skills");
      // Nunca as instrucoes (so as RPCs do super admin leem).
      expect(consulta.colunas).not.toContain("instrucoes");
    }
  });
});

// ---------------------------------------------------------------------------
// O dialogo do "Ligar de novo"
// ---------------------------------------------------------------------------

function dialogo(
  props: Partial<ComponentProps<typeof DialogoDoReligar>> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <DialogoDoReligar
        telefone={telefone({ id: "t2", rotulo: "Ana", ativo: false })}
        confirmou={false}
        aoMudarConfirmacao={vi.fn()}
        aoFechar={vi.fn()}
        aoConfirmar={vi.fn()}
        pendente={false}
        ocupado={false}
        dica={null}
        idDaCaixa="aviso-religar"
        {...props}
      />
    </TooltipProvider>,
  );
}

/** A tag de abertura do botao com aquele texto. */
function botao(html: string, rotulo: string): string {
  const indice = html.indexOf(`${rotulo}</button>`);
  expect(indice, `botão ${rotulo}`).toBeGreaterThan(-1);
  const abertura = html.lastIndexOf("<button", indice);
  return html.slice(abertura, html.indexOf(">", abertura) + 1);
}

describe("o diálogo do Ligar de novo", () => {
  it("fechado sem telefone", () => {
    expect(dialogo({ telefone: null })).toBe("");
  });

  it("o título, o texto, de quem é o telefone e a caixa do aviso, nunca marcada sozinha", () => {
    const html = dialogo();
    const visivel = texto(html);
    expect(visivel).toContain(TEXTOS_DA_IA.religarTitulo);
    expect(visivel).toContain(TEXTOS_DA_IA.religarTexto);
    expect(visivel).toContain("Ana");
    expect(visivel).toContain("(84) 99999-0001");
    expect(visivel).toContain(TEXTOS_DA_IA.confirmarAvisoDaOpenai);
    const caixa = /<button[^>]*role="checkbox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(caixa).toContain('aria-checked="false"');
    expect(caixa).toContain('id="aviso-religar"');
    expect(html).toContain('for="aviso-religar"');
  });

  it("sem a caixa marcada: Ligar de novo preso, com a dica escrita no cursor", () => {
    const html = dialogo();
    expect(botao(html, TEXTOS_DA_IA.religar)).toContain('disabled=""');
    expect(html).toMatch(
      /<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*disabled=""/,
    );
  });

  it("com a caixa marcada: Ligar de novo livre; rodando, Ligando...", () => {
    expect(
      botao(dialogo({ confirmou: true }), TEXTOS_DA_IA.religar),
    ).not.toContain('disabled=""');
    const rodando = dialogo({ confirmou: true, ocupado: true, pendente: true });
    expect(botao(rodando, TEXTOS_DA_IA.religando)).toContain(
      'aria-busy="true"',
    );
  });

  it("sem permissão: tudo preso, com a dica de permissão", () => {
    const html = dialogo({
      confirmou: true,
      dica: TEXTOS_DA_IA.semPermissao,
    });
    expect(botao(html, TEXTOS_DA_IA.religar)).toContain('disabled=""');
    const caixa = /<button[^>]*role="checkbox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(caixa).toContain('disabled=""');
  });

  it("o botão de Ligar de novo da linha continua visível; o diálogo só abre no clique", () => {
    const html = aba();
    expect(html).toContain("Ligar de novo</button>");
    // Fechado de saida: nem o titulo do dialogo, nem uma segunda caixa.
    expect(html).not.toContain(TEXTOS_DA_IA.religarTitulo);
    expect(html.match(/role="checkbox"/g) ?? []).toHaveLength(1);
  });
});
