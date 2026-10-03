"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  chaveDeTelefone,
  formatarTelefone,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import type { ContatoDaAtividade } from "@/lib/queries/atividades";
import { createClient } from "@/lib/supabase/client";

// Busca de paciente ou lead para a "Nova atividade" da tela Atividades. E a
// mesma regra de busca do combobox da Agenda (telefone completo pela chave,
// pedaco de numero pelos digitos, o resto pelo nome), sem a criacao rapida
// de cadastro: atividade e sempre de quem ja existe. O combobox da Agenda
// nao foi extraido porque a criacao rapida e a autorizacao vivem dentro dele.
// A RLS de contact recorta a clinica; a tela que abre este dialogo ja gravou
// a trilha de leitura.

type Resultado = { id: string; name: string | null; phone_e164: string };

export function BuscaDeContato({
  clinicId,
  contato,
  aoEscolher,
  erro,
}: {
  clinicId: string;
  contato: ContatoDaAtividade | null;
  aoEscolher: (contato: ContatoDaAtividade | null) => void;
  erro?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) {
      setResultados([]);
      setBuscando(false);
      setFalhou(false);
      return;
    }
    setBuscando(true);
    let cancelado = false;
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
        // `digitos` so tem digitos: seguro dentro do or.
        consulta = consulta.or(
          `phone_key.ilike.%${digitos}%,phone_e164.ilike.%${digitos}%`,
        );
      } else {
        consulta = consulta.ilike("name", `%${limpo.replace(/[%_,()]/g, "")}%`);
      }
      void consulta.limit(8).then(({ data, error }) => {
        if (cancelado) {
          return;
        }
        setFalhou(error !== null);
        setResultados(error ? [] : ((data ?? []) as Resultado[]));
        setBuscando(false);
      });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [termo, supabase, clinicId]);

  if (contato) {
    return (
      <div className="grid gap-1.5">
        <Label>Paciente ou lead</Label>
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border-strong bg-card pl-3 shadow-xs">
          <span className="min-w-0 truncate text-sm font-semibold text-text-strong">
            {contato.nome ?? "Sem nome"}
            <span className="ml-2 cz-num text-xs font-normal text-text-secondary">
              {formatarTelefone(contato.telefone)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTermo("");
              aoEscolher(null);
            }}
          >
            Trocar
          </Button>
        </div>
      </div>
    );
  }

  const idDoErro = erro ? "busca-contato-atividade-erro" : undefined;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="busca-contato-atividade">Paciente ou lead</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <Input
          id="busca-contato-atividade"
          autoComplete="off"
          className="h-10 pl-9"
          placeholder="Nome ou telefone"
          value={termo}
          aria-invalid={erro ? true : undefined}
          aria-describedby={idDoErro}
          onChange={(evento) => setTermo(evento.target.value)}
        />
      </div>
      {termo.trim().length >= 2 ? (
        <div className="overflow-hidden rounded-xl border border-border-strong bg-card shadow-xs">
          {buscando ? (
            <div className="grid gap-1.5 p-2" aria-hidden>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <ul className="cz-scroll max-h-56 overflow-y-auto">
              {resultados.map((resultado) => (
                <li key={resultado.id}>
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm outline-none cz-transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                    onClick={() =>
                      aoEscolher({
                        id: resultado.id,
                        nome: resultado.name,
                        telefone: resultado.phone_e164,
                      })
                    }
                  >
                    <span className="min-w-0 truncate font-semibold text-text-strong">
                      {resultado.name ?? "Sem nome"}
                    </span>
                    <span className="shrink-0 cz-num text-xs text-text-secondary">
                      {formatarTelefone(resultado.phone_e164)}
                    </span>
                  </button>
                </li>
              ))}
              {resultados.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-text-secondary">
                  {falhou
                    ? "Não foi possível buscar agora. Tente de novo."
                    : "Ninguém com esse nome ou telefone."}
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
      {erro ? (
        <p id={idDoErro} className="text-[13px] font-medium text-alert-text">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
