<p align="center"><img src="public/agenflux-logo.png" alt="Logo AgenFlux" width="128"></p>

# AgenFlux

**Monte seu time de agentes e acompanhe o trabalho do Codex em um escritório virtual.**

O AgenFlux é um painel que roda no navegador, servido pelo seu próprio computador. Organize agentes por especialidade, delegue missões no diretório do seu projeto e acompanhe o andamento e os pedidos de aprovação em um só lugar.

## O que você pode fazer

| Área | O que ela faz |
| --- | --- |
| Escritório | Mostra até oito agentes em um mapa animado. Selecione um agente para ver sua atividade ou abra a planta em tela cheia. |
| Time | Monte e salve equipes com agentes próprios ou perfis da biblioteca. Você pode criar times diferentes para desenvolvimento, revisão, documentação e outras tarefas. |
| Missões | Defina o objetivo, a pasta do projeto e o time. Em uma missão personalizada, os agentes trabalham na ordem selecionada e o último consolida a entrega. |
| Aprovações | Mostra as solicitações de autorização e permite aprovar ou recusar cada uma. |
| Histórico | Reúne as missões e seus resultados. |
| Configurações | Conecta o Codex local e mostra os modelos e níveis de raciocínio disponíveis na sua conta. |

## Em computadores mais modestos

O AgenFlux é uma boa opção para quem quer acompanhar agentes em um computador com recursos limitados. O painel roda no navegador, a inferência fica a cargo do serviço Codex e as tarefas reais são executadas uma por vez. Seu computador ainda precisa rodar o Node.js, o navegador e os comandos que você autorizar. O desempenho depende do tamanho do projeto e dos programas em execução.

## Instalação

Você precisa do **Node.js 24 ou superior**, com npm. Para executar tarefas reais, instale também o [Codex CLI](https://developers.openai.com/codex/cli/) e entre com sua conta do ChatGPT.

Clone o repositório ou baixe o ZIP pelo botão **Code → Download ZIP**. Abra um terminal na pasta que contém `package.json` e execute:

```sh
npm ci
codex login
npm run dev
```

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000) e clique em **Conectar Codex**. Para testar a interface sem uma conta conectada, pule o login e use **Demonstração → Simular aprovação**.

## Como usar

1. Em **Time**, monte a equipe e escolha **Salvar time e aplicar**. A ordem de seleção define a ordem de execução de uma missão personalizada.
2. Em **Nova missão**, selecione o time, informe o objetivo e indique o caminho da pasta do seu projeto. Os agentes atuam em sequência e o último consolida a entrega.
3. Acompanhe o escritório e revise pedidos de aprovação antes de responder. Consulte o resultado em **Histórico**.
4. Em **Configurações**, consulte modelos e níveis disponíveis na sua conta. A **Biblioteca ECC** também permite pesquisar agentes e adicionar perfis ao catálogo ou diretamente ao escritório.

O servidor escuta apenas no computador local. A execução usa sua sessão local do Codex e os limites da sua conta. O banco SQLite fica em `data/`. Mantenha essa pasta ao atualizar para preservar seu histórico e seus times. A subpasta `data/packages/ecc/` faz parte do código distribuído e contém os perfis da biblioteca.

## Diagnóstico e testes

```sh
npm run doctor
npm run typecheck
npm test
npm run build
```

Se trocar arquivos do servidor, encerre a instância com **Ctrl+C** e execute `npm run dev` novamente. Se a porta 3000 estiver ocupada, defina a variável de ambiente `PORT` antes de iniciar.

## Biblioteca ECC já incluída

O AgenFlux vem com a biblioteca ECC pronta para consultar, com **71 perfis de agentes** e **314 skills**. Abra **Configurações → Biblioteca ECC** para pesquisar e ler os perfis, ou selecione agentes da biblioteca diretamente na aba **Time**. Não é preciso baixar ou instalar o ECC separadamente.

O material de terceiros vem de [affaan-m/ECC](https://github.com/affaan-m/ECC/tree/d2ef2680594f9a17526a6e1a2e18b3d242c5d17b). O aviso de licença MIT do pacote está em [data/packages/ecc/source/LICENSE](data/packages/ecc/source/LICENSE).
