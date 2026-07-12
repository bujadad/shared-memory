#!/usr/bin/env node
// 사주 앱 리뷰 비교 크롤러 v2 (Google Play, KR/ko) — 감정 분석 보강판
// 수집: 구글플레이 내부 batchexecute(UsvDTd) JSON API 직접 호출(HTML 파싱 아님 → 레이아웃 변경에 강함).
// 페이지네이션으로 앱당 최대 --count건 수집. 감정지수 + 부정/긍정 키워드 비교표 + 앱별 자동 키워드 추출.
// 외부 npm 의존성 없음(Node18+ fetch).
//
// 사용법:
//   node saju-review-crawler.mjs                        # 기본 5개 앱, 각 최대 100건 수집→분석
//   node saju-review-crawler.mjs --count 60
//   node saju-review-crawler.mjs --from saju-reviews-raw.json   # 저장 JSON에서 재수집 없이 바로 분석
//   node saju-review-crawler.mjs com.a com.b            # appId 직접 지정
//   node saju-review-crawler.mjs --json saju-reviews-raw.json   # 원문도 저장
//
// 산출물: 콘솔표 + saju-review-comparison.md + saju-review-comparison.csv + saju-sentiment-keywords.md

const DEFAULT_APPS = [
  ["포스텔러",   "com.un7qi3.forceteller"],
  ["점신",       "handasoft.mobile.divination"],
  ["헬로우봇",   "com.thingsflow.hellobot"],
  ["정통사주",   "com.ipapas.sajulite"],
  ["운세비결",   "com.comprehensivefortune"],
];

// ---- CLI ----
const argv = process.argv.slice(2);
let COUNT = 100, LANG = "ko", GL = "kr", JSON_OUT = null, FROM = null;
const appArgs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--count") COUNT = parseInt(argv[++i], 10) || 100;
  else if (a === "--lang") LANG = argv[++i] || "ko";
  else if (a === "--json") JSON_OUT = argv[++i] || "saju-reviews-raw.json";
  else if (a === "--from") FROM = argv[++i];
  else appArgs.push(a);
}
const APPS = appArgs.length ? appArgs.map(id => [id, id]) : DEFAULT_APPS;
GL = ({ ko: "kr", en: "us", ja: "jp", zh: "cn", es: "es" }[LANG]) || "kr";

// ---- 감정 사전(가중치) : 감정지수 산출용 ----
const POS_LEX = [["잘\\s*맞|정확|소름|족집게|딱\\s*맞", 2], ["만족|최고|추천|유용|짱", 2], ["힐링|위로|따뜻|감동", 2], ["좋|감사|재미|편리|친근|귀여|신기|도움", 1]];
const NEG_LEX = [["먹튀|사기|호구|최악", 3], ["환불|돈\\s*아깝|아까", 2], ["광고", 2], ["안\\s*맞|틀리|엉터리|정반대", 2], ["복붙|복사|두루뭉|뭉뚱|누구에게나|누구나|뻔한|성의\\s*없", 2], ["짜증|실망|불쾌|화나", 2], ["오류|버그|튕|먹통|안됨|안돼", 1], ["별로|불편|비싸|과금", 1]];
const compile = lex => lex.map(([p, w]) => [new RegExp(p), w]);
const POS_RE = compile(POS_LEX), NEG_RE = compile(NEG_LEX);

// ---- 감정 키워드 비교 매트릭스(리뷰 등장 비율%) ----
const NEG_KW = [
  ["광고",        /광고/],
  ["환불/먹튀",   /환불|먹튀|사기|돈\s*아깝|아까/],
  ["복붙/뻔함",   /복붙|복사|두루뭉|뭉뚱|누구에게나|누구나|뻔한|성의\s*없/],
  ["안맞음",      /안\s*맞|틀리|엉터리|정반대/],
  ["짜증/실망",   /짜증|실망|불쾌|화나|최악|별로/],
  ["오류/버그",   /오류|버그|튕|먹통|안됨|안돼|재설치|로그인.*풀/],
  ["과금/비쌈",   /유료|과금|비싸|돈독/],
];
const POS_KW = [
  ["잘맞음/정확", /잘\s*맞|정확|소름|족집게|딱\s*맞/],
  ["만족/추천",   /만족|추천|최고|짱/],
  ["재미",        /재미|재밌|잼|신기/],
  ["힐링/위로",   /힐링|위로|따뜻|감동/],
  ["편리/친근",   /편리|친근|쉽게|귀여|깔끔/],
  ["무료풍부",    /무료.*많|무료.*풍부|다\s*무료|무료로\s*다/],
  ["유용/도움",   /유용|도움/],
];

// ---- 자동 키워드 추출용 불용어 ----
const STOP = new Set("너무 진짜 정말 그냥 조금 이거 근데 그리고 계속 다시 이런 저런 하는 있는 해서 합니다 입니다 는데 어플 어플이 어플은 어플을 사주 운세 리뷰 별점 여기 이제 이건 그거 점점 이게 정도 때문 이용 사용 같아요 같은 있어요 없어요 봤는데 보고 보는 보면 그런 아니 항상 매번 자꾸 그래도 하지만 그게 저는 제가 그리고 근데 그런데 이렇게 그렇게 하나 한번 아주 좀더 매우 완전 그냥 진짜로 이라 라고 라는 것도 이런거 그런거 있고 없고 되고 하고 해도 했는데 인데 어플로 앱이 앱을 앱은 이앱 요앱 이앱은 별로 별루".split(/\s+/));

