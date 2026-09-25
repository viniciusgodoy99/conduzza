"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Plus, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import type { ConnectState } from "@/lib/actions/whatsapp-connect";

import { ConnectClient } from "./connect-client";
import {
  unidadesParaEscolher,
  type NumeroDoWhatsapp,
  type UnidadeDaClinica,
} from "./numeros";

// Dialogos da aba de WhatsApp das Configuracoes (docs/07, Telas). Cada um
// recebe a acao como callback que devolve o texto do erro (nulo: deu certo):
// quem fala com o servidor e a lista-de-numeros.tsx. O conteudo de um dialogo
// desmonta ao fechar, entao formulario e erro recomecam limpos a cada vez.

/** Valor do seletor para "Sem unidade" (o Select do Radix nao aceita vazio). */
export const SEM_UNIDADE = "sem-unidade";

/** O Dialog so avisa o fechamento: abrir e sempre a lista que decide. */
function aoFecharQuando(aoFechar: () => void): (abrir: boolean) => void {
  return (abrir) => {
    if (!abrir) {
      aoFechar();
    }
  };
}

const formularioSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Dê um nome ao número.")
    .max(40, "Use até 40 caracteres."),
  unidade: z.string(),
});

type ValoresDoFormulario = z.infer<typeof formularioSchema>;

/** O que o formulario entrega a acao. */
export type DadosDoNumero = { nome: string; unitId: string | null };

export type ModoDoFormulario = "adicionar" | "renomear" | "unidade";

const TEXTOS: Record<
  ModoDoFormulario,
  {
    titulo: (nome: string) => string;
    descricao: string;
    enviar: string;
    enviando: string;
  }
> = {
  adicionar: {
    titulo: () => "Adicionar número",
    descricao:
      "Cada número é um WhatsApp separado. Depois de criar, leia o QR code no celular para conectar.",
    enviar: "Criar e conectar",
    enviando: "Criando...",
  },
  renomear: {
    titulo: (nome) => `Renomear ${nome}`,
    descricao:
      "O nome é só para a equipe: aparece no cartão do número e nas conversas.",
    enviar: "Salvar",
    enviando: "Salvando...",
  },
  unidade: {
    titulo: (nome) => `Unidade de ${nome}`,
    descricao: "A unidade ajuda a equipe a saber de onde é este número.",
    enviar: "Salvar",
    enviando: "Salvando...",
  },
};

