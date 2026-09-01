"use client";

import { useQueryClient } from "@tanstack/react-query";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  PASSOS_CONFIRMACAO,
  PASSOS_POS_FALTA,
} from "@/lib/domain/textos-padrao";
import {
  confirmacoesKeys,
  type ReguaDeConfirmacao,
  type ReguasDaClinica,
} from "@/lib/queries/confirmacoes";
import { cn } from "@/lib/utils";

// Painel de ativacao das reguas. A Tela 7 (Automacoes) e a tarefa 4.8: sem
// este painel ninguem consegue ligar uma regua, e uma regua que nasce
// desligada e nunca pode ser ligada nao serve para nada.
//
// As DUAS reguas que o seed cria aparecem aqui, cada uma com sua janela e seu
// interruptor: a de confirmacao (tres toques antes da consulta) e a de
// recuperacao depois da falta (dois toques depois). O motor executa as duas;
// deixar a segunda sem tela de ativacao seria construir metade do caminho.
//
// Duas regras do dono do produto aparecem aqui inteiras:
// 1. A CLINICA informa a janela de envio. Nao existe horario padrao no
//    codigo, e o banco recusa ativar sem janela (check active_exige_janela).
//    O interruptor fica visivel e DESABILITADO com dica ate a janela existir.
// 2. Antes da PRIMEIRA mensagem, registre a taxa de falta atual. E ela que
//    prova o resultado depois, e depois de ligar nao da mais para medir o
//    "antes".
//
// Os textos ficam em LEITURA: editar modelo e a Tela 7.

const DIAS = [
  { valor: 0, curto: "Dom", longo: "domingo" },
  { valor: 1, curto: "Seg", longo: "segunda-feira" },
  { valor: 2, curto: "Ter", longo: "terça-feira" },
  { valor: 3, curto: "Qua", longo: "quarta-feira" },
  { valor: 4, curto: "Qui", longo: "quinta-feira" },
  { valor: 5, curto: "Sex", longo: "sexta-feira" },
  { valor: 6, curto: "Sáb", longo: "sábado" },
];

type TipoDeRegua = "confirmacao" | "pos_falta";

/** O que muda de uma regua para a outra na tela. */
const COPY: Record<
  TipoDeRegua,
  {
    aba: string;
    descricao: string;
    ligar: string;
    ligada: string;
    desligada: string;
    tituloDosPassos: string;
    descricaoDosPassos: string;
    vazio: string;
  }
> = {
  confirmacao: {
    aba: "Confirmação",
    descricao:
      "Três mensagens automáticas antes da consulta, com os botões Confirmar, Remarcar e Cancelar.",
    ligar: "Ligar a régua de confirmação",
    ligada: "Régua ligada",
    desligada: "Régua desligada",
    tituloDosPassos: "As três mensagens",
    descricaoDosPassos:
      "Os campos entre chaves são preenchidos com os dados da consulta na hora do envio. Editar o texto é a tela de Automações.",
    vazio: "Esta clínica ainda não tem a régua de confirmação configurada.",
  },
  pos_falta: {
    aba: "Depois da falta",
    descricao:
      "Duas mensagens depois de uma falta, para trazer o paciente de volta à agenda.",
    ligar: "Ligar a régua de recuperação depois da falta",
    ligada: "Recuperação ligada",
    desligada: "Recuperação desligada",
    tituloDosPassos: "As duas mensagens",
    descricaoDosPassos:
      "Saem só para quem foi marcado como falta na tela de confirmações. Editar o texto é a tela de Automações.",
    vazio: "Esta clínica ainda não tem a régua de recuperação configurada.",
  },
};

const ROTULO_POR_OFFSET = new Map(
  [...PASSOS_CONFIRMACAO, ...PASSOS_POS_FALTA].map((passo) => [
    passo.offsetMinutes,
    passo.rotulo,
  ]),
);

/** "72 horas antes" para os passos padrao; conta as horas para os demais. */
function rotuloDoPasso(offsetMinutes: number): string {
  const conhecido = ROTULO_POR_OFFSET.get(offsetMinutes);
  if (conhecido) {
    return conhecido;
  }
  const horas = Math.round(Math.abs(offsetMinutes) / 60);
  return offsetMinutes < 0 ? `${horas} horas antes` : `${horas} horas depois`;
}

/** O tipo time do Postgres chega "HH:MM:SS"; o campo de hora quer "HH:MM". */
function horaCurta(valor: string | null | undefined): string {
  return valor ? valor.slice(0, 5) : "";
}

