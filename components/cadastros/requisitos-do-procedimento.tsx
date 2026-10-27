"use client";

import { ClipboardCheck, Plus, Trash2 } from "lucide-react";

import { CampoDeMarcar, ChipSituacao } from "@/components/cadastros/comum";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  descricaoDoRequisito,
  ehTipoDeRequisito,
  LIMITES_DO_CADASTRO,
  ROTULO_DO_TIPO_DE_REQUISITO,
  TIPOS_DE_REQUISITO,
  VALOR_DO_TIPO,
  type RequisitoDoProcedimento,
  type RequisitoParaSalvar,
  type TipoDeRequisito,
} from "@/lib/domain/cadastro-para-o-agente";
import type { Convenio } from "@/lib/queries/catalogo";

// "O que o paciente precisa" no modal do Procedimento (cadastro para o
// agente, AG1; procedure_requirement): cada item tem o tipo (rotulos de
// recepcao), para quem vale (todos ou um convenio), o numero quando o tipo
// pede (minutos antes ou idade minima), o texto ao paciente (ate 300,
// conferido pelas regras do editor da base de conhecimento) e se esta
// ativo. A lista vai junto com o Salvar do procedimento
// (salvarRequisitosDoProcedimentoAction), depois da linha dele.

export const TEXTOS_DOS_REQUISITOS = {
  titulo: "O que o paciente precisa",
  ajuda:
    "O que o paciente precisa levar ou fazer para este procedimento. Cada item vale para todos ou só para um convênio.",
  vazio: "Nenhum item cadastrado.",
  adicionar: "Adicionar item",
  tipo: "O que é",
  paraQuem: "Para quem",
  todos: "Todos (particular e convênios)",
  texto: "O que dizer ao paciente",
  textoOpcional: "O que dizer ao paciente (opcional)",
  textoExemplo: "Ex.: Traga a carteirinha e um documento com foto.",
  textoAjuda:
    "O texto passa pelas mesmas regras das respostas do assistente: sem telefone, link, valor nem orientação de saúde.",
  ativo: "Item ativo",
  ativoDescricao: "Desmarcado, fica guardado e deixa de valer.",
  remover: "Remover",
  convenioInativo: "inativo",
  leituraVazia: "Nenhum item cadastrado.",
} as const;

const PARA_TODOS = "todos";

/** O item como a tela edita (o numero como digitado). */
export type RequisitoEmEdicao = {
  chave: string;
  id?: string;
  tipo: TipoDeRequisito;
  insurance_id: string | null;
  valor: string;
  texto: string;
  ativo: boolean;
};

export function requisitosParaEdicao(
  gravados: readonly RequisitoDoProcedimento[],
  novaChave: () => string,
): RequisitoEmEdicao[] {
  return gravados.map((r) => ({
    chave: novaChave(),
    id: r.id,
    tipo: r.tipo,
    insurance_id: r.insurance_id,
    valor: r.valor_inteiro === null ? "" : String(r.valor_inteiro),
    texto: r.texto_ao_paciente ?? "",
    ativo: r.ativo,
  }));
}

/**
 * O que vai para a action: o numero so no tipo que pede (o texto que nao e
 * inteiro vira NaN, que a conferencia recusa com a faixa do tipo), o texto
 * aparado (vazio e nulo).
 */
export function requisitosParaSalvar(
  edicao: readonly RequisitoEmEdicao[],
): RequisitoParaSalvar[] {
  return edicao.map((r) => {
    const pedeNumero = VALOR_DO_TIPO[r.tipo] !== undefined;
    const digitado = r.valor.trim();
    const valor = !pedeNumero
      ? null
      : digitado === ""
        ? null
        : /^[0-9]+$/.test(digitado)
          ? Number(digitado)
          : Number.NaN;
    return {
      ...(r.id ? { id: r.id } : {}),
      tipo: r.tipo,
      insurance_id: r.insurance_id,
      valor_inteiro: valor,
      texto_ao_paciente: r.texto.trim() || null,
      ativo: r.ativo,
    };
  });
}

