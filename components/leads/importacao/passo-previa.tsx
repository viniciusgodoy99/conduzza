"use client";

import {
  CircleCheck,
  CircleX,
  Download,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { importarContatosAction } from "@/app/(app)/leads/actions";
import type { MapeamentoDeColunas } from "@/components/leads/importacao/passo-mapeamento";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  dividirEmLotes,
  validarLinha,
  type LinhaImportada,
} from "@/lib/domain/importacao";
import type { DeclaracaoDeConsentimento } from "@/lib/integrations/importar-contatos";
import { baixarCsv, gerarCsv } from "@/lib/utils/csv";

// Passo 4 da importacao: previa das linhas validadas e o envio em lotes de
// 500 pela importarContatosAction, com progresso real, retomada do lote que
// falhou e download das linhas rejeitadas.

const TAMANHO_DO_LOTE = 500;
const LINHAS_NA_PREVIA = 20;

const numero = new Intl.NumberFormat("pt-BR");

type LinhaInvalida = { numeroDaLinha: number; colunas: string[]; motivo: string };

type Totais = {
  importados: number;
  atualizados: number;
  mantidos_sem_autorizacao: number;
  pulados: number;
};

const TOTAIS_ZERADOS: Totais = {
  importados: 0,
  atualizados: 0,
  mantidos_sem_autorizacao: 0,
  pulados: 0,
};

type Fase =
  | { etapa: "pronto" }
  | { etapa: "importando"; enviados: number }
  | { etapa: "erro"; loteIndice: number; enviados: number; mensagem: string }
  | { etapa: "concluido"; totais: Totais };

