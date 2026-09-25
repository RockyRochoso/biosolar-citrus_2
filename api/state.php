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
            '1' => ['nome' => 'Talhão 1 - Laranja', 'umidade' => 62.0, 'bomba' => false, 'critico' => false, 'imagem' => 'talhao_1.png'],
            '2' => ['nome' => 'Talhão 2 - Limão',   'umidade' => 48.0, 'bomba' => false, 'critico' => false, 'imagem' => 'talhao_2.png'],
            '3' => ['nome' => 'Talhão 3 - Laranja', 'umidade' => 70.0, 'bomba' => false, 'critico' => false, 'imagem' => 'talhao_3.png'],
        ],
        'reservatorio'        => 65.0,
        'bloqueio_emergencia' => false,
        'last_update'         => microtime(true),
        'historico' => [
            'timestamps'   => [],
            'reservatorio' => [],
            'talhoes'      => ['1' => [], '2' => [], '3' => []],
            'energia'      => [
                'bateria'      => [],
                'tensao_ac_a'  => [],
                'tensao_ac_b'  => [],
                'corrente_dc_a'=> [],
                'corrente_dc_b'=> [],
                'consumo_w'    => [],
                'tensao_dc'    => [],
                'corrente_dc'  => [],
            ]
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
        'retificadoras' => [
            'CPN-RTF-SMU02B' => [
                'nome' => 'CPN-RTF-SMU02B (Principal Solar)',
                'status' => 'UP',
                'modulos' => [
                    'rectifier1' => 'UP',
                    'rectifier2' => 'UP',
                    'rectifier3' => 'UP',
                ],
                'temp_media' => 38.0,
                'tempo_operacao' => '14.3 weeks',
                'latencia' => '946 µs',
                'bateria_pct' => 100.0,
                'tensao_ac_a' => 224.0,
                'tensao_ac_b' => 224.0,
                'corrente_dc_a' => 3.30,
                'corrente_dc_b' => 3.10,
                'tensao_dc' => 54.6,
                'corrente_dc_total' => 4.80,
                'consumo_w' => 517.0,
            ],
            'OUR-SJS-RTF-SMU11B' => [
                'nome' => 'OUR-SJS-RTF-SMU11B (Backup / Setor Sul)',
                'status' => 'OFF',
                'modulos' => [
                    'rectifier1' => 'OFF',
                    'rectifier2' => 'OFF',
                ],
                'temp_media' => 33.0,
                'tempo_operacao' => '13.3 weeks',
                'latencia' => '1.76 ms',
                'bateria_pct' => 86.0,
                'tensao_ac_a' => 0.0,
                'tensao_ac_b' => 0.0,
                'corrente_dc_a' => 0.0,
                'corrente_dc_b' => 0.0,
                'tensao_dc' => 49.6,
                'corrente_dc_total' => 4.60,
                'consumo_w' => 0.0,
            ]
        ],
        'iot' => [
            'gateway' => [
                'status' => 'ONLINE',
                'protocol' => 'LoRaWAN / MQTT',
                'uptime' => '99.98%',
                'packet_loss' => 0.2,
                'last_ping' => 12
            ],
            'sensores' => [
                'node_t1' => [
                    'talhao' => '1', 'bateria_pct' => 88.5, 'rssi' => -92, 'snr' => 5.2, 'last_uplink' => 'agora', 'status' => 'ONLINE', 'tipo' => 'Umidade/Solo'
                ],
                'node_t2' => [
                    'talhao' => '2', 'bateria_pct' => 65.0, 'rssi' => -112, 'snr' => -1.5, 'last_uplink' => 'agora', 'status' => 'WARNING', 'tipo' => 'Umidade/Solo'
                ],
                'node_t3' => [
                    'talhao' => '3', 'bateria_pct' => 95.0, 'rssi' => -85, 'snr' => 7.1, 'last_uplink' => 'agora', 'status' => 'ONLINE', 'tipo' => 'Umidade/Solo'
                ]
            ]
        ],
        'zabbix_problems' => [
            [
                'id' => 1,
                'tipo' => 'danger',
                'icon' => 'heart-crack',
                'titulo' => 'Módulo Rectifier2 desligou',
                'equipamento' => 'OUR-SJS-RTF-SMU11B',
                'tempo' => '25 Sep 2026 11:08:18 (35 min atrás)',
            ],
            [
                'id' => 2,
                'tipo' => 'danger',
                'icon' => 'heart-crack',
                'titulo' => 'Módulo Rectifier1 desligou',
                'equipamento' => 'OUR-SJS-RTF-SMU11B',
                'tempo' => '25 Sep 2026 11:08:18 (18 min atrás)',
            ],
            [
                'id' => 3,
                'tipo' => 'info',
                'icon' => 'heart',
                'titulo' => 'Bateria está em carga rápida',
                'equipamento' => 'OUR-RTF-SMU11B',
                'tempo' => '01 Sep 2026 11:39:17 (24 days)',
            ],
            [
                'id' => 4,
                'tipo' => 'info',
                'icon' => 'battery-charging',
                'titulo' => 'Corrente de Baterias Limitada',
                'equipamento' => 'OUR-RTF-SMU11B',
                'tempo' => '01 Sep 2026 11:00:17 (24 days)',
            ],
            [
                'id' => 5,
                'tipo' => 'info',
                'icon' => 'battery-charging',
                'titulo' => 'Corrente de Baterias Limitada',
                'equipamento' => 'BVT-RTF-SMU11B',
                'tempo' => '10 Jul 2026 15:12:09 (2 months)',
            ]
        ]
    ];
}

