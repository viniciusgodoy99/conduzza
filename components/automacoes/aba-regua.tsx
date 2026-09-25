"use client";

import {
  CalendarClock,
  Coins,
  MessagesSquare,
  Plus,
  SendHorizonal,
  Trash2,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  criarPassoAction,
  excluirPassoAction,
  salvarEsperaDoPassoAction,
  testarEnvioAction,
} from "@/app/(app)/automacoes/actions";
import { DialogPasso } from "@/components/automacoes/dialog-passo";
import {
  DialogoDeExclusao,
  PERDAS_DO_HISTORICO,
} from "@/components/automacoes/dialogo-de-exclusao";
import { EditorDePasso } from "@/components/automacoes/editor-de-passo";
import { LinhaDoTempo } from "@/components/automacoes/linha-do-tempo";
import { MetricasDaRegua } from "@/components/automacoes/metricas-da-regua";
import { ControlesDaRegua } from "@/components/confirmacoes/controles-da-regua";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  estimarRegua,
  type BaseDaEstimativa,
} from "@/lib/domain/estimativa-regua";
import {
  rotuloDoPasso,
  type TipoDeReguaDoRotulo,
} from "@/lib/domain/textos-padrao";
import type { ReguaDeConfirmacao } from "@/lib/queries/confirmacoes";

// Uma aba de regua da Tela 7 (confirmacao ou pos falta, e as excecoes da
// fase seguinte): ativacao (o MESMO bloco da Tela 2), a linha do tempo com
// um editor por passo e a estimativa honesta de volume.
//
// Desenho do design system (docs/06 secao 5.10): cada bloco em Card. Dentro
// de uma excecao ou de um follow-up (que ja sao cartoes), "aninhada" tira a
// casca e separa os blocos por um fio, para nao empilhar cartao em cartao.

// Textos do dialogo de excluir mensagem por tipo de regua (achado L14, o
// mesmo cuidado do achado 54 na prova de trabalho): quem deixa de receber e
// onde o historico apagado aparecia. Confirmacao e pos falta aparecem em
// Confirmacoes (lista do dia e Faltas de hoje); follow-up fala com leads e
// nao aparece la. A comparacao de antes e depois em Resultados usa o
// primeiro envio de qualquer regua, entao vale para as tres.
const EXCLUSAO_DO_PASSO: Record<
  TipoDeReguaDoRotulo,
  { publico: string; historico: string }
> = {
  confirmacao: {
    publico: "os pacientes",
    historico:
      "O histórico de envios dela também é apagado: some das métricas da régua e da lista do dia em Confirmações, e pode mudar a comparação de antes e depois em Resultados.",
  },
  pos_falta: {
    publico: "quem faltou",
    historico:
      "O histórico de envios dela também é apagado: some das métricas da régua e da aba Faltas de hoje em Confirmações, e pode mudar a comparação de antes e depois em Resultados.",
  },
  followup: {
    publico: "os leads desta etapa",
    historico:
      "O histórico de envios dela também é apagado: some das métricas da régua e pode mudar a comparação de antes e depois em Resultados.",
  },
};

