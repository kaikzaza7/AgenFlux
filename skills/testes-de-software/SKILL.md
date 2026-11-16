---
name: testes-de-software
description: Estratégia para escrever e executar testes: o que testar, casos de borda, como relatar resultados reais. Use ao criar testes ou verificar requisitos.
license: MIT
compatibility: opencode
metadata:
  keywords: teste, testes, testar, cobertura, qa, requisitos, verificacao, validacao, unitario, e2e, jest, vitest, playwright
  agents: tester,developer,reviewer
  origem: agenflux
---

# Testes de software

## Antes de executar
- Descubra os comandos do projeto (`package.json`, `Makefile`, README). Não invente comandos.
- Prefira os testes existentes; rode o conjunto mais específico primeiro.

## O que cobrir
- Caminho feliz de cada requisito da missão.
- Casos de borda: vazio, nulo, zero, limites, textos longos, caracteres especiais, concorrência.
- Erros esperados: entrada inválida, falha de rede, permissão negada.
- Regressão: o comportamento anterior continua igual onde não deveria mudar.

## Bons testes
- Um comportamento por teste, com nome que descreve o resultado esperado.
- Independentes entre si e determinísticos (sem depender de hora, rede ou ordem).
- Verificam o resultado observável, não detalhes internos.

## Relatório
Informe **o comando exato executado, o resultado real e a saída relevante**. Se um teste não pôde ser executado, diga o motivo. Nunca declare "testes passaram" sem evidência.
