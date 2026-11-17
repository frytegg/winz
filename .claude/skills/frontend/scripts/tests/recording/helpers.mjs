// @ts-check
/*
 * Test helpers for recording-check: a stored (method 0) or deflated (method 8) ZIP writer for .pptx and .key decks,
 * an MP4-shaped box stream carrying a codec fourcc, and an ffmpeg probe so ffmpeg-dependent tests can say why they
 * skip.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * @param {Array<{name: string, data: Buffer | string, deflate?: boolean}>} entries
 * @returns {Buffer}
 */
export function makeZip(entries) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * @param {string} type
 * @param {Buffer} [payload]
 * @returns {Buffer}
 */
export function box(type, payload = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

/**
 * An MP4-shaped byte stream: ftyp, then moov (with the codec fourcc in a fake sample entry) and mdat in either order.
 * @param {{codec: string, moovFirst?: boolean}} options
 * @returns {Buffer}
 */
export function fakeMp4({ codec, moovFirst = true }) {
  const ftyp = box('ftyp', Buffer.from('isom\u0000\u0000\u0002\u0000', 'latin1'));
  const moov = box('moov', box('trak', box('stsd', Buffer.concat([Buffer.alloc(8), box(codec, Buffer.alloc(16))]))));
  const mdat = box('mdat', Buffer.alloc(64, 7));
  return Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

/**
 * Whether ffmpeg (FFMPEG_PATH or PATH) has libx264 and libvmaf, and ffprobe runs.
 * @returns {{x264: boolean, vmaf: boolean, probe: boolean}}
 */
export function ffmpegFeatures() {
  const bin = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const enc = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true });
  const fil = spawnSync(bin, ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true });
  const probe = spawnSync(process.env.FFPROBE_PATH?.trim() || 'ffprobe', ['-version'], { encoding: 'utf8', windowsHide: true });
  return {
    x264: enc.status === 0 && /\blibx264\b/.test(enc.stdout),
    vmaf: fil.status === 0 && /\blibvmaf\b/.test(fil.stdout ?? ''),
    probe: probe.status === 0,
  };
}

/**
 * A 0.2 s 64x64 H.264 master tagged BT.709 limited range with fast start (FD20 Deliverable E recipe); needs ffmpeg.
 * @param {string} dir
 * @returns {string}
 */
export function makeMaster(dir) {
  const file = path.join(dir, 'master-tv.mp4');
  const r = spawnSync(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x101010:s=64x64:d=0.2', '-vf', 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg could not make the test master: ${r.stderr}`);
  return file;
}
