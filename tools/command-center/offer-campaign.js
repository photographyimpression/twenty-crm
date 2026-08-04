// Seasonal-offer campaign: a 3-touch, deadline-driven prepaid-card offer that
// Moshe enrols ONE client at a time, with the card amount and the number of
// bonus images typed in per person.
//
// Two deliberate design decisions, both from the brief:
//
//  1. It READS like a general seasonal sale, but every send is personal. That
//     protects the list price (a public discount permanently resets what the
//     product is "worth"; a sale that visibly ends does not).
//  2. The copy never says a PERCENTAGE. "10 extra images" is a concrete thing
//     you receive; "10% more" is arithmetic the reader has to do, and it reads
//     like a discount on price rather than a bonus.
//
// The sale window starts at ENROLMENT, not on a fixed calendar date, and the
// sale names itself from the real month. Enrol someone in November and they get
// a Winter offer ending in 3 days — never a "Summer Sale" in the snow, and
// never two clients comparing notes on the same sale with different deadlines.
//
// Email bodies are raw designed HTML: the leading `<!--email:html-->` sentinel
// is what makes twenty-server skip the react-email renderer (which would escape
// the markup). Buttons carry background-color INSIDE style="" because Outlook
// strips bgcolor= attributes.

const SEASONS = [
  { name: 'Winter', months: [12, 1, 2] },
  { name: 'Spring', months: [3, 4, 5] },
  { name: 'Summer', months: [6, 7, 8] },
  { name: 'Fall', months: [9, 10, 11] },
];

function seasonNameFor(date) {
  const m = date.getMonth() + 1;
  const hit = SEASONS.find((s) => s.months.includes(m));
  return hit ? hit.name : 'Seasonal';
}

// The offer runs to the end of the 3rd day. Touch 3 goes out in its final hours.
function offerWindow(startDate) {
  const end = new Date(startDate.getTime());
  end.setDate(end.getDate() + 3);
  end.setHours(23, 59, 59, 999);
  return { start: new Date(startDate.getTime()), end };
}

