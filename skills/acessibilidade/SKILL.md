---
name: acessibilidade
description: Checklist de acessibilidade web (WCAG 2.2 AA): semântica, teclado, foco, contraste, rótulos e leitores de tela. Use ao criar ou revisar interfaces.
license: MIT
compatibility: opencode
metadata:
  keywords: acessibilidade, a11y, wcag, aria, teclado, contraste, leitor de tela, interface, ui
  agents: developer,reviewer,tester
  origem: agenflux
---

# Acessibilidade

## Verificações obrigatórias
- **Semântica**: use `button`, `a`, `nav`, `main`, `label`, `h1…h6` antes de recorrer a `div` + ARIA.
- **Teclado**: tudo que é clicável funciona com Tab, Enter e Espaço; a ordem de foco segue a leitura; nenhum foco fica preso.
- **Foco visível**: nunca remova o `outline` sem oferecer substituto de contraste ≥ 3:1.
- **Rótulos**: todo campo tem `label`; botões só com ícone têm `aria-label`; imagens informativas têm `alt`.
- **Contraste**: texto ≥ 4.5:1; texto grande e ícones de interface ≥ 3:1.
- **Movimento**: respeite `prefers-reduced-motion`; nada pisca mais de 3 vezes por segundo.
- **Mensagens dinâmicas**: erros e avisos usam `role="alert"` ou `aria-live`.
- **Alvos de toque**: mínimo de 24×24 px, idealmente 44×44 px.

## Como relatar
Para cada problema: arquivo, elemento, critério violado e correção sugerida. Não declare conformidade sem ter verificado.
