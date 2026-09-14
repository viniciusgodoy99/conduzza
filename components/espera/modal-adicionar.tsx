"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { adicionarNaEsperaAction } from "@/app/(app)/espera/actions";
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
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Adicionar manualmente a fila (brief da Tela 10): busca de contato com
// debounce (mesmo desenho da BuscaPaciente da agenda), pedido (procedimento
// e profissional opcionais) e preferencias de turno e dias.

const TURNOS = [
  { valor: "manha", rotulo: "Manhã" },
  { valor: "tarde", rotulo: "Tarde" },
  { valor: "noite", rotulo: "Noite" },
];
const DIAS = [
  { valor: 0, curto: "Dom" },
  { valor: 1, curto: "Seg" },
  { valor: 2, curto: "Ter" },
  { valor: 3, curto: "Qua" },
  { valor: 4, curto: "Qui" },
  { valor: 5, curto: "Sex" },
  { valor: 6, curto: "Sáb" },
];

const QUALQUER = "__qualquer__";

export type OpcaoDeCatalogo = { id: string; name: string };

export function ModalAdicionar({
  clinicId,
  aberto,
  onFechar,
  procedimentos,
  profissionais,
  contatoInicial,
  aoMudar,
}: {
  clinicId: string;
  aberto: boolean;
  onFechar: () => void;
  procedimentos: OpcaoDeCatalogo[];
  profissionais: OpcaoDeCatalogo[];
  /** Vindo de /espera?adicionar=<contactId> (ficha do paciente, Inbox). */
  contatoInicial: { id: string; nome: string } | null;
  aoMudar: () => Promise<unknown> | void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<
    { id: string; name: string | null; phone_e164: string }[]
  >([]);
  const [contato, setContato] = useState<{ id: string; nome: string } | null>(
    null,
  );
  const [procedimento, setProcedimento] = useState(QUALQUER);
  const [profissional, setProfissional] = useState(QUALQUER);
  const [turnos, setTurnos] = useState<string[]>([]);
  const [dias, setDias] = useState<number[]>([]);
  const [pendente, iniciarTransicao] = useTransition();

  useEffect(() => {
    if (aberto) {
      setContato(contatoInicial);
      setTermo("");
      setResultados([]);
    }
  }, [aberto, contatoInicial]);

  // Debounce de 300ms na busca por nome ou telefone (padrao da agenda).
  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2 || contato) {
      setResultados([]);
      return;
    }
    const timer = setTimeout(() => {
      const seguro = limpo.replace(/[%,()]/g, "");
      void supabase
        .from("contact")
        .select("id, name, phone_e164")
        .eq("clinic_id", clinicId)
        .or(`name.ilike.%${seguro}%,phone_e164.ilike.%${seguro}%`)
        .limit(8)
        .then(({ data }) => {
          setResultados(
            (data ?? []) as {
              id: string;
              name: string | null;
              phone_e164: string;
            }[],
          );
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [termo, contato, supabase, clinicId]);

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
        preferred_weekdays: [...dias].sort(),
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar à lista de espera</DialogTitle>
          <DialogDescription>
            Quando um horário compatível vagar, a oferta sai sozinha para a
            fila, na ordem de prioridade.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="espera-contato">Paciente</Label>
            {contato ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm font-medium">{contato.nome}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setContato(null)}
                >
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="espera-contato"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Nome ou telefone"
                  className="h-10"
                />
                {resultados.length > 0 ? (
                  <ul className="grid max-h-44 gap-0.5 overflow-y-auto rounded-md border p-1">
                    {resultados.map((linha) => (
                      <li key={linha.id}>
                        <button
                          type="button"
                          className="flex h-10 w-full items-center justify-between rounded px-2 text-left text-sm hover:bg-surface-3"
                          onClick={() =>
                            setContato({
                              id: linha.id,
                              nome: linha.name ?? linha.phone_e164,
                            })
                          }
                        >
                          <span>{linha.name ?? "Sem nome"}</span>
                          <span className="text-xs text-text-secondary">
                            {linha.phone_e164}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="espera-procedimento">Procedimento</Label>
              <Select value={procedimento} onValueChange={setProcedimento}>
                <SelectTrigger id="espera-procedimento" className="min-h-10">
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
                <SelectTrigger id="espera-profissional" className="min-h-10">
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
            <legend className="pb-1.5 text-sm font-medium">
              Preferência de turno
            </legend>
            <div className="flex gap-1.5">
              {TURNOS.map((turno) => {
                const marcado = turnos.includes(turno.valor);
                return (
                  <button
                    key={turno.valor}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => setTurnos((atual) => alternar(atual, turno.valor))}
                    className={cn(
                      "h-10 rounded-md border px-3 text-[13px] font-medium transition-colors",
                      marcado
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "text-text-secondary hover:text-foreground",
                    )}
                  >
                    {turno.rotulo}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-text-tertiary">
              Nada marcado significa qualquer horário.
            </p>
          </fieldset>

          <fieldset className="grid gap-1.5">
            <legend className="pb-1.5 text-sm font-medium">
              Preferência de dias
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {DIAS.map((dia) => {
                const marcado = dias.includes(dia.valor);
                return (
                  <button
                    key={dia.valor}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => setDias((atual) => alternar(atual, dia.valor))}
                    className={cn(
                      "h-10 min-w-11 rounded-md border px-2 text-[13px] font-medium transition-colors",
                      marcado
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "text-text-secondary hover:text-foreground",
                    )}
                  >
                    {dia.curto}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={pendente}
            onClick={onFechar}
          >
            Cancelar
          </Button>
          <Button
            className="h-10"
            disabled={pendente || !contato}
            onClick={adicionar}
          >
            {pendente ? "Adicionando..." : "Adicionar à lista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
