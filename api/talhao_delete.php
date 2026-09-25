<?php
require_once __DIR__ . '/state.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $id = isset($input['talhao']) ? (string) $input['talhao'] : null;
    
    if (!$id) {
        http_response_code(400);
        echo json_encode(['erro' => 'ID do talhão não fornecido']);
        exit;
    }
    
    $state = load_state();
    
    if (!isset($state['talhoes'][$id])) {
        http_response_code(404);
        echo json_encode(['erro' => 'Talhão não encontrado']);
        exit;
    }
    
    $nome = $state['talhoes'][$id]['nome'];
    unset($state['talhoes'][$id]);
    
    if (isset($state['historico']['talhoes'][$id])) {
        unset($state['historico']['talhoes'][$id]);
    }
    
    add_log($state, 'info', "Talhão excluído: " . $nome);
    
    save_state($state);
    
    echo json_encode(['sucesso' => true, 'id' => $id, 'msg' => "Talhão {$nome} excluído com sucesso"]);
}
