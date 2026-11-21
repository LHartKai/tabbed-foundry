# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que organiza aplicações `ApplicationV2` destacadas em uma janela externa única, com abas e painéis divididos.

> **Prévia integrada — v1.3.3-beta.1.** Esta versão mantém o agrupamento baseado em libWrapper e incorpora uma integração opcional de compatibilidade para Monk's Enhanced Journal 14.02. Inclui a proteção do ciclo de desanexação nativa e ainda precisa de validação no Foundry Desktop v14.365.

## Funcionalidades

- Agrupamento automático de aplicações `ApplicationV2` destacadas a partir do workspace principal.
- Abas independentes dentro de cada painel.
- Split View horizontal e vertical por arrastar uma aba para as zonas laterais de um painel.
- Divisores redimensionáveis; duplo clique restaura a divisão em 50/50.
- Menu de contexto por aba para devolver a aplicação ao Foundry ou destacá-la em uma janela nativa própria.
- Fechamento de uma aba fecha somente a aplicação correspondente.
- Integração opcional com Monk's Enhanced Journal para compatibilidade de versões e comportamento das abas internas.

## Dependências

- Foundry VTT v14 (testes-alvo: v14.365).
- **libWrapper** — dependência obrigatória para compor a interceptação com outros módulos sem substituir diretamente `ApplicationV2.prototype.detachWindow`.

O Monk's Enhanced Journal não é uma dependência. A integração só é executada quando o módulo está ativo e sua versão é exatamente **14.02**.

## Integração com Monk's Enhanced Journal

O Tabbed Foundry inclui um adaptador opcional para MEJ 14.02. Quando detecta essa versão, corrige:

- Proteção de `fixType()` para documentos ausentes e para não atribuir tipos de página MEJ ao `JournalEntry` principal.
- Retorno da Promise de renderização de páginas internas.
- Ordem de inicialização da limpeza de abas duplicadas, antes da criação de `this.tabs.active`.
- Reaplicação dos estilos das páginas dentro do Enhanced Journal.

A integração é independente da opção de agrupamento automático. Portanto, as correções do Monk continuam ativas quando o agrupamento de janelas do Tabbed está desligado.

Para evitar alterações em versões não verificadas, o adaptador **não aplica correções** se o Monk estiver ausente, desativado ou em qualquer versão diferente de 14.02. O adaptador também evita aplicar patches duplicados se o módulo separado **MEJ 14.02 Compatibility Patch** estiver ativo.

**Migração do patch separado:** depois de instalar e validar esta versão do Tabbed Foundry, desative o módulo separado `mej-14-02-compat` e reinicie o Foundry. Não deixe os dois ativos ao mesmo tempo. Enquanto o módulo separado estiver ativo, o adaptador embutido registra no console que foi ignorado.

O status da integração pode ser consultado em `game.modules.get("tabbed-foundry").api.mejCompatibility`.

## Configuração

Em **Configurações do Jogo → Configurações de Módulos → Tabbed Foundry**, use:

- **Agrupar aplicações destacadas automaticamente**: ativado por padrão.
- Desativado: os próximos destacamentos usam o comportamento nativo do Foundry.
- Ativado: aplicações destacadas do workspace principal são incorporadas à janela Tabbed Foundry.

A configuração é individual por cliente. Desativá-la não desativa a integração de compatibilidade do Monk e não fecha automaticamente as aplicações que já estão dentro da janela Tabbed: devolva-as pelo menu de contexto ou feche suas abas.

## Como funciona a interceptação

O módulo registra um wrapper `MIXED` de `foundry.applications.api.ApplicationV2.prototype.detachWindow` por meio do libWrapper.

- Quando o agrupamento está desativado, a chamada continua diretamente para o destacamento nativo.
- Aplicações já destacadas ou pertencentes a outra aplicação-pai não são capturadas.
- O próprio host Tabbed sempre usa o destacamento nativo do Foundry.
- Ao destacar uma aplicação que já está em uma aba, ela só é removida do layout depois que o destacamento nativo termina com sucesso.
- Se o registro do wrapper falhar, o módulo falha de forma segura e mantém o destacamento nativo. O console informa o motivo.

As operações de entrada, saída e reanexação são serializadas por uma fila para evitar transferências concorrentes. O módulo também registra conflitos de libWrapper que envolvam seu próprio wrapper.

## Roteiro de validação da prévia

Teste primeiro em uma cópia do mundo e com o módulo **Tabbed Journals** desativado, para evitar dois módulos interceptando a abertura de Journals ao mesmo tempo.

1. Ative o Tabbed Foundry e confirme no console que o agrupamento automático está ativado e a interceptação via libWrapper foi instalada.
2. Destaque duas aplicações `ApplicationV2` a partir da janela principal. Elas devem aparecer como abas na mesma janela Tabbed.
3. Alterne entre as abas e redimensione a janela.
4. Arraste uma aba para a esquerda/direita e depois para cima/baixo de outro painel. Verifique a divisão e o redimensionamento.
5. No menu de contexto de uma aba, devolva uma aplicação ao Foundry enquanto outra permanece no Tabbed.
6. No menu de contexto de outra aba, destaque-a em uma janela nativa separada.
7. Com MEJ 14.02 ativo e o módulo separado de compatibilidade desativado, confirme no console:
   `Compatibilidade do Monk's Enhanced Journal 14.02 aplicada`.
8. Teste abrir Journals com várias páginas, fechar páginas internas, estilos, abas duplicadas e fechar a aplicação pela aba.
9. Desative o agrupamento automático e confirme que os próximos destacamentos usam a janela nativa, enquanto a integração do Monk continua ativa.
10. Reative o agrupamento e repita os testes de destacamento e reanexação.

## Recuperação

Se uma aplicação ficar presa ou a janela deixar de responder:

1. Use o menu de contexto da aba para devolver a aplicação ao Foundry, quando disponível.
2. Caso a janela Tabbed não responda, feche o Foundry Desktop completamente e abra-o novamente.
3. Se estiver atualizando a partir de uma versão que substituía diretamente o método nativo, encerre todos os processos do Foundry antes de instalar esta versão. Isso remove qualquer interceptação antiga que ainda esteja na memória do processo.

## Desenvolvimento

Validação automatizada:

```bash
node --check scripts/tabbed-foundry.js
node --check scripts/integrations/monks-enhanced-journal.js
node tests/smoke.js
node tests/mej-integration-smoke.js
```

Os testes automatizados cobrem registro de wrappers, fallbacks nativos, ativação condicional por versão do Monk, ausência de patches quando o Monk não está ativo e correções de renderização/abas. Eles não substituem os testes de interface dentro do Foundry Desktop.
