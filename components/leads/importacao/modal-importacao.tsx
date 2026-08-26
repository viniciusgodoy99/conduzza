"use client";

import { Check, FileUp } from "lucide-react";
import { useRef, useState } from "react";

import { PassoConsentimento } from "@/components/leads/importacao/passo-consentimento";
import {
  MAPEAMENTO_VAZIO,
  PassoMapeamento,
  preMapearColunas,
  type MapeamentoDeColunas,
} from "@/components/leads/importacao/passo-mapeamento";
import { PassoPrevia } from "@/components/leads/importacao/passo-previa";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampoImportavel } from "@/lib/domain/importacao";
import type { OpcaoDeclaracao } from "@/lib/integrations/importar-contatos";
import { parseCsv, type CsvLido } from "@/lib/utils/csv";
import { cn } from "@/lib/utils";

// Assistente de importacao de planilha (Tela 4, tarefa 4.4), em 4 passos:
// arquivo, mapeamento de colunas, declaracao de consentimento (obrigatoria) e
// previa com envio em lotes. Quem abre e a tela de Leads, atras do
// BotaoProtegido; a permissao real e conferida na Server Action.

export type ModalImportacaoProps = {
  aberto: boolean;
  /** Fechamento pedido pela tela; "onFechar" e aceito como sinonimo. */
  aoFechar?: () => void;
  onFechar?: () => void;
  /** Chamado ao fechar depois de qualquer lote gravado: recarregue a lista. */
  aoImportar?: () => void;
  /** Aceito por conveniencia da tela; a Server Action resolve a clinica da sessao. */
  clinicId?: string;
};

const PASSOS = ["Arquivo", "Colunas", "Autorização", "Importar"] as const;

const numero = new Intl.NumberFormat("pt-BR");

