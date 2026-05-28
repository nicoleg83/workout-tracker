// Real exercise images extracted from PDF guides.
// IMAGE_KEYS lists every image_key that has a real JPEG in icons/exercises/.
const IMAGE_KEYS = new Set([
  // Day 1 — Push
  'barbell-bench-press','barbell-overhead-press','dumbbell-front-raise',
  'dumbbell-lateral-raise','lateral-raise-pulse','overhead-dumbbell-press',
  'arnold-press','dumbbell-overhead-hold','dumbbell-alternating-bench-press',
  'tricep-kickback','incline-dumbbell-chest-press','cable-tricep-pushdown',
  'single-arm-cable-chest-press','cable-chest-fly','overhead-press-machine',
  'pec-deck-fly','lateral-raise-machine','machine-chest-press',
  'incline-chest-press-machine','overhead-tricep-extension-2arm',
  'overhead-tricep-extension-1arm','z-press',
  // Day 2 — Pull
  'ez-bar-curl','bent-over-dumbbell-row','alternating-dumbbell-curl',
  'dumbbell-shrugs','hammer-curl','rear-delt-fly','incline-dumbbell-back-fly',
  'cable-face-pull','incline-dumbbell-curl','assisted-pull-up',
  'band-pull-apart','wide-grip-lat-pulldown','close-grip-cable-row','seated-cable-row',
  'trap-3-raise','straight-arm-pulldown','lat-pull-machine','superman-hold',
  // Day 3 — Legs
  'barbell-back-squat','goblet-squat','straight-leg-back-lunge',
  'standing-calf-raises','romanian-deadlift','plie-squat','single-leg-deadlift',
  'side-lunges','reverse-lunges','split-squat','dumbbell-step-up',
  'bulgarian-split-squat','kettlebell-sumo-squat-to-press','jump-squats',
  'cable-glute-kickback','leg-press','hip-abduction','hip-adduction',
  'lateral-band-walk','groucho-walk','dumbbell-glute-bridge','wall-sit',
]);

function getExerciseMedia(imageKey) {
  if (IMAGE_KEYS.has(imageKey)) {
    return `<div class="exercise-media-wrap"><img class="exercise-media-img" src="icons/exercises/${imageKey}.png" alt="" loading="lazy" /></div>`;
  }
  const svg = ILLUSTRATIONS[imageKey] || ILLUSTRATIONS['_placeholder'];
  return `<div class="exercise-media-wrap exercise-media-svg">${svg}</div>`;
}

const _attr = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;

