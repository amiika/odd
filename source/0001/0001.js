const DICT = {
    'sine': (stack, sounds) => {
        if (stack.length > 0) {
            sounds.push({
                freqs: [...stack], 
                phase: 0
            });
            stack.length = 0;
        }
    }
};

class ForthProcessor extends AudioWorkletProcessor {
    constructor() { 
        super(); 
        this.sounds = []; 
        this.port.onmessage = (e) => this.interpret(e.data); 
    }
    
    interpret(text) {
        const tokens = text.split(/\s+/).filter(x => x);
        const stack = [];
        const newSounds = [];
        
        tokens.forEach(token => {
            const num = parseFloat(token);
            if (!isNaN(num)) {
                stack.push(num);
            } else if (DICT[token]) {
                DICT[token](stack, newSounds);
            }
        });
        
        newSounds.forEach((sound, index) => {
            if (this.sounds[index]) {
                sound.phase = this.sounds[index].phase;
            }
        });
        
        this.sounds = newSounds;
    }

    process(inputs, outputs) {
        const output = outputs[0][0];
        if (!output) return true;
        
        const samplesPerBeat = sampleRate * 0.5; // 120 BPM

        for (let i = 0; i < output.length; i++) {
            const globalTime = currentFrame + i;
            const sequenceTime = globalTime % samplesPerBeat;
            let signal = 0;

            this.sounds.forEach(voice => {
                if (voice.freqs.length === 0) return;
                
                const step = samplesPerBeat / voice.freqs.length;
                const noteIndex = Math.floor(sequenceTime / step);
                const freq = voice.freqs[noteIndex] || 0;
                
                voice.phase += (freq / sampleRate);
                signal += Math.sin(voice.phase * 2 * Math.PI);      
            });

            output[i] = signal * 0.2;
        }
        return true;
    }
}
registerProcessor('fzrth-proc', ForthProcessor);