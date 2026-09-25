"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  criarBloqueiosEmLoteAction,
  excluirBloqueioAction,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AvisoDeConsultas,
  BotaoProtegido,
  CampoDeMarcar,
  ENCAIXE_DO_BLOQUEIO,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { instanteLocal } from "@/lib/domain/horarios";
import type { Bloqueio } from "@/lib/queries/catalogo";

// Aba de Bloqueios pontuais (ferias, congresso, imprevisto). Almoco nao e
// bloqueio, e jornada. Criacao em lote conforme spec 3.9: varios
// profissionais de uma vez, mesmo periodo e motivo.

type FormBloqueio = {
  professionalIds: string[];
  inicio: string;
  fim: string;
  motivo: string;
  impedirEncaixe: boolean;
};

const FORM_VAZIO: FormBloqueio = {
  professionalIds: [],
  inicio: "",
  fim: "",
  motivo: "",
  impedirEncaixe: true,
};

function formatarMomento(iso: string, timezone: string): string {
  const data = new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  });
  const hora = new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} às ${hora}`;
}

export function BloqueiosTab({
  catalogo,
  podeEditar,
  dica,
  aoMudar,
  timezone,
}: TabProps) {
  const [criarAberto, setCriarAberto] = useState(false);
  const [form, setFormBruto] = useState<FormBloqueio>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Consultas ja marcadas no periodo (achado 37): o servidor conta e devolve
  // sem gravar; a tela avisa e so cria com confirmacao explicita.
  const [aviso, setAviso] = useState<{
    consultas: number;
    primeira: string | null;
  } | null>(null);

  // Mudou profissional ou periodo: a contagem antiga nao vale mais.
  const setForm = (
    proximo: FormBloqueio | ((atual: FormBloqueio) => FormBloqueio),
  ) => {
    setAviso(null);
    setFormBruto(proximo);
  };

  const [paraExcluir, setParaExcluir] = useState<Bloqueio | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const nomeProfissional = (id: string) =>
    catalogo.profissionais.find((p) => p.id === id)?.name ??
    "Profissional removido";

  const abrirCriacao = () => {
    setErro(null);
    setForm(FORM_VAZIO);
    setCriarAberto(true);
  };

  const alternarProfissional = (id: string, marcado: boolean) => {
    setForm((atual) => ({
      ...atual,
      professionalIds: marcado
        ? [...atual.professionalIds, id]
        : atual.professionalIds.filter((p) => p !== id),
    }));
  };

  const todosSelecionados =
    catalogo.profissionais.length > 0 &&
    form.professionalIds.length === catalogo.profissionais.length;

  const alternarTodos = (marcado: boolean) => {
    setForm((atual) => ({
      ...atual,
      professionalIds: marcado ? catalogo.profissionais.map((p) => p.id) : [],
    }));
  };

  const salvar = async (confirmarConsultas = false) => {
    if (form.professionalIds.length === 0) {
      setErro("Escolha pelo menos um profissional.");
      return;
    }
    if (!form.inicio || !form.fim) {
      setErro("Informe o início e o fim do bloqueio.");
      return;
    }
    if (!form.motivo.trim()) {
      setErro("Informe o motivo do bloqueio.");
      return;
    }
    setSalvando(true);
    setErro(null);
    // O input datetime-local devolve "aaaa-mm-ddTHH:MM" no relogio de quem
    // digita. Interpretamos essa data e hora no FUSO DA CLINICA (regra 3.6),
    // nunca no fuso do navegador.
    const [inicioDia, inicioHora] = form.inicio.split("T");
    const [fimDia, fimHora] = form.fim.split("T");
    const resultado = await criarBloqueiosEmLoteAction({
      professional_ids: form.professionalIds,
      starts_at: instanteLocal(timezone, inicioDia!, inicioHora!).toISOString(),
      ends_at: instanteLocal(timezone, fimDia!, fimHora!).toISOString(),
      reason: form.motivo.trim(),
      blocks_overbooking: form.impedirEncaixe,
      confirmar_consultas: confirmarConsultas,
    });
    setSalvando(false);
    if (!resultado.ok) {
      if (resultado.code === "consultas_no_periodo") {
        setAviso({
          consultas: resultado.consultas ?? 0,
          primeira: resultado.primeiraConsulta ?? null,
        });
        return;
      }
      setErro(resultado.error ?? "Não foi possível criar os bloqueios.");
      return;
    }
    setAviso(null);
    toast.success(
      form.professionalIds.length === 1
        ? "Bloqueio criado"
        : "Bloqueios criados",
    );
    setCriarAberto(false);
    aoMudar();
  };

  const excluir = async () => {
    if (!paraExcluir) {
      return;
    }
    setExcluindo(true);
    setErroExclusao(null);
    const resultado = await excluirBloqueioAction(paraExcluir.id);
    setExcluindo(false);
    if (!resultado.ok) {
      setErroExclusao(
        resultado.error ?? "Não foi possível remover o bloqueio.",
      );
      return;
    }
    toast.success("Bloqueio removido");
    setParaExcluir(null);
    aoMudar();
  };

  const colunas: ColumnDef<Bloqueio>[] = [
    {
      id: "profissional",
      header: "Profissional",
      cell: ({ row }) => (
        <span className="font-semibold text-text-strong">
          {nomeProfissional(row.original.professional_id)}
        </span>
      ),
    },
    {
      id: "inicio",
      header: "Início",
      meta: { numeric: true },
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatarMomento(row.original.starts_at, timezone)}
        </span>
      ),
    },
    {
      id: "fim",
      header: "Fim",
      meta: { numeric: true },
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatarMomento(row.original.ends_at, timezone)}
        </span>
      ),
    },
    {
      id: "motivo",
      header: "Motivo",
      cell: ({ row }) => (
        <span className="text-text-secondary">{row.original.reason}</span>
      ),
    },
    {
      id: "encaixe",
      header: "Encaixe",
      cell: ({ row }) => (
        <StatusChip
          size="sm"
          definition={
            ENCAIXE_DO_BLOQUEIO[
              row.original.blocks_overbooking ? "impede" : "permite"
            ]
          }
        />
      ),
    },
    {
      id: "acoes",
      header: () => <span className="sr-only">Ações</span>,
      meta: { align: "right", numeric: false },
      cell: ({ row }) => {
        const rotulo = `Remover bloqueio de ${nomeProfissional(row.original.professional_id)}`;
        return podeEditar ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setErroExclusao(null);
              setParaExcluir(row.original);
            }}
            aria-label={rotulo}
          >
            <Trash2 aria-hidden />
          </Button>
        ) : (
          <DisabledWithHint hint={dica}>
            <Button variant="ghost" size="icon" disabled aria-label={rotulo}>
              <Trash2 aria-hidden />
            </Button>
          </DisabledWithHint>
        );
      },
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={abrirCriacao}
        >
          <Plus aria-hidden /> Novo bloqueio
        </BotaoProtegido>
      </div>

      {catalogo.bloqueios.length === 0 ? (
        <VazioDaAba
          icon={CalendarOff}
          titulo="Nenhum bloqueio futuro"
          descricao="Crie um bloqueio para tirar da oferta os horários de férias, congressos ou imprevistos."
          acao={{ rotulo: "Criar o primeiro bloqueio", onClick: abrirCriacao }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.bloqueios} />
      )}

      <Dialog open={criarAberto} onOpenChange={setCriarAberto}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Novo bloqueio</DialogTitle>
            <DialogDescription>
              O bloqueio aparece hachurado na agenda e os horários somem da
              oferta. Consultas já marcadas no período não são desmarcadas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-xs font-semibold text-foreground">
                Profissionais
              </legend>
              {catalogo.profissionais.length === 0 ? (
                <p className="text-[13px] text-text-secondary">
                  Cadastre um profissional antes de criar bloqueios.
                </p>
              ) : (
                <div className="grid cz-scroll max-h-64 gap-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13.5px] font-semibold text-text-strong cz-transition hover:bg-surface-3">
                    <Checkbox
                      checked={todosSelecionados}
                      onCheckedChange={(v) => alternarTodos(v === true)}
                    />
                    Selecionar todos
                  </label>
                  {catalogo.profissionais.map((profissional) => (
                    <label
                      key={profissional.id}
                      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13.5px] text-foreground cz-transition hover:bg-surface-3"
                    >
                      <Checkbox
                        checked={form.professionalIds.includes(profissional.id)}
                        onCheckedChange={(v) =>
                          alternarProfissional(profissional.id, v === true)
                        }
                      />
                      {profissional.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="bloqueio-inicio">Início</Label>
                <Input
                  id="bloqueio-inicio"
                  type="datetime-local"
                  value={form.inicio}
                  onChange={(e) => setForm({ ...form, inicio: e.target.value })}
                  className="cz-num"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bloqueio-fim">Fim</Label>
                <Input
                  id="bloqueio-fim"
                  type="datetime-local"
                  value={form.fim}
                  onChange={(e) => setForm({ ...form, fim: e.target.value })}
                  className="cz-num"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bloqueio-motivo">Motivo</Label>
              <Input
                id="bloqueio-motivo"
                value={form.motivo}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Férias, congresso, imprevisto"
              />
            </div>
            <CampoDeMarcar
              id="bloqueio-encaixe"
              rotulo="Impedir encaixe neste período"
              marcado={form.impedirEncaixe}
              aoMudar={(marcado) =>
                setForm({ ...form, impedirEncaixe: marcado })
              }
            />
            {erro ? (
              <Aviso tom="alert" role="alert">
                {erro}
              </Aviso>
            ) : null}
            {aviso ? (
              <AvisoDeConsultas
                consultas={aviso.consultas}
                primeira={aviso.primeira}
                timezone={timezone}
                rotuloConfirmar="Criar o bloqueio mesmo assim"
                confirmando={salvando}
                aoConfirmar={() => void salvar(true)}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCriarAberto(false)}>
              Cancelar
            </Button>
            {aviso ? null : (
              <Button onClick={() => void salvar()} disabled={salvando}>
                {salvando ? "Salvando..." : "Criar bloqueio"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={paraExcluir !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setParaExcluir(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Remover bloqueio</DialogTitle>
            {paraExcluir ? (
              <DialogDescription>
                O bloqueio de {nomeProfissional(paraExcluir.professional_id)} (
                <span className="cz-num">
                  {formatarMomento(paraExcluir.starts_at, timezone)}
                </span>{" "}
                até{" "}
                <span className="cz-num">
                  {formatarMomento(paraExcluir.ends_at, timezone)}
                </span>
                ) será removido e os horários voltam para a oferta.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {erroExclusao ? (
            <Aviso tom="alert" role="alert">
              {erroExclusao}
            </Aviso>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setParaExcluir(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void excluir()}
              disabled={excluindo}
            >
              {excluindo ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
