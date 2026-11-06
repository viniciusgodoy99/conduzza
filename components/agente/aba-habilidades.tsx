"use client";

import { ChaveTravada } from "@/components/agente/chave-travada";
import {
  // [AG6b mídia] início
  dicaDaMidiaNoServidor,
  // [AG6b mídia] fim
  // [AG7 preparo] início
  HABILIDADE_ENVIAR_PREPARO,
  notaDoPreparoSemTextoAprovado,
  // [AG7 preparo] fim
  TEXTOS_DO_AGENTE as T,
} from "@/components/agente/textos";
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
  // [AG6b mídia] início
  notaDaHabilidade,
  type MidiaNoServidor,
  // [AG6b mídia] fim
  type AgendaDoAgente,
  type HabilidadesDoAgente,
  type PrazosDoAgente,
} from "@/lib/domain/agente/config";
// [AG7 preparo] início
import type { PreparoDaHabilidade } from "@/lib/domain/preparo";
// [AG7 preparo] fim

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
// Decisao do dono de 06/11/2026: com os dois preenchidos, ela ja aparece
// ligada (a chave ausente vale ligada), e so quem desligou fica desligado.
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
//
// AG5 (27/10/2026; decisoes D-36, D-39 e D-45 pela recomendacao, pendentes
// do dono): "Lista de espera", desligada por padrao, so com "Agendar
// consulta" valendo (titulo, descricao e dica vem da configuracao, como as
// outras). A nota da fase de teste dela e outra: o SIM a oferta marca a
// consulta na hora, e o contato vira paciente ali (sem a aprovacao da
// equipe). Nota, nao status, como as outras.
//
// [AG6b mídia] início
// AG6b (desenho da AG6b, secao 6; D-60 e D-95 pela recomendacao, pendentes
// do dono): "Entender áudio" e "Ler imagem e documento", desligadas por
// padrao, sem dependencia. Titulo, descricao e nota moram na configuracao
// (notaDaHabilidade); a tela so renderiza, com a nota embaixo da descricao,
// para todos os papeis: o audio, a foto e o documento vao para a OpenAI, e
// so com os telefones cadastrados na aba WhatsApp que confirmaram o aviso
// novo (o chip "Sem áudio, foto e documento" da aba WhatsApp diz qual
// falta). Sem permissao (recepcao), a chave fica visivel e desabilitada com
// a dica de sempre.
//
// Revisao das telas da AG6b: com as constantes do servidor desligadas
// (midiaNoServidor, calculado na pagina; ligadas desde 06/11/2026), a
// habilidade de midia ligada nao tem efeito, e a dica (dicaDaMidiaNoServidor)
// fica escrita embaixo dela, para todos os papeis, sem travar a chave:
// desligar continua livre (item 3). A nota, a dica
// do servidor e a da dependencia sao a descricao da chave
// (aria-describedby, na ordem da tela): o leitor de tela ouve a nota da
// OpenAI no foco (item 7).
// [AG6b mídia] fim
//
// [AG7 preparo] início
// AG7 (desenho, secao 5.4; D-80, autorizada pelo dono em 03/11/2026):
// "Enviar orientação de preparo", desligada por padrao, sem dependencia
// (titulo e descricao da configuracao, HABILIDADES_DO_AGENTE). Leva a nota
// da fase de teste (TEXTOS_DO_AGENTE.preparoNaFaseDeTeste), para todos os
// papeis. Quando a pagina conferiu que nenhum procedimento ativo tem
// orientacao aprovada pelo responsavel tecnico em vigor
// (preparoDaHabilidade "sem_texto_aprovado", lido pela sessao para todo
// papel, a recepcao inclusive), ou que as regras de hoje recusam o texto de
// todas ("aprovada_sem_envio", revisao curta: o texto nao sai e Cadastros
// mostra "Aprovada, sem envio"), a dica escrita embaixo dela, como a da
// midia que ainda nao vale: com a chave ligada, o pedido de preparo passa
// para a equipe. A dica nao trava a chave e entra na descricao dela
// (aria-describedby), depois da nota e da dica do servidor. Sem a leitura
// (nulo), sem a dica: a tela nao inventa.
// [AG7 preparo] fim

/** As habilidades que, nesta fase de teste, levam a nota do telefone. */
export const HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA: ReadonlySet<string> =
  new Set(["cancelar", "remarcar", "confirmar_presenca"]);

