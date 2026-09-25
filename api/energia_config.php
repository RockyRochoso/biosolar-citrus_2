<?php
require_once __DIR__ . '/state.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $state = load_state();
    
    if (isset($input['baterias'])) $state['energia']['baterias'] = (int)$input['baterias'];
    if (isset($input['tempo_descarga'])) $state['energia']['tempo_descarga'] = (int)$input['tempo_descarga'];
    if (isset($input['consumo_bomba'])) $state['energia']['consumo_bomba'] = (float)$input['consumo_bomba'];
    
    add_log($state, 'info', "Configurações de energia atualizadas.");
    
    save_state($state);
    
    echo json_encode(['success' => true]);
}
