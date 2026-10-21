"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  contarConversasParadasAction,
  resolverConversasParadasAction,
} from "@/app/(app)/atendimento/conversas-paradas-actions";
import { CartoesDeEscolha } from "@/components/agente/cartoes-de-escolha";
import {
  DIAS_PARADA,
  rotuloDosDias,
  textoDaContagem,
  textoDoConfirmar,
  textoDoFim,
  TEXTOS_DAS_PARADAS as T,
  type DiasParada,
  type ResultadoDasParadas,
} from "@/components/atendimento/conversas-paradas";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { conversationKeys } from "@/lib/queries/conversations";

// "Resolver conversas paradas" no rodape da lista do Atendimento (onda 2,
// decisao P11b do dono, opcao a), so nas clinicas com o agente habilitado:
// a conversa ja aberta com a equipe nunca entra na IA (D7), e a clinica
// resolve as antigas antes da producao. O dialogo pede ha quanto tempo a
// conversa esta parada (7, 15, 30 ou 60 dias, NENHUMA opcao marcada de
// antemao), conta quantas sao e so entao deixa confirmar, com o numero no
// botao. Acao em lote: visivel para todos, habilitada so para o
// administrador e o gestor (os outros veem a dica); a acao confere de novo.
// Nenhum dado de paciente: so contagens.

type Contagem =
  | { estado: "nada" }
  | { estado: "contando"; dias: DiasParada }
  | { estado: "contado"; dias: DiasParada; total: number }
  | { estado: "erro"; dias: DiasParada; texto: string };

export function ResolverConversasParadas({
  clinicId,
  podeResolver,
}: {
  clinicId: string;
  /** Administrador ou gestor (resolver em lote e da chefia). */
  podeResolver: boolean;
}) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState<DiasParada | null>(null);
  const [contagem, setContagem] = useState<Contagem>({ estado: "nada" });
  const [erro, setErro] = useState<string | null>(null);
  const [resolvendo, startResolver] = useTransition();
  const [, startContar] = useTransition();

  const fechar = () => {
    if (resolvendo) {
      return;
    }
    setAberto(false);
    setDias(null);
    setContagem({ estado: "nada" });
    setErro(null);
  };

  const escolher = (escolhidos: DiasParada) => {
    setDias(escolhidos);
    setErro(null);
    setContagem({ estado: "contando", dias: escolhidos });
    startContar(async () => {
      let r: ResultadoDasParadas;
      try {
        r = await contarConversasParadasAction({ dias: escolhidos });
      } catch {
        r = { ok: false, error: T.semResposta };
      }
      // So vale a resposta da escolha de agora (trocar de opcao no meio
      // descarta a contagem velha).
      setContagem((atual) =>
        atual.estado !== "contando" || atual.dias !== escolhidos
          ? atual
          : r.ok
            ? { estado: "contado", dias: escolhidos, total: r.total }
            : { estado: "erro", dias: escolhidos, texto: r.error },
      );
    });
  };

  const confirmar = () => {
    if (contagem.estado !== "contado" || contagem.total === 0) {
      return;
    }
    const escolhidos = contagem.dias;
    setErro(null);
    startResolver(async () => {
      let r: ResultadoDasParadas;
      try {
        r = await resolverConversasParadasAction({ dias: escolhidos });
      } catch {
        r = { ok: false, error: T.semResposta };
      }
      if (r.ok) {
        toast.success(textoDoFim(r.total, r.restam));
        await queryClient.invalidateQueries({
          queryKey: conversationKeys.list(clinicId),
        });
        setAberto(false);
        setDias(null);
        setContagem({ estado: "nada" });
        return;
      }
      setErro(r.error);
      toast.error(r.error);
    });
  };

  const podeConfirmar =
    contagem.estado === "contado" && contagem.total > 0 && !resolvendo;
  const motivoDoConfirmar =
    dias === null
      ? T.escolhaAntes
      : contagem.estado === "contado" && contagem.total === 0
        ? T.nenhumaParaResolver
        : null;

  const botaoAbrir = (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 w-full justify-start"
      disabled={!podeResolver}
      onClick={() => setAberto(true)}
    >
      <Check aria-hidden />
      {T.botao}
    </Button>
  );

  const botaoConfirmar = (
    <Button
      disabled={!podeConfirmar}
      aria-busy={resolvendo || undefined}
      onClick={confirmar}
    >
      <Check aria-hidden />
      {resolvendo
        ? T.resolvendo
        : contagem.estado === "contado" && contagem.total > 0
          ? textoDoConfirmar(contagem.total)
          : "Resolver"}
    </Button>
  );

  return (
    <div className="shrink-0 border-t border-border p-2">
      {podeResolver ? (
        botaoAbrir
      ) : (
        <DisabledWithHint hint={T.semPermissao} className="w-full">
          {botaoAbrir}
        </DisabledWithHint>
      )}

      <Dialog
        open={aberto}
        onOpenChange={(abrir) => (!abrir ? fechar() : null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{T.titulo}</DialogTitle>
            <DialogDescription>{T.descricao}</DialogDescription>
          </DialogHeader>
          <p className="text-[13px] text-text-secondary">{T.porQue}</p>
          <CartoesDeEscolha
            nome="conversas-paradas"
            rotuloDoGrupo={T.rotuloDoGrupo}
            className="sm:grid-cols-2"
            desabilitado={resolvendo}
            valor={dias === null ? null : String(dias)}
            aoEscolher={(valor) => {
              const escolhidos = DIAS_PARADA.find(
                (opcao) => String(opcao) === valor,
              );
              if (escolhidos !== undefined) {
                escolher(escolhidos);
              }
            }}
            opcoes={DIAS_PARADA.map((valor) => ({
              valor: String(valor),
              rotulo: rotuloDosDias(valor),
            }))}
          />
          {/* Sempre montada: o leitor de tela anuncia a contagem e o erro. */}
          <div aria-live="polite" aria-atomic="true" className="grid gap-2">
            {contagem.estado === "contando" ? (
              <>
                <Skeleton className="h-10 w-full" aria-hidden />
                <span className="sr-only">{T.contando}</span>
              </>
            ) : contagem.estado === "contado" ? (
              <Aviso
                tom={contagem.total === 0 ? "info" : "warning"}
                role="status"
              >
                {textoDaContagem(contagem.total, contagem.dias)}
              </Aviso>
            ) : contagem.estado === "erro" ? (
              <Aviso tom="alert" role="note">
                {contagem.texto}
              </Aviso>
            ) : null}
            {erro ? (
              <Aviso tom="alert" role="note">
                {erro}
              </Aviso>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={resolvendo} onClick={fechar}>
              Cancelar
            </Button>
            {motivoDoConfirmar ? (
              <DisabledWithHint hint={motivoDoConfirmar}>
                {botaoConfirmar}
              </DisabledWithHint>
            ) : (
              botaoConfirmar
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
