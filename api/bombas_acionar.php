<?php
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/state.php';

$input  = json_decode(file_get_contents('php://input'), true);
$talhao = isset($input['talhao']) ? (string) $input['talhao'] : null;
$estado = isset($input['estado']) ? (bool)   $input['estado'] : null;

$state = load_state();
simulate($state);

if ($talhao === null || $estado === null || !isset($state['talhoes'][$talhao])) {
    http_response_code(400);
    echo json_encode(['erro' => 'Parâmetros inválidos. Envie {"talhao": "1", "estado": true}']);
    exit;
}

// Trava de Escassez: bloqueio de emergência impede acionamento manual
if ($state['bloqueio_emergencia'] && $estado === true) {
    http_response_code(423); // Locked
    echo json_encode([
        'erro'         => 'Bloqueio de Emergência ativo (reservatório abaixo de '
                        . LIMIAR_EMERGENCIA_RESERVATORIO . '%). '
                        . 'Acionamento manual de bombas bloqueado até recarga.',
        'reservatorio' => round($state['reservatorio'], 2),
    ]);
    save_state($state);
    exit;
}

$nome = $state['talhoes'][$talhao]['nome'];
$state['talhoes'][$talhao]['bomba'] = $estado;
if ($estado === false) {
    $state['talhoes'][$talhao]['critico'] = false;
}

// Registrar no log de eventos
$acao = $estado ? 'ligada' : 'desligada';
add_log($state, $estado ? 'bomba_on' : 'bomba_off',
    "Bomba do {$nome} {$acao} manualmente");

save_state($state);

echo json_encode(['sucesso' => true, 'talhao' => $talhao, 'bomba' => $estado]);
