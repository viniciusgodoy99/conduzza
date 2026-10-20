"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { CANAIS } from "@/components/leads/rotulos";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ORIGEM_SEM_ATRIBUICAO,
  ROTULO_SEM_ATRIBUICAO,
  type OpcaoDoFiltro,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { ValoresDosFiltrosDeLeads } from "@/lib/domain/leads-ui";

// Filtros da Tela 4: etapa, origem, campanha, anuncio, responsavel e
// periodo de entrada. Os valores vivem na URL (o pai grava); aqui e so a
// barra, solta na pagina (fora de cartao), no desenho do design system
// Conduzza (docs/06 secao 5.4). O sentinela evita value="" no Radix Select,
// mesmo padrao do SelectFiltro da Agenda. Os mesmos valores vao para a
// exportacao (o arquivo sai com os leads que estes filtros mostram).
//
// Campanha e Anúncio (pedido do dono em 20/10/2026) separam os leads como
// Resultados conta (lib/domain/campanha-e-anuncio-do-lead.ts); as opcoes
// vem do pai, a partir dos leads carregados. A Origem ganhou "Sem
// atribuição" (o canal vazio, a mesma linha de Resultados). No fim da
// barra, o resumo que o pai manda (quantos leads batem com os filtros).

const TODOS = "__todos__";

// O campo de data aceita ano de 5 digitos (o Chrome vai ate 275760), e o
// filtro so le dia civil com ano de 4 (ehDiaCivilValido): sem o teto, a data
// ficaria escrita no campo sem filtrar nada.
const ULTIMO_DIA_DO_CAMPO = "9999-12-31";

export type ValoresFiltros = ValoresDosFiltrosDeLeads;

/** Membro que aparece numa lista de responsavel (filtro, Reatribuir, Novo lead). */
export type OpcaoDeResponsavel = { id: string; nome: string };

/** A Origem: os 8 canais e, no fim, o canal vazio. */
const OPCOES_DE_ORIGEM: OpcaoDoFiltro[] = [
  ...CANAIS.map((canal) => ({ value: canal.valor, label: canal.rotulo })),
  { value: ORIGEM_SEM_ATRIBUICAO, label: ROTULO_SEM_ATRIBUICAO },
];

function SelectFiltro({
  placeholder,
  value,
  onChange,
  opcoes,
  dicaDeIndisponivel = null,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  opcoes: OpcaoDoFiltro[];
  /** Filtro que nao funciona agora: visivel, desabilitado e com a dica. */
  dicaDeIndisponivel?: string | null;
}) {
  const select = (
    <Select
      value={value || TODOS}
      onValueChange={(v) => onChange(v === TODOS ? "" : v)}
      disabled={dicaDeIndisponivel !== null}
    >
      <SelectTrigger
        className="h-10 w-auto max-w-[200px] min-w-[128px] text-[13px] shadow-xs"
        aria-label={placeholder}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Nome de campanha e titulo de anuncio podem ser longos: a lista
          quebra a linha em vez de passar da largura da tela. */}
      <SelectContent className="max-w-[min(28rem,calc(100vw-2rem))]">
        <SelectItem value={TODOS}>{placeholder}</SelectItem>
        {opcoes.map((opcao) => (
          <SelectItem
            key={opcao.value}
            value={opcao.value}
            className="break-words"
          >
            {opcao.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return dicaDeIndisponivel === null ? (
    select
  ) : (
    <DisabledWithHint hint={dicaDeIndisponivel}>{select}</DisabledWithHint>
  );
}

export function FiltrosLeads({
  valores,
  responsaveis,
  jornada,
  opcoesDeCampanha,
  dicaDaCampanha = null,
  opcoesDeAnuncio,
  resumo,
  aoMudar,
  aoLimpar,
}: {
  valores: ValoresFiltros;
  /** Ja ordenados; o pai decide quem entra (ativos e donos atuais) */
  responsaveis: OpcaoDeResponsavel[];
  jornada: EtapaDaJornada[];
  /** Campanhas dos leads carregados, mais leads primeiro (opcoesDeCampanha) */
  opcoesDeCampanha: OpcaoDoFiltro[];
  /**
   * Por que o filtro de campanha nao funciona agora (o mapa da clinica
   * carregando ou com erro); null quando funciona.
   */
  dicaDaCampanha?: string | null;
  /** Anuncios dos leads carregados, mais leads primeiro (opcoesDeAnuncio) */
  opcoesDeAnuncio: OpcaoDoFiltro[];
  /** Quantos leads batem com os filtros (regiao viva, no fim da barra) */
  resumo?: ReactNode;
  aoMudar: (campo: keyof ValoresFiltros, valor: string) => void;
  aoLimpar: () => void;
}) {
  const etapas = jornada.map((def) => ({
    value: def.chave,
    label: def.nome,
  }));
  const temAtivo = Boolean(
    valores.etapa ||
    valores.origem ||
    valores.campanha ||
    valores.anuncio ||
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
        opcoes={OPCOES_DE_ORIGEM}
      />
      <SelectFiltro
        placeholder="Campanha"
        value={valores.campanha}
        onChange={(v) => aoMudar("campanha", v)}
        opcoes={opcoesDeCampanha}
        dicaDeIndisponivel={dicaDaCampanha}
      />
      <SelectFiltro
        placeholder="Anúncio"
        value={valores.anuncio}
        onChange={(v) => aoMudar("anuncio", v)}
        opcoes={opcoesDeAnuncio}
      />
      <SelectFiltro
        placeholder="Responsável"
        value={valores.resp}
        onChange={(v) => aoMudar("resp", v)}
        opcoes={responsaveis.map((membro) => ({
          value: membro.id,
          label: membro.nome,
        }))}
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={valores.de}
          onChange={(e) => aoMudar("de", e.target.value)}
          max={ULTIMO_DIA_DO_CAMPO}
          className="h-10 w-[150px] cz-num shadow-xs"
          aria-label="Entrou a partir de"
        />
        <span className="text-xs text-text-secondary">até</span>
        <Input
          type="date"
          value={valores.ate}
          onChange={(e) => aoMudar("ate", e.target.value)}
          max={ULTIMO_DIA_DO_CAMPO}
          className="h-10 w-[150px] cz-num shadow-xs"
          aria-label="Entrou até"
        />
      </div>
      {temAtivo ? (
        <Button variant="ghost" onClick={aoLimpar}>
          <X className="size-4" /> Limpar filtros
        </Button>
      ) : null}
      {resumo !== undefined ? <div className="ml-auto">{resumo}</div> : null}
    </div>
  );
}
