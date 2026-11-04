/** Browser/Hermes compatible; no Buffer/native dependency or persistent files. */
export function photoBase64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export function photoBytes(base64: string): Uint8Array {
  const text = atob(base64);
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
