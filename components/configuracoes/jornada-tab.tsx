"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  Lock,
  Pencil,
  Plus,
  Route,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  excluirEtapaDaJornadaAction,
  reordenarEtapaDaJornadaAction,
  salvarEtapaDaJornadaAction,
} from "@/app/(app)/configuracoes/actions";
import { DicaDeAjuda } from "@/components/shared/dica-de-ajuda";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CONVERSAO_STATUS,
  STATUS_TONE_VARS,
  type StatusDefinition,
  type StatusTone,
} from "@/lib/design/status";
import {
  AJUDA_QUEM_ESCREVE,
  ICONES_DE_ETAPA,
  LIMITE_DA_DESCRICAO,
  OPCOES_TERMOS_DE_QUEM,
  TERMOS_DE_QUEM,
  ajudaDosTermos,
  definicaoDaEtapa,
  etapaDeSistema,
  normalizarDescricaoDaEtapa,
  resumoDosTermos,
  trocaDeOrdemPermitida,
  type EtapaDaJornada,
  type PapelDeEtapa,
  type TermosDeQuem,
  type TrocaDeOrdem,
} from "@/lib/domain/jornada";
import { rotuloDoEvento } from "@/lib/domain/meta-conversao";
import { centavosParaReais, reaisParaCentavos } from "@/lib/utils/moeda";

// A tela da JORNADA (fase 3 da jornada configuravel): as etapas do funil da
// clinica, no modelo da Jornada de Compra do Tintim. Cada etapa edita nome,
// aparencia, termos-chave e a venda. O evento da Meta morava aqui ate
// 24/11/2026, quando o dono pediu a conversao por etapa dentro de Anuncios e
// rastreio (passo "Conversoes por etapa"); aqui fica so a leitura dele, com o
// link para la. A marca "primeiro contato" saiu da tela no mesmo dia: nao
// mudava numero nenhum (a coluna continua no banco, intocada).
//
// Papel de sistema (entrada, aguardando, em_contato, agendou, compareceu,
// perdido) aparece com o chip de cadeado, e a explicacao fica na dica dele
// (26/11/2026: tela que mostra e nao explica; o rodape com a mesma regra
// saiu): renomeia e reordena, nunca exclui. Quem garante isso e gatilho no
// banco; a tela so evita oferecer o que vai ser recusado. Aguardando resposta e Em contato viraram etapas de
// sistema na onda 3 (21/10/2026, migration 20261023100000); antes dela as
// duas chegam sem papel e a tela as trata como livres (sem cadeado, com
// Excluir), menos na ordem: Em contato ja nao passa de Novo nem de Agendou
// (revisao de 21/10/2026; a migration preserva a ordem dela).
//
// Ordem fixa (decisao D6 do dono, 21/10/2026): Novo, Aguardando resposta, Em
// contato, Agendou e Compareceu nao trocam de lugar entre si. A seta que
// faria essa troca fica visivel e desabilitada, com a dica dizendo a ordem
// com os nomes da clinica (trocaDeOrdemPermitida, lib/domain/jornada.ts); a
// action confere o mesmo antes da RPC, e o banco recusa (a RPC e o gatilho
// conferir_ordem_da_jornada). Perdido e as etapas livres vao para qualquer
// lugar.
//
// Desenho do design system (docs/06 secao 5.12): cada etapa e uma linha
// afundada; a aberta vira cartao com o formulario. A marca de venda e
// Checkbox, porque so vale quando se clica em Salvar (C31).
//
// 02/10/2026 (pedido do dono): cada etapa ganha "Quem escreve o termo"
// (paciente, clinica ou qualquer um) e uma descricao curta, que o Kanban
// mostra abaixo do nome da coluna. Os textos que dependem de quem escreve
// moram em lib/domain/jornada.ts, testados em unidade.

const ETAPA_DE_SISTEMA: StatusDefinition = {
  label: "Sistema",
  tone: "neutral",
  icon: Lock,
};

