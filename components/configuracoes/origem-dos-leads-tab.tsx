"use client";

import { Pencil, Plus, RotateCcw, Signpost, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  ativarRegraDeOrigemAction,
  desativarRegraDeOrigemAction,
  excluirRegraDeOrigemAction,
} from "@/app/(app)/configuracoes/regras-de-origem-actions";
import { DialogoDaOrigem } from "@/components/configuracoes/dialogo-da-origem";
import { LinkParaABio } from "@/components/configuracoes/link-para-a-bio";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RECORD_STATUS } from "@/lib/design/status";
import {
  fraseDoTeste,
  LIMITE_DE_ORIGENS_ATIVAS,
  recusaDoLimite,
  testarMensagem,
  textoDoCanalDaRegra,
  textoDoReconhecimento,
  type NumeroParaOLink,
  type RegraDeOrigem,
} from "@/lib/domain/regras-de-origem";
import { cn } from "@/lib/utils";

// Aba "Origem dos leads" de Configuracoes (onda 5, item 17; P17-1 do dono:
// logo depois de Anuncios do Google). Quando o lead chega por um link da
// clinica (bio do Instagram, perfil no Google, QR code, parceiro), o sistema
// reconhece a origem pela mensagem pronta do link, por um codigo no link ou
// por uma palavra-chave na primeira mensagem (a decisao e da ingestao,
// lib/domain/attribution.ts). Administrador e gestor criam, editam, ativam,
// desativam e excluem; o Implementador entra como administrador; os demais
// papeis nem chegam a Configuracoes. Sem permissao, tudo fica visivel e
// desabilitado, com a dica.
//
// Estados: carregando (esqueleto da lista, ao tentar de novo), vazio,
// erro com "Tentar de novo" (a falha desta aba nunca derruba a tela) e a
// lista. Status em tres camadas (icone, rotulo e cor) pelo RECORD_STATUS
// ("Ativa" e "Desativada"), sem icone novo; os botoes Ativar e Desativar
// sao so texto, como em Cadastros e no Agente (CirclePause e do status).

export const TEXTOS_DA_ORIGEM = {
  descricaoDaAba:
    "Quando o lead chega por um link da clínica (a bio do Instagram, o perfil no Google, um QR code, um parceiro), o sistema reconhece a origem pela mensagem pronta do link, por um código no link ou por uma palavra-chave na primeira mensagem. Anúncio da Meta e clique no site já chegam com a origem sozinhos.",
  titulo: "Origens cadastradas",
  nova: "Nova origem",
  vazioTitulo: "Nenhuma origem cadastrada",
  vazioDescricao:
    "Cadastre o link da bio, do perfil no Google ou de um parceiro para o lead chegar com a origem certa.",
  erroTitulo: "Não foi possível carregar as origens",
  erroDescricao: "Tente de novo. Se continuar, fale com o suporte.",
  tentarDeNovo: "Tentar de novo",
  ativa: "Ativa",
  desativada: "Desativada",
  confirmarExclusao: "A origem dos leads que já chegaram não muda.",
  testeTitulo: "Testar uma mensagem",
  testeDescricao:
    "Cole a primeira mensagem de um lead para ver qual origem ele ganharia. Nada é gravado.",
  testeRegra:
    "Vale para a primeira mensagem de um contato novo. O código do link vale sempre, mesmo para quem já é contato.",
  desativadaSemCopiar:
    "Ative a origem antes de copiar o link: desativada, ela não reconhece ninguém.",
} as const;

/** O que a pagina manda para a aba (nulo: a leitura das origens falhou). */
export type DadosDasOrigens = {
  regras: RegraDeOrigem[];
  /** nulo: a leitura dos numeros falhou */
  numeros: NumeroParaOLink[] | null;
  /** as frases do botao do site da clinica e as de fabrica */
  frasesDoSite: string[];
};

/** O esqueleto da lista, enquanto a aba carrega de novo. */
export function CarregandoOrigens() {
  return (
    <Card>
      <div role="status" className="grid gap-3 p-4">
        <span className="sr-only">Carregando as origens</span>
        <ListSkeleton rows={3} />
      </div>
    </Card>
  );
}

