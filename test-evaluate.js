/* test-evaluate.js — 판정 로직 검증 스크립트
 *
 * 앱에는 포함되지 않습니다 (index.html 이 불러오지 않습니다).
 * criteria.json 의 기준을 고친 뒤, 터미널에서 아래 한 줄로 확인하세요.
 *
 *     node test-evaluate.js
 *
 * 아래 PASS/FAIL 목록에 FAIL 이 하나라도 있으면 기준과 로직이 어긋난 것입니다.
 */

const fs = require('fs');
const { evaluate, dayOfLife } = require('./evaluate.js');
const criteria = JSON.parse(fs.readFileSync('./criteria.json', 'utf8'));

const baby = { name: '젤리', birthDate: '2026-08-31', birthWeight: 3200, feedingType: 'breast' };

// 생후 12일의 '정상' 기록을 기본값으로 두고, 케이스마다 필요한 값만 바꿉니다.
const BASE = {
  date: '2026-09-11',
  breastFeedCount: 9, formulaFeedCount: 0, formulaTotalMl: null,
  wetDiaperCount: 7, stoolCount: 3,
  stoolColor: ['yellow'], stoolTexture: 'seedy',
  sleepTotalHours: 15, temperature: 37.0,
  jaundiceLevel: 'face', alertness: 'normal',
  weightGram: 3300, symptoms: [], memo: null
};
const L = (o) => Object.assign({}, BASE, o);

const cases = [
  ['① 정상',            L({})],
  ['② 기저귀 5개 (기준 6)', L({ wetDiaperCount: 5 })],
  ['③ 기저귀 4개 (기준 6)', L({ wetDiaperCount: 4 })],
  ['④ 체중 2848g (−11%)',  L({ weightGram: 2848 })],
  ['⑤ 발열 38.3°C',        L({ temperature: 38.3 })],
  ['⑥ 흰변',              L({ stoolColor: ['yellow', 'white'] })],
  ['⑦ 증상 체크 2개',      L({ symptoms: ['breathing', 'limp'] })],
  ['⑧ 태변만, 생후 12일',  L({ stoolColor: ['meconium'] })],
  ['⑨ 대부분 미입력',      L({ temperature: null, weightGram: null, jaundiceLevel: null,
                              alertness: null, stoolColor: [], stoolTexture: null, stoolCount: null })],
  ['⑩ 오늘 기록 없음',     null]
];

const ICON = { red: '🔴 red   ', yellow: '🟡 yellow', green: '🟢 green ', none: '⚪ none  ' };

for (const [title, log] of cases) {
  const r = evaluate(log, baby, criteria);
  console.log('\n' + '═'.repeat(74));
  console.log(title + '   |   생후 ' + (r.dayOfLife ?? '—') + '일   |   종합: ' + ICON[r.overall].trim());
  console.log('─'.repeat(74));
  for (const it of r.items) {
    console.log('  ' + ICON[it.flag] + ' ' + it.label.padEnd(12, ' ') + it.message);
    if (it.flag !== 'green') {
      console.log('              ↳ 출처: ' + (it.source ? it.source.name : '(없음)'));
      if (!it.source) console.log('              !! 출처 링크 없음 — 규칙 위반');
    }
  }
  if (r.missing.length) console.log('  ⋯ 아직 입력하지 않음: ' + r.missing.map(m => m.label).join(', '));
}

// ── 규칙 자동 확인 ────────────────────────────────────────────
console.log('\n' + '═'.repeat(74));
console.log('규칙 자동 확인');
console.log('─'.repeat(74));
const assert = (name, ok) => console.log((ok ? '  PASS  ' : '  FAIL  ') + name);

assert('출생일이 생후 1일', dayOfLife('2026-08-31', '2026-08-31') === 1);
assert('다음날이 생후 2일', dayOfLife('2026-09-01', '2026-08-31') === 2);

// 증상이 켜지면 나머지가 전부 green 이어도 red
const allGreenButSymptom = evaluate(L({ symptoms: ['cry'] }), baby, criteria);
assert('증상 체크 → 다른 항목 무관하게 overall=red', allGreenButSymptom.overall === 'red');

