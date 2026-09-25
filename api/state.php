<?php
// Todo o estado vive apenas no servidor (state.json), conforme exigido no
// caderno: "Proibição de Persistência Local". O front-end nunca guarda dado,
// apenas consulta GET /telemetria e envia POST /bombas/acionar.

define('STATE_FILE', __DIR__ . '/state.json');

// ── Taxas da simulação (ajuste para acelerar/desacelerar a demo) ──────────
define('EVAPORATION_RATE',       0.05);   // %/s de perda natural de umidade
define('IRRIGATION_RATE',        0.4);    // %/s de ganho de umidade (aspersor)
define('RESERVOIR_CONSUMPTION',  0.15);   // %/s de consumo do reservatório por bomba
define('RESERVOIR_RECHARGE',     0.03);   // %/s de recarga natural (chuva/poço)

// ── Limiares ──────────────────────────────────────────────────────────────
define('LIMIAR_CRITICO_UMIDADE',          25);
define('LIMIAR_EMERGENCIA_RESERVATORIO',  15);
define('LIMIAR_DESBLOQUEIO_RESERVATORIO', 20);

// ── Novos parâmetros v2 ───────────────────────────────────────────────────
define('HISTORY_MAX',        30);   // leituras no buffer circular (sparklines)
define('LOG_MAX',            50);   // eventos máximos mantidos
define('POTENCIA_BOMBA_KW',  2.2); // consumo elétrico por bomba (kW)

// ═══════════════════════════════════════════════════════════════════════════

function default_state(): array {
    return [
        'talhoes' => [
            '1' => ['nome' => 'Talhão 1 - Laranja', 'umidade' => 62.0, 'bomba' => false, 'critico' => false],
            '2' => ['nome' => 'Talhão 2 - Limão',   'umidade' => 48.0, 'bomba' => false, 'critico' => false],
            '3' => ['nome' => 'Talhão 3 - Laranja', 'umidade' => 70.0, 'bomba' => false, 'critico' => false],
        ],
        'reservatorio'        => 65.0,
        'bloqueio_emergencia' => false,
        'last_update'         => microtime(true),
        'historico' => [
            'timestamps'   => [],
            'reservatorio'  => [],
            'talhoes'      => ['1' => [], '2' => [], '3' => []],
        ],
        'log_eventos' => [],
        'clima' => [
            'temperatura'  => 31.0,
            'vento_kmh'    => 8.0,
            'uv'           => 7,
            'chance_chuva' => 10,
            'condicao'     => 'ensolarado',
        ],
        'energia' => [
            'consumo_acumulado_kwh' => 0.0,
            'start_time'           => microtime(true),
            'baterias'             => 4,
            'tempo_descarga'       => 120, // Minutos
            'consumo_bomba'        => 2.2, // kW
        ],
    ];
}

/**
 * Migra state.json antigo para o formato v2, adicionando campos novos
 * sem perder o estado existente.
 */
function migrate_state(array $s): array {
    if (!isset($s['historico'])) {
        $ids = array_keys($s['talhoes']);
        $s['historico'] = [
            'timestamps'   => [],
            'reservatorio'  => [],
            'talhoes'      => array_fill_keys($ids, []),
        ];
    }
    if (!isset($s['log_eventos']))  $s['log_eventos'] = [];
    if (!isset($s['clima'])) {
        $s['clima'] = ['temperatura'=>31,'vento_kmh'=>8,'uv'=>7,'chance_chuva'=>10,'condicao'=>'ensolarado'];
    }
    if (!isset($s['energia'])) {
        $s['energia'] = ['consumo_acumulado_kwh'=>0,'start_time'=>microtime(true)];
    }
    if (!isset($s['energia']['baterias'])) {
        $s['energia']['baterias'] = 4;
        $s['energia']['tempo_descarga'] = 120;
        $s['energia']['consumo_bomba'] = 2.2;
    }
    return $s;
}

function load_state(): array {
    if (!file_exists(STATE_FILE)) {
        $state = default_state();
        save_state($state);
        return $state;
    }
    $fp = fopen(STATE_FILE, 'r');
    flock($fp, LOCK_SH);
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $data = json_decode($raw, true);
    return $data ? migrate_state($data) : default_state();
}

