"use client";

import { Tag, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { etiquetarConversaAction } from "@/app/(app)/atendimento/actions";
import { ChipDeEtiqueta } from "@/components/shared/chip-de-etiqueta";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import {
  etiquetasDaConversa,
  porChaveDeEtiqueta,
  type EtiquetaDeConversa,
} from "@/lib/domain/etiquetas-de-conversa";

// Aplicar e remover etiqueta sem sair da conversa. Irmao de
// etapa-do-contato.tsx: mesma forma (useTransition, toast, DisabledWithHint)
// e a mesma regra de nunca esconder acao sem permissao.

export function EtiquetasDaConversa({
  conversationId,
  tags,
  catalogo,
  podeEtiquetar,
  dicaSemPermissao,
  ehChefia,
  aoEtiquetar,
}: {
  conversationId: string;
  tags: string[];
  catalogo: EtiquetaDeConversa[];
  podeEtiquetar: boolean;
  dicaSemPermissao: string;
  /** Decide se o vazio convida a criar ou manda pedir para quem pode. */
  ehChefia: boolean;
  aoEtiquetar: (tags: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();

  const aplicadas = etiquetasDaConversa(tags, porChaveDeEtiqueta(catalogo));

  const alternar = (chave: string, marcada: boolean) => {
    iniciarTransicao(async () => {
      const resultado = await etiquetarConversaAction({
        conversation_id: conversationId,
        adicionar: marcada ? [] : [chave],
        remover: marcada ? [chave] : [],
      });
      if (resultado.ok && resultado.tags) {
        aoEtiquetar(resultado.tags);
        return;
      }
      toast.error(resultado.error ?? "Não foi possível etiquetar.");
    });
  };

  const botao = (
    <Button variant="outline" className="h-10" disabled={!podeEtiquetar || pendente}>
      <Tag strokeWidth={1.5} className="size-4" aria-hidden />
      Etiquetar
    </Button>
  );

  return (
    <div className="grid gap-2">
      {aplicadas.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {aplicadas.map((etiqueta) =>
            podeEtiquetar ? (
              <button
                key={etiqueta.chave}
                type="button"
                disabled={pendente}
                onClick={() => alternar(etiqueta.chave, true)}
                aria-label={`Remover etiqueta ${etiqueta.nome}`}
                className="inline-flex items-center gap-1 rounded-full disabled:opacity-60"
                style={{
                  color: STATUS_TONE_VARS[etiqueta.tom].text,
                  backgroundColor: STATUS_TONE_VARS[etiqueta.tom].bg,
                }}
              >
                <span className="py-0.5 pl-2 text-[11px] font-semibold">
                  {etiqueta.nome}
                </span>
                <X strokeWidth={1.5} className="mr-1.5 size-3" aria-hidden />
              </button>
            ) : (
              <ChipDeEtiqueta
                key={etiqueta.chave}
                nome={etiqueta.nome}
                tom={etiqueta.tom}
              />
            ),
          )}
        </div>
      ) : (
        <p className="text-[12.5px] text-text-tertiary">
          Nenhuma etiqueta nesta conversa.
        </p>
      )}

      {podeEtiquetar ? (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>{botao}</PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1">
            {catalogo.length === 0 ? (
              <div className="grid gap-1.5 p-2">
                <p className="text-xs text-text-secondary">
                  Esta clínica ainda não tem etiquetas.
                </p>
                {ehChefia ? (
                  <Link
                    href="/configuracoes?aba=etiquetas"
                    className="text-xs font-medium underline underline-offset-2"
                  >
                    Criar etiquetas
                  </Link>
                ) : (
                  <p className="text-xs text-text-tertiary">
                    Peça a um administrador para criar as etiquetas em
                    Configurações.
                  </p>
                )}
              </div>
            ) : (
              // Teto do catalogo e 20: sem rolagem, as ultimas ficariam
              // inalcancaveis dentro do popover.
              <div className="grid max-h-72 overflow-y-auto">
                {catalogo.map((etiqueta) => {
                  const marcada = tags.includes(etiqueta.chave);
                  return (
                    <button
                      key={etiqueta.chave}
                      type="button"
                      disabled={pendente}
                      aria-pressed={marcada}
                      onClick={() => alternar(etiqueta.chave, marcada)}
                      className="flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-[12.5px] hover:bg-surface-3 disabled:opacity-60"
                    >
                      <Checkbox
                        checked={marcada}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: STATUS_TONE_VARS[etiqueta.tom].text,
                        }}
                      />
                      <span className="min-w-0 truncate">{etiqueta.nome}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        <DisabledWithHint hint={dicaSemPermissao}>{botao}</DisabledWithHint>
      )}
    </div>
  );
}
