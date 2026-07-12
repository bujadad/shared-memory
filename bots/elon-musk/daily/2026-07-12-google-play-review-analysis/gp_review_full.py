import urllib.request, re, html as html_mod, json, os, sys, urllib.parse
from datetime import datetime

APP_ID = 'handasoft.mobile.divination_pro'
LANG = 'ko'
COUNT = 30
RELAY_URL = 'http://127.0.0.1:18792/slack'
GEMINI_KEY = os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY')

def fetch(app_id, lang='ko'):
    url = f'https://play.google.com/store/apps/details?id={app_id}&hl={lang}&showAllReviews=true'
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept-Language': lang
    })
    return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore')

def parse_reviews(html_text, max_count=30):
    seen = set()
    positions = []
    for m in re.finditer(r'data-review-id="([^"]+)"', html_text):
        rid = m.group(1)
        if rid in seen:
            continue
        seen.add(rid)
        positions.append(m.start())
    print(f'Found {len(positions)} unique review IDs')
    reviews = []
    for idx, start in enumerate(positions[:max_count]):
        end = html_text.find('data-review-id="', start + 20)
        block = html_text[start:end] if end != -1 else html_text[start:start + 8000]
        score = None
        score_m = re.search(r'별표\s*\d+개\s*만점에\s*([\d\.]+)개', block)
        if score_m:
            score = float(score_m.group(1))
        text = ''
        for m in re.finditer(r'>([^<]{30,})<', block):
            candidate = html_mod.unescape(m.group(1).strip())
            if candidate and not candidate.startswith('부적절한'):
                text = candidate
                break
        if text and score is not None:
            reviews.append({'score': score, 'text': text, 'id': rid})
            print(f'  [{idx}] score={score:.1f} text={text[:70]}')
    return reviews

def build_prompt(direction, reviews):
    label = '저평점 1~2점' if direction == 'low' else '고평점 4~5점'
    texts = '\n'.join([f'[{r["score"]}점] {r["text"]}' for r in reviews])
    return f'Google Play 리뷰 분석. 기준: {label}\n{texts}\n\n출력:\n- 공통 불만:\n- 공통 칭찬:\n- 개선 요청 TOP5:'

def call_gemini(prompt):
    if not GEMINI_KEY:
        raise RuntimeError('GOOGLE_API_KEY/GEMINI_API_KEY missing')
    body = json.dumps({'contents': [{'parts': [{'text': prompt}]}]}, ensure_ascii=False).encode('utf-8')
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + urllib.parse.quote(GEMINI_KEY)
    data = urllib.request.urlopen(urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}), timeout=60).read().decode('utf-8')
    obj = json.loads(data)
    return obj.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')

def format_slack(low_text, high_text, app_id):
    return '\n'.join([
        f'*Google Play 리뷰 분석*',
        f'appId: `{app_id}`',
        '',
        f'#저평점 1~2점',
        low_text or '(해당 없음)',
        '',
        f'#고평점 4~5점',
        high_text or '(해당 없음)'
    ])

def send_slack(text):
    secret = os.environ.get('RELAY_SECRET', '')
    payload = json.dumps({'text': text}).encode('utf-8')
    req = urllib.request.Request(RELAY_URL, data=payload, headers={'Content-Type': 'application/json', 'RELAY_SECRET': secret})
    try:
        r = urllib.request.urlopen(req, timeout=15)
        return True, r.status
    except urllib.error.HTTPError as e:
        return False, e.code
    except Exception as e:
        return False, str(e)

if __name__ == '__main__':
    html_text = fetch(APP_ID, LANG)
    reviews = parse_reviews(html_text, COUNT)
    if not reviews:
        msg = f'❌ 리뷰 0건: {APP_ID} (count={COUNT})'
        print(msg)
        send_slack(msg)
        sys.exit(1)
    low = [r for r in reviews if r['score'] <= 2]
    high = [r for r in reviews if r['score'] >= 4]
    print(f'Low: {len(low)}, High: {len(high)}')
    print(f'[{datetime.now()}] AI low...')
    low_text = call_gemini(build_prompt('low', low)) if low else '(저평점 리뷰 없음)'
    print(f'[{datetime.now()}] AI high...')
    high_text = call_gemini(build_prompt('high', high)) if high else '(고평점 리뷰 없음)'
    msg = format_slack(low_text, high_text, APP_ID)
    print(f'\n[{datetime.now()}] Sending to Slack...')
    ok, status = send_slack(msg)
    if ok:
        print(f'✅ Slack relay success (status={status})')
        print('\n--- PREVIEW ---')
        print(msg)
        print('--- END ---')
    else:
        print(f'⚠️ Slack relay failed: {status}')
        print('\n--- MESSAGE ---')
        print(msg)
        print('--- END ---')
