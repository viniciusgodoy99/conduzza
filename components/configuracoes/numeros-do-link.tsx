"use client";

import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { salvarNumerosDoLinkAction } from "@/app/(app)/configuracoes/regras-de-origem-actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PESO_MAXIMO,
  PESO_MINIMO,
  textoDosNumerosDoLink,
  type NumeroDoLink,
} from "@/lib/domain/link-rastreado";
import type { NumeroParaOLink } from "@/lib/domain/regras-de-origem";

// Os numeros do link rastreado de uma origem (etapa 3b do plano de
// 16/11/2026: rodizio entre numeros, como no Q5). Mostra para qual numero o
// link manda e deixa escolher varios, cada um com um peso. Sem nenhum
// escolhido, vale o numero principal da clinica. Quem nao gerencia ve o
// botao visivel e desabilitado, com o porque.

export const TEXTOS_DOS_NUMEROS_DO_LINK = {
  paraOnde: "O link manda para:",
  naoCarregou: "Não foi possível carregar os números deste link.",
  escolher: "Escolher números",
  titulo: "Números do link",
  explicacao:
    "Sem nenhum marcado, o link usa o número principal da clínica. Com mais de um, o link distribui as pessoas pelo peso: peso 2 recebe o dobro de peso 1. Quem já tocou no link volta sempre para o mesmo número, e número desconectado fica de fora até voltar.",
  semNumeros:
    "Conecte um número de WhatsApp na aba WhatsApp para escolher os números do link.",
  salvar: "Salvar números",
  salvos: "Números do link salvos.",
  semServidor: "Não foi possível falar com o servidor. Tente de novo.",
} as const;

const PESOS = Array.from(
  { length: PESO_MAXIMO - PESO_MINIMO + 1 },
  (_, indice) => PESO_MINIMO + indice,
);

export function NumerosDoLink({
  regraId,
  nomeDaOrigem,
  numeros,
  escolhidos,
  podeGerenciar,
  dica,
}: {
  regraId: string;
  nomeDaOrigem: string;
  /** os numeros ativos da clinica; nulo: a leitura falhou */
  numeros: readonly NumeroParaOLink[] | null;
  /** os escolhidos para este link; nulo: a leitura falhou */
  escolhidos: readonly NumeroDoLink[] | null;
  podeGerenciar: boolean;
  dica: string;
}) {
  const id = useId();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pesos, setPesos] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  if (numeros === null || escolhidos === null) {
    return (
      <p className="text-[12px] text-alert-text">
        {TEXTOS_DOS_NUMEROS_DO_LINK.naoCarregou}
      </p>
    );
  }

  const abrir = () => {
    // So os escolhidos que ainda existem entre os numeros ativos da clinica.
    setPesos(
      Object.fromEntries(
        escolhidos
          .filter((escolhido) => numeros.some((n) => n.id === escolhido.id))
          .map((escolhido) => [escolhido.id, escolhido.peso]),
      ),
    );
    setErro(null);
    setAberto(true);
  };

  const salvar = () => {
    setErro(null);
    iniciar(async () => {
      let resultado;
      try {
        resultado = await salvarNumerosDoLinkAction({
          id: regraId,
          numeros: Object.entries(pesos).map(([numero, peso]) => ({
            id: numero,
            peso,
          })),
        });
      } catch {
        setErro(TEXTOS_DOS_NUMEROS_DO_LINK.semServidor);
        return;
      }
      if (!resultado.ok) {
        setErro(resultado.error);
        return;
      }
      toast.success(TEXTOS_DOS_NUMEROS_DO_LINK.salvos);
      setAberto(false);
      router.refresh();
    });
  };

  const botao = (
    <Button
      type="button"
      variant="outline"
      disabled={!podeGerenciar}
      onClick={abrir}
      aria-label={`${TEXTOS_DOS_NUMEROS_DO_LINK.escolher} de ${nomeDaOrigem}`}
    >
      <Phone aria-hidden />
      {TEXTOS_DOS_NUMEROS_DO_LINK.escolher}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-[12px] text-text-secondary">
        {TEXTOS_DOS_NUMEROS_DO_LINK.paraOnde}{" "}
        <span className="text-foreground">
          {textoDosNumerosDoLink(escolhidos, numeros)}
        </span>
      </p>
      {podeGerenciar ? botao : <DisabledWithHint hint={dica}>{botao}</DisabledWithHint>}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {TEXTOS_DOS_NUMEROS_DO_LINK.titulo} de {nomeDaOrigem}
            </DialogTitle>
            <DialogDescription>
              {TEXTOS_DOS_NUMEROS_DO_LINK.explicacao}
            </DialogDescription>
          </DialogHeader>
          {numeros.length === 0 ? (
            <p className="text-[13px] text-text-secondary">
              {TEXTOS_DOS_NUMEROS_DO_LINK.semNumeros}
            </p>
          ) : (
            <ul className="grid gap-2">
              {numeros.map((numero) => {
                const marcado = pesos[numero.id] !== undefined;
                const idDoCampo = `${id}-${numero.id}`;
                return (
                  <li
                    key={numero.id}
                    className="flex min-h-10 flex-wrap items-center gap-3"
                  >
                    <Checkbox
                      id={idDoCampo}
                      checked={marcado}
                      onCheckedChange={(valor) =>
                        setPesos((antes) => {
                          const depois = { ...antes };
                          if (valor === true) {
                            depois[numero.id] = PESO_MINIMO;
                          } else {
                            delete depois[numero.id];
                          }
                          return depois;
                        })
                      }
                    />
                    <Label htmlFor={idDoCampo} className="min-w-0 flex-1">
                      {numero.nome},{" "}
                      <span className="cz-num">{numero.telefone}</span>
                    </Label>
                    <Select
                      value={String(pesos[numero.id] ?? PESO_MINIMO)}
                      onValueChange={(valor) =>
                        setPesos((antes) => ({
                          ...antes,
                          [numero.id]: Number(valor),
                        }))
                      }
                      disabled={!marcado}
                    >
                      <SelectTrigger
                        className="h-10 w-28"
                        aria-label={`Peso de ${numero.nome}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PESOS.map((peso) => (
                          <SelectItem key={peso} value={String(peso)}>
                            Peso {peso}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          )}
          {erro ? (
            <p role="alert" className="text-[12.5px] text-alert-text">
              {erro}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={salvar} disabled={pendente}>
              {TEXTOS_DOS_NUMEROS_DO_LINK.salvar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
