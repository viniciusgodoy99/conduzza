"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ControlesDaRegua } from "@/components/confirmacoes/controles-da-regua";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { rotuloDoPasso } from "@/lib/domain/textos-padrao";
import {
  confirmacoesKeys,
  type ReguasDaClinica,
} from "@/lib/queries/confirmacoes";
import { cn } from "@/lib/utils";

// Painel de ativacao das reguas na Tela 2: o atalho do dia a dia para ligar,
// desligar e ajustar a janela. A EDICAO dos textos e a criacao de excecoes
// moram na Tela 7 (/automacoes); aqui os passos aparecem em leitura com o
// link para la. O bloco de ativacao e o MESMO componente das duas telas
// (ControlesDaRegua): uma regra so.

const COPY = {
  confirmacao: {
    aba: "Confirmação",
    descricao:
      "Mensagens automáticas antes da consulta, com os botões Confirmar, Remarcar e Cancelar.",
    ligar: "Ligar a régua de confirmação",
    ligada: "Régua ligada",
    desligada: "Régua desligada",
    descricaoDosPassos:
      "Os campos entre chaves são preenchidos com os dados da consulta na hora do envio.",
    vazio: "Esta clínica ainda não tem a régua de confirmação configurada.",
  },
  pos_falta: {
    aba: "Depois da falta",
    descricao:
      "Mensagens depois de uma falta, para trazer o paciente de volta à agenda.",
    ligar: "Ligar a régua de recuperação depois da falta",
    ligada: "Recuperação ligada",
    desligada: "Recuperação desligada",
    descricaoDosPassos:
      "Saem só para quem foi marcado como falta na tela de confirmações.",
    vazio: "Esta clínica ainda não tem a régua de recuperação configurada.",
  },
} as const;

type TipoDeRegua = keyof typeof COPY;

export function PainelRegua({
  clinicId,
  reguas,
  aberto,
  onFechar,
  podeEditar,
  dicaSemPermissao,
}: {
  clinicId: string;
  reguas: ReguasDaClinica | null;
  aberto: boolean;
  onFechar: () => void;
  podeEditar: boolean;
  dicaSemPermissao: string;
}) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoDeRegua>("confirmacao");
  const copy = COPY[tipo];
  const regua =
    tipo === "confirmacao" ? reguas?.confirmacao : reguas?.pos_falta;

  const invalidar = () =>
    queryClient.invalidateQueries({
      queryKey: confirmacoesKeys.regua(clinicId),
    });

  return (
    <Sheet open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>Mensagens automáticas</SheetTitle>
          <SheetDescription>{copy.descricao}</SheetDescription>
        </SheetHeader>

        {/* Segmentador, nao aba ARIA: role="tab" obriga tabpanel associado e
            navegacao por seta, e aqui o conteudo abaixo nao e um painel
            declarado. aria-pressed diz a mesma coisa sem prometer o que a tela
            nao cumpre, e e o mesmo padrao do segmentador do Inbox. */}
        <div className="px-4">
          <div
            role="group"
            aria-label="Tipo de régua"
            className="grid grid-cols-2 rounded-lg bg-surface-3 p-0.5 text-[12.5px] font-medium"
          >
            {(Object.keys(COPY) as TipoDeRegua[]).map((valor) => (
              <button
                key={valor}
                type="button"
                aria-pressed={tipo === valor}
                onClick={() => setTipo(valor)}
                className={cn(
                  // h-10: alvo de toque mínimo de 40px da seção 5 do CLAUDE.md.
                  "h-10 rounded-md transition-colors",
                  tipo === valor
                    ? "bg-surface-5 text-foreground"
                    : "text-text-secondary hover:text-foreground",
                )}
              >
                {COPY[valor].aba}
              </button>
            ))}
          </div>
        </div>

        {!regua ? (
          <div className="p-4 text-sm text-text-secondary">{copy.vazio}</div>
        ) : (
          <div key={regua.id} className="grid gap-6 p-4">
            <ControlesDaRegua
              regua={regua}
              rotuloLigar={copy.ligar}
              rotuloLigada={copy.ligada}
              rotuloDesligada={copy.desligada}
              visivel={aberto}
              podeEditar={podeEditar}
              dicaSemPermissao={dicaSemPermissao}
              aoMudar={invalidar}
            />

            {/* Os toques, em leitura; a edicao mora na Tela 7 */}
            <section className="grid gap-3">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {regua.passos.length === 1
                      ? "A mensagem"
                      : `As ${regua.passos.length} mensagens`}
                  </h3>
                  <Link
                    href={`/automacoes?aba=${tipo}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Editar em Automações
                  </Link>
                </div>
                <p className="text-xs text-text-secondary">
                  {copy.descricaoDosPassos}
                </p>
              </div>
              {regua.passos.map((passo) => (
                <article
                  key={passo.id}
                  className="grid gap-1.5 rounded-lg border p-3"
                >
                  <span className="text-[12.5px] font-semibold">
                    {rotuloDoPasso(passo.offset_minutes)}
                  </span>
                  <p className="text-[13px] whitespace-pre-line text-text-secondary">
                    {passo.fixed_body ?? "Sem texto cadastrado."}
                  </p>
                </article>
              ))}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
