"use client";

import { ChaveTravada } from "@/components/agente/chave-travada";
import { TEXTOS_DO_AGENTE as T } from "@/components/agente/textos";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  type HabilidadesDoAgente,
} from "@/lib/domain/agente/config";

// Aba Habilidades da Tela 6: a lista FECHADA desta leva (lib/domain/agente),
// cada uma com titulo, uma linha de descricao e a chave. As travadas
// (Responder duvidas e Passar para a equipe) aparecem ligadas com cadeado
// (C24). A chave livre grava no RASCUNHO na hora do toque (por isso Switch,
// e nao Checkbox, C31): o paciente so sente depois de publicar, e o rodape
// conta a alteracao. Sem permissao, a chave fica visivel e desabilitada,
// com a dica.

export function AbaHabilidades({
  habilidades,
  podeEditar,
  dica,
  pendente,
  ocupado,
  aoAlternar,
}: {
  habilidades: Record<string, boolean>;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  /** A habilidade cuja gravacao esta rodando. */
  ocupado: (chave: string) => boolean;
  aoAlternar: (
    proximas: HabilidadesDoAgente,
    habilidade: (typeof HABILIDADES_DO_AGENTE)[number],
  ) => void;
}) {
  const efetivas = habilidadesEfetivas(habilidades);
  return (
    <Card role="region" aria-labelledby="agente-habilidades-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-habilidades-titulo">
            {T.habilidadesTitulo}
          </CardTitle>
          <CardDescription>{T.habilidadesDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {HABILIDADES_DO_AGENTE.map((habilidade) => {
            if (habilidade.travada) {
              return (
                <li key={habilidade.chave} className="py-2.5">
                  <ChaveTravada
                    rotulo={habilidade.titulo}
                    descricao={habilidade.descricao}
                  />
                </li>
              );
            }
            const ligada = efetivas[habilidade.chave];
            const idRotulo = `agente-habilidade-${habilidade.chave}`;
            const chave = (
              <Switch
                checked={ligada}
                aria-labelledby={idRotulo}
                aria-busy={ocupado(habilidade.chave) || undefined}
                disabled={!podeEditar || pendente}
                onCheckedChange={(valor) =>
                  aoAlternar(
                    { ...efetivas, [habilidade.chave]: valor === true },
                    habilidade,
                  )
                }
              />
            );
            return (
              <li
                key={habilidade.chave}
                className="flex min-h-10 items-center justify-between gap-3 py-2.5"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span id={idRotulo} className="text-[13.5px] font-semibold">
                    {habilidade.titulo}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {habilidade.descricao}
                  </span>
                  {ocupado(habilidade.chave) ? (
                    <span className="text-xs text-text-secondary">
                      Salvando...
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {/* O estado por extenso, ao lado da chave (a cor nao vai
                      sozinha). */}
                  <span
                    aria-hidden
                    className="text-xs font-semibold text-text-secondary"
                  >
                    {ligada ? "Ligada" : "Desligada"}
                  </span>
                  {dica ? (
                    <DisabledWithHint hint={dica}>{chave}</DisabledWithHint>
                  ) : (
                    chave
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
