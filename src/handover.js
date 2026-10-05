// Decides when the bot should answer on a number your team ALSO uses in the
// WhatsApp Business app (Coexistence). Turned on with SHARED_NUMBER=true.
//
// Rules in shared mode:
//  • Customer taps one of the bot's buttons          -> bot always answers
//  • Customer types "menu" or says hi/hello/salam   -> bot restarts the chat (and un-pauses)
//  • Someone from your team replied from the app    -> bot stays silent for that customer
//                                                      for HUMAN_PAUSE_HOURS (default 12)
//  • Customer says hi / hello / salam etc.          -> bot shows the welcome menu
//  • Any other message (a question, a photo, …)
//      - first message in 24h -> menu + "our team will also reply" note
//      - otherwise            -> bot stays silent, your team answers in the app
//
// Note: this memory resets when the server restarts (e.g. Render free plan waking up).
// Worst case, a customer gets the menu once more — nothing breaks.

const SHARED = /^(1|true|yes)$/i.test(process.env.SHARED_NUMBER || '');
const PAUSE_MS = Number(process.env.HUMAN_PAUSE_HOURS || 12) * 3600e3;
const QUIET_MS = 24 * 3600e3;

const GREETING =
  /^(hi+|hey+|hello+|helo|hlo|hii+|namaste|namaskar|salam|salaam|as+alam.*|asalam.*|good (morning|afternoon|evening)|menu|start|shop|shopping|order|catalog(ue)?|products?|retail|corporate)[\s!.,?🙏👋]*$/i;

const staffReplied = new Map(); // customer -> time a team member last replied from the app
const lastSeen = new Map(); // customer -> time the customer last messaged

function noteStaffReply(customer) {
  staffReplied.set(customer, Date.now());
}

// Returns { reply: boolean, note?: string }
function decide(customer, input) {
  const now = Date.now();
  const prev = lastSeen.get(customer);
  lastSeen.set(customer, now);
  cleanup(now);

  if (!SHARED) return { reply: true };

  const text = (input.text || '').trim();
  if (input.replyId || input.agent) return { reply: true };
  // "hi", "hello", "menu" etc. always restart the chat with the bot (even after the team replied)
  if (/^menu$/i.test(text) || GREETING.test(text)) {
    staffReplied.delete(customer);
    return { reply: true };
  }

  const paused = now - (staffReplied.get(customer) || 0) < PAUSE_MS;
  if (paused) return { reply: false };

  if (GREETING.test(text)) return { reply: true };

  const isNewChat = !prev || now - prev > QUIET_MS;
  if (isNewChat) {
    return { reply: true, note: 'Thanks for your message! 🙏 Our team will reply to you here shortly.' };
  }
  return { reply: false };
}

function cleanup(now) {
  if (lastSeen.size < 5000) return;
  for (const [k, t] of lastSeen) if (now - t > QUIET_MS) lastSeen.delete(k);
  for (const [k, t] of staffReplied) if (now - t > PAUSE_MS) staffReplied.delete(k);
}

module.exports = { decide, noteStaffReply, SHARED };
