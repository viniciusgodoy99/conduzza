"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import {
  criarAtividadeAction,
  editarAtividadeAction,
} from "@/app/(app)/atividades/actions";
import { BuscaDeContato } from "@/components/atividades/busca-de-contato";
import {
  opcoesDeResponsavel,
  useEquipeDaAtividade,
} from "@/components/atividades/use-equipe-da-atividade";
import { Aviso } from "@/components/shared/aviso";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  atalhosDePrazo,
  DETALHES_MAX,
  formularioDeAtividadeSchema,
  hojeNaClinica,
  horaDoPrazo,
  problemaNoPrazoNovo,
  TITULO_MAX,
  type ValoresDoFormularioDeAtividade,
} from "@/lib/domain/atividades";
import { formatarTelefone } from "@/lib/domain/telefone";
import type {
  AtividadeResumo,
  ContatoDaAtividade,
  EquipeDaAtividade,
} from "@/lib/queries/atividades";
import { cn } from "@/lib/utils";

// Dialogo compartilhado de atividade (modal central de 520px): cria pelo
// drawer do lead, pelo painel da conversa, pela ficha e pela tela
// Atividades (com a busca de paciente), e edita pela linha. react-hook-form
// com o mesmo Zod de lib/domain/atividades; a Server Action valida de novo.
//
// Prazo: "Para quando" e o dia civil DA CLINICA (atalhos Amanhã, Em 7 dias e
// Em 30 dias contados de hoje na clinica, ou a data escolhida) e a "Hora" e
// opcional, no relogio da clinica (regra 3.6). Responsavel: membros ativos,
// com padrao quem esta criando.

/** Valor do Select para "Sem responsável" (o Radix nao aceita vazio). */
const SEM = "__sem__";

export type DialogoDeAtividadeProps = {
  aberto: boolean;
  aoFechar: () => void;
  /** Depois de salvar: o id da atividade criada ou editada */
  aoSalvar: (id: string) => void;
  /** A clinica ativa: busca de contato e chave da equipe. Ausente no
   *  painel da conversa, que ja entrega a equipe pronta. */
  clinicId?: string;
  timezone: string;
  /** A atividade editada; ausente cria uma nova */
  atividade?: AtividadeResumo | null;
  /** Contato fixo da criacao; null mostra a busca (tela Atividades) */
  contato?: ContatoDaAtividade | null;
  /** Conversa de onde a atividade foi criada (painel do Atendimento) */
  conversationId?: string | null;
  /** A equipe, quando quem abre ja a tem; senao o dialogo busca ao abrir */
  equipe?: EquipeDaAtividade;
};

