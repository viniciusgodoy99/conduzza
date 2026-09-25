"use client";

import { Check, FileSpreadsheet, FileUp } from "lucide-react";
import { useRef, useState } from "react";

import { decodificarCsv } from "@/components/leads/importacao/decodificar-csv";
import { PassoConsentimento } from "@/components/leads/importacao/passo-consentimento";
import {
  MAPEAMENTO_VAZIO,
  PassoMapeamento,
  preMapearColunas,
  type MapeamentoDeColunas,
} from "@/components/leads/importacao/passo-mapeamento";
import { PassoPrevia } from "@/components/leads/importacao/passo-previa";
import { Aviso } from "@/components/shared/aviso";
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
//
// O arquivo e lido em bytes e decodificado aqui (achado 101 da revisao): o
// CSV do Excel em portugues vem em Windows-1252, e ler como UTF-8 quebrava os
// acentos sem aviso. Quando o arquivo nao e UTF-8, a tela diz que leu como
// Excel e pede para conferir os nomes na previa.

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
  const [recodificado, setRecodificado] = useState(false);
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
    setRecodificado(false);
    setNomeArquivo(arquivo.name);
    arquivo
      .arrayBuffer()
      .then((bytes) => {
        const { texto, recodificado: foiRecodificado } = decodificarCsv(bytes);
        const lido = parseCsv(texto);
        if (lido.linhas.length < 2) {
          setErroArquivo(
            "O arquivo está vazio ou tem só o cabeçalho. Exporte a planilha com os contatos e escolha o arquivo de novo.",
          );
          return;
        }
        setCsv(lido);
        setRecodificado(foiRecodificado);
        setMapeamento(preMapearColunas(lido.linhas[0] ?? []));
      })
      .catch(() => {
        setErroArquivo(
          "Não foi possível ler o arquivo. Confira se ele abre no computador e tente de novo.",
        );
      });
  };

  const fechar = () => {
    if (ocupado) {
      return;
    }
    setPasso(0);
    setNomeArquivo(null);
    setCsv(null);
    setRecodificado(false);
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
      <DialogContent className="sm:max-w-[640px]" showCloseButton={!ocupado}>
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Traga os contatos de uma planilha CSV com a autorização de cada um
            registrada.
          </DialogDescription>
        </DialogHeader>

        <ol
          aria-label="Etapas da importação"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          {PASSOS.map((rotulo, indice) => (
            <li
              key={rotulo}
              aria-current={indice === passo ? "step" : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full cz-num text-xs font-bold",
                  indice < passo && "bg-success-bg text-success-text",
                  indice === passo && "bg-primary text-primary-foreground",
                  indice > passo && "border border-input text-text-secondary",
                )}
              >
                {indice < passo ? (
                  <Check className="size-3.5" aria-label="concluída" />
                ) : (
                  indice + 1
                )}
              </span>
              <span
                className={cn(
                  "text-[13px]",
                  indice === passo
                    ? "font-bold text-text-strong"
                    : "font-medium text-text-secondary",
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
              className="flex flex-col items-center justify-center gap-2.5 rounded-card border border-dashed border-input bg-surface-subtle px-6 py-8 text-center outline-none cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              <span className="grid size-[52px] place-items-center rounded-card bg-primary-soft">
                <FileUp className="size-6 text-primary-text" aria-hidden />
              </span>
              <span className="text-sm font-bold text-text-strong">
                Escolher arquivo CSV
              </span>
              <span className="max-w-[44ch] text-[13px] text-text-secondary">
                Exporte a planilha de contatos como CSV e escolha o arquivo
                aqui.
              </span>
            </button>
            {csv && nomeArquivo ? (
              <div className="flex items-start gap-3 rounded-xl bg-surface-4 p-3.5">
                <FileSpreadsheet
                  className="mt-0.5 size-[18px] shrink-0 text-text-secondary"
                  aria-hidden
                />
                <div className="grid min-w-0 gap-0.5 text-[13px]">
                  <p className="truncate font-semibold text-text-strong">
                    {nomeArquivo}
                  </p>
                  <p className="text-text-secondary">
                    <span className="cz-num">
                      {numero.format(csv.linhas.length - 1)}
                    </span>{" "}
                    {csv.linhas.length - 1 === 1
                      ? "linha de contato"
                      : "linhas de contato"}
                    , colunas separadas por{" "}
                    {csv.delimitador === ";" ? "ponto e vírgula" : "vírgula"}. A
                    primeira linha é o cabeçalho.
                  </p>
                </div>
              </div>
            ) : null}
            {csv && recodificado ? (
              <Aviso tom="info" role="note">
                O arquivo não estava em UTF-8 e foi lido como planilha do Excel
                em português. Confira se os acentos dos nomes aparecem certos na
                prévia.
              </Aviso>
            ) : null}
            {erroArquivo ? (
              <Aviso tom="alert" role="alert">
                {erroArquivo}
              </Aviso>
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
            recodificado={recodificado}
            aoOcupado={setOcupado}
            aoGravarLote={() => {
              gravouAlgo.current = true;
            }}
            aoTerminar={() => setTerminou(true)}
          />
        ) : null}

        <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle px-5 py-3.5">
          <div className="min-h-5 flex-1 text-xs text-text-secondary">
            {passo < 3 && !podeContinuar && dicaDoPasso ? dicaDoPasso : null}
          </div>
          <div className="flex items-center gap-2">
            {passo > 0 && !terminou ? (
              <Button
                variant="outline"
                disabled={ocupado}
                onClick={() => setPasso((atual) => Math.max(0, atual - 1))}
              >
                Voltar
              </Button>
            ) : null}
            {passo < 3 ? (
              <Button
                disabled={!podeContinuar}
                onClick={() => setPasso((atual) => Math.min(3, atual + 1))}
              >
                Continuar
              </Button>
            ) : null}
            {terminou ? <Button onClick={fechar}>Fechar</Button> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
