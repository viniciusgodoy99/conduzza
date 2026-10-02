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
import type { NumerosDasAutomaticas } from "@/components/automacoes/numeros-de-envio";
import {
  AJUDA_DA_PRECEDENCIA,
  TIPOS_DE_VINCULO,
  itensDoVinculo,
  opcoesLivres,
  ordenarReguasVinculadas,
  rotuloDoVinculo,
  textoDaEtiqueta,
  type KindVinculavel,
  type OpcoesDeVinculo,
  type TipoDeVinculo,
} from "@/components/automacoes/vinculo-da-regua";
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
import type { ReguaVinculada } from "@/lib/queries/automacoes";
import { cn } from "@/lib/utils";

// Reguas vinculadas da confirmacao e da pos-falta (spec 8.2 e 8.3, e a
// decisao do dono de 29/09/2026): regua propria por medico, especialidade ou
// procedimento (colonoscopia tem 41% de falta, consulta comum tem 2%) e, na
// confirmacao, a reforcada para paciente com historico de falta. O banco
// escolhe a mais especifica sozinho (regua_da_consulta); aqui a clinica
// cria, edita e exclui. O mesmo componente serve as duas abas, pelo kind.
//
// Desenho do design system (docs/06 secao 5.10): cada regua num cartao com
// cabecalho de acordeao (nome, vinculo com icone e rotulo, recorte e a
// situacao em 3 camadas com REGUA_STATUS; achado 54) e "Excluir" suave, que
// pergunta antes (achado 48).

type Base = TipoDeVinculo | "reforcada";

/** A ordem do "Vincular a", a mesma da decisao do dono. */
const ORDEM_DOS_VINCULOS: readonly TipoDeVinculo[] = [
  "medico",
  "especialidade",
  "procedimento",
];

const SEM_ESCOLHA: Record<TipoDeVinculo, string> = {
  medico: "",
  especialidade: "",
  procedimento: "",
};

const CAMPO_DO_VINCULO: Record<
  TipoDeVinculo,
  {
    placeholder: string;
    /** Nada ativo no cadastro. */
    semCadastro: string;
    /** Tudo o que esta ativo ja tem regua deste tipo. */
    semLivre: string;
    ajuda?: string;
  }
> = {
  medico: {
    placeholder: "Escolha o médico",
    semCadastro: "Nenhum médico ativo em Cadastros.",
    semLivre: "Todos os médicos ativos já têm régua própria.",
  },
  especialidade: {
    placeholder: "Escolha a especialidade",
    semCadastro:
      "Nenhum profissional ativo tem especialidade preenchida em Cadastros.",
    semLivre: "Todas as especialidades já têm régua própria.",
    ajuda:
      "A lista vem das especialidades dos profissionais ativos, em Cadastros.",
  },
  procedimento: {
    placeholder: "Escolha o procedimento",
    semCadastro: "Nenhum procedimento ativo em Cadastros.",
    semLivre: "Todos os procedimentos ativos já têm régua própria.",
  },
};

/** O que muda de uma aba para a outra. */
const COPIA_DO_TIPO: Record<
  KindVinculavel,
  {
    apoio: string;
    /** Frase que so a confirmacao tem (a reforcada). */
    extra: string | null;
    vazio: string;
    nomeDaGeral: string;
    exclusao: string;
    historico: string;
    regua: {
      inicioDaLinha: string;
      fimDaLinha: string | null;
      sentidoDoPasso: "antes" | "depois";
      eventoRotulo: string;
      rotuloDoEvento: string;
      rotuloDoEventoSingular: string;
    };
  }
> = {
  confirmacao: {
    apoio:
      "Procedimentos com preparo, como colonoscopia, têm falta muito maior e pedem mais toques. Um médico ou uma especialidade também podem pedir outra conversa.",
    extra:
      "Para quem tem histórico de falta, a reforçada vale no lugar da geral.",
    vazio: "A régua geral de confirmação cobre todas as consultas.",
    nomeDaGeral: "régua geral de confirmação",
    exclusao:
      "As próximas consultas deste recorte passam a seguir a próxima régua que vale para elas, ou a geral de confirmação.",
    historico:
      "Todo o histórico de envios dela também é apagado: some das métricas e da lista do dia em Confirmações.",
    regua: {
      inicioDaLinha: "Agendou",
      fimDaLinha: "Consulta",
      sentidoDoPasso: "antes",
      eventoRotulo: "a consulta",
      rotuloDoEvento: "consultas marcadas",
      rotuloDoEventoSingular: "consulta marcada",
    },
  },
  pos_falta: {
    apoio:
      "Quando a falta de um médico, de uma especialidade ou de um procedimento pede outra conversa, a recuperação ganha uma régua própria.",
    extra: null,
    vazio: "A régua geral de recuperação cobre todas as faltas.",
    nomeDaGeral: "régua geral de recuperação",
    exclusao:
      "As próximas faltas deste recorte passam a seguir a próxima régua que vale para elas, ou a geral de recuperação.",
    historico:
      "Todo o histórico de envios dela também é apagado: some das métricas e da aba Faltas de hoje em Confirmações.",
    regua: {
      inicioDaLinha: "Falta registrada",
      fimDaLinha: null,
      sentidoDoPasso: "depois",
      eventoRotulo: "a falta",
      rotuloDoEvento: "faltas registradas",
      rotuloDoEventoSingular: "falta registrada",
    },
  },
};

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
  regua: ReguaVinculada;
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