// green 이 아닌 항목은 전부 출처를 가진다
let srcOK = true;
for (const [, log] of cases) {
  for (const it of evaluate(log, baby, criteria).items)
    if (it.flag !== 'green' && !(it.source && it.source.url)) srcOK = false;
}
assert('green 이 아닌 모든 항목에 출처 링크 존재', srcOK);

// 순수 함수: 입력을 변형하지 않는다 / 같은 입력이면 같은 출력
const probe = L({ stoolColor: ['meconium'], symptoms: ['fever'] });
const snapshot = JSON.stringify(probe);
const r1 = JSON.stringify(evaluate(probe, baby, criteria));
const r2 = JSON.stringify(evaluate(probe, baby, criteria));
assert('입력 객체를 변형하지 않음', JSON.stringify(probe) === snapshot);
assert('같은 입력 → 같은 출력', r1 === r2);

// criteria 를 고치면 과거 기록이 새 기준으로 재평가된다
const tweaked = JSON.parse(JSON.stringify(criteria));
tweaked.categories.wetDiapers.minByDayOfLife['5plus'] = 8;
const before = evaluate(L({ wetDiaperCount: 7 }), baby, criteria).byKey.wetDiapers;
const after  = evaluate(L({ wetDiaperCount: 7 }), baby, tweaked).byKey.wetDiapers;
assert('기준을 6→8 로 바꾸면 같은 기록이 green→yellow (' + before.flag + '→' + after.flag + ')',
       before.flag === 'green' && after.flag === 'yellow');

// 일령별 기저귀 기준표
const dayTable = [[1,'2026-08-31',1],[2,'2026-09-01',2],[3,'2026-09-02',3],[4,'2026-09-03',4],[5,'2026-09-04',6]];
let tblOK = true;
for (const [d, date, min] of dayTable) {
  const ok = evaluate(L({ date, wetDiaperCount: min }), baby, criteria).byKey.wetDiapers;
  const ng = evaluate(L({ date, wetDiaperCount: min - 2 }), baby, criteria).byKey.wetDiapers;
  if (ok.flag !== 'green' || ng.flag !== 'red') tblOK = false;
}
assert('일령 1~5일 기저귀 기준표 (1/2/3/4/6개) 적용', tblOK);

// 태변 downgrade 는 생후 3일까지만 green
const mec3 = evaluate(L({ date: '2026-09-02', stoolColor: ['meconium'], stoolTexture: null }), baby, criteria).byKey.stool;
const mec4 = evaluate(L({ date: '2026-09-03', stoolColor: ['meconium'], stoolTexture: null }), baby, criteria).byKey.stool;
assert('태변: 생후 3일 green / 4일 yellow (' + mec3.flag + '/' + mec4.flag + ')',
       mec3.flag === 'green' && mec4.flag === 'yellow');

// 분유 기준 전환 (1주차 → 이후)
const fBaby = Object.assign({}, baby, { feedingType: 'formula' });
const f7 = evaluate(L({ date: '2026-09-06', breastFeedCount: 0, formulaFeedCount: 7 }), fBaby, criteria).byKey.feeding;
const f8 = evaluate(L({ date: '2026-09-07', breastFeedCount: 0, formulaFeedCount: 7 }), fBaby, criteria).byKey.feeding;
assert('분유 7회: 생후 7일 yellow / 8일 green (' + f7.flag + '/' + f8.flag + ')',
       f7.flag === 'yellow' && f8.flag === 'green');

// 체온 경계
const tb = (t) => evaluate(L({ temperature: t }), baby, criteria).byKey.temperature.flag;
assert('체온 35.9 red / 36.0 yellow / 36.5 green / 37.5 green / 37.6 yellow / 38.0 red  (' +
       [35.9,36.0,36.5,37.5,37.6,38.0].map(tb).join(',') + ')',
       tb(35.9)==='red' && tb(36.0)==='yellow' && tb(36.5)==='green' &&
       tb(37.5)==='green' && tb(37.6)==='yellow' && tb(38.0)==='red');

