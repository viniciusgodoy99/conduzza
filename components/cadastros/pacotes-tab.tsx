"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Package2, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  alternarPacoteAtivoAction,
  excluirPacoteAction,
  salvarPacoteAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  PainelDeCadastro,
  PreviaDeReais,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  descontoDoPacote,
  NOME_DO_PACOTE_MAX,
  precoAvulsoDoPacote,
  SESSOES_POR_ITEM_MAX,
  type PrecoAvulso,
} from "@/lib/domain/pacotes";
import {
  adicionarItem,
  itensDasLinhas,
  itensParaCalcular,
  lerSessoes,
  linhasDoPacote,
  removerItem,
  resumoDosItens,
  textoDoDesconto,
  trocarSessoes,
  type LinhaDoItem,
} from "@/lib/domain/pacotes-ui";
import type { Pacote, Procedimento, UsoDoPacote } from "@/lib/queries/catalogo";
import { cn } from "@/lib/utils";
import {
  centavosParaReais,
  formatarCentavos,
  lerReais,
} from "@/lib/utils/moeda";

type FormPacote = {
  id?: string;
  nome: string;
  /** Procedimentos do pacote, com as sessoes em texto (como o campo guarda) */
  linhas: LinhaDoItem[];
  preco: string;
  validity_days: string;
  active: boolean;
};

const FORM_VAZIO: FormPacote = {
  nome: "",
  linhas: [],
  preco: "",
  validity_days: "",
  active: true,
};

const DICA_VENDIDO_REMOVER =
  "Este pacote já foi vendido. Desative em vez de remover.";

const DICA_ITENS_VENDIDOS =
  "Pacote já vendido: os procedimentos e as sessões não mudam; crie um pacote novo.";

