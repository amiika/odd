const SEQ='SEQ', CYC='CYC', CHO='CHO', SMP='SMP', CMD='CMD', OP='OP';

// --- FORMATTER ---
const format = (v) => {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.map(format).join(' ');
    if (v.val !== undefined) return format(v.val);
    if (typeof v === 'number') return parseFloat(v.toFixed(3));
    if (typeof v === 'string') return `"${v}"`;
    if (v.type === OP) return format(resolve(v));
    if (v.type === CMD) {
        const name = v.op === SMP ? 'play' : v.op.toLowerCase();
        return `${format(v.data)} ${name}`;
    }
    if (v.data) {
        const chars = { [SEQ]: '[]', [CYC]: '<>', [CHO]: '()' };
        const [open, close] = chars[v.type] || ['[', ']'];
        return `${open} ${v.data.map(format).join(' ')} ${close}`;
    }
    return '';
};

const DICT = {
    'sine': (c) => render(c, 'SINE'),
    'saw':  (c) => render(c, 'SAW'),
    'sqr':  (c) => render(c, 'SQR'),
    'tri':  (c) => render(c, 'TRI'),
    'play': (c) => render(c, SMP),
    'seq':   (c) => container(c, SEQ),
    'cycle': (c) => container(c, CYC),
    'chord': (c) => container(c, CHO),
    '[': (c) => c.stack.push({ type: SEQ, isMarker: true }),
    ']': (c) => closeGroup(c, SEQ),
    '<': (c) => c.stack.push({ type: CYC, isMarker: true }),
    '>': (c) => closeGroup(c, CYC),
    ':': macro,
    'dup':  (c) => { if (c.stack.length) c.stack.push(c.stack[c.stack.length-1]); },
    'drop': (c) => c.stack.pop(),
    'swap': (c) => { const a=c.stack.pop(), b=c.stack.pop(); c.stack.push(a, b); },
    'vol': (c) => { const v = resolve(c.stack.pop()); if(c.stack.length) c.stack[c.stack.length-1].gain = v; },
    'time': (c, t) => c.stack.push({ val: c.time, ranges: [t] }), 
    'bpm': (c) => { if(c.stack.length) c.bpm = resolve(c.stack.pop()); },
    '+': (c) => calc(c, (a,b)=>a+b),
    '-': (c) => calc(c, (a,b)=>a-b),
    '*': (c) => calc(c, (a,b)=>a*b),
};

function container(c, type) {
    const data = c.stack.splice(0).filter(x => !x.isMarker);
    const ranges = data.flatMap(x => x.ranges || [x]);
    c.stack.push({ type, data, idx: 0, ranges });
}

function render(c, type) {
    if (c.stack.length === 0) return;
    const data = c.stack.splice(0).filter(x => !x.isMarker);
    const pattern = data.length > 1 ? { type: SEQ, data } : data[0];
    
    if (c.isEval) {
        c.sounds.push({ type: CMD, op: type, data: pattern });
        return;
    }

    pattern.ranges = pattern.ranges || [pattern];
    if (type === SMP) scanSamples(c, pattern);
    c.sounds.push(new Sound(pattern, type));
}

function closeGroup(c, type) {
    let markerIdx = -1;
    for (let i = c.stack.length - 1; i >= 0; i--) {
        if (c.stack[i].isMarker && c.stack[i].type === type) { markerIdx = i; break; }
    }
    if (markerIdx === -1) return;
    const raw = c.stack.splice(markerIdx); 
    const data = raw.slice(1).filter(x => !x.isMarker);
    const ranges = data.flatMap(x => x.ranges || [x]);
    c.stack.push({ type, data, idx: 0, ranges });
}

function scanSamples(c, node) {
    if (!node) return;
    const val = node.val || node;
    if (typeof val === 'string' && !DICT[val]) c.req.add(val);
    else if (node.data) {
        if(Array.isArray(node.data)) node.data.forEach(n => scanSamples(c, n));
        else scanSamples(c, node.data);
    }
}

function extract(c) {
    let depth = 1, block = [];
    while (c.pos < c.tokens.length) {
        const t = c.tokens[c.pos++];
        if (t.val === 'do') depth++;
        if (t.val === 'loop') depth--;
        if (depth === 0) break;
        block.push(t);
    }
    return block;
}

function macro(c) {
    const nameToken = c.tokens[c.pos++];
    if (!nameToken) return;
    const body = [];
    while (c.pos < c.tokens.length) {
        const t = c.tokens[c.pos++];
        if (t.val === ';') break;
        body.push(t);
    }
    c.macros[nameToken.val] = body;
}

// FIX: Recursive Math Mapping now correctly isolates ranges per item
function calc(c, fn) {
    if (c.stack.length < 1) return;
    const b = c.stack.pop(), a = (fn.length > 1 && c.stack.length > 0) ? c.stack.pop() : undefined;

    // Helper to get ranges from a node, falling back to the node itself if it has source info
    const getRanges = (x) => x.ranges || (x.s !== undefined ? [x] : []);

    const map = (x, y) => {
        // Recurse into containers
        if (y?.data) return { ...y, data: y.data.map(i => map(x, i)) };
        if (x?.data) return { ...x, data: x.data.map(i => map(i, y)) };
        
        // Leaf Node: Merge only the ranges specific to this operation pair
        const ranges = [...getRanges(x), ...getRanges(y)];
        return { type: OP, fn, args: [x, y], ranges };
    };
    
    c.stack.push(map(a, b));
}

