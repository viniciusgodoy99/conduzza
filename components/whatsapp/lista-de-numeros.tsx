"use client";

import {
  FlaskConical,
  MessageCircle,
  Plus,
  Trash2,
  Unplug,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  adicionarNumeroAction,
  atualizarNumeroAction,
  definirNumeroPrincipalAction,
  disconnectWhatsAppAction,
  removerNumeroAction,
} from "@/lib/actions/whatsapp-connect";

import { CartaoDoNumero } from "./cartao-do-numero";
import { OrientacaoDoWhatsappBusiness } from "./connect-client";
import {
  DialogoDeConexao,
  DialogoDeConfirmacao,
  DialogoDoFormulario,
  type DadosDoNumero,
} from "./dialogos-do-numero";
import {
  DICA_SEM_UNIDADES,
  DICA_UNIDADES_NAO_CARREGADAS,
  dicaDoLimite,
  limiteAtingido,
  motivoParaNaoRemover,
  nomeDaUnidade,
  textoDaRemocao,
  unidadesParaEscolher,
  type NumeroDoWhatsapp,
  type UnidadeDaClinica,
} from "./numeros";

// Aba de WhatsApp das Configuracoes com VARIOS numeros (docs/07, Telas; kit
// ScreenConfig): um cartao por numero ativo e, no fim, o cartao de adicionar.
// Cada numero e um WhatsApp separado, com o proprio QR e a propria situacao.
//
// Quem pode o que (D8): administrador e gestor conectam, desconectam,
// adicionam, renomeiam, escolhem a unidade e o principal; remover e so do
// administrador. A tela desabilita com a dica, e a acao confere de novo no
// servidor (esconder ou desabilitar botao nao protege nada).
//
// Depois de cada acao, router.refresh() traz a lista nova do servidor; as
// acoes tambem revalidam /configuracoes.

type Alvo =
  | { tipo: "adicionar" }
  | {
      tipo: "conectar";
      numero: NumeroDoWhatsapp;
      conectarAoAbrir: boolean;
    }
  | { tipo: "renomear"; numero: NumeroDoWhatsapp }
  | { tipo: "unidade"; numero: NumeroDoWhatsapp }
  | { tipo: "remover"; numero: NumeroDoWhatsapp }
  | { tipo: "desconectar"; numero: NumeroDoWhatsapp };

export type ListaDeNumerosProps = {
  /** os numeros ATIVOS da clinica, o principal primeiro */
  numeros: NumeroDoWhatsapp[];
  /** as unidades da clinica; nulo: a leitura falhou */
  unidades: UnidadeDaClinica[] | null;
  /** o numero fixo das mensagens automaticas (modo fixo), se houver */
  contaFixaId: string | null;
  /** clinic.limite_de_numeros; nulo = sem limite (o padrao) */
  limite: number | null;
  /** administrador ou gestor */
  podeGerenciar: boolean;
  ehAdmin: boolean;
  /** dica de quem nao gerencia */
  dica: string;
  /** provedor com que um numero novo nasce; nulo = canal nao configurado */
  providerDoAmbiente: string | null;
  /** fuso da clinica */
  timezone: string;
};

