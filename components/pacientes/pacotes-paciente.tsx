"use client";

import {
  CalendarRange,
  CalendarX2,
  Plus,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  ajustarSaldoDePacoteAction,
  cancelarVendaDePacoteAction,
  venderPacoteAction,
} from "@/app/(app)/pacientes/actions";
import {
  AcaoProtegida,
  BarraSessoes,
  BlocoFicha,
  diaEmTexto,
  plural,
} from "@/components/pacientes/comum";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { pacoteVencido, sessoesRestantes } from "@/lib/domain/pacientes-ui";
import type { SaldoDePacote } from "@/lib/queries/pacientes";

// Saldo de pacote do paciente. A validade e comparada em DIA CIVIL da clinica
// (regra 3.6), do mesmo jeito que a RPC pacientes_resumo compara: pacote
// vendido com 90 dias vence no dia local certo, nao no dia UTC do servidor.
// Vencido aparece com icone, rotulo e cor, nunca so cor, e conta ZERO sessao
// restante: a lista e a ficha nao podem dizer coisas diferentes sobre o mesmo
// pacote.
//
// Achado 71: alem de vender, a ficha AJUSTA o saldo (sessoes usadas e
// validade, com motivo guardado) e CANCELA a venda feita por engano (so
// administrador e gestor, e so enquanto nenhuma consulta descontou dela). A
// venda tambem cadastra pacote em andamento, comprado antes do sistema.

export type PacoteVendavel = {
  id: string;
  rotulo: string;
  /** Sessoes do pacote: limite das "sessoes ja usadas" da venda em andamento */
  sessoes: number;
};

const DICA_JA_DESCONTOU =
  "Esta venda já descontou sessão de consulta. Para corrigir, use Ajustar saldo.";

