"use client";

import { Eye, EyeOff, FileUser, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  lerDadosInformadosAction,
  revelarDadoInformadoAction,
  type DadoProtegido,
  type DadosInformadosDaConsulta,
  type ResultadoDoDadoRevelado,
  type ResultadoDosDadosInformados,
} from "@/app/(app)/agenda/actions";
import {
  dataNaClinica,
  horaNaClinica,
} from "@/components/atendimento/fuso-da-clinica";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatarCpf,
  mascararCarteirinha,
  mascararCpf,
  type SituacaoDaConsulta,
} from "@/lib/domain/dados-informados";
import { formatarTelefone } from "@/lib/domain/telefone";
import { cn } from "@/lib/utils";

// "Ver dados informados" (AG3, decisao D-7 do dono, padrao recomendado): onde
// a equipe aprova a consulta que a IA marcou (o painel "Pendente de voce" e
// o menu da consulta), o que o paciente informou ao assistente para marcar:
// nome completo, nascimento, CPF, carteirinha, se a consulta e para ele
// mesmo, quando informou e, se ja entrou no cadastro, quando e por quem. Ao
// aprovar, o banco aplica esses dados ao cadastro do contato: o nome, se o
// cadastro estiver sem nome ou com o nome que veio do WhatsApp; nascimento,
// CPF e carteirinha, so se estiverem vazios (o gatilho da aprovacao).
//
// A leitura grava trilha (leu_dados_da_marcacao, sem o conteudo), entao e SO
// sob demanda: o clique no botao chama a acao (lerDadosInformadosAction),
// nunca a renderizacao, o foco da janela ou o tempo real. Fechar descarta o
// que foi lido; abrir de novo le de novo. Quem nao pode ler (papel que so ve
// a agenda) ve o botao desabilitado com a dica; o banco confere de novo (o
// profissional so na propria agenda).
//
// Revisao final da AG3 (achados 12 e 13):
//  - o CPF e a carteirinha chegam ao navegador SO mascarados. O olho do
//    campo (Eye para mostrar, EyeOff para ocultar, 40px, o rotulo muda junto
//    com o estado e por isso sem aria-pressed; docs/06 5.13) pede o dado
//    inteiro a acao propria (revelarDadoInformadoAction), que rele pela RPC
//    e grava a trilha de novo; ocultar descarta o valor;
//  - a consulta ja tratada diz o que aconteceu com os dados: recusada ou
//    cancelada, que nao entram no cadastro; tratada e sem dados, que eles
//    nao estao mais guardados (a manutencao apaga 30 dias depois). "Tentar
//    de novo" so no erro que passa tentando (o banco nao respondeu).
// Nada aqui vai para log nem para cache: o que foi lido mora so no estado do
// dialogo aberto.

export { formatarCpf, mascararCarteirinha, mascararCpf };

export const TEXTOS_DOS_DADOS_INFORMADOS = {
  ver: "Ver dados informados",
  titulo: "Dados informados pelo paciente",
  descricao: (nome: string | null) =>
    nome
      ? `O que o paciente informou ao assistente para marcar a consulta de ${nome}.`
      : "O que o paciente informou ao assistente para marcar esta consulta.",
  carregando: "Carregando os dados informados...",
  vazio: "O paciente não informou dados nesta conversa.",
  naoGuardados: "Os dados informados não estão mais guardados para esta consulta.",
  erro: "Não foi possível carregar os dados. Tente de novo.",
  tentarDeNovo: "Tentar de novo",
  semPermissao: "Seu perfil não vê os dados que o paciente informou.",
  nomeCompleto: "Nome completo",
  nascimento: "Data de nascimento",
  cpf: "CPF",
  carteirinha: "Carteirinha",
  paraQuem: "Para quem é a consulta",
  paraOProprio: "Para o próprio paciente",
  paraOutraPessoa: "Para outra pessoa",
  informadoEm: "Informado em",
  noCadastro: "No cadastro",
  naoInformado: "Não informado",
  naoInformada: "Não informada",
  oculto: "oculto",
  mostrar: (campo: string) => `Mostrar ${campo}`,
  ocultar: (campo: string) => `Ocultar ${campo}`,
  mostrando: "Carregando o dado...",
  naoMostrou: "Não foi possível mostrar o dado. Tente de novo.",
  aindaNaoAplicado: "Ainda não aplicado.",
  naoEntraRecusada: "Não entra no cadastro: a consulta foi recusada.",
  naoEntraCancelada: "Não entra no cadastro: a consulta foi cancelada.",
  naoEntraOutraPessoa: "Não entra no cadastro: a consulta é para outra pessoa.",
  naoEntrou: "Não entrou no cadastro.",
  regraDoCadastro:
    "O nome entra se o cadastro estiver sem nome ou com o nome que veio do WhatsApp; nascimento, CPF e carteirinha, só se estiverem vazios.",
  aplicado: (quando: string, quem: string | null) =>
    quem === null
      ? `Aplicado em ${quando}, na aprovação da consulta.`
      : `Aplicado em ${quando}, na aprovação por ${quem}.`,
  alguemDaEquipe: "alguém da equipe",
  aoAprovar:
    "Ao aprovar a consulta, estes dados entram no cadastro do paciente. O nome entra se o cadastro estiver sem nome ou com o nome que veio do WhatsApp; nascimento, CPF e carteirinha, só se estiverem vazios.",
  fechar: "Fechar",
} as const;

