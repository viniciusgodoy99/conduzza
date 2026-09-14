"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { salvarTextoDoPassoAction } from "@/app/(app)/automacoes/actions";
import { BalaoWhatsApp } from "@/components/automacoes/balao-whatsapp";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PLACEHOLDERS, renderizarModelo } from "@/lib/domain/modelo-mensagem";
import type { PassoDaReguaDaTela } from "@/lib/queries/confirmacoes";

// Editor de um passo da regua: textarea com os campos {{...}} em chips
// clicaveis e a pre-visualizacao ao vivo em balao de WhatsApp, lado a lado.
// E o coracao do aceite da 4.8: trocar o texto da regua sem tocar em codigo.

/** Valores de amostra da pre-visualizacao, explicitamente FICTICIOS. */
export function valoresDeAmostra(nomeDaClinica: string) {
  return {
    nome: "Maria",
    clinica: nomeDaClinica,
    data: "quinta-feira, 24 de setembro",
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
}: {
  passo: PassoDaReguaDaTela;
  rotulo: string;
  nomeDaClinica: string;
  botoes?: string[];
  /** Subconjunto de campos que fazem sentido nesta regua. */
  placeholders?: readonly string[];
  podeEditar: boolean;
  dicaSemPermissao: string;
}) {
  const [texto, setTexto] = useState(passo.fixed_body ?? "");
  const [pendente, iniciarTransicao] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Trocar de passo recarrega o rascunho do que esta salvo.
  useEffect(() => {
    setTexto(passo.fixed_body ?? "");
  }, [passo.id, passo.fixed_body]);

  const preview = useMemo(
    () => renderizarModelo(texto, valoresDeAmostra(nomeDaClinica)),
    [texto, nomeDaClinica],
  );

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
          <Label htmlFor={idArea}>Mensagem de {rotulo.toLowerCase()}</Label>
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
            disabled={pendente || !mudou || texto.trim().length === 0}
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
        <BalaoWhatsApp corpo={preview} botoes={botoes} />
        <p className="text-[11.5px] text-text-tertiary">
          Amostra com dados fictícios. No envio real, os campos são
          preenchidos com os dados da consulta e do paciente.
        </p>
      </div>
    </div>
  );
}