// Shared figure fragments
const _head = (cx=60,cy=18) => `<circle cx="${cx}" cy="${cy}" r="8"/>`;
const _torso = (x=60,y1=26,y2=75) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`;
const _hips = (hx=60,hy=75) => `<line x1="${hx}" y1="${hy}" x2="${hx-12}" y2="${hy+8}"/><line x1="${hx}" y1="${hy}" x2="${hx+12}" y2="${hy+8}"/>`;
const _legs = (hx=60,hy=75) => `
  <line x1="${hx-12}" y1="${hy+8}" x2="${hx-14}" y2="${hy+42}"/>
  <line x1="${hx-14}" y1="${hy+42}" x2="${hx-16}" y2="${hy+72}"/>
  <line x1="${hx+12}" y1="${hy+8}" x2="${hx+14}" y2="${hy+42}"/>
  <line x1="${hx+14}" y1="${hy+42}" x2="${hx+16}" y2="${hy+72}"/>`;
const _feet = (hx=60,hy=75) => `
  <line x1="${hx-16}" y1="${hy+72}" x2="${hx-22}" y2="${hy+75}"/>
  <line x1="${hx+16}" y1="${hy+72}" x2="${hx+22}" y2="${hy+75}"/>`;
const _armsDown = (sx=60,sy=35) => `
  <line x1="${sx}" y1="${sy}" x2="${sx-18}" y2="${sy+18}"/>
  <line x1="${sx-18}" y1="${sy+18}" x2="${sx-20}" y2="${sy+36}"/>
  <line x1="${sx}" y1="${sy}" x2="${sx+18}" y2="${sy+18}"/>
  <line x1="${sx+18}" y1="${sy+18}" x2="${sx+20}" y2="${sy+36}"/>`;
const _db = (x,y) => `<circle cx="${x}" cy="${y}" r="4" fill="currentColor"/>`;
const _dbs = (lx,ly,rx,ry) => _db(lx,ly)+_db(rx,ry);

function _standing(armsHtml='') {
  return `<svg ${_attr}>${_head()}${_torso()}${_hips()}${_legs()}${_feet()}${armsHtml}</svg>`;
}

const ILLUSTRATIONS = {

  // ── PLACEHOLDER ──────────────────────────────────────────────
  '_placeholder': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    ${_armsDown()}
    ${_dbs(40,71,80,71)}
  </svg>`,

  // ── DAY 1 — PUSH ─────────────────────────────────────────────

  'barbell-bench-press': `<svg ${_attr}>
    <!-- Figure lying on bench -->
    <rect x="10" y="82" width="100" height="8" rx="2"/>
    <circle cx="60" cy="72" r="8"/>
    <line x1="60" y1="80" x2="60" y2="82"/>
    <line x1="28" y1="82" x2="20" y2="82"/>
    <line x1="92" y1="82" x2="100" y2="82"/>
    <!-- Arms pressing bar up -->
    <line x1="60" y1="45" x2="42" y2="58"/>
    <line x1="60" y1="45" x2="78" y2="58"/>
    <line x1="42" y1="58" x2="40" y2="75"/>
    <line x1="78" y1="58" x2="80" y2="75"/>
    <!-- Barbell -->
    <line x1="20" y1="44" x2="100" y2="44"/>
    <circle cx="20" cy="44" r="5"/>
    <circle cx="100" cy="44" r="5"/>
    <!-- Legs on bench -->
    <line x1="28" y1="82" x2="24" y2="118"/>
    <line x1="92" y1="82" x2="96" y2="118"/>
    <line x1="24" y1="118" x2="22" y2="148"/>
    <line x1="96" y1="118" x2="98" y2="148"/>
  </svg>`,

  'barbell-overhead-press': `<svg ${_attr}>
    ${_head()}
    <line x1="60" y1="26" x2="60" y2="75"/>
    ${_hips()}${_legs()}${_feet()}
    <!-- Arms overhead with bar -->
    <line x1="60" y1="35" x2="38" y2="20"/>
    <line x1="60" y1="35" x2="82" y2="20"/>
    <line x1="22" y1="17" x2="98" y2="17"/>
    <circle cx="22" cy="17" r="5"/>
    <circle cx="98" cy="17" r="5"/>
  </svg>`,

  'dumbbell-front-raise': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms raised forward -->
    <line x1="60" y1="35" x2="38" y2="28"/>
    <line x1="38" y1="28" x2="30" y2="20"/>
    <line x1="60" y1="35" x2="82" y2="28"/>
    <line x1="82" y1="28" x2="90" y2="20"/>
    ${_dbs(28,18,92,18)}
  </svg>`,

  'dumbbell-lateral-raise': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms out to sides -->
    <line x1="60" y1="35" x2="30" y2="42"/>
    <line x1="30" y1="42" x2="18" y2="40"/>
    <line x1="60" y1="35" x2="90" y2="42"/>
    <line x1="90" y1="42" x2="102" y2="40"/>
    ${_dbs(15,40,105,40)}
  </svg>`,

  'lateral-raise-pulse': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms at shoulder height, slight pulse position -->
    <line x1="60" y1="35" x2="28" y2="36"/>
    <line x1="28" y1="36" x2="16" y2="35"/>
    <line x1="60" y1="35" x2="92" y2="36"/>
    <line x1="92" y1="36" x2="104" y2="35"/>
    ${_dbs(13,35,107,35)}
    <!-- Motion dots -->
    <circle cx="16" cy="30" r="1.5" fill="currentColor"/>
    <circle cx="104" cy="30" r="1.5" fill="currentColor"/>
  </svg>`,

  'overhead-dumbbell-press': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms pressed overhead -->
    <line x1="60" y1="35" x2="38" y2="28"/>
    <line x1="38" y1="28" x2="36" y2="12"/>
    <line x1="60" y1="35" x2="82" y2="28"/>
    <line x1="82" y1="28" x2="84" y2="12"/>
    ${_dbs(36,9,84,9)}
  </svg>`,

  'arnold-press': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms mid-rotation (palms rotating out, pressing up) -->
    <line x1="60" y1="35" x2="40" y2="30"/>
    <line x1="40" y1="30" x2="34" y2="15"/>
    <line x1="60" y1="35" x2="80" y2="30"/>
    <line x1="80" y1="30" x2="86" y2="15"/>
    ${_dbs(34,12,86,12)}
    <!-- Rotation arc indicator -->
    <path d="M 38 36 Q 36 30 40 26" stroke-dasharray="3,2"/>
  </svg>`,

  'dumbbell-overhead-hold': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms fully extended overhead, holding -->
    <line x1="60" y1="35" x2="38" y2="26"/>
    <line x1="38" y1="26" x2="36" y2="10"/>
    <line x1="60" y1="35" x2="82" y2="26"/>
    <line x1="82" y1="26" x2="84" y2="10"/>
    ${_dbs(36,7,84,7)}
    <!-- Hold indicator (small lines) -->
    <line x1="28" y1="7" x2="32" y2="7" stroke-width="1.5"/>
    <line x1="88" y1="7" x2="92" y2="7" stroke-width="1.5"/>
  </svg>`,

  'dumbbell-alternating-bench-press': `<svg ${_attr}>
    <!-- Figure on bench, one arm up one arm mid -->
    <rect x="10" y="82" width="100" height="8" rx="2"/>
    <circle cx="60" cy="72" r="8"/>
    <line x1="60" y1="80" x2="60" y2="82"/>
    <line x1="28" y1="82" x2="24" y2="118"/>
    <line x1="92" y1="82" x2="96" y2="118"/>
    <line x1="24" y1="118" x2="22" y2="148"/>
    <line x1="96" y1="118" x2="98" y2="148"/>
    <!-- One arm up, one arm at chest -->
    <line x1="60" y1="48" x2="42" y2="44"/>
    <line x1="42" y1="44" x2="40" y2="30"/>
    <line x1="60" y1="48" x2="78" y2="55"/>
    <line x1="78" y1="55" x2="80" y2="70"/>
    ${_dbs(40,27,80,68)}
  </svg>`,

  'tricep-kickback': `<svg ${_attr}>
    ${_head(40,18)}
    <!-- Bent over, one hand on bench -->
    <line x1="40" y1="26" x2="60" y2="55"/>
    <!-- Support arm on bench -->
    <line x1="60" y1="55" x2="75" y2="62"/>
    <line x1="75" y1="62" x2="85" y2="70"/>
    <rect x="82" y="70" width="30" height="6" rx="2"/>
    <!-- Kickback arm extended back -->
    <line x1="60" y1="55" x2="45" y2="48"/>
    <line x1="45" y1="48" x2="30" y2="40"/>
    ${_db(28,38)}
    <!-- Hips and legs -->
    <line x1="60" y1="55" x2="52" y2="62"/>
    <line x1="60" y1="55" x2="68" y2="62"/>
    <line x1="52" y1="62" x2="48" y2="100"/>
    <line x1="68" y1="62" x2="72" y2="100"/>
    <line x1="48" y1="100" x2="46" y2="140"/>
    <line x1="72" y1="100" x2="74" y2="140"/>
  </svg>`,

  'incline-dumbbell-chest-press': `<svg ${_attr}>
    <!-- Incline bench -->
    <line x1="15" y1="148" x2="90" y2="70"/>
    <line x1="90" y1="70" x2="105" y2="70"/>
    <line x1="15" y1="148" x2="20" y2="148"/>
    <!-- Figure on incline -->
    <circle cx="88" cy="58" r="8"/>
    <line x1="88" y1="66" x2="75" y2="90"/>
    <line x1="75" y1="90" x2="55" y2="130"/>
    <!-- Arms pressing dumbbells -->
    <line x1="82" y1="68" x2="68" y2="55"/>
    <line x1="68" y1="55" x2="62" y2="42"/>
    <line x1="94" y1="68" x2="100" y2="55"/>
    <line x1="100" y1="55" x2="104" y2="42"/>
    ${_dbs(60,39,106,39)}
  </svg>`,

  'cable-tricep-pushdown': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Cable from top -->
    <line x1="60" y1="0" x2="60" y2="15" stroke-dasharray="3,2"/>
    <line x1="50" y1="15" x2="70" y2="15"/>
    <!-- Arms pushed down, elbows tucked -->
    <line x1="60" y1="35" x2="48" y2="42"/>
    <line x1="48" y1="42" x2="46" y2="60"/>
    <line x1="60" y1="35" x2="72" y2="42"/>
    <line x1="72" y1="42" x2="74" y2="60"/>
    <line x1="46" y1="60" x2="74" y2="60"/>
  </svg>`,

  'single-arm-cable-chest-press': `<svg ${_attr}>
    ${_head(48,18)}
    <line x1="48" y1="26" x2="48" y2="75"/>
    <line x1="48" y1="75" x2="36" y2="83"/>
    <line x1="48" y1="75" x2="60" y2="83"/>
    <line x1="36" y1="83" x2="32" y2="118"/>
    <line x1="60" y1="83" x2="64" y2="118"/>
    <line x1="32" y1="118" x2="30" y2="148"/>
    <line x1="64" y1="118" x2="66" y2="148"/>
    <!-- Cable arm pressing forward -->
    <line x1="48" y1="38" x2="32" y2="35"/>
    <line x1="32" y1="35" x2="16" y2="38"/>
    <!-- Cable -->
    <line x1="16" y1="38" x2="5" y2="30" stroke-dasharray="3,2"/>
    <!-- Pressing arm -->
    <line x1="48" y1="38" x2="66" y2="35"/>
    <line x1="66" y1="35" x2="82" y2="38"/>
    ${_db(83,38)}
  </svg>`,

  'cable-chest-fly': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms bringing cables together -->
    <line x1="60" y1="38" x2="34" y2="30"/>
    <line x1="34" y1="30" x2="15" y2="25"/>
    <line x1="60" y1="38" x2="86" y2="30"/>
    <line x1="86" y1="30" x2="105" y2="25"/>
    <!-- Cable lines -->
    <line x1="15" y1="25" x2="5" y2="15" stroke-dasharray="3,2"/>
    <line x1="105" y1="25" x2="115" y2="15" stroke-dasharray="3,2"/>
    <!-- Hands meeting at center (crossed cables) -->
    <circle cx="15" cy="25" r="3" fill="currentColor"/>
    <circle cx="105" cy="25" r="3" fill="currentColor"/>
  </svg>`,

  'overhead-press-machine': `<svg ${_attr}>
    <!-- Machine frame -->
    <rect x="10" y="10" width="100" height="148" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <!-- Seat -->
    <rect x="30" y="100" width="60" height="8" rx="2"/>
    <rect x="42" y="108" width="36" height="40" rx="2"/>
    <!-- Figure seated -->
    <circle cx="60" cy="80" r="8"/>
    <line x1="60" y1="88" x2="60" y2="100"/>
    <!-- Arms pressing handles up -->
    <line x1="60" y1="92" x2="40" y2="80"/>
    <line x1="40" y1="80" x2="36" y2="62"/>
    <line x1="60" y1="92" x2="80" y2="80"/>
    <line x1="80" y1="80" x2="84" y2="62"/>
    <line x1="30" y1="58" x2="90" y2="58"/>
  </svg>`,

  'pec-deck-fly': `<svg ${_attr}>
    <!-- Machine frame -->
    <rect x="10" y="30" width="100" height="120" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <!-- Seat -->
    <rect x="32" y="100" width="56" height="8" rx="2"/>
    <!-- Pads -->
    <rect x="20" y="70" width="16" height="30" rx="3"/>
    <rect x="84" y="70" width="16" height="30" rx="3"/>
    <!-- Figure seated, arms on pads -->
    <circle cx="60" cy="68" r="8"/>
    <line x1="60" y1="76" x2="60" y2="100"/>
    <line x1="60" y1="82" x2="36" y2="82"/>
    <line x1="60" y1="82" x2="84" y2="82"/>
  </svg>`,

  'lateral-raise-machine': `<svg ${_attr}>
    <rect x="10" y="30" width="100" height="120" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <rect x="32" y="100" width="56" height="8" rx="2"/>
    <circle cx="60" cy="68" r="8"/>
    <line x1="60" y1="76" x2="60" y2="100"/>
    <!-- Arms raising outward on machine pads -->
    <line x1="60" y1="82" x2="32" y2="75"/>
    <line x1="32" y1="75" x2="22" y2="70"/>
    <line x1="60" y1="82" x2="88" y2="75"/>
    <line x1="88" y1="75" x2="98" y2="70"/>
    <rect x="14" y="66" width="12" height="8" rx="2"/>
    <rect x="94" y="66" width="12" height="8" rx="2"/>
  </svg>`,

  'machine-chest-press': `<svg ${_attr}>
    <rect x="10" y="30" width="100" height="120" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <rect x="32" y="100" width="56" height="8" rx="2"/>
    <circle cx="60" cy="68" r="8"/>
    <line x1="60" y1="76" x2="60" y2="100"/>
    <!-- Arms pressing forward -->
    <line x1="60" y1="82" x2="38" y2="80"/>
    <line x1="38" y1="80" x2="24" y2="82"/>
    <line x1="60" y1="82" x2="82" y2="80"/>
    <line x1="82" y1="80" x2="96" y2="82"/>
    <line x1="18" y1="78" x2="18" y2="90"/>
    <line x1="102" y1="78" x2="102" y2="90"/>
  </svg>`,

  'incline-chest-press-machine': `<svg ${_attr}>
    <rect x="10" y="20" width="100" height="130" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <!-- Inclined seat back -->
    <line x1="30" y1="148" x2="85" y2="80"/>
    <rect x="32" y="100" width="50" height="8" rx="2"/>
    <circle cx="80" cy="68" r="8"/>
    <line x1="80" y1="76" x2="70" y2="100"/>
    <!-- Arms pressing up and forward -->
    <line x1="80" y1="80" x2="62" y2="70"/>
    <line x1="62" y1="70" x2="52" y2="56"/>
    <line x1="80" y1="80" x2="94" y2="74"/>
    <line x1="94" y1="74" x2="100" y2="62"/>
  </svg>`,

  'overhead-tricep-extension-2arm': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Both hands holding one DB overhead, lowered behind head -->
    <line x1="60" y1="35" x2="44" y2="26"/>
    <line x1="44" y1="26" x2="42" y2="10"/>
    <line x1="60" y1="35" x2="76" y2="26"/>
    <line x1="76" y1="26" x2="78" y2="10"/>
    <!-- Single dumbbell behind head -->
    <line x1="42" y1="10" x2="78" y2="10"/>
    <circle cx="60" cy="10" r="5" fill="currentColor"/>
  </svg>`,

  'overhead-tricep-extension-1arm': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- One arm overhead, elbow bent, DB behind head -->
    <line x1="60" y1="35" x2="74" y2="24"/>
    <line x1="74" y1="24" x2="70" y2="10"/>
    ${_db(70,8)}
    <!-- Other arm down -->
    <line x1="60" y1="35" x2="44" y2="44"/>
    <line x1="44" y1="44" x2="40" y2="62"/>
    ${_db(40,65)}
  </svg>`,

  'z-press': `<svg ${_attr}>
    <!-- Figure seated on floor, legs straight, pressing overhead -->
    <circle cx="60" cy="60" r="8"/>
    <line x1="60" y1="68" x2="60" y2="96"/>
    <!-- Legs out straight -->
    <line x1="60" y1="96" x2="20" y2="110"/>
    <line x1="20" y1="110" x2="14" y2="140"/>
    <line x1="60" y1="96" x2="100" y2="110"/>
    <line x1="100" y1="110" x2="106" y2="140"/>
    <line x1="14" y1="140" x2="8" y2="145"/>
    <line x1="106" y1="140" x2="112" y2="145"/>
    <!-- Arms pressing overhead -->
    <line x1="60" y1="76" x2="40" y2="66"/>
    <line x1="40" y1="66" x2="36" y2="50"/>
    <line x1="60" y1="76" x2="80" y2="66"/>
    <line x1="80" y1="66" x2="84" y2="50"/>
    ${_dbs(34,47,86,47)}
  </svg>`,

  // ── DAY 2 — PULL ──────────────────────────────────────────────

  'ez-bar-curl': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms curling EZ bar -->
    <line x1="60" y1="35" x2="40" y2="44"/>
    <line x1="40" y1="44" x2="36" y2="62"/>
    <line x1="60" y1="35" x2="80" y2="44"/>
    <line x1="80" y1="44" x2="84" y2="62"/>
    <!-- EZ bar (wavy) -->
    <path d="M 30 62 Q 36 58 42 62 Q 48 66 54 62 Q 60 58 66 62 Q 72 66 78 62 Q 84 58 90 62"/>
    <circle cx="28" cy="62" r="4" fill="currentColor"/>
    <circle cx="92" cy="62" r="4" fill="currentColor"/>
  </svg>`,

  'bent-over-dumbbell-row': `<svg ${_attr}>
    <!-- Figure bent over 45° -->
    <circle cx="55" cy="30" r="8"/>
    <line x1="55" y1="38" x2="68" y2="70"/>
    <line x1="68" y1="70" x2="60" y2="78"/>
    <line x1="68" y1="70" x2="76" y2="78"/>
    <line x1="60" y1="78" x2="56" y2="118"/>
    <line x1="76" y1="78" x2="80" y2="118"/>
    <line x1="56" y1="118" x2="54" y2="148"/>
    <line x1="80" y1="118" x2="82" y2="148"/>
    <!-- Arms rowing dumbbells up -->
    <line x1="62" y1="46" x2="48" y2="40"/>
    <line x1="48" y1="40" x2="36" y2="48"/>
    <line x1="62" y1="46" x2="76" y2="40"/>
    <line x1="76" y1="40" x2="88" y2="48"/>
    ${_dbs(33,50,90,50)}
  </svg>`,

  'alternating-dumbbell-curl': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- One arm curling up, one arm down -->
    <line x1="60" y1="35" x2="42" y2="44"/>
    <line x1="42" y1="44" x2="38" y2="28"/>
    ${_db(38,26)}
    <line x1="60" y1="35" x2="78" y2="44"/>
    <line x1="78" y1="44" x2="82" y2="62"/>
    ${_db(82,66)}
    <!-- Arrow showing alternation -->
    <path d="M 30 70 Q 28 55 38 35" stroke-dasharray="2,2" stroke-width="1.5"/>
  </svg>`,

  'dumbbell-shrugs': `<svg ${_attr}>
    <!-- Figure with shoulders raised in shrug -->
    <circle cx="60" cy="20" r="8"/>
    <line x1="60" y1="28" x2="60" y2="36"/>
    <line x1="60" y1="36" x2="60" y2="76"/>
    ${_hips()}${_legs()}${_feet()}
    <!-- Shoulders raised high -->
    <line x1="60" y1="36" x2="34" y2="30"/>
    <line x1="34" y1="30" x2="30" y2="48"/>
    <line x1="60" y1="36" x2="86" y2="30"/>
    <line x1="86" y1="30" x2="90" y2="48"/>
    ${_dbs(28,52,92,52)}
    <!-- Upward arrows for shrug -->
    <path d="M 38 28 L 36 22 M 36 22 L 34 26 M 36 22 L 40 26" stroke-width="1.5"/>
    <path d="M 82 28 L 84 22 M 84 22 L 80 26 M 84 22 L 88 26" stroke-width="1.5"/>
  </svg>`,

  'hammer-curl': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms curling, palms facing in (neutral grip) -->
    <line x1="60" y1="35" x2="42" y2="44"/>
    <line x1="42" y1="44" x2="38" y2="30"/>
    <!-- Vertical dumbbell (neutral grip indicator) -->
    <line x1="38" y1="24" x2="38" y2="32"/>
    <circle cx="38" cy="23" r="3.5" fill="currentColor"/>
    <circle cx="38" cy="33" r="3.5" fill="currentColor"/>
    <line x1="60" y1="35" x2="78" y2="44"/>
    <line x1="78" y1="44" x2="82" y2="30"/>
    <line x1="82" y1="24" x2="82" y2="32"/>
    <circle cx="82" cy="23" r="3.5" fill="currentColor"/>
    <circle cx="82" cy="33" r="3.5" fill="currentColor"/>
  </svg>`,

  'rear-delt-fly': `<svg ${_attr}>
    <!-- Figure bent forward, arms raising to sides -->
    <circle cx="55" cy="30" r="8"/>
    <line x1="55" y1="38" x2="65" y2="65"/>
    <line x1="65" y1="65" x2="55" y2="72"/>
    <line x1="65" y1="65" x2="75" y2="72"/>
    <line x1="55" y1="72" x2="50" y2="115"/>
    <line x1="75" y1="72" x2="78" y2="115"/>
    <line x1="50" y1="115" x2="48" y2="148"/>
    <line x1="78" y1="115" x2="80" y2="148"/>
    <!-- Arms raising out to sides -->
    <line x1="60" y1="50" x2="40" y2="38"/>
    <line x1="40" y1="38" x2="22" y2="32"/>
    <line x1="60" y1="50" x2="80" y2="38"/>
    <line x1="80" y1="38" x2="98" y2="32"/>
    ${_dbs(20,30,100,30)}
  </svg>`,

  'incline-dumbbell-back-fly': `<svg ${_attr}>
    <!-- Figure face-down on incline bench -->
    <line x1="15" y1="148" x2="100" y2="60"/>
    <line x1="100" y1="60" x2="110" y2="60"/>
    <circle cx="98" cy="48" r="8"/>
    <line x1="98" y1="56" x2="82" y2="78"/>
    <!-- Arms hanging then raising to sides -->
    <line x1="90" y1="62" x2="76" y2="54"/>
    <line x1="76" y1="54" x2="62" y2="48"/>
    <line x1="90" y1="62" x2="100" y2="52"/>
    <line x1="100" y1="52" x2="110" y2="44"/>
    ${_dbs(60,46,112,42)}
  </svg>`,

  'trap-3-raise': `<svg ${_attr}>
    <!-- Figure face-down on incline, arms in Y position -->
    <line x1="15" y1="148" x2="100" y2="60"/>
    <line x1="100" y1="60" x2="110" y2="60"/>
    <circle cx="98" cy="48" r="8"/>
    <line x1="98" y1="56" x2="82" y2="78"/>
    <!-- Arms in Y shape overhead -->
    <line x1="90" y1="60" x2="72" y2="42"/>
    <line x1="72" y1="42" x2="58" y2="28"/>
    <line x1="90" y1="60" x2="106" y2="46"/>
    <line x1="106" y1="46" x2="116" y2="34"/>
    ${_dbs(56,26,118,32)}
    <!-- Thumbs up indicator -->
    <line x1="56" y1="26" x2="52" y2="22"/>
  </svg>`,

  'incline-dumbbell-curl': `<svg ${_attr}>
    <!-- Figure seated on incline bench, arms hanging down -->
    <line x1="20" y1="148" x2="88" y2="75"/>
    <line x1="88" y1="75" x2="105" y2="75"/>
    <circle cx="88" cy="63" r="8"/>
    <line x1="88" y1="71" x2="78" y2="95"/>
    <!-- Arms hanging and curling -->
    <line x1="82" y1="74" x2="66" y2="80"/>
    <line x1="66" y1="80" x2="58" y2="95"/>
    <line x1="94" y1="74" x2="108" y2="80"/>
    <line x1="108" y1="80" x2="112" y2="96"/>
    ${_dbs(56,98,114,98)}
  </svg>`,

  'cable-face-pull': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Cable from front at face height -->
    <line x1="112" y1="38" x2="85" y2="38" stroke-dasharray="3,2"/>
    <!-- Arms pulling rope to face, elbows high -->
    <line x1="60" y1="35" x2="80" y2="28"/>
    <line x1="80" y1="28" x2="88" y2="38"/>
    <line x1="60" y1="35" x2="74" y2="30"/>
    <line x1="74" y1="30" x2="82" y2="38"/>
    <!-- Rope attachment -->
    <line x1="82" y1="36" x2="94" y2="36"/>
    <line x1="82" y1="40" x2="94" y2="40"/>
  </svg>`,

  'straight-arm-pulldown': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Cable from overhead -->
    <line x1="60" y1="0" x2="60" y2="15" stroke-dasharray="3,2"/>
    <!-- Arms straight, pulling bar to thighs -->
    <line x1="60" y1="35" x2="42" y2="28"/>
    <line x1="42" y1="28" x2="36" y2="70"/>
    <line x1="60" y1="35" x2="78" y2="28"/>
    <line x1="78" y1="28" x2="84" y2="70"/>
    <line x1="30" y1="16" x2="90" y2="16"/>
    <line x1="36" y1="70" x2="84" y2="70"/>
  </svg>`,

  'close-grip-cable-row': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Standing, pulling V-bar to upper abs -->
    <line x1="5" y1="55" x2="40" y2="55" stroke-dasharray="3,2"/>
    <!-- Arms pulling in, elbows back -->
    <line x1="60" y1="35" x2="44" y2="44"/>
    <line x1="44" y1="44" x2="38" y2="55"/>
    <line x1="60" y1="35" x2="76" y2="44"/>
    <line x1="76" y1="44" x2="82" y2="55"/>
    <!-- V-bar -->
    <path d="M 38 55 L 44 62 L 50 55"/>
    <path d="M 82 55 L 76 62 L 70 55"/>
    <line x1="50" y1="55" x2="70" y2="55"/>
  </svg>`,

  'seated-cable-row': `<svg ${_attr}>
    <!-- Figure seated -->
    <circle cx="60" cy="50" r="8"/>
    <line x1="60" y1="58" x2="60" y2="90"/>
    <!-- Seat -->
    <rect x="40" y="90" width="44" height="6" rx="2"/>
    <!-- Legs out (feet on platform) -->
    <line x1="50" y1="96" x2="26" y2="108"/>
    <line x1="70" y1="96" x2="94" y2="108"/>
    <line x1="26" y1="108" x2="18" y2="110"/>
    <line x1="94" y1="108" x2="102" y2="110"/>
    <!-- Arms pulling handle to torso -->
    <line x1="60" y1="68" x2="42" y2="62"/>
    <line x1="42" y1="62" x2="24" y2="66"/>
    <line x1="60" y1="68" x2="78" y2="62"/>
    <line x1="78" y1="62" x2="96" y2="66"/>
    <!-- Cable back -->
    <line x1="24" y1="66" x2="5" y2="66" stroke-dasharray="3,2"/>
  </svg>`,

  'wide-grip-lat-pulldown': `<svg ${_attr}>
    <!-- Figure seated at lat pulldown machine -->
    <circle cx="60" cy="45" r="8"/>
    <line x1="60" y1="53" x2="60" y2="85"/>
    <rect x="36" y="85" width="48" height="6" rx="2"/>
    <!-- Wide bar overhead -->
    <line x1="18" y1="28" x2="102" y2="28"/>
    <circle cx="16" cy="28" r="4"/>
    <circle cx="104" cy="28" r="4"/>
    <!-- Cable from ceiling -->
    <line x1="60" y1="0" x2="60" y2="28" stroke-dasharray="3,2"/>
    <!-- Arms wide, pulling bar down to chest -->
    <line x1="60" y1="55" x2="36" y2="42"/>
    <line x1="36" y1="42" x2="20" y2="30"/>
    <line x1="60" y1="55" x2="84" y2="42"/>
    <line x1="84" y1="42" x2="100" y2="30"/>
  </svg>`,

  'lat-pull-machine': `<svg ${_attr}>
    <rect x="10" y="10" width="100" height="148" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <circle cx="60" cy="52" r="8"/>
    <line x1="60" y1="60" x2="60" y2="92"/>
    <rect x="36" y="92" width="48" height="6" rx="2"/>
    <!-- Thigh pad -->
    <rect x="36" y="82" width="48" height="10" rx="2"/>
    <!-- Wide bar -->
    <line x1="18" y1="28" x2="102" y2="28"/>
    <circle cx="16" cy="28" r="4"/>
    <circle cx="104" cy="28" r="4"/>
    <!-- Arms pulling bar down -->
    <line x1="60" y1="60" x2="36" y2="46"/>
    <line x1="36" y1="46" x2="20" y2="30"/>
    <line x1="60" y1="60" x2="84" y2="46"/>
    <line x1="84" y1="46" x2="100" y2="30"/>
  </svg>`,

  'assisted-pull-up': `<svg ${_attr}>
    <!-- Pull-up bar at top -->
    <line x1="10" y1="18" x2="110" y2="18"/>
    <line x1="10" y1="10" x2="10" y2="18"/>
    <line x1="110" y1="10" x2="110" y2="18"/>
    <!-- Figure hanging, pulling up -->
    <circle cx="60" cy="40" r="8"/>
    <line x1="60" y1="48" x2="60" y2="85"/>
    <!-- Arms gripping bar -->
    <line x1="60" y1="50" x2="40" y2="35"/>
    <line x1="40" y1="35" x2="34" y2="18"/>
    <line x1="60" y1="50" x2="80" y2="35"/>
    <line x1="80" y1="35" x2="86" y2="18"/>
    <!-- Legs hanging -->
    <line x1="60" y1="85" x2="52" y2="90"/>
    <line x1="60" y1="85" x2="68" y2="90"/>
    <line x1="52" y1="90" x2="48" y2="120"/>
    <line x1="68" y1="90" x2="72" y2="120"/>
    <line x1="48" y1="120" x2="46" y2="148"/>
    <line x1="72" y1="120" x2="74" y2="148"/>
    <!-- Assistance platform (dotted) -->
    <line x1="30" y1="148" x2="90" y2="148" stroke-dasharray="4,3"/>
  </svg>`,

  'band-pull-apart': `<svg ${_attr}>
    ${_head()}${_torso()}${_hips()}${_legs()}${_feet()}
    <!-- Arms pulling band apart at chest height -->
    <line x1="60" y1="35" x2="36" y2="46"/>
    <line x1="36" y1="46" x2="18" y2="46"/>
    <line x1="60" y1="35" x2="84" y2="46"/>
    <line x1="84" y1="46" x2="102" y2="46"/>
    <!-- Band (stretched) -->
    <path d="M 18 46 Q 36 44 60 46 Q 84 48 102 46" stroke-dasharray="4,2"/>
    <circle cx="18" cy="46" r="3" fill="currentColor"/>
    <circle cx="102" cy="46" r="3" fill="currentColor"/>
  </svg>`,

  'superman-hold': `<svg ${_attr}>
    <!-- Figure face-down, arms and legs raised -->
    <circle cx="60" cy="85" r="8"/>
    <line x1="60" y1="93" x2="60" y2="110"/>
    <!-- Arms raised overhead -->
    <line x1="54" y1="90" x2="36" y2="78"/>
    <line x1="36" y1="78" x2="22" y2="70"/>
    <line x1="66" y1="90" x2="84" y2="78"/>
    <line x1="84" y1="78" x2="98" y2="70"/>
    <!-- Legs raised -->
    <line x1="56" y1="112" x2="40" y2="122"/>
    <line x1="40" y1="122" x2="28" y2="138"/>
    <line x1="64" y1="112" x2="80" y2="122"/>
    <line x1="80" y1="122" x2="92" y2="138"/>
    <!-- Ground line -->
    <line x1="10" y1="108" x2="110" y2="108" stroke-width="1.5"/>
  </svg>`,

  // ── DAY 3 — LEGS ──────────────────────────────────────────────

  'barbell-back-squat': `<svg ${_attr}>
    <!-- Figure in squat position with barbell on back -->
    <circle cx="60" cy="18" r="8"/>
    <!-- Barbell across shoulders -->
    <line x1="18" y1="30" x2="102" y2="30"/>
    <circle cx="16" cy="30" r="5" fill="currentColor"/>
    <circle cx="104" cy="30" r="5" fill="currentColor"/>
    <line x1="60" y1="26" x2="60" y2="38"/>
    <line x1="60" y1="32" x2="40" y2="34"/>
    <line x1="60" y1="32" x2="80" y2="34"/>
    <!-- Torso upright in squat -->
    <line x1="60" y1="38" x2="58" y2="78"/>
    <!-- Hips low -->
    <line x1="58" y1="78" x2="44" y2="86"/>
    <line x1="58" y1="78" x2="72" y2="86"/>
    <!-- Thighs parallel to ground -->
    <line x1="44" y1="86" x2="30" y2="88"/>
    <line x1="72" y1="86" x2="86" y2="88"/>
    <!-- Shins -->
    <line x1="30" y1="88" x2="26" y2="140"/>
    <line x1="86" y1="88" x2="90" y2="140"/>
    <line x1="26" y1="140" x2="18" y2="145"/>
    <line x1="90" y1="140" x2="98" y2="145"/>
  </svg>`,

  'goblet-squat': `<svg ${_attr}>
    <circle cx="60" cy="25" r="8"/>
    <!-- DB held at chest -->
    <circle cx="60" cy="40" r="6" fill="currentColor"/>
    <line x1="60" y1="33" x2="60" y2="40"/>
    <!-- Torso -->
    <line x1="60" y1="40" x2="58" y2="78"/>
    <!-- Arms holding DB -->
    <line x1="58" y1="44" x2="46" y2="42"/>
    <line x1="58" y1="44" x2="70" y2="42"/>
    <!-- Squat position -->
    <line x1="58" y1="78" x2="44" y2="88"/>
    <line x1="58" y1="78" x2="72" y2="88"/>
    <line x1="44" y1="88" x2="28" y2="90"/>
    <line x1="72" y1="88" x2="88" y2="90"/>
    <line x1="28" y1="90" x2="24" y2="142"/>
    <line x1="88" y1="90" x2="92" y2="142"/>
    <line x1="24" y1="142" x2="16" y2="148"/>
    <line x1="92" y1="142" x2="100" y2="148"/>
  </svg>`,

  'straight-leg-back-lunge': `<svg ${_attr}>
    <circle cx="55" cy="18" r="8"/>
    <line x1="55" y1="26" x2="55" y2="70"/>
    <line x1="55" y1="70" x2="46" y2="76"/>
    <line x1="55" y1="70" x2="64" y2="76"/>
    <!-- Arms with dumbbells at sides -->
    <line x1="55" y1="36" x2="38" y2="46"/>
    <line x1="38" y1="46" x2="34" y2="68"/>
    <line x1="55" y1="36" x2="72" y2="46"/>
    <line x1="72" y1="46" x2="76" y2="68"/>
    ${_dbs(32,72,78,72)}
    <!-- Front leg bent -->
    <line x1="46" y1="76" x2="38" y2="120"/>
    <line x1="38" y1="120" x2="34" y2="148"/>
    <!-- Back leg straight (lunge back) -->
    <line x1="64" y1="76" x2="80" y2="110"/>
    <line x1="80" y1="110" x2="90" y2="148"/>
    <line x1="34" y1="148" x2="28" y2="152"/>
    <line x1="90" y1="148" x2="96" y2="152"/>
  </svg>`,

  'standing-calf-raises': `<svg ${_attr}>
    <!-- Figure on tip-toes -->
    <circle cx="60" cy="18" r="8"/>
    <line x1="60" y1="26" x2="60" y2="75"/>
    ${_hips(60,75)}
    <!-- Arms at sides -->
    <line x1="60" y1="35" x2="42" y2="48"/>
    <line x1="42" y1="48" x2="40" y2="65"/>
    <line x1="60" y1="35" x2="78" y2="48"/>
    <line x1="78" y1="48" x2="80" y2="65"/>
    <!-- Legs on tiptoe -->
    <line x1="48" y1="83" x2="44" y2="116"/>
    <line x1="72" y1="83" x2="76" y2="116"/>
    <!-- Raised heel -->
    <line x1="44" y1="116" x2="40" y2="128"/>
    <line x1="76" y1="116" x2="80" y2="128"/>
    <!-- Toes on ground -->
    <line x1="40" y1="128" x2="46" y2="148"/>
    <line x1="80" y1="128" x2="74" y2="148"/>
    <line x1="46" y1="148" x2="36" y2="150"/>
    <line x1="74" y1="148" x2="84" y2="150"/>
  </svg>`,

  'romanian-deadlift': `<svg ${_attr}>
    <!-- Figure hinged at hips, back flat -->
    <circle cx="62" cy="28" r="8"/>
    <line x1="62" y1="36" x2="74" y2="68"/>
    <line x1="74" y1="68" x2="66" y2="76"/>
    <line x1="74" y1="68" x2="82" y2="76"/>
    <!-- Legs straight, slight knee bend -->
    <line x1="66" y1="76" x2="60" y2="118"/>
    <line x1="82" y1="76" x2="86" y2="118"/>
    <line x1="60" y1="118" x2="58" y2="148"/>
    <line x1="86" y1="118" x2="88" y2="148"/>
    <line x1="58" y1="148" x2="50" y2="153"/>
    <line x1="88" y1="148" x2="96" y2="153"/>
    <!-- Arms hanging, holding DBs -->
    <line x1="68" y1="44" x2="54" y2="50"/>
    <line x1="54" y1="50" x2="48" y2="68"/>
    <line x1="68" y1="44" x2="80" y2="50"/>
    <line x1="80" y1="50" x2="88" y2="68"/>
    ${_dbs(46,72,90,72)}
  </svg>`,

  'plie-squat': `<svg ${_attr}>
    <!-- Wide stance, toes out, deep squat -->
    <circle cx="60" cy="30" r="8"/>
    <!-- DB at chest -->
    <circle cx="60" cy="46" r="5" fill="currentColor"/>
    <line x1="60" y1="38" x2="60" y2="46"/>
    <line x1="60" y1="46" x2="60" y2="78"/>
    <!-- Wide legs -->
    <line x1="60" y1="78" x2="34" y2="88"/>
    <line x1="60" y1="78" x2="86" y2="88"/>
    <!-- Thighs low, plie position -->
    <line x1="34" y1="88" x2="20" y2="100"/>
    <line x1="86" y1="88" x2="100" y2="100"/>
    <!-- Shins angled out (toes pointed) -->
    <line x1="20" y1="100" x2="16" y2="148"/>
    <line x1="100" y1="100" x2="104" y2="148"/>
    <line x1="16" y1="148" x2="8" y2="152"/>
    <line x1="104" y1="148" x2="112" y2="152"/>
  </svg>`,

  'single-leg-deadlift': `<svg ${_attr}>
    <!-- Figure balanced on one leg, other leg extended back -->
    <circle cx="55" cy="30" r="8"/>
    <line x1="55" y1="38" x2="62" y2="65"/>
    <!-- Standing leg -->
    <line x1="62" y1="65" x2="58" y2="110"/>
    <line x1="58" y1="110" x2="56" y2="148"/>
    <line x1="56" y1="148" x2="48" y2="153"/>
    <!-- Raised back leg -->
    <line x1="62" y1="65" x2="76" y2="72"/>
    <line x1="76" y1="72" x2="96" y2="68"/>
    <line x1="96" y1="68" x2="108" y2="62"/>
    <!-- Arms with DBs hanging down -->
    <line x1="58" y1="44" x2="46" y2="50"/>
    <line x1="46" y1="50" x2="42" y2="68"/>
    <line x1="58" y1="44" x2="68" y2="50"/>
    <line x1="68" y1="50" x2="72" y2="68"/>
    ${_dbs(40,72,74,72)}
  </svg>`,

  'side-lunges': `<svg ${_attr}>
    <!-- Figure stepping wide to one side, lead knee bent -->
    <circle cx="52" cy="28" r="8"/>
    <line x1="52" y1="36" x2="52" y2="70"/>
    <!-- Arms with DBs at sides -->
    <line x1="52" y1="40" x2="36" y2="50"/>
    <line x1="36" y1="50" x2="32" y2="68"/>
    <line x1="52" y1="40" x2="68" y2="50"/>
    <line x1="68" y1="50" x2="72" y2="68"/>
    ${_dbs(30,72,74,72)}
    <!-- Lead leg lunging to side (bent) -->
    <line x1="52" y1="70" x2="30" y2="80"/>
    <line x1="30" y1="80" x2="14" y2="90"/>
    <line x1="14" y1="90" x2="12" y2="148"/>
    <line x1="12" y1="148" x2="6" y2="153"/>
    <!-- Trailing leg straight -->
    <line x1="52" y1="70" x2="72" y2="78"/>
    <line x1="72" y1="78" x2="90" y2="80"/>
    <line x1="90" y1="80" x2="94" y2="148"/>
    <line x1="94" y1="148" x2="100" y2="153"/>
  </svg>`,

  'reverse-lunges': `<svg ${_attr}>
    <circle cx="50" cy="18" r="8"/>
    <line x1="50" y1="26" x2="50" y2="68"/>
    <!-- Arms with DBs -->
    <line x1="50" y1="36" x2="34" y2="46"/>
    <line x1="34" y1="46" x2="30" y2="64"/>
    <line x1="50" y1="36" x2="66" y2="46"/>
    <line x1="66" y1="46" x2="70" y2="64"/>
    ${_dbs(28,68,72,68)}
    <!-- Front leg -->
    <line x1="50" y1="68" x2="42" y2="74"/>
    <line x1="42" y1="74" x2="38" y2="118"/>
    <line x1="38" y1="118" x2="36" y2="148"/>
    <line x1="36" y1="148" x2="28" y2="153"/>
    <!-- Back leg (stepped back, knee near ground) -->
    <line x1="50" y1="68" x2="62" y2="76"/>
    <line x1="62" y1="76" x2="82" y2="90"/>
    <line x1="82" y1="90" x2="88" y2="120"/>
    <line x1="88" y1="120" x2="86" y2="148"/>
    <line x1="86" y1="148" x2="92" y2="153"/>
  </svg>`,

  'split-squat': `<svg ${_attr}>
    <!-- Figure in split stance, both feet planted, lowered -->
    <circle cx="55" cy="22" r="8"/>
    <line x1="55" y1="30" x2="55" y2="70"/>
    <!-- Arms with DBs -->
    <line x1="55" y1="40" x2="38" y2="50"/>
    <line x1="38" y1="50" x2="34" y2="68"/>
    <line x1="55" y1="40" x2="72" y2="50"/>
    <line x1="72" y1="50" x2="76" y2="68"/>
    ${_dbs(32,72,78,72)}
    <!-- Front leg (knee bent ~90°) -->
    <line x1="55" y1="70" x2="42" y2="76"/>
    <line x1="42" y1="76" x2="34" y2="116"/>
    <line x1="34" y1="116" x2="32" y2="148"/>
    <!-- Back leg (knee near ground) -->
    <line x1="55" y1="70" x2="68" y2="78"/>
    <line x1="68" y1="78" x2="82" y2="100"/>
    <line x1="82" y1="100" x2="84" y2="148"/>
    <line x1="32" y1="148" x2="24" y2="153"/>
    <line x1="84" y1="148" x2="90" y2="153"/>
  </svg>`,

  'dumbbell-step-up': `<svg ${_attr}>
    <!-- Box/bench -->
    <rect x="20" y="110" width="80" height="38" rx="3"/>
    <!-- Figure stepping up, one foot on box -->
    <circle cx="55" cy="42" r="8"/>
    <line x1="55" y1="50" x2="55" y2="90"/>
    <!-- Arms with DBs -->
    <line x1="55" y1="60" x2="38" y2="70"/>
    <line x1="38" y1="70" x2="34" y2="88"/>
    <line x1="55" y1="60" x2="72" y2="70"/>
    <line x1="72" y1="70" x2="76" y2="88"/>
    ${_dbs(32,92,78,92)}
    <!-- Lead leg on box (knee raised) -->
    <line x1="55" y1="90" x2="44" y2="96"/>
    <line x1="44" y1="96" x2="40" y2="110"/>
    <!-- Trailing leg on ground -->
    <line x1="55" y1="90" x2="66" y2="98"/>
    <line x1="66" y1="98" x2="72" y2="148"/>
    <line x1="72" y1="148" x2="78" y2="153"/>
  </svg>`,

  'bulgarian-split-squat': `<svg ${_attr}>
    <!-- Bench behind -->
    <rect x="62" y="112" width="52" height="12" rx="2"/>
    <!-- Figure: front leg bent, rear foot on bench -->
    <circle cx="45" cy="28" r="8"/>
    <line x1="45" y1="36" x2="45" y2="76"/>
    <!-- Arms with DBs -->
    <line x1="45" y1="46" x2="30" y2="56"/>
    <line x1="30" y1="56" x2="26" y2="74"/>
    <line x1="45" y1="46" x2="60" y2="56"/>
    <line x1="60" y1="56" x2="64" y2="74"/>
    ${_dbs(24,78,66,78)}
    <!-- Front leg -->
    <line x1="45" y1="76" x2="36" y2="82"/>
    <line x1="36" y1="82" x2="30" y2="124"/>
    <line x1="30" y1="124" x2="28" y2="148"/>
    <line x1="28" y1="148" x2="20" y2="153"/>
    <!-- Rear leg elevated on bench -->
    <line x1="45" y1="76" x2="60" y2="86"/>
    <line x1="60" y1="86" x2="74" y2="112"/>
  </svg>`,

  'kettlebell-sumo-squat-to-press': `<svg ${_attr}>
    <!-- Figure in sumo squat pressing KB overhead -->
    <circle cx="60" cy="18" r="8"/>
    <!-- Arms pressing KB overhead -->
    <line x1="60" y1="26" x2="46" y2="20"/>
    <line x1="46" y1="20" x2="42" y2="10"/>
    <line x1="60" y1="26" x2="74" y2="20"/>
    <line x1="74" y1="20" x2="78" y2="10"/>
    <!-- Kettlebell at top -->
    <circle cx="60" cy="8" r="5"/>
    <path d="M 52 12 Q 60 6 68 12"/>
    <!-- Torso -->
    <line x1="60" y1="26" x2="58" y2="72"/>
    <!-- Wide sumo stance legs -->
    <line x1="58" y1="72" x2="36" y2="82"/>
    <line x1="58" y1="72" x2="80" y2="82"/>
    <!-- Thighs parallel -->
    <line x1="36" y1="82" x2="20" y2="86"/>
    <line x1="80" y1="82" x2="96" y2="86"/>
    <line x1="20" y1="86" x2="14" y2="148"/>
    <line x1="96" y1="86" x2="102" y2="148"/>
    <line x1="14" y1="148" x2="6" y2="153"/>
    <line x1="102" y1="148" x2="110" y2="153"/>
  </svg>`,

  'jump-squats': `<svg ${_attr}>
    <!-- Figure in air, arms raised, legs tucked slightly -->
    <circle cx="60" cy="22" r="8"/>
    <line x1="60" y1="30" x2="60" y2="72"/>
    <!-- Arms up (momentum) -->
    <line x1="60" y1="40" x2="42" y2="28"/>
    <line x1="42" y1="28" x2="36" y2="18"/>
    <line x1="60" y1="40" x2="78" y2="28"/>
    <line x1="78" y1="28" x2="84" y2="18"/>
    <!-- Legs slightly bent (airborne) -->
    <line x1="60" y1="72" x2="46" y2="80"/>
    <line x1="46" y1="80" x2="40" y2="105"/>
    <line x1="40" y1="105" x2="38" y2="130"/>
    <line x1="60" y1="72" x2="74" y2="80"/>
    <line x1="74" y1="80" x2="80" y2="105"/>
    <line x1="80" y1="105" x2="82" y2="130"/>
    <!-- Ground line below -->
    <line x1="10" y1="148" x2="110" y2="148" stroke-dasharray="4,3"/>
    <!-- Jump arrows -->
    <path d="M 55 148 L 55 138 M 55 138 L 52 143 M 55 138 L 58 143" stroke-width="1.5"/>
    <path d="M 65 148 L 65 138 M 65 138 L 62 143 M 65 138 L 68 143" stroke-width="1.5"/>
  </svg>`,

  'cable-glute-kickback': `<svg ${_attr}>
    <!-- Figure facing cable machine, one leg kicking back -->
    <circle cx="55" cy="28" r="8"/>
    <line x1="55" y1="36" x2="58" y2="72"/>
    <!-- Arms holding support -->
    <line x1="55" y1="46" x2="40" y2="52"/>
    <line x1="40" y1="52" x2="28" y2="52"/>
    <line x1="55" y1="46" x2="64" y2="52"/>
    <line x1="64" y1="52" x2="78" y2="52"/>
    <!-- Standing leg -->
    <line x1="58" y1="72" x2="50" y2="78"/>
    <line x1="50" y1="78" x2="46" y2="120"/>
    <line x1="46" y1="120" x2="44" y2="148"/>
    <!-- Kickback leg extended behind -->
    <line x1="58" y1="72" x2="70" y2="78"/>
    <line x1="70" y1="78" x2="88" y2="90"/>
    <line x1="88" y1="90" x2="106" y2="96"/>
    <!-- Ankle strap / cable -->
    <line x1="106" y1="96" x2="115" y2="100" stroke-dasharray="3,2"/>
  </svg>`,

  'leg-press': `<svg ${_attr}>
    <!-- Leg press machine (reclined figure, legs pressing platform) -->
    <rect x="5" y="80" width="110" height="70" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <!-- Reclined seat/back -->
    <line x1="15" y1="148" x2="80" y2="90"/>
    <!-- Figure reclined -->
    <circle cx="78" cy="80" r="8"/>
    <line x1="78" y1="88" x2="65" y2="115"/>
    <!-- Arms on handles -->
    <line x1="72" y1="88" x2="60" y2="95"/>
    <line x1="84" y1="88" x2="96" y2="95"/>
    <!-- Legs pressing platform up -->
    <line x1="65" y1="115" x2="56" y2="120"/>
    <line x1="65" y1="115" x2="72" y2="120"/>
    <line x1="56" y1="120" x2="40" y2="96"/>
    <line x1="72" y1="120" x2="56" y2="96"/>
    <!-- Platform -->
    <line x1="30" y1="92" x2="66" y2="92"/>
  </svg>`,

  'hip-abduction': `<svg ${_attr}>
    <!-- Seated machine, legs pushing out -->
    <rect x="10" y="70" width="100" height="80" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <rect x="32" y="100" width="56" height="8" rx="2"/>
    <circle cx="60" cy="68" r="8"/>
    <line x1="60" y1="76" x2="60" y2="100"/>
    <!-- Legs pushed wide apart (abduction) -->
    <line x1="50" y1="108" x2="24" y2="118"/>
    <line x1="24" y1="118" x2="16" y2="148"/>
    <line x1="70" y1="108" x2="96" y2="118"/>
    <line x1="96" y1="118" x2="104" y2="148"/>
    <!-- Outer thigh pads -->
    <rect x="10" y="106" width="16" height="20" rx="2"/>
    <rect x="94" y="106" width="16" height="20" rx="2"/>
    <!-- Arrow showing outward push -->
    <path d="M 42 115 L 30 115 M 30 115 L 34 112 M 30 115 L 34 118" stroke-width="1.5"/>
    <path d="M 78 115 L 90 115 M 90 115 L 86 112 M 90 115 L 86 118" stroke-width="1.5"/>
  </svg>`,

  'hip-adduction': `<svg ${_attr}>
    <rect x="10" y="70" width="100" height="80" rx="4" stroke-width="1.5" stroke-dasharray="4,3"/>
    <rect x="32" y="100" width="56" height="8" rx="2"/>
    <circle cx="60" cy="68" r="8"/>
    <line x1="60" y1="76" x2="60" y2="100"/>
    <!-- Legs squeezed together (adduction) -->
    <line x1="50" y1="108" x2="42" y2="118"/>
    <line x1="42" y1="118" x2="40" y2="148"/>
    <line x1="70" y1="108" x2="78" y2="118"/>
    <line x1="78" y1="118" x2="80" y2="148"/>
    <!-- Inner thigh pads -->
    <rect x="44" y="106" width="12" height="20" rx="2"/>
    <rect x="64" y="106" width="12" height="20" rx="2"/>
    <!-- Arrow showing inward squeeze -->
    <path d="M 42 115 L 54 115 M 54 115 L 50 112 M 54 115 L 50 118" stroke-width="1.5"/>
    <path d="M 78 115 L 66 115 M 66 115 L 70 112 M 66 115 L 70 118" stroke-width="1.5"/>
  </svg>`,

  'lateral-band-walk': `<svg ${_attr}>
    <!-- Figure in partial squat stepping sideways with band -->
    <circle cx="55" cy="28" r="8"/>
    <line x1="55" y1="36" x2="55" y2="72"/>
    <!-- Arms out for balance -->
    <line x1="55" y1="46" x2="34" y2="52"/>
    <line x1="55" y1="46" x2="76" y2="52"/>
    <!-- Hips low (squat stance) -->
    <line x1="55" y1="72" x2="36" y2="80"/>
    <line x1="55" y1="72" x2="74" y2="80"/>
    <!-- Wide stance legs -->
    <line x1="36" y1="80" x2="28" y2="124"/>
    <line x1="74" y1="80" x2="86" y2="124"/>
    <line x1="28" y1="124" x2="24" y2="148"/>
    <line x1="86" y1="124" x2="90" y2="148"/>
    <!-- Resistance band around thighs -->
    <path d="M 36 88 Q 55 84 74 88" stroke-dasharray="4,2"/>
    <line x1="24" y1="148" x2="16" y2="153"/>
    <line x1="90" y1="148" x2="98" y2="153"/>
    <!-- Side arrow -->
    <path d="M 100 80 L 112 80 M 112 80 L 108 77 M 112 80 L 108 83" stroke-width="1.5"/>
  </svg>`,

  'groucho-walk': `<svg ${_attr}>
    <!-- Figure walking in deep squat position -->
    <circle cx="52" cy="40" r="8"/>
    <line x1="52" y1="48" x2="52" y2="82"/>
    <!-- Arms bent for balance -->
    <line x1="52" y1="56" x2="34" y2="62"/>
    <line x1="34" y1="62" x2="28" y2="74"/>
    <line x1="52" y1="56" x2="70" y2="62"/>
    <line x1="70" y1="62" x2="78" y2="74"/>
    <!-- Deep squat legs, one stepping forward -->
    <line x1="52" y1="82" x2="36" y2="90"/>
    <line x1="36" y1="90" x2="22" y2="88"/>
    <line x1="22" y1="88" x2="16" y2="148"/>
    <line x1="52" y1="82" x2="68" y2="90"/>
    <line x1="68" y1="90" x2="82" y2="92"/>
    <line x1="82" y1="92" x2="88" y2="148"/>
    <line x1="16" y1="148" x2="10" y2="153"/>
    <line x1="88" y1="148" x2="94" y2="153"/>
    <!-- Forward arrows -->
    <path d="M 96 100 L 108 100 M 108 100 L 104 97 M 108 100 L 104 103" stroke-width="1.5"/>
  </svg>`,

  'dumbbell-glute-bridge': `<svg ${_attr}>
    <!-- Figure on back, hips raised, DB on hips -->
    <!-- Ground -->
    <line x1="10" y1="148" x2="110" y2="148" stroke-width="1.5"/>
    <!-- Upper back/shoulders on ground -->
    <circle cx="60" cy="80" r="8"/>
    <line x1="60" y1="88" x2="44" y2="96"/>
    <line x1="60" y1="88" x2="76" y2="96"/>
    <!-- Torso raised (hips up) -->
    <line x1="52" y1="94" x2="55" y2="115"/>
    <line x1="68" y1="94" x2="65" y2="115"/>
    <!-- DB on hips -->
    <line x1="48" y1="112" x2="72" y2="112"/>
    <circle cx="60" cy="112" r="6" fill="currentColor"/>
    <!-- Feet flat on ground -->
    <line x1="55" y1="115" x2="48" y2="128"/>
    <line x1="48" y1="128" x2="44" y2="148"/>
    <line x1="65" y1="115" x2="72" y2="128"/>
    <line x1="72" y1="128" x2="76" y2="148"/>
    <!-- Arms on ground at sides -->
    <line x1="44" y1="96" x2="22" y2="110"/>
    <line x1="76" y1="96" x2="98" y2="110"/>
  </svg>`,

  'wall-sit': `<svg ${_attr}>
    <!-- Wall on left -->
    <line x1="28" y1="10" x2="28" y2="158" stroke-width="3"/>
    <!-- Figure seated against wall, knees at 90° -->
    <circle cx="45" cy="40" r="8"/>
    <line x1="45" y1="48" x2="45" y2="90"/>
    <!-- Back flat on wall -->
    <line x1="28" y1="48" x2="45" y2="48"/>
    <!-- Thighs parallel to ground -->
    <line x1="45" y1="90" x2="34" y2="96"/>
    <line x1="45" y1="90" x2="56" y2="96"/>
    <line x1="34" y1="96" x2="20" y2="90"/>
    <line x1="56" y1="96" x2="70" y2="90"/>
    <!-- Shins straight down -->
    <line x1="20" y1="90" x2="18" y2="148"/>
    <line x1="70" y1="90" x2="72" y2="148"/>
    <line x1="18" y1="148" x2="10" y2="153"/>
    <line x1="72" y1="148" x2="78" y2="153"/>
    <!-- Ball between thighs -->
    <circle cx="45" cy="93" r="8" stroke-dasharray="3,2"/>
    <!-- Arms at sides on wall -->
    <line x1="45" y1="58" x2="28" y2="62"/>
    <line x1="45" y1="58" x2="62" y2="64"/>
  </svg>`,
};
