# Guia: OpenCode + modelos gratuitos no Windows

Este guia também aparece dentro do AgenFlux, em **Modelos e Provedores → Guia: configurar o OpenCode no Windows**.
Os comandos abaixo são para o **PowerShell**.

> O que foi verificado: os comandos `opencode --version`, `opencode auth login`, `opencode models`, `opencode serve` e a instalação via npm foram conferidos contra o OpenCode **1.19.5** real. Scoop/Chocolatey (OpenCode) e o identificador do winget para o Ollama não puderam ser testados aqui: se falharem, baixe o instalador no site oficial.

## 1. Instalar

```powershell
npm install -g opencode-ai
```

```powershell
opencode --version
```

Se o PowerShell não reconhecer `opencode`, feche e abra o terminal. O AgenFlux **não instala nada sozinho**.

## 2. Conectar uma conta ou provedor (opcional)

Os modelos **“Free” do OpenCode Zen funcionam sem login**. Para outros provedores:

```powershell
opencode auth login
```

Escolha o provedor e cole a chave **no terminal**. Ela fica guardada pelo próprio OpenCode, nunca pelo AgenFlux. Para conferir:

```powershell
opencode auth list
```

## 3. Ver os modelos disponíveis

```powershell
opencode models
```

```powershell
opencode models opencode
```

Os gratuitos do Zen aparecem como `opencode/...-free` (por exemplo `opencode/nemotron-3-ultra-free` e `opencode/nemotron-3.5-lightning-free`).

## 4. Conectar o AgenFlux

1. Inicie o AgenFlux: `npm run dev` e abra http://127.0.0.1:3000.
2. Vá em **Modelos e Provedores** e clique em **Conectar** no cartão **OpenCode**.

O AgenFlux inicia `opencode serve` por conta própria, **somente em 127.0.0.1**, protegido por uma **senha aleatória** que só existe na memória do processo.

### Alternativa: usar um servidor que você mesmo abriu

```powershell
$env:OPENCODE_SERVER_PASSWORD = "uma-senha-forte"
opencode serve --hostname 127.0.0.1 --port 4096
```

Em outro terminal, antes de iniciar o AgenFlux:

```powershell
$env:OPENCODE_URL = "http://127.0.0.1:4096"
$env:OPENCODE_SERVER_PASSWORD = "uma-senha-forte"
npm run dev
```

## 5. Escolher modelos gratuitos e testar

- Mantenha **Somente modelos gratuitos** ligado (é o padrão).
- Na tabela **Modelos**, clique em **Testar**: é uma requisição mínima e real.
- **Tornar padrão** define a preferência geral; na aba **Agentes** você escolhe um modelo (e um alternativo) por agente.

## 6. Ollama (opcional, 100% local)

```powershell
winget install Ollama.Ollama
```

```powershell
ollama pull qwen2.5-coder:7b
```

Depois, **Conectar** no cartão **Ollama**. Neste modo direto o modelo **não usa ferramentas** (serve para análise, planejamento e documentação: o AgenFlux envia um pacote de contexto do projeto). Para um modelo do Ollama editar arquivos, adicione-o como provedor no `opencode.json` do OpenCode.

## 7. Claude como Orquestrador (opcional — usa a sua assinatura Claude)

```powershell
npm install -g @anthropic-ai/claude-code
```

```powershell
claude
```

Faça o login uma vez na janela que abrir e feche. No AgenFlux: **Modelos e Provedores → cartão Claude → Conectar → Tornar o Claude o Orquestrador**.

- O Claude passa a abrir cada missão (inclusive as das **Automações**) com um briefing para a equipe e a redigir o relatório final.
- Dentro do AgenFlux ele trabalha **somente em leitura** (ferramentas Read, Glob e Grep). Edições continuam com os agentes do OpenCode, que pedem aprovação.
- **Não é gratuito**: consome os limites do seu plano. Por isso o botão liga “Permitir assinatura já contratada”. Os outros agentes continuam nos modelos gratuitos.
- Se o limite da assinatura acabar no meio de uma missão, a etapa é refeita com um modelo gratuito.
- A variável `ANTHROPIC_API_KEY` é ignorada de propósito, para nunca gerar cobrança de API.

Verificado com o Claude Code 2.1.325 (uma chamada real mínima). No Windows, se o AgenFlux não achar o executável, defina `CLAUDE_BIN` com o caminho de `claude.exe`.

## 8. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| “OpenCode não encontrado” | executável fora do PATH | defina `OPENCODE_BIN` (abaixo) e reinicie o AgenFlux |
| “recusou a senha do servidor” (401) | `OPENCODE_SERVER_PASSWORD` diferente | use a mesma senha nos dois terminais |
| “Nenhum modelo gratuito compatível” | nenhum provedor gratuito conectado | conecte o OpenCode; confira o filtro e a política |
| “Limite gratuito atingido” (429) | cota do modelo esgotou | o AgenFlux tenta outro modelo gratuito; se não houver, escolha outro e use **Retomar missão** |
| Modelo gratuito sumiu | oferta temporária encerrada | **Atualizar catálogo** e escolha outro |
| Ollama “não está em execução” | aplicativo fechado | abra o Ollama; ele é opcional |

```powershell
$env:OPENCODE_BIN = "$env:APPDATA\npm\node_modules\opencode-ai\bin\opencode.exe"
npm run dev
```
