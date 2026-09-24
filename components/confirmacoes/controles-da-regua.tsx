"use client";

import { CircleCheck, CirclePause, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  alternarReguaAction,
  salvarJanelaDaReguaAction,
} from "@/app/(app)/confirmacoes/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";
import { cn } from "@/lib/utils";

// Ativacao e janela de envio de UMA regua: o bloco que a Tela 2 (painel) e a
// Tela 7 (Automacoes) mostram identico. Extraido do painel na 4.8 para as
// duas telas usarem a MESMA regra (e as mesmas actions), nunca duas copias.
//
// As duas regras do dono continuam inteiras aqui:
// 1. A CLINICA informa a janela; o banco recusa ativar sem ela e o
//    interruptor fica desabilitado com dica ate la.
// 2. Primeira ativacao pede o registro da taxa de falta (linha de base).

const DIAS = [
  { valor: 0, curto: "Dom", longo: "domingo" },
  { valor: 1, curto: "Seg", longo: "segunda-feira" },
  { valor: 2, curto: "Ter", longo: "terça-feira" },
  { valor: 3, curto: "Qua", longo: "quarta-feira" },
  { valor: 4, curto: "Qui", longo: "quinta-feira" },
  { valor: 5, curto: "Sex", longo: "sexta-feira" },
  { valor: 6, curto: "Sáb", longo: "sábado" },
];

/** O tipo time do Postgres chega "HH:MM:SS"; o campo de hora quer "HH:MM". */
function horaCurta(valor: string | null | undefined): string {
  return valor ? valor.slice(0, 5) : "";
}

