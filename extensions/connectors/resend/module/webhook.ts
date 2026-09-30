/** The shared host verifies the exact Svix-signed bytes before invoking this mapper. */
export function resendWebhookInput(event:Record<string,unknown>,eventId:string,bodyDigest:string){
  const data=event.data;
  if(!/^[A-Za-z0-9_-]{1,128}$/u.test(eventId)
    ||!['email.sent','email.delivered','email.bounced','email.failed','email.received']
      .includes(String(event.type))
    ||!data||typeof data!=='object'||Array.isArray(data)
    ||typeof (data as Record<string,unknown>).email_id!=='string'
    ||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(String((data as Record<string,unknown>).email_id))
    ||typeof event.created_at!=='string'||!Number.isFinite(Date.parse(event.created_at))
    ||!/^[a-f0-9]{64}$/u.test(bodyDigest))throw new Error('Invalid Resend event');
  return {requestKey:eventId,eventId,bodyDigest,eventType:event.type,
    emailId:(data as Record<string,unknown>).email_id,
    occurredAt:new Date(event.created_at).toISOString()};
}
