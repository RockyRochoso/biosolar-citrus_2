# BioSolar Citrus API

Automação Hidro-Energética de Pomares de Citros — Caderno de Desafio Opção 03 (V JTI).

Stack: **PHP** (back-end / API REST, sem framework) + **HTML/CSS/JavaScript puro** (dashboard front-end).

## Como rodar

Requer PHP 8+ instalado (`php -v` para checar).

```bash
php -S localhost:8000 -t public router.php
```

> Atenção à ordem dos parâmetros: `-t public` (docroot) precisa vir **antes** de `router.php`.

Depois abra **http://localhost:8000** no navegador.

## Estrutura

```
router.php              # roteia /telemetria e /bombas/acionar; demais rotas caem nos estáticos de /public
api/
  state.php              # estado + loop de simulação (evapotranspiração, irrigação, reservatório)
  state.json             # criado automaticamente no primeiro request — é a "memória" do servidor
  telemetria.php          # GET  /telemetria
  bombas_acionar.php      # POST /bombas/acionar   body: {"talhao":"1","estado":true}
public/
  index.html, style.css, script.js   # Painel Industrial (dashboard)
```

## Regras de negócio implementadas

- **Sem persistência local**: todo o estado (umidade dos talhões, nível do reservatório, bombas)
  vive só no servidor, em `api/state.json`. O front-end apenas consulta e envia comandos.
- **Loop simulatório**: a cada chamada à API, `simulate()` recalcula a umidade e o reservatório
  com base no tempo real decorrido desde a última chamada (evapotranspiração natural, ganho de
  umidade quando a bomba está ligada, consumo do reservatório por bomba ativa, recarga natural).
- **Gatilho de Salvamento**: umidade de um talhão < 25% → liga a bomba daquele talhão
  automaticamente (`critico: true`).
- **Gatilho de Proteção Hídrica / Bloqueio de Emergência**: reservatório < 15% → desliga todas
  as bombas irrestritamente e passa a **rejeitar** (HTTP 423) qualquer tentativa manual de ligar
  uma bomba, até o reservatório recarregar acima de 20% (histerese, evita ficar oscilando).
- **Painel Industrial**: medidor do reservatório e cards por talhão com cor verde/amarelo/vermelho
  conforme o nível, badge de "Irrigação Crítica (auto)" e interruptor manual por talhão (desabilitado
  durante o bloqueio de emergência).

## Ajustando a velocidade da simulação

As taxas (evaporação, irrigação, consumo/recarga do reservatório) estão como constantes no topo
de `api/state.php` — reduza os valores para uma demo mais lenta, aumente para forçar os gatilhos
mais rápido durante os testes da banca.
