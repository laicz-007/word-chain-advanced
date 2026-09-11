# -*- coding: utf-8 -*-
"""
build_unified_db.py — 把开源词库统一成一个"按需结构化数据库" data/db.json

主数据源（小文件、可稳定下载，用于单词+释义+音标+难度+知识点）：
  KyleBing/english-vocabulary  full_line_jsonl/full/乱序/*.jsonl
    每个文件对应一个考试级别, 含逐词精讲(例句/短语/近义/同根/真题) + 英文释义/音标/词序

兜底基础（本地已有）：
  原词库 public/vocab.json  (28.5k 词: 英文/中文/难度/词频)  —— 作为基础池, 优先级高

可选增强（有缓存则用, 无则跳过, 避免大文件下载阻塞）：
  ECDICT ecdict.csv   —— 兜底释义/音标/考试标签/词频 (若有缓存)
  Tofu   words.csv    —— 中文释义/英美音标 (若有缓存)

输出字段：
  w 单词, zh 中文释义, phonetic 音标, frq 词频序,
  d 难度(0-10), f 常见度(越高越常见), tag 标签, collins 柯林斯星级
  note 知识点(<=80字; 过长截断), note_long 完整知识点, has_note

运行:python tools/build_unified_db.py
"""
import csv, io, json, os, re, sys, time, math, urllib.request, urllib.parse, ssl, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
# 产出【原始】词库，不是最终成品。
# 第 3 步 compute_chain_idx.js 会读它、过滤、写出 data/db.json（成品）。
# 分成两个文件是为了防止"就地改写"：过滤规则一旦删过头，重跑第 3 步（约 30 秒）就能恢复，
# 不必从 ECDICT 重新整合（几分钟）。曾经两者共用一个文件，导致误删的词永久消失。
OUT = os.path.join(DATA, 'db.raw.json')
SEED = os.path.join(ROOT, 'public', 'vocab.json')

KYLE_API = 'https://api.github.com/repos/KyleBing/english-vocabulary/contents/full_line_jsonl/full/%E4%B9%B1%E5%BA%8F'
KYLE_RAW = 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/'
ECD_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
TOFU_URL = 'https://raw.githubusercontent.com/Tofu-Xx/dictionary/main/words.csv'

# 考试级别(文件名/标签) -> 难度
LEVEL_DIFF = {'初中': 1, '中考': 1, '高考': 3, '四级': 4, '六级': 6, '考研': 6,
              '雅思': 7, '托福': 8, 'GRE': 9, 'SAT': 9, 'GMAT': 9, '专四': 5, '专八': 8, 'PETS': 2}
# 注：本步骤【不做】任何"游戏规则"判断（元音结尾 / 禁 ry·ht·ck 之类），只负责整合原始词条。
# 那些规则只在下一行的下一环 compute_chain_idx.js 里用到，且它直接复用 public/logic.js 的实现。
# （旧版本这里留过一个没用到的 VOWELS = 'aeiouy'，已删除 —— 死常量容易让人误以为规则有两处。）


def download(url, path, expect_min=1000):
    if os.path.exists(path) and os.path.getsize(path) > expect_min:
        return True
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ctx = ssl.create_default_context()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            r = urllib.request.urlopen(req, timeout=90, context=ctx)
            tmp = path + '.part'; n = 0
            with open(tmp, 'wb') as f:
                while True:
                    c = r.read(262144)
                    if not c:
                        break
                    f.write(c); n += len(c)
            if n < expect_min:
                raise IOError('small %d' % n)
            os.replace(tmp, path)
            print('  ok', os.path.basename(path), n)
            return True
        except Exception as e:
            print('  retry', attempt, repr(e)); time.sleep(2)
    return False


def api_json(url):
    ctx = ssl.create_default_context()
    r = urllib.request.urlopen(url, timeout=60, context=ctx)
    return json.loads(r.read().decode('utf-8'))


