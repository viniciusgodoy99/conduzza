"use client";

import { Eye, EyeOff, FileUser } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  lerDadosInformadosAction,
  type DadosInformadosDaConsulta,
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
import { formatarTelefone } from "@/lib/domain/telefone";
import { cn } from "@/lib/utils";

// "Ver dados informados" (AG3, decisao D-7 do dono, padrao recomendado): onde
// a equipe aprova a consulta que a IA marcou (o painel "Pendente de voce" e
// o menu da consulta), o que o paciente informou ao assistente para marcar:
// nome completo, nascimento, CPF, carteirinha, se a consulta e para ele
// mesmo, quando informou e, se ja entrou no cadastro, quando e por quem. Ao
// aprovar, o banco aplica esses dados ao cadastro do contato so onde ele
// esta vazio (o gatilho da aprovacao).
//
// A leitura grava trilha (leu_dados_da_marcacao, sem o conteudo), entao e SO
// sob demanda: o clique no botao chama a acao (lerDadosInformadosAction),
// nunca a renderizacao, o foco da janela ou o tempo real. Fechar descarta o
// que foi lido; abrir de novo le de novo. Quem nao pode ler (papel que so ve
// a agenda) ve o botao desabilitado com a dica; o banco confere de novo (o
// profissional so na propria agenda).
//
// O CPF chega inteiro e aparece mascarado ate a pessoa pedir, com o olho do
// campo de senha (Eye para mostrar, EyeOff para ocultar, 40px, o rotulo
// muda junto com o estado e por isso sem aria-pressed; docs/06 5.13). Nada
// aqui vai para log nem para cache: o que foi lido mora so no estado do
// dialogo aberto.

export const TEXTOS_DOS_DADOS_INFORMADOS = {
  ver: "Ver dados informados",
  titulo: "Dados informados pelo paciente",
  descricao: (nome: string | null) =>
    nome
      ? `O que o paciente informou ao assistente para marcar a consulta de ${nome}.`
      : "O que o paciente informou ao assistente para marcar esta consulta.",
  carregando: "Carregando os dados informados...",
  vazio: "O paciente não informou dados nesta conversa.",
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
  cpfOculto: "oculto",
  mostrarCpf: "Mostrar CPF",
  ocultarCpf: "Ocultar CPF",
  aindaNaoAplicado: "Ainda não aplicado.",
  aplicado: (quando: string, quem: string | null) =>
    quem === null
      ? `Aplicado em ${quando}, na aprovação da consulta. Só entrou o que estava vazio.`
      : `Aplicado em ${quando}, na aprovação por ${quem}. Só entrou o que estava vazio.`,
  alguemDaEquipe: "alguém da equipe",
  aoAprovar:
    "Ao aprovar a consulta, estes dados entram no cadastro do paciente, só onde ele está vazio.",
  fechar: "Fechar",
} as const;

const T = TEXTOS_DOS_DADOS_INFORMADOS;

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** "12345678909" vira "123.456.789-09"; fora de 11 digitos, como veio. */
export function formatarCpf(cpf: string): string {
  const digitos = cpf.replace(/\D/g, "");
  return digitos.length === 11
    ? `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`
    : cpf;
}

/**
 * O CPF mascarado como o governo publica (so os digitos do meio):
 * "12345678909" vira "•••.456.789-••". Fora de 11 digitos, tudo oculto.
 */
export function mascararCpf(cpf: string): string {
  const digitos = cpf.replace(/\D/g, "");
  return digitos.length === 11
    ? `•••.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-••`
    : "•••.•••.•••-••";
}

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

/** A linha "No cadastro": entrou (quando e por quem) ou ainda nao. */
export function textoDoCadastro(
  dados: Pick<DadosInformadosDaConsulta, "aplicadoEm" | "aplicadoPor">,
  fuso: string,
): string {
  if (dados.aplicadoEm === null) {
    return T.aindaNaoAplicado;
  }
  const quando = instanteNaClinica(dados.aplicadoEm, fuso);
  if (dados.aplicadoPor === null) {
    return T.aplicado(quando, null);
  }
  return T.aplicado(quando, dados.aplicadoPor.nome ?? T.alguemDaEquipe);
}

/** O que o dialogo mostra enquanto esta aberto. */
export type EstadoDosDadosInformados =
  | { tipo: "carregando" }
  | { tipo: "erro"; texto: string }
  | { tipo: "pronto"; dados: DadosInformadosDaConsulta | null };

