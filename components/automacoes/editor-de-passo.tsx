"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  removerAnexoDoPassoAction,
  salvarAnexoDoPassoAction,
  salvarTextoDoPassoAction,
} from "@/app/(app)/automacoes/actions";
import { BalaoWhatsApp } from "@/components/automacoes/balao-whatsapp";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PLACEHOLDERS, renderizarModelo } from "@/lib/domain/modelo-mensagem";
import { CORPO_DO_MENU_APOS_MIDIA } from "@/lib/domain/textos-padrao";
import type { PassoDaReguaDaTela } from "@/lib/queries/confirmacoes";
import { createClient } from "@/lib/supabase/client";

// Editor de um passo da regua: textarea com os campos {{...}} em chips
// clicaveis e a pre-visualizacao ao vivo em balao de WhatsApp, lado a lado.
// E o coracao do aceite da 4.8: trocar o texto da regua sem tocar em codigo.

/** Valores de amostra da pre-visualizacao, explicitamente FICTICIOS. A data
 *  usa o MESMO formato do envio real (dd/MM/yyyy): preview que mostra um
 *  formato que nunca sai engana a clinica. */
export function valoresDeAmostra(nomeDaClinica: string) {
  const amanha = new Date(Date.now() + 24 * 60 * 60_000);
  return {
    nome: "Maria",
    clinica: nomeDaClinica,
    data: format(amanha, "dd/MM/yyyy", { locale: ptBR }),
    hora: "14:00",
    profissional: "Dra. Exemplo",
    procedimento: "Consulta",
    preparo: "",
  } as const;
}

