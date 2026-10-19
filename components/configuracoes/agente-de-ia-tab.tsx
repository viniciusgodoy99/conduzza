"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bot,
  CircleQuestionMark,
  Phone,
  Plus,
  Power,
  PowerOff,
  Smartphone,
} from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  adicionarTelefoneDaIaAction,
  alternarNumeroDaIaAction,
  alternarTelefoneDaIaAction,
  definirEscolhaDaIaAction,
  definirInterruptorGeralAction,
  type ResultadoDaIa,
} from "@/app/(app)/configuracoes/ia-liberacao-actions";
import {
  avisosAoLigar,
  dicasDaIa,
  ESCOLHAS_DA_IA,
  escolhaAtual,
  estadoDaIa,
  estadoDoNumero,
  estadoDoTelefone,
  faltasParaAEquipe,
  IA_NA_CLINICA_STATUS,
  LIGADO_DESLIGADO_STATUS,
  LIMITE_DO_ROTULO,
  motorDaIaParadoNaAba,
  motivosDaParada,
  NUMERO_DO_ASSISTENTE_STATUS,
  numerosDoDialogo,
  numerosLigados,
  oQueNaoDeuParaConferir,
  porQueNaoAciona,
  quantosTelefonesLigados,
  ROTULO_DA_ESCOLHA,
  rotuloDoNumeroLigado,
  rotuloDoTelefoneLigado,
  TELEFONE_DA_EQUIPE_STATUS,
  telefoneComConversaAberta,
  telefoneDaEquipeSchema,
  telefoneParaExibir,
  TEXTOS_DA_IA,
  temTelefoneQueNaoAciona,
  textoDoTelefoneQueNaoAciona,
  textoDoTeto,
  textosDaParada,
  type AcaoDaIa,
  type EscolhaDaIa,
  type EstadoDaIa,
} from "@/components/configuracoes/agente-de-ia";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  telefoneFormatado,
  type NumeroDoWhatsapp,
} from "@/components/whatsapp/numeros";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";
import type { DadosDaIa, TelefoneDaIa } from "@/lib/queries/ia-liberacao";

// Aba "Agente de IA" de Configuracoes (Fase 3; decisao do dono em
// 05/10/2026). So existe na teste123 e na Conduzza Teste: a pagina decide no
// servidor (abaDaIaVisivel) e nem monta a aba nas outras clinicas.
//
// - "Assistente de IA nesta clinica": o estado em 3 camadas (Desligado, So
//   simulador, Conversando com a equipe, "Ligado, mas parado" com os
//   motivos, ou "Não deu para conferir agora" quando uma leitura falhou e
//   nenhum motivo e conhecido; achado T3), e o seletor do modo. Ligar pede confirmacao; desligar e na
//   hora (e o lado seguro). "Conversar com a equipe" so com ao menos um
//   numero ligado e um telefone ligado (a acao confere de novo).
// - "Números do assistente" (decisao do dono de 19/10/2026): varios numeros
//   ligados ao mesmo tempo, cada um com o proprio estado em 3 camadas e o
//   proprio botao (ligar so numero conectado e so pela equipe Conduzza;
//   desligar tambem pelo administrador, sem mexer nos outros).
// - "Telefones da equipe": so eles conversam com o assistente. O formulario
//   pede sempre a confirmacao do aviso da OpenAI (LGPD, D32); recusa numero
//   de WhatsApp do Conduzza e telefone de paciente (so o super admin usa
//   "Usar mesmo assim", e fica registrado). A linha do telefone que nao
//   aciona o assistente tem estado proprio, e a do telefone com conversa
//   aberta com a equipe avisa que o assistente comeca na proxima conversa.
// - Ligar o atendimento pelo WhatsApp (modo equipe e ligar numero) e so da
//   equipe Conduzza nesta fase: o administrador ve esses controles
//   desabilitados, com a dica; desligar continua com ele. Adicionar telefone
//   e "Ligar de novo" ficam com o administrador desde 19/10/2026 (decisao do
//   dono); "Usar mesmo assim" (o forcar) continua so do super admin.
// - "Interruptor geral": botao so para o super admin; os demais veem o
//   estado e quem liga.
// - "Teto de gasto": so leitura nesta fase.
// Sem permissao (gestor), tudo visivel e desabilitado, com a dica. Uma acao
// por vez: enquanto uma roda, os controles esperam. O resultado das acoes e
// anunciado por uma regiao sempre montada e por um toast (sucesso e erro).

