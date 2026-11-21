# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que reúne aplicações `ApplicationV2` destacadas em uma única janela externa. Cada painel possui suas próprias abas e pode ser dividido em layouts aninhados.

## Organização por abas

- O primeiro destaque cria a janela externa do Tabbed Foundry.
- As aplicações são registradas como filhas com `ApplicationV2.renderChild()`.
- Cada painel mantém um conjunto independente de abas.
- Abas podem ser reordenadas arrastando-as dentro da barra.
- Clique com o botão direito em uma aba para:
  - **Voltar para o Foundry:** reanexar temporariamente a janela Tabbed com `ApplicationV2.attachWindow()`, transferir a aplicação para a Sidebar do documento principal usando `renderChild()`, e destacar novamente a janela Tabbed se ainda houver outras aplicações.
  - **Destacar em janela própria:** usar `ApplicationV2.detachWindow()` para abrir uma janela externa nativa.
- Fechar uma aba fecha apenas aquela aplicação.
- Quando a última aplicação deixa a janela Tabbed (por fechamento, retorno ao workspace ou detach nativo), a janela hospedeira é fechada automaticamente.

## Split View

Para dividir um painel, arraste uma aba e solte em uma zona de destino:

- Esquerda / direita: cria painéis lado a lado.
- Superior / inferior: cria painéis empilhados.
- Arrastar para o centro de outra aba ou do painel: adiciona a aplicação ao mesmo grupo de abas.
- Arrastar para a borda esquerda ou direita do nome de outra aba: divide o painel em torno daquela aba.
- As zonas de destino são exibidas durante o arraste.
- Arrastar a aba para fora do Tabbed Foundry e soltar sem aceitar um destino destaca a aplicação em uma janela nativa.
- Pressionar Escape cancela o arraste.

Os painéis podem ser divididos novamente, criando layouts aninhados. Arraste a divisória para redimensionar os painéis; duplo clique na divisória restaura a proporção 50/50. Cada lado tenta preservar pelo menos 180 px quando o espaço disponível permite.

## Atualização de geometria

O módulo acompanha os eventos `render` e `position` das aplicações, além de observar alterações de tamanho. Assim, atualiza a geometria dos painéis depois de operações internas do Playlist Directory, Combat Tracker e outras aplicações que recalculam suas dimensões.

## Compatibilidade opcional com Monk's Enhanced Journal

Quando `monks-enhanced-journal` está instalado e ativo, o Tabbed Foundry aplica um patch local aos botões `.journal-tab .close` do Enhanced Journal. O patch interrompe a propagação do clique depois do handler do próprio Monk, evitando que o clique de fechar também ative a página que está sendo removida.

- Não existe dependência obrigatória de Monk's Enhanced Journal.
- Sem o Monk's Enhanced Journal, essa integração não é executada.
- A integração é aplicada novamente após cada renderização do Enhanced Journal, incluindo páginas internas que forem recriadas.

## Configuração

Em **Game Settings → Module Settings → Tabbed Foundry**, use **Agrupar aplicações destacadas automaticamente**.

- Ativado (padrão): o botão de destacar envia `ApplicationV2` para a janela Tabbed Foundry.
- Desativado: o método original `ApplicationV2.detachWindow()` é executado sem agrupamento.

A configuração é individual por cliente (`scope: client`).

## Arquitetura

- `HandlebarsApplicationMixin(ApplicationV2)` para a janela hospedeira.
- `ApplicationV2.attachWindow()` para trazer temporariamente o Tabbed Foundry ao workspace principal antes da transferência.
- `ApplicationV2.renderChild()` para transferir a aplicação à Sidebar do documento principal; depois, o Tabbed restante é destacado novamente.
- `ApplicationV2.detachWindow()` para destacar uma aplicação em sua própria janela nativa.
- A árvore recursiva de painéis (`pane` / `split`) controla grupos de abas, divisões e proporções.
- Os separadores usam Pointer Events; as zonas de divisão usam HTML Drag and Drop.
- A geometria dos filhos é reaplicada nos eventos oficiais `render` e `position`, e observada por `ResizeObserver`.
- A integração com Monk's Enhanced Journal é detectada em tempo de execução e não adiciona dependência ao manifesto.
- O destacamento individual só remove a aplicação da árvore depois que o método nativo termina com sucesso; se o detach falhar, a aba é mantida.

## Escopo e testes necessários

- O agrupamento automático cobre `ApplicationV2`. Aplicações legadas `ApplicationV1` seguem o comportamento nativo.
- Testar no Foundry Desktop v14.365: dividir horizontal e verticalmente, divisões aninhadas, redimensionar separadores, mover abas entre painéis, soltar fora do host, cancelar com Escape e fechar a última aplicação.
- Com Monk's Enhanced Journal ativo, testar fechar uma página interna, alternar páginas e adicionar novas páginas.
- Testar Playlist Directory ao expandir/recolher pastas e Combat Tracker ao iniciar/avançar combate.
- Testar retorno à janela principal: o host deve anexar-se temporariamente ao documento principal, a aplicação deve passar para `ui.sidebar` desse mesmo documento (validado por `ownerDocument`) e o host deve destacar-se novamente se ainda houver abas. Testar também detach nativo individual e fechamento automático da janela Tabbed vazia.
- A janela destacada individual é criada pelo detach nativo do Foundry; itens de menu do aplicativo desktop (Electron) não são criados pelo Tabbed Foundry.

A implementação permanece experimental até esses testes serem feitos no cliente Foundry Desktop.

## API do Foundry utilizada

- [ApplicationV2 v14](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html)
- [Sidebar v14](https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.Sidebar.html)
- `ApplicationV2.renderChild()`
- `ApplicationV2.detachWindow()`
- `ApplicationV2.attachWindow()`
- Eventos `render` e `position` de `ApplicationV2`
- `ApplicationV2.parent` e `ApplicationV2.children`