function Vencimento({ dia, vencido }: { dia: string; vencido: boolean }) {
  return (
    <span
      className={
        vencido
          ? "flex items-center gap-1.5 text-xs font-semibold text-alert-text"
          : "flex items-center gap-1.5 text-xs text-text-secondary"
      }
    >
      {vencido ? (
        <CalendarX2 className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <CalendarRange className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>
        {vencido ? "Venceu em " : "Vale até "}
        <span className="cz-num">{diaEmTexto(dia)}</span>
      </span>
    </span>
  );
}

/** Campo de motivo, obrigatorio nos dois dialogos que mexem no saldo. */
function CampoMotivo({
  id,
  valor,
  aoMudar,
  placeholder,
}: {
  id: string;
  valor: string;
  aoMudar: (valor: string) => void;
  placeholder: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Motivo (obrigatório)</Label>
      <Textarea
        id={id}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        rows={2}
        maxLength={500}
        placeholder={placeholder}
      />
      <p className="text-[11px] text-text-tertiary">
        Fica registrado junto com o seu usuário e a data.
      </p>
    </div>
  );
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) {
    return null;
  }
  return (
    <p role="alert" className="text-[13px] text-alert-text">
      {texto}
    </p>
  );
}

export function PacotesPaciente({
  contactId,
  pacotes,
  pacotesDoCatalogo,
  pacotesCadastrados,
  saldosQueJaDescontaram,
  hojeNaClinica,
  podeEditar,
  dica,
  podeCancelarVenda,
  dicaCancelarVenda,
}: {
  contactId: string;
  pacotes: SaldoDePacote[];
  /** So os pacotes ATIVOS do catalogo: o banco recusa vender desativado */
  pacotesDoCatalogo: PacoteVendavel[];
  /** Quantos pacotes a clinica tem cadastrados, ativos ou nao */
  pacotesCadastrados: number;
  /** Saldos que alguma consulta ja descontou: a venda nao se cancela */
  saldosQueJaDescontaram: string[];
  hojeNaClinica: string;
  podeEditar: boolean;
  dica: string;
  /** Admin e gestor, igual a policy "gestao remove saldo" */
  podeCancelarVenda: boolean;
  dicaCancelarVenda: string;
}) {
  const router = useRouter();

  // Venda
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [emAndamento, setEmAndamento] = useState(false);
  const [jaUsadas, setJaUsadas] = useState("0");
  const [inicio, setInicio] = useState(hojeNaClinica);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ajuste e cancelamento: o saldo escolhido abre o dialogo
  const [ajustando, setAjustando] = useState<SaldoDePacote | null>(null);
  const [usadasAjuste, setUsadasAjuste] = useState("");
  const [validadeAjuste, setValidadeAjuste] = useState("");
  const [cancelando, setCancelando] = useState<SaldoDePacote | null>(null);
  const [motivo, setMotivo] = useState("");

  const pacoteEscolhido = pacotesDoCatalogo.find(
    (pacote) => pacote.id === escolhido,
  );
  const descontaram = new Set(saldosQueJaDescontaram);

  const abrirVenda = () => {
    setErro(null);
    setEscolhido("");
    setEmAndamento(false);
    setJaUsadas("0");
    setInicio(hojeNaClinica);
    setAberto(true);
  };

  const vender = async () => {
    if (!pacoteEscolhido) {
      setErro("Escolha o pacote vendido.");
      return;
    }
    const usadas = emAndamento ? Number(jaUsadas) : 0;
    if (
      !Number.isInteger(usadas) ||
      usadas < 0 ||
      usadas >= pacoteEscolhido.sessoes
    ) {
      setErro(
        `As sessões já usadas vão de 0 a ${pacoteEscolhido.sessoes - 1} neste pacote.`,
      );
      return;
    }
    if (emAndamento && (!inicio || inicio > hojeNaClinica)) {
      setErro("Informe a data de início, até hoje.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await venderPacoteAction({
      contact_id: contactId,
      package_id: pacoteEscolhido.id,
      sessions_used: usadas,
      inicio: emAndamento ? inicio : undefined,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível registrar o pacote.");
      return;
    }
    toast.success("Pacote registrado");
    setAberto(false);
    router.refresh();
  };

  const abrirAjuste = (pacote: SaldoDePacote) => {
    setErro(null);
    setMotivo("");
    setUsadasAjuste(String(pacote.sessions_used));
    setValidadeAjuste(pacote.expires_at ?? "");
    setAjustando(pacote);
  };

  const usadasNoAjuste = Number(usadasAjuste);
  const ajusteValido =
    ajustando !== null &&
    usadasAjuste.trim() !== "" &&
    Number.isInteger(usadasNoAjuste) &&
    usadasNoAjuste >= 0 &&
    usadasNoAjuste <= ajustando.sessions_total;
  const ajusteMudou =
    ajustando !== null &&
    (usadasNoAjuste !== ajustando.sessions_used ||
      (validadeAjuste || null) !== ajustando.expires_at);

  const ajustar = async () => {
    if (!ajustando) {
      return;
    }
    if (!ajusteValido) {
      setErro(
        `As sessões usadas vão de 0 a ${ajustando.sessions_total} neste pacote.`,
      );
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await ajustarSaldoDePacoteAction({
      balance_id: ajustando.id,
      sessions_used: usadasNoAjuste,
      expires_at: validadeAjuste || null,
      motivo: motivo.trim(),
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível ajustar o saldo.");
      return;
    }
    toast.success("Saldo ajustado");
    setAjustando(null);
    router.refresh();
  };

  const abrirCancelamento = (pacote: SaldoDePacote) => {
    setErro(null);
    setMotivo("");
    setCancelando(pacote);
  };

  const cancelar = async () => {
    if (!cancelando) {
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await cancelarVendaDePacoteAction({
      balance_id: cancelando.id,
      motivo: motivo.trim(),
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível cancelar a venda.");
      return;
    }
    toast.success("Venda cancelada");
    setCancelando(null);
    router.refresh();
  };

  const motivoValido = motivo.trim().length >= 3;

  return (
    <BlocoFicha
      titulo="Saldo de pacote"
      acao={
        // 40px de altura (achado 76), e o nome "Vender pacote" e o que o e2e
        // do papel leitura procura desabilitado.
        <AcaoProtegida podeEditar={podeEditar} dica={dica} onClick={abrirVenda}>
          <Plus aria-hidden /> Vender pacote
        </AcaoProtegida>
      }
    >
      {pacotes.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          Nenhum pacote vendido para este paciente.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {pacotes.map((pacote) => {
            const vencido = pacoteVencido(pacote, hojeNaClinica);
            const restantes = sessoesRestantes(pacote, hojeNaClinica);
            const jaDescontou = descontaram.has(pacote.id);
            const nome = pacote.procedure_name ?? "Pacote";
            return (
              <li
                key={pacote.id}
                className="grid gap-2 rounded-xl bg-surface-4 p-3.5"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-text-strong">
                    {nome}
                  </span>
                  <span
                    className={
                      vencido
                        ? "cz-num text-[13px] text-text-secondary"
                        : "cz-num text-[13px] font-semibold text-text-strong"
                    }
                  >
                    {restantes} {plural(restantes, "sessão", "sessões")}{" "}
                    {plural(restantes, "restante", "restantes")}
                  </span>
                </span>
                <BarraSessoes
                  usadas={pacote.sessions_used}
                  total={pacote.sessions_total}
                  vencida={vencido}
                />
                <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                  <span>
                    <span className="cz-num">
                      {pacote.sessions_used} de {pacote.sessions_total}
                    </span>{" "}
                    {plural(
                      pacote.sessions_total,
                      "sessão usada",
                      "sessões usadas",
                    )}
                  </span>
                  {pacote.expires_at ? (
                    <Vencimento dia={pacote.expires_at} vencido={vencido} />
                  ) : (
                    <span>Sem validade</span>
                  )}
                </span>
                <div className="flex flex-wrap gap-2 pt-1">
                  <AcaoProtegida
                    podeEditar={podeEditar}
                    dica={dica}
                    onClick={() => abrirAjuste(pacote)}
                  >
                    <SlidersHorizontal aria-hidden /> Ajustar saldo
                  </AcaoProtegida>
                  <AcaoProtegida
                    podeEditar={podeCancelarVenda && !jaDescontou}
                    dica={
                      podeCancelarVenda ? DICA_JA_DESCONTOU : dicaCancelarVenda
                    }
                    variant="destructive"
                    onClick={() => abrirCancelamento(pacote)}
                  >
                    <Undo2 aria-hidden /> Cancelar venda
                  </AcaoProtegida>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Vender pacote</DialogTitle>
            <DialogDescription>
              {emAndamento
                ? "O saldo entra com as sessões já usadas, e a validade conta a partir da data de início, no fuso da clínica."
                : "O saldo entra na hora e a validade conta a partir de hoje, no fuso da clínica."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {pacotesDoCatalogo.length === 0 ? (
              pacotesCadastrados > 0 ? (
                <p className="text-[13px] text-text-secondary">
                  Nenhum pacote à venda. Os pacotes cadastrados estão
                  desativados; reative um em Cadastros para poder vender.
                </p>
              ) : (
                <p className="text-[13px] text-text-secondary">
                  Nenhum pacote cadastrado. Crie os pacotes em Cadastros para
                  poder vender.
                </p>
              )
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="pacote-escolhido">Pacote</Label>
                  <Select value={escolhido} onValueChange={setEscolhido}>
                    <SelectTrigger id="pacote-escolhido" className="w-full">
                      <SelectValue placeholder="Escolha o pacote" />
                    </SelectTrigger>
                    <SelectContent>
                      {pacotesDoCatalogo.map((pacote) => (
                        <SelectItem key={pacote.id} value={pacote.id}>
                          {pacote.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-h-10 items-center gap-2.5">
                  <Checkbox
                    id="pacote-em-andamento"
                    checked={emAndamento}
                    onCheckedChange={(valor) => setEmAndamento(valor === true)}
                  />
                  <Label
                    htmlFor="pacote-em-andamento"
                    className="text-[13px] font-medium"
                  >
                    Pacote em andamento, comprado antes do sistema
                  </Label>
                </div>
                {emAndamento ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="pacote-ja-usadas">
                        Sessões já usadas
                      </Label>
                      <Input
                        id="pacote-ja-usadas"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={
                          pacoteEscolhido
                            ? pacoteEscolhido.sessoes - 1
                            : undefined
                        }
                        value={jaUsadas}
                        onChange={(evento) => setJaUsadas(evento.target.value)}
                        className="cz-num"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="pacote-inicio">Data de início</Label>
                      <Input
                        id="pacote-inicio"
                        type="date"
                        max={hojeNaClinica}
                        value={inicio}
                        onChange={(evento) => setInicio(evento.target.value)}
                        className="cz-num"
                      />
                    </div>
                  </div>
                ) : null}
              </>
            )}
            <Erro texto={erro} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void vender()}
              disabled={salvando || pacotesDoCatalogo.length === 0}
            >
              {salvando ? "Registrando..." : "Registrar venda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ajustando !== null}
        onOpenChange={(abrir) => {
          if (!abrir) {
            setAjustando(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Ajustar saldo</DialogTitle>
            <DialogDescription>
              {ajustando
                ? `${ajustando.procedure_name ?? "Pacote"}, ${ajustando.sessions_total} ${plural(ajustando.sessions_total, "sessão", "sessões")} no pacote. Corrija as sessões usadas ou a validade.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ajuste-usadas">Sessões usadas</Label>
                <Input
                  id="ajuste-usadas"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={ajustando?.sessions_total}
                  value={usadasAjuste}
                  onChange={(evento) => setUsadasAjuste(evento.target.value)}
                  className="cz-num"
                />
                <p className="text-[11px] text-text-tertiary">
                  De <span className="cz-num">0</span> a{" "}
                  <span className="cz-num">{ajustando?.sessions_total}</span>
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ajuste-validade">Validade</Label>
                <Input
                  id="ajuste-validade"
                  type="date"
                  value={validadeAjuste}
                  onChange={(evento) => setValidadeAjuste(evento.target.value)}
                  className="cz-num"
                />
                <p className="text-[11px] text-text-tertiary">
                  Em branco, o pacote não vence.
                </p>
              </div>
            </div>
            <CampoMotivo
              id="ajuste-motivo"
              valor={motivo}
              aoMudar={setMotivo}
              placeholder="Ex.: sessão feita antes de a clínica usar o sistema"
            />
            <Erro texto={erro} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAjustando(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void ajustar()}
              disabled={salvando || !motivoValido || !ajusteMudou}
            >
              {salvando ? "Salvando..." : "Salvar ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelando !== null}
        onOpenChange={(abrir) => {
          if (!abrir) {
            setCancelando(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Cancelar venda</DialogTitle>
            <DialogDescription>
              {cancelando
                ? `O saldo de ${cancelando.procedure_name ?? "Pacote"} sai da ficha e deixa de ser descontado nas consultas. Use só para venda registrada por engano.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <CampoMotivo
              id="cancelamento-motivo"
              valor={motivo}
              aoMudar={setMotivo}
              placeholder="Ex.: pacote registrado no paciente errado"
            />
            <Erro texto={erro} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void cancelar()}
              disabled={salvando || !motivoValido}
            >
              {salvando ? "Cancelando..." : "Cancelar venda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BlocoFicha>
  );
}
