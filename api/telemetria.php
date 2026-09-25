<?php
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/state.php';

$state = load_state();
simulate($state);
save_state($state);

// ── KPIs derivados ──
$bombas_ativas = 0;
foreach ($state['talhoes'] as $t) {
    if ($t['bomba']) $bombas_ativas++;
}
$consumo_atual_kw = POTENCIA_BOMBA_KW * $bombas_ativas;
$uptime_s         = microtime(true) - $state['energia']['start_time'];

// Economia: irrigação inteligente vs irrigação contínua (3 bombas 100% do tempo)
$consumo_continuo = POTENCIA_BOMBA_KW * count($state['talhoes']) * ($uptime_s / 3600);
$economia_pct     = $consumo_continuo > 0
    ? round((1 - $state['energia']['consumo_acumulado_kwh'] / $consumo_continuo) * 100, 1)
    : 0;

echo json_encode([
    'talhoes'              => $state['talhoes'],
    'reservatorio'         => round($state['reservatorio'], 2),
    'bloqueio_emergencia'  => $state['bloqueio_emergencia'],
    'timestamp'            => date('c'),
    'historico'            => $state['historico'],
    'log_eventos'          => array_slice($state['log_eventos'], 0, 20),
    'clima'                => $state['clima'],
    'energia' => [
        'consumo_atual_kw'       => round($consumo_atual_kw, 1),
        'consumo_acumulado_kwh'  => round($state['energia']['consumo_acumulado_kwh'], 2),
        'economia_estimada_pct'  => max(0, $economia_pct),
        'uptime_s'               => round($uptime_s),
    ],
], JSON_UNESCAPED_UNICODE);
