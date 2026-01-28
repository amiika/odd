const SEQ='SEQ', CYC='CYC', CHO='CHO', SMP='SMP';
const SEL='SEL', SPEED='SPEED', VOL='VOL', CMD='CMD', OP='OP';
const MARKERS = [SEQ, CYC, CHO, SEL, SPEED, VOL, CMD, OP];

const DICT = {
    // GENERATORS
    'sine': (c) => compile(c, 'SINE'),
    'saw':  (c) => compile(c, 'SAW'),
    'sqr':  (c) => compile(c, 'SQR'),
    'tri':  (c) => compile(c, 'TRI'),
    'noise':(c) => compile(c, 'NOISE'),
    'play': (c) => compile(c, SMP),
    'raw': (c) => compile(c, 'RAW'),
    'seq':   (c, t) => container(c, t, SEQ),
    'cycle': (c, t) => container(c, t, CYC),
    'chord': (c, t) => container(c, t, CHO),
    '[': (c, t) => c.stack.push({ type: SEQ, isMarker: true }),
    ']': (c, t) => closeGroup(c, SEQ),
    '<': (c, t) => c.stack.push({ type: CYC, isMarker: true }),
    '>': (c, t) => closeGroup(c, CYC),
    '(': (c, t) => c.stack.push({ type: CHO, isMarker: true }),
    ')': (c, t) => closeGroup(c, CHO),
    ':': macro,
    'dup':  (c) => { if (c.stack.length) c.stack.push(c.stack[c.stack.length-1]); },
    'drop': (c) => c.stack.pop(),
    'swap': (c) => { const a=c.stack.pop(), b=c.stack.pop(); c.stack.push(a, b); },
    'vol': (c, t) => adjustVolume(c, t),
    'speed': (c, t) => changeSpeed(c, t),
    'bpm': (c) => { if(c.stack.length) c.bpm = resolve(c.stack.pop()); },
    't': (c, t) => c.stack.push({ type: 'VAR', name: 't', ranges: [t] }),
    'time': (c, t) => c.stack.push({ type: 'VAR', name: 'time', ranges: [t] }),
    'beat': (c, t) => c.stack.push({ type: 'VAR', name: 'beat', ranges: [t] }),
    '+': (c, t) => calc(c, t, (a,b)=>a+b),
    '-': (c, t) => calc(c, t, (a,b)=>a-b),
    '*': (c, t) => calc(c, t, (a,b)=>a*b),
    '/': (c, t) => calc(c, t, (a,b)=>a/b),
    '%': (c, t) => calc(c, t, (a,b)=>a%b),
    'and': (c, t) => calc(c, t, (a,b)=>a&b),
    'or':  (c, t) => calc(c, t, (a,b)=>a|b),
    'xor': (c, t) => calc(c, t, (a,b)=>a^b),
    'rshift': (c, t) => calc(c, t, (a,b)=>a>>b),
    'lshift': (c, t) => calc(c, t, (a,b)=>a<<b),
    'sin': (c, t) => calc(c, t, Math.sin, 1),
    'cos': (c, t) => calc(c, t, Math.cos, 1),
    'pow': (c, t) => calc(c, t, Math.pow),
};

function adjustVolume(c, t) {
    const amt = c.stack.pop(); 
    if(c.stack.length) {
        const data = c.stack.pop();
        const ranges = [t, ...(amt?.ranges||[])]; 
        c.stack.push({ type: VOL, amount: amt, data, ranges });
    }
}

function changeSpeed(c, t) {
    const amt = c.stack.pop();
    const data = c.stack.pop();
    const ranges = [t, ...(amt?.ranges||[])];
    c.stack.push({ type: SPEED, amount: amt, data, ranges });
}

function container(c, tToken, type) {
    const data = c.stack.splice(0).filter(x => !x.isMarker);
    c.stack.push({ type, data, idx: 0 }); 
}

function closeGroup(c, type) {
    let markerIdx = -1;
    for (let i = c.stack.length - 1; i >= 0; i--) {
        if (c.stack[i].isMarker && c.stack[i].type === type) { markerIdx = i; break; }
    }
    if (markerIdx === -1) return;
    const raw = c.stack.splice(markerIdx); 
    const data = raw.slice(1).filter(x => !x.isMarker);
    c.stack.push({ type, data, idx: 0 });
}

