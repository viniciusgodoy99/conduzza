"use client";

import { X } from "lucide-react";

import { CANAIS } from "@/components/leads/rotulos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

// Filtros da Tela 4: etapa, origem, responsavel e periodo de entrada. Os
// valores vivem na URL (o pai grava); aqui e so a barra. O sentinela evita
// value="" no Radix Select, mesmo padrao do SelectFiltro da Agenda.

const TODOS = "__todos__";

export type ValoresFiltros = {
  etapa: string;
  origem: string;
  resp: string;
  de: string;
  ate: string;
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

export function FiltrosLeads({
  valores,
  membros,
  jornada,
  aoMudar,
  aoLimpar,
}: {
  valores: ValoresFiltros;
  membros: Record<string, string>;
  jornada: EtapaDaJornada[];
  aoMudar: (campo: keyof ValoresFiltros, valor: string) => void;
  aoLimpar: () => void;
}) {
  const etapas = jornada.map((def) => ({
    value: def.chave,
    label: def.nome,
  }));
  const responsaveis = Object.entries(membros)
    .map(([id, nome]) => ({ value: id, label: nome }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const temAtivo = Boolean(
    valores.etapa ||
    valores.origem ||
    valores.resp ||
    valores.de ||
    valores.ate,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SelectFiltro
        placeholder="Etapa"
        value={valores.etapa}
        onChange={(v) => aoMudar("etapa", v)}
        opcoes={etapas}
      />
      <SelectFiltro
        placeholder="Origem"
        value={valores.origem}
        onChange={(v) => aoMudar("origem", v)}
        opcoes={CANAIS.map((canal) => ({
          value: canal.valor,
          label: canal.rotulo,
        }))}
      />
      <SelectFiltro
        placeholder="Responsável"
        value={valores.resp}
        onChange={(v) => aoMudar("resp", v)}
        opcoes={responsaveis}
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={valores.de}
          onChange={(e) => aoMudar("de", e.target.value)}
          className="h-10 w-[150px]"
          aria-label="Entrou a partir de"
        />
        <span className="text-xs text-text-tertiary">até</span>
        <Input
          type="date"
          value={valores.ate}
          onChange={(e) => aoMudar("ate", e.target.value)}
          className="h-10 w-[150px]"
          aria-label="Entrou até"
        />
      </div>
      {temAtivo ? (
        <Button variant="ghost" className="h-10" onClick={aoLimpar}>
          <X className="size-4" /> Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
