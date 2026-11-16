---
name: banco-de-dados
description: Análise e revisão de bancos de dados relacionais: modelagem, índices, integridade, migrações e desempenho. Use ao investigar ou alterar esquemas e acesso a dados.
license: MIT
compatibility: opencode
metadata:
  keywords: banco de dados, database, sql, schema, tabela, tabelas, indice, indices, migracao, migracoes, postgres, mysql, sqlite, prisma, supabase
  agents: analyst,developer,reviewer
  origem: agenflux
---

# Banco de dados

## O que verificar
- **Modelagem**: chaves primárias em todas as tabelas; chaves estrangeiras declaradas; tipos adequados (datas como data, dinheiro como decimal).
- **Integridade**: `NOT NULL`, `UNIQUE` e `CHECK` onde a regra de negócio exige. Não confie só na aplicação.
- **Índices**: colunas usadas em `WHERE`, `JOIN` e `ORDER BY` frequentes; evite índices duplicados ou nunca usados.
- **Migrações**: reversíveis, pequenas e sem perda de dados. Alterações destrutivas (DROP, mudança de tipo) exigem aprovação explícita e backup.
- **Transações**: operações que precisam ocorrer juntas ficam na mesma transação.
- **Padrões de risco**: N+1 consultas, `SELECT *` em tabelas largas, ausência de paginação, bloqueios longos.

## Regras de segurança
- Nunca execute comandos destrutivos em produção. Não rode migrações sem autorização.
- Não copie dados reais de usuários para relatórios; descreva estrutura e contagens.
