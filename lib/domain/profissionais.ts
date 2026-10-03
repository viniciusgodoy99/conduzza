// Regras puras do cadastro de profissionais.

/**
 * A lista que vai para o banco: as especialidades ja adicionadas e o que
 * ficou DIGITADO no campo sem Enter. Antes, quem digitava "Dermatologia" e
 * clicava em Salvar perdia o texto: o profissional ficava "Sem
 * especialidade" (relato do dono em 02/10/2026).
 */
export function especialidadesParaSalvar(
  adicionadas: readonly string[],
  digitada: string,
): string[] {
  const pendente = digitada.trim();
  if (!pendente || adicionadas.includes(pendente)) {
    return [...adicionadas];
  }
  return [...adicionadas, pendente];
}
