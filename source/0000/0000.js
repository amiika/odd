/**
 * Class: SineSynth
 * Extends: AudioWorkletProcessor
 * * The processor runs on a high-priority audio thread.
 * Its job is to fill audio buffers (arrays of numbers) with waveform data.
 */
class SineSynth extends AudioWorkletProcessor {
    
    // Define parameters that can be automated (e.g., changing pitch smoothly).
    // 'a-rate' means the parameter is calculated per-sample (high precision).
    static get parameterDescriptors() {
        return [
            { 
                name: 'freq', 
                defaultValue: 440, 
                minValue: 20, 
                maxValue: 22000,
                automationRate: 'a-rate' // Explicitly 'a-rate' for smooth pitch bends
            }
        ];
    }

    constructor() {
        super();
        // Phase tracks the current position in the sine wave cycle (0.0 to 1.0).
        this.phase = 0;
    }

    /**
     * The Core DSP Loop
     * * @param {Float32Array[][]} inputs - Incoming audio (not used here).
     * @param {Float32Array[][]} outputs - Where we write our sound. [Output][Channel][Sample].
     * @param {Object} parameters - The current values of our defined parameters (freq).
     */
    process(inputs, outputs, parameters) {
        // accessing output[0] (first output) channel[0] (left channel/mono)
        const output = outputs[0][0];
        if (!output) return true; // Keep processor alive even if output is missing
        
        const freqs = parameters.freq;
        
        // --- OPTIMIZATION CHECK ---
        // If freq is constant: freqs.length === 1 (Browser optimization)
        // If freq is changing: freqs.length === 128 (Full per-sample automation data)
        const isFArr = freqs.length > 1;

        // Loop through every sample in the buffer (usually 128 times)
        for (let i = 0; i < output.length; i++) {
            
            // 1. Get current Frequency
            const f = isFArr ? freqs[i] : freqs[0];

            // 2. Increment Phase
            // phase += frequency / sampleRate
            this.phase += f / sampleRate;
            
            // 3. Wrap Phase
            // Keep phase between 0.0 and 1.0
            if (this.phase > 1.0) this.phase -= 1.0;
            
            // 4. Generate Sine Wave
            // Map 0.0-1.0 phase to 0-2PI radians.
            output[i] = Math.sin(2.0 * Math.PI * this.phase);

            // --- Alternate Waveforms ---
            // Sawtooth: output[i] = 2.0 * this.phase - 1.0;
            // Square:   output[i] = this.phase < 0.5 ? 1.0 : -1.0;
            // Triangle: output[i] = 1.0 - 4.0 * Math.abs(this.phase - 0.5);
        }

        // Return true to tell the audio engine to keep this node alive.
        return true;
    }
}

// Register the class so the AudioContext can find it by name.
registerProcessor('sine-synth', SineSynth);