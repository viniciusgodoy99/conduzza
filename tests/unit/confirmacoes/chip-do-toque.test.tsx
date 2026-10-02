import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChipDoToque } from "@/components/confirmacoes/chip-do-toque";
import { contaComoNaoEnviada } from "@/lib/domain/falha-de-envio";

// Revisao da Fase 3 (02/10/2026): o chip "Não enviada" (MailWarning, ambar)
// da lista e o cartao/filtro "Não enviadas" tem de contar a MESMA coisa. O
// pulo esperado (regua que deixou de valer, consulta remarcada, toque que o
// seguinte cobriu) nao e falha: vira "Dispensada", neutro, com outro icone.

const MOTIVOS_PULADOS = [
  "falha_envio",
  "desconectado",
  "canal_ocupado",
  "numero_removido",
  "sem_consentimento",
  "fora_janela",
  "teto_gasto",
  "condicao_parada",
  "consulta_remarcada",
  "remarcacao_pedida",
  "toque_atrasado",
];

function chip(motivo: string): string {
  return renderToStaticMarkup(
    <ChipDoToque
      toque={{ situacao: "pulado", motivo, detalhe: null }}
      horaLocal={() => "08:00"}
    />,
  );
}

describe("ChipDoToque, pulado", () => {
  it.each(MOTIVOS_PULADOS)(
    "%s: 'Não enviada' âmbar se e somente se o cartão conta",
    (motivo) => {
      const markup = chip(motivo);
      if (contaComoNaoEnviada(motivo)) {
        expect(markup).toContain("Não enviada");
        expect(markup).toContain("lucide-mail-warning");
        expect(markup).not.toContain("Dispensada");
      } else {
        expect(markup).toContain("Dispensada");
        expect(markup).toContain("lucide-mail-minus");
        expect(markup).not.toContain("Não enviada");
        expect(markup).not.toContain("lucide-mail-warning");
      }
    },
  );

  it("o pulo esperado continua dizendo o motivo na linha de apoio", () => {
    expect(chip("condicao_parada")).toContain("não era mais necessária");
  });
});
