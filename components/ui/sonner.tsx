"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonAlertIcon,
} from "lucide-react";

// Toast do Conduzza Design System (docs/06 secao 4.5, D17): fundo de tinta nos
// dois temas pelo escopo cz-dark, icone na cor -text da familia (nada de lime
// em sucesso, info e aviso ao mesmo tempo). As cores vem dos aliases e sao
// declaradas no proprio toast (toastOptions.style): la o cz-dark ja vale, entao
// --card, --text-strong e --border resolvem para os valores do escuro.
// O CSS do sonner e injetado fora das camadas do Tailwind e vence qualquer
// utilitario; por isso padding, gap, sombra, peso e cor levam "!".
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[17px] text-success-text" />,
        info: <InfoIcon className="size-[17px] text-info-text" />,
        warning: <CircleAlertIcon className="size-[17px] text-warning-text" />,
        error: <OctagonAlertIcon className="size-[17px] text-alert-text" />,
        loading: <LoaderCircleIcon className="size-[17px] animate-spin" />,
      }}
      style={
        {
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--text-strong)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties,
        classNames: {
          toast:
            "cn-toast cz-dark gap-[11px]! px-3.5! py-3! font-sans shadow-pop!",
          title: "text-[13.5px] font-bold!",
          description: "text-[12.5px] text-text-secondary!",
          icon: "size-[17px]!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
