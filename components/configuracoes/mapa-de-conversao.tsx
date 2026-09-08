"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  removerMapaDeConversaoAction,
  salvarMapaDeConversaoAction,
} from "@/app/(app)/configuracoes/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FUNNEL_STAGE, type FunnelStage } from "@/lib/design/status";
import {
  EVENTOS_META_PADRAO,
  ehEventoPadrao,
  rotuloDoEvento,
} from "@/lib/domain/meta-conversao";
import { centavosParaReais, reaisParaCentavos } from "@/lib/utils/moeda";

// Mapa de conversao (R2 da frente de Resultados): o "Jornada de Compra" do
// Tintim trazido para dentro. Uma linha por etapa mapeavel do funil; em cada
// uma, o evento que a Meta vai receber quando um lead chegar ali, se conta
// como venda, e com qual valor.
//
// HONESTIDADE OBRIGATORIA NO RODAPE: esta tela so CONFIGURA. Nenhum evento e
// enviado a Meta ainda (o disparo e a tarefa R4, e depende das credenciais da
// R6). Sem o aviso, a pessoa configuraria e acreditaria que a Meta ja esta
// recebendo.

// 'perdido' fica de fora POR DECISAO DE SCHEMA (check da migration
// 20260908120000): nao se devolve conversao de lead perdido.
const ETAPAS_MAPEAVEIS: readonly FunnelStage[] = [
  "novo",
  "em_contato",
  "aguardando_resposta",
  "agendou",
  "compareceu",
];

const EVENTO_PERSONALIZADO = "__personalizado__";

type ModoDeValor = "sem" | "fixo" | "service_link";

export type LinhaDoMapa = {
  trigger_stage: FunnelStage;
  meta_event_name: string;
  is_sale: boolean;
  is_first_contact: boolean;
  value_source: "service_link" | "fixo" | null;
  value_cents: number | null;
  active: boolean;
};

type Rascunho = {
  evento: string;
  eventoPersonalizado: string;
  ehVenda: boolean;
  primeiroContato: boolean;
  modoDeValor: ModoDeValor;
  valorReais: string;
  ativo: boolean;
};

function rascunhoDaLinha(linha: LinhaDoMapa | null): Rascunho {
  if (!linha) {
    return {
      evento: "",
      eventoPersonalizado: "",
      ehVenda: false,
      primeiroContato: false,
      modoDeValor: "sem",
      valorReais: "",
      ativo: true,
    };
  }
  const padrao = ehEventoPadrao(linha.meta_event_name);
  return {
    evento: padrao ? linha.meta_event_name : EVENTO_PERSONALIZADO,
    eventoPersonalizado: padrao ? "" : linha.meta_event_name,
    ehVenda: linha.is_sale,
    primeiroContato: linha.is_first_contact,
    modoDeValor: linha.value_source ?? "sem",
    valorReais: centavosParaReais(linha.value_cents),
    ativo: linha.active,
  };
}

