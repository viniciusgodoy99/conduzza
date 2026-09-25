"use client";

import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  alternarReguaAction,
  salvarJanelaDaReguaAction,
} from "@/app/(app)/confirmacoes/actions";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
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
import { REGUA_STATUS } from "@/lib/design/status";
import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";
import { cn } from "@/lib/utils";

// Ativacao e janela de envio de UMA regua: o bloco que a Tela 2 (painel) e a
// Tela 7 (Automacoes) mostram identico. Extraido do painel na 4.8 para as
// duas telas usarem a MESMA regra (e as mesmas actions), nunca duas copias.
//
// As duas regras do dono continuam inteiras aqui:
// 1. A CLINICA informa a janela; o banco recusa ativar sem ela e o
//    interruptor fica desabilitado com dica ate la.
// 2. Ligar a regua de CONFIRMACAO sem linha de base registrada pede o
//    registro da taxa de falta (achado 49: antes o aviso seguia "a clinica
//    nunca enviou", aparecia no follow-up e mandava registrar sem dizer onde).

/** Qual regua e: decide os textos de apoio (achado 54). */
export type TipoDaReguaDosControles = "confirmacao" | "pos_falta" | "followup";

// Prova de trabalho por tipo: o aviso do topo da tela e a faixa global do
// shell (WhatsApp desconectado ou envio parado); onde ver o motivo de cada
// mensagem que nao saiu depende da regua (so a confirmacao tem a lista do
// dia com o motivo por consulta).
const PROVA_DE_TRABALHO: Record<
  TipoDaReguaDosControles,
  { semEnvio: string; motivo: string }
