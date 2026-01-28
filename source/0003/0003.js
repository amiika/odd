const SEQ='SEQ', CYC='CYC', CHO='CHO', SMP='SMP';

const DICT = {
    'sine': (c) => render(c, 'SINE'),
    'tri':  (c) => render(c, 'TRI'),
    'saw':  (c) => render(c, 'SAW'),
    'sqr':  (c) => render(c, 'SQR'),
    'play': (c) => render(c, SMP),
    'seq':   (c) => container(c, SEQ),
    'cycle': (c) => container(c, CYC),
    'chord': (c) => container(c, CHO),
    '[': (c) => c.stack.push(SEQ), ']': (c) => closeGroup(c, SEQ),
    '<': (c) => c.stack.push(CYC), '>': (c) => closeGroup(c, CYC),
    '(': (c) => c.stack.push(CHO), ')': (c) => closeGroup(c, CHO),
    ':': macro,
    'dup':  (c) => { if (c.stack.length) c.stack.push(c.stack[c.stack.length-1]); },
    'drop': (c) => c.stack.pop(),
    'swap': (c) => { const a=c.stack.pop(), b=c.stack.pop(); c.stack.push(a, b); },
    'bpm': (c) => { if(c.stack.length) c.bpm = resolve(c.stack.pop()); },
    '+': (c) => calc(c, (a,b)=>a+b),
    '-': (c) => calc(c, (a,b)=>a-b),
    '*': (c) => calc(c, (a,b)=>a*b),
    '/': (c) => calc(c, (a,b)=>a/b),
    '%': (c) => calc(c, (a,b)=>a%b),
};

function render(c, type) {
    if (c.stack.length === 0) return;
    const data = c.stack.splice(0);
    const pattern = data.length > 1 ? { type: SEQ, data } : data[0];
    if (type === SMP) scanSamples(c, pattern);
    c.sounds.push(new Sound(pattern, type));
}

function container(c, type) {
    const data = c.stack.splice(0);
    c.stack.push({ type, data, idx: 0 });
}

function closeGroup(c, marker) {
    const tmp = [];
    while (c.stack.length) {
        const item = c.stack.pop();
        if (item === marker) {
            c.stack.push({ type: marker, data: tmp.reverse(), idx: 0 });
            return;
        }
        tmp.push(item);
    }
}

function scanSamples(c, node) {
    if (!node) return;
    if (typeof node === 'string') c.req.add(node);
    else if (node.data) {
        if(Array.isArray(node.data)) node.data.forEach(n => scanSamples(c, n));
        else scanSamples(c, node.data);
    }
}

function macro(c) {
    const name = c.tokens[c.pos++];
    const body = [];
    while (c.pos < c.tokens.length) {
        const t = c.tokens[c.pos++];
        if (t === ';') break;
        body.push(t);
    }
    c.macros[name] = body;
}

function calc(c, fn) {
    if (c.stack.length < 1) return;
    const b = c.stack.pop();
    const a = (fn.length > 1 && c.stack.length > 0) ? c.stack.pop() : undefined;
    const map = (x, y) => {
        if (y?.data) return { ...y, data: y.data.map(i => map(x, i)) };
        if (x?.data) return { ...x, data: x.data.map(i => map(i, y)) };
        return { type: 'OP', fn, args: [x, y] };
    };
    c.stack.push(map(a, b));
}

function resolve(node) {
    if (typeof node === 'number') return node;
    if (typeof node === 'string') return node;
    if (!node) return 0;
    if (node.type === 'OP') return node.fn(resolve(node.args[0]), resolve(node.args[1]));
    return 0;
}

const RENDERERS = {
    'SINE': (p) => Math.sin(p * 6.28318),
    'TRI':  (p) => Math.abs((p % 1) * 4 - 2) - 1,
    'SAW':  (p) => (p % 1) * 2 - 1,
    'SQR':  (p) => (p % 1) < 0.5 ? 0.5 : -0.5,
    'SMP':  (p, buf) => {
        if (!buf) return 0;
        const idx = Math.floor(p * buf.sr);
        return (idx >= 0 && idx < buf.len) ? buf.data[idx] : 0;
    }
};

class Sound {
    constructor(pattern, type) {
        this.pattern = pattern;
        this.type = type;
        this.renderFn = RENDERERS[type];
        this.iter = this.makeIterator();
        this.endTime = -1;
        this.voices = [];
        this.curr = null;
    }

    *makeIterator() { while(true) yield* this.visit(this.pattern, 1.0, 1.0); }