export type DadosDaAbaDaIa = {
  /** Nulo: a leitura da liberacao falhou (a aba mostra o erro). */
  dados: DadosDaIa | null;
  /** Os numeros ATIVOS da clinica (a leitura da aba WhatsApp); nulo: falhou. */
  numeros: NumeroDoWhatsapp[] | null;
  /** T1 e T2: producao com a chave da OpenAI e a clinica na lista fechada. */
  ambienteLigado: boolean;
  /** Administrador da clinica ou super admin. */
  podeEditar: boolean;
  superAdmin: boolean;
  /** Relogio do servidor na carga (epoch ms): o horario do assistente. */
  agoraMs: number;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  fuso: string;
};

type Resultado = { tom: "alert" | "success"; texto: string };

/**
 * Anuncia o fim de uma acao: o toast nos dois casos (sucesso e erro) e, no
 * erro, o texto para a regiao sempre montada (o leitor de tela le, e ele
 * fica na tela depois que o toast some). Nulo em r: o servidor nao
 * respondeu. Devolve o que a regiao mostra (nulo no sucesso).
 */
export function anunciar(
  r: ResultadoDaIa | null,
  sucesso: string,
): Resultado | null {
  if (r?.ok) {
    toast.success(sucesso);
    return null;
  }
  const texto = r ? r.error : TEXTOS_DA_IA.semResposta;
  toast.error(texto);
  return { tom: "alert", texto };
}

type ValoresDoTelefone = z.input<typeof telefoneDaEquipeSchema>;
type TelefoneValidado = z.output<typeof telefoneDaEquipeSchema>;

function comDica(controle: React.ReactNode, dica: string | null) {
  return dica ? (
    <DisabledWithHint hint={dica}>{controle}</DisabledWithHint>
  ) : (
    controle
  );
}

/** Ladrilho decorativo do cabecalho: a cor nao diz estado. */
function Ladrilho({ icone: Icone }: { icone: typeof Bot }) {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
    >
      <Icone className="size-5 text-text-strong" />
    </span>
  );
}

/** Ativos primeiro; dentro de cada grupo, pelo nome. */
export function telefonesNaOrdem(
  telefones: readonly TelefoneDaIa[],
): TelefoneDaIa[] {
  return [...telefones].sort(
    (a, b) =>
      Number(b.ativo) - Number(a.ativo) ||
      (a.rotulo ?? "").localeCompare(b.rotulo ?? "", "pt-BR"),
  );
}

