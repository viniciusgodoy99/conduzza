"use client";

import { Check, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  removerTokenDeLeituraMetaAction,
  salvarTokenDeLeituraMetaAction,
  testarLeituraMetaAction,
  type ResultadoDoTesteDeLeitura,
} from "@/app/(app)/configuracoes/anuncios-meta-actions";
import { focoPerdido } from "@/components/cadastros/comum";
import {
  avisosDaConta,
  estadoDaLeituraMeta,
  leituraPausada,
  problemaGravadoNaTela,
  resultadoLocalVale,
  TEXTOS_DA_LEITURA,
  textoDoAtualizadoEm,
  textoDoAviso,
  textoDoGastoRecente,
  textoDoSucessoDoTeste,
  TOKEN_DE_LEITURA_VALIDO,
  type LeituraDoInvestimento,
} from "@/components/configuracoes/investimento-meta";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { atualizarInvestimentoMetaAction } from "@/lib/actions/investimento-meta";
import { LEITURA_META_STATUS, TOKEN_META_STATUS } from "@/lib/design/status";
import { textoDoProblemaDeLeitura } from "@/lib/domain/meta-anuncios";

// Cartao "Investimento nos anuncios" (Configuracoes, aba Anuncios da Meta;
// Fase 4, critica 4.4 e 4.5). Le quanto a clinica investiu nos anuncios,
// para o custo por lead em Resultados.
//
// - A conta de anuncios NAO se repete aqui: e a do cartao "Conta de
//   anuncios", recebida pronta (adAccountId).
// - O TOKEN E WRITE-ONLY: o campo sempre nasce vazio, o servidor so manda
//   se ele existe (temTokenDeLeitura) e salvar substitui. Campo de senha sem
//   o olho (decisao do plano: token da Meta sem olho).
// - "Salvar token" salva e testa em seguida; salva mesmo se o teste falhar.
// - "Atualizar agora" pede a leitura ao banco (10 minutos entre pedidos).
//   Enquanto o pedido e mais novo que a ultima tentativa do job, o chip diz
//   "Atualizando" e a tela recarrega a cada 5 s, por ate 2 minutos.
// - Toda acao fica visivel; sem permissao ou sem configuracao, desabilitada
//   com a dica do porque.
// - O resultado local de cada acao vale ate o job registrar tentativa nova
//   (resultadoLocalVale): o recarregamento do "Atualizando" nao remonta o
//   cartao, e a situacao gravada depois do pedido tem que aparecer.
// - Foco do teclado na confirmacao do "Remover token" (padrao de
//   components/cadastros/comum.tsx): ela recebe o foco ao aparecer e, ao
//   cancelar ou quando a remocao falha, o foco volta ao "Remover token".

const RECARREGAR_A_CADA_MS = 5_000;
const VOLTAS_DE_RECARGA = 24;

type ResultadoNaTela = {
  tom: "success" | "info" | "warning" | "alert";
  titulo?: string;
  texto: string;
};

/** O resultado guardado com a ultima tentativa do job na tela quando ele chegou. */
type ResultadoGuardado = ResultadoNaTela & { tentadoEmBase: string | null };

export type Acao = "salvar" | "testar" | "atualizar" | "remover";

const ROTULO_EM_ANDAMENTO: Record<Acao, string> = {
  salvar: "Salvando...",
  testar: "Testando...",
  atualizar: "Pedindo...",
  remover: "Removendo...",
};

/** O que a regiao do resultado mostra depois de salvar ou testar. */
export function resultadoDoTesteNaTela(
  resultado: ResultadoDoTesteDeLeitura,
): ResultadoNaTela {
  if (resultado.ok) {
    const partes = [
      textoDoSucessoDoTeste(resultado.conta),
      textoDoGastoRecente(resultado.temGasto),
    ];
    if (resultado.leituraPedida) {
      partes.push(TEXTOS_DA_LEITURA.leituraPedida);
    }
    return { tom: "success", texto: partes.join(" ") };
  }
  if (resultado.problema) {
    return {
      tom: "alert",
      titulo: resultado.tokenSalvo
        ? TEXTOS_DA_LEITURA.tokenSalvoComFalha
        : undefined,
      texto: resultado.error,
    };
  }
  return {
    tom: resultado.tokenSalvo ? "warning" : "alert",
    texto: resultado.error,
  };
}

