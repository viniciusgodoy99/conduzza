import { MonitorSmartphone } from "lucide-react";

import { Aviso } from "@/components/shared/aviso";

// Aviso exibido SO abaixo de 768px, nas telas pensadas para computador (brief
// secao 6: "melhor no computador"). Hoje aparece em Leads, Pacientes (lista e
// ficha) e Confirmacoes.
//
// O texto diz so o que e verdade: nenhuma tela trava acao pela largura (a
// permissao e por papel, na RLS, nas Server Actions e nos botoes desabilitados
// com dica), entao o aviso nao promete "somente leitura" (achados 75, 103 e
// 110 da revisao).
export function AvisoCelular() {
  return (
    <Aviso
      tom="info"
      icone={MonitorSmartphone}
      role="note"
      className="md:hidden"
    >
      Esta tela funciona melhor no computador ou tablet.
    </Aviso>
  );
}
