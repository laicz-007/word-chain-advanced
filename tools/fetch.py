# -*- coding: utf-8 -*-
"""分块流式下载器：chunked read + 重试，避免大文件一次性 read 超时。"""
import urllib.request, ssl, json, io, os, sys, time

def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        print('cached', path, os.path.getsize(path))
        return True
    ctx = ssl.create_default_context()
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            r = urllib.request.urlopen(req, timeout=120, context=ctx)
            tmp = path + '.part'
            n = 0
            with open(tmp, 'wb') as f:
                while True:
                    chunk = r.read(262144)  # 256KB
                    if not chunk:
                        break
                    f.write(chunk)
                    n += len(chunk)
            if n < 1000:
                raise IOError('too small: %d' % n)
            os.replace(tmp, path)
            print('OK', os.path.basename(path), n)
            return True
        except Exception as e:
            print('  retry', attempt, repr(e))
            time.sleep(2)
    return False


def fetch(url, out):
    download(url, out)


def fetch_json(url, out):
    ctx = ssl.create_default_context()
    r = urllib.request.urlopen(url, timeout=60, context=ctx)
    d = json.loads(r.read().decode('utf-8'))
    with io.open(out, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    print('OK', out, len(d))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'json':
        fetch_json(sys.argv[2], sys.argv[3])
    else:
        fetch(sys.argv[2], sys.argv[3])
