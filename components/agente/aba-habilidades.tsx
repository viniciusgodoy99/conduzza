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
  dicaDaHabilidade,
  HABILIDADES_DO_AGENTE,
  habilidadesComAgenda,
  type AgendaDoAgente,
  type HabilidadesDoAgente,
  type PrazosDoAgente,
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
// Fase de teste (decisao do dono de 20/10/2026, revista na onda 2, item
// 10): a consulta da IA so transforma o contato em paciente quando a equipe
// aprova (a conversao na aprovacao). "Agendar consulta" passa a funcionar
// com telefone comum; "Confirmar presença" (consulta ja aprovada, contato ja
// paciente) continua so com telefone da equipe cadastrado pela equipe
// Conduzza (o forcado). A nota fica embaixo da descricao dela, sempre
// visivel, para todos os papeis. E nota, nao status: so texto, sem chip,
// sem cor propria.
//
// AG4 (27/10/2026; decisoes D-9, D-10, D-24 e D-26, as tres ultimas pela
// recomendacao, pendentes do dono): "Cancelar consulta" e "Remarcar
// consulta", desligadas por padrao. Cancelar so liga com o prazo para
// cancelar preenchido em Regras e limites; Remarcar, com "Agendar consulta"
// valendo e o prazo para remarcar (a dica de cada uma vem da configuracao,
// dicaDaHabilidade, e vale como a da agenda: escrita embaixo da descricao e
// no cursor). As duas levam a nota da fase de teste: quem tem consulta ja e
// paciente, e o telefone comum de paciente nao aciona o assistente.

/** As habilidades que, nesta fase de teste, levam a nota do telefone. */
export const HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA: ReadonlySet<string> =
  new Set(["cancelar", "remarcar", "confirmar_presenca"]);

/**
 * Por que a chave nao muda: sem permissao vence; depois, o que falta para a
 * habilidade valer (a agenda, o prazo ou, na remarcacao, "Agendar consulta").
 */
export function motivoDaChaveTravada(
  chave: string,
  contexto: {
    habilidades: unknown;
    agenda: AgendaDoAgente;
    prazos: PrazosDoAgente;
  },
  dicaDePermissao: string | null,
): string | null {
  if (dicaDePermissao) {
    return dicaDePermissao;
  }
  return dicaDaHabilidade(chave, contexto);
}

export function AbaHabilidades({
  habilidades,
  agenda,
  prazos,
  podeEditar,
  dica,
  pendente,
  ocupado,
  aoAlternar,
}: {
  habilidades: Record<string, boolean>;
  /** Os limites para marcar consulta do rascunho (Regras e limites). */
  agenda: AgendaDoAgente;
  /** AG4: os prazos para cancelar e remarcar do rascunho (Regras e limites). */
  prazos: PrazosDoAgente;
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
  const efetivas = habilidadesComAgenda(habilidades, agenda, prazos);
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
            // O id da dica de dependencia ("-agenda" desde o E4; vale tambem
            // para o prazo e para a outra habilidade, AG4).
            const idDaAgenda = `${idRotulo}-agenda`;
            const contexto = { habilidades, agenda, prazos };
            const falta = dicaDaHabilidade(habilidade.chave, contexto);
            const motivo = motivoDaChaveTravada(
              habilidade.chave,
              contexto,
              dica,
            );
            const chave = (
              <Switch
                checked={ligada}
                aria-labelledby={idRotulo}
                aria-describedby={falta ? idDaAgenda : undefined}
                aria-busy={ocupado(habilidade.chave) || undefined}
                disabled={!podeEditar || pendente || falta !== null}
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
                  {falta ? (
                    <span
                      id={idDaAgenda}
                      className="text-xs font-semibold text-text-secondary"
                    >
                      {falta}
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