const ERROS_DO_PEDIDO: readonly string[] = [
  TEXTOS_DA_LEITURA.atualizacaoNaoPedida,
  TEXTOS_DA_LEITURA.semPermissao,
  TEXTOS_DA_LEITURA.sessaoExpirada,
];

/**
 * A dica de cada botao desabilitado (nula = botao liberado): a permissao
 * primeiro, depois o que falta. Exportada para o teste, porque a dica so
 * aparece no HTML quando o tooltip abre.
 */
export function dicasDoCartao(entrada: {
  podeGerenciar: boolean;
  dica: string;
  tokenDigitado: string;
  configurada: boolean;
  pausada: boolean;
  atualizando: boolean;
  temTokenDeLeitura: boolean;
}): Record<Acao, string | null> {
  if (!entrada.podeGerenciar) {
    return {
      salvar: entrada.dica,
      testar: entrada.dica,
      atualizar: entrada.dica,
      remover: entrada.dica,
    };
  }
  const token = entrada.tokenDigitado.trim();
  return {
    salvar: TOKEN_DE_LEITURA_VALIDO.test(token)
      ? null
      : token === ""
        ? TEXTOS_DA_LEITURA.tokenVazio
        : TEXTOS_DA_LEITURA.tokenInvalido,
    testar: entrada.configurada ? null : TEXTOS_DA_LEITURA.semConfiguracao,
    atualizar: !entrada.configurada
      ? TEXTOS_DA_LEITURA.semConfiguracao
      : entrada.pausada
        ? TEXTOS_DA_LEITURA.pausada
        : entrada.atualizando
          ? TEXTOS_DA_LEITURA.atualizacaoEmAndamento
          : null,
    remover: entrada.temTokenDeLeitura
      ? null
      : "Não há token de leitura salvo.",
  };
}

function comDica(botao: React.ReactNode, dica: string | null) {
  return dica ? <DisabledWithHint hint={dica}>{botao}</DisabledWithHint> : botao;
}

export type InvestimentoMetaCardProps = {
  /** A conta salva no cartao "Conta de anuncios" (act_...), ou nula. */
  adAccountId: string | null;
  temTokenDeLeitura: boolean;
  /** A situacao gravada; nula enquanto nunca houve token nem teste. */
  leitura: LeituraDoInvestimento | null;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  timezone: string;
  /** Instante da renderizacao no servidor (ms), para o "Atualizando". */
  agoraMs: number;
  podeGerenciar: boolean;
  dica: string;
};

