// Team availability in India time, from BUSINESS_HOURS (e.g. "10:00-19:00")
// and BUSINESS_DAYS (e.g. "Mon-Sat" or "Mon-Fri,Sun"). Not set = always "open".
const { BUSINESS_HOURS, BUSINESS_DAYS } = require('./config');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function nowIST() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3)), minutes: Number(get('hour')) % 24 * 60 + Number(get('minute')) };
}

function openDays() {
  const set = new Set();
  for (const part of BUSINESS_DAYS.toLowerCase().split(',')) {
    const [a, b] = part.trim().split('-').map((d) => DAYS.indexOf(d.trim().slice(0, 3)));
    if (a < 0) continue;
    if (b === undefined || b < 0) set.add(a);
    else for (let d = a; ; d = (d + 1) % 7) { set.add(d); if (d === b) break; }
  }
  return set;
}

function range() {
  const m = BUSINESS_HOURS.match(/(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?/);
  if (!m) return null;
  return { from: Number(m[1]) * 60 + Number(m[2] || 0), to: Number(m[3]) * 60 + Number(m[4] || 0) };
}

function isOpen() {
  const r = range();
  if (!r) return true;
  const { day, minutes } = nowIST();
  return openDays().has(day) && minutes >= r.from && minutes < r.to;
}

function fmt(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

function describe() {
  const r = range();
  if (!r) return '';
  return `${BUSINESS_DAYS.replace(/\s*-\s*/g, ' to ').replace(/\s*,\s*/g, ' & ')}, ${fmt(r.from)} – ${fmt(r.to)}`;
}

module.exports = { isOpen, describe };
