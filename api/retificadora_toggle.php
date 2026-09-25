<?php
require_once __DIR__ . '/state.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $rtf_id = $input['retificadora'] ?? 'CPN-RTF-SMU02B';
    $modulo = $input['modulo'] ?? null;
    $status = $input['status'] ?? null; // 'UP' or 'OFF'
    
    $state = load_state();
    
    if (isset($state['retificadoras'][$rtf_id])) {
        if ($modulo && isset($state['retificadoras'][$rtf_id]['modulos'][$modulo])) {
            $state['retificadoras'][$rtf_id]['modulos'][$modulo] = $status;
            add_log($state, 'energia', "Módulo {$modulo} da retificadora {$rtf_id} alterado para {$status}");
        } elseif ($status) {
            $state['retificadoras'][$rtf_id]['status'] = $status;
            foreach ($state['retificadoras'][$rtf_id]['modulos'] as $m => $v) {
                $state['retificadoras'][$rtf_id]['modulos'][$m] = $status;
            }
            add_log($state, 'energia', "Retificadora {$rtf_id} alterada para {$status}");
        }
        
        save_state($state);
        echo json_encode(['sucesso' => true, 'retificadora' => $state['retificadoras'][$rtf_id]]);
        exit;
    }
    
    http_response_code(404);
    echo json_encode(['erro' => 'Retificadora não encontrada']);
}
