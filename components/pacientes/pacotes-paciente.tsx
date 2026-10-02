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
import {
  itensDoAjuste,
  resumoDosItens,
  usadasParaVender,
  type ItemVendavel,
} from "@/lib/domain/pacotes-ui";
import type { SaldoDePacote } from "@/lib/queries/pacientes";
import { formatarCentavos } from "@/lib/utils/moeda";

// Saldo de pacote do paciente. A validade e comparada em DIA CIVIL da clinica
// (regra 3.6), do mesmo jeito que a RPC pacientes_resumo compara: pacote
// vendido com 90 dias vence no dia local certo, nao no dia UTC do servidor.
// Vencido aparece com icone, rotulo e cor, nunca so cor, e conta ZERO sessao
// restante: a lista e a ficha nao podem dizer coisas diferentes sobre o mesmo
// pacote.
//
// Pacote com varios procedimentos (pedido do dono em 29/09/2026): um cartao
// por VENDA, com uma barra por procedimento (o saldo e por item) e a validade
// da venda inteira. A venda em andamento pede as sessoes ja usadas de cada
// procedimento, e o ajuste corrige cada procedimento e a validade com um
// motivo so.
//
// Achado 71: alem de vender, a ficha AJUSTA o saldo (sessoes usadas e
// validade, com motivo guardado) e CANCELA a venda feita por engano (so
// administrador e gestor, e so enquanto nenhuma consulta descontou dela). A
// venda tambem cadastra pacote em andamento, comprado antes do sistema.

/** Pacote a venda (ativo e com procedimentos), como o dialogo de venda o mostra. */
export type PacoteVendavel = {
  id: string;
  nome: string;
  price_cents: number;
  /** Validade do pacote em dias a partir da venda; null = nao vence */
  validity_days: number | null;
  /** Os procedimentos do pacote, na ordem do nome */
  itens: ItemVendavel[];
};

function resumoDoPacote(pacote: PacoteVendavel): string {
  const nomes = new Map(pacote.itens.map((item) => [item.procedure_id, item]));
  return resumoDosItens(
    pacote.itens,
    (procedureId) => nomes.get(procedureId)?.nome ?? "Procedimento",
  );
}

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

/**
 * O que o pacote escolhido inclui: preco, validade e os procedimentos com as
 * sessoes de cada um. No pacote em andamento, cada procedimento ganha o campo
 * das sessoes ja usadas (de 0 ate as sessoes dele; campo vazio conta 0).
 */