export function EditorDePasso({
  passo,
  rotulo,
  nomeDaClinica,
  botoes,
  placeholders = PLACEHOLDERS,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  passo: PassoDaReguaDaTela;
  rotulo: string;
  nomeDaClinica: string;
  botoes?: string[];
  /** Subconjunto de campos que fazem sentido nesta regua. */
  placeholders?: readonly string[];
  podeEditar: boolean;
  dicaSemPermissao: string;
  /** Invalida o cache das reguas: sem isto o texto salvo sumia da vista. */
  aoMudar: () => Promise<unknown> | void;
}) {
  const [texto, setTexto] = useState(passo.fixed_body ?? "");
  const [pendente, iniciarTransicao] = useTransition();
  const [pendenteAnexo, setPendenteAnexo] = useState(false);
  const [anexoUrl, setAnexoUrl] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const temAnexo = passo.media_path !== null;

  // URL assinada para a preview: a policy do balde deixa o membro ler o
  // anexo do proprio passo, entao o browser assina direto.
  useEffect(() => {
    if (!passo.media_path) {
      setAnexoUrl(null);
      return;
    }
    let cancelado = false;
    const supabase = createClient();
    supabase.storage
      .from("midia-de-regua")
      // 1 hora: e conteudo da CLINICA (nao de paciente) numa sessao de
      // edicao; 5 minutos derrubava o player de audio no meio do trabalho.
      .createSignedUrl(passo.media_path, 3600)
      .then(({ data }) => {
        if (!cancelado) {
          setAnexoUrl(data?.signedUrl ?? null);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [passo.media_path]);

  const anexarArquivo = (arquivo: File) => {
    setPendenteAnexo(true);
    const dados = new FormData();
    dados.set("arquivo", arquivo);
    void salvarAnexoDoPassoAction(passo.id, dados)
      .then(async (resultado) => {
        if (resultado.ok) {
          toast.success("Anexo salvo.");
          await aoMudar();
        } else {
          toast.error(resultado.error ?? "Não foi possível salvar o anexo.");
        }
      })
      .finally(() => setPendenteAnexo(false));
  };

  const removerAnexo = () => {
    setPendenteAnexo(true);
    void removerAnexoDoPassoAction({ cadence_step_id: passo.id })
      .then(async (resultado) => {
        if (resultado.ok) {
          toast.success("Anexo removido.");
          await aoMudar();
        } else {
          toast.error(resultado.error ?? "Não foi possível remover o anexo.");
        }
      })
      .finally(() => setPendenteAnexo(false));
  };

  // Trocar de passo recarrega o rascunho do que esta salvo.
  useEffect(() => {
    setTexto(passo.fixed_body ?? "");
  }, [passo.id, passo.fixed_body]);

  const preview = useMemo(
    () => renderizarModelo(texto, valoresDeAmostra(nomeDaClinica)),
    [texto, nomeDaClinica],
  );
  const audioComTexto =
    temAnexo && passo.media_type === "audio" && preview.trim().length > 0;

  // Campo desconhecido nao explode no envio (renderizarModelo limpa), mas
  // sumir em silencio e pior: avisa enquanto edita.
  const desconhecidos = useMemo(() => {
    const usados = [...texto.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(
      (m) => m[1],
    );
    return [...new Set(usados)].filter(
      (campo) => campo !== undefined && !placeholders.includes(campo),
    );
  }, [texto, placeholders]);

  const inserirCampo = (campo: string) => {
    const area = areaRef.current;
    const marcador = `{{${campo}}}`;
    if (!area) {
      setTexto((atual) => atual + marcador);
      return;
    }
    const inicio = area.selectionStart ?? texto.length;
    const fim = area.selectionEnd ?? texto.length;
    const novo = texto.slice(0, inicio) + marcador + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      area.focus();
      const cursor = inicio + marcador.length;
      area.setSelectionRange(cursor, cursor);
    });
  };

  const salvar = () => {
    iniciarTransicao(async () => {
      const resultado = await salvarTextoDoPassoAction({
        cadence_step_id: passo.id,
        fixed_body: texto,
      });
      if (resultado.ok) {
        toast.success("Texto salvo.");
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível salvar o texto.");
    });
  };

  const mudou = texto !== (passo.fixed_body ?? "");
  const idArea = `passo-texto-${passo.id}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={idArea}>
            Mensagem enviada {rotulo.toLowerCase()}
          </Label>
          <Textarea
            id={idArea}
            ref={areaRef}
            value={texto}
            disabled={!podeEditar || pendente}
            onChange={(e) => setTexto(e.target.value)}
            rows={7}
            maxLength={2000}
            placeholder="Escreva a mensagem que o paciente vai receber."
            className="text-[13px]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-secondary">Inserir campo:</span>
          {placeholders.map((campo) => (
            <button
              key={campo}
              type="button"
              disabled={!podeEditar || pendente}
              onClick={() => inserirCampo(campo)}
              className="h-8 rounded-full border px-2.5 font-mono text-[11.5px] text-text-secondary transition-colors hover:text-foreground disabled:opacity-50"
            >
              {`{{${campo}}}`}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5 rounded-lg border p-3">
          <span className="text-xs font-medium text-text-secondary">
            Anexo (foto, áudio ou arquivo)
          </span>
          {temAnexo ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-[12.5px]">
                <Paperclip
                  strokeWidth={1.5}
                  className="size-4 shrink-0 text-text-secondary"
                  aria-hidden
                />
                {passo.media_type === "image"
                  ? "Foto anexada"
                  : passo.media_type === "audio"
                    ? "Áudio anexado"
                    : (passo.media_filename ?? "Arquivo anexado")}
              </span>
              {podeEditar ? (
                <Button
                  variant="ghost"
                  className="h-10"
                  disabled={pendenteAnexo}
                  onClick={removerAnexo}
                >
                  <X strokeWidth={1.5} className="size-4" aria-hidden />
                  Remover
                </Button>
              ) : null}
              {audioComTexto ? (
                // O WhatsApp nao mostra legenda em audio: o envio manda o
                // texto numa segunda mensagem, e a tela diz isso.
                <span className="basis-full text-[11.5px] text-text-tertiary">
                  Com áudio, o texto vai numa mensagem separada, logo depois.
                </span>
              ) : null}
            </div>
          ) : podeEditar ? (
            <>
              <input
                ref={arquivoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,audio/ogg,audio/webm,application/pdf"
                className="sr-only"
                onChange={(evento) => {
                  const arquivo = evento.target.files?.[0];
                  evento.target.value = "";
                  if (arquivo) {
                    anexarArquivo(arquivo);
                  }
                }}
              />
              <Button
                variant="outline"
                className="h-10 justify-self-start"
                disabled={pendenteAnexo}
                onClick={() => arquivoRef.current?.click()}
              >
                <Paperclip strokeWidth={1.5} className="size-4" aria-hidden />
                {pendenteAnexo ? "Enviando..." : "Anexar arquivo"}
              </Button>
              <span className="text-[11.5px] text-text-tertiary">
                Até 3,8 MB. Com anexo, o texto é opcional. Na foto e no
                arquivo, ele vira a legenda; com áudio, vai numa mensagem
                separada, logo depois.
              </span>
            </>
          ) : (
            <DisabledWithHint hint={dicaSemPermissao}>
              <Button variant="outline" className="h-10" disabled>
                <Paperclip strokeWidth={1.5} className="size-4" aria-hidden />
                Anexar arquivo
              </Button>
            </DisabledWithHint>
          )}
        </div>
        {desconhecidos.length > 0 ? (
          <p className="text-xs" style={{ color: "var(--warning-text)" }}>
            {desconhecidos.length === 1 ? "O campo" : "Os campos"}{" "}
            {desconhecidos.map((c) => `{{${c}}}`).join(", ")}{" "}
            {desconhecidos.length === 1 ? "não existe" : "não existem"} e
            {desconhecidos.length === 1 ? " sai" : " saem"} em branco no envio.
            Use os campos da lista acima.
          </p>
        ) : null}
        {podeEditar ? (
          <Button
            className="h-10 justify-self-start"
            disabled={
              pendente ||
              !mudou ||
              (texto.trim().length === 0 && !temAnexo)
            }
            onClick={salvar}
          >
            {pendente ? "Salvando..." : "Salvar texto"}
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button className="h-10 justify-self-start" disabled>
              Salvar texto
            </Button>
          </DisabledWithHint>
        )}
      </div>
      <div className="grid content-start gap-1.5">
        <span className="text-sm font-medium">Como o paciente vê</span>
        {temAnexo &&
        passo.media_type &&
        botoes &&
        botoes.length > 0 &&
        !audioComTexto ? (
          // Com anexo, a confirmacao vira DUAS mensagens de verdade (a midia
          // e depois os botoes): a preview mostra o PAR, senao mentiria. Com
          // audio e texto, o proprio balao mostra o par (audio sozinho, depois
          // o texto com os botoes), igual ao envio real.
          <div className="grid gap-2">
            <BalaoWhatsApp
              corpo={preview}
              anexo={{
                tipo: passo.media_type,
                url: anexoUrl,
                nome: passo.media_filename,
              }}
            />
            <BalaoWhatsApp corpo={CORPO_DO_MENU_APOS_MIDIA} botoes={botoes} />
          </div>
        ) : (
          <BalaoWhatsApp
            corpo={preview}
            botoes={botoes}
            anexo={
              temAnexo && passo.media_type
                ? {
                    tipo: passo.media_type,
                    url: anexoUrl,
                    nome: passo.media_filename,
                  }
                : null
            }
          />
        )}
        <p className="text-[11.5px] text-text-tertiary">
          Amostra com dados fictícios. No envio real, os campos são
          preenchidos com os dados da consulta e do paciente.
        </p>
      </div>
    </div>
  );
}