function save_state(array $state): void {
    $fp = fopen(STATE_FILE, 'c');
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function clamp(float $v, float $min = 0, float $max = 100): float {
    return max($min, min($max, $v));
}

// ── Logging ───────────────────────────────────────────────────────────────

function add_log(array &$state, string $tipo, string $msg): void {
    array_unshift($state['log_eventos'], [
        'ts'   => date('H:i:s'),
        'tipo' => $tipo,
        'msg'  => $msg,
    ]);
    if (count($state['log_eventos']) > LOG_MAX) {
        $state['log_eventos'] = array_slice($state['log_eventos'], 0, LOG_MAX);
    }
}

// ── Histórico (buffer circular para sparklines) ──────────────────────────

function push_history(array &$state): void {
    $h = &$state['historico'];
    $h['timestamps'][]   = date('H:i:s');
    $h['reservatorio'][] = round($state['reservatorio'], 1);
    foreach ($state['talhoes'] as $id => $t) {
        $h['talhoes'][$id][] = round($t['umidade'], 1);
    }
    if (count($h['timestamps']) > HISTORY_MAX) {
        $h['timestamps']   = array_slice($h['timestamps'],   -HISTORY_MAX);
        $h['reservatorio'] = array_slice($h['reservatorio'],  -HISTORY_MAX);
        foreach ($h['talhoes'] as $id => &$arr) {
            $arr = array_slice($arr, -HISTORY_MAX);
        }
        unset($arr);
    }
}

// ── Simulação Climática ──────────────────────────────────────────────────

function simulate_weather(array &$state, float $elapsed): void {
    $c = &$state['clima'];

    // Drift suave baseado no tempo real
    $c['temperatura']  = clamp($c['temperatura']  + (mt_rand(-10, 10) / 80) * $elapsed, 18, 42);
    $c['vento_kmh']    = clamp($c['vento_kmh']    + (mt_rand(-8, 8)   / 80) * $elapsed, 2, 45);
    $c['chance_chuva'] = clamp($c['chance_chuva'] + (mt_rand(-12, 12) / 80) * $elapsed, 0, 85);

    // UV inversamente correlacionado com nebulosidade
    $uv_base = ($c['chance_chuva'] < 30) ? mt_rand(6, 11) : mt_rand(1, 5);
    $c['uv'] = (int) round(($c['uv'] * 0.85) + ($uv_base * 0.15));

    // Condição textual
    if ($c['chance_chuva'] > 65) {
        $c['condicao'] = $c['vento_kmh'] > 28 ? 'tempestade' : 'chuva';
    } elseif ($c['chance_chuva'] > 35) {
        $c['condicao'] = 'nublado';
    } else {
        $c['condicao'] = 'ensolarado';
    }
}

// ── Simulação Principal ─────────────────────────────────────────────────

/**
 * Avança a simulação com base no tempo real decorrido desde a última
 * chamada à API (o "loop simulatório" roda a cada requisição, já que o
 * PHP built-in server é stateless entre requests).
 */
function simulate(array &$state): void {
    $now     = microtime(true);
    $elapsed = $now - $state['last_update'];
    if ($elapsed <= 0) return;
    $elapsed = min($elapsed, 300); // trava de segurança

    // ── Clima ──
    simulate_weather($state, $elapsed);

    // Multiplicadores baseados no clima
    $evap_mult     = 1.0;
    $recharge_mult = 1.0;
    switch ($state['clima']['condicao']) {
        case 'chuva':
            $evap_mult = 0.3;  $recharge_mult = 3.0;  break;
        case 'tempestade':
            $evap_mult = 0.15; $recharge_mult = 5.0;  break;
        default:
            if ($state['clima']['temperatura'] > 36) $evap_mult = 1.5;
    }

    // ── Talhões: umidade ──
    $bombas_ativas = 0;
    foreach ($state['talhoes'] as &$t) {
        if ($t['bomba']) {
            $t['umidade'] = clamp($t['umidade'] + IRRIGATION_RATE * $elapsed);
            $bombas_ativas++;
        } else {
            $t['umidade'] = clamp($t['umidade'] - EVAPORATION_RATE * $elapsed * $evap_mult);
        }
    }
    unset($t);

    // ── Energia ──
    $consumo_por_bomba = $state['energia']['consumo_bomba'] ?? POTENCIA_BOMBA_KW;
    $state['energia']['consumo_acumulado_kwh'] +=
        ($consumo_por_bomba * $bombas_ativas * $elapsed / 3600);

    // ── Reservatório ──
    $delta = (RESERVOIR_RECHARGE * $elapsed * $recharge_mult)
           - (RESERVOIR_CONSUMPTION * $elapsed * $bombas_ativas);
    $state['reservatorio'] = clamp($state['reservatorio'] + $delta);

    // ── Bloqueio de Emergência (com histerese) ──
    $prev_bloqueio = $state['bloqueio_emergencia'];

    if ($state['reservatorio'] < LIMIAR_EMERGENCIA_RESERVATORIO) {
        $state['bloqueio_emergencia'] = true;
    } elseif ($state['reservatorio'] >= LIMIAR_DESBLOQUEIO_RESERVATORIO) {
        $state['bloqueio_emergencia'] = false;
    }

    if ($state['bloqueio_emergencia'] && !$prev_bloqueio) {
        add_log($state, 'emergencia',
            'BLOQUEIO DE EMERGÊNCIA ativado — reservatório em '
            . round($state['reservatorio'], 1) . '%');
    }
    if (!$state['bloqueio_emergencia'] && $prev_bloqueio) {
        add_log($state, 'desbloqueio',
            'Bloqueio desativado — reservatório recuperou para '
            . round($state['reservatorio'], 1) . '%');
    }

    if ($state['bloqueio_emergencia']) {
        foreach ($state['talhoes'] as $id => &$t) {
            if ($t['bomba']) {
                add_log($state, 'bomba_off',
                    'Bomba do ' . $t['nome'] . ' desligada (bloqueio de emergência)');
            }
            $t['bomba']   = false;
            $t['critico'] = false;
        }
        unset($t);
    } else {
        // Gatilho Autônomo de Salvamento → Irrigação Crítica
        foreach ($state['talhoes'] as $id => &$t) {
            $was_critico = $t['critico'];
            if ($t['umidade'] < LIMIAR_CRITICO_UMIDADE) {
                $t['bomba']   = true;
                $t['critico'] = true;
                if (!$was_critico) {
                    add_log($state, 'critico',
                        'IRRIGAÇÃO CRÍTICA ativada no ' . $t['nome']
                        . ' — umidade em ' . round($t['umidade'], 1) . '%');
                }
            } elseif ($t['umidade'] > LIMIAR_CRITICO_UMIDADE + 5) {
                if ($was_critico) {
                    add_log($state, 'critico_off',
                        'Irrigação crítica desativada no ' . $t['nome']
                        . ' — umidade recuperou para ' . round($t['umidade'], 1) . '%');
                }
                $t['critico'] = false;
            }
        }
        unset($t);
    }

    // ── Histórico ──
    push_history($state);

    $state['last_update'] = $now;
}