export function OrigemDosLeadsTab({
  dados,
  podeGerenciar,
  dica,
}: {
  dados: DadosDasOrigens | null;
  podeGerenciar: boolean;
  dica: string;
}) {
  const router = useRouter();
  const [recarregando, recarregar] = useTransition();

  if (recarregando) {
    return <CarregandoOrigens />;
  }
  if (dados === null) {
    return (
      <Card>
        <EmptyState
          tom="erro"
          title={TEXTOS_DA_ORIGEM.erroTitulo}
          description={TEXTOS_DA_ORIGEM.erroDescricao}
        >
          <Button
            variant="outline"
            onClick={() => recarregar(() => router.refresh())}
          >
            <RotateCcw aria-hidden />
            {TEXTOS_DA_ORIGEM.tentarDeNovo}
          </Button>
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      <ListaDeOrigens dados={dados} podeGerenciar={podeGerenciar} dica={dica} />
      <TesteDeMensagem
        regras={dados.regras}
        frasesDoSite={dados.frasesDoSite}
      />
    </>
  );
}

function ListaDeOrigens({
  dados,
  podeGerenciar,
  dica,
}: {
  dados: DadosDasOrigens;
  podeGerenciar: boolean;
  dica: string;
}) {
  const { regras, numeros, frasesDoSite } = dados;
  // undefined = dialogo fechado; null = criando; regra = editando.
  const [editando, setEditando] = useState<RegraDeOrigem | null | undefined>(
    undefined,
  );
  const [excluindo, setExcluindo] = useState<RegraDeOrigem | null>(null);
  const [pendente, iniciar] = useTransition();

  const ativas = regras.filter((regra) => regra.ativa).length;
  const noLimite = ativas >= LIMITE_DE_ORIGENS_ATIVAS;

  const executar = (
    tarefa: () => Promise<{ ok: boolean; error?: string; aviso?: string }>,
    sucesso: string,
    depois?: () => void,
  ) => {
    iniciar(async () => {
      const resultado = await tarefa().catch(() => null);
      if (!resultado) {
        toast.error("Não foi possível falar com o servidor. Tente de novo.");
        return;
      }
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível concluir.");
        return;
      }
      toast.success(sucesso);
      if (resultado.aviso) {
        toast.warning(resultado.aviso);
      }
      depois?.();
    });
  };

  const motivoDaNova = !podeGerenciar
    ? dica
    : noLimite
      ? recusaDoLimite("criar")
      : null;
  const botaoNova = (
    <Button
      variant="outline"
      disabled={motivoDaNova !== null || pendente}
      onClick={() => setEditando(null)}
    >
      <Plus aria-hidden />
      {TEXTOS_DA_ORIGEM.nova}
    </Button>
  );
  const comDica = (motivo: string | null, controle: React.ReactNode) =>
    motivo ? (
      <DisabledWithHint hint={motivo}>{controle}</DisabledWithHint>
    ) : (
      controle
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {TEXTOS_DA_ORIGEM.titulo}{" "}
          <span className="cz-num font-normal text-text-secondary">
            {regras.length}
          </span>
        </CardTitle>
        <CardDescription>
          {ativas === 1 ? "1 ativa" : `${ativas} ativas`}, de até{" "}
          {LIMITE_DE_ORIGENS_ATIVAS} por clínica. A ordem é a de cadastro: no
          empate, vale a origem cadastrada primeiro.
        </CardDescription>
        <CardAction>{comDica(motivoDaNova, botaoNova)}</CardAction>
      </CardHeader>

      {regras.length === 0 ? (
        <EmptyState
          icon={Signpost}
          title={TEXTOS_DA_ORIGEM.vazioTitulo}
          description={TEXTOS_DA_ORIGEM.vazioDescricao}
        >
          {comDica(motivoDaNova, botaoNova)}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {regras.map((regra) => {
            const motivoDeAtivar = !podeGerenciar
              ? dica
              : !regra.ativa && noLimite
                ? recusaDoLimite("ativar")
                : null;
            const motivoDeEscrever = podeGerenciar ? null : dica;
            const botaoEditar = (
              <Button
                variant="ghost"
                disabled={motivoDeEscrever !== null || pendente}
                onClick={() => setEditando(regra)}
                aria-label={`Editar ${regra.nome}`}
              >
                <Pencil aria-hidden />
                Editar
              </Button>
            );
            const botaoAtivar = (
              <Button
                variant="ghost"
                disabled={
                  (regra.ativa ? motivoDeEscrever : motivoDeAtivar) !== null ||
                  pendente
                }
                aria-label={`${regra.ativa ? "Desativar" : "Ativar"} ${regra.nome}`}
                onClick={() =>
                  regra.ativa
                    ? executar(
                        () => desativarRegraDeOrigemAction({ id: regra.id }),
                        `${regra.nome} desativada. Ela não reconhece mais ninguém.`,
                      )
                    : executar(
                        () => ativarRegraDeOrigemAction({ id: regra.id }),
                        `${regra.nome} ativada.`,
                      )
                }
              >
                {regra.ativa ? "Desativar" : "Ativar"}
              </Button>
            );
            const botaoExcluir = (
              <Button
                variant="ghost"
                disabled={motivoDeEscrever !== null || pendente}
                onClick={() => setExcluindo(regra)}
                aria-label={`Excluir ${regra.nome}`}
              >
                <Trash2 aria-hidden />
                Excluir
              </Button>
            );
            return (
              <li key={regra.id} className="grid gap-2.5 px-4 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="grid min-w-[12rem] flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-bold text-text-strong">
                        {regra.nome}
                      </span>
                      <StatusChip
                        size="sm"
                        definition={
                          RECORD_STATUS[regra.ativa ? "ativo" : "inativo"]
                        }
                        label={
                          regra.ativa
                            ? TEXTOS_DA_ORIGEM.ativa
                            : TEXTOS_DA_ORIGEM.desativada
                        }
                      />
                    </div>
                    <p className="text-[12.5px] text-foreground">
                      {textoDoCanalDaRegra(regra)}
                    </p>
                    <p className="text-[12.5px] text-text-secondary">
                      {textoDoReconhecimento(regra)}
                    </p>
                    {regra.campanha ? (
                      <p className="text-[12.5px] text-text-secondary">
                        Campanha: {regra.campanha}
                      </p>
                    ) : null}
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    {comDica(motivoDeEscrever, botaoEditar)}
                    {comDica(
                      regra.ativa ? motivoDeEscrever : motivoDeAtivar,
                      botaoAtivar,
                    )}
                    {comDica(motivoDeEscrever, botaoExcluir)}
                  </div>
                </div>
                {regra.mensagem ? (
                  <LinkParaABio
                    numeros={numeros}
                    mensagem={regra.mensagem}
                    codigo={regra.codigo}
                    nomeDaOrigem={regra.nome}
                    motivoSemCopiar={
                      regra.ativa ? null : TEXTOS_DA_ORIGEM.desativadaSemCopiar
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <DialogoDaOrigem
        aberto={editando !== undefined}
        aoFechar={() => setEditando(undefined)}
        regra={editando ?? null}
        numeros={numeros}
        frasesDoSite={frasesDoSite}
      />

      <Dialog
        open={excluindo !== null}
        onOpenChange={(aberto) => (!aberto ? setExcluindo(null) : null)}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              Excluir {excluindo?.nome ?? "esta origem"}?
            </DialogTitle>
            <DialogDescription>
              {TEXTOS_DA_ORIGEM.confirmarExclusao} Quem chegar pelo link depois
              disso fica sem esta origem. Para parar só por um tempo, desative
              em vez de excluir.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExcluindo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pendente}
              onClick={() => {
                const alvo = excluindo;
                if (!alvo) {
                  return;
                }
                executar(
                  () => excluirRegraDeOrigemAction({ id: alvo.id }),
                  `${alvo.nome} excluída.`,
                  () => setExcluindo(null),
                );
              }}
            >
              {pendente ? "Excluindo..." : "Excluir origem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * "Testar uma mensagem": roda a decisao da ingestao no navegador com as
 * origens ATIVAS carregadas (e as frases do botao do site, que a ingestao
 * nao atribui quando o codigo do clique se perde). Nada vai ao servidor nem
 * e gravado.
 */
export function TesteDeMensagem({
  regras,
  frasesDoSite = [],
}: {
  regras: RegraDeOrigem[];
  frasesDoSite?: readonly string[];
}) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const resultado = testarMensagem(texto, regras, frasesDoSite);
  const frase = fraseDoTeste(resultado);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TEXTOS_DA_ORIGEM.testeTitulo}</CardTitle>
        <CardDescription>{TEXTOS_DA_ORIGEM.testeDescricao}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-texto`}>Primeira mensagem do lead</Label>
          <Textarea
            id={`${id}-texto`}
            value={texto}
            rows={3}
            maxLength={4000}
            className="text-sm"
            aria-describedby={`${id}-regra`}
            placeholder="Ex.: Olá! Vi o perfil da clínica no Instagram e quero agendar uma avaliação."
            onChange={(evento) => setTexto(evento.target.value)}
          />
          <p id={`${id}-regra`} className="text-[12px] text-text-secondary">
            {TEXTOS_DA_ORIGEM.testeRegra}
          </p>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "min-h-5 text-[13.5px]",
            resultado.tipo === "reconhecida"
              ? "font-semibold text-text-strong"
              : "text-text-secondary",
          )}
        >
          {frase ?? ""}
        </p>
      </CardContent>
    </Card>
  );
}
