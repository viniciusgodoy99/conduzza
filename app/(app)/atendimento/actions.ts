"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { createClient } from "@/lib/supabase/server";

// Acoes do Inbox. Rodam com a SESSAO do usuario (RLS aplica); nada de service
// role aqui. As acoes de posse (assumir, devolver, resolver) chegam na 1.7.

const idSchema = z.uuid();

export async function markConversationReadAction(
  conversationId: string,
): Promise<void> {
  const parsed = idSchema.safeParse(conversationId);
  const context = await getSessionContext();
  if (!parsed.success || !context?.active) {
    return;
  }
  const supabase = await createClient();
  await supabase
    .from("conversation")
    .update({ unread_count: 0 })
    .eq("id", parsed.data)
    .eq("clinic_id", context.active.clinicId)
    .gt("unread_count", 0);
}
