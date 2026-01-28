export function mount(container, _ignoredCode, processorSource) {
    // 1. Build UI
    // Note: We use absolute positioning within the relative container
    container.style.height = '400px'; 
    container.style.overflow = 'hidden';
    container.style.cursor = 'crosshair';
    
    container.innerHTML = `
        <div class="overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); z-index: 10; cursor: pointer;">
            <div style="text-align:center">
                <h1 style="margin:0; text-shadow: 0 0 10px #0f0; color:#0f0">CLICK TO START</h1>
                <p style="color:#888; margin:5px 0">Pitch Space Prototype</p>
            </div>
        </div>
        <div class="info" style="position: absolute; top: 10px; left: 10px; pointer-events: none; font-size: 16px; background: rgba(0,0,0,0.5); padding: 5px; color: #0f0;">0 Hz</div>
        <canvas style="display: block; width: 100%; height: 100%;"></canvas>
    `;

    const canvas = container.querySelector('canvas');
    const overlay = container.querySelector('.overlay');
    const info = container.querySelector('.info');
    const ctx = canvas.getContext('2d');
    
    let width, height;
    let audioCtx, synthNode, gainNode;
    let isPlaying = false;
    let lx = 0, ly = 0;
    const MIN_FREQ = 20, MAX_FREQ = 20000;

    // 2. Logic
    const resize = () => {
        width = canvas.width = container.clientWidth;
        height = canvas.height = container.clientHeight;
    };
    // ResizeObserver is better for widgets than window.onresize
    new ResizeObserver(resize).observe(container);
    // Initial size
    setTimeout(resize, 0);

    const getSpatialFreq = (x, y) => {
        const totalOctaves = Math.log2(MAX_FREQ / MIN_FREQ); 
        const ratio = width / height;
        const octavesY = totalOctaves / (ratio + 1);
        const octavesX = totalOctaves - octavesY;
        const normX = x / width;
        const normY = (height - y) / height;
        const octaveOffset = (octavesX * normX) + (octavesY * normY);
        return MIN_FREQ * Math.pow(2, octaveOffset);
    };

    const updateAudio = (x, y, timeConstant = 0.05) => {
        if (!synthNode) return;
        const freq = getSpatialFreq(x, y);
        info.innerText = Math.round(freq) + " Hz";
        synthNode.parameters.get('freq').setTargetAtTime(freq, audioCtx.currentTime, timeConstant);
    };

    const animate = () => {
        if(!audioCtx) return; // Stop animation if not running
        requestAnimationFrame(animate);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, width, height);
    };

    const init = async () => {
        if (audioCtx) return;
        
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const blob = new Blob([processorSource], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            await audioCtx.audioWorklet.addModule(url);
            
            synthNode = new AudioWorkletNode(audioCtx, 'sine-synth'); // Expects 'sine-synth'
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 0;
            
            synthNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            overlay.style.display = 'none';
            animate();
        } catch (e) {
            console.error(e);
            info.innerText = "Error loading AudioWorklet";
            info.style.color = "red";
        }
    };

    // 3. Interaction
    const start = (x, y) => {
        if (!audioCtx) return;
        isPlaying = true;
        lx = x; ly = y;
        updateAudio(lx, ly, 0.001);
        gainNode.gain.setTargetAtTime(0.5, audioCtx.currentTime, 0.02);
    };

    const move = (x, y) => {
        if (!isPlaying) return;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(x, y);
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#0f0';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.shadowBlur = 0;
        lx = x; ly = y;
        updateAudio(lx, ly);
    };

    const end = () => {
        if (!gainNode) return;
        isPlaying = false;
        gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    };

    overlay.addEventListener('click', init);
    
    // Bind generic events to container
    container.addEventListener('mousedown', e => start(e.offsetX, e.offsetY));
    container.addEventListener('mousemove', e => move(e.offsetX, e.offsetY));
    container.addEventListener('mouseup', end);
    container.addEventListener('mouseleave', end);
}