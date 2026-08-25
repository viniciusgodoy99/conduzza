"use client";

import { TriangleAlert } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OpcaoDeclaracao } from "@/lib/integrations/importar-contatos";
import { cn } from "@/lib/utils";

// Passo 3 da importacao: declaracao OBRIGATORIA de como os contatos
// autorizaram receber mensagens. A escolha vira a evidencia gravada em
// contact_consent (regra 3.3: sem autorização, nenhum disparo).

const OPCOES: {
  valor: OpcaoDeclaracao;
  rotulo: string;
  descricao: string;
}[] = [
  {
    valor: "formulario_site",
    rotulo: "Formulário do site",
    descricao: "A pessoa preencheu o formulário e aceitou receber mensagens.",
  },
  {
    valor: "anuncio_ctwa",
    rotulo: "Anúncio com clique para o WhatsApp",
    descricao: "A pessoa clicou no anúncio e começou a conversa com a clínica.",
  },
  {
    valor: "recepcao",
    rotulo: "Cadastro presencial na recepção",
    descricao: "A pessoa autorizou pessoalmente no balcão da clínica.",
  },
  {
    valor: "outra",
    rotulo: "Outra origem (descreva)",
    descricao: "Explique no campo abaixo como a autorização aconteceu.",
  },
];

export function PassoConsentimento({
  opcao,
  observacao,
  aoEscolher,
  aoMudarObservacao,
}: {
  opcao: OpcaoDeclaracao | null;
  observacao: string;
  aoEscolher: (opcao: OpcaoDeclaracao) => void;
  aoMudarObservacao: (observacao: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-secondary">
        Como estas pessoas autorizaram receber mensagens da clínica no
        WhatsApp? A declaração fica registrada junto de cada contato.
      </p>

      <div
        role="radiogroup"
        aria-label="Como os contatos autorizaram receber mensagens"
        className="grid gap-2"
      >
        {OPCOES.map((item) => (
          <label
            key={item.valor}
            className={cn(
              "flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5",
              opcao === item.valor
                ? "border-primary bg-muted"
                : "border-border",
            )}
          >
            <input
              type="radio"
              name="declaracao-consentimento"
              value={item.valor}
              checked={opcao === item.valor}
              onChange={() => aoEscolher(item.valor)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{item.rotulo}</span>
              <span className="text-xs text-text-secondary">
                {item.descricao}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="declaracao-observacao">
          Observação {opcao === "outra" ? "(obrigatória)" : "(opcional)"}
        </Label>
        <Textarea
          id="declaracao-observacao"
          rows={2}
          maxLength={300}
          value={observacao}
          onChange={(evento) => aoMudarObservacao(evento.target.value)}
          placeholder="Ex.: pacientes que assinaram a ficha de autorização na recepção em maio"
        />
      </div>

      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border px-3 py-2.5"
        style={{
          borderColor: "var(--warning)",
          backgroundColor: "var(--warning-bg)",
          color: "var(--warning-text)",
        }}
      >
        <TriangleAlert
          strokeWidth={1.5}
          className="mt-0.5 size-4 shrink-0"
          aria-hidden
        />
        <p className="text-sm">
          Disparar mensagem para quem não autorizou derruba a nota do seu
          número no WhatsApp e pode travar os envios da clínica inteira.
        </p>
      </div>
    </div>
  );
}
