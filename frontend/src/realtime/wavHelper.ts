/**
 * Utility to convert raw 16-bit PCM ArrayBuffers into a valid WAV Blob for browser playback.
 */
export function createWavBlob(chunks: ArrayBuffer[], sampleRate = 16000, numChannels = 1): Blob {
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const buffer = new ArrayBuffer(44 + totalLength);
  const view = new DataView(buffer);

  // RIFF identifier
  writeAscii(view, 0, "RIFF");
  // file length
  view.setUint32(4, 36 + totalLength, true);
  // RIFF type
  writeAscii(view, 8, "WAVE");
  // format chunk identifier
  writeAscii(view, 12, "fmt ");
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw PCM = 1)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * numChannels * 2)
  view.setUint32(28, sampleRate * numChannels * 2, true);
  // block align (numChannels * 2)
  view.setUint16(32, numChannels * 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeAscii(view, 36, "data");
  // data chunk length
  view.setUint32(40, totalLength, true);

  // copy PCM sample bytes
  let offset = 44;
  const uint8 = new Uint8Array(buffer);
  for (const chunk of chunks) {
    uint8.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