# ---------- Kyle：主源 ----------
def kyle_note(obj):
    c = obj.get('content', {}).get('word', {}).get('content', {}) if obj.get('content') else {}
    cands = []
    # 短语(可靠, 短)
    ph = c.get('phrase', {}).get('phrases', [])
    if ph:
        p = ph[0]; cands.append((0, '短语:' + (p.get('pContent', '') or '') + ' ' + (p.get('pCn', '') or '')))
    # 同根词
    root = c.get('relWord', {}).get('rels', [])
    rw = []
    for rel in root[:2]:
        for wd in rel.get('words', [])[:3]:
            if wd.get('hwd'):
                rw.append(wd['hwd'])
    if rw:
        cands.append((1, '同根词:' + '/'.join(rw[:3])))
    # 例句(可靠, 但常较长 -> 触发"打开提示")
    sen = c.get('sentence', {}).get('sentences', [])
    if sen:
        s = sen[0]; cands.append((2, '例句:' + (s.get('sContent', '') or '') + ' — ' + (s.get('sCn', '') or '')))
    # 近义词(源数据不稳, 最低优先级)
    syno = c.get('syno', {}).get('synos', [])
    sw = []
    for s in syno[:3]:
        for h in s.get('hwds', [])[:3]:
            if h.get('w'):
                sw.append(h['w'])
    if sw:
        cands.append((3, '近义词:' + '/'.join(sw[:3])))

    cands = [(w, re.sub(r'\s+', ' ', t).strip()) for (w, t) in cands if t.strip()]
    if not cands:
        return None
    # 选 <=80 且价值高、短; 否则挑最短放 note_long
    best = None
    for w, t in cands:
        n = len(t)
        if best is None:
            best = (w, t, n)
        else:
            _, bt, bn = best
            if n <= 80 and bn > 80:
                best = (w, t, n)
            elif n <= 80 and bn <= 80 and (w < best[0] or (w == best[0] and n < bn)):
                best = (w, t, n)
            elif n > 80 and bn > 80 and n < bn:
                best = (w, t, n)
    _, t, n = best
    return (t[:40] + '…' if n > 80 else t, t if n > 80 else None)