function resolve(node) {
    if (typeof node === 'number') return node;
    if (typeof node === 'string') return node;
    if (node?.val !== undefined) return node.val;
    if (node?.type === OP) return node.fn(resolve(node.args[0]), resolve(node.args[1]));
    return 0;
}

const RENDERERS = {
    'SINE': (p) => Math.sin(p * 6.28318),
    'TRI':  (p) => Math.abs((p % 1) * 4 - 2) - 1,
    'SAW':  (p) => (p % 1) * 2 - 1,
    'SQR':  (p) => (p % 1) < 0.5 ? 0.5 : -0.5,
    'SMP':  (p, buf) => buf ? ((Math.floor(p*buf.sr)<buf.len) ? buf.data[Math.floor(p*buf.sr)] : 0) : 0
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
        const ranges = node?.ranges || (node ? [node] : []);
        const g = (node.gain || 1.0) * gain;
        if (node?.type === SEQ) {
            const step = duration / (node.data.length || 1);
            for (const item of node.data) yield* this.visit(item, step, g);
            return;
        }
        if (node?.type === CYC) {
            if (node.data.length) yield* this.visit(node.data[node.idx++ % node.data.length], duration, g);
            return;
        }
        yield { nodes: [node], baseGain: g, dur: duration, ranges };
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
            if (e.data.type === 'sample') {
                this.samples[e.data.name] = e.data.buf;
            } else if (e.data.type === 'eval') {
                const ctx = this.runCode(e.data.code, true);
                const result = [...ctx.sounds, ...ctx.stack].map(format).join(' ');
                this.port.postMessage({ type: 'result', code: result });
            } else {
                const ctx = this.runCode(e.data);
                this.sounds = ctx.sounds;
                this.bpm = ctx.bpm;
                if (ctx.req.size) this.port.postMessage({ type: 'req', names: Array.from(ctx.req) });
            }
        };
    }

    runCode(text, isEval = false) {
        const regex = /"[^"]*"|#.*|[^\s\[\]<>()]+|[\[\]<>()]/g;
        const tokens = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
            if (!m[0].trim()) continue;
            tokens.push({ val: m[0], s: m.index, e: m.index + m[0].length });
        }
        const req = new Set();
        const ctx = { 
            tokens: tokens.filter(t => !t.val.startsWith('#')), 
            pos: 0, stack: [], loopStack: [], sounds: [], macros: {}, bpm: this.bpm, req, time: currentFrame/sampleRate,
            isEval: isEval 
        };
        ctx.run = (list) => {
            const saveT = ctx.tokens, saveP = ctx.pos;
            ctx.tokens = list; ctx.pos = 0;
            while (ctx.pos < ctx.tokens.length) {
                const t = ctx.tokens[ctx.pos++];
                const num = parseFloat(t.val);
                if (!isNaN(num) && !t.val.includes('"')) {
                    ctx.stack.push({ val: num, s: t.s, e: t.e });
                } else if (t.val.startsWith('"')) {
                    ctx.stack.push({ val: t.val.slice(1,-1), s: t.s, e: t.e });
                } else if (DICT[t.val]) {
                    DICT[t.val](ctx, t);
                } else if (ctx.macros[t.val]) {
                    ctx.run(ctx.macros[t.val]);
                } else {
                    ctx.stack.push(t);
                }
            }
            ctx.tokens = saveT; ctx.pos = saveP;
        };
        try { ctx.run(ctx.tokens); } catch(e) { console.error(e); }
        return ctx;
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
        const activeRanges = [];

        for (let i = 0; i < output.length; i++) {
            const absFrame = currentFrame + i;
            const beatNow = this.anchorBeat + (absFrame - this.anchorFrame) * beatsPerSample;
            let signal = 0;

            for (const snd of this.sounds) {
                if (snd.endTime === -1) snd.endTime = Math.floor(beatNow);

                while (beatNow >= snd.endTime) {
                    const next = snd.iter.next();
                    snd.curr = next.value;
                    snd.endTime += next.value.dur;
                    if (snd.curr) snd.voices = snd.curr.nodes.map(() => ({ p: 0 }));
                }

                if (i === 0 && snd.curr && snd.curr.ranges) {
                    activeRanges.push(...snd.curr.ranges);
                }

                if (!snd.curr) continue;

                for (let v = 0; v < snd.curr.nodes.length; v++) {
                    const node = snd.curr.nodes[v];
                    const voice = snd.voices[v];
                    const gain = snd.curr.baseGain;
                    const val = resolve(node);

                    if (snd.type === SMP) {
                        const key = (typeof val === 'string') ? val : (node.val || '');
                        if (this.samples[key]) {
                            signal += snd.renderFn(voice.p, this.samples[key]) * gain;
                            voice.p += (1/sampleRate);
                        }
                    } else if (val > 0) {
                        voice.p += (val / sampleRate);
                        signal += snd.renderFn(voice.p) * gain;
                    }
                }
            }
            output[i] = signal * 0.2;
        }

        if (activeRanges.length > 0) this.port.postMessage(activeRanges);
        return true;
    }
}
registerProcessor('fzrth-proc', ForthProcessor);