import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AppointmentStatus } from "@/lib/design/status";
import {
  falhouNoEnvio,
  foiConfirmada,
  rotuloDoNaoEnvioDaConsulta,
  type ConsultaDaConfirmacao,
  type EstadoDoToque,
} from "@/lib/queries/confirmacoes";

// Os predicados dos cartoes e dos filtros da Tela 2 (Fase 3, 02/10/2026).
// foiConfirmada e o espelho de consulta_foi_confirmada: o teste de paridade
// le as listas de status DA PROPRIA MIGRATION, para o TS e o SQL nao
// divergirem sem ninguem ver.

const TODOS_OS_STATUS: AppointmentStatus[] = [
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
  "na_recepcao",
  "em_atendimento",
  "compareceu",
  "cancelado_paciente",
  "cancelado_clinica",
  "faltou",
];

/** As duas listas de "p_status in (...)" do corpo de consulta_foi_confirmada. */
function listasDoSql(): { confirmados: string[]; depois: string[] } {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      "../../../supabase/migrations/20261002110000_metricas_da_fase_3.sql",
    ),
    "utf8",
  );
  const corpo =
    /create or replace function public\.consulta_foi_confirmada\([\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
      sql,
    )?.[1] ?? "";
  const listas = [...corpo.matchAll(/p_status in \(([^)]*)\)/g)].map((achado) =>
    [...(achado[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (status) => status[1] as string,
    ),
  );
  expect(listas, "corpo de consulta_foi_confirmada na migration").toHaveLength(
    2,
  );
  // A segunda lista e a que vem depois de "p_canal is not null and".
  expect(corpo).toMatch(/p_canal is not null\s+and\s+p_status in/);
  return { confirmados: listas[0] ?? [], depois: listas[1] ?? [] };
}

describe("foiConfirmada (espelho de consulta_foi_confirmada)", () => {
  it("paridade com o SQL da migration, em todo status e canal", () => {
    const { confirmados, depois } = listasDoSql();
    expect(confirmados.sort()).toEqual([
      "confirmado_paciente",
      "confirmado_recepcao",
    ]);
    expect(depois.sort()).toEqual([
      "compareceu",
      "em_atendimento",
      "faltou",
      "na_recepcao",
    ]);
    for (const status of TODOS_OS_STATUS) {
      for (const canal of [null, "whatsapp", "telefone", ""]) {
        // coalesce(p_status in A or (p_canal is not null and p_status in B), false)
        const doSql =
          confirmados.includes(status) ||
          (canal !== null && depois.includes(status));
        expect(foiConfirmada(status, canal), `${status} / ${canal}`).toBe(
          doSql,
        );
      }
    }
  });

  it("quem confirmou e já chegou continua contando", () => {
    expect(foiConfirmada("compareceu", "whatsapp")).toBe(true);
    expect(foiConfirmada("na_recepcao", "recepcao")).toBe(true);
    expect(foiConfirmada("faltou", "whatsapp")).toBe(true);
  });

  it("sem canal, chegar não é confirmar; remarcada de volta e cancelada não contam", () => {
    expect(foiConfirmada("compareceu", null)).toBe(false);
    expect(foiConfirmada("agendado", null)).toBe(false);
    expect(foiConfirmada("cancelado_paciente", "whatsapp")).toBe(false);
    expect(foiConfirmada("aguardando_confirmacao", "whatsapp")).toBe(false);
  });

  it("confirmada pelo status vale com ou sem canal; status nulo nunca", () => {
    expect(foiConfirmada("confirmado_recepcao", null)).toBe(true);
    expect(foiConfirmada("confirmado_paciente", undefined)).toBe(true);
    expect(foiConfirmada(null, "whatsapp")).toBe(false);
    expect(foiConfirmada(undefined, null)).toBe(false);
  });
});

type Recorte = Pick<
  ConsultaDaConfirmacao,
  "status" | "remarcacao_pedida_em" | "toque" | "consent_estado"
>;

function pulada(
  motivo: string,
  detalhe: string | null = null,
  extra: Partial<Recorte> = {},
): Recorte {
  return {
    status: "aguardando_confirmacao",
    remarcacao_pedida_em: null,
    toque: { situacao: "pulado", motivo, detalhe },
    consent_estado: "autorizado",
    ...extra,
  };
}

describe("falhouNoEnvio (cartão e filtro Não enviadas)", () => {
  it("aguardando com o último toque pulado por motivo de não envio", () => {
    for (const motivo of [
      "falha_envio",
      "desconectado",
      "canal_ocupado",
      "numero_removido",
      "sem_consentimento",
      "fora_janela",
      "teto_gasto",
    ]) {
      expect(falhouNoEnvio(pulada(motivo)), motivo).toBe(true);
    }
    expect(
      falhouNoEnvio(pulada("falha_envio", null, { status: "agendado" })),
    ).toBe(true);
  });

  it("pulo esperado não é falha", () => {
    for (const motivo of [
      "condicao_parada",
      "consulta_remarcada",
      "remarcacao_pedida",
      "toque_atrasado",
    ]) {
      expect(falhouNoEnvio(pulada(motivo)), motivo).toBe(false);
    }
  });

  it("só conta quem ainda está aguardando", () => {
    for (const status of TODOS_OS_STATUS.filter(
      (s) => s !== "agendado" && s !== "aguardando_confirmacao",
    )) {
      expect(
        falhouNoEnvio(pulada("falha_envio", null, { status })),
        status,
      ).toBe(false);
    }
  });

  it("quem pediu para remarcar fica fora (a linha mostra o pedido)", () => {
    expect(
      falhouNoEnvio(
        pulada("falha_envio", null, {
          remarcacao_pedida_em: "2026-10-02T12:00:00+00:00",
        }),
      ),
    ).toBe(false);
  });

  it("toque enviado, na fila ou inexistente não é falha", () => {
    const toques: EstadoDoToque[] = [
      { situacao: "enviado", em: "2026-10-02T12:00:00+00:00" },
      { situacao: "na_fila", para: "2026-10-02T12:00:00+00:00" },
      { situacao: "nenhum" },
    ];
    for (const toque of toques) {
      expect(falhouNoEnvio(pulada("falha_envio", null, { toque }))).toBe(false);
    }
  });
});

describe("rotuloDoNaoEnvioDaConsulta", () => {
  it("usa o motivo, o código da falha e a autorização da consulta", () => {
    expect(
      rotuloDoNaoEnvioDaConsulta(pulada("falha_envio", "uazapi_400")),
    ).toBe("WhatsApp recusou a mensagem");
    expect(
      rotuloDoNaoEnvioDaConsulta(
        pulada("sem_consentimento", null, { consent_estado: "revogado" }),
      ),
    ).toBe("Pediu para não receber");
    expect(rotuloDoNaoEnvioDaConsulta(pulada("falha_envio"))).toBe(
      "Falha no envio",
    );
  });

  it("toque que não foi pulado não tem rótulo", () => {
    expect(
      rotuloDoNaoEnvioDaConsulta({
        toque: { situacao: "nenhum" },
        consent_estado: "autorizado",
      }),
    ).toBeNull();
  });
});
