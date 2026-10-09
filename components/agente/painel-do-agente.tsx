"use client";

import { Check } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { AbaConhecimento } from "@/components/agente/aba-conhecimento";
import { AbaHabilidades } from "@/components/agente/aba-habilidades";
import { AbaInstrucoes } from "@/components/agente/aba-instrucoes";
import { AbaPersona } from "@/components/agente/aba-persona";
import { AbaRegras } from "@/components/agente/aba-regras";
import { AbaVersoes } from "@/components/agente/aba-versoes";
import {
  acoesDoAgente,
  type AcoesDoAgente,
  type ResultadoDaPublicacao,
} from "@/components/agente/acoes";
import {
  formulariosNaoSalvos,
  GERACAO_INICIAL,
  geracaoDepoisDeDescartar,
  NADA_NAO_SALVO,
  rotuloDoFormulario,
  type AvisarNaoSalvo,
  type FormularioDoAgente,
} from "@/components/agente/nao-salvo";
import { Simulador } from "@/components/agente/simulador";
import {
  abaDoAgente,
  abasVisiveis,
  listaEmTexto,
  textoDasAlteracoes,
  textoDaUltimaPublicada,
  TEXTOS_DO_AGENTE as T,
  type AbaDoAgente,
} from "@/components/agente/textos";
import type {
  DadosDoPainel,
  ResultadoDaAcao,
  RetornoDaAcao,
} from "@/components/agente/tipos";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  comMudancaDasInstrucoes,
  diferencasDoRascunho,
  problemasDaPublicacao,
  type ProblemaDaPublicacao,
} from "@/lib/domain/agente/config";

// Painel da Tela 6 (Agente de IA), so nas clinicas da fase controlada (a
// pagina decide no servidor). Desenho do docs/06 5.14 sobre o brief:
// - duas colunas (configuracao 3fr, simulador 2fr fixo na rolagem);
// - abas line na URL (?aba=persona|habilidades|conhecimento|regras|
//   instrucoes|versoes), a das instrucoes so para o super admin. A troca de
//   aba so reescreve a URL (history.replaceState), sem ida ao servidor, e
//   as abas ficam montadas (escondidas) para um formulario em edicao nao
//   perder o que foi digitado;
// - rodape fixo com a ultima versao publicada, "N alterações não
//   publicadas" e "Publicar alterações" (o unico lime da tela, h-11), que
//   pede confirmacao com a lista do que muda e o que precisa ser corrigido.
//   O rodape fica no pe da area de conteudo mesmo nas abas curtas (mt-auto
//   na casca que ocupa a altura toda) e a pagina reserva o espaco dele na
//   rolagem do foco (scroll-padding no main; achado 32);
// - a linha "Instruções da equipe Conduzza" das alteracoes vem do servidor
//   (dados.instrucoesMudaram), para todos os papeis e sem o texto: a conta
//   do navegador nunca decide sobre as instrucoes (achados 16, 35 e 38);
// - o que foi digitado e nao salvo nao vai junto sem a pessoa saber: o
//   dialogo de publicar lista as abas com edicao pendente e so publica
//   depois de salvar ou descartar (achado 27).
//
// Toda gravacao vai para o RASCUNHO (o paciente so ve depois de publicar).
// Uma acao por vez: enquanto uma roda, os outros controles esperam. O
// resultado vai num toast e, no erro sem formulario, numa regiao sempre
// montada (o leitor de tela anuncia). Sem permissao (recepcao), tudo
// visivel e desabilitado, com a dica (CLAUDE.md secao 5).

/**
 * A chave de cada formulario: muda quando o servidor manda outra versao
 * daquela parte (salvou, restaurou), e o formulario remonta com os valores
 * novos (o useForm so le os valores iniciais na montagem). Mudanca em outra
 * parte nao mexe no formulario aberto.
 */
export function chavesDosFormularios(config: DadosDoPainel["config"]): {
  persona: string;
  horario: string;
  instrucoes: string;
} {
  return {
    persona: JSON.stringify([
      config.nome,
      config.tom,
      config.usarEmoji,
      config.saudacao,
      config.encerramento,
    ]),
    horario: JSON.stringify(config.horario),
    instrucoes: JSON.stringify(config.instrucoes),
  };
}

