const SEQ = 'SEQ', CYC = 'CYC', CHO = 'CHO';

const DICT = {
    'sine': (c) => render(c),
    'bpm': function(c) { c.bpm = c.stack.pop() || 120; },
    ':': macro,
    'dup':  (c) => { if (c.stack.length) c.stack.push(c.stack[c.stack.length-1]); },
    'drop': (c) => c.stack.pop(),
    'swap': (c) => { const a=c.stack.pop(), b=c.stack.pop(); c.stack.push(a, b); },
    '+': (c) => calc(c, (a,b)=>a+b),
    '-': (c) => calc(c, (a,b)=>a-b),
    '*': (c) => calc(c, (a,b)=>a*b),
    '/': (c) => calc(c, (a,b)=>a/b),
    '%': (c) => calc(c, (a,b)=>a%b),
    'seq':   (c) => { const d=c.stack.splice(0); c.stack.push({type:SEQ, data:d}); },
    'cycle': (c) => { const d=c.stack.splice(0); c.stack.push({type:CYC, data:d}); },
    'chord': (c) => { const d=c.stack.splice(0); c.stack.push({type:CHO, data:d}); },
};

function render(c) {
    const data = c.stack.splice(0);
    if (!data.length) return;
    const pattern = data.length > 1 ? { type: SEQ, data } : data[0];
    c.sounds.push({ pattern, phases: [] });
}

function macro(c, s) { 
    const name = s.shift(), body = [];
    while(s.length) { 
        const t = s.shift(); 
        if(t === ';') break; 
        body.push(t); 
    }
    c.dict[name] = (ctx) => this.run([...body], ctx);
}

const calc = (c, fn) => {
    if (c.stack.length < 2) return;
    const b = c.stack.pop(), a = c.stack.pop();
    const map = (x, y) => {
        if (typeof x === 'number' && typeof y === 'number') return fn(x, y);
        if (y?.data) return { ...y, data: y.data.map(i => map(x, i)) };
        if (x?.data) return { ...x, data: x.data.map(i => map(i, y)) };
        return { type: 'OP', fn, args: [x, y] };
    }
    c.stack.push(map(a, b));
};

class ForthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sounds = [];
        this.bpm = 120;
        this.lastBpm = 120;
        this.anchorFrame = 0;
        this.anchorBeat = 0;
        
        this.port.onmessage = (e) => this.interpret(e.data);
    }

    interpret(text) {
        const ctx = { stack: [], loopStack: [], sounds: [], bpm: this.bpm };      
        const tokens = text.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(x => x);
      
        ctx.dict = Object.create(DICT);

        try { this.run(tokens, ctx); } catch(e) {}

        ctx.sounds.forEach((s, i) => { 
            if (this.sounds[i]) s.phases = this.sounds[i].phases; 
        });

        this.sounds = ctx.sounds;
        this.bpm = ctx.bpm;
    }

    run(tokens, ctx) {
        while(tokens.length) {
            const t = tokens.shift();
            const n = parseFloat(t);
            if (!isNaN(n)) {
                ctx.stack.push(n);
            } else if (ctx.dict[t]) {
                ctx.dict[t].call(this, ctx, tokens);
            }
        }
    }

    process(inputs, outputs) {
        const out = outputs[0][0];
        if (!out) return true;

        if (this.bpm !== this.lastBpm) {
            const prevRate = this.lastBpm / (60 * sampleRate);
            const beatNow = this.anchorBeat + (currentFrame - this.anchorFrame) * prevRate;
            this.anchorBeat = beatNow;
            this.anchorFrame = currentFrame;
            this.lastBpm = this.bpm;
        }

        const beatsPerSample = this.bpm / (60 * sampleRate);

        for (let i = 0; i < out.length; i++) {
            const absFrame = currentFrame + i;
            const totalBeats = this.anchorBeat + (absFrame - this.anchorFrame) * beatsPerSample;
            
            const beatIndex = Math.floor(totalBeats);
            const beatPhase = totalBeats % 1; 

            let sig = 0;
            this.sounds.forEach(snd => {
                const freqs = this.getFreqs(snd.pattern, beatPhase, beatIndex);
                
                freqs.forEach((f, ch) => {
                    if(!snd.phases[ch]) snd.phases[ch]=0;
                    snd.phases[ch] += (f/sampleRate);
                    sig += Math.sin(snd.phases[ch] * 6.28318);
                });
                // Truncate phases if voice count drops (e.g. seq ending)
                if(snd.phases.length > freqs.length) snd.phases.length = freqs.length;
            });
            out[i] = sig * 0.15;
        }
        return true;
    }

    getFreqs(node, beatPhase, beatIndex) {
        if (typeof node === 'number') return [node];
        if (node.type === 'OP') return [node];
        
        if (node.type === CHO) {
            return node.data.flatMap(n => this.getFreqs(n, beatPhase, beatIndex));
        }
        if (node.type === SEQ) {
            if (!node.data.length) return [];
            const idx = Math.floor(beatPhase * node.data.length) % node.data.length;
            // Recursively scale phase for the child
            return this.getFreqs(node.data[idx], (beatPhase * node.data.length) % 1, beatIndex);
        }
        if (node.type === CYC) {
            if (!node.data.length) return [];
            const idx = beatIndex % node.data.length;
            return this.getFreqs(node.data[idx], beatPhase, beatIndex);
        }
        return [];
    }
}
registerProcessor('fzrth-proc', ForthProcessor);