function ItensDaVenda({
  pacote,
  emAndamento,
  jaUsadas,
  aoMudarJaUsadas,
}: {
  pacote: PacoteVendavel;
  emAndamento: boolean;
  jaUsadas: Readonly<Record<string, string>>;
  aoMudarJaUsadas: (procedureId: string, valor: string) => void;
}) {
  return (
    <div className="grid gap-2.5 rounded-xl border border-border p-3.5">
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-text-strong">
            {pacote.nome}
          </span>
          <span className="cz-num text-[13px] text-text-strong">
            {formatarCentavos(pacote.price_cents)}
          </span>
        </span>
        <span className="text-xs text-text-secondary">
          {pacote.validity_days === null ? (
            "Sem validade"
          ) : (
            <>
              Vale <span className="cz-num">{pacote.validity_days}</span>{" "}
              {plural(pacote.validity_days, "dia", "dias")} a partir{" "}
              {emAndamento ? "da data de início" : "de hoje"}
            </>
          )}
        </span>
      </div>
      <ul
        className="grid border-t border-border"
        aria-label={`Procedimentos de ${pacote.nome}`}
      >
        {pacote.itens.map((item) => {
          const idCampo = `pacote-ja-usadas-${item.procedure_id}`;
          return (
            <li
              key={item.procedure_id}
              className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border py-1.5 last:border-b-0"
            >
              <span className="text-[13px] text-foreground">
                <span className="font-medium">{item.nome}</span>{" "}
                <span className="text-text-secondary">
                  <span className="cz-num">{item.sessions}</span>{" "}
                  {plural(item.sessions, "sessão", "sessões")}
                </span>
              </span>
              {emAndamento ? (
                <span className="flex items-center gap-2">
                  <Label htmlFor={idCampo} className="font-medium">
                    Já usadas<span className="sr-only"> de {item.nome}</span>
                  </Label>
                  <Input
                    id={idCampo}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={item.sessions}
                    placeholder="0"
                    value={jaUsadas[item.procedure_id] ?? ""}
                    onChange={(evento) =>
                      aoMudarJaUsadas(item.procedure_id, evento.target.value)
                    }
                    className="w-20 cz-num"
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
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

  // Venda. As sessoes ja usadas (pacote em andamento) sao por procedimento,
  // em texto como o campo guarda, pela chave procedure_id.
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [emAndamento, setEmAndamento] = useState(false);
  const [jaUsadas, setJaUsadas] = useState<Record<string, string>>({});
  const [inicio, setInicio] = useState(hojeNaClinica);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ajuste e cancelamento: a venda escolhida abre o dialogo. As sessoes
  // usadas do ajuste sao por item da venda (chave: id do item).
  const [ajustando, setAjustando] = useState<SaldoDePacote | null>(null);
  const [usadasAjuste, setUsadasAjuste] = useState<Record<string, string>>({});
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
    setJaUsadas({});
    setInicio(hojeNaClinica);
    setAberto(true);
  };

  const vender = async () => {
    if (!pacoteEscolhido) {
      setErro("Escolha o pacote vendido.");
      return;
    }
    let usadas: { procedure_id: string; sessions_used: number }[] = [];
    if (emAndamento) {
      const conferidas = usadasParaVender(pacoteEscolhido.itens, jaUsadas);
      if (!conferidas.ok) {
        setErro(conferidas.erro);
        return;
      }
      usadas = conferidas.usadas;
      if (!inicio || inicio > hojeNaClinica) {
        setErro("Informe a data de início, até hoje.");
        return;
      }
    }
    setSalvando(true);
    setErro(null);
    const resultado = await venderPacoteAction({
      contact_id: contactId,
      package_id: pacoteEscolhido.id,
      usadas,
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
    setUsadasAjuste(
      Object.fromEntries(
        pacote.itens.map((item) => [item.id, String(item.sessions_used)]),
      ),
    );
    setValidadeAjuste(pacote.expires_at ?? "");
    setAjustando(pacote);
  };

  // So os itens que mudaram vao para o banco (uma linha de historico por
  // item). Campo invalido conta como mudanca: o Salvar fica ativo para a
  // tela dizer o que corrigir.
  const ajuste = ajustando
    ? itensDoAjuste(ajustando.itens, usadasAjuste)
    : null;
  const validadeMudou =
    ajustando !== null && (validadeAjuste || null) !== ajustando.expires_at;
  const ajusteMudou =
    ajuste !== null && (!ajuste.ok || ajuste.itens.length > 0 || validadeMudou);

  const ajustar = async () => {
    if (!ajustando || !ajuste) {
      return;
    }
    if (!ajuste.ok) {
      setErro(ajuste.erro);
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await ajustarSaldoDePacoteAction({
      balance_id: ajustando.id,
      itens: ajuste.itens,
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
            const nome = pacote.package_name ?? "Pacote";
            return (
              <li
                key={pacote.id}
                className="grid gap-3 rounded-xl border border-border p-3.5"
              >
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-text-strong">
                      {nome}
                    </h3>
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
                  </div>
                  {pacote.expires_at ? (
                    <Vencimento dia={pacote.expires_at} vencido={vencido} />
                  ) : (
                    <span className="text-xs text-text-secondary">
                      Sem validade
                    </span>
                  )}
                </div>
                <ul
                  className="grid gap-2.5"
                  aria-label={`Procedimentos de ${nome}`}
                >
                  {pacote.itens.map((item) => {
                    const procedimento = item.procedure_name ?? "Procedimento";
                    return (
                      <li key={item.id} className="grid gap-1.5">
                        <span className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                          <span className="font-medium text-foreground">
                            {procedimento}
                          </span>
                          <span className="text-xs text-text-secondary">
                            <span className="cz-num">
                              {item.sessions_used} de {item.sessions_total}
                            </span>{" "}
                            {plural(item.sessions_total, "usada", "usadas")}
                          </span>
                        </span>
                        <BarraSessoes
                          usadas={item.sessions_used}
                          total={item.sessions_total}
                          vencida={vencido}
                          nome={procedimento}
                        />
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-2">
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
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Vender pacote</DialogTitle>
            <DialogDescription>
              {emAndamento
                ? "O saldo entra com as sessões já usadas de cada procedimento, e a validade conta a partir da data de início, no fuso da clínica."
                : "O saldo de cada procedimento entra na hora e a validade conta a partir de hoje, no fuso da clínica."}
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
                  <Select
                    value={escolhido}
                    onValueChange={(valor) => {
                      setEscolhido(valor);
                      setJaUsadas({});
                      setErro(null);
                    }}
                  >
                    <SelectTrigger id="pacote-escolhido" className="w-full">
                      <SelectValue placeholder="Escolha o pacote" />
                    </SelectTrigger>
                    <SelectContent>
                      {pacotesDoCatalogo.map((pacote) => (
                        <SelectItem key={pacote.id} value={pacote.id}>
                          {pacote.nome} ({resumoDoPacote(pacote)})
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
                {pacoteEscolhido ? (
                  <ItensDaVenda
                    pacote={pacoteEscolhido}
                    emAndamento={emAndamento}
                    jaUsadas={jaUsadas}
                    aoMudarJaUsadas={(procedureId, valor) =>
                      setJaUsadas({ ...jaUsadas, [procedureId]: valor })
                    }
                  />
                ) : null}
                {emAndamento ? (
                  <div className="grid gap-1.5 sm:max-w-[220px]">
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
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Ajustar saldo</DialogTitle>
            <DialogDescription>
              {ajustando
                ? `${ajustando.package_name ?? "Pacote"}: corrija as sessões usadas de cada procedimento ou a validade do pacote.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {ajustando ? (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-foreground">
                  Sessões usadas
                </legend>
                <ul className="grid rounded-xl border border-border">
                  {ajustando.itens.map((item) => {
                    const procedimento = item.procedure_name ?? "Procedimento";
                    const idCampo = `ajuste-usadas-${item.id}`;
                    return (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border px-3.5 py-2 last:border-b-0"
                      >
                        <Label
                          htmlFor={idCampo}
                          className="text-[13px] font-medium"
                        >
                          <span className="sr-only">Sessões usadas de </span>
                          {procedimento}
                        </Label>
                        <span className="flex items-center gap-2">
                          <Input
                            id={idCampo}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={item.sessions_total}
                            value={
                              usadasAjuste[item.id] ??
                              String(item.sessions_used)
                            }
                            onChange={(evento) =>
                              setUsadasAjuste({
                                ...usadasAjuste,
                                [item.id]: evento.target.value,
                              })
                            }
                            aria-describedby={`${idCampo}-total`}
                            className="w-20 cz-num"
                          />
                          <span
                            id={`${idCampo}-total`}
                            className="text-xs whitespace-nowrap text-text-secondary"
                          >
                            de{" "}
                            <span className="cz-num">
                              {item.sessions_total}
                            </span>
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ) : null}
            <div className="grid gap-1.5 sm:max-w-[220px]">
              <Label htmlFor="ajuste-validade">Validade do pacote</Label>
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
                ? `A venda de ${cancelando.package_name ?? "Pacote"} sai da ficha, com o saldo de todos os procedimentos, e deixa de ser descontada nas consultas. Use só para venda registrada por engano.`
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
