"use client";

import { Check, CircleAlert, ListChecks, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { salvarConversoesDasEtapasAction } from "@/app/(app)/configuracoes/actions";
import { ErroDaAba } from "@/components/configuracoes/erro-da-aba";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONVERSAO_STATUS } from "@/lib/design/status";
import { definicaoDaEtapa, type EtapaDaJornada } from "@/lib/domain/jornada";
import {
  EVENTOS_MAIS_USADOS,
  EVENTOS_META_PADRAO,
  OUTROS_EVENTOS,
  avisoDoWhatsapp,
  ehEventoPadrao,
  recomendadoParaAJornada,
  textoDoRecomendado,
  type ValorDaConversao,
} from "@/lib/domain/meta-conversao";
import { centavosParaReais, reaisParaCentavos } from "@/lib/utils/moeda";

// Passo "Conversoes por etapa" da aba Anuncios e rastreio (pedido do dono em
// 24/11/2026: a conversao por etapa no mesmo lugar do resto do rastreio,
// "mais facil e simples de configurar"). Uma linha por etapa, com o evento que
// a Meta recebe e o valor; um botao so salva as linhas mudadas. Grava as
// mesmas colunas de funnel_stage_def que a Jornada usava, sem migration.
// Perdido nunca vira conversao (check perdido_sem_conversao): nem aparece.

export const TEXTOS_DAS_CONVERSOES = {
  titulo: "O que cada etapa envia",
  recomendado: "Recomendado para começar:",
  usarRecomendado: "Usar o recomendado",
  recomendadoJaFeito: "As etapas do recomendado já têm evento escolhido.",
  naoEnviar: "Não enviar nada",
  rotuloDoEvento: "O que a Meta recebe",
  rotuloDoValor: "Valor enviado",
  rodape:
    "Cada contato conta uma vez por etapa e sai para a Meta com o envio ligado (passo 4). Perdido nunca vira conversão.",
} as const;

const NAO_ENVIAR = "__nao_enviar__";
const PERSONALIZADO = "__personalizado__";

type Linha = {
  /** NAO_ENVIAR, PERSONALIZADO ou o nome de um evento padrao */
  evento: string;
  personalizado: string;
  valor: ValorDaConversao;
  valorReais: string;
};

function linhaDaEtapa(etapa: EtapaDaJornada): Linha {
  const evento = etapa.meta_event_name;
  return {
    evento: !evento
      ? NAO_ENVIAR
      : ehEventoPadrao(evento)
        ? evento
        : PERSONALIZADO,
    personalizado: evento && !ehEventoPadrao(evento) ? evento : "",
    valor: etapa.value_source ?? "sem",
    valorReais: centavosParaReais(etapa.value_cents),
  };
}

function eventoDaLinha(linha: Linha): string | null {
  if (linha.evento === NAO_ENVIAR) return null;
  if (linha.evento === PERSONALIZADO) return linha.personalizado.trim() || null;
  return linha.evento;
}

/** A linha mudou em relacao ao que esta gravado? (so as mudadas vao ao banco) */
function mudou(etapa: EtapaDaJornada, linha: Linha): boolean {
  const evento = eventoDaLinha(linha);
  if (linha.evento === PERSONALIZADO && !evento) return true;
  if (evento !== etapa.meta_event_name) return true;
  if (!evento) return false;
  if (linha.valor !== (etapa.value_source ?? "sem")) return true;
  return (
    linha.valor === "fixo" &&
    reaisParaCentavos(linha.valorReais) !== etapa.value_cents
  );
}