/** A situacao da conversao da etapa, em 3 camadas (CONVERSAO_STATUS). */
function chipDaConversao(etapa: EtapaDaJornada): {
  definicao: StatusDefinition;
  rotulo: string;
} {
  if (!etapa.meta_event_name) {
    return {
      definicao: CONVERSAO_STATUS.sem,
      rotulo: CONVERSAO_STATUS.sem.label,
    };
  }
  const evento = rotuloDoEvento(etapa.meta_event_name);
  return etapa.conversao_ativa
    ? { definicao: CONVERSAO_STATUS.ativa, rotulo: `Envia ${evento}` }
    : {
        definicao: CONVERSAO_STATUS.pausada,
        rotulo: `Conversão pausada (${evento})`,
      };
}

const TONS: { valor: StatusTone; rotulo: string }[] = [
  { valor: "neutral", rotulo: "Cinza (neutro)" },
  { valor: "info", rotulo: "Azul (informativo)" },
  { valor: "warning", rotulo: "Âmbar (atenção)" },
  { valor: "success", rotulo: "Verde (sucesso)" },
  { valor: "alert", rotulo: "Vermelho (alerta)" },
];

// A dica do chip "Sistema", uma por papel: o Record fechado faz o typecheck
// cobrar o texto de todo papel novo.
const PAPEL_EXPLICADO: Record<PapelDeEtapa, string> = {
  entrada: "Etapa do sistema: todo contato novo entra aqui",
  aguardando: "Etapa do sistema: lead novo que a IA passou para a equipe",
  em_contato:
    "Etapa do sistema: lead que a equipe assumiu, iniciou, passou ou reabriu",
  agendou: "Etapa do sistema: o contato vem para cá ao agendar",
  compareceu: "Etapa do sistema: o contato vem para cá ao comparecer",
  perdido: "Etapa do sistema: marcar como perdido pede o motivo",
};

/** Sem papel conhecido (cache velho), a dica generica. */
const DICA_DE_SISTEMA = "Etapa do sistema";

/**
 * A dica da marca de venda (Venda pela Jornada, decisao do dono de
 * 23/11/2026): conta em Resultados a partir de quando a etapa esta marcada.
 */
const AJUDA_DA_VENDA =
  "A marca de venda conta em Resultados a partir de quando a etapa está marcada: cada entrada de um contato nela é uma venda, com este valor";

/** O passo da conversao por etapa (Anuncios e rastreio), desde 24/11/2026. */
const LINK_DAS_CONVERSOES = "/configuracoes?aba=rastreio&passo=conversoes";

// Sentinela do estado "criando etapa". Os dois pontos nao existem no alfabeto
// de chave (^[a-z0-9_]+$), entao NENHUMA etapa real pode colidir com ele. A
// primeira versao usava "nova" e uma etapa chamada "Nova" (chave gerada
// "nova") abria dois formularios com o mesmo rascunho, um salvando por cima
// do outro (achado da revisao adversarial de 09/09/2026).
const CRIANDO = ":nova";

// O mesmo teto do Zod da action (termos_chave max 20): a tela para de aceitar
// ANTES de o salvar falhar com mensagem generica.
const MAXIMO_DE_TERMOS = 20;

type Rascunho = {
  nome: string;
  tom: StatusTone;
  icone: string;
  descricao: string;
  termos: string[];
  termosDeQuem: TermosDeQuem;
  termoNovo: string;
  ehVenda: boolean;
  modoDeValor: "sem" | "fixo" | "service_link";
  valorReais: string;
};

function rascunhoDaEtapa(etapa: EtapaDaJornada | null): Rascunho {
  if (!etapa) {
    return {
      nome: "",
      tom: "neutral",
      icone: "circle",
      descricao: "",
      termos: [],
      termosDeQuem: "paciente",
      termoNovo: "",
      ehVenda: false,
      modoDeValor: "sem",
      valorReais: "",
    };
  }
  return {
    nome: etapa.nome,
    tom: etapa.tom,
    icone: etapa.icone in ICONES_DE_ETAPA ? etapa.icone : "circle",
    descricao: etapa.descricao ?? "",
    termos: etapa.termos_chave,
    // Valor fora do catalogo (nao passa no check do banco) volta ao padrao
    // em vez de deixar o campo sem opcao marcada.
    termosDeQuem: (TERMOS_DE_QUEM as readonly string[]).includes(
      etapa.termos_de_quem,
    )
      ? etapa.termos_de_quem
      : "paciente",
    termoNovo: "",
    ehVenda: etapa.is_sale,
    modoDeValor: etapa.value_source ?? "sem",
    valorReais: centavosParaReais(etapa.value_cents),
  };
}

