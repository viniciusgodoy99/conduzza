"use client";

import { Info, RefreshCw, Reply, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { definirNumeroDasAutomaticasAction } from "@/app/(app)/automacoes/actions";
import {
  situacaoDoNumero,
  telefoneDoNumero,
  temEscolhaDeNumero,
  tiposQueMudaram,
  type NumerosDasAutomaticas,
  type PoliticaDeEnvio,
} from "@/components/automacoes/numeros-de-envio";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROTULO_DO_TIPO_DE_ENVIO,
  TIPOS_DE_ENVIO,
  type TipoDeEnvio,
} from "@/lib/domain/tipo-de-envio";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// Cartao "Numero das mensagens automaticas" (decisao 2 do dono, docs/07,
// telas da Fase 4; POR TIPO desde a decisao de 29/09/2026). SO aparece com
// mais de um numero ativo: com um numero so nao ha o que escolher.
//
// Uma linha por tipo de mensagem automatica, cada uma com um seletor:
// "Ultimo numero usado pelo paciente (recomendado)" (sem conversa, o
// principal) ou "sempre pelo numero X", um item por numero ativo. Tipo sem
// escolha gravada vale o ultimo usado.
//
// Salva tudo de uma vez, com UM botao, e so os tipos que mudaram: a pessoa
// ajusta quantas linhas quiser, confere e grava; gravar a cada troca
// recarimbaria a fila a cada clique. Quem nao edita (recepcao) ve tudo,
// desabilitado, com a dica no botao de salvar (regra 3.4: esconder nao
// protege; a action e a policy conferem o papel de novo).

const TITULO = "Número das mensagens automáticas";

/** Valor do seletor para o ultimo usado (os numeros sao uuid, nao colidem). */
const ULTIMO_USADO = "ultimo_usado";
const ROTULO_ULTIMO_USADO = "Último número usado pelo paciente (recomendado)";

function Cabecalho() {
  return (
    <CardHeader>
      <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
        {TITULO}
      </h2>
      <CardDescription>
        Escolha por qual número sai cada tipo de mensagem automática. No último
        número usado, quem nunca conversou com a clínica recebe pelo número
        principal.
      </CardDescription>
    </CardHeader>
  );
}

export function NumeroDasAutomaticas({
  dados,
  podeEditar,
  dicaSemPermissao,
  aoTentarDeNovo,
}: {
  /** Nulo quando a leitura dos numeros ou da politica falhou. */
  dados: NumerosDasAutomaticas | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoTentarDeNovo: () => void;
}) {
  if (dados === null) {
    return (
      <Card>
        <Cabecalho />
        <CardContent>
          <Aviso
            tom="alert"
            acao={
              <Button variant="outline" onClick={aoTentarDeNovo}>
                <RefreshCw aria-hidden />
                Tentar de novo
              </Button>
            }
          >
            Não foi possível carregar os números de WhatsApp da clínica.
          </Aviso>
        </CardContent>
      </Card>
    );
  }
  if (!temEscolhaDeNumero(dados)) {
    return null;
  }
  // A chave remonta a escolha quando o servidor devolve outra politica
  // (revalidatePath da action): o rascunho nunca fica preso na de antes.
  return (
    <EscolhaPorTipo
      key={TIPOS_DE_ENVIO.map((tipo) => dados.politica[tipo] ?? "").join(":")}
      numeros={dados.numeros}
      politica={dados.politica}
      podeEditar={podeEditar}
      dicaSemPermissao={dicaSemPermissao}
    />
  );
}

function ItemDoNumero({ numero }: { numero: NumeroDaClinica }) {
  const telefone = telefoneDoNumero(numero.display_phone);
  return (
    <>
      <span className="truncate font-semibold text-text-strong">
        {numero.nome}
      </span>
      {telefone ? (
        <span className="cz-num text-xs text-text-secondary">{telefone}</span>
      ) : null}
      <StatusChip
        size="sm"
        definition={situacaoDoNumero(numero.connection_status)}
      />
    </>
  );
}

/**
 * Os numeros escolhidos como fixos que NAO estao conectados, cada um com os
 * tipos que esperam por ele (na ordem da tela). A tela avisa: esses tipos
 * ficam parados ate a reconexao, nunca saem por outro numero.
 */
function fixosDesconectados(
  numeros: NumeroDaClinica[],
  rascunho: PoliticaDeEnvio,
): { numero: NumeroDaClinica; tipos: TipoDeEnvio[] }[] {
  return numeros
    .filter((numero) => numero.connection_status !== "conectado")
    .map((numero) => ({
      numero,
      tipos: TIPOS_DE_ENVIO.filter((tipo) => rascunho[tipo] === numero.id),
    }))
    .filter((grupo) => grupo.tipos.length > 0);
}

