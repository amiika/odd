export function mount(container, initialCode, processorSource) {
    // 1. Build UI
    container.innerHTML = `
        <div style="padding: 15px; background: var(--code-bg); border: 1px solid var(--border);">
            
            <div style="display: flex; gap: 20px; margin-bottom: 15px; font-size: 12px; color: var(--text);">
                <div style="flex: 1;">
                    <div style="margin-bottom: 5px;">SPEED: <span class="speed-val">0.18</span></div>
                    <input type="range" class="speed-slider" min="0.01" max="5.0" step="0.01" value="0.18" style="width: 100%; accent-color: var(--text);">
                </div>
                <div style="flex: 1;">
                    <div style="margin-bottom: 5px;">VOLUME: <span class="vol-val">50%</span></div>
                    <input type="range" class="vol-slider" min="0" max="1" step="0.01" value="0.5" style="width: 100%; accent-color: var(--text);">
                </div>
            </div>

            <textarea style="width: 100%; height: 60px; background: var(--bg); color: var(--text); border: 1px solid var(--dim-text); font-family: monospace; padding: 10px; box-sizing: border-box; resize: vertical; outline: none; margin-bottom: 10px;" spellcheck="false"></textarea>
            
            <div style="display: flex; justify-content: flex-end;">
                <button class="toggle-btn" style="border: 1px solid var(--text); padding: 5px 20px;">EXECUTE</button>
            </div>
        </div>
    `;

    // 2. Select Elements
    const textarea = container.querySelector('textarea');
    const btn = container.querySelector('.toggle-btn');
    const speedSlider = container.querySelector('.speed-slider');
    const volSlider = container.querySelector('.vol-slider');
    const speedDisplay = container.querySelector('.speed-val');
    const volDisplay = container.querySelector('.vol-val');

    // Decode HTML entities
    textarea.value = (window.he ? he.decode(initialCode) : initialCode).trim();

    // 3. Audio Logic
    let audioCtx = null;
    let workletNode = null;
    let isPlaying = false;

    const initAudio = async () => {
        if (audioCtx) return;
        
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Use the passed processor source code
        const blob = new Blob([processorSource], { type: 'application/javascript' });
        await audioCtx.audioWorklet.addModule(URL.createObjectURL(blob));

        workletNode = new AudioWorkletNode(audioCtx, 'bytebeat-processor');
        workletNode.connect(audioCtx.destination);

        // Send Initial Code
        workletNode.port.postMessage({ code: textarea.value });
        updateParams();
    };

    const updateParams = () => {
        const s = parseFloat(speedSlider.value);
        const v = parseFloat(volSlider.value);
        
        speedDisplay.innerText = s.toFixed(2);
        volDisplay.innerText = Math.round(v * 100) + '%';

        if (workletNode) {
            workletNode.parameters.get('speed').setValueAtTime(s, audioCtx.currentTime);
            if (isPlaying) {
                // Square volume for more natural curve
                workletNode.parameters.get('volume').setTargetAtTime(v * v, audioCtx.currentTime, 0.1);
            }
        }
    };

    const toggle = async () => {
        if (!audioCtx) await initAudio();
        
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        const v = parseFloat(volSlider.value);
        const volParam = workletNode.parameters.get('volume');
        const now = audioCtx.currentTime;

        if (isPlaying) {
            // Fade out
            volParam.setTargetAtTime(0, now, 0.1);
            btn.innerText = "EXECUTE";
            isPlaying = false;
        } else {
            // Update code and Fade in
            workletNode.port.postMessage({ code: textarea.value });
            volParam.setTargetAtTime(v * v, now, 0.1);
            btn.innerText = "TERMINATE";
            isPlaying = true;
        }
    };

    // 4. Event Listeners
    btn.onclick = toggle;
    speedSlider.oninput = updateParams;
    volSlider.oninput = updateParams;
    
    // Live code update while playing
    textarea.oninput = () => {
        if (workletNode && isPlaying) {
            workletNode.port.postMessage({ code: textarea.value });
        }
    };
}