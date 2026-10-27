"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DIAS_DO_HORARIO,
  FAIXA_NOVA,
  LIMITES_DO_CADASTRO,
  ROTULO_DO_DIA_DO_HORARIO,
  type DiaDoHorario,
  type HorarioEmEdicao,
} from "@/lib/domain/cadastro-para-o-agente";

// Editor do horario de funcionamento da unidade (cadastro para o agente,
// AG1): uma linha por dia, de domingo a sabado, como a jornada do
// profissional e o expediente do agente. Dia aberto tem de 1 a 4 faixas
// (manha e tarde = duas faixas); dia fechado e desmarcado e guarda as
// faixas que tinha ate o Salvar, para voltarem se ele reabrir. A regra
// (formato, fim depois do inicio, sem sobreposicao) e conferida no Salvar
// por problemasDoHorarioEmEdicao, com o dia em cada frase. Alvos de 40px.

export const TEXTOS_DO_HORARIO = {
  legenda: "Horário de funcionamento",
  ajuda:
    "Os dias e horários em que a unidade abre, no fuso da clínica. Almoço: crie duas faixas no mesmo dia. Dia fechado fica desmarcado.",
  fechado: "Fechado",
  aberto: "Aberto",
  adicionarFaixa: "Adicionar faixa",
  limiteDeFaixas: `No máximo ${LIMITES_DO_CADASTRO.faixasPorDia} faixas por dia.`,
} as const;

export function EditorDoHorarioDeFuncionamento({
  idBase,
  valor,
  aoMudar,
  novaChave,
  desabilitado = false,
}: {
  /** Prefixo dos ids dos campos (unico na tela) */
  idBase: string;
  valor: HorarioEmEdicao;
  aoMudar: (proximo: HorarioEmEdicao) => void;
  novaChave: () => string;
  desabilitado?: boolean;
}) {
  const mudarDia = (
    dia: DiaDoHorario,
    mudanca: Partial<HorarioEmEdicao[DiaDoHorario]>,
  ) => aoMudar({ ...valor, [dia]: { ...valor[dia], ...mudanca } });

  const abrirOuFechar = (dia: DiaDoHorario, aberto: boolean) => {
    const atual = valor[dia];
    // Abrir um dia sem faixa ja traz uma, para a pessoa so ajustar.
    const faixas =
      aberto && atual.faixas.length === 0
        ? [{ chave: novaChave(), ...FAIXA_NOVA }]
        : atual.faixas;
    mudarDia(dia, { aberto, faixas });
  };

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="text-sm font-bold text-text-strong">
        {TEXTOS_DO_HORARIO.legenda}
      </legend>
      <p className="text-xs text-text-secondary">{TEXTOS_DO_HORARIO.ajuda}</p>
      <ul className="grid gap-1.5 pt-1">
        {DIAS_DO_HORARIO.map((dia) => {
          const { aberto, faixas } = valor[dia];
          const rotulo = ROTULO_DO_DIA_DO_HORARIO[dia];
          const idDoDia = `${idBase}-dia-${dia}`;
          const cheio = faixas.length >= LIMITES_DO_CADASTRO.faixasPorDia;
          return (
            <li
              key={dia}
              className="grid items-start gap-x-3 gap-y-1.5 rounded-md bg-surface-4 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
            >
              <div className="flex min-h-10 items-center gap-3">
                <Checkbox
                  id={idDoDia}
                  checked={aberto}
                  disabled={desabilitado}
                  onCheckedChange={(marcado) =>
                    abrirOuFechar(dia, marcado === true)
                  }
                />
                <Label htmlFor={idDoDia} className="text-[13.5px]">
                  {rotulo}
                </Label>
                <span className="sr-only">
                  {aberto
                    ? TEXTOS_DO_HORARIO.aberto
                    : TEXTOS_DO_HORARIO.fechado}
                </span>
              </div>
              {aberto ? (
                <div className="grid gap-1.5">
                  {faixas.map((faixa, indice) => (
                    <div
                      key={faixa.chave}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Input
                        type="time"
                        value={faixa.inicio}
                        disabled={desabilitado}
                        onChange={(evento) =>
                          mudarDia(dia, {
                            faixas: faixas.map((f) =>
                              f.chave === faixa.chave
                                ? { ...f, inicio: evento.target.value }
                                : f,
                            ),
                          })
                        }
                        aria-label={`${rotulo}, faixa ${indice + 1}: início`}
                        className="w-[112px] cz-num"
                      />
                      <span className="text-[13px] text-text-secondary">
                        às
                      </span>
                      <Input
                        type="time"
                        value={faixa.fim}
                        disabled={desabilitado}
                        onChange={(evento) =>
                          mudarDia(dia, {
                            faixas: faixas.map((f) =>
                              f.chave === faixa.chave
                                ? { ...f, fim: evento.target.value }
                                : f,
                            ),
                          })
                        }
                        aria-label={`${rotulo}, faixa ${indice + 1}: fim`}
                        className="w-[112px] cz-num"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={desabilitado}
                        onClick={() => {
                          const restantes = faixas.filter(
                            (f) => f.chave !== faixa.chave,
                          );
                          // Sem faixa, o dia fecha (nao fica aberto e vazio).
                          mudarDia(dia, {
                            faixas: restantes,
                            aberto: restantes.length > 0,
                          });
                        }}
                        aria-label={`Remover a faixa ${indice + 1} de ${rotulo}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={desabilitado || cheio}
                      title={
                        cheio ? TEXTOS_DO_HORARIO.limiteDeFaixas : undefined
                      }
                      onClick={() =>
                        mudarDia(dia, {
                          faixas: [
                            ...faixas,
                            {
                              chave: novaChave(),
                              inicio: "13:00",
                              fim: "18:00",
                            },
                          ],
                        })
                      }
                    >
                      <Plus aria-hidden /> {TEXTOS_DO_HORARIO.adicionarFaixa}
                    </Button>
                    {cheio ? (
                      <p className="text-xs text-text-secondary">
                        {TEXTOS_DO_HORARIO.limiteDeFaixas}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p
                  aria-hidden
                  className="flex min-h-10 items-center text-[13px] text-text-secondary"
                >
                  {TEXTOS_DO_HORARIO.fechado}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