const T = TEXTOS_DOS_DADOS_INFORMADOS;

/** O nome do campo protegido no rotulo do olho ("Mostrar CPF"). */
const NOME_DO_CAMPO: Readonly<Record<DadoProtegido, string>> = {
  cpf: "CPF",
  carteirinha: "carteirinha",
};

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** "2001-05-09" (dia civil, sem fuso) vira "09/05/2001". */
export function dataCivilEmTexto(dia: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : dia;
}

/** O contato da consulta para o dialogo: o nome, o telefone ou nada. */
export function contatoDaConsulta(consulta: {
  contact: { name: string | null; phone_e164: string } | null;
}): string | null {
  const nome = consulta.contact?.name?.trim();
  if (nome) {
    return nome;
  }
  const telefone = consulta.contact?.phone_e164;
  return telefone ? formatarTelefone(telefone) : null;
}

/** "21/10/2026 às 14:05", no fuso da clinica (CLAUDE.md 3.6). */
export function instanteNaClinica(instante: string, fuso: string): string {
  return `${dataNaClinica(instante, fuso)} às ${horaNaClinica(instante, fuso)}`;
}

/**
 * A linha "No cadastro": entrou (quando e por quem) ou, revisao final da
 * AG3, por que nao entra (recusada, cancelada, outra pessoa) ou ainda nao.
 */
export function textoDoCadastro(
  dados: Pick<
    DadosInformadosDaConsulta,
    "aplicadoEm" | "aplicadoPor" | "paraOTitular"
  >,
  fuso: string,
  situacao: SituacaoDaConsulta,
): string {
  if (dados.aplicadoEm !== null) {
    const quando = instanteNaClinica(dados.aplicadoEm, fuso);
    if (dados.aplicadoPor === null) {
      return T.aplicado(quando, null);
    }
    return T.aplicado(quando, dados.aplicadoPor.nome ?? T.alguemDaEquipe);
  }
  if (!dados.paraOTitular) {
    return T.naoEntraOutraPessoa;
  }
  switch (situacao) {
    case "recusada":
      return T.naoEntraRecusada;
    case "cancelada":
      return T.naoEntraCancelada;
    case "aprovada":
      return T.naoEntrou;
    case "pendente":
      return T.aindaNaoAplicado;
  }
}

/** O que o dialogo diz quando nao ha dados: nunca informados ou ja apagados. */
export function textoSemDados(situacao: SituacaoDaConsulta): string {
  return situacao === "pendente" ? T.vazio : T.naoGuardados;
}

/** O que o dialogo mostra enquanto esta aberto. */
export type EstadoDosDadosInformados =
  | { tipo: "carregando" }
  | { tipo: "erro"; texto: string; transitorio: boolean }
  | { tipo: "pronto"; dados: DadosInformadosDaConsulta | null };

/** O resultado da acao no estado do dialogo. */
export function estadoDoResultado(
  resultado: ResultadoDosDadosInformados,
): EstadoDosDadosInformados {
  return resultado.ok
    ? { tipo: "pronto", dados: resultado.dados }
    : {
        tipo: "erro",
        texto: resultado.error || T.erro,
        transitorio: resultado.transitorio,
      };
}

