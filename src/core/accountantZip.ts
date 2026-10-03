/** Minimal deterministic ZIP32 STORE writer; filenames are fixed by the exporter. */
export function accountantZip(
  files: readonly { name: string; content: string }[],
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const names = new Set<string>()
  const local: Uint8Array[] = [],
    central: Uint8Array[] = []
  let offset = 0,
    centralSize = 0
  for (const file of files) {
    if (!/^[a-z][a-z0-9_]*\.csv$|^README\.txt$/.test(file.name) || names.has(file.name))
      throw new Error('ZIPのファイル名が不正または重複しています。')
    names.add(file.name)
    const name = encoder.encode(file.name),
      data = encoder.encode(file.content)
    if (data.length > 100_000_000 || offset + data.length > 200_000_000)
      throw new Error('CSV出力が大きすぎます。')
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = new Uint8Array(30 + name.length),
      view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x800, true)
    view.setUint16(12, 33, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true)
    header.set(name, 30)
    const entry = new Uint8Array(46 + name.length),
      cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x800, true)
    cv.setUint16(14, 33, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)
    local.push(header, data)
    central.push(entry)
    offset += header.length + data.length
    centralSize += entry.length
  }
  if (files.length > 65535) throw new Error('ZIP内のファイル数が多すぎます。')
  const end = new Uint8Array(22),
    ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const result = new Uint8Array(offset + centralSize + end.length)
  let position = 0
  for (const chunk of [...local, ...central, end]) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}
