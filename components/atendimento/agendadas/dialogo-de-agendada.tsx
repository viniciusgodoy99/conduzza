"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  agendarMensagemAction,
  editarAgendadaAction,
} from "@/app/(app)/atendimento/agendadas-actions";
import { horaNaClinica } from "@/components/atendimento/fuso-da-clinica";
import { Aviso } from "@/components/shared/aviso";
import { MarcadorDoNumero } from "@/components/shared/marcador-do-numero";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CorDoNumero } from "@/lib/domain/cor-do-numero";
import { diaCivil } from "@/lib/domain/horarios";
import {
  atalhosDeData,
  descricaoDaEdicao,
  descricaoDoAgendamento,
  ERROS_DA_AGENDADA,
  limitesDaData,
  problemaNoTexto,
  tamanhoDoTexto,
  TEXTO_MAXIMO_DA_AGENDADA,
  textoDaPreviaDoAgendamento,
  validarQuando,
  type AgendadaDaLista,
} from "@/lib/domain/mensagem-agendada";
import { cn } from "@/lib/utils";

// Dialogo "Agendar mensagem" e "Editar mensagem agendada" (secoes 4.2 e 4.3
// do desenho, com a A1 do desenho final), na casca de 520px do dialogo de
// atividade. A data e a hora sao do relogio da CLINICA (regra 3.6): os
// atalhos so mudam a data, contada do dia civil da clinica, e a validacao e
// a mesma do gatilho proteger_mensagem_agendada (validarQuando). A Server
// Action valida de novo, e o banco de novo.
//
// O texto vem do campo do compositor e o campo so esvazia DEPOIS do ok (quem
// esvazia e o InboxClient, em aoConcluir). Enter quebra linha; Ctrl+Enter ou
// Cmd+Enter agenda.
//
// Enquanto "Agendando..." ou "Salvando...", o dialogo nao fecha (Esc, clique
// fora, X): a resposta da Server Action precisa de onde aparecer. Fechado no
// meio, a recusa sumia sem aviso e o sucesso valia apesar do gesto de
// cancelar (achado 29 da revisao).

/** Faltando menos que isto, a edicao avisa que pode perder para o envio. */
const QUASE_SAINDO_MS = 2 * 60_000;

/** O numero da conversa, so quando a clinica tem mais de um ativo. */
export type NumeroDoAgendamento = { nome: string; cor: CorDoNumero | null };

export type PedidoDeAgendada =
  | {
      tipo: "agendar";
      conversationId: string;
      /** o texto do campo do compositor, ou o da nao enviada */
      texto: string;
      /** "Agendar de novo": a nao enviada que sai da lista depois do ok */
      substitui: string | null;
      /** havia citacao pendurada no compositor */
      semCitacao: boolean;
      /** havia arquivo anexado no compositor */
      comAnexo: boolean;
    }
  | { tipo: "editar"; agendada: AgendadaDaLista };

export type ConclusaoDoAgendamento = {
  tipo: "agendar" | "editar";
  enviarEm: string;
  substitui: string | null;
};

export type DialogoDeAgendadaProps = {
  pedido: PedidoDeAgendada | null;
  aoFechar: () => void;
  /** Depois do ok, antes de fechar */
  aoConcluir: (conclusao: ConclusaoDoAgendamento) => void;
  /** A Server Action recusou: a lista confere de novo o que esta marcado */
  aoRecarregarLista: () => void;
  timezone: string;
  viewerId: string;
  /** O numero da conversa, so com mais de um numero ativo */
  numero: NumeroDoAgendamento | null;
};

/**
 * O pedido de fechar (Esc, clique fora, X) vale? Nao enquanto a Server
 * Action esta em curso.
 */
export function fechamentoPermitido(enviando: boolean): boolean {
  return !enviando;
}