> = {
  confirmacao: {
    semEnvio:
      "Nenhuma mensagem enviada nas últimas 24 horas. Se havia consultas para confirmar no período, veja se há aviso no topo da tela (WhatsApp desconectado ou envio parado).",
    motivo: "O motivo de cada uma aparece na lista do dia, em Confirmações.",
  },
  pos_falta: {
    semEnvio:
      "Nenhuma mensagem enviada nas últimas 24 horas. Se alguém faltou no período, veja se há aviso no topo da tela (WhatsApp desconectado ou envio parado).",
    motivo:
      "Os motivos aparecem nos números dos últimos 30 dias da régua, em Automações.",
  },
  followup: {
    semEnvio:
      "Nenhuma mensagem enviada nas últimas 24 horas. Se havia leads parados nesta etapa no período, veja se há aviso no topo da tela (WhatsApp desconectado ou envio parado).",
    motivo: "Os motivos aparecem nos números dos últimos 30 dias da régua.",
  },
};

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
  tipo,
  rotuloLigar,
  rotuloLigada,
  rotuloDesligada,
  visivel,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  aoMudar,
}: {
  regua: ReguaDeConfirmacao;
  tipo: TipoDaReguaDosControles;
  rotuloLigar: string;
  rotuloLigada: string;
  rotuloDesligada: string;
  /** Recarrega o rascunho da janela quando a tela reabre/troca. */
  visivel: boolean;
  podeEditar: boolean;
  dicaSemPermissao: string;
  /**
   * So o administrador registra a linha de base (policy "admin registra
   * linha de base"): para o gestor, o aviso diz a quem pedir.
   */
  ehAdministrador: boolean;
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
    // So a confirmacao e so sem linha de base (a query ja decide os dois).
    if (ativar && regua.pede_linha_de_base) {
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
  const prova = PROVA_DE_TRABALHO[tipo];

  const botaoSalvar = (
    <Button
      variant="outline"
      disabled={!podeEditar || pendente || !janelaMudou}
      onClick={salvarJanela}
    >
      {pendente ? "Salvando..." : "Salvar horário"}
    </Button>
  );

  return (
    <>
      {/* Situacao da regua, nas 3 camadas (REGUA_STATUS com o rotulo da
          tela), e o interruptor. Travado, o interruptor e a dica ficam no
          MESMO pai: e ele que o e2e foca para ler a dica. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-4 px-3.5 py-3">
        <StatusChip
          definition={REGUA_STATUS[regua.active ? "ligada" : "desligada"]}
          label={regua.active ? rotuloLigada : rotuloDesligada}
        />
        {dicaDoInterruptor ? (
          <span className="flex items-center gap-2.5">
            <span className="max-w-60 text-right text-xs text-text-secondary">
              {dicaDoInterruptor}
            </span>
            <Switch checked={regua.active} disabled aria-label={rotuloLigar} />
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
        <p className="text-[12.5px] text-text-secondary">
          {regua.enviados_24h > 0 ? (
            <>
              <span className="cz-num font-semibold text-text-strong">
                {regua.enviados_24h}
              </span>{" "}
              {regua.enviados_24h === 1
                ? "mensagem enviada"
                : "mensagens enviadas"}{" "}
              nas últimas 24 horas.
            </>
          ) : (
            prova.semEnvio
          )}
          {regua.pulados_24h > 0 ? (
            <>
              {" "}
              <span className="cz-num font-semibold text-text-strong">
                {regua.pulados_24h}
              </span>{" "}
              {regua.pulados_24h === 1 ? "não saiu" : "não saíram"} (sem
              autorização, fora do horário ou WhatsApp fora do ar).{" "}
              {prova.motivo}
            </>
          ) : null}
        </p>
      ) : null}

      {/* Janela de envio: a clinica informa */}
      <section className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-bold">Horário de envio</h3>
          <p className="text-xs text-text-secondary">
            As mensagens só saem dentro desta faixa, no fuso da clínica. Um
            toque que vence fora dela espera a próxima abertura.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:max-w-[360px]">
          <div className="grid gap-1.5">
            <Label htmlFor={idInicio}>Começa às</Label>
            <Input
              id={idInicio}
              type="time"
              className="cz-num"
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
              className="cz-num"
              value={fim}
              disabled={!podeEditar || pendente}
              onChange={(e) => setFim(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="pb-2 text-xs font-semibold text-foreground">
            Dias de envio
          </legend>
          {/* Receita "escolha em chip" (docs/06 secao 4.7): escolhido em lime
              suave com borda e o sinal de marcado, nunca preenchido de lime.
              O nome acessivel e o dia por extenso (o e2e clica por ele). */}
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
                    "inline-flex h-10 min-w-11 items-center justify-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-45",
                    marcado
                      ? "border-primary-edge bg-primary-soft font-semibold text-primary-text"
                      : "border-input bg-card text-foreground hover:bg-surface-3",
                  )}
                >
                  {marcado ? <Check className="size-3.5" aria-hidden /> : null}
                  {dia.curto}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex items-center gap-2">
          {podeEditar ? (
            botaoSalvar
          ) : (
            <DisabledWithHint hint={dicaSemPermissao}>
              {botaoSalvar}
            </DisabledWithHint>
          )}
        </div>
      </section>

      {/* Regua de confirmacao sem linha de base: o aviso diz ONDE registrar
          (Resultados, aba Confirmacao) e, para quem nao e administrador, a
          quem pedir, porque so o administrador registra (achado 49). */}
      <Dialog open={avisoAberto} onOpenChange={setAvisoAberto}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Antes de ligar, anote a taxa de falta</DialogTitle>
            <DialogDescription>
              {regua.primeira_ativacao
                ? "Esta é a primeira vez que a clínica vai enviar mensagem automática."
                : "A clínica ainda não registrou a taxa de falta de antes das mensagens automáticas."}
            </DialogDescription>
          </DialogHeader>
          <Aviso tom="warning" role="note">
            <p>
              {ehAdministrador
                ? "Registre a taxa de falta atual da clínica em Resultados, aba Confirmação."
                : "Peça a quem administra a clínica para registrar a taxa de falta em Resultados."}{" "}
              É ela que prova o resultado depois: sem o número de antes, não
              existe comparação e o ganho da régua fica sem evidência.
            </p>
            {ehAdministrador ? (
              <Link
                href="/relatorios?aba=confirmacao"
                className="mt-1 inline-flex min-h-10 items-center gap-1 rounded-sm font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
              >
                Registrar a taxa de falta
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </Aviso>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setAvisoAberto(false)}
            >
              Agora não
            </Button>
            <Button
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
