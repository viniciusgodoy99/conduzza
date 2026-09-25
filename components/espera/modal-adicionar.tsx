"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { adicionarNaEsperaAction } from "@/app/(app)/espera/actions";
import { concederConsentimentoAction } from "@/app/(app)/leads/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
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
import { Skeleton } from "@/components/ui/skeleton";
import { CONSENT_STATUS } from "@/lib/design/status";
import {
  chaveDeTelefone,
  formatarTelefone,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import { esperaKeys, fetchAutorizacaoDoContato } from "@/lib/queries/espera";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Adicionar manualmente a fila (brief da Tela 10): busca de contato com
// debounce (mesmo desenho da BuscaPaciente da agenda), pedido (procedimento
// e profissional opcionais) e preferencias de turno e dias.
//
// Achado 57: a reoferta so manda mensagem para quem tem autorizacao vigente
// (regra 3.3) e pula os outros calada. Por isso, escolhido o paciente, o
// modal confere a autorizacao e, sem ela, diz que a oferta nao sai para ele
// e oferece o registro ali mesmo (a mesma acao da ficha, origem recepcao,
// com evidencia obrigatoria). Entrar na fila continua permitido: a recepcao
// ainda pode ligar para oferecer a vaga.

const TURNOS = [
  { valor: "manha", rotulo: "Manhã" },
  { valor: "tarde", rotulo: "Tarde" },
  { valor: "noite", rotulo: "Noite" },
];
const DIAS = [
  { valor: 0, curto: "Dom", nome: "Domingo" },
  { valor: 1, curto: "Seg", nome: "Segunda" },
  { valor: 2, curto: "Ter", nome: "Terça" },
  { valor: 3, curto: "Qua", nome: "Quarta" },
  { valor: 4, curto: "Qui", nome: "Quinta" },
  { valor: 5, curto: "Sex", nome: "Sexta" },
  { valor: 6, curto: "Sáb", nome: "Sábado" },
];

const QUALQUER = "__qualquer__";

export type OpcaoDeCatalogo = { id: string; name: string };

/** Contato escolhido para entrar na fila (da busca ou do link da ficha). */
export type ContatoEscolhido = {
  id: string;
  nome: string;
  telefone: string | null;
};

type ResultadoDaBusca = { id: string; name: string | null; phone_e164: string };

type EstadoDaBusca =
  | { situacao: "ocioso" }
  | { situacao: "buscando" }
  | { situacao: "pronto"; resultados: ResultadoDaBusca[] }
  | { situacao: "erro" };

/**
 * Receita "Escolha em chip" do design system (docs/06 secao 4.7): sem
 * escolha, borda de campo sobre o cartao; escolhido, lime suave com borda e
 * o Check antes do rotulo. Nunca o lime cheio (o lime do modal e o botao
 * "Adicionar a lista").
 */
function ChipDeEscolha({
  marcado,
  rotulo,
  nomeAcessivel,
  className,
  onAlternar,
}: {
  marcado: boolean;
  rotulo: string;
  /** Nome inteiro quando o rotulo e abreviado ("Seg" vira "Segunda"). */
  nomeAcessivel?: string;
  className?: string;
  onAlternar: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      aria-label={nomeAcessivel}
      onClick={onAlternar}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium outline-none cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
        marcado
          ? "border-primary-edge bg-primary-soft font-semibold text-primary-text hover:bg-primary-soft-hover"
          : "border-input bg-card text-foreground hover:bg-surface-3",
        className,
      )}
    >
      {marcado ? <Check className="size-3.5" aria-hidden /> : null}
      {rotulo}
    </button>
  );
}