function compile(c, type) {
    if (c.stack.length === 0) return;
    const data = c.stack.splice(0).filter(x => !x.isMarker);
    
    // Implicit sequences get NO ranges of their own
    const pattern = data.length > 1 
        ? { type: SEQ, data, idx: 0 } 
        : data[0];
        
    if (c.isEval) { c.sounds.push({ type: CMD, op: type, data: pattern }); return; }
    
    // Ensure root pattern has ranges if missing (for highlighting single nodes)
    if (!pattern.ranges && pattern.s !== undefined) pattern.ranges = [pattern];
    
    if (type === SMP) scanSamples(c, pattern);
    
    try {
        c.sounds.push(new Sound(pattern, type));
    } catch(e) { console.error(e); }
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

const format = (v) => {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.map(format).join(' ');
    if (v.val !== undefined) return format(v.val);
    if (typeof v === 'number') return parseFloat(v.toFixed(3));
    if (typeof v === 'string') return `"${v}"`;
    if (v.type === OP) return format(resolve(v, {beat:0, time:0, t:0}));
    if (v.type === CMD) return `${format(v.data)} ${v.op === SMP ? 'play' : v.op.toLowerCase()}`;
    if (v.type === 'VAR') return v.name; 
    if (v.data) {
        const c = { [SEQ]:'[]', [CYC]:'<>', [CHO]:'()' }, w = c[v.type]||['[',']'];
        return w[0] + ' ' + v.data.map(format).join(' ') + ' ' + w[1];
    }
    return '';
};

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

// --- MATH (Robust & Safe) ---
function calc(c, tToken, fn, argc = 2) {
    if (c.stack.length < argc) return;
    const args = [];
    for(let i=0; i<argc; i++) args.unshift(c.stack.pop());
    
    if (args.some(a => a && a.isMarker)) return;

    const getRanges = (x) => x?.ranges || (x?.s !== undefined ? [x] : []);

    const deep = (...vals) => {
        const idx = vals.findIndex(v => (v?.type === SEQ || v?.type === CHO) && Array.isArray(v.data));
        
        if (idx !== -1) {
            const nested = vals[idx];
            return {
                ...nested,
                data: nested.data.map(item => {
                    const nextArgs = [...vals];
                    nextArgs[idx] = item;
                    return deep(...nextArgs);
                })
            };
        }
        
        // Guard against corrupt nodes
        if (vals.some(v => v && typeof v === 'object' && !v.type && !v.val && !v.data)) {
            return { type: OP, fn, args: [], ranges: [] };
        }

        const ranges = [];
        vals.forEach(v => {
            const r = getRanges(v);
            for(let i=0; i<r.length; i++) ranges.push(r[i]);
        });
        if (tToken) ranges.push(tToken);
        
        return { type: OP, fn, args: vals, ranges };
    };
    c.stack.push(deep(...args));
}

function resolve(node, env = {}) {
    if (typeof node === 'number') return node;
    if (typeof node === 'string') return node;
    if (!node) return 0;
    if (node.val !== undefined) return node.val;
    if (node.type === 'VAR') return env[node.name] || 0;
    
    if (node.type === CYC) {
        if (!node.data || !node.data.length) return 0;
        const idx = Math.floor(env.beat) % node.data.length;
        return resolve(node.data[idx], env);
    }

    if (node.type === OP) {
        if (!node.args) return 0;
        const args = node.args.map(a => resolve(a, env));
        return node.fn(...args);
    }
    return 0;
}

const RENDERERS = {
    'SINE': (p) => Math.sin(p * 6.28318),
    'TRI':  (p) => Math.abs((p % 1) * 4 - 2) - 1,
    'SAW':  (p) => (p % 1) * 2 - 1,
    'SQR':  (p) => (p % 1) < 0.5 ? 0.5 : -0.5,
    'NOISE':(p) => Math.random() * 2 - 1,
    'RAW':  (p) => p, 
    'SMP':  (p, buf) => buf ? ((Math.floor(p*buf.sr)<buf.len) ? buf.data[Math.floor(p*buf.sr)] : 0) : 0
};

// --- AUDIO CLASSES ---

class Track {
    constructor(iterator) {
        this.iter = iterator;
        this.curr = null;   
        this.done = false;
        this.rem = 0;       
        this.pull();
    }
    pull() {
        const res = this.iter.next();
        if (res.done) { this.done = true; this.curr = null; this.rem = 0; }
        else { this.curr = res.value; this.rem = res.value.dur; }
    }
}

class Sound {
    constructor(pattern, type) {
        this.pattern = pattern;
        this.waveType = type;
        this.renderFn = RENDERERS[type];
        this.signature = JSON.stringify(pattern, (k, v) => (k==='s'||k==='e'||k==='ranges'||k==='idx') ? undefined : v) + ':' + type;
        this.iter = this.makeIterator();
        this.endTime = -1;
        this.voices = [];
        this.curr = null;
        this.env = { t: 0, time: 0, beat: 0 }; 
    }
    *makeIterator() { while(true) yield* this.visit(this.pattern, 1.0, 1.0); }
    
    // Digs into Math/Cycles to find active visualization ranges
    collectRanges(node, list) {
        if (!node) return;
        const ranges = node.ranges || (node.s !== undefined ? [node] : []);
        for(let i=0; i<ranges.length; i++) list.push(ranges[i]);
        
        if (node.type === OP) {
            for(let i=0; i<node.args.length; i++) this.collectRanges(node.args[i], list);
        }
        else if (node.type === CYC && node.data && node.data.length > 0) {
            const idx = Math.floor(this.env.beat) % node.data.length;
            this.collectRanges(node.data[idx], list);
        }
    }

    *visit(node, duration, gain) {
        if (!node || (node.isMarker && !node.data)) { yield { nodes:[], gains:[], dur:duration }; return; }

        const ranges = node.ranges || (node.s !== undefined ? [node] : []);
        const g = (node.gain || 1.0) * gain;

        const yieldWith = function*(iter) {
            for (const step of iter) {
                const active = [];
                // Merge Parent Ranges
                if (step.ranges) for(let i=0; i<step.ranges.length; i++) active.push(step.ranges[i]);
                if (ranges) for(let i=0; i<ranges.length; i++) active.push(ranges[i]);
                
                // Inspect leaf nodes for hidden cycles in math
                if (step.nodes) {
                    for(let i=0; i<step.nodes.length; i++) this.collectRanges(step.nodes[i], active);
                }
                
                yield { ...step, ranges: active };
            }
        }.bind(this);
        
        if (node.type === SEQ) {
            if (!node.data.length) { yield { nodes:[], gains:[], dur:duration, ranges }; return; }
            const step = duration / node.data.length;
            // OPTIMIZATION: If seq has no ranges (implicit), skip wrapper
            if (!ranges.length) {
                for (const item of node.data) yield* this.visit(item, step, g);
            } else {
                for (const item of node.data) yield* yieldWith(this.visit(item, step, g));
            }
            return;
        }
        
        if (node.type === CYC) {
            if (!node.data.length) { yield { nodes:[], gains:[], dur:duration, ranges }; return; }
            // OPTIMIZATION: Direct yield if no parent ranges
            if (!ranges.length) {
                yield* this.visit(node.data[node.idx++ % node.data.length], duration, g);
            } else {
                yield* yieldWith(this.visit(node.data[node.idx++ % node.data.length], duration, g));
            }
            return;
        }
        
        if (node.type === CHO) {
            if (!node.data.length) { yield { nodes:[], gains:[], dur:duration, ranges }; return; }
            const tracks = node.data.map(item => new Track(this.visit(item, duration, g)));
            while (tracks.some(t => !t.done)) {
                const active = tracks.filter(t => !t.done);
                if (!active.length) break;
                
                let step = Math.min(...active.map(t => t.rem));
                if (step < 1e-9) step = 0.001;
                
                const nodes = [], gains = [], combinedRanges = [];
                if(ranges) for(let i=0; i<ranges.length; i++) combinedRanges.push(ranges[i]);

                active.forEach(t => {
                    if (t.curr) {
                        if(t.curr.nodes) for(let i=0; i<t.curr.nodes.length; i++) nodes.push(t.curr.nodes[i]);
                        if(t.curr.gains) for(let i=0; i<t.curr.gains.length; i++) gains.push(t.curr.gains[i]);
                        // AGGREGATE CHILD RANGES (Fixes Chords not lighting up)
                        if(t.curr.ranges) for(let i=0; i<t.curr.ranges.length; i++) combinedRanges.push(t.curr.ranges[i]);
                    }
                });
                yield { nodes, gains, ranges: combinedRanges, dur: step };
                active.forEach(t => { t.rem -= step; if (t.rem <= 1e-5) t.pull(); });
            }
            return;
        }
        
        if (node.type === SPEED) {
            const factor = resolve(node.amount, this.env);
            yield* yieldWith(this.visit(node.data, duration / (factor || 1), g));
            return;
        }
        
        if (node.type === VOL) {
            const v = resolve(node.amount, this.env);
            yield* yieldWith(this.visit(node.data, duration, g * v));
            return;
        }

        // Leaf Node
        const activeRanges = [];
        if(ranges) for(let i=0; i<ranges.length; i++) activeRanges.push(ranges[i]);
        this.collectRanges(node, activeRanges);

        yield { nodes: [node], gains: [g], dur: duration, ranges: activeRanges };
    }
}

class ForthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sounds = [];
        this.samples = {};
        this.requested = new Set();
        this.bpm = 120;
        this.lastBpm = 120;
        this.anchorFrame = 0;
        this.anchorBeat = 0;
        this.kFreq = 0.05; 
        this.kAmp = 0.05;

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
            pos: 0, stack: [], sounds: [], macros: {}, bpm: this.bpm, req, time: currentFrame/sampleRate,
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
                snd.env.t = absFrame;
                snd.env.time = absFrame / sampleRate;
                snd.env.beat = beatNow;

                if (snd.endTime === -1) snd.endTime = Math.floor(beatNow);

                while (beatNow >= snd.endTime) {
                    const next = snd.iter.next();
                    snd.curr = next.value;
                    snd.endTime += next.value.dur;
                    if (snd.curr) {
                        if (snd.voices.length !== snd.curr.nodes.length) {
                            snd.voices = snd.curr.nodes.map(() => ({ p: 0, f: 0, a: 0 }));
                        }
                        if (snd.waveType === SMP) {
                            snd.voices.forEach(v => v.p = 0);
                        }
                    }
                }

                if (i === 0 && snd.curr && snd.curr.ranges) {
                    for(let r=0; r<snd.curr.ranges.length; r++) {
                        const rng = snd.curr.ranges[r];
                        if (rng && rng.s !== undefined) activeRanges.push(rng);
                    }
                }

                if (!snd.curr) continue;

                for (let v = 0; v < snd.curr.nodes.length; v++) {
                    const node = snd.curr.nodes[v];
                    const voice = snd.voices[v];
                    const gain = (snd.curr.gains && snd.curr.gains[v] !== undefined ? snd.curr.gains[v] : 1.0) * (snd.curr.baseGain || 1.0);
                    const val = resolve(node, snd.env);

                    if (snd.waveType === 'RAW') {
                        signal += val * gain;
                    } else if (snd.waveType === SMP) {
                        const key = (typeof val === 'string') ? val : (node.val || '');
                        if (this.samples[key]) {
                            signal += snd.renderFn(voice.p, this.samples[key]) * gain;
                            voice.p += (1/sampleRate);
                        }
                    } else {
                        const targetFreq = (typeof val === 'number') ? val : 0;
                        const targetAmp = (targetFreq > 0 ? 1.0 : 0.0) * gain;
                        voice.f += (targetFreq - voice.f) * this.kFreq;
                        voice.a += (targetAmp - voice.a) * this.kAmp;
                        if (voice.a > 0.001) {
                            voice.p += (voice.f / sampleRate);
                            signal += snd.renderFn(voice.p) * voice.a;
                        }
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