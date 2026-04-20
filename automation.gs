// ═══════════════════════════════════════════════════════════════════════
// i9 SPORTS NORTHEAST DADE — GOOGLE APPS SCRIPT AUTOMATION
// Franchise #504 · Coach Mike · Highland Oaks + La Redonda
// ═══════════════════════════════════════════════════════════════════════
// SETUP: Paste this entire file into Extensions → Apps Script
//        Fill in CONFIG below, then run setupTriggers() ONCE manually
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  OWNER_EMAIL:         '[YOUR EMAIL HERE]',         // e.g. coachmike@i9sports.com
  FRANCHISE_NAME:      'i9 Sports Northeast Dade',
  PHONE:               '305-808-7425',
  INSTAGRAM_1:         '@i9sportsIS504',
  INSTAGRAM_2:         '@i9sports504',
  REG_URL_REGULAR:     'https://www.i9sports.com/venues/33180-highland-oaks-middle-school-youth-sports-programs/8260',
  REG_URL_SUMMER:      'https://www.i9sports.com/venues/33180-la-redonda-indoor-turf-field-aventura-youth-sports-programs/12086',
  REWARD_PER_REFERRAL: 10,          // $ credit per successful referral
  LEADS_SHEET:         'Leads',
  REFERRALS_SHEET:     'Referrals',
  DASHBOARD_SHEET:     'Dashboard',

  // Column positions in Leads sheet (1-indexed)
  COL_LEAD_ID:         1,   // A
  COL_DATE:            2,   // B
  COL_SOURCE:          3,   // C
  COL_NAME:            4,   // D
  COL_EMAIL:           5,   // E
  COL_PHONE:           6,   // F
  COL_AGE:             7,   // G
  COL_ZIP:             8,   // H
  COL_SEASON:          9,   // I
  COL_SPORT:           10,  // J
  COL_PRICING:         11,  // K
  COL_STATUS:          12,  // L
  COL_REF_CODE:        13,  // M
  COL_FOLLOWUP:        14,  // N
  COL_NOTES:           15,  // O

  // Referrals sheet columns (1-indexed)
  RCOL_CODE:           1,   // A — referral code
  RCOL_NAME:           2,   // B — referrer name
  RCOL_EMAIL:          3,   // C — referrer email
  RCOL_DATE:           4,   // D — date registered
  RCOL_COUNT:          5,   // E — successful referrals count
};

// ───────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function getSheet(name) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    Logger.log('ERROR: Sheet not found — ' + name);
    return null;
  }
  return sheet;
}

