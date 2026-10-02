import { describe, expect, it } from "vitest";

import { motivoDoPulo } from "@/components/confirmacoes/chip-do-toque";
import {
  contaComoNaoEnviada,
  MOTIVOS_DE_NAO_ENVIO,
  resumirMotivos,
  rodapeDosMotivos,
  ROTULO_DA_FALHA_GENERICA,
  rotuloDaFalhaDeEnvio,
  rotuloDoNaoEnvio,
} from "@/lib/domain/falha-de-envio";

// Cartao "Não enviadas" da Tela 2 (Fase 3, 02/10/2026): quais pulos contam,
// o rotulo curto de cada motivo e codigo (sem travessao, sem codigo cru) e o
// rodape com o motivo mais comum, que nunca escolhe um lado num empate.

const TRAVESSOES = /[–—]/;

// Todos os codigos que podem chegar em cadence_run.motivo_da_falha e tem
// rotulo proprio (send.ts, uazapi.ts, regua.ts, worker.ts e job_queue).
const CODIGOS_COM_ROTULO: Record<string, string> = {
  whatsapp_463: "WhatsApp restringiu o número",
  provider_indisponivel: "Servidor do WhatsApp fora do ar",
  envio_incerto: "Sem confirmação do WhatsApp",
  instancia_invalida: "WhatsApp desconectado",
  sem_instancia: "Número da clínica não configurado",
  configuracao_ausente: "Número da clínica não configurado",
  slot_indisponivel: "Número da clínica indisponível",
  conta_divergente: "Conversa em outro número",
  conversa_inexistente: "Conversa não encontrada",
  contato_inexistente: "Contato não encontrado",
  sem_consentimento_no_envio: "Sem autorização",
  leitura_falhou: "Erro do sistema no envio",
  registro_falhou: "Erro do sistema no envio",
  pular_run_falhou: "Erro do sistema no envio",
  excecao_no_worker: "Erro do sistema no envio",
  lease_expirado: "Envio interrompido",
  devolucoes_demais: "Envio adiado várias vezes",
};

describe("contaComoNaoEnviada", () => {
  it("conta os pulos que deixaram o paciente sem a mensagem", () => {
    for (const motivo of [
      "falha_envio",
      "desconectado",
      "canal_ocupado",
      "numero_removido",
      "sem_consentimento",
      "fora_janela",
      "teto_gasto",
    ]) {
      expect(contaComoNaoEnviada(motivo), motivo).toBe(true);
    }
    expect(MOTIVOS_DE_NAO_ENVIO).toHaveLength(7);
  });

  it("deixa de fora os pulos esperados e o que não conhece", () => {
    for (const motivo of [
      "condicao_parada",
      "consulta_remarcada",
      "remarcacao_pedida",
      "toque_atrasado",
      "qualquer_outro",
      "",
    ]) {
      expect(contaComoNaoEnviada(motivo), motivo).toBe(false);
    }
  });
});

describe("rotuloDaFalhaDeEnvio", () => {
  it("cada código conhecido tem o rótulo curto de recepção", () => {
    for (const [codigo, rotulo] of Object.entries(CODIGOS_COM_ROTULO)) {
      expect(rotuloDaFalhaDeEnvio(codigo), codigo).toBe(rotulo);
    }
  });

  it("uazapi_<status> pela faixa: 5xx fora do ar, o resto recusa", () => {
    expect(rotuloDaFalhaDeEnvio("uazapi_500")).toBe(
      "Servidor do WhatsApp fora do ar",
    );
    expect(rotuloDaFalhaDeEnvio("uazapi_503")).toBe(
      "Servidor do WhatsApp fora do ar",
    );
    expect(rotuloDaFalhaDeEnvio("uazapi_400")).toBe(
      "WhatsApp recusou a mensagem",
    );
    expect(rotuloDaFalhaDeEnvio("uazapi_429")).toBe(
      "WhatsApp recusou a mensagem",
    );
  });

  it("linha antiga, 'desconhecido' e código sem rótulo viram Falha no envio", () => {
    expect(ROTULO_DA_FALHA_GENERICA).toBe("Falha no envio");
    for (const codigo of [
      null,
      undefined,
      "",
      "desconhecido",
      "uazapi_",
      "uazapi_5000",
      "codigo_novo_qualquer",
    ]) {
      expect(rotuloDaFalhaDeEnvio(codigo), String(codigo)).toBe(
        "Falha no envio",
      );
    }
  });
});

