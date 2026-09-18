// Duracao curta na linguagem do brief (secao 3.7: "40 min · 1h20"). Modulo
// PURO de proposito: o Painel (Server Component) e as abas client usam a
// mesma funcao, e funcao importada de modulo "use client" nao pode ser
// chamada em render de servidor (achado grave da revisao de 18/09/2026:
// o /inicio quebrava com 500 para todo papel que via o painel).
export function formatarDuracao(segundos: number | null): string {
  if (segundos === null) {
    return "sem dados";
  }
  if (segundos < 60) {
    return "menos de 1 min";
  }
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) {
    return `${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) {
    return resto > 0
      ? `${horas}h${String(resto).padStart(2, "0")}`
      : `${horas}h`;
  }
  const dias = Math.floor(horas / 24);
  return `${dias} dia${dias === 1 ? "" : "s"}`;
}
