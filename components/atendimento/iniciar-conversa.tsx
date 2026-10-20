"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, SendHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { iniciarConversaAction } from "@/app/(app)/atendimento/iniciar-conversa-actions";
import {
  situacaoDoNumero,
  telefoneDoNumero,
} from "@/components/automacoes/numeros-de-envio";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DICA_SEM_AUTORIZACAO_PARA_INICIAR,
  MENSAGEM_SEM_NUMERO_PARA_INICIAR,
  mensagemDeNumeroDesconectado,
  numeroConectado,
  numeroPadraoParaIniciar,
  TEXTO_MAXIMO_DA_PRIMEIRA_MENSAGEM,
} from "@/lib/domain/iniciar-conversa";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  fetchNumerosDaClinica,
  numerosKeys,
  type NumeroDaClinica,
} from "@/lib/queries/conversations";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// "Iniciar conversa" (decisao do dono em 20/10/2026): a primeira mensagem
// para quem nunca escreveu, no lugar do "Abrir conversa" desabilitado da
// gaveta de Leads e da ficha do paciente. O botao fica visivel e
// desabilitado, com a dica, sem permissao (so administrador, gestor e
// recepcao iniciam) ou sem a autorizacao para receber mensagens registrada.
//
// O dialogo pede o texto e, so quando a clinica tem mais de um numero ativo,
// por qual numero sair (ja marcado no principal; com ele desconectado, no
// primeiro conectado, como o teste das Automacoes). Numero desconectado fica
// visivel e desabilitado. A Server Action confere tudo de novo, envia pelo
// mesmo caminho da resposta digitada no Atendimento e devolve a conversa:
// a tela leva ate ela (/atendimento?conversa=<id>). Nada em massa aqui.
//
// O dialogo so existe enquanto aberto: cada abertura comeca vazia, no numero
// padrao. Os numeros vem pela sessao (todo membro ativo le
// whatsapp_account), na abertura.

export const ROTULO_INICIAR_CONVERSA = "Iniciar conversa";

export type ContatoParaIniciar = {
  id: string;
  nome: string | null;
  telefone: string;
};

export type EstadoDosNumeros =
  | { estado: "carregando" }
  | { estado: "erro" }
  | { estado: "pronto"; numeros: NumeroDaClinica[] };

export type ErroDoInicio = {
  mensagem: string;
  /** A conversa ja existe (ou acabou de nascer): da para abrir e seguir. */
  conversationId?: string;
};

/**
 * O botao. `dicaSemPermissao` vale quando o papel nao inicia conversa; sem
 * a autorizacao registrada, a dica e a da autorizacao.
 */
