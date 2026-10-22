"use client";

import { SeletorDeEtiqueta } from "@/components/automacoes/seletor-de-etiqueta";
import { ChipDeEtiqueta } from "@/components/shared/chip-de-etiqueta";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { SegmentedControl } from "@/components/shared/segmented-control";
import {
  chaveDaEtiqueta,
  type LeituraDasEtiquetas,
  type ModoDoFiltro,
  type OpcaoDeEtiqueta,
  type TonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import { ETIQUETAS_POR_REGUA } from "@/lib/domain/reguas-de-followup";

// O "Para quem" de uma regua de follow-up por etiqueta (onda 4, item 16):
// as etiquetas do filtro (o chip com o nome sempre escrito e o tom da
// etiqueta do catalogo, como na lista de Leads) e, com duas ou mais, se o
// lead precisa ter qualquer uma ou todas. Serve o dialogo da regua nova e o
// de editar o "Para quem". Sem estado: quem chama guarda a lista e o modo.

export const OPCOES_DO_MODO = [
  { value: "qualquer", label: "Qualquer uma" },
  { value: "todas", label: "Todas" },
] as const;

/** Os chips das etiquetas do filtro, para o cartao e os dialogos. */
export function ChipsDasEtiquetas({
  etiquetas,
  tons,
  aoRemover,
  desabilitado = false,
}: {
  etiquetas: readonly string[];
  tons: TonsDasEtiquetas;
  /** Com ele, cada chip ganha o X de remover */
  aoRemover?: (nome: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      {etiquetas.map((nome) => (
        <ChipDeEtiqueta
          key={nome}
          nome={nome}
          tom={tons.get(chaveDaEtiqueta(nome)) ?? "neutral"}
          aoRemover={aoRemover ? () => aoRemover(nome) : undefined}
          removerDesabilitado={desabilitado}
        />
      ))}
    </span>
  );
}

export function EtiquetasDaRegua({
  etiquetas,
  modo,
  aoMudar,
  opcoes,
  leitura,
  tons,
  desabilitado = false,
  idDoRotulo,
}: {
  etiquetas: readonly string[];
  modo: ModoDoFiltro;
  aoMudar: (proximo: { etiquetas: string[]; modo: ModoDoFiltro }) => void;
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  tons: TonsDasEtiquetas;
  desabilitado?: boolean;
  /** O id do rotulo "Etiquetas" que o grupo usa como nome acessivel */
  idDoRotulo: string;
}) {
  const cheia = etiquetas.length >= ETIQUETAS_POR_REGUA;
  const adicionar = (
    <SeletorDeEtiqueta
      modo="adicionar"
      rotulo="Adicionar etiqueta"
      opcoes={opcoes}
      leitura={leitura}
      jaEscolhidas={etiquetas}
      desabilitado={desabilitado || cheia}
      aoEscolher={(nome) => aoMudar({ etiquetas: [...etiquetas, nome], modo })}
    />
  );
  return (
    <div role="group" aria-labelledby={idDoRotulo} className="grid gap-2.5">
      {etiquetas.length > 0 ? (
        <ChipsDasEtiquetas
          etiquetas={etiquetas}
          tons={tons}
          desabilitado={desabilitado}
          aoRemover={(nome) =>
            aoMudar({
              etiquetas: etiquetas.filter((etiqueta) => etiqueta !== nome),
              modo,
            })
          }
        />
      ) : null}
      <div>
        {cheia ? (
          <DisabledWithHint
            hint={`Até ${ETIQUETAS_POR_REGUA} etiquetas por régua.`}
          >
            {adicionar}
          </DisabledWithHint>
        ) : (
          adicionar
        )}
      </div>
      {etiquetas.length >= 2 ? (
        <div className="grid gap-1.5">
          <p className="text-xs font-semibold text-foreground">
            O lead precisa ter
          </p>
          <SegmentedControl
            ariaLabel="O lead precisa ter"
            options={OPCOES_DO_MODO.map((opcao) => ({
              ...opcao,
              disabled: desabilitado,
            }))}
            value={modo}
            onChange={(proximo) =>
              aoMudar({ etiquetas: [...etiquetas], modo: proximo })
            }
            className="w-fit"
          />
          <p className="text-[11px] text-text-secondary">
            {modo === "todas"
              ? "Só recebe quem tem todas estas etiquetas."
              : "Recebe quem tem qualquer uma destas etiquetas."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