function Bloco({
  aninhada,
  titulo,
  descricao,
  acao,
  children,
}: {
  aninhada: boolean;
  titulo?: string;
  descricao?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  const cabecalho = titulo ? (
    <div className="grid gap-0.5">
      {aninhada ? (
        <h3 className="text-sm font-bold">{titulo}</h3>
      ) : (
        <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
          {titulo}
        </h2>
      )}
      {descricao ? (
        aninhada ? (
          <p className="text-xs text-text-secondary">{descricao}</p>
        ) : (
          <CardDescription>{descricao}</CardDescription>
        )
      ) : null}
    </div>
  ) : null;

  if (aninhada) {
    return (
      <section className="grid gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
        {cabecalho ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            {cabecalho}
            {acao}
          </div>
        ) : null}
        {children}
      </section>
    );
  }
  return (
    <Card>
      {cabecalho ? (
        <CardHeader>
          {cabecalho}
          {acao ? <CardAction>{acao}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

export function AbaRegua({
  clinicId,
  regua,
  copy,
  nomeDaClinica,
  botoesDaPreview,
  estimativa,
  sentidoDoPasso,
  tipoDaRegua,
  eventoRotulo,
  placeholders,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  aninhada = false,
  aoMudar,
}: {
  clinicId: string;
  regua: ReguaDeConfirmacao | null;
  copy: {
    ligar: string;
    ligada: string;
    desligada: string;
    inicioDaLinha: string;
    fimDaLinha: string | null;
    vazio: string;
  };
  nomeDaClinica: string;
  botoesDaPreview?: string[];
  estimativa: Omit<BaseDaEstimativa, "passos">;
  /** confirmacao conta ANTES da consulta; pos falta conta DEPOIS do evento. */
  sentidoDoPasso: "antes" | "depois";
  /** Qual regua e: decide os rotulos padrao dos pontos da linha do tempo. */
  tipoDaRegua: TipoDeReguaDoRotulo;
  /** "a consulta" | "a falta", para os dialogos. */
  eventoRotulo: string;
  /** Campos {{...}} que fazem sentido nesta regua; ausente = todos. */
  placeholders?: readonly string[];
  podeEditar: boolean;
  dicaSemPermissao: string;
  /** So o administrador registra a linha de base (aviso ao ligar). */
  ehAdministrador: boolean;
  /** Dentro de outro cartao (excecao, follow-up): blocos sem casca. */
  aninhada?: boolean;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [passoAberto, setPassoAberto] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<
    "criar" | "momento" | "excluir" | null
  >(null);
  const [pendente, iniciarTransicao] = useTransition();

  const passoSelecionado = useMemo(() => {
    if (!regua || regua.passos.length === 0) {
      return null;
    }
    return (
      regua.passos.find((passo) => passo.id === passoAberto) ??
      regua.passos[0] ??
      null
    );
  }, [regua, passoAberto]);

  if (!regua) {
    const vazio = (
      <EmptyState compact icon={MessagesSquare} title={copy.vazio} />
    );
    return aninhada ? vazio : <Card>{vazio}</Card>;
  }
  const reguaAtual = regua;

  const criarPasso = (offsetMinutes: number, texto: string) => {
    iniciarTransicao(async () => {
      const resultado = await criarPassoAction({
        cadence_id: reguaAtual.id,
        offset_minutes: offsetMinutes,
        fixed_body: texto,
      });
      if (resultado.ok) {
        toast.success("Mensagem criada.");
        setDialogo(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível criar a mensagem.");
    });
  };

  const mudarMomento = (offsetMinutes: number) => {
    if (!passoSelecionado) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await salvarEsperaDoPassoAction({
        cadence_step_id: passoSelecionado.id,
        offset_minutes: offsetMinutes,
      });
      if (resultado.ok) {
        toast.success("Momento da mensagem salvo.");
        setDialogo(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível mudar o momento.");
    });
  };

  const testarEnvio = () => {
    if (!passoSelecionado) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await testarEnvioAction({
        cadence_step_id: passoSelecionado.id,
      });
      if (resultado.ok) {
        toast.success(
          resultado.aviso ??
            "Teste enviado para o WhatsApp da clínica. Confira lá.",
        );
        return;
      }
      toast.error(resultado.error ?? "Não foi possível enviar o teste.");
    });
  };

  const excluirPasso = () => {
    if (!passoSelecionado) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await excluirPassoAction({
        cadence_step_id: passoSelecionado.id,
      });
      if (resultado.ok) {
        toast.success("Mensagem excluída.");
        setDialogo(null);
        setPassoAberto(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  const resultado = estimarRegua({
    ...estimativa,
    // Passo com CONTEUDO: texto ou anexo (pode ser so o audio).
    passos: regua.passos.filter((passo) => passo.fixed_body || passo.media_path)
      .length,
  });

  const ultimaMensagem = regua.passos.length <= 1;
  const rotuloDoSelecionado = passoSelecionado
    ? rotuloDoPasso(passoSelecionado.offset_minutes, tipoDaRegua)
    : "";

  const botaoAdicionar = podeEditar ? (
    <Button
      variant="outline"
      disabled={pendente}
      onClick={() => setDialogo("criar")}
    >
      <Plus aria-hidden />
      Adicionar mensagem
    </Button>
  ) : (
    <DisabledWithHint hint={dicaSemPermissao}>
      <Button variant="outline" disabled>
        <Plus aria-hidden />
        Adicionar mensagem
      </Button>
    </DisabledWithHint>
  );

  return (
    <div className="grid gap-4">
      <Bloco aninhada={aninhada}>
        <ControlesDaRegua
          regua={regua}
          tipo={tipoDaRegua}
          rotuloLigar={copy.ligar}
          rotuloLigada={copy.ligada}
          rotuloDesligada={copy.desligada}
          visivel
          podeEditar={podeEditar}
          dicaSemPermissao={dicaSemPermissao}
          ehAdministrador={ehAdministrador}
          aoMudar={aoMudar}
        />
      </Bloco>

      <Bloco
        aninhada={aninhada}
        titulo="As mensagens da régua"
        descricao="Toque num ponto da linha para editar a mensagem daquele momento."
        acao={botaoAdicionar}
      >
        {passoSelecionado ? (
          <>
            <LinhaDoTempo
              inicioRotulo={copy.inicioDaLinha}
              fimRotulo={copy.fimDaLinha}
              pontos={regua.passos.map((passo) => ({
                id: passo.id,
                rotulo: rotuloDoPasso(passo.offset_minutes, tipoDaRegua),
                temTexto: Boolean(passo.fixed_body || passo.media_path),
              }))}
              selecionadoId={passoSelecionado.id}
              onSelecionar={setPassoAberto}
            />
            {/* Barra do passo: acoes que mudam o passo inteiro. Sem
                permissao, visiveis e desabilitadas, com a dica. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {podeEditar ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={pendente}
                    onClick={() => setDialogo("momento")}
                  >
                    <CalendarClock aria-hidden />
                    Mudar o momento
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={
                      pendente ||
                      (!passoSelecionado.fixed_body &&
                        !passoSelecionado.media_path)
                    }
                    onClick={testarEnvio}
                  >
                    <SendHorizonal aria-hidden />
                    {pendente ? "Enviando..." : "Testar no WhatsApp da clínica"}
                  </Button>
                  {ultimaMensagem ? (
                    <DisabledWithHint
                      hint="A última mensagem não se exclui. Desligue a régua para pausar."
                      className="ml-auto"
                    >
                      <Button variant="destructive" disabled>
                        <Trash2 aria-hidden />
                        Excluir mensagem
                      </Button>
                    </DisabledWithHint>
                  ) : (
                    <Button
                      variant="destructive"
                      className="ml-auto"
                      disabled={pendente}
                      onClick={() => setDialogo("excluir")}
                    >
                      <Trash2 aria-hidden />
                      Excluir mensagem
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <DisabledWithHint hint={dicaSemPermissao}>
                    <Button variant="ghost" disabled>
                      <CalendarClock aria-hidden />
                      Mudar o momento
                    </Button>
                  </DisabledWithHint>
                  <DisabledWithHint hint={dicaSemPermissao}>
                    <Button variant="ghost" disabled>
                      <SendHorizonal aria-hidden />
                      Testar no WhatsApp da clínica
                    </Button>
                  </DisabledWithHint>
                  <DisabledWithHint hint={dicaSemPermissao} className="ml-auto">
                    <Button variant="destructive" disabled>
                      <Trash2 aria-hidden />
                      Excluir mensagem
                    </Button>
                  </DisabledWithHint>
                </>
              )}
            </div>
            <EditorDePasso
              key={passoSelecionado.id}
              passo={passoSelecionado}
              rotulo={rotuloDoSelecionado}
              nomeDaClinica={nomeDaClinica}
              botoes={botoesDaPreview}
              placeholders={placeholders}
              podeEditar={podeEditar}
              dicaSemPermissao={dicaSemPermissao}
              aoMudar={aoMudar}
            />
          </>
        ) : (
          <EmptyState
            compact
            icon={MessagesSquare}
            title="Esta régua ainda não tem mensagens"
            description="Toque em Adicionar mensagem para criar a primeira."
          />
        )}
      </Bloco>

      <Bloco aninhada={aninhada} titulo="Últimos 30 dias">
        <MetricasDaRegua clinicId={clinicId} cadenceId={regua.id} />
        {/* Estimativa em bloco afundado: volume dos ultimos 30 dias vezes
            os passos com conteudo, sem inventar preco. */}
        <div className="flex gap-3 rounded-xl bg-surface-4 p-3.5">
          <Coins
            className="mt-px size-[17px] shrink-0 text-text-secondary"
            aria-hidden
          />
          <div className="grid gap-1 text-[13px]">
            <p className="text-foreground">{resultado.frase}</p>
            <p className="text-text-secondary">{resultado.fraseDeCusto}</p>
          </div>
        </div>
      </Bloco>

      <DialogoDeExclusao
        aberto={dialogo === "excluir"}
        titulo="Excluir esta mensagem?"
        descricao={`A mensagem enviada ${rotuloDoSelecionado.toLowerCase()} deixa de sair para ${EXCLUSAO_DO_PASSO[tipoDaRegua].publico}.`}
        consequencias={[
          "O texto e o anexo desta mensagem são apagados.",
          EXCLUSAO_DO_PASSO[tipoDaRegua].historico,
          PERDAS_DO_HISTORICO.resposta,
        ]}
        rotuloConfirmar="Excluir mensagem"
        pendente={pendente}
        onFechar={() => setDialogo(null)}
        onConfirmar={excluirPasso}
      />
      <DialogPasso
        aberto={dialogo === "criar"}
        onFechar={() => setDialogo(null)}
        titulo="Nova mensagem da régua"
        sentido={sentidoDoPasso}
        eventoRotulo={eventoRotulo}
        offsetInicialMin={null}
        pedirTexto
        pendente={pendente}
        aoConfirmar={criarPasso}
      />
      <DialogPasso
        aberto={dialogo === "momento"}
        onFechar={() => setDialogo(null)}
        titulo="Mudar o momento da mensagem"
        sentido={sentidoDoPasso}
        eventoRotulo={eventoRotulo}
        offsetInicialMin={passoSelecionado?.offset_minutes ?? null}
        pedirTexto={false}
        pendente={pendente}
        aoConfirmar={(offset) => mudarMomento(offset)}
      />
    </div>
  );
}
