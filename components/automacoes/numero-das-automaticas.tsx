"use client";

import { Info, RefreshCw, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { definirNumeroDasAutomaticasAction } from "@/app/(app)/automacoes/actions";
import {
  situacaoDoNumero,
  telefoneDoNumero,
  temEscolhaDeNumero,
  type ModoDeEnvio,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NumeroDaClinica } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Cartao "Numero das mensagens automaticas" (decisao 2 do dono, docs/07,
// telas da Fase 4). SO aparece com mais de um numero ativo: com um numero so
// nao ha o que escolher. Por padrao, as automaticas saem pelo ultimo numero
// com que o paciente conversou (sem conversa, pelo principal); quem configura
// as automacoes pode fixar "sempre pelo numero X".
//
// Salva com botao, e nao a cada clique: "sempre pelo mesmo numero" so vale
// com o numero escolhido, e gravar no meio da escolha recarimbaria a fila
// duas vezes. Quem nao edita (recepcao) ve tudo, desabilitado, com a dica no
// botao de salvar (regra 3.4: esconder nao protege; a action e a policy
// conferem o papel de novo).

const TITULO = "Número das mensagens automáticas";

const OPCOES: readonly {
  valor: ModoDeEnvio;
  rotulo: string;
  descricao: string;
}[] = [
  {
    valor: "ultimo_usado",
    rotulo: "Último número usado pelo paciente (recomendado)",
    descricao:
      "Confirmações, lembretes e avisos saem pelo número com que o paciente conversou por último. Quem nunca conversou recebe pelo número principal.",
  },
  {
    valor: "fixo",
    rotulo: "Sempre pelo mesmo número",
    descricao:
      "Todas as mensagens automáticas saem pelo número escolhido. A resposta a quem respondeu uma mensagem sai pelo número em que o paciente respondeu.",
  },
];

function Cabecalho() {
  return (
    <CardHeader>
      <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
        {TITULO}
      </h2>
      <CardDescription>
        Vale para confirmação, recuperação depois da falta, follow-up, lista de
        espera, aviso de remarcação e Cobrar agora.
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
    <EscolhaDoNumero
      key={`${dados.politica.modo}:${dados.politica.contaFixaId ?? ""}`}
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

function EscolhaDoNumero({
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
  const [modo, setModo] = useState<ModoDeEnvio>(politica.modo);
  const [contaFixaId, setContaFixaId] = useState<string | null>(
    politica.contaFixaId,
  );
  const [pendente, iniciarTransicao] = useTransition();

  const faltaNumero = modo === "fixo" && contaFixaId === null;
  const mudou =
    modo !== salva.modo ||
    (modo === "fixo" && contaFixaId !== salva.contaFixaId);
  const escolhido =
    modo === "fixo"
      ? (numeros.find((numero) => numero.id === contaFixaId) ?? null)
      : null;
  const bloqueado = !podeEditar || pendente;

  const salvar = () => {
    if (!podeEditar || faltaNumero || !mudou) {
      return;
    }
    const nova: PoliticaDeEnvio =
      modo === "fixo"
        ? { modo, contaFixaId }
        : { modo: "ultimo_usado", contaFixaId: null };
    iniciarTransicao(async () => {
      const resultado = await definirNumeroDasAutomaticasAction(
        nova.modo === "fixo"
          ? { modo: "fixo", contaFixaId: nova.contaFixaId }
          : { modo: "ultimo_usado" },
      );
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
      toast.success(
        escolhido
          ? `As mensagens automáticas saem sempre pelo número "${escolhido.nome}".`
          : "As mensagens automáticas saem pelo último número usado pelo paciente.",
      );
    });
  };

  const botaoSalvar = podeEditar ? (
    <Button disabled={pendente || !mudou || faltaNumero} onClick={salvar}>
      <Save aria-hidden />
      {pendente ? "Salvando..." : "Salvar escolha"}
    </Button>
  ) : (
    <DisabledWithHint hint={dicaSemPermissao}>
      <Button disabled>
        <Save aria-hidden />
        Salvar escolha
      </Button>
    </DisabledWithHint>
  );

  return (
    <Card>
      <Cabecalho />
      <CardContent className="grid gap-4">
        {/* fieldset desabilitado leva junto os radios e o seletor: a
            recepcao ve a escolha atual sem conseguir muda-la. */}
        <fieldset disabled={bloqueado} className="grid gap-2">
          <legend className="sr-only">
            Por qual número as mensagens automáticas saem
          </legend>
          {OPCOES.map((opcao) => {
            const marcada = modo === opcao.valor;
            const idDescricao = `numero-automaticas-${opcao.valor}`;
            return (
              <div
                key={opcao.valor}
                className={cn(
                  "grid gap-3 rounded-xl border px-3.5 py-3 cz-transition",
                  marcada
                    ? "border-primary-edge bg-primary-soft"
                    : "border-border-strong bg-card",
                  !bloqueado && !marcada && "hover:bg-surface-subtle",
                )}
              >
                <label
                  className={cn(
                    "flex min-h-10 items-start gap-3",
                    bloqueado ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <input
                    type="radio"
                    name="numero-das-automaticas"
                    value={opcao.valor}
                    checked={marcada}
                    aria-describedby={idDescricao}
                    onChange={() => setModo(opcao.valor)}
                    className="mt-0.5 size-4 shrink-0 accent-(--primary-edge)"
                  />
                  <span className="grid gap-0.5">
                    <span
                      className={cn(
                        "text-sm text-text-strong",
                        marcada ? "font-bold" : "font-semibold",
                      )}
                    >
                      {opcao.rotulo}
                    </span>
                    <span
                      id={idDescricao}
                      className="text-xs text-text-secondary"
                    >
                      {opcao.descricao}
                    </span>
                  </span>
                </label>
                {opcao.valor === "fixo" && marcada ? (
                  <div className="grid gap-1.5 pl-7">
                    <Label htmlFor="numero-fixo-das-automaticas">Número</Label>
                    <Select
                      value={contaFixaId ?? ""}
                      onValueChange={(valor) => setContaFixaId(valor)}
                      disabled={bloqueado}
                    >
                      <SelectTrigger
                        id="numero-fixo-das-automaticas"
                        className="w-full sm:max-w-md"
                      >
                        {/* O escolhido vai explicito: a pagina ja chega
                            com ele desenhada no servidor, sem piscar vazio
                            ate a hidratacao. */}
                        <SelectValue placeholder="Escolha o número">
                          {escolhido ? (
                            <ItemDoNumero numero={escolhido} />
                          ) : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {numeros.map((numero) => (
                          <SelectItem key={numero.id} value={numero.id}>
                            <ItemDoNumero numero={numero} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>

        {faltaNumero && salva.modo === "fixo" && salva.contaFixaId === null ? (
          <Aviso tom="warning">
            O número escolhido antes não está mais ativo nesta clínica. Escolha
            outro número para as mensagens automáticas.
          </Aviso>
        ) : null}
        {escolhido && escolhido.connection_status !== "conectado" ? (
          <Aviso tom="warning">
            O número &quot;{escolhido.nome}&quot; não está conectado. Enquanto
            ele não reconectar, as mensagens automáticas ficam esperando.
            Reconecte em Configurações, aba WhatsApp.
          </Aviso>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex max-w-[62ch] items-start gap-2 text-[12.5px] text-text-secondary">
            <Info aria-hidden className="mt-px size-4 shrink-0" />
            Se o número escolhido estiver desconectado, as mensagens esperam a
            reconexão. Elas nunca saem por outro número sozinhas.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {podeEditar && faltaNumero ? (
              <span className="text-xs text-text-secondary">
                Escolha o número para salvar.
              </span>
            ) : null}
            {botaoSalvar}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
