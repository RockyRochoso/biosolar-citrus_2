<?php
require_once __DIR__ . '/state.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $id = isset($input['talhao']) ? (string) $input['talhao'] : null;
    $imagem = isset($input['imagem']) ? (string) $input['imagem'] : null;
    
    if (!$id || !$imagem) {
        http_response_code(400);
        echo json_encode(['erro' => 'Parâmetros inválidos. Envie {"talhao": "1", "imagem": "url_ou_base64"}']);
        exit;
    }
    
    $state = load_state();
    
    if (!isset($state['talhoes'][$id])) {
        http_response_code(404);
        echo json_encode(['erro' => 'Talhão não encontrado']);
        exit;
    }
    
    $state['talhoes'][$id]['imagem'] = $imagem;
    
    $nome = $state['talhoes'][$id]['nome'];
    add_log($state, 'info', "Imagem/Planta Satélite atualizada para: " . $nome);
    
    save_state($state);
    
    echo json_encode(['sucesso' => true, 'id' => $id, 'msg' => "Imagem do talhão {$nome} atualizada"]);
}
