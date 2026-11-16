---
name: consultas-sql
description: Como escrever e revisar consultas SQL corretas, seguras e eficientes. Use ao criar, otimizar ou auditar consultas.
license: MIT
compatibility: opencode
metadata:
  keywords: sql, consulta, consultas, query, queries, join, select, otimizacao, lenta, lento, banco de dados
  agents: developer,reviewer,security
  origem: agenflux
---

# Consultas SQL

- **Parâmetros sempre**: nunca monte SQL concatenando entrada do usuário. Use parâmetros/placeholders do driver ou ORM.
- **Selecione o necessário**: liste as colunas; evite `SELECT *`.
- **Filtre cedo**: condições no `WHERE` antes de agregações; cuidado com funções sobre colunas indexadas (anulam o índice).
- **JOINs**: confirme a cardinalidade para não multiplicar linhas; prefira `EXISTS` a `IN` com subconsulta grande.
- **Paginação**: `LIMIT` com ordenação determinística; para tabelas grandes, paginação por chave.
- **NULL**: lembre que `NULL = NULL` não é verdadeiro; use `IS NULL` e `COALESCE`.
- **Plano de execução**: use `EXPLAIN` para confirmar o uso de índices antes de otimizar "no escuro".
- **Escritas**: `UPDATE` e `DELETE` sempre com `WHERE`; teste primeiro com `SELECT` equivalente.