// Pacote com varios procedimentos (pedido do dono em 29/09/2026): o pacote
// tem nome, uma lista de procedimentos com as sessoes de cada um, o preco do
// pacote (o valor que a clinica define) e a validade, que vale para o pacote
// inteiro. O preco avulso (soma de sessoes x preco base) e calculado ao vivo,
// nunca gravado, para a clinica ver o desconto.
//
// Pacote ja vendido (achado 35): nao sai do banco (os saldos apontam para
// ele), os procedimentos e as sessoes ficam congelados (a venda copiou os
// itens para o saldo do paciente) e "tirar de linha" e desativar, que so
// tira o pacote da venda na ficha. Nome, preco, validade e "a venda"
// continuam editaveis.
export function PacotesTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
  usoDosPacotes,
  usoIndisponivel,
  aoRecarregarUso,
}: TabProps & {
  usoDosPacotes: Record<string, UsoDoPacote> | undefined;
  usoIndisponivel: boolean;
  /** Tenta de novo a leitura das vendas quando ela falhou */
  aoRecarregarUso: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormPacote>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pacoteParaRemover, setPacoteParaRemover] = useState<Pacote | null>(
    null,
  );
  const [removendo, setRemovendo] = useState(false);
  const [erroRemocao, setErroRemocao] = useState<string | null>(null);
  const [alternandoId, setAlternandoId] = useState<string | null>(null);

  const nomeProcedimento = (procedureId: string) =>
    catalogo.procedimentos.find((p) => p.id === procedureId)?.name ??
    "Procedimento removido";

  const resumo = (pacote: Pacote): string =>
    pacote.itens.length === 0
      ? "Sem procedimentos"
      : resumoDosItens(pacote.itens, nomeProcedimento);

  // undefined enquanto o uso nao carregou: a tela nao afirma "nunca vendido"
  // sem saber (o servidor confere de novo antes de remover, e o banco recusa
  // mudar os itens de pacote vendido com a mesma frase da dica).
  const vendasDe = (pacoteId: string): number | undefined =>
    usoDosPacotes === undefined
      ? undefined
      : (usoDosPacotes[pacoteId]?.vendas ?? 0);

  const formVendido = form.id !== undefined && (vendasDe(form.id) ?? 0) > 0;

  // Preco avulso AO VIVO, com os itens do formulario (null enquanto alguma
  // sessao esta invalida ou a lista esta vazia).
  const itensAoVivo = itensParaCalcular(form.linhas);
  const avulsoAoVivo =
    itensAoVivo === null
      ? null
      : precoAvulsoDoPacote(itensAoVivo, catalogo.procedimentos);

  const abrir = (pacote?: Pacote) => {
    setErro(null);
    setForm(
      pacote
        ? {
            id: pacote.id,
            nome: pacote.name,
            linhas: linhasDoPacote(pacote.itens),
            preco: centavosParaReais(pacote.price_cents),
            validity_days:
              pacote.validity_days === null ? "" : String(pacote.validity_days),
            active: pacote.active,
          }
        : FORM_VAZIO,
    );
    setAberto(true);
  };

  const alternarAtivo = async (pacote: Pacote) => {
    setAlternandoId(pacote.id);
    const resultado = await alternarPacoteAtivoAction(
      pacote.id,
      !pacote.active,
    );
    setAlternandoId(null);
    if (!resultado.ok) {
      toast.error(resultado.error ?? "Não foi possível alterar o pacote.");
      return;
    }
    toast.success(
      pacote.active
        ? "Pacote desativado. Ele sai da venda, e os saldos já vendidos continuam valendo."
        : "Pacote reativado",
    );
    aoMudar();
  };

  const salvar = async () => {
    setErro(null);
    const nome = form.nome.trim();
    if (nome === "") {
      setErro("Dê um nome ao pacote.");
      return;
    }
    if (nome.length > NOME_DO_PACOTE_MAX) {
      setErro(
        `O nome do pacote tem no máximo ${NOME_DO_PACOTE_MAX} caracteres.`,
      );
      return;
    }
    const itens = itensDasLinhas(form.linhas, nomeProcedimento);
    if (!itens.ok) {
      setErro(itens.erro);
      return;
    }
    const priceCents = lerReais(form.preco);
    if (priceCents === null) {
      setErro("Informe o preço do pacote em reais.");
      return;
    }
    if (priceCents === undefined) {
      setErro("Não entendemos o preço. Use o formato 1.200,00.");
      return;
    }
    let validityDays: number | null = null;
    if (form.validity_days.trim() !== "") {
      const dias = Number(form.validity_days);
      if (!Number.isInteger(dias) || dias < 1) {
        setErro(
          "A validade precisa ser um número de dias (ou fique em branco).",
        );
        return;
      }
      validityDays = dias;
    }

    setSalvando(true);
    const resultado = await salvarPacoteAction({
      id: form.id,
      name: nome,
      itens: itens.itens,
      price_cents: priceCents,
      validity_days: validityDays,
      active: form.active,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Pacote atualizado" : "Pacote criado");
    setAberto(false);
    aoMudar();
  };

  const remover = async () => {
    if (!pacoteParaRemover) return;
    setRemovendo(true);
    setErroRemocao(null);
    const resultado = await excluirPacoteAction(pacoteParaRemover.id);
    setRemovendo(false);
    if (!resultado.ok) {
      setErroRemocao(resultado.error ?? "Não foi possível remover o pacote.");
      return;
    }
    toast.success("Pacote removido");
    setPacoteParaRemover(null);
    aoMudar();
  };

  const pacientesComSaldo = (pacote: Pacote): React.ReactNode => {
    if (usoDosPacotes === undefined) {
      return usoIndisponivel ? "Não carregou" : "Carregando...";
    }
    const comSaldo = usoDosPacotes[pacote.id]?.pacientesComSaldo ?? 0;
    if (comSaldo === 0) {
      return (vendasDe(pacote.id) ?? 0) > 0 ? "Nenhum (já vendido)" : "Nenhum";
    }
    return (
      <>
        <span className="cz-num">{comSaldo}</span>{" "}
        {comSaldo === 1 ? "paciente" : "pacientes"}
      </>
    );
  };

  const acoesDoPacote = (pacote: Pacote) => {
    const nome = pacote.name;
    const vendido = (vendasDe(pacote.id) ?? 0) > 0;
    if (!podeEditar) {
      return (
        <div className="flex items-center justify-end gap-1">
          <DisabledWithHint hint={dica}>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Editar pacote ${nome}`}
            >
              <Pencil aria-hidden />
            </Button>
          </DisabledWithHint>
          <DisabledWithHint hint={dica}>
            <Button variant="ghost" disabled>
              {pacote.active ? "Desativar" : "Reativar"}
            </Button>
          </DisabledWithHint>
          <DisabledWithHint hint={dica}>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Remover pacote ${nome}`}
            >
              <Trash2 aria-hidden />
            </Button>
          </DisabledWithHint>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => abrir(pacote)}
          aria-label={`Editar pacote ${nome}`}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          disabled={alternandoId === pacote.id}
          onClick={() => void alternarAtivo(pacote)}
          aria-label={`${pacote.active ? "Desativar" : "Reativar"} pacote ${nome}`}
        >
          {pacote.active ? "Desativar" : "Reativar"}
        </Button>
        {vendido ? (
          <DisabledWithHint hint={DICA_VENDIDO_REMOVER}>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Remover pacote ${nome}`}
            >
              <Trash2 aria-hidden />
            </Button>
          </DisabledWithHint>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setErroRemocao(null);
              setPacoteParaRemover(pacote);
            }}
            aria-label={`Remover pacote ${nome}`}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    );
  };

  const colunas: ColumnDef<Pacote>[] = [
    {
      id: "pacote",
      header: "Pacote",
      cell: ({ row }) => (
        <span className="font-semibold text-text-strong">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "procedimentos",
      header: "Procedimentos",
      cell: ({ row }) => (
        <span className="block max-w-[320px] whitespace-normal text-foreground">
          {resumo(row.original)}
        </span>
      ),
    },
    {
      id: "avulso",
      header: "Preço avulso",
      meta: { align: "right", numeric: false },
      cell: ({ row }) => (
        <PrecoAvulsoNaTabela avulso={row.original.preco_avulso} />
      ),
    },
    {
      id: "preco",
      header: "Preço do pacote",
      meta: { align: "right", numeric: false },
      cell: ({ row }) => {
        const desconto = descontoDoPacote(
          row.original.price_cents,
          row.original.preco_avulso,
        );
        return (
          <span className="grid justify-items-end gap-0.5">
            <span className="cz-num whitespace-nowrap text-text-strong">
              {formatarCentavos(row.original.price_cents)}
            </span>
            {desconto ? (
              <span className="text-xs whitespace-nowrap text-text-secondary">
                {textoDoDesconto(desconto)}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "validade",
      header: "Validade",
      cell: ({ row }) =>
        row.original.validity_days === null ? (
          <span className="text-text-secondary">Sem validade</span>
        ) : (
          <span className="whitespace-nowrap text-text-secondary">
            <span className="cz-num">{row.original.validity_days}</span> dias
          </span>
        ),
    },
    {
      id: "saldo",
      header: "Pacientes com saldo",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-text-secondary">
          {pacientesComSaldo(row.original)}
        </span>
      ),
    },
    {
      id: "situacao",
      header: "Situação",
      cell: ({ row }) => <ChipSituacao active={row.original.active} />,
    },
    {
      id: "acoes",
      header: () => <span className="sr-only">Ações</span>,
      meta: { align: "right", numeric: false },
      cell: ({ row }) => acoesDoPacote(row.original),
    },
  ];

  const fechar = () => setAberto(false);

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => abrir()}
        >
          <Plus aria-hidden /> Novo pacote
        </BotaoProtegido>
      </div>

      {/* Erro da leitura das vendas (achado 35): a tabela continua, a coluna
          diz "Não carregou" e daqui da para tentar de novo. */}
      {usoIndisponivel && catalogo.pacotes.length > 0 ? (
        <Aviso
          tom="alert"
          role="alert"
          acao={
            <Button variant="outline" onClick={aoRecarregarUso}>
              <RotateCcw aria-hidden /> Tentar de novo
            </Button>
          }
        >
          Não foi possível carregar as vendas dos pacotes: a coluna de pacientes
          com saldo fica sem número até carregar.
        </Aviso>
      ) : null}

      {catalogo.pacotes.length === 0 ? (
        <VazioDaAba
          icon={Package2}
          titulo="Nenhum pacote cadastrado"
          descricao="Pacotes de várias sessões são essenciais em estética: 10 sessões de drenagem, ou Botox e Facelift num pacote só. Cadastre o primeiro para a recepção oferecer."
          acao={{
            rotulo: "Cadastrar o primeiro pacote",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.pacotes} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo={form.id ? "Editar pacote" : "Novo pacote"}
        descricao="Junte um ou mais procedimentos, cada um com as suas sessões. A validade vale para o pacote inteiro."
        larga
        erro={erro}
        rodape={
          <RodapeDeSalvar
            salvando={salvando}
            aoCancelar={fechar}
            aoSalvar={() => void salvar()}
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="pacote-nome">Nome do pacote</Label>
            <Input
              id="pacote-nome"
              value={form.nome}
              maxLength={NOME_DO_PACOTE_MAX}
              placeholder="Ex.: Harmonização facial"
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          <ItensDoPacote
            linhas={form.linhas}
            aoMudarLinhas={(linhas) => setForm({ ...form, linhas })}
            procedimentos={catalogo.procedimentos}
            vendido={formVendido}
          />

          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <PrecoAvulsoDoFormulario
              avulso={avulsoAoVivo}
              temItens={form.linhas.length > 0}
            />
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pacote-preco">Preço do pacote (R$)</Label>
              <Input
                id="pacote-preco"
                inputMode="decimal"
                placeholder="Ex.: 1.200,00"
                value={form.preco}
                onChange={(e) => setForm({ ...form, preco: e.target.value })}
                aria-describedby="pacote-preco-previa"
                className="cz-num"
              />
              <PreviaDeReais texto={form.preco} id="pacote-preco-previa" />
            </div>
          </div>
          <DescontoDoFormulario avulso={avulsoAoVivo} precoTexto={form.preco} />

          <div className="grid gap-1.5">
            <Label htmlFor="pacote-validade">Validade (dias)</Label>
            <Input
              id="pacote-validade"
              type="number"
              min={1}
              placeholder="Em branco: sem validade"
              value={form.validity_days}
              onChange={(e) =>
                setForm({ ...form, validity_days: e.target.value })
              }
              className="cz-num"
            />
          </div>
          <CampoDeMarcar
            id="pacote-ativo"
            rotulo="Pacote à venda"
            descricao="Desativado, ele sai da venda na ficha do paciente. Os saldos já vendidos continuam valendo."
            marcado={form.active}
            aoMudar={(marcado) => setForm({ ...form, active: marcado })}
          />
        </div>
      </PainelDeCadastro>

      <Dialog
        open={pacoteParaRemover !== null}
        onOpenChange={(open) => {
          if (!open) setPacoteParaRemover(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Remover este pacote?</DialogTitle>
            {pacoteParaRemover ? (
              <DialogDescription>
                {pacoteParaRemover.name}: {resumo(pacoteParaRemover)},{" "}
                <span className="cz-num">
                  {formatarCentavos(pacoteParaRemover.price_cents)}
                </span>
                . Só dá para remover pacote que nunca foi vendido.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {erroRemocao ? (
            <Aviso tom="alert" role="alert">
              {erroRemocao}
            </Aviso>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPacoteParaRemover(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remover()}
              disabled={removendo}
            >
              {removendo ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Procedimentos do pacote (secao do modal)
// ---------------------------------------------------------------------------

const ID_DO_TITULO_DOS_ITENS = "pacote-itens-titulo";
const ID_DO_ADICIONAR_ITEM = "pacote-adicionar-procedimento";
const ID_DA_DICA_DO_ADICIONAR = "pacote-adicionar-dica";
const ID_DA_NOTA_DE_VENDIDO = "pacote-itens-vendido";

function idDoRemoverItem(procedureId: string): string {
  return `pacote-remover-${procedureId}`;
}

// Mesmo desenho de "Quem faz e convenios" no modal do Procedimento: a lista
// do que ja esta no pacote e, embaixo, o campo que adiciona (sempre vazio,
// pronto para o proximo). O mesmo procedimento entra uma vez so: quem ja esta
// na lista sai das opcoes. Pacote vendido: tudo continua a vista, travado,
// com a dica do porque.
function ItensDoPacote({
  linhas,
  aoMudarLinhas,
  procedimentos,
  vendido,
}: {
  linhas: LinhaDoItem[];
  aoMudarLinhas: (linhas: LinhaDoItem[]) => void;
  procedimentos: Procedimento[];
  vendido: boolean;
}) {
  const porId = new Map(procedimentos.map((p) => [p.id, p]));
  const naLista = new Set(linhas.map((linha) => linha.procedure_id));
  const disponiveis = procedimentos.filter(
    (p) => p.active && !naLista.has(p.id),
  );
  const temProcedimentoAtivo = procedimentos.some((p) => p.active);

  // Foco depois do Remover: a linha sai com o botao que tinha o foco, e o
  // FocusScope do Radix mandaria o foco para o topo do modal. Vai para o
  // Remover da proxima linha ou, na ultima, para "Adicionar procedimento".
  const focoDepoisDeRemover = useRef<string | null>(null);
  useEffect(() => {
    const alvo = focoDepoisDeRemover.current;
    if (alvo === null) {
      return;
    }
    focoDepoisDeRemover.current = null;
    // O campo de adicionar tambem e botao (o gatilho do Select).
    const elemento = document.getElementById(alvo);
    if (elemento instanceof HTMLButtonElement && !elemento.disabled) {
      elemento.focus();
      return;
    }
    document.getElementById(ID_DO_TITULO_DOS_ITENS)?.focus();
  }, [linhas]);

  const remover = (procedureId: string) => {
    const indice = linhas.findIndex(
      (linha) => linha.procedure_id === procedureId,
    );
    const proxima = indice === -1 ? undefined : linhas[indice + 1];
    focoDepoisDeRemover.current = proxima
      ? idDoRemoverItem(proxima.procedure_id)
      : ID_DO_ADICIONAR_ITEM;
    aoMudarLinhas(removerItem(linhas, procedureId));
  };

  const campoDeAdicionar = (
    <SelectTrigger
      id={ID_DO_ADICIONAR_ITEM}
      className="w-full"
      aria-describedby={
        vendido
          ? ID_DA_NOTA_DE_VENDIDO
          : disponiveis.length === 0
            ? ID_DA_DICA_DO_ADICIONAR
            : undefined
      }
    >
      <SelectValue placeholder="Escolha o procedimento" />
    </SelectTrigger>
  );

  return (
    <section
      aria-labelledby={ID_DO_TITULO_DOS_ITENS}
      className="grid gap-3 border-t border-border pt-4"
    >
      <div className="grid gap-1">
        <h3
          id={ID_DO_TITULO_DOS_ITENS}
          // Alvo de foco de reserva do Remover (nao entra na ordem do Tab).
          tabIndex={-1}
          className="text-sm font-bold text-text-strong"
        >
          Procedimentos do pacote
        </h3>
        <p className="text-xs text-text-secondary">
          Cada procedimento entra uma vez, com as suas sessões. Quando o
          paciente comparece, a sessão sai do procedimento da consulta.
        </p>
      </div>

      {vendido ? (
        <p
          id={ID_DA_NOTA_DE_VENDIDO}
          className="rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-text-secondary"
        >
          {DICA_ITENS_VENDIDOS} Nome, preço, validade e &quot;Pacote à
          venda&quot; continuam editáveis.
        </p>
      ) : null}

      {linhas.length === 0 ? (
        <p className="rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-text-secondary">
          Nenhum procedimento no pacote ainda. Adicione o primeiro logo abaixo.
        </p>
      ) : (
        <ul className="grid rounded-xl border border-border">
          {linhas.map((linha) => {
            const procedimento = porId.get(linha.procedure_id);
            const nome = procedimento?.name ?? "Procedimento removido";
            const sessoes = lerSessoes(linha.sessions);
            const idSessoes = `pacote-sessoes-${linha.procedure_id}`;
            const idPreco = `${idSessoes}-preco`;
            const rotuloRemover = `Remover ${nome} do pacote`;
            return (
              <li
                key={linha.procedure_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                <div className="grid min-w-[160px] flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-text-strong">
                      {nome}
                    </span>
                    {procedimento && !procedimento.active ? (
                      <ChipSituacao active={false} />
                    ) : null}
                  </span>
                  <span id={idPreco} className="text-xs text-text-secondary">
                    <PrecoDoItem
                      precoBase={procedimento?.base_price_cents ?? null}
                      sessoes={sessoes}
                    />
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={idSessoes}>
                    Sessões<span className="sr-only"> de {nome}</span>
                  </Label>
                  <Input
                    id={idSessoes}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={SESSOES_POR_ITEM_MAX}
                    value={linha.sessions}
                    onChange={(e) =>
                      aoMudarLinhas(
                        trocarSessoes(
                          linhas,
                          linha.procedure_id,
                          e.target.value,
                        ),
                      )
                    }
                    disabled={vendido}
                    aria-invalid={sessoes === null ? true : undefined}
                    aria-describedby={
                      vendido ? `${idPreco} ${ID_DA_NOTA_DE_VENDIDO}` : idPreco
                    }
                    className="w-20 cz-num"
                  />
                </div>
                {vendido ? (
                  <DisabledWithHint hint={DICA_ITENS_VENDIDOS}>
                    <Button
                      variant="ghost"
                      className="h-10"
                      disabled
                      aria-label={rotuloRemover}
                    >
                      <X aria-hidden /> Remover
                    </Button>
                  </DisabledWithHint>
                ) : (
                  <Button
                    id={idDoRemoverItem(linha.procedure_id)}
                    variant="ghost"
                    className="h-10"
                    onClick={() => remover(linha.procedure_id)}
                    aria-label={rotuloRemover}
                  >
                    <X aria-hidden /> Remover
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={ID_DO_ADICIONAR_ITEM}>Adicionar procedimento</Label>
        {vendido ? (
          <DisabledWithHint hint={DICA_ITENS_VENDIDOS} className="w-full">
            <Select value="" disabled>
              {campoDeAdicionar}
            </Select>
          </DisabledWithHint>
        ) : (
          <Select
            // Sempre vazio: escolher adiciona a linha e o campo volta ao
            // texto de ajuda, pronto para o proximo.
            value=""
            onValueChange={(procedureId) =>
              aoMudarLinhas(adicionarItem(linhas, procedureId))
            }
            disabled={disponiveis.length === 0}
          >
            {campoDeAdicionar}
            <SelectContent>
              {disponiveis.map((procedimento) => (
                <SelectItem key={procedimento.id} value={procedimento.id}>
                  {procedimento.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!vendido && disponiveis.length === 0 ? (
          <p
            id={ID_DA_DICA_DO_ADICIONAR}
            className="text-xs text-text-secondary"
          >
            {temProcedimentoAtivo
              ? "Todos os procedimentos ativos já estão no pacote."
              : "Cadastre os procedimentos na aba Procedimentos para montar o pacote."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Preco base do procedimento e quanto as sessoes dele dariam avulsas. */
function PrecoDoItem({
  precoBase,
  sessoes,
}: {
  precoBase: number | null;
  sessoes: number | null;
}) {
  if (precoBase === null) {
    return <>Sem preço base</>;
  }
  return (
    <>
      <span className="cz-num">{formatarCentavos(precoBase)}</span> por sessão
      {sessoes === null ? null : (
        <>
          ,{" "}
          <span className="cz-num">
            {formatarCentavos(precoBase * sessoes)}
          </span>{" "}
          avulso
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Preco avulso e desconto
// ---------------------------------------------------------------------------

function notaDoAvulso(avulso: PrecoAvulso | null): string {
  if (avulso !== null && avulso.itensSemPreco > 0) {
    return avulso.itensSemPreco === 1
      ? "1 procedimento está sem preço base, então a soma está incompleta. Cadastre o preço base em Procedimentos para ver o desconto."
      : `${avulso.itensSemPreco} procedimentos estão sem preço base, então a soma está incompleta. Cadastre o preço base em Procedimentos para ver o desconto.`;
  }
  return "Soma de sessões x preço base de cada procedimento.";
}

// Calculado ao vivo com os itens do formulario, nunca gravado: mudar o preco
// base de um procedimento muda o avulso de todo pacote que o usa.
function PrecoAvulsoDoFormulario({
  avulso,
  temItens,
}: {
  avulso: PrecoAvulso | null;
  temItens: boolean;
}) {
  const incompleto = avulso !== null && avulso.itensSemPreco > 0;
  return (
    <div className="grid content-start gap-1.5">
      <span
        id="pacote-avulso-rotulo"
        className="text-xs leading-none font-semibold text-foreground"
      >
        Preço avulso
      </span>
      <output
        aria-labelledby="pacote-avulso-rotulo"
        aria-describedby="pacote-avulso-nota"
        className="flex h-10 items-center gap-2 rounded-lg bg-surface-subtle px-3 text-sm"
      >
        {avulso === null ? (
          <span className="text-text-secondary">
            {temItens ? "Confira as sessões" : "Sem procedimentos"}
          </span>
        ) : (
          <>
            <span className="cz-num font-semibold text-text-strong">
              {formatarCentavos(avulso.centavos)}
            </span>
            {incompleto ? (
              <span className="text-xs text-text-secondary">(incompleto)</span>
            ) : null}
          </>
        )}
      </output>
      <p
        id="pacote-avulso-nota"
        className={cn(
          "text-xs",
          incompleto ? "text-warning-text" : "text-text-secondary",
        )}
      >
        {notaDoAvulso(avulso)}
      </p>
    </div>
  );
}

// O desconto so aparece quando os dois precos existem e o avulso esta
// completo. Pacote mais caro que o avulso aparece como acrescimo, nunca
// escondido. A regiao viva fica sempre montada, para o leitor de tela ouvir
// a troca.
function DescontoDoFormulario({
  avulso,
  precoTexto,
}: {
  avulso: PrecoAvulso | null;
  precoTexto: string;
}) {
  const preco = lerReais(precoTexto);
  const desconto =
    avulso === null || preco === null || preco === undefined
      ? null
      : descontoDoPacote(preco, avulso);
  // Vazia, a regiao desconta a folga da grade do formulario (gap-4) em vez
  // de sumir: display none tiraria a regiao viva da arvore de acessibilidade.
  return (
    <div aria-live="polite" className="empty:-mt-4">
      {desconto ? (
        <p className="rounded-xl bg-surface-subtle px-3.5 py-2.5 text-[13px] text-foreground">
          <span className="font-semibold text-text-strong">
            {textoDoDesconto(desconto)}
          </span>
          {desconto.centavos > 0 ? (
            <>
              :{" "}
              <span className="cz-num">
                {formatarCentavos(desconto.centavos)}
              </span>{" "}
              a menos que o avulso.
            </>
          ) : desconto.centavos < 0 ? (
            <>
              :{" "}
              <span className="cz-num">
                {formatarCentavos(-desconto.centavos)}
              </span>{" "}
              a mais.
            </>
          ) : (
            "."
          )}
        </p>
      ) : null}
    </div>
  );
}

/** Coluna "Preco avulso" da tabela: com item sem preco base, diz o que falta. */
function PrecoAvulsoNaTabela({ avulso }: { avulso: PrecoAvulso }) {
  if (avulso.itensSemPreco > 0) {
    return (
      <span className="whitespace-nowrap text-text-secondary">
        Falta preço base
      </span>
    );
  }
  return (
    <span className="cz-num whitespace-nowrap text-text-secondary">
      {formatarCentavos(avulso.centavos)}
    </span>
  );
}
