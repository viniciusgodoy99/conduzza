"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { criarReguaDeFollowupAction } from "@/app/(app)/automacoes/actions";
import { Aviso } from "@/components/shared/aviso";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  LeituraDasEtiquetas,
  ModoDoFiltro,
  OpcaoDeEtiqueta,
  TonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import {
  NOME_DA_REGUA_MAXIMO,
  nomeSugeridoDaRegua,
  RECUSAS_DA_REGUA,
} from "@/lib/domain/reguas-de-followup";

import { EtiquetasDaRegua } from "./etiquetas-da-regua";

// "Nova régua" do Follow-up de leads (onda 4, item 16). Antes, so a etapa
// sem regua aparecia (uma regua por etapa). Agora qualquer etapa que aceita
// follow-up: sem etiqueta e a regua GERAL da etapa (uma so, entao so quando
// a etapa ainda nao tem); com etiqueta e a regua de quem tem as etiquetas,
// que nasce desligada, no fim da ordem da etapa, com as mensagens e o
// horario copiados da geral, quando ha. O nome vem sugerido ("Follow-up de
// Em contato: Psiquiatria") ate a pessoa mexer nele.

export type EtapaDaNovaRegua = {
  chave: string;
  nome: string;
  /** A etapa ja tem a regua geral: a nova precisa de etiqueta. */
  temGeral: boolean;
};

export function DialogoNovaRegua({
  aberto,
  aoFechar,
  aoCriar,
  etapas,
  opcoes,
  leitura,
  tons,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriar: () => Promise<unknown> | void;
  /** As etapas que aceitam follow-up, na ordem da jornada */
  etapas: readonly EtapaDaNovaRegua[];
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  tons: TonsDasEtiquetas;
}) {
  const [etapa, setEtapa] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [modo, setModo] = useState<ModoDoFiltro>("qualquer");
  const [nome, setNome] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const idDasEtiquetas = useId();
  const idDoNome = useId();
  const idDaEtapa = useId();

  const escolhida = etapas.find((item) => item.chave === etapa) ?? null;
  const sugestao = escolhida
    ? nomeSugeridoDaRegua(escolhida.nome, etiquetas, modo)
    : "";
  // O nome acompanha a sugestao ate a pessoa escrever outro.
  const nomeNaTela = nome ?? sugestao;
  const precisaDeEtiqueta =
    Boolean(escolhida?.temGeral) && etiquetas.length === 0;
  const pronta = escolhida !== null && !precisaDeEtiqueta;

  const limpar = () => {
    setEtapa("");
    setEtiquetas([]);
    setModo("qualquer");
    setNome(null);
  };

  const criar = () => {
    if (!escolhida) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await criarReguaDeFollowupAction({
        trigger_stage: escolhida.chave,
        etiquetas,
        etiquetas_modo: modo,
        nome: nomeNaTela,
      });
      if (resultado.ok) {
        toast.success(
          etiquetas.length > 0
            ? "Régua criada, desligada. Confira as mensagens e ligue."
            : "Régua criada, desligada. Escreva as mensagens e ligue.",
        );
        if (resultado.aviso) {
          toast.info(resultado.aviso);
        }
        limpar();
        aoFechar();
        await aoCriar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível criar a régua.");
    });
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          limpar();
          aoFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nova régua de follow-up</DialogTitle>
          <DialogDescription>
            Escolha a etapa e para quem é. A régua nasce desligada, para você
            conferir as mensagens antes de ligar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={idDaEtapa}>Etapa da jornada</Label>
            <Select
              value={etapa}
              onValueChange={(valor) => {
                setEtapa(valor);
                setNome(null);
              }}
            >
              <SelectTrigger id={idDaEtapa} className="w-full">
                <SelectValue placeholder="Escolha a etapa" />
              </SelectTrigger>
              <SelectContent>
                {etapas.map((item) => (
                  <SelectItem key={item.chave} value={item.chave}>
                    {item.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {etapas.length === 0 ? (
              <p className="text-[11px] text-text-secondary">
                Nenhuma etapa da jornada aceita follow-up.
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <p
              id={idDasEtiquetas}
              className="text-sm leading-none font-medium text-foreground"
            >
              Para quem
            </p>
            <p className="text-xs text-text-secondary">
              {escolhida?.temGeral
                ? `${escolhida.nome} já tem a régua geral: escolha as etiquetas de quem recebe esta.`
                : "Sem etiqueta, é a régua geral da etapa: vale para quem não tem as etiquetas das outras réguas. Com etiqueta, só para quem tem."}
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
          </div>

          {etiquetas.length > 0 ? (
            <p className="text-xs text-text-secondary">
              As mensagens e o horário vêm copiados da régua geral da etapa,
              quando ela existe. A etiqueta vale no lead e na conversa, pelo
              nome.
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor={idDoNome}>Nome da régua</Label>
            <Input
              id={idDoNome}
              value={nomeNaTela}
              onChange={(evento) => setNome(evento.target.value)}
              maxLength={NOME_DA_REGUA_MAXIMO}
              placeholder="Escolha a etapa para sugerir o nome"
            />
          </div>

          {precisaDeEtiqueta ? (
            <Aviso tom="info">{RECUSAS_DA_REGUA.geralJaExiste}</Aviso>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={pendente}
            onClick={() => {
              limpar();
              aoFechar();
            }}
          >
            Cancelar
          </Button>
          <Button disabled={pendente || !pronta} onClick={criar}>
            {pendente ? "Criando..." : "Criar régua"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
