export function assertUtf8JsonArtifact(content: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (content.charCodeAt(0) === 0xfeff) issues.push('bom_detected');
  if (content.includes('\u0000')) issues.push('nul_byte_detected');
  try {
    JSON.parse(content);
  } catch {
    issues.push('json_parse_failed');
  }
  return { ok: issues.length === 0, issues };
}

export function assertUtf8Buffer(buffer: Buffer): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    issues.push('bom_detected');
  }
  if (buffer.includes(0x00)) issues.push('nul_byte_detected');
  return { ok: issues.length === 0, issues };
}
