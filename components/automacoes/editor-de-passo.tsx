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
import { Aviso } from "@/components/shared/aviso";
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
//
// Desenho do design system (docs/06 secao 5.10, C30): a sintaxe continua a
// do envio ({{campo}}, limite de 2000); do kit entram so a apresentacao
// (contador n/2000, chips de campo) e a previa como bolha RECEBIDA pelo
// paciente. "Salvar texto" e o unico botao lime do editor.

const LIMITE_DO_TEXTO = 2000;

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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={idArea}>
              Mensagem enviada {rotulo.toLowerCase()}
            </Label>
            <span
              className="cz-num text-[11px] text-text-secondary"
              aria-hidden
            >
              {texto.length}/{LIMITE_DO_TEXTO}
            </span>
          </div>
          <Textarea
            id={idArea}
            ref={areaRef}
            value={texto}
            disabled={!podeEditar || pendente}
            onChange={(e) => setTexto(e.target.value)}
            rows={7}
            maxLength={LIMITE_DO_TEXTO}
            placeholder="Escreva a mensagem que o paciente vai receber."
            className="min-h-[168px] text-sm"
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs text-text-secondary">
            Toque num campo para inserir no texto. No envio, ele vira o dado da
            consulta ou do paciente.
          </span>
          <div className="flex flex-wrap gap-x-1.5 gap-y-2.5">
            {placeholders.map((campo) => (
              <button
                key={campo}
                type="button"
                disabled={!podeEditar || pendente}
                onClick={() => inserirCampo(campo)}
                className="hit-40 h-[30px] rounded-sm border border-border-strong bg-card px-2 cz-num text-[11.5px] text-foreground shadow-xs cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-45"
              >
                {`{{${campo}}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 rounded-xl bg-surface-4 p-3.5">
          <span className="text-xs font-semibold text-foreground">
            Anexo (foto, áudio ou arquivo)
          </span>
          {temAnexo ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex min-h-10 items-center gap-2 rounded-lg border border-border-strong bg-card px-3 text-[12.5px] text-foreground">
                <Paperclip
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
                  disabled={pendenteAnexo}
                  onClick={removerAnexo}
                >
                  <X aria-hidden />
                  Remover
                </Button>
              ) : null}
              {audioComTexto ? (
                // O WhatsApp nao mostra legenda em audio: o envio manda o
                // texto numa segunda mensagem, e a tela diz isso.
                <span className="basis-full text-[11.5px] text-text-secondary">
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
                className="justify-self-start"
                disabled={pendenteAnexo}
                onClick={() => arquivoRef.current?.click()}
              >
                <Paperclip aria-hidden />
                {pendenteAnexo ? "Enviando..." : "Anexar arquivo"}
              </Button>
              <span className="text-[11.5px] text-text-secondary">
                Até <span className="cz-num">3,8</span> MB. Com anexo, o texto é
                opcional. Na foto e no arquivo, ele vira a legenda; com áudio,
                vai numa mensagem separada, logo depois.
              </span>
            </>
          ) : (
            <DisabledWithHint hint={dicaSemPermissao}>
              <Button variant="outline" disabled>
                <Paperclip aria-hidden />
                Anexar arquivo
              </Button>
            </DisabledWithHint>
          )}
        </div>
        {desconhecidos.length > 0 ? (
          <Aviso tom="warning">
            {desconhecidos.length === 1 ? "O campo" : "Os campos"}{" "}
            <span className="cz-num">
              {desconhecidos.map((c) => `{{${c}}}`).join(", ")}
            </span>{" "}
            {desconhecidos.length === 1 ? "não existe" : "não existem"} e
            {desconhecidos.length === 1 ? " sai" : " saem"} em branco no envio.
            Use os campos da lista acima.
          </Aviso>
        ) : null}
        {podeEditar ? (
          <Button
            className="justify-self-start"
            disabled={
              pendente || !mudou || (texto.trim().length === 0 && !temAnexo)
            }
            onClick={salvar}
          >
            {pendente ? "Salvando..." : "Salvar texto"}
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button className="justify-self-start" disabled>
              Salvar texto
            </Button>
          </DisabledWithHint>
        )}
      </div>
      <div className="grid content-start gap-2">
        <span className="text-xs font-semibold text-foreground">
          Como o paciente vê
        </span>
        {temAnexo &&
        passo.media_type &&
        botoes &&
        botoes.length > 0 &&
        !audioComTexto ? (
          // Com anexo, a confirmacao vira DUAS mensagens de verdade (a midia
          // e depois os botoes): a preview mostra o PAR, senao mentiria. Com
          // audio e texto, o proprio balao mostra o par (audio sozinho, depois
          // o texto com os botoes), igual ao envio real.
          <BalaoWhatsApp
            corpo={preview}
            anexo={{
              tipo: passo.media_type,
              url: anexoUrl,
              nome: passo.media_filename,
            }}
            seguinte={{ corpo: CORPO_DO_MENU_APOS_MIDIA, botoes }}
          />
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
        <p className="text-[11.5px] text-text-secondary">
          Amostra com dados fictícios. No envio real, os campos são preenchidos
          com os dados da consulta e do paciente.
        </p>
      </div>
    </div>
  );
}
