---
name: documentacao-em-portugues
description: Como escrever documentação técnica e comentários de código em português brasileiro, claros para outro desenvolvedor. Use ao documentar ou explicar um projeto.
license: MIT
compatibility: opencode
metadata:
  keywords: documentacao, documentar, documente, comentarios, comentario, explique, explicacao, readme, portugues, guia, desenvolvedor
  agents: documenter,analyst,reviewer
  origem: agenflux
---

# Documentação em português

## Comentários no código
- Explique **o porquê** e as decisões; o código já mostra o quê.
- Comente regras de negócio, casos de borda, limites e armadilhas.
- Frases completas, em português do Brasil, sem gírias. Mantenha nomes de identificadores e termos técnicos consagrados no original (ex.: *callback*, *middleware*).
- Não comente o óbvio nem deixe código morto comentado.
- Ao traduzir comentários existentes, preserve o sentido técnico e **não altere o código**.

## Documento de visão geral
1. **O que o projeto faz** em duas ou três frases.
2. **Como rodar**: pré-requisitos e comandos exatos.
3. **Arquitetura**: partes principais e como conversam (uma lista ou diagrama simples).
4. **Fluxo principal** passo a passo, citando os arquivos envolvidos.
5. **Onde mexer para…** (tarefas comuns).
6. **Limitações conhecidas**.

## Regras
- Só afirme o que foi verificado no código. Marque suposições como suposições.
- Cite caminhos de arquivo reais. Nunca inclua senhas, chaves ou tokens em exemplos.
