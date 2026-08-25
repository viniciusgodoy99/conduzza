"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CampoImportavel } from "@/lib/domain/importacao";

// Passo 2 da importacao: dizer de qual coluna da planilha vem cada campo da
// ficha. So o telefone e obrigatorio; o resto pode ficar em "Não importar".

export type MapeamentoDeColunas = Record<CampoImportavel, number | null>;

export const MAPEAMENTO_VAZIO: MapeamentoDeColunas = {
  name: null,
  phone_e164: null,
  email: null,
  insurance_name: null,
  source_campaign: null,
};

const NAO_IMPORTAR = "nao_importar";

const CAMPOS: {
  campo: CampoImportavel;
  rotulo: string;
  obrigatorio: boolean;
}[] = [
  { campo: "name", rotulo: "Nome", obrigatorio: false },
  { campo: "phone_e164", rotulo: "Telefone", obrigatorio: true },
  { campo: "email", rotulo: "E-mail", obrigatorio: false },
  { campo: "insurance_name", rotulo: "Convênio", obrigatorio: false },
  { campo: "source_campaign", rotulo: "Campanha", obrigatorio: false },
];

function normalizarCabecalho(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Ordem de palpite importa: telefone e campanha primeiro, nome por ultimo,
// senao um cabecalho "Nome da campanha" seria tomado como nome da pessoa.
const PALPITES: { campo: CampoImportavel; padrao: RegExp }[] = [
  { campo: "phone_e164", padrao: /telefone|fone|celular|whats|phone|numero/ },
  { campo: "email", padrao: /mail/ },
  { campo: "insurance_name", padrao: /convenio|plano|insurance/ },
  { campo: "source_campaign", padrao: /campanha|campaign|origem|fonte|utm/ },
  { campo: "name", padrao: /nome|name|paciente|contato|cliente/ },
];

/** Pre-mapeia pelas palavras do cabecalho; cada coluna atende um campo so. */
export function preMapearColunas(cabecalho: string[]): MapeamentoDeColunas {
  const mapeamento: MapeamentoDeColunas = { ...MAPEAMENTO_VAZIO };
  const ocupadas = new Set<number>();
  for (const { campo, padrao } of PALPITES) {
    const indice = cabecalho.findIndex(
      (titulo, i) => !ocupadas.has(i) && padrao.test(normalizarCabecalho(titulo)),
    );
    if (indice >= 0) {
      mapeamento[campo] = indice;
      ocupadas.add(indice);
    }
  }
  return mapeamento;
}

export function PassoMapeamento({
  cabecalho,
  amostra,
  mapeamento,
  aoMudar,
}: {
  cabecalho: string[];
  /** Primeira linha de dados, mostrada como exemplo da coluna escolhida. */
  amostra: string[];
  mapeamento: MapeamentoDeColunas;
  aoMudar: (campo: CampoImportavel, indice: number | null) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-secondary">
        Diga de qual coluna da planilha vem cada informação. Só o telefone é
        obrigatório.
      </p>
      {CAMPOS.map(({ campo, rotulo, obrigatorio }) => {
        const indice = mapeamento[campo];
        const exemplo = indice === null ? "" : (amostra[indice] ?? "").trim();
        return (
          <div key={campo} className="grid gap-1.5">
            <Label htmlFor={`coluna-${campo}`}>
              {rotulo}
              {obrigatorio ? " (obrigatório)" : ""}
            </Label>
            <Select
              value={indice === null ? NAO_IMPORTAR : String(indice)}
              onValueChange={(valor) =>
                aoMudar(campo, valor === NAO_IMPORTAR ? null : Number(valor))
              }
            >
              <SelectTrigger
                id={`coluna-${campo}`}
                className="h-10 w-full"
                aria-required={obrigatorio}
              >
                <SelectValue placeholder="Escolha a coluna" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NAO_IMPORTAR}>Não importar</SelectItem>
                {cabecalho.map((titulo, i) => (
                  <SelectItem key={`${i}-${titulo}`} value={String(i)}>
                    {titulo.trim() === "" ? `Coluna ${i + 1}` : titulo.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {exemplo !== "" ? (
              <p className="text-xs text-text-secondary">
                Exemplo da planilha: {exemplo}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
