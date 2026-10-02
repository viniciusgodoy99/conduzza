"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { criarBloqueiosEmLoteAction } from "@/app/(app)/cadastros/actions";
import {
  dataFimAoMudarInicio,
  periodoDoBloqueio,
  type PeriodoDoFormulario,
} from "@/components/agenda/bloqueio-comum";
import { CampoDeMarcar } from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
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
import { diaCivil } from "@/lib/domain/horarios";

// Dialogo "Bloquear horario" (ferias, congresso, imprevisto), aberto pela
// barra da Agenda ou pelo "Bloquear este horario" do modal que nasce do
// clique no vao (ja com o profissional da coluna e a hora clicada). Criacao
// em lote conforme spec 3.9: varios profissionais de uma vez, mesmo periodo
// e motivo. Almoco nao e bloqueio, e jornada. Data e hora sao lidas no FUSO
// DA CLINICA (regra 3.6); "Dia inteiro" troca as horas por primeiro e
// ultimo dia. Consultas ja marcadas no periodo (achado 37): o servidor conta
// sem gravar, a tela avisa e so cria com confirmacao explicita. Quem monta
// so renderiza este componente enquanto ele esta aberto, entao o formulario
// nasce limpo a cada abertura.

type FormBloqueio = PeriodoDoFormulario & {
  professionalIds: string[];
  motivo: string;
  impedirEncaixe: boolean;
};

