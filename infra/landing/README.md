# Landing pages de empreendimentos

Páginas estáticas públicas (HTML + imagens + PDF), servidas pelo Caddy em
`{$LANDING_DOMAIN}` (ex.: `materiais.nordenimoveis.com.br`), uma pasta por
empreendimento. Usadas para Google Ads, WhatsApp e integração no site.

## Estrutura

```
landing/
  wave/
    index.html      # a landing (um arquivo, CSS inline)
    img/            # renders otimizados
    wave-book.pdf   # material para download
  sky/
    index.html      # landing do SKY (Agronômica)
    img/            # renders + plantas (lazer, cobertura)
```

- URLs finais: `https://materiais.nordenimoveis.com.br/wave` · `/sky`
- O Caddy monta esta pasta em `/srv/landing` (ver docker-compose) e serve com
  `file_server`. HTTPS automático.

## Publicar / atualizar

1. Garanta o registro DNS **A** do subdomínio apontando para o IP da VPS.
2. (Opcional) Defina `LANDING_DOMAIN` no `.env` (há default no compose).
3. Na VPS: `git pull` e `docker compose up -d caddy` (recria o contêiner para
   pegar o novo volume/variável). Atualizações só de conteúdo já valem no pull
   seguinte, sem recriar (a pasta é um volume montado).

## Google Analytics / Google Ads

No `index.html`, preencha `GA_ID` (GA4) e `ADS_SEND_TO` (conversão do Ads) no
bloco de script no topo. O clique no WhatsApp dispara o evento `contato_whatsapp`
(GA4) e a `conversion` (Ads).
