# AlugaLoja — painel para alugar lojas prontas

Você sobe o `index.html` dos seus sites, marca o que pode ser editado, e os clientes alugam
(semanal ou mensal), trocam textos, preços, fotos e o link do checkout. O layout fica travado.

## Rodar no computador

```powershell
cd C:\Users\lucas\saas-lojas
npm start
```

- Painel: http://localhost:3000
- Login do admin: está no arquivo `.env` (criado sozinho na primeira vez)
- Lojas dos clientes: http://NOMEDALOJA.localhost:3000

Não precisa instalar nada além do Node.js (22.13 ou mais novo). O banco fica em `data/saas.db`.

## Como usar

**Dono (admin)**: menu de cima
- **Configurações**: sua chave Pix (CNPJ), nome do recebedor e cidade; teste grátis (em horas);
  cadastro aberto ou fechado; nome, cor e textos do site; WhatsApp e horário de atendimento; aviso para os membros.
- **Membros**: busca, cria login (senha automática ou escolhida), troca senha, bloqueia/desbloqueia,
  libera novo teste grátis, cria loja para o membro já liberada por X dias, anotações e histórico de pagamentos.
- **Pagamentos**: quem clicou em "Já paguei" aparece em destaque com o comprovante.
  Confira o Pix no banco → **Confirmar e liberar** (o prazo da loja soma na hora) ou **Recusar**.
- **Lojas**: libera tempo em dias ou horas, suspende/reativa, e **Gerenciar** abre o conteúdo e o checkout de qualquer loja.
- **Página inicial**: edite todos os textos da página de entrada do site (topo, botões, vantagens, como funciona,
  planos, chamada final, rodapé), escolha a loja de exemplo ou uma imagem própria e ligue/desligue seções, com prévia ao lado.
- **Templates**: envie a **pasta do site** (index.html + pastas de CSS, imagens, fontes, JS, como `index_files`)
  ou um **.zip** dela, e marque o que pode ser editado. Os caminhos dos arquivos são ligados sozinhos.
- **Planos**: crie quantos quiser (diário, semanal, quinzenal, mensal...), com preço e duração.

> O `index.html` precisa ser completo: CSS dentro do arquivo e imagens embutidas ou por link `https://`.

**Membro (quem aluga)**
1. Cria conta (ou recebe o login do dono) → escolhe modelo, endereço e plano (ou o teste grátis).
2. Paga o Pix (QR Code ou copia e cola com o valor certo) e clica em **Já paguei** com o comprovante.
3. **Conteúdo**: textos, preços e fotos. **Checkout**: escolhe onde os clientes dele pagam:
   link externo (Yampi, CartPanda, Kiwify, Hotmart...), Mercado Pago, Stripe, Pix direto ou WhatsApp,
   com um ou mais produtos. Os botões "Comprar" da loja passam a abrir esse checkout.
4. Quando vence, a loja sai do ar sozinha. É só renovar no painel.

As chaves de Mercado Pago e Stripe dos membros ficam cifradas no banco (`APP_SECRET` no `.env`, não perca esse valor).

## Pagamento do aluguel

O padrão é **Pix na sua chave com confirmação manual** (Configurações → Recebimento do aluguel).
Para testar sem dinheiro, escolha "Modo teste". Para cobrança automática pelo Asaas, coloque no `.env`
e escolha "Asaas" nas Configurações:

```
ASAAS_API_KEY=sua_chave
ASAAS_ENV=sandbox            # troque para producao quando for valer
ASAAS_WEBHOOK_TOKEN=um-token-secreto-qualquer
```

No painel do Asaas, crie um webhook apontando para `https://seudominio.com/webhooks/asaas`
com o mesmo token e os eventos "Cobrança recebida" e "Cobrança confirmada".
Cada pagamento confirmado soma 7 ou 30 dias ao prazo da loja.

## Proteção contra cópia

- O cliente que aluga nunca recebe o arquivo. Ele só edita campos.
- A loja vai cifrada para o navegador. Ctrl+U e "exibir código-fonte" mostram só um código embaralhado.
- A chave depende do domínio: a página copiada ou salva não abre em outro lugar.
- Bloqueia F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S, Ctrl+P, botão direito e arrastar imagens.
- Se o DevTools for aberto pelo menu do navegador, a página se apaga.
- Cada loja leva uma marca invisível (no texto e no código) para identificar quem copiou.

