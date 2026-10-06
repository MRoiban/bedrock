const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (n: number, bits: number) => n >>> bits | n << (32 - bits);
export class Sha256 {
  private state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  private block = new Uint8Array(64);
  private words = new Uint32Array(64);
  private length = 0;
  private pending = 0;
  update(bytes: Uint8Array) {
    this.length += bytes.length;
    let offset = 0;
    while (offset < bytes.length) {
      const count = Math.min(64 - this.pending, bytes.length - offset);
      this.block.set(bytes.subarray(offset, offset + count), this.pending);
      offset += count; this.pending += count;
      if (this.pending === 64) { this.compress(); this.pending = 0; }
    }
    return this;
  }
  digest(): string {
    // Finalize a copy so callers can inspect a digest without changing the stream.
    const copy = new Sha256();
    copy.state.set(this.state); copy.block.set(this.block); copy.pending = this.pending;
    const padding = new Uint8Array(this.pending < 56 ? 64 - this.pending : 128 - this.pending);
    padding[0] = 0x80;
    new DataView(padding.buffer).setBigUint64(padding.length - 8, BigInt(this.length) * 8n);
    copy.update(padding);
    return Array.from(copy.state, word => word.toString(16).padStart(8, '0')).join('');
  }
  private compress() {
    const w = this.words, view = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!;
      w[i] = w[i - 16]! + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + w[i - 7]! + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10);
    }
    let [a,b,c,d,e,f,g,h] = Array.from(this.state) as [number,number,number,number,number,number,number,number];
    for (let i = 0; i < 64; i++) {
      const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + K[i]! + w[i]!;
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c);
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const next = [a,b,c,d,e,f,g,h];
    for (let i = 0; i < 8; i++) this.state[i] = this.state[i]! + next[i]!;
  }
}
