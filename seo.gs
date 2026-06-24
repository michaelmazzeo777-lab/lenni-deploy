// ═══════════════════════════════════════════════════════════════════════
// i9 SPORTS NORTHEAST DADE — SEO PLUGIN (claude-seo)
// Franchise #504 · Coach Mike · Highland Oaks + La Redonda
// ═══════════════════════════════════════════════════════════════════════
// FUNCTIONS IN THIS FILE
//   generateGBPPosts()        — weekly Google Business Profile posts
//   generateSchemaMarkup()    — LocalBusiness + SportsOrganization JSON-LD
//   generateMetaTags()        — per-page title/description/OG tags
//   generateKeywordContent()  — sport-specific keyword snippets
//   sendSeoWeeklyReport()     — emails owner a ready-to-copy SEO bundle
//   setupSeoTrigger()         — installs weekly Monday 8am trigger (run ONCE)
// ═══════════════════════════════════════════════════════════════════════

const SEO = {
  // ── Business identity ────────────────────────────────────────────────
  BUSINESS_NAME:    'i9 Sports Northeast Dade',
  FRANCHISE_NUM:    '504',
  OWNER_NAME:       'Coach Mike',
  PHONE:            '305-808-7425',
  EMAIL:            '[YOUR EMAIL HERE]',          // e.g. coachmike@i9sports.com

  // ── Service area ─────────────────────────────────────────────────────
  CITY:             'Aventura',
  STATE:            'FL',
  REGION:           'Northeast Dade County',
  ZIP_PRIMARY:      '33180',
  ZIPS_SERVED:      ['33160', '33162', '33180', '33181', '33160', '33004'],
  GEO_LAT:          25.9565,
  GEO_LNG:          -80.1395,

  // ── Venues ───────────────────────────────────────────────────────────
  VENUE_REGULAR: {
    name:    'Highland Oaks Middle School',
    address: '20949 NE 23rd Ct, Aventura, FL 33180',
    url:     'https://www.i9sports.com/venues/33180-highland-oaks-middle-school-youth-sports-programs/8260',
    type:    'Outdoor fields',
  },
  VENUE_SUMMER: {
    name:    'La Redonda Indoor Turf Field',
    address: 'Aventura, FL 33180',
    url:     'https://www.i9sports.com/venues/33180-la-redonda-indoor-turf-field-aventura-youth-sports-programs/12086',
    type:    'Indoor A/C turf',
  },

  // ── Social ───────────────────────────────────────────────────────────
  INSTAGRAM_1:   '@i9sportsIS504',
  INSTAGRAM_2:   '@i9sports504',

  // ── Sports offered ───────────────────────────────────────────────────
  SPORTS: ['Soccer', 'Flag Football', 'Basketball', 'Baseball', 'T-Ball', 'Volleyball', 'Cheerleading'],

  // ── Age ranges ───────────────────────────────────────────────────────
  AGES: '3–17',

  // ── Primary keywords (local SEO) ─────────────────────────────────────
  KEYWORDS_LOCAL: [
    'youth sports Aventura FL',
    'kids soccer Aventura',
    'youth flag football Northeast Dade',
    'kids basketball Aventura FL',
    'youth sports leagues 33180',
    'recreational sports for kids Miami',
    'after school sports Aventura',
    'youth baseball Aventura FL',
    'kids sports programs North Miami Beach',
    'summer sports camp Aventura indoor',
    'i9 sports Aventura',
    'i9 sports Northeast Dade County',
  ],

  // ── Season schedule ───────────────────────────────────────────────────
  SEASONS: {
    FALL:   { name: 'Fall 2025',   regOpen: 'August 2025' },
    WINTER: { name: 'Winter 2026', regOpen: 'November 2025' },
    SPRING: { name: 'Spring 2026', regOpen: 'February 2026' },
    SUMMER: { name: 'Summer 2026', regOpen: 'April 2026', venue: 'La Redonda (Indoor A/C)' },
  },
};

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 1: generateGBPPosts
// Returns an array of 4 ready-to-publish Google Business Profile posts
// covering registration CTA, summer indoor, referral, and sport spotlight.
// ───────────────────────────────────────────────────────────────────────
function generateGBPPosts() {
  const week = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy');

  const posts = [
    // Post 1 — Registration CTA (evergreen)
    {
      category: 'Registration CTA',
      text: `⚽🏈 Register now for ${SEO.SEASONS.SUMMER.name} at ${SEO.BUSINESS_NAME}!

Your kids ages ${SEO.AGES} can play ${SEO.SPORTS.slice(0, 4).join(', ')}, and more — all in a fun, no-stress environment where EVERY child plays.

☀️ Summer games at ${SEO.VENUE_SUMMER.name} — ${SEO.SEASONS.SUMMER.venue}. Spots are LIMITED.

📍 Serving ${SEO.REGION}: Aventura, North Miami Beach, Hallandale & surrounding communities
📞 Call/text: ${SEO.PHONE}
🔗 Register: ${SEO.VENUE_SUMMER.url}

${SEO.INSTAGRAM_1} | #i9Sports #YouthSports #AventuraFL #NortheastDade #KidsSports #SummerSports`,
    },

    // Post 2 — Indoor summer spotlight
    {
      category: 'Summer Indoor Venue',
      text: `❄️ Beat the Florida heat this summer with ${SEO.BUSINESS_NAME}!

We're playing ALL summer long at ${SEO.VENUE_SUMMER.name} — a fully air-conditioned indoor turf field right here in Aventura.

✅ Ages ${SEO.AGES}
✅ Soccer, Flag Football, Basketball & more
✅ No experience needed — all skill levels welcome
✅ Saturdays (check schedule online)

Limited spots — don't wait!
📞 ${SEO.PHONE}
🔗 ${SEO.VENUE_SUMMER.url}

#IndoorSports #AventuraKids #SummerCamp #YouthSoccer #YouthBasketball #NortheastDadeCounty #i9Sports504`,
    },

    // Post 3 — Referral program
    {
      category: 'Referral Program',
      text: `💰 Know a family looking for youth sports in Aventura? REFER THEM & EARN!

When you register your child with ${SEO.BUSINESS_NAME} you get your own referral code. Every time a friend registers using your code, you earn $10 in i9 Sports credit — with no limit!

How it works:
1️⃣ Register your child
2️⃣ Get your personal referral code
3️⃣ Share it with friends at school, in WhatsApp groups, at the park
4️⃣ Earn $10 credit for EVERY family that registers

📞 Questions? ${SEO.PHONE}
📲 DM us: ${SEO.INSTAGRAM_1}
🔗 ${SEO.VENUE_REGULAR.url}

#i9Sports #AventuraFL #ReferAndEarn #KidsSports #YouthSports #NortheastDade`,
    },

    // Post 4 — Sport spotlight (rotates through SEO.SPORTS)
    {
      category: 'Sport Spotlight',
      text: `🏈 SPORT SPOTLIGHT: Youth Flag Football in Aventura!

Looking for flag football for your kids in ${SEO.REGION}? ${SEO.BUSINESS_NAME} runs one of the best recreational flag football programs in the area — no tackle, no risk, all the fun.

✔ Ages ${SEO.AGES}
✔ Focus on fundamentals + teamwork
✔ Every child plays every game
✔ ${SEO.VENUE_REGULAR.name} (regular season) · ${SEO.VENUE_SUMMER.name} (summer)

Register today:
📞 ${SEO.PHONE}
🔗 ${SEO.VENUE_REGULAR.url}

#FlagFootball #YouthFootball #AventuraFL #KidsSports #i9Sports #NortheastDadeCounty #HealthyKids`,
    },
  ];

  Logger.log('=== GBP POSTS GENERATED — ' + week + ' ===');
  posts.forEach((p, i) => {
    Logger.log('\n--- Post ' + (i + 1) + ': ' + p.category + ' ---\n' + p.text + '\n');
  });

  return posts;
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 2: generateSchemaMarkup
// Returns JSON-LD schema strings for LocalBusiness + SportsOrganization.
// Paste each into your website's <head> or CMS schema field.
// ───────────────────────────────────────────────────────────────────────
function generateSchemaMarkup() {
  const localBusiness = {
    '@context':   'https://schema.org',
    '@type':      ['LocalBusiness', 'SportsOrganization'],
    'name':       SEO.BUSINESS_NAME,
    'description': `${SEO.BUSINESS_NAME} offers youth recreational sports leagues for kids ages ${SEO.AGES} in ${SEO.REGION}, including soccer, flag football, basketball, baseball, and more. Games held at ${SEO.VENUE_REGULAR.name} and ${SEO.VENUE_SUMMER.name} in Aventura, FL.`,
    'url':         SEO.VENUE_REGULAR.url,
    'telephone':   SEO.PHONE,
    'address': {
      '@type':           'PostalAddress',
      'streetAddress':   '20949 NE 23rd Ct',
      'addressLocality': SEO.CITY,
      'addressRegion':   SEO.STATE,
      'postalCode':      SEO.ZIP_PRIMARY,
      'addressCountry':  'US',
    },
    'geo': {
      '@type':     'GeoCoordinates',
      'latitude':  SEO.GEO_LAT,
      'longitude': SEO.GEO_LNG,
    },
    'areaServed': SEO.ZIPS_SERVED.map(zip => ({
      '@type':       'PostalAddress',
      'postalCode':  zip,
      'addressRegion': SEO.STATE,
      'addressCountry': 'US',
    })),
    'sameAs': [
      'https://www.instagram.com/i9sportsIS504',
      'https://www.instagram.com/i9sports504',
      'https://www.i9sports.com',
    ],
    'sport': SEO.SPORTS,
    'knowsAbout': SEO.KEYWORDS_LOCAL,
  };

  const schemaStr = JSON.stringify(localBusiness, null, 2);
  const scriptTag = '<script type="application/ld+json">\n' + schemaStr + '\n</script>';

  Logger.log('=== SCHEMA MARKUP (JSON-LD) ===');
  Logger.log(scriptTag);

  return { json: schemaStr, scriptTag };
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 3: generateMetaTags
// Returns SEO meta tags for key pages of the i9 Sports Northeast Dade
// web presence. Copy/paste into your CMS or website HTML <head>.
// ───────────────────────────────────────────────────────────────────────
function generateMetaTags() {
  const pages = [
    {
      page:        'Homepage / Venue',
      title:       `Youth Sports Leagues in Aventura FL | ${SEO.BUSINESS_NAME}`,
      description: `Register your child for youth soccer, flag football, basketball, baseball & more in Aventura, FL. ${SEO.BUSINESS_NAME} serves ages ${SEO.AGES} across Northeast Dade County. Call ${SEO.PHONE}.`,
      keywords:    'youth sports Aventura FL, kids soccer Northeast Dade, flag football Aventura, youth basketball 33180, i9 sports Aventura',
      ogTitle:     `${SEO.BUSINESS_NAME} — Youth Sports for Ages ${SEO.AGES} in Aventura`,
      ogDesc:      `Fun, safe recreational sports leagues in Aventura & Northeast Dade. Soccer, football, basketball & more. Register now!`,
    },
    {
      page:        'Summer Indoor (La Redonda)',
      title:       `Summer Indoor Youth Sports Aventura FL | ${SEO.BUSINESS_NAME}`,
      description: `Beat the heat! ${SEO.BUSINESS_NAME} hosts summer youth sports at ${SEO.VENUE_SUMMER.name} — a fully air-conditioned indoor turf field in Aventura. Ages ${SEO.AGES}. Limited spots. Call ${SEO.PHONE}.`,
      keywords:    'summer indoor sports Aventura, indoor youth soccer FL, air conditioned kids sports Miami, summer sports camp 33180',
      ogTitle:     `Indoor Summer Sports for Kids in Aventura — ${SEO.BUSINESS_NAME}`,
      ogDesc:      `Air-conditioned indoor turf at La Redonda. Soccer, flag football & basketball all summer. Register before spots fill up!`,
    },
    {
      page:        'Soccer Program',
      title:       `Youth Soccer Leagues Aventura FL | ${SEO.BUSINESS_NAME}`,
      description: `Youth soccer leagues for kids ages ${SEO.AGES} in Aventura, FL. ${SEO.BUSINESS_NAME} teaches fundamentals, teamwork & love of the game. No-cut, every child plays. Register at ${SEO.PHONE}.`,
      keywords:    'youth soccer Aventura FL, kids soccer leagues Northeast Dade, recreational soccer 33180, youth soccer Miami',
      ogTitle:     `Kids Soccer in Aventura FL — ${SEO.BUSINESS_NAME}`,
      ogDesc:      `No-cut youth soccer leagues where every child plays every game. Ages ${SEO.AGES} in Aventura & Northeast Dade County.`,
    },
    {
      page:        'Flag Football Program',
      title:       `Youth Flag Football Aventura FL | ${SEO.BUSINESS_NAME}`,
      description: `Youth flag football leagues in Aventura and Northeast Dade County. Safe, fun, non-contact for kids ages ${SEO.AGES}. ${SEO.BUSINESS_NAME} — call ${SEO.PHONE} to register.`,
      keywords:    'youth flag football Aventura, kids football Northeast Dade, flag football leagues 33180, recreational football Miami',
      ogTitle:     `Flag Football for Kids in Aventura — ${SEO.BUSINESS_NAME}`,
      ogDesc:      `Fun, no-tackle flag football leagues. Every child plays. Ages ${SEO.AGES} in Aventura FL.`,
    },
  ];

  Logger.log('=== META TAGS BY PAGE ===');
  pages.forEach(p => {
    Logger.log('\n--- ' + p.page + ' ---');
    Logger.log('<title>' + p.title + '</title>');
    Logger.log('<meta name="description" content="' + p.description + '">');
    Logger.log('<meta name="keywords" content="' + p.keywords + '">');
    Logger.log('<meta property="og:title" content="' + p.ogTitle + '">');
    Logger.log('<meta property="og:description" content="' + p.ogDesc + '">');
  });

  return pages;
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 4: generateKeywordContent
// Returns short, keyword-rich copy blocks for each sport.
// Use these on website sport pages, email campaigns, or social captions.
// ───────────────────────────────────────────────────────────────────────
function generateKeywordContent() {
  const sportContent = {
    'Soccer': {
      h1:   `Youth Soccer Leagues in Aventura, FL — ${SEO.BUSINESS_NAME}`,
      body: `Looking for youth soccer in Aventura or Northeast Dade County? ${SEO.BUSINESS_NAME} runs recreational soccer leagues for kids ages ${SEO.AGES} at ${SEO.VENUE_REGULAR.name}. Our no-cut program guarantees every child plays every game. Summer soccer is held indoors at ${SEO.VENUE_SUMMER.name} — fully air-conditioned. Register today: ${SEO.PHONE}.`,
      cta:  `Register for Soccer — ${SEO.VENUE_REGULAR.url}`,
    },
    'Flag Football': {
      h1:   `Youth Flag Football in Aventura, FL — ${SEO.BUSINESS_NAME}`,
      body: `${SEO.BUSINESS_NAME} offers youth flag football leagues for kids ages ${SEO.AGES} in Aventura and surrounding Northeast Dade communities. No contact, all the fun — we focus on skills, teamwork, and sportsmanship. Games are played Saturdays at ${SEO.VENUE_REGULAR.name}. Call us: ${SEO.PHONE}.`,
      cta:  `Register for Flag Football — ${SEO.VENUE_REGULAR.url}`,
    },
    'Basketball': {
      h1:   `Youth Basketball Leagues in Aventura, FL — ${SEO.BUSINESS_NAME}`,
      body: `Sign your child up for youth basketball with ${SEO.BUSINESS_NAME} in Aventura, FL. Ages ${SEO.AGES}. Our recreational basketball program builds fundamentals and confidence in a team-first environment. Every player gets court time every game. Questions? Call ${SEO.PHONE}.`,
      cta:  `Register for Basketball — ${SEO.VENUE_REGULAR.url}`,
    },
    'Baseball': {
      h1:   `Youth Baseball & T-Ball in Aventura, FL — ${SEO.BUSINESS_NAME}`,
      body: `${SEO.BUSINESS_NAME} brings youth baseball and T-Ball leagues to Northeast Dade County. Perfect for beginners and experienced players ages ${SEO.AGES}. Games at ${SEO.VENUE_REGULAR.name} on Saturdays. Register now: ${SEO.PHONE}.`,
      cta:  `Register for Baseball — ${SEO.VENUE_REGULAR.url}`,
    },
  };

  Logger.log('=== KEYWORD CONTENT BLOCKS BY SPORT ===');
  Object.entries(sportContent).forEach(([sport, content]) => {
    Logger.log('\n--- ' + sport + ' ---');
    Logger.log('H1: ' + content.h1);
    Logger.log('Body: ' + content.body);
    Logger.log('CTA: ' + content.cta);
  });

  return sportContent;
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 5: sendSeoWeeklyReport
// Emails Coach Mike a complete SEO bundle: GBP posts + meta tags +
// keyword content — ready to copy/paste with no editing needed.
// Triggered every Monday at 8am.
// ───────────────────────────────────────────────────────────────────────
function sendSeoWeeklyReport() {
  const week    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy');
  const posts   = generateGBPPosts();
  const metas   = generateMetaTags();
  const content = generateKeywordContent();

  // ── Section: GBP Posts ──
  let gbpSection = 'GOOGLE BUSINESS PROFILE POSTS\n' + '='.repeat(40) + '\n\n';
  posts.forEach((p, i) => {
    gbpSection += `POST ${i + 1} — ${p.category}\n${'-'.repeat(30)}\n${p.text}\n\n`;
  });

  // ── Section: Meta Tags ──
  let metaSection = 'META TAGS (paste into CMS <head>)\n' + '='.repeat(40) + '\n\n';
  metas.forEach(m => {
    metaSection += `PAGE: ${m.page}\n`;
    metaSection += `<title>${m.title}</title>\n`;
    metaSection += `<meta name="description" content="${m.description}">\n`;
    metaSection += `<meta name="keywords" content="${m.keywords}">\n`;
    metaSection += `<meta property="og:title" content="${m.ogTitle}">\n`;
    metaSection += `<meta property="og:description" content="${m.ogDesc}">\n\n`;
  });

  // ── Section: Keyword Content ──
  let kwSection = 'KEYWORD CONTENT BLOCKS (sport pages / email)\n' + '='.repeat(40) + '\n\n';
  Object.entries(content).forEach(([sport, c]) => {
    kwSection += `SPORT: ${sport}\nH1: ${c.h1}\nBody: ${c.body}\nCTA: ${c.cta}\n\n`;
  });

  // ── Section: Local Keywords ──
  const kwList = 'LOCAL SEO KEYWORDS TO TARGET\n' + '='.repeat(40) + '\n' +
    SEO.KEYWORDS_LOCAL.map(k => '• ' + k).join('\n') + '\n\n';

  const subject = `🔍 SEO Bundle — ${SEO.BUSINESS_NAME} — ${week}`;
  const body = `Good morning ${SEO.OWNER_NAME},

Here is your weekly SEO content bundle for ${SEO.BUSINESS_NAME}.
Copy-paste each section directly — no editing required.

${'─'.repeat(60)}
${gbpSection}
${'─'.repeat(60)}
${metaSection}
${'─'.repeat(60)}
${kwSection}
${'─'.repeat(60)}
${kwList}
${'─'.repeat(60)}
QUICK SEO CHECKLIST — WEEK OF ${week.toUpperCase()}
• [ ] Post 1–2 GBP updates from the posts above
• [ ] Verify Google Business Profile hours & photos are current
• [ ] Respond to any new Google reviews within 24 hours
• [ ] Check that registration links in GBP are pointing to current season
• [ ] Share one post on ${SEO.INSTAGRAM_1} using the sport spotlight copy

${SEO.PHONE} · ${SEO.INSTAGRAM_1} · ${SEO.INSTAGRAM_2}
  `.trim();

  if (!isValidSeoEmail(SEO.EMAIL)) {
    Logger.log('SEO report not sent — SEO.EMAIL not configured.');
    return;
  }
  MailApp.sendEmail(SEO.EMAIL, subject, body);
  Logger.log('SEO weekly report sent to ' + SEO.EMAIL);
}

// ───────────────────────────────────────────────────────────────────────
// HELPER: isValidSeoEmail — basic guard before sending
// ───────────────────────────────────────────────────────────────────────
function isValidSeoEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

// ───────────────────────────────────────────────────────────────────────
// FUNCTION 6: setupSeoTrigger
// Run ONCE manually. Installs weekly Monday 8am trigger for SEO report.
// ───────────────────────────────────────────────────────────────────────
function setupSeoTrigger() {
  // Remove existing SEO triggers to prevent duplicates
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendSeoWeeklyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendSeoWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  Logger.log('✅ SEO trigger installed — sendSeoWeeklyReport fires every Monday at 8am.');
  Logger.log('⚠️  Set SEO.EMAIL before going live!');
}
