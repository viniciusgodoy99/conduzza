"use client";

import { ArrowDown, ArrowUp, ChevronDown, Pencil, Trash2 } from "lucide-react";

import { AbaRegua } from "@/components/automacoes/aba-regua";
import type { NumerosDasAutomaticas } from "@/components/automacoes/numeros-de-envio";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { REGUA_STATUS } from "@/lib/design/status";
import type { TonsDasEtiquetas } from "@/lib/domain/etiquetas-do-lead";
import {
  avisoAoDesligar,
  avisoDeLigadaSemMensagem,
  DICA_PARA_LIGAR_SEM_MENSAGEM,
  ehReguaGeral,
  textoDeParaQuem,
} from "@/lib/domain/reguas-de-followup";
import type { ReguaDeFollowup } from "@/lib/queries/automacoes";
import { cn } from "@/lib/utils";

import { ChipsDasEtiquetas } from "./etiquetas-da-regua";

// Uma regua de follow-up num cartao com cabecalho de acordeao (docs/06
// secao 5.10): o nome, os chips das etiquetas (o nome sempre escrito e o
// tom do catalogo) com "qualquer uma" ou "todas", ou "Régua geral", e a
// situacao em 3 camadas (REGUA_STATUS). Fora do botao do acordeao, Subir e
// Descer (so nas com etiqueta: a ordem decide quem vale, D2) e Excluir.
// Aberto: o "Para quem" com o botao de editar, as contagens de hoje (quem
// recebe, quem tem as etiquetas, quem esta sem autorizacao) e o editor de
// sempre (AbaRegua, com o Testar por passo).

export type OrdemDaRegua = {
  podeSubir: boolean;
  podeDescer: boolean;
  aoSubir: () => void;
  aoDescer: () => void;
};

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-card px-3 py-2">
      <dt className="text-[11px] text-text-secondary">{rotulo}</dt>
      <dd className="cz-num text-lg font-bold text-text-strong">{valor}</dd>
    </div>
  );
}

