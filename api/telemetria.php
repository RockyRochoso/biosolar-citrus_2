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

// ── Métricas ESG & Financeiras ──
$horas_operacao = max(0.01, $uptime_s / 3600);
$litros_por_hora_bomba = 1500; // Vazão típica por talhão (L/h)
$total_talhoes = max(1, count($state['talhoes']));

// Litros que teriam sido gastos se todas as bombas operassem 100% do tempo vs real
$litros_teorico = $total_talhoes * $litros_por_hora_bomba * $horas_operacao;
$kwh_consumido = $state['energia']['consumo_acumulado_kwh'];
$horas_bomba_efetivas = (POTENCIA_BOMBA_KW > 0) ? ($kwh_consumido / POTENCIA_BOMBA_KW) : 0;
$litros_gastos = $horas_bomba_efetivas * $litros_por_hora_bomba;
$agua_economizada_l = max(0, $litros_teorico - $litros_gastos);

// Economia financeira (R$ 0,85 por kWh + economia de água tratada R$ 0,004/L)
$kwh_economizado = max(0, $consumo_continuo - $kwh_consumido);
$economia_reais = ($kwh_economizado * 0.85) + ($agua_economizada_l * 0.004);

// CO2 evitado (0.092 kg de CO2 por kWh solar vs rede fóssil)
$co2_evitado_kg = $kwh_economizado * 0.092;

echo json_encode([
    'talhoes'              => $state['talhoes'],
    'reservatorio'         => round($state['reservatorio'], 2),
    'bloqueio_emergencia'  => $state['bloqueio_emergencia'],
    'timestamp'            => date('c'),
    'historico'            => $state['historico'],
    'log_eventos'          => array_slice($state['log_eventos'], 0, 30),
    'clima'                => $state['clima'],
    'energia' => [
        'consumo_atual_kw'       => round($consumo_atual_kw, 1),
        'consumo_acumulado_kwh'  => round($state['energia']['consumo_acumulado_kwh'], 2),
        'economia_estimada_pct'  => max(0, $economia_pct),
        'uptime_s'               => round($uptime_s),
        'baterias'               => $state['energia']['baterias'] ?? 4,
        'tempo_descarga'         => $state['energia']['tempo_descarga'] ?? 120,
        'consumo_bomba'          => $state['energia']['consumo_bomba'] ?? POTENCIA_BOMBA_KW,
        'agua_economizada_l'     => round($agua_economizada_l, 0),
        'economia_reais'         => round($economia_reais, 2),
        'co2_evitado_kg'         => round($co2_evitado_kg, 2),
    ],
    'retificadoras'        => $state['retificadoras'] ?? [],
    'zabbix_problems'      => $state['zabbix_problems'] ?? [],
], JSON_UNESCAPED_UNICODE);


