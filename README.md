# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que reúne aplicações `ApplicationV2` destacadas em uma única janela externa com abas.

## Abas e ações

- O primeiro destaque cria a janela externa do Tabbed Foundry.
- A aplicação destacada é registrada como filha usando `ApplicationV2.renderChild()`.
- As próximas aplicações são adicionadas à mesma janela.
- A alternância de abas não recria nem move manualmente os elementos do DOM.
- As abas podem ser reordenadas por arrastar e soltar e cada aplicação pode ser fechada individualmente.
- Clique com o botão direito em uma aba para abrir o menu contextual:
  - **Voltar para o Foundry:** transfere a aplicação para um pai invisível na janela principal, mantendo-a como a mesma instância.
  - **Destacar em janela própria:** usa o `ApplicationV2.detachWindow()` original para abrir uma janela externa individual.
- Arrastar uma aba para um destino que não aceite a operação (aba existente ou futura zona de divisão) aciona o detach nativo. Pressionar Escape cancela o arraste sem destacar a aplicação.

## Configuração

Em **Game Settings → Module Settings → Tabbed Foundry**, use **Agrupar aplicações destacadas automaticamente**.

- Ativado (padrão): o botão de destacar envia `ApplicationV2` para a janela Tabbed Foundry.
- Desativado: o método original `ApplicationV2.detachWindow()` é executado sem agrupamento.

A configuração é individual por cliente (`scope: client`) e vale para os próximos destaques.

## Arquitetura

- `HandlebarsApplicationMixin(ApplicationV2)` para as aplicações hospedeiras.
- `ApplicationV2.renderChild()` para transferir aplicações entre a janela Tabbed e o pai invisível no workspace principal.
- `ApplicationV2.detachWindow()` para destacar uma aplicação em sua própria janela nativa.
- O pai invisível do workspace principal é renderizado sem frame e mantém as aplicações reanexadas na janela principal do Foundry.
- A barra de abas usa menu contextual próprio e drag-and-drop HTML5.
- Os futuros alvos de Split View devem chamar `host.acceptDraggedTabDrop()` ao aceitar uma aba; um arraste não aceito resulta em detach nativo.

## Escopo e limitações

- O agrupamento automático cobre `ApplicationV2`. Aplicações legadas `ApplicationV1` seguem o comportamento nativo.
- A divisão de painéis (Split View) ainda não está implementada nesta versão. O comportamento de arraste já reserva a regra: zonas de divisão aceitas mantêm a aplicação no Tabbed; arrastes não aceitos destacam a aplicação em janela nativa.
- Aplicações que não usam `ApplicationV2.detachWindow()` para destacar suas janelas não são interceptadas.
- A implementação precisa ser validada no Foundry Desktop v14.365, especialmente o retorno ao workspace principal, destacamento individual, cancelamento de arraste e módulos que personalizam janelas.

## Desenvolvimento

Copie a pasta `tabbed-foundry` para `Data/modules/` e ative o módulo. A versão atual é experimental; não considere a compatibilidade validada até executar os testes no cliente Foundry.

## API do Foundry utilizada

- [ApplicationV2 v14](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html)
- `ApplicationV2.renderChild()`
- `ApplicationV2.detachWindow()`
- `ApplicationV2.attachWindow()`
- `ApplicationV2.parent` e `ApplicationV2.children`
