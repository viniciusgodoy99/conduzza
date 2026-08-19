// Avatar de contato com cor deterministica derivada do nome (handoff: avatar
// 38px na lista, 32px no cabecalho da conversa).

const TONES = [
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--ai)",
  "var(--alert)",
  "var(--neutral)",
];

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function initialsOf(name: string | null, phone: string): string {
  if (!name || name.trim().length === 0) {
    return phone.slice(-2);
  }
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function ContactAvatar({
  name,
  phone,
  size = 38,
}: {
  name: string | null;
  phone: string;
  size?: number;
}) {
  const tone = TONES[hashOf(name ?? phone) % TONES.length];
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{
        width: size,
        height: size,
        color: tone,
        backgroundColor: `color-mix(in srgb, ${tone} 18%, var(--card))`,
      }}
    >
      {initialsOf(name, phone)}
    </span>
  );
}
