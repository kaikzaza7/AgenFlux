---
name: animacoes-de-interface
description: Regras para animações e transições de interface: duração, curvas, propriedades baratas e redução de movimento. Use ao adicionar movimento a uma interface.
license: MIT
compatibility: opencode
metadata:
  keywords: animacao, animacoes, animations, transicao, transicoes, motion, movimento, css, interface, moderna, moderno
  agents: developer,reviewer
  origem: agenflux
---

# Animações de interface

- **Propósito**: cada animação explica uma mudança (entrada, saída, relação entre elementos). Sem propósito, remova.
- **Duração**: 120–200 ms para microinterações; 200–400 ms para painéis; saídas mais rápidas que entradas.
- **Curvas**: desaceleração (`ease-out`) para entradas; aceleração para saídas; evite `linear` em interface.
- **Propriedades baratas**: anime `transform` e `opacity`. Evite animar `width`, `height`, `top`, `left` e sombras grandes.
- **Sem bloqueio**: a interface responde durante a animação; nada de esperar o fim para aceitar cliques.
- **Redução de movimento**: em `prefers-reduced-motion: reduce`, troque deslocamentos por fade curto ou remova.
- **Consistência**: defina durações e curvas como variáveis e reutilize.
- **Loops**: animações contínuas pausam quando o elemento sai da tela ou a aba fica oculta.
