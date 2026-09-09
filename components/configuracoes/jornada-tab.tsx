"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  excluirEtapaDaJornadaAction,
  reordenarEtapaDaJornadaAction,
  salvarEtapaDaJornadaAction,
} from "@/app/(app)/configuracoes/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { STATUS_TONE_VARS, type StatusTone } from "@/lib/design/status";
import {
  ICONES_DE_ETAPA,
  definicaoDaEtapa,
  type EtapaDaJornada,
} from "@/lib/domain/jornada";
import {
  EVENTOS_META_PADRAO,
  ehEventoPadrao,
  rotuloDoEvento,
} from "@/lib/domain/meta-conversao";
import { centavosParaReais, reaisParaCentavos } from "@/lib/utils/moeda";

// A tela da JORNADA (fase 3 da jornada configuravel): as etapas do funil da
// clinica, no modelo da Jornada de Compra do Tintim. Cada etapa edita nome,
// aparencia, termos-chave e a conversao da Meta NO MESMO formulario, porque
// era assim que o dono usava no Tintim e foi assim que ele pediu.
//
// Papel de sistema (entrada, agendou, compareceu, perdido) aparece com
// cadeado e explicacao: renomeia e reordena, nunca exclui. Quem garante isso
// e gatilho no banco; a tela so evita oferecer o que vai ser recusado.

const TONS: { valor: StatusTone; rotulo: string }[] = [
  { valor: "neutral", rotulo: "Cinza (neutro)" },
  { valor: "info", rotulo: "Azul (informativo)" },
  { valor: "warning", rotulo: "Âmbar (atenção)" },
  { valor: "success", rotulo: "Verde (sucesso)" },
  { valor: "alert", rotulo: "Vermelho (alerta)" },
];

const PAPEL_EXPLICADO: Record<string, string> = {
  entrada: "Etapa de sistema: todo contato novo nasce aqui.",
  agendou: "Etapa de sistema: criar um agendamento move o contato para cá.",
  compareceu: "Etapa de sistema: comparecer à consulta move o contato para cá.",
  perdido: "Etapa de sistema: marcar como perdido exige o motivo.",
};

const EVENTO_PERSONALIZADO = "__personalizado__";
const SEM_EVENTO = "__sem_evento__";

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
  termos: string[];
  termoNovo: string;
  evento: string;
  eventoPersonalizado: string;
  ehVenda: boolean;
  primeiroContato: boolean;
  modoDeValor: "sem" | "fixo" | "service_link";
  valorReais: string;
  conversaoAtiva: boolean;
};