function FormularioDoNumero({
  modo,
  numero,
  unidades,
  aoEnviar,
}: {
  modo: ModoDoFormulario;
  numero: NumeroDoWhatsapp | null;
  unidades: UnidadeDaClinica[];
  aoEnviar: (dados: DadosDoNumero) => Promise<string | null>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const form = useForm<ValoresDoFormulario>({
    resolver: zodResolver(formularioSchema),
    defaultValues: {
      nome: numero?.nome ?? "",
      unidade: numero?.unitId ?? SEM_UNIDADE,
    },
  });
  const textos = TEXTOS[modo];
  const opcoes = unidadesParaEscolher(unidades, numero?.unitId ?? null);
  const mostraNome = modo !== "unidade";
  // "Unidade (opcional)" so aparece ao adicionar quando a clinica tem
  // unidades; no modo unidade, e o unico campo.
  const mostraUnidade =
    modo === "unidade" || (modo === "adicionar" && opcoes.length > 0);
  const enviando = form.formState.isSubmitting;

  const enviar = async (valores: ValoresDoFormulario) => {
    setErro(null);
    const falha = await aoEnviar({
      nome: valores.nome,
      unitId: valores.unidade === SEM_UNIDADE ? null : valores.unidade,
    });
    if (falha) {
      setErro(falha);
    }
  };

  return (
    <Form {...form}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(evento) => void form.handleSubmit(enviar)(evento)}
      >
        <DialogHeader>
          <DialogTitle>{textos.titulo(numero?.nome ?? "")}</DialogTitle>
          <DialogDescription>{textos.descricao}</DialogDescription>
        </DialogHeader>

        {mostraNome ? (
          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome do número</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Ex.: Recepção"
                    maxLength={40}
                    autoComplete="off"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {mostraUnidade ? (
          <FormField
            control={form.control}
            name="unidade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {modo === "adicionar" ? "Unidade (opcional)" : "Unidade"}
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={SEM_UNIDADE}>Sem unidade</SelectItem>
                    {opcoes.map((unidade) => (
                      <SelectItem key={unidade.id} value={unidade.id}>
                        {unidade.ativa
                          ? unidade.nome
                          : `${unidade.nome} (inativa)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

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
            {modo === "adicionar" ? (
              <Plus aria-hidden className="size-4" />
            ) : (
              <Check aria-hidden className="size-4" />
            )}
            {enviando ? textos.enviando : textos.enviar}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/** Adicionar, renomear ou escolher a unidade de um numero. */
export function DialogoDoFormulario({
  aberto,
  modo,
  numero,
  unidades,
  aoFechar,
  aoEnviar,
}: {
  aberto: boolean;
  modo: ModoDoFormulario;
  /** o numero editado; nulo ao adicionar */
  numero: NumeroDoWhatsapp | null;
  unidades: UnidadeDaClinica[];
  aoFechar: () => void;
  aoEnviar: (dados: DadosDoNumero) => Promise<string | null>;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoFecharQuando(aoFechar)}>
      <DialogContent>
        <FormularioDoNumero
          modo={modo}
          numero={numero}
          unidades={unidades}
          aoEnviar={aoEnviar}
        />
      </DialogContent>
    </Dialog>
  );
}

function CorpoDaConfirmacao({
  titulo,
  descricao,
  rotulo,
  rotuloPendente,
  icone: Icone,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  descricao: string;
  rotulo: string;
  rotuloPendente: string;
  icone: LucideIcon;
  aoConfirmar: () => Promise<string | null>;
  aoCancelar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const confirmar = () => {
    setErro(null);
    startTransition(async () => {
      const falha = await aoConfirmar();
      if (falha) {
        setErro(falha);
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>{descricao}</DialogDescription>
      </DialogHeader>
      {erro ? (
        <Aviso tom="alert" role="alert">
          {erro}
        </Aviso>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={aoCancelar} disabled={pendente}>
          Cancelar
        </Button>
        <Button variant="destructive" onClick={confirmar} disabled={pendente}>
          <Icone aria-hidden className="size-4" />
          {pendente ? rotuloPendente : rotulo}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Confirmacao de acao que interrompe o atendimento (remover, desconectar). */
export function DialogoDeConfirmacao({
  aberto,
  aoFechar,
  ...corpo
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao: string;
  rotulo: string;
  rotuloPendente: string;
  icone: LucideIcon;
  aoConfirmar: () => Promise<string | null>;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoFecharQuando(aoFechar)}>
      <DialogContent className="sm:max-w-[420px]">
        <CorpoDaConfirmacao {...corpo} aoCancelar={aoFechar} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialogo "Conectar": o painel de conexao do numero (QR, situacao e avisos),
 * sem moldura. Com `conectarAoAbrir`, o pareamento comeca na hora.
 */
export function DialogoDeConexao({
  aberto,
  numero,
  conectarAoAbrir,
  podeGerenciar,
  dica,
  timezone,
  aoFechar,
  aoMudarDeSituacao,
}: {
  aberto: boolean;
  numero: NumeroDoWhatsapp | null;
  conectarAoAbrir: boolean;
  podeGerenciar: boolean;
  dica: string;
  timezone: string;
  aoFechar: () => void;
  aoMudarDeSituacao: (situacao: ConnectState["status"]) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoFecharQuando(aoFechar)}>
      <DialogContent className="sm:max-w-[560px]">
        {numero ? (
          <>
            <DialogHeader>
              <DialogTitle>{`Conectar ${numero.nome}`}</DialogTitle>
              <DialogDescription>
                O número é pareado com a plataforma, como no WhatsApp Web: leia
                o QR code no celular em Aparelhos conectados.
              </DialogDescription>
            </DialogHeader>
            <ConnectClient
              key={numero.id}
              moldura="dialogo"
              accountId={numero.id}
              nome={numero.nome}
              initial={{
                status: numero.status,
                qrCode: null,
                displayPhone: numero.displayPhone,
              }}
              connectedAt={numero.connectedAt}
              canManage={podeGerenciar}
              hint={dica}
              providerName={numero.provider}
              timezone={timezone}
              conectarAoAbrir={conectarAoAbrir}
              aoMudarDeSituacao={aoMudarDeSituacao}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Fechar</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
