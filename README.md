# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que reúne aplicações `ApplicationV2` destacadas em uma única janela externa com abas.

## Como funciona

- O primeiro destaque cria a janela externa do Tabbed Foundry.
- A aplicação destacada é registrada como filha usando `ApplicationV2.renderChild()`.
- Os próximos destaques são adicionados à mesma janela.
- A alternância de abas apenas oculta/exibe a raiz da aplicação; o módulo não move manualmente os elementos do DOM.
- As aplicações-filhas continuam sob o ciclo de vida nativo `parent` / `children` do Foundry.
- As abas podem ser reorganizadas por arrastar e soltar e cada aplicação pode ser fechada individualmente.

## Configuração

Em **Game Settings → Module Settings → Tabbed Foundry**, use **Agrupar aplicações destacadas automaticamente**.

- Ativado (padrão): o botão de destacar envia `ApplicationV2` para a janela Tabbed Foundry.
- Desativado: o método original `ApplicationV2.detachWindow()` é executado sem agrupamento.

A configuração é individual por cliente (`scope: client`) e vale para os próximos destaques, sem reiniciar o mundo. A versão anterior já utilizava a chave interna `enabled`, que foi preservada para não perder a preferência salva de cada cliente.

## Escopo e limitações

- O agrupamento automático cobre `ApplicationV2`.
- Aplicações legadas `ApplicationV1` não são interceptadas.
- O botão/método de detach de uma aplicação que já está dentro do Tabbed Foundry continua podendo destacá-la individualmente; nesse caso ela é removida da barra de abas.
- Se houver erro no agrupamento antes de a aplicação ser vinculada, o módulo tenta executar o detach nativo como fallback.
- A implementação precisa ser validada em Foundry Desktop v14.365 com fichas, Journals, itens, compêndios, redimensionamento, minimização, fechamento e reabertura da janela hospedeira.

## Desenvolvimento

Copie a pasta `tabbed-foundry` para `Data/modules/` e ative o módulo. A versão atual é experimental; não considere a compatibilidade validada até executar os testes no cliente Foundry.

## API do Foundry utilizada

- `foundry.applications.api.HandlebarsApplicationMixin`
- `ApplicationV2.renderChild()`
- `ApplicationV2.detachWindow()`
- `ApplicationV2.parent` e `ApplicationV2.children`
