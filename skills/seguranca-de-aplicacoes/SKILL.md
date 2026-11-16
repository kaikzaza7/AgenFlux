---
name: seguranca-de-aplicacoes
description: Roteiro de auditoria de segurança de aplicações: segredos, autenticação, autorização, injeção, dependências e configuração. Use ao procurar vulnerabilidades ou revisar código sensível.
license: MIT
compatibility: opencode
metadata:
  keywords: seguranca, security, vulnerabilidade, vulnerabilidades, owasp, credenciais, segredos, chave de api, senha, token, sensivel, exposta, auditoria
  agents: analyst,security,reviewer,developer
  origem: agenflux
---

# Segurança de aplicações

## Roteiro
1. **Segredos**: chaves, senhas e tokens em código, exemplos, logs, histórico e arquivos de configuração. Relate **arquivo, linha e categoria — nunca o valor**.
2. **Entrada não confiável → operação perigosa**: SQL, shell, caminhos de arquivo, HTML, URLs de saída, desserialização. Trace do ponto de entrada até o uso.
3. **Autenticação e sessão**: senhas com hash forte e sal; tokens com expiração; cookies `HttpOnly`, `Secure`, `SameSite`.
4. **Autorização**: toda rota confere se o usuário pode acessar *aquele* recurso (IDOR); não confie em IDs vindos do cliente.
5. **Exposição no cliente**: nada de segredos em código de navegador ou em variáveis públicas.
6. **Configuração**: CORS restrito, mensagens de erro sem detalhes internos, modo debug desligado, cabeçalhos de segurança.
7. **Dependências**: versões com vulnerabilidades conhecidas e scripts de instalação suspeitos.

## Como relatar
Gravidade (crítica, alta, média, baixa), evidência com caminho do arquivo, impacto e correção sugerida. Um segredo exposto deve ser **revogado e trocado**, não apenas apagado do arquivo.
