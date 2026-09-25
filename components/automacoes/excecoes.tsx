"use client";

import { ChevronDown, Layers, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  criarReguaDeExcecaoAction,
  excluirReguaAction,
  salvarLimiarDaReforcadaAction,
} from "@/app/(app)/automacoes/actions";
import { AbaRegua } from "@/components/automacoes/aba-regua";
import {
  DialogoDeExclusao,
  PERDAS_DO_HISTORICO,
} from "@/components/automacoes/dialogo-de-exclusao";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REGUA_STATUS } from "@/lib/design/status";
import { LIMIAR_RISCO_DE_FALTA } from "@/lib/domain/etiquetas";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import type {
  ExcecaoDeConfirmacao,
  ProcedimentoParaExcecao,
} from "@/lib/queries/automacoes";
import { cn } from "@/lib/utils";

// Excecoes da regua de confirmacao (spec 8.2 e 8.3): regua propria por
// procedimento (colonoscopia tem 41% de falta, consulta comum tem 2%) e
// regua reforcada para paciente com historico de falta. O planner escolhe a
// mais especifica sozinho; aqui a clinica cria, edita e exclui.
//
// Desenho do design system (docs/06 secao 5.10): cada regua num cartao com
// cabecalho de acordeao (nome, recorte e a situacao em 3 camadas com
// REGUA_STATUS; achado 54) e "Excluir" suave, que pergunta antes (achado 48).

/**
 * A frase VERDADEIRA sobre o numero de faltas (achado 53): ele vale so para
 * a regua. A etiqueta de risco da ficha tem regra propria, fixa.
 */
function FraseDoLimiar() {
  return (
    <>
      Vale só para esta régua. A etiqueta de risco da ficha do paciente continua
      aparecendo a partir de{" "}
      <span className="cz-num">{LIMIAR_RISCO_DE_FALTA}</span> faltas.
    </>
  );
}

/**
 * O numero de faltas da regua reforcada, editavel depois de criada (achado
 * 53). Antes so mudava excluindo e recriando a regua, o que apaga os textos
 * e o historico de envios. A action valida de novo com Zod (1 a 10).
 */