function safeSendEmail(to, subject, body, context) {
  if (!isValidEmail(to)) {
    Logger.log('SKIP email — invalid address: ' + to + ' [' + context + ']');
    return false;
  }
  try {
    MailApp.sendEmail(to, subject, body);
    return true;
  } catch (err) {
    Logger.log('ERROR sending email [' + context + ']: ' + err.message);
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 1: onFormSubmit — Fires on every Google Form submission
// Assigns Lead ID, sets Date + Status, processes any incoming referral
// code, alerts owner for Summer 2026 leads, refreshes Dashboard
// ───────────────────────────────────────────────────────────────────────
function onFormSubmit(e) {
  const sheet = getSheet(CONFIG.LEADS_SHEET);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();

  // Build Lead ID: L-YYYYMMDD-NNN (sequence resets daily)
  const today       = new Date();
  const dateStr     = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  const todayPrefix = 'L-' + dateStr + '-';

  let todayCount = 0;
  if (lastRow >= 3) {
    const ids = sheet.getRange(3, CONFIG.COL_LEAD_ID, lastRow - 2, 1).getValues().flat();
    todayCount = ids.filter(id => String(id).startsWith(todayPrefix)).length;
  }
  const seq    = String(todayCount + 1).padStart(3, '0');
  const leadId = todayPrefix + seq;

  sheet.getRange(lastRow, CONFIG.COL_LEAD_ID).setValue(leadId);
  sheet.getRange(lastRow, CONFIG.COL_DATE).setValue(
    Utilities.formatDate(today, Session.getScriptTimeZone(), 'MM/dd/yyyy')
  );
  sheet.getRange(lastRow, CONFIG.COL_STATUS).setValue('New');

  const season  = String(sheet.getRange(lastRow, CONFIG.COL_SEASON).getValue());
  const sport   = String(sheet.getRange(lastRow, CONFIG.COL_SPORT).getValue());
  const name    = String(sheet.getRange(lastRow, CONFIG.COL_NAME).getValue()).trim();
  const email   = String(sheet.getRange(lastRow, CONFIG.COL_EMAIL).getValue()).trim();
  const refCode = String(sheet.getRange(lastRow, CONFIG.COL_REF_CODE).getValue()).trim();

  // Credit the referrer if this lead came via a referral code
  if (refCode) {
    processReferralCode(refCode, name);
  }

  // Alert owner for Summer leads — limited indoor spots at La Redonda
  if (season.toLowerCase().includes('summer')) {
    const subject = '⚡ NEW SUMMER LEAD — ' + CONFIG.FRANCHISE_NAME;
    const body = `
A new Summer 2026 lead just came in — indoor spots are LIMITED.

Lead ID : ${leadId}
Name    : ${name}
Email   : ${email}
Sport   : ${sport}
Season  : ${season}

👉 Follow up within 24 hours to lock the spot.

Register link (La Redonda):
${CONFIG.REG_URL_SUMMER}
    `.trim();
    safeSendEmail(CONFIG.OWNER_EMAIL, subject, body, 'summer-alert');
  }

  updateDashboard();
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 2: onEdit — Fires when Status column changes to "Registered"
// Generates referral code (once per row), logs to Referrals sheet,
// emails parent their code + reward info, refreshes Dashboard
// ───────────────────────────────────────────────────────────────────────
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.LEADS_SHEET) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (col !== CONFIG.COL_STATUS) return;

  // Read cell directly — installable trigger e.value is not always populated
  const newStatus = String(sheet.getRange(row, col).getValue()).trim();
  if (newStatus !== 'Registered') return;

  const name  = String(sheet.getRange(row, CONFIG.COL_NAME).getValue()).trim();
  const email = String(sheet.getRange(row, CONFIG.COL_EMAIL).getValue()).trim();
  const sport = String(sheet.getRange(row, CONFIG.COL_SPORT).getValue()).trim();

  if (!name || !email) return;

  // Guard: skip if this row already has a referral code assigned
  const existingCode = String(sheet.getRange(row, CONFIG.COL_REF_CODE).getValue()).trim();
  if (existingCode) {
    Logger.log('Referral code already exists for row ' + row + ' — skipping duplicate.');
    updateDashboard();
    return;
  }

  // Generate referral code: REF-INITIALS-4DIGIT
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
  const rand4    = String(Math.floor(1000 + Math.random() * 9000));
  const refCode  = 'REF-' + initials + '-' + rand4;

  // Write code back to the Leads row so we can guard duplicates above
  sheet.getRange(row, CONFIG.COL_REF_CODE).setValue(refCode);

  // Log to Referrals sheet
  const refSheet = getSheet(CONFIG.REFERRALS_SHEET);
  if (refSheet) {
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy');
    refSheet.appendRow([refCode, name, email, today, 0]);
  }

  const firstName = name.split(' ')[0];
  const subject   = "You're registered! Share this & earn rewards — " + CONFIG.FRANCHISE_NAME;
  const body = `
Hi ${firstName},

Welcome to ${CONFIG.FRANCHISE_NAME}! We're excited to have your child on the field this season playing ${sport}.

As a registered family, you now have your own referral code:

🏅 YOUR CODE: ${refCode}

Every time a new family registers using your code, you earn $${CONFIG.REWARD_PER_REFERRAL} — every single time.

How to share:
• Tell a friend: "Register at i9 Sports and use code ${refCode}"
• Drop the code in your school's WhatsApp group
• DM us ${CONFIG.INSTAGRAM_1} and we'll help spread the word

Register link for friends:
${CONFIG.REG_URL_REGULAR}

Summer (La Redonda indoor, A/C):
${CONFIG.REG_URL_SUMMER}

Questions? Call or text: ${CONFIG.PHONE}
Follow us: ${CONFIG.INSTAGRAM_1} · ${CONFIG.INSTAGRAM_2}

See you Saturday!
Coach Mike & the ${CONFIG.FRANCHISE_NAME} Team
  `.trim();

  safeSendEmail(email, subject, body, 'referral-welcome');
  updateDashboard();
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 3: sendWeeklyDigest — Runs every Monday at 7am
// Pulls live Dashboard KPIs and emails owner a formatted summary
// ───────────────────────────────────────────────────────────────────────
function sendWeeklyDigest() {
  const dash = getSheet(CONFIG.DASHBOARD_SHEET);
  if (!dash) return;

  updateDashboard();

  const kpiData = dash.getRange(3, 1, 12, 2).getValues();
  const kpiRows = kpiData.map(([label, val]) => {
    if (!label) return null;
    const display = typeof val === 'number' && val > 0 && val < 1
      ? (val * 100).toFixed(1) + '%'
      : val;
    return '• ' + label + ': ' + display;
  }).filter(Boolean).join('\n');

  const week    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy');
  const subject = '📊 Weekly Lead Report — ' + CONFIG.FRANCHISE_NAME + ' — ' + week;
  const body = `
Good morning Coach Mike,

Here's your i9 Sports Northeast Dade lead summary for the week of ${week}:

${kpiRows}

──────────────────────────
ACTION ITEMS:
• Follow up on all "New" and "Contacted" leads within 48 hours
• Summer spots at La Redonda are limited — prioritize Summer 2026 leads
• Check the Source Summary sheet for top-performing school partners
• Any lead with a Follow-Up Date in the past = call today

Register links:
Regular season : ${CONFIG.REG_URL_REGULAR}
Summer (indoor): ${CONFIG.REG_URL_SUMMER}

${CONFIG.INSTAGRAM_1} · ${CONFIG.INSTAGRAM_2} · ${CONFIG.PHONE}

See you on the field!
  `.trim();

  safeSendEmail(CONFIG.OWNER_EMAIL, subject, body, 'weekly-digest');
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 4: sendFollowUpReminders — Runs daily at 6am
// Scans Leads sheet for overdue follow-ups and emails owner a list
// ───────────────────────────────────────────────────────────────────────
function sendFollowUpReminders() {
  const sheet = getSheet(CONFIG.LEADS_SHEET);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;

  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const data = sheet.getRange(3, 1, lastRow - 2, CONFIG.COL_NOTES).getValues();
  const overdue = [];

  data.forEach(row => {
    const status     = String(row[CONFIG.COL_STATUS - 1]).trim();
    const name       = String(row[CONFIG.COL_NAME - 1]).trim();
    const sport      = String(row[CONFIG.COL_SPORT - 1]).trim();
    const followUpRaw = row[CONFIG.COL_FOLLOWUP - 1];
    const dateRaw    = row[CONFIG.COL_DATE - 1];

    if (status !== 'New' && status !== 'Contacted') return;
    if (!name) return;

    let dueDate = null;

    if (followUpRaw instanceof Date && !isNaN(followUpRaw)) {
      dueDate = new Date(followUpRaw);
      dueDate.setHours(0, 0, 0, 0);
    } else if (status === 'New' && dateRaw) {
      // No follow-up date set — flag if lead is 2+ days old
      const entryDate = new Date(dateRaw);
      if (!isNaN(entryDate) && entryDate <= twoDaysAgo) {
        dueDate = entryDate;
      }
    }

    if (dueDate && dueDate <= today) {
      const dueFmt = Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'MM/dd/yyyy');
      overdue.push('• ' + name + ' | ' + sport + ' | ' + status + ' | Due: ' + dueFmt);
    }
  });

  if (overdue.length === 0) return;

  const subject = '⏰ Follow-Up Alert — ' + overdue.length + ' lead' +
    (overdue.length > 1 ? 's' : '') + ' need attention today';
  const body = `
Coach Mike,

The following leads are overdue for follow-up:

${overdue.join('\n')}

Call or text each one today. Summer leads especially — indoor spots are going fast.

Register links:
Regular season : ${CONFIG.REG_URL_REGULAR}
Summer (indoor): ${CONFIG.REG_URL_SUMMER}

${CONFIG.PHONE} · ${CONFIG.INSTAGRAM_1}
  `.trim();

  safeSendEmail(CONFIG.OWNER_EMAIL, subject, body, 'follow-up-reminders');
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 5: processReferralCode — Credits referrer when a new lead
// uses their code; called by onFormSubmit when COL_REF_CODE is set
// ───────────────────────────────────────────────────────────────────────
function processReferralCode(refCode, newLeadName) {
  const refSheet = getSheet(CONFIG.REFERRALS_SHEET);
  if (!refSheet) return;

  const lastRefRow = refSheet.getLastRow();
  if (lastRefRow < 2) return;

  const codes = refSheet.getRange(2, CONFIG.RCOL_CODE, lastRefRow - 1, 1).getValues().flat();
  const matchIndex = codes.findIndex(c => String(c).trim() === refCode.trim());

  if (matchIndex === -1) {
    Logger.log('Referral code not found: ' + refCode);
    return;
  }

  const dataRow = matchIndex + 2; // 1-indexed, offset for header row
  const referrerName  = String(refSheet.getRange(dataRow, CONFIG.RCOL_NAME).getValue()).trim();
  const referrerEmail = String(refSheet.getRange(dataRow, CONFIG.RCOL_EMAIL).getValue()).trim();
  const currentCount  = Number(refSheet.getRange(dataRow, CONFIG.RCOL_COUNT).getValue()) || 0;

  refSheet.getRange(dataRow, CONFIG.RCOL_COUNT).setValue(currentCount + 1);

  const totalEarned = (currentCount + 1) * CONFIG.REWARD_PER_REFERRAL;
  const firstName   = referrerName.split(' ')[0];
  const subject     = '🎉 You earned a reward! — ' + CONFIG.FRANCHISE_NAME;
  const body = `
Hi ${firstName},

Great news — ${newLeadName} just registered using your referral code ${refCode}!

You've earned $${CONFIG.REWARD_PER_REFERRAL} in i9 Sports credit.
Total rewards earned so far: $${totalEarned}

Keep sharing your code and keep earning. Every registration counts!

Your code: ${refCode}
Share the link: ${CONFIG.REG_URL_REGULAR}

Questions? ${CONFIG.PHONE} · ${CONFIG.INSTAGRAM_1}

See you on the field!
Coach Mike & the ${CONFIG.FRANCHISE_NAME} Team
  `.trim();

  safeSendEmail(referrerEmail, subject, body, 'referral-reward');
  Logger.log('Referral credited — code: ' + refCode + ' | referrer: ' + referrerName + ' | total: ' + (currentCount + 1));
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 6: updateDashboard — Computes KPIs from Leads + Referrals
// and writes them to Dashboard rows 3–14 col B. Called automatically
// after every form submission, status change, and daily triggers.
// ───────────────────────────────────────────────────────────────────────
function updateDashboard() {
  const leadSheet = getSheet(CONFIG.LEADS_SHEET);
  const dashSheet = getSheet(CONFIG.DASHBOARD_SHEET);
  const refSheet  = getSheet(CONFIG.REFERRALS_SHEET);
  if (!leadSheet || !dashSheet) return;

  const lastRow = leadSheet.getLastRow();
  const tz      = Session.getScriptTimeZone();
  const now     = new Date();

  // Start of current week (Monday)
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  weekStart.setDate(weekStart.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  let total = 0, countNew = 0, contacted = 0, registered = 0;
  let summerTotal = 0, summerRegistered = 0;
  let leadsThisWeek = 0, regThisWeek = 0;

  if (lastRow >= 3) {
    const data = leadSheet.getRange(3, 1, lastRow - 2, CONFIG.COL_NOTES).getValues();
    data.forEach(row => {
      const status  = String(row[CONFIG.COL_STATUS - 1]).trim();
      const season  = String(row[CONFIG.COL_SEASON - 1]).toLowerCase();
      const dateRaw = row[CONFIG.COL_DATE - 1];
      if (!row[CONFIG.COL_NAME - 1]) return;

      total++;
      if (status === 'New')        countNew++;
      if (status === 'Contacted')  contacted++;
      if (status === 'Registered') registered++;

      if (season.includes('summer')) {
        summerTotal++;
        if (status === 'Registered') summerRegistered++;
      }

      if (dateRaw) {
        const entryDate = new Date(dateRaw);
        if (!isNaN(entryDate) && entryDate >= weekStart) {
          leadsThisWeek++;
          if (status === 'Registered') regThisWeek++;
        }
      }
    });
  }

  const convRate        = total > 0 ? registered / total : 0;
  const summerConvRate  = summerTotal > 0 ? summerRegistered / summerTotal : 0;

  let totalReferralsSent  = 0;
  let referralRegistered  = 0;
  if (refSheet) {
    const refLast = refSheet.getLastRow();
    if (refLast >= 2) {
      const refData = refSheet.getRange(2, CONFIG.RCOL_CODE, refLast - 1, CONFIG.RCOL_COUNT).getValues();
      refData.forEach(r => {
        if (!r[CONFIG.RCOL_CODE - 1]) return;
        totalReferralsSent++;
        referralRegistered += Number(r[CONFIG.RCOL_COUNT - 1]) || 0;
      });
    }
  }

  const kpis = [
    ['Total Leads',              total],
    ['New',                      countNew],
    ['Contacted',                contacted],
    ['Registered',               registered],
    ['Conversion Rate',          convRate],
    ['Summer Leads',             summerTotal],
    ['Summer Registered',        summerRegistered],
    ['Summer Conversion Rate',   summerConvRate],
    ['Referral Codes Sent',      totalReferralsSent],
    ['Referral Registrations',   referralRegistered],
    ['Leads This Week',          leadsThisWeek],
    ['Registrations This Week',  regThisWeek],
  ];

  // Write label + value pairs starting at row 3
  kpis.forEach(([label, value], i) => {
    const r = 3 + i;
    dashSheet.getRange(r, 1).setValue(label);
    dashSheet.getRange(r, 2).setValue(value);
  });

  Logger.log('Dashboard updated — ' + Utilities.formatDate(now, tz, 'MM/dd/yyyy HH:mm'));
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 7: setupTriggers — Run ONCE manually after pasting this script
// Installs all triggers, clears old ones first to prevent duplicates
// ───────────────────────────────────────────────────────────────────────
function setupTriggers() {
  // Remove all existing triggers to prevent duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Form submit → assign Lead ID, process referral, alert owner
  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  // Edit → generate referral code when status → Registered
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  // Weekly digest — Mondays at 7am
  ScriptApp.newTrigger('sendWeeklyDigest')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7)
    .create();

  // Daily follow-up reminder — 6am every day
  ScriptApp.newTrigger('sendFollowUpReminders')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  // Daily dashboard refresh — 5:55am (before digest)
  ScriptApp.newTrigger('updateDashboard')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .nearMinute(55)
    .create();

  Logger.log('✅ All 5 triggers installed successfully.');
  Logger.log('Triggers: onFormSubmit | onEdit | sendWeeklyDigest (Mon 7am) | sendFollowUpReminders (daily 6am) | updateDashboard (daily 5:55am)');
  Logger.log('⚠️  Make sure CONFIG.OWNER_EMAIL is set before going live!');
}
