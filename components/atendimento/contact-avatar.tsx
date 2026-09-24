// Avatar de contato com cor deterministica derivada do nome, com a pele do
// Avatar do design system Conduzza (docs/06 secao 4.6, D10): disco claro com
// um toque da paleta da marca, iniciais em tinta e um fio fino, igual nos
// dois temas. Tamanhos de uso: 24 (tabela, kanban), 30 (rodape e menu da
// sidebar), 36 (lista e cabecalho do Atendimento), 44 (drawer do lead) e 56
// (painel de contexto e ficha). Sem ponto de presenca.
//
// Excecao documentada a regra de so usar aliases (D25): a paleta e a das
// constantes de marca do DS, decorativa. Cor de status NUNCA entra aqui,
// porque um avatar "vermelho" leria como alerta.

const TONES = [
  "var(--cz-lime-400)",
  "var(--cz-lime-600)",
  "var(--cz-info-500)",
  "var(--cz-warning-500)",
  "var(--cz-success-500)",
  "var(--cz-ink-400)",
];

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Iniciais da primeira e da ultima palavra do nome ("Maria Clara Souza" vira
// MS). Sem nome, os 2 ultimos digitos do telefone.
export function initialsOf(name: string | null, phone: string): string {
  if (!name || name.trim().length === 0) {
    return phone.slice(-2);
  }
  const parts = name.trim().split(/\s+/);
  const primeira = parts[0]?.[0] ?? "";
  const ultima = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

export function ContactAvatar({
  name,
  phone,
  size = 36,
}: {
  name: string | null;
  phone: string;
  size?: number;
}) {
  const tone = TONES[hashOf(name ?? phone) % TONES.length];
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.02em]"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        color: "var(--cz-ink-900)",
        backgroundColor: `color-mix(in oklab, ${tone} 26%, var(--cz-paper-050))`,
        boxShadow: "inset 0 0 0 1px var(--border)",
      }}
    >
      {initialsOf(name, phone)}
    </span>
  );
}