export function ListaDeNumeros({
  numeros,
  unidades,
  contaFixaId,
  limite,
  podeGerenciar,
  ehAdmin,
  dica,
  providerDoAmbiente,
  timezone,
}: ListaDeNumerosProps) {
  const router = useRouter();
  // `alvo` fica guardado depois de fechar: o dialogo que sai ainda mostra o
  // numero dele durante a animacao de saida.
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const abrir = (proximo: Alvo) => {
    setAlvo(proximo);
    setAberto(true);
  };
  const fechar = () => setAberto(false);
  const recarregar = useCallback(() => router.refresh(), [router]);

  const total = numeros.length;
  const noLimite = limiteAtingido(total, limite);
  const listaDeUnidades = unidades ?? [];

  const motivoDaUnidade = (numero: NumeroDoWhatsapp): string | null => {
    if (unidades === null) {
      return DICA_UNIDADES_NAO_CARREGADAS;
    }
    return unidadesParaEscolher(unidades, numero.unitId).length === 0
      ? DICA_SEM_UNIDADES
      : null;
  };

  // ------------------------------------------------------------------------
  // Acoes
  // ------------------------------------------------------------------------

  const adicionar = async (dados: DadosDoNumero): Promise<string | null> => {
    const resultado = await adicionarNumeroAction({
      nome: dados.nome,
      unitId: dados.unitId,
    });
    if (!resultado.ok || !resultado.accountId) {
      return (
        resultado.error ?? "Não foi possível criar o número. Tente de novo."
      );
    }
    // "Criar e conectar": o dialogo de adicionar da lugar ao de conexao, que
    // ja comeca o pareamento do numero novo.
    abrir({
      tipo: "conectar",
      conectarAoAbrir: true,
      numero: {
        id: resultado.accountId,
        nome: dados.nome,
        principal: total === 0,
        unitId: dados.unitId,
        displayPhone: null,
        status: "desconectado",
        connectedAt: null,
        provider: providerDoAmbiente,
      },
    });
    recarregar();
    return null;
  };

  /**
   * Manda so o campo que o dialogo edita: sem `unitId` a unidade fica como
   * esta (renomear nao mexe nela) e sem `nome` o nome fica como esta (trocar
   * a unidade nao regrava o nome do retrato desta tela, que pode ter mudado
   * em outra aba).
   */
  const atualizar = async (
    numero: NumeroDoWhatsapp,
    dados: { nome?: string; unitId?: string | null },
    mensagem: string,
  ): Promise<string | null> => {
    const resultado = await atualizarNumeroAction({
      accountId: numero.id,
      ...dados,
    });
    if (!resultado.ok) {
      return (
        resultado.error ?? "Não foi possível salvar o número. Tente de novo."
      );
    }
    fechar();
    toast.success(mensagem);
    recarregar();
    return null;
  };

  const remover = async (numero: NumeroDoWhatsapp): Promise<string | null> => {
    const resultado = await removerNumeroAction(numero.id);
    if (!resultado.ok) {
      return (
        resultado.error ??
        "Não foi possível remover este número. Tente de novo."
      );
    }
    fechar();
    toast.success(`Número ${numero.nome} removido`);
    recarregar();
    return null;
  };

  const desconectar = async (
    numero: NumeroDoWhatsapp,
  ): Promise<string | null> => {
    const resultado = await disconnectWhatsAppAction(numero.id);
    if (resultado.error) {
      return resultado.error;
    }
    fechar();
    toast.success(`${numero.nome} desconectado`);
    recarregar();
    return null;
  };

  const tornarPrincipal = async (numero: NumeroDoWhatsapp) => {
    setOcupado(numero.id);
    try {
      const resultado = await definirNumeroPrincipalAction(numero.id);
      if (!resultado.ok) {
        toast.error(
          resultado.error ??
            "Não foi possível tornar este número o principal. Tente de novo.",
        );
        return;
      }
      toast.success(`${numero.nome} agora é o número principal`);
      recarregar();
    } finally {
      setOcupado(null);
    }
  };

  // ------------------------------------------------------------------------
  // Tela
  // ------------------------------------------------------------------------

  const dicaDeAdicionar = !podeGerenciar
    ? dica
    : noLimite && limite !== null
      ? dicaDoLimite(limite)
      : null;
  // No vazio, adicionar e a acao principal da tela (o unico lime); com
  // numeros, o cartao de adicionar fica secundario, ao lado dos outros.
  const adicionarProtegido = (principal: boolean) => {
    const botao = (
      <Button
        variant={principal ? "default" : "outline"}
        onClick={() => abrir({ tipo: "adicionar" })}
        disabled={dicaDeAdicionar !== null}
      >
        <Plus aria-hidden className="size-4" />
        Adicionar número
      </Button>
    );
    return dicaDeAdicionar === null ? (
      botao
    ) : (
      <DisabledWithHint hint={dicaDeAdicionar}>{botao}</DisabledWithHint>
    );
  };

  const demonstracao =
    numeros.some((numero) => numero.provider === "fake") ||
    (total === 0 && providerDoAmbiente === "fake");

  const numeroDoAlvo = alvo && alvo.tipo !== "adicionar" ? alvo.numero : null;

  return (
    <div className="grid gap-4">
      {providerDoAmbiente === null ? (
        <Aviso tom="alert" role="alert">
          O canal de WhatsApp não está configurado no servidor, então os números
          não conectam agora. Fale com o suporte.
        </Aviso>
      ) : null}
      {demonstracao ? (
        <Aviso tom="info" icone={FlaskConical}>
          Ambiente de demonstração: a conexão é simulada e nenhuma mensagem sai
          de verdade para o paciente.
        </Aviso>
      ) : null}

      {total === 0 ? (
        <Card>
          <EmptyState
            icon={MessageCircle}
            title="Nenhum número de WhatsApp ainda"
            description="Adicione o número que atende os pacientes e leia o QR code no celular para conectar."
          >
            {adicionarProtegido(true)}
          </EmptyState>
        </Card>
      ) : (
        <ul
          aria-label="Números de WhatsApp da clínica"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {numeros.map((numero) => (
            <li key={numero.id} className="min-w-0">
              <CartaoDoNumero
                numero={numero}
                unidade={nomeDaUnidade(numero.unitId, unidades)}
                fixoDasAutomaticas={contaFixaId === numero.id}
                timezone={timezone}
                podeGerenciar={podeGerenciar}
                dica={dica}
                motivoParaNaoRemover={motivoParaNaoRemover(numero, {
                  ehAdmin,
                  totalAtivos: total,
                  contaFixaId,
                })}
                motivoParaNaoEscolherUnidade={motivoDaUnidade(numero)}
                ocupado={ocupado === numero.id}
                aoConectar={() =>
                  abrir({
                    tipo: "conectar",
                    numero,
                    // Pareamento em andamento: o dialogo so retoma a
                    // consulta (e o QR), sem pedir outro.
                    conectarAoAbrir: numero.status === "desconectado",
                  })
                }
                aoDesconectar={() => abrir({ tipo: "desconectar", numero })}
                aoRenomear={() => abrir({ tipo: "renomear", numero })}
                aoEscolherUnidade={() => abrir({ tipo: "unidade", numero })}
                aoTornarPrincipal={() => void tornarPrincipal(numero)}
                aoRemover={() => abrir({ tipo: "remover", numero })}
              />
            </li>
          ))}
          <li className="min-w-0">
            <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2.5 rounded-card border border-dashed border-border-heavy p-4 text-center">
              <span
                aria-hidden
                className="grid size-10 place-items-center rounded-md bg-primary-soft"
              >
                <Plus className="size-5 text-primary-text" />
              </span>
              {limite !== null ? (
                <p className="text-xs text-text-secondary">
                  <span className="cz-num">{total}</span> de{" "}
                  <span className="cz-num">{limite}</span>{" "}
                  {limite === 1 ? "número" : "números"} do plano
                </p>
              ) : null}
              {noLimite && limite !== null ? (
                <p className="max-w-[34ch] text-xs text-text-secondary">
                  {dicaDoLimite(limite)}
                </p>
              ) : null}
              {adicionarProtegido(false)}
            </div>
          </li>
        </ul>
      )}

      <OrientacaoDoWhatsappBusiness />

      <DialogoDoFormulario
        aberto={aberto && alvo?.tipo === "adicionar"}
        modo="adicionar"
        numero={null}
        unidades={listaDeUnidades}
        aoFechar={fechar}
        aoEnviar={adicionar}
      />
      <DialogoDoFormulario
        aberto={aberto && alvo?.tipo === "renomear"}
        modo="renomear"
        numero={alvo?.tipo === "renomear" ? alvo.numero : null}
        unidades={listaDeUnidades}
        aoFechar={fechar}
        aoEnviar={(dados) =>
          alvo?.tipo === "renomear"
            ? atualizar(
                alvo.numero,
                { nome: dados.nome },
                "Nome do número atualizado",
              )
            : Promise.resolve(null)
        }
      />
      <DialogoDoFormulario
        aberto={aberto && alvo?.tipo === "unidade"}
        modo="unidade"
        numero={alvo?.tipo === "unidade" ? alvo.numero : null}
        unidades={listaDeUnidades}
        aoFechar={fechar}
        aoEnviar={(dados) =>
          alvo?.tipo === "unidade"
            ? atualizar(
                alvo.numero,
                { unitId: dados.unitId },
                "Unidade do número atualizada",
              )
            : Promise.resolve(null)
        }
      />
      <DialogoDeConexao
        aberto={aberto && alvo?.tipo === "conectar"}
        numero={alvo?.tipo === "conectar" ? alvo.numero : null}
        conectarAoAbrir={alvo?.tipo === "conectar" && alvo.conectarAoAbrir}
        podeGerenciar={podeGerenciar}
        dica={dica}
        timezone={timezone}
        aoFechar={() => {
          fechar();
          recarregar();
        }}
        aoMudarDeSituacao={recarregar}
      />
      <DialogoDeConfirmacao
        aberto={aberto && alvo?.tipo === "remover"}
        aoFechar={fechar}
        titulo={`Remover o número ${numeroDoAlvo?.nome ?? ""}?`}
        descricao={numeroDoAlvo ? textoDaRemocao(numeroDoAlvo) : ""}
        rotulo="Remover número"
        rotuloPendente="Removendo..."
        icone={Trash2}
        aoConfirmar={() =>
          alvo?.tipo === "remover"
            ? remover(alvo.numero)
            : Promise.resolve(null)
        }
      />
      <DialogoDeConfirmacao
        aberto={aberto && alvo?.tipo === "desconectar"}
        aoFechar={fechar}
        titulo={`Desconectar ${numeroDoAlvo?.nome ?? ""}?`}
        descricao="Enquanto estiver desconectado, este número não recebe nem envia mensagens pelo Conduzza, e as mensagens automáticas dele esperam a reconexão."
        rotulo="Desconectar"
        rotuloPendente="Desconectando..."
        icone={Unplug}
        aoConfirmar={() =>
          alvo?.tipo === "desconectar"
            ? desconectar(alvo.numero)
            : Promise.resolve(null)
        }
      />
    </div>
  );
}
