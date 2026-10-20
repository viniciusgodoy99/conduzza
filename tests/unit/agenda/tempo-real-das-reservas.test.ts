import { describe, expect, it } from "vitest";

import type { HoldDaAgenda } from "@/lib/queries/agenda";
import { reservasDepoisDoEvento } from "@/lib/realtime/use-agenda-channel";

// Revisao da E4 (20/10/2026): o canal da Agenda so assinava INSERT em
// slot_hold. O consumo da reserva pelo agendar_pela_ia (UPDATE) e a troca de
// reserva da conversa (o reservar_horario_da_ia apaga a anterior; DELETE nao
// e assinado, de proposito) nunca chegavam a uma Agenda aberta: a reserva
// velha ficava desenhada (e escondia o horario no Novo agendamento) ate o
// vencimento original. reservasDepoisDoEvento e o que o canal aplica a cada
// dia em cache.

const AGORA = Date.parse("2026-10-20T12:00:00.000Z");
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const OUTRA = "c0000000-0000-4000-8000-000000000002";

function reserva(extra: Partial<HoldDaAgenda>): HoldDaAgenda {
  return {
    id: "h1",
    professional_id: "p1",
    starts_at: "2026-10-21T17:00:00.000Z",
    ends_at: "2026-10-21T17:30:00.000Z",
    expires_at: "2026-10-20T12:10:00.000Z",
    created_by: "ia",
    conversation_id: CONVERSA,
    consumido_em: null,
    ...extra,
  };
}

describe("reservas no cache depois do evento", () => {
  it("a reserva consumida (UPDATE do agendar) sai na hora, mesmo antes do vencimento original", () => {
    const viva = reserva({});
    const consumida = reserva({
      consumido_em: "2026-10-20T12:01:00.000Z",
      expires_at: "2026-10-20T12:01:00.000Z",
    });
    expect(
      reservasDepoisDoEvento([viva], consumida, {
        agoraMs: AGORA,
        doDia: true,
      }),
    ).toEqual([]);
    // Mesmo com o relogio do navegador atrasado (vencimento ainda no futuro
    // para ele), consumida nao volta.
    expect(
      reservasDepoisDoEvento(
        [viva],
        reserva({ consumido_em: "2026-10-20T12:01:00.000Z" }),
        { agoraMs: AGORA, doDia: true },
      ),
    ).toEqual([]);
  });

  it("a reserva nova da conversa tira a anterior da MESMA conversa (troca), de qualquer dia", () => {
    const anterior = reserva({ id: "h-anterior" });
    const deOutraConversa = reserva({ id: "h-outra", conversation_id: OUTRA });
    const daRecepcao = reserva({
      id: "h-recepcao",
      conversation_id: null,
      created_by: "usuario",
    });
    const nova = reserva({
      id: "h-nova",
      starts_at: "2026-10-22T13:00:00.000Z",
      ends_at: "2026-10-22T13:30:00.000Z",
    });
    // O dia da anterior (a nova e de outro dia): a anterior sai, o resto fica.
    expect(
      reservasDepoisDoEvento([anterior, deOutraConversa, daRecepcao], nova, {
        agoraMs: AGORA,
        doDia: false,
      }),
    ).toEqual([deOutraConversa, daRecepcao]);
    // O dia da nova: ela entra.
    expect(
      reservasDepoisDoEvento([], nova, { agoraMs: AGORA, doDia: true }),
    ).toEqual([nova]);
  });

  it("como antes: a reserva viva entra no dia dela, sem repetir, e a vencida sai", () => {
    const vencida = reserva({
      id: "h-vencida",
      conversation_id: OUTRA,
      expires_at: "2026-10-20T11:59:00.000Z",
    });
    const nova = reserva({});
    expect(
      reservasDepoisDoEvento([vencida, nova], nova, {
        agoraMs: AGORA,
        doDia: true,
      }),
    ).toEqual([nova]);
    // A reserva da recepcao (sem conversa) nao tira nenhuma outra.
    const daRecepcao = reserva({
      id: "h-recepcao",
      conversation_id: null,
      created_by: "usuario",
    });
    const outraDaRecepcao = reserva({
      id: "h-recepcao-2",
      conversation_id: null,
      created_by: "usuario",
    });
    expect(
      reservasDepoisDoEvento([outraDaRecepcao], daRecepcao, {
        agoraMs: AGORA,
        doDia: true,
      }),
    ).toEqual([outraDaRecepcao, daRecepcao]);
  });

  it("a consumida não tira a reserva de outra conversa nem as outras da recepção", () => {
    const deOutraConversa = reserva({ id: "h-outra", conversation_id: OUTRA });
    const consumida = reserva({ consumido_em: "2026-10-20T12:01:00.000Z" });
    expect(
      reservasDepoisDoEvento([deOutraConversa, reserva({})], consumida, {
        agoraMs: AGORA,
        doDia: true,
      }),
    ).toEqual([deOutraConversa]);
  });
});
