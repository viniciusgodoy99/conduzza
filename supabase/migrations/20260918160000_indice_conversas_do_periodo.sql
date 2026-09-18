-- Achado da revisao adversarial de 18/09/2026 (dimensao performance): a RPC
-- atendimento_do_periodo conta conversas iniciadas por created_at, e
-- conversation era a UNICA tabela-fato das RPCs de periodo sem indice no
-- eixo de recorte (contact, appointment e message ganharam os seus na
-- migration 20260918100000). Na escala alvo (~50 clinicas) o scan passa a
-- doer; o indice fecha a familia.
create index conversation_clinic_created_idx
  on public.conversation (clinic_id, created_at);
