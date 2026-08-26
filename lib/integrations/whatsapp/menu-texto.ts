import type { MenuOption } from "./provider";

// Botao interativo nao tem garantia em API nao oficial: o uazapi degrada
// sozinho para lista numerada. Este e o texto dessa lista, e ele vive num
// lugar so porque e usado em dois: o fallback do cliente uazapi e o corpo
// gravado em message.body. Se os dois divergissem, a conversa no Inbox nao
// explicaria a resposta "1" do paciente.
export function textoNumerado(body: string, options: MenuOption[]): string {
  const linhas = options.map((option, index) => `${index + 1}. ${option.text}`);
  return `${body}\n\n${linhas.join("\n")}\n\nResponda com o número da opção.`;
}