describe("rotuloDoNaoEnvio", () => {
  it("motivo do pulo em rótulo curto", () => {
    expect(rotuloDoNaoEnvio("desconectado", null)).toBe(
      "WhatsApp desconectado",
    );
    expect(rotuloDoNaoEnvio("canal_ocupado", null)).toBe(
      "Fila até a hora da consulta",
    );
    expect(rotuloDoNaoEnvio("numero_removido", null)).toBe(
      "Número removido da clínica",
    );
    expect(rotuloDoNaoEnvio("fora_janela", null)).toBe(
      "Fora do horário de envio",
    );
    expect(rotuloDoNaoEnvio("teto_gasto", null)).toBe(
      "Limite de gasto atingido",
    );
  });

  it("falha de envio usa o código gravado; sem código, Falha no envio", () => {
    expect(rotuloDoNaoEnvio("falha_envio", "whatsapp_463")).toBe(
      "WhatsApp restringiu o número",
    );
    expect(rotuloDoNaoEnvio("falha_envio", null)).toBe("Falha no envio");
  });

  it("sem autorização separa quem pediu para não receber (achado 57)", () => {
    expect(rotuloDoNaoEnvio("sem_consentimento", null, "revogado")).toBe(
      "Pediu para não receber",
    );
    expect(rotuloDoNaoEnvio("sem_consentimento", null, "sem_autorizacao")).toBe(
      "Sem autorização",
    );
    expect(rotuloDoNaoEnvio("sem_consentimento", null, "autorizado")).toBe(
      "Sem autorização",
    );
    expect(rotuloDoNaoEnvio("sem_consentimento", null)).toBe("Sem autorização");
  });

  it("nenhum rótulo tem travessão nem código cru", () => {
    const rotulos = [
      ...Object.keys(CODIGOS_COM_ROTULO).map((codigo) =>
        rotuloDaFalhaDeEnvio(codigo),
      ),
      ...MOTIVOS_DE_NAO_ENVIO.map((motivo) => rotuloDoNaoEnvio(motivo, null)),
      rotuloDoNaoEnvio("sem_consentimento", null, "revogado"),
      rotuloDaFalhaDeEnvio("uazapi_400"),
      rotuloDaFalhaDeEnvio("uazapi_502"),
    ];
    for (const rotulo of rotulos) {
      expect(rotulo).not.toMatch(TRAVESSOES);
      expect(rotulo).not.toMatch(/_/);
      expect(rotulo.charAt(0)).toBe(rotulo.charAt(0).toUpperCase());
    }
  });
});

describe("resumirMotivos (moda dos rótulos)", () => {
  it("sem nenhuma não enviada, nada no rodapé", () => {
    const resumo = resumirMotivos([]);
    expect(resumo).toEqual({ tipo: "nenhum" });
    expect(rodapeDosMotivos(resumo)).toBeNull();
  });

  it("todas pelo mesmo motivo: Motivo", () => {
    const resumo = resumirMotivos(["Sem autorização", "Sem autorização"]);
    expect(resumo).toEqual({ tipo: "unico", rotulo: "Sem autorização" });
    expect(rodapeDosMotivos(resumo)).toBe("Motivo: Sem autorização");
    expect(rodapeDosMotivos(resumirMotivos(["Falha no envio"]))).toBe(
      "Motivo: Falha no envio",
    );
  });

  it("um motivo à frente dos outros: Mais comum", () => {
    const resumo = resumirMotivos([
      "WhatsApp desconectado",
      "Sem autorização",
      "WhatsApp desconectado",
      "Fora do horário de envio",
    ]);
    expect(resumo).toEqual({
      tipo: "mais_comum",
      rotulo: "WhatsApp desconectado",
    });
    expect(rodapeDosMotivos(resumo)).toBe("Mais comum: WhatsApp desconectado");
  });

  it("empate no topo não escolhe um lado", () => {
    const resumo = resumirMotivos([
      "Sem autorização",
      "WhatsApp desconectado",
      "Fora do horário de envio",
      "WhatsApp desconectado",
      "Sem autorização",
    ]);
    expect(resumo).toEqual({ tipo: "variados" });
    expect(rodapeDosMotivos(resumo)).toBe("Motivos variados");
  });

  it("dois códigos com o mesmo rótulo somam juntos", () => {
    const rotulos = [
      "sem_instancia",
      "configuracao_ausente",
      "whatsapp_463",
    ].map((codigo) => rotuloDoNaoEnvio("falha_envio", codigo));
    expect(rodapeDosMotivos(resumirMotivos(rotulos))).toBe(
      "Mais comum: Número da clínica não configurado",
    );
  });

  it("nenhum rodapé tem travessão", () => {
    for (const resumo of [
      resumirMotivos(["A"]),
      resumirMotivos(["A", "A", "B"]),
      resumirMotivos(["A", "B"]),
    ]) {
      expect(rodapeDosMotivos(resumo) ?? "").not.toMatch(TRAVESSOES);
    }
  });
});

describe("motivoDoPulo com o detalhe da falha (chip da lista)", () => {
  it("a falha diz o porquê com o mesmo rótulo do cartão", () => {
    expect(motivoDoPulo("falha_envio", undefined, "whatsapp_463")).toBe(
      "falhou no envio: WhatsApp restringiu o número",
    );
    expect(motivoDoPulo("falha_envio", undefined, "uazapi_502")).toBe(
      "falhou no envio: servidor do WhatsApp fora do ar",
    );
    expect(motivoDoPulo("falha_envio", undefined, "sem_instancia")).toBe(
      "falhou no envio: número da clínica não configurado",
    );
  });

  it("sem detalhe, ou com código sem rótulo, continua como antes", () => {
    expect(motivoDoPulo("falha_envio")).toBe("falhou no envio");
    expect(motivoDoPulo("falha_envio", undefined, null)).toBe(
      "falhou no envio",
    );
    expect(motivoDoPulo("falha_envio", undefined, "desconhecido")).toBe(
      "falhou no envio",
    );
  });

  it("o detalhe não muda os outros motivos", () => {
    expect(motivoDoPulo("fora_janela", undefined, null)).toBe(
      "fora do horário de envio",
    );
    expect(motivoDoPulo("sem_consentimento", "revogado", null)).toBe(
      "o paciente pediu para não receber mensagens",
    );
  });
});
