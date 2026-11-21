# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que tenta agrupar aplicações destacadas em uma única janela externa com abas.

## Estado

**v0.1.0 — prova de conceito.** Ainda não é uma versão estável.

## Escopo inicial

- Interceptar chamadas a `ApplicationV2.detachWindow()`.
- Criar uma janela externa chamada Tabbed Foundry na primeira aplicação destacada.
- Adotar a aplicação como filha usando `ApplicationV2.renderChild()`.
- Alternar entre aplicações por abas.
- Fechar uma aplicação individualmente pelo botão da aba.

## Limitações conhecidas

- O agrupamento automático cobre apenas `ApplicationV2`. Aplicações legadas `ApplicationV1` seguem o comportamento nativo.
- O módulo intercepta o método público `detachWindow`; aplicações que criem janelas por outros meios não são capturadas.
- Esta prova de conceito ainda precisa ser testada no Foundry Desktop v14.365, especialmente com fichas, journals, compêndios, janelas minimizadas, fechar a janela hospedeira e aplicações que dependem de posicionamento próprio.
- O layout interno de cada aplicação pode precisar de ajustes para se adaptar ao espaço da janela agrupadora.

## Instalação para desenvolvimento

Copie a pasta `tabbed-foundry` para `Data/modules/` e ative o módulo no mundo.

## API utilizada

- [ApplicationV2 v14](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html)