/**
 * Migra state.json antigo para o formato v3
 */
function migrate_state(array $s): array {
    $default = default_state();
    if (!isset($s['historico'])) {
        $s['historico'] = $default['historico'];
    }
    if (!isset($s['historico']['energia'])) {
        $s['historico']['energia'] = $default['historico']['energia'];
    }
    if (!isset($s['retificadoras'])) {
        $s['retificadoras'] = $default['retificadoras'];
    }
    if (!isset($s['iot'])) {
        $s['iot'] = $default['iot'];
    }
    if (!isset($s['zabbix_problems'])) {
        $s['zabbix_problems'] = $default['zabbix_problems'];
    }
    if (!isset($s['log_eventos']))  $s['log_eventos'] = [];
    if (!isset($s['clima'])) {
        $s['clima'] = $default['clima'];
    }
    if (!isset($s['energia'])) {
        $s['energia'] = $default['energia'];
    }
    if (!isset($s['energia']['baterias'])) {
        $s['energia']['baterias'] = 4;
        $s['energia']['tempo_descarga'] = 120;
        $s['energia']['consumo_bomba'] = 2.2;
    }
    // Assegura campo imagem em cada talhao
    if (isset($s['talhoes'])) {
        foreach ($s['talhoes'] as $id => &$t) {
            if (!isset($t['imagem'])) {
                $t['imagem'] = "talhao_{$id}.png";
            }
        }
        unset($t);
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
    $s = $data ? migrate_state($data) : default_state();
    if (empty($s['last_update']) || $s['last_update'] <= 0) {
        $s['last_update'] = microtime(true);
    }
    if (empty($s['energia']['start_time']) || $s['energia']['start_time'] <= 0) {
        $s['energia']['start_time'] = microtime(true);
    }
    return $s;
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

// ── Histórico (buffer circular para sparklines e gráficos elétricos) ──────────────────────────

function push_history(array &$state): void {
    $h = &$state['historico'];
    $h['timestamps'][]   = date('H:i:s');
    $h['reservatorio'][] = round($state['reservatorio'], 1);
    foreach ($state['talhoes'] as $id => $t) {
        if (!isset($h['talhoes'][$id])) $h['talhoes'][$id] = [];
        $h['talhoes'][$id][] = round($t['umidade'], 1);
    }
    
    // Histórico de energia (usando a retificadora principal)
    $rtf = $state['retificadoras']['CPN-RTF-SMU02B'] ?? null;
    if ($rtf) {
        if (!isset($h['energia'])) $h['energia'] = [];
        $h['energia']['bateria'][]       = round($rtf['bateria_pct'], 1);
        $h['energia']['tensao_ac_a'][]   = round($rtf['tensao_ac_a'], 1);
        $h['energia']['tensao_ac_b'][]   = round($rtf['tensao_ac_b'], 1);
        $h['energia']['corrente_dc_a'][] = round($rtf['corrente_dc_a'], 2);
        $h['energia']['corrente_dc_b'][] = round($rtf['corrente_dc_b'], 2);
        $h['energia']['consumo_w'][]     = round($rtf['consumo_w'], 0);
        $h['energia']['tensao_dc'][]     = round($rtf['tensao_dc'], 1);
        $h['energia']['corrente_dc'][]   = round($rtf['corrente_dc_total'], 2);
    }

    if (count($h['timestamps']) > HISTORY_MAX) {
        $h['timestamps']   = array_slice($h['timestamps'],   -HISTORY_MAX);
        $h['reservatorio'] = array_slice($h['reservatorio'],  -HISTORY_MAX);
        foreach ($h['talhoes'] as $id => &$arr) {
            $arr = array_slice($arr, -HISTORY_MAX);
        }
        unset($arr);
        if (isset($h['energia'])) {
            foreach ($h['energia'] as $k => &$arr) {
                $arr = array_slice($arr, -HISTORY_MAX);
            }
            unset($arr);
        }
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

    // ── Simulação de Retificadoras & Suficiência Energética ──
    if (isset($state['retificadoras']['CPN-RTF-SMU02B'])) {
        $rtf = &$state['retificadoras']['CPN-RTF-SMU02B'];
        if ($rtf['status'] === 'UP') {
            $uv = $state['clima']['uv'] ?? 7;
            $noise = (mt_rand(-10, 10) / 10);
            $rtf['tensao_ac_a'] = clamp(222.0 + $noise * 3, 212, 226);
            $rtf['tensao_ac_b'] = clamp(223.0 + (mt_rand(-8, 8) / 10) * 3, 212, 226);
            $base_corrente = 3.1 + ($bombas_ativas * 1.5);
            $rtf['corrente_dc_a'] = clamp($base_corrente + (mt_rand(-5, 5)/50), 0, 15);
            $rtf['corrente_dc_b'] = clamp($base_corrente * 0.95 + (mt_rand(-5, 5)/50), 0, 15);
            $rtf['tensao_dc'] = clamp(54.6 + (mt_rand(-2, 2)/10), 52.0, 56.0);
            $rtf['corrente_dc_total'] = round($rtf['corrente_dc_a'] + $rtf['corrente_dc_b'], 2);
            $rtf['consumo_w'] = round(517 + ($bombas_ativas * 2200), 0);
            
            // Bateria solar: recarrega com sol alto, drena com muitas bombas ligadas
            $solar_power = $uv * 12; // taxa de carga solar
            $discharge = ($bombas_ativas * 8) + 2;
            $rtf['bateria_pct'] = clamp($rtf['bateria_pct'] + (($solar_power - $discharge) * $elapsed / 300), 10, 100);
            $rtf['temp_media'] = clamp(36 + ($bombas_ativas * 2) + ($uv * 0.4), 25, 60);
        }
        unset($rtf);
    }

    // ── Simulação IoT ──
    if (isset($state['iot']['sensores'])) {
        foreach ($state['iot']['sensores'] as &$sensor) {
            // Flutuação de RSSI e SNR
            $sensor['rssi'] = clamp($sensor['rssi'] + mt_rand(-2, 2), -130, -50);
            $sensor['snr'] = clamp($sensor['snr'] + mt_rand(-10, 10) / 10, -20, 10);
            $sensor['bateria_pct'] = clamp($sensor['bateria_pct'] - (0.01 * $elapsed / 60), 0, 100);
            
            if ($sensor['rssi'] < -120) {
                $sensor['status'] = 'OFFLINE';
            } elseif ($sensor['rssi'] < -110 || $sensor['bateria_pct'] < 20) {
                $sensor['status'] = 'WARNING';
            } else {
                $sensor['status'] = 'ONLINE';
            }
        }
        unset($sensor);
        
        $state['iot']['gateway']['packet_loss'] = clamp($state['iot']['gateway']['packet_loss'] + (mt_rand(-10, 10) / 100), 0, 5);
        $state['iot']['gateway']['last_ping'] = mt_rand(10, 45);
    }

    // ── Histórico ──
    push_history($state);

    $state['last_update'] = $now;
}
