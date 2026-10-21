"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bot,
  CircleQuestionMark,
  MessageSquareText,
  Pause,
  Phone,
  Play,
  Plus,
  Power,
  Smartphone,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  adicionarTelefoneDaIaAction,
  alternarNumeroDaIaAction,
  alternarTelefoneDaIaAction,
  definirEscolhaDaIaAction,
  definirPausaDaIaAction,
  excluirTelefoneDaIaAction,
  type ResultadoDaIa,
} from "@/app/(app)/agente/whatsapp-actions";
import {
  apoioAoDesligar,
  apoioAoDesligarOWhatsapp,
  avisosAoLigar,
  conversasAbertasDoTelefone,
  dicasDaIa,
  ESCOLHAS_DA_IA,
  escolhaAtual,
  estadoDaIa,
  estadoDoNumero,
  estadoDoTelefone,
  faltasParaAEquipe,
  IA_NA_CLINICA_STATUS,
  LIMITE_DO_ROTULO,
  LINK_DOS_NUMEROS,
  linkDaConversa,
  motorDaIaParadoNaAba,
  motivosDaParada,
  NUMERO_DO_ASSISTENTE_STATUS,
  numerosDoDialogo,
  numerosLigados,
  numerosLivresDoTelefone,
  oQueNaoDeuParaConferir,
  porQueNaoAciona,
  quantosTelefonesLigados,
  ROTULO_DA_ESCOLHA,
  rotuloDoLinkDaConversa,
  rotuloDoNumeroLigado,
  rotuloDoTelefoneLigado,
  TELEFONE_DA_EQUIPE_STATUS,
  telefoneDaEquipeSchema,
  telefoneParaExibir,
  TEXTOS_DA_IA,
  TEXTOS_DO_TESTE_COM_PACIENTE,
  temTelefoneQueNaoAciona,
  textoDaConversaAberta,
  textoDoLimiteDeGasto,
  textoDoTelefoneQueNaoAciona,
  textosDaParada,
  whatsappLigado,
  type AcaoDaIa,
  type EscolhaDaAba,
  type EscolhaDaIa,
  type EstadoDaIa,
} from "@/components/agente/whatsapp/agente-de-ia";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
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
import { Label } from "@/components/ui/label";
import {
  telefoneFormatado,
  type NumeroDoWhatsapp,
} from "@/components/whatsapp/numeros";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";
import type { DadosDaIa, TelefoneDaIa } from "@/lib/queries/ia-liberacao";

// Aba "WhatsApp" da tela Agente de IA (Tela 6; onda 2, item 8, decisao do
// dono de 20/10/2026: tudo do agente num lugar so). Ate a onda 2 era a aba
// "Agente de IA" de Configuracoes. So existe nas clinicas com o agente
// habilitado (a pagina decide no servidor e nem monta a tela nas outras).
// O que se muda aqui vale na hora, sem publicar: a linha do topo diz isso,
// e o rodape de publicar nao conta esta aba.
//
// - "Assistente de IA nesta clinica": o estado em 3 camadas (Desligado, So
//   simulador, Conversando com a equipe, Atendendo os contatos, "Ligado, mas
//   parado" com os motivos, ou "Não deu para conferir agora" quando uma
//   leitura falhou e nenhum motivo e conhecido; achado T3), o seletor do
//   modo, a pausa e a retomada pela clinica (onda 2, P11c) e a linha do
//   limite de gasto (so leitura; P8). Ligar e retomar pedem confirmacao;
//   desligar e pausar sao na hora (o lado seguro). "Conversar com a equipe"
//   so com ao menos um numero ligado e um telefone ligado (a acao confere de
//   novo). "Atendendo os contatos" (producao) aparece sempre e so muda pelo
//   Painel geral.
// - "Números do assistente" (decisao do dono de 19/10/2026): varios numeros
//   ligados ao mesmo tempo, cada um com o proprio estado em 3 camadas e o
//   proprio botao (ligar so numero conectado e so pela equipe Conduzza;
//   desligar tambem pelo administrador, sem mexer nos outros).
// - "Telefones da equipe": o formulario pede sempre a confirmacao do aviso
//   da OpenAI (LGPD, D32); recusa numero de WhatsApp do Conduzza; o telefone
//   de paciente abre o dialogo do "Usar mesmo assim" com a confirmacao do
//   teste (onda 2, item 3, decisao P3: o administrador tambem). Cada linha
//   tem "Excluir" com confirmacao (onda 2, item 9). A linha do telefone que
//   nao aciona o assistente tem estado proprio e diz por que (inclusive o
//   contato fora do publico escolhido, P4b), e a do telefone com conversa
//   aberta com a equipe diz em QUAL numero e o que fazer, com o link para a
//   conversa (revisao de producao de 19/10/2026).
// - Quem desliga e nao liga de novo (o administrador da clinica) le "Depois
//   de desligar, só a equipe Conduzza liga de novo." junto do seletor (com
//   o WhatsApp ligado), no dialogo do "Só simulador" e em cada numero
//   ligado.
// Sem permissao (gestor), tudo visivel e desabilitado, com a dica e a linha
// escrita no topo. A recepcao ve so a linha de quem cuida
// (AbaWhatsappDaRecepcao): a RLS nao entrega as linhas. Uma acao por vez:
// enquanto uma roda, os controles esperam. O resultado das acoes e
// anunciado por uma regiao sempre montada e por um toast (sucesso e erro).
//
// Painel geral (onda 1): os cartoes "Números do assistente" e "Telefones da
// equipe" tambem servem a uma clinica escolhida pela equipe Conduzza
// (components/painel-geral). No modo noPainel, as acoes levam o clinicId da
// tela (so o super admin passa, na action e no banco), o vazio dos numeros
// nao leva a Configuracoes de quem ve, a conversa aberta nao vira link e o
// telefone novo pede sempre a confirmacao de que e de alguem da equipe. O
// ciclo de cada acao (useAcaoDaIa) e a regiao do resultado sao os mesmos.