export type LerDadosInformados = (
  consultaId: string,
) => Promise<ResultadoDosDadosInformados>;

export type RevelarDadoInformado = (
  consultaId: string,
  campo: DadoProtegido,
) => Promise<ResultadoDoDadoRevelado>;

/**
 * Uma leitura (uma chamada da acao) e o estado que o dialogo mostra. A acao
 * so e resolvida aqui, no clique: nada a toca ao renderizar. A que lanca
 * (rede, servidor fora) vira o erro de sempre, que passa tentando de novo.
 */
export async function lerOsDadosInformados(
  consultaId: string,
  ler?: LerDadosInformados,
): Promise<EstadoDosDadosInformados> {
  try {
    return estadoDoResultado(
      await (ler ?? lerDadosInformadosAction)(consultaId),
    );
  } catch {
    return { tipo: "erro", texto: T.erro, transitorio: true };
  }
}

/**
 * Revisao final da AG3: o dado protegido inteiro, sob pedido (a acao rele
 * pela RPC e grava a trilha). A que lanca vira o erro que passa tentando.
 */
export async function revelarODado(
  consultaId: string,
  campo: DadoProtegido,
  revelar?: RevelarDadoInformado,
): Promise<ResultadoDoDadoRevelado> {
  try {
    return await (revelar ?? revelarDadoInformadoAction)(consultaId, campo);
  } catch {
    return { ok: false, error: T.naoMostrou, transitorio: true };
  }
}

// ---------------------------------------------------------------------------
// Estado do dialogo (a leitura so no clique)
// ---------------------------------------------------------------------------

/**
 * Abre o dialogo de uma consulta e le na hora (uma leitura por abertura, e
 * por "Tentar de novo"). Resposta que chega depois de fechar, ou de abrir
 * outra consulta, e descartada. `ler` e `revelar` trocam as acoes nos
 * testes.
 */
export function useDadosInformados(
  ler?: LerDadosInformados,
  revelar?: RevelarDadoInformado,
) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoDosDadosInformados>({
    tipo: "carregando",
  });
  const pedido = useRef(0);

  const carregar = useCallback(
    async (consultaId: string) => {
      const este = ++pedido.current;
      setEstado({ tipo: "carregando" });
      const novo = await lerOsDadosInformados(consultaId, ler);
      if (pedido.current === este) {
        setEstado(novo);
      }
    },
    [ler],
  );

  const abrir = useCallback(
    (consultaId: string) => {
      setAberta(consultaId);
      void carregar(consultaId);
    },
    [carregar],
  );

  const fechar = useCallback(() => {
    pedido.current += 1;
    setAberta(null);
    setEstado({ tipo: "carregando" });
  }, []);

  const tentarDeNovo = useCallback(() => {
    if (aberta !== null) {
      void carregar(aberta);
    }
  }, [aberta, carregar]);

  const revelarCampo = useCallback(
    async (campo: DadoProtegido): Promise<ResultadoDoDadoRevelado> =>
      aberta === null
        ? { ok: false, error: T.naoMostrou, transitorio: false }
        : revelarODado(aberta, campo, revelar),
    [aberta, revelar],
  );

  return { aberta, estado, abrir, fechar, tentarDeNovo, revelar: revelarCampo };
}

// ---------------------------------------------------------------------------
// Pecas da tela
// ---------------------------------------------------------------------------

/**
 * O botao de bloco do cartao da pendencia (40px). Sem permissao, visivel e
 * desabilitado com a dica.
 */
export function BotaoDosDadosInformados({
  podeLer,
  aoAbrir,
  className,
}: {
  podeLer: boolean;
  aoAbrir: () => void;
  className?: string;
}) {
  const botao = (
    <Button
      variant="outline"
      className={cn("h-10 w-full", className)}
      disabled={!podeLer}
      onClick={podeLer ? aoAbrir : undefined}
    >
      <FileUser aria-hidden />
      {T.ver}
    </Button>
  );
  return podeLer ? (
    botao
  ) : (
    <DisabledWithHint hint={T.semPermissao} className="w-full">
      {botao}
    </DisabledWithHint>
  );
}