export function ControlesDaRegua({
  regua,
  rotuloLigar,
  rotuloLigada,
  rotuloDesligada,
  visivel,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  regua: ReguaDeConfirmacao;
  rotuloLigar: string;
  rotuloLigada: string;
  rotuloDesligada: string;
  /** Recarrega o rascunho da janela quando a tela reabre/troca. */
  visivel: boolean;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const [inicio, setInicio] = useState(horaCurta(regua.send_window_start));
  const [fim, setFim] = useState(horaCurta(regua.send_window_end));
  const [dias, setDias] = useState<number[]>(regua.send_weekdays ?? []);
  const [avisoAberto, setAvisoAberto] = useState(false);

  // O bloco abre com o que esta salvo, sempre: reabrir depois de desistir de
  // uma edicao nao pode mostrar rascunho.
  useEffect(() => {
    if (!visivel) {
      return;
    }
    setInicio(horaCurta(regua.send_window_start));
    setFim(horaCurta(regua.send_window_end));
    setDias(regua.send_weekdays ?? []);
  }, [visivel, regua]);

  const janelaSalva =
    regua.send_window_start !== null &&
    regua.send_window_end !== null &&
    (regua.send_weekdays?.length ?? 0) > 0;

  const alternarDia = (valor: number) =>
    setDias((atual) =>
      atual.includes(valor)
        ? atual.filter((dia) => dia !== valor)
        : [...atual, valor].sort(),
    );

  const salvarJanela = () => {
    iniciarTransicao(async () => {
      const resultado = await salvarJanelaDaReguaAction({
        cadence_id: regua.id,
        send_window_start: inicio,
        send_window_end: fim,
        send_weekdays: dias,
      });
      if (resultado.ok) {
        toast.success("Horário de envio salvo.");
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível salvar.");
    });
  };

  const alternar = (ativar: boolean) => {
    if (ativar && regua.primeira_ativacao) {
      setAvisoAberto(true);
      return;
    }
    aplicarAlternancia(ativar);
  };

  const aplicarAlternancia = (ativar: boolean) => {
    iniciarTransicao(async () => {
      const resultado = await alternarReguaAction({
        cadence_id: regua.id,
        ativar,
      });
      if (resultado.ok) {
        toast.success(ativar ? `${rotuloLigada}.` : `${rotuloDesligada}.`);
        await aoMudar();
        setAvisoAberto(false);
        return;
      }
      toast.error(resultado.error ?? "Não foi possível mudar a régua.");
    });
  };

  const janelaMudou =
    inicio !== horaCurta(regua.send_window_start) ||
    fim !== horaCurta(regua.send_window_end) ||
    dias.join(",") !== (regua.send_weekdays ?? []).join(",");

  const dicaDoInterruptor = !podeEditar
    ? dicaSemPermissao
    : !janelaSalva
      ? "Preencha e salve a hora de início, a hora de fim e os dias antes de ligar a régua"
      : null;

  const idInicio = `regua-inicio-${regua.id}`;
  const idFim = `regua-fim-${regua.id}`;

  return (
    <>
      {/* Situacao da regua, nas 3 camadas */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <span className="flex items-center gap-2">
          {regua.active ? (
            <CircleCheck
              className="size-4"
              style={{ color: "var(--success-text)" }}
              aria-hidden
            />
          ) : (
            <CirclePause
              className="size-4"
              style={{ color: "var(--neutral-text)" }}
              aria-hidden
            />
          )}
          <span className="text-sm font-medium">
            {regua.active ? rotuloLigada : rotuloDesligada}
          </span>
        </span>
        {dicaDoInterruptor ? (
          <span className="flex items-center gap-2">
            <Switch checked={regua.active} disabled aria-label={rotuloLigar} />
            <span className="max-w-56 text-xs text-text-tertiary">
              {dicaDoInterruptor}
            </span>
          </span>
        ) : (
          <Switch
            checked={regua.active}
            disabled={pendente}
            aria-label={rotuloLigar}
            onCheckedChange={alternar}
          />
        )}
      </div>

      {/* Prova de trabalho. "Regua ligada" sozinho nao diz nada. */}
      {regua.active ? (
        <p className="rounded-lg border px-3 py-2 text-xs text-text-secondary">
          {regua.enviados_24h > 0 ? (
            <>
              <strong>{regua.enviados_24h}</strong>{" "}
              {regua.enviados_24h === 1
                ? "mensagem enviada"
                : "mensagens enviadas"}{" "}
              nas últimas 24 horas
            </>
          ) : (
            "Nenhuma mensagem enviada nas últimas 24 horas. Se havia consultas no período, confira o aviso no topo da tela."
          )}
          {regua.pulados_24h > 0 ? (
            <>
              {". "}
              <strong>{regua.pulados_24h}</strong>{" "}
              {regua.pulados_24h === 1 ? "não saiu" : "não saíram"} (sem
              autorização, fora do horário ou WhatsApp fora do ar). O motivo de
              cada uma aparece na lista do dia.
            </>
          ) : null}
        </p>
      ) : null}

      {/* Janela de envio: a clinica informa */}
      <section className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">Horário de envio</h3>
          <p className="text-xs text-text-secondary">
            As mensagens só saem dentro desta faixa, no fuso da clínica. Um
            toque que vence fora dela espera a próxima abertura.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={idInicio}>Começa às</Label>
            <Input
              id={idInicio}
              type="time"
              className="h-10"
              value={inicio}
              disabled={!podeEditar || pendente}
              onChange={(e) => setInicio(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={idFim}>Termina às</Label>
            <Input
              id={idFim}
              type="time"
              className="h-10"
              value={fim}
              disabled={!podeEditar || pendente}
              onChange={(e) => setFim(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="pb-1.5 text-sm font-medium">Dias de envio</legend>
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((dia) => {
              const marcado = dias.includes(dia.valor);
              return (
                <button
                  key={dia.valor}
                  type="button"
                  aria-pressed={marcado}
                  aria-label={dia.longo}
                  disabled={!podeEditar || pendente}
                  onClick={() => alternarDia(dia.valor)}
                  className={cn(
                    "h-10 min-w-11 rounded-md border px-2 text-[13px] font-medium transition-colors disabled:opacity-50",
                    marcado
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "text-text-secondary hover:text-foreground",
                  )}
                >
                  {dia.curto}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex items-center gap-2">
          <Button
            className="h-10"
            disabled={!podeEditar || pendente || !janelaMudou}
            onClick={salvarJanela}
          >
            {pendente ? "Salvando..." : "Salvar horário"}
          </Button>
          {!podeEditar ? (
            <span className="text-xs text-text-tertiary">
              {dicaSemPermissao}
            </span>
          ) : null}
        </div>
      </section>

      {/* Primeira ativacao da clinica: o aviso da linha de base */}
      <Dialog open={avisoAberto} onOpenChange={setAvisoAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Antes de ligar, anote a taxa de falta</DialogTitle>
            <DialogDescription>
              Esta é a primeira vez que a clínica vai enviar mensagem
              automática.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 rounded-lg border p-3">
            <TriangleAlert
              className="size-5 shrink-0"
              style={{ color: "var(--warning-text)" }}
              aria-hidden
            />
            <p className="text-sm text-text-secondary">
              Registre agora a taxa de falta atual da clínica. É ela que prova o
              resultado depois: sem o número de antes, não existe comparação e o
              ganho da régua fica sem evidência.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              disabled={pendente}
              onClick={() => setAvisoAberto(false)}
            >
              Agora não
            </Button>
            <Button
              className="h-10"
              disabled={pendente}
              onClick={() => aplicarAlternancia(true)}
            >
              {pendente ? "Ligando..." : "Anotei, pode ligar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
