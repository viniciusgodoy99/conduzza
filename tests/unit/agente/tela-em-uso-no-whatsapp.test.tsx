import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { DadosDoPainel } from "@/components/agente/tipos";
import type { ContextoDaIa } from "@/components/configuracoes/agente-de-ia";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import { expedientePadrao } from "@/lib/domain/agente/config";
import { iaLiberadaNoAmbiente, lerConfigDaIa } from "@/lib/ia/liberacao";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";

import {
  configDeTeste,
  dadosDeTeste,
  FUSO,
  ITEM_ATIVO,
  VERSAO_1,
  VERSAO_2,
} from "./tela-fixtures";

// Tela 6 (E3, D39): "Em uso no WhatsApp" SO quando a aba Agente de IA de
// Configuracoes diz "Conversando com a equipe", sem nenhum motivo de parada
// (a pagina decide com estadoDaIa). Nos outros casos, "Última publicada" e
// os textos de antes. A dica do Inicio tambem muda so nas duas clinicas.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarItemDaBase: vi.fn(),
    ativarItemDaBase: vi.fn(),
    excluirItemDaBase: vi.fn(),
    salvarInstrucoes: vi.fn(),
    publicar: vi.fn(),
    restaurarVersao: vi.fn(),
    simular: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { PainelDoAgente } = await import("@/components/agente/painel-do-agente");
const { AbaVersoes, VERSAO_EM_USO, VERSAO_EM_USO_NO_WHATSAPP } =
  await import("@/components/agente/aba-versoes");
const { textoDaUltimaPublicada, TEXTOS_DO_AGENTE } =
  await import("@/components/agente/textos");
const { dicaDaIaNoInicio } =
  await import("@/components/inicio/indicadores-do-dia");
const { versaoEmUsoNoWhatsapp } =
  await import("@/components/configuracoes/agente-de-ia");

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function painel(campos: Partial<DadosDoPainel>): string {
  const config = configDeTeste({ base: [ITEM_ATIVO] });
  return texto(
    renderToStaticMarkup(
      <TooltipProvider>
        <PainelDoAgente
          dados={dadosDeTeste({
            config,
            publicada: { ...config, status: "publicada" },
            base: [ITEM_ATIVO],
            versoes: [VERSAO_2, VERSAO_1],
            ...campos,
          })}
        />
      </TooltipProvider>,
    ),
  );
}

describe("rodapé da Tela 6", () => {
  it("em uso no WhatsApp: versão e data no fuso da clínica", () => {
    const visivel = painel({ emUsoNoWhatsapp: true });
    expect(visivel).toContain(
      "Em uso no WhatsApp: versão 2, publicada em 06/10/2026 às 14:05.",
    );
    expect(visivel).not.toContain("Última publicada:");
  });

  it("fora de uso (qualquer motivo de parada): Última publicada, como antes", () => {
    const visivel = painel({ emUsoNoWhatsapp: false });
    expect(visivel).toContain(
      "Última publicada: versão 2, em 06/10/2026 às 14:05.",
    );
    expect(visivel).not.toContain("Em uso no WhatsApp");
  });

  it("texto do rodapé, com e sem a data", () => {
    expect(textoDaUltimaPublicada(null, 3, FUSO, true)).toBe(
      "Em uso no WhatsApp: versão 3.",
    );
    expect(
      textoDaUltimaPublicada(
        { versao: 2, publicadaEm: VERSAO_2.publicadaEm },
        2,
        FUSO,
        true,
      ),
    ).toBe("Em uso no WhatsApp: versão 2, publicada em 06/10/2026 às 14:05.");
    // em uso sem versao nenhuma nao acontece; se acontecer, nao inventa
    expect(textoDaUltimaPublicada(null, null, FUSO, true)).toBe(
      "O assistente ainda não foi publicado.",
    );
    // padrao: fora de uso
    expect(textoDaUltimaPublicada(null, 3, FUSO)).toBe(
      "Última publicada: versão 3.",
    );
  });

  it("descrição de publicar: a de uso só em uso", () => {
    expect(TEXTOS_DO_AGENTE.publicarDescricaoEmUso).toBe(
      "A nova versão fica guardada em Versões e passa a valer nas conversas do WhatsApp assim que for publicada. O simulador sempre usa o rascunho.",
    );
    expect(TEXTOS_DO_AGENTE.publicarDescricao).toBe(
      "A nova versão fica guardada em Versões e passa a valer nas conversas quando o assistente for ligado no WhatsApp. O simulador sempre usa o rascunho.",
    );
  });
});

describe("aba Versões", () => {
  function versoes(emUsoNoWhatsapp?: boolean): string {
    return texto(
      renderToStaticMarkup(
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
            emUsoNoWhatsapp={emUsoNoWhatsapp}
          />
        </TooltipProvider>,
      ),
    );
  }

  it("Em uso no WhatsApp só em uso; senão, Última publicada", () => {
    expect(versoes(true)).toContain("Em uso no WhatsApp");
    expect(versoes(true)).not.toContain("Última publicada");
    expect(versoes(false)).toContain("Última publicada");
    expect(versoes(false)).not.toContain("Em uso no WhatsApp");
    expect(versoes()).toContain("Última publicada");
  });

  it("a mesma forma e a mesma cor nos dois rótulos (3 camadas)", () => {
    expect(VERSAO_EM_USO_NO_WHATSAPP.icon).toBe(VERSAO_EM_USO.icon);
    expect(VERSAO_EM_USO_NO_WHATSAPP.tone).toBe(VERSAO_EM_USO.tone);
    expect(VERSAO_EM_USO_NO_WHATSAPP.label).toBe("Em uso no WhatsApp");
  });
});

