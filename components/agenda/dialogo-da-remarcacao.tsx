"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import {
  aprovarRemarcacaoAction,
  recusarRemarcacaoAction,
} from "@/app/(app)/agenda/actions";
import { TEXTOS_DO_AVISO_AO_PACIENTE } from "@/components/agenda/remarcacao-comum";
import {
  antigaNaoCarregada,
  avisoDaAntigaQueJaPassou,
  desfechoDaRemarcacao,
  erroDaAntigaEncerrada,
  situacaoDaAntiga,
  textoDoAprovar,
  textoDoRecusar,
  TEXTOS_DA_REMARCACAO,
  type AcaoDaRemarcacao,
  type AvisoDaRemarcacao,
} from "@/components/agenda/remarcacao-da-ia";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

// "Aprovar a remarcação?" e "Recusar a remarcação?" (AG4, desenho da secao
// 5), o mesmo dialogo no painel "Pendente de você" e no menu da consulta. A
// remarcacao e a consulta NOVA que a IA pediu, pendente e ligada a antiga.
// A antiga vem da lista do "Pendente de você" (lida a parte; o painel e o
// menu passam a consulta da lista, que o tempo real renova), e o dialogo a
// le a cada render: a antiga cancelada ou atendida nesse meio muda o texto e
// o Aprovar na hora (revisao da AG4, achado 3). Se a antiga nao carregou, o
// dialogo diz isso e o servidor confere de novo ao confirmar.
//
// - Aprovar: a frase do que acontece com as duas consultas (a antiga e
//   cancelada; o horario dela volta a lista de espera so se ainda for futuro)
//   e a caixa "Avisar o paciente pelo WhatsApp", MARCADA ao abrir (D-28, pela
//   recomendacao, pendente do dono): o mesmo aviso e os mesmos textos do
//   Remarcar da Agenda. Caixa (Checkbox), e nao a chave do Remarcar, porque
//   so vale ao confirmar (C31 do docs/06). O aviso sai com o novo dia e
//   horario, so com a autorizacao do paciente; o que nao saiu volta como
//   atencao.
// - Recusar: so a nova e cancelada; a antiga continua marcada e a conversa
//   volta para a equipe avisar o paciente.
// - Retornos (desfechoDaRemarcacao): sucesso com o texto do servidor (o
//   horario da antiga lido do banco), "Esta remarcação já foi tratada." para
//   quem chega depois, e o erro do gatilho da aprovacao (a antiga ja
//   atendida ou com falta) dentro do dialogo, com o Aprovar travado. Quando
//   a lista ja mostra a antiga encerrada, o dialogo mostra esse erro e o
//   Aprovar travado (o servidor confere de novo).
// - A antiga que ja passou sem presenca nem falta marcada (revisao da AG4,
//   achado 8): a aprovacao a cancela como "Cancelado pelo paciente", e o
//   paciente pode ter ido ou faltado. O "Aprovar a remarcação?" avisa, e o
//   Aprovar continua (a decisao e da recepcao).
// Quem nao edita a agenda nem chega aqui: o botao que abre fica visivel e
// desabilitado com a dica, e a acao confere de novo no servidor.

function mostrar(avisos: readonly AvisoDaRemarcacao[]): void {
  for (const aviso of avisos) {
    if (aviso.tipo === "success") {
      toast.success(aviso.texto);
    } else if (aviso.tipo === "info") {
      toast.info(aviso.texto);
    } else if (aviso.tipo === "warning") {
      // O que a recepcao precisa fazer (avisar por telefone, abrir a
      // conversa): mais tempo na tela.
      toast.warning(aviso.texto, { duration: 10_000 });
    } else {
      toast.error(aviso.texto);
    }
  }
}

