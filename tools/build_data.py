# -*- coding: utf-8 -*-
"""
通过 LinXueyuanStdio/DictionaryData 的 word.csv 与 word_translation.csv
构建游戏用词库 public/vocab.json。

输出字段:
  w  : 单词(小写纯字母, 长度>=2)
  zh : 中文释义
  d  : 难度评级 (0-10, 来自词库 vc_difficulty)
  f  : 词频 (vc_frequency)

过滤规则:
  - 仅保留纯字母单词 (a-z), 去掉含空格/标点/连字符的短语。
  - 仅保留有中文释义的词 (保证出词时都能展示释义, 便于学习)。
"""
import csv, io, re, json, os, sys, collections

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORD_CSV = os.path.join(BASE, 'data', 'word.csv')
TRANS_CSV = os.path.join(BASE, 'data', 'word_translation.csv')
OUT = os.path.join(BASE, 'public', 'vocab.json')


def check_sources():
    """决定这一步该不该跑。

    源数据 data/word.csv 与 data/word_translation.csv **不入库**（data/*.csv 被 gitignore），
    而产物 public/vocab.json 是入库的 —— 所以**全新克隆天然没有源数据、但有产物**。
    这时应当跳过，而不是抛 FileNotFoundError 把整条 npm run build 打断
    （曾经就是这样：新人按 README 跑第一步，看到的是一段 Python 报错堆栈）。
    """
    have_src = os.path.exists(WORD_CSV) and os.path.exists(TRANS_CSV)
    have_out = os.path.exists(OUT) and os.path.getsize(OUT) > 100000
    if have_src:
        return True
    if have_out:
        print('[跳过] 找不到源数据 data/word.csv + word_translation.csv，')
        print('       但产物 public/vocab.json 已随仓库提供（%.2f MB），直接沿用它。'
              % (os.path.getsize(OUT) / 1048576.0))
        print('       如需重建这一步，请把 word.csv 与 word_translation.csv 放到 data/ 下再跑。')
        return False
    print('【错误】既没有源数据，也没有可用的 public/vocab.json，无法继续。', file=sys.stderr)
    print('   缺：' + WORD_CSV, file=sys.stderr)
    print('   缺：' + TRANS_CSV, file=sys.stderr)
    print('   这两个文件来自 LinXueyuanStdio/DictionaryData，请先补齐后再跑本步骤。', file=sys.stderr)
    sys.exit(1)


def load_translations():
    m = {}
    with io.open(TRANS_CSV, 'r', encoding='utf-8', errors='replace') as f:
        for row in csv.DictReader(f):
            w = (row.get('word') or '').strip().lower()
            if not w:
                continue
            t = (row.get('translation') or '').strip()
            # 保留首次出现, 避免同词多行覆盖
            if w not in m:
                m[w] = t
    return m


def main():
    if not check_sources():
        return
    trans = load_translations()
    entries = {}  # word -> dict
    stat = collections.Counter()

    with io.open(WORD_CSV, 'r', encoding='utf-8', errors='replace') as f:
        for row in csv.DictReader(f, delimiter='>'):
            w = (row.get('vc_vocabulary') or '').strip().lower()
            if not re.fullmatch(r'[a-z]+', w):
                stat['non_alpha'] += 1
                continue
            if len(w) < 2:
                stat['too_short'] += 1
                continue
            try:
                d = int(row.get('vc_difficulty') or 0)
            except ValueError:
                d = 0
            try:
                fq = float(row.get('vc_frequency') or 0)
            except ValueError:
                fq = 0.0
            zh = trans.get(w, '')
            if not zh:
                stat['no_zh'] += 1
                continue
            if w in entries:
                stat['dup'] += 1
                continue
            entries[w] = {'w': w, 'zh': zh, 'd': d, 'f': fq}

    vocab = list(entries.values())
    vocab.sort(key=lambda e: e['w'])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(vocab, f, ensure_ascii=False, separators=(',', ':'))

    print('stats:', dict(stat))
    print('vocab entries:', len(vocab))
    print('vocab.json size:', os.path.getsize(OUT))
    print('difficulty min/max:', min(e['d'] for e in vocab), max(e['d'] for e in vocab))


if __name__ == '__main__':
    main()
