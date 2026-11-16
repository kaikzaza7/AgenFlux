---
name: revisao-de-codigo
description: Roteiro de revisão de código: correção, legibilidade, regressões, tratamento de erros e escopo. Use ao revisar alterações feitas por outro agente ou pessoa.
license: MIT
compatibility: opencode
metadata:
  keywords: revisao, revisar, review, qualidade de codigo, regressao, regressoes, refatoracao, melhore, melhorar, corrigir
  agents: reviewer,analyst
  origem: agenflux
---

# Revisão de código

1. **Escopo**: a mudança faz o que a missão pediu — e só isso?
2. **Correção**: siga o fluxo com entradas normais e de borda; procure condições invertidas, índices fora do limite e estados não tratados.
3. **Regressões**: quem mais usa o código alterado? Assinaturas, formatos de dados e comportamento padrão foram preservados?
4. **Erros**: falhas são tratadas ou propagadas com contexto; nada é engolido em silêncio.
5. **Legibilidade**: nomes claros, funções curtas, sem duplicação desnecessária.
6. **Segurança**: entrada validada; nenhum segredo adicionado; permissões inalteradas.
7. **Testes**: existem para o comportamento novo e continuam passando?

## Como relatar
Para cada problema: arquivo e linha, por que é um problema e a correção sugerida. Separe **bloqueantes** (use `needsChanges`) de **sugestões**. Reconheça o que está bom com uma frase, sem exagero.
