"use client";

import {
  CircleCheck,
  Download,
  OctagonAlert,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { importarContatosAction } from "@/app/(app)/leads/actions";
import { EscolhaImportarComo } from "@/components/leads/importacao/escolha-importar-como";
import type { MapeamentoDeColunas } from "@/components/leads/importacao/passo-mapeamento";
import { Aviso } from "@/components/shared/aviso";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
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
import { chaveDeTelefone, formatarTelefone } from "@/lib/domain/telefone";
import type {
  DeclaracaoDeConsentimento,
  ImportarComo,
} from "@/lib/integrations/importar-contatos";
import { baixarCsv, gerarCsv } from "@/lib/utils/csv";

// Passo 4 da importacao: previa das linhas validadas e o envio em lotes de
// 500 pela importarContatosAction, com progresso real, retomada do lote que
// falhou e download das linhas rejeitadas.
//
// Linhas repetidas sao contadas pela CHAVE do telefone (lib/domain/telefone):
// "(84) 98812-3456" e "8488123456" sao a mesma pessoa, e o servidor ja une as
// duas pela chave; contar por texto exato prometia dois contatos onde entra
// um so.
//
// A previa diz que a importacao NAO inscreve ninguem em follow-up (decisao
// do dono de 24/09/2026): o planejador ignora o relogio de etapa de quem
// nasceu pela planilha, ate alguem mudar a etapa do contato.
//
// "Importar como" (20/10/2026) mora aqui, junto do botao que grava: Leads,
// como sempre, ou Pacientes. A escolha vai em todo lote e trava assim que o
// primeiro sai; o resumo diz quantos viraram pacientes.

const TAMANHO_DO_LOTE = 500;
const LINHAS_NA_PREVIA = 20;

const numero = new Intl.NumberFormat("pt-BR");

type LinhaInvalida = {
  numeroDaLinha: number;
  colunas: string[];
  motivo: string;
};

/** O que os lotes gravaram, somado (o resumo do fim da importacao). */
export type TotaisDaImportacao = {
  importados: number;
  atualizados: number;
  viraram_pacientes: number;
  ja_eram_pacientes: number;
  mantidos_sem_autorizacao: number;
  pulados: number;
};

type Totais = TotaisDaImportacao;

const TOTAIS_ZERADOS: Totais = {
  importados: 0,
  atualizados: 0,
  viraram_pacientes: 0,
  ja_eram_pacientes: 0,
  mantidos_sem_autorizacao: 0,
  pulados: 0,
};

type Fase =
  | { etapa: "pronto" }
  | { etapa: "importando"; enviados: number }
  | { etapa: "erro"; loteIndice: number; enviados: number; mensagem: string }
  | { etapa: "concluido"; totais: Totais; importarComo: ImportarComo };

export function PassoPrevia({
  cabecalho,
  linhas,
  mapeamento,
  declaracao,
  importarComo = "leads",
  aoMudarImportarComo,
  recodificado = false,
  aoOcupado,
  aoGravarLote,
  aoTerminar,
}: {
  cabecalho: string[];
  /** Linhas de dados do CSV, sem o cabecalho. */
  linhas: string[][];
  mapeamento: MapeamentoDeColunas;
  declaracao: DeclaracaoDeConsentimento;
  /** "Importar como": Leads (padrao) ou Pacientes. */
  importarComo?: ImportarComo;
  /** Sem ele, a escolha nao aparece e a importacao vai como Leads. */
  aoMudarImportarComo?: (valor: ImportarComo) => void;
  /** O arquivo nao era UTF-8 e foi lido como Windows-1252 (Excel pt-BR) */
  recodificado?: boolean;
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
      const chave = chaveDeTelefone(resultado.linha.phone_e164);
      if (validasPorTelefone.has(chave)) {
        linhasRepetidas += 1;
        return;
      }
      validasPorTelefone.set(chave, resultado.linha);
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
      const resultado = await importarContatosAction({
        declaracao,
        lote,
        importar_como: importarComo,
      });
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
        viraram_pacientes:
          totaisRef.current.viraram_pacientes + resultado.viraram_pacientes,
        ja_eram_pacientes:
          totaisRef.current.ja_eram_pacientes + resultado.ja_eram_pacientes,
        mantidos_sem_autorizacao:
          totaisRef.current.mantidos_sem_autorizacao +
          resultado.mantidos_sem_autorizacao,
        pulados: totaisRef.current.pulados + resultado.pulados,
      };
      aoGravarLote();
      enviados += lote.length;
      setFase({ etapa: "importando", enviados });
    }
    setFase({ etapa: "concluido", totais: totaisRef.current, importarComo });
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
      <ResumoDaImportacao
        totais={fase.totais}
        importarComo={fase.importarComo}
        invalidas={invalidas.length}
        aoBaixarRejeitadas={baixarRejeitadas}
      />
    );
  }

  if (fase.etapa === "importando") {
    return (
      <div role="status" className="py-6">
        <BarraDeProgresso
          valor={fase.enviados}
          maximo={validas.length}
          rotulo="Importando contatos, não feche esta janela."
          legenda={`${numero.format(fase.enviados)} de ${numero.format(validas.length)}`}
          ariaLabel={`${fase.enviados} de ${validas.length} contatos importados`}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] font-medium text-text-strong">
        <span className="flex items-center gap-1.5">
          <CircleCheck
            className="size-4 shrink-0 text-success-text"
            aria-hidden
          />
          <span>
            <span className="cz-num">{numero.format(validas.length)}</span>{" "}
            {validas.length === 1
              ? "contato pronto para importar"
              : "contatos prontos para importar"}
          </span>
        </span>
        {invalidas.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <OctagonAlert
              className="size-4 shrink-0 text-alert-text"
              aria-hidden
            />
            <span>
              <span className="cz-num">{numero.format(invalidas.length)}</span>{" "}
              {invalidas.length === 1 ? "linha inválida" : "linhas inválidas"}
            </span>
          </span>
        ) : null}
      </div>
      {repetidas > 0 ? (
        <p className="text-xs text-text-secondary">
          <span className="cz-num">{numero.format(repetidas)}</span>{" "}
          {repetidas === 1
            ? "linha repetia um telefone e foi unida"
            : "linhas repetiam telefones e foram unidas"}{" "}
          à primeira.
        </p>
      ) : null}

      {validas.length === 0 ? (
        <Aviso tom="alert" role="alert">
          Nenhuma linha válida para importar. Volte e confira se a coluna de
          telefone está certa.
        </Aviso>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table containerClassName="max-h-64">
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
                  <TableRow key={chaveDeTelefone(linha.phone_e164)}>
                    <TableCell className="font-semibold text-text-strong">
                      {linha.name ?? ""}
                    </TableCell>
                    <TableCell className="cz-num whitespace-nowrap">
                      {formatarTelefone(linha.phone_e164)}
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
              Mostrando as primeiras{" "}
              <span className="cz-num">{LINHAS_NA_PREVIA}</span> de{" "}
              <span className="cz-num">{numero.format(validas.length)}</span>{" "}
              linhas válidas.
            </p>
          ) : null}
          {recodificado ? (
            <Aviso tom="info" role="note">
              O arquivo não estava em UTF-8 e foi lido como planilha do Excel em
              português. Confira se os acentos dos nomes acima estão certos
              antes de importar.
            </Aviso>
          ) : null}
          <Aviso tom="info" role="note" titulo="Sem follow-up automático">
            Os contatos importados não recebem as réguas de follow-up só por
            terem entrado pela planilha. A régua de uma etapa começa para eles
            quando alguém mudar a etapa do contato.
          </Aviso>
          {aoMudarImportarComo ? (
            <EscolhaImportarComo
              valor={importarComo}
              aoEscolher={aoMudarImportarComo}
              // Um lote ja gravado (erro no meio): o resto vai do mesmo jeito.
              travado={fase.etapa !== "pronto"}
            />
          ) : null}
        </>
      )}

      {fase.etapa === "erro" ? (
        <Aviso tom="alert" role="alert" titulo={fase.mensagem}>
          <span className="cz-num">{numero.format(fase.enviados)}</span> de{" "}
          <span className="cz-num">{numero.format(validas.length)}</span>{" "}
          contatos já foram gravados. O restante espera este lote.
        </Aviso>
      ) : null}

      <div className="flex justify-end">
        {fase.etapa === "erro" ? (
          <Button
            variant="outline"
            onClick={() => importarDesde(fase.loteIndice)}
          >
            <RotateCcw className="size-4" /> Tentar o lote de novo
          </Button>
        ) : (
          <Button
            disabled={validas.length === 0}
            onClick={() => importarDesde(0)}
          >
            <Upload className="size-4" /> Importar{" "}
            {numero.format(validas.length)}{" "}
            {validas.length === 1 ? "contato" : "contatos"}
            {importarComo === "pacientes" ? " como pacientes" : null}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * O resumo do fim da importacao, so apresentacao: contatos novos,
 * atualizados, quantos viraram pacientes (importando como Pacientes), as
 * linhas invalidas, quem ja tinha autorizacao e quem pediu para nao receber.
 */
export function ResumoDaImportacao({
  totais,
  importarComo,
  invalidas,
  aoBaixarRejeitadas,
}: {
  totais: TotaisDaImportacao;
  importarComo: ImportarComo;
  /** Quantas linhas da planilha foram rejeitadas na previa. */
  invalidas: number;
  aoBaixarRejeitadas: () => void;
}) {
  // Importando como Pacientes: os novos nasceram pacientes e os leads que
  // ja existiam viraram; quem ja era paciente continuou.
  const viraramPacientes =
    importarComo === "pacientes"
      ? totais.importados + totais.viraram_pacientes
      : 0;
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded-card border border-border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 text-base font-bold text-text-strong">
          <CircleCheck
            className="size-[18px] shrink-0 text-success-text"
            aria-hidden
          />
          Importação concluída
        </p>
        <dl className="grid gap-1.5 text-[13px]">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-text-secondary">Contatos novos</dt>
            <dd className="cz-num font-semibold text-text-strong">
              {numero.format(totais.importados)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-text-secondary">Contatos atualizados</dt>
            <dd className="cz-num font-semibold text-text-strong">
              {numero.format(totais.atualizados)}
            </dd>
          </div>
          {importarComo === "pacientes" ? (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-text-secondary">Viraram pacientes</dt>
              <dd className="cz-num font-semibold text-text-strong">
                {numero.format(viraramPacientes)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <dt className="text-text-secondary">Linhas inválidas</dt>
            <dd className="cz-num font-semibold text-text-strong">
              {numero.format(invalidas)}
            </dd>
          </div>
        </dl>
        {importarComo === "pacientes" ? (
          <p className="text-xs text-text-secondary">
            {viraramPacientes > 0
              ? `${
                  viraramPacientes === 1
                    ? "O contato já aparece em Pacientes"
                    : "Os contatos já aparecem em Pacientes"
                }, sem mudar de etapa no funil.`
              : "Nenhum contato mudou para paciente nesta importação."}
            {totais.ja_eram_pacientes > 0
              ? ` ${numero.format(totais.ja_eram_pacientes)} ${
                  totais.ja_eram_pacientes === 1
                    ? "contato já era paciente e continuou como estava"
                    : "contatos já eram pacientes e continuaram como estavam"
                }.`
              : null}
          </p>
        ) : null}
        {totais.pulados > 0 ? (
          <p className="text-xs text-text-secondary">
            <span className="cz-num">{numero.format(totais.pulados)}</span>{" "}
            {totais.pulados === 1
              ? "contato já tinha autorização e foi mantido"
              : "contatos já tinham autorização e foram mantidos"}{" "}
            como estava.
          </p>
        ) : null}
        {totais.mantidos_sem_autorizacao > 0 ? (
          <Aviso
            tom="warning"
            role="note"
            titulo={`${numero.format(totais.mantidos_sem_autorizacao)} ${
              totais.mantidos_sem_autorizacao === 1
                ? "pessoa pediu para não receber mensagens"
                : "pessoas pediram para não receber mensagens"
            }`}
          >
            Os dados entraram, mas elas continuam sem autorização e nenhum envio
            automático as alcança. Para voltar a enviar, abra a ficha e registre
            como a pessoa autorizou de novo.
          </Aviso>
        ) : null}
      </div>
      {invalidas > 0 ? (
        <Button
          variant="outline"
          className="w-fit"
          onClick={aoBaixarRejeitadas}
        >
          <Download className="size-4" /> Baixar rejeitados
        </Button>
      ) : null}
    </div>
  );
}