export function PainelDoAgente({
  dados,
  abaInicial,
  acoes = acoesDoAgente,
}: {
  dados: DadosDoPainel;
  abaInicial?: string;
  /** As Server Actions (os testes trocam). */
  acoes?: AcoesDoAgente;
}) {
  const [aba, setAba] = useState<AbaDoAgente>(() =>
    abaDoAgente(abaInicial, dados.superAdmin),
  );
  const [pendente, startTransition] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);
  const [erroDaPublicacao, setErroDaPublicacao] = useState<{
    texto: string;
    problemas: ProblemaDaPublicacao[];
  } | null>(null);
  // Os formularios com texto digitado e nao salvo (cada um avisa).
  const [naoSalvos, setNaoSalvos] = useState(NADA_NAO_SALVO);
  // Descartar remonta o formulario (a chave muda) com o que esta salvo.
  const [geracao, setGeracao] = useState(GERACAO_INICIAL);
  const avisos = useMemo(() => {
    const avisar =
      (formulario: FormularioDoAgente): AvisarNaoSalvo =>
      (naoSalvo) =>
        setNaoSalvos((atuais) =>
          atuais[formulario] === naoSalvo
            ? atuais
            : { ...atuais, [formulario]: naoSalvo },
        );
    return {
      persona: avisar("persona"),
      conhecimento: avisar("conhecimento"),
      regras: avisar("regras"),
      instrucoes: avisar("instrucoes"),
    } satisfies Record<FormularioDoAgente, AvisarNaoSalvo>;
  }, []);

  const { config, publicada, base, podeEditar, superAdmin } = dados;
  const dica = dados.dicaSemPermissao;
  const configComBase = { ...config, base: base ?? config.base };
  // Sem rascunho gravado nao ha o que publicar (publicar_agente publica o
  // rascunho): a primeira versao nasce quando algo e salvo. As instrucoes
  // nunca sao comparadas aqui (a publicada chega sem o texto): a linha delas
  // e a do servidor, e sem ela ("nao conferido") nada e inventado.
  const mudancas = dados.temRascunho
    ? comMudancaDasInstrucoes(
        diferencasDoRascunho({ ...configComBase, instrucoes: null }, publicada),
        dados.instrucoesMudaram,
      )
    : [];
  const problemas = base === null ? [] : problemasDaPublicacao(configComBase);
  const ultimaPublicada = dados.versoes?.find((versao) => versao.emUso) ?? null;
  const chaves = chavesDosFormularios(config);
  const pendentes = formulariosNaoSalvos(naoSalvos, superAdmin);

  const descartarNaoSalvos = () => {
    setGeracao((atuais) => geracaoDepoisDeDescartar(atuais, pendentes));
    setNaoSalvos(NADA_NAO_SALVO);
  };

  const trocarAba = (valor: string) => {
    const nova = abaDoAgente(valor, superAdmin);
    setAba(nova);
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("aba", nova);
      window.history.replaceState(null, "", `?${params.toString()}`);
    } catch {
      // Sem a URL a aba continua trocada; so o link direto nao acompanha.
    }
  };

  const executar = (
    qual: string,
    tarefa: () => Promise<ResultadoDaAcao>,
    sucesso: string,
    retorno: RetornoDaAcao = {},
  ) => {
    setResultado(null);
    setAcao(qual);
    startTransition(async () => {
      let r: ResultadoDaAcao;
      try {
        r = await tarefa();
      } catch {
        r = { ok: false, erro: T.semResposta };
      }
      if (r.ok) {
        // A acao chama revalidatePath("/agente"): a pagina volta com os
        // dados novos na mesma resposta, sem outra ida ao servidor.
        toast.success(sucesso);
        retorno.seDerCerto?.();
        return;
      }
      toast.error(r.erro);
      if (retorno.seFalhar) {
        retorno.seFalhar(r.erro);
      } else {
        setResultado(r.erro);
      }
    });
  };
  const ocupado = (qual: string) => pendente && acao === qual;

  const publicar = () => {
    setErroDaPublicacao(null);
    setResultado(null);
    setAcao("publicar");
    startTransition(async () => {
      let r: ResultadoDaPublicacao;
      try {
        r = await acoes.publicar();
      } catch {
        r = { ok: false, erro: T.semResposta, problemas: [] };
      }
      if (r.ok) {
        toast.success(T.publicado);
        setPublicando(false);
        return;
      }
      toast.error(r.erro);
      setErroDaPublicacao({ texto: r.erro, problemas: r.problemas });
    });
  };

  const motivoParaNaoPublicar = !podeEditar
    ? (dica ?? T.semPermissao)
    : base === null
      ? T.baseSemLeitura
      : !dados.temRascunho
        ? T.semRascunho
        : mudancas.length === 0
          ? T.nadaParaPublicar
          : null;

  const botaoConfirmar = (desabilitado: boolean) => (
    <Button
      variant="solid"
      disabled={desabilitado}
      aria-busy={ocupado("publicar") || undefined}
      onClick={publicar}
    >
      <Check aria-hidden />
      {ocupado("publicar") ? T.publicando : "Publicar"}
    </Button>
  );

  const botaoPublicar = (
    <Button
      size="lg"
      disabled={motivoParaNaoPublicar !== null || pendente}
      aria-busy={ocupado("publicar") || undefined}
      onClick={() => {
        setErroDaPublicacao(null);
        setPublicando(true);
      }}
    >
      <Check aria-hidden />
      {ocupado("publicar") ? T.publicando : T.publicar}
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      {dica ? (
        <Aviso tom="info" role="note">
          Você vê a configuração do assistente sem alterar. {dica}.
        </Aviso>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <div className="grid min-w-0 gap-4">
          {/* Sempre montada: o leitor de tela anuncia o erro novo. */}
          <div aria-live="polite" aria-atomic="true" className="grid gap-2">
            {resultado ? (
              <Aviso tom="alert" role="note">
                {resultado}
              </Aviso>
            ) : null}
          </div>

          <Tabs value={aba} onValueChange={trocarAba} className="gap-4">
            <TabsList aria-label="Configuração do assistente">
              {abasVisiveis(superAdmin).map((item) => (
                <TabsTrigger key={item.chave} value={item.chave}>
                  {item.rotulo}
                  {item.chave === "conhecimento" && base ? (
                    <>
                      {" "}
                      <TabsCount>
                        <span aria-hidden>{base.length}</span>
                        <span className="sr-only">{base.length} perguntas</span>
                      </TabsCount>
                    </>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent
              value="persona"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <AbaPersona
                key={`${chaves.persona}:${geracao.persona}`}
                config={config}
                podeEditar={podeEditar}
                dica={dica}
                pendente={pendente}
                salvando={ocupado("persona")}
                aoSalvar={(persona, retorno) =>
                  executar(
                    "persona",
                    () => acoes.salvarPersona(persona),
                    T.personaSalva,
                    retorno,
                  )
                }
                aoMudarNaoSalvo={avisos.persona}
              />
            </TabsContent>

            <TabsContent
              value="habilidades"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <AbaHabilidades
                habilidades={config.habilidades}
                podeEditar={podeEditar}
                dica={dica}
                pendente={pendente}
                ocupado={(chave) => ocupado(`habilidade-${chave}`)}
                aoAlternar={(proximas, habilidade) =>
                  executar(
                    `habilidade-${habilidade.chave}`,
                    () => acoes.salvarHabilidades(proximas),
                    proximas[habilidade.chave]
                      ? T.habilidadeLigada(habilidade.titulo)
                      : T.habilidadeDesligada(habilidade.titulo),
                  )
                }
              />
            </TabsContent>

            <TabsContent
              value="conhecimento"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <AbaConhecimento
                key={geracao.conhecimento}
                base={base}
                podeEditar={podeEditar}
                dica={dica}
                pendente={pendente}
                ocupado={ocupado}
                acoes={{
                  aoSalvar: (item, retorno) =>
                    executar(
                      `salvar-${item.id ?? "nova"}`,
                      () => acoes.salvarItemDaBase(item),
                      item.id ? T.perguntaSalva : T.perguntaCriada,
                      retorno,
                    ),
                  aoAtivar: (item, ativo) =>
                    executar(
                      `ativar-${item.id}`,
                      () => acoes.ativarItemDaBase(item.id, ativo),
                      ativo ? T.perguntaAtivada : T.perguntaDesativada,
                    ),
                  aoExcluir: (item, retorno) =>
                    executar(
                      `excluir-${item.id}`,
                      () => acoes.excluirItemDaBase(item.id),
                      T.perguntaExcluida,
                      retorno,
                    ),
                }}
                aoMudarNaoSalvo={avisos.conhecimento}
              />
            </TabsContent>

            <TabsContent
              value="regras"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <AbaRegras
                key={`${chaves.horario}:${geracao.regras}`}
                horario={config.horario}
                podeEditar={podeEditar}
                dica={dica}
                pendente={pendente}
                salvando={ocupado("horario")}
                aoSalvar={(horario, retorno) =>
                  executar(
                    "horario",
                    () => acoes.salvarHorario(horario),
                    T.horarioSalvo,
                    retorno,
                  )
                }
                aoMudarNaoSalvo={avisos.regras}
              />
            </TabsContent>

            {superAdmin ? (
              <TabsContent
                value="instrucoes"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <AbaInstrucoes
                  key={`${chaves.instrucoes}:${geracao.instrucoes}`}
                  instrucoes={config.instrucoes}
                  previa={dados.previaDoPrompt}
                  pendente={pendente}
                  salvando={ocupado("instrucoes")}
                  aoSalvar={(entrada, retorno) =>
                    executar(
                      "instrucoes",
                      () => acoes.salvarInstrucoes(entrada),
                      T.instrucoesSalvas,
                      retorno,
                    )
                  }
                  aoMudarNaoSalvo={avisos.instrucoes}
                />
              </TabsContent>
            ) : null}

            <TabsContent
              value="versoes"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <AbaVersoes
                versoes={dados.versoes}
                mudancasDoRascunho={
                  dados.versoes && dados.versoes.length > 0 ? mudancas : []
                }
                timezone={dados.timezone}
                podeEditar={podeEditar}
                dica={dica}
                pendente={pendente}
                ocupado={ocupado}
                aoRestaurar={(versao, retorno) =>
                  executar(
                    `restaurar-${versao}`,
                    () => acoes.restaurarVersao(versao),
                    T.restaurada(versao),
                    retorno,
                  )
                }
              />
            </TabsContent>
          </Tabs>
        </div>

        <Simulador
          className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-14rem)]"
          nomeDoAssistente={config.nome}
          podeUsar={podeEditar}
          dica={dica}
          motivo={dados.motivoDoSimulador}
          aoSimular={acoes.simular}
        />
      </div>

      {/* Rodape fixo: a ultima publicada, o contador e o unico lime da
          tela. mt-auto: no pe da area de conteudo nas abas curtas. */}
      <footer
        aria-label="Publicação"
        className="sticky bottom-0 z-20 -mx-6 mt-auto -mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-card px-6 py-3"
      >
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[13.5px] font-bold text-text-strong">
            {textoDasAlteracoes(mudancas.length)}
          </span>
          <span className="text-xs text-text-secondary">
            {textoDaUltimaPublicada(
              ultimaPublicada,
              publicada?.versao ?? null,
              dados.timezone,
            )}
          </span>
        </div>
        <div className="ml-auto">
          {motivoParaNaoPublicar ? (
            <DisabledWithHint hint={motivoParaNaoPublicar}>
              {botaoPublicar}
            </DisabledWithHint>
          ) : (
            botaoPublicar
          )}
        </div>
      </footer>

      <Dialog
        open={publicando}
        onOpenChange={(aberto) =>
          !aberto && !pendente ? setPublicando(false) : null
        }
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {mudancas.length === 1
                ? "Publicar 1 alteração?"
                : `Publicar ${mudancas.length} alterações?`}
            </DialogTitle>
            <DialogDescription>{T.publicarDescricao}</DialogDescription>
          </DialogHeader>
          <ul className="grid cz-scroll max-h-56 list-disc gap-0.5 overflow-y-auto pl-5 text-[13px]">
            {mudancas.map((mudanca, indice) => (
              <li key={`${mudanca.campo}-${indice}`} className="break-words">
                {mudanca.rotulo}
              </li>
            ))}
          </ul>
          <ProblemasDaPublicacao
            problemas={
              erroDaPublicacao?.problemas.length
                ? erroDaPublicacao.problemas
                : problemas
            }
          />
          {erroDaPublicacao && erroDaPublicacao.problemas.length === 0 ? (
            <Aviso tom="alert" role="alert">
              {erroDaPublicacao.texto}
            </Aviso>
          ) : null}
          <NaoSalvosNoPublicar
            abas={pendentes.map(rotuloDoFormulario)}
            pendente={pendente}
            aoDescartar={descartarNaoSalvos}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pendente}
              onClick={() => setPublicando(false)}
            >
              Cancelar
            </Button>
            {pendentes.length > 0 ? (
              <DisabledWithHint hint={T.publicarSemSalvar}>
                {botaoConfirmar(true)}
              </DisabledWithHint>
            ) : (
              botaoConfirmar(pendente || problemas.length > 0)
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * O que foi digitado e nao salvo, no dialogo de publicar: a publicacao leva
 * so o que esta gravado, entao a pessoa salva na aba ou descarta aqui.
 */
export function NaoSalvosNoPublicar({
  abas,
  pendente,
  aoDescartar,
}: {
  abas: readonly string[];
  pendente: boolean;
  aoDescartar: () => void;
}) {
  if (abas.length === 0) {
    return null;
  }
  return (
    <Aviso tom="warning" role="alert" titulo={T.naoSalvasTitulo}>
      <p>{T.naoSalvasTexto(listaEmTexto(abas))}</p>
      <Button
        variant="outline"
        className="mt-2"
        disabled={pendente}
        onClick={aoDescartar}
      >
        {T.descartarNaoSalvas}
      </Button>
    </Aviso>
  );
}

/** O que precisa mudar antes de publicar, com onde esta cada problema. */
export function ProblemasDaPublicacao({
  problemas,
}: {
  problemas: readonly ProblemaDaPublicacao[];
}) {
  if (problemas.length === 0) {
    return null;
  }
  return (
    <Aviso tom="alert" role="alert" titulo={T.conferirAntes}>
      <ul className="grid list-disc gap-1 pl-4">
        {problemas.map((problema, indice) => (
          <li
            key={`${problema.campo}-${problema.itemId ?? ""}-${indice}`}
            className="break-words"
          >
            <span className="font-semibold">{problema.rotulo}:</span>{" "}
            {problema.mensagem}
          </li>
        ))}
      </ul>
    </Aviso>
  );
}
