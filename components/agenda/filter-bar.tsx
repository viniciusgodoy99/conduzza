"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { AgendaActionsMenu } from "@/components/agenda/agenda-actions-menu";
import { BotaoProtegido } from "@/components/cadastros/comum";
import type {
  ContextoAgenda,
  FiltrosAgenda,
  VisaoAgenda,
} from "@/components/agenda/tipos";
import type { AgendaDia } from "@/lib/queries/agenda";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { cn } from "@/lib/utils";

// Barra de filtros da Agenda. A ORDEM e regra de produto (brief Tela 3):
// data, Unidade, Especialidade, Convenio, Procedimento e o PROFISSIONAL POR
// ULTIMO. "A recepcao pergunta quem esta livre para dermato pela Unimed, nao
// abra a agenda do Dr. Fulano."

const TODOS = "__todos__";

function SelectFiltro({
  placeholder,
  value,
  onChange,
  opcoes,
}: {
  placeholder: string;
  value: string | null;
  onChange: (v: string | null) => void;
  opcoes: { value: string; label: string }[];
}) {
  return (
    <Select
      value={value ?? TODOS}
      onValueChange={(v) => onChange(v === TODOS ? null : v)}
    >
      <SelectTrigger
        className="h-10 w-auto max-w-[180px] min-w-[120px]"
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

export function FilterBar({
  contexto,
  dia,
  onDia,
  visao,
  onVisao,
  filtros,
  onFiltros,
  travadoNoProfissional,
  onNovoAgendamento,
  dados,
}: {
  contexto: ContextoAgenda;
  dia: string;
  onDia: (dia: string) => void;
  visao: VisaoAgenda;
  onVisao: (v: VisaoAgenda) => void;
  filtros: FiltrosAgenda;
  onFiltros: (f: FiltrosAgenda) => void;
  travadoNoProfissional: string | null;
  onNovoAgendamento: () => void;
  dados: AgendaDia;
}) {
  const { catalogo, podeEditar, dica } = contexto;
  const [dataAberta, setDataAberta] = useState(false);

  const especialidades = useMemo(() => {
    const conjunto = new Set<string>();
    for (const profissional of catalogo.profissionais) {
      if (!profissional.active) {
        continue;
      }
      for (const especialidade of profissional.specialties) {
        conjunto.add(especialidade);
      }
    }
    return [...conjunto].sort();
  }, [catalogo.profissionais]);

  const dataFormatada = useMemo(() => {
    const [ano, mes, diaN] = dia.split("-");
    return `${diaN}/${mes}/${ano!.slice(2)}`;
  }, [dia]);

  const hoje = () => {
    // O "hoje" e sempre o dia civil no FUSO DA CLINICA, nao no fuso do
    // navegador: perto da virada do dia os dois divergem e "Hoje" cairia no
    // dia errado.
    onDia(diaCivil(contexto.timezone, new Date()));
    setDataAberta(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-1 px-4 py-2.5">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label="Dia anterior"
          onClick={() => onDia(somarDias(dia, -1))}
        >
          <ChevronLeft strokeWidth={1.5} className="size-4" />
        </Button>
        <Popover open={dataAberta} onOpenChange={setDataAberta}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="h-10 gap-2 font-mono tabular-nums"
            >
              <CalendarDays strokeWidth={1.5} className="size-4" />
              {dataFormatada}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3">
            <div className="grid gap-2">
              <Input
                type="date"
                value={dia}
                onChange={(e) => {
                  if (e.target.value) {
                    onDia(e.target.value);
                  }
                }}
                className="h-10"
                aria-label="Escolher data"
              />
              <Button variant="outline" size="sm" onClick={hoje}>
                Hoje
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label="Dia seguinte"
          onClick={() => onDia(somarDias(dia, 1))}
        >
          <ChevronRight strokeWidth={1.5} className="size-4" />
        </Button>
      </div>

      {catalogo.unidades.filter((u) => u.active).length > 1 ? (
        <SelectFiltro
          placeholder="Unidade"
          value={filtros.unidadeId}
          onChange={(v) => onFiltros({ ...filtros, unidadeId: v })}
          opcoes={catalogo.unidades
            .filter((u) => u.active)
            .map((u) => ({ value: u.id, label: u.name }))}
        />
      ) : null}
      <SelectFiltro
        placeholder="Especialidade"
        value={filtros.especialidade}
        onChange={(v) => onFiltros({ ...filtros, especialidade: v })}
        opcoes={especialidades.map((e) => ({ value: e, label: e }))}
      />
      <SelectFiltro
        placeholder="Convênio"
        value={filtros.convenioId}
        onChange={(v) => onFiltros({ ...filtros, convenioId: v })}
        opcoes={[
          { value: "particular", label: "Particular" },
          ...catalogo.convenios
            .filter((c) => c.active)
            .map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <SelectFiltro
        placeholder="Procedimento"
        value={filtros.procedimentoId}
        onChange={(v) => onFiltros({ ...filtros, procedimentoId: v })}
        opcoes={catalogo.procedimentos
          .filter((p) => p.active)
          .map((p) => ({ value: p.id, label: p.name }))}
      />
      {/* Profissional e o ULTIMO filtro, de proposito. */}
      {travadoNoProfissional ? null : (
        <SelectFiltro
          placeholder="Profissional"
          value={filtros.profissionalId}
          onChange={(v) => onFiltros({ ...filtros, profissionalId: v })}
          opcoes={catalogo.profissionais
            .filter((p) => p.active)
            .map((p) => ({ value: p.id, label: p.name }))}
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        <div
          role="group"
          aria-label="Visão da agenda"
          className="grid grid-cols-2 rounded-lg bg-surface-3 p-0.5 text-[12.5px] font-medium"
        >
          {(
            [
              ["dia", "Dia"],
              ["semana", "Semana"],
            ] as [VisaoAgenda, string][]
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => onVisao(valor)}
              aria-pressed={visao === valor}
              className={cn(
                "h-[34px] min-w-[64px] rounded-md px-3 transition-colors",
                visao === valor
                  ? "bg-surface-5 text-foreground"
                  : "text-text-secondary hover:text-foreground",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={onNovoAgendamento}
        >
          <Plus strokeWidth={1.5} className="size-4" /> Novo agendamento
        </BotaoProtegido>
        <AgendaActionsMenu contexto={contexto} dia={dia} dados={dados} />
      </div>
    </div>
  );
}
