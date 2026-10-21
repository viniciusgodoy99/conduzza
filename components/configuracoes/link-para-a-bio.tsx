"use client";

import { Check, Copy } from "lucide-react";
import { useId, useState } from "react";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  linkDoWhatsApp,
  textoDoLink,
  type NumeroParaOLink,
} from "@/lib/domain/regras-de-origem";
import { cn } from "@/lib/utils";

// Bloco "Link para a bio" da aba Origem dos leads (onda 5, contrato A.3): o
// numero da clinica (so os ativos, sem os removidos, e so os que ja tem
// telefone), o link pronto (https://wa.me/<digitos>?text=..., com o
// " [#CODIGO]" no fim quando a origem tem codigo) e "Copiar link", que vira
// "Link copiado". Aparece na linha de cada origem e no dialogo de edicao.
// Copiar e so leitura: nao depende do papel. Quando nao da para copiar
// (origem ainda nao salva, mudanca nao salva, origem desativada), o botao
// fica visivel e desabilitado, com o porque.

export const TEXTOS_DO_LINK = {
  titulo: "Link para a bio",
  semNumeros:
    "Conecte um número de WhatsApp na aba WhatsApp para montar o link.",
  numerosNaoCarregaram:
    "Não foi possível carregar os números de WhatsApp. Recarregue a página.",
  semMensagem: "Escreva a mensagem pronta para montar o link.",
  copiar: "Copiar link",
  copiado: "Link copiado",
  naoCopiou: "Não foi possível copiar. Selecione o link e copie à mão.",
  oQueAparece: "Texto que aparece no WhatsApp:",
} as const;

export function LinkParaABio({
  numeros,
  mensagem,
  codigo,
  motivoSemCopiar = null,
  nomeDaOrigem,
  className,
}: {
  /** nulo: a leitura dos numeros falhou */
  numeros: readonly NumeroParaOLink[] | null;
  mensagem: string | null;
  codigo: string | null;
  /** Por que o link ainda nao pode ser copiado (nulo: pode). */
  motivoSemCopiar?: string | null;
  /** Para o nome acessivel do seletor e do botao, na linha da lista. */
  nomeDaOrigem?: string;
  className?: string;
}) {
  const id = useId();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const numero =
    numeros?.find((item) => item.id === escolhido) ?? numeros?.[0] ?? null;
  const link = numero ? linkDoWhatsApp(numero.digitos, mensagem, codigo) : null;
  const deQuem = nomeDaOrigem ? ` de ${nomeDaOrigem}` : "";

  let situacao: string | null = null;
  if (numeros === null) {
    situacao = TEXTOS_DO_LINK.numerosNaoCarregaram;
  } else if (numeros.length === 0) {
    situacao = TEXTOS_DO_LINK.semNumeros;
  } else if (!mensagem || mensagem.trim() === "") {
    situacao = TEXTOS_DO_LINK.semMensagem;
  }

  const copiar = async () => {
    if (!link) {
      return;
    }
    setErro(null);
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro(TEXTOS_DO_LINK.naoCopiou);
    }
  };

  const botao = (
    <Button
      type="button"
      variant="outline"
      disabled={!link || motivoSemCopiar !== null}
      onClick={() => void copiar()}
      aria-label={`${copiado ? TEXTOS_DO_LINK.copiado : TEXTOS_DO_LINK.copiar}${deQuem}`}
    >
      {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copiado ? TEXTOS_DO_LINK.copiado : TEXTOS_DO_LINK.copiar}
    </Button>
  );

  return (
    <div
      className={cn("grid gap-2 rounded-xl bg-surface-4 p-3", className)}
      role="group"
      aria-labelledby={`${id}-titulo`}
    >
      <p
        id={`${id}-titulo`}
        className="text-xs font-semibold text-text-strong"
      >
        {TEXTOS_DO_LINK.titulo}
      </p>
      {situacao !== null ? (
        <p
          className={cn(
            "text-[12.5px]",
            numeros === null ? "text-alert-text" : "text-text-secondary",
          )}
        >
          {situacao}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {numeros && numeros.length > 1 ? (
              <Select
                value={numero?.id ?? ""}
                onValueChange={(valor) => {
                  setEscolhido(valor);
                  setCopiado(false);
                }}
              >
                <SelectTrigger
                  className="h-10 w-full sm:w-64"
                  aria-label={`Número do link${deQuem}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {numeros.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.nome}, {item.telefone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : numero ? (
              <span className="text-[12.5px] text-text-secondary">
                {numero.nome}, <span className="cz-num">{numero.telefone}</span>
              </span>
            ) : null}
            {motivoSemCopiar ? (
              <DisabledWithHint hint={motivoSemCopiar}>{botao}</DisabledWithHint>
            ) : (
              botao
            )}
          </div>
          {link ? (
            <p className="cz-num text-[12px] break-all text-foreground select-all">
              {link}
            </p>
          ) : null}
          {mensagem ? (
            <p className="text-[12px] text-text-secondary">
              {TEXTOS_DO_LINK.oQueAparece}{" "}
              <span className="whitespace-pre-line text-foreground">
                {textoDoLink(mensagem, codigo)}
              </span>
            </p>
          ) : null}
          {erro ? (
            <p role="alert" className="text-[12.5px] text-alert-text">
              {erro}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