export function BloquearHorarioDialog({
  onFechar,
  profissionais,
  timezone,
  diaSugerido,
  horaSugerida,
  profissionaisSugeridos = [],
  atualizarAgenda,
  aoIrParaODia,
  titulo = "Bloquear horário",
}: {
  onFechar: () => void;
  /** Quem pode ser bloqueado (os ativos, na Agenda). */
  profissionais: readonly { id: string; name: string }[];
  timezone: string;
  /** Dia (aaaa-mm-dd, fuso da clinica) que o formulario ja traz preenchido. */
  diaSugerido: string;
  /**
   * Hora de inicio (HH:MM, fuso da clinica) ja preenchida: a hora clicada no
   * vao. O fim fica para a pessoa escolher.
   */
  horaSugerida?: string;
  /** Ja marcados ao abrir (o profissional do filtro, da semana ou da coluna). */
  profissionaisSugeridos?: readonly string[];
  /**
   * Chamado ao fim de TODA tentativa de gravar, deu certo ou nao: quem monta
   * refaz a grade. Uma resposta perdida (rede caiu depois do insert) pode
   * esconder um bloqueio que foi gravado.
   */
  atualizarAgenda: () => void;
  /**
   * Com consultas no periodo: leva a grade ao dia da primeira. Sem ele, o
   * aviso oferece o link para a Agenda.
   */
  aoIrParaODia?: (dia: string) => void;
  titulo?: string;
}) {
  const [form, setFormBruto] = useState<FormBloqueio>(() => ({
    professionalIds: profissionaisSugeridos.filter((id) =>
      profissionais.some((p) => p.id === id),
    ),
    diaInteiro: false,
    dataInicio: diaSugerido,
    horaInicio: horaSugerida ?? "",
    dataFim: diaSugerido,
    horaFim: "",
    motivo: "",
    impedirEncaixe: true,
  }));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{
    consultas: number;
    primeira: string | null;
  } | null>(null);

  // Mudou profissional ou periodo: a contagem antiga de consultas nao vale.
  const setForm = (
    proximo: FormBloqueio | ((atual: FormBloqueio) => FormBloqueio),
  ) => {
    setAviso(null);
    setFormBruto(proximo);
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
    profissionais.length > 0 &&
    profissionais.every((p) => form.professionalIds.includes(p.id));

  const alternarTodos = (marcado: boolean) => {
    setForm((atual) => ({
      ...atual,
      professionalIds: marcado ? profissionais.map((p) => p.id) : [],
    }));
  };

  const mudarDataInicio = (valor: string) => {
    setForm((atual) => ({
      ...atual,
      dataInicio: valor,
      dataFim: dataFimAoMudarInicio(atual.dataInicio, atual.dataFim, valor),
    }));
  };

  const salvar = async (confirmarConsultas = false) => {
    if (form.professionalIds.length === 0) {
      setErro("Escolha pelo menos um profissional.");
      return;
    }
    const periodo = periodoDoBloqueio(form, timezone);
    if (!periodo.ok) {
      setErro(periodo.erro);
      return;
    }
    if (!form.motivo.trim()) {
      setErro("Informe o motivo do bloqueio.");
      return;
    }
    setSalvando(true);
    setErro(null);
    let criou = false;
    // A chamada da Server Action rejeita com rede caida, excecao no servidor
    // ou deploy novo no meio: sem o finally o botao ficava em "Salvando..."
    // para sempre e nenhuma mensagem aparecia.
    try {
      const resultado = await criarBloqueiosEmLoteAction({
        professional_ids: form.professionalIds,
        starts_at: periodo.inicio.toISOString(),
        ends_at: periodo.fim.toISOString(),
        reason: form.motivo.trim(),
        blocks_overbooking: form.impedirEncaixe,
        confirmar_consultas: confirmarConsultas,
      });
      if (!resultado.ok) {
        if (resultado.code === "consultas_no_periodo") {
          setAviso({
            consultas: resultado.consultas ?? 0,
            primeira: resultado.primeiraConsulta ?? null,
          });
          return;
        }
        setErro(resultado.error ?? "Não foi possível criar o bloqueio.");
        return;
      }
      criou = true;
    } catch {
      setErro(
        "Não foi possível criar o bloqueio. Confira a conexão e tente de novo.",
      );
    } finally {
      setSalvando(false);
      atualizarAgenda();
    }
    if (criou) {
      toast.success(
        form.professionalIds.length === 1
          ? "Bloqueio criado"
          : "Bloqueios criados",
      );
      onFechar();
    }
  };

  const diaDaPrimeira = aviso?.primeira
    ? diaCivil(timezone, new Date(aviso.primeira))
    : null;

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) {
          onFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            O período aparece hachurado na agenda e os horários somem da oferta.
            Consultas já marcadas nele não são desmarcadas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-xs font-semibold text-foreground">
              Profissionais
            </legend>
            {profissionais.length === 0 ? (
              <p className="text-[13px] text-text-secondary">
                Cadastre um profissional antes de bloquear horários.
              </p>
            ) : (
              <div className="grid cz-scroll max-h-56 gap-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                {profissionais.length > 1 ? (
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13.5px] font-semibold text-text-strong cz-transition hover:bg-surface-3">
                    <Checkbox
                      checked={todosSelecionados}
                      onCheckedChange={(v) => alternarTodos(v === true)}
                    />
                    Selecionar todos
                  </label>
                ) : null}
                {profissionais.map((profissional) => (
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

          <CampoDeMarcar
            id="bloqueio-dia-inteiro"
            rotulo="Dia inteiro"
            descricao="Bloqueia de 00:00 do primeiro dia até o fim do último."
            marcado={form.diaInteiro}
            aoMudar={(marcado) => setForm({ ...form, diaInteiro: marcado })}
          />

          {form.diaInteiro ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="bloqueio-primeiro-dia">Primeiro dia</Label>
                <Input
                  id="bloqueio-primeiro-dia"
                  type="date"
                  value={form.dataInicio}
                  onChange={(e) => mudarDataInicio(e.target.value)}
                  className="cz-num"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bloqueio-ultimo-dia">Último dia</Label>
                <Input
                  id="bloqueio-ultimo-dia"
                  type="date"
                  value={form.dataFim}
                  min={form.dataInicio || undefined}
                  onChange={(e) =>
                    setForm({ ...form, dataFim: e.target.value })
                  }
                  className="cz-num"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-foreground">
                  Início
                </legend>
                <div className="grid grid-cols-[minmax(0,1fr)_128px] gap-2">
                  <Input
                    type="date"
                    aria-label="Data de início"
                    value={form.dataInicio}
                    onChange={(e) => mudarDataInicio(e.target.value)}
                    className="cz-num"
                  />
                  <Input
                    type="time"
                    aria-label="Hora de início"
                    value={form.horaInicio}
                    onChange={(e) =>
                      setForm({ ...form, horaInicio: e.target.value })
                    }
                    className="cz-num"
                  />
                </div>
              </fieldset>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-foreground">
                  Fim
                </legend>
                <div className="grid grid-cols-[minmax(0,1fr)_128px] gap-2">
                  <Input
                    type="date"
                    aria-label="Data de fim"
                    value={form.dataFim}
                    min={form.dataInicio || undefined}
                    onChange={(e) =>
                      setForm({ ...form, dataFim: e.target.value })
                    }
                    className="cz-num"
                  />
                  <Input
                    type="time"
                    aria-label="Hora de fim"
                    value={form.horaFim}
                    onChange={(e) =>
                      setForm({ ...form, horaFim: e.target.value })
                    }
                    className="cz-num"
                  />
                </div>
              </fieldset>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="bloqueio-motivo">Motivo</Label>
            <Input
              id="bloqueio-motivo"
              value={form.motivo}
              maxLength={200}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              placeholder="Férias, congresso, imprevisto"
            />
          </div>
          <CampoDeMarcar
            id="bloqueio-encaixe"
            rotulo="Impedir encaixe neste período"
            descricao="Desmarcado, a recepção ainda consegue marcar um encaixe em cima do bloqueio."
            marcado={form.impedirEncaixe}
            aoMudar={(marcado) => setForm({ ...form, impedirEncaixe: marcado })}
          />
          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
          {aviso ? (
            <AvisoDeConsultasNoPeriodo
              consultas={aviso.consultas}
              primeira={aviso.primeira}
              timezone={timezone}
              salvando={salvando}
              aoConfirmar={() => void salvar(true)}
              aoIrParaODia={
                aoIrParaODia && diaDaPrimeira
                  ? () => {
                      aoIrParaODia(diaDaPrimeira);
                      onFechar();
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          {aviso ? null : (
            <Button
              onClick={() => void salvar()}
              disabled={salvando || profissionais.length === 0}
            >
              {salvando ? "Salvando..." : "Criar bloqueio"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Aviso de consultas ja marcadas no periodo (achado 37), no desenho do
// AvisoDeConsultas dos Cadastros. Dentro da Agenda, o atalho leva a grade ao
// dia da primeira consulta em vez de abrir a propria Agenda de novo.
function AvisoDeConsultasNoPeriodo({
  consultas,
  primeira,
  timezone,
  salvando,
  aoConfirmar,
  aoIrParaODia,
}: {
  consultas: number;
  primeira: string | null;
  timezone: string;
  salvando: boolean;
  aoConfirmar: () => void;
  aoIrParaODia?: () => void;
}) {
  const quando = primeira
    ? `${new Date(primeira).toLocaleDateString("pt-BR", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
      })} às ${new Date(primeira).toLocaleTimeString("pt-BR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : null;
  // Atencao e CircleAlert (padrao do Aviso warning): TriangleAlert e so do
  // status Faltou (tabela de icones reservados, docs/06 secao 4.6).
  return (
    <Aviso tom="warning" role="alert">
      <p className="text-[13.5px] leading-[1.35] font-bold">
        Há <span className="cz-num">{consultas}</span>{" "}
        {consultas === 1 ? "consulta marcada" : "consultas marcadas"} neste
        período. Remarque ou cancele.
      </p>
      <p className="mt-1">
        {quando ? (
          <>
            A primeira é em <span className="cz-num">{quando}</span>.{" "}
          </>
        ) : null}
        O bloqueio não desmarca nada: as consultas continuam valendo e os
        lembretes continuam saindo para os pacientes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {aoIrParaODia ? (
          <Button variant="outline" onClick={aoIrParaODia}>
            <CalendarDays aria-hidden /> Ver o dia na Agenda
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/agenda">
              <CalendarDays aria-hidden /> Abrir a Agenda
            </Link>
          </Button>
        )}
        <Button variant="ghost" onClick={aoConfirmar} disabled={salvando}>
          {salvando ? "Salvando..." : "Criar o bloqueio mesmo assim"}
        </Button>
      </div>
    </Aviso>
  );
}