/** A nota da fase de teste da habilidade, ou nula quando ela nao leva nota. */
export function notaDaFaseDeTeste(chave: string): string | null {
  if (HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA.has(chave)) {
    return T.habilidadeNaFaseDeTeste;
  }
  if (chave === "lista_de_espera") {
    return T.listaDeEsperaNaFaseDeTeste;
  }
  // [AG7 preparo] início
  if (chave === HABILIDADE_ENVIAR_PREPARO) {
    return T.preparoNaFaseDeTeste;
  }
  // [AG7 preparo] fim
  // [AG6b mídia] início
  // A nota que mora na configuracao (as habilidades de midia); nula nas
  // outras.
  return notaDaHabilidade(chave);
  // [AG6b mídia] fim
}

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

// [AG6b mídia] início
/**
 * A descricao da chave (aria-describedby): os ids do que esta escrito
 * embaixo da habilidade, na ordem da tela (a nota, a dica do servidor e a
 * dica da dependencia). Sem nada escrito, sem o atributo (undefined).
 */
export function descricaoDaChave(
  ids: readonly (string | null)[],
): string | undefined {
  const presentes = ids.filter((id): id is string => id !== null);
  return presentes.length > 0 ? presentes.join(" ") : undefined;
}
// [AG6b mídia] fim

export function AbaHabilidades({
  habilidades,
  agenda,
  prazos,
  podeEditar,
  dica,
  pendente,
  ocupado,
  aoAlternar,
  // [AG6b mídia] início
  midiaNoServidor,
  // [AG6b mídia] fim
  // [AG7 preparo] início
  preparoDaHabilidade,
  // [AG7 preparo] fim
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
  // [AG6b mídia] início
  /**
   * O que o servidor ja deixa valer. Ausente: sem a
   * dica (a tela nao inventa).
   */
  midiaNoServidor?: MidiaNoServidor | null;
  // [AG6b mídia] fim
  // [AG7 preparo] início
  /**
   * A orientacao de preparo aprovada na clinica (calculado na pagina, com as
   * regras de hoje conferidas no servidor). "sem_texto_aprovado" ou
   * "aprovada_sem_envio": a dica em "Enviar orientação de preparo". Nulo ou
   * ausente: sem a dica (a tela nao inventa).
   */
  preparoDaHabilidade?: PreparoDaHabilidade | null;
  // [AG7 preparo] fim
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
            const nota = notaDaFaseDeTeste(habilidade.chave);
            // [AG6b mídia] início
            const idDaNota = `${idRotulo}-fase-de-teste`;
            const idDoServidor = `${idRotulo}-no-servidor`;
            const semEfeito = dicaDaMidiaNoServidor(
              habilidade.chave,
              midiaNoServidor,
            );
            // [AG6b mídia] fim
            // [AG7 preparo] início
            const idSemPreparo = `${idRotulo}-sem-preparo`;
            const semPreparo = notaDoPreparoSemTextoAprovado(
              habilidade.chave,
              preparoDaHabilidade,
            );
            // [AG7 preparo] fim
            const chave = (
              <Switch
                checked={ligada}
                aria-labelledby={idRotulo}
                // [AG6b mídia] a nota e a dica do servidor tambem
                aria-describedby={descricaoDaChave([
                  nota ? idDaNota : null,
                  semEfeito ? idDoServidor : null,
                  // [AG7 preparo] início
                  semPreparo ? idSemPreparo : null,
                  // [AG7 preparo] fim
                  falta ? idDaAgenda : null,
                ])}
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
                  {nota ? (
                    <span id={idDaNota} className="text-xs text-text-secondary">
                      {nota}
                    </span>
                  ) : null}
                  {/* [AG6b mídia] início: a habilidade que o servidor ainda
                      nao deixa valer (dica escrita, como a da dependencia;
                      a chave continua livre). */}
                  {semEfeito ? (
                    <span
                      id={idDoServidor}
                      className="text-xs font-semibold text-text-secondary"
                    >
                      {semEfeito}
                    </span>
                  ) : null}
                  {/* [AG6b mídia] fim */}
                  {/* [AG7 preparo] início: nenhum procedimento com
                      orientacao aprovada em vigor que possa sair (dica
                      escrita, como a do servidor; a chave continua livre). */}
                  {semPreparo ? (
                    <span
                      id={idSemPreparo}
                      className="text-xs font-semibold text-text-secondary"
                    >
                      {semPreparo}
                    </span>
                  ) : null}
                  {/* [AG7 preparo] fim */}
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