export function DialogoDaRemarcacao({
  contexto,
  consulta,
  acao,
  aoFechar,
  aoTerminar,
}: {
  contexto: ContextoAgenda;
  /**
   * A consulta NOVA (a remarcacao pendente), como a lista do "Pendente de
   * você" tem agora, com a antiga lida a parte.
   */
  consulta: ConsultaDaAgenda;
  acao: AcaoDaRemarcacao;
  aoFechar: () => void;
  /** Depois de qualquer resposta do servidor: refaz a agenda. */
  aoTerminar?: () => Promise<unknown> | void;
}) {
  const aprovar = acao === "aprovar";
  const [enviando, setEnviando] = useState(false);
  // O erro que o servidor devolveu, e se ele trava o Aprovar.
  const [erroDoServidor, setErroDoServidor] = useState<{
    texto: string;
    travar: boolean;
  } | null>(null);
  const [avisar, setAvisar] = useState(true);
  const [abertoEm] = useState(() => Date.now());
  const idCaixaAviso = useId();

  // A antiga como a lista tem AGORA (a cada render, nunca so na abertura).
  // Ja na recepcao, em atendimento, compareceu ou faltou: o gatilho
  // recusaria a aprovacao. O dialogo diz isso, com o Aprovar travado (o
  // servidor confere de novo, com a antiga lida do banco).
  const antiga = consulta.antiga ?? null;
  const antigaEncerrada =
    aprovar &&
    antiga !== null &&
    situacaoDaAntiga(antiga.status) === "encerrada";
  const erro =
    erroDoServidor?.texto ??
    (antigaEncerrada && antiga
      ? erroDaAntigaEncerrada(antiga.starts_at, contexto.timezone)
      : null);
  const travado = (erroDoServidor?.travar ?? false) || antigaEncerrada;
  const naoCarregada = antigaNaoCarregada(consulta);
  const jaPassou = aprovar
    ? avisoDaAntigaQueJaPassou(consulta, contexto.timezone, abertoEm)
    : null;

  const nome =
    consulta.contact?.name ?? consulta.contact?.phone_e164 ?? "Paciente";
  const procedimento = consulta.service_link?.procedure?.name ?? "Consulta";
  const convenio = consulta.service_link?.insurance?.name ?? "Particular";

  const confirmar = async () => {
    setEnviando(true);
    setErroDoServidor(null);
    let resultado: Awaited<ReturnType<typeof aprovarRemarcacaoAction>>;
    try {
      resultado = aprovar
        ? await aprovarRemarcacaoAction({
            id: consulta.id,
            avisar_paciente: avisar,
          })
        : await recusarRemarcacaoAction(consulta.id);
    } catch {
      resultado = { ok: false };
    }
    const desfecho = desfechoDaRemarcacao(resultado, acao);
    setEnviando(false);
    if (desfecho.fechar) {
      mostrar(desfecho.avisos);
      aoFechar();
    } else {
      setErroDoServidor({ texto: desfecho.erro, travar: desfecho.travar });
    }
    await aoTerminar?.();
  };

  return (
    <Dialog
      open
      onOpenChange={(aberto) => (!aberto && !enviando ? aoFechar() : null)}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {aprovar
              ? TEXTOS_DA_REMARCACAO.aprovarTitulo
              : TEXTOS_DA_REMARCACAO.recusarTitulo}
          </DialogTitle>
          <DialogDescription>
            {aprovar
              ? textoDoAprovar(consulta, contexto.timezone, abertoEm)
              : textoDoRecusar(consulta, contexto.timezone)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* De quem e a remarcacao: o dialogo abre de um cartao ou de um
              menu, e o nome evita aprovar a errada. */}
          <p className="grid gap-0.5 rounded-xl border border-border px-3.5 py-2.5">
            <span className="truncate text-sm font-semibold text-text-strong">
              {nome}
            </span>
            <span className="truncate text-xs text-text-secondary">
              {procedimento}
              {" · "}
              {convenio}
            </span>
          </p>

          {naoCarregada ? (
            <Aviso tom="warning">
              {TEXTOS_DA_REMARCACAO.antigaNaoCarregadaNoDialogo}
            </Aviso>
          ) : null}

          {jaPassou ? <Aviso tom="warning">{jaPassou}</Aviso> : null}

          {aprovar ? (
            <CaixaAvisarPaciente
              id={idCaixaAviso}
              marcada={avisar}
              aoMudar={setAvisar}
              desabilitada={enviando || travado}
            />
          ) : null}

          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={enviando}
            onClick={aoFechar}
          >
            {TEXTOS_DA_REMARCACAO.voltar}
          </Button>
          <Button
            variant={aprovar ? "default" : "destructive"}
            className="h-10"
            disabled={enviando || travado}
            aria-busy={enviando || undefined}
            onClick={() => void confirmar()}
          >
            {aprovar
              ? enviando
                ? TEXTOS_DA_REMARCACAO.aprovando
                : TEXTOS_DA_REMARCACAO.aprovar
              : enviando
                ? TEXTOS_DA_REMARCACAO.recusando
                : TEXTOS_DA_REMARCACAO.recusar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Avisar o paciente pelo WhatsApp" do "Aprovar a remarcação?": caixa de
 * marcar com a linha inteira de 40px, o rotulo ligado e a explicacao do que
 * sai (ou nao sai) embaixo, ligada pelo aria-describedby.
 */
function CaixaAvisarPaciente({
  id,
  marcada,
  aoMudar,
  desabilitada,
}: {
  id: string;
  marcada: boolean;
  aoMudar: (marcada: boolean) => void;
  desabilitada: boolean;
}) {
  const idDescricao = `${id}-descricao`;
  return (
    <div className="grid gap-1 rounded-xl border border-border px-3.5 py-2.5">
      <div className="flex min-h-10 items-center gap-3">
        <Checkbox
          id={id}
          checked={marcada}
          disabled={desabilitada}
          onCheckedChange={(valor) => aoMudar(valor === true)}
          aria-describedby={idDescricao}
        />
        <Label htmlFor={id}>{TEXTOS_DO_AVISO_AO_PACIENTE.rotulo}</Label>
      </div>
      <p id={idDescricao} className="text-xs text-text-secondary">
        {marcada
          ? TEXTOS_DO_AVISO_AO_PACIENTE.marcada
          : TEXTOS_DO_AVISO_AO_PACIENTE.desmarcada}
      </p>
    </div>
  );
}