export function BotaoIniciarConversa({
  clinicId,
  contato,
  podeIniciar,
  dicaSemPermissao,
  autorizado,
  className,
}: {
  clinicId: string;
  contato: ContatoParaIniciar;
  podeIniciar: boolean;
  dicaSemPermissao: string;
  /** Autorizacao para receber mensagens vigente. */
  autorizado: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const dica = !podeIniciar
    ? dicaSemPermissao
    : !autorizado
      ? DICA_SEM_AUTORIZACAO_PARA_INICIAR
      : null;

  const botao = (
    <Button
      variant="outline"
      className={className}
      disabled={dica !== null}
      onClick={() => setAberto(true)}
    >
      <MessageSquarePlus aria-hidden />
      {ROTULO_INICIAR_CONVERSA}
    </Button>
  );

  if (dica !== null) {
    return (
      <DisabledWithHint hint={dica} className={className}>
        {botao}
      </DisabledWithHint>
    );
  }
  return (
    <>
      {botao}
      {aberto ? (
        <DialogoIniciarConversa
          clinicId={clinicId}
          contato={contato}
          onFechar={() => setAberto(false)}
        />
      ) : null}
    </>
  );
}

/** O dialogo com os dados: os numeros da clinica e o envio. */
export function DialogoIniciarConversa({
  clinicId,
  contato,
  onFechar,
}: {
  clinicId: string;
  contato: ContatoParaIniciar;
  onFechar: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const numerosQuery = useQuery({
    queryKey: numerosKeys.ativos(clinicId),
    queryFn: () => fetchNumerosDaClinica(supabase, clinicId),
    staleTime: 30_000,
  });
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroDoInicio | null>(null);
  // Dois cliques antes de o botao travar mandariam a mensagem duas vezes.
  const emVoo = useRef(false);

  const numeros: EstadoDosNumeros = numerosQuery.data
    ? { estado: "pronto", numeros: numerosQuery.data }
    : numerosQuery.isError && !numerosQuery.isFetching
      ? { estado: "erro" }
      : { estado: "carregando" };

  const enviar = async (whatsappAccountId: string) => {
    if (emVoo.current) {
      return;
    }
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    let resultado: Awaited<ReturnType<typeof iniciarConversaAction>>;
    try {
      resultado = await iniciarConversaAction({
        contact_id: contato.id,
        whatsapp_account_id: whatsappAccountId,
        texto,
      });
    } catch {
      resultado = {
        ok: false,
        error: "Não foi possível falar com o servidor. Tente de novo.",
      };
    }
    if (!resultado.ok) {
      emVoo.current = false;
      setEnviando(false);
      setErro({
        mensagem: resultado.error,
        ...(resultado.conversationId
          ? { conversationId: resultado.conversationId }
          : {}),
      });
      return;
    }
    toast.success("Mensagem enviada. A conversa está com você no Atendimento.");
    router.push(`/atendimento?conversa=${resultado.conversationId}`);
    onFechar();
  };

  return (
    <Dialog
      open
      onOpenChange={(abrindo) => {
        if (!abrindo && !enviando) {
          onFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px]" showCloseButton={!enviando}>
        <ConteudoIniciarConversa
          contato={contato}
          numeros={numeros}
          escolhido={escolhido}
          aoEscolher={setEscolhido}
          aoTentarDeNovo={() => void numerosQuery.refetch()}
          texto={texto}
          aoMudarTexto={setTexto}
          enviando={enviando}
          erro={erro}
          aoEnviar={(id) => void enviar(id)}
          aoCancelar={onFechar}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * O miolo do dialogo, so apresentacao (cabecalho, numero, texto, erro e
 * rodape), para os estados serem testados sem banco: carregando, erro,
 * nenhum numero, um so, varios, desconectado e enviando.
 */
export function ConteudoIniciarConversa({
  contato,
  numeros,
  escolhido,
  aoEscolher,
  aoTentarDeNovo,
  texto,
  aoMudarTexto,
  enviando,
  erro,
  aoEnviar,
  aoCancelar,
}: {
  contato: ContatoParaIniciar;
  numeros: EstadoDosNumeros;
  /** O numero escolhido na tela; null segue o padrao. */
  escolhido: string | null;
  aoEscolher: (id: string) => void;
  aoTentarDeNovo: () => void;
  texto: string;
  aoMudarTexto: (texto: string) => void;
  enviando: boolean;
  erro: ErroDoInicio | null;
  aoEnviar: (whatsappAccountId: string) => void;
  aoCancelar: () => void;
}) {
  const lista = numeros.estado === "pronto" ? numeros.numeros : [];
  const numero =
    lista.find((candidato) => candidato.id === escolhido) ??
    numeroPadraoParaIniciar(lista);
  const conectado = numero !== null && numeroConectado(numero);
  const varios = lista.length > 1;
  const algumConectado = lista.some(numeroConectado);
  const telefone = formatarTelefone(contato.telefone);
  const podeEnviar =
    !enviando && numero !== null && conectado && texto.trim().length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{ROTULO_INICIAR_CONVERSA}</DialogTitle>
        <DialogDescription>
          A primeira mensagem sai pelo WhatsApp da clínica, e a conversa fica
          com você no Atendimento.
        </DialogDescription>
      </DialogHeader>

      <p className="text-[13px] text-foreground">
        Para{" "}
        <span className="font-semibold text-text-strong">
          {contato.nome ?? telefone}
        </span>
        {contato.nome ? (
          <span className="cz-num text-text-secondary"> ({telefone})</span>
        ) : null}
      </p>

      {numeros.estado === "carregando" ? (
        <div role="status" className="grid gap-1.5">
          <span className="sr-only">Carregando os números da clínica</span>
          <Skeleton aria-hidden className="h-10 w-full rounded-xl" />
        </div>
      ) : numeros.estado === "erro" ? (
        <Aviso
          tom="alert"
          role="alert"
          acao={
            <Button variant="ghost" size="sm" onClick={aoTentarDeNovo}>
              Tentar de novo
            </Button>
          }
        >
          Não foi possível carregar os números da clínica.
        </Aviso>
      ) : lista.length === 0 ? (
        <Aviso tom="warning">{MENSAGEM_SEM_NUMERO_PARA_INICIAR}</Aviso>
      ) : varios ? (
        <fieldset disabled={enviando} className="grid gap-2">
          <legend className="mb-2 text-[13.5px] font-semibold text-text-strong">
            Sair pelo número
          </legend>
          {lista.map((opcao) => {
            const opcaoConectada = numeroConectado(opcao);
            const marcado = numero?.id === opcao.id;
            const telefoneDoNumeroDaClinica = telefoneDoNumero(
              opcao.display_phone,
            );
            const idDetalhe = `numero-da-conversa-${opcao.id}`;
            return (
              <label
                key={opcao.id}
                className={cn(
                  "flex min-h-10 items-start gap-3 rounded-xl border px-3.5 py-3 cz-transition",
                  !opcaoConectada
                    ? "cursor-not-allowed border-border bg-surface-4"
                    : marcado
                      ? "cursor-pointer border-primary-edge bg-primary-soft"
                      : "cursor-pointer border-border-strong bg-card hover:bg-surface-subtle",
                )}
              >
                <input
                  type="radio"
                  name="numero-da-conversa"
                  value={opcao.id}
                  checked={marcado}
                  disabled={!opcaoConectada}
                  aria-describedby={idDetalhe}
                  onChange={() => aoEscolher(opcao.id)}
                  className="mt-0.5 size-4 shrink-0 accent-(--primary-edge)"
                />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span
                    className={cn(
                      "text-sm text-text-strong",
                      marcado ? "font-bold" : "font-semibold",
                    )}
                  >
                    {opcao.nome}
                    {opcao.principal ? (
                      <span className="font-normal text-text-secondary">
                        {" "}
                        (principal)
                      </span>
                    ) : null}
                  </span>
                  <span
                    id={idDetalhe}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    {telefoneDoNumeroDaClinica ? (
                      <span className="cz-num text-xs text-text-secondary">
                        {telefoneDoNumeroDaClinica}
                      </span>
                    ) : null}
                    <StatusChip
                      size="sm"
                      definition={situacaoDoNumero(opcao.connection_status)}
                    />
                    {!opcaoConectada ? (
                      <span className="text-xs text-text-secondary">
                        Reconecte em Configurações para enviar por este número.
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}
          {!algumConectado ? (
            <Aviso tom="warning">
              Nenhum número está conectado agora. Reconecte em Configurações,
              aba WhatsApp, para iniciar a conversa.
            </Aviso>
          ) : null}
        </fieldset>
      ) : numero && !conectado ? (
        <Aviso tom="warning">
          {mensagemDeNumeroDesconectado(numero, false)}
        </Aviso>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="primeira-mensagem">Mensagem</Label>
        <Textarea
          id="primeira-mensagem"
          rows={4}
          maxLength={TEXTO_MAXIMO_DA_PRIMEIRA_MENSAGEM}
          value={texto}
          disabled={enviando}
          onChange={(evento) => aoMudarTexto(evento.target.value)}
          placeholder="Escreva a primeira mensagem para o contato"
        />
      </div>

      {erro ? (
        <Aviso
          tom="alert"
          role="alert"
          acao={
            erro.conversationId ? (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/atendimento?conversa=${erro.conversationId}`}
                  prefetch={false}
                >
                  Abrir a conversa
                </Link>
              </Button>
            ) : undefined
          }
        >
          {erro.mensagem}
        </Aviso>
      ) : null}

      <DialogFooter>
        <Button variant="outline" disabled={enviando} onClick={aoCancelar}>
          Cancelar
        </Button>
        <Button
          disabled={!podeEnviar}
          onClick={() => {
            if (numero) {
              aoEnviar(numero.id);
            }
          }}
        >
          <SendHorizontal aria-hidden />
          {enviando ? "Enviando..." : "Enviar"}
        </Button>
      </DialogFooter>
    </>
  );
}
