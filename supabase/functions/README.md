# Edge Functions: plano de migração

Nenhuma Edge Function está implantada ainda, por decisão registrada no plano
da Fase 1: sem `SUPABASE_ACCESS_TOKEN` não há deploy nem execução, e a conta
uazapi real ainda não chegou para validar o formato dos eventos.

O webhook do WhatsApp roda hoje como Route Handler do Next em
`app/api/webhooks/whatsapp/route.ts`. Toda a lógica pesada (idempotência,
concorrência, contato, consentimento, conversa aberta) vive na função SQL
`public.ingest_inbound_message`, criada na migration
`20260819190000_conversas_whatsapp.sql`.

## Quando migrar

Gatilhos: `SUPABASE_ACCESS_TOKEN` disponível no `.env.local` E conta uazapi
real validada. A migração é barata de propósito:

1. `supabase/functions/whatsapp-webhook/index.ts`: invólucro Deno fino que
   repete o Route Handler: valida `?clinic&secret` contra
   `whatsapp_account_secret` (service role), normaliza o payload (portar
   `lib/integrations/whatsapp/inbound.ts`, que é puro) e chama a MESMA RPC
   `ingest_inbound_message`.
2. `supabase functions deploy whatsapp-webhook --project-ref imizkroxevcawomvgrbn`
   com `SUPABASE_ACCESS_TOKEN` no ambiente.
3. Reconfigurar o webhook das instâncias uazapi para a URL da função
   (a Server Action `connectWhatsAppAction` já faz isso; basta trocar a URL
   base por configuração).
4. O Route Handler permanece como fallback documentado (docs/03 seção 2).

Motivo da função existir: responder a Meta ou o uazapi em menos de 5 segundos
sem cold start de Next, isolada da aplicação.
