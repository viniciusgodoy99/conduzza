"use client";

import { Coins } from "lucide-react";
import { useMemo, useState } from "react";

import { EditorDePasso } from "@/components/automacoes/editor-de-passo";
import { LinhaDoTempo } from "@/components/automacoes/linha-do-tempo";
import { ControlesDaRegua } from "@/components/confirmacoes/controles-da-regua";
import {
  estimarRegua,
  type BaseDaEstimativa,
} from "@/lib/domain/estimativa-regua";
import { rotuloDoPasso } from "@/lib/domain/textos-padrao";
import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";

// Uma aba de regua da Tela 7 (confirmacao ou pos falta, e as excecoes da
// fase seguinte): ativacao (o MESMO bloco da Tela 2), a linha do tempo com
// um editor por passo e a estimativa honesta de volume.

export function AbaRegua({
  regua,
  copy,
  nomeDaClinica,
  botoesDaPreview,
  estimativa,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  regua: ReguaDeConfirmacao | null;
  copy: {
    ligar: string;
    ligada: string;
    desligada: string;
    inicioDaLinha: string;
    fimDaLinha: string | null;
    vazio: string;
  };
  nomeDaClinica: string;
  botoesDaPreview?: string[];
  estimativa: Omit<BaseDaEstimativa, "passos">;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [passoAberto, setPassoAberto] = useState<string | null>(null);

  const passoSelecionado = useMemo(() => {
    if (!regua || regua.passos.length === 0) {
      return null;
    }
    return (
      regua.passos.find((passo) => passo.id === passoAberto) ??
      regua.passos[0] ??
      null
    );
  }, [regua, passoAberto]);

  if (!regua) {
    return <p className="text-sm text-text-secondary">{copy.vazio}</p>;
  }

  const resultado = estimarRegua({
    ...estimativa,
    passos: regua.passos.filter((passo) => passo.fixed_body).length,
  });

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 rounded-lg border bg-card p-4">
        <ControlesDaRegua
          regua={regua}
          rotuloLigar={copy.ligar}
          rotuloLigada={copy.ligada}
          rotuloDesligada={copy.desligada}
          visivel
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          aoMudar={aoMudar}
        />
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-4">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">As mensagens da régua</h3>
          <p className="text-xs text-text-secondary">
            Toque num ponto da linha para editar a mensagem daquele momento.
          </p>
        </div>
        <LinhaDoTempo
          inicioRotulo={copy.inicioDaLinha}
          fimRotulo={copy.fimDaLinha}
          pontos={regua.passos.map((passo) => ({
            id: passo.id,
            rotulo: rotuloDoPasso(passo.offset_minutes),
            temTexto: Boolean(passo.fixed_body),
          }))}
          selecionadoId={passoSelecionado?.id ?? null}
          onSelecionar={setPassoAberto}
        />
        {passoSelecionado ? (
          <EditorDePasso
            key={passoSelecionado.id}
            passo={passoSelecionado}
            rotulo={rotuloDoPasso(passoSelecionado.offset_minutes)}
            nomeDaClinica={nomeDaClinica}
            botoes={botoesDaPreview}
            podeEditar={podeEditar}
            dicaSemPermissao={dicaSemPermissao}
          />
        ) : (
          <p className="text-sm text-text-secondary">
            Esta régua ainda não tem mensagens.
          </p>
        )}
      </section>

      <section className="flex gap-3 rounded-lg border bg-card p-4">
        <Coins
          strokeWidth={1.5}
          className="size-5 shrink-0 text-text-secondary"
          aria-hidden
        />
        <div className="grid gap-1 text-sm">
          <p>{resultado.frase}</p>
          <p className="text-text-secondary">{resultado.fraseDeCusto}</p>
        </div>
      </section>
    </div>
  );
}
