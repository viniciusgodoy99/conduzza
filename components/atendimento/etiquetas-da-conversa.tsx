"use client";

import { Plus } from "lucide-react";
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
    <Button
      variant="ghost"
      size="sm"
      className="w-fit"
      disabled={!podeEtiquetar || pendente}
    >
      <Plus aria-hidden />
      Etiquetar
    </Button>
  );

  return (
    <div className="grid justify-items-start gap-2">
      {aplicadas.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {aplicadas.map((etiqueta) => (
            <ChipDeEtiqueta
              key={etiqueta.chave}
              nome={etiqueta.nome}
              tom={etiqueta.tom}
              aoRemover={
                podeEtiquetar ? () => alternar(etiqueta.chave, true) : undefined
              }
              removerDesabilitado={pendente}
            />
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-text-secondary">
          Nenhuma etiqueta nesta conversa.
        </p>
      )}

      {podeEtiquetar ? (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>{botao}</PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-[5px]">
            {catalogo.length === 0 ? (
              <div className="grid gap-1.5 p-2">
                <p className="text-xs text-text-secondary">
                  Esta clínica ainda não tem etiquetas.
                </p>
                {ehChefia ? (
                  <Link
                    href="/configuracoes?aba=etiquetas"
                    className="text-xs font-semibold text-primary-text underline underline-offset-2"
                  >
                    Criar etiquetas
                  </Link>
                ) : (
                  <p className="text-xs text-text-secondary">
                    Peça a um administrador para criar as etiquetas em
                    Configurações.
                  </p>
                )}
              </div>
            ) : (
              // Teto do catalogo e 20: sem rolagem, as ultimas ficariam
              // inalcancaveis dentro do popover.
              <div className="grid cz-scroll max-h-72 overflow-y-auto">
                {catalogo.map((etiqueta) => {
                  const marcada = tags.includes(etiqueta.chave);
                  return (
                    <button
                      key={etiqueta.chave}
                      type="button"
                      disabled={pendente}
                      aria-pressed={marcada}
                      onClick={() => alternar(etiqueta.chave, marcada)}
                      className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] font-medium text-foreground cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:opacity-45"
                    >
                      <Checkbox
                        checked={marcada}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-[2px]"
                        style={{
                          backgroundColor:
                            STATUS_TONE_VARS[etiqueta.tom].marker,
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
