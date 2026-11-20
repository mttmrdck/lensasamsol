/** A thumbnail may never turn into an unbounded original or executable content response. */
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
export function imageContentType(value: string | null): string | null {
  const type=(value ?? '').split(';')[0].trim().toLowerCase();
  return ['image/jpeg','image/png','image/webp'].includes(type) ? type : null;
}
export async function boundedPreview(res: Response): Promise<{ bytes: Uint8Array; type: string }> {
  const type=imageContentType(res.headers.get('content-type'));
  if(!type || !res.body || Number(res.headers.get('content-length') ?? 0)>MAX_PREVIEW_BYTES) {
    await res.body?.cancel(); throw new Error('Invalid preview response');
  }
  const reader=res.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  for(;;) {
    const {done,value}=await reader.read();if(done) break;
    size+=value.byteLength;
    if(size>MAX_PREVIEW_BYTES) { await reader.cancel();throw new Error('Preview exceeds size limit'); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes,type};
}
