# Deploy do Sentinel Server

Este servidor substitui o Firebase Firestore para o monitoramento em tempo real (Sem custos, sem limites de quota).

## Opção 1: Rodar Localmente (Teste)
1. Abra um terminal na pasta `sentinel-server`.
2. Instale as dependências (se ainda não fez): `npm install`
3. Inicie o servidor: `npm start`
4. O servidor rodará em `http://localhost:3001`.
5. O site (frontend) já está configurado para tentar conectar no localhost se nenhuma outra URL for definida.

## Opção 2: Deploy no Render.com (Produção Gratuita)
Para que o painel Admin funcione na internet (quando você não estiver no seu PC), você precisa colocar este servidor online. O Render.com oferece isso de graça para Node.js.

1. Crie um repositório no GitHub apenas com o conteúdo desta pasta `sentinel-server` (ou suba o projeto todo e configure a "Root Directory" no Render).
2. Crie uma conta no [Render.com](https://render.com).
3. Clique em **New +** -> **Web Service**.
4. Conecte seu GitHub e escolha o repositório.
5. Configure:
   - **Name**: `aniflix-sentinel` (ou o que preferir)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Clique em **Create Web Service**.
7. Espere o deploy terminar. O Render te dará uma URL (ex: `https://aniflix-sentinel.onrender.com`).

## Passo Final: Conectar o Frontend
Depois de ter a URL do servidor (seja localhost ou Render):

1. Vá no painel da **Netlify** do seu site `yure-flix`.
2. Vá em **Site settings** -> **Environment variables**.
3. Adicione uma nova variável:
   - Key: `NEXT_PUBLIC_SENTINEL_SERVER_URL`
   - Value: `https://aniflix-sentinel.onrender.com` (ou a URL que você obteve no passo anterior).
4. Faça um novo deploy do frontend (ou `npm run build` localmente e re-deploy).

Agora seu sistema de monitoramento é ilimitado e independente do Firebase!