// ---- fetch (batchexecute UsvDTd, sort=2 최신, 페이지네이션) ----
async function fetchPage(appId, token) {
  const inner2 = token
    ? `[null,null,[2,1,[${COUNT},null,"${token}"],null,[]],["${appId}",7]]`
    : `[null,null,[2,1,[${COUNT},null,null],null,[]],["${appId}",7]]`;
  const freqRaw = JSON.stringify([[["UsvDTd", inner2, null, "generic"]]]);
  const url = `https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=UsvDTd&source-path=%2Fstore%2Fapps%2Fdetails&hl=${LANG}&gl=${GL}&rt=c`;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "f.req=" + encodeURIComponent(freqRaw) });
  const raw = await res.text();
  const line = String(raw).split("\n").find(l => l.startsWith('[["wrb.fr"'));
  if (!line) return { reviews: [], next: null };
  const entry = JSON.parse(line).find(e => e[1] === "UsvDTd");
  if (!entry || !entry[2]) return { reviews: [], next: null };
  const payload = JSON.parse(entry[2]);
  const arr = payload[0] || [];
  const reviews = arr.map(r => ({
    score: r[2], text: String(r[4] || "").replace(/\s+/g, " ").trim(),
    date: (r[5] && r[5][0]) ? new Date(r[5][0] * 1000).toISOString().slice(0, 10) : null, thumbsUp: r[6] || 0,
  })).filter(x => typeof x.score === "number" && x.text);
  let next = null;
  const tk = payload[1];
  if (Array.isArray(tk)) next = tk.find(v => typeof v === "string") || null;
  return { reviews, next };
}

async function fetchReviews(appId) {
  const seen = new Set(); const out = [];
  let token = null;
  for (let p = 0; p < 5 && out.length < COUNT; p++) {
    let page;
    try { page = await fetchPage(appId, token); } catch { break; }
    for (const r of page.reviews) { const k = r.text.slice(0, 40); if (!seen.has(k)) { seen.add(k); out.push(r); } }
    token = page.next;
    if (!token || page.reviews.length === 0) break;
  }
  return out.slice(0, COUNT);
}

