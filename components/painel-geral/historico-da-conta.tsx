import { History } from "lucide-react";
import { useId } from "react";

import {
  autoria,
  dataEHoraNaClinica,
  descricoesDoHistorico,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { HistoricoDaConta as Historico } from "@/lib/queries/painel-geral";

// O historico da conta no detalhe do Painel geral (segunda leva,
// 26/10/2026; escolha (6) do dono): o que a equipe Conduzza mudou na
// clinica (suspender e reativar, liberar e retirar o agente, a producao, o
// teto, os requisitos e as notas), com quem e quando, do mais novo para o
// mais antigo. Vem do audit_log pela funcao do banco, so da equipe
// Conduzza; nada de dado de paciente (dos detalhes, so as chaves que a tela
// conhece, em painel-geral.ts). Leitura que falhou: o aviso no lugar da
// lista, nunca um historico vazio. Server Component.

export function HistoricoDaConta({
  historico,
  fuso,
}: {
  /** Os eventos, o mais novo primeiro; "erro": a leitura falhou. */
  historico: Historico | "erro";
  /** clinic.timezone: quando, no relogio da clinica. */
  fuso: string;
}) {
  const id = useId();
  // Cada evento em texto; a direcao da mudanca do agente sai da lista
  // inteira (a trilha so guarda o estado de destino).
  const eventos =
    historico === "erro"
      ? "erro"
      : descricoesDoHistorico(historico.eventos, fuso);
  return (
    <Card role="region" aria-labelledby={`${id}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <History className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${id}-titulo`}>
              {TEXTOS_DO_PAINEL.historicoTitulo}
            </CardTitle>
            <CardDescription>
              {TEXTOS_DO_PAINEL.historicoDescricao}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {eventos === "erro" ? (
          <Aviso tom="alert" role="note">
            {TEXTOS_DO_PAINEL.historicoSemLeitura}
          </Aviso>
        ) : eventos.length === 0 ? (
          <p className="text-[13px] text-text-secondary">
            {TEXTOS_DO_PAINEL.historicoVazio}
          </p>
        ) : (
          // Lista longa rola dentro do cartao; o foco de teclado chega nela
          // (a rolagem sem foco nao rola pelo teclado).
          <ol
            aria-labelledby={`${id}-titulo`}
            tabIndex={0}
            className="grid cz-scroll max-h-[480px] gap-0 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {eventos.map(({ evento, descricao: { titulo, linhas } }) => {
              return (
                <li
                  key={evento.id}
                  className="grid gap-0.5 border-b border-border py-2.5 last:border-b-0"
                >
                  <p className="text-[13.5px] font-semibold text-text-strong">
                    {titulo}
                  </p>
                  {linhas.map((linha) => (
                    <p
                      key={linha}
                      className="text-[13px] break-words text-foreground"
                    >
                      {linha}
                    </p>
                  ))}
                  <p className="text-[12px] text-text-secondary">
                    Feito {autoria(evento.autor)} em{" "}
                    <span className="cz-num">
                      {dataEHoraNaClinica(evento.em, fuso)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        {historico !== "erro" && historico.temMais ? (
          <p className="mt-2 text-[12px] text-text-secondary">
            {TEXTOS_DO_PAINEL.historicoTemMais}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