export function JornadaTab({
  jornada,
  podeGerenciar,
  dica,
}: {
  jornada: EtapaDaJornada[];
  podeGerenciar: boolean;
  dica: string;
}) {
  // CRIANDO = criando; chave = editando aquela etapa; null = tudo fechado.
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoDaEtapa(null));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const abrir = (etapa: EtapaDaJornada | null) => {
    setErro(null);
    setRascunho(rascunhoDaEtapa(etapa));
    setEditando(etapa?.chave ?? CRIANDO);
  };

  const fechar = () => {
    setEditando(null);
    setErro(null);
  };

  const salvar = (etapa: EtapaDaJornada | null) => {
    const nome = rascunho.nome.trim();
    if (nome.length < 2) {
      setErro("Dê um nome à etapa, com pelo menos 2 letras.");
      return;
    }
    const descricao = normalizarDescricaoDaEtapa(rascunho.descricao);
    if (descricao && descricao.length > LIMITE_DA_DESCRICAO) {
      setErro(
        `A descrição da etapa cabe em até ${LIMITE_DA_DESCRICAO} caracteres.`,
      );
      return;
    }
    const centavos =
      rascunho.modoDeValor === "fixo"
        ? reaisParaCentavos(rascunho.valorReais)
        : null;
    if (rascunho.ehVenda && rascunho.modoDeValor === "fixo" && centavos === null) {
      setErro("Informe o valor em reais, por exemplo 250,00.");
      return;
    }
    // Termo digitado e nao adicionado conta: esquecer o Enter nao pode
    // significar perder o termo em silencio.
    const termoPendente = rascunho.termoNovo.trim();
    const termos =
      termoPendente.length >= 2 &&
      !rascunho.termos.includes(termoPendente) &&
      rascunho.termos.length < MAXIMO_DE_TERMOS
        ? [...rascunho.termos, termoPendente]
        : rascunho.termos;

    setErro(null);
    startTransition(async () => {
      const resultado = await salvarEtapaDaJornadaAction({
        chave: etapa?.chave ?? null,
        nome,
        tom: rascunho.tom,
        icone: rascunho.icone,
        descricao,
        termos_chave: termos,
        termos_de_quem: rascunho.termosDeQuem,
        venda: {
          is_sale: rascunho.ehVenda,
          value_source:
            rascunho.modoDeValor !== "sem" ? rascunho.modoDeValor : null,
          value_cents: centavos,
        },
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível salvar.");
        return;
      }
      toast.success(etapa ? `Etapa ${nome} salva.` : `Etapa ${nome} criada.`);
      fechar();
    });
  };

  const excluir = (etapa: EtapaDaJornada) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await excluirEtapaDaJornadaAction(etapa.chave);
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível excluir.");
        return;
      }
      toast.success(`Etapa ${etapa.nome} excluída.`);
      fechar();
    });
  };

  const reordenar = (etapa: EtapaDaJornada, direcao: "subir" | "descer") => {
    startTransition(async () => {
      const resultado = await reordenarEtapaDaJornadaAction(
        etapa.chave,
        direcao,
      );
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível reordenar.");
      }
    });
  };

  const botaoNovaEtapa = (
    <Button
      variant="outline"
      disabled={!podeGerenciar || pendente || editando === CRIANDO}
      onClick={() => abrir(null)}
    >
      <Plus className="size-4" />
      Nova etapa
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapas da jornada</CardTitle>
        <CardAction>
          {podeGerenciar ? (
            botaoNovaEtapa
          ) : (
            <DisabledWithHint hint={dica}>{botaoNovaEtapa}</DisabledWithHint>
          )}
        </CardAction>
      </CardHeader>
      <div className="divide-y divide-border">
        {jornada.length === 0 && editando !== CRIANDO ? (
          <EmptyState compact icon={Route} title="Nenhuma etapa na jornada" />
        ) : null}

        {jornada.map((etapa, indice) => {
          const aberta = editando === etapa.chave;
          // Papel fora do catalogo (cache velho) fica com a dica generica.
          const explicacao = etapa.papel
            ? (PAPEL_EXPLICADO[etapa.papel] ?? DICA_DE_SISTEMA)
            : DICA_DE_SISTEMA;
          const conversao = chipDaConversao(etapa);
          // Uma seta por direcao. Sem permissao, as duas vao juntas na dica
          // de permissao (abaixo); com permissao, a seta que trocaria duas
          // etapas de sistema ganha a propria dica.
          const seta = (direcao: "subir" | "descer", troca: TrocaDeOrdem) => {
            const Icone = direcao === "subir" ? ArrowUp : ArrowDown;
            const botao = (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${direcao === "subir" ? "Subir" : "Descer"} ${etapa.nome}`}
                disabled={!podeGerenciar || pendente || !troca.permitida}
                onClick={() => reordenar(etapa, direcao)}
              >
                <Icone className="size-4" aria-hidden />
              </Button>
            );
            return podeGerenciar && !troca.permitida && troca.dica ? (
              <DisabledWithHint hint={troca.dica}>{botao}</DisabledWithHint>
            ) : (
              botao
            );
          };
          const setas = (
            <>
              {seta(
                "subir",
                trocaDeOrdemPermitida(jornada, etapa.chave, "subir"),
              )}
              {seta(
                "descer",
                trocaDeOrdemPermitida(jornada, etapa.chave, "descer"),
              )}
            </>
          );
          const botaoEditar = (
            <Button
              variant="ghost"
              disabled={!podeGerenciar || pendente}
              onClick={() => abrir(etapa)}
            >
              <Pencil className="size-4" />
              Editar
            </Button>
          );
          return (
            <article
              key={etapa.chave}
              className={
                aberta ? "grid gap-3 px-4 py-3" : "grid gap-1 px-4 py-2"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden
                  className="w-5 text-center cz-num text-[11px] text-text-secondary"
                >
                  {indice + 1}
                </span>
                <StatusChip definition={definicaoDaEtapa(etapa)} />
                {etapaDeSistema(etapa) ? (
                  <DicaDeAjuda texto={explicacao}>
                    <StatusChip size="sm" definition={ETAPA_DE_SISTEMA} />
                  </DicaDeAjuda>
                ) : null}
                <StatusChip
                  size="sm"
                  definition={conversao.definicao}
                  label={conversao.rotulo}
                />
                {etapa.termos_chave.length > 0 ? (
                  <span className="text-xs text-text-secondary">
                    <span className="cz-num">{etapa.termos_chave.length}</span>{" "}
                    {resumoDosTermos(
                      etapa.termos_chave.length,
                      etapa.termos_de_quem,
                    )}
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  {podeGerenciar ? (
                    setas
                  ) : (
                    <DisabledWithHint hint={dica}>
                      <span className="flex items-center gap-1">{setas}</span>
                    </DisabledWithHint>
                  )}
                  {aberta ? null : podeGerenciar ? (
                    botaoEditar
                  ) : (
                    <DisabledWithHint hint={dica}>
                      {botaoEditar}
                    </DisabledWithHint>
                  )}
                </div>
              </div>

              {etapa.descricao && !aberta ? (
                <p className="pl-7 text-xs break-words text-text-secondary">
                  {etapa.descricao}
                </p>
              ) : null}

              {aberta ? (
                <FormularioDaEtapa
                  etapa={etapa}
                  rascunho={rascunho}
                  setRascunho={setRascunho}
                  erro={erro}
                  pendente={pendente}
                  aoSalvar={() => salvar(etapa)}
                  aoCancelar={fechar}
                  aoExcluir={
                    etapaDeSistema(etapa) ? null : () => excluir(etapa)
                  }
                />
              ) : null}
            </article>
          );
        })}

        {editando === CRIANDO ? (
          <article className="grid gap-3 px-4 py-3">
            <p className="text-sm font-bold text-text-strong">Nova etapa</p>
            <FormularioDaEtapa
              etapa={null}
              rascunho={rascunho}
              setRascunho={setRascunho}
              erro={erro}
              pendente={pendente}
              aoSalvar={() => salvar(null)}
              aoCancelar={fechar}
              aoExcluir={null}
            />
          </article>
        ) : null}
      </div>
    </Card>
  );
}

function FormularioDaEtapa({
  etapa,
  rascunho,
  setRascunho,
  erro,
  pendente,
  aoSalvar,
  aoCancelar,
  aoExcluir,
}: {
  etapa: EtapaDaJornada | null;
  rascunho: Rascunho;
  setRascunho: React.Dispatch<React.SetStateAction<Rascunho>>;
  erro: string | null;
  pendente: boolean;
  aoSalvar: () => void;
  aoCancelar: () => void;
  aoExcluir: (() => void) | null;
}) {
  const id = etapa?.chave ?? "criando";

  const adicionarTermo = () => {
    const termo = rascunho.termoNovo.trim();
    if (
      termo.length < 2 ||
      rascunho.termos.includes(termo) ||
      rascunho.termos.length >= MAXIMO_DE_TERMOS
    ) {
      return;
    }
    setRascunho((atual) => ({
      ...atual,
      termos: [...atual.termos, termo],
      termoNovo: "",
    }));
  };

  return (
    <div className="grid gap-4 border-t border-border pt-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`nome-${id}`}>Nome da etapa</Label>
          <Input
            id={`nome-${id}`}
            value={rascunho.nome}
            onChange={(evento) =>
              setRascunho((atual) => ({ ...atual, nome: evento.target.value }))
            }
            placeholder="Comprou pacote"
            maxLength={60}
            className="h-10"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`tom-${id}`}>Cor</Label>
          <Select
            value={rascunho.tom}
            onValueChange={(valor) =>
              setRascunho((atual) => ({
                ...atual,
                tom: valor as StatusTone,
              }))
            }
          >
            <SelectTrigger id={`tom-${id}`} className="min-h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONS.map((tom) => (
                <SelectItem key={tom.valor} value={tom.valor}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{
                        backgroundColor: STATUS_TONE_VARS[tom.valor].text,
                      }}
                    />
                    {tom.rotulo}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`icone-${id}`}>Ícone</Label>
          <Select
            value={rascunho.icone}
            onValueChange={(valor) =>
              setRascunho((atual) => ({ ...atual, icone: valor }))
            }
          >
            <SelectTrigger id={`icone-${id}`} className="min-h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ICONES_DE_ETAPA).map(([nome, Icone]) => (
                <SelectItem key={nome} value={nome}>
                  <span className="flex items-center gap-2">
                    <Icone className="size-4" aria-hidden />
                    {nome}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Descricao curta do Kanban (02/10/2026). O teto e o mesmo do check
          descricao_de_etapa_com_tamanho; o contador entra no
          aria-describedby para o leitor de tela dizer quanto falta. */}
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Label htmlFor={`descricao-${id}`}>
            Descrição no Kanban (opcional)
          </Label>
          <span
            id={`descricao-contador-${id}`}
            className="cz-num text-xs text-text-secondary"
          >
            {rascunho.descricao.length}/{LIMITE_DA_DESCRICAO}
          </span>
        </div>
        <Textarea
          id={`descricao-${id}`}
          value={rascunho.descricao}
          onChange={(evento) =>
            setRascunho((atual) => ({
              ...atual,
              descricao: evento.target.value,
            }))
          }
          maxLength={LIMITE_DA_DESCRICAO}
          rows={2}
          placeholder="Por exemplo: pediu o valor e ainda não marcou a consulta"
          aria-describedby={`descricao-contador-${id}`}
          className="min-h-10"
        />
      </div>

      {/* A etapa de perda nao recebe termo: palavra solta nao perde ninguem
          (a decisao pura em lib/domain/jornada.ts ignora termos dela). */}
      {etapa?.papel === "perdido" ? null : (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`termo-${id}`}>
              Termos que movem o contato para cá
            </Label>
            <DicaDeAjuda texto={ajudaDosTermos(rascunho.termosDeQuem)} />
          </div>
          <div className="grid gap-1.5 pt-1 sm:max-w-sm">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`quem-${id}`}>Quem escreve o termo</Label>
              <DicaDeAjuda texto={AJUDA_QUEM_ESCREVE} />
            </div>
            <Select
              value={rascunho.termosDeQuem}
              onValueChange={(valor) =>
                setRascunho((atual) => ({
                  ...atual,
                  termosDeQuem: valor as TermosDeQuem,
                }))
              }
            >
              <SelectTrigger id={`quem-${id}`} className="min-h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPCOES_TERMOS_DE_QUEM.map((opcao) => (
                  <SelectItem key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rascunho.termos.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {rascunho.termos.map((termo) => (
                <span
                  key={termo}
                  className="inline-flex h-6 items-center gap-1 rounded-sm border border-border-strong bg-card pr-1 pl-2.5 text-xs font-medium text-foreground"
                >
                  {termo}
                  {/* O X e pequeno no olho, mas o alvo de toque chega aos 40px
                    da regra 5 pelo hit-40. */}
                  <button
                    type="button"
                    aria-label={`Remover o termo ${termo}`}
                    className="hit-40 relative grid size-4 place-items-center rounded-[4px] text-text-secondary cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                    onClick={() =>
                      setRascunho((atual) => ({
                        ...atual,
                        termos: atual.termos.filter((t) => t !== termo),
                      }))
                    }
                  >
                    <X className="size-[11px]" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {rascunho.termos.length >= MAXIMO_DE_TERMOS ? (
            <p className="text-xs text-text-secondary">
              Máximo de {MAXIMO_DE_TERMOS} termos
            </p>
          ) : (
            <div className="flex gap-2">
              <Input
                id={`termo-${id}`}
                value={rascunho.termoNovo}
                onChange={(evento) =>
                  setRascunho((atual) => ({
                    ...atual,
                    termoNovo: evento.target.value,
                  }))
                }
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") {
                    evento.preventDefault();
                    adicionarTermo();
                  }
                }}
                placeholder="Novo termo"
                maxLength={40}
                className="h-10 max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                onClick={adicionarTermo}
                disabled={rascunho.termoNovo.trim().length < 2}
              >
                Adicionar
              </Button>
            </div>
          )}
        </div>
      )}

      {/* A etapa de perda nao e venda nem conversao (o check
          perdido_sem_conversao recusa o evento): a tela nem oferece. */}
      {etapa?.papel === "perdido" ? null : (
        <div className="grid gap-3 border-t border-border pt-4">
          <div className="flex min-h-10 items-center gap-2.5">
            <Checkbox
              id={`venda-${id}`}
              checked={rascunho.ehVenda}
              onCheckedChange={(valor) =>
                setRascunho((atual) => ({
                  ...atual,
                  ehVenda: valor === true,
                }))
              }
            />
            <Label htmlFor={`venda-${id}`}>Esta etapa é uma venda</Label>
            {/* Venda pela Jornada (decisao do dono de 23/11/2026). */}
            <DicaDeAjuda texto={AJUDA_DA_VENDA} />
          </div>
          {rascunho.ehVenda ? (
            <div className="grid gap-1.5 sm:max-w-sm">
              <Label htmlFor={`valor-${id}`}>Valor da venda</Label>
              <Select
                value={rascunho.modoDeValor}
                onValueChange={(valor) =>
                  setRascunho((atual) => ({
                    ...atual,
                    modoDeValor: valor as Rascunho["modoDeValor"],
                  }))
                }
              >
                <SelectTrigger id={`valor-${id}`} className="min-h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem valor</SelectItem>
                  <SelectItem value="service_link">Preço da consulta</SelectItem>
                  <SelectItem value="fixo">Valor fixo</SelectItem>
                </SelectContent>
              </Select>
              {rascunho.modoDeValor === "fixo" ? (
                <Input
                  value={rascunho.valorReais}
                  onChange={(evento) =>
                    setRascunho((atual) => ({
                      ...atual,
                      valorReais: evento.target.value,
                    }))
                  }
                  inputMode="decimal"
                  placeholder="250,00"
                  aria-label="Valor em reais"
                  className="h-10 cz-num"
                />
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-text-secondary">
            Conversão nos anúncios:{" "}
            <Link
              href={LINK_DAS_CONVERSOES}
              prefetch={false}
              className="font-semibold text-primary-text underline underline-offset-2"
            >
              Conversões por etapa
            </Link>
          </p>
        </div>
      )}

      {erro ? (
        <Aviso tom="alert" role="alert">
          {erro}
        </Aviso>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pendente} onClick={aoSalvar}>
          <Check className="size-4" />
          {pendente ? "Salvando..." : "Salvar"}
        </Button>
        <Button variant="ghost" disabled={pendente} onClick={aoCancelar}>
          <X className="size-4" />
          Cancelar
        </Button>
        {aoExcluir ? (
          <Button
            variant="destructive"
            disabled={pendente}
            onClick={aoExcluir}
            className="ml-auto"
          >
            <Trash2 className="size-4" />
            Excluir etapa
          </Button>
        ) : null}
      </div>
    </div>
  );
}
