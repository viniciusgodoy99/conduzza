"use client";

import {
  CalendarClock,
  Coins,
  Plus,
  SendHorizonal,
  Trash2,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  criarPassoAction,
  excluirPassoAction,
  salvarEsperaDoPassoAction,
  testarEnvioAction,
} from "@/app/(app)/automacoes/actions";
import { DialogPasso } from "@/components/automacoes/dialog-passo";
import { EditorDePasso } from "@/components/automacoes/editor-de-passo";
import { LinhaDoTempo } from "@/components/automacoes/linha-do-tempo";
import { MetricasDaRegua } from "@/components/automacoes/metricas-da-regua";
import { ControlesDaRegua } from "@/components/confirmacoes/controles-da-regua";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  estimarRegua,
  type BaseDaEstimativa,
} from "@/lib/domain/estimativa-regua";
import {
  rotuloDoPasso,
  type TipoDeReguaDoRotulo,
} from "@/lib/domain/textos-padrao";
import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";

// Uma aba de regua da Tela 7 (confirmacao ou pos falta, e as excecoes da
// fase seguinte): ativacao (o MESMO bloco da Tela 2), a linha do tempo com
// um editor por passo e a estimativa honesta de volume.

export function AbaRegua({
  clinicId,
  regua,
  copy,
  nomeDaClinica,
  botoesDaPreview,
  estimativa,
  sentidoDoPasso,
  tipoDaRegua,
  eventoRotulo,
  placeholders,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  clinicId: string;
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
  /** confirmacao conta ANTES da consulta; pos falta conta DEPOIS do evento. */
  sentidoDoPasso: "antes" | "depois";
  /** Qual regua e: decide os rotulos padrao dos pontos da linha do tempo. */
  tipoDaRegua: TipoDeReguaDoRotulo;
  /** "a consulta" | "a falta", para os dialogos. */
  eventoRotulo: string;
  /** Campos {{...}} que fazem sentido nesta regua; ausente = todos. */
  placeholders?: readonly string[];
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [passoAberto, setPassoAberto] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<"criar" | "momento" | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

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
  const reguaAtual = regua;

  const criarPasso = (offsetMinutes: number, texto: string) => {
    iniciarTransicao(async () => {
      const resultado = await criarPassoAction({
        cadence_id: reguaAtual.id,
        offset_minutes: offsetMinutes,
        fixed_body: texto,
      });
      if (resultado.ok) {
        toast.success("Mensagem criada.");
        setDialogo(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível criar a mensagem.");
    });
  };

  const mudarMomento = (offsetMinutes: number) => {
    if (!passoSelecionado) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await salvarEsperaDoPassoAction({
        cadence_step_id: passoSelecionado.id,
        offset_minutes: offsetMinutes,
      });
      if (resultado.ok) {
        toast.success("Momento da mensagem salvo.");
        setDialogo(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível mudar o momento.");
    });
  };

  const testarEnvio = () => {
    if (!passoSelecionado) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await testarEnvioAction({
        cadence_step_id: passoSelecionado.id,
      });
      if (resultado.ok) {
        toast.success(
          resultado.aviso ??
            "Teste enviado para o WhatsApp da clínica. Confira lá.",
        );
        return;
      }
      toast.error(resultado.error ?? "Não foi possível enviar o teste.");
    });
  };

  const excluirPasso = () => {
    if (!passoSelecionado) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await excluirPassoAction({
        cadence_step_id: passoSelecionado.id,
      });
      if (resultado.ok) {
        toast.success("Mensagem excluída.");
        setPassoAberto(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  const resultado = estimarRegua({
    ...estimativa,
    // Passo com CONTEUDO: texto ou anexo (pode ser so o audio).
    passos: regua.passos.filter((passo) => passo.fixed_body || passo.media_path)
      .length,
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <LinhaDoTempo
              inicioRotulo={copy.inicioDaLinha}
              fimRotulo={copy.fimDaLinha}
              pontos={regua.passos.map((passo) => ({
                id: passo.id,
                rotulo: rotuloDoPasso(passo.offset_minutes, tipoDaRegua),
                temTexto: Boolean(passo.fixed_body || passo.media_path),
              }))}
              selecionadoId={passoSelecionado?.id ?? null}
              onSelecionar={setPassoAberto}
            />
          </div>
          {podeEditar ? (
            <Button
              variant="outline"
              className="h-10"
              disabled={pendente}
              onClick={() => setDialogo("criar")}
            >
              <Plus className="size-4" />
              Adicionar mensagem
            </Button>
          ) : (
            <DisabledWithHint hint={dicaSemPermissao}>
              <Button variant="outline" className="h-10" disabled>
                <Plus className="size-4" />
                Adicionar mensagem
              </Button>
            </DisabledWithHint>
          )}
        </div>
        {passoSelecionado ? (
          <>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {podeEditar ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    disabled={pendente}
                    onClick={() => setDialogo("momento")}
                  >
                    <CalendarClock className="size-4" />
                    Mudar o momento
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    disabled={
                      pendente ||
                      (!passoSelecionado.fixed_body &&
                        !passoSelecionado.media_path)
                    }
                    onClick={testarEnvio}
                  >
                    <SendHorizonal className="size-4" />
                    {pendente ? "Enviando..." : "Testar no WhatsApp da clínica"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 [color:var(--alert-text)]"
                    disabled={pendente || regua.passos.length <= 1}
                    onClick={excluirPasso}
                  >
                    <Trash2 className="size-4" />
                    Excluir mensagem
                  </Button>
                  {regua.passos.length <= 1 ? (
                    <span className="self-center text-xs text-text-tertiary">
                      A última mensagem não se exclui; desligue a régua para
                      pausar.
                    </span>
                  ) : null}
                </>
              ) : (
                <DisabledWithHint hint={dicaSemPermissao}>
                  <span className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" className="h-9" disabled>
                      <CalendarClock className="size-4" />
                      Mudar o momento
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9" disabled>
                      <SendHorizonal className="size-4" />
                      Testar no WhatsApp da clínica
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9" disabled>
                      <Trash2 className="size-4" />
                      Excluir mensagem
                    </Button>
                  </span>
                </DisabledWithHint>
              )}
            </div>
            <EditorDePasso
              key={passoSelecionado.id}
              passo={passoSelecionado}
              rotulo={rotuloDoPasso(
                passoSelecionado.offset_minutes,
                tipoDaRegua,
              )}
              nomeDaClinica={nomeDaClinica}
              botoes={botoesDaPreview}
              placeholders={placeholders}
              podeEditar={podeEditar}
              dicaSemPermissao={dicaSemPermissao}
              aoMudar={aoMudar}
            />
          </>
        ) : (
          <p className="text-sm text-text-secondary">
            Esta régua ainda não tem mensagens. Toque em Adicionar mensagem para
            criar a primeira.
          </p>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <MetricasDaRegua clinicId={clinicId} cadenceId={regua.id} />
      </section>

      <section className="flex gap-3 rounded-lg border bg-card p-4">
        <Coins className="size-5 shrink-0 text-text-secondary" aria-hidden />
        <div className="grid gap-1 text-sm">
          <p>{resultado.frase}</p>
          <p className="text-text-secondary">{resultado.fraseDeCusto}</p>
        </div>
      </section>
      <DialogPasso
        aberto={dialogo === "criar"}
        onFechar={() => setDialogo(null)}
        titulo="Nova mensagem da régua"
        sentido={sentidoDoPasso}
        eventoRotulo={eventoRotulo}
        offsetInicialMin={null}
        pedirTexto
        pendente={pendente}
        aoConfirmar={criarPasso}
      />
      <DialogPasso
        aberto={dialogo === "momento"}
        onFechar={() => setDialogo(null)}
        titulo="Mudar o momento da mensagem"
        sentido={sentidoDoPasso}
        eventoRotulo={eventoRotulo}
        offsetInicialMin={passoSelecionado?.offset_minutes ?? null}
        pedirTexto={false}
        pendente={pendente}
        aoConfirmar={(offset) => mudarMomento(offset)}
      />
    </div>
  );
}
