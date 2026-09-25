"use client";

import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Filtros da Tela 9: tres chaves de sim ou nao e dois seletores. Os valores
// vivem na URL (o pai grava), para o link chegar filtrado no colega. O
// sentinela evita value="" no Radix Select, mesmo padrao da Tela 4.

const TODOS = "__todos__";

export type ValoresFiltrosPacientes = {
  falta: boolean;
  inativos: boolean;
  pacote: boolean;
  convenio: string;
  prof: string;
};

function SelectFiltro({
  placeholder,
  value,
  onChange,
  opcoes,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  opcoes: { value: string; label: string }[];
}) {
  return (
    <Select
      value={value || TODOS}
      onValueChange={(v) => onChange(v === TODOS ? "" : v)}
    >
      <SelectTrigger
        className="h-10 w-auto max-w-[200px] min-w-[128px] text-[13px] shadow-xs"
        aria-label={placeholder}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{placeholder}</SelectItem>
        {opcoes.map((opcao) => (
          <SelectItem key={opcao.value} value={opcao.value}>
            {opcao.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Chave de sim ou nao com estado em texto (aria-pressed), em forma (o check
// aparece quando ligada) e em cor, nunca so cor. Ligada usa a receita de
// escolha em chip do DS: fio lime-700 e fundo lime suave, nunca lime cheio.
function ChaveFiltro({
  rotulo,
  ligada,
  onClick,
}: {
  rotulo: string;
  ligada: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ligada}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
        ligada
          ? "border-primary-edge bg-primary-soft text-text-strong"
          : "border-border-strong bg-card text-text-secondary hover:bg-surface-3 hover:text-text-strong",
      )}
    >
      {ligada ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
      {rotulo}
    </button>
  );
}

export function FiltrosPacientes({
  valores,
  convenios,
  profissionais,
  aoMudar,
  aoLimpar,
}: {
  valores: ValoresFiltrosPacientes;
  convenios: { id: string; name: string }[];
  profissionais: { id: string; name: string }[];
  aoMudar: (
    campo: keyof ValoresFiltrosPacientes,
    valor: string | boolean,
  ) => void;
  aoLimpar: () => void;
}) {
  const temAtivo =
    valores.falta ||
    valores.inativos ||
    valores.pacote ||
    Boolean(valores.convenio) ||
    Boolean(valores.prof);

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <ChaveFiltro
        rotulo="Com falta"
        ligada={valores.falta}
        onClick={() => aoMudar("falta", !valores.falta)}
      />
      <ChaveFiltro
        rotulo="Inativos"
        ligada={valores.inativos}
        onClick={() => aoMudar("inativos", !valores.inativos)}
      />
      <ChaveFiltro
        rotulo="Com pacote"
        ligada={valores.pacote}
        onClick={() => aoMudar("pacote", !valores.pacote)}
      />
      <SelectFiltro
        placeholder="Convênio"
        value={valores.convenio}
        onChange={(v) => aoMudar("convenio", v)}
        opcoes={convenios.map((convenio) => ({
          value: convenio.id,
          label: convenio.name,
        }))}
      />
      <SelectFiltro
        placeholder="Profissional"
        value={valores.prof}
        onChange={(v) => aoMudar("prof", v)}
        opcoes={profissionais.map((profissional) => ({
          value: profissional.id,
          label: profissional.name,
        }))}
      />
      {temAtivo ? (
        <Button variant="ghost" onClick={aoLimpar}>
          <X aria-hidden /> Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