export function PainelRegua({
  clinicId,
  reguas,
  aberto,
  onFechar,
  podeEditar,
  dicaSemPermissao,
}: {
  clinicId: string;
  reguas: ReguasDaClinica | null;
  aberto: boolean;
  onFechar: () => void;
  podeEditar: boolean;
  dicaSemPermissao: string;
}) {
  const [tipo, setTipo] = useState<TipoDeRegua>("confirmacao");
  const copy = COPY[tipo];
  const regua =
    tipo === "confirmacao" ? reguas?.confirmacao : reguas?.pos_falta;

  return (
    <Sheet open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>Mensagens automáticas</SheetTitle>
          <SheetDescription>{copy.descricao}</SheetDescription>
        </SheetHeader>

        {/* Segmentador, nao aba ARIA: role="tab" obriga tabpanel associado e
            navegacao por seta, e aqui o conteudo abaixo nao e um painel
            declarado. aria-pressed diz a mesma coisa sem prometer o que a tela
            nao cumpre, e e o mesmo padrao do segmentador do Inbox. */}
        <div className="px-4">
          <div
            role="group"
            aria-label="Tipo de régua"
            className="grid grid-cols-2 rounded-lg bg-surface-3 p-0.5 text-[12.5px] font-medium"
          >
            {(Object.keys(COPY) as TipoDeRegua[]).map((valor) => (
              <button
                key={valor}
                type="button"
                aria-pressed={tipo === valor}
                onClick={() => setTipo(valor)}
                className={cn(
                  // h-10: alvo de toque mínimo de 40px da seção 5 do CLAUDE.md.
                  "h-10 rounded-md transition-colors",
                  tipo === valor
                    ? "bg-surface-5 text-foreground"
                    : "text-text-secondary hover:text-foreground",
                )}
              >
                {COPY[valor].aba}
              </button>
            ))}
          </div>
        </div>

        {!regua ? (
          <div className="p-4 text-sm text-text-secondary">{copy.vazio}</div>
        ) : (
          <BlocoDaRegua
            key={regua.id}
            clinicId={clinicId}
            regua={regua}
            copy={copy}
            aberto={aberto}
            podeEditar={podeEditar}
            dicaSemPermissao={dicaSemPermissao}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function BlocoDaRegua({
  clinicId,
  regua,
  copy,
  aberto,
  podeEditar,
  dicaSemPermissao,
}: {
  clinicId: string;
  regua: ReguaDeConfirmacao;
  copy: (typeof COPY)[TipoDeRegua];
  aberto: boolean;
  podeEditar: boolean;
  dicaSemPermissao: string;
}) {
  const queryClient = useQueryClient();
  const [pendente, iniciarTransicao] = useTransition();
  const [inicio, setInicio] = useState(horaCurta(regua.send_window_start));
  const [fim, setFim] = useState(horaCurta(regua.send_window_end));
  const [dias, setDias] = useState<number[]>(regua.send_weekdays ?? []);
  const [avisoAberto, setAvisoAberto] = useState(false);

  // O painel abre com o que esta salvo, sempre: reabrir depois de desistir de
  // uma edicao nao pode mostrar rascunho.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    setInicio(horaCurta(regua.send_window_start));
    setFim(horaCurta(regua.send_window_end));
    setDias(regua.send_weekdays ?? []);
  }, [aberto, regua]);

  const invalidar = () =>
    queryClient.invalidateQueries({
      queryKey: confirmacoesKeys.regua(clinicId),
    });

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
        await invalidar();
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
        toast.success(ativar ? `${copy.ligada}.` : `${copy.desligada}.`);
        await invalidar();
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
      <div className="grid gap-6 p-4">
        {/* Situacao da regua, nas 3 camadas */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <span className="flex items-center gap-2">
            {regua.active ? (
              <CircleCheck
                strokeWidth={1.5}
                className="size-4"
                style={{ color: "var(--success-text)" }}
                aria-hidden
              />
            ) : (
              <CirclePause
                strokeWidth={1.5}
                className="size-4"
                style={{ color: "var(--neutral-text)" }}
                aria-hidden
              />
            )}
            <span className="text-sm font-medium">
              {regua.active ? copy.ligada : copy.desligada}
            </span>
          </span>
          {dicaDoInterruptor ? (
            <span className="flex items-center gap-2">
              <Switch checked={regua.active} disabled aria-label={copy.ligar} />
              <span className="max-w-56 text-xs text-text-tertiary">
                {dicaDoInterruptor}
              </span>
            </span>
          ) : (
            <Switch
              checked={regua.active}
              disabled={pendente}
              aria-label={copy.ligar}
              onCheckedChange={alternar}
            />
          )}
        </div>

        {/* Prova de trabalho. "Régua ligada" sozinho não diz nada: uma régua
            ligada com o motor parado fica idêntica a uma régua trabalhando, e
            a clínica só descobria pelo paciente que faltou. */}
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
                autorização, fora do horário ou WhatsApp fora do ar). O motivo
                de cada uma aparece na lista do dia.
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
            <legend className="pb-1.5 text-sm font-medium">
              Dias de envio
            </legend>
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

        {/* Os toques, em leitura */}
        <section className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold">{copy.tituloDosPassos}</h3>
            <p className="text-xs text-text-secondary">
              {copy.descricaoDosPassos}
            </p>
          </div>
          {regua.passos.map((passo) => (
            <article
              key={passo.id}
              className="grid gap-1.5 rounded-lg border p-3"
            >
              <span className="text-[12.5px] font-semibold">
                {rotuloDoPasso(passo.offset_minutes)}
              </span>
              <p className="text-[13px] whitespace-pre-line text-text-secondary">
                {passo.fixed_body ?? "Sem texto cadastrado."}
              </p>
            </article>
          ))}
        </section>
      </div>

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
              strokeWidth={1.5}
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