    *visit(node, duration, gain) {
        if (node?.type === SEQ) {
            const step = duration / (node.data.length || 1);
            for (const item of node.data) yield* this.visit(item, step, gain);
            return;
        }
        if (node?.type === CYC) {
            if (node.data.length) yield* this.visit(node.data[node.idx++ % node.data.length], duration, gain);
            return;
        }
        if (node?.type === CHO) {
            const flatten = (n) => {
                if (n?.type === SEQ || n?.type === CHO || n?.type === CYC) return n.data.flatMap(flatten);
                return [n];
            };
            const allNotes = node.data.flatMap(flatten);
            yield { nodes: allNotes, baseGain: gain, dur: duration };
            return;
        }
        yield { nodes: [node], baseGain: gain, dur: duration };
    }
}

class ForthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sounds = [];
        this.samples = {};
        this.bpm = 120;
        
        this.lastBpm = 120;
        this.anchorFrame = 0;
        this.anchorBeat = 0;
        
        this.port.onmessage = (e) => {
            if (e.data.type === 'sample') this.samples[e.data.name] = e.data.buf;
            else this.compile(e.data);
        };
    }

    compile(text) {
        const tokens = text.match(/"[^"]*"|#.*|[^\s\[\]<>()]+|[\[\]<>()]/g) || [];
        const sampleRequests = new Set();
        const ctx = { 
            tokens: tokens.filter(t => !t.startsWith('#')), 
            pos: 0, 
            stack: [],
            sounds: [], 
            macros: {}, 
            bpm: this.bpm, 
            req: sampleRequests 
        };

        ctx.run = (list) => {
            const saveT = ctx.tokens, saveP = ctx.pos;
            ctx.tokens = list; ctx.pos = 0;
            while (ctx.pos < ctx.tokens.length) {
                const t = ctx.tokens[ctx.pos++];
                const num = parseFloat(t);
                
                if (!isNaN(num) && !t.includes(':')) {
                    ctx.stack.push(num);
                }
                else if (DICT[t]) DICT[t](ctx);
                else if (ctx.macros[t]) ctx.run(ctx.macros[t]);
                else ctx.stack.push(t);
            }
            ctx.tokens = saveT; ctx.pos = saveP;
        };

        try { ctx.run(ctx.tokens); } catch(e) {}
        this.sounds = ctx.sounds;
        this.bpm = ctx.bpm;
        if (sampleRequests.size) this.port.postMessage({ type: 'req', names: Array.from(sampleRequests) });
    }

    process(inputs, outputs) {
        const output = outputs[0][0];
        if (!output) return true;

        if (this.bpm !== this.lastBpm) {
            const prevRate = this.lastBpm / (60 * sampleRate);
            const beatNow = this.anchorBeat + (currentFrame - this.anchorFrame) * prevRate;
            this.anchorBeat = beatNow;
            this.anchorFrame = currentFrame;
            this.lastBpm = this.bpm;
        }

        const beatsPerSample = this.bpm / (60 * sampleRate);

        for (let i = 0; i < output.length; i++) {
            const absFrame = currentFrame + i;
            const beatNow = this.anchorBeat + (absFrame - this.anchorFrame) * beatsPerSample;
            
            let signal = 0;

            for (const snd of this.sounds) {
                if (snd.endTime === -1) {
                    snd.endTime = Math.floor(beatNow);
                }

                while (beatNow >= snd.endTime) {
                    const next = snd.iter.next();
                    snd.curr = next.value;
                    snd.endTime += next.value.dur;
                    if (snd.curr) {
                        snd.voices = snd.curr.nodes.map(() => ({ p: 0 }));
                    }
                }

                if (!snd.curr) continue;

                for (let v = 0; v < snd.curr.nodes.length; v++) {
                    const node = snd.curr.nodes[v];
                    const voice = snd.voices[v];
                    const gain = snd.curr.baseGain;
                    const val = resolve(node);

                    if (snd.type === SMP) {
                        if (typeof val === 'string' && this.samples[val]) {
                            signal += snd.renderFn(voice.p, this.samples[val]) * gain;
                            voice.p += (1/sampleRate);
                        }
                    } else {
                        if (val > 0) {
                            voice.p += (val / sampleRate);
                            signal += snd.renderFn(voice.p) * gain;
                        }
                    }
                }
            }
            output[i] = signal * 0.2;
        }
        return true;
    }
}
registerProcessor('fzrth-proc', ForthProcessor);