/** O resultado da acao no estado do dialogo. */
export function estadoDoResultado(
  resultado: ResultadoDosDadosInformados,
): EstadoDosDadosInformados {
  return resultado.ok
    ? { tipo: "pronto", dados: resultado.dados }
    : { tipo: "erro", texto: resultado.error || T.erro };
}

export type LerDadosInformados = (
  consultaId: string,
) => Promise<ResultadoDosDadosInformados>;

/**
 * Uma leitura (uma chamada da acao) e o estado que o dialogo mostra. A acao
 * so e resolvida aqui, no clique: nada a toca ao renderizar. A que lanca
 * (rede, servidor fora) vira o erro de sempre.
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
    return { tipo: "erro", texto: T.erro };
  }
}

// ---------------------------------------------------------------------------
// Estado do dialogo (a leitura so no clique)
// ---------------------------------------------------------------------------

/**
 * Abre o dialogo de uma consulta e le na hora (uma leitura por abertura, e
 * por "Tentar de novo"). Resposta que chega depois de fechar, ou de abrir
 * outra consulta, e descartada. `ler` troca a acao nos testes.
 */
export function useDadosInformados(ler?: LerDadosInformados) {
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

  return { aberta, estado, abrir, fechar, tentarDeNovo };
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

/** O CPF mascarado, com o olho para mostrar (o estado e so desta tela). */
export function CampoDoCpf({ cpf }: { cpf: string }) {
  const [visivel, setVisivel] = useState(false);
  const Icone = visivel ? EyeOff : Eye;
  return (
    <span className="flex min-h-10 items-center gap-1">
      {visivel ? (
        <span className="cz-num">{formatarCpf(cpf)}</span>
      ) : (
        <span className="cz-num">
          <span aria-hidden>{mascararCpf(cpf)}</span>
          <span className="sr-only">{T.cpfOculto}</span>
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-text-secondary"
        aria-label={visivel ? T.ocultarCpf : T.mostrarCpf}
        onClick={() => setVisivel((atual) => !atual)}
      >
        <Icone aria-hidden />
      </Button>
    </span>
  );
}

/**
 * O miolo do dialogo, por estado: carregando (esqueleto com o texto para o
 * leitor de tela), erro (com "Tentar de novo"), vazio e os dados. `pendente`:
 * a consulta ainda espera aprovacao (so entao a frase do que acontece ao
 * aprovar).
 */
export function CorpoDosDadosInformados({
  estado,
  fuso,
  pendente,
  aoTentarDeNovo,
}: {
  estado: EstadoDosDadosInformados;
  fuso: string;
  pendente: boolean;
  aoTentarDeNovo: () => void;
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
          action={{
            label: T.tentarDeNovo,
            onClick: aoTentarDeNovo,
            variant: "outline",
          }}
        />
      </div>
    );
  }
  const { dados } = estado;
  if (dados === null) {
    return <EmptyState compact icon={FileUser} title={T.vazio} />;
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
          {dados.cpf ? (
            <CampoDoCpf cpf={dados.cpf} />
          ) : (
            <Vazio texto={T.naoInformado} />
          )}
        </Linha>
        <Linha rotulo={T.carteirinha}>
          {dados.carteirinha ?? <Vazio texto={T.naoInformada} />}
        </Linha>
        <Linha rotulo={T.paraQuem}>
          {dados.paraOTitular ? T.paraOProprio : T.paraOutraPessoa}
        </Linha>
        <Linha rotulo={T.informadoEm}>
          <span className="cz-num">
            {instanteNaClinica(dados.informadoEm, fuso)}
          </span>
        </Linha>
        <Linha rotulo={T.noCadastro}>{textoDoCadastro(dados, fuso)}</Linha>
      </dl>
      {pendente && dados.paraOTitular && dados.aplicadoEm === null ? (
        <Aviso tom="info" role="note">
          {T.aoAprovar}
        </Aviso>
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
  pendente,
  estado,
  aoFechar,
  aoTentarDeNovo,
}: {
  aberto: boolean;
  /** O nome (ou o telefone) do contato da consulta; nulo sem nenhum. */
  nome: string | null;
  fuso: string;
  pendente: boolean;
  estado: EstadoDosDadosInformados;
  aoFechar: () => void;
  aoTentarDeNovo: () => void;
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
          pendente={pendente}
          aoTentarDeNovo={aoTentarDeNovo}
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
