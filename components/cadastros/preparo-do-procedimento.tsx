"use client";

import { CircleAlert, History, PenLine } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  descartarPreparoAction,
  salvarPreparoAction,
  suspenderPreparoAction,
  type ResultadoDoPreparo,
  type ResultadoDoSalvarPreparo,
} from "@/app/(app)/cadastros/preparo-actions";
import {
  AprovarPreparoDialog,
  type PedidoDeAprovacao,
} from "@/components/cadastros/aprovar-preparo-dialog";
import {
  aprovadaPor,
  contadorDoTexto,
  dataEHoraNoFuso,
  dataNoFuso,
  devolvidoPeloRt,
  erroDeSempre,
  escritoPor,
  faixaDoRt,
  FRASE_DA_EQUIPE_CONDUZZA,
  FRASES_SEM_PERMISSAO,
  PESSOA_SEM_NOME,
  prepararTextoDoPreparo,
  problemaNoTextoDoPreparo,
  registroDoRt,
  ROTULO_DA_SITUACAO,
  suspensoDesde,
  TEXTOS_DO_PREPARO as T,
  textoAntigo,
} from "@/components/cadastros/preparo-na-tela";
import { BotaoProtegido } from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
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
import { Textarea } from "@/components/ui/textarea";
import { PREPARO_DO_PROCEDIMENTO_STATUS } from "@/lib/design/status";
import {
  codigoDoTexto,
  LIMITE_DO_TEXTO_DO_PREPARO,
  type SituacaoDoPreparoNaTela,
} from "@/lib/domain/preparo";
import {
  situacaoDoProcedimento,
  temRtVigente,
  versaoLidaDoProcedimento,
  versoesDoProcedimento,
  type PreparosDaClinica,
  type ResponsavelTecnico,
  type VersaoDoPreparo,
} from "@/lib/queries/preparo";
import { cn } from "@/lib/utils";

// A secao "Orientacao de preparo" do modal do Procedimento (AG7; desenho
// 5.1, contrato 3.3), no lugar do campo de texto livre (prep_instructions).
// O texto so sai para o paciente depois que o responsavel tecnico (RT) da
// clinica aprova; cada texto e uma versao imutavel. Cada acao daqui grava na
// hora, pela propria Server Action (app/(app)/cadastros/preparo-actions.ts),
// fora do Salvar do procedimento.
//
// A secao e a MESMA no modo de edicao e no de leitura: o RT de papel
// profissional ou leitura so abre o modal em modo leitura e e ali que ele
// revisa, aprova, devolve e escreve (contrato, secao 0, item 16). Quem pode
// cada acao (desenho 5.6; D-71):
//  - escrever, descartar e suspender: administrador, gestor, a equipe
//    Conduzza (super admin) e o RT vigente;
//  - aprovar, aprovar de novo e devolver: SO o RT vigente, e nunca a equipe
//    Conduzza, nem quando ela e o RT designado (TELA-9).
// Sem permissao, a acao fica visivel e desabilitada, com a frase 42501 do
// banco como dica (nunca escondida). A action e a RPC conferem de novo.
//
// O que a pessoa le e o que vai para o banco (revisao das telas):
//  - o editor guarda a maior versao lida quando abriu (TELA-3): se outra
//    pessoa salvou no meio, o banco recusa, o texto digitado fica e o texto
//    novo aparece acima antes do proximo envio;
//  - o texto digitado e nao enviado nunca se perde em silencio (TELA-4): o
//    Cancelar do editor pede confirmacao, e o modal do procedimento sabe
//    (aoMudarRascunho) para o Salvar e o fechar pedirem tambem;
//  - descartar o texto que espera o RT pede confirmacao (TELA-5);
//  - o texto aguardando escrito com o nome antigo do procedimento diz isso
//    antes de o RT ler, e "Enviar de novo com o nome novo" o salva de novo
//    (TELA-6).

export type EstadoDosPreparos =
  | { tipo: "carregando" }
  | { tipo: "erro" }
  | { tipo: "pronto"; dados: PreparosDaClinica };

/** O que a aba Procedimentos recebe de Cadastros para o preparo. */
export type PreparoDaAba = {
  estado: EstadoDosPreparos;
  /** A equipe Conduzza: escreve, descarta e suspende, nunca aprova (D-71). */
  superAdmin: boolean;
  /**
   * Quem define o RT (administrador pleno e a equipe Conduzza): o aviso sem
   * RT ganha o link para Configuracoes, Equipe; os outros leem quem define.
   */
  podeDefinirRt: boolean;
  /** Le de novo as versoes e o RT (depois de cada acao). */
  recarregar: () => void;
};

const HREF_DA_EQUIPE = "/configuracoes?aba=equipe";

// ---------------------------------------------------------------------------
// O topo da aba Procedimentos
// ---------------------------------------------------------------------------