function Linha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-semibold text-text-secondary sm:pt-px">
        {rotulo}
      </dt>
      <dd className="min-w-0 text-[13.5px] break-words text-text-strong">
        {children}
      </dd>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <span className="text-text-secondary">{texto}</span>;
}

/** O que o campo protegido mostra: oculto, buscando, o valor ou o erro. */
export type EstadoDoCampo =
  | { tipo: "oculto" }
  | { tipo: "buscando" }
  | { tipo: "visivel"; valor: string }
  | { tipo: "erro"; texto: string };

/**
 * O clique no olho: o visivel volta a ficar oculto (o valor e descartado);
 * o resto pede o dado inteiro a acao. O CPF chega formatado; sem o dado (ou
 * com a acao recusando), o erro dela.
 */
export async function alternarOCampo(
  estado: EstadoDoCampo,
  campo: DadoProtegido,
  aoRevelar: (campo: DadoProtegido) => Promise<ResultadoDoDadoRevelado>,
): Promise<EstadoDoCampo> {
  if (estado.tipo === "visivel") {
    return { tipo: "oculto" };
  }
  const r = await aoRevelar(campo);
  if (r.ok && r.valor !== null) {
    return {
      tipo: "visivel",
      valor: campo === "cpf" ? formatarCpf(r.valor) : r.valor,
    };
  }
  return { tipo: "erro", texto: r.ok ? T.naoMostrou : r.error };
}

/**
 * Revisao final da AG3 (achado 12): o CPF ou a carteirinha, mascarado, com
 * o olho para mostrar. Mostrar pede o dado inteiro a acao (que rele e grava
 * a trilha); ocultar descarta o valor. O estado e so desta tela.
 * `estadoInicial` e para renderizar cada estado nos testes.
 */
