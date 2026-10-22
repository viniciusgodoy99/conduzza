"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { editarParaQuemDaReguaAction } from "@/app/(app)/automacoes/actions";
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
import type {
  LeituraDasEtiquetas,
  ModoDoFiltro,
  OpcaoDeEtiqueta,
  TonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import {
  ehReguaGeral,
  NOME_DA_REGUA_MAXIMO,
  RECUSAS_DA_REGUA,
} from "@/lib/domain/reguas-de-followup";
import type { ReguaDeFollowup } from "@/lib/queries/automacoes";

import { EtiquetasDaRegua } from "./etiquetas-da-regua";

// Editar o "Para quem" de uma regua de follow-up (onda 4, item 16): o nome
// e, na regua com etiqueta, as etiquetas e o modo. A geral continua geral
// (so o nome muda) e a com etiqueta continua com pelo menos uma. Trocar as
// etiquetas de uma regua ligada vale a partir do proximo toque de cada lead.

export function DialogoParaQuem({
  regua,
  aoFechar,
  aoSalvar,
  opcoes,
  leitura,
  tons,
}: {
  /** nula fecha o dialogo */
  regua: ReguaDeFollowup | null;
  aoFechar: () => void;
  aoSalvar: () => Promise<unknown> | void;
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  tons: TonsDasEtiquetas;
}) {
  return (
    <Dialog
      open={regua !== null}
      onOpenChange={(abrir) => (!abrir ? aoFechar() : null)}
    >
      <DialogContent className="sm:max-w-[520px]">
        {regua ? (
          <FormularioDoParaQuem
            key={regua.id}
            regua={regua}
            aoFechar={aoFechar}
            aoSalvar={aoSalvar}
            opcoes={opcoes}
            leitura={leitura}
            tons={tons}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDoParaQuem({
  regua,
  aoFechar,
  aoSalvar,
  opcoes,
  leitura,
  tons,
}: {
  regua: ReguaDeFollowup;
  aoFechar: () => void;
  aoSalvar: () => Promise<unknown> | void;
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  tons: TonsDasEtiquetas;
}) {
  const geral = ehReguaGeral(regua);
  const [nome, setNome] = useState(regua.name);
  const [etiquetas, setEtiquetas] = useState<string[]>([...regua.etiquetas]);
  const [modo, setModo] = useState<ModoDoFiltro>(regua.etiquetas_modo);
  const [pendente, iniciarTransicao] = useTransition();
  const idDoNome = useId();
  const idDasEtiquetas = useId();
  const semEtiqueta = !geral && etiquetas.length === 0;

  const salvar = () => {
    iniciarTransicao(async () => {
      const resultado = await editarParaQuemDaReguaAction({
        cadence_id: regua.id,
        nome,
        etiquetas: geral ? [] : etiquetas,
        etiquetas_modo: modo,
      });
      if (resultado.ok) {
        toast.success("Régua salva.");
        aoFechar();
        await aoSalvar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível salvar a régua.");
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Para quem é {regua.name}</DialogTitle>
        <DialogDescription>
          {geral
            ? `Régua geral de ${regua.etapa_nome}: vale para quem não tem as etiquetas das outras réguas da etapa, e continua geral.`
            : `Os leads de ${regua.etapa_nome} com estas etiquetas recebem esta régua. Trocar as etiquetas vale a partir da próxima mensagem de cada lead.`}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={idDoNome}>Nome da régua</Label>
          <Input
            id={idDoNome}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={NOME_DA_REGUA_MAXIMO}
          />
        </div>

        {geral ? null : (
          <div className="grid gap-1.5">
            <p
              id={idDasEtiquetas}
              className="text-sm leading-none font-medium text-foreground"
            >
              Etiquetas
            </p>
            <p className="text-xs text-text-secondary">
              A etiqueta vale no lead e na conversa, pelo nome.
            </p>
            <EtiquetasDaRegua
              etiquetas={etiquetas}
              modo={modo}
              aoMudar={(proximo) => {
                setEtiquetas(proximo.etiquetas);
                setModo(proximo.modo);
              }}
              opcoes={opcoes}
              leitura={leitura}
              tons={tons}
              desabilitado={pendente}
              idDoRotulo={idDasEtiquetas}
            />
            {semEtiqueta ? (
              <p className="text-[11px] font-medium text-alert-text">
                {RECUSAS_DA_REGUA.semEtiquetaNaComEtiqueta}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" disabled={pendente} onClick={aoFechar}>
          Cancelar
        </Button>
        <Button disabled={pendente || semEtiqueta} onClick={salvar}>
          {pendente ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}
