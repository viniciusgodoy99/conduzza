import { redirect } from "next/navigation";

// A raiz leva direto para a area logada. Landing page publica esta fora do
// escopo do V1 por decisao documentada.
export default function RootPage() {
  redirect("/inicio");
}
