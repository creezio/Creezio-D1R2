import type {CallToolResult} from '@modelcontextprotocol/client';

const sourceLimit = 2_097_152;
const resultLimit = 3_145_728;
const encoder = new TextEncoder();

function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte))
    return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (bytes.length >= 12 && [82,73,70,70].every((byte,index) => bytes[index] === byte) &&
    [87,69,66,80].every((byte,index) => bytes[index + 8] === byte)) return 'image/webp';
  return null;
}

/** Keep private bytes only in the app-visible tool metadata, never model-visible content. */
export async function linkedImageToolResult(blob: Blob): Promise<CallToolResult | null> {
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > sourceLimit) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== blob.size || bytes.byteLength > sourceLimit) return null;
  const mimeType = imageMime(bytes);
  // The linked-read client carries the server-verified content type in Blob.type.
  if (!mimeType || blob.type !== mimeType) return null;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  const result: CallToolResult = {
    content: [{type: 'text', text: 'Image privée remise au composant.'}],
    _meta: {'creezio/linkedImage': {schemaVersion: 1, type: 'image', mimeType,
      data: btoa(parts.join(''))}},
  };
  return encoder.encode(JSON.stringify(result)).byteLength <= resultLimit ? result : null;
}
