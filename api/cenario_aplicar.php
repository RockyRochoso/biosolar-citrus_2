<?php
require_once __DIR__ . '/state.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $cenario = $input['cenario'] ?? 'normal';
    
    $state = load_state();
    
    switch ($cenario) {
        case 'seca':
            // Força Gatilho de Salvamento (umidade < 25%)
            foreach ($state['talhoes'] as $id => &$t) {
                $t['umidade'] = 22.0;
                $t['bomba'] = true;
                $t['critico'] = true;
            }
            unset($t);
            $state['clima'] = [
                'temperatura' => 41.5,
                'vento_kmh' => 24.0,
                'uv' => 11,
                'chance_chuva' => 0,
                'condicao' => 'ensolarado',
            ];
            add_log($state, 'critico', 'CENÁRIO ATIVADO: Onda de Calor & Seca Extrema — Gatilho de Salvamento forçado');
            break;

        case 'escassez':
            // Força Bloqueio de Emergência (reservatório < 15%)
            $state['reservatorio'] = 11.5;
            $state['bloqueio_emergencia'] = true;
            foreach ($state['talhoes'] as $id => &$t) {
                $t['bomba'] = false;
                $t['critico'] = false;
            }
            unset($t);
            add_log($state, 'emergencia', 'CENÁRIO ATIVADO: Escassez Hídrica Crítica — Bloqueio de Emergência acionado (<15%)');
            break;

        case 'tempestade':
            // Recarga rápida do reservatório e solo úmido
            $state['reservatorio'] = 94.0;
            $state['bloqueio_emergencia'] = false;
            foreach ($state['talhoes'] as $id => &$t) {
                $t['umidade'] = 88.0;
                $t['bomba'] = false;
                $t['critico'] = false;
            }
            unset($t);
            $state['clima'] = [
                'temperatura' => 22.0,
                'vento_kmh' => 38.0,
                'uv' => 1,
                'chance_chuva' => 95,
                'condicao' => 'tempestade',
            ];
            add_log($state, 'desbloqueio', 'CENÁRIO ATIVADO: Tempestade Tropical — Reservatório recarregado para 94%');
            break;

        case 'apagao':
            // Queda da retificadora e descarga do banco de baterias
            if (isset($state['retificadoras']['CPN-RTF-SMU02B'])) {
                $rtf = &$state['retificadoras']['CPN-RTF-SMU02B'];
                $rtf['status'] = 'OFF';
                $rtf['modulos']['rectifier1'] = 'OFF';
                $rtf['modulos']['rectifier2'] = 'OFF';
                $rtf['bateria_pct'] = 34.0;
                $rtf['tensao_ac_a'] = 0.0;
                $rtf['tensao_ac_b'] = 0.0;
                $rtf['corrente_dc_a'] = 0.0;
                $rtf['corrente_dc_b'] = 0.0;
                $rtf['tensao_dc'] = 47.8;
                unset($rtf);
            }
            add_log($state, 'emergencia', 'CENÁRIO ATIVADO: Falha Geral de Retificadora — Operando em Banco de Baterias');
            break;

        case 'normal':
        default:
            $state['reservatorio'] = 72.0;
            $state['bloqueio_emergencia'] = false;
            foreach ($state['talhoes'] as $id => &$t) {
                $t['umidade'] = 65.0;
                $t['bomba'] = false;
                $t['critico'] = false;
            }
            unset($t);
            $state['clima'] = [
                'temperatura' => 29.0,
                'vento_kmh' => 12.0,
                'uv' => 7,
                'chance_chuva' => 15,
                'condicao' => 'ensolarado',
            ];
            if (isset($state['retificadoras']['CPN-RTF-SMU02B'])) {
                $rtf = &$state['retificadoras']['CPN-RTF-SMU02B'];
                $rtf['status'] = 'UP';
                $rtf['modulos']['rectifier1'] = 'UP';
                $rtf['modulos']['rectifier2'] = 'UP';
                $rtf['modulos']['rectifier3'] = 'UP';
                $rtf['bateria_pct'] = 100.0;
                unset($rtf);
            }
            add_log($state, 'info', 'CENÁRIO ATIVADO: Condições Normais de Operação restauradas');
            break;
    }
    
    $state['last_update'] = microtime(true);
    save_state($state);
    
    echo json_encode([
        'sucesso' => true,
        'cenario' => $cenario,
        'msg' => "Cenário {$cenario} aplicado com sucesso"
    ]);
}
