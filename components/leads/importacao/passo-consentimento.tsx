"use client";

import { Aviso } from "@/components/shared/aviso";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OpcaoDeclaracao } from "@/lib/integrations/importar-contatos";
import { cn } from "@/lib/utils";

// Passo 3 da importacao: declaracao OBRIGATORIA de como os contatos
// autorizaram receber mensagens. A escolha vira a evidencia gravada em
// contact_consent (regra 3.3: sem autorização, nenhum disparo). A opcao
// escolhida segue a receita de selecionado do DS (lime suave com borda
// lime-700), com o radio nativo como pista que nao depende de cor.

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
      <p className="text-[13.5px] text-text-secondary">
        Como estas pessoas autorizaram receber mensagens da clínica no WhatsApp?
        A declaração fica registrada junto de cada contato.
      </p>

      <div
        role="radiogroup"
        aria-label="Como os contatos autorizaram receber mensagens"
        className="grid gap-2"
      >
        {OPCOES.map((item) => {
          const escolhida = opcao === item.valor;
          return (
            <label
              key={item.valor}
              className={cn(
                "flex min-h-10 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 cz-transition",
                escolhida
                  ? "border-primary-edge bg-primary-soft"
                  : "border-border-strong bg-card hover:bg-surface-subtle",
              )}
            >
              <input
                type="radio"
                name="declaracao-consentimento"
                value={item.valor}
                checked={escolhida}
                onChange={() => aoEscolher(item.valor)}
                className="mt-0.5 size-4 shrink-0 accent-(--primary-edge)"
              />
              <span className="grid gap-0.5">
                <span
                  className={cn(
                    "text-sm text-text-strong",
                    escolhida ? "font-bold" : "font-semibold",
                  )}
                >
                  {item.rotulo}
                </span>
                <span className="text-xs text-text-secondary">
                  {item.descricao}
                </span>
              </span>
            </label>
          );
        })}
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

      <Aviso tom="warning" role="note">
        Disparar mensagem para quem não autorizou derruba a nota do seu número
        no WhatsApp e pode travar os envios da clínica inteira.
      </Aviso>
    </div>
  );
}