function rascunhoDaEtapa(etapa: EtapaDaJornada | null): Rascunho {
  if (!etapa) {
    return {
      nome: "",
      tom: "neutral",
      icone: "circle",
      termos: [],
      termoNovo: "",
      evento: SEM_EVENTO,
      eventoPersonalizado: "",
      ehVenda: false,
      primeiroContato: false,
      modoDeValor: "sem",
      valorReais: "",
      conversaoAtiva: true,
    };
  }
  const evento = etapa.meta_event_name;
  return {
    nome: etapa.nome,
    tom: etapa.tom,
    icone: etapa.icone in ICONES_DE_ETAPA ? etapa.icone : "circle",
    termos: etapa.termos_chave,
    termoNovo: "",
    evento: !evento
      ? SEM_EVENTO
      : ehEventoPadrao(evento)
        ? evento
        : EVENTO_PERSONALIZADO,
    eventoPersonalizado: evento && !ehEventoPadrao(evento) ? evento : "",
    ehVenda: etapa.is_sale,
    primeiroContato: etapa.is_first_contact,
    modoDeValor: etapa.value_source ?? "sem",
    valorReais: centavosParaReais(etapa.value_cents),
    conversaoAtiva: etapa.conversao_ativa,
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
    const evento =
      rascunho.evento === SEM_EVENTO
        ? null
        : rascunho.evento === EVENTO_PERSONALIZADO
          ? rascunho.eventoPersonalizado.trim() || null
          : rascunho.evento;
    if (rascunho.evento === EVENTO_PERSONALIZADO && !evento) {
      setErro("Digite o nome do evento personalizado, ou escolha um da lista.");
      return;
    }
    const centavos =
      rascunho.modoDeValor === "fixo"
        ? reaisParaCentavos(rascunho.valorReais)
        : null;
    if (evento && rascunho.modoDeValor === "fixo" && centavos === null) {
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
        termos_chave: termos,
        conversao: {
          meta_event_name: evento,
          conversao_ativa: rascunho.conversaoAtiva,
          is_sale: evento ? rascunho.ehVenda : false,
          is_first_contact: evento ? rascunho.primeiroContato : false,
          value_source:
            evento && rascunho.modoDeValor !== "sem"
              ? rascunho.modoDeValor
              : null,
          value_cents: evento ? centavos : null,
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

  return (
    <div className="grid gap-3">
      {jornada.map((etapa, indice) => {
        const aberta = editando === etapa.chave;
        const explicacao = etapa.papel ? PAPEL_EXPLICADO[etapa.papel] : null;
        return (
          <article
            key={etapa.chave}
            className="grid gap-3 rounded-lg border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip definition={definicaoDaEtapa(etapa)} />
              {etapa.papel ? (
                <span
                  className="flex items-center gap-1 text-[11.5px] text-text-tertiary"
                  title={explicacao ?? undefined}
                >
                  <Lock strokeWidth={1.5} className="size-3" />
                  sistema
                </span>
              ) : null}
              <span className="text-sm text-text-secondary">
                {etapa.meta_event_name
                  ? etapa.conversao_ativa
                    ? `Envia ${rotuloDoEvento(etapa.meta_event_name)}`
                    : `Conversão pausada (${rotuloDoEvento(etapa.meta_event_name)})`
                  : "Sem evento de conversão"}
                {etapa.termos_chave.length > 0
                  ? ` · ${etapa.termos_chave.length} ${etapa.termos_chave.length === 1 ? "termo" : "termos"}`
                  : ""}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={`Subir ${etapa.nome}`}
                  disabled={!podeGerenciar || pendente || indice === 0}
                  onClick={() => reordenar(etapa, "subir")}
                >
                  <ArrowUp strokeWidth={1.5} className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={`Descer ${etapa.nome}`}
                  disabled={
                    !podeGerenciar || pendente || indice === jornada.length - 1
                  }
                  onClick={() => reordenar(etapa, "descer")}
                >
                  <ArrowDown strokeWidth={1.5} className="size-4" />
                </Button>
                {aberta ? null : podeGerenciar ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendente}
                    onClick={() => abrir(etapa)}
                  >
                    <Pencil strokeWidth={1.5} className="size-4" />
                    Editar
                  </Button>
                ) : (
                  <DisabledWithHint hint={dica}>
                    <Button variant="outline" size="sm" disabled>
                      <Pencil strokeWidth={1.5} className="size-4" />
                      Editar
                    </Button>
                  </DisabledWithHint>
                )}
              </div>
            </div>

            {explicacao ? (
              <p className="text-[12px] text-text-tertiary">{explicacao}</p>
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
                aoExcluir={etapa.papel ? null : () => excluir(etapa)}
              />
            ) : null}
          </article>
        );
      })}

      {editando === CRIANDO ? (
        <article className="grid gap-3 rounded-lg border bg-card p-4">
          <p className="text-sm font-semibold">Nova etapa</p>
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
      ) : podeGerenciar ? (
        <Button
          variant="outline"
          disabled={pendente}
          onClick={() => abrir(null)}
          className="justify-self-start"
        >
          <Plus strokeWidth={1.5} className="size-4" />
          Nova etapa
        </Button>
      ) : (
        <DisabledWithHint hint={dica}>
          <Button variant="outline" disabled className="justify-self-start">
            <Plus strokeWidth={1.5} className="size-4" />
            Nova etapa
          </Button>
        </DisabledWithHint>
      )}

      <p className="text-[12.5px] text-text-tertiary">
        As etapas de sistema podem mudar de nome e de lugar, nunca sair: são
        elas que movem o contato sozinho (agendar, comparecer) e que protegem o
        motivo de perda. Os eventos de conversão ainda não são enviados à Meta:
        esta tela define o que será enviado quando a conta de anúncios for
        conectada.
      </p>
    </div>
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
  const temEvento = rascunho.evento !== SEM_EVENTO;

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
    <div className="grid gap-4 border-t pt-4">
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
                    <Icone strokeWidth={1.5} className="size-4" aria-hidden />
                    {nome}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* A etapa de perda nao recebe termo: palavra solta nao perde ninguem
          (a decisao pura em lib/domain/jornada.ts ignora termos dela). */}
      {etapa?.papel === "perdido" ? null : (
        <div className="grid gap-1.5">
          <Label htmlFor={`termo-${id}`}>
            Termos que movem o contato para cá
          </Label>
        <p className="text-[12px] text-text-tertiary">
          Quando o paciente escrever um destes termos na conversa, o contato
          anda sozinho para esta etapa (só para frente na jornada, nunca para a
          etapa de perda).
        </p>
        {rascunho.termos.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {rascunho.termos.map((termo) => (
              <span
                key={termo}
                className="flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-[12px]"
              >
                {termo}
                {/* O X e pequeno no olho, mas o alvo de toque chega aos 40px
                    da regra 5 pelo pseudo-elemento expandido. */}
                <button
                  type="button"
                  aria-label={`Remover o termo ${termo}`}
                  className="relative grid size-5 place-items-center rounded-full after:absolute after:-inset-2.5 hover:bg-surface-4"
                  onClick={() =>
                    setRascunho((atual) => ({
                      ...atual,
                      termos: atual.termos.filter((t) => t !== termo),
                    }))
                  }
                >
                  <X strokeWidth={1.5} className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {rascunho.termos.length >= MAXIMO_DE_TERMOS ? (
          <p className="text-[12px] text-text-tertiary">
            Esta etapa chegou ao máximo de {MAXIMO_DE_TERMOS} termos. Remova um
            para adicionar outro.
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
              placeholder="Digite e aperte Enter para adicionar"
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

      {/* Perda nunca e conversao: o check perdido_sem_conversao no banco
          recusa, entao a tela nem oferece. */}
      {etapa?.papel === "perdido" ? null : (
      <div className="grid gap-3 rounded-lg bg-surface-2 p-3">
        <p className="text-[13px] font-semibold">Conversão para os anúncios</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`evento-${id}`}>Evento que a Meta recebe</Label>
            <Select
              value={rascunho.evento}
              onValueChange={(valor) =>
                setRascunho((atual) => ({ ...atual, evento: valor }))
              }
            >
              <SelectTrigger id={`evento-${id}`} className="min-h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_EVENTO}>Sem evento</SelectItem>
                {EVENTOS_META_PADRAO.map((evento) => (
                  <SelectItem key={evento.nome} value={evento.nome}>
                    {evento.rotulo}
                  </SelectItem>
                ))}
                <SelectItem value={EVENTO_PERSONALIZADO}>
                  Personalizado (digitar o nome)
                </SelectItem>
              </SelectContent>
            </Select>
            {rascunho.evento === EVENTO_PERSONALIZADO ? (
              <Input
                value={rascunho.eventoPersonalizado}
                onChange={(evento) =>
                  setRascunho((atual) => ({
                    ...atual,
                    eventoPersonalizado: evento.target.value,
                  }))
                }
                placeholder="NomeDoEventoNaMeta"
                aria-label="Nome do evento personalizado"
                className="h-10 font-mono"
                maxLength={100}
              />
            ) : null}
          </div>

          {temEvento ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`valor-${id}`}>Valor da conversão</Label>
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
                  <SelectItem value="fixo">Valor fixo</SelectItem>
                  <SelectItem value="service_link">
                    Preço da consulta do agendamento
                  </SelectItem>
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
                  className="h-10 font-mono tabular-nums"
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {temEvento ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <Switch
                id={`venda-${id}`}
                checked={rascunho.ehVenda}
                onCheckedChange={(valor) =>
                  setRascunho((atual) => ({ ...atual, ehVenda: valor }))
                }
              />
              <Label htmlFor={`venda-${id}`}>Esta etapa é uma venda</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`primeiro-${id}`}
                checked={rascunho.primeiroContato}
                onCheckedChange={(valor) =>
                  setRascunho((atual) => ({
                    ...atual,
                    primeiroContato: valor,
                  }))
                }
              />
              <Label htmlFor={`primeiro-${id}`}>É o primeiro contato</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`conversao-ativa-${id}`}
                checked={rascunho.conversaoAtiva}
                onCheckedChange={(valor) =>
                  setRascunho((atual) => ({
                    ...atual,
                    conversaoAtiva: valor,
                  }))
                }
              />
              <Label htmlFor={`conversao-ativa-${id}`}>
                {rascunho.conversaoAtiva ? "Conversão ativa" : "Pausada"}
              </Label>
            </div>
          </div>
        ) : null}
      </div>
      )}

      {erro ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pendente} onClick={aoSalvar}>
          <Check strokeWidth={1.5} className="size-4" />
          {pendente ? "Salvando..." : "Salvar"}
        </Button>
        <Button variant="ghost" disabled={pendente} onClick={aoCancelar}>
          <X strokeWidth={1.5} className="size-4" />
          Cancelar
        </Button>
        {aoExcluir ? (
          <Button
            variant="ghost"
            disabled={pendente}
            onClick={aoExcluir}
            className="ml-auto [color:var(--alert-text)]"
          >
            <Trash2 strokeWidth={1.5} className="size-4" />
            Excluir etapa
          </Button>
        ) : null}
      </div>
    </div>
  );
}
