"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ControlesDaRegua } from "@/components/confirmacoes/controles-da-regua";
import { EmptyState } from "@/components/shared/empty-state";
import { SegmentedControl } from "@/components/shared/segmented-control";
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
    // A falta so se marca na Agenda (achado 64): a Tela 2 nao tem esse botao.
    descricaoDosPassos: "Saem só para quem foi marcado como falta na Agenda.",
    vazio: "Esta clínica ainda não tem a régua de recuperação configurada.",
  },
} as const;

type TipoDeRegua = keyof typeof COPY;

const OPCOES_DE_TIPO = (Object.keys(COPY) as TipoDeRegua[]).map((valor) => ({
  value: valor,
  label: COPY[valor].aba,
}));

export function PainelRegua({
  clinicId,
  reguas,
  aberto,
  onFechar,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
}: {
  clinicId: string;
  reguas: ReguasDaClinica | null;
  aberto: boolean;
  onFechar: () => void;
  podeEditar: boolean;
  dicaSemPermissao: string;
  /** So o administrador registra a linha de base (policy do banco). */
  ehAdministrador: boolean;
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
      {/* Folha sem rodape (docs/06 secao 5.10): cada bloco salva sozinho. */}
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
            nao cumpre (o e2e clica o botao "Depois da falta"). */}
        <div className="px-5 pt-4">
          <SegmentedControl
            ariaLabel="Tipo de régua"
            options={OPCOES_DE_TIPO}
            value={tipo}
            onChange={setTipo}
            block
          />
        </div>

        {!regua ? (
          <EmptyState compact icon={Workflow} title={copy.vazio} />
        ) : (
          <div key={regua.id} className="grid gap-5 px-5 py-4">
            <ControlesDaRegua
              regua={regua}
              tipo={tipo}
              rotuloLigar={copy.ligar}
              rotuloLigada={copy.ligada}
              rotuloDesligada={copy.desligada}
              visivel={aberto}
              podeEditar={podeEditar}
              dicaSemPermissao={dicaSemPermissao}
              ehAdministrador={ehAdministrador}
              aoMudar={invalidar}
            />

            {/* Os toques, em leitura; a edicao mora na Tela 7 */}
            <section className="grid gap-3">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">
                    {regua.passos.length === 1 ? (
                      "A mensagem"
                    ) : (
                      <>
                        As <span className="cz-num">{regua.passos.length}</span>{" "}
                        mensagens
                      </>
                    )}
                  </h3>
                  <Link
                    href={`/automacoes?aba=${tipo}`}
                    className="hit-40 inline-flex items-center gap-1 rounded-sm text-[13px] font-semibold text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                  >
                    Editar em Automações
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
                <p className="text-xs text-text-secondary">
                  {copy.descricaoDosPassos}
                </p>
              </div>
              {regua.passos.map((passo) => (
                <article
                  key={passo.id}
                  className="grid gap-1.5 rounded-xl bg-surface-4 p-3.5"
                >
                  <span className="text-[12.5px] font-bold text-text-strong">
                    {rotuloDoPasso(passo.offset_minutes, tipo)}
                  </span>
                  <p className="text-[13px] whitespace-pre-line text-foreground">
                    {passo.fixed_body ??
                      (passo.media_path
                        ? "Só o anexo, sem texto."
                        : "Sem texto cadastrado.")}
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