Nenhuma proteção é 100%. Quem é muito técnico ainda consegue tirar uma cópia do que aparece na tela.
Mas copiar passa a dar muito mais trabalho do que pagar o aluguel.

## Colocar no ar (produção)

> **Vercel e Netlify não servem.** Este sistema precisa de um servidor sempre ligado e de um disco que guarde
> o banco, as fotos e os arquivos dos templates. A Vercel roda "funções" curtas e apaga o que é gravado
> (dá o erro `500 FUNCTION_INVOCATION_FAILED`). Use uma das opções abaixo.

### Opção A — Railway (mais fácil, ~US$ 5/mês)

1. Suba esta pasta para um repositório no GitHub (o `.gitignore` já deixa de fora `data/` e `.env`).
2. Em railway.com → **New Project → Deploy from GitHub repo** → escolha o repositório.
   A Railway usa o `Dockerfile` sozinha.
3. No serviço → **Settings → Volumes → Add Volume** com o caminho **`/data`**. (Sem volume, tudo é apagado a cada publicação.)
4. Em **Variables**, adicione:
   - `ADMIN_EMAIL` = seu e-mail de login
   - `ADMIN_PASSWORD` = sua senha de dono
   - `APP_SECRET` = um texto longo e aleatório (guarde: ele protege as chaves de pagamento dos membros)
5. Em **Settings → Networking → Generate Domain**. Pronto: o painel fica em `https://SEU-APP.up.railway.app`
   e as lojas em `https://SEU-APP.up.railway.app/loja/NOMEDALOJA/` (o sistema detecta a Railway sozinho).
6. **Domínio próprio (opcional)**: em Networking → Custom Domain adicione `seudominio.com.br` **e** `*.seudominio.com.br`,
   crie os registros que a Railway mostrar no seu DNS e adicione a variável `BASE_DOMAIN=seudominio.com.br`.
   As lojas passam a ficar em `NOMEDALOJA.seudominio.com.br`.

**Render** funciona igual (Web Service com Docker + Disk em `/data`; disco só nos planos pagos).
**Fly.io** também (`fly launch` usa o Dockerfile; crie um volume montado em `/data`).

Variáveis opcionais: `BASE_DOMAIN`, `PUBLIC_PROTO`, `PUBLIC_PORT`, `TRUST_PROXY`, `DATA_DIR`,
`LOJA_POR_CAMINHO` (`1` = lojas em `/loja/nome/`, `0` = lojas em subdomínio), `ASAAS_*`.

### Opção B — VPS própria (mais barata a longo prazo)

Tudo é feito por dois scripts da pasta `deploy/`.

**Antes (uma vez só):**
1. Compre uma VPS com **Ubuntu 24.04** (1 GB de RAM basta) e anote o IP e a senha de root.
2. Compre o domínio (Registro.br) e adicione no **Cloudflare** (troque os DNS no Registro.br).
3. No Cloudflare → **DNS**: dois registros `A`, `@` e `*`, apontando para o IP da VPS, com a nuvem laranja ligada.
4. No Cloudflare → **SSL/TLS**: modo **Full (strict)**.
5. No Cloudflare → **SSL/TLS → Origin Server → Create Certificate**: deixe a janela aberta,
   o script vai pedir para colar o certificado e a chave.

**Instalar (no seu PC):**
```powershell
cd C:\Users\lucas\saas-lojas; powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Ip IP_DA_VPS
```
O script envia o projeto e pergunta: domínio, e-mail e senha do dono, e o certificado do Cloudflare.
Ele instala Node.js, Caddy (HTTPS), PM2 (mantém o painel ligado), firewall e backup diário em `/opt/backups`.

**Atualizar depois** (quando mudar o código): rode o mesmo comando. O banco, as fotos, os comprovantes
e o `.env` da VPS nunca são substituídos.

Comandos úteis na VPS (`ssh root@IP_DA_VPS`): `pm2 logs lojas` (ver erros), `pm2 restart lojas` (reiniciar).
