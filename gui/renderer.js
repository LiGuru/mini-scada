// Получаваме API методите от preload.js
const api = window.electronAPI;

// Получаваме DOM елементи, в които ще рендерираме статусите и резултатите
const statusLine = document.getElementById('status');
const resultsContainer = document.getElementById('measurementResults');

// Функция за обновяване на състоянието на агента
function updateAgentStatus(status) {
    console.log('Received agent status:', status);

    statusLine.innerText = `Status: ${status.status.charAt(0).toUpperCase() + status.status.slice(1)}`;
    const statusElement = document.getElementById('status');
    if (status.status === 'ready') {
        statusElement.classList.add('ready');
        statusElement.classList.remove('failed');
    } else {
        statusElement.classList.add('failed');
        statusElement.classList.remove('ready');
    }

    // Обновяваме времето на последната актуализация
    document.getElementById('statusTimestamp').innerText = status.timestamp || 'n/a';
}

// Функция за обновяване на резултатите от теста
function updateTestResults(resultData) {
    console.log('Received test results:', resultData);

    document.getElementById('result').innerText = `Result: ${resultData.result.charAt(0).toUpperCase() + resultData.result.slice(1)}`;
    document.getElementById('agentId').innerText = resultData.agent_id || 'n/a';
    document.getElementById('taskId').innerText = resultData.task_id || 'n/a';
    document.getElementById('cycleNumber').innerText = resultData.cycle_number || 'n/a';

    const resultElement = document.getElementById('result');
    if (resultData.result === 'pass') {
        resultElement.classList.add('pass');
        resultElement.classList.remove('fail');
    } else {
        resultElement.classList.add('fail');
        resultElement.classList.remove('pass');
    }

    // Обновяване на измерванията
    document.getElementById('temperature').innerText = resultData.details.temperature ? `${resultData.details.temperature}°C` : 'n/a';
    document.getElementById('current').innerText = resultData.details.current ? `${resultData.details.current} A` : 'n/a';
    document.getElementById('voltage').innerText = resultData.details.voltage ? `${resultData.details.voltage} V` : 'n/a';
    document.getElementById('measuredAt').innerText = resultData.details.measured_at || 'n/a';
}

// Слушаме за събитие 'gui_status' от main процеса чрез preload
api.onStatus(updateAgentStatus);

// Слушаме за събитие 'gui_results' от main процеса чрез preload
api.onMeasurement(updateTestResults);