export function MapaDeConversao({
  linhas,
  podeGerenciar,
  dica,
}: {
  linhas: LinhaDoMapa[];
  podeGerenciar: boolean;
  dica: string;
}) {
  const [editando, setEditando] = useState<FunnelStage | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoDaLinha(null));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const porEtapa = new Map(linhas.map((linha) => [linha.trigger_stage, linha]));

  const abrir = (etapa: FunnelStage) => {
    setErro(null);
    setRascunho(rascunhoDaLinha(porEtapa.get(etapa) ?? null));
    setEditando(etapa);
  };

  const fechar = () => {
    setEditando(null);
    setErro(null);
  };

  const salvar = (etapa: FunnelStage) => {
    const nomeDoEvento =
      rascunho.evento === EVENTO_PERSONALIZADO
        ? rascunho.eventoPersonalizado.trim()
        : rascunho.evento;
    if (!nomeDoEvento) {
      setErro("Escolha o evento que a Meta vai receber.");
      return;
    }
    const centavos =
      rascunho.modoDeValor === "fixo"
        ? reaisParaCentavos(rascunho.valorReais)
        : null;
    if (rascunho.modoDeValor === "fixo" && centavos === null) {
      setErro("Informe o valor em reais, por exemplo 250,00.");
      return;
    }
    setErro(null);
    startTransition(async () => {
      const resultado = await salvarMapaDeConversaoAction({
        trigger_stage: etapa,
        meta_event_name: nomeDoEvento,
        is_sale: rascunho.ehVenda,
        is_first_contact: rascunho.primeiroContato,
        value_source:
          rascunho.modoDeValor === "sem" ? null : rascunho.modoDeValor,
        value_cents: centavos,
        active: rascunho.ativo,
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível salvar.");
        return;
      }
      toast.success(`Etapa ${FUNNEL_STAGE[etapa].label} configurada.`);
      fechar();
    });
  };

  const remover = (etapa: FunnelStage) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await removerMapaDeConversaoAction(etapa);
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível remover.");
        return;
      }
      toast.success(`Etapa ${FUNNEL_STAGE[etapa].label} sem evento.`);
      fechar();
    });
  };

  return (
    <div className="grid gap-3">
      {ETAPAS_MAPEAVEIS.map((etapa) => {
        const linha = porEtapa.get(etapa) ?? null;
        const aberta = editando === etapa;
        return (
          <article
            key={etapa}
            className="grid gap-3 rounded-lg border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip definition={FUNNEL_STAGE[etapa]} />
              {/* O estado em TEXTO, nunca so cor: sem evento, enviando, ou
                  pausado. */}
              <span className="text-sm text-text-secondary">
                {!linha
                  ? "Sem evento configurado"
                  : linha.active
                    ? `Envia ${rotuloDoEvento(linha.meta_event_name)}`
                    : `Pausado (${rotuloDoEvento(linha.meta_event_name)})`}
              </span>
              {linha?.is_sale ? (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-medium [color:var(--success-text)] [background:var(--success-bg)]">
                  Venda
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                {aberta ? null : podeGerenciar ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendente}
                    onClick={() => abrir(etapa)}
                  >
                    <Pencil strokeWidth={1.5} className="size-4" />
                    {linha ? "Editar" : "Configurar"}
                  </Button>
                ) : (
                  <DisabledWithHint hint={dica}>
                    <Button variant="outline" size="sm" disabled>
                      <Pencil strokeWidth={1.5} className="size-4" />
                      {linha ? "Editar" : "Configurar"}
                    </Button>
                  </DisabledWithHint>
                )}
              </div>
            </div>

            {aberta ? (
              <div className="grid gap-4 border-t pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`evento-${etapa}`}>
                      Evento que a Meta recebe
                    </Label>
                    <Select
                      value={rascunho.evento || undefined}
                      onValueChange={(valor) =>
                        setRascunho((atual) => ({ ...atual, evento: valor }))
                      }
                    >
                      <SelectTrigger
                        id={`evento-${etapa}`}
                        className="min-h-10"
                      >
                        <SelectValue placeholder="Escolha o evento" />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENTOS_META_PADRAO.map((evento) => (
                          <SelectItem key={evento.nome} value={evento.nome}>
                            {evento.rotulo}
                          </SelectItem>
                        ))}
                        <SelectItem value={EVENTO_PERSONALIZADO}>
                          Personalizado (digitar o nome)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {rascunho.evento === EVENTO_PERSONALIZADO ? (
                      <Input
                        value={rascunho.eventoPersonalizado}
                        onChange={(evento) =>
                          setRascunho((atual) => ({
                            ...atual,
                            eventoPersonalizado: evento.target.value,
                          }))
                        }
                        placeholder="NomeDoEventoNaMeta"
                        aria-label="Nome do evento personalizado"
                        className="h-10 font-mono"
                        maxLength={100}
                      />
                    ) : null}
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`valor-${etapa}`}>Valor da conversão</Label>
                    <Select
                      value={rascunho.modoDeValor}
                      onValueChange={(valor) =>
                        setRascunho((atual) => ({
                          ...atual,
                          modoDeValor: valor as ModoDeValor,
                        }))
                      }
                    >
                      <SelectTrigger id={`valor-${etapa}`} className="min-h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sem">Sem valor</SelectItem>
                        <SelectItem value="fixo">Valor fixo</SelectItem>
                        <SelectItem value="service_link">
                          Preço da consulta do agendamento
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {rascunho.modoDeValor === "fixo" ? (
                      <Input
                        value={rascunho.valorReais}
                        onChange={(evento) =>
                          setRascunho((atual) => ({
                            ...atual,
                            valorReais: evento.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder="250,00"
                        aria-label="Valor em reais"
                        className="h-10 font-mono tabular-nums"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`venda-${etapa}`}
                      checked={rascunho.ehVenda}
                      onCheckedChange={(valor) =>
                        setRascunho((atual) => ({ ...atual, ehVenda: valor }))
                      }
                    />
                    <Label htmlFor={`venda-${etapa}`}>
                      Esta etapa é uma venda
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`primeiro-${etapa}`}
                      checked={rascunho.primeiroContato}
                      onCheckedChange={(valor) =>
                        setRascunho((atual) => ({
                          ...atual,
                          primeiroContato: valor,
                        }))
                      }
                    />
                    <Label htmlFor={`primeiro-${etapa}`}>
                      É o primeiro contato
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`ativo-${etapa}`}
                      checked={rascunho.ativo}
                      onCheckedChange={(valor) =>
                        setRascunho((atual) => ({ ...atual, ativo: valor }))
                      }
                    />
                    <Label htmlFor={`ativo-${etapa}`}>
                      {rascunho.ativo ? "Ativo" : "Pausado"}
                    </Label>
                  </div>
                </div>

                {erro ? (
                  <p role="alert" className="text-sm [color:var(--alert-text)]">
                    {erro}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={pendente} onClick={() => salvar(etapa)}>
                    <Check strokeWidth={1.5} className="size-4" />
                    {pendente ? "Salvando..." : "Salvar"}
                  </Button>
                  <Button variant="ghost" disabled={pendente} onClick={fechar}>
                    <X strokeWidth={1.5} className="size-4" />
                    Cancelar
                  </Button>
                  {linha ? (
                    <Button
                      variant="ghost"
                      disabled={pendente}
                      onClick={() => remover(etapa)}
                      className="ml-auto [color:var(--alert-text)]"
                    >
                      <Trash2 strokeWidth={1.5} className="size-4" />
                      Remover evento
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}

      <p className="text-[12.5px] text-text-tertiary">
        Esta tela só define o que será enviado. Nenhum evento vai para a Meta
        ainda: o envio automático chega junto com a conexão da conta de
        anúncios, na próxima etapa desta frente.
      </p>
    </div>
  );
}
