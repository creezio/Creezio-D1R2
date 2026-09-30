/** The shared host verifies Standard Webhooks over the exact raw body before calling this mapper. */
export function granolaWebhookInput(event:Record<string,unknown>,eventId:string,bodyDigest:string){
  const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  if(!validId.test(eventId)||event.event_id!==eventId
    ||!['note.generated','note.edited','note.access_granted'].includes(String(event.event_type))
    ||typeof event.note_id!=='string'||!/^not_[A-Za-z0-9]{1,60}$/u.test(event.note_id)
    ||typeof event.occurred_at!=='string'||!Number.isFinite(Date.parse(event.occurred_at))
    ||typeof bodyDigest!=='string'||!/^[a-f0-9]{64}$/u.test(bodyDigest))
    throw new Error('Invalid Granola event');
  return {requestKey:eventId,eventId,bodyDigest,eventType:event.event_type,
    noteId:event.note_id,occurredAt:new Date(event.occurred_at).toISOString()};
}
