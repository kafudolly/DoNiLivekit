class PcmRingBufferProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        const configuredCapacity = Number(options?.processorOptions?.capacityFrames);
        const capacityFrames = Number.isFinite(configuredCapacity) && configuredCapacity > 1024
            ? Math.floor(configuredCapacity)
            : Math.floor(sampleRate * 0.25);

        this.capacity = capacityFrames;
        this.buffer = new Float32Array(this.capacity);
        this.readIndex = 0;
        this.writeIndex = 0;
        this.available = 0;

        const configuredTarget = Number(options?.processorOptions?.targetLatencyFrames);
        const configuredMax = Number(options?.processorOptions?.maxLatencyFrames);

        // 低延迟策略：队列超过 maxLatencyFrames 时，直接丢弃旧样本，回落到 targetLatencyFrames。
        // 这可以防止网络/主线程短暂卡顿后，后续继续播放“几十秒前的旧语音”。
        this.targetLatencyFrames = Number.isFinite(configuredTarget) && configuredTarget >= 0
            ? Math.floor(configuredTarget)
            : Math.floor(this.capacity * 0.35);

        this.maxLatencyFrames = Number.isFinite(configuredMax) && configuredMax > this.targetLatencyFrames
            ? Math.floor(configuredMax)
            : Math.floor(this.capacity * 0.75);

        this.dropCount = 0;
        this.lastStatsAt = currentTime;

        this.port.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            if (data && data.type === 'reset') {
                this.reset();
                return;
            }

            let chunk = null;
            if (data instanceof ArrayBuffer) {
                chunk = new Float32Array(data);
            } else if (ArrayBuffer.isView(data)) {
                chunk = data instanceof Float32Array
                    ? data
                    : new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
            }

            if (!chunk || chunk.length === 0) return;
            this.push(chunk);
        };
    }

    reset() {
        this.readIndex = 0;
        this.writeIndex = 0;
        this.available = 0;
        this.dropCount = 0;
    }

    dropOldest(frameCount) {
        const drop = Math.max(0, Math.min(frameCount, this.available));
        if (drop <= 0) return;
        this.readIndex = (this.readIndex + drop) % this.capacity;
        this.available -= drop;
        this.dropCount += drop;
    }

    trimLatency() {
        if (this.available <= this.maxLatencyFrames) return;
        this.dropOldest(this.available - this.targetLatencyFrames);
    }

    push(chunk) {
        // 极端情况：单个 chunk 已经超过环形缓冲容量，只保留最新的一段。
        if (chunk.length >= this.capacity) {
            const start = chunk.length - this.capacity;
            this.buffer.set(chunk.subarray(start));
            this.readIndex = 0;
            this.writeIndex = 0;
            this.available = this.capacity;
            this.trimLatency();
            return;
        }

        for (let i = 0; i < chunk.length; i++) {
            if (this.available >= this.capacity) {
                this.dropOldest(1);
            }

            const sample = chunk[i];
            this.buffer[this.writeIndex] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
            this.writeIndex = (this.writeIndex + 1) % this.capacity;
            this.available++;
        }

        this.trimLatency();
    }

    pull() {
        if (this.available <= 0) return 0;
        const sample = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.available--;
        return sample;
    }

    process(_inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const frames = output[0].length;
        for (let i = 0; i < frames; i++) {
            const monoSample = this.pull();
            for (let ch = 0; ch < output.length; ch++) {
                output[ch][i] = monoSample;
            }
        }

        // 偶尔回报一次缓冲状态，方便以后调试延迟，不影响正常运行。
        if (currentTime - this.lastStatsAt > 2) {
            this.lastStatsAt = currentTime;
            this.port.postMessage({
                type: 'pcm_buffer_stats',
                available: this.available,
                capacity: this.capacity,
                dropped: this.dropCount,
            });
            this.dropCount = 0;
        }

        return true;
    }
}

registerProcessor('pcm-ring-buffer-processor', PcmRingBufferProcessor);