/**
 * O vinculo no cabecalho: icone, tipo e o nome ATUAL do cadastro ("Médico:
 * Dra. Helena Souza"). O nome da regua e gravado so na criacao e envelhece
 * quando Cadastros renomeia o medico ou o procedimento; a etiqueta vem da
 * leitura de agora e diz a qual cadastro a regua esta presa. Nome longo
 * trunca, com o texto inteiro no title (o leitor de tela le o texto todo).
 * Pele de etiqueta neutra, nao de status: o vinculo e recorte, nao situacao.
 */
function EtiquetaDoVinculo({ regua }: { regua: ReguaVinculada }) {
  const rotulo = rotuloDoVinculo(regua);
  if (!rotulo) {
    return null;
  }
  const Icone = rotulo.icone;
  const texto = textoDaEtiqueta(rotulo);
  return (
    <span
      title={texto}
      className="inline-flex h-6 max-w-[18rem] min-w-0 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-2 text-xs font-medium text-foreground"
    >
      <Icone className="size-3.5 shrink-0 text-text-secondary" aria-hidden />
      <span className="sr-only">Vínculo: </span>
      <span className="min-w-0 truncate">{texto}</span>
    </span>
  );
}

export function ReguasVinculadas({
  kind,
  clinicId,
  reguas,
  opcoes,
  nomeDaClinica,
  precoCents,
  podeEditar,
  dicaSemPermissao,
  ehAdministrador,
  numeros = null,
  aoMudar,
}: {
  /** Qual aba: confirmacao ou pos_falta. */
  kind: KindVinculavel;
  clinicId: string;
  /** As vinculadas da clinica, dos dois tipos: o componente fica com as do seu. */
  reguas: ReguaVinculada[];
  /** Medicos, especialidades e procedimentos ativos da clinica. */
  opcoes: OpcoesDeVinculo;
  nomeDaClinica: string;
  precoCents: number | null;
  podeEditar: boolean;
  dicaSemPermissao: string;
  ehAdministrador: boolean;
  /** Numeros ativos e politica: o teste de cada passo escolhe o numero. */
  numeros?: NumerosDasAutomaticas | null;
  aoMudar: () => Promise<unknown> | void;
}) {
  const copia = COPIA_DO_TIPO[kind];
  const [aberta, setAberta] = useState<string | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [aExcluir, setAExcluir] = useState<ReguaVinculada | null>(null);
  const [base, setBase] = useState<Base>("medico");
  const [escolhas, setEscolhas] =
    useState<Record<TipoDeVinculo, string>>(SEM_ESCOLHA);
  const [limiar, setLimiar] = useState("2");
  const [pendente, iniciarTransicao] = useTransition();

  const doTipo = ordenarReguasVinculadas(
    reguas.filter((regua) => regua.kind === kind),
  );
  const livres = opcoesLivres(kind, reguas, opcoes);

  const numeroDoLimiar = Number(limiar);
  const limiarValido =
    Number.isInteger(numeroDoLimiar) &&
    numeroDoLimiar >= 1 &&
    numeroDoLimiar <= 10;
  const itens = base === "reforcada" ? [] : itensDoVinculo(base, livres);
  // A escolha so vale enquanto continua livre (outra pessoa pode ter criado
  // a mesma regua no meio do caminho; o banco recusa de qualquer jeito).
  const escolhida =
    base === "reforcada"
      ? null
      : (itens.find((item) => item.valor === escolhas[base]) ?? null);
  const podeCriar =
    base === "reforcada"
      ? limiarValido && !livres.temReforcada
      : escolhida !== null;

  const abrirDialogo = () => {
    setBase("medico");
    setEscolhas(SEM_ESCOLHA);
    setLimiar("2");
    setDialogoAberto(true);
  };

  const criar = () => {
    let entrada: Record<string, unknown>;
    if (base === "reforcada") {
      entrada = { kind, base, no_show_threshold: numeroDoLimiar };
    } else if (!escolhida) {
      return;
    } else if (base === "especialidade") {
      entrada = { kind, base, specialty: escolhida.rotulo };
    } else if (base === "medico") {
      entrada = { kind, base, professional_id: escolhida.valor };
    } else {
      entrada = { kind, base, procedure_id: escolhida.valor };
    }
    iniciarTransicao(async () => {
      const resultado = await criarReguaDeExcecaoAction(entrada);
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

  const excluir = (regua: ReguaVinculada) => {
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

  const idTitulo = `vinculadas-titulo-${kind}`;
  const idBase = `vinculo-base-${kind}`;
  const idEscolha = `vinculo-escolha-${kind}`;
  const idLimiar = `vinculo-limiar-${kind}`;
  const campo = base === "reforcada" ? null : CAMPO_DO_VINCULO[base];
  const cadastrados =
    base === "reforcada" ? 0 : itensDoVinculo(base, opcoes).length;
  const IconeDaReforcada = TIPOS_DE_VINCULO.reforcada.icone;

  return (
    <section className="grid gap-3" aria-labelledby={idTitulo}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2
            id={idTitulo}
            className="text-base leading-[1.3] font-bold tracking-[-0.01em]"
          >
            Réguas vinculadas
          </h2>
          <p className="max-w-[62ch] text-[13px] text-text-secondary">
            {copia.apoio}
          </p>
          <p className="max-w-[62ch] text-[13px] text-foreground">
            {AJUDA_DA_PRECEDENCIA}
            {copia.extra ? ` ${copia.extra}` : null}
          </p>
        </div>
        {podeEditar ? (
          <Button variant="outline" disabled={pendente} onClick={abrirDialogo}>
            <Plus aria-hidden />
            Nova régua vinculada
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button variant="outline" disabled>
              <Plus aria-hidden />
              Nova régua vinculada
            </Button>
          </DisabledWithHint>
        )}
      </div>

      {doTipo.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={Layers}
            title="Nenhuma régua vinculada ainda"
            description={copia.vazio}
          />
        </Card>
      ) : (
        doTipo.map((regua) => {
          const expandida = aberta === regua.id;
          const idConteudo = `vinculada-${regua.id}`;
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
                  <EtiquetaDoVinculo regua={regua} />
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
                      inicioDaLinha: copia.regua.inicioDaLinha,
                      fimDaLinha: copia.regua.fimDaLinha,
                      vazio: "Esta régua não tem mensagens.",
                    }}
                    nomeDaClinica={nomeDaClinica}
                    botoesDaPreview={
                      kind === "confirmacao"
                        ? MENU_CONFIRMACAO.map((opcao) => opcao.text)
                        : undefined
                    }
                    estimativa={{
                      eventos30d: regua.eventos30d,
                      rotuloDoEvento: copia.regua.rotuloDoEvento,
                      rotuloDoEventoSingular:
                        copia.regua.rotuloDoEventoSingular,
                      precoCents,
                    }}
                    sentidoDoPasso={copia.regua.sentidoDoPasso}
                    tipoDaRegua={kind}
                    eventoRotulo={copia.regua.eventoRotulo}
                    podeEditar={podeEditar}
                    dicaSemPermissao={dicaSemPermissao}
                    ehAdministrador={ehAdministrador}
                    numeros={numeros}
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
        descricao={copia.exclusao}
        consequencias={[
          "Os textos e os anexos da régua são apagados.",
          copia.historico,
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
            <DialogTitle>Nova régua vinculada</DialogTitle>
            <DialogDescription>
              A régua nasce desligada, copiando a janela e as mensagens da{" "}
              {copia.nomeDaGeral}, para você ajustar antes de ligar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={idBase}>Vincular a</Label>
              <Select value={base} onValueChange={(v) => setBase(v as Base)}>
                <SelectTrigger id={idBase} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDEM_DOS_VINCULOS.map((tipo) => {
                    const Icone = TIPOS_DE_VINCULO[tipo].icone;
                    return (
                      <SelectItem key={tipo} value={tipo}>
                        <Icone aria-hidden />
                        {TIPOS_DE_VINCULO[tipo].rotulo}
                      </SelectItem>
                    );
                  })}
                  {kind === "confirmacao" ? (
                    <SelectItem
                      value="reforcada"
                      disabled={livres.temReforcada}
                    >
                      <IconeDaReforcada aria-hidden />
                      Reforçada por histórico de falta
                      {livres.temReforcada ? " (já existe)" : ""}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
            {base !== "reforcada" && campo ? (
              <div className="grid gap-1.5">
                <Label htmlFor={idEscolha}>
                  {TIPOS_DE_VINCULO[base].rotulo}
                </Label>
                <Select
                  value={escolhida?.valor ?? ""}
                  onValueChange={(valor) =>
                    setEscolhas((atual) => ({ ...atual, [base]: valor }))
                  }
                  disabled={itens.length === 0}
                >
                  <SelectTrigger id={idEscolha} className="w-full">
                    <SelectValue placeholder={campo.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {itens.map((item) => (
                      <SelectItem key={item.valor} value={item.valor}>
                        {item.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {itens.length === 0 ? (
                  <p className="text-[11px] text-text-secondary">
                    {cadastrados === 0 ? campo.semCadastro : campo.semLivre}
                  </p>
                ) : campo.ajuda ? (
                  <p className="text-[11px] text-text-secondary">
                    {campo.ajuda}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor={idLimiar}>A partir de quantas faltas</Label>
                <Input
                  id={idLimiar}
                  type="number"
                  min={1}
                  max={10}
                  className="w-24 cz-num"
                  value={limiar}
                  aria-invalid={!limiarValido}
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
            <Button disabled={pendente || !podeCriar} onClick={criar}>
              {pendente ? "Criando..." : "Criar régua"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
