<?php
require_once __DIR__ . '/state.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $nome = $input['nome'] ?? 'Novo Talhão';
    
    $state = load_state();
    
    // Find next id
    $ids = array_keys($state['talhoes']);
    $next_id = empty($ids) ? 1 : max($ids) + 1;
    
    $state['talhoes'][(string)$next_id] = [
        'nome' => $nome,
        'umidade' => 100.0, // Começa cheio
        'bomba' => false,
        'critico' => false
    ];
    $state['historico']['talhoes'][(string)$next_id] = array_fill(0, count($state['historico']['timestamps']), 100.0);
    
    add_log($state, 'info', "Novo talhão adicionado: " . $nome);
    
    save_state($state);
    
    echo json_encode(['success' => true, 'id' => $next_id]);
}