export type DadosDaAbaWhatsapp = {
  /** Nulo: a leitura da liberacao falhou (a aba mostra o erro). */
  dados: DadosDaIa | null;
  /**
   * Os numeros ATIVOS da clinica (a leitura da aba WhatsApp de
   * Configuracoes); nulo: falhou.
   */
  numeros: NumeroDoWhatsapp[] | null;
  /** T1 e T2: producao com a chave da OpenAI e a clinica na lista do banco. */
  ambienteLigado: boolean;
  /** Administrador da clinica ou super admin (o gestor ve sem alterar). */
  podeEditar: boolean;
  superAdmin: boolean;
  /** Relogio do servidor na carga (epoch ms): o horario do assistente. */
  agoraMs: number;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  fuso: string;
  /**
   * Os ids dos telefones usados mesmo sendo de paciente (forcado): o dialogo
   * de excluir avisa que voltar pede a confirmacao de novo. Nulo: a leitura
   * falhou (o dialogo fica com o texto de sempre).
   */
  telefonesForcados: string[] | null;
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

/**
 * sempre: roda no fim, deu certo ou nao (fechar o dialogo). seDerCerto: so
 * quando a acao deu certo (limpar o formulario do telefone).
 * sePedirConfirmacao: a acao recusou pedindo a confirmacao explicita
 * (telefone que ja e de um contato da clinica). sePedirForcar: a acao
 * recusou telefone de paciente (o dialogo do "Usar mesmo assim").
 */
type DepoisDaAcao = {
  sempre?: () => void;
  seDerCerto?: () => void;
  sePedirConfirmacao?: () => void;
  sePedirForcar?: () => void;
};

/**
 * O ciclo de uma acao da aba: uma por vez (enquanto uma roda, os controles
 * esperam), o fim no toast e, no erro, o texto para a regiao sempre montada
 * (resultado). Os cartoes de numeros e de telefones do Painel geral usam o
 * mesmo ciclo.
 */
export function useAcaoDaIa() {
  const [pendente, startTransition] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const executar = (
    qual: string,
    tarefa: () => Promise<ResultadoDaIa>,
    sucesso: string,
    depois: DepoisDaAcao = {},
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

  return { pendente, resultado, executar, ocupado };
}

/** Sempre montada: o leitor de tela anuncia o resultado novo. */
export function RegiaoDoResultado({
  resultado,
}: {
  resultado: Resultado | null;
}) {
  return (
    <div aria-live="polite" aria-atomic="true" className="grid gap-2">
      {resultado ? (
        <Aviso tom={resultado.tom} role="note">
          {resultado.texto}
        </Aviso>
      ) : null}
    </div>
  );
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

/** A linha do topo da aba: o que se muda aqui vale na hora. */
function LinhaDoTopo() {
  return (
    <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
      {TEXTOS_DA_IA.valeNaHora}
    </p>
  );
}

/**
 * A aba para a recepcao: a Tela 6 ela ve sem alterar, mas os numeros e os
 * telefones do assistente a RLS nao entrega (so administrador, gestor e
 * super admin leem a liberacao). So a linha de quem cuida.
 */
export function AbaWhatsappDaRecepcao() {
  return (
    <div className="grid gap-4">
      <LinhaDoTopo />
      <Card>
        <EmptyState
          compact
          icon={Smartphone}
          title="Números e telefones do assistente"
          description={TEXTOS_DA_IA.soAdministradorEGestor}
        />
      </Card>
    </div>
  );
}

/**
 * A aba inteira para quem le a liberacao (administrador, gestor e super
 * admin). Leitura que falhou vira o erro da aba, nunca uma clinica
 * "desligada" que nao e.
 */
export function AbaWhatsapp(props: DadosDaAbaWhatsapp) {
  if (props.dados === null) {
    return (
      <div className="grid gap-4">
        <LinhaDoTopo />
        <Card>
          <EmptyState
            tom="erro"
            title="Não foi possível carregar o assistente de IA"
            description="Recarregue a página. Se continuar, fale com o suporte."
          />
        </Card>
      </div>
    );
  }
  return <AbaWhatsappCarregada {...props} dados={props.dados} />;
}

function AbaWhatsappCarregada({
  dados,
  numeros,
  ambienteLigado,
  podeEditar,
  superAdmin,
  agoraMs,
  fuso,
  telefonesForcados,
}: DadosDaAbaWhatsapp & { dados: DadosDaIa }) {
  const ids = useId();
  const { pendente, resultado, executar, ocupado } = useAcaoDaIa();
  const [confirmando, setConfirmando] = useState<Exclude<
    EscolhaDaAba,
    "desligado"
  > | null>(null);
  const [confirmandoRetomar, setConfirmandoRetomar] = useState(false);

  const contexto = { dados, numeros, ambienteLigado, agoraMs, fuso };
  const escolha = escolhaAtual(dados.liberacao);
  const emProducao = escolha === "producao";
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
    emProducao,
  });
  const avisosDoLigar = avisosAoLigar({
    ambienteLigado,
    interruptorLigado: dados.interruptorLigado,
    versaoPublicada: dados.situacao.versaoPublicada,
    motorParado: motorDaIaParadoNaAba(dados),
    temTelefoneInvalido: temTelefoneQueNaoAciona(dados),
    modo: confirmando ?? "equipe",
    superAdmin,
  });
  // "Depois de desligar, só a equipe Conduzza liga de novo.": para quem
  // desliga e nao liga de novo (o administrador). No seletor e no dialogo
  // do "Só simulador", so com o WhatsApp ligado (o simulador ele religa).
  const apoioDoDesligar = apoioAoDesligar({ podeEditar, superAdmin });
  const apoioNoSeletor = apoioAoDesligarOWhatsapp({
    escolha,
    podeEditar,
    superAdmin,
  });
  const pausada = dados.liberacao?.pausadaPelaClinica ?? false;
  const forcados = telefonesForcados ? new Set(telefonesForcados) : null;

  const trocarEscolha = (nova: EscolhaDaIa) => {
    // A producao nunca muda por aqui (so o Painel geral): a opcao fica
    // desabilitada, e o clique na escolhida nao faz nada.
    if (
      nova === escolha ||
      nova === "producao" ||
      pendente ||
      dicas.modo !== null
    ) {
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

  const pausar = () =>
    executar(
      "pausa",
      () => definirPausaDaIaAction({ pausada: true }),
      TEXTOS_DA_IA.pausado,
    );

  // O segmentado: sem permissao, tudo preso (e a dica no grupo inteiro);
  // "Conversar com a equipe" preso para quem nao e a equipe Conduzza (nesta
  // fase), sem numero ou sem telefone, salvo se ja e a escolha gravada (a
  // opcao ligada nao some debaixo de quem a ve; desligar segue livre).
  // "Atendendo os contatos" so o Painel geral liga. Com o assistente em
  // producao (revisao da onda 2), o seletor inteiro fica preso, com a dica:
  // so o Painel geral muda o modo, e a clinica para pelo Pausar.
  const seletor = (
    <SegmentedControl<EscolhaDaIa>
      ariaLabel="Como o assistente funciona nesta clínica"
      // No celular as opcoes nao cabem na largura do cartao: o trilho rola
      // por dentro, sem rolagem lateral da pagina.
      className="max-w-full overflow-x-auto"
      value={escolha}
      onChange={trocarEscolha}
      options={ESCOLHAS_DA_IA.map((valor) => ({
        value: valor,
        label: ROTULO_DA_ESCOLHA[valor],
        disabled:
          !podeEditar ||
          pendente ||
          dicas.modo !== null ||
          (valor === "equipe" &&
            escolha !== "equipe" &&
            dicas.equipe !== null) ||
          (valor === "producao" && escolha !== "producao"),
      }))}
    />
  );

  const botaoDaPausa = pausada ? (
    <Button
      disabled={dicas.pausa !== null || pendente}
      aria-busy={ocupado("pausa") || undefined}
      onClick={() => setConfirmandoRetomar(true)}
    >
      <Play aria-hidden />
      {ocupado("pausa") ? "Retomando..." : TEXTOS_DA_IA.retomar}
    </Button>
  ) : (
    <Button
      variant="outline"
      disabled={dicas.pausa !== null || pendente}
      aria-busy={ocupado("pausa") || undefined}
      onClick={pausar}
    >
      <Pause aria-hidden />
      {ocupado("pausa") ? "Pausando..." : TEXTOS_DA_IA.pausar}
    </Button>
  );

  return (
    <div className="grid min-w-0 gap-4">
      <LinhaDoTopo />
      {podeEditar ? null : (
        <Aviso tom="info" role="note">
          {TEXTOS_DA_IA.semPermissao}
        </Aviso>
      )}
      <RegiaoDoResultado resultado={resultado} />

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
                {textosDaParada(contexto, superAdmin).map((texto) => (
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
            {comDica(seletor, dicas.modo)}
            {ocupado("escolha") ? (
              <span className="text-[13px] text-text-secondary">
                Salvando...
              </span>
            ) : null}
          </div>
          {podeEditar && escolha !== "equipe" && dicas.equipe ? (
            <p className="text-[13px] text-text-secondary">{dicas.equipe}</p>
          ) : null}
          {dicas.producao ? (
            <p className="text-[13px] text-text-secondary">{dicas.producao}</p>
          ) : null}
          {apoioNoSeletor ? (
            <p className="text-[13px] text-text-secondary">{apoioNoSeletor}</p>
          ) : null}

          {/* Pausar e retomar (onda 2, P11c): pausar so com o WhatsApp
              ligado; retomar sempre que a pausa estiver gravada, em
              qualquer modo (revisao da onda 2: a pausa tambem trava o
              simulador). A pausa e o lado seguro e sai na hora; retomar
              pede confirmacao. */}
          {whatsappLigado(escolha) || pausada ? (
            <div className="grid gap-2 rounded-lg border border-border px-3.5 py-3">
              <div className="flex min-h-10 flex-wrap items-center gap-3">
                {comDica(botaoDaPausa, dicas.pausa)}
              </div>
              <p className="text-[12px] text-text-secondary">
                {TEXTOS_DA_IA.pausaExplicacao}
              </p>
            </div>
          ) : null}

          <dl className="grid gap-2 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
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
                O assistente responde pelo WhatsApp dos números ligados, só para
                os telefones da equipe abaixo. Os pacientes continuam com a
                equipe.
              </dd>
            </div>
            <div className="grid content-start gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
              <dt className="font-semibold text-text-strong">
                Atendendo os contatos
              </dt>
              <dd className="text-text-secondary">
                O assistente responde pelo WhatsApp dos números ligados a quem
                escrever, dentro do público escolhido em Regras e limites. Só a
                equipe Conduzza liga, pelo Painel geral.
              </dd>
            </div>
          </dl>

          {/* O limite de gasto, so leitura (onda 2, P8): o ajuste e da
              equipe Conduzza, no Painel geral. */}
          <div className="grid gap-0.5">
            <p className="cz-num text-[13px] font-semibold text-text-strong">
              {textoDoLimiteDeGasto(dados.liberacao)}
            </p>
            <p className="text-[12px] text-text-secondary">
              {TEXTOS_DA_IA.tetoExplicacao}
            </p>
          </div>
        </CardContent>
      </Card>

      <CartaoDosNumeros
        dados={dados}
        numeros={numeros}
        estadoDoAssistente={estado}
        emProducao={emProducao}
        dicas={dicas}
        apoioDoDesligar={apoioDoDesligar}
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
        numeros={numeros}
        estadoDoAssistente={estado}
        emProducao={emProducao}
        forcados={forcados}
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
        aoExcluir={(telefone, { fechar }) =>
          executar(
            `excluir-${telefone.id}`,
            () => excluirTelefoneDaIaAction({ id: telefone.id }),
            TEXTOS_DA_IA.telefoneExcluido,
            { sempre: fechar },
          )
        }
        aoAdicionar={(valores, depois) =>
          executar(
            "telefone-novo",
            () => adicionarTelefoneDaIaAction(valores),
            "Telefone da equipe adicionado.",
            depois,
          )
        }
      />

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
          {confirmando === "simulador" && apoioNoSeletor ? (
            // Com o WhatsApp ligado, "Só simulador" desliga o atendimento
            // pelo WhatsApp, e o administrador nao liga de novo.
            <Aviso tom="warning" role="note">
              {apoioNoSeletor}
            </Aviso>
          ) : null}
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
        open={confirmandoRetomar}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setConfirmandoRetomar(false) : null
        }
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{TEXTOS_DA_IA.retomarTitulo}</DialogTitle>
            <DialogDescription>{TEXTOS_DA_IA.retomarTexto}</DialogDescription>
          </DialogHeader>
          {motivos.filter((motivo) => motivo !== "pausada").length > 0 ? (
            <Aviso
              tom="info"
              role="note"
              titulo={TEXTOS_DA_IA.aindaNaoResponde}
            >
              <ul className="grid list-disc gap-1 pl-4">
                {textosDaParada(contexto, superAdmin)
                  .filter((texto) => texto !== TEXTOS_DA_IA.motivos.pausada)
                  .map((texto) => (
                    <li key={texto}>{texto}</li>
                  ))}
              </ul>
            </Aviso>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setConfirmandoRetomar(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={pendente}
              aria-busy={ocupado("pausa") || undefined}
              onClick={() =>
                executar(
                  "pausa",
                  () => definirPausaDaIaAction({ pausada: false }),
                  TEXTOS_DA_IA.retomado,
                  { sempre: () => setConfirmandoRetomar(false) },
                )
              }
            >
              <Play aria-hidden />
              {ocupado("pausa") ? "Retomando..." : TEXTOS_DA_IA.retomar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * O telefone do numero na linha: o pareado, como a recepcao discaria. O
 * Painel geral troca pelos 4 ultimos digitos (o painel nao traz o numero
 * inteiro).
 */
function telefoneDoNumeroPadrao(numero: NumeroDoWhatsapp): string | null {
  return telefoneFormatado(numero.displayPhone);
}

/**
 * "Números do assistente". Na aba da Tela 6, os numeros da clinica ativa. No
 * Painel geral (noPainel), os de uma clinica escolhida pela equipe
 * Conduzza: o vazio nao leva a Configuracoes (que e da clinica ativa de quem
 * ve, nao desta) e diz quem conecta.
 */
export function CartaoDosNumeros({
  dados,
  numeros,
  estadoDoAssistente,
  emProducao = false,
  dicas,
  apoioDoDesligar,
  pendente,
  ocupado,
  aoAlternar,
  noPainel = false,
  telefoneDoNumero = telefoneDoNumeroPadrao,
}: {
  dados: DadosDaIa;
  numeros: NumeroDoWhatsapp[] | null;
  /** "Em uso pelo assistente" so no estado verde e no numero conectado (achado T4). */
  estadoDoAssistente: EstadoDaIa;
  /** O assistente atende os contatos (producao): a descricao muda. */
  emProducao?: boolean;
  /** escolha: desligar (so permissao); numero: ligar (equipe Conduzza). */
  dicas: Record<AcaoDaIa, string | null>;
  /**
   * A linha de apoio junto do "Desligar" de cada numero ligado, para quem
   * nao liga de novo (apoioAoDesligar). Nula: sem linha.
   */
  apoioDoDesligar: string | null;
  pendente: boolean;
  ocupado: (qual: string) => boolean;
  aoAlternar: (numero: NumeroDoWhatsapp, ligado: boolean) => void;
  /** Painel geral: a clinica nao e a ativa de quem ve. */
  noPainel?: boolean;
  /** O telefone escrito na linha; nulo: sem telefone. */
  telefoneDoNumero?: (numero: NumeroDoWhatsapp) => string | null;
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
              {emProducao
                ? TEXTOS_DA_IA.descricaoDosNumerosEmProducao
                : TEXTOS_DA_IA.descricaoDosNumeros}
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
          noPainel ? (
            <EmptyState
              compact
              icon={Smartphone}
              title="Nenhum número de WhatsApp na clínica"
              description={TEXTOS_DO_PAINEL.semNumerosNoPainel}
            />
          ) : (
            <EmptyState
              compact
              icon={Smartphone}
              title="Nenhum número de WhatsApp na clínica"
              description={TEXTOS_DA_IA.semNumeros}
              action={{
                label: TEXTOS_DA_IA.abrirConfiguracoes,
                href: LINK_DOS_NUMEROS,
                variant: "outline",
              }}
            />
          )
        ) : (
          <ul className="grid gap-2" aria-label="Números da clínica">
            {numeros.map((numero) => {
              const qual = `numero-${numero.id}`;
              const estadoNoAssistente = estadoDoNumero(dados, numero.id);
              const ligado = estadoNoAssistente === "ligado";
              const conectado = numero.status === "conectado";
              const telefone = telefoneDoNumero(numero);
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
                  {ligado && apoioDoDesligar ? (
                    <p className="text-[12px] text-text-secondary">
                      {apoioDoDesligar}
                    </p>
                  ) : null}
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

/** O que a tela faz depois de adicionar (o mesmo ciclo do useAcaoDaIa). */
type DepoisDeAdicionar = {
  sempre?: () => void;
  seDerCerto?: () => void;
  sePedirConfirmacao?: () => void;
  sePedirForcar?: () => void;
};

/**
 * "Telefones da equipe". No Painel geral (noPainel), de uma clinica
 * escolhida pela equipe Conduzza: a confirmacao "Confirmo que este telefone
 * e de alguem da equipe" fica sempre a vista e e obrigatoria (o painel nao
 * consulta os contatos da clinica, entao nao sabe se o telefone ja e de um
 * paciente; o banco continua recusando o de paciente sem o forcar), e a
 * conversa aberta nao vira link (o Atendimento abre a clinica ativa de quem
 * ve, nao esta).
 *
 * O "Usar mesmo assim" do telefone de paciente (onda 2, item 3, P3) e um
 * dialogo com a confirmacao do teste, para quem passa na guarda (o
 * administrador da clinica e o super admin): o formulario guarda o que foi
 * mandado e manda de novo com o forcar e a confirmacao. "Excluir" (item 9)
 * pede confirmacao e diz, no telefone forcado, que voltar pede a
 * confirmacao de novo.
 */
export function CartaoDosTelefones({
  dados,
  numeros,
  estadoDoAssistente,
  emProducao = false,
  forcados,
  dicas,
  pendente,
  ocupado,
  aoAlternar,
  aoExcluir,
  aoAdicionar,
  noPainel = false,
}: {
  dados: DadosDaIa;
  /**
   * Os numeros ATIVOS da clinica: o nome do numero com conversa aberta e os
   * ligados e conectados sem conversa aberta (o rotulo). Nulo: a leitura
   * falhou (a linha diz "num dos números ligados").
   */
  numeros: NumeroDoWhatsapp[] | null;
  /**
   * "Conversa com o assistente" so no estado verde (achado T4) e com um
   * numero ligado e conectado sem conversa aberta para o telefone.
   */
  estadoDoAssistente: EstadoDaIa;
  /** O assistente atende os contatos (producao): o aviso do cartao muda. */
  emProducao?: boolean;
  /**
   * Os ids dos telefones forcados (o dialogo de excluir avisa). Nulo: a
   * leitura falhou e o dialogo fica com o texto de sempre.
   */
  forcados: ReadonlySet<string> | null;
  /** escolha: desligar; telefone: adicionar e ligar; excluir; forcar. */
  dicas: Record<AcaoDaIa, string | null>;
  pendente: boolean;
  ocupado: (qual: string) => boolean;
  aoAlternar: (telefone: TelefoneDaIa, ligado: boolean) => void;
  aoExcluir: (telefone: TelefoneDaIa, retorno: { fechar: () => void }) => void;
  aoAdicionar: (valores: TelefoneValidado, depois: DepoisDeAdicionar) => void;
  /** Painel geral: a clinica nao e a ativa de quem ve. */
  noPainel?: boolean;
}) {
  const tituloId = useId();
  const ids = useId();
  const telefones = dados.telefones;
  // Sem confirmarAvisoDaOpenai: a caixa nasce desmarcada (o schema so aceita
  // true, e o formulario mostra a mensagem quando falta).
  const vazio = {
    rotulo: "",
    telefone: "",
    confirmarContato: false,
    forcarContatoDePaciente: false,
    confirmouTesteComPaciente: false,
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
  // O "Usar mesmo assim" (item 3): o que foi mandado e o telefone digitado,
  // enquanto o dialogo da confirmacao do teste esta aberto.
  const [forcando, setForcando] = useState<{
    valores: TelefoneValidado;
    digitado: string;
  } | null>(null);
  const [confirmouTeste, setConfirmouTeste] = useState(false);
  // O telefone a excluir (o dialogo de confirmacao).
  const [excluindo, setExcluindo] = useState<TelefoneDaIa | null>(null);
  const telefoneDigitado = form.watch("telefone");
  // No painel a confirmacao e sempre pedida (ver o comentario do cartao).
  const pedindoConfirmacao =
    noPainel ||
    (confirmacaoPara !== null && confirmacaoPara === telefoneDigitado);

  const limpar = () => {
    form.reset(vazio);
    setConfirmacaoPara(null);
    setForcando(null);
    setConfirmouTeste(false);
  };

  const fecharForcar = () => {
    setForcando(null);
    setConfirmouTeste(false);
  };

  const confirmarForcar = () => {
    if (!forcando || !confirmouTeste) {
      return;
    }
    aoAdicionar(
      {
        ...forcando.valores,
        forcarContatoDePaciente: true,
        confirmouTesteComPaciente: true,
      },
      { sempre: fecharForcar, seDerCerto: limpar },
    );
  };

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

  const excluindoForcado =
    excluindo !== null && forcados !== null && forcados.has(excluindo.id);

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
          {emProducao
            ? TEXTOS_DA_IA.telefonesEmProducao
            : TEXTOS_DA_IA.soEstesTelefones}
        </Aviso>

        <Form {...form}>
          <form
            noValidate
            aria-label="Adicionar telefone da equipe"
            className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]"
            onSubmit={(evento) =>
              void form.handleSubmit((valores) => {
                const digitado = form.getValues("telefone");
                if (noPainel && valores.confirmarContato !== true) {
                  form.setError("confirmarContato", {
                    message: TEXTOS_DO_PAINEL.confirmeQueEDaEquipe,
                  });
                  return;
                }
                const enviados: TelefoneValidado = {
                  ...valores,
                  // Marcado escondido (de outro telefone) nao vale.
                  confirmarContato:
                    pedindoConfirmacao && valores.confirmarContato === true,
                  // O forcar so sai pelo dialogo (confirmarForcar).
                  forcarContatoDePaciente: false,
                  confirmouTesteComPaciente: false,
                };
                aoAdicionar(enviados, {
                  seDerCerto: limpar,
                  sePedirConfirmacao: () => {
                    form.setValue("confirmarContato", false);
                    setConfirmacaoPara(digitado);
                  },
                  sePedirForcar: () => {
                    setConfirmouTeste(false);
                    setForcando({ valores: enviados, digitado });
                  },
                });
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
            {pedindoConfirmacao ? (
              <FormField
                control={form.control}
                name="confirmarContato"
                render={({ field }) => (
                  <FormItem className="grid gap-1 sm:col-span-3">
                    <div className="flex min-h-10 items-center gap-3">
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
                    </div>
                    <FormMessage />
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
              const qualExcluir = `excluir-${telefone.id}`;
              const estado = estadoDoTelefone(dados, telefone.id);
              const invalido = estado === "invalido";
              const naoAciona = porQueNaoAciona(dados, telefone.id);
              const textoDeQueNaoAciona =
                naoAciona === null
                  ? null
                  : textoDoTelefoneQueNaoAciona(naoAciona);
              // A conversa aberta com a equipe em cada numero ligado: a linha
              // diz qual numero e leva a conversa (o assistente so comeca
              // nesse numero depois que alguem assumir e resolver).
              const conversasAbertas =
                telefone.ativo && !invalido
                  ? conversasAbertasDoTelefone(dados, numeros, telefone.id)
                  : [];
              // Desligar: so a permissao (nunca recusado). Ligar de novo: a
              // permissao (administrador ou super admin, desde 19/10/2026),
              // e nunca o telefone que nao aciona o assistente (o invalido o
              // banco recusa; o do contato sem autorizacao ou fora do
              // publico ligaria sem nunca conversar).
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
              const nomeDoTelefone = telefone.rotulo ?? "Sem nome";
              const botaoExcluir = (
                <Button
                  variant="ghost"
                  disabled={dicas.excluir !== null || pendente}
                  aria-busy={ocupado(qualExcluir) || undefined}
                  aria-label={`${TEXTOS_DA_IA.excluir} o telefone de ${nomeDoTelefone}`}
                  onClick={() => setExcluindo(telefone)}
                >
                  <Trash2 aria-hidden />
                  {ocupado(qualExcluir) ? "Excluindo..." : TEXTOS_DA_IA.excluir}
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
                        {nomeDoTelefone}
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
                              ? rotuloDoTelefoneLigado(
                                  estadoDoAssistente,
                                  numerosLivresDoTelefone(
                                    dados,
                                    numeros,
                                    telefone.id,
                                  ).length,
                                )
                              : undefined
                          }
                        />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {comDica(botao, dicaDaLinha)}
                      {comDica(botaoExcluir, dicas.excluir)}
                    </div>
                  </div>
                  {textoDeQueNaoAciona !== null ? (
                    <Aviso tom="warning" role="note">
                      {textoDeQueNaoAciona}
                    </Aviso>
                  ) : null}
                  {conversasAbertas.map((conversa) =>
                    noPainel ? (
                      <Aviso
                        key={conversa.conversaId}
                        tom="info"
                        role="note"
                        titulo={textoDaConversaAberta(conversa.numero)}
                      >
                        {TEXTOS_DO_PAINEL.conversaAbertaNoPainel}
                      </Aviso>
                    ) : (
                      <Aviso
                        key={conversa.conversaId}
                        tom="info"
                        role="note"
                        titulo={textoDaConversaAberta(conversa.numero)}
                        acao={
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={linkDaConversa(conversa.conversaId)}
                              prefetch={false}
                              aria-label={rotuloDoLinkDaConversa(
                                conversa.numero,
                              )}
                            >
                              <MessageSquareText aria-hidden />
                              {TEXTOS_DA_IA.abrirConversa}
                            </Link>
                          </Button>
                        }
                      >
                        {TEXTOS_DA_IA.conversaAbertaAcao}
                      </Aviso>
                    ),
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* Excluir (item 9): acao que tira o telefone da lista, sempre com
          confirmacao. */}
      <Dialog
        open={excluindo !== null}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setExcluindo(null) : null
        }
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{TEXTOS_DA_IA.excluirTitulo}</DialogTitle>
            <DialogDescription>{TEXTOS_DA_IA.excluirTexto}</DialogDescription>
          </DialogHeader>
          {excluindo ? (
            <p className="text-[13px] text-foreground">
              <span className="font-semibold">
                {excluindo.rotulo ?? "Sem nome"}
              </span>{" "}
              <span className="cz-num text-text-secondary">
                {telefoneParaExibir(excluindo.telefone)}
              </span>
            </p>
          ) : null}
          {excluindoForcado ? (
            <Aviso tom="warning" role="note">
              {TEXTOS_DA_IA.excluirForcado}
            </Aviso>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setExcluindo(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pendente || excluindo === null}
              aria-busy={
                (excluindo !== null && ocupado(`excluir-${excluindo.id}`)) ||
                undefined
              }
              onClick={() => {
                if (excluindo) {
                  aoExcluir(excluindo, { fechar: () => setExcluindo(null) });
                }
              }}
            >
              <Trash2 aria-hidden />
              {excluindo !== null && ocupado(`excluir-${excluindo.id}`)
                ? "Excluindo..."
                : "Excluir telefone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* O "Usar mesmo assim" do telefone de paciente (item 3, P3): so com
          a confirmacao do teste marcada; fica registrado no nome de quem
          forca. */}
      <Dialog
        open={forcando !== null && forcando.digitado === telefoneDigitado}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? fecharForcar() : null
        }
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{TEXTOS_DO_TESTE_COM_PACIENTE.titulo}</DialogTitle>
            <DialogDescription>
              {TEXTOS_DO_TESTE_COM_PACIENTE.texto}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-10 items-start gap-3">
            <Checkbox
              id={`${ids}-teste`}
              checked={confirmouTeste}
              onCheckedChange={(valor) => setConfirmouTeste(valor === true)}
              disabled={pendente || dicas.forcar !== null}
              className="mt-0.5"
            />
            <Label
              htmlFor={`${ids}-teste`}
              className="text-[13px] leading-snug font-normal"
            >
              {TEXTOS_DO_TESTE_COM_PACIENTE.confirmacao}
            </Label>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={pendente} onClick={fecharForcar}>
              Cancelar
            </Button>
            {comDica(
              <Button
                disabled={pendente || !confirmouTeste || dicas.forcar !== null}
                aria-busy={ocupado("telefone-novo") || undefined}
                onClick={confirmarForcar}
              >
                {ocupado("telefone-novo")
                  ? TEXTOS_DO_TESTE_COM_PACIENTE.usando
                  : TEXTOS_DO_TESTE_COM_PACIENTE.botao}
              </Button>,
              dicas.forcar ??
                (confirmouTeste
                  ? null
                  : TEXTOS_DO_TESTE_COM_PACIENTE.naoConfirmado),
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
