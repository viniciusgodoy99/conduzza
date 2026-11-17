"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { definirAvisoDaMetaNoLinkAction } from "@/app/(app)/configuracoes/regras-de-origem-actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// "Avisar a Meta no clique" do link rastreado de uma origem (etapa 3e do
// plano de 16/11/2026, como no Q5): com a chave ligada, quem toca no link
// passa por uma pagina que dispara o Pixel da clinica e segue para o WhatsApp,
// e o mesmo evento vai pelo servidor. So funciona com o Pixel e o envio de
// conversoes ligados na aba Anuncios da Meta. A chave fica sempre visivel:
// sem permissao ou sem a Meta pronta, desabilitada com o porque.

export const TEXTOS_DO_AVISO_DA_META = {
  rotulo: "Avisar a Meta no clique",
  explicacao:
    "Quem toca no link passa por uma página que avisa o Pixel da clínica e segue para o WhatsApp, em até 1,5 segundo. Use em link de anúncio.",
  semMeta:
    "Para usar, cadastre o Pixel e ligue o envio de conversões nos passos 1 e 3 desta aba.",
  ligado: "A Meta passa a ser avisada a cada clique deste link.",
  desligado: "A Meta deixa de ser avisada no clique deste link.",
  semServidor: "Não foi possível falar com o servidor. Tente de novo.",
} as const;

export function AvisoDaMetaNoLink({
  regraId,
  nomeDaOrigem,
  ligado,
  metaPronta,
  podeGerenciar,
  dica,
}: {
  regraId: string;
  nomeDaOrigem: string;
  ligado: boolean;
  /** a clinica tem o Pixel e o envio de conversoes ligados */
  metaPronta: boolean;
  podeGerenciar: boolean;
  dica: string;
}) {
  const id = useId();
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const alternar = (valor: boolean) => {
    setErro(null);
    iniciar(async () => {
      let resultado;
      try {
        resultado = await definirAvisoDaMetaNoLinkAction({
          id: regraId,
          ligado: valor,
        });
      } catch {
        setErro(TEXTOS_DO_AVISO_DA_META.semServidor);
        return;
      }
      if (!resultado.ok) {
        setErro(resultado.error);
        return;
      }
      toast.success(
        valor
          ? TEXTOS_DO_AVISO_DA_META.ligado
          : TEXTOS_DO_AVISO_DA_META.desligado,
      );
      router.refresh();
    });
  };

  // Ligada, sempre da para desligar. Desligada, so liga com a Meta pronta.
  const motivo = !podeGerenciar
    ? dica
    : !ligado && !metaPronta
      ? TEXTOS_DO_AVISO_DA_META.semMeta
      : null;
  const chave = (
    <Switch
      id={id}
      checked={ligado}
      onCheckedChange={alternar}
      disabled={motivo !== null || pendente}
      aria-label={`${TEXTOS_DO_AVISO_DA_META.rotulo} de ${nomeDaOrigem}`}
    />
  );

  return (
    <div className="grid gap-1">
      <div className="flex min-h-10 items-center gap-2.5">
        {motivo ? <DisabledWithHint hint={motivo}>{chave}</DisabledWithHint> : chave}
        <Label htmlFor={id} className="text-[12.5px]">
          {TEXTOS_DO_AVISO_DA_META.rotulo}
        </Label>
      </div>
      <p className="text-[12px] text-text-secondary">
        {TEXTOS_DO_AVISO_DA_META.explicacao}
      </p>
      {erro ? (
        <p role="alert" className="text-[12.5px] text-alert-text">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
