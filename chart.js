/* chart.js — SVG 꺾은선 차트 + 추이 화면
 *
 * 외부 차트 라이브러리를 쓰지 않고 SVG 요소를 직접 만듭니다.
 * 여기서도 기준값은 criteria 에서만 읽습니다. 기준선의 위치·라벨이 전부 거기서 옵니다.
 *
 *   NTChart.line(spec)   → <svg> 하나를 만들어 돌려줍니다 (순수 그리기)
 *   NTTrend.render(...)  → 추이 화면(차트 + 신호 스트립)을 그립니다
 */

(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // 그림 좌표계. viewBox 로 그리므로 폰 폭에 맞춰 알아서 늘어납니다.
  var W = 340, H = 210;
  var PAD = { top: 14, right: 12, bottom: 26, left: 38 };

  var COLOR = {
    line:   '#7ae1b4',
    grid:   '#2f3744',
    text:   '#9aa6b6',
    green:  '#4ecf9b',
    yellow: '#f0c04a',
    red:    '#ff6b6b',
    band:   'rgba(78, 207, 155, .12)'
  };

  // 글자가 선이나 점 위에 겹쳐도 읽히도록 배경색 테두리를 두릅니다.
  var HALO = { stroke: '#1b2029', 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };
  function halo(attrs) {
    for (var k in HALO) attrs[k] = HALO[k];
    return attrs;
  }

  function el(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  /* ────────────────────────────────────────────────────────────
     NTChart.line(spec)

     spec = {
       points:   [{ x, y, flag }]              // x = 일령, y = 값, flag = 그날 신호
       refLines: [{ y, label, color, dash }]   // 가로 기준선
       stepLine: { values: [{x, y}], label }   // 일령마다 달라지는 기준선 (계단 모양)
       band:     { from, to }                  // 정상 범위 음영
       unit:     'g' 같은 단위 문자열
     }
     ──────────────────────────────────────────────────────────── */
  function line(spec) {
    var pts = spec.points || [];
    var refs = spec.refLines || [];
    var step = spec.stepLine || null;
    var band = spec.band || null;

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      role: 'img',
      'aria-label': spec.ariaLabel || '추이 그래프'
    });

    // ── x 범위: 일령. 점이 하나뿐이면 양옆으로 조금 벌려 선이 보이게 합니다.
    var xs = pts.map(function (p) { return p.x; });
    if (step && step.values.length) xs = xs.concat(step.values.map(function (v) { return v.x; }));
    var xMin = Math.min.apply(null, xs);
    var xMax = Math.max.apply(null, xs);
    if (xMin === xMax) { xMin -= 1; xMax += 1; }

    // ── y 범위: 데이터와 기준선·음영이 모두 들어오도록
    var ys = pts.map(function (p) { return p.y; });
    refs.forEach(function (r) { ys.push(r.y); });
    if (step) step.values.forEach(function (v) { ys.push(v.y); });
    if (band) { ys.push(band.from); ys.push(band.to); }
    if (!ys.length) ys = [0, 1];
    var yMin = Math.min.apply(null, ys);
    var yMax = Math.max.apply(null, ys);
    var span = (yMax - yMin) || 1;
    yMin -= span * 0.12;
    yMax += span * 0.12;

    // 횟수·개수처럼 정수만 나오는 값은 눈금도 정수로 맞춥니다 (8.8개 같은 표시 방지).
    if (spec.integer) {
      yMin = Math.max(0, Math.floor(yMin));
      yMax = Math.ceil(yMax);
      if (yMax - yMin < 3) yMax = yMin + 3;   // 눈금 4칸이 겹치지 않도록
    }

    var plotW = W - PAD.left - PAD.right;
    var plotH = H - PAD.top - PAD.bottom;
    var X = function (v) { return PAD.left + (v - xMin) / (xMax - xMin) * plotW; };
    var Y = function (v) { return PAD.top + (yMax - v) / (yMax - yMin) * plotH; };

    // ── 정상 범위 음영 (체온)
    if (band) {
      svg.appendChild(el('rect', {
        x: PAD.left, y: Y(band.to), width: plotW, height: Math.abs(Y(band.from) - Y(band.to)),
        fill: COLOR.band
      }));
    }

    // ── y 눈금 4칸
    for (var i = 0; i <= 3; i++) {
      var v = yMin + (yMax - yMin) * i / 3;
      svg.appendChild(el('line', {
        x1: PAD.left, x2: W - PAD.right, y1: Y(v), y2: Y(v),
        stroke: COLOR.grid, 'stroke-width': 1
      }));
      svg.appendChild(el('text', halo({
        x: PAD.left - 5, y: Y(v) + 3, 'text-anchor': 'end',
        fill: COLOR.text, 'font-size': 9
      }), tick(v, spec.unit, spec.integer)));
    }

    // ── 일령마다 달라지는 기준선 (계단)
    if (step && step.values.length) {
      var d = '';
      step.values.forEach(function (v, idx) {
        var x0 = X(v.x - 0.5), x1 = X(v.x + 0.5), y = Y(v.y);
        d += (idx === 0 ? 'M' : 'L') + x0 + ' ' + y + 'L' + x1 + ' ' + y;
      });
      svg.appendChild(el('path', {
        d: d, fill: 'none', stroke: COLOR.yellow, 'stroke-width': 1.2,
        'stroke-dasharray': '4 3', opacity: .85
      }));
    }

    // ── 가로 기준선
    refs.forEach(function (r) {
      svg.appendChild(el('line', {
        x1: PAD.left, x2: W - PAD.right, y1: Y(r.y), y2: Y(r.y),
        stroke: r.color || COLOR.yellow, 'stroke-width': 1.2,
        'stroke-dasharray': r.dash || '4 3', opacity: .9
      }));
      if (r.label) {
        svg.appendChild(el('text', halo({
          x: W - PAD.right, y: Y(r.y) - 3, 'text-anchor': 'end',
          fill: r.color || COLOR.yellow, 'font-size': 9
        }), r.label));
      }
    });

    // ── 값 꺾은선. 기록이 없는 날은 이어 붙이지 않고 끊습니다.
    var sorted = pts.slice().sort(function (a, b) { return a.x - b.x; });
    var seg = [];
    sorted.forEach(function (p, idx) {
      var prev = sorted[idx - 1];
      if (prev && p.x - prev.x > 1) { flushSeg(); }
      seg.push(p);
    });
    flushSeg();

    function flushSeg() {
      if (seg.length > 1) {
        svg.appendChild(el('polyline', {
          points: seg.map(function (p) { return X(p.x) + ',' + Y(p.y); }).join(' '),
          fill: 'none', stroke: COLOR.line, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      }
      seg = [];
    }

    // ── 점. 색은 그날의 신호(green/yellow/red)를 그대로 씁니다.
    sorted.forEach(function (p) {
      svg.appendChild(el('circle', {
        cx: X(p.x), cy: Y(p.y), r: 3.4,
        fill: COLOR[p.flag] || COLOR.line,
        stroke: '#1b2029', 'stroke-width': 1.2
      }));
    });

    // ── x 축 라벨 (일령). 날이 많으면 건너뛰며 표시합니다.
    var days = [];
    for (var dd = Math.ceil(xMin); dd <= Math.floor(xMax); dd++) days.push(dd);
    var every = Math.ceil(days.length / 7) || 1;
    days.forEach(function (dv, idx) {
      if (idx % every !== 0) return;
      svg.appendChild(el('text', halo({
        x: X(dv), y: H - 8, 'text-anchor': 'middle',
        fill: COLOR.text, 'font-size': 9
      }), dv + '일'));
    });

    return svg;
  }

  function tick(v, unit, integer) {
    var n = (integer || Math.abs(v) >= 100) ? Math.round(v) : Math.round(v * 10) / 10;
    return n + (unit || '');
  }

  /* ────────────────────────────────────────────────────────────
     추이 화면
     ──────────────────────────────────────────────────────────── */
  function render(logs, baby, criteria) {
    var wrap = document.getElementById('trend-chart');
    var legend = document.getElementById('trend-legend');
    var strip = document.getElementById('trend-strip');
    var empty = document.getElementById('trend-empty');
    if (!wrap || !baby || !criteria) return;

    var tab = (root.NTApp && root.NTApp.activeTab()) || 'weight';

    // 각 기록을 판정해 둡니다. 점 색과 스트립 색에 씁니다. (저장하지 않고 매번 계산)
    var rows = logs.map(function (log) {
      return { log: log, r: NTEvaluate.evaluate(log, baby, criteria) };
    }).filter(function (row) {
      return row.r.dayOfLife != null && row.r.dayOfLife >= 1;
    });

    wrap.innerHTML = '';
    strip.innerHTML = '';

    if (!rows.length) {
      empty.hidden = false;
      legend.textContent = '';
      return;
    }
    empty.hidden = true;

    var spec = buildSpec(tab, rows, baby, criteria);
    wrap.appendChild(line(spec));
    // 이 항목만 한 번도 입력하지 않은 경우(예: 체중을 아직 안 잼) 기준선만 보이므로 알려줍니다.
    legend.textContent = (spec.points.length ? '' : '이 항목은 아직 입력한 날이 없습니다. ') + spec.legend;

    // ── 날짜별 신호 스트립. 누르면 그날 기록으로 이동합니다.
    rows.forEach(function (row) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'strip-cell';
      cell.dataset.flag = row.r.overall;
      cell.title = row.log.date;
      cell.appendChild(document.createElement('b'));
      cell.appendChild(document.createTextNode(row.r.dayOfLife + '일'));
      cell.addEventListener('click', function () {
        if (root.NTApp && root.NTApp.openDate) root.NTApp.openDate(row.log.date);
      });
      strip.appendChild(cell);
    });
  }

  /* 탭마다 어떤 값을 그리고 어떤 기준선을 얹을지 정합니다.
     숫자는 하나도 여기 적지 않고 criteria 에서 꺼내 씁니다. */
  function buildSpec(tab, rows, baby, criteria) {
    var cats = criteria.categories || {};
    var pts = [];
    var days = rows.map(function (r) { return r.r.dayOfLife; });

    function collect(key, getValue) {
      rows.forEach(function (row) {
        var v = getValue(row.log);
        if (typeof v !== 'number' || !isFinite(v)) return;
        var item = row.r.byKey[key];
        pts.push({ x: row.r.dayOfLife, y: v, flag: item ? item.flag : 'green' });
      });
    }

    if (tab === 'weight') {
      collect('weight', function (l) { return l.weightGram; });
      var th = (cats.weight || {}).thresholds || {};
      var bw = baby.birthWeight;
      return {
        points: pts, unit: 'g',
        ariaLabel: '체중 추이',
        refLines: [
          { y: bw, label: '출생 ' + bw + 'g', color: COLOR.text, dash: '2 3' },
          { y: bw * (1 - th.yellowLossPct / 100), label: '−' + th.yellowLossPct + '%', color: COLOR.yellow },
          { y: bw * (1 - th.redLossPct / 100), label: '−' + th.redLossPct + '%', color: COLOR.red }
        ],
        legend: '점선은 위에서부터 출생체중, −' + th.yellowLossPct + '%, −' + th.redLossPct +
                '% 입니다. 점 색은 그날의 체중 신호입니다.'
      };
    }

    if (tab === 'wetDiapers') {
      collect('wetDiapers', function (l) { return l.wetDiaperCount; });
      var table = (cats.wetDiapers || {}).minByDayOfLife || {};
      return {
        points: pts, unit: '개', integer: true,
        ariaLabel: '젖은 기저귀 추이',
        stepLine: { values: stepValues(days, function (d) {
          return d >= 5 ? table['5plus'] : table[String(d)];
        }) },
        legend: '계단 모양 점선은 그 일령의 최소 기준입니다 (생후 5일부터 하루 ' +
                table['5plus'] + '개). 점 색은 그날의 신호입니다.'
      };
    }

    if (tab === 'feeding') {
      collect('feeding', function (l) {
        var a = typeof l.breastFeedCount === 'number' ? l.breastFeedCount : 0;
        var b = typeof l.formulaFeedCount === 'number' ? l.formulaFeedCount : 0;
        return a + b;
      });
      var ft = (cats.feeding || {}).thresholds || {};
      return {
        points: pts, unit: '회', integer: true,
        ariaLabel: '수유 횟수 추이',
        stepLine: { values: stepValues(days, function (d) {
          if (baby.feedingType === 'formula') {
            return d <= 7 ? (ft.formula.week1 || {}).greenMin : (ft.formula.after || {}).greenMin;
          }
          return (ft.breast || {}).greenMin;
        }) },
        legend: '점선은 하루 최소 기준 횟수입니다. 모유·분유를 합한 횟수를 그립니다.'
      };
    }

    // 체온
    collect('temperature', function (l) { return l.temperature; });
    var tt = (cats.temperature || {}).thresholds || {};
    return {
      points: pts, unit: '°C',
      ariaLabel: '체온 추이',
      band: { from: tt.greenMin, to: tt.greenMax },
      refLines: [
        { y: tt.redHigh, label: tt.redHigh.toFixed(1) + '°C', color: COLOR.red },
        { y: tt.redLow, label: tt.redLow.toFixed(1) + '°C', color: COLOR.red }
      ],
      legend: '초록 음영이 정상 범위(' + tt.greenMin.toFixed(1) + '~' + tt.greenMax.toFixed(1) +
              '°C)이고, 빨간 점선은 즉시 진료 기준선입니다.'
    };
  }

  // 일령 범위 전체에 대해 기준값을 계산해 계단선의 재료를 만듭니다.
  function stepValues(days, fn) {
    var lo = Math.min.apply(null, days), hi = Math.max.apply(null, days);
    var out = [];
    for (var d = lo; d <= hi; d++) {
      var v = fn(d);
      if (typeof v === 'number' && isFinite(v)) out.push({ x: d, y: v });
    }
    return out;
  }

  root.NTChart = { line: line };
  root.NTTrend = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