export function PassoPrevia({
  cabecalho,
  linhas,
  mapeamento,
  declaracao,
  aoOcupado,
  aoGravarLote,
  aoTerminar,
}: {
  cabecalho: string[];
  /** Linhas de dados do CSV, sem o cabecalho. */
  linhas: string[][];
  mapeamento: MapeamentoDeColunas;
  declaracao: DeclaracaoDeConsentimento;
  /** Avisa o modal para travar o fechamento enquanto grava. */
  aoOcupado: (ocupado: boolean) => void;
  /** Chamado a cada lote gravado: a tela de Leads precisa recarregar. */
  aoGravarLote: () => void;
  /** Chamado quando todos os lotes terminaram. */
  aoTerminar: () => void;
}) {
  const [fase, setFase] = useState<Fase>({ etapa: "pronto" });
  const totaisRef = useRef<Totais>(TOTAIS_ZERADOS);

  const { validas, invalidas, repetidas } = useMemo(() => {
    const validasPorTelefone = new Map<string, LinhaImportada>();
    const linhasInvalidas: LinhaInvalida[] = [];
    let linhasRepetidas = 0;
    linhas.forEach((colunas, indice) => {
      const resultado = validarLinha(colunas, mapeamento);
      if (!resultado.ok) {
        linhasInvalidas.push({
          // +2: a linha 1 da planilha e o cabecalho e o indice comeca em 0.
          numeroDaLinha: indice + 2,
          colunas,
          motivo: resultado.motivo,
        });
        return;
      }
      if (validasPorTelefone.has(resultado.linha.phone_e164)) {
        linhasRepetidas += 1;
        return;
      }
      validasPorTelefone.set(resultado.linha.phone_e164, resultado.linha);
    });
    return {
      validas: [...validasPorTelefone.values()],
      invalidas: linhasInvalidas,
      repetidas: linhasRepetidas,
    };
  }, [linhas, mapeamento]);

  const lotes = useMemo(
    () => dividirEmLotes(validas, TAMANHO_DO_LOTE),
    [validas],
  );

  const importarDesde = async (indiceInicial: number) => {
    if (indiceInicial === 0) {
      totaisRef.current = TOTAIS_ZERADOS;
    }
    aoOcupado(true);
    let enviados = 0;
    for (let i = 0; i < indiceInicial; i += 1) {
      enviados += lotes[i]?.length ?? 0;
    }
    setFase({ etapa: "importando", enviados });
    for (let i = indiceInicial; i < lotes.length; i += 1) {
      const lote = lotes[i];
      if (!lote) {
        break;
      }
      const resultado = await importarContatosAction({ declaracao, lote });
      if (!resultado.ok) {
        setFase({
          etapa: "erro",
          loteIndice: i,
          enviados,
          mensagem: resultado.error ?? "Não foi possível gravar este lote.",
        });
        aoOcupado(false);
        return;
      }
      totaisRef.current = {
        importados: totaisRef.current.importados + resultado.importados,
        atualizados: totaisRef.current.atualizados + resultado.atualizados,
        mantidos_sem_autorizacao:
          totaisRef.current.mantidos_sem_autorizacao +
          resultado.mantidos_sem_autorizacao,
        pulados: totaisRef.current.pulados + resultado.pulados,
      };
      aoGravarLote();
      enviados += lote.length;
      setFase({ etapa: "importando", enviados });
    }
    setFase({ etapa: "concluido", totais: totaisRef.current });
    aoOcupado(false);
    aoTerminar();
  };

  const baixarRejeitadas = () => {
    const corpo = invalidas.map((linha) => [
      String(linha.numeroDaLinha),
      linha.motivo,
      ...cabecalho.map((_, i) => linha.colunas[i] ?? ""),
    ]);
    baixarCsv(
      "linhas-rejeitadas.csv",
      gerarCsv([["Linha", "Motivo", ...cabecalho], ...corpo]),
    );
  };

  if (fase.etapa === "concluido") {
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleCheck
              strokeWidth={1.5}
              className="size-4 shrink-0"
              style={{ color: "var(--success)" }}
              aria-hidden
            />
            Importação concluída
          </p>
          <dl className="grid gap-1 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-text-secondary">Contatos novos</dt>
              <dd className="font-medium">
                {numero.format(fase.totais.importados)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-text-secondary">Contatos atualizados</dt>
              <dd className="font-medium">
                {numero.format(fase.totais.atualizados)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-text-secondary">Linhas inválidas</dt>
              <dd className="font-medium">{numero.format(invalidas.length)}</dd>
            </div>
          </dl>
          {fase.totais.pulados > 0 ? (
            <p className="text-xs text-text-secondary">
              {numero.format(fase.totais.pulados)}{" "}
              {fase.totais.pulados === 1
                ? "contato já tinha autorização e foi mantido"
                : "contatos já tinham autorização e foram mantidos"}{" "}
              como estava.
            </p>
          ) : null}
          {fase.totais.mantidos_sem_autorizacao > 0 ? (
            <div
              role="note"
              className="grid gap-1 rounded-lg border px-3 py-2.5"
              style={{
                borderColor: "var(--warning)",
                backgroundColor: "var(--warning-bg)",
                color: "var(--warning-text)",
              }}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <TriangleAlert
                  strokeWidth={1.5}
                  className="size-4 shrink-0"
                  aria-hidden
                />
                {numero.format(fase.totais.mantidos_sem_autorizacao)}{" "}
                {fase.totais.mantidos_sem_autorizacao === 1
                  ? "pessoa pediu para não receber mensagens"
                  : "pessoas pediram para não receber mensagens"}
              </p>
              <p className="text-xs">
                Os dados entraram, mas elas continuam sem autorização e nenhum
                envio automático as alcança. Para voltar a enviar, abra a ficha
                e registre como a pessoa autorizou de novo.
              </p>
            </div>
          ) : null}
        </div>
        {invalidas.length > 0 ? (
          <Button
            variant="outline"
            className="h-10 w-fit"
            onClick={baixarRejeitadas}
          >
            <Download strokeWidth={1.5} className="size-4" /> Baixar rejeitados
          </Button>
        ) : null}
      </div>
    );
  }

  if (fase.etapa === "importando") {
    const percentual =
      validas.length === 0
        ? 0
        : Math.round((fase.enviados / validas.length) * 100);
    return (
      <div role="status" className="grid gap-2 py-6">
        <div className="flex items-center justify-between text-sm">
          <span>Importando contatos, não feche esta janela.</span>
          <span className="font-medium tabular-nums">
            {numero.format(fase.enviados)} de {numero.format(validas.length)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percentual}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <CircleCheck
            strokeWidth={1.5}
            className="size-4 shrink-0"
            style={{ color: "var(--success)" }}
            aria-hidden
          />
          <span>
            {numero.format(validas.length)}{" "}
            {validas.length === 1
              ? "contato pronto para importar"
              : "contatos prontos para importar"}
          </span>
        </span>
        {invalidas.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <CircleX
              strokeWidth={1.5}
              className="size-4 shrink-0"
              style={{ color: "var(--alert)" }}
              aria-hidden
            />
            <span>
              {numero.format(invalidas.length)}{" "}
              {invalidas.length === 1 ? "linha inválida" : "linhas inválidas"}
            </span>
          </span>
        ) : null}
      </div>
      {repetidas > 0 ? (
        <p className="text-xs text-text-secondary">
          {numero.format(repetidas)}{" "}
          {repetidas === 1
            ? "linha repetia um telefone e foi unida"
            : "linhas repetiam telefones e foram unidas"}{" "}
          à primeira.
        </p>
      ) : null}

      {validas.length === 0 ? (
        <p role="alert" className="text-sm" style={{ color: "var(--alert-text)" }}>
          Nenhuma linha válida para importar. Volte e confira se a coluna de
          telefone está certa.
        </p>
      ) : (
        <>
          <div className="max-h-64 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Convênio</TableHead>
                  <TableHead>Campanha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {validas.slice(0, LINHAS_NA_PREVIA).map((linha) => (
                  <TableRow key={linha.phone_e164}>
                    <TableCell className="font-medium">
                      {linha.name ?? ""}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {linha.phone_e164}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {linha.email ?? ""}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {linha.insurance_name ?? ""}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {linha.source_campaign ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {validas.length > LINHAS_NA_PREVIA ? (
            <p className="text-xs text-text-secondary">
              Mostrando as primeiras {LINHAS_NA_PREVIA} de{" "}
              {numero.format(validas.length)} linhas válidas.
            </p>
          ) : null}
        </>
      )}

      {fase.etapa === "erro" ? (
        <div
          role="alert"
          className="grid gap-1 rounded-lg border px-3 py-2.5"
          style={{
            borderColor: "var(--alert)",
            backgroundColor: "var(--alert-bg)",
            color: "var(--alert-text)",
          }}
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <CircleX strokeWidth={1.5} className="size-4 shrink-0" aria-hidden />
            {fase.mensagem}
          </p>
          <p className="text-xs">
            {numero.format(fase.enviados)} de {numero.format(validas.length)}{" "}
            contatos já foram gravados. O restante espera este lote.
          </p>
        </div>
      ) : null}

      <div className="flex justify-end">
        {fase.etapa === "erro" ? (
          <Button
            variant="outline"
            className="h-10"
            onClick={() => importarDesde(fase.loteIndice)}
          >
            <RotateCcw strokeWidth={1.5} className="size-4" /> Tentar o lote de
            novo
          </Button>
        ) : (
          <Button
            className="h-10"
            disabled={validas.length === 0}
            onClick={() => importarDesde(0)}
          >
            <Upload strokeWidth={1.5} className="size-4" /> Importar{" "}
            {numero.format(validas.length)}{" "}
            {validas.length === 1 ? "contato" : "contatos"}
          </Button>
        )}
      </div>
    </div>
  );
}