// 체중 경계 + 회복 기한
const wb = (g, date) => evaluate(L({ weightGram: g, date: date || BASE.date }), baby, criteria).byKey.weight.flag;
assert('체중 −7% yellow / −10% red (' + wb(2976) + ',' + wb(2880) + ')',
       wb(2976)==='yellow' && wb(2880)==='red');
assert('생후 14일에 출생체중 미만이면 yellow (' + wb(3150, '2026-09-13') + ')', wb(3150, '2026-09-13')==='yellow');
assert('생후 13일에 출생체중 미만이면 green (' + wb(3150, '2026-09-12') + ')', wb(3150, '2026-09-12')==='green');

// ── 하루가 진행 중일 때의 보류 (criteria.partialDay) ──────────
// 오전 10시, 오늘 기록, 수유 2회 / 기저귀 1개 / 대변 0회
const morning = new Date(2026, 8, 11, 10, 46);      // 2026-09-11 10:46 (지역시)
const evening = new Date(2026, 8, 11, 21, 30);      // 같은 날 밤 9시 30분
const partial = L({ breastFeedCount: 2, formulaFeedCount: 0, wetDiaperCount: 1,
                    stoolCount: 0, stoolColor: [], stoolTexture: null });

const am = evaluate(partial, baby, criteria, morning);
const pm = evaluate(partial, baby, criteria, evening);
console.log('\n오전 10:46 (하루 진행 중)  → 종합 ' + am.overall +
            ' / 집계 중: ' + am.pending.map(p => p.label).join(', '));
am.pending.forEach(p => console.log('    ⏳ ' + p.label + ' — ' + p.message));
console.log('밤 21:30 (기준 시각 이후) → 종합 ' + pm.overall + ' / 판정: ' +
            pm.items.map(i => i.label + '=' + i.flag).join(', '));

assert('오전에는 수유·기저귀를 판정하지 않고 집계 중으로 둠',
       am.pending.length === 3 && !am.byKey.feeding.flag.match(/red|yellow|green/));
assert('오전에도 종합은 red 가 아님 (' + am.overall + ')', am.overall !== 'red');
assert('밤 9시 이후에는 같은 기록이 red 로 판정됨 (' + pm.byKey.feeding.flag + ')',
       pm.byKey.feeding.flag === 'red' && pm.byKey.wetDiapers.flag === 'red');

// 어제 기록은 지금이 오전이어도 그대로 판정합니다
const yesterday = evaluate(L({ date: '2026-09-10', breastFeedCount: 2, formulaFeedCount: 0,
                              wetDiaperCount: 1 }), baby, criteria, morning);
assert('어제 기록은 오전에도 그대로 판정 (' + yesterday.byKey.feeding.flag + ')',
       yesterday.byKey.feeding.flag === 'red');

// ★ 가장 중요: 흰 변은 시간과 무관하게 즉시 red
const whiteAM = evaluate(L({ stoolColor: ['white'], stoolCount: 1, breastFeedCount: 2,
                            formulaFeedCount: 0, wetDiaperCount: 1 }), baby, criteria, morning);
assert('오전이어도 흰 변은 즉시 red (' + whiteAM.byKey.stool.flag + ', 종합 ' + whiteAM.overall + ')',
       whiteAM.byKey.stool.flag === 'red' && whiteAM.overall === 'red');

// 증상 체크도 시간과 무관
const sympAM = evaluate(L({ symptoms: ['breathing'], breastFeedCount: 1, formulaFeedCount: 0,
                           wetDiaperCount: 0 }), baby, criteria, morning);
assert('오전이어도 증상 체크는 즉시 red (' + sympAM.overall + ')', sympAM.overall === 'red');

// 체온·체중·황달·활력은 순간값이므로 오전에도 판정
const feverAM = evaluate(L({ temperature: 38.3, breastFeedCount: 2, formulaFeedCount: 0,
                            wetDiaperCount: 1 }), baby, criteria, morning);
assert('오전이어도 발열은 즉시 red (' + feverAM.byKey.temperature.flag + ')',
       feverAM.byKey.temperature.flag === 'red');

// now 를 넘기지 않으면 지금까지와 똑같이 동작
assert('now 없이 부르면 예전과 동일하게 전부 판정',
       evaluate(partial, baby, criteria).byKey.feeding.flag === 'red');
