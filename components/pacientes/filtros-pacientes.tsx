"use client";

import { X } from "lucide-react";

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
        className="h-10 w-auto max-w-[190px] min-w-[120px]"
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

// Chave de sim ou nao com estado em texto (aria-pressed) e em forma (fundo
// cheio quando ligada), nunca so cor.
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
        "flex h-10 items-center rounded-lg border px-3 text-[13px] font-medium transition-colors",
        ligada
          ? "border-transparent bg-surface-5 text-foreground"
          : "border-border text-text-secondary hover:text-foreground",
      )}
    >
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
    <div className="flex flex-wrap items-center gap-2">
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
        <Button variant="ghost" className="h-10" onClick={aoLimpar}>
          <X strokeWidth={1.5} className="size-4" /> Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
