"use client";

import type { ContextoAgenda } from "@/components/agenda/tipos";
import { APPOINTMENT_STATUS } from "@/lib/design/status";
import type { AgendaDia, ConsultaDaAgenda } from "@/lib/queries/agenda";

// Versao de impressao da agenda do dia. So aparece no papel (o wrapper e
// "hidden print:block"). Preto no branco: a situacao vai em TEXTO, porque a
// impressora da recepcao e P&B e cor sozinha nao informa nada.

function horaNoFuso(instante: string, timezone: string): string {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PrintDay({
  contexto,
  dia,
  dados,
}: {
  contexto: ContextoAgenda;
  dia: string;
  dados: AgendaDia;
}) {
  const [ano, mes, diaN] = dia.split("-");
  const dataFormatada = `${diaN}/${mes}/${ano}`;

  const porProfissional = new Map<string, ConsultaDaAgenda[]>();
  for (const consulta of [...dados.consultas].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  )) {
    const lista = porProfissional.get(consulta.professional_id) ?? [];
    lista.push(consulta);
    porProfissional.set(consulta.professional_id, lista);
  }

  const secoes = contexto.catalogo.profissionais
    .filter((p) => porProfissional.has(p.id))
    .map((p) => ({
      profissional: p,
      consultas: porProfissional.get(p.id) ?? [],
    }));

  return (
    <div className="hidden bg-white text-black print:block">
      <h1 className="mb-4 text-xl font-bold">Agenda de {dataFormatada}</h1>
      {secoes.length === 0 ? (
        <p>Nenhuma consulta neste dia.</p>
      ) : (
        secoes.map(({ profissional, consultas }) => (
          <section key={profissional.id} className="mb-6 break-inside-avoid">
            <h2 className="mb-2 text-base font-semibold">
              {profissional.name}
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {[
                    "Hora",
                    "Paciente",
                    "Telefone",
                    "Procedimento",
                    "Convênio",
                    "Situação",
                    "Obs",
                  ].map((coluna) => (
                    <th
                      key={coluna}
                      className="border border-black px-2 py-1 text-left font-semibold"
                    >
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {consultas.map((consulta) => (
                  <tr key={consulta.id}>
                    <td className="border border-black px-2 py-1">
                      {horaNoFuso(consulta.starts_at, contexto.timezone)}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {consulta.contact?.name ?? "Sem nome"}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {consulta.contact?.phone_e164 ?? ""}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {consulta.service_link?.procedure?.name ?? ""}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {consulta.service_link?.insurance?.name ?? "Particular"}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {APPOINTMENT_STATUS[consulta.status].label}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {consulta.notes ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
