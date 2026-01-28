class BytebeatProcessor extends AudioWorkletProcessor {
            static get parameterDescriptors() {
                return [
                    { 
                        name: 'volume', 
                        defaultValue: 0,
                        automationRate: 'a-rate'
                    },
                    { 
                        name: 'speed', 
                        defaultValue: 0.18,
                        automationRate: 'k-rate'
                    }
                ];
            }
            constructor() {
                super();
                this.time = 0;
                this.dsp = (t) => 0;
                this.port.onmessage = (event) => {
                    if (event.data.code) {
                        try {
                            const code = event.data.code.trim();
                            this.dsp = new Function('t', "return "+ code);
                        } catch (err) {}
                    }
                };
            }
            process(inputs, outputs, parameters) {
                const output = outputs[0];
                const left = output[0];
                const right = output[1];
                const vol = parameters.volume;
                const delta = parameters.speed[0];

                if (left) {
                    for (let i = 0; i < left.length; i++) {
                        let result = 0;

                        try {
                            // Some bytebeat magic, or is like floor but faster
                            result = this.dsp(this.time | 0) | 0;
                        } catch (e) {}

                        // More 8-bit magic, essentially result % 256 / 256 maps to [-1.0, 1.0]
                        const sample = ((result & 255) - 128) / 128;

                        // Handling volume automation rate
                        const currentVolume = vol.length > 1 ? vol[i] : vol[0];

                        left[i] = sample * currentVolume;
                        if (right) right[i] = left[i];

                        // Increment time based on speed parameter
                        this.time += delta;
                    }

                    // About 25% of the time, send visualizer data
                    if (((this.time | 0) & 511) < 128) {
                        this.port.postMessage(left);
                    }
                }
                return true;
            }
        }
        registerProcessor("bytebeat-processor", BytebeatProcessor);