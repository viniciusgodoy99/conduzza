import { HeartPulse } from "lucide-react";
import { useId } from "react";

import {
  detalheDoSinal,
  rotuloDoSinal,
  SAUDE_STATUS,
  SINAL_STATUS,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ClinicaNoPainel,
  SinalNoPainel,
} from "@/lib/queries/painel-geral";
import { cn } from "@/lib/utils";

// A saude e os sinais de alerta de uma clinica no Painel geral (segunda
// leva, 26/10/2026; escolhas (1) e (8) do dono). O banco decide os sinais e
// a saude (a leitura confere a coerencia); aqui, o desenho: na linha da
// lista, a saude e cada sinal aceso, todos em 3 camadas (icone, rotulo e
// cor; nunca so cor); no detalhe, o cartao "Saúde da clínica" com a regra
// escrita e, em cada sinal, o que o banco contou (desde quando, quantos,
// quanto do teto). Sem estado nem evento: serve a lista (client) e o
// detalhe (servidor).

/** Os sinais acesos, um chip por sinal, numa lista com nome acessivel. */
export function ListaDeSinais({
  sinais,
  rotulo,
  className,
}: {
  sinais: readonly SinalNoPainel[];
  /** O nome da lista para o leitor de tela ("Sinais de alerta da ..."). */
  rotulo: string;
  className?: string;
}) {
  if (sinais.length === 0) {
    return null;
  }
  return (
    <ul aria-label={rotulo} className={cn("flex flex-wrap gap-1", className)}>
      {sinais.map((sinal) => (
        <li key={sinal.chave}>
          <StatusChip
            size="sm"
            definition={SINAL_STATUS[sinal.chave]}
            label={rotuloDoSinal(sinal)}
          />
        </li>
      ))}
    </ul>
  );
}

/** A celula Saude da lista: a saude e, embaixo, os sinais acesos. */
export function SaudeNaLinha({
  clinica,
}: {
  clinica: Pick<ClinicaNoPainel, "nome" | "saude" | "sinais">;
}) {
  return (
    <div className="grid justify-items-start gap-1">
      <StatusChip size="sm" definition={SAUDE_STATUS[clinica.saude]} />
      <ListaDeSinais
        sinais={clinica.sinais}
        rotulo={`${TEXTOS_DO_PAINEL.sinaisDeAlerta} da ${clinica.nome}`}
        className="max-w-[280px]"
      />
    </div>
  );
}

/** O cartao "Saúde da clínica" do detalhe. */
export function SaudeDaClinicaCartao({
  clinica,
}: {
  clinica: Pick<ClinicaNoPainel, "saude" | "sinais" | "fuso">;
}) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={`${id}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <HeartPulse className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${id}-titulo`}>
              {TEXTOS_DO_PAINEL.saudeTitulo}
            </CardTitle>
            <CardDescription>{TEXTOS_DO_PAINEL.saudeRegra}</CardDescription>
          </div>
        </div>
        <CardAction>
          <StatusChip definition={SAUDE_STATUS[clinica.saude]} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p id={`${id}-sinais`} className="cz-eyebrow text-text-secondary">
          {TEXTOS_DO_PAINEL.sinaisDeAlerta}
        </p>
        {clinica.sinais.length === 0 ? (
          <p className="text-[13px] text-text-secondary">
            {TEXTOS_DO_PAINEL.nenhumSinal}
          </p>
        ) : (
          <ul aria-labelledby={`${id}-sinais`} className="grid gap-2.5">
            {clinica.sinais.map((sinal) => {
              const detalhe = detalheDoSinal(sinal, clinica.fuso);
              return (
                <li
                  key={sinal.chave}
                  className="grid justify-items-start gap-1"
                >
                  <StatusChip
                    size="sm"
                    definition={SINAL_STATUS[sinal.chave]}
                    label={rotuloDoSinal(sinal)}
                  />
                  {detalhe ? (
                    <p className="text-[13px] text-text-secondary">{detalhe}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
