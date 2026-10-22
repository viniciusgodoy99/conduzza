"use client";

import { ChevronDown, Plus, Tag } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import {
  chaveDaEtiqueta,
  etiquetaLimpa,
  grafiaDaEtiqueta,
  type LeituraDasEtiquetas,
  type OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";
import { cn } from "@/lib/utils";

// Escolher uma etiqueta para um FILTRO (onda 4): a condicao "o lead tem a
// etiqueta" de uma automacao de fluxo e o "Para quem" de uma regua de
// follow-up por etiqueta. Oferece as etiquetas do catalogo de conversa (com
// o tom delas) e as que ja estao nos leads, sem repetir pelo nome, como o
// "Etiquetar lead" (opcoesDeEtiqueta); e aceita uma nova, por texto, com a
// grafia da que a clinica ja tem ("lead" entra como "LEAD").
//
// O filtro vale para a etiqueta do lead E para a da conversa, pelo nome sem
// maiuscula e acento (decisao D1 do dono), entao o que se guarda e o NOME.

const LINHA_DA_OPCAO =
  "flex min-h-10 w-full items-center gap-[9px] rounded-sm px-[9px] text-left text-[13px] font-medium text-foreground outline-none cz-transition hover:bg-accent hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45";

/**
 * O conteudo do seletor, sem hook (o projeto nao tem jsdom: os testes
 * chamam a funcao e acham o onClick na arvore). Quem abre guarda o texto.
 */
export function PainelDeEtiquetas({
  digitada,
  aoDigitar,
  opcoes,
  leitura,
  jaEscolhidas,
  aoEscolher,
}: {
  digitada: string;
  aoDigitar: (texto: string) => void;
  /** As do catalogo e as em uso, sem repetir (opcoesDeEtiqueta) */
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  /** As que ja estao no filtro: nao se oferecem de novo */
  jaEscolhidas: readonly string[];
  /** Recebe a grafia que entra no filtro */
  aoEscolher: (nome: string) => void;
}) {
  const limpa = etiquetaLimpa(digitada);
  const grafia = grafiaDaEtiqueta(digitada, opcoes);
  const chaveDigitada = chaveDaEtiqueta(limpa);
  const escolhidas = new Set(jaEscolhidas.map(chaveDaEtiqueta));
  const oferecidas = opcoes.filter(
    (opcao) =>
      !escolhidas.has(chaveDaEtiqueta(opcao.nome)) &&
      (chaveDigitada === "" ||
        chaveDaEtiqueta(opcao.nome).includes(chaveDigitada)),
  );
  const repetida = chaveDigitada !== "" && escolhidas.has(chaveDigitada);
  const outraGrafia = limpa.length > 0 && grafia !== limpa;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <div className="flex gap-1.5">
          <Input
            value={digitada}
            onChange={(evento) => aoDigitar(evento.target.value)}
            placeholder="Buscar ou escrever uma etiqueta"
            maxLength={40}
            aria-label="Buscar ou escrever uma etiqueta"
          />
          <Button
            type="button"
            variant="solid"
            disabled={limpa.length === 0 || repetida}
            onClick={() => aoEscolher(grafia)}
          >
            Usar
          </Button>
        </div>
        <p
          aria-live="polite"
          className="text-[11px] leading-[1.4] text-text-secondary empty:hidden"
        >
          {repetida
            ? "Esta etiqueta já está no filtro."
            : outraGrafia
              ? `Esta etiqueta já existe como ${grafia} e entra com essa grafia.`
              : null}
        </p>
      </div>

      <div className="grid gap-1.5">
        <p className="text-xs font-semibold text-text-strong">
          Etiquetas da clínica
        </p>
        {leitura === "carregando" ? (
          <p role="status" className="text-xs text-text-secondary">
            Carregando as etiquetas.
          </p>
        ) : null}
        {leitura === "erro" ? (
          <p className="text-xs leading-[1.4] text-text-secondary">
            Não foi possível carregar as etiquetas da clínica. Escreva a
            etiqueta acima, com o mesmo nome que ela tem no lead ou na conversa.
          </p>
        ) : null}
        {oferecidas.length > 0 ? (
          <div className="-mx-[5px] grid cz-scroll max-h-48 overflow-y-auto">
            {oferecidas.map((opcao) => (
              <button
                key={opcao.nome}
                type="button"
                onClick={() => aoEscolher(opcao.nome)}
                aria-label={`Escolher a etiqueta ${opcao.nome}`}
                className={LINHA_DA_OPCAO}
              >
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: STATUS_TONE_VARS[opcao.tom].marker,
                  }}
                />
                <span className="min-w-0 truncate">{opcao.nome}</span>
                {opcao.cadastrada ? null : (
                  <span className="ml-auto shrink-0 text-[11px] text-text-secondary">
                    só nos leads
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : leitura === "pronto" ? (
          <p className="text-xs leading-[1.4] text-text-secondary">
            {opcoes.length === 0
              ? "A clínica ainda não tem etiquetas. Escreva uma acima."
              : chaveDigitada
                ? "Nenhuma etiqueta com este nome. Use a que você escreveu."
                : "Todas as etiquetas da clínica já estão no filtro."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * O botao que abre o painel. "trocar": mostra a etiqueta escolhida (a
 * condicao tem uma so); "adicionar": e o "Adicionar etiqueta" de uma lista.
 */
export function SeletorDeEtiqueta({
  modo,
  valor = "",
  rotulo,
  id,
  opcoes,
  leitura,
  jaEscolhidas = [],
  desabilitado = false,
  "aria-invalid": invalido,
  "aria-describedby": descritoPor,
  aoEscolher,
}: {
  modo: "trocar" | "adicionar";
  /** A etiqueta escolhida (modo trocar); vazio: nenhuma */
  valor?: string;
  /** O nome acessivel do botao */
  rotulo: string;
  /** Vem do FormControl (o rotulo do campo aponta para o botao) */
  id?: string;
  opcoes: readonly OpcaoDeEtiqueta[];
  leitura: LeituraDasEtiquetas;
  jaEscolhidas?: readonly string[];
  desabilitado?: boolean;
  /** Vem do FormControl: o campo com erro */
  "aria-invalid"?: boolean | "true" | "false";
  /** Vem do FormControl: a ajuda e a mensagem de erro do campo */
  "aria-describedby"?: string;
  aoEscolher: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [digitada, setDigitada] = useState("");
  const tom =
    opcoes.find(
      (opcao) => chaveDaEtiqueta(opcao.nome) === chaveDaEtiqueta(valor),
    )?.tom ?? "neutral";

  const gatilho =
    modo === "trocar" ? (
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={desabilitado}
        aria-label={valor ? `${rotulo}: ${valor}` : rotulo}
        aria-invalid={invalido === true || invalido === "true" || undefined}
        aria-describedby={descritoPor}
        className="w-full justify-start font-medium"
      >
        {valor ? (
          <>
            <span
              aria-hidden
              className="size-[7px] shrink-0 rounded-[2px]"
              style={{ backgroundColor: STATUS_TONE_VARS[tom].marker }}
            />
            <span className="min-w-0 truncate">{valor}</span>
          </>
        ) : (
          <>
            <Tag aria-hidden className="text-text-secondary" />
            <span className="text-text-secondary">Escolha a etiqueta</span>
          </>
        )}
        <ChevronDown aria-hidden className="ml-auto text-text-secondary" />
      </Button>
    ) : (
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={desabilitado}
        aria-describedby={descritoPor}
      >
        <Plus aria-hidden />
        {rotulo}
      </Button>
    );

  return (
    <Popover
      open={aberto}
      onOpenChange={(abrir) => {
        setAberto(abrir);
        if (!abrir) {
          setDigitada("");
        }
      }}
    >
      <PopoverTrigger asChild>{gatilho}</PopoverTrigger>
      <PopoverContent align="start" className={cn("w-80 p-2.5")}>
        <PainelDeEtiquetas
          digitada={digitada}
          aoDigitar={setDigitada}
          opcoes={opcoes}
          leitura={leitura}
          jaEscolhidas={
            modo === "trocar"
              ? jaEscolhidas.filter((nome) => nome !== valor)
              : jaEscolhidas
          }
          aoEscolher={(nome) => {
            setAberto(false);
            setDigitada("");
            aoEscolher(nome);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