/** "Unimed (Nacional)" ou "Unimed"; o convenio que sumiu do cadastro. */
export function nomeDoConvenioDoRequisito(
  convenios: readonly Convenio[],
  insuranceId: string | null,
): string {
  if (insuranceId === null) {
    return TEXTOS_DOS_REQUISITOS.todos;
  }
  const convenio = convenios.find((c) => c.id === insuranceId);
  if (!convenio) {
    return "Convênio removido";
  }
  return convenio.plan_name
    ? `${convenio.name} (${convenio.plan_name})`
    : convenio.name;
}

export function RequisitosDoProcedimento({
  requisitos,
  aoMudar,
  convenios,
  novaChave,
}: {
  requisitos: readonly RequisitoEmEdicao[];
  aoMudar: (proximos: RequisitoEmEdicao[]) => void;
  convenios: readonly Convenio[];
  novaChave: () => string;
}) {
  const mudar = (chave: string, mudanca: Partial<RequisitoEmEdicao>) =>
    aoMudar(
      requisitos.map((r) => (r.chave === chave ? { ...r, ...mudanca } : r)),
    );

  // Os convenios ativos, mais o inativo que algum item ja usa (para ele
  // continuar aparecendo e poder ser trocado).
  const emUso = new Set(
    requisitos.flatMap((r) => (r.insurance_id ? [r.insurance_id] : [])),
  );
  const opcoesDeConvenio = convenios.filter((c) => c.active || emUso.has(c.id));
  const cheio =
    requisitos.length >= LIMITES_DO_CADASTRO.requisitosPorProcedimento;

  return (
    <section
      aria-labelledby="proc-requisitos-titulo"
      className="grid gap-3 border-t border-border pt-4"
    >
      <div className="grid gap-1">
        <h3
          id="proc-requisitos-titulo"
          className="text-sm font-bold text-text-strong"
        >
          {TEXTOS_DOS_REQUISITOS.titulo}
        </h3>
        <p className="text-xs text-text-secondary">
          {TEXTOS_DOS_REQUISITOS.ajuda}
        </p>
      </div>
      {requisitos.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          {TEXTOS_DOS_REQUISITOS.vazio}
        </p>
      ) : (
        <ul className="grid gap-2">
          {requisitos.map((requisito, indice) => {
            const valor = VALOR_DO_TIPO[requisito.tipo];
            const id = `proc-req-${requisito.chave}`;
            const ehOutro = requisito.tipo === "outro";
            return (
              <li
                key={requisito.chave}
                className="grid gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-tipo`}>
                      {TEXTOS_DOS_REQUISITOS.tipo}
                    </Label>
                    <Select
                      value={requisito.tipo}
                      onValueChange={(tipo) => {
                        if (ehTipoDeRequisito(tipo)) {
                          mudar(requisito.chave, {
                            tipo,
                            valor: VALOR_DO_TIPO[tipo] ? requisito.valor : "",
                          });
                        }
                      }}
                    >
                      <SelectTrigger id={`${id}-tipo`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_DE_REQUISITO.map((tipo) => (
                          <SelectItem key={tipo} value={tipo}>
                            {ROTULO_DO_TIPO_DE_REQUISITO[tipo]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-convenio`}>
                      {TEXTOS_DOS_REQUISITOS.paraQuem}
                    </Label>
                    <Select
                      value={requisito.insurance_id ?? PARA_TODOS}
                      onValueChange={(valor) =>
                        mudar(requisito.chave, {
                          insurance_id: valor === PARA_TODOS ? null : valor,
                        })
                      }
                    >
                      <SelectTrigger id={`${id}-convenio`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PARA_TODOS}>
                          {TEXTOS_DOS_REQUISITOS.todos}
                        </SelectItem>
                        {opcoesDeConvenio.map((convenio) => (
                          <SelectItem key={convenio.id} value={convenio.id}>
                            {nomeDoConvenioDoRequisito(convenios, convenio.id)}
                            {convenio.active
                              ? ""
                              : ` (${TEXTOS_DOS_REQUISITOS.convenioInativo})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {valor ? (
                  <div className="grid gap-1.5 sm:max-w-[240px]">
                    <Label htmlFor={`${id}-valor`}>{valor.rotulo}</Label>
                    <Input
                      id={`${id}-valor`}
                      type="number"
                      inputMode="numeric"
                      min={valor.minimo}
                      max={valor.maximo}
                      step={1}
                      value={requisito.valor}
                      aria-describedby={`${id}-valor-ajuda`}
                      onChange={(e) =>
                        mudar(requisito.chave, { valor: e.target.value })
                      }
                      className="cz-num"
                    />
                    <p
                      id={`${id}-valor-ajuda`}
                      className="text-xs text-text-secondary"
                    >
                      De {valor.minimo} a {valor.maximo} {valor.unidade}.
                    </p>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`${id}-texto`}>
                      {ehOutro
                        ? TEXTOS_DOS_REQUISITOS.texto
                        : TEXTOS_DOS_REQUISITOS.textoOpcional}
                    </Label>
                    <span className="cz-num text-xs text-text-secondary">
                      {requisito.texto.length}/
                      {LIMITES_DO_CADASTRO.textoDoRequisito}
                    </span>
                  </div>
                  <Textarea
                    id={`${id}-texto`}
                    value={requisito.texto}
                    maxLength={LIMITES_DO_CADASTRO.textoDoRequisito}
                    rows={2}
                    placeholder={TEXTOS_DOS_REQUISITOS.textoExemplo}
                    aria-describedby={`${id}-texto-ajuda`}
                    onChange={(e) =>
                      mudar(requisito.chave, { texto: e.target.value })
                    }
                  />
                  <p
                    id={`${id}-texto-ajuda`}
                    className="text-xs text-text-secondary"
                  >
                    {TEXTOS_DOS_REQUISITOS.textoAjuda}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CampoDeMarcar
                    id={`${id}-ativo`}
                    rotulo={TEXTOS_DOS_REQUISITOS.ativo}
                    descricao={TEXTOS_DOS_REQUISITOS.ativoDescricao}
                    marcado={requisito.ativo}
                    aoMudar={(ativo) => mudar(requisito.chave, { ativo })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      aoMudar(
                        requisitos.filter((r) => r.chave !== requisito.chave),
                      )
                    }
                    aria-label={`${TEXTOS_DOS_REQUISITOS.remover} o item ${indice + 1}, ${ROTULO_DO_TIPO_DE_REQUISITO[requisito.tipo]}`}
                  >
                    <Trash2 aria-hidden /> {TEXTOS_DOS_REQUISITOS.remover}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={cheio}
        onClick={() =>
          aoMudar([
            ...requisitos,
            {
              chave: novaChave(),
              tipo: "documento_com_foto",
              insurance_id: null,
              valor: "",
              texto: "",
              ativo: true,
            },
          ])
        }
      >
        <Plus aria-hidden /> {TEXTOS_DOS_REQUISITOS.adicionar}
      </Button>
    </section>
  );
}

/** A lista em texto, para quem so ve (Ver detalhes). */
export function RequisitosSomenteLeitura({
  requisitos,
  convenios,
}: {
  requisitos: readonly RequisitoDoProcedimento[];
  convenios: readonly Convenio[];
}) {
  if (requisitos.length === 0) {
    return (
      <span className="text-text-secondary">
        {TEXTOS_DOS_REQUISITOS.leituraVazia}
      </span>
    );
  }
  return (
    <ul className="grid gap-2">
      {requisitos.map((requisito) => (
        <li key={requisito.id} className="grid gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <ClipboardCheck
              aria-hidden
              className="size-4 shrink-0 text-text-secondary"
            />
            <span className="font-semibold text-text-strong">
              {descricaoDoRequisito(requisito)}
            </span>
            <span className="text-text-secondary">
              {nomeDoConvenioDoRequisito(convenios, requisito.insurance_id)}
            </span>
            <ChipSituacao active={requisito.ativo} />
          </span>
          {requisito.texto_ao_paciente ? (
            <span className="whitespace-pre-wrap">
              {requisito.texto_ao_paciente}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