export function AgenteDeIaTab({
  dados,
  numeros,
  ambienteLigado,
  podeEditar,
  superAdmin,
  agoraMs,
  fuso,
}: DadosDaAbaDaIa & { dados: DadosDaIa }) {
  const ids = useId();
  const [pendente, startTransition] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [confirmando, setConfirmando] = useState<Exclude<
    EscolhaDaIa,
    "desligado"
  > | null>(null);
  const [confirmandoInterruptor, setConfirmandoInterruptor] = useState(false);

  const contexto = { dados, numeros, ambienteLigado, agoraMs, fuso };
  const escolha = escolhaAtual(dados.liberacao);
  const estado = estadoDaIa(contexto);
  const motivos = motivosDaParada(contexto);
  const naoConferido = oQueNaoDeuParaConferir(contexto);
  const faltas = faltasParaAEquipe(dados, numeros);
  const numerosNoDialogo = numerosDoDialogo(numerosLigados(dados, numeros));
  const telefonesLigados = quantosTelefonesLigados(dados);
  const dicas = dicasDaIa({
    podeEditar,
    superAdmin,
    faltasParaAEquipe: faltas,
  });
  const teto = textoDoTeto(dados.liberacao);
  const avisosDoLigar = avisosAoLigar({
    ambienteLigado,
    interruptorLigado: dados.interruptorLigado,
    versaoPublicada: dados.situacao.versaoPublicada,
    motorParado: motorDaIaParadoNaAba(dados),
    temTelefoneInvalido: temTelefoneQueNaoAciona(dados),
    modo: confirmando ?? "equipe",
  });

  // sempre: roda no fim, deu certo ou nao (fechar o dialogo). seDerCerto:
  // so quando a acao deu certo (limpar o formulario do telefone).
  // sePedirConfirmacao: a acao recusou pedindo a confirmacao explicita
  // (telefone que ja e de um contato da clinica). sePedirForcar: a acao
  // recusou telefone de paciente e quem pediu e o super admin (D43).
  const executar = (
    qual: string,
    tarefa: () => Promise<ResultadoDaIa>,
    sucesso: string,
    depois: {
      sempre?: () => void;
      seDerCerto?: () => void;
      sePedirConfirmacao?: () => void;
      sePedirForcar?: () => void;
    } = {},
  ) => {
    setResultado(null);
    setAcao(qual);
    startTransition(async () => {
      try {
        const r = await tarefa();
        depois.sempre?.();
        if (r.ok) {
          depois.seDerCerto?.();
        } else {
          if (r.pedeConfirmacao) {
            depois.sePedirConfirmacao?.();
          }
          if (r.pedeForcar) {
            depois.sePedirForcar?.();
          }
        }
        setResultado(anunciar(r, sucesso));
      } catch {
        depois.sempre?.();
        setResultado(anunciar(null, sucesso));
      }
    });
  };
  const ocupado = (qual: string) => pendente && acao === qual;

  const trocarEscolha = (nova: EscolhaDaIa) => {
    if (nova === escolha || pendente) {
      return;
    }
    if (nova === "desligado") {
      executar(
        "escolha",
        () => definirEscolhaDaIaAction({ escolha: "desligado" }),
        "Assistente de IA desligado nesta clínica.",
      );
      return;
    }
    setConfirmando(nova);
  };

  const confirmarEscolha = () => {
    if (!confirmando) {
      return;
    }
    const nova = confirmando;
    executar(
      "escolha",
      () => definirEscolhaDaIaAction({ escolha: nova }),
      nova === "equipe"
        ? "Assistente ligado para conversar com a equipe."
        : "Assistente ligado só no simulador.",
      { sempre: () => setConfirmando(null) },
    );
  };

  // O segmentado: sem permissao, tudo preso (e a dica no grupo inteiro);
  // "Conversar com a equipe" preso para quem nao e a equipe Conduzza (nesta
  // fase) e sem numero ou sem telefone, salvo se ja e a escolha gravada (a
  // opcao ligada nao some debaixo de quem a ve; desligar segue livre).
  const seletor = (
    <SegmentedControl<EscolhaDaIa>
      ariaLabel="Como o assistente funciona nesta clínica"
      // No celular as tres opcoes nao cabem na largura do cartao: o trilho
      // rola por dentro, sem rolagem lateral da pagina.
      className="max-w-full overflow-x-auto"
      value={escolha}
      onChange={trocarEscolha}
      options={ESCOLHAS_DA_IA.map((valor) => ({
        value: valor,
        label: ROTULO_DA_ESCOLHA[valor],
        disabled:
          !podeEditar ||
          pendente ||
          (valor === "equipe" && escolha !== "equipe" && dicas.equipe !== null),
      }))}
    />
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 gap-4">
        {/* Sempre montada: o leitor de tela anuncia o resultado novo. */}
        <div aria-live="polite" aria-atomic="true" className="grid gap-2">
          {resultado ? (
            <Aviso tom={resultado.tom} role="note">
              {resultado.texto}
            </Aviso>
          ) : null}
        </div>

        <Card role="region" aria-labelledby={`${ids}-assistente`}>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <Ladrilho icone={Bot} />
              <div className="grid min-w-0 gap-[3px]">
                <CardTitle id={`${ids}-assistente`}>
                  Assistente de IA nesta clínica
                </CardTitle>
                <CardDescription>
                  Ligue só no simulador para testar sem WhatsApp, ou deixe o
                  assistente conversar com os telefones da equipe pelos números
                  ligados.
                </CardDescription>
              </div>
            </div>
            <CardAction>
              <StatusChip definition={IA_NA_CLINICA_STATUS[estado]} />
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            {motivos.length > 0 ? (
              <Aviso
                tom="warning"
                role="note"
                titulo="Por que o assistente ainda não responde"
              >
                <ul className="grid list-disc gap-1 pl-4">
                  {textosDaParada(contexto).map((texto) => (
                    <li key={texto}>{texto}</li>
                  ))}
                </ul>
              </Aviso>
            ) : estado === "nao_conferido" ? (
              <Aviso
                tom="neutral"
                icone={CircleQuestionMark}
                role="note"
                titulo={TEXTOS_DA_IA.naoConferidoTitulo}
              >
                <ul className="grid list-disc gap-1 pl-4">
                  {naoConferido.map((qual) => (
                    <li key={qual}>{TEXTOS_DA_IA.naoConferido[qual]}</li>
                  ))}
                </ul>
              </Aviso>
            ) : null}

            <div className="flex min-h-10 flex-wrap items-center gap-3">
              {comDica(seletor, dicas.escolha)}
              {ocupado("escolha") ? (
                <span className="text-[13px] text-text-secondary">
                  Salvando...
                </span>
              ) : null}
            </div>
            {podeEditar && escolha !== "equipe" && dicas.equipe ? (
              <p className="text-[13px] text-text-secondary">{dicas.equipe}</p>
            ) : null}

            <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
              <div className="grid content-start gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
                <dt className="font-semibold text-text-strong">Só simulador</dt>
                <dd className="text-text-secondary">
                  O assistente responde só no simulador, dentro do sistema.
                  Ninguém recebe mensagem dele pelo WhatsApp.
                </dd>
              </div>
              <div className="grid content-start gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
                <dt className="font-semibold text-text-strong">
                  Conversar com a equipe
                </dt>
                <dd className="text-text-secondary">
                  O assistente responde pelo WhatsApp dos números ligados, só
                  para os telefones da equipe abaixo. Os pacientes continuam com
                  a equipe.
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <CartaoDosNumeros
          dados={dados}
          numeros={numeros}
          estadoDoAssistente={estado}
          dicas={dicas}
          pendente={pendente}
          ocupado={ocupado}
          aoAlternar={(numero, ligado) =>
            executar(
              `numero-${numero.id}`,
              () =>
                alternarNumeroDaIaAction({
                  whatsappAccountId: numero.id,
                  ligado,
                }),
              ligado
                ? `Número ${numero.nome} ligado ao assistente.`
                : `Número ${numero.nome} desligado do assistente.`,
            )
          }
        />

        <CartaoDosTelefones
          dados={dados}
          estadoDoAssistente={estado}
          superAdmin={superAdmin}
          dicas={dicas}
          pendente={pendente}
          ocupado={ocupado}
          aoAlternar={(telefone, ligado) =>
            executar(
              `telefone-${telefone.id}`,
              () =>
                alternarTelefoneDaIaAction({
                  telefone: telefone.telefone,
                  ligado,
                }),
              ligado ? "Telefone ligado." : "Telefone desligado.",
            )
          }
          aoAdicionar={(valores, { limpar, pedirConfirmacao, pedirForcar }) =>
            executar(
              "telefone-novo",
              () => adicionarTelefoneDaIaAction(valores),
              "Telefone da equipe adicionado.",
              {
                seDerCerto: limpar,
                sePedirConfirmacao: pedirConfirmacao,
                sePedirForcar: pedirForcar,
              },
            )
          }
        />
      </div>

      <div className="grid min-w-0 gap-4">
        <Card role="region" aria-labelledby={`${ids}-interruptor`}>
          <CardHeader>
            <div className="grid min-w-0 gap-[3px]">
              <CardTitle id={`${ids}-interruptor`}>Interruptor geral</CardTitle>
              <CardDescription>
                Liga e desliga o assistente em todas as clínicas de uma vez.
              </CardDescription>
            </div>
            <CardAction>
              <StatusChip
                size="sm"
                definition={
                  LIGADO_DESLIGADO_STATUS[
                    dados.interruptorLigado ? "ligado" : "desligado"
                  ]
                }
              />
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3">
            {superAdmin ? (
              dados.interruptorLigado ? (
                <Button
                  variant="outline"
                  className="w-fit"
                  disabled={pendente}
                  aria-busy={ocupado("interruptor") || undefined}
                  onClick={() =>
                    executar(
                      "interruptor",
                      () => definirInterruptorGeralAction({ ligado: false }),
                      "Interruptor geral desligado.",
                    )
                  }
                >
                  <PowerOff aria-hidden />
                  {ocupado("interruptor")
                    ? "Desligando..."
                    : "Desligar o interruptor geral"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-fit"
                  disabled={pendente}
                  aria-busy={ocupado("interruptor") || undefined}
                  onClick={() => setConfirmandoInterruptor(true)}
                >
                  <Power aria-hidden />
                  {ocupado("interruptor")
                    ? "Ligando..."
                    : "Ligar o interruptor geral"}
                </Button>
              )
            ) : (
              <p className="text-[13px] text-text-secondary">
                {TEXTOS_DA_IA.soEquipeConduzza}
              </p>
            )}
            <p className="text-[12px] text-text-secondary">
              Desligado, nenhuma clínica tem o assistente respondendo, e as
              conversas dele voltam para a equipe sem nenhuma mensagem ao
              paciente.
            </p>
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby={`${ids}-teto`}>
          <CardHeader>
            <div className="grid min-w-0 gap-[3px]">
              <CardTitle id={`${ids}-teto`}>Teto de gasto</CardTitle>
              <CardDescription>
                Quanto o assistente pode gastar nesta clínica.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {teto ? (
              <p className="cz-num text-[15px] font-semibold text-text-strong">
                {teto}
              </p>
            ) : (
              <p className="text-[13px] text-text-secondary">
                {TEXTOS_DA_IA.tetoSemLinha}
              </p>
            )}
            <p className="text-[12px] text-text-secondary">
              {TEXTOS_DA_IA.tetoExplicacao}
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={confirmando !== null}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setConfirmando(null) : null
        }
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {confirmando === "equipe"
                ? "Ligar o assistente para conversar com a equipe?"
                : "Ligar o assistente só no simulador?"}
            </DialogTitle>
            <DialogDescription>
              {confirmando === "equipe"
                ? `O assistente passa a responder pelo WhatsApp${
                    numerosNoDialogo ? ` ${numerosNoDialogo}` : ""
                  }, só para ${
                    telefonesLigados === 1
                      ? "o telefone da equipe ligado"
                      : `os ${telefonesLigados} telefones da equipe ligados`
                  }. Os pacientes continuam sendo atendidos pela equipe.`
                : "O assistente responde só no simulador, dentro do sistema. Ninguém recebe mensagem dele pelo WhatsApp."}
            </DialogDescription>
          </DialogHeader>
          {avisosDoLigar.length > 0 ? (
            <Aviso
              tom="info"
              role="note"
              titulo={TEXTOS_DA_IA.aindaNaoResponde}
            >
              <ul className="grid list-disc gap-1 pl-4">
                {avisosDoLigar.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            </Aviso>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setConfirmando(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={pendente}
              aria-busy={ocupado("escolha") || undefined}
              onClick={confirmarEscolha}
            >
              <Power aria-hidden />
              {ocupado("escolha") ? "Ligando..." : "Ligar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmandoInterruptor}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setConfirmandoInterruptor(false) : null
        }
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Ligar o interruptor geral?</DialogTitle>
            <DialogDescription>
              O assistente passa a responder em todas as clínicas que estão com
              ele ligado, cada uma no modo escolhido por ela.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setConfirmandoInterruptor(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={pendente}
              aria-busy={ocupado("interruptor") || undefined}
              onClick={() =>
                executar(
                  "interruptor",
                  () => definirInterruptorGeralAction({ ligado: true }),
                  "Interruptor geral ligado.",
                  { sempre: () => setConfirmandoInterruptor(false) },
                )
              }
            >
              <Power aria-hidden />
              {ocupado("interruptor") ? "Ligando..." : "Ligar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CartaoDosNumeros({
  dados,
  numeros,
  estadoDoAssistente,
  dicas,
  pendente,
  ocupado,
  aoAlternar,
}: {
  dados: DadosDaIa;
  numeros: NumeroDoWhatsapp[] | null;
  /** "Em uso pelo assistente" so no estado equipe e no numero conectado (achado T4). */
  estadoDoAssistente: EstadoDaIa;
  /** escolha: desligar (so permissao); numero: ligar (equipe Conduzza). */
  dicas: Record<AcaoDaIa, string | null>;
  pendente: boolean;
  ocupado: (qual: string) => boolean;
  aoAlternar: (numero: NumeroDoWhatsapp, ligado: boolean) => void;
}) {
  const tituloId = useId();
  return (
    <Card role="region" aria-labelledby={tituloId}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <Ladrilho icone={Smartphone} />
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={tituloId}>Números do assistente</CardTitle>
            <CardDescription>
              {TEXTOS_DA_IA.descricaoDosNumeros}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {numeros === null ? (
          <Aviso tom="alert" role="note">
            Não foi possível carregar os números de WhatsApp. Recarregue a
            página.
          </Aviso>
        ) : numeros.length === 0 ? (
          <EmptyState
            compact
            icon={Smartphone}
            title="Nenhum número de WhatsApp na clínica"
            description="Adicione e conecte um número na aba WhatsApp. Depois, ligue o número aqui."
            action={{
              label: "Ir para WhatsApp",
              href: "/configuracoes?aba=whatsapp",
              variant: "outline",
            }}
          />
        ) : (
          <ul className="grid gap-2" aria-label="Números da clínica">
            {numeros.map((numero) => {
              const qual = `numero-${numero.id}`;
              const estadoNoAssistente = estadoDoNumero(dados, numero.id);
              const ligado = estadoNoAssistente === "ligado";
              const conectado = numero.status === "conectado";
              const telefone = telefoneFormatado(numero.displayPhone);
              // Cada numero sozinho (19/10/2026): desligar, so a permissao;
              // ligar, so a equipe Conduzza nesta fase, e so numero
              // conectado. Nenhum dos dois mexe nos outros numeros.
              const dica = ligado
                ? dicas.escolha
                : (dicas.numero ??
                  (!conectado ? TEXTOS_DA_IA.conecteAntes : null));
              const botao = (
                <Button
                  variant={ligado ? "ghost" : "outline"}
                  disabled={dica !== null || pendente}
                  aria-busy={ocupado(qual) || undefined}
                  onClick={() => aoAlternar(numero, !ligado)}
                >
                  {ocupado(qual)
                    ? "Salvando..."
                    : ligado
                      ? "Desligar"
                      : "Ligar"}
                </Button>
              );
              return (
                <li
                  key={numero.id}
                  className={
                    ligado
                      ? "grid gap-2 rounded-lg border border-border px-3.5 py-3"
                      : "grid gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3"
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid min-w-0 gap-1">
                      <span className="font-semibold break-words text-text-strong">
                        {numero.nome}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
                        {telefone ? (
                          <span className="cz-num">{telefone}</span>
                        ) : null}
                        <StatusChip
                          size="sm"
                          definition={WHATSAPP_CONNECTION_STATUS[numero.status]}
                        />
                        <StatusChip
                          size="sm"
                          definition={
                            NUMERO_DO_ASSISTENTE_STATUS[estadoNoAssistente]
                          }
                          label={
                            ligado
                              ? rotuloDoNumeroLigado(
                                  estadoDoAssistente,
                                  conectado,
                                )
                              : undefined
                          }
                        />
                      </span>
                    </div>
                    {comDica(botao, dica)}
                  </div>
                  {ligado && !conectado ? (
                    <Aviso tom="warning" role="note">
                      {TEXTOS_DA_IA.numeroDesconectado}
                    </Aviso>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CartaoDosTelefones({
  dados,
  estadoDoAssistente,
  superAdmin,
  dicas,
  pendente,
  ocupado,
  aoAlternar,
  aoAdicionar,
}: {
  dados: DadosDaIa;
  /** "Conversa com o assistente" so no estado equipe (achado T4). */
  estadoDoAssistente: EstadoDaIa;
  superAdmin: boolean;
  /** escolha: desligar (so permissao); telefone: adicionar e ligar. */
  dicas: Record<AcaoDaIa, string | null>;
  pendente: boolean;
  ocupado: (qual: string) => boolean;
  aoAlternar: (telefone: TelefoneDaIa, ligado: boolean) => void;
  aoAdicionar: (
    valores: TelefoneValidado,
    retorno: {
      limpar: () => void;
      pedirConfirmacao: () => void;
      pedirForcar: () => void;
    },
  ) => void;
}) {
  const tituloId = useId();
  const telefones = dados.telefones;
  // Sem confirmarAvisoDaOpenai: a caixa nasce desmarcada (o schema so aceita
  // true, e o formulario mostra a mensagem quando falta).
  const vazio = {
    rotulo: "",
    telefone: "",
    confirmarContato: false,
    forcarContatoDePaciente: false,
  };
  const form = useForm<ValoresDoTelefone, unknown, TelefoneValidado>({
    resolver: zodResolver(telefoneDaEquipeSchema),
    defaultValues: vazio,
  });
  // Adicionar e ligar: o administrador da clinica e o super admin (desde
  // 19/10/2026; dicas.telefone so pede a permissao).
  const dica = dicas.telefone;
  const podeAdicionar = dica === null;
  // O telefone (como digitado) para o qual a acao pediu a confirmacao: o
  // campo de confirmacao so aparece enquanto o telefone e esse. Trocar o
  // telefone desmarca (a confirmacao vale para um telefone so).
  const [confirmacaoPara, setConfirmacaoPara] = useState<string | null>(null);
  // O mesmo para o "Usar mesmo assim" (so o super admin, depois da recusa
  // de telefone de paciente).
  const [forcarPara, setForcarPara] = useState<string | null>(null);
  const telefoneDigitado = form.watch("telefone");
  const pedindoConfirmacao =
    confirmacaoPara !== null && confirmacaoPara === telefoneDigitado;
  const pedindoForcar =
    superAdmin && forcarPara !== null && forcarPara === telefoneDigitado;

  const botaoAdicionar = (
    <Button
      type="submit"
      disabled={!podeAdicionar || pendente}
      aria-busy={ocupado("telefone-novo") || undefined}
    >
      <Plus aria-hidden />
      {ocupado("telefone-novo") ? "Adicionando..." : "Adicionar"}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby={tituloId}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <Ladrilho icone={Phone} />
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={tituloId}>Telefones da equipe</CardTitle>
            <CardDescription>
              O celular de quem vai conversar com o assistente para testar.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Aviso tom="info" role="note">
          {TEXTOS_DA_IA.soEstesTelefones}
        </Aviso>

        <Form {...form}>
          <form
            noValidate
            aria-label="Adicionar telefone da equipe"
            className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]"
            onSubmit={(evento) =>
              void form.handleSubmit((valores) => {
                const digitado = form.getValues("telefone");
                aoAdicionar(
                  {
                    ...valores,
                    // Marcado escondido (de outro telefone) nao vale.
                    confirmarContato:
                      pedindoConfirmacao && valores.confirmarContato === true,
                    forcarContatoDePaciente:
                      pedindoForcar && valores.forcarContatoDePaciente === true,
                  },
                  {
                    limpar: () => {
                      form.reset(vazio);
                      setConfirmacaoPara(null);
                      setForcarPara(null);
                    },
                    pedirConfirmacao: () => {
                      form.setValue("confirmarContato", false);
                      setConfirmacaoPara(digitado);
                    },
                    pedirForcar: () => {
                      form.setValue("forcarContatoDePaciente", false);
                      setForcarPara(digitado);
                    },
                  },
                );
              })(evento)
            }
          >
            <FormField
              control={form.control}
              name="rotulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>De quem é</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={LIMITE_DO_ROTULO}
                      placeholder="Por exemplo: Vinicius, recepção"
                      autoComplete="off"
                      disabled={!podeAdicionar}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="telefone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(evento) => {
                        field.onChange(evento);
                        form.setValue("confirmarContato", false);
                        form.setValue("forcarContatoDePaciente", false);
                      }}
                      type="tel"
                      inputMode="tel"
                      placeholder="(84) 99999-0000"
                      autoComplete="off"
                      disabled={!podeAdicionar}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:pt-[22px]">{comDica(botaoAdicionar, dica)}</div>
            {/* LGPD (D32): sempre presente, nunca marcada sozinha. */}
            <FormField
              control={form.control}
              name="confirmarAvisoDaOpenai"
              render={({ field }) => (
                <FormItem className="grid gap-1 sm:col-span-3">
                  <div className="flex min-h-10 items-center gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(valor) =>
                          field.onChange(valor === true ? true : undefined)
                        }
                        onBlur={field.onBlur}
                        disabled={!podeAdicionar || pendente}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {TEXTOS_DA_IA.confirmarAvisoDaOpenai}
                    </FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* So o super admin, depois da recusa de telefone de paciente
                (o motivo ja esta no aviso do topo e no toast). */}
            {pedindoForcar ? (
              <div className="grid gap-2 sm:col-span-3">
                <FormField
                  control={form.control}
                  name="forcarContatoDePaciente"
                  render={({ field }) => (
                    <FormItem className="flex min-h-10 items-center gap-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(valor) =>
                            field.onChange(valor === true)
                          }
                          onBlur={field.onBlur}
                          disabled={pendente}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {TEXTOS_DA_IA.forcarContatoDePaciente}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            ) : null}
            {pedindoConfirmacao ? (
              <FormField
                control={form.control}
                name="confirmarContato"
                render={({ field }) => (
                  <FormItem className="flex min-h-10 items-center gap-3 sm:col-span-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(valor) =>
                          field.onChange(valor === true)
                        }
                        onBlur={field.onBlur}
                        disabled={!podeAdicionar || pendente}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {TEXTOS_DA_IA.confirmarContato}
                    </FormLabel>
                  </FormItem>
                )}
              />
            ) : null}
          </form>
        </Form>

        {telefones.length === 0 ? (
          <EmptyState
            compact
            icon={Phone}
            title="Nenhum telefone da equipe ainda"
            description="Cadastre acima o celular de quem vai conversar com o assistente. Sem telefone, o assistente não conversa com ninguém pelo WhatsApp."
          />
        ) : (
          <ul className="grid gap-2" aria-label="Telefones cadastrados">
            {telefonesNaOrdem(telefones).map((telefone) => {
              const qual = `telefone-${telefone.id}`;
              const estado = estadoDoTelefone(dados, telefone.id);
              const invalido = estado === "invalido";
              const naoAciona = porQueNaoAciona(dados, telefone.id);
              const textoDeQueNaoAciona =
                naoAciona === null
                  ? null
                  : textoDoTelefoneQueNaoAciona(naoAciona);
              const conversaAberta =
                telefone.ativo &&
                !invalido &&
                telefoneComConversaAberta(dados, telefone.id);
              // Desligar: so a permissao (nunca recusado). Ligar de novo: a
              // permissao (administrador ou super admin, desde 19/10/2026),
              // e nunca o telefone que nao aciona o assistente (o invalido o
              // banco recusa; o do contato sem autorizacao ligaria sem nunca
              // conversar).
              const dicaDaLinha = telefone.ativo
                ? dicas.escolha
                : (dicas.telefone ?? textoDeQueNaoAciona);
              const botao = (
                <Button
                  variant={telefone.ativo ? "ghost" : "outline"}
                  disabled={dicaDaLinha !== null || pendente}
                  aria-busy={ocupado(qual) || undefined}
                  onClick={() => aoAlternar(telefone, !telefone.ativo)}
                >
                  {ocupado(qual)
                    ? "Salvando..."
                    : telefone.ativo
                      ? "Desligar"
                      : "Ligar de novo"}
                </Button>
              );
              return (
                <li
                  key={telefone.id}
                  className={
                    telefone.ativo && !invalido
                      ? "grid gap-2 rounded-lg border border-border px-3.5 py-3"
                      : "grid gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3"
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid min-w-0 gap-1">
                      <span className="font-semibold break-words text-text-strong">
                        {telefone.rotulo ?? "Sem nome"}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
                        <span className="cz-num">
                          {telefoneParaExibir(telefone.telefone)}
                        </span>
                        <StatusChip
                          size="sm"
                          definition={TELEFONE_DA_EQUIPE_STATUS[estado]}
                          label={
                            estado === "ligado"
                              ? rotuloDoTelefoneLigado(estadoDoAssistente)
                              : undefined
                          }
                        />
                      </span>
                    </div>
                    {comDica(botao, dicaDaLinha)}
                  </div>
                  {textoDeQueNaoAciona !== null ? (
                    <Aviso tom="warning" role="note">
                      {textoDeQueNaoAciona}
                    </Aviso>
                  ) : null}
                  {conversaAberta ? (
                    <Aviso tom="info" role="note">
                      {TEXTOS_DA_IA.conversaAbertaNoNumero}
                    </Aviso>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
