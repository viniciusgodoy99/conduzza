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
  agendaCompleta,
  DICA_DA_AGENDA_INCOMPLETA,
  HABILIDADES_DO_AGENTE,
  habilidadesComAgenda,
  type AgendaDoAgente,
  type HabilidadesDoAgente,
} from "@/lib/domain/agente/config";

// Aba Habilidades da Tela 6: a lista FECHADA (lib/domain/agente), cada uma
// com titulo, uma linha de descricao e a chave. As travadas (Responder
// duvidas e Passar para a equipe) aparecem ligadas com cadeado (C24). A
// chave livre grava no RASCUNHO na hora do toque (por isso Switch, e nao
// Checkbox, C31): o paciente so sente depois de publicar, e o rodape conta a
// alteracao. Sem permissao, a chave fica visivel e desabilitada, com a dica.
//
// E4 (20/10/2026): "Agendar consulta" (precisaDaAgenda) so liga com a
// antecedencia e o horizonte preenchidos em Regras e limites (D13). Enquanto
// falta um dos dois, a chave fica desligada e desabilitada com a dica
// DICA_DA_AGENDA_INCOMPLETA, escrita tambem embaixo da descricao (a dica do
// cursor nao e o unico jeito de saber por que). A acao recusa de novo.
//
// Fase de teste (decisao do dono de 20/10/2026): "Agendar consulta" e
// "Confirmar presença" so com telefone da equipe cadastrado pela equipe
// Conduzza (o forcado), porque a consulta marcada transforma o contato em
// paciente e um telefone comum deixa de acionar o assistente. A nota fica
// embaixo da descricao das duas, sempre visivel, para todos os papeis. E
// nota, nao status: so texto, sem chip, sem cor propria.

/** As habilidades que, nesta fase de teste, levam a nota do telefone. */
export const HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA: ReadonlySet<string> =
  new Set(["agendar", "confirmar_presenca"]);

/** Por que a chave nao muda: sem permissao vence; depois, a agenda. */
export function motivoDaChaveTravada(
  habilidade: { precisaDaAgenda: boolean },
  agenda: AgendaDoAgente,
  dicaDePermissao: string | null,
): string | null {
  if (dicaDePermissao) {
    return dicaDePermissao;
  }
  return habilidade.precisaDaAgenda && !agendaCompleta(agenda)
    ? DICA_DA_AGENDA_INCOMPLETA
    : null;
}

export function AbaHabilidades({
  habilidades,
  agenda,
  podeEditar,
  dica,
  pendente,
  ocupado,
  aoAlternar,
}: {
  habilidades: Record<string, boolean>;
  /** Os limites para marcar consulta do rascunho (Regras e limites). */
  agenda: AgendaDoAgente;
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
  const efetivas = habilidadesComAgenda(habilidades, agenda);
  const semAgenda = !agendaCompleta(agenda);
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
            const idDaAgenda = `${idRotulo}-agenda`;
            const faltaAgenda = habilidade.precisaDaAgenda && semAgenda;
            const motivo = motivoDaChaveTravada(habilidade, agenda, dica);
            const chave = (
              <Switch
                checked={ligada}
                aria-labelledby={idRotulo}
                aria-describedby={faltaAgenda ? idDaAgenda : undefined}
                aria-busy={ocupado(habilidade.chave) || undefined}
                disabled={!podeEditar || pendente || faltaAgenda}
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
                  {HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA.has(
                    habilidade.chave,
                  ) ? (
                    <span
                      id={`${idRotulo}-fase-de-teste`}
                      className="text-xs text-text-secondary"
                    >
                      {T.habilidadeNaFaseDeTeste}
                    </span>
                  ) : null}
                  {faltaAgenda ? (
                    <span
                      id={idDaAgenda}
                      className="text-xs font-semibold text-text-secondary"
                    >
                      {DICA_DA_AGENDA_INCOMPLETA}
                    </span>
                  ) : null}
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
                  {motivo ? (
                    <DisabledWithHint hint={motivo}>{chave}</DisabledWithHint>
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
