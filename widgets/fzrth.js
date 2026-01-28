const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function mount(parent, initialCode, processorCode) {
    parent.innerHTML = `
        <style>
            .fzrth-ui { display: flex; flex-direction: column; background: #000; border: 1px solid #320; height: 350px; position: relative; font-family: monospace; }
            .fzrth-header { padding: 10px; background: #111; border-bottom: 1px solid #320; display: flex; justify-content: space-between; align-items: center; }
            .fzrth-status { font-size: 11px; color: #666; cursor: pointer; letter-spacing: 1px; }
            .fzrth-status.active { color: #fb0; text-shadow: 0 0 5px #fb0; }
            .fzrth-editor-wrap { position: relative; flex: 1; overflow: hidden; }
            .fzrth-area, .fzrth-hl { 
                position: absolute; top:0; left:0; width:100%; height:100%; padding: 20px; 
                font-size: 18px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;
                box-sizing: border-box; border: none; outline: none; margin: 0; background: transparent;
                font-family: 'Courier New', monospace;
            }
            .fzrth-area { color: transparent; caret-color: #fff; z-index: 2; resize: none; }
            .fzrth-hl { color: #554422; z-index: 1; pointer-events: none; }
            .fzrth-hl .active { color: #fb0; text-shadow: 0 0 8px #fb0; font-weight: bold; }
        </style>
        <div class="fzrth-ui">
            <div class="fzrth-header">
                <span style="color:#fb0; font-weight:bold;">FZRTH</span>
                <div class="fzrth-status">CLICK TO START</div>
            </div>
            <div class="fzrth-editor-wrap">
                <div class="fzrth-hl"></div>
                <textarea class="fzrth-area" spellcheck="false">${initialCode}</textarea>
            </div>
        </div>
    `;

    const area = parent.querySelector('.fzrth-area');
    const hl = parent.querySelector('.fzrth-hl');
    const status = parent.querySelector('.fzrth-status');
    let ctx, node;

    const LOADER = {
        cache: {},
        map: null,
        async load(names, port, audioCtx) {
            if (!this.map) this.map = await fetch('https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/strudel.json').then(r=>r.json());
            
            for(const reqKey of names) {
                if (this.cache[reqKey]) continue;

                const [base, idxStr] = reqKey.split(':');
                const idx = idxStr ? parseInt(idxStr) : 0;
                
                const entry = this.map[base];
                if (!entry) { console.warn("Folder not found:", base); continue; }

                let path;
                if (Array.isArray(entry)) {
                    path = entry[idx] || entry[0];
                } else {
                    const values = Object.values(entry);
                    path = values[idx] || values[0];
                }
                
                if (!path) { console.warn("Sample not found:", reqKey); continue; }
                
                try {
                    const ab = await fetch('https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/' + path).then(r=>r.arrayBuffer());
                    const aud = await audioCtx.decodeAudioData(ab);
                    this.cache[reqKey] = true;
                    port.postMessage({ type: 'sample', name: reqKey, buf: { data: aud.getChannelData(0), sr: aud.sampleRate, len: aud.length }});
                } catch(e) { console.error("Sample load error:", e); }
            }
        }
    };

    function renderHighlights(ranges) {
        const text = area.value;
        if (!Array.isArray(ranges) || ranges.length === 0) {
            hl.innerHTML = esc(text).replace(/\n/g, '<br/>');
            return;
        }
        let html = '', lastPos = 0;
        ranges.filter(r => r.e > r.s).sort((a, b) => a.s - b.s).forEach(r => {
            if (r.s < lastPos) return;
            html += esc(text.substring(lastPos, r.s));
            html += `<span class="active">${esc(text.substring(r.s, r.e))}</span>`;
            lastPos = r.e;
        });
        html += esc(text.substring(lastPos));
        hl.innerHTML = html.replace(/\n/g, '<br/>') + (text.endsWith('\n') ? '<br/>&nbsp;' : '');
    }

    async function start() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Convert the string processorCode into a loadable Worklet module
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        
        try {
            await ctx.audioWorklet.addModule(url);
            node = new AudioWorkletNode(ctx, 'fzrth-proc');
            node.connect(ctx.destination);
            
            node.port.onmessage = (e) => {
                if (e.data.type === 'req') LOADER.load(e.data.names, node.port, ctx);
                else if (Array.isArray(e.data)) renderHighlights(e.data);
            };

            area.addEventListener('input', () => {
                node.port.postMessage(area.value);
                hl.innerHTML = esc(area.value).replace(/\n/g, '<br/>');
            });

            node.port.postMessage(area.value);
            status.innerText = "RUNNING";
            status.classList.add('active');
        } catch (err) {
            status.innerText = "ERROR";
            console.error(err);
        }
    }

    area.addEventListener('scroll', () => hl.scrollTop = area.scrollTop);
    hl.innerHTML = esc(area.value).replace(/\n/g, '<br/>');
    parent.addEventListener('click', start, { once: true });
}