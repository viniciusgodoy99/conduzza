"use client";

import { CircleCheck, History, PencilLine, RotateCcw } from "lucide-react";
import { useState } from "react";

import {
  dataEHoraNaClinica,
  textoDasAlteracoes,
  TEXTOS_DO_AGENTE as T,
} from "@/components/agente/textos";
import type { VersaoDoAgente } from "@/components/agente/tipos";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StatusDefinition } from "@/lib/design/status";
import type { Mudanca } from "@/lib/domain/agente/config";

// Aba Versoes da Tela 6: o historico das versoes publicadas, da mais nova
// para a mais antiga, com a data no fuso da clinica (regra 3.6), quem
// publicou e o que mudou (calculado pela diferenca com a versao anterior:
// nao ha coluna de resumo). No topo, o rascunho com as alteracoes que ainda
// nao foram publicadas. "Restaurar" pede confirmacao: o rascunho passa a ter
// a configuracao, as instrucoes da equipe Conduzza e as perguntas daquela
// versao (as que nao estao nela ficam desativadas, nunca apagadas), e nada
// muda para o paciente ate publicar.
//
// O "o que mudou" de cada versao vem pronto da pagina, com a linha
// "Instruções da equipe Conduzza" decidida no servidor (sem o texto).

/**
 * A ultima versao publicada: 3 camadas (icone, rotulo e cor). "Última
 * publicada" e nao "Em uso": nesta leva nada usa a versao publicada. Nenhuma
 * conversa de verdade roda o assistente ainda, e o simulador usa SEMPRE o
 * rascunho (achado 30).
 */
export const VERSAO_EM_USO: StatusDefinition = {
  label: "Última publicada",
  tone: "success",
  icon: CircleCheck,
};

/** O rascunho com alteracoes: neutro, com o lapis de "em edicao". */
export const VERSAO_RASCUNHO: StatusDefinition = {
  label: "Rascunho",
  tone: "neutral",
  icon: PencilLine,
};

function ListaDeMudancas({ mudancas }: { mudancas: readonly Mudanca[] }) {
  if (mudancas.length === 0) {
    return (
      <p className="text-[12.5px] text-text-secondary">
        Sem mudança em relação à versão anterior.
      </p>
    );
  }
  return (
    <ul className="grid list-disc gap-0.5 pl-4 text-[12.5px] text-text-secondary">
      {mudancas.map((mudanca, indice) => (
        <li key={`${mudanca.campo}-${indice}`} className="break-words">
          {mudanca.rotulo}
        </li>
      ))}
    </ul>
  );
}

export function AbaVersoes({
  versoes,
  mudancasDoRascunho,
  timezone,
  podeEditar,
  dica,
  pendente,
  ocupado,
  aoRestaurar,
}: {
  /** Nulo: a leitura falhou. */
  versoes: VersaoDoAgente[] | null;
  /** O que o rascunho muda em relacao a ultima publicada. */
  mudancasDoRascunho: readonly Mudanca[];
  timezone: string;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  ocupado: (qual: string) => boolean;
  aoRestaurar: (versao: number, retorno: { seDerCerto: () => void }) => void;
}) {
  const [restaurando, setRestaurando] = useState<VersaoDoAgente | null>(null);

  if (versoes === null) {
    return (
      <Card>
        <EmptyState
          tom="erro"
          title={T.versoesErro}
          description={T.erroAoCarregarDescricao}
        />
      </Card>
    );
  }

  const comDica = (controle: React.ReactNode) =>
    dica ? (
      <DisabledWithHint hint={dica}>{controle}</DisabledWithHint>
    ) : (
      controle
    );

  return (
    <Card role="region" aria-labelledby="agente-versoes-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-versoes-titulo">{T.versoesTitulo}</CardTitle>
          <CardDescription>{T.versoesDescricao}</CardDescription>
        </div>
      </CardHeader>

      <ul className="divide-y divide-border border-t border-border">
        {mudancasDoRascunho.length > 0 ? (
          <li className="grid gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-bold text-text-strong">
                Próxima versão
              </span>
              <StatusChip size="sm" definition={VERSAO_RASCUNHO} />
              <span className="text-xs text-text-secondary">
                {textoDasAlteracoes(mudancasDoRascunho.length)}
              </span>
            </div>
            <ListaDeMudancas mudancas={mudancasDoRascunho} />
          </li>
        ) : null}

        {versoes.map((versao) => {
          const qual = `restaurar-${versao.versao}`;
          const botao = (
            <Button
              variant="outline"
              disabled={!podeEditar || pendente}
              aria-busy={ocupado(qual) || undefined}
              aria-label={`${T.restaurar} a versão ${versao.versao}`}
              onClick={() => setRestaurando(versao)}
            >
              <RotateCcw className="size-4" aria-hidden />
              {T.restaurar}
            </Button>
          );
          return (
            <li
              key={versao.versao}
              className="flex flex-wrap items-start gap-3 px-4 py-3"
            >
              <div className="grid min-w-0 flex-1 gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-bold text-text-strong">
                    Versão <span className="cz-num">{versao.versao}</span>
                  </span>
                  {versao.emUso ? (
                    <StatusChip size="sm" definition={VERSAO_EM_USO} />
                  ) : null}
                </div>
                <p className="text-xs text-text-secondary">
                  Publicada em{" "}
                  <span className="cz-num">
                    {dataEHoraNaClinica(versao.publicadaEm, timezone)}
                  </span>{" "}
                  por {versao.autor ?? T.autorDesconhecido}
                </p>
                <ListaDeMudancas mudancas={versao.mudancas} />
              </div>
              <div className="ml-auto">{comDica(botao)}</div>
            </li>
          );
        })}
      </ul>

      {versoes.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title={T.versoesVazio}
          description={T.versoesVazioDescricao}
        />
      ) : null}

      <Dialog
        open={restaurando !== null}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setRestaurando(null) : null
        }
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              Restaurar a versão {restaurando?.versao ?? ""}?
            </DialogTitle>
            <DialogDescription>{T.restaurarDescricao}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setRestaurando(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="solid"
              disabled={pendente}
              aria-busy={
                (restaurando !== null &&
                  ocupado(`restaurar-${restaurando.versao}`)) ||
                undefined
              }
              onClick={() => {
                if (restaurando) {
                  aoRestaurar(restaurando.versao, {
                    seDerCerto: () => setRestaurando(null),
                  });
                }
              }}
            >
              <RotateCcw className="size-4" aria-hidden />
              {restaurando !== null &&
              ocupado(`restaurar-${restaurando.versao}`)
                ? "Restaurando..."
                : "Restaurar no rascunho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
