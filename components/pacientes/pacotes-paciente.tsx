"use client";

import { CalendarX2, CircleCheck, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { venderPacoteAction } from "@/app/(app)/leads/actions";
import { BotaoProtegido } from "@/components/cadastros/comum";
import {
  BarraSessoes,
  BlocoFicha,
  diaEmTexto,
  plural,
} from "@/components/pacientes/comum";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SaldoDePacote } from "@/lib/queries/pacientes";

// Saldo de pacote do paciente. A validade e comparada em DIA CIVIL da clinica
// (regra 3.6), do mesmo jeito que a RPC pacientes_resumo compara: pacote
// vendido com 90 dias vence no dia local certo, nao no dia UTC do servidor.
// Vencido aparece com icone, rotulo e cor, nunca so cor.

export type PacoteVendavel = { id: string; rotulo: string };

function Vencimento({ dia, hoje }: { dia: string; hoje: string }) {
  const vencido = dia < hoje;
  return (
    <span
      className="flex items-center gap-1.5 text-xs"
      style={{
        color: vencido ? "var(--alert-text)" : "var(--text-secondary)",
      }}
    >
      {vencido ? (
        <CalendarX2
          strokeWidth={1.5}
          className="size-3.5 shrink-0"
          aria-hidden
        />
      ) : (
        <CircleCheck
          strokeWidth={1.5}
          className="size-3.5 shrink-0"
          aria-hidden
        />
      )}
      {vencido ? `Venceu em ${diaEmTexto(dia)}` : `Vale até ${diaEmTexto(dia)}`}
    </span>
  );
}

export function PacotesPaciente({
  contactId,
  pacotes,
  pacotesDoCatalogo,
  hojeNaClinica,
  podeEditar,
  dica,
}: {
  contactId: string;
  pacotes: SaldoDePacote[];
  pacotesDoCatalogo: PacoteVendavel[];
  hojeNaClinica: string;
  podeEditar: boolean;
  dica: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const vender = async () => {
    if (!escolhido) {
      setErro("Escolha o pacote vendido.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await venderPacoteAction({
      contact_id: contactId,
      package_id: escolhido,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível registrar o pacote.");
      return;
    }
    toast.success("Pacote registrado");
    setAberto(false);
    setEscolhido("");
    router.refresh();
  };

  return (
    <BlocoFicha
      titulo="Saldo de pacote"
      acao={
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          variant="outline"
          size="sm"
          onClick={() => {
            setErro(null);
            setAberto(true);
          }}
        >
          <Plus strokeWidth={1.5} className="size-4" /> Vender pacote
        </BotaoProtegido>
      }
    >
      {pacotes.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          Nenhum pacote vendido para este paciente.
        </p>
      ) : (
        <ul className="grid gap-3">
          {pacotes.map((pacote) => {
            const restantes = Math.max(
              pacote.sessions_total - pacote.sessions_used,
              0,
            );
            return (
              <li key={pacote.id} className="grid gap-1.5">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {pacote.procedure_name ?? "Pacote"}
                  </span>
                  <span className="font-mono text-[13px] tabular-nums">
                    {restantes} {plural(restantes, "sessão", "sessões")}{" "}
                    {plural(restantes, "restante", "restantes")}
                  </span>
                </span>
                <BarraSessoes
                  usadas={pacote.sessions_used}
                  total={pacote.sessions_total}
                />
                <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                  <span>
                    {pacote.sessions_used} de {pacote.sessions_total}{" "}
                    {plural(
                      pacote.sessions_total,
                      "sessão usada",
                      "sessões usadas",
                    )}
                  </span>
                  {pacote.expires_at ? (
                    <Vencimento dia={pacote.expires_at} hoje={hojeNaClinica} />
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vender pacote</DialogTitle>
            <DialogDescription>
              O saldo entra na hora e a validade conta a partir de hoje, no fuso
              da clínica.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {pacotesDoCatalogo.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Nenhum pacote cadastrado. Crie os pacotes em Cadastros para
                poder vender.
              </p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="pacote-escolhido">Pacote</Label>
                <Select value={escolhido} onValueChange={setEscolhido}>
                  <SelectTrigger id="pacote-escolhido" className="h-10 w-full">
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
            )}
            {erro ? (
              <p role="alert" className="text-sm [color:var(--alert-text)]">
                {erro}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="h-10"
                onClick={() => setAberto(false)}
              >
                Cancelar
              </Button>
              <Button
                className="h-10"
                onClick={() => void vender()}
                disabled={salvando || pacotesDoCatalogo.length === 0}
              >
                {salvando ? "Registrando..." : "Registrar venda"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </BlocoFicha>
  );
}