export function ModalAdicionar({
  clinicId,
  aberto,
  onFechar,
  procedimentos,
  profissionais,
  contatoInicial,
  podeRegistrarAutorizacao,
  dicaAutorizacao,
  aoMudar,
}: {
  clinicId: string;
  aberto: boolean;
  onFechar: () => void;
  procedimentos: OpcaoDeCatalogo[];
  profissionais: OpcaoDeCatalogo[];
  /** Vindo de /espera?adicionar=<contactId> (ficha do paciente, Inbox). */
  contatoInicial: ContatoEscolhido | null;
  /** Registrar autorizacao e acao de leads e pacientes (outra chave). */
  podeRegistrarAutorizacao: boolean;
  dicaAutorizacao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [termo, setTermo] = useState("");
  const [busca, setBusca] = useState<EstadoDaBusca>({ situacao: "ocioso" });
  const [tentativaDaBusca, setTentativaDaBusca] = useState(0);
  const [contato, setContato] = useState<ContatoEscolhido | null>(null);
  const [procedimento, setProcedimento] = useState(QUALQUER);
  const [profissional, setProfissional] = useState(QUALQUER);
  const [turnos, setTurnos] = useState<string[]>([]);
  const [dias, setDias] = useState<number[]>([]);
  const [pendente, iniciarTransicao] = useTransition();

  // Cada abertura comeca limpa: o pedido de uma pessoa nao vaza para a
  // proxima (turnos e dias marcados antes ficavam para o paciente seguinte).
  useEffect(() => {
    if (aberto) {
      setContato(contatoInicial);
      setTermo("");
      setBusca({ situacao: "ocioso" });
      setProcedimento(QUALQUER);
      setProfissional(QUALQUER);
      setTurnos([]);
      setDias([]);
    }
  }, [aberto, contatoInicial]);

  // Debounce de 300ms na busca por nome ou telefone (padrao da agenda).
  // Telefone completo casa pela CHAVE (phone_key), com ou sem o nono digito
  // e em qualquer formato: "(85) 99999-0000" acha o contato que o WhatsApp
  // gravou sem o 9. Pedaco de numero procura pelos digitos (a pontuacao
  // digitada nao atrapalha); o resto e nome.
  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2 || contato) {
      setBusca({ situacao: "ocioso" });
      return;
    }
    setBusca({ situacao: "buscando" });
    let descartada = false;
    const timer = setTimeout(() => {
      const telefone = normalizarTelefone(limpo);
      const digitos = limpo.replace(/\D/g, "");
      const pareceTelefone = /^[\d\s()+.-]+$/.test(limpo);
      let consulta = supabase
        .from("contact")
        .select("id, name, phone_e164")
        .eq("clinic_id", clinicId);
      if (telefone) {
        consulta = consulta.eq("phone_key", chaveDeTelefone(telefone));
      } else if (pareceTelefone && digitos.length >= 4) {
        // Pedaco de numero pela CHAVE, que sempre tem o nono digito (achado
        // L15): "99999-0000" acha quem o WhatsApp gravou como
        // +558599990000, e a tela mostra o numero com o 9. O texto gravado
        // segue valendo para pedaco sem o 9 que atravessa o DDD ("858765").
        // `digitos` so tem digitos: seguro dentro do or.
        consulta = consulta.or(
          `phone_key.ilike.%${digitos}%,phone_e164.ilike.%${digitos}%`,
        );
      } else {
        consulta = consulta.ilike(
          "name",
          `%${limpo.replace(/[%_,()\\]/g, "")}%`,
        );
      }
      void consulta
        .order("name")
        .limit(8)
        .then(({ data, error }) => {
          if (descartada) {
            return;
          }
          setBusca(
            error
              ? { situacao: "erro" }
              : {
                  situacao: "pronto",
                  resultados: (data ?? []) as ResultadoDaBusca[],
                },
          );
        });
    }, 300);
    return () => {
      descartada = true;
      clearTimeout(timer);
    };
  }, [termo, contato, supabase, clinicId, tentativaDaBusca]);

  const alternar = <T,>(lista: T[], valor: T): T[] =>
    lista.includes(valor)
      ? lista.filter((item) => item !== valor)
      : [...lista, valor];

  const adicionar = () => {
    if (!contato) {
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await adicionarNaEsperaAction({
        contact_id: contato.id,
        procedure_id: procedimento === QUALQUER ? null : procedimento,
        professional_id: profissional === QUALQUER ? null : profissional,
        preferred_shifts: turnos,
        preferred_weekdays: [...dias].sort((a, b) => a - b),
      });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível adicionar.");
        return;
      }
      toast.success(`${contato.nome} entrou na lista de espera.`);
      onFechar();
      await aoMudar();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Adicionar à lista de espera</DialogTitle>
          <DialogDescription>
            Quando um horário compatível vagar, a oferta sai sozinha para a
            fila, na ordem de prioridade.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            {contato ? (
              <>
                <span className="text-xs font-semibold text-foreground">
                  Paciente
                </span>
                <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-surface-4 py-1.5 pr-1.5 pl-3">
                  <ContactAvatar
                    name={contato.nome}
                    phone={contato.telefone ?? ""}
                    size={30}
                  />
                  <div className="grid min-w-0 flex-1 gap-px">
                    <span className="truncate text-[13.5px] font-semibold text-text-strong">
                      {contato.nome}
                    </span>
                    {contato.telefone ? (
                      <span className="truncate cz-num text-xs text-text-secondary">
                        {formatarTelefone(contato.telefone)}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={`Trocar o paciente (${contato.nome})`}
                    onClick={() => setContato(null)}
                  >
                    Trocar
                  </Button>
                </div>
                <AutorizacaoDoContato
                  key={contato.id}
                  clinicId={clinicId}
                  contato={contato}
                  podeRegistrar={podeRegistrarAutorizacao}
                  dicaAutorizacao={dicaAutorizacao}
                />
              </>
            ) : (
              <>
                <Label htmlFor="espera-contato">Paciente</Label>
                <Input
                  id="espera-contato"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Nome ou telefone"
                  autoComplete="off"
                />
                <ResultadosDaBusca
                  busca={busca}
                  aoEscolher={(linha) =>
                    setContato({
                      id: linha.id,
                      nome: linha.name ?? formatarTelefone(linha.phone_e164),
                      telefone: linha.phone_e164,
                    })
                  }
                  aoTentarDeNovo={() => setTentativaDaBusca((n) => n + 1)}
                />
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="espera-procedimento">Procedimento</Label>
              <Select value={procedimento} onValueChange={setProcedimento}>
                <SelectTrigger id="espera-procedimento" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                  {procedimentos.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="espera-profissional">Profissional</Label>
              <Select value={profissional} onValueChange={setProfissional}>
                <SelectTrigger id="espera-profissional" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                  {profissionais.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="pb-1.5 text-xs font-semibold text-foreground">
              Preferência de turno
            </legend>
            <div className="flex flex-wrap gap-2">
              {TURNOS.map((turno) => (
                <ChipDeEscolha
                  key={turno.valor}
                  marcado={turnos.includes(turno.valor)}
                  rotulo={turno.rotulo}
                  onAlternar={() =>
                    setTurnos((atual) => alternar(atual, turno.valor))
                  }
                />
              ))}
            </div>
            <p className="text-[11px] text-text-secondary">
              Nada marcado significa qualquer horário.
            </p>
          </fieldset>

          <fieldset className="grid gap-1.5">
            <legend className="pb-1.5 text-xs font-semibold text-foreground">
              Preferência de dias
            </legend>
            <div className="flex flex-wrap gap-2">
              {DIAS.map((dia) => (
                <ChipDeEscolha
                  key={dia.valor}
                  marcado={dias.includes(dia.valor)}
                  rotulo={dia.curto}
                  nomeAcessivel={dia.nome}
                  className="min-w-11"
                  onAlternar={() =>
                    setDias((atual) => alternar(atual, dia.valor))
                  }
                />
              ))}
            </div>
            <p className="text-[11px] text-text-secondary">
              Nada marcado significa qualquer dia.
            </p>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={pendente || !contato} onClick={adicionar}>
            {pendente ? "Adicionando..." : "Adicionar à lista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Busca em andamento, erro, nada encontrado ou a lista para escolher. */
function ResultadosDaBusca({
  busca,
  aoEscolher,
  aoTentarDeNovo,
}: {
  busca: EstadoDaBusca;
  aoEscolher: (linha: ResultadoDaBusca) => void;
  aoTentarDeNovo: () => void;
}) {
  if (busca.situacao === "ocioso") {
    return null;
  }
  if (busca.situacao === "buscando") {
    return (
      <p
        role="status"
        className="flex min-h-10 items-center gap-2 text-[13px] text-text-secondary"
      >
        <LoaderCircle
          className="size-3.5 motion-safe:animate-spin"
          aria-hidden
        />
        Buscando...
      </p>
    );
  }
  if (busca.situacao === "erro") {
    return (
      <Aviso
        tom="alert"
        role="alert"
        acao={
          <Button variant="outline" onClick={aoTentarDeNovo}>
            Tentar de novo
          </Button>
        }
      >
        Não foi possível buscar agora.
      </Aviso>
    );
  }
  if (busca.resultados.length === 0) {
    return (
      <p role="status" className="py-2 text-[13px] text-text-secondary">
        Ninguém encontrado com esse nome ou telefone.
      </p>
    );
  }
  return (
    <ul
      aria-label="Contatos encontrados"
      className="grid cz-scroll max-h-52 gap-0.5 overflow-y-auto rounded-xl border border-border-strong bg-popover p-[5px] shadow-xs"
    >
      {busca.resultados.map((linha) => (
        <li key={linha.id}>
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[13px] outline-none cz-transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            onClick={() => aoEscolher(linha)}
          >
            <ContactAvatar
              name={linha.name}
              phone={linha.phone_e164}
              size={24}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {linha.name ?? "Sem nome"}
            </span>
            <span className="shrink-0 cz-num text-xs text-text-secondary">
              {formatarTelefone(linha.phone_e164)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Autorizacao do paciente escolhido para receber mensagens (achado 57).
 * Autorizado: o chip do CONSENT_STATUS basta. Sem autorizacao ou revogada:
 * diz que a reoferta automatica pula esse paciente e oferece o registro
 * ali mesmo. Carregando ou com erro nunca aparece como "sem autorizacao".
 */
function AutorizacaoDoContato({
  clinicId,
  contato,
  podeRegistrar,
  dicaAutorizacao,
}: {
  clinicId: string;
  contato: ContatoEscolhido;
  podeRegistrar: boolean;
  dicaAutorizacao: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [registrando, setRegistrando] = useState(false);
  const [evidencia, setEvidencia] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarTransicao] = useTransition();
  const chave = esperaKeys.consentimento(clinicId, contato.id);
  const consulta = useQuery({
    queryKey: chave,
    queryFn: () => fetchAutorizacaoDoContato(supabase, clinicId, contato.id),
    staleTime: 30_000,
  });

  if (consulta.isPending) {
    return (
      <div role="status" className="pt-1">
        <Skeleton className="h-5 w-56" />
        <span className="sr-only">
          Conferindo a autorização para receber mensagens
        </span>
      </div>
    );
  }
  if (consulta.isError) {
    return (
      <Aviso
        tom="alert"
        role="alert"
        acao={
          <Button variant="outline" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </Button>
        }
      >
        Não foi possível conferir a autorização para receber mensagens.
      </Aviso>
    );
  }

  const situacao = consulta.data;
  if (situacao === "autorizado") {
    return (
      <span className="flex pt-1">
        <StatusChip size="sm" definition={CONSENT_STATUS.autorizado} />
      </span>
    );
  }

  const revogado = situacao === "revogado";
  const rotuloDoRegistro = revogado
    ? "Registrar nova autorização"
    : "Registrar autorização";
  const evidenciaValida = evidencia.trim().length >= 2;

  const registrar = () => {
    if (!evidenciaValida) {
      setErro("Descreva quando e como o paciente autorizou.");
      return;
    }
    setErro(null);
    iniciarTransicao(async () => {
      const resultado = await concederConsentimentoAction({
        contact_id: contato.id,
        source: "recepcao",
        evidence: evidencia.trim(),
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível registrar a autorização.");
        return;
      }
      toast.success("Autorização registrada");
      setRegistrando(false);
      setEvidencia("");
      await queryClient.invalidateQueries({ queryKey: chave });
    });
  };

  return (
    <div className="grid gap-2 pt-1">
      <span className="flex">
        <StatusChip size="sm" definition={CONSENT_STATUS[situacao]} />
      </span>
      <Aviso
        tom="warning"
        titulo="A oferta automática de horário não vai para este paciente"
      >
        {revogado
          ? "Ele pediu para não receber mensagens. Pode entrar na fila, mas a oferta pelo WhatsApp não sai para ele. Só registre de novo se ele autorizou outra vez."
          : "Ele pode entrar na fila, mas sem autorização para receber mensagens a oferta pelo WhatsApp não sai para ele. Se ele autorizou, registre aqui."}
      </Aviso>
      {registrando ? (
        <div className="grid gap-3 rounded-xl bg-surface-4 p-3.5">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
            <span className="text-text-secondary">Como autorizou</span>
            <span className="text-foreground">Recepção</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="espera-evidencia">Evidência</Label>
            <Input
              id="espera-evidencia"
              value={evidencia}
              maxLength={500}
              autoFocus
              placeholder="Ex.: autorizou por telefone ao entrar na lista"
              onChange={(e) => setEvidencia(e.target.value)}
            />
            <p className="text-[11px] text-text-secondary">
              Obrigatória: quando e como a autorização foi dada.
            </p>
          </div>
          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={salvando}
              onClick={() => {
                setRegistrando(false);
                setErro(null);
              }}
            >
              Voltar
            </Button>
            <Button
              variant="solid"
              disabled={salvando || !evidenciaValida}
              onClick={registrar}
            >
              {salvando ? "Registrando..." : rotuloDoRegistro}
            </Button>
          </div>
        </div>
      ) : (
        <span className="flex">
          {podeRegistrar ? (
            <Button variant="outline" onClick={() => setRegistrando(true)}>
              {rotuloDoRegistro}
            </Button>
          ) : (
            <DisabledWithHint hint={dicaAutorizacao}>
              <Button variant="outline" disabled>
                {rotuloDoRegistro}
              </Button>
            </DisabledWithHint>
          )}
        </span>
      )}
    </div>
  );
}