export function CartaoDaRegua({
  regua,
  aberta,
  aoAlternar,
  ordem,
  tons,
  clinicId,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  numeros,
  pendente,
  aoEditarParaQuem,
  aoExcluir,
  aoMudar,
}: {
  regua: ReguaDeFollowup;
  aberta: boolean;
  aoAlternar: () => void;
  /** So nas com etiqueta: a ordem entre elas */
  ordem: OrdemDaRegua | null;
  tons: TonsDasEtiquetas;
  clinicId: string;
  nomeDaClinica: string;
  precoCents: number | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ehAdministrador: boolean;
  numeros: NumerosDasAutomaticas | null;
  pendente: boolean;
  aoEditarParaQuem: () => void;
  aoExcluir: () => void;
  aoMudar: () => Promise<unknown> | void;
}) {
  const geral = ehReguaGeral(regua);
  const idConteudo = `followup-${regua.id}`;
  const alcance = regua.alcance;
  // A com etiqueta so liga com mensagem (a action recusa do mesmo jeito):
  // ligada e vazia, os leads dela ficariam sem follow-up, nem a geral.
  const semMensagem = !geral && regua.passos.length === 0;

  const comDica = (controle: React.ReactNode, dica: string | null) =>
    dica ? (
      <DisabledWithHint hint={dica}>{controle}</DisabledWithHint>
    ) : (
      controle
    );

  const botaoSubir = ordem ? (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Subir a régua ${regua.name}`}
      disabled={!podeEditar || pendente || !ordem.podeSubir}
      onClick={ordem.aoSubir}
    >
      <ArrowUp aria-hidden />
    </Button>
  ) : null;
  const botaoDescer = ordem ? (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Descer a régua ${regua.name}`}
      disabled={!podeEditar || pendente || !ordem.podeDescer}
      onClick={ordem.aoDescer}
    >
      <ArrowDown aria-hidden />
    </Button>
  ) : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <button
          type="button"
          aria-expanded={aberta}
          aria-controls={idConteudo}
          onClick={aoAlternar}
          className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-text-secondary transition-transform duration-(--dur-base) motion-reduce:transition-none",
              aberta && "rotate-180",
            )}
            aria-hidden
          />
          <span className="text-[13.5px] font-bold text-text-strong">
            {regua.name}
          </span>
          {geral ? (
            <span className="inline-flex h-6 items-center rounded-sm border border-border-strong bg-card px-2 text-xs font-medium text-foreground">
              Régua geral
            </span>
          ) : (
            <>
              <span className="sr-only">Para leads com</span>
              <ChipsDasEtiquetas etiquetas={regua.etiquetas} tons={tons} />
              {regua.etiquetas.length >= 2 ? (
                <span className="text-xs text-text-secondary">
                  {regua.etiquetas_modo === "todas" ? "todas" : "qualquer uma"}
                </span>
              ) : null}
            </>
          )}
          <StatusChip
            size="sm"
            className="ml-auto"
            definition={REGUA_STATUS[regua.active ? "ligada" : "desligada"]}
          />
        </button>
        {ordem ? (
          <span className="flex items-center">
            {comDica(botaoSubir, podeEditar ? null : dicaSemPermissao)}
            {comDica(botaoDescer, podeEditar ? null : dicaSemPermissao)}
          </span>
        ) : null}
        {podeEditar ? (
          <Button
            variant="destructive"
            aria-label={`Excluir a régua ${regua.name}`}
            disabled={pendente}
            onClick={aoExcluir}
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
      {aberta ? (
        <div id={idConteudo} className="grid gap-4 border-t border-border p-4">
          <section
            aria-label={`Para quem é ${regua.name}`}
            className="grid gap-3 rounded-xl bg-surface-4 p-3.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-0.5">
                <h3 className="text-sm font-bold">Para quem</h3>
                <p className="text-[13px] text-foreground">
                  {textoDeParaQuem(regua)}
                </p>
              </div>
              {comDica(
                <Button
                  variant="outline"
                  disabled={!podeEditar || pendente}
                  onClick={aoEditarParaQuem}
                >
                  <Pencil aria-hidden />
                  Editar para quem
                </Button>,
                podeEditar ? null : dicaSemPermissao,
              )}
            </div>
            {alcance ? (
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Numero rotulo="Recebem hoje" valor={alcance.recebem} />
                <Numero
                  rotulo={geral ? "Na etapa hoje" : "Com as etiquetas hoje"}
                  valor={alcance.casam}
                />
                <Numero
                  rotulo="Sem autorização"
                  valor={alcance.sem_autorizacao}
                />
              </dl>
            ) : (
              <p className="text-xs text-text-secondary">
                Não foi possível contar os leads desta régua agora. Recarregue a
                página para tentar de novo.
              </p>
            )}
            {regua.active && !geral ? (
              <p className="text-xs text-text-secondary">
                <span className="font-semibold">Ao desligar:</span>{" "}
                {avisoAoDesligar(regua)}
              </p>
            ) : null}
          </section>

          {semMensagem && regua.active ? (
            <Aviso tom="warning">{avisoDeLigadaSemMensagem(regua)}</Aviso>
          ) : null}

          {/* Spec 7.6: quem sera pulado por falta de autorizacao */}
          {alcance && alcance.sem_autorizacao > 0 ? (
            <Aviso tom="info">
              <span className="cz-num font-semibold">
                {alcance.sem_autorizacao}
              </span>{" "}
              de <span className="cz-num">{alcance.casam}</span>{" "}
              {alcance.casam === 1 ? "lead" : "leads"} desta régua não{" "}
              {alcance.sem_autorizacao === 1 ? "tem" : "têm"} autorização para
              receber mensagens e{" "}
              {alcance.sem_autorizacao === 1 ? "será pulado" : "serão pulados"}.
            </Aviso>
          ) : null}
          <AbaRegua
            clinicId={clinicId}
            regua={regua}
            copy={{
              ligar: `Ligar a régua ${regua.name}`,
              ligada: "Régua ligada",
              desligada: "Régua desligada",
              inicioDaLinha: "Entrou na etapa",
              fimDaLinha: null,
              vazio: "Esta régua não tem mensagens.",
            }}
            nomeDaClinica={nomeDaClinica}
            estimativa={{
              eventos30d: regua.eventos30d,
              // A conta com as etiquetas so existe com o alcance; sem ele,
              // e a etapa inteira (a ordem de grandeza).
              rotuloDoEvento:
                geral || !alcance
                  ? "leads que entraram na etapa"
                  : "leads com as etiquetas que entraram na etapa",
              rotuloDoEventoSingular:
                geral || !alcance
                  ? "lead que entrou na etapa"
                  : "lead com as etiquetas que entrou na etapa",
              precoCents,
            }}
            sentidoDoPasso="depois"
            tipoDaRegua="followup"
            eventoRotulo="a entrada na etapa"
            placeholders={["nome", "clinica"]}
            podeEditar={podeEditar}
            dicaSemPermissao={dicaSemPermissao}
            dicaParaLigar={semMensagem ? DICA_PARA_LIGAR_SEM_MENSAGEM : null}
            ehAdministrador={ehAdministrador}
            numeros={numeros}
            aninhada
            aoMudar={aoMudar}
          />
        </div>
      ) : null}
    </Card>
  );
}