describe("dica do Início", () => {
  it("nas duas clínicas da fase: a medição ainda não existe", () => {
    expect(dicaDaIaNoInicio(true)).toBe("Medição da IA ainda não disponível.");
  });

  it("nas outras: a de sempre", () => {
    expect(dicaDaIaNoInicio(false)).toBe(
      "Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.",
    );
  });
});

// Achado T3 da revisao do E3: a pagina da Tela 6 decide "Em uso no
// WhatsApp" pela mesma regra do verde da aba (versaoEmUsoNoWhatsapp). Antes,
// com a leitura do motor falhando, a aba ficava verde e a Tela 6 dizia em
// uso; com a dos numeros falhando, a aba ficava verde e a Tela 6 nao: as
// duas telas divergiam. Agora nenhuma afirma o que nao conferiu.
describe("Em uso no WhatsApp: a mesma regra do verde da aba (T3)", () => {
  const NUMERO = "11111111-1111-4111-8111-111111111111";

  function dadosDaIa(campos: Partial<DadosDaIa> = {}): DadosDaIa {
    return {
      liberacao: {
        liberada: true,
        modo: "contatos",
        pausadaPelaClinica: false,
        tetoDiarioCentavosUsd: 500,
      },
      numerosLigados: [NUMERO],
      telefones: [
        { id: "t1", telefone: "+5584999990001", rotulo: "Ana", ativo: true },
      ],
      interruptorLigado: true,
      situacao: {
        tetoAtingido: false,
        versaoPublicada: 2,
        telefonesInvalidos: [],
        telefonesSemAutorizacao: [],
        telefonesComConversaAberta: [],
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

  const CONECTADO: NumeroDoWhatsapp = {
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

  function contexto(campos: Partial<ContextoDaIa> = {}): ContextoDaIa {
    return {
      dados: dadosDaIa(),
      numeros: [CONECTADO],
      ambienteLigado: true,
      agoraMs: Date.parse("2026-10-13T15:00:00.000Z"),
      fuso: FUSO,
      ...campos,
    };
  }

  it("tudo conferido e sem parada: em uso", () => {
    expect(versaoEmUsoNoWhatsapp(contexto())).toBe(true);
  });

  it("leitura dos números que falhou: fora de uso, como a aba (não conferido)", () => {
    expect(versaoEmUsoNoWhatsapp(contexto({ numeros: null }))).toBe(false);
  });

  it("ambiente sem o que a IA exige (inclusive o segredo, S12): fora de uso", () => {
    expect(versaoEmUsoNoWhatsapp(contexto({ ambienteLigado: false }))).toBe(
      false,
    );
  });

  it("motor da IA parado (situação da clínica): fora de uso", () => {
    const parado = dadosDaIa();
    parado.situacao = { ...parado.situacao, motorParado: true };
    expect(versaoEmUsoNoWhatsapp(contexto({ dados: parado }))).toBe(false);
  });

  it("produção com a chave e sem o segredo do identificador: fora de uso, como a aba", () => {
    const CLINICA_DA_FASE = "acd9c539-585e-4f2a-a195-712c70099564";
    const semSegredo = lerConfigDaIa({
      VERCEL_ENV: "production",
      OPENAI_API_KEY: "chave-de-teste",
    });
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({
          ambienteLigado: iaLiberadaNoAmbiente(semSegredo, CLINICA_DA_FASE),
        }),
      ),
    ).toBe(false);
    const comSegredo = lerConfigDaIa({
      VERCEL_ENV: "production",
      OPENAI_API_KEY: "chave-de-teste",
      IA_SEGREDO_DO_IDENTIFICADOR: "s".repeat(32),
    });
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({
          ambienteLigado: iaLiberadaNoAmbiente(comSegredo, CLINICA_DA_FASE),
        }),
      ),
    ).toBe(true);
  });

  it("vários números (19/10/2026): em uso com pelo menos um ligado e conectado, a mesma regra da aba", () => {
    const SEGUNDO: NumeroDoWhatsapp = {
      ...CONECTADO,
      id: "22222222-2222-4222-8222-222222222222",
      nome: "Numero 2 teste pessoal",
      principal: false,
    };
    const doisLigados = dadosDaIa({ numerosLigados: [NUMERO, SEGUNDO.id] });
    // os dois conectados, ou um conectado e o outro caido: em uso
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({ dados: doisLigados, numeros: [CONECTADO, SEGUNDO] }),
      ),
    ).toBe(true);
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({
          dados: doisLigados,
          numeros: [CONECTADO, { ...SEGUNDO, status: "desconectado" }],
        }),
      ),
    ).toBe(true);
    // nenhum conectado, ou nenhum ligado: fora de uso
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({
          dados: doisLigados,
          numeros: [
            { ...CONECTADO, status: "desconectado" },
            { ...SEGUNDO, status: "desconectado" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({
          dados: dadosDaIa({ numerosLigados: [] }),
          numeros: [CONECTADO, SEGUNDO],
        }),
      ),
    ).toBe(false);
  });

  it("número desconectado ou nunca publicado: fora de uso", () => {
    expect(
      versaoEmUsoNoWhatsapp(
        contexto({ numeros: [{ ...CONECTADO, status: "desconectado" }] }),
      ),
    ).toBe(false);
    const semVersao = dadosDaIa();
    semVersao.situacao = { ...semVersao.situacao, versaoPublicada: null };
    expect(versaoEmUsoNoWhatsapp(contexto({ dados: semVersao }))).toBe(false);
  });
});
