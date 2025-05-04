import { updateLoad } from './instruments/load.js';
import { updatePowerSupply } from './instruments/powerSupply.js';
import { updateDMM } from './instruments/dmm.js';
import {formatDate} from "./utils/helpers.js";

const api = window.electronAPI;

function updateAgentStatus(status) {
    const agentIdElement = document.getElementById('statusAgentId');
    if (agentIdElement) {
        agentIdElement.innerText = status.agent_id || 'n/a';
    }
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.innerText = status.status.toUpperCase();
    }
    const timestampElement = document.getElementById('statusTimestamp');
    if (timestampElement) {
        timestampElement.innerText = formatDate(status.timestamp)
    }
}

function updateTestResults(resultData) {

    const resultElement = document.getElementById('result');

    if (resultElement) resultElement.innerText = `Result: ${resultData.result.charAt(0).toUpperCase() + resultData.result.slice(1)}`;
    resultElement.innerText = `Result: ${resultData.result.charAt(0).toUpperCase() + resultData.result.slice(1)}`;
    resultElement.classList.toggle('pass', resultData.result === 'pass');
    resultElement.classList.toggle('fail', resultData.result !== 'pass');

    // Update agent ID
    const agentIdElement = document.getElementById('agentId');
    if (agentIdElement) {
        agentIdElement.innerText = resultData.agent_id || 'n/a';
    }

    // Update task ID
    const taskIdElement = document.getElementById('taskId');
    if (taskIdElement) {
        taskIdElement.innerText = resultData.task_id || 'n/a';
    }


    // Update cycle number
    const cycleNumberElement = document.getElementById('cycleNumber');
    if (cycleNumberElement) {
        cycleNumberElement.innerText = resultData.cycle_number || 'n/a';
    }

    if (resultData.details.load) updateLoad(resultData.details.load);
    if (resultData.details.power_supply) updatePowerSupply(resultData.details.power_supply);
    if (resultData.details.dmm) updateDMM(resultData.details.dmm);
}

api.onStatus(updateAgentStatus);
api.onMeasurement(updateTestResults);
