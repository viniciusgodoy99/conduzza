"use client";

import { CircleAlert, History, PenLine } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
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
  escritoPor,
  faixaDoRt,
  FRASES_SEM_PERMISSAO,
  PESSOA_SEM_NOME,
  problemaNoTextoDoPreparo,
  registroDoRt,
  ROTULO_DA_SITUACAO,
  suspensoDesde,
  TEXTOS_DO_PREPARO as T,
  textoAntigo,
} from "@/components/cadastros/preparo-na-tela";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
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
  normalizarTextoDoPreparo,
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
//  - aprovar, aprovar de novo e devolver: SO o RT vigente.
// Sem permissao, a acao fica visivel e desabilitada, com a frase 42501 do
// banco como dica (nunca escondida). A action e a RPC conferem de novo.

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

/** Sob o campo Nome: renomear tira a aprovacao (aria-describedby). */
export function AvisoDoNomeDoProcedimento({ id }: { id: string }) {
  return (
    <p
      id={id}
      aria-live="polite"
      className="flex items-start gap-1.5 text-xs text-warning-text"
    >
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{T.avisoDoNome}</span>
    </p>
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

/** Botao visivel sempre; sem permissao, desabilitado com a frase do banco. */
function BotaoDoPreparo({
  pode,
  dica,
  onClick,
  children,
  variant = "outline",
  disabled = false,
}: {
  pode: boolean;
  dica: string;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
  disabled?: boolean;
}) {
  if (pode) {
    return (
      <Button
        variant={variant}
        className="h-10"
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={dica}>
      <Button variant={variant} className="h-10" disabled>
        {children}
      </Button>
    </DisabledWithHint>
  );
}

/** O texto como o paciente le, com as quebras preservadas. */
function TextoDoPreparo({ texto }: { texto: string }) {
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
  aoEnviar,
  aoCancelar,
}: {
  id: string;
  texto: string;
  aoMudar: (texto: string) => void;
  enviando: boolean;
  erro: string | null;
  aoEnviar: () => void;
  aoCancelar: () => void;
}) {
  const tamanho = Array.from(normalizarTextoDoPreparo(texto)).length;
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
]);

function recarregaDepois(
  resultado: ResultadoDoPreparo | ResultadoDoSalvarPreparo,
): boolean {
  return !resultado.ok && RECUSAS_QUE_RECARREGAM.has(resultado.code ?? "");
}

// ---------------------------------------------------------------------------
// A secao
// ---------------------------------------------------------------------------

export function SecaoDoPreparo({
  procedimento,
  preparo,
  podeEditarCadastros,
  timezone,
}: {
  /** O procedimento GRAVADO (o nome do banco); null no procedimento novo. */
  procedimento: { id: string; nome: string } | null;
  preparo: PreparoDaAba;
  /** Administrador ou gestor (canEdit de Cadastros). */
  podeEditarCadastros: boolean;
  timezone: string;
}) {
  const id = useId();
  const idDoTitulo = `${id}-titulo`;
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroDoEditor, setErroDoEditor] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<PedidoDeAprovacao | null>(null);
  const [confirmandoSuspensao, setConfirmandoSuspensao] = useState(false);
  const [suspendendo, setSuspendendo] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [verVersoes, setVerVersoes] = useState(false);

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
  const podeAprovar = dados.souRt;
  const ocupado = enviando || suspendendo || descartando;

  // O editor parte do texto mais util: o que espera o RT, o que ele devolveu
  // (para corrigir o que o comentario pede), o aprovado ou o suspenso.
  const abrirEditor = () => {
    setTexto(
      aguardando?.texto ??
        devolvida?.texto ??
        aprovada?.texto ??
        suspensa?.texto ??
        "",
    );
    setErroDoEditor(null);
    setErro(null);
    setEscrevendo(true);
  };

  const enviarTexto = async () => {
    const problema = problemaNoTextoDoPreparo(texto);
    if (problema) {
      setErroDoEditor(problema);
      return;
    }
    setEnviando(true);
    setErroDoEditor(null);
    let resultado: ResultadoDoSalvarPreparo;
    try {
      resultado = await salvarPreparoAction({
        procedureId: procedimento.id,
        texto,
        versaoLida: resumo.versaoLida,
      });
    } catch {
      resultado = {
        ok: false,
        error: "Não foi possível salvar agora. Tente de novo.",
      };
    }
    setEnviando(false);
    if (resultado.ok) {
      toast.success(T.enviado);
      setEscrevendo(false);
      preparo.recarregar();
      return;
    }
    setErroDoEditor(resultado.error);
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
      resultado = {
        ok: false,
        error: "Não foi possível descartar agora. Tente de novo.",
      };
    }
    setDescartando(false);
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
      resultado = {
        ok: false,
        error: "Não foi possível suspender agora. Tente de novo.",
      };
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

  // "Aprovar de novo" so sem texto novo esperando: salvar de novo o texto
  // antigo descartaria o novo (a RPC troca a aguardando pela versao nova).
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
      <TextoDoPreparo texto={versao.texto} />
      <p className="text-xs text-text-secondary">
        {linhaDaAprovacao(dados, versao, timezone)}
      </p>
      <div className="flex flex-wrap gap-2">
        {situacao === "aprovada" && versao === aprovada ? (
          <BotaoDoPreparo
            pode={podeEscrever}
            dica={FRASES_SEM_PERMISSAO.suspender}
            onClick={() => setConfirmandoSuspensao(true)}
            disabled={ocupado}
          >
            {T.suspender}
          </BotaoDoPreparo>
        ) : null}
        {baseDoAprovarDeNovo !== null && versao === baseDoAprovarDeNovo ? (
          <BotaoDoPreparo
            pode={podeAprovar}
            dica={FRASES_SEM_PERMISSAO.aprovar}
            variant="default"
            onClick={() =>
              setPedido({
                modo: "aprovar_de_novo",
                versao: baseDoAprovarDeNovo,
              })
            }
            disabled={ocupado}
          >
            {T.aprovarDeNovo}
          </BotaoDoPreparo>
        ) : null}
      </div>
    </div>
  );

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

      {aguardando ? (
        <div className="grid gap-2" data-parte="bloco-aguardando">
          <h4 className="text-[13px] font-semibold text-text-strong">
            {T.aguardando}
          </h4>
          <TextoDoPreparo texto={aguardando.texto} />
          <p className="text-xs text-text-secondary">
            {linhaDaAutoria(dados, aguardando, timezone)}{" "}
            {situacao === "aprovada" ? T.enquantoComVigor : T.enquantoSemVigor}
          </p>
          <div className="flex flex-wrap gap-2">
            <BotaoDoPreparo
              pode={podeAprovar}
              dica={FRASES_SEM_PERMISSAO.aprovar}
              variant="default"
              onClick={() => setPedido({ modo: "aprovar", versao: aguardando })}
              disabled={ocupado}
            >
              {T.revisar}
            </BotaoDoPreparo>
            <BotaoDoPreparo
              pode={podeEscrever}
              dica={FRASES_SEM_PERMISSAO.descartar}
              variant="ghost"
              onClick={() => void descartar(aguardando)}
              disabled={ocupado}
            >
              {descartando ? T.descartando : T.descartar}
            </BotaoDoPreparo>
          </div>
        </div>
      ) : null}

      {versoes.length === 0 && !escrevendo ? (
        <p className="text-[13px] text-text-secondary">{T.semOrientacao}</p>
      ) : null}

      {erro ? (
        <Aviso tom="alert" role="alert">
          {erro}
        </Aviso>
      ) : null}

      {escrevendo ? (
        <EditorDoPreparo
          id={id}
          texto={texto}
          aoMudar={(novo) => {
            setTexto(novo);
            setErroDoEditor(null);
          }}
          enviando={enviando}
          erro={erroDoEditor}
          aoEnviar={() => void enviarTexto()}
          aoCancelar={() => {
            setEscrevendo(false);
            setErroDoEditor(null);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <BotaoDoPreparo
            pode={podeEscrever}
            dica={FRASES_SEM_PERMISSAO.escrever}
            onClick={abrirEditor}
            disabled={ocupado}
          >
            <PenLine aria-hidden />
            {versoes.length === 0 ? T.escrever : T.escreverNovo}
          </BotaoDoPreparo>
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

      {dados.rtAberto && podeAprovar ? (
        <AprovarPreparoDialog
          pedido={pedido}
          aoFechar={() => setPedido(null)}
          procedureId={procedimento.id}
          procedimento={procedimento.nome}
          rt={dados.rtAberto}
          textoEmVigor={aprovada?.texto ?? null}
          versaoLida={resumo.versaoLida}
          aoConcluir={preparo.recarregar}
        />
      ) : null}

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
