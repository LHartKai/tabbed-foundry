# Tabbed Foundry

Módulo experimental para Foundry VTT v14 que organiza aplicações `ApplicationV2` destacadas em uma janela externa única, com abas e painéis divididos.

> **Prévia de desenvolvimento — v1.3.0-beta.2.** Esta versão reativa o agrupamento após o modo de segurança e muda a interceptação para libWrapper. Ainda precisa de validação no Foundry Desktop v14.365 antes de ser considerada estável.

## Funcionalidades

- Agrupamento automático de aplicações `ApplicationV2` destacadas a partir do workspace principal.
- Abas independentes dentro de cada painel.
- Split View horizontal e vertical por arrastar uma aba para as zonas laterais de um painel.
- Divisores redimensionáveis; duplo clique restaura a divisão em 50/50.
- Menu de contexto por aba para devolver a aplicação ao Foundry ou destacá-la em uma janela nativa própria.
- Fechamento de uma aba fecha somente a aplicação correspondente.
- Integração visual opcional com Monk's Enhanced Journal para evitar que o clique de fechar uma página também selecione essa página.

## Dependências

- Foundry VTT v14 (testes-alvo: v14.365).
- **libWrapper** — dependência obrigatória para compor a interceptação com outros módulos sem substituir diretamente `ApplicationV2.prototype.detachWindow`.

O Monk's Enhanced Journal não é uma dependência. A integração com ele só é aplicada quando o módulo está ativo.

## Configuração

Em **Configurações do Jogo → Configurações de Módulos → Tabbed Foundry**, use:

- **Agrupar aplicações destacadas automaticamente**: ativado por padrão.
- Desativado: os próximos destacamentos usam o comportamento nativo do Foundry.
- Ativado: aplicações destacadas do workspace principal são incorporadas à janela Tabbed Foundry.

A configuração é individual por cliente. Desativá-la não fecha automaticamente as aplicações que já estão dentro da janela Tabbed: devolva-as pelo menu de contexto ou feche suas abas.

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
7. Teste Journals, incluindo abrir páginas, fechar páginas internas e fechar a aplicação pela aba.
8. Desative a opção de agrupamento e confirme que os próximos destacamentos usam a janela nativa.
9. Reative a opção e repita os testes de destacamento e reanexação.

## Recuperação

Se uma aplicação ficar presa ou a janela deixar de responder:

1. Use o menu de contexto da aba para devolver a aplicação ao Foundry, quando disponível.
2. Caso a janela Tabbed não responda, feche o Foundry Desktop completamente e abra-o novamente.
3. Se estiver atualizando a partir de uma versão que substituía diretamente o método nativo, encerre todos os processos do Foundry antes de instalar esta versão. Isso remove qualquer interceptação antiga que ainda esteja na memória do processo.

## Desenvolvimento

Validação automatizada:

```bash
node --check scripts/tabbed-foundry.js
node tests/smoke.js
```

A validação automatizada cobre a instalação do wrapper, o uso da configuração, os caminhos de fallback nativo e regressões estruturais conhecidas. Ela não substitui os testes de interface dentro do Foundry Desktop.