export function DialogoDeAtividade(props: DialogoDeAtividadeProps) {
  return (
    <Dialog
      open={props.aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          props.aoFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        {/* O conteudo desmonta ao fechar: o formulario recomeca limpo. */}
        {props.aberto ? <ConteudoDoDialogo {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ConteudoDoDialogo({
  aoFechar,
  aoSalvar,
  clinicId,
  timezone,
  atividade,
  contato,
  conversationId,
  equipe: equipeDada,
}: DialogoDeAtividadeProps) {
  const editando = Boolean(atividade);
  // Equipe dada (tela, ficha, conversa) vale direto; sem ela, busca.
  const equipeQuery = useEquipeDaAtividade(
    clinicId ?? "",
    equipeDada === undefined,
  );
  const equipe = equipeDada ?? equipeQuery.data;

  const titulo = editando ? "Editar atividade" : "Nova atividade";
  const descricao = editando
    ? "Mude o que fazer, o prazo ou quem cuida dela."
    : "Um lembrete do que fazer com este contato, e para quando.";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>{descricao}</DialogDescription>
      </DialogHeader>
      {equipe ? (
        <FormularioDeAtividade
          aoFechar={aoFechar}
          aoSalvar={aoSalvar}
          clinicId={clinicId ?? ""}
          timezone={timezone}
          atividade={atividade ?? null}
          contatoFixo={atividade?.contato ?? contato ?? null}
          conversationId={conversationId ?? null}
          equipe={equipe}
        />
      ) : equipeQuery.isError ? (
        <Aviso
          tom="alert"
          role="alert"
          acao={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void equipeQuery.refetch()}
            >
              <RotateCcw aria-hidden />
              Tentar de novo
            </Button>
          }
        >
          Não foi possível carregar a equipe da clínica.
        </Aviso>
      ) : (
        <div className="grid gap-4" aria-hidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
    </>
  );
}

function FormularioDeAtividade({
  aoFechar,
  aoSalvar,
  clinicId,
  timezone,
  atividade,
  contatoFixo,
  conversationId,
  equipe,
}: {
  aoFechar: () => void;
  aoSalvar: (id: string) => void;
  clinicId: string;
  timezone: string;
  atividade: AtividadeResumo | null;
  contatoFixo: ContatoDaAtividade | null;
  conversationId: string | null;
  equipe: EquipeDaAtividade;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [contato, setContato] = useState<ContatoDaAtividade | null>(
    contatoFixo,
  );
  const [erroDoContato, setErroDoContato] = useState<string | undefined>();
  // O dia de hoje na clinica, fixado na abertura do dialogo.
  const [hoje] = useState(() => hojeNaClinica(timezone, new Date()));
  const atalhos = useMemo(() => atalhosDePrazo(hoje), [hoje]);
  const opcoes = useMemo(
    () => opcoesDeResponsavel(equipe, atividade?.assignee_user_id ?? null),
    [equipe, atividade],
  );
  // Busca so ao criar pela tela Atividades: drawer, conversa e ficha ja
  // sabem de quem e, e a edicao nunca troca o contato.
  const comBusca = atividade === null && contatoFixo === null;

  const responsavelPadrao = atividade
    ? (atividade.assignee_user_id ?? SEM)
    : equipe.ativos.includes(equipe.eu)
      ? equipe.eu
      : SEM;

  const form = useForm<ValoresDoFormularioDeAtividade>({
    resolver: zodResolver(formularioDeAtividadeSchema),
    defaultValues: {
      titulo: atividade?.titulo ?? "",
      detalhes: atividade?.detalhes ?? "",
      dia: atividade?.due_on ?? atalhos[0]!.dia,
      hora: atividade?.due_at ? horaDoPrazo(atividade.due_at, timezone) : "",
      responsavel: responsavelPadrao,
    },
  });
  const enviando = form.formState.isSubmitting;
  const diaEscolhido = form.watch("dia");

  const enviar = async (valores: ValoresDoFormularioDeAtividade) => {
    setErro(null);
    const hora = valores.hora === "" ? null : valores.hora;
    const assignee = valores.responsavel === SEM ? null : valores.responsavel;

    if (!atividade) {
      if (!contato) {
        setErroDoContato("Escolha de quem é a atividade.");
        return;
      }
      // A mesma regra da Server Action, so para dizer antes.
      const problema = problemaNoPrazoNovo(
        valores.dia,
        hora,
        new Date(),
        timezone,
      );
      if (problema) {
        form.setError(hora && valores.dia >= hoje ? "hora" : "dia", {
          message: problema,
        });
        return;
      }
    }

    const resultado = atividade
      ? await editarAtividadeAction({
          id: atividade.id,
          titulo: valores.titulo,
          detalhes: valores.detalhes,
          dia: valores.dia,
          hora,
          assignee_user_id: assignee,
        })
      : await criarAtividadeAction({
          contact_id: contato!.id,
          conversation_id: conversationId,
          titulo: valores.titulo,
          detalhes: valores.detalhes,
          dia: valores.dia,
          hora,
          assignee_user_id: assignee,
        });
    if (!resultado.ok) {
      setErro(resultado.error);
      return;
    }
    aoSalvar(resultado.id);
    aoFechar();
  };

  return (
    <Form {...form}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(evento) => void form.handleSubmit(enviar)(evento)}
      >
        {comBusca ? (
          <BuscaDeContato
            clinicId={clinicId}
            contato={contato}
            aoEscolher={(escolhido) => {
              setContato(escolhido);
              setErroDoContato(undefined);
            }}
            erro={erroDoContato}
          />
        ) : contatoFixo ? (
          <p className="text-[13px] text-text-secondary">
            De{" "}
            <span className="font-semibold text-text-strong">
              {contatoFixo.nome ?? formatarTelefone(contatoFixo.telefone)}
            </span>
          </p>
        ) : null}

        <FormField
          control={form.control}
          name="titulo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>O que fazer</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus={!comBusca}
                  autoComplete="off"
                  maxLength={TITULO_MAX}
                  placeholder="Ex.: Ligar para lembrar do retorno"
                />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="detalhes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Detalhes (opcional)</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} maxLength={DETALHES_MAX} />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dia"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Para quando</FormLabel>
              <div
                role="group"
                aria-label="Atalhos de prazo"
                className="flex flex-wrap gap-2"
              >
                {atalhos.map((atalho) => {
                  const ligado = diaEscolhido === atalho.dia;
                  return (
                    <Button
                      key={atalho.dias}
                      type="button"
                      variant="outline"
                      aria-pressed={ligado}
                      className={cn(
                        ligado &&
                          "border-text-strong bg-surface-3 font-bold text-text-strong",
                      )}
                      onClick={() =>
                        form.setValue("dia", atalho.dia, {
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
              <FormControl>
                <Input
                  {...field}
                  type="date"
                  min={atividade ? undefined : hoje}
                  className="w-full cz-num sm:w-[200px]"
                />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <FormField
            control={form.control}
            name="hora"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hora (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} type="time" className="cz-num" />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="responsavel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Responsável</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {opcoes.map((opcao) => (
                      <SelectItem key={opcao.id} value={opcao.id}>
                        {opcao.id === equipe.eu
                          ? `${opcao.nome} (você)`
                          : opcao.ativo
                            ? opcao.nome
                            : `${opcao.nome} (sem acesso)`}
                      </SelectItem>
                    ))}
                    <SelectItem value={SEM}>Sem responsável</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
        </div>

        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button type="submit" disabled={enviando}>
            {atividade ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Plus aria-hidden className="size-4" />
            )}
            {enviando
              ? "Salvando..."
              : atividade
                ? "Salvar"
                : "Criar atividade"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
