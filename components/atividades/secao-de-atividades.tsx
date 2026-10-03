"use client";

import { ListChecks, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DialogoDeAtividade } from "@/components/atividades/dialogo-de-atividade";
import {
  LinhaDeAtividade,
  type AcoesDaLinha,
  type ContextoDaLinha,
} from "@/components/atividades/linha-de-atividade";
import { useAcoesDeAtividade } from "@/components/atividades/use-acoes-de-atividade";
import { useAgora } from "@/components/atividades/use-agora";
import { useEquipeDaAtividade } from "@/components/atividades/use-equipe-da-atividade";
import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { compararPorPrazo, hojeNaClinica } from "@/lib/domain/atividades";
import type {
  AtividadeResumo,
  AtividadesDoContato,
  ContatoDaAtividade,
  EquipeDaAtividade,
} from "@/lib/queries/atividades";

// As atividades de UM contato, no drawer do lead, no painel da conversa
// (cumpre o "criar lembrete" da spec 1.9) e na ficha. Quem usa entrega o dado
// ja lido com trilha (abrirDetalheDoContatoAction, atividadesDoContatoAction
// ou a ficha no servidor) e o jeito de recarregar; esta secao desenha os
// estados (carregando, erro com "Tentar de novo", vazio), as pendentes mais
// proximas, "Nova atividade" (visivel e desabilitado com dica para quem so
// le) e "Ver todas", que abre a tela Atividades so com este contato.

export type EstadoDasAtividades = "carregando" | "erro" | "pronto";