export function DialogoDeAgendada(props: DialogoDeAgendadaProps) {
  // O envio mora no formulario (ConteudoDoDialogo); a casca so precisa saber
  // se ele esta em curso para recusar o fechamento.
  const [enviando, setEnviando] = useState(false);
  return (
    <Dialog
      open={props.pedido !== null}
      onOpenChange={(abrir) => {
        if (!abrir && fechamentoPermitido(enviando)) {
          props.aoFechar();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[520px]"
        onEscapeKeyDown={(evento) => {
          if (!fechamentoPermitido(enviando)) {
            evento.preventDefault();
          }
        }}
        onInteractOutside={(evento) => {
          if (!fechamentoPermitido(enviando)) {
            evento.preventDefault();
          }
        }}
      >
        {/* O conteudo desmonta ao fechar: cada abertura recomeca limpa, com
            um id novo para o agendamento. */}
        {props.pedido ? (
          <ConteudoDoDialogo
            {...props}
            pedido={props.pedido}
            aoMudarEnvio={setEnviando}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const valoresSchema = z.object({
  texto: z.string().superRefine((texto, ctx) => {
    const problema = problemaNoTexto(texto);
    if (problema) {
      ctx.addIssue({ code: "custom", message: problema });
    }
  }),
  data: z.string().trim().min(1, ERROS_DA_AGENDADA.semData),
  hora: z.string().trim().min(1, ERROS_DA_AGENDADA.semHora),
});

type Valores = z.infer<typeof valoresSchema>;

/** Em qual campo o erro de validarQuando aparece. */
export function campoDoErroDeQuando(
  erro: string,
  data: string,
  hoje: string,
): "data" | "hora" {
  if (erro === ERROS_DA_AGENDADA.semHora) {
    return "hora";
  }
  if (erro === ERROS_DA_AGENDADA.horaPassada) {
    // A hora que passou num dia que tambem ja passou: o problema e o dia.
    return data && data < hoje ? "data" : "hora";
  }
  return "data";
}

function ConteudoDoDialogo({
  pedido,
  aoFechar,
  aoConcluir,
  aoRecarregarLista,
  timezone,
  viewerId,
  numero,
  aoMudarEnvio,
}: DialogoDeAgendadaProps & {
  pedido: PedidoDeAgendada;
  /** Avisa a casca quando o envio comeca e termina */
  aoMudarEnvio: (enviando: boolean) => void;
}) {
  const editando = pedido.tipo === "editar";
  // O id da agendada nova nasce na abertura e vale para todas as tentativas
  // desta abertura: um duplo envio cai na mesma linha (a Server Action rele
  // pelo id).
  const [idNovo] = useState(() => crypto.randomUUID());
  // O dia de hoje na clinica, fixado na abertura (atalhos, min e max).
  const [hoje] = useState(() => diaCivil(timezone, new Date()));
  const atalhos = useMemo(() => atalhosDeData(hoje), [hoje]);
  const limites = useMemo(() => limitesDaData(hoje), [hoje]);
  // Relogio da previa e do "sai em instantes", conferido a cada 15 s.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 15_000);
    return () => window.clearInterval(relogio);
  }, []);
  const [erro, setErro] = useState<string | null>(null);

  const form = useForm<Valores>({
    resolver: zodResolver(valoresSchema),
    defaultValues: editando
      ? {
          texto: pedido.agendada.texto ?? "",
          data: diaCivil(timezone, new Date(pedido.agendada.enviarEm)),
          hora: horaNaClinica(pedido.agendada.enviarEm, timezone),
        }
      : { texto: pedido.texto, data: "", hora: "" },
  });
  const enviando = form.formState.isSubmitting;
  useEffect(() => {
    aoMudarEnvio(enviando);
  }, [enviando, aoMudarEnvio]);
  // Desmontado no meio do envio (a conversa saiu do alcance), a casca volta
  // a deixar fechar.
  useEffect(() => () => aoMudarEnvio(false), [aoMudarEnvio]);
  const texto = form.watch("texto");
  const data = form.watch("data");
  const hora = form.watch("hora");
  const tamanho = tamanhoDoTexto(texto.trim());

  // A previa so aparece com data e hora validas (e o mesmo criterio do envio).
  const quando = validarQuando({ data, hora, agora, fuso: timezone });
  const previa = quando.ok
    ? textoDaPreviaDoAgendamento(quando.enviarEm, timezone)
    : "";

  const quaseSaindo =
    editando &&
    new Date(pedido.agendada.enviarEm).getTime() - agora < QUASE_SAINDO_MS;

  const enviar = async (valores: Valores) => {
    setErro(null);
    const conferido = validarQuando({
      data: valores.data,
      hora: valores.hora,
      agora: Date.now(),
      fuso: timezone,
    });
    if (!conferido.ok) {
      form.setError(campoDoErroDeQuando(conferido.erro, valores.data, hoje), {
        message: conferido.erro,
      });
      return;
    }
    const corpo = valores.texto.trim();
    // O instante que vale e o gravado: no duplo envio, o da linha que ja
    // existia.
    let enviarEm = conferido.enviarEm;
    try {
      const resultado =
        pedido.tipo === "agendar"
          ? await agendarMensagemAction({
              id: idNovo,
              conversationId: pedido.conversationId,
              texto: corpo,
              data: valores.data,
              hora: valores.hora,
              ...(pedido.substitui ? { substitui: pedido.substitui } : {}),
            })
          : await editarAgendadaAction({
              id: pedido.agendada.id,
              texto: corpo,
              data: valores.data,
              hora: valores.hora,
            });
      if (!resultado.ok) {
        // O dialogo nao fecha: o texto continua aqui. A lista confere de
        // novo (a agendada pode ter comecado a sair, ou o teto mudou).
        setErro(resultado.error);
        aoRecarregarLista();
        return;
      }
      const gravado = "enviarEm" in resultado ? resultado.enviarEm : null;
      if (typeof gravado === "string" && gravado) {
        enviarEm = gravado;
      }
    } catch {
      setErro(
        editando
          ? "Não foi possível salvar a mudança. O texto continua aqui."
          : ERROS_DA_AGENDADA.naoAgendou,
      );
      return;
    }
    aoConcluir({
      tipo: pedido.tipo,
      enviarEm,
      substitui: pedido.tipo === "agendar" ? pedido.substitui : null,
    });
    aoFechar();
  };

  const submeter = () => void form.handleSubmit(enviar)();

  const descricao =
    pedido.tipo === "editar"
      ? descricaoDaEdicao(pedido.agendada, viewerId)
      : descricaoDoAgendamento(numero?.nome ?? null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editando ? "Editar mensagem agendada" : "Agendar mensagem"}
        </DialogTitle>
        <DialogDescription
          className={cn(
            !editando && numero ? "flex items-baseline gap-1.5" : undefined,
          )}
        >
          {!editando && numero ? (
            <MarcadorDoNumero cor={numero.cor} className="translate-y-px" />
          ) : null}
          <span>{descricao}</span>
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            submeter();
          }}
        >
          <FormField
            control={form.control}
            name="texto"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mensagem</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={4}
                    autoFocus
                    className="max-h-[240px]"
                    onKeyDown={(evento) => {
                      // Enter quebra linha; Ctrl+Enter ou Cmd+Enter agenda.
                      if (
                        evento.key === "Enter" &&
                        (evento.ctrlKey || evento.metaKey) &&
                        !evento.nativeEvent.isComposing
                      ) {
                        evento.preventDefault();
                        submeter();
                      }
                    }}
                  />
                </FormControl>
                {/* O contador e a descricao do campo: o FormControl liga
                    a ele (e ao erro, quando houver) pelo aria-describedby. */}
                <FormDescription
                  className={cn(
                    "justify-self-end cz-num text-[12px]",
                    tamanho > TEXTO_MAXIMO_DA_AGENDADA
                      ? "font-semibold text-alert-text"
                      : "text-text-secondary",
                  )}
                >
                  {tamanho} de {TEXTO_MAXIMO_DA_AGENDADA}
                </FormDescription>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />

          <fieldset className="grid gap-3">
            <legend className="mb-3 text-[13.5px] font-semibold text-text-strong">
              Quando
            </legend>
            <div
              role="group"
              aria-label="Atalhos de data"
              className="flex flex-wrap gap-2"
            >
              {atalhos.map((atalho) => {
                const ligado = data === atalho.data;
                return (
                  <Button
                    key={atalho.rotulo}
                    type="button"
                    variant="outline"
                    aria-pressed={ligado}
                    className={cn(
                      ligado &&
                        "border-text-strong bg-surface-3 font-bold text-text-strong",
                    )}
                    onClick={() =>
                      form.setValue("data", atalho.data, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                  >
                    {ligado ? <Check aria-hidden /> : null}
                    {atalho.rotulo}
                  </Button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-[200px_160px]">
              <FormField
                control={form.control}
                name="data"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        min={limites.min}
                        max={limites.max}
                        className="w-full cz-num"
                      />
                    </FormControl>
                    <FormMessage className="text-[13px]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="hora"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hora</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="time"
                        required
                        className="w-full cz-num"
                      />
                    </FormControl>
                    <FormMessage className="text-[13px]" />
                  </FormItem>
                )}
              />
            </div>
          </fieldset>

          {/* Montada sempre: a regiao viva precisa existir antes de mudar. */}
          <p
            aria-live="polite"
            className={cn(
              "text-[13px] text-text-strong",
              previa ? undefined : "sr-only",
            )}
          >
            {previa}
          </p>

          {pedido.tipo === "agendar" && pedido.semCitacao ? (
            <Aviso tom="info" role="note">
              A mensagem agendada sai sem a citação.
            </Aviso>
          ) : null}
          {pedido.tipo === "agendar" && pedido.comAnexo ? (
            <Aviso tom="info" role="note">
              Só o texto é agendado. O arquivo anexado continua aqui para enviar
              agora.
            </Aviso>
          ) : null}
          {quaseSaindo ? (
            <Aviso tom="warning" role="note">
              Esta mensagem sai em instantes. Se ela começar a sair antes de
              você salvar, a mudança não vale.
            </Aviso>
          ) : null}

          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={enviando}>
                Voltar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={enviando}>
              {/* Sem o ClockPlus: ele e so o botao do compositor (tabela de
                  icones reservados, lib/design/status). */}
              <Check aria-hidden className="size-4" />
              {editando
                ? enviando
                  ? "Salvando..."
                  : "Salvar"
                : enviando
                  ? "Agendando..."
                  : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