export function ConversoesPorEtapa({
  jornada,
  podeGerenciar,
  dica,
}: {
  /** nulo: a leitura da jornada falhou */
  jornada: EtapaDaJornada[] | null;
  podeGerenciar: boolean;
  dica: string;
}) {
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  if (!jornada) {
    return <ErroDaAba titulo="Não foi possível carregar as etapas da jornada" />;
  }

  const etapas = jornada.filter((etapa) => etapa.papel !== "perdido");
  const linhaDe = (etapa: EtapaDaJornada) =>
    linhas[etapa.chave] ?? linhaDaEtapa(etapa);
  const mudar = (etapa: EtapaDaJornada, campos: Partial<Linha>) => {
    setErro(null);
    setLinhas((atuais) => ({
      ...atuais,
      [etapa.chave]: { ...(atuais[etapa.chave] ?? linhaDaEtapa(etapa)), ...campos },
    }));
  };

  const alteradas = etapas.filter((etapa) => mudou(etapa, linhaDe(etapa)));
  const aPreencher = recomendadoParaAJornada(
    etapas,
    (chave) => {
      const etapa = etapas.find((e) => e.chave === chave);
      return etapa ? linhaDe(etapa).evento === NAO_ENVIAR : false;
    },
  );
  const recomendado = textoDoRecomendado(etapas);

  const usarRecomendado = () => {
    for (const item of aPreencher) {
      const etapa = etapas.find((e) => e.chave === item.chave);
      if (etapa) {
        mudar(etapa, { evento: item.evento, valor: item.valor });
      }
    }
    toast.success("Recomendado preenchido. Confira e clique em Salvar.");
  };

  const salvar = () => {
    const envio: {
      chave: string;
      meta_event_name: string | null;
      value_source: "fixo" | "service_link" | null;
      value_cents: number | null;
    }[] = [];
    for (const etapa of alteradas) {
      const linha = linhaDe(etapa);
      const evento = eventoDaLinha(linha);
      if (linha.evento === PERSONALIZADO && !evento) {
        setErro(
          `Digite o nome do evento personalizado da etapa ${etapa.nome}, ou escolha um da lista.`,
        );
        return;
      }
      const centavos =
        linha.valor === "fixo" ? reaisParaCentavos(linha.valorReais) : null;
      if (evento && linha.valor === "fixo" && centavos === null) {
        setErro(
          `Informe o valor em reais da etapa ${etapa.nome}, por exemplo 250,00.`,
        );
        return;
      }
      envio.push({
        chave: etapa.chave,
        meta_event_name: evento,
        value_source: linha.valor === "sem" ? null : linha.valor,
        value_cents: centavos,
      });
    }
    setErro(null);
    startTransition(async () => {
      const resultado = await salvarConversoesDasEtapasAction({ etapas: envio });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível salvar as conversões.");
        return;
      }
      setLinhas({});
      toast.success("Conversões salvas.");
    });
  };

  const botaoRecomendado = (
    <Button
      variant="outline"
      disabled={!podeGerenciar || pendente || aPreencher.length === 0}
      onClick={usarRecomendado}
    >
      <ListChecks className="size-4" />
      {TEXTOS_DAS_CONVERSOES.usarRecomendado}
    </Button>
  );
  const botaoSalvar = (
    <Button
      disabled={!podeGerenciar || pendente || alteradas.length === 0}
      onClick={salvar}
    >
      <Check className="size-4" />
      {pendente ? "Salvando..." : "Salvar conversões"}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TEXTOS_DAS_CONVERSOES.titulo}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {recomendado ? (
          <Aviso
            tom="info"
            acao={
              !podeGerenciar ? (
                <DisabledWithHint hint={dica}>{botaoRecomendado}</DisabledWithHint>
              ) : aPreencher.length === 0 ? (
                <DisabledWithHint hint={TEXTOS_DAS_CONVERSOES.recomendadoJaFeito}>
                  {botaoRecomendado}
                </DisabledWithHint>
              ) : (
                botaoRecomendado
              )
            }
          >
            <span className="font-semibold">
              {TEXTOS_DAS_CONVERSOES.recomendado}
            </span>{" "}
            {recomendado}
          </Aviso>
        ) : null}

        <ul className="divide-y divide-border">
          {etapas.map((etapa) => {
            const linha = linhaDe(etapa);
            const id = `conversao-${etapa.chave}`;
            const temEvento = linha.evento !== NAO_ENVIAR;
            const quandoUsar = EVENTOS_META_PADRAO.find(
              (evento) => evento.nome === linha.evento,
            )?.quandoUsar;
            const eventoEscolhido = eventoDaLinha(linha);
            const noWhatsapp = eventoEscolhido
              ? avisoDoWhatsapp(eventoEscolhido)
              : null;
            const descricoes = [
              quandoUsar ? `${id}-quando` : null,
              noWhatsapp ? `${id}-whatsapp` : null,
            ].filter(Boolean);
            const pausada =
              Boolean(etapa.meta_event_name) &&
              !etapa.conversao_ativa &&
              !mudou(etapa, linha);
            return (
              <li
                key={etapa.chave}
                className="grid gap-3 py-3 first:pt-0 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,15rem)] md:items-start"
              >
                <div className="flex min-h-10 flex-wrap items-center gap-2 md:mt-[22px]">
                  <StatusChip definition={definicaoDaEtapa(etapa)} />
                  {pausada ? (
                    <StatusChip size="sm" definition={CONVERSAO_STATUS.pausada} />
                  ) : null}
                </div>

                <div className="grid content-start gap-1.5">
                  <Label htmlFor={`${id}-evento`}>
                    {TEXTOS_DAS_CONVERSOES.rotuloDoEvento}
                  </Label>
                  <Select
                    value={linha.evento}
                    disabled={!podeGerenciar || pendente}
                    onValueChange={(valor) => mudar(etapa, { evento: valor })}
                  >
                    <SelectTrigger
                      id={`${id}-evento`}
                      className="min-h-10 w-full"
                      aria-describedby={
                        descricoes.length > 0 ? descricoes.join(" ") : undefined
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NAO_ENVIAR}>
                        {TEXTOS_DAS_CONVERSOES.naoEnviar}
                      </SelectItem>
                      <SelectGroup>
                        <SelectLabel>Mais usados em clínica</SelectLabel>
                        {EVENTOS_MAIS_USADOS.map((evento) => (
                          <SelectItem key={evento.nome} value={evento.nome}>
                            {evento.rotulo}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Outros eventos da Meta</SelectLabel>
                        {OUTROS_EVENTOS.map((evento) => (
                          <SelectItem key={evento.nome} value={evento.nome}>
                            {evento.rotulo}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectItem value={PERSONALIZADO}>
                        Personalizado (digitar o nome)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {quandoUsar ? (
                    <p id={`${id}-quando`} className="text-xs text-text-secondary">
                      {quandoUsar}
                    </p>
                  ) : null}
                  {noWhatsapp ? (
                    <p
                      id={`${id}-whatsapp`}
                      className={
                        noWhatsapp.tom === "alerta"
                          ? "flex gap-1.5 text-xs font-medium text-warning-text"
                          : "text-xs text-text-secondary"
                      }
                    >
                      {noWhatsapp.tom === "alerta" ? (
                        <CircleAlert
                          aria-hidden
                          className="mt-px size-3.5 shrink-0"
                        />
                      ) : null}
                      {noWhatsapp.texto}
                    </p>
                  ) : null}
                  {linha.evento === PERSONALIZADO ? (
                    <Input
                      value={linha.personalizado}
                      disabled={!podeGerenciar || pendente}
                      onChange={(evento) =>
                        mudar(etapa, { personalizado: evento.target.value })
                      }
                      placeholder="NomeDoEventoNaMeta"
                      aria-label={`Nome do evento personalizado da etapa ${etapa.nome}`}
                      className="h-10 font-mono"
                      maxLength={100}
                    />
                  ) : null}
                </div>

                {temEvento ? (
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor={`${id}-valor`}>
                      {TEXTOS_DAS_CONVERSOES.rotuloDoValor}
                    </Label>
                    <Select
                      value={linha.valor}
                      disabled={!podeGerenciar || pendente}
                      onValueChange={(valor) =>
                        mudar(etapa, { valor: valor as ValorDaConversao })
                      }
                    >
                      <SelectTrigger id={`${id}-valor`} className="min-h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sem">Sem valor</SelectItem>
                        <SelectItem value="service_link">
                          Preço da consulta
                        </SelectItem>
                        <SelectItem value="fixo">Valor fixo</SelectItem>
                      </SelectContent>
                    </Select>
                    {linha.valor === "fixo" ? (
                      <Input
                        value={linha.valorReais}
                        disabled={!podeGerenciar || pendente}
                        onChange={(evento) =>
                          mudar(etapa, { valorReais: evento.target.value })
                        }
                        inputMode="decimal"
                        placeholder="250,00"
                        aria-label={`Valor em reais da etapa ${etapa.nome}`}
                        className="h-10 cz-num"
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        <p className="max-w-[72ch] text-xs text-text-secondary">
          {TEXTOS_DAS_CONVERSOES.rodape}
        </p>

        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        {podeGerenciar ? (
          botaoSalvar
        ) : (
          <DisabledWithHint hint={dica}>{botaoSalvar}</DisabledWithHint>
        )}
        {alteradas.length > 0 ? (
          <>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => {
                setLinhas({});
                setErro(null);
              }}
            >
              <Undo2 className="size-4" />
              Desfazer
            </Button>
            <span className="text-xs text-text-secondary">
              <span className="cz-num">{alteradas.length}</span>{" "}
              {alteradas.length === 1 ? "etapa mudada" : "etapas mudadas"}, ainda
              sem salvar
            </span>
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
}
