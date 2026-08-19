import * as React from "react";

// Icone composto para o status "Cancelado pela clinica": building-2 do Lucide
// com risco diagonal. O brief (secao 3.5) pede "building-2 com risco" e o
// Lucide nao tem essa variante pronta. Mesma assinatura dos icones do Lucide.
export const BuildingSlash = React.forwardRef<
  SVGSVGElement,
  React.SVGProps<SVGSVGElement> & { strokeWidth?: number | string }
>(function BuildingSlash({ strokeWidth = 2, ...props }, ref) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="m3 3 18 18" />
    </svg>
  );
});
