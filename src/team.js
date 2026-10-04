// Notifies your team when a customer taps "Talk to Executive".
//
// Settings:
//   TEAM_NUMBERS        Team WhatsApp numbers to alert, comma-separated, with country code
//                       e.g. 919876543210,919812345678
//   TEAM_ALERT_TEMPLATE (optional, recommended) name of an approved WhatsApp message template
//                       with 2 variables: {{1}} = customer name, {{2}} = customer number.
//                       Without a template, WhatsApp only delivers the alert to team members
//                       who have messaged the business number in the last 24 hours.
//   TEAM_ALERT_LANG     template language code (default "en")

const wa = require('./whatsapp');

function teamNumbers() {
  return (process.env.TEAM_NUMBERS || '')
    .split(',')
    .map((n) => n.replace(/[^\d]/g, ''))
    .filter(Boolean);
}

async function alertTeam(customer, name) {
  const who = name ? `${name} (+${customer})` : `+${customer}`;
  console.log(`🔔 ${who} asked to talk to an executive`);

  const numbers = teamNumbers();
  if (!numbers.length) {
    console.log('   (no TEAM_NUMBERS set — no WhatsApp alert sent)');
    return;
  }

  const template = process.env.TEAM_ALERT_TEMPLATE;
  for (const to of numbers) {
    if (to === customer) continue;
    let ok = false;
    if (template) {
      ok = await wa.send(to, {
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.TEAM_ALERT_LANG || 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: name || 'A customer' },
                { type: 'text', text: '+' + customer },
              ],
            },
          ],
        },
      });
    }
    if (!ok) {
      ok = await wa.send(to, {
        type: 'text',
        text: {
          preview_url: false,
          body: `🔔 *Customer wants to talk to an executive*\n\n👤 ${name || 'Customer'}\n📱 +${customer}\n\nReply to them in the WhatsApp Business app, or open: https://wa.me/${customer}`,
        },
      });
    }
    console.log(`   alert to +${to}: ${ok ? 'sent ✅' : 'failed ❌'}`);
  }
}

module.exports = { alertTeam };