// ---- 분석 ----
function sentiment(text) {
  let pos = 0, neg = 0;
  for (const [re, w] of POS_RE) if (re.test(text)) pos += w;
  for (const [re, w] of NEG_RE) if (re.test(text)) neg += w;
  return { pos, neg };
}
function topKeywords(reviews, n) {
  const freq = new Map();
  for (const r of reviews) {
    const toks = (r.text.match(/[가-힣]{2,}/g) || []);
    const uniq = new Set();
    for (let t of toks) {
      if (t.length > 3) t = t.slice(0, 3);        // 조사 흡수용 어간 근사(3자)
      if (t.length < 2 || STOP.has(t)) continue;
      uniq.add(t);
    }
    for (const t of uniq) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k}(${c})`);
}
function analyze(name, appId, reviews) {
  const nR = reviews.length;
  const dist = [0, 0, 0, 0, 0]; let sum = 0, sPos = 0, sNeg = 0;
  for (const r of reviews) { dist[r.score - 1]++; sum += r.score; const s = sentiment(r.text); sPos += s.pos; sNeg += s.neg; }
  const pct = c => nR ? Math.round((c / nR) * 100) : 0;
  const negRev = reviews.filter(r => r.score <= 2), posRev = reviews.filter(r => r.score >= 4);
  const senIdx = (sPos + sNeg) ? Math.round(((sPos - sNeg) / (sPos + sNeg)) * 100) : 0; // -100~+100
  const negKw = {}, posKw = {};
  for (const [l, re] of NEG_KW) negKw[l] = pct(reviews.filter(r => re.test(r.text)).length);
  for (const [l, re] of POS_KW) posKw[l] = pct(reviews.filter(r => re.test(r.text)).length);
  return {
    name, appId, n: nR, avg: nR ? +(sum / nR).toFixed(2) : 0, dist,
    posPct: pct(dist[3] + dist[4]), negPct: pct(dist[0] + dist[1]),
    senIdx, negKw, posKw,
    topNeg: topKeywords(negRev, 8), topPos: topKeywords(posRev, 8),
  };
}

// ---- 렌더 ----
function padR(s, w) { s = String(s); const len = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0); return s + " ".repeat(Math.max(0, w - len)); }
function tbl(head, widths, rows) {
  const line = a => a.map((v, i) => padR(v, widths[i])).join("│");
  return [line(head), widths.map(w => "─".repeat(w)).join("┼"), ...rows.map(line)].join("\n");
}
function renderSummary(R) {
  const H = ["앱", "표본", "평균", "긍정%", "부정%", "감정지수"];
  const W = [12, 5, 5, 6, 6, 8];
  return tbl(H, W, R.map(r => [r.name, r.n, r.avg, r.posPct + "%", r.negPct + "%", (r.senIdx > 0 ? "+" : "") + r.senIdx]));
}
function renderNeg(R) {
  const H = ["앱", ...NEG_KW.map(k => k[0])]; const W = [12, ...NEG_KW.map(() => 9)];
  return tbl(H, W, R.map(r => [r.name, ...NEG_KW.map(k => r.negKw[k[0]] + "%")]));
}
function renderPos(R) {
  const H = ["앱", ...POS_KW.map(k => k[0])]; const W = [12, ...POS_KW.map(() => 9)];
  return tbl(H, W, R.map(r => [r.name, ...POS_KW.map(k => r.posKw[k[0]] + "%")]));
}
function mdMatrix(R, KW, pick) {
  const H = ["앱", ...KW.map(k => k[0])];
  return "| " + H.join(" | ") + " |\n| " + H.map(() => "---").join(" | ") + " |\n" +
    R.map(r => "| " + [r.name, ...KW.map(k => pick(r)[k[0]])].join(" | ") + " |").join("\n");
}

// ---- 실행 ----
import { writeFileSync, readFileSync } from "node:fs";
const rows = []; const rawAll = {};
if (FROM) {
  const data = JSON.parse(readFileSync(FROM, "utf8"));
  for (const appId in data) { const { name, reviews } = data[appId]; rows.push(analyze(name || appId, appId, reviews)); process.stderr.write(`✓ ${name || appId} ${reviews.length}건(JSON)\n`); }
} else {
  for (const [name, appId] of APPS) {
    try { const reviews = await fetchReviews(appId); rows.push(analyze(name, appId, reviews)); rawAll[appId] = { name, reviews }; process.stderr.write(`✓ ${name} ${reviews.length}건\n`); }
    catch (e) { rows.push(analyze(name, appId, [])); process.stderr.write(`✗ ${name} ERROR ${e.message}\n`); }
  }
}
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
console.log(`\n■ 리뷰 비교 요약  (${stamp} UTC · 앱당 최대 ${COUNT}건·최신순)\n`);
console.log(renderSummary(rows));
console.log(`\n■ 부정 감정 키워드 비교(리뷰 등장률%)\n`);
console.log(renderNeg(rows));
console.log(`\n■ 긍정 감정 키워드 비교(리뷰 등장률%)\n`);
console.log(renderPos(rows));
console.log(`\n■ 앱별 자동 추출 키워드(어간3자·괄호=언급수)`);
for (const r of rows) {
  console.log(`\n[${r.name}]  감정지수 ${(r.senIdx > 0 ? "+" : "") + r.senIdx}`);
  console.log(`  😡 부정리뷰: ${r.topNeg.join(", ")}`);
  console.log(`  😊 긍정리뷰: ${r.topPos.join(", ")}`);
}
console.log(`\n감정지수 = (긍정어가중 − 부정어가중)/합 ×100, −100~+100.`);

// 저장물
const md = `# 구글플레이 사주 앱 리뷰 — 감정 비교 (${stamp} UTC, 앱당 최대 ${COUNT}건)\n\n` +
  `## 요약\n\n| 앱 | appId | 표본 | 평균 | 긍정%(≥4) | 부정%(≤2) | 감정지수(−100~+100) |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
  rows.map(r => `| ${r.name} | \`${r.appId}\` | ${r.n} | ${r.avg} | ${r.posPct} | ${r.negPct} | ${r.senIdx} |`).join("\n") +
  `\n\n## 부정 감정 키워드(등장률%)\n\n${mdMatrix(rows, NEG_KW, r => r.negKw)}\n\n## 긍정 감정 키워드(등장률%)\n\n${mdMatrix(rows, POS_KW, r => r.posKw)}\n\n## 앱별 자동 추출 키워드\n\n` +
  rows.map(r => `**${r.name}** (감정지수 ${r.senIdx})\n- 부정: ${r.topNeg.join(", ")}\n- 긍정: ${r.topPos.join(", ")}`).join("\n\n") + "\n";
writeFileSync("saju-sentiment-keywords.md", md);
const csvH = ["name", "appId", "n", "avg", "pos_pct", "neg_pct", "sentiment_idx", ...NEG_KW.map(k => "neg_" + k[0]), ...POS_KW.map(k => "pos_" + k[0])];
const csv = [csvH.join(","), ...rows.map(r => [r.name, r.appId, r.n, r.avg, r.posPct, r.negPct, r.senIdx, ...NEG_KW.map(k => r.negKw[k[0]]), ...POS_KW.map(k => r.posKw[k[0]])].join(","))].join("\n");
writeFileSync("saju-review-comparison.csv", csv);
writeFileSync("saju-review-comparison.md", md);
if (JSON_OUT && !FROM) writeFileSync(JSON_OUT, JSON.stringify(rawAll));
process.stderr.write(`\n저장: saju-sentiment-keywords.md, saju-review-comparison.md, saju-review-comparison.csv${JSON_OUT && !FROM ? ", " + JSON_OUT : ""}\n`);