export function CampoProtegido({
  campo,
  mascarado,
  aoRevelar,
  estadoInicial = { tipo: "oculto" },
}: {
  campo: DadoProtegido;
  mascarado: string;
  aoRevelar: (campo: DadoProtegido) => Promise<ResultadoDoDadoRevelado>;
  estadoInicial?: EstadoDoCampo;
}) {
  const [estado, setEstado] = useState<EstadoDoCampo>(estadoInicial);
  const nome = NOME_DO_CAMPO[campo];
  const visivel = estado.tipo === "visivel";
  const buscando = estado.tipo === "buscando";
  const Icone = buscando ? Loader2 : visivel ? EyeOff : Eye;

  const alternar = async () => {
    if (!visivel) {
      setEstado({ tipo: "buscando" });
    }
    setEstado(await alternarOCampo(estado, campo, aoRevelar));
  };

  return (
    <span className="grid gap-1">
      <span className="flex min-h-10 items-center gap-1">
        {visivel ? (
          <span className="cz-num">{estado.valor}</span>
        ) : (
          <span className="cz-num">
            <span aria-hidden>{mascarado}</span>
            <span className="sr-only">{T.oculto}</span>
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-text-secondary"
          disabled={buscando}
          aria-busy={buscando || undefined}
          aria-label={visivel ? T.ocultar(nome) : T.mostrar(nome)}
          onClick={() => void alternar()}
        >
          <Icone aria-hidden className={buscando ? "animate-spin" : undefined} />
        </Button>
        {buscando ? (
          <span role="status" className="sr-only">
            {T.mostrando}
          </span>
        ) : null}
      </span>
      {estado.tipo === "erro" ? (
        <span role="alert" className="text-xs text-alert-text">
          {estado.texto}
        </span>
      ) : null}
    </span>
  );
}

/**
 * O miolo do dialogo, por estado: carregando (esqueleto com o texto para o
 * leitor de tela), erro (com "Tentar de novo" so quando passa tentando),
 * vazio (nunca informado ou ja apagado, pela situacao da consulta) e os
 * dados. `situacao`: o que aconteceu com a consulta (so a pendente diz o que
 * acontece ao aprovar).
 */
export function CorpoDosDadosInformados({
  estado,
  fuso,
  situacao,
  aoTentarDeNovo,
  aoRevelar,
}: {
  estado: EstadoDosDadosInformados;
  fuso: string;
  situacao: SituacaoDaConsulta;
  aoTentarDeNovo: () => void;
  aoRevelar: (campo: DadoProtegido) => Promise<ResultadoDoDadoRevelado>;
}) {
  if (estado.tipo === "carregando") {
    return (
      <div role="status" aria-live="polite" className="grid gap-3 py-1">
        <span className="sr-only">{T.carregando}</span>
        {[0, 1, 2, 3].map((indice) => (
          <div key={indice} className="grid gap-1.5" aria-hidden>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    );
  }
  if (estado.tipo === "erro") {
    // role="alert": o leitor de tela anuncia o erro que chegou depois do
    // "carregando".
    return (
      <div role="alert">
        <EmptyState
          tom="erro"
          compact
          title={estado.texto}
          action={
            estado.transitorio
              ? {
                  label: T.tentarDeNovo,
                  onClick: aoTentarDeNovo,
                  variant: "outline",
                }
              : undefined
          }
        />
      </div>
    );
  }
  const { dados } = estado;
  if (dados === null) {
    return <EmptyState compact icon={FileUser} title={textoSemDados(situacao)} />;
  }
  return (
    <div className="grid gap-3">
      <dl className="divide-y divide-border">
        <Linha rotulo={T.nomeCompleto}>
          {dados.nomeCompleto ?? <Vazio texto={T.naoInformado} />}
        </Linha>
        <Linha rotulo={T.nascimento}>
          {dados.dataNascimento ? (
            <span className="cz-num">
              {dataCivilEmTexto(dados.dataNascimento)}
            </span>
          ) : (
            <Vazio texto={T.naoInformada} />
          )}
        </Linha>
        <Linha rotulo={T.cpf}>
          {dados.cpfMascarado ? (
            <CampoProtegido
              campo="cpf"
              mascarado={dados.cpfMascarado}
              aoRevelar={aoRevelar}
            />
          ) : (
            <Vazio texto={T.naoInformado} />
          )}
        </Linha>
        <Linha rotulo={T.carteirinha}>
          {dados.carteirinhaMascarada ? (
            <CampoProtegido
              campo="carteirinha"
              mascarado={dados.carteirinhaMascarada}
              aoRevelar={aoRevelar}
            />
          ) : (
            <Vazio texto={T.naoInformada} />
          )}
        </Linha>
        <Linha rotulo={T.paraQuem}>
          {dados.paraOTitular ? T.paraOProprio : T.paraOutraPessoa}
        </Linha>
        <Linha rotulo={T.informadoEm}>
          <span className="cz-num">
            {instanteNaClinica(dados.informadoEm, fuso)}
          </span>
        </Linha>
        <Linha rotulo={T.noCadastro}>
          {textoDoCadastro(dados, fuso, situacao)}
        </Linha>
      </dl>
      {situacao === "pendente" && dados.paraOTitular && dados.aplicadoEm === null ? (
        <Aviso tom="info" role="note">
          {T.aoAprovar}
        </Aviso>
      ) : dados.aplicadoEm !== null ? (
        <p className="text-xs text-text-secondary">{T.regraDoCadastro}</p>
      ) : null}
    </div>
  );
}

/**
 * O dialogo inteiro. Abre pelo `aberto` (o hook) e fecha pelo X, pelo Esc
 * ou pelo "Fechar".
 */
export function DialogoDosDadosInformados({
  aberto,
  nome,
  fuso,
  situacao,
  estado,
  aoFechar,
  aoTentarDeNovo,
  aoRevelar,
}: {
  aberto: boolean;
  /** O nome (ou o telefone) do contato da consulta; nulo sem nenhum. */
  nome: string | null;
  fuso: string;
  situacao: SituacaoDaConsulta;
  estado: EstadoDosDadosInformados;
  aoFechar: () => void;
  aoTentarDeNovo: () => void;
  aoRevelar: (campo: DadoProtegido) => Promise<ResultadoDoDadoRevelado>;
}) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          aoFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{T.titulo}</DialogTitle>
          <DialogDescription>{T.descricao(nome)}</DialogDescription>
        </DialogHeader>
        <CorpoDosDadosInformados
          estado={estado}
          fuso={fuso}
          situacao={situacao}
          aoTentarDeNovo={aoTentarDeNovo}
          aoRevelar={aoRevelar}
        />
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {T.fechar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
