const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 1_600;

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  private readonly source: number[] = [];
  private readonly output: number[] = [];
  private sourcePosition = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<{ type?: string }>) => {
      if (data?.type === "flush") {
        this.emit(true);
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;

    for (const value of channel) this.source.push(value);
    this.resample();
    this.emit(false);
    return true;
  }

  private resample() {
    const ratio = sampleRate / TARGET_SAMPLE_RATE;
    if (ratio >= 1) {
      while (this.sourcePosition + ratio <= this.source.length) {
        const start = this.sourcePosition;
        const end = start + ratio;
        let weightedSum = 0;
        let totalWeight = 0;
        for (let index = Math.floor(start); index < Math.ceil(end); index += 1) {
          const weight = Math.max(0, Math.min(end, index + 1) - Math.max(start, index));
          if (weight && index < this.source.length) {
            weightedSum += this.source[index] * weight;
            totalWeight += weight;
          }
        }
        this.output.push(totalWeight ? weightedSum / totalWeight : 0);
        this.sourcePosition = end;
      }
    } else {
      while (this.sourcePosition + 1 < this.source.length) {
        const left = Math.floor(this.sourcePosition);
        const fraction = this.sourcePosition - left;
        this.output.push(
          this.source[left] * (1 - fraction) + this.source[left + 1] * fraction,
        );
        this.sourcePosition += ratio;
      }
    }

    const consumed = Math.floor(this.sourcePosition);
    if (consumed > 0) {
      this.source.splice(0, consumed);
      this.sourcePosition -= consumed;
    }
  }

  private emit(flush: boolean) {
    while (this.output.length >= CHUNK_SAMPLES || (flush && this.output.length)) {
      const size = Math.min(CHUNK_SAMPLES, this.output.length);
      const pcm = new Int16Array(size);
      for (let index = 0; index < size; index += 1) {
        const value = Math.max(-1, Math.min(1, this.output[index]));
        pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
      }
      this.output.splice(0, size);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
  }
}

registerProcessor("pcm16-capture", Pcm16CaptureProcessor);

export {};
