<?php
// Uso: php -S localhost:8000 -t public router.php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($uri === '/telemetria' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require __DIR__ . '/api/telemetria.php';
    return true;
}

if ($uri === '/bombas/acionar' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require __DIR__ . '/api/bombas_acionar.php';
    return true;
}

// Reset da simulação (útil para demo em competição)
if ($uri === '/reset' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require __DIR__ . '/api/state.php';
    $state = default_state();
    save_state($state);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['sucesso' => true, 'msg' => 'Simulação reiniciada']);
    return true;
}

if ($uri === '/energia_config' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require __DIR__ . '/api/energia_config.php';
    return true;
}

if ($uri === '/talhao_add' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require __DIR__ . '/api/talhao_add.php';
    return true;
}

return false; // servidor embutido serve os estáticos de /public