export function InvestimentoMetaCard({
  adAccountId,
  temTokenDeLeitura,
  leitura,
  timezone,
  agoraMs,
  podeGerenciar,
  dica,
}: InvestimentoMetaCardProps) {
  const router = useRouter();
  const ids = useId();
  const tituloId = `${ids}-titulo`;
  const campoId = `${ids}-token`;
  const ajudaId = `${ids}-ajuda`;
  const confirmacaoId = `${ids}-confirmacao`;

  const [token, setToken] = useState("");
  const [acao, setAcao] = useState<Acao | null>(null);
  const [resultado, setResultado] = useState<ResultadoGuardado | null>(null);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [pendente, startTransition] = useTransition();

  // A ultima tentativa do job ja na tela. Cada resultado local guarda a dele:
  // tentativa mais nova depois disso tira o resultado de cena.
  const tentadoEmAtual = leitura?.tentadoEm ?? null;
  const tentadoEmNaTela = useRef(tentadoEmAtual);
  useEffect(() => {
    tentadoEmNaTela.current = tentadoEmAtual;
  }, [tentadoEmAtual]);
  const mostrar = (novo: ResultadoNaTela) =>
    setResultado({ ...novo, tentadoEmBase: tentadoEmNaTela.current });

  // Foco do teclado na confirmacao inline: o "Remover token" sai da tela com
  // o foco. A confirmacao recebe o foco ao aparecer (no grupo, nao no
  // "Remover": um Enter repetido nao remove nada sem leitura). Ao cancelar,
  // ou se a remocao falhar, o foco volta ao "Remover token" habilitado. Tudo
  // so quando o foco se perdeu: quem ja esta em outro campo fica onde esta.
  const grupoDaConfirmacao = useRef<HTMLDivElement>(null);
  const botaoRemoverToken = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);
  useEffect(() => {
    if (confirmandoRemocao) {
      if (focoPerdido()) {
        grupoDaConfirmacao.current?.focus();
      }
      return;
    }
    if (pendente || !devolverFoco.current) {
      return;
    }
    devolverFoco.current = false;
    const botao = botaoRemoverToken.current;
    if (botao && !botao.disabled && focoPerdido()) {
      botao.focus();
    }
  }, [confirmandoRemocao, pendente]);

  const estado = estadoDaLeituraMeta({
    adAccountId,
    temTokenDeLeitura,
    leitura,
    agoraMs,
  });
  const configurada = Boolean(adAccountId) && temTokenDeLeitura;
  const pausada = leituraPausada(leitura);
  const atualizando = estado === "atualizando";
  const funcionando = leitura?.situacao === "funcionando";
  const tokenDigitado = token.trim();

  // "Atualizando": o motor roda a cada 20 s; a tela confere a cada 5 s, por
  // ate 2 minutos. A aba fechada desmonta o cartao e para a conferencia.
  useEffect(() => {
    if (estado !== "atualizando") {
      return;
    }
    let voltas = 0;
    const id = window.setInterval(() => {
      voltas += 1;
      router.refresh();
      if (voltas >= VOLTAS_DE_RECARGA) {
        window.clearInterval(id);
      }
    }, RECARREGAR_A_CADA_MS);
    return () => window.clearInterval(id);
  }, [estado, router]);

  const executar = (qual: Acao, tarefa: () => Promise<void>) => {
    setResultado(null);
    setAcao(qual);
    startTransition(async () => {
      try {
        await tarefa();
      } catch {
        mostrar({ tom: "alert", texto: TEXTOS_DA_LEITURA.semResposta });
      }
    });
  };

  const salvarToken = () =>
    executar("salvar", async () => {
      const r = await salvarTokenDeLeituraMetaAction({
        insights_access_token: tokenDigitado,
      });
      if (r.ok || r.tokenSalvo) {
        setToken("");
        toast.success("Token salvo. Ele não aparece de novo por segurança.");
      }
      mostrar(resultadoDoTesteNaTela(r));
    });

  const testar = () =>
    executar("testar", async () => {
      mostrar(resultadoDoTesteNaTela(await testarLeituraMetaAction()));
    });

  const atualizar = () =>
    executar("atualizar", async () => {
      const r = await atualizarInvestimentoMetaAction();
      if (!r.ok) {
        mostrar({
          tom: ERROS_DO_PEDIDO.includes(r.error) ? "alert" : "warning",
          texto: r.error,
        });
        return;
      }
      mostrar({
        tom: "info",
        texto:
          r.codigo === "ja_na_fila"
            ? TEXTOS_DA_LEITURA.atualizacaoEmAndamento
            : TEXTOS_DA_LEITURA.atualizacaoPedida,
      });
    });

  const remover = () =>
    executar("remover", async () => {
      const r = await removerTokenDeLeituraMetaAction();
      // Removido, o botao volta desabilitado e o resultado e anunciado pela
      // regiao aria-live; sem remover, o foco volta ao "Remover token".
      devolverFoco.current = !r.ok;
      setConfirmandoRemocao(false);
      mostrar(
        r.ok
          ? { tom: "success", texto: TEXTOS_DA_LEITURA.tokenRemovido }
          : { tom: "alert", texto: r.error },
      );
    });

  const rotulo = (qual: Acao, padrao: string) =>
    pendente && acao === qual ? ROTULO_EM_ANDAMENTO[qual] : padrao;
  const ocupado = (qual: Acao) => pendente && acao === qual;

  const {
    salvar: dicaDoSalvar,
    testar: dicaDoTestar,
    atualizar: dicaDoAtualizar,
    remover: dicaDoRemover,
  } = dicasDoCartao({
    podeGerenciar,
    dica,
    tokenDigitado,
    configurada,
    pausada,
    atualizando,
    temTokenDeLeitura,
  });

  const botaoSalvar = (
    <Button
      variant="outline"
      onClick={salvarToken}
      disabled={dicaDoSalvar !== null || pendente}
      aria-busy={ocupado("salvar") || undefined}
    >
      <Check aria-hidden />
      {rotulo("salvar", "Salvar token")}
    </Button>
  );
  const botaoTestar = (
    <Button
      variant="outline"
      onClick={testar}
      disabled={dicaDoTestar !== null || pendente}
      aria-busy={ocupado("testar") || undefined}
    >
      {rotulo("testar", "Testar leitura")}
    </Button>
  );
  const botaoAtualizar = (
    <Button
      variant="outline"
      onClick={atualizar}
      disabled={dicaDoAtualizar !== null || pendente}
      aria-busy={ocupado("atualizar") || undefined}
    >
      <RefreshCw
        aria-hidden
        className={ocupado("atualizar") ? "motion-safe:animate-spin" : undefined}
      />
      {rotulo("atualizar", "Atualizar agora")}
    </Button>
  );
  const botaoRemover = (
    <Button
      ref={botaoRemoverToken}
      variant="ghost"
      className="text-alert-text hover:text-alert-text"
      onClick={() => setConfirmandoRemocao(true)}
      disabled={dicaDoRemover !== null || pendente}
      aria-busy={ocupado("remover") || undefined}
    >
      <Trash2 aria-hidden />
      {rotulo("remover", "Remover token")}
    </Button>
  );

  // O resultado local so vale ate o job registrar tentativa nova; depois
  // disso a situacao gravada e a mais recente e o problema dela aparece.
  const resultadoVigente =
    resultado !== null &&
    resultadoLocalVale({
      tentadoEmBase: resultado.tentadoEmBase,
      tentadoEmAtual,
    })
      ? resultado
      : null;
  const problemaGravado = problemaGravadoNaTela({
    temResultadoVigente: resultadoVigente !== null,
    estado,
    leitura,
  });

  // Conta lida e avisos so com a leitura funcionando: depois de trocar de
  // conta, o nome e a moeda gravados ainda sao os da conta antiga.
  const avisos =
    funcionando && leitura
      ? avisosDaConta(
          {
            moeda: leitura.moeda,
            fuso: leitura.fusoDaConta,
            ativa: leitura.contaAtiva,
          },
          timezone,
          agoraMs,
        )
      : [];
  const contaLida =
    funcionando && leitura && leitura.moeda
      ? `Conta lida: ${leitura.nomeDaConta ?? adAccountId ?? "sem nome"} · ${leitura.moeda}`
      : null;
  const atualizadoEm =
    textoDoAtualizadoEm(leitura?.sincronizadoEm ?? null, timezone) ??
    (configurada ? TEXTOS_DA_LEITURA.semLeitura : null);

  return (
    <Card role="region" aria-labelledby={tituloId}>
      <CardHeader>
        <CardTitle id={tituloId}>Investimento nos anúncios</CardTitle>
        <CardDescription>
          Quanto a clínica investiu nos anúncios, para o custo por lead em
          Resultados. A leitura usa a conta de anúncios do cartão ao lado e
          roda sozinha todo dia de manhã.
        </CardDescription>
        <CardAction>
          <StatusChip size="sm" definition={LEITURA_META_STATUS[estado]} />
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
            <Label htmlFor={campoId}>Token de leitura de anúncios</Label>
            <StatusChip
              size="sm"
              definition={
                TOKEN_META_STATUS[temTokenDeLeitura ? "salvo" : "ausente"]
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              id={campoId}
              type="password"
              value={token}
              onChange={(evento) => setToken(evento.target.value)}
              placeholder={
                temTokenDeLeitura
                  ? "Cole um novo token para substituir"
                  : "Cole o token aqui"
              }
              aria-describedby={ajudaId}
              className="min-w-0 flex-1 font-mono"
              disabled={!podeGerenciar}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore=""
              data-lpignore="true"
            />
            {comDica(botaoSalvar, dicaDoSalvar)}
          </div>
          <p id={ajudaId} className="text-[11px] text-text-secondary">
            Pode ser o mesmo token da API de conversões, se ele tiver a
            permissão ads_read e acesso à conta de anúncios. O recomendado é um
            token de usuário do sistema, só com ads_read e sem validade: no
            Gerenciador de Negócios, em Usuários do sistema, dê acesso à conta
            de anúncios e gere o token (é preciso um aplicativo da Meta no
            Gerenciador). Por segurança, o token salvo nunca é mostrado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {comDica(botaoTestar, dicaDoTestar)}
          {confirmandoRemocao
            ? null
            : comDica(botaoRemover, dicaDoRemover)}
        </div>

        {confirmandoRemocao ? (
          <div
            ref={grupoDaConfirmacao}
            tabIndex={-1}
            role="group"
            aria-label="Confirmar a remoção do token de leitura"
            aria-describedby={confirmacaoId}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-alert-bg px-3.5 py-3 text-alert-text"
          >
            <p id={confirmacaoId} className="min-w-0 flex-1 text-[13px]">
              Remover o token de leitura? A leitura diária para, e o
              investimento já lido continua guardado.
            </p>
            <Button
              variant="destructive"
              onClick={remover}
              disabled={pendente}
              aria-busy={ocupado("remover") || undefined}
            >
              {rotulo("remover", "Remover")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                devolverFoco.current = true;
                setConfirmandoRemocao(false);
              }}
              disabled={pendente}
            >
              Cancelar
            </Button>
          </div>
        ) : null}

        {/* Sempre montada: o leitor de tela anuncia o resultado novo. */}
        <div aria-live="polite" aria-atomic="true" className="grid gap-2 empty:-mt-3">
          {resultadoVigente ? (
            <Aviso
              tom={resultadoVigente.tom}
              role="note"
              titulo={resultadoVigente.titulo}
            >
              {resultadoVigente.texto}
            </Aviso>
          ) : null}
        </div>

        {problemaGravado ? (
          <Aviso
            tom="alert"
            role="note"
            titulo={
              pausada
                ? "A leitura diária está parada."
                : "A última leitura teve problema."
            }
          >
            {textoDoProblemaDeLeitura(problemaGravado, {
              adAccountId,
              codigo: leitura?.codigoDaMeta ?? null,
            })}
          </Aviso>
        ) : null}

        {contaLida ? (
          <p className="text-[13px] text-text-secondary">{contaLida}</p>
        ) : null}

        {avisos.map((aviso) => (
          <Aviso key={aviso} tom="warning" role="note">
            {textoDoAviso(aviso, {
              moeda: leitura?.moeda ?? null,
              fuso: leitura?.fusoDaConta ?? null,
            })}
          </Aviso>
        ))}
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-2">
        <p className="min-w-0 text-[13px] text-text-secondary">
          {atualizadoEm}
        </p>
        {comDica(botaoAtualizar, dicaDoAtualizar)}
      </CardFooter>
    </Card>
  );
}