function EscolhaPorTipo({
  numeros,
  politica,
  podeEditar,
  dicaSemPermissao,
}: {
  numeros: NumeroDaClinica[];
  politica: PoliticaDeEnvio;
  podeEditar: boolean;
  dicaSemPermissao: string;
}) {
  const [salva, setSalva] = useState<PoliticaDeEnvio>(politica);
  const [rascunho, setRascunho] = useState<PoliticaDeEnvio>(politica);
  const [pendente, iniciarTransicao] = useTransition();

  const mudaram = tiposQueMudaram(salva, rascunho);
  const bloqueado = !podeEditar || pendente;
  const esperando = fixosDesconectados(numeros, rascunho);

  const escolher = (tipo: TipoDeEnvio, valor: string) => {
    setRascunho((atual) => ({
      ...atual,
      [tipo]: valor === ULTIMO_USADO ? null : valor,
    }));
  };

  const salvar = () => {
    if (!podeEditar || mudaram.length === 0) {
      return;
    }
    const nova = rascunho;
    iniciarTransicao(async () => {
      const resultado = await definirNumeroDasAutomaticasAction({
        escolhas: mudaram.map((tipo) => ({
          tipo,
          contaFixaId: nova[tipo],
        })),
      });
      if (!resultado.ok) {
        toast.error(
          resultado.error ??
            "Não foi possível salvar o número das mensagens automáticas.",
        );
        return;
      }
      setSalva(nova);
      if (resultado.aviso) {
        toast.warning(resultado.aviso, { duration: 10_000 });
        return;
      }
      const [unico] = mudaram;
      toast.success(
        unico && mudaram.length === 1
          ? `Escolha salva para ${ROTULO_DO_TIPO_DE_ENVIO[unico]}.`
          : "Escolhas salvas.",
      );
    });
  };

  const botaoSalvar = podeEditar ? (
    <Button disabled={pendente || mudaram.length === 0} onClick={salvar}>
      <Save aria-hidden />
      {pendente ? "Salvando..." : "Salvar escolhas"}
    </Button>
  ) : (
    <DisabledWithHint hint={dicaSemPermissao}>
      <Button disabled>
        <Save aria-hidden />
        Salvar escolhas
      </Button>
    </DisabledWithHint>
  );

  return (
    <Card>
      <Cabecalho />
      <CardContent className="grid gap-4">
        {/* fieldset desabilitado leva junto os seletores: a recepcao ve a
            escolha atual de cada tipo sem conseguir muda-la. */}
        <fieldset disabled={bloqueado} className="min-w-0">
          <legend className="sr-only">
            Por qual número sai cada tipo de mensagem automática
          </legend>
          <ul className="grid divide-y divide-border rounded-xl border border-border-strong">
            {TIPOS_DE_ENVIO.map((tipo) => (
              <LinhaDoTipo
                key={tipo}
                tipo={tipo}
                numeros={numeros}
                contaFixaId={rascunho[tipo]}
                bloqueado={bloqueado}
                aoEscolher={(valor) => escolher(tipo, valor)}
              />
            ))}
          </ul>
        </fieldset>

        {esperando.map(({ numero }) => (
          <Aviso key={numero.id} tom="warning">
            O número &quot;{numero.nome}&quot; não está conectado. Enquanto ele
            não reconectar, as mensagens que saem sempre por ele ficam
            esperando. Reconecte em Configurações, aba WhatsApp.
          </Aviso>
        ))}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid max-w-[62ch] gap-1.5 text-[12.5px] text-text-secondary">
            <p className="flex items-start gap-2">
              <Info aria-hidden className="mt-px size-4 shrink-0" />
              Se o número escolhido estiver desconectado, as mensagens esperam a
              reconexão. Elas nunca saem por outro número sozinhas.
            </p>
            <p className="flex items-start gap-2">
              <Reply aria-hidden className="mt-px size-4 shrink-0" />A resposta
              a quem respondeu uma mensagem sai pelo número em que o paciente
              respondeu.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {podeEditar && mudaram.length > 0 && !pendente ? (
              <span className="text-xs text-text-secondary">
                Há escolhas ainda não salvas.
              </span>
            ) : null}
            {botaoSalvar}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LinhaDoTipo({
  tipo,
  numeros,
  contaFixaId,
  bloqueado,
  aoEscolher,
}: {
  tipo: TipoDeEnvio;
  numeros: NumeroDaClinica[];
  /** O numero fixo deste tipo; nulo = ultimo usado. */
  contaFixaId: string | null;
  bloqueado: boolean;
  aoEscolher: (valor: string) => void;
}) {
  const id = `numero-do-tipo-${tipo}`;
  const escolhido =
    contaFixaId === null
      ? null
      : (numeros.find((numero) => numero.id === contaFixaId) ?? null);
  return (
    <li className="grid gap-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] sm:items-center sm:gap-4">
      <Label htmlFor={id} className="text-sm font-semibold text-text-strong">
        {ROTULO_DO_TIPO_DE_ENVIO[tipo]}
      </Label>
      <Select
        value={escolhido?.id ?? ULTIMO_USADO}
        onValueChange={aoEscolher}
        disabled={bloqueado}
      >
        <SelectTrigger id={id} className="w-full min-w-0">
          {/* O escolhido vai explicito: a pagina ja chega com ele desenhado
              no servidor, sem piscar vazio ate a hidratacao. */}
          <SelectValue>
            {escolhido ? (
              <ItemDoNumero numero={escolhido} />
            ) : (
              <span className="truncate">{ROTULO_ULTIMO_USADO}</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ULTIMO_USADO}>{ROTULO_ULTIMO_USADO}</SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Sempre pelo número</SelectLabel>
            {numeros.map((numero) => (
              <SelectItem key={numero.id} value={numero.id}>
                <ItemDoNumero numero={numero} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </li>
  );
}