/** Sem RT vigente: nenhuma orientacao sai (topo da aba e da secao). */
export function AvisoSemRt({ podeDefinirRt }: { podeDefinirRt: boolean }) {
  return (
    <Aviso
      tom="warning"
      role="note"
      acao={
        podeDefinirRt ? (
          <Button asChild variant="outline" className="h-10">
            <Link href={HREF_DA_EQUIPE}>{T.semRtLink}</Link>
          </Button>
        ) : undefined
      }
    >
      <p>{T.semRt}</p>
      {podeDefinirRt ? null : <p className="mt-1">{T.semRtSemLink}</p>}
    </Aviso>
  );
}

/** Para o RT: quantas orientacoes esperam a aprovacao dele, com o filtro. */
export function FaixaDoRt({
  quantos,
  filtrando,
  aoAlternar,
}: {
  quantos: number;
  filtrando: boolean;
  aoAlternar: () => void;
}) {
  return (
    <Aviso
      tom="info"
      role="status"
      acao={
        <Button
          variant="outline"
          className="h-10"
          onClick={aoAlternar}
          aria-pressed={filtrando}
        >
          {filtrando ? T.mostrarTodos : T.filtrarAguardando}
        </Button>
      }
    >
      {faixaDoRt(quantos)}
    </Aviso>
  );
}

/**
 * O aviso sob o campo Nome quando ele muda (TELA-6): o texto em vigor perde
 * a aprovacao, e o texto que espera o RT precisa ser enviado de novo (a
 * aprovacao prende o nome). null: renomear nao mexe em nenhuma orientacao.
 */
export function avisoDoNomeDoPreparo(e: {
  emVigor: boolean;
  aguardando: boolean;
}): string | null {
  if (e.emVigor && e.aguardando) {
    return `${T.avisoDoNome} ${T.avisoDoNomeAguardando}`;
  }
  if (e.emVigor) {
    return T.avisoDoNome;
  }
  return e.aguardando ? T.avisoDoNomeAguardando : null;
}

/** Sob o campo Nome: renomear tira a aprovacao (aria-describedby). */
export function AvisoDoNomeDoProcedimento({
  id,
  texto = T.avisoDoNome,
}: {
  id: string;
  texto?: string;
}) {
  return (
    <p
      id={id}
      aria-live="polite"
      className="flex items-start gap-1.5 text-xs text-warning-text"
    >
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{texto}</span>
    </p>
  );
}

/**
 * A confirmacao antes de descartar o texto digitado e nao enviado para o RT
 * (TELA-4): o Cancelar do editor e, no modal do procedimento, o Salvar e o
 * fechar. "Continuar editando" e o lado seguro (fechar a confirmacao tambem).
 */