function formatDeadline(end) {
  return end.toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BRAND_DARK = '#0f1115';
const BRAND_BLUE = '#3b82f6';

function shell({ preheader, badge, badgeBg, badgeBorder, badgeColor, heading, bodyHtml, ctaLabel, ctaUrl, footNote }) {
  return `<!--email:html-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6f9;margin:0;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
      <tr><td style="background:${BRAND_DARK};padding:22px 28px">
        <div style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px">Impression Photography</div>
        <div style="color:#9aa3b2;font-size:12px;padding-top:3px">Product photography &middot; Montreal</div>
      </td></tr>
      ${badge ? `<tr><td style="padding:26px 28px 0">
        <div style="display:inline-block;background:${badgeBg};border:1px solid ${badgeBorder};color:${badgeColor};font-size:12px;font-weight:700;letter-spacing:.4px;padding:6px 12px;border-radius:999px">${esc(badge)}</div>
      </td></tr>` : ''}
      <tr><td style="padding:16px 28px 8px">
        <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:${BRAND_DARK}">${esc(heading)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td align="center" style="padding:4px 28px 26px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="border-radius:8px;background-color:${BRAND_BLUE}">
            <a href="${esc(ctaUrl)}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background-color:${BRAND_BLUE}">${esc(ctaLabel)}</a>
          </td>
        </tr></table>
        ${footNote ? `<div style="padding-top:12px;font-size:12px;color:#8a92a1">${esc(footNote)}</div>` : ''}
      </td></tr>
      <tr><td style="padding:0 28px 28px">
        <div style="border-top:1px solid #e7eaef;padding-top:18px;font-size:14px;line-height:1.6;color:#3d4451">
          &mdash; Moshe Lerner<br><span style="color:#8a92a1">Impression Photography</span>
        </div>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 28px;font-size:11px;line-height:1.6;color:#8a92a1;border-top:1px solid #e7eaef">
        Impression Photography &middot; Montreal, QC<br>You are receiving this because you asked us about product photography.
      </td></tr>
    </table>
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
  </td></tr>
</table>`;
}

const P = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#3d4451';

// touchNumber -> { subject, html }
function renderTouch(touchNumber, ctx) {
  const { firstName, cardAmount, extraImages, ctaUrl, deadline, saleName } = ctx;
  const who = firstName && firstName.trim() ? firstName.trim() : 'there';
  const bonus = `${extraImages} extra image${Number(extraImages) === 1 ? '' : 's'}`;

  if (touchNumber === 1) {
    return {
      subject: `${saleName} offer: ${bonus} on a ${cardAmount} prepaid card`,
      html: shell({
        preheader: `Get ${bonus} free when you top up your ${cardAmount} prepaid card. Ends ${deadline}.`,
        badge: `${saleName.toUpperCase()} OFFER`,
        badgeBg: '#eff6ff', badgeBorder: '#bfdbfe', badgeColor: '#1d4ed8',
        heading: `${bonus} on your next shoot`,
        bodyHtml:
          `<p style="${P}">Hi ${esc(who)},</p>` +
          `<p style="${P}">We are running our ${esc(saleName.toLowerCase())} offer on prepaid photography cards, and I wanted to make sure you saw it before it closes.</p>` +
          `<p style="${P}">Put <strong>${esc(cardAmount)}</strong> on a prepaid card and you get <strong>${esc(bonus)}</strong> added on top &mdash; free. The card never expires, so you can use it across as many products and as many shoots as you like.</p>` +
          `<p style="${P}">It is the cheapest way to buy photography from us, and the images are the same ones you would get any other day: pure-white mains, angles, detail shots, lifestyle.</p>` +
          `<p style="${P}"><strong>The offer ends ${esc(deadline)}.</strong></p>`,
        ctaLabel: 'Get the offer',
        ctaUrl,
        footNote: `Offer ends ${deadline}`,
      }),
    };
  }

  if (touchNumber === 2) {
    return {
      subject: `Re: ${bonus} on a ${cardAmount} card — closes ${deadline}`,
      html: shell({
        preheader: `A quick reminder — your ${bonus} offer closes ${deadline}.`,
        badge: 'CLOSING SOON',
        badgeBg: '#fff7ed', badgeBorder: '#fed7aa', badgeColor: '#b45309',
        heading: `Still time to claim your ${bonus}`,
        bodyHtml:
          `<p style="${P}">Hi ${esc(who)},</p>` +
          `<p style="${P}">Short note so this does not slip past you: the ${esc(bonus)} on a <strong>${esc(cardAmount)}</strong> prepaid card is still available, and it closes <strong>${esc(deadline)}</strong>.</p>` +
          `<p style="${P}">You do not need to have the products ready or the shoot booked. The card is credit &mdash; claim it now, use it whenever your products are ready.</p>` +
          `<p style="${P}">If you would rather talk it through first, just reply to this email and I will call you.</p>`,
        ctaLabel: 'Claim the offer',
        ctaUrl,
        footNote: `Closes ${deadline}`,
      }),
    };
  }

  return {
    subject: `Last hours — ${bonus} ends tonight`,
    html: shell({
      preheader: `Final hours to claim ${bonus} on your ${cardAmount} prepaid card.`,
      badge: 'FINAL HOURS',
      badgeBg: '#fef2f2', badgeBorder: '#fecaca', badgeColor: '#b91c1c',
      heading: 'Final hours',
      bodyHtml:
        `<p style="${P}">Hi ${esc(who)},</p>` +
        `<p style="${P}">This is the last note about it &mdash; the ${esc(bonus)} on a <strong>${esc(cardAmount)}</strong> prepaid card ends <strong>tonight (${esc(deadline)})</strong>.</p>` +
        `<p style="${P}">After tonight the card is still available, just without the bonus images. If you were going to need product photography this season anyway, this is the moment it is worth the most.</p>` +
        `<p style="${P}">Takes about a minute.</p>`,
      ctaLabel: 'Claim before midnight',
      ctaUrl,
      footNote: 'Ends tonight',
    }),
  };
}

module.exports = {
  SEASONAL_OFFER_KEY: 'SEASONAL_OFFER',
  SEASONAL_OFFER_TOUCHES: 3,
  seasonNameFor,
  offerWindow,
  formatDeadline,
  renderTouch,
};