function LimiarDaReforcada({
  regua,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  regua: ExcecaoDeConfirmacao;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [valor, setValor] = useState(String(regua.no_show_threshold));
  const [pendente, iniciarTransicao] = useTransition();

  // Depois de salvar (ou de outra pessoa mudar), o campo mostra o salvo.
  useEffect(() => {
    setValor(String(regua.no_show_threshold));
  }, [regua.no_show_threshold]);

  const numero = Number(valor);
  const valido = Number.isInteger(numero) && numero >= 1 && numero <= 10;
  const mudou = valido && numero !== regua.no_show_threshold;
  const id = `limiar-${regua.id}`;

  const salvar = () => {
    iniciarTransicao(async () => {
      const resultado = await salvarLimiarDaReforcadaAction({
        cadence_id: regua.id,
        no_show_threshold: numero,
      });
      if (resultado.ok) {
        toast.success("Número de faltas salvo.");
        await aoMudar();
        return;
      }
      toast.error(
        resultado.error ?? "Não foi possível salvar o número de faltas.",
      );
    });
  };

  const botao = (
    <Button
      variant="outline"
      disabled={!podeEditar || pendente || !mudou}
      onClick={salvar}
    >
      {pendente ? "Salvando..." : "Salvar número"}
    </Button>
  );

  return (
    <div className="grid gap-2 rounded-xl bg-surface-4 p-3.5">
      <Label htmlFor={id}>A partir de quantas faltas</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          min={1}
          max={10}
          className="w-24 cz-num"
          value={valor}
          aria-invalid={!valido}
          disabled={!podeEditar || pendente}
          onChange={(evento) => setValor(evento.target.value)}
        />
        {podeEditar ? (
          botao
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>{botao}</DisabledWithHint>
        )}
      </div>
      {!valido ? (
        <p className="text-[11px] font-medium text-alert-text" role="alert">
          Use um número de <span className="cz-num">1</span> a{" "}
          <span className="cz-num">10</span>.
        </p>
      ) : null}
      <p className="text-[11.5px] text-text-secondary">
        <FraseDoLimiar />
      </p>
    </div>
  );
}

export function Excecoes({
  clinicId,
  excecoes,
  procedimentos,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  aoMudar,
}: {
  clinicId: string;
  excecoes: ExcecaoDeConfirmacao[];
  procedimentos: ProcedimentoParaExcecao[];
  nomeDaClinica: string;
  precoCents: number | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ehAdministrador: boolean;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [aExcluir, setAExcluir] = useState<ExcecaoDeConfirmacao | null>(null);
  const [base, setBase] = useState<"procedimento" | "reforcada">(
    "procedimento",
  );
  const [procedimentoId, setProcedimentoId] = useState("");
  const [limiar, setLimiar] = useState("2");
  const [pendente, iniciarTransicao] = useTransition();

  const temReforcada = excecoes.some((regua) => regua.for_no_show_history);
  const procedimentosLivres = procedimentos.filter(
    (procedimento) =>
      !excecoes.some((regua) => regua.procedure?.id === procedimento.id),
  );

  const criar = () => {
    iniciarTransicao(async () => {
      const resultado = await criarReguaDeExcecaoAction(
        base === "procedimento"
          ? { base, procedure_id: procedimentoId }
          : { base, no_show_threshold: Number(limiar) },
      );
      if (resultado.ok) {
        if (resultado.aviso) {
          toast.warning(resultado.aviso);
        }
        toast.success("Régua criada, desligada. Ajuste os textos e ligue.");
        setDialogoAberto(false);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível criar a régua.");
    });
  };

  const excluir = (regua: ExcecaoDeConfirmacao) => {
    iniciarTransicao(async () => {
      const resultado = await excluirReguaAction({ cadence_id: regua.id });
      if (resultado.ok) {
        toast.success(`Régua ${regua.name} excluída.`);
        setAExcluir(null);
        await aoMudar();
        return;
      }
      toast.error(resultado.error ?? "Não foi possível excluir.");
    });
  };

  return (
    <section className="grid gap-3" aria-labelledby="excecoes-titulo">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2
            id="excecoes-titulo"
            className="text-base leading-[1.3] font-bold tracking-[-0.01em]"
          >
            Exceções da confirmação
          </h2>
          <p className="max-w-[62ch] text-[13px] text-text-secondary">
            Procedimentos com preparo, como colonoscopia, têm falta muito maior
            e pedem mais toques. Pacientes com histórico de falta também. A
            régua mais específica vence a principal.
          </p>
        </div>
        {podeEditar ? (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => setDialogoAberto(true)}
          >
            <Plus aria-hidden />
            Nova régua de exceção
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button variant="outline" disabled>
              <Plus aria-hidden />
              Nova régua de exceção
            </Button>
          </DisabledWithHint>
        )}
      </div>

      {excecoes.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={Layers}
            title="Nenhuma exceção ainda"
            description="A régua principal cobre todas as consultas."
          />
        </Card>
      ) : (
        excecoes.map((regua) => {
          const expandida = aberta === regua.id;
          const idConteudo = `excecao-${regua.id}`;
          return (
            <Card key={regua.id}>
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                <button
                  type="button"
                  aria-expanded={expandida}
                  aria-controls={idConteudo}
                  onClick={() => setAberta(expandida ? null : regua.id)}
                  className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-text-secondary transition-transform duration-(--dur-base) motion-reduce:transition-none",
                      expandida && "rotate-180",
                    )}
                    aria-hidden
                  />
                  <span className="text-[13.5px] font-bold text-text-strong">
                    {regua.name}
                  </span>
                  {regua.for_no_show_history ? (
                    <span className="text-xs text-text-secondary">
                      para quem tem{" "}
                      <span className="cz-num">{regua.no_show_threshold}</span>{" "}
                      {regua.no_show_threshold === 1 ? "falta" : "faltas"} ou
                      mais
                    </span>
                  ) : null}
                  <StatusChip
                    size="sm"
                    className="ml-auto"
                    definition={
                      REGUA_STATUS[regua.active ? "ligada" : "desligada"]
                    }
                  />
                </button>
                {podeEditar ? (
                  <Button
                    variant="destructive"
                    aria-label={`Excluir a régua ${regua.name}`}
                    disabled={pendente}
                    onClick={() => setAExcluir(regua)}
                  >
                    <Trash2 aria-hidden />
                    Excluir
                  </Button>
                ) : (
                  <DisabledWithHint hint={dicaSemPermissao}>
                    <Button
                      variant="destructive"
                      aria-label={`Excluir a régua ${regua.name}`}
                      disabled
                    >
                      <Trash2 aria-hidden />
                      Excluir
                    </Button>
                  </DisabledWithHint>
                )}
              </div>
              {expandida ? (
                <div
                  id={idConteudo}
                  className="grid gap-4 border-t border-border p-4"
                >
                  {regua.for_no_show_history ? (
                    <LimiarDaReforcada
                      regua={regua}
                      podeEditar={podeEditar}
                      dicaSemPermissao={dicaSemPermissao}
                      aoMudar={aoMudar}
                    />
                  ) : null}
                  <AbaRegua
                    clinicId={clinicId}
                    regua={regua}
                    copy={{
                      ligar: `Ligar a régua ${regua.name}`,
                      ligada: "Régua ligada",
                      desligada: "Régua desligada",
                      inicioDaLinha: "Agendou",
                      fimDaLinha: "Consulta",
                      vazio: "Esta régua não tem mensagens.",
                    }}
                    nomeDaClinica={nomeDaClinica}
                    botoesDaPreview={MENU_CONFIRMACAO.map(
                      (opcao) => opcao.text,
                    )}
                    estimativa={{
                      eventos30d: regua.eventos30d,
                      rotuloDoEvento: "consultas marcadas",
                      rotuloDoEventoSingular: "consulta marcada",
                      precoCents,
                    }}
                    sentidoDoPasso="antes"
                    tipoDaRegua="confirmacao"
                    eventoRotulo="a consulta"
                    podeEditar={podeEditar}
                    dicaSemPermissao={dicaSemPermissao}
                    ehAdministrador={ehAdministrador}
                    aninhada
                    aoMudar={aoMudar}
                  />
                </div>
              ) : null}
            </Card>
          );
        })
      )}

      <DialogoDeExclusao
        aberto={aExcluir !== null}
        titulo={`Excluir a régua ${aExcluir?.name ?? ""}?`}
        descricao="As próximas consultas deste recorte passam a seguir a régua principal de confirmação."
        consequencias={[
          "Os textos e os anexos da régua são apagados.",
          "Todo o histórico de envios dela também é apagado: some das métricas e da lista do dia em Confirmações.",
          PERDAS_DO_HISTORICO.resposta,
        ]}
        rotuloConfirmar="Excluir régua"
        pendente={pendente}
        onFechar={() => setAExcluir(null)}
        onConfirmar={() => {
          if (aExcluir) {
            excluir(aExcluir);
          }
        }}
      />

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Nova régua de exceção</DialogTitle>
            <DialogDescription>
              A régua nasce desligada, copiando a janela e as mensagens da
              principal, para você ajustar antes de ligar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="excecao-base">Tipo de exceção</Label>
              <Select
                value={base}
                onValueChange={(v) => setBase(v as typeof base)}
              >
                <SelectTrigger id="excecao-base" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="procedimento">Por procedimento</SelectItem>
                  <SelectItem value="reforcada" disabled={temReforcada}>
                    Reforçada por histórico de falta
                    {temReforcada ? " (já existe)" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {base === "procedimento" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="excecao-procedimento">Procedimento</Label>
                <Select
                  value={procedimentoId}
                  onValueChange={setProcedimentoId}
                >
                  <SelectTrigger id="excecao-procedimento" className="w-full">
                    <SelectValue placeholder="Escolha o procedimento" />
                  </SelectTrigger>
                  <SelectContent>
                    {procedimentosLivres.map((procedimento) => (
                      <SelectItem key={procedimento.id} value={procedimento.id}>
                        {procedimento.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {procedimentosLivres.length === 0 ? (
                  <p className="text-[11px] text-text-secondary">
                    Todos os procedimentos ativos já têm régua própria.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="excecao-limiar">
                  A partir de quantas faltas
                </Label>
                <Input
                  id="excecao-limiar"
                  type="number"
                  min={1}
                  max={10}
                  className="w-24 cz-num"
                  value={limiar}
                  onChange={(e) => setLimiar(e.target.value)}
                />
                {/* Achado 53: a frase antiga dizia que o numero aparecia na
                    etiqueta de risco da ficha, e nao aparece. */}
                <p className="text-[11px] text-text-secondary">
                  <FraseDoLimiar /> Dá para mudar o número depois, na própria
                  régua.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setDialogoAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={
                pendente ||
                (base === "procedimento"
                  ? procedimentoId === ""
                  : !Number.isInteger(Number(limiar)) ||
                    Number(limiar) < 1 ||
                    Number(limiar) > 10)
              }
              onClick={criar}
            >
              {pendente ? "Criando..." : "Criar régua"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
