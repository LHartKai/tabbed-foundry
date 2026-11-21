# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que reúne aplicações destacadas em uma única janela externa com abas.

## Estado

**Implementação experimental inicial.** A arquitetura atual usa o ciclo de vida nativo de aplicações-filhas do Foundry (`ApplicationV2.renderChild`). Ainda precisa ser testada no Foundry Desktop v14.365 antes de ser considerada estável.

## Comportamento

- Ao destacar uma aplicação `ApplicationV2`, o módulo a encaminha para a janela externa Tabbed Foundry.
- A primeira aplicação cria a janela hospedeira; as seguintes são registradas como aplicações-filhas da mesma janela.
- As abas alternam a aplicação visível.
- O botão de fechar de uma aba fecha apenas aquela aplicação.
- Fechar a janela hospedeira segue o comportamento nativo do Foundry e fecha suas aplicações-filhas.

## Configuração

Em **Game Settings → Module Settings → Tabbed Foundry**:

- **Agrupar aplicações destacadas** — ativado por padrão.
- Quando desativado, o módulo chama o método original `ApplicationV2.detachWindow()` e o Foundry abre a aplicação em uma janela individual.

A configuração usa escopo `client`, portanto cada cliente pode escolher seu próprio comportamento.

## Arquitetura

- `HandlebarsApplicationMixin(ApplicationV2)` para a janela hospedeira.
- `ApplicationV2.renderChild()` para registrar e renderizar as aplicações na mesma janela.
- Interceptação de `ApplicationV2.detachWindow()` com bypass quando a configuração está desativada e fallback para o método original em caso de erro.
- Nenhuma movimentação manual de elementos entre árvores DOM.

## Limitações e testes necessários

- O agrupamento automático cobre `ApplicationV2`. Aplicações legadas `ApplicationV1` seguem o comportamento nativo.
- Aplicações que não usam `ApplicationV2.detachWindow()` para destacar suas janelas não são interceptadas.
- O CSS de dimensionamento das aplicações-filhas precisa ser validado no Foundry Desktop v14.365.
- Testar fichas, Journals, itens, compêndios, minimização, restauração, fechamento de abas e fechamento da janela hospedeira.
- Verificar aplicações que dependem de dimensões ou posicionamento próprios.

## Instalação para desenvolvimento

Copie a pasta `tabbed-foundry` para `Data/modules/` e ative o módulo no mundo.

## Documentação

- [ApplicationV2 v14](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html)
- [Foundry Applications API](https://foundryvtt.com/api/modules/foundry.applications.html)
