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
import csv, io, re, json, os, collections

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORD_CSV = os.path.join(BASE, 'data', 'word.csv')
TRANS_CSV = os.path.join(BASE, 'data', 'word_translation.csv')
OUT = os.path.join(BASE, 'public', 'vocab.json')


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
