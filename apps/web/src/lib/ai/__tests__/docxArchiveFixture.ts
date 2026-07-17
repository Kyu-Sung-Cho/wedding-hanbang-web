export type DocxZipEntryFixture = {
  name: string;
  data?: Buffer;
  uncompressedSize?: number;
  flags?: number;
  method?: 0 | 8;
  extra?: Buffer;
};

export function makeDocxZipFixture(entries: DocxZipEntryFixture[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data ?? Buffer.from("x");
    const extra = entry.extra ?? Buffer.alloc(0);
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const flags = entry.flags ?? 0x0800;
    const method = entry.method ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    localParts.push(local, name, extra, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name, extra);

    localOffset += local.length + name.length + extra.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

export function docxRequiredEntries(
  extra: DocxZipEntryFixture[] = [],
): DocxZipEntryFixture[] {
  return [
    { name: "[Content_Types].xml" },
    { name: "_rels/.rels" },
    { name: "word/document.xml" },
    ...extra,
  ];
}