def collect_kyle():
    import glob
    try:
        listing = api_json(KYLE_API)
        files = [x for x in listing if x['type'] == 'file' and x['name'].endswith('.jsonl')]
    except Exception as e:
        print('[Kyle] 在线列出失败，改用本地缓存 data/kyle/*.jsonl')
        files = [{'name': os.path.basename(p), 'path': os.path.basename(p)}
                 for p in sorted(glob.glob(os.path.join(DATA, 'kyle', '*.jsonl')))]
    print('[Kyle] 待下载文件:', len(files))
    out = collections.defaultdict(dict)
    for meta in files:
        fname = meta['name']
        diff = 5
        for key, d in LEVEL_DIFF.items():
            if key in fname:
                diff = d; break
        local = os.path.join(DATA, 'kyle', fname)
        url = KYLE_RAW + urllib.parse.quote(meta['path'], safe='/')
        if not download(url, local):
            print('  跳过(下载失败):', fname); continue
        cnt = 0
        with io.open(local, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                wc = obj.get('content', {}).get('word', {})
                w = (wc.get('wordHead') or '').lower()
                if not re.fullmatch(r'[a-z]+', w) or len(w) < 2:
                    continue
                c = wc.get('content', {})
                trans = c.get('trans', [])
                zh = (trans[0].get('tranCn', '') if trans else '').replace('\n', ' ').strip()
                uk = c.get('ukphone', '') or c.get('usphone', '') or ''
                rank = obj.get('wordRank') or 0
                nt = kyle_note(obj)
                rec = out[w]
                # 取"最低级别"(最早教学/最简单)作为该词难度：同一词出现在多级时, 反映其最基础的掌握级别
                if 'diff' not in rec or diff < rec['diff']:
                    rec['diff'] = diff; rec['zh'] = zh; rec['phonetic'] = uk
                    rec['frq'] = rank if isinstance(rank, int) and rank > 0 else 0
                    rec['tag'] = fname
                if rec.get('note') is None and nt:
                    rec['note'], rec['note_long'] = nt
                    rec['has_note'] = True
                cnt += 1
        print('  ', fname, '->', cnt)
    return out


# ---------- 原词库 seed ----------
def collect_seed():
    if not os.path.exists(SEED):
        print('[seed] 未找到 public/vocab.json'); return {}
    with io.open(SEED, 'r', encoding='utf-8') as f:
        return {e['w']: e for e in json.load(f)}


# ---------- ECDICT / Tofu 可选 ----------
def _derive_diff(tag, collins, frq, length):
    best = 5
    rank = {'gre': 9, 'toefl': 8, 'ielts': 7, 'ky': 6, 'cet6': 6, 'cet4': 4, 'gk': 3, 'zk': 1}
    for t in (tag or '').split():
        if t in rank:
            best = max(best, rank[t])
    if collins >= 4:
        best = min(best, 2)
    elif collins >= 2:
        best = min(best, 4)
    elif collins == 1:
        best = min(best, 5)
    if frq and frq > 20000:
        best = max(best, 6)
    elif frq and 0 < frq < 3000:
        best = min(best, 3)
    if length > 13:
        best = max(best, 7)
    return best


def _safe_int(v):
    try:
        return int(float(v))
    except Exception:
        return 0


def _rank_common(rank):
    """词频排序(越小越常见) -> 常见度(0-1)。COCA/BNC 语料排序。仅作兜底/微调。"""
    if not rank or rank <= 0:
        return 0.0
    return max(0.0, 1.0 - math.log(rank + 1) / math.log(60001))


def clamp01(x):
    return max(0.0, min(1.0, x))


# 考试级别 -> 常见度(越低级别越常见). 与 LEVEL_DIFF 对齐
LEVEL_COMMON = {1: 0.86, 2: 0.80, 3: 0.70, 4: 0.60, 5: 0.50,
                6: 0.42, 7: 0.34, 8: 0.27, 9: 0.20}


def _collins_common(c):
    """柯林斯星级 -> 常见度(核心词更常见). 0-5星"""
    return {5: 0.85, 4: 0.72, 3: 0.60, 2: 0.50, 1: 0.42}.get(int(c or 0), 0.33)


# ---- 多源综合：常见度 与 难度 ----
# 原则：seed(原学习者词库) 是最贴近"学习者"的校准，作为主信号，不再用 ECDICT 语料排名稀释。
#       kyle(考试级别) 是权威的"学习者难度/级别"锚；ECDICT 只做兜底。
def compute_commonness(sig):
    """综合出常见度 0-1。优先级：seed_f(学习者频率) > kyle级别(考试级别) > collins/语料兜底。"""
    ln = sig['len']
    # 1) seed 词：seed_f 是学习者校准，直接主用(仅轻微 collins 平滑 + 长词减分)
    if sig.get('seed_f') is not None and float(sig['seed_f']) > 0:
        f = 0.85 * float(sig['seed_f']) + 0.15 * _collins_common(sig.get('ecd_collins', 0))
        if ln > 11:
            f -= 0.05
        return clamp01(f)
    # 2) kyle 词：由考试级别映射常见度(越低级别越常见)
    if sig.get('kyle_diff'):
        return LEVEL_COMMON.get(int(sig['kyle_diff']), 0.33)
    # 3) 仅 ECDICT：柯林斯 + 语料排名微调 + 词长
    f = _collins_common(sig.get('ecd_collins', 0))
    ranks = [r for r in (sig.get('ecd_frq'), sig.get('ecd_bnc')) if r and r > 0]
    if ranks:
        rank = min(ranks)
        if rank <= 3000:
            f += 0.10
        elif rank >= 25000:
            f -= 0.10
    if ln <= 5:
        f += 0.05
    elif ln >= 11:
        f -= 0.07
    return clamp01(f)


def compute_difficulty(sig, f):
    """综合出难度 1-10。优先级：seed_d(学习者难度, 主) > kyle考试级别(补 seed 没有的词) > 标签/柯林斯/罕见度兜底。
    seed 是完整学习者分级表, 其 d 自洽连续, 避免'同为基础词却难度不一'的抖动。"""
    ln = sig['len']
    kyle_diff = sig.get('kyle_diff')
    seed_d = sig.get('seed_d')
    c = sig.get('ecd_collins', 0)

    def nudge(d):
        if f < 0.10:
            d = max(d, 6)
        elif f < 0.18:
            d = max(d, 5)
        if ln > 13:
            d = max(d, 6)
        return min(10, max(1, d))

    # 1) 有 seed_d：主用(学习者难度, 自洽)
    if seed_d is not None:
        return nudge(int(round(float(seed_d))))

    # 2) 无 seed 但有 kyle 级别：用考试级别作为难度
    if kyle_diff:
        d = int(kyle_diff)
        if c >= 5:
            d = min(d, 3)
        elif c >= 4:
            d = min(d, 4)
        elif c >= 2:
            d = min(d, 5)
        return nudge(d)

    # 3) 仅 ECDICT：考试标签锚 + 柯林斯封顶 + 罕见度 + 词长
    rank_map = {'zk': 1, 'gk': 3, 'cet4': 4, 'cet6': 6, 'ky': 6,
                'ielts': 7, 'toefl': 8, 'gre': 9}
    anchor = 5
    for t in (sig.get('ecd_tag') or '').split():
        if t in rank_map:
            anchor = max(anchor, rank_map[t])
    if c >= 5:
        anchor = min(anchor, 3)
    elif c >= 4:
        anchor = min(anchor, 4)
    elif c >= 2:
        anchor = min(anchor, 5)
    elif c == 1:
        anchor = min(anchor, 6)
    if f < 0.10:
        anchor = max(anchor, 7)
    elif f < 0.18:
        anchor = max(anchor, 5)
    if ln > 13:
        anchor = max(anchor, 7)
    return min(10, max(1, anchor))


def load_ecd_map():
    p = os.path.join(DATA, 'ecdict.csv')
    m = {}
    # 无缓存先尝试联网下载（有缓存则直接用，不再"跳过"）
    if not os.path.exists(p) or os.path.getsize(p) < 1000000:
        print('[ECDICT] 无缓存，开始下载 ecdict.csv ...')
        if not download(ECD_URL, p, expect_min=10 * 1024 * 1024):
            print('[ECDICT] 下载失败，跳过 ECDICT 兜底'); return m
    with io.open(p, 'r', encoding='utf-8', errors='replace') as f:
        for row in csv.DictReader(f):
            raw = (row.get('word') or '').strip()
            # 排除缩写/专有名词：只收"原样就是纯小写"的词(AA/NASA/Aachen 等含大写都被排掉)
            if raw != raw.lower():
                continue
            w = raw.lower()
            if not re.fullmatch(r'[a-z]+', w) or len(w) < 2:
                continue
            m.setdefault(w, {
                'tag': (row.get('tag') or '').strip(),
                'collins': _safe_int(row.get('collins')),
                'oxford': _safe_int(row.get('oxford')),
                'frq': _safe_int(row.get('frq')),
                'bnc': _safe_int(row.get('bnc')),
                'zh': (row.get('translation') or '').replace('\n', ' ').strip(),
                'ph': row.get('phonetic', '') or ''
            })
    return m


def enrich_tofu(entries):
    p = os.path.join(DATA, 'tofu_words.csv')
    # 无缓存先尝试联网下载
    if not os.path.exists(p) or os.path.getsize(p) < 1000000:
        print('[Tofu] 无缓存，开始下载 words.csv ...')
        if not download(TOFU_URL, p, expect_min=2 * 1024 * 1024):
            print('[Tofu] 下载失败，跳过 Tofu 补充'); return
    print('[Tofu] 使用缓存...')
    with io.open(p, 'r', encoding='utf-8', errors='replace') as f:
        for row in csv.reader(f):
            if len(row) < 5:
                continue
            w = (row[1] or '').strip().lower()
            if w in entries:
                e = entries[w]
                if not e.get('zh') and row[4].strip():
                    e['zh'] = row[4].strip()
                if not e.get('phonetic') and row[2]:
                    e['phonetic'] = row[2]
    print('  Tofu 补充完成')


def main():
    print('== 整合词库(多源综合难度/常见度) ==')
    seed = collect_seed()
    kyle = collect_kyle()
    ecd = load_ecd_map()

    # ---- 数据源完整性把关（"绝不静默失败"）----
    # 缺数据源时**不能默默继续**：那会产出一个"看起来成功、其实少了一大块"的词库。
    # 实测过的两种残缺：
    #   · 没有 Kyle（全新克隆默认如此：GitHub API 不通且本地无缓存）
    #     → has_note 从 13,884 掉到 0 → 精讲/知识点全丢、conf 全面降级、
    #       而且 isTrusted 少了"有精讲"这一支 → 更多短词会被当成生僻词删掉
    #   · 没有 ECDICT（下载失败且无缓存）
    #     → 词条数从 33 万掉到约 4 万，差一个数量级
    if not kyle:
        print('')
        print('【警告】Kyle 精讲数据一个字都没拿到（has_note 将全部为 false）。')
        print('    影响：知识点全丢、AI 的教学加成失效、conf 全面降级，')
        print('          并且构建期的"依赖型短词清理"会多删一批词（少了"有精讲=可信"这一支）。')
        print('    原因通常是：无法访问 GitHub API，且本地没有 data/kyle/*.jsonl 缓存。')
        print('    解决：联网后重跑，或把 kyle 的 9 个 .jsonl 放到 data/kyle/ 下。')
        print('    （本次仍然继续构建，但产出的词库与标准版【不一致】，请勿直接用于发布。）')
        print('')
    if len(ecd) < 100000:
        print('【错误】ECDICT 词库不可用（只拿到 %d 条，正常应有 30 万条以上）。' % len(ecd))
        print('   它是全量词库的主体，缺了它只能生成一个约 4 万词的残缺库。')
        print('   这种"看起来成功、其实少一个数量级"的结果比直接报错更危险，故中止。')
        print('   解决：联网后重跑（首次需下载约 62MB），或把 ecdict.csv 放到 data/ 下。')
        sys.exit(1)

    # 汇拢每个词的多源信号
    sigs = {}
    for w, s in seed.items():
        sg = sigs.setdefault(w, {'len': len(w)})
        sg['seed_d'] = s.get('d'); sg['seed_f'] = s.get('f'); sg['seed_zh'] = s.get('zh', ''); sg['seed_ph'] = s.get('phonetic', '')
    for w, k in kyle.items():
        sg = sigs.setdefault(w, {'len': len(w)})
        sg['kyle_diff'] = k.get('diff'); sg['kyle_rank'] = k.get('frq', 0)
        sg['kyle_zh'] = k.get('zh', ''); sg['kyle_ph'] = k.get('phonetic', '')
        sg['kyle_note'] = k.get('note', ''); sg['kyle_note_long'] = k.get('note_long', ''); sg['kyle_has_note'] = bool(k.get('note'))
        sg['kyle_tag'] = k.get('tag', '')
    for w, r in ecd.items():
        sg = sigs.setdefault(w, {'len': len(w)})
        sg['ecd_tag'] = r['tag']; sg['ecd_collins'] = r['collins']; sg['ecd_oxford'] = r['oxford']
        sg['ecd_frq'] = r['frq']; sg['ecd_bnc'] = r['bnc']
        if not sg.get('ecd_zh'): sg['ecd_zh'] = r['zh']
        if not sg.get('ecd_ph'): sg['ecd_ph'] = r['ph']

    entries = {}
    for w, sg in sigs.items():
        zh = sg.get('seed_zh') or sg.get('kyle_zh') or sg.get('ecd_zh') or ''
        ph = sg.get('seed_ph') or sg.get('kyle_ph') or sg.get('ecd_ph') or ''
        # 只要"有中文释义"就收（缩写/专有名词已在 load_ecd_map 用 原样含大写 排除）
        if not zh:
            continue

        f = round(compute_commonness(sg), 4)
        d = compute_difficulty(sg, f)
        rank = min([x for x in (sg.get('ecd_frq'), sg.get('ecd_bnc')) if x and x > 0] or [0]) or 0
        entries[w] = {
            'w': w, 'zh': zh, 'phonetic': ph, 'frq': rank,
            'd': d, 'f': f,
            'tag': (sg.get('ecd_tag') or sg.get('kyle_tag') or ''),
            'collins': sg.get('ecd_collins', 0),
            'note': sg.get('kyle_note', ''), 'note_long': sg.get('kyle_note_long', ''), 'has_note': bool(sg.get('kyle_has_note'))
        }

    enrich_tofu(entries)

    db = sorted(entries.values(), key=lambda e: e['w'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, separators=(',', ':'))
    print('输出 %s' % OUT)
    print('  总词条: %d, 有知识点: %d, 含中文: %d' % (
        len(db), sum(1 for e in db if e.get('has_note')), sum(1 for e in db if e.get('zh'))))


if __name__ == '__main__':
    main()