export function SecaoDeAtividades({
  contato,
  conversationId = null,
  clinicId,
  timezone,
  estado,
  atividades,
  aoTentarDeNovo,
  aoMudar,
  equipe: equipeDada,
  nomes,
  podeEditar,
  dica,
  limite = 3,
  mostrarConcluidas = false,
  comAtalhos = { conversa: true, ficha: true },
  agoraInicial,
}: {
  contato: ContatoDaAtividade;
  /** Conversa de onde se cria (painel do Atendimento) */
  conversationId?: string | null;
  clinicId?: string;
  timezone: string;
  estado: EstadoDasAtividades;
  atividades: AtividadesDoContato | null;
  aoTentarDeNovo: () => void;
  /** Recarrega a fonte depois de criar, editar, concluir, adiar ou cancelar */
  aoMudar: () => void;
  /** A equipe ja lida; sem ela o dialogo busca ao abrir */
  equipe?: EquipeDaAtividade;
  /** Nomes da equipe para o responsavel (inclusive quem saiu) */
  nomes: Record<string, string>;
  podeEditar: boolean;
  dica: string;
  /** Quantas pendentes aparecem antes do "Ver todas" */
  limite?: number;
  /** A ficha mostra tambem as ultimas concluidas */
  mostrarConcluidas?: boolean;
  comAtalhos?: { conversa: boolean; ficha: boolean };
  /** Instante do servidor, quando a secao e renderizada la (ficha) */
  agoraInicial?: string;
}) {
  const agora = useAgora(agoraInicial);
  // Sem equipe dada (drawer do lead), busca uma vez por clinica (fica em
  // cache): da o "Você", o "sem acesso" e o dialogo abre sem esperar.
  const equipeQuery = useEquipeDaAtividade(
    clinicId ?? "",
    equipeDada === undefined,
  );
  const equipe = equipeDada ?? equipeQuery.data;
  const hoje = hojeNaClinica(timezone, agora);
  const [dialogo, setDialogo] = useState<
    { modo: "criar" } | { modo: "editar"; atividade: AtividadeResumo } | null
  >(null);

  const todas = useMemo(
    () =>
      atividades ? [...atividades.pendentes, ...atividades.concluidas] : [],
    [atividades],
  );
  const acoes = useAcoesDeAtividade({ lista: todas, aoMudar });
  // Depois da sobrescrita local: a concluida agora sai das pendentes na hora
  // e a reaberta volta para o lugar dela no prazo.
  const pendentes = acoes.lista
    .filter((a) => a.status === "pendente")
    .sort(compararPorPrazo);
  const concluidas = acoes.lista.filter((a) => a.status === "concluida");
  const visiveis = pendentes.slice(0, limite);
  const restantes = pendentes.length - visiveis.length;

  const contexto: ContextoDaLinha = {
    agora,
    hoje,
    timezone,
    nomes: equipe?.nomes ?? nomes,
    ativos: equipe?.ativos ?? null,
    eu: equipe?.eu ?? null,
    podeEditar,
    dica,
  };
  const acoesDaLinha: AcoesDaLinha = {
    concluir: acoes.concluir,
    reabrir: acoes.reabrir,
    cancelar: acoes.cancelar,
    adiar: acoes.adiar,
    editar: (atividade) => setDialogo({ modo: "editar", atividade }),
  };

  const novaAtividade = (
    <>
      <Plus aria-hidden />
      Nova atividade
    </>
  );

  return (
    <div className="grid gap-2.5">
      {estado === "carregando" ? (
        <div role="status">
          <span className="sr-only">Carregando as atividades</span>
          <ListSkeleton rows={2} />
        </div>
      ) : estado === "erro" || !atividades ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-[13px] text-text-secondary">
            Não foi possível carregar as atividades.
          </p>
          <Button variant="outline" size="sm" onClick={aoTentarDeNovo}>
            <RotateCcw aria-hidden />
            Tentar de novo
          </Button>
        </div>
      ) : (
        <>
          {visiveis.length > 0 ? (
            <ul className="grid" aria-label="Atividades pendentes">
              {visiveis.map((atividade) => (
                <LinhaDeAtividade
                  key={atividade.id}
                  atividade={atividade}
                  forma="compacta"
                  ocupada={acoes.ocupadas.has(atividade.id)}
                  acoes={acoesDaLinha}
                  contexto={contexto}
                  comAtalhos={comAtalhos}
                />
              ))}
            </ul>
          ) : (
            <p className="flex items-start gap-2 text-[13px] text-text-secondary">
              <ListChecks aria-hidden className="mt-px size-4 shrink-0" />
              Nenhuma atividade pendente para este contato.
            </p>
          )}
          {restantes > 0 ? (
            <p className="text-xs text-text-secondary">
              E mais <span className="cz-num">{restantes}</span>{" "}
              {restantes === 1 ? "pendente" : "pendentes"} em Ver todas.
            </p>
          ) : null}
          {mostrarConcluidas && concluidas.length > 0 ? (
            <div className="grid gap-1 pt-1">
              <h3 className="cz-eyebrow text-text-secondary">
                Concluídas recentemente
              </h3>
              <ul className="grid" aria-label="Atividades concluídas">
                {concluidas.map((atividade) => (
                  <LinhaDeAtividade
                    key={atividade.id}
                    atividade={atividade}
                    forma="compacta"
                    ocupada={acoes.ocupadas.has(atividade.id)}
                    acoes={acoesDaLinha}
                    contexto={contexto}
                    comAtalhos={comAtalhos}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {podeEditar && estado === "pronto" ? (
          <Button
            variant="outline"
            onClick={() => setDialogo({ modo: "criar" })}
          >
            {novaAtividade}
          </Button>
        ) : (
          <DisabledWithHint
            hint={
              !podeEditar
                ? dica
                : estado === "carregando"
                  ? "Espere as atividades deste contato carregarem."
                  : "Carregue as atividades de novo antes de criar outra."
            }
          >
            <Button variant="outline" disabled>
              {novaAtividade}
            </Button>
          </DisabledWithHint>
        )}
        <Button variant="ghost" asChild>
          <Link
            href={`/atividades?quem=todas&contato=${contato.id}`}
            prefetch={false}
          >
            Ver todas
          </Link>
        </Button>
      </div>

      <DialogoDeAtividade
        aberto={dialogo !== null}
        aoFechar={() => setDialogo(null)}
        aoSalvar={() => aoMudar()}
        clinicId={clinicId}
        timezone={timezone}
        atividade={dialogo?.modo === "editar" ? dialogo.atividade : null}
        contato={contato}
        conversationId={conversationId}
        equipe={equipe}
      />
    </div>
  );
}
