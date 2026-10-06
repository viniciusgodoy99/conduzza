import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

// Entra no canal de tempo real SO depois de o token da sessao estar no
// cliente (defeito achado em 06/10/2026, docs/05). Na carga da pagina o canal
// pedia para entrar antes de o login ser lido dos cookies: o pedido saia sem
// token, o Realtime registrava a assinatura como anonima (a RLS nao deixa
// passar nenhum evento), e o token que chegava logo depois so era reenviado
// aos canais ja conectados quando MUDASSE, ou seja, na renovacao, perto de 1
// hora depois. Nesse tempo os contadores do menu, a faixa do WhatsApp e, por
// sorte de tempo, o Inbox ficavam mudos, sem erro nenhum.
//
// setAuth() sem argumento busca o token da sessao atual (o callback que o
// supabase-js registra no cliente de tempo real) e o grava antes do join, que
// passa a sair com access_token. As renovacoes seguintes continuam com o
// supabase-js, que reenvia o token aos canais conectados.
//
// Devolve a funcao de saida: desassina (ou impede o join que ainda esperava o
// token, se a tela desmontou antes).
export function assinarComSessao(
  supabase: SupabaseClient,
  canal: RealtimeChannel,
  aoMudar?: Parameters<RealtimeChannel["subscribe"]>[0],
): () => void {
  let ativo = true;
  void supabase.realtime
    .setAuth()
    .catch(() => {
      // Sem token legivel: entra assim mesmo (o comportamento de antes), e a
      // renovacao do supabase-js corrige quando o token chegar.
    })
    .finally(() => {
      if (ativo) {
        canal.subscribe(aoMudar);
      }
    });
  return () => {
    ativo = false;
    void supabase.removeChannel(canal);
  };
}