export function ModalImportacao({
  aberto,
  aoFechar,
  onFechar,
  aoImportar,
}: ModalImportacaoProps) {
  const [passo, setPasso] = useState(0);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [csv, setCsv] = useState<CsvLido | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [mapeamento, setMapeamento] =
    useState<MapeamentoDeColunas>(MAPEAMENTO_VAZIO);
  const [opcao, setOpcao] = useState<OpcaoDeclaracao | null>(null);
  const [observacao, setObservacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [terminou, setTerminou] = useState(false);
  const gravouAlgo = useRef(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const lerArquivo = (arquivo: File) => {
    setErroArquivo(null);
    setCsv(null);
    setNomeArquivo(arquivo.name);
    const leitor = new FileReader();
    leitor.onerror = () => {
      setErroArquivo(
        "Não foi possível ler o arquivo. Confira se ele abre no computador e tente de novo.",
      );
    };
    leitor.onload = () => {
      const texto = typeof leitor.result === "string" ? leitor.result : "";
      const lido = parseCsv(texto);
      if (lido.linhas.length < 2) {
        setErroArquivo(
          "O arquivo está vazio ou tem só o cabeçalho. Exporte a planilha com os contatos e escolha o arquivo de novo.",
        );
        return;
      }
      setCsv(lido);
      setMapeamento(preMapearColunas(lido.linhas[0] ?? []));
    };
    leitor.readAsText(arquivo);
  };

  const fechar = () => {
    if (ocupado) {
      return;
    }
    setPasso(0);
    setNomeArquivo(null);
    setCsv(null);
    setErroArquivo(null);
    setMapeamento(MAPEAMENTO_VAZIO);
    setOpcao(null);
    setObservacao("");
    setTerminou(false);
    if (gravouAlgo.current) {
      gravouAlgo.current = false;
      aoImportar?.();
    }
    (aoFechar ?? onFechar)?.();
  };

  const podeContinuar =
    passo === 0
      ? csv !== null
      : passo === 1
        ? mapeamento.phone_e164 !== null
        : passo === 2
          ? opcao !== null &&
            (opcao !== "outra" || observacao.trim().length >= 2)
          : false;

  const dicaDoPasso =
    passo === 1 && mapeamento.phone_e164 === null
      ? "Escolha qual coluna traz o telefone para continuar."
      : passo === 2 && opcao === null
        ? "Escolha como estes contatos autorizaram receber mensagens."
        : passo === 2 && opcao === "outra" && observacao.trim().length < 2
          ? "Descreva a origem da autorização para continuar."
          : null;

  const cabecalho = csv?.linhas[0] ?? [];
  const dados = csv ? csv.linhas.slice(1) : [];

  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrindo) => {
        if (!abrindo) {
          fechar();
        }
      }}
    >
      <DialogContent
        className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl"
        showCloseButton={!ocupado}
      >
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Traga os contatos de uma planilha CSV com a autorização de cada um
            registrada.
          </DialogDescription>
        </DialogHeader>

        <ol
          aria-label="Etapas da importação"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {PASSOS.map((rotulo, indice) => (
            <li
              key={rotulo}
              aria-current={indice === passo ? "step" : undefined}
              className="flex items-center gap-1.5"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  indice < passo &&
                    "border-transparent bg-[var(--success-bg)] text-[var(--success-text)]",
                  indice === passo &&
                    "border-primary bg-primary text-primary-foreground",
                  indice > passo && "border-border text-text-tertiary",
                )}
              >
                {indice < passo ? (
                  <Check
                    strokeWidth={2}
                    className="size-3.5"
                    aria-label="concluída"
                  />
                ) : (
                  indice + 1
                )}
              </span>
              <span
                className={cn(
                  "text-sm",
                  indice === passo ? "font-medium" : "text-text-secondary",
                )}
              >
                {rotulo}
              </span>
            </li>
          ))}
        </ol>

        {passo === 0 ? (
          <div className="grid gap-3">
            <input
              ref={inputArquivo}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(evento) => {
                const arquivo = evento.target.files?.[0];
                if (arquivo) {
                  lerArquivo(arquivo);
                }
                evento.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputArquivo.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center hover:bg-muted"
            >
              <FileUp
                strokeWidth={1.5}
                className="size-5 text-text-secondary"
                aria-hidden
              />
              <span className="text-sm font-medium">Escolher arquivo CSV</span>
              <span className="text-xs text-text-secondary">
                Exporte a planilha de contatos como CSV e escolha o arquivo
                aqui.
              </span>
            </button>
            {csv && nomeArquivo ? (
              <div className="rounded-lg border px-3 py-2 text-sm">
                <p className="font-medium">{nomeArquivo}</p>
                <p className="text-text-secondary">
                  {numero.format(csv.linhas.length - 1)}{" "}
                  {csv.linhas.length - 1 === 1
                    ? "linha de contato"
                    : "linhas de contato"}
                  , colunas separadas por{" "}
                  {csv.delimitador === ";" ? "ponto e vírgula" : "vírgula"}. A
                  primeira linha é o cabeçalho.
                </p>
              </div>
            ) : null}
            {erroArquivo ? (
              <p
                role="alert"
                className="text-sm"
                style={{ color: "var(--alert-text)" }}
              >
                {erroArquivo}
              </p>
            ) : null}
          </div>
        ) : null}

        {passo === 1 && csv ? (
          <PassoMapeamento
            cabecalho={cabecalho}
            amostra={csv.linhas[1] ?? []}
            mapeamento={mapeamento}
            aoMudar={(campo: CampoImportavel, indice: number | null) =>
              setMapeamento((anterior) => ({ ...anterior, [campo]: indice }))
            }
          />
        ) : null}

        {passo === 2 ? (
          <PassoConsentimento
            opcao={opcao}
            observacao={observacao}
            aoEscolher={setOpcao}
            aoMudarObservacao={setObservacao}
          />
        ) : null}

        {passo === 3 && csv && opcao ? (
          <PassoPrevia
            cabecalho={cabecalho}
            linhas={dados}
            mapeamento={mapeamento}
            declaracao={{
              opcao,
              ...(observacao.trim() !== ""
                ? { observacao: observacao.trim() }
                : {}),
            }}
            aoOcupado={setOcupado}
            aoGravarLote={() => {
              gravouAlgo.current = true;
            }}
            aoTerminar={() => setTerminou(true)}
          />
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div className="min-h-5 text-xs text-text-secondary">
            {passo < 3 && !podeContinuar && dicaDoPasso ? dicaDoPasso : null}
          </div>
          <div className="flex items-center gap-2">
            {passo > 0 && !terminou ? (
              <Button
                variant="outline"
                className="h-10"
                disabled={ocupado}
                onClick={() => setPasso((atual) => Math.max(0, atual - 1))}
              >
                Voltar
              </Button>
            ) : null}
            {passo < 3 ? (
              <Button
                className="h-10"
                disabled={!podeContinuar}
                onClick={() => setPasso((atual) => Math.min(3, atual + 1))}
              >
                Continuar
              </Button>
            ) : null}
            {terminou ? (
              <Button className="h-10" onClick={fechar}>
                Fechar
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