export function ConfirmarDescarteDoRascunho({
  aberto,
  corpo,
  rotuloDescartar,
  aoContinuar,
  aoDescartar,
}: {
  aberto: boolean;
  corpo: string;
  rotuloDescartar: string;
  aoContinuar: () => void;
  aoDescartar: () => void;
}) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          aoContinuar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{T.rascunhoTitulo}</DialogTitle>
          <DialogDescription>{corpo}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" className="h-10" onClick={aoContinuar}>
            {T.continuarEditando}
          </Button>
          <Button variant="destructive" className="h-10" onClick={aoDescartar}>
            {rotuloDescartar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// As pecas da secao
// ---------------------------------------------------------------------------

/** O chip do procedimento nas 3 camadas (icone, rotulo e cor). */
export function ChipDoPreparo({
  situacao,
}: {
  situacao: SituacaoDoPreparoNaTela;
}) {
  return (
    <StatusChip
      size="sm"
      definition={PREPARO_DO_PROCEDIMENTO_STATUS[situacao]}
    />
  );
}

/**
 * O texto como o paciente le, com as quebras preservadas. Sem o texto lido
 * (null), o erro com "Tentar de novo": nunca um bloco vazio que pareca um
 * texto em branco.
 */
function TextoDoPreparo({
  texto,
  aoTentarDeNovo,
}: {
  texto: string | null;
  aoTentarDeNovo: () => void;
}) {
  if (texto === null) {
    return (
      <Aviso
        tom="alert"
        role="alert"
        acao={
          <Button variant="outline" className="h-10" onClick={aoTentarDeNovo}>
            {T.tentarDeNovo}
          </Button>
        }
      >
        {T.textoIndisponivel}
      </Aviso>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-foreground">
      {texto}
    </div>
  );
}

function rtDaVersao(
  dados: PreparosDaClinica,
  versao: VersaoDoPreparo,
): ResponsavelTecnico | null {
  return dados.responsaveis.find((r) => r.id === versao.rtId) ?? null;
}

function nomeDe(dados: PreparosDaClinica, userId: string | null): string {
  return (userId && dados.nomes[userId]) || PESSOA_SEM_NOME;
}

/** "Aprovada por ... em ... Codigo do texto: ...", ou null sem aprovacao. */
export function linhaDaAprovacao(
  dados: PreparosDaClinica,
  versao: VersaoDoPreparo,
  timezone: string,
): string | null {
  if (versao.aprovadoEm === null) {
    return null;
  }
  const rt = rtDaVersao(dados, versao);
  return aprovadaPor(
    rt ? registroDoRt(rt) : nomeDe(dados, versao.aprovadoPor),
    dataEHoraNoFuso(versao.aprovadoEm, timezone),
    codigoDoTexto(versao.textoSha256),
  );
}

/** Quem escreveu e quando (o texto antigo copiado pela migration, sem autor). */
export function linhaDaAutoria(
  dados: PreparosDaClinica,
  versao: VersaoDoPreparo,
  timezone: string,
): string {
  const quando = dataNoFuso(versao.escritoEm, timezone);
  return versao.origem === "texto_antigo"
    ? textoAntigo(quando)
    : escritoPor(nomeDe(dados, versao.escritoPor), quando);
}

/**
 * Por que a aprovacao parou de valer (o chip "Precisa de nova aprovacao"):
 * o RT de agora nao e o que aprovou, o RT esta sem acesso, ou o nome do
 * procedimento mudou. Sem RT nenhum, o aviso do topo ja diz.
 */
export function motivoDaNovaAprovacao(
  dados: PreparosDaClinica,
  aprovada: VersaoDoPreparo,
  nomeGravado: string,
): string | null {
  if (dados.rtAberto === null) {
    return null;
  }
  if (aprovada.rtId !== dados.rtAberto.id) {
    return T.rtMudou;
  }
  if (!dados.rtComAcesso) {
    return T.rtSemAcesso;
  }
  if (aprovada.nomeDoProcedimento !== nomeGravado) {
    return T.nomeMudou;
  }
  return null;
}

/** A versao mais nova de uma lista (ou null). */
function maisNova(versoes: readonly VersaoDoPreparo[]): VersaoDoPreparo | null {
  return versoes.reduce<VersaoDoPreparo | null>(
    (escolhida, v) =>
      escolhida === null || v.versao > escolhida.versao ? v : escolhida,
    null,
  );
}

/** O que a secao mostra de um procedimento, calculado uma vez. */
export function resumoDoPreparo(
  dados: PreparosDaClinica,
  procedimento: { id: string; nome: string },
) {
  const versoes = versoesDoProcedimento(dados, procedimento.id);
  const aprovada = maisNova(versoes.filter((v) => v.situacao === "aprovado"));
  const aguardando = maisNova(
    versoes.filter((v) => v.situacao === "aguardando_rt"),
  );
  const ultimaJaAprovada = maisNova(
    versoes.filter(
      (v) =>
        v.situacao === "aprovado" ||
        v.situacao === "substituido" ||
        v.situacao === "suspenso",
    ),
  );
  const ultima = maisNova(versoes);
  return {
    versoes,
    aprovada,
    aguardando,
    suspensa:
      aprovada === null && ultimaJaAprovada?.situacao === "suspenso"
        ? ultimaJaAprovada
        : null,
    devolvida: ultima?.situacao === "devolvido" ? ultima : null,
    situacao: situacaoDoProcedimento(dados, {
      id: procedimento.id,
      name: procedimento.nome,
    }),
    versaoLida: versaoLidaDoProcedimento(dados, procedimento.id),
  };
}

/** A lista "Ver versoes" (so leitura), da mais nova para a mais antiga. */
export function ListaDeVersoes({
  dados,
  versoes,
  timezone,
}: {
  dados: PreparosDaClinica;
  versoes: readonly VersaoDoPreparo[];
  timezone: string;
}) {
  const ordenadas = [...versoes].sort((a, b) => b.versao - a.versao);
  return (
    <ol className="grid gap-2" aria-label={T.versoesTitulo}>
      {ordenadas.map((v) => {
        const aprovacao = linhaDaAprovacao(dados, v, timezone);
        return (
          <li
            key={v.id}
            className="grid gap-0.5 rounded-xl border border-border bg-card px-3 py-2 text-[13px]"
          >
            <span className="font-semibold text-text-strong">
              Versão <span className="cz-num">{v.versao}</span>:{" "}
              {ROTULO_DA_SITUACAO[v.situacao]}
            </span>
            <span className="text-text-secondary">
              {linhaDaAutoria(dados, v, timezone)}
            </span>
            {aprovacao ? (
              <span className="text-text-secondary">{aprovacao}</span>
            ) : (
              <span className="text-text-secondary">
                Código do texto:{" "}
                <span className="cz-num">{codigoDoTexto(v.textoSha256)}</span>.
              </span>
            )}
            {v.comentario ? (
              <span className="break-words whitespace-pre-wrap text-foreground">
                Comentário: {v.comentario}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** O editor do texto novo ("Escrever orientacao" ou "Escrever texto novo"). */
export function EditorDoPreparo({
  id,
  texto,
  aoMudar,
  enviando,
  erro,
  aviso = null,
  aoEnviar,
  aoCancelar,
}: {
  id: string;
  texto: string;
  aoMudar: (texto: string) => void;
  enviando: boolean;
  erro: string | null;
  /** Outra pessoa salvou no meio: o texto novo esta acima (TELA-3). */
  aviso?: string | null;
  aoEnviar: () => void;
  aoCancelar: () => void;
}) {
  const tamanho = Array.from(prepararTextoDoPreparo(texto)).length;
  const passou = tamanho > LIMITE_DO_TEXTO_DO_PREPARO;
  return (
    <div className="grid gap-1.5" data-parte="editor-do-preparo">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-texto`}>{T.campo}</Label>
        <span
          id={`${id}-contador`}
          aria-live="polite"
          className={cn(
            "cz-num text-xs",
            passou ? "font-semibold text-alert-text" : "text-text-secondary",
          )}
        >
          {contadorDoTexto(texto)}
        </span>
      </div>
      <Textarea
        id={`${id}-texto`}
        value={texto}
        onChange={(e) => aoMudar(e.target.value)}
        rows={8}
        disabled={enviando}
        aria-describedby={`${id}-contador`}
        aria-invalid={erro !== null || passou}
      />
      {aviso ? (
        <Aviso tom="warning" role="status">
          {aviso}
        </Aviso>
      ) : null}
      {erro ? (
        <Aviso tom="alert" role="alert">
          {erro}
        </Aviso>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          className="h-10"
          onClick={aoCancelar}
          disabled={enviando}
        >
          {T.cancelar}
        </Button>
        <Button className="h-10" onClick={aoEnviar} disabled={enviando}>
          {enviando ? T.enviando : T.enviarParaORt}
        </Button>
      </div>
    </div>
  );
}

/** As recusas que pedem para a secao ler de novo o que mostra. */
const RECUSAS_QUE_RECARREGAM: ReadonlySet<string> = new Set([
  "texto_mudou",
  "texto_igual_ao_em_vigor",
  "nao_aguarda_aprovacao",
  "nome_mudou",
  "outra_aprovacao",
  "sem_preparo_aprovado",
  "sem_permissao",
  "versao_inexistente",
]);

function recarregaDepois(
  resultado: ResultadoDoPreparo | ResultadoDoSalvarPreparo,
): boolean {
  return !resultado.ok && RECUSAS_QUE_RECARREGAM.has(resultado.code ?? "");
}

/** O editor aberto: o texto, o ponto de partida e a versao lida ao abrir. */
type EditorAberto = {
  texto: string;
  /** O texto com que o editor abriu: o rascunho e o que mudou dele. */
  inicial: string;
  /**
   * A maior versao do procedimento quando o editor abriu (o p_versao_lida;
   * TELA-3). Depois do aviso de que outra pessoa salvou, a do envio que deu
   * texto_mudou.
   */
  versaoLida: number;
  /** Outra pessoa salvou no meio: o proximo envio usa a versao que a tela mostra. */
  conflito: boolean;
};

/**
 * A versao lida que vai no envio do editor (TELA-3): a da abertura do
 * editor, nunca a relida em segundo plano; depois do aviso de que outra
 * pessoa salvou, a que a tela mostra agora (o texto novo esta acima).
 */
export function versaoLidaDoEnvio(
  editor: Pick<EditorAberto, "versaoLida" | "conflito">,
  versaoLidaNaTela: number,
): number {
  return editor.conflito ? versaoLidaNaTela : editor.versaoLida;
}

/**
 * O pedido do dialogo do RT com o que ele le AGORA (TELA-1, TELA-2 e
 * TELA-11): o texto, a maior versao lida, o RT e o nome da previa, e o
 * ultimo texto aprovado para a diferenca. null sem o texto lido (o da versao
 * ou o da diferenca) ou sem RT aberto: o dialogo nao abre.
 */
export function montarPedidoDeAprovacao(e: {
  modo: PedidoDeAprovacao["modo"];
  versao: VersaoDoPreparo;
  resumo: Pick<
    ReturnType<typeof resumoDoPreparo>,
    "aprovada" | "suspensa" | "situacao" | "versaoLida"
  >;
  rtAberto: ResponsavelTecnico | null;
  procedimento: { nome: string };
}): PedidoDeAprovacao | null {
  const { modo, versao, resumo } = e;
  const ultimoAprovado = resumo.aprovada ?? resumo.suspensa;
  const textoDoUltimo = ultimoAprovado?.texto ?? null;
  if (
    versao.texto === null ||
    e.rtAberto === null ||
    (modo === "aprovar" && ultimoAprovado !== null && textoDoUltimo === null)
  ) {
    return null;
  }
  return {
    modo,
    versao,
    texto: versao.texto,
    versaoLida: resumo.versaoLida,
    rt: e.rtAberto,
    procedimento: e.procedimento.nome,
    comparacao:
      modo === "aprovar" && ultimoAprovado !== null && textoDoUltimo !== null
        ? {
            texto: textoDoUltimo,
            emVigor:
              resumo.situacao === "aprovada" &&
              ultimoAprovado === resumo.aprovada,
          }
        : null,
  };
}

/**
 * A confirmacao do descarte do texto que espera o RT (TELA-5): grava na
 * hora e o texto sai da tela. Para o RT, lembra que o Devolver pede a
 * mudanca sem descartar.
 */
export function ConfirmarDescarteDoTextoNovo({
  versao,
  doRt,
  descartando,
  aoVoltar,
  aoDescartar,
}: {
  /** null: fechada. */
  versao: Pick<VersaoDoPreparo, "origem"> | null;
  doRt: boolean;
  descartando: boolean;
  aoVoltar: () => void;
  aoDescartar: () => void;
}) {
  return (
    <Dialog
      open={versao !== null}
      onOpenChange={(aberto) => {
        if (!aberto && !descartando) {
          aoVoltar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {versao?.origem === "texto_antigo"
              ? T.descartarTituloTextoAntigo
              : T.descartarTitulo}
          </DialogTitle>
          <DialogDescription>
            {doRt ? T.descartarCorpoDoRt : T.descartarCorpo}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            className="h-10"
            onClick={aoVoltar}
            disabled={descartando}
          >
            {T.voltar}
          </Button>
          <Button
            variant="destructive"
            className="h-10"
            onClick={aoDescartar}
            disabled={descartando}
          >
            {descartando ? T.descartando : T.descartarConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ha texto digitado e nao enviado (o rascunho que nao pode sumir calado)? */
export function editorComRascunho(
  editor: Pick<EditorAberto, "texto" | "inicial"> | null,
): boolean {
  return (
    editor !== null &&
    prepararTextoDoPreparo(editor.texto) !==
      prepararTextoDoPreparo(editor.inicial)
  );
}

/** Avisa quem chamou do rascunho agora e, ao desmontar, que nada ficou. */
function useAvisarRascunho(
  temRascunho: boolean,
  avisar: ((temRascunho: boolean) => void) | undefined,
): void {
  useEffect(() => {
    avisar?.(temRascunho);
  }, [temRascunho, avisar]);
  useEffect(() => () => avisar?.(false), [avisar]);
}

// ---------------------------------------------------------------------------
// A secao
// ---------------------------------------------------------------------------

export function SecaoDoPreparo({
  procedimento,
  preparo,
  podeEditarCadastros,
  timezone,
  aoMudarRascunho,
}: {
  /** O procedimento GRAVADO (o nome do banco); null no procedimento novo. */
  procedimento: { id: string; nome: string } | null;
  preparo: PreparoDaAba;
  /** Administrador ou gestor (canEdit de Cadastros). */
  podeEditarCadastros: boolean;
  timezone: string;
  /**
   * Avisa o modal do procedimento quando ha texto digitado e nao enviado
   * para o RT (TELA-4): o Salvar e o fechar do modal pedem confirmacao
   * antes de descartar. Precisa ser estavel (um setState serve).
   */
  aoMudarRascunho?: (temRascunho: boolean) => void;
}) {
  const id = useId();
  const idDoTitulo = `${id}-titulo`;
  const [editor, setEditor] = useState<EditorAberto | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroDoEditor, setErroDoEditor] = useState<string | null>(null);
  const [cancelandoEditor, setCancelandoEditor] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<PedidoDeAprovacao | null>(null);
  const [confirmandoSuspensao, setConfirmandoSuspensao] = useState(false);
  const [suspendendo, setSuspendendo] = useState(false);
  const [descarte, setDescarte] = useState<VersaoDoPreparo | null>(null);
  const [descartando, setDescartando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [verVersoes, setVerVersoes] = useState(false);

  const temRascunho = editorComRascunho(editor);
  useAvisarRascunho(temRascunho, aoMudarRascunho);

  const cabecalho = (
    <div className="grid gap-1">
      <h3 id={idDoTitulo} className="text-sm font-bold text-text-strong">
        {T.titulo}
      </h3>
      <p className="text-xs text-text-secondary">{T.ajuda}</p>
    </div>
  );
  const moldura = (conteudo: React.ReactNode, chip?: React.ReactNode) => (
    <section
      aria-labelledby={idDoTitulo}
      className="grid gap-3 border-t border-border pt-4"
      data-parte="secao-do-preparo"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        {cabecalho}
        {chip}
      </div>
      {conteudo}
    </section>
  );

  if (procedimento === null) {
    return moldura(
      <p className="text-[13px] text-text-secondary">{T.procedimentoNovo}</p>,
    );
  }
  if (preparo.estado.tipo === "carregando") {
    return moldura(
      <p role="status" className="text-[13px] text-text-secondary">
        {T.carregando}
      </p>,
    );
  }
  if (preparo.estado.tipo === "erro") {
    return moldura(
      <Aviso
        tom="alert"
        role="alert"
        acao={
          <Button
            variant="outline"
            className="h-10"
            onClick={preparo.recarregar}
          >
            {T.tentarDeNovo}
          </Button>
        }
      >
        {T.erroAoCarregar}
      </Aviso>,
    );
  }

  const dados = preparo.estado.dados;
  const resumo = resumoDoPreparo(dados, procedimento);
  const { versoes, aprovada, aguardando, suspensa, devolvida, situacao } =
    resumo;
  const rtVigente = temRtVigente(dados);
  const podeEscrever = podeEditarCadastros || preparo.superAdmin || dados.souRt;
  // A equipe Conduzza nunca aprova, nem quando e o RT designado (TELA-9).
  const podeAprovar = dados.souRt && !preparo.superAdmin;
  const dicaDeAprovar = preparo.superAdmin
    ? FRASE_DA_EQUIPE_CONDUZZA
    : FRASES_SEM_PERMISSAO.aprovar;
  const ocupado = enviando || suspendendo || descartando || reenviando;
  // O ultimo texto aprovado (em vigor, parado ou suspenso): a diferenca do
  // dialogo do RT compara com ele, e sem o texto dele lido o dialogo nao abre.
  const ultimoAprovado = aprovada ?? suspensa;

  // O editor parte do texto mais util: o que espera o RT, o que ele devolveu
  // (para corrigir o que o comentario pede), o aprovado ou o suspenso. Ele
  // guarda a versao lida AGORA (TELA-3): a releitura dos dados nao a muda.
  const abrirEditor = () => {
    const base = aguardando ?? devolvida ?? aprovada ?? suspensa;
    const inicial = base?.texto ?? "";
    setEditor({
      texto: inicial,
      inicial,
      versaoLida: resumo.versaoLida,
      conflito: false,
    });
    setErroDoEditor(null);
    setErro(null);
  };

  const fecharEditor = () => {
    setEditor(null);
    setErroDoEditor(null);
    setCancelandoEditor(false);
  };

  const cancelarEditor = () => {
    if (temRascunho) {
      setCancelandoEditor(true);
      return;
    }
    fecharEditor();
  };

  const enviarTexto = async () => {
    if (editor === null) {
      return;
    }
    const problema = problemaNoTextoDoPreparo(editor.texto);
    if (problema) {
      setErroDoEditor(problema);
      return;
    }
    const versaoLida = versaoLidaDoEnvio(editor, resumo.versaoLida);
    setEnviando(true);
    setErroDoEditor(null);
    let resultado: ResultadoDoSalvarPreparo;
    try {
      resultado = await salvarPreparoAction({
        procedureId: procedimento.id,
        texto: editor.texto,
        versaoLida,
      });
    } catch {
      resultado = { ok: false, error: erroDeSempre("salvar") };
    }
    setEnviando(false);
    if (resultado.ok) {
      toast.success(T.enviado);
      fecharEditor();
      preparo.recarregar();
      return;
    }
    if (resultado.code === "texto_mudou") {
      // Outra pessoa salvou no meio: o texto digitado fica, a secao rele, e
      // o texto novo aparece acima antes do proximo envio.
      setEditor((atual) =>
        atual === null ? null : { ...atual, versaoLida, conflito: true },
      );
      preparo.recarregar();
      return;
    }
    setErroDoEditor(resultado.error);
    if (recarregaDepois(resultado)) {
      preparo.recarregar();
    }
  };

  // TELA-6: o mesmo texto que espera o RT, salvo de novo com o nome de agora
  // (a versao nova toma o lugar dela e o RT pode aprovar).
  const reenviar = async (versao: VersaoDoPreparo) => {
    if (versao.texto === null) {
      return;
    }
    setReenviando(true);
    setErro(null);
    let resultado: ResultadoDoSalvarPreparo;
    try {
      resultado = await salvarPreparoAction({
        procedureId: procedimento.id,
        texto: versao.texto,
        versaoLida: resumo.versaoLida,
      });
    } catch {
      resultado = { ok: false, error: erroDeSempre("salvar") };
    }
    setReenviando(false);
    if (resultado.ok) {
      toast.success(T.enviado);
      preparo.recarregar();
      return;
    }
    setErro(resultado.error);
    if (recarregaDepois(resultado)) {
      preparo.recarregar();
    }
  };

  const descartar = async (versao: VersaoDoPreparo) => {
    setDescartando(true);
    setErro(null);
    let resultado: ResultadoDoPreparo;
    try {
      resultado = await descartarPreparoAction({ versaoId: versao.id });
    } catch {
      resultado = { ok: false, error: erroDeSempre("descartar") };
    }
    setDescartando(false);
    setDescarte(null);
    if (resultado.ok) {
      toast.success(T.descartado);
      preparo.recarregar();
      return;
    }
    setErro(resultado.error);
    if (recarregaDepois(resultado)) {
      preparo.recarregar();
    }
  };

  const suspender = async () => {
    setSuspendendo(true);
    setErro(null);
    let resultado: ResultadoDoPreparo;
    try {
      resultado = await suspenderPreparoAction({
        procedureId: procedimento.id,
      });
    } catch {
      resultado = { ok: false, error: erroDeSempre("suspender") };
    }
    setSuspendendo(false);
    setConfirmandoSuspensao(false);
    if (resultado.ok) {
      toast.success(T.suspenso);
      preparo.recarregar();
      return;
    }
    setErro(resultado.error);
    if (recarregaDepois(resultado)) {
      preparo.recarregar();
    }
  };

  // O dialogo do RT guarda o que ele le AGORA (montarPedidoDeAprovacao).
  const abrirAprovacao = (
    modo: PedidoDeAprovacao["modo"],
    versao: VersaoDoPreparo,
  ) => {
    const novo = montarPedidoDeAprovacao({
      modo,
      versao,
      resumo,
      rtAberto: dados.rtAberto,
      procedimento,
    });
    if (novo !== null) {
      setPedido(novo);
    }
  };

  // "Aprovar de novo" so sem texto novo esperando: salvar de novo o texto
  // antigo descartaria o novo (a RPC troca a aguardando pela versao nova; a
  // action tambem recusa, TELA-1).
  const baseDoAprovarDeNovo =
    aguardando === null
      ? situacao === "precisa_de_nova_aprovacao"
        ? aprovada
        : suspensa
      : null;
  const motivo =
    aprovada !== null && situacao === "precisa_de_nova_aprovacao"
      ? motivoDaNovaAprovacao(dados, aprovada, procedimento.nome)
      : null;

  const blocoDaAprovada = (versao: VersaoDoPreparo, titulo: string) => (
    <div className="grid gap-2" data-parte="bloco-em-vigor">
      <h4 className="text-[13px] font-semibold text-text-strong">{titulo}</h4>
      {motivo && versao === aprovada ? (
        <p className="text-[13px] text-text-secondary">{motivo}</p>
      ) : null}
      {versao === suspensa && versao.encerradoEm ? (
        <p className="text-[13px] text-text-secondary">
          {suspensoDesde(dataNoFuso(versao.encerradoEm, timezone))}
        </p>
      ) : null}
      <TextoDoPreparo
        texto={versao.texto}
        aoTentarDeNovo={preparo.recarregar}
      />
      <p className="text-xs text-text-secondary">
        {linhaDaAprovacao(dados, versao, timezone)}
      </p>
      <div className="flex flex-wrap gap-2">
        {situacao === "aprovada" && versao === aprovada ? (
          <BotaoProtegido
            podeEditar={podeEscrever}
            dica={FRASES_SEM_PERMISSAO.suspender}
            onClick={() => setConfirmandoSuspensao(true)}
            disabled={ocupado}
          >
            {T.suspender}
          </BotaoProtegido>
        ) : null}
        {baseDoAprovarDeNovo !== null && versao === baseDoAprovarDeNovo ? (
          <BotaoProtegido
            podeEditar={podeAprovar}
            dica={dicaDeAprovar}
            variant="default"
            onClick={() =>
              abrirAprovacao("aprovar_de_novo", baseDoAprovarDeNovo)
            }
            disabled={ocupado || baseDoAprovarDeNovo.texto === null}
          >
            {T.aprovarDeNovo}
          </BotaoProtegido>
        ) : null}
      </div>
    </div>
  );

  const blocoDoAguardando = (versao: VersaoDoPreparo) => {
    const textoAntigoDoCadastro = versao.origem === "texto_antigo";
    // A aprovacao prende o nome da versao (nome_mudou): escrito com o nome
    // antigo, o texto precisa ser enviado de novo antes de o RT aprovar.
    const nomeMudou = versao.nomeDoProcedimento !== procedimento.nome;
    const semTextoLido =
      versao.texto === null ||
      (ultimoAprovado !== null && ultimoAprovado.texto === null);
    return (
      <div className="grid gap-2" data-parte="bloco-aguardando">
        <h4 className="text-[13px] font-semibold text-text-strong">
          {textoAntigoDoCadastro ? T.aguardandoTextoAntigo : T.aguardando}
        </h4>
        {nomeMudou ? (
          <p
            data-parte="nome-mudou-no-aguardando"
            className="flex items-start gap-1.5 text-[13px] text-warning-text"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{T.nomeMudouNoAguardando}</span>
          </p>
        ) : null}
        <TextoDoPreparo
          texto={versao.texto}
          aoTentarDeNovo={preparo.recarregar}
        />
        <p className="text-xs text-text-secondary">
          {linhaDaAutoria(dados, versao, timezone)}{" "}
          {situacao === "aprovada" ? T.enquantoComVigor : T.enquantoSemVigor}
        </p>
        <div className="flex flex-wrap gap-2">
          {nomeMudou ? (
            <BotaoProtegido
              podeEditar={podeEscrever}
              dica={FRASES_SEM_PERMISSAO.escrever}
              variant="default"
              onClick={() => void reenviar(versao)}
              disabled={ocupado || versao.texto === null}
            >
              {reenviando ? T.enviando : T.enviarDeNovo}
            </BotaoProtegido>
          ) : null}
          <BotaoProtegido
            podeEditar={podeAprovar && !nomeMudou}
            dica={podeAprovar ? T.dicaDoNomeMudou : dicaDeAprovar}
            variant={nomeMudou ? "outline" : "default"}
            onClick={() => abrirAprovacao("aprovar", versao)}
            disabled={ocupado || semTextoLido}
          >
            {T.revisar}
          </BotaoProtegido>
          <BotaoProtegido
            podeEditar={podeEscrever}
            dica={FRASES_SEM_PERMISSAO.descartar}
            variant="ghost"
            onClick={() => setDescarte(versao)}
            disabled={ocupado}
          >
            {descartando
              ? T.descartando
              : textoAntigoDoCadastro
                ? T.descartarTextoAntigo
                : T.descartar}
          </BotaoProtegido>
        </div>
      </div>
    );
  };

  // Outra pessoa salvou enquanto o editor estava aberto (TELA-3): diz onde
  // esta o texto novo e, se ele espera o RT, que o envio toma o lugar dele.
  const avisoDoEditor =
    editor !== null && editor.conflito
      ? aguardando !== null && aguardando.versao > editor.versaoLida
        ? T.outraPessoaSalvouAguardando
        : T.outraPessoaSalvou
      : null;

  return moldura(
    <>
      {rtVigente ? null : <AvisoSemRt podeDefinirRt={preparo.podeDefinirRt} />}

      {devolvida && devolvida.comentario ? (
        <Aviso tom="warning" role="note">
          {devolvidoPeloRt(
            dataNoFuso(devolvida.escritoEm, timezone),
            devolvida.comentario,
          )}
        </Aviso>
      ) : null}

      {aprovada
        ? blocoDaAprovada(
            aprovada,
            situacao === "aprovada" ? T.emVigor : T.aprovadaParada,
          )
        : null}
      {suspensa ? blocoDaAprovada(suspensa, T.suspensa) : null}

      {aguardando ? blocoDoAguardando(aguardando) : null}

      {versoes.length === 0 && editor === null ? (
        <p className="text-[13px] text-text-secondary">{T.semOrientacao}</p>
      ) : null}

      {erro ? (
        <Aviso tom="alert" role="alert">
          {erro}
        </Aviso>
      ) : null}

      {editor !== null ? (
        <EditorDoPreparo
          id={id}
          texto={editor.texto}
          aoMudar={(novo) => {
            setEditor((atual) =>
              atual === null ? null : { ...atual, texto: novo },
            );
            setErroDoEditor(null);
          }}
          enviando={enviando}
          erro={erroDoEditor}
          aviso={avisoDoEditor}
          aoEnviar={() => void enviarTexto()}
          aoCancelar={cancelarEditor}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <BotaoProtegido
            podeEditar={podeEscrever}
            dica={FRASES_SEM_PERMISSAO.escrever}
            onClick={abrirEditor}
            disabled={ocupado}
          >
            <PenLine aria-hidden />
            {versoes.length === 0 ? T.escrever : T.escreverNovo}
          </BotaoProtegido>
          {versoes.length > 0 ? (
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => setVerVersoes((v) => !v)}
              aria-expanded={verVersoes}
            >
              <History aria-hidden />
              {verVersoes ? T.esconderVersoes : T.verVersoes}
            </Button>
          ) : null}
        </div>
      )}

      {verVersoes && versoes.length > 0 ? (
        <ListaDeVersoes dados={dados} versoes={versoes} timezone={timezone} />
      ) : null}

      {/* Montado enquanto houver pedido, mesmo que a sessao deixe de ser o
          RT: o dialogo diz isso e trava, ate a pessoa fechar (TELA-2). */}
      <AprovarPreparoDialog
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        procedureId={procedimento.id}
        souRt={podeAprovar}
        rtDeAgora={dados.rtAberto}
        aoConcluir={preparo.recarregar}
      />

      <ConfirmarDescarteDoRascunho
        aberto={cancelandoEditor}
        corpo={T.rascunhoAoCancelar}
        rotuloDescartar={T.descartarOTexto}
        aoContinuar={() => setCancelandoEditor(false)}
        aoDescartar={fecharEditor}
      />

      <ConfirmarDescarteDoTextoNovo
        versao={descarte}
        doRt={podeAprovar}
        descartando={descartando}
        aoVoltar={() => setDescarte(null)}
        aoDescartar={() => {
          if (descarte !== null) {
            void descartar(descarte);
          }
        }}
      />

      <Dialog
        open={confirmandoSuspensao}
        onOpenChange={(aberto) => {
          if (!suspendendo) {
            setConfirmandoSuspensao(aberto);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{T.suspenderTitulo}</DialogTitle>
            <DialogDescription>{T.suspenderCorpo}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => setConfirmandoSuspensao(false)}
              disabled={suspendendo}
            >
              {T.voltar}
            </Button>
            <Button
              variant="destructive"
              className="h-10"
              onClick={() => void suspender()}
              disabled={suspendendo}
            >
              {suspendendo ? T.suspendendo : T.suspenderConfirmar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
    <ChipDoPreparo situacao={situacao} />,
  );
}
