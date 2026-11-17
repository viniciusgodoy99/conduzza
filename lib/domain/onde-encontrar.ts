// "Onde encontro": o caminho, na Meta e no Google, ate cada dado que a aba
// "Anuncios e rastreio" pede (decisao do dono de 17/11/2026: o link ao lado
// do campo). Enderecos e caminhos conferidos em 17/11/2026 nas paginas
// oficiais (Central de Ajuda da Meta para Empresas, developers.facebook.com
// e support.google.com); as telas da Meta e do Google mudam, entao cada item
// leva tambem a pagina de ajuda oficial. Nao acrescentar endereco que nao
// esteja numa pagina oficial.

export type LinkDeFora = { rotulo: string; href: string };

export type OndeEncontrar = {
  passos: readonly string[];
  /** Abre a tela onde o dado esta. */
  link: LinkDeFora | null;
  /** A pagina de ajuda oficial com o passo a passo. */
  ajuda: LinkDeFora | null;
};

const GERENCIADOR_DE_EVENTOS: LinkDeFora = {
  rotulo: "Abrir o Gerenciador de Eventos",
  href: "https://business.facebook.com/events_manager2/list",
};

const CONFIGURACOES_DA_EMPRESA: LinkDeFora = {
  rotulo: "Abrir as Configurações da empresa",
  href: "https://business.facebook.com/latest/settings",
};

export const ONDE_ENCONTRAR = {
  pixel: {
    passos: [
      "Abra o Gerenciador de Eventos da Meta.",
      "Em Fontes de dados, escolha o conjunto de dados (o Pixel) da clínica.",
      "Na aba Configurações, copie a identificação do conjunto de dados.",
    ],
    link: GERENCIADOR_DE_EVENTOS,
    ajuda: {
      rotulo: "Ajuda da Meta sobre o conjunto de dados",
      href: "https://www.facebook.com/business/help/898185560232180",
    },
  },
  contaDeAnuncios: {
    passos: [
      "Abra o Gerenciador de Anúncios.",
      "O número da conta aparece no menu de contas, no topo, junto do nome.",
      "Também vale copiar o endereço da página: o número vem depois de act=.",
    ],
    link: {
      rotulo: "Abrir o Gerenciador de Anúncios",
      href: "https://www.facebook.com/adsmanager/manage",
    },
    ajuda: {
      rotulo: "Ajuda da Meta sobre o número da conta",
      href: "https://www.facebook.com/business/help/1492627900875762",
    },
  },
  waba: {
    passos: [
      "Abra as Configurações da empresa na Meta.",
      "Em Contas, abra Contas do WhatsApp Business.",
      "Clique na conta: o painel que abre mostra a identificação dela.",
    ],
    link: CONFIGURACOES_DA_EMPRESA,
    ajuda: null,
  },
  codigoDeTeste: {
    passos: [
      "No Gerenciador de Eventos, escolha o conjunto de dados da clínica.",
      "Abra a aba Eventos de teste.",
      "Na parte de eventos do servidor, copie o código de teste.",
    ],
    link: GERENCIADOR_DE_EVENTOS,
    ajuda: {
      rotulo: "Ajuda da Meta sobre os eventos de teste",
      href: "https://www.facebook.com/business/help/1624255387706033",
    },
  },
  tokenDeConversoes: {
    passos: [
      "Abra o Gerenciador de Eventos da Meta e escolha o conjunto de dados (o Pixel) da clínica.",
      "Na aba Configurações, procure a parte API de Conversões.",
      "Clique em Gerar token de acesso. O botão só aparece para quem administra o conjunto de dados.",
      "Copie o token e cole no campo abaixo.",
    ],
    link: GERENCIADOR_DE_EVENTOS,
    ajuda: {
      rotulo: "Ajuda da Meta sobre a API de Conversões",
      href: "https://www.facebook.com/business/help/232481544843294",
    },
  },
  tokenDeLeitura: {
    passos: [
      "Abra as Configurações da empresa na Meta e, em Usuários, entre em Usuários do sistema.",
      "Crie um usuário do sistema, ou use um que já existe.",
      "Dê a ele acesso à conta de anúncios da clínica.",
      "Clique em Gerar novo token, escolha o aplicativo e a permissão ads_read, e copie o token.",
    ],
    link: {
      rotulo: "Abrir os Usuários do sistema",
      href: "https://business.facebook.com/settings/system-users",
    },
    ajuda: {
      rotulo: "Ajuda da Meta sobre usuários do sistema",
      href: "https://www.facebook.com/business/help/503306463479099",
    },
  },
  parametrosDeUrl: {
    passos: [
      "No Gerenciador de Anúncios, abra o anúncio para editar.",
      "Na parte Rastreamento, procure o campo Parâmetros de URL.",
      "Cole os parâmetros que o cartão Rastreio do site mostra e publique.",
    ],
    link: {
      rotulo: "Abrir o Gerenciador de Anúncios",
      href: "https://www.facebook.com/adsmanager/manage",
    },
    ajuda: {
      rotulo: "Ajuda da Meta sobre parâmetros de URL",
      href: "https://www.facebook.com/business/help/1016122818401732",
    },
  },
  codificacaoAutomaticaDoGoogle: {
    passos: [
      "No Google Ads, abra Administrador e depois Configurações da conta.",
      "Em Codificação automática, marque a opção de codificar o URL dos anúncios.",
      "Salve. Sem isso o clique chega sem o identificador do Google.",
    ],
    link: {
      rotulo: "Abrir as configurações do Google Ads",
      href: "https://ads.google.com/aw/settings/account",
    },
    ajuda: {
      rotulo: "Ajuda do Google sobre a codificação automática",
      href: "https://support.google.com/google-ads/answer/3095550?hl=pt-BR",
    },
  },
  conversoesDoGoogle: {
    passos: [
      "No Google Ads, em Metas, crie uma ação de conversão off-line com o mesmo nome da etapa (por exemplo, compareceu).",
      "No Conduzza, em Resultados, use Exportar e escolha Conversões para o Google Ads (CSV).",
      "No Google Ads, em Metas, Conversões, Uploads, envie o arquivo.",
    ],
    link: {
      rotulo: "Abrir os uploads do Google Ads",
      href: "https://ads.google.com/aw/conversions/uploads",
    },
    ajuda: {
      rotulo: "Ajuda do Google sobre importar conversões",
      href: "https://support.google.com/google-ads/answer/7014069?hl=pt-BR",
    },
  },
} as const satisfies Record<string, OndeEncontrar>;
