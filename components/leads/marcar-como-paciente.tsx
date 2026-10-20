"use client";

import { IdCard } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { marcarComoPacienteAction } from "@/app/(app)/leads/actions";
import { Aviso } from "@/components/shared/aviso";
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

// "Marcar como paciente" (decisao do dono em 20/10/2026): o lead passa a
// aparecer em Pacientes sem consulta marcada. Tres portas, uma confirmacao
// so: a acao em massa da lista de Leads (em lotes, components/leads/
// barra-acoes-massa.tsx), a gaveta de Leads e o painel do contato no
// Atendimento (BotaoMarcarComoPaciente, um contato). Antes de gravar, o
// dialogo diz quantos mudam, que eles passam a aparecer em Pacientes e que a
// etapa do funil NAO muda (mover para Agendou ou Compareceu geraria
// conversao falsa para a Meta). Nao ha caminho de volta pela tela, e o
// dialogo diz isso tambem.
//
// Sem permissao (profissional e leitura): visivel, desabilitado e com a dica
// do projeto (permissionHint). A Server Action confere o papel de novo.

export const ROTULO_MARCAR_COMO_PACIENTE = "Marcar como paciente";

/** "1 lead passa" ou "3 leads passam": o sujeito da frase do dialogo. */
function quemPassa(leads: number, nome: string | null | undefined): string {
  if (nome) {
    return `${nome} passa`;
  }
  return leads === 1 ? "O lead passa" : `Os ${leads} leads passam`;
}

/**
 * O dialogo de confirmacao, so apresentacao: quem chama decide o que gravar
 * (um contato, ou varios em lotes) e quando fecha.
 */
export function DialogoMarcarComoPaciente({
  aberto,
  leads,
  jaPacientes = 0,
  nome,
  salvando = false,
  erro = null,
  onConfirmar,
  onFechar,
}: {
  aberto: boolean;
  /** Quantos leads mudam para paciente. */
  leads: number;
  /** Quantos dos escolhidos ja sao pacientes (ficam como estao). */
  jaPacientes?: number;
  /** O nome (ou o telefone) do contato, quando e um so. */
  nome?: string | null;
  salvando?: boolean;
  erro?: string | null;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const umSo = leads === 1;
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrindo) => {
        if (!abrindo && !salvando) {
          onFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[440px]" showCloseButton={!salvando}>
        <DialogHeader>
          <DialogTitle>
            {umSo
              ? "Marcar como paciente?"
              : `Marcar ${leads} leads como pacientes?`}
          </DialogTitle>
          <DialogDescription>
            {quemPassa(leads, nome)} a aparecer em Pacientes, mesmo sem consulta
            marcada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-[13px] leading-[1.5]">
          <p className="text-foreground">
            A etapa no funil não muda.
            {jaPacientes > 0
              ? jaPacientes === 1
                ? " 1 dos selecionados já é paciente e fica como está."
                : ` ${jaPacientes} dos selecionados já são pacientes e ficam como estão.`
              : null}
          </p>
          <p className="text-text-secondary">
            {umSo
              ? "Depois de marcado, o contato não volta a ser lead pela tela."
              : "Depois de marcados, eles não voltam a ser leads pela tela."}
          </p>
        </div>
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={salvando} onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={onConfirmar}>
            <IdCard aria-hidden />
            {salvando
              ? "Marcando..."
              : umSo
                ? ROTULO_MARCAR_COMO_PACIENTE
                : `Marcar ${leads} como pacientes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O botao de UM contato (gaveta de Leads e painel do Atendimento), com a
 * confirmacao. Quem chama so mostra o botao para lead; `aoMarcar` recebe
 * quantos mudaram (0 quando outra pessoa ja tinha marcado) para a tela
 * atualizar o que mostra.
 */
export function BotaoMarcarComoPaciente({
  contactId,
  nome,
  podeEditar,
  dica,
  aoMarcar,
  size = "default",
  className,
}: {
  contactId: string;
  /** Nome ou telefone, para o dialogo dizer quem. */
  nome: string;
  podeEditar: boolean;
  /** Dica do botao desabilitado (permissionHint de leads_pacientes). */
  dica: string;
  aoMarcar?: (marcados: number) => void;
  size?: "default" | "sm";
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const botao = (
    <Button
      variant="outline"
      size={size}
      className={className}
      disabled={!podeEditar || salvando}
      onClick={() => {
        setErro(null);
        setAberto(true);
      }}
    >
      <IdCard aria-hidden />
      {ROTULO_MARCAR_COMO_PACIENTE}
    </Button>
  );

  if (!podeEditar) {
    return (
      <DisabledWithHint hint={dica} className={className}>
        {botao}
      </DisabledWithHint>
    );
  }

  const confirmar = async () => {
    setSalvando(true);
    setErro(null);
    let resultado: Awaited<ReturnType<typeof marcarComoPacienteAction>>;
    try {
      resultado = await marcarComoPacienteAction({ contact_ids: [contactId] });
    } catch {
      resultado = {
        ok: false,
        error: "Não foi possível falar com o servidor. Tente de novo.",
      };
    }
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error);
      return;
    }
    setAberto(false);
    if (resultado.marcados > 0) {
      toast.success("Contato marcado como paciente");
    } else {
      toast.info("Este contato já era paciente.");
    }
    aoMarcar?.(resultado.marcados);
  };

  return (
    <>
      {botao}
      <DialogoMarcarComoPaciente
        aberto={aberto}
        leads={1}
        nome={nome}
        salvando={salvando}
        erro={erro}
        onConfirmar={() => void confirmar()}
        onFechar={() => setAberto(false)}
      />
    </>
  );
}
