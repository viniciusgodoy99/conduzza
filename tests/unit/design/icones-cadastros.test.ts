import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { CalendarX2, ShieldPlus, Umbrella, ZapOff } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  COBERTO_PELO_CONVENIO,
  ENCAIXE_DO_BLOQUEIO,
} from "@/components/cadastros/comum";
import {
  ACCESS_LEVEL_STATUS,
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
  CONSENT_STATUS,
  CONTACT_RECENCY,
  CONVERSAO_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  IA_AGENDA_STATUS,
  PATIENT_TAG,
  RECORD_STATUS,
  REGUA_STATUS,
  TOKEN_META_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";

// Achados 9 e 16 da revisao da leva 2: os chips de Cadastros ("Coberto" e
// "Impede encaixe") repetiam icones que ja tinham outro sentido e outra cor
// (CalendarX2 do pacote vencido, em alert; ShieldPlus do botao de
// autorizacao de Confirmacoes). A regra C18 e "um icone, um sentido, uma cor,
// em qualquer tela, dentro ou fora dos mapas", entao o teste olha os mapas
// globais E o codigo das telas.

const GLOBAIS: StatusDefinition[] = [
  APPOINTMENT_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  CONTACT_RECENCY,
  PATIENT_TAG,
  APPOINTMENT_FLAG,
  RECORD_STATUS,
  REGUA_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  ACCESS_LEVEL_STATUS,
  IA_AGENDA_STATUS,
  CONVERSAO_STATUS,
  TOKEN_META_STATUS,
  CONSENT_STATUS,
].flatMap((mapa) => Object.values(mapa) as StatusDefinition[]);

const DOS_CADASTROS: StatusDefinition[] = [
  COBERTO_PELO_CONVENIO,
  ...Object.values(ENCAIXE_DO_BLOQUEIO),
];

const RAIZ = path.resolve(__dirname, "../../..");

function arquivosDeCodigo(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = path.join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivosDeCodigo(caminho));
    } else if (/\.(ts|tsx)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

/** Arquivos que importam o icone do lucide-react, relativos a raiz. */
function quemImporta(icone: string): string[] {
  const importDoLucide = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
  return ["app", "components", "lib"]
    .flatMap((pasta) => arquivosDeCodigo(path.join(RAIZ, pasta)))
    .filter((arquivo) => {
      const codigo = readFileSync(arquivo, "utf8");
      return [...codigo.matchAll(importDoLucide)].some((casamento) =>
        (casamento[1] ?? "")
          .split(",")
          .map((parte) => parte.trim())
          .includes(icone),
      );
    })
    .map((arquivo) => path.relative(RAIZ, arquivo));
}

describe("ícones exclusivos dos chips de Cadastros", () => {
  it("Coberto é Umbrella info e Impede encaixe é ZapOff warning", () => {
    expect(COBERTO_PELO_CONVENIO.icon).toBe(Umbrella);
    expect(COBERTO_PELO_CONVENIO.tone).toBe("info");
    expect(ENCAIXE_DO_BLOQUEIO.impede.icon).toBe(ZapOff);
    expect(ENCAIXE_DO_BLOQUEIO.impede.tone).toBe("warning");
  });

  it("nenhum ícone dos chips de Cadastros aparece nos mapas globais", () => {
    const globais = new Set(GLOBAIS.map((definicao) => definicao.icon));
    for (const definicao of DOS_CADASTROS) {
      expect(globais.has(definicao.icon)).toBe(false);
    }
  });

  it("não reusa CalendarX2 (pacote vencido) nem ShieldPlus (autorização)", () => {
    for (const definicao of DOS_CADASTROS) {
      expect(definicao.icon).not.toBe(CalendarX2);
      expect(definicao.icon).not.toBe(ShieldPlus);
    }
  });

  it("Umbrella e ZapOff só existem nos Cadastros, em nenhuma outra tela", () => {
    expect(quemImporta("Umbrella")).toEqual(["components/cadastros/comum.tsx"]);
    expect(quemImporta("ZapOff")).toEqual(["components/cadastros/comum.tsx"]);
  });
});
