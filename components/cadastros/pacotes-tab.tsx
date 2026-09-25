"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Package2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
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
import type { Pacote, UsoDoPacote } from "@/lib/queries/catalogo";
import {
  centavosParaReais,
  formatarCentavos,
  lerReais,
} from "@/lib/utils/moeda";

type FormPacote = {
  id?: string;
  procedure_id: string;
  sessions: string;
  preco: string;
  validity_days: string;
  active: boolean;
};

const FORM_VAZIO: FormPacote = {
  procedure_id: "",
  sessions: "10",
  preco: "",
  validity_days: "",
  active: true,
};

const DICA_VENDIDO_REMOVER =
  "Este pacote já foi vendido. Desative em vez de remover.";

// Pacote ja vendido (achado 35): nao sai do banco (os saldos apontam para
// ele), o procedimento fica congelado (o debito automatico casa por ele) e
// "tirar de linha" e desativar, que so tira o pacote da venda na ficha.
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

  // undefined enquanto o uso nao carregou: a tela nao afirma "nunca vendido"
  // sem saber (o servidor confere de novo antes de remover).
  const vendasDe = (pacoteId: string): number | undefined =>
    usoDosPacotes === undefined
      ? undefined
      : (usoDosPacotes[pacoteId]?.vendas ?? 0);

  const formVendido = form.id !== undefined && (vendasDe(form.id) ?? 0) > 0;

  const abrir = (pacote?: Pacote) => {
    setErro(null);
    setForm(
      pacote
        ? {
            id: pacote.id,
            procedure_id: pacote.procedure_id,
            sessions: String(pacote.sessions),
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
    if (!form.procedure_id) {
      setErro("Escolha o procedimento do pacote.");
      return;
    }
    const sessions = Number(form.sessions);
    if (!Number.isInteger(sessions) || sessions < 1) {
      setErro("Informe quantas sessões o pacote inclui (no mínimo 1).");
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
      procedure_id: form.procedure_id,
      sessions,
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
    const nome = nomeProcedimento(pacote.procedure_id);
    const vendido = (vendasDe(pacote.id) ?? 0) > 0;
    if (!podeEditar) {
      return (
        <div className="flex items-center justify-end gap-1">
          <DisabledWithHint hint={dica}>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Editar pacote de ${nome}`}
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
              aria-label={`Remover pacote de ${nome}`}
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
          aria-label={`Editar pacote de ${nome}`}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          disabled={alternandoId === pacote.id}
          onClick={() => void alternarAtivo(pacote)}
          aria-label={`${pacote.active ? "Desativar" : "Reativar"} pacote de ${nome}`}
        >
          {pacote.active ? "Desativar" : "Reativar"}
        </Button>
        {vendido ? (
          <DisabledWithHint hint={DICA_VENDIDO_REMOVER}>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Remover pacote de ${nome}`}
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
            aria-label={`Remover pacote de ${nome}`}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    );
  };

  const colunas: ColumnDef<Pacote>[] = [
    {
      id: "procedimento",
      header: "Procedimento",
      cell: ({ row }) => (
        <span className="font-semibold text-text-strong">
          {nomeProcedimento(row.original.procedure_id)}
        </span>
      ),
    },
    {
      id: "sessoes",
      header: "Sessões",
      meta: { align: "right" },
      cell: ({ row }) => row.original.sessions,
    },
    {
      id: "preco",
      header: "Preço do pacote",
      meta: { align: "right" },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-text-strong">
          {formatarCentavos(row.original.price_cents)}
        </span>
      ),
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
          descricao="Pacotes de várias sessões (10 de drenagem, por exemplo) são essenciais em estética. Cadastre o primeiro para a recepção oferecer."
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
            <Label htmlFor="pacote-procedimento">Procedimento</Label>
            <Select
              value={form.procedure_id}
              onValueChange={(v) => setForm({ ...form, procedure_id: v })}
              disabled={formVendido}
            >
              <SelectTrigger
                id="pacote-procedimento"
                className="w-full"
                aria-describedby={
                  formVendido ? "pacote-procedimento-fixo" : undefined
                }
              >
                <SelectValue placeholder="Escolha o procedimento" />
              </SelectTrigger>
              <SelectContent>
                {catalogo.procedimentos
                  .filter(
                    (procedimento) =>
                      procedimento.active ||
                      procedimento.id === form.procedure_id,
                  )
                  .map((procedimento) => (
                    <SelectItem key={procedimento.id} value={procedimento.id}>
                      {procedimento.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {formVendido ? (
              <p
                id="pacote-procedimento-fixo"
                className="text-xs text-text-secondary"
              >
                Este pacote já foi vendido, então o procedimento não muda (os
                saldos dos pacientes são debitados por ele). Para outro
                procedimento, crie um pacote novo.
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pacote-sessoes">Quantidade de sessões</Label>
            <Input
              id="pacote-sessoes"
              type="number"
              min={1}
              value={form.sessions}
              onChange={(e) => setForm({ ...form, sessions: e.target.value })}
              className="cz-num"
            />
          </div>
          <div className="grid gap-1.5">
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
                {nomeProcedimento(pacoteParaRemover.procedure_id)},{" "}
                <span className="cz-num">{pacoteParaRemover.sessions}</span>{" "}
                {pacoteParaRemover.sessions === 1 ? "sessão" : "sessões"},{" "}
